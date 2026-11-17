import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/service";
import { DEFAULT_PREMIUM_TIERS, type PremiumPrivileges, type PremiumTier } from "@/lib/settings/registry";

/**
 * Privilèges Premium — le système existant (isPremium + premiumLevel 1..5)
 * est conservé ; les avantages de chaque niveau sont désormais définis dans
 * le paramètre administrable `premium.tiers`.
 *
 * Aucun privilège n'agit sur le plateau : uniquement organisation,
 * communauté, statistiques et personnalisation.
 */

export interface PremiumSubject {
  isAdmin: boolean;
  isPremium: boolean;
  premiumLevel: number;
  premiumExpiresAt?: Date | null;
}

export function effectiveLevel(user: PremiumSubject, now = new Date()): number {
  if (user.isAdmin) return Number.POSITIVE_INFINITY;
  if (!user.isPremium) return 0;
  if (user.premiumExpiresAt && user.premiumExpiresAt <= now) return 0;
  // Ancien Premium sans niveau explicite : niveau 1.
  return Math.max(1, user.premiumLevel || 0);
}

export function tierFor(tiers: PremiumTier[], level: number): PremiumTier {
  const sorted = [...tiers].sort((a, b) => a.level - b.level);
  let tier = sorted[0]!;
  for (const candidate of sorted) if (candidate.level <= level) tier = candidate;
  return tier;
}

const ADMIN_PRIVILEGES: PremiumPrivileges = {
  maxActiveTournaments: 1000,
  maxTournamentPlayers: 1024,
  maxScope: "INTERNATIONAL",
  tournamentFormats: [
    "SURVIVAL_BANK", "ARENA", "SWISS", "ROUND_ROBIN", "ELIMINATION",
    "DOUBLE_ELIMINATION", "GROUPS_ELIMINATION", "LEAGUE",
  ],
  privateTournaments: true,
  paidTournaments: true,
  customTournamentBranding: true,
  advancedStats: true,
  historyDays: 0,
  clubCreate: true,
  maxClubsOwned: 100,
  maxClubMembers: 10_000,
  clubChampionships: true,
  profileThemes: true,
  badge: true,
  privateRooms: 100,
  pinInOwnSpaces: true,
  communityStats: true,
  maxBulkInvites: 500,
  clubCustomization: true,
  unlimitedGames: true,
};

export async function getPrivileges(user: PremiumSubject): Promise<{
  level: number;
  tier: PremiumTier;
  privileges: PremiumPrivileges;
}> {
  const tiers = await getSetting("premium.tiers");
  const level = effectiveLevel(user);
  const tier = tierFor(tiers, Number.isFinite(level) ? level : 99);
  return {
    level: Number.isFinite(level) ? level : tier.level,
    tier,
    // Les privilèges ajoutés après coup (communauté…) prennent la valeur par défaut du niveau
    // tant que l'administrateur ne les a pas renseignés dans `premium.tiers`.
    privileges: user.isAdmin
      ? ADMIN_PRIVILEGES
      : {
          ...tierFor(DEFAULT_PREMIUM_TIERS, tier.level).privileges,
          ...tierFor(tiers, 0).privileges,
          ...tier.privileges,
        },
  };
}

export async function getPrivilegesForUserId(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, isPremium: true, premiumLevel: true, premiumExpiresAt: true },
  });
  if (!user) return null;
  return getPrivileges(user);
}

export const SCOPE_RANK: Record<string, number> = {
  NEIGHBORHOOD: 1,
  CITY: 2,
  REGION: 3,
  COUNTRY: 4,
  CONTINENT: 5,
  INTERNATIONAL: 6,
};
