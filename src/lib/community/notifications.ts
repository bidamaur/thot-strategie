import type { Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/service";
import { cursorWhere, decodeCursor, encodeCursor, AUTHOR_SELECT, authorCard } from "./core";
import { decodeFromDb, encodeBounded } from "./text";

/**
 * Système de notifications unique de la plateforme (il n'en existait pas).
 * Asynchrone : un échec d'envoi ne fait jamais échouer l'action principale.
 */

export const NOTIFICATION_TYPES = {
  FRIEND_REQUEST: "Nouvelle demande d’amitié",
  FRIEND_ACCEPTED: "Demande d’amitié acceptée",
  POST_COMMENT: "Commentaire sur vos publications",
  COMMENT_REPLY: "Réponse à vos commentaires",
  POST_REACTION: "Réaction à vos publications",
  CHALLENGE_RECEIVED: "Nouveau défi",
  CHALLENGE_ACCEPTED: "Défi accepté",
  CHALLENGE_DECLINED: "Défi refusé ou expiré",
  TOURNAMENT_INVITE: "Invitation à un tournoi",
  CLUB_INVITE: "Invitation à un club",
  CLUB_MATCH: "Rencontres interclubs de mes clubs",
  ROOM_PINNED: "Publication importante d’un salon suivi",
  MODERATION: "Décisions de modération",
  GAME_EXIT_REQUEST: "Demande de quitter ma partie en cours",
  GAME_EXIT_ANSWER: "Réponse à mes demandes de sortie de partie",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** Types que le joueur ne peut pas couper (sécurité, sanctions). */
const MANDATORY: NotificationType[] = ["MODERATION"];

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
}

function disabledByUser(prefs: Prisma.JsonValue | null, type: NotificationType): boolean {
  if (MANDATORY.includes(type)) return false;
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return false;
  const off = (prefs as { disabled?: unknown }).disabled;
  return Array.isArray(off) && off.includes(type);
}

/** Envoie des notifications en respectant les préférences et l'administration. */
export async function notify(inputs: NotifyInput | NotifyInput[]): Promise<number> {
  const list = (Array.isArray(inputs) ? inputs : [inputs]).filter((n) => n.userId && n.userId !== n.actorId);
  if (list.length === 0) return 0;
  try {
    const globallyDisabled = await getSetting("community.disabledNotificationTypes");
    const recipients = await prisma.user.findMany({
      where: { id: { in: [...new Set(list.map((n) => n.userId))] } },
      select: { id: true, notificationPrefs: true },
    });
    const prefs = new Map(recipients.map((r) => [r.id, r.notificationPrefs]));
    const data = list
      .filter((n) => prefs.has(n.userId))
      .filter((n) => MANDATORY.includes(n.type) || !globallyDisabled.includes(n.type))
      .filter((n) => !disabledByUser(prefs.get(n.userId) ?? null, n.type))
      .map((n) => ({
        userId: n.userId,
        type: n.type,
        actorId: n.actorId ?? null,
        title: encodeBounded(n.title, 160),
        body: n.body ? encodeBounded(n.body, 300) : null,
        link: n.link?.slice(0, 300) ?? null,
      }));
    if (data.length === 0) return 0;
    const result = await prisma.notification.createMany({ data });
    return result.count;
  } catch (error) {
    console.error("Notification non envoyée :", error);
    return 0;
  }
}

export async function listNotifications(userId: string, cursor?: string | null, limit = 20) {
  const take = Math.min(Math.max(limit, 1), 50);
  const rows = await prisma.notification.findMany({
    where: { userId, ...cursorWhere(decodeCursor(cursor)) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    include: { actor: { select: AUTHOR_SELECT } },
  });
  const page = rows.slice(0, take);
  return {
    items: page.map((n) => ({
      id: n.id,
      type: n.type,
      title: decodeFromDb(n.title),
      body: decodeFromDb(n.body),
      link: n.link,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
      actor: n.actor ? authorCard(n.actor) : null,
    })),
    nextCursor: rows.length > take ? encodeCursor(page[page.length - 1]!) : null,
  };
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, ids: string[] | "all"): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids.slice(0, 100) } }) },
    data: { readAt: new Date() },
  });
  return result.count;
}

export function readPreferences(prefs: Prisma.JsonValue | null) {
  const disabled = new Set<string>();
  if (prefs && typeof prefs === "object" && !Array.isArray(prefs)) {
    const off = (prefs as { disabled?: unknown }).disabled;
    if (Array.isArray(off)) off.forEach((t) => typeof t === "string" && disabled.add(t));
  }
  return (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((type) => ({
    type,
    label: NOTIFICATION_TYPES[type],
    enabled: MANDATORY.includes(type) || !disabled.has(type),
    mandatory: MANDATORY.includes(type),
  }));
}

export async function savePreferences(userId: string, disabled: string[]) {
  const valid = disabled.filter(
    (t): t is NotificationType => t in NOTIFICATION_TYPES && !MANDATORY.includes(t as NotificationType),
  );
  await prisma.user.update({ where: { id: userId }, data: { notificationPrefs: { disabled: valid } } });
  return valid;
}
