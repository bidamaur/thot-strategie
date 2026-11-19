import type { Prisma } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { effectiveLevel, getPrivileges } from "@/lib/premium/privileges";
import { CommunityError, isOnline, requireActor } from "./core";
import { relationshipBetween } from "./friends";
import { cleanText, decodeFromDb, encodeBounded } from "./text";

/** Ce que chaque joueur choisit de rendre visible aux autres. */
export interface PrivacySettings {
  showRatings: boolean;
  showStats: boolean;
  showClubs: boolean;
  showFriends: boolean;
  showPosts: boolean;
  showOnline: boolean;
  showLocation: boolean;
  /** Statistiques avancées (consultables par les Premium, en partie). Exige aussi showStats. */
  showAdvancedStats: boolean;
  /** Cinq derniers adversaires et variations de points. Exige aussi showStats. */
  showRecentOpponents: boolean;
  /** Performances en tournois et compétitions rémunérées (classements, jamais les montants). */
  showTournaments: boolean;
  /** Qui peut envoyer une demande d'amitié. */
  friendRequests: "EVERYONE" | "NOBODY";
  /** Couleur d'accent du profil (privilège Premium « personnalisation »). */
  accent: string | null;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  showRatings: true,
  showStats: true,
  showClubs: true,
  showFriends: true,
  showPosts: true,
  showOnline: true,
  showLocation: true,
  showAdvancedStats: true,
  showRecentOpponents: true,
  showTournaments: true,
  friendRequests: "EVERYONE",
  accent: null,
};

export function readPrivacy(value: Prisma.JsonValue | null | undefined): PrivacySettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const bool = (key: keyof PrivacySettings) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : (DEFAULT_PRIVACY[key] as boolean);
  return {
    showRatings: bool("showRatings"),
    showStats: bool("showStats"),
    showClubs: bool("showClubs"),
    showFriends: bool("showFriends"),
    showPosts: bool("showPosts"),
    showOnline: bool("showOnline"),
    showLocation: bool("showLocation"),
    showAdvancedStats: bool("showAdvancedStats"),
    showRecentOpponents: bool("showRecentOpponents"),
    showTournaments: bool("showTournaments"),
    friendRequests: raw.friendRequests === "NOBODY" ? "NOBODY" : "EVERYONE",
    accent: typeof raw.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.accent) ? raw.accent : null,
  };
}

export async function updateCommunityProfile(userId: string, input: { bio?: unknown; privacy?: unknown }) {
  const actor = await requireActor(userId, "read");
  const data: Prisma.UserUpdateInput = {};
  if (input.bio !== undefined) {
    const bio = cleanText(input.bio, 280);
    data.bio = bio ? encodeBounded(bio, 280) : null;
  }
  if (input.privacy !== undefined) {
    const current = readPrivacy(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { privacySettings: true } })).privacySettings,
    );
    const next = readPrivacy({ ...current, ...(typeof input.privacy === "object" && input.privacy ? input.privacy : {}) } as Prisma.JsonValue);
    if (next.accent && next.accent !== current.accent) {
      const { privileges } = await getPrivileges(actor);
      if (!privileges.profileThemes) next.accent = current.accent;
    }
    data.privacySettings = next as unknown as Prisma.InputJsonValue;
  }
  await prisma.user.update({ where: { id: userId }, data });
  return getOwnSettings(userId);
}

export async function getOwnSettings(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { bio: true, privacySettings: true, isAdmin: true, isPremium: true, premiumLevel: true, premiumExpiresAt: true },
  });
  const { privileges } = await getPrivileges(user);
  return {
    bio: decodeFromDb(user.bio) ?? "",
    privacy: readPrivacy(user.privacySettings),
    canCustomize: privileges.profileThemes,
  };
}

interface Badge {
  id: string;
  label: string;
  description: string;
}

/** Badges et distinctions calculés à partir des données existantes (aucune table dédiée). */
function computeBadges(input: {
  premiumLevel: number;
  createdAt: Date;
  gamesPlayed: number;
  tournamentWins: number;
  podiums: number;
  posts: number;
  friends: number;
  clubsOwned: number;
}): Badge[] {
  const badges: Badge[] = [];
  const years = (Date.now() - input.createdAt.getTime()) / (365 * 24 * 3600_000);
  if (input.tournamentWins > 0) badges.push({ id: "champion", label: `Champion ×${input.tournamentWins}`, description: "A remporté au moins un tournoi." });
  if (input.podiums > 0) badges.push({ id: "podium", label: `${input.podiums} podium(s)`, description: "Classé dans les trois premiers d’un tournoi." });
  if (input.gamesPlayed >= 500) badges.push({ id: "marathon", label: "Marathonien", description: "Plus de 500 parties jouées." });
  else if (input.gamesPlayed >= 100) badges.push({ id: "assidu", label: "Assidu", description: "Plus de 100 parties jouées." });
  if (input.posts >= 50) badges.push({ id: "pilier", label: "Pilier de la communauté", description: "Plus de 50 publications." });
  if (input.friends >= 25) badges.push({ id: "rassembleur", label: "Rassembleur", description: "Plus de 25 amis." });
  if (input.clubsOwned > 0) badges.push({ id: "fondateur", label: "Fondateur de club", description: "A créé un club." });
  if (years >= 1) badges.push({ id: "veteran", label: `Membre depuis ${Math.floor(years)} an(s)`, description: "Fidèle à la plateforme." });
  if (input.premiumLevel > 0) badges.push({ id: "premium", label: "Premium", description: "Soutient la plateforme." });
  return badges;
}

export async function getPublicProfile(username: string, viewer: { id: string; isAdmin: boolean } | null) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      avatar: true,
      bio: true,
      elo: true,
      city: true,
      country: true,
      createdAt: true,
      lastSeenAt: true,
      isAdmin: true,
      isPremium: true,
      premiumLevel: true,
      premiumExpiresAt: true,
      privacySettings: true,
      playerRatings: { select: { variant: true, timeControl: true, eloRating: true, gamesPlayed: true, wins: true, losses: true, draws: true } },
      clubMemberships: { select: { role: true, club: { select: { slug: true, name: true, logo: true } } } },
    },
  });
  if (!user) throw new CommunityError("Joueur introuvable.", 404);
  const relationship = viewer ? await relationshipBetween(viewer.id, user.id) : { status: "NONE" as const, friendshipId: null, favorite: false };
  if (relationship.status === "BLOCKED_ME") throw new CommunityError("Joueur introuvable.", 404);

  const privacy = readPrivacy(user.privacySettings);
  const isSelf = viewer?.id === user.id;
  const see = (flag: boolean) => isSelf || (viewer?.isAdmin ?? false) || flag;

  const [friendCount, postCount, commentCount, tournamentWins, podiums, clubsOwned, recentMatches] = await Promise.all([
    prisma.friendship.count({ where: { status: "ACCEPTED", OR: [{ requesterId: user.id }, { addresseeId: user.id }] } }),
    prisma.communityPost.count({ where: { authorId: user.id, deletedAt: null, isHidden: false } }),
    prisma.communityComment.count({ where: { authorId: user.id, deletedAt: null, isHidden: false } }),
    prisma.tournament.count({ where: { winnerId: user.id, status: "COMPLETED" } }),
    prisma.tournamentParticipant.count({ where: { userId: user.id, placement: { gte: 1, lte: 3 }, tournament: { status: "COMPLETED" } } }),
    prisma.club.count({ where: { ownerId: user.id } }),
    see(privacy.showStats)
      ? prisma.match.findMany({
          where: {
            status: { in: ["FINISHED", "ABANDONED"] },
            OR: [{ playerWhiteId: user.id }, { playerBlackId: user.id }],
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: {
            id: true,
            gameType: true,
            draughtsVariant: true,
            mode: true,
            winnerId: true,
            updatedAt: true,
            playerWhite: { select: { id: true, username: true } },
            playerBlack: { select: { id: true, username: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const totals = user.playerRatings.reduce(
    (acc, r) => ({ games: acc.games + r.gamesPlayed, wins: acc.wins + r.wins, losses: acc.losses + r.losses, draws: acc.draws + r.draws }),
    { games: 0, wins: 0, losses: 0, draws: 0 },
  );
  const level = effectiveLevel(user);
  const premiumLevel = Number.isFinite(level) && level > 0 ? level : 0;

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    bio: decodeFromDb(user.bio),
    accent: privacy.accent,
    memberSince: user.createdAt.toISOString(),
    location: see(privacy.showLocation) ? [user.city, user.country].filter(Boolean).join(", ") || null : null,
    online: see(privacy.showOnline) ? isOnline(user) : null,
    premiumLevel,
    isAdmin: user.isAdmin,
    relationship,
    acceptsFriendRequests: privacy.friendRequests === "EVERYONE",
    ratings: see(privacy.showRatings)
      ? {
          general: user.elo,
          pools: user.playerRatings
            .filter((r) => r.gamesPlayed > 0)
            .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
            .map((r) => ({ variant: r.variant, cadence: r.timeControl, rating: r.eloRating, games: r.gamesPlayed })),
        }
      : null,
    stats: see(privacy.showStats) ? { ...totals, tournamentWins, podiums } : null,
    recentMatches: recentMatches.map((m) => {
      const opponent = m.playerWhite.id === user.id ? m.playerBlack : m.playerWhite;
      return {
        id: m.id,
        gameType: m.gameType,
        variant: m.draughtsVariant,
        mode: m.mode,
        opponent: opponent?.username ?? "—",
        result: m.winnerId === null ? "DRAW" : m.winnerId === user.id ? "WIN" : "LOSS",
        date: m.updatedAt.toISOString(),
      };
    }),
    clubs: see(privacy.showClubs) ? user.clubMemberships.map((m) => ({ ...m.club, role: m.role })) : null,
    community: {
      friends: see(privacy.showFriends) ? friendCount : null,
      posts: postCount,
      comments: commentCount,
      showPosts: see(privacy.showPosts),
    },
    badges: computeBadges({ premiumLevel, createdAt: user.createdAt, gamesPlayed: totals.games, tournamentWins, podiums, posts: postCount, friends: friendCount, clubsOwned }),
    isSelf,
  };
}
