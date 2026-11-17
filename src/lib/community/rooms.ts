import {
  CommunityPostPermission,
  CommunityRoomRole,
  CommunityRoomVisibility,
  Prisma,
} from "@/generated/prisma-client";
import { writeAuditLog } from "@/lib/audit";
import { slugify } from "@/lib/clubs/service";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { actorPrivileges, CommunityError, isUniqueViolation, requireActor } from "./core";
import { friendIds } from "./friends";
import { notify } from "./notifications";
import { cleanText, decodeFromDb, encodeBounded } from "./text";

export const ROOM_ICONS = ["chat", "chess", "draughts", "swords", "trophy", "shield", "target", "news", "lock", "star"] as const;

export interface RoomAccess {
  canView: boolean;
  canPost: boolean;
  canModerate: boolean;
  isMember: boolean;
  follow: boolean;
  role: CommunityRoomRole | null;
}

type RoomRow = Prisma.CommunityRoomGetPayload<object>;

export async function roomAccess(
  room: RoomRow,
  viewer: { id: string; isAdmin: boolean } | null,
): Promise<RoomAccess> {
  const membership = viewer
    ? await prisma.communityRoomMember.findUnique({
        where: { roomId_userId: { roomId: room.id, userId: viewer.id } },
        select: { role: true, follow: true },
      })
    : null;
  const isAdmin = viewer?.isAdmin ?? false;
  const role = membership?.role ?? null;
  const canModerate = isAdmin || role === "OWNER" || role === "MODERATOR";
  const canView = isAdmin || (room.isActive && (room.visibility === "PUBLIC" || membership !== null));
  const canPost =
    !!viewer &&
    canView &&
    room.isActive &&
    (room.postPermission === "EVERYONE"
      ? room.visibility === "PUBLIC" || membership !== null
      : room.postPermission === "MEMBERS"
        ? membership !== null
        : canModerate);
  return { canView, canPost, canModerate, isMember: membership !== null, follow: membership?.follow ?? false, role };
}

function roomDto(room: RoomRow & { _count?: { posts: number; members: number } }, access?: RoomAccess) {
  return {
    id: room.id,
    slug: room.slug,
    name: decodeFromDb(room.name),
    description: decodeFromDb(room.description),
    icon: room.icon,
    isActive: room.isActive,
    visibility: room.visibility,
    postPermission: room.postPermission,
    commentsEnabled: room.commentsEnabled,
    sortOrder: room.sortOrder,
    ownerId: room.ownerId,
    postCount: room._count?.posts ?? null,
    memberCount: room._count?.members ?? null,
    access: access ?? null,
  };
}

export type RoomDto = ReturnType<typeof roomDto>;

/** Salons visibles par le joueur : publics actifs + privés dont il est membre. */
export async function listRooms(viewer: { id: string; isAdmin: boolean } | null) {
  const memberships = viewer
    ? await prisma.communityRoomMember.findMany({ where: { userId: viewer.id }, select: { roomId: true } })
    : [];
  const rooms = await prisma.communityRoom.findMany({
    where: {
      isActive: true,
      OR: [{ visibility: "PUBLIC" }, { id: { in: memberships.map((m) => m.roomId) } }],
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { posts: { where: { deletedAt: null, isHidden: false } }, members: true } } },
  });
  return Promise.all(rooms.map(async (room) => roomDto(room, await roomAccess(room, viewer))));
}

export async function getRoom(slug: string, viewer: { id: string; isAdmin: boolean } | null) {
  const room = await prisma.communityRoom.findUnique({
    where: { slug },
    include: { _count: { select: { posts: { where: { deletedAt: null, isHidden: false } }, members: true } } },
  });
  if (!room) throw new CommunityError("Salon introuvable.", 404);
  const access = await roomAccess(room, viewer);
  if (!access.canView) throw new CommunityError("Ce salon est privé.", 403);
  return roomDto(room, access);
}

/** Rejoindre / suivre un salon public, ou quitter. */
export async function setRoomMembership(userId: string, slug: string, action: "join" | "leave" | "follow" | "unfollow") {
  const actor = await requireActor(userId, "read");
  const room = await prisma.communityRoom.findUnique({ where: { slug } });
  if (!room || (!room.isActive && !actor.isAdmin)) throw new CommunityError("Salon introuvable.", 404);
  const membership = await prisma.communityRoomMember.findUnique({
    where: { roomId_userId: { roomId: room.id, userId } },
  });
  if (action === "leave") {
    if (membership?.role === "OWNER") throw new CommunityError("Le créateur ne peut pas quitter son salon.", 400);
    await prisma.communityRoomMember.deleteMany({ where: { roomId: room.id, userId } });
    return;
  }
  if (!membership) {
    if (room.visibility === "PRIVATE" && !actor.isAdmin) {
      throw new CommunityError("Ce salon privé est accessible sur invitation.", 403);
    }
    await prisma.communityRoomMember.create({
      data: { roomId: room.id, userId, follow: action !== "unfollow" },
    });
    return;
  }
  if (action === "follow" || action === "unfollow") {
    await prisma.communityRoomMember.update({ where: { id: membership.id }, data: { follow: action === "follow" } });
  }
}

interface RoomInput {
  name?: unknown;
  description?: unknown;
  icon?: unknown;
  isActive?: unknown;
  visibility?: unknown;
  postPermission?: unknown;
  commentsEnabled?: unknown;
  sortOrder?: unknown;
}

function parseRoomInput(input: RoomInput, partial: boolean) {
  const data: Prisma.CommunityRoomUpdateInput = {};
  if (input.name !== undefined || !partial) {
    const name = cleanText(input.name, 60);
    if (name.length < 3) throw new CommunityError("Le nom du salon doit contenir au moins 3 caractères.", 400);
    data.name = encodeBounded(name, 60);
  }
  if (input.description !== undefined) {
    const description = cleanText(input.description, 300);
    data.description = description ? encodeBounded(description, 300) : null;
  }
  if (input.icon !== undefined) {
    data.icon = typeof input.icon === "string" && (ROOM_ICONS as readonly string[]).includes(input.icon) ? input.icon : "chat";
  }
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (input.visibility !== undefined) {
    if (input.visibility !== "PUBLIC" && input.visibility !== "PRIVATE") throw new CommunityError("Visibilité invalide.", 400);
    data.visibility = input.visibility as CommunityRoomVisibility;
  }
  if (input.postPermission !== undefined) {
    if (!["EVERYONE", "MEMBERS", "MODERATORS"].includes(String(input.postPermission))) {
      throw new CommunityError("Permission de publication invalide.", 400);
    }
    data.postPermission = input.postPermission as CommunityPostPermission;
  }
  if (input.commentsEnabled !== undefined) data.commentsEnabled = Boolean(input.commentsEnabled);
  if (input.sortOrder !== undefined) {
    const order = Number(input.sortOrder);
    if (!Number.isInteger(order) || order < 0 || order > 10_000) throw new CommunityError("Ordre invalide.", 400);
    data.sortOrder = order;
  }
  return data;
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "salon";
  for (let i = 0; i < 20; i += 1) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.communityRoom.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Administration : créer un salon public (ou privé). */
export async function adminCreateRoom(adminId: string, input: RoomInput) {
  const data = parseRoomInput(input, false) as Prisma.CommunityRoomCreateInput;
  const slug = await uniqueSlug(String(input.name ?? ""));
  return prisma.$transaction(async (tx) => {
    const room = await tx.communityRoom.create({ data: { ...data, slug } });
    await writeAuditLog(tx, { actorId: adminId, action: "COMMUNITY_ROOM_CREATED", entity: "CommunityRoom", entityId: room.id, after: { slug, name: room.name } });
    return roomDto(room);
  });
}

export async function adminUpdateRoom(adminId: string, roomId: string, input: RoomInput) {
  const before = await prisma.communityRoom.findUnique({ where: { id: roomId } });
  if (!before) throw new CommunityError("Salon introuvable.", 404);
  const data = parseRoomInput(input, true);
  return prisma.$transaction(async (tx) => {
    const room = await tx.communityRoom.update({ where: { id: roomId }, data });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: "COMMUNITY_ROOM_UPDATED",
      entity: "CommunityRoom",
      entityId: roomId,
      before: { name: before.name, isActive: before.isActive, visibility: before.visibility, postPermission: before.postPermission, commentsEnabled: before.commentsEnabled, sortOrder: before.sortOrder },
      after: data as Prisma.InputJsonValue,
    });
    return roomDto(room);
  });
}

/** Suppression définitive (les publications restent, sans salon) — la désactivation est préférable. */
export async function adminDeleteRoom(adminId: string, roomId: string) {
  const room = await prisma.communityRoom.findUnique({ where: { id: roomId } });
  if (!room) throw new CommunityError("Salon introuvable.", 404);
  await prisma.$transaction(async (tx) => {
    await tx.communityRoom.delete({ where: { id: roomId } });
    await writeAuditLog(tx, { actorId: adminId, action: "COMMUNITY_ROOM_DELETED", entity: "CommunityRoom", entityId: roomId, before: { slug: room.slug, name: room.name } });
  });
}

export async function adminListRooms() {
  const rooms = await prisma.communityRoom.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { posts: true, members: true } }, owner: { select: { username: true } } },
  });
  return rooms.map((r) => ({ ...roomDto(r), owner: r.owner?.username ?? null }));
}

/** Premium : créer un salon privé (limite selon le niveau). */
export async function createPrivateRoom(userId: string, input: RoomInput) {
  const actor = await requireActor(userId);
  const settings = await getSettings(["community.privateRoomsEnabled"] as const);
  if (!settings["community.privateRoomsEnabled"] && !actor.isAdmin) {
    throw new CommunityError("La création de salons privés est désactivée.", 403);
  }
  const privileges = await actorPrivileges(actor);
  const max = privileges.privateRooms ?? 0;
  if (max <= 0) throw new CommunityError("Les salons privés sont un privilège Premium.", 403);
  const owned = await prisma.communityRoom.count({ where: { ownerId: userId } });
  if (owned >= max) throw new CommunityError(`Limite de ${max} salon(s) privé(s) atteinte pour votre niveau.`, 403);

  const data = parseRoomInput({ ...input, visibility: "PRIVATE", isActive: true }, false) as Prisma.CommunityRoomCreateInput;
  const slug = await uniqueSlug(String(input.name ?? ""));
  try {
    const room = await prisma.communityRoom.create({
      data: {
        ...data,
        slug,
        sortOrder: 1000,
        owner: { connect: { id: userId } },
        members: { create: { userId, role: "OWNER" } },
      },
    });
    return roomDto(room);
  } catch (error) {
    if (isUniqueViolation(error)) throw new CommunityError("Ce nom de salon est déjà pris.", 409);
    throw error;
  }
}

/** Inviter des amis dans un salon privé (propriétaire ou modérateur). */
export async function inviteToRoom(userId: string, slug: string, userIds: string[]) {
  const actor = await requireActor(userId);
  const room = await prisma.communityRoom.findUnique({ where: { slug } });
  if (!room) throw new CommunityError("Salon introuvable.", 404);
  const access = await roomAccess(room, actor);
  if (!access.canModerate) throw new CommunityError("Seuls les animateurs du salon peuvent inviter.", 403);
  const privileges = await actorPrivileges(actor);
  const friends = new Set(await friendIds(userId));
  const targets = [...new Set(userIds)].filter((id) => friends.has(id) || actor.isAdmin).slice(0, privileges.maxBulkInvites ?? 5);
  if (targets.length === 0) throw new CommunityError("Sélectionnez des amis à inviter.", 400);
  await prisma.communityRoomMember.createMany({
    data: targets.map((id) => ({ roomId: room.id, userId: id })),
    skipDuplicates: true,
  });
  await notify(
    targets.map((id) => ({
      userId: id,
      actorId: userId,
      type: "ROOM_PINNED" as const,
      title: `${actor.username} vous a ajouté au salon « ${decodeFromDb(room.name)} »`,
      link: `/communaute/salons/${room.slug}`,
    })),
  );
  return { invited: targets.length };
}
