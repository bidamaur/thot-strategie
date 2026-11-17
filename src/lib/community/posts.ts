import { CommunityReactionType, Prisma } from "@/generated/prisma-client";
import { withSerializableRetry } from "@/lib/db/retry";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import {
  AUTHOR_SELECT,
  actorPrivileges,
  assertNotBlocked,
  assertRate,
  authorCard,
  blockedIdsFor,
  CommunityError,
  cursorWhere,
  decodeCursor,
  encodeCursor,
  requireActor,
  type CommunityActor,
} from "./core";
import { notify } from "./notifications";
import { roomAccess } from "./rooms";
import { cleanText, decodeFromDb, encodeBounded, encodeForDb } from "./text";

export const REACTIONS: Record<CommunityReactionType, { label: string; emoji: string }> = {
  LIKE: { label: "J’aime", emoji: "👍" },
  BRAVO: { label: "Bravo", emoji: "👏" },
  INTERESTING: { label: "Intéressant", emoji: "💡" },
  CONGRATS: { label: "Félicitations", emoji: "🎉" },
};

export function parseReaction(value: unknown): CommunityReactionType | null {
  return typeof value === "string" && value in REACTIONS ? (value as CommunityReactionType) : null;
}

type Viewer = { id: string; isAdmin: boolean } | null;

// ── Espaces (salon ou club) ───────────────────────────────────────────

interface SpaceAccess {
  canView: boolean;
  canPost: boolean;
  canModerate: boolean;
  canComment: boolean;
  /** Le responsable de l'espace peut épingler (privilège Premium ou admin). */
  canPin: boolean;
}

async function clubAccess(clubId: string, viewer: Viewer): Promise<SpaceAccess> {
  const club = await prisma.club.findUnique({ where: { id: clubId }, select: { id: true, isPrivate: true, ownerId: true } });
  if (!club) return { canView: false, canPost: false, canModerate: false, canComment: false, canPin: false };
  const member = viewer
    ? await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId, userId: viewer.id } }, select: { role: true } })
    : null;
  const isAdmin = viewer?.isAdmin ?? false;
  const canModerate = isAdmin || member?.role === "OWNER" || member?.role === "ADMIN";
  const canView = isAdmin || !club.isPrivate || !!member;
  return { canView, canPost: !!viewer && !!member, canModerate, canComment: !!viewer && canView, canPin: canModerate };
}

async function spaceAccess(post: { roomId: string | null; clubId: string | null }, viewer: Viewer): Promise<SpaceAccess> {
  if (post.clubId) return clubAccess(post.clubId, viewer);
  if (post.roomId) {
    const room = await prisma.communityRoom.findUnique({ where: { id: post.roomId } });
    if (!room) return { canView: false, canPost: false, canModerate: false, canComment: false, canPin: false };
    const access = await roomAccess(room, viewer);
    return {
      canView: access.canView,
      canPost: access.canPost,
      canModerate: access.canModerate,
      canComment: !!viewer && access.canView && room.commentsEnabled && room.isActive,
      // Salons publics : épinglage réservé aux administrateurs ; salons privés : à leurs animateurs.
      canPin: (viewer?.isAdmin ?? false) || (room.visibility === "PRIVATE" && access.canModerate),
    };
  }
  // Publication sans salon (salon supprimé) : lisible, plus de nouvelles interactions.
  return { canView: true, canPost: false, canModerate: viewer?.isAdmin ?? false, canComment: false, canPin: false };
}

// ── Lecture du fil ────────────────────────────────────────────────────

const POST_INCLUDE = {
  author: { select: AUTHOR_SELECT },
  room: { select: { slug: true, name: true, icon: true } },
  club: { select: { slug: true, name: true } },
} satisfies Prisma.CommunityPostInclude;

type PostRow = Prisma.CommunityPostGetPayload<{ include: typeof POST_INCLUDE }>;

async function resolveLinks(rows: PostRow[]) {
  const tournamentIds = rows.filter((r) => r.linkType === "TOURNAMENT" && r.linkId).map((r) => r.linkId!);
  const clubIds = rows.filter((r) => r.linkType === "CLUB" && r.linkId).map((r) => r.linkId!);
  const [tournaments, clubs] = await Promise.all([
    tournamentIds.length
      ? prisma.tournament.findMany({ where: { id: { in: tournamentIds } }, select: { id: true, name: true, status: true, gameType: true } })
      : [],
    clubIds.length ? prisma.club.findMany({ where: { id: { in: clubIds } }, select: { id: true, name: true, slug: true } }) : [],
  ]);
  const t = new Map(tournaments.map((x) => [x.id, x]));
  const c = new Map(clubs.map((x) => [x.id, x]));
  return (row: PostRow) => {
    if (row.linkType === "TOURNAMENT" && row.linkId && t.has(row.linkId)) {
      const tournament = t.get(row.linkId)!;
      return {
        type: "TOURNAMENT" as const,
        label: tournament.name,
        detail: tournament.status === "OPEN" ? "Inscriptions ouvertes" : tournament.status === "IN_PROGRESS" ? "En cours" : "Terminé",
        href: `/tournois/${tournament.id}`,
        open: tournament.status === "OPEN",
      };
    }
    if (row.linkType === "CLUB" && row.linkId && c.has(row.linkId)) {
      const club = c.get(row.linkId)!;
      return { type: "CLUB" as const, label: club.name, detail: "Club", href: `/clubs/${club.slug}`, open: true };
    }
    return null;
  };
}

async function toPostDtos(rows: PostRow[], viewer: Viewer, accessByPost: Map<string, SpaceAccess>) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [counts, mine, linkOf] = await Promise.all([
    prisma.communityReaction.groupBy({ by: ["postId", "type"], where: { postId: { in: ids } }, _count: { _all: true } }),
    viewer
      ? prisma.communityReaction.findMany({ where: { userId: viewer.id, postId: { in: ids } }, select: { postId: true, type: true } })
      : [],
    resolveLinks(rows),
  ]);
  const myReaction = new Map(mine.map((m) => [m.postId!, m.type]));
  return rows.map((row) => {
    const access = accessByPost.get(row.id)!;
    const summary: Partial<Record<CommunityReactionType, number>> = {};
    for (const c of counts) if (c.postId === row.id) summary[c.type] = c._count._all;
    return {
      id: row.id,
      author: authorCard(row.author),
      room: row.room ? { slug: row.room.slug, name: decodeFromDb(row.room.name), icon: row.room.icon } : null,
      club: row.club,
      title: decodeFromDb(row.title),
      body: decodeFromDb(row.body),
      imageUrl: row.imageUrl,
      link: linkOf(row),
      isPinned: row.isPinned,
      isHidden: row.isHidden,
      commentCount: row.commentCount,
      reactionCount: row.reactionCount,
      reactions: summary,
      myReaction: myReaction.get(row.id) ?? null,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      canEdit: viewer?.id === row.authorId,
      canDelete: viewer?.id === row.authorId || access.canModerate,
      canModerate: access.canModerate,
      canPin: access.canPin,
      canComment: access.canComment,
    };
  });
}

export type PostDto = Awaited<ReturnType<typeof toPostDtos>>[number];

export interface FeedQuery {
  room?: string | null;
  club?: string | null;
  author?: string | null;
  cursor?: string | null;
  limit?: number;
}

/** Fil paginé : jamais plus de 30 publications par requête. */
export async function getFeed(viewer: Viewer, query: FeedQuery) {
  const take = Math.min(Math.max(query.limit ?? 15, 1), 30);
  const where: Prisma.CommunityPostWhereInput = { deletedAt: null };
  let pinnedFirst = false;
  let space: { canPost: boolean; canPin: boolean } | null = null;

  if (query.room) {
    const room = await prisma.communityRoom.findUnique({ where: { slug: query.room } });
    if (!room) throw new CommunityError("Salon introuvable.", 404);
    const access = await roomAccess(room, viewer);
    if (!access.canView) throw new CommunityError("Ce salon est privé.", 403);
    where.roomId = room.id;
    pinnedFirst = true;
    space = { canPost: access.canPost, canPin: (viewer?.isAdmin ?? false) || (room.visibility === "PRIVATE" && access.canModerate) };
  } else if (query.club) {
    const club = await prisma.club.findUnique({ where: { slug: query.club }, select: { id: true } });
    if (!club) throw new CommunityError("Club introuvable.", 404);
    const access = await clubAccess(club.id, viewer);
    if (!access.canView) throw new CommunityError("Ce club est privé.", 403);
    where.clubId = club.id;
    pinnedFirst = true;
    space = { canPost: access.canPost, canPin: access.canPin };
  } else {
    // Fil général : salons publics actifs + salons privés dont le joueur est membre + clubs publics/les siens.
    const [memberRooms, memberClubs] = viewer
      ? await Promise.all([
          prisma.communityRoomMember.findMany({ where: { userId: viewer.id }, select: { roomId: true } }),
          prisma.clubMember.findMany({ where: { userId: viewer.id }, select: { clubId: true } }),
        ])
      : [[], []];
    where.OR = [
      { room: { isActive: true, visibility: "PUBLIC" } },
      { roomId: { in: memberRooms.map((m) => m.roomId) } },
      { club: { isPrivate: false } },
      { clubId: { in: memberClubs.map((m) => m.clubId) } },
    ];
  }

  if (query.author) {
    const author = await prisma.user.findUnique({ where: { username: query.author }, select: { id: true } });
    if (!author) return { items: [], nextCursor: null, space };
    where.authorId = author.id;
  }
  if (viewer) {
    const blocked = await blockedIdsFor(viewer.id);
    if (blocked.length) where.authorId = { ...(typeof where.authorId === "string" ? { equals: where.authorId } : {}), notIn: blocked };
    if (!viewer.isAdmin) {
      where.AND = [{ OR: [{ isHidden: false }, { authorId: viewer.id }] }];
    }
  } else {
    where.isHidden = false;
  }

  const cursor = decodeCursor(query.cursor);
  const pinned =
    pinnedFirst && !cursor
      ? await prisma.communityPost.findMany({
          where: { ...where, isPinned: true },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: POST_INCLUDE,
        })
      : [];
  const rows = await prisma.communityPost.findMany({
    where: { AND: [where, cursorWhere(cursor), pinnedFirst ? { isPinned: false } : {}] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    include: POST_INCLUDE,
  });
  const page = rows.slice(0, take);
  const all = [...pinned, ...page];
  const accessByPost = new Map<string, SpaceAccess>();
  const cache = new Map<string, SpaceAccess>();
  for (const row of all) {
    const key = row.clubId ? `c:${row.clubId}` : `r:${row.roomId}`;
    if (!cache.has(key)) cache.set(key, await spaceAccess(row, viewer));
    accessByPost.set(row.id, cache.get(key)!);
  }
  return {
    items: await toPostDtos(all, viewer, accessByPost),
    nextCursor: rows.length > take ? encodeCursor(page[page.length - 1]!) : null,
    space,
  };
}

async function loadPost(postId: string, viewer: Viewer) {
  const row = await prisma.communityPost.findUnique({ where: { id: postId }, include: POST_INCLUDE });
  if (!row || row.deletedAt) throw new CommunityError("Publication introuvable.", 404);
  const access = await spaceAccess(row, viewer);
  if (!access.canView || (row.isHidden && !access.canModerate && viewer?.id !== row.authorId)) {
    throw new CommunityError("Publication introuvable.", 404);
  }
  return { row, access };
}

export async function getPost(postId: string, viewer: Viewer) {
  const { row, access } = await loadPost(postId, viewer);
  const [dto] = await toPostDtos([row], viewer, new Map([[row.id, access]]));
  return dto!;
}

// ── Écriture ──────────────────────────────────────────────────────────

export interface PostInput {
  room?: unknown;
  club?: unknown;
  title?: unknown;
  body?: unknown;
  imageUrl?: unknown;
  linkType?: unknown;
  linkId?: unknown;
}

async function validateImage(actor: CommunityActor, imageUrl: unknown): Promise<string | null> {
  if (imageUrl === undefined || imageUrl === null || imageUrl === "") return null;
  const settings = await getSettings(["community.imagesEnabled"] as const);
  if (!settings["community.imagesEnabled"]) throw new CommunityError("Les images sont désactivées.", 403);
  // Seules les images téléversées par l'auteur lui-même sont acceptées.
  if (typeof imageUrl !== "string" || !new RegExp(`^/uploads/community/${actor.id}_[a-z0-9]+\\.(png|jpg|webp|gif)$`).test(imageUrl)) {
    throw new CommunityError("Image invalide.", 400);
  }
  return imageUrl;
}

async function validateLink(linkType: unknown, linkId: unknown) {
  if (!linkType) return { linkType: null, linkId: null };
  if (typeof linkId !== "string" || linkId.length > 40) throw new CommunityError("Lien invalide.", 400);
  if (linkType === "TOURNAMENT") {
    const t = await prisma.tournament.findUnique({ where: { id: linkId }, select: { id: true, visibility: true } });
    if (!t || t.visibility !== "PUBLIC") throw new CommunityError("Tournoi introuvable ou non public.", 400);
    return { linkType: "TOURNAMENT" as const, linkId };
  }
  if (linkType === "CLUB") {
    const c = await prisma.club.findUnique({ where: { id: linkId }, select: { id: true } });
    if (!c) throw new CommunityError("Club introuvable.", 400);
    return { linkType: "CLUB" as const, linkId };
  }
  throw new CommunityError("Type de lien invalide.", 400);
}

export async function createPost(userId: string, input: PostInput) {
  const actor = await requireActor(userId);
  const settings = await getSettings([
    "community.postsEnabled",
    "community.postMaxLength",
    "community.postsPerHour",
    "community.minAccountAgeHours",
  ] as const);
  if (!settings["community.postsEnabled"] && !actor.isAdmin) throw new CommunityError("La publication est momentanément désactivée.", 403);
  const minAge = settings["community.minAccountAgeHours"];
  if (minAge > 0 && !actor.isAdmin && Date.now() - actor.createdAt.getTime() < minAge * 3600_000) {
    throw new CommunityError(`Votre compte doit avoir au moins ${minAge} h pour publier.`, 403);
  }
  const recent = await prisma.communityPost.count({ where: { authorId: userId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (!actor.isAdmin) await assertRate(recent, settings["community.postsPerHour"], "Vous publiez beaucoup : patientez un peu avant la prochaine publication.");

  const body = cleanText(input.body, settings["community.postMaxLength"]);
  if (body.length < 2) throw new CommunityError("Votre publication est vide.", 400);
  const title = cleanText(input.title, 140);

  let roomId: string | null = null;
  let clubId: string | null = null;
  if (typeof input.club === "string" && input.club) {
    const club = await prisma.club.findUnique({ where: { slug: input.club }, select: { id: true } });
    if (!club) throw new CommunityError("Club introuvable.", 404);
    const access = await clubAccess(club.id, actor);
    if (!access.canPost) throw new CommunityError("Seuls les membres du club peuvent y publier.", 403);
    clubId = club.id;
  } else {
    const slug = typeof input.room === "string" && input.room ? input.room : "general";
    const room = await prisma.communityRoom.findUnique({ where: { slug } });
    if (!room) throw new CommunityError("Salon introuvable.", 404);
    const access = await roomAccess(room, actor);
    if (!access.canPost) throw new CommunityError("Vous ne pouvez pas publier dans ce salon.", 403);
    roomId = room.id;
  }

  const [imageUrl, link] = await Promise.all([validateImage(actor, input.imageUrl), validateLink(input.linkType, input.linkId)]);
  const row = await prisma.communityPost.create({
    data: {
      authorId: userId,
      roomId,
      clubId,
      title: title ? encodeBounded(title, 140) : null,
      body: encodeForDb(body),
      imageUrl,
      ...link,
    },
    include: POST_INCLUDE,
  });
  const access = await spaceAccess(row, actor);
  const [dto] = await toPostDtos([row], actor, new Map([[row.id, access]]));
  return dto!;
}

export async function updatePost(userId: string, postId: string, input: PostInput) {
  await requireActor(userId);
  const settings = await getSettings(["community.postMaxLength"] as const);
  const post = await prisma.communityPost.findUnique({ where: { id: postId } });
  if (!post || post.deletedAt) throw new CommunityError("Publication introuvable.", 404);
  if (post.authorId !== userId) throw new CommunityError("Vous ne pouvez modifier que vos publications.", 403);
  const data: Prisma.CommunityPostUpdateInput = { editedAt: new Date() };
  if (input.body !== undefined) {
    const body = cleanText(input.body, settings["community.postMaxLength"]);
    if (body.length < 2) throw new CommunityError("Votre publication est vide.", 400);
    data.body = encodeForDb(body);
  }
  if (input.title !== undefined) {
    const title = cleanText(input.title, 140);
    data.title = title ? encodeBounded(title, 140) : null;
  }
  await prisma.communityPost.update({ where: { id: postId }, data });
  return getPost(postId, { id: userId, isAdmin: false });
}

/** Suppression (douce) par l'auteur ou un modérateur de l'espace. */
export async function deletePost(userId: string, postId: string) {
  const actor = await requireActor(userId, "read");
  const { row, access } = await loadPost(postId, actor);
  if (row.authorId !== userId && !access.canModerate) throw new CommunityError("Action non autorisée.", 403);
  await prisma.communityPost.update({ where: { id: postId }, data: { deletedAt: new Date(), isPinned: false } });
  return { moderated: row.authorId !== userId };
}

export async function setPinned(userId: string, postId: string, pinned: boolean) {
  const actor = await requireActor(userId);
  const { row, access } = await loadPost(postId, actor);
  if (!access.canPin) throw new CommunityError("Épingler est réservé aux responsables de cet espace.", 403);
  if (!actor.isAdmin && row.clubId) {
    const privileges = await actorPrivileges(actor);
    if (!privileges.pinInOwnSpaces) throw new CommunityError("Épingler des publications est un privilège Premium.", 403);
  }
  await prisma.communityPost.update({ where: { id: postId }, data: { isPinned: pinned } });
  if (pinned && row.roomId) {
    const followers = await prisma.communityRoomMember.findMany({
      where: { roomId: row.roomId, follow: true, userId: { not: row.authorId } },
      select: { userId: true },
      take: 5000,
    });
    await notify(
      followers.map((f) => ({
        userId: f.userId,
        actorId: userId,
        type: "ROOM_PINNED" as const,
        title: `Publication importante dans « ${row.room ? decodeFromDb(row.room.name) : "un salon"} »`,
        body: decodeFromDb(row.title) ?? decodeFromDb(row.body).slice(0, 120),
        link: `/communaute/publication/${row.id}`,
      })),
    );
  }
}

// ── Réactions ─────────────────────────────────────────────────────────

/** Une réaction par joueur et par contenu ; `null` retire la réaction. */
export async function reactToPost(userId: string, postId: string, type: CommunityReactionType | null) {
  const actor = await requireActor(userId);
  const { row, access } = await loadPost(postId, actor);
  if (!access.canComment) throw new CommunityError("Les interactions sont fermées sur cette publication.", 403);
  await assertNotBlocked(userId, row.authorId);
  const created = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.communityReaction.findUnique({ where: { userId_postId: { userId, postId } } });
        if (type === null) {
          if (existing) {
            await tx.communityReaction.delete({ where: { id: existing.id } });
            await tx.communityPost.update({ where: { id: postId }, data: { reactionCount: { decrement: 1 } } });
          }
          return false;
        }
        if (existing) {
          if (existing.type !== type) await tx.communityReaction.update({ where: { id: existing.id }, data: { type } });
          return false;
        }
        await tx.communityReaction.create({ data: { userId, postId, type } });
        await tx.communityPost.update({ where: { id: postId }, data: { reactionCount: { increment: 1 } } });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  if (created && type) {
    await notify({
      userId: row.authorId,
      actorId: userId,
      type: "POST_REACTION",
      title: `${actor.username} a réagi « ${REACTIONS[type].label} » à votre publication`,
      link: `/communaute/publication/${postId}`,
    });
  }
  return getPost(postId, actor);
}

// ── Commentaires ──────────────────────────────────────────────────────

const COMMENT_INCLUDE = { author: { select: AUTHOR_SELECT } } satisfies Prisma.CommunityCommentInclude;
type CommentRow = Prisma.CommunityCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

async function toCommentDtos(rows: CommentRow[], viewer: Viewer, canModerate: boolean) {
  const ids = rows.map((r) => r.id);
  const mine = viewer && ids.length
    ? await prisma.communityReaction.findMany({ where: { userId: viewer.id, commentId: { in: ids } }, select: { commentId: true, type: true } })
    : [];
  const myReaction = new Map(mine.map((m) => [m.commentId!, m.type]));
  return rows.map((c) => {
    const removed = c.deletedAt !== null || (c.isHidden && !canModerate && viewer?.id !== c.authorId);
    return {
      id: c.id,
      parentId: c.parentId,
      author: authorCard(c.author),
      body: removed ? null : decodeFromDb(c.body),
      removed,
      isHidden: c.isHidden,
      reactionCount: c.reactionCount,
      replyCount: c.replyCount,
      myReaction: myReaction.get(c.id) ?? null,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
      canEdit: !removed && viewer?.id === c.authorId,
      canDelete: !removed && (viewer?.id === c.authorId || canModerate),
    };
  });
}

export type CommentDto = Awaited<ReturnType<typeof toCommentDtos>>[number];

/** Commentaires d'une publication (ou réponses d'un commentaire), du plus ancien au plus récent, par pages. */
export async function listComments(viewer: Viewer, postId: string, options: { parentId?: string | null; cursor?: string | null; limit?: number }) {
  const { access } = await loadPost(postId, viewer);
  const take = Math.min(Math.max(options.limit ?? 10, 1), 30);
  const cursor = decodeCursor(options.cursor);
  const blocked = viewer ? await blockedIdsFor(viewer.id) : [];
  const rows = await prisma.communityComment.findMany({
    where: {
      postId,
      parentId: options.parentId ?? null,
      ...(blocked.length ? { authorId: { notIn: blocked } } : {}),
      // Un commentaire supprimé reste visible comme « supprimé » s'il a des réponses.
      OR: [{ deletedAt: null }, { replyCount: { gt: 0 } }],
      ...(cursor
        ? { AND: [{ OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: take + 1,
    include: COMMENT_INCLUDE,
  });
  const page = rows.slice(0, take);
  return {
    items: await toCommentDtos(page, viewer, access.canModerate),
    nextCursor: rows.length > take ? encodeCursor(page[page.length - 1]!) : null,
  };
}

export async function createComment(userId: string, postId: string, input: { body?: unknown; parentId?: unknown }) {
  const actor = await requireActor(userId);
  const settings = await getSettings(["community.commentsEnabled", "community.commentMaxLength", "community.commentsPerHour"] as const);
  if (!settings["community.commentsEnabled"] && !actor.isAdmin) throw new CommunityError("Les commentaires sont désactivés.", 403);
  const { row, access } = await loadPost(postId, actor);
  if (!access.canComment) throw new CommunityError("Les commentaires sont fermés ici.", 403);
  await assertNotBlocked(userId, row.authorId);
  const recent = await prisma.communityComment.count({ where: { authorId: userId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (!actor.isAdmin) await assertRate(recent, settings["community.commentsPerHour"], "Vous commentez beaucoup : patientez un peu.");

  const body = cleanText(input.body, settings["community.commentMaxLength"]);
  if (body.length < 1) throw new CommunityError("Votre commentaire est vide.", 400);
  const encoded = encodeForDb(body);
  if (encoded.length > 2000) throw new CommunityError("Commentaire trop long (les emojis comptent davantage).", 400);

  let parentId: string | null = null;
  let parentAuthorId: string | null = null;
  if (typeof input.parentId === "string" && input.parentId) {
    const parent = await prisma.communityComment.findUnique({ where: { id: input.parentId }, select: { id: true, postId: true, parentId: true, authorId: true, deletedAt: true } });
    if (!parent || parent.postId !== postId || parent.deletedAt) throw new CommunityError("Commentaire introuvable.", 404);
    await assertNotBlocked(userId, parent.authorId);
    // Un seul niveau de réponses : on répond au fil du commentaire principal.
    parentId = parent.parentId ?? parent.id;
    parentAuthorId = parent.authorId;
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.communityComment.create({ data: { postId, authorId: userId, parentId, body: encoded }, include: COMMENT_INCLUDE });
    await tx.communityPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
    if (parentId) await tx.communityComment.update({ where: { id: parentId }, data: { replyCount: { increment: 1 } } });
    return created;
  });

  const link = `/communaute/publication/${postId}`;
  const notifications = [];
  if (parentAuthorId && parentAuthorId !== userId) {
    notifications.push({ userId: parentAuthorId, actorId: userId, type: "COMMENT_REPLY" as const, title: `${actor.username} a répondu à votre commentaire`, body: body.slice(0, 120), link });
  }
  if (row.authorId !== userId && row.authorId !== parentAuthorId) {
    notifications.push({ userId: row.authorId, actorId: userId, type: "POST_COMMENT" as const, title: `${actor.username} a commenté votre publication`, body: body.slice(0, 120), link });
  }
  await notify(notifications);
  const [dto] = await toCommentDtos([comment], actor, access.canModerate);
  return dto!;
}

export async function updateComment(userId: string, commentId: string, bodyInput: unknown) {
  await requireActor(userId);
  const settings = await getSettings(["community.commentMaxLength"] as const);
  const comment = await prisma.communityComment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw new CommunityError("Commentaire introuvable.", 404);
  if (comment.authorId !== userId) throw new CommunityError("Vous ne pouvez modifier que vos commentaires.", 403);
  const body = cleanText(bodyInput, settings["community.commentMaxLength"]);
  if (!body) throw new CommunityError("Votre commentaire est vide.", 400);
  const encoded = encodeForDb(body);
  if (encoded.length > 2000) throw new CommunityError("Commentaire trop long.", 400);
  const updated = await prisma.communityComment.update({ where: { id: commentId }, data: { body: encoded, editedAt: new Date() }, include: COMMENT_INCLUDE });
  const [dto] = await toCommentDtos([updated], { id: userId, isAdmin: false }, false);
  return dto!;
}

export async function deleteComment(userId: string, commentId: string) {
  const actor = await requireActor(userId, "read");
  const comment = await prisma.communityComment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw new CommunityError("Commentaire introuvable.", 404);
  const { access } = await loadPost(comment.postId, actor);
  if (comment.authorId !== userId && !access.canModerate) throw new CommunityError("Action non autorisée.", 403);
  await prisma.$transaction(async (tx) => {
    await tx.communityComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    await tx.communityPost.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
    if (comment.parentId) await tx.communityComment.update({ where: { id: comment.parentId }, data: { replyCount: { decrement: 1 } } });
  });
  return { moderated: comment.authorId !== userId };
}

export async function reactToComment(userId: string, commentId: string, type: CommunityReactionType | null) {
  await requireActor(userId);
  const settings = await getSettings(["community.commentReactionsEnabled"] as const);
  if (!settings["community.commentReactionsEnabled"]) throw new CommunityError("Les réactions aux commentaires sont désactivées.", 403);
  const comment = await prisma.communityComment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw new CommunityError("Commentaire introuvable.", 404);
  const { access } = await loadPost(comment.postId, { id: userId, isAdmin: false });
  if (!access.canComment) throw new CommunityError("Les interactions sont fermées ici.", 403);
  await assertNotBlocked(userId, comment.authorId);
  await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.communityReaction.findUnique({ where: { userId_commentId: { userId, commentId } } });
        if (type === null) {
          if (existing) {
            await tx.communityReaction.delete({ where: { id: existing.id } });
            await tx.communityComment.update({ where: { id: commentId }, data: { reactionCount: { decrement: 1 } } });
          }
          return;
        }
        if (existing) {
          if (existing.type !== type) await tx.communityReaction.update({ where: { id: existing.id }, data: { type } });
          return;
        }
        await tx.communityReaction.create({ data: { userId, commentId, type } });
        await tx.communityComment.update({ where: { id: commentId }, data: { reactionCount: { increment: 1 } } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  const updated = await prisma.communityComment.findUniqueOrThrow({ where: { id: commentId }, select: { reactionCount: true } });
  return { reactionCount: updated.reactionCount, myReaction: type };
}
