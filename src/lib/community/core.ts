import { Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { badgeLevel, getPrivileges } from "@/lib/premium/privileges";
import { getSettings } from "@/lib/settings/service";
import type { SettingKey } from "@/lib/settings/registry";

/** Erreur métier de la communauté : message affichable + statut HTTP. */
export class CommunityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CommunityError";
  }
}

export async function communitySettings<const K extends readonly SettingKey[]>(keys: K) {
  return getSettings(keys);
}

export interface CommunityActor {
  id: string;
  username: string;
  isAdmin: boolean;
  isPremium: boolean;
  premiumLevel: number;
  premiumExpiresAt: Date | null;
  createdAt: Date;
}

const ACTOR_SELECT = {
  id: true,
  username: true,
  isAdmin: true,
  isPremium: true,
  premiumLevel: true,
  premiumExpiresAt: true,
  createdAt: true,
} as const;

/** Sanctions actives d'un joueur (restriction temporaire / suspension). */
export async function activeSanctions(userId: string, now = new Date()) {
  return prisma.communitySanction.findMany({
    where: {
      userId,
      revokedAt: null,
      type: { in: ["MUTE", "SUSPENSION"] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { type: true, expiresAt: true, reason: true },
  });
}

/**
 * Vérifie que le joueur peut agir dans la communauté.
 * - `read` : consulter (refusé seulement si suspendu) ;
 * - `write` : publier, commenter, réagir, demander en ami, défier (refusé si restreint).
 */
export async function requireActor(userId: string, intent: "read" | "write" = "write"): Promise<CommunityActor> {
  const [settings, actor, sanctions] = await Promise.all([
    getSettings(["community.enabled"] as const),
    prisma.user.findUnique({ where: { id: userId }, select: ACTOR_SELECT }),
    activeSanctions(userId),
  ]);
  if (!actor) throw new CommunityError("Profil introuvable.", 404);
  if (!settings["community.enabled"] && !actor.isAdmin) {
    throw new CommunityError("L’espace communautaire est momentanément fermé.", 503);
  }
  const suspension = sanctions.find((s) => s.type === "SUSPENSION");
  if (suspension) {
    throw new CommunityError(
      `Votre accès à la communauté est suspendu${suspension.expiresAt ? ` jusqu’au ${suspension.expiresAt.toLocaleDateString("fr-FR")}` : ""}.`,
      403,
    );
  }
  if (intent === "write") {
    const mute = sanctions.find((s) => s.type === "MUTE");
    if (mute) {
      throw new CommunityError(
        `Vous ne pouvez pas publier ni interagir pour le moment${mute.expiresAt ? ` (jusqu’au ${mute.expiresAt.toLocaleString("fr-FR")})` : ""}.`,
        403,
      );
    }
  }
  return actor;
}

export async function actorPrivileges(actor: CommunityActor) {
  return (await getPrivileges(actor)).privileges;
}

// ── Blocages ──────────────────────────────────────────────────────────

/** Vrai si l'un des deux a bloqué l'autre (toute interaction directe est alors refusée). */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const count = await prisma.userBlock.count({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
  });
  return count > 0;
}

/** Ids des joueurs avec qui `userId` a un blocage (dans un sens ou dans l'autre). */
export async function blockedIdsFor(userId: string): Promise<string[]> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return [...new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)))];
}

export async function assertNotBlocked(a: string, b: string) {
  if (await isBlockedBetween(a, b)) {
    throw new CommunityError("Interaction impossible avec ce joueur.", 403);
  }
}

// ── Présence ──────────────────────────────────────────────────────────

const ONLINE_WINDOW_MS = 3 * 60 * 1000;

type PresenceProbe = (userId: string) => boolean;

/** Le serveur temps réel (même processus) expose qui est connecté à une partie ou au matchmaking. */
function socketPresence(): PresenceProbe | null {
  const probe = (globalThis as { __thotIsOnline?: PresenceProbe }).__thotIsOnline;
  return typeof probe === "function" ? probe : null;
}

export function isOnline(user: { id: string; lastSeenAt: Date | null }, now = Date.now()): boolean {
  if (socketPresence()?.(user.id)) return true;
  return !!user.lastSeenAt && now - user.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

/** Marque le joueur comme actif (au plus une écriture par minute). */
export async function touchPresence(userId: string): Promise<void> {
  await prisma.user.updateMany({
    where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - 60_000) } }] },
    data: { lastSeenAt: new Date() },
  });
}

// ── Fiches joueur ─────────────────────────────────────────────────────

export const PLAYER_CARD_SELECT = {
  id: true,
  username: true,
  avatar: true,
  elo: true,
  isAdmin: true,
  isPremium: true,
  premiumLevel: true,
  premiumExpiresAt: true,
  lastSeenAt: true,
  privacySettings: true,
  playerRatings: { select: { variant: true, eloRating: true, gamesPlayed: true } },
  clubMemberships: { take: 1, orderBy: { joinedAt: "asc" }, select: { club: { select: { slug: true, name: true } } } },
} satisfies Prisma.UserSelect;

export type PlayerCardRow = Prisma.UserGetPayload<{ select: typeof PLAYER_CARD_SELECT }>;

function hidesPresence(settings: Prisma.JsonValue | null): boolean {
  return !!settings && typeof settings === "object" && !Array.isArray(settings) && (settings as { showOnline?: unknown }).showOnline === false;
}

/** Classement représentatif par jeu : le pool le plus joué. */
function ratingFor(rows: PlayerCardRow["playerRatings"], variants: string[]): number | null {
  const candidates = rows.filter((r) => variants.includes(r.variant));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.gamesPlayed - a.gamesPlayed)[0]!.eloRating;
}

export function playerCard(row: PlayerCardRow) {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    elo: row.elo,
    chessElo: ratingFor(row.playerRatings, ["CHESS"]),
    draughtsElo: ratingFor(row.playerRatings, ["INTERNATIONAL", "ENGLISH"]),
    // Badge Premium : abonnement en cours et privilège « badge » du niveau.
    premiumLevel: badgeLevel(row),
    isAdmin: row.isAdmin,
    // Le joueur peut masquer sa présence (paramètres de confidentialité).
    online: hidesPresence(row.privacySettings) ? false : isOnline(row),
    club: row.clubMemberships[0]?.club ?? null,
  };
}

export type PlayerCard = ReturnType<typeof playerCard>;

/** Carte allégée pour les auteurs de publications et commentaires. */
export const AUTHOR_SELECT = {
  id: true,
  username: true,
  avatar: true,
  elo: true,
  isAdmin: true,
  isPremium: true,
  premiumLevel: true,
  premiumExpiresAt: true,
} satisfies Prisma.UserSelect;

export function authorCard(row: Prisma.UserGetPayload<{ select: typeof AUTHOR_SELECT }>) {
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    elo: row.elo,
    // Badge Premium : abonnement en cours et privilège « badge » du niveau.
    premiumLevel: badgeLevel(row),
    isAdmin: row.isAdmin,
  };
}

export type AuthorCard = ReturnType<typeof authorCard>;

/** Limite de fréquence basée sur la base (fiable même avec plusieurs instances). */
export async function assertRate(count: number, max: number, message: string) {
  if (count >= max) throw new CommunityError(message, 429);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Pagination par curseur (date + id) : stable même si de nouveaux éléments arrivent. */
export function decodeCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [ts, id] = cursor.split("_");
  const time = Number(ts);
  if (!id || !Number.isFinite(time)) return null;
  return { createdAt: new Date(time), id };
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.getTime()}_${row.id}`;
}

export function cursorWhere(cursor: { createdAt: Date; id: string } | null) {
  if (!cursor) return {};
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}
