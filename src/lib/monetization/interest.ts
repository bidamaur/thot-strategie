import type { Prisma } from "@/generated/prisma-client";
import { writeAuditLog } from "@/lib/audit";
import { notify } from "@/lib/community/notifications";
import { decodeFromDb, encodeBounded } from "@/lib/community/text";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { fillDate, INTEREST_FEATURES, launchLabel, paymentCountryCode, type InterestFeature } from "./rules";

/**
 * Intérêts commerciaux : une ligne par joueur × fonctionnalité × niveau,
 * incrémentée à chaque sollicitation (pas une ligne par clic). L'inscription à
 * la liste d'attente est un choix volontaire distinct d'une simple consultation.
 */
export async function recordInterest(
  userId: string,
  input: { feature: InterestFeature; tierLevel?: number; waitlist?: boolean },
  now = new Date(),
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { country: true, verifiedCountryCode: true } });
  if (!user) return null;
  const tierLevel = Number.isInteger(input.tierLevel) && input.tierLevel! >= 0 && input.tierLevel! <= 10 ? input.tierLevel! : 0;
  const country = user.country ? encodeBounded(user.country, 80) : null;
  const countryCode = paymentCountryCode(user);
  const waitlist = input.waitlist === true;
  const row = await prisma.premiumInterest.upsert({
    where: { userId_feature_tierLevel: { userId, feature: input.feature, tierLevel } },
    create: { userId, feature: input.feature, tierLevel, country, countryCode, firstAt: now, lastAt: now, waitlist, waitlistAt: waitlist ? now : null },
    update: {
      views: { increment: 1 },
      lastAt: now,
      country,
      countryCode,
      ...(waitlist ? { waitlist: true } : {}),
    },
    select: { id: true, waitlist: true, waitlistAt: true, views: true },
  });
  // Date d'inscription : la première seulement.
  if (waitlist && !row.waitlistAt) await prisma.premiumInterest.update({ where: { id: row.id }, data: { waitlistAt: now } });
  return { waitlist: row.waitlist, views: row.views };
}

/** Le joueur est-il déjà inscrit à la liste d'attente (toutes fonctionnalités) ? */
export async function isOnWaitlist(userId: string) {
  return (await prisma.premiumInterest.count({ where: { userId, waitlist: true } })) > 0;
}

export interface InterestFilters {
  feature?: string | null;
  countryCode?: string | null;
  waitlistOnly?: boolean;
  from?: Date | null;
  to?: Date | null;
}

function whereOf(f: InterestFilters): Prisma.PremiumInterestWhereInput {
  const where: Prisma.PremiumInterestWhereInput = {};
  if (f.feature && Object.hasOwn(INTEREST_FEATURES, f.feature)) where.feature = f.feature;
  if (f.countryCode === "UNKNOWN") where.countryCode = null;
  else if (f.countryCode && /^[A-Z]{2}$/.test(f.countryCode)) where.countryCode = f.countryCode;
  if (f.waitlistOnly) where.waitlist = true;
  if (f.from || f.to) where.lastAt = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };
  return where;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export async function interestStats(filters: InterestFilters) {
  const where = whereOf(filters);
  const [players, waitlistPlayers, byFeature, byTier, byCountry, timeline, recent] = await Promise.all([
    prisma.premiumInterest.groupBy({ by: ["userId"], where }).then((r) => r.length),
    prisma.premiumInterest.groupBy({ by: ["userId"], where: { ...where, waitlist: true } }).then((r) => r.length),
    prisma.premiumInterest.groupBy({ by: ["feature"], where, _count: { _all: true }, _sum: { views: true } }),
    prisma.premiumInterest.groupBy({ by: ["tierLevel"], where: { ...where, tierLevel: { gt: 0 } }, _count: { _all: true }, _sum: { views: true } }),
    prisma.premiumInterest.groupBy({ by: ["countryCode"], where, _count: { _all: true } }),
    prisma.premiumInterest.findMany({ where, select: { firstAt: true, waitlistAt: true, userId: true } }),
    prisma.premiumInterest.findMany({
      where,
      orderBy: { lastAt: "desc" },
      take: 50,
      select: { feature: true, tierLevel: true, views: true, waitlist: true, firstAt: true, lastAt: true, country: true, countryCode: true, user: { select: { username: true } } },
    }),
  ]);

  // Évolution mensuelle : nouvelles sollicitations et inscriptions (12 derniers mois).
  const months = new Map<string, { month: string; interests: number; waitlist: number }>();
  const now = new Date();
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.set(monthKey(d), { month: monthKey(d), interests: 0, waitlist: 0 });
  }
  for (const row of timeline) {
    const a = months.get(monthKey(row.firstAt));
    if (a) a.interests += 1;
    if (row.waitlistAt) {
      const b = months.get(monthKey(row.waitlistAt));
      if (b) b.waitlist += 1;
    }
  }

  // Les pays déclarés avant normalisation sont regroupés par code.
  const countryCounts = new Map<string, number>();
  for (const g of byCountry) countryCounts.set(g.countryCode ?? "UNKNOWN", (countryCounts.get(g.countryCode ?? "UNKNOWN") ?? 0) + g._count._all);

  return {
    players,
    waitlistPlayers,
    features: byFeature
      .map((g) => ({ feature: g.feature, label: INTEREST_FEATURES[g.feature as InterestFeature] ?? g.feature, players: g._count._all, views: g._sum.views ?? 0 }))
      .sort((a, b) => b.players - a.players || b.views - a.views),
    tiers: byTier.map((g) => ({ level: g.tierLevel, players: g._count._all, views: g._sum.views ?? 0 })).sort((a, b) => b.players - a.players),
    countries: [...countryCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    monthly: [...months.values()],
    recent: recent.map((r) => ({
      ...r,
      label: INTEREST_FEATURES[r.feature as InterestFeature] ?? r.feature,
      country: r.country ? decodeFromDb(r.country) : null,
      username: r.user.username,
      user: undefined,
      firstAt: r.firstAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
    })),
  };
}

/**
 * Prévient la liste d'attente (une seule fois par joueur) : à utiliser au
 * lancement. Ne touche à aucun paiement ni abonnement.
 */
export async function notifyWaitlist(adminId: string, now = new Date()) {
  const s = await getSettings(["payments.internationalLaunchDate"] as const);
  const rows = await prisma.premiumInterest.findMany({ where: { waitlist: true, notifiedAt: null }, select: { userId: true } });
  const userIds = [...new Set(rows.map((r) => r.userId))];
  if (userIds.length === 0) return { notified: 0 };
  await notify(
    userIds.map((userId) => ({
      userId,
      type: "PREMIUM_LAUNCH" as const,
      title: "Les offres Premium sont ouvertes",
      body: fillDate("Vous avez demandé à être prévenu : les offres Premium sont disponibles ({DATE}).", launchLabel(s["payments.internationalLaunchDate"])),
      link: "/premium",
    })),
  );
  await prisma.$transaction(async (tx) => {
    await tx.premiumInterest.updateMany({ where: { userId: { in: userIds }, waitlist: true, notifiedAt: null }, data: { notifiedAt: now } });
    await writeAuditLog(tx, { actorId: adminId, action: "WAITLIST_NOTIFIED", entity: "PremiumInterest", after: { players: userIds.length } });
  });
  return { notified: userIds.length };
}
