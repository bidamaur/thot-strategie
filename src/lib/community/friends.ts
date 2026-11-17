import { FriendshipStatus, Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/retry";
import { getSettings } from "@/lib/settings/service";
import {
  CommunityError,
  PLAYER_CARD_SELECT,
  assertNotBlocked,
  isUniqueViolation,
  playerCard,
  requireActor,
  type PlayerCard,
} from "./core";
import { notify } from "./notifications";

/** Clé unique d'une paire, indépendante du sens de la demande. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export type Relationship =
  | "SELF"
  | "NONE"
  | "FRIENDS"
  | "REQUEST_SENT"
  | "REQUEST_RECEIVED"
  | "BLOCKED_BY_ME"
  | "BLOCKED_ME";

export async function relationshipBetween(viewerId: string, otherId: string): Promise<{
  status: Relationship;
  friendshipId: string | null;
  favorite: boolean;
}> {
  if (viewerId === otherId) return { status: "SELF", friendshipId: null, favorite: false };
  const [blocks, friendship] = await Promise.all([
    prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId, blockedId: otherId }, { blockerId: otherId, blockedId: viewerId }] },
      select: { blockerId: true },
    }),
    prisma.friendship.findUnique({ where: { pairKey: pairKey(viewerId, otherId) } }),
  ]);
  if (blocks.some((b) => b.blockerId === viewerId)) return { status: "BLOCKED_BY_ME", friendshipId: null, favorite: false };
  if (blocks.length > 0) return { status: "BLOCKED_ME", friendshipId: null, favorite: false };
  if (!friendship) return { status: "NONE", friendshipId: null, favorite: false };
  const mine = friendship.requesterId === viewerId;
  if (friendship.status === FriendshipStatus.ACCEPTED) {
    return {
      status: "FRIENDS",
      friendshipId: friendship.id,
      favorite: mine ? friendship.requesterFavorite : friendship.addresseeFavorite,
    };
  }
  if (friendship.status === FriendshipStatus.PENDING) {
    return { status: mine ? "REQUEST_SENT" : "REQUEST_RECEIVED", friendshipId: friendship.id, favorite: false };
  }
  return { status: "NONE", friendshipId: friendship.id, favorite: false };
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const f = await prisma.friendship.findUnique({ where: { pairKey: pairKey(a, b) }, select: { status: true } });
  return f?.status === FriendshipStatus.ACCEPTED;
}

export async function friendIds(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: { status: FriendshipStatus.ACCEPTED, OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

async function countFriends(tx: Prisma.TransactionClient, userId: string) {
  return tx.friendship.count({
    where: { status: FriendshipStatus.ACCEPTED, OR: [{ requesterId: userId }, { addresseeId: userId }] },
  });
}

/** Envoyer une demande. Si l'autre joueur avait déjà demandé, la demande croisée vaut acceptation. */
export async function sendFriendRequest(requesterId: string, targetUsernameOrId: string) {
  const actor = await requireActor(requesterId);
  const target = await prisma.user.findFirst({
    where: { OR: [{ id: targetUsernameOrId }, { username: targetUsernameOrId }] },
    select: { id: true, username: true, privacySettings: true },
  });
  if (!target) throw new CommunityError("Joueur introuvable.", 404);
  if (target.id === requesterId) throw new CommunityError("Vous ne pouvez pas vous ajouter vous-même.", 400);
  const privacy = target.privacySettings as { friendRequests?: unknown } | null;
  const incoming = await prisma.friendship.findUnique({ where: { pairKey: pairKey(requesterId, target.id) }, select: { status: true, requesterId: true } });
  const crossRequest = incoming?.status === FriendshipStatus.PENDING && incoming.requesterId === target.id;
  if (privacy && typeof privacy === "object" && privacy.friendRequests === "NOBODY" && !crossRequest && !actor.isAdmin) {
    throw new CommunityError("Ce joueur n’accepte pas de demandes d’amitié.", 403);
  }
  await assertNotBlocked(requesterId, target.id);

  const settings = await getSettings([
    "community.friendRequestsPerDay",
    "community.friendRequestCooldownDays",
    "community.maxFriends",
    "community.friendRequestMinGames",
  ] as const);

  if (settings["community.friendRequestMinGames"] > 0 && !actor.isAdmin) {
    const games = await prisma.match.count({
      where: {
        status: { in: ["FINISHED", "ABANDONED"] },
        OR: [{ playerWhiteId: requesterId }, { playerBlackId: requesterId }],
      },
    });
    if (games < settings["community.friendRequestMinGames"]) {
      throw new CommunityError(
        `Jouez au moins ${settings["community.friendRequestMinGames"]} parties avant d’envoyer des demandes d’amitié.`,
        403,
      );
    }
  }
  const sentToday = await prisma.friendship.count({
    where: { requesterId, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  if (sentToday >= settings["community.friendRequestsPerDay"]) {
    throw new CommunityError("Trop de demandes d’amitié envoyées aujourd’hui. Réessayez demain.", 429);
  }

  const key = pairKey(requesterId, target.id);
  const result = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const existing = await tx.friendship.findUnique({ where: { pairKey: key } });
        if (existing?.status === FriendshipStatus.ACCEPTED) {
          throw new CommunityError("Vous êtes déjà amis.", 409);
        }
        if (existing?.status === FriendshipStatus.PENDING) {
          if (existing.requesterId === requesterId) {
            throw new CommunityError("Votre demande est déjà en attente.", 409);
          }
          // Demande croisée : on accepte directement.
          await assertCapacity(tx, requesterId, target.id, settings["community.maxFriends"]);
          await tx.friendship.update({
            where: { id: existing.id },
            data: { status: FriendshipStatus.ACCEPTED, respondedAt: new Date() },
          });
          return { status: "ACCEPTED" as const };
        }
        if (existing?.status === FriendshipStatus.DECLINED && existing.requesterId === requesterId) {
          const cooldownMs = settings["community.friendRequestCooldownDays"] * 24 * 3600 * 1000;
          const since = existing.respondedAt ?? existing.updatedAt;
          if (Date.now() - since.getTime() < cooldownMs) {
            throw new CommunityError("Ce joueur a décliné votre demande récemment. Patientez avant de redemander.", 429);
          }
        }
        await assertCapacity(tx, requesterId, null, settings["community.maxFriends"]);
        const data = {
          requesterId,
          addresseeId: target.id,
          status: FriendshipStatus.PENDING,
          respondedAt: null,
          requesterFavorite: false,
          addresseeFavorite: false,
          createdAt: new Date(),
        };
        if (existing) await tx.friendship.update({ where: { id: existing.id }, data });
        else await tx.friendship.create({ data: { ...data, pairKey: key } });
        return { status: "PENDING" as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  ).catch((error: unknown) => {
    if (isUniqueViolation(error)) throw new CommunityError("Une demande existe déjà entre vous.", 409);
    throw error;
  });

  if (result.status === "PENDING") {
    await notify({
      userId: target.id,
      actorId: requesterId,
      type: "FRIEND_REQUEST",
      title: `${actor.username} souhaite devenir votre ami`,
      link: "/communaute?tab=amis",
    });
  } else {
    await notify({
      userId: target.id,
      actorId: requesterId,
      type: "FRIEND_ACCEPTED",
      title: `${actor.username} et vous êtes maintenant amis`,
      link: `/joueurs/${encodeURIComponent(actor.username)}`,
    });
  }
  return result;
}

async function assertCapacity(tx: Prisma.TransactionClient, a: string, b: string | null, max: number) {
  for (const id of b ? [a, b] : [a]) {
    if ((await countFriends(tx, id)) >= max) {
      throw new CommunityError(
        id === a ? `Vous avez atteint la limite de ${max} amis.` : "Ce joueur a atteint sa limite d’amis.",
        409,
      );
    }
  }
}

/** Réponse du destinataire : accepter, refuser, ou refuser et bloquer. */
export async function respondFriendRequest(userId: string, friendshipId: string, decision: "accept" | "decline" | "block") {
  const actor = await requireActor(userId, decision === "accept" ? "write" : "read");
  const settings = await getSettings(["community.maxFriends"] as const);
  const friendship = await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const f = await tx.friendship.findUnique({ where: { id: friendshipId } });
        if (!f || f.addresseeId !== userId) throw new CommunityError("Demande introuvable.", 404);
        if (f.status !== FriendshipStatus.PENDING) throw new CommunityError("Cette demande a déjà reçu une réponse.", 409);
        if (decision === "accept") await assertCapacity(tx, userId, f.requesterId, settings["community.maxFriends"]);
        const updated = await tx.friendship.update({
          where: { id: f.id },
          data: {
            status: decision === "accept" ? FriendshipStatus.ACCEPTED : FriendshipStatus.DECLINED,
            respondedAt: new Date(),
          },
        });
        if (decision === "block") {
          await tx.userBlock.upsert({
            where: { blockerId_blockedId: { blockerId: userId, blockedId: f.requesterId } },
            create: { blockerId: userId, blockedId: f.requesterId },
            update: {},
          });
        }
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  if (decision === "accept") {
    await notify({
      userId: friendship.requesterId,
      actorId: userId,
      type: "FRIEND_ACCEPTED",
      title: `${actor.username} a accepté votre demande d’amitié`,
      link: `/joueurs/${encodeURIComponent(actor.username)}`,
    });
  }
  return { status: friendship.status };
}

/** Annuler sa propre demande en attente. */
export async function cancelFriendRequest(userId: string, friendshipId: string) {
  const updated = await prisma.friendship.updateMany({
    where: { id: friendshipId, requesterId: userId, status: FriendshipStatus.PENDING },
    data: { status: FriendshipStatus.CANCELLED, respondedAt: new Date() },
  });
  if (updated.count === 0) throw new CommunityError("Demande introuvable ou déjà traitée.", 404);
}

/** Retirer un ami (la relation repasse à « annulée », sans délai pour redemander). */
export async function removeFriend(userId: string, otherId: string) {
  const updated = await prisma.friendship.updateMany({
    where: { pairKey: pairKey(userId, otherId), status: FriendshipStatus.ACCEPTED },
    data: { status: FriendshipStatus.CANCELLED, requesterFavorite: false, addresseeFavorite: false, respondedAt: new Date() },
  });
  if (updated.count === 0) throw new CommunityError("Ce joueur n’est pas dans vos amis.", 404);
}

export async function setFavorite(userId: string, otherId: string, favorite: boolean) {
  const f = await prisma.friendship.findUnique({ where: { pairKey: pairKey(userId, otherId) } });
  if (!f || f.status !== FriendshipStatus.ACCEPTED) throw new CommunityError("Ce joueur n’est pas dans vos amis.", 404);
  await prisma.friendship.update({
    where: { id: f.id },
    data: f.requesterId === userId ? { requesterFavorite: favorite } : { addresseeFavorite: favorite },
  });
}

/** Bloquer : met fin à l'amitié et aux demandes en cours, empêche toute interaction directe. */
export async function blockUser(userId: string, targetId: string) {
  if (userId === targetId) throw new CommunityError("Vous ne pouvez pas vous bloquer vous-même.", 400);
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) throw new CommunityError("Joueur introuvable.", 404);
  await prisma.$transaction([
    prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
      create: { blockerId: userId, blockedId: targetId },
      update: {},
    }),
    prisma.friendship.updateMany({
      where: { pairKey: pairKey(userId, targetId), status: { in: [FriendshipStatus.ACCEPTED, FriendshipStatus.PENDING] } },
      data: { status: FriendshipStatus.CANCELLED, requesterFavorite: false, addresseeFavorite: false, respondedAt: new Date() },
    }),
    prisma.friendChallenge.updateMany({
      where: {
        status: "PENDING",
        OR: [
          { challengerId: userId, challengedId: targetId },
          { challengerId: targetId, challengedId: userId },
        ],
      },
      data: { status: "CANCELLED", respondedAt: new Date() },
    }),
  ]);
}

export async function unblockUser(userId: string, targetId: string) {
  await prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
}

export async function listBlocked(userId: string) {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { blocked: { select: { id: true, username: true, avatar: true } } },
  });
  return rows.map((r) => ({ ...r.blocked, blockedAt: r.createdAt.toISOString() }));
}

export interface FriendRow extends PlayerCard {
  friendshipId: string;
  favorite: boolean;
  since: string;
}

export async function listFriends(userId: string): Promise<FriendRow[]> {
  const rows = await prisma.friendship.findMany({
    where: { status: FriendshipStatus.ACCEPTED, OR: [{ requesterId: userId }, { addresseeId: userId }] },
    orderBy: { respondedAt: "desc" },
    take: 1000,
    include: { requester: { select: PLAYER_CARD_SELECT }, addressee: { select: PLAYER_CARD_SELECT } },
  });
  return rows
    .map((f) => {
      const mine = f.requesterId === userId;
      const other = mine ? f.addressee : f.requester;
      return {
        ...playerCard(other),
        friendshipId: f.id,
        favorite: mine ? f.requesterFavorite : f.addresseeFavorite,
        since: (f.respondedAt ?? f.createdAt).toISOString(),
      };
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
}

export async function listRequests(userId: string) {
  const [received, sent] = await Promise.all([
    prisma.friendship.findMany({
      where: { addresseeId: userId, status: FriendshipStatus.PENDING },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { requester: { select: PLAYER_CARD_SELECT } },
    }),
    prisma.friendship.findMany({
      where: { requesterId: userId, status: FriendshipStatus.PENDING },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { addressee: { select: PLAYER_CARD_SELECT } },
    }),
  ]);
  return {
    received: received.map((f) => ({ friendshipId: f.id, createdAt: f.createdAt.toISOString(), player: playerCard(f.requester) })),
    sent: sent.map((f) => ({ friendshipId: f.id, createdAt: f.createdAt.toISOString(), player: playerCard(f.addressee) })),
  };
}

/** Recherche de joueurs (pseudo) pour ajouter des amis ou trouver un adversaire. */
export async function searchPlayers(viewerId: string, query: string, limit = 12) {
  const q = query.trim().slice(0, 30);
  if (q.length < 2) return [];
  const blocked = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  const hidden = new Set(blocked.flatMap((b) => [b.blockerId, b.blockedId]));
  hidden.add(viewerId);
  const rows = await prisma.user.findMany({
    where: { username: { contains: q, mode: "insensitive" }, id: { notIn: [...hidden] } },
    orderBy: { username: "asc" },
    take: Math.min(limit, 30),
    select: PLAYER_CARD_SELECT,
  });
  return rows.map(playerCard);
}
