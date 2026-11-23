import { prisma } from "@/lib/prisma";
import { INTEREST_FEATURES, type InterestFeature } from "./rules";

/**
 * Tableau de bord de la monétisation. Quatre notions toujours séparées :
 *  1. intérêts commerciaux (consultations, liste d'attente) ;
 *  2. déclarations de paiement (non vérifiées) ;
 *  3. paiements vérifiés (validés par un administrateur) ;
 *  4. revenus réellement encaissés = somme des montants REÇUS des paiements validés.
 * Une déclaration en attente ou rejetée n'est jamais comptée comme revenu.
 */
export async function monetizationDashboard(now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const [activePremium, interestPlayers, waitlistPlayers, byStatus, revenue, byProvider, topFeatures, byCountry, validatedRows, declaredRows] = await Promise.all([
    prisma.user.count({ where: { isAdmin: false, isPremium: true, premiumLevel: { gt: 0 }, OR: [{ premiumExpiresAt: null }, { premiumExpiresAt: { gt: now } }] } }),
    prisma.premiumInterest.groupBy({ by: ["userId"] }).then((r) => r.length),
    prisma.premiumInterest.groupBy({ by: ["userId"], where: { waitlist: true } }).then((r) => r.length),
    prisma.payment.groupBy({ by: ["purpose", "status"], _count: { _all: true }, _sum: { declaredAmount: true } }),
    prisma.payment.groupBy({ by: ["purpose"], where: { status: "VALIDATED" }, _sum: { receivedAmount: true }, _count: { _all: true } }),
    prisma.payment.groupBy({ by: ["provider", "purpose"], where: { status: "VALIDATED" }, _sum: { receivedAmount: true }, _count: { _all: true } }),
    prisma.premiumInterest.groupBy({ by: ["feature"], _count: { _all: true }, orderBy: { _count: { feature: "desc" } }, take: 6 }),
    prisma.premiumInterest.groupBy({ by: ["countryCode"], _count: { _all: true } }),
    prisma.payment.findMany({ where: { status: "VALIDATED", reviewedAt: { gte: since } }, select: { purpose: true, receivedAmount: true, reviewedAt: true } }),
    prisma.payment.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);

  const count = (purpose: string, status: string) => byStatus.find((g) => g.purpose === purpose && g.status === status)?._count._all ?? 0;
  const cashed = (purpose: string) => revenue.find((g) => g.purpose === purpose)?._sum.receivedAmount ?? 0;

  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const months = new Map<string, { month: string; premium: number; donations: number; declarations: number }>();
  for (let i = 11; i >= 0; i -= 1) {
    const key = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
    months.set(key, { month: key, premium: 0, donations: 0, declarations: 0 });
  }
  for (const p of validatedRows) {
    const m = p.reviewedAt && months.get(monthKey(p.reviewedAt));
    if (!m) continue;
    if (p.purpose === "PREMIUM") m.premium += p.receivedAmount ?? 0;
    else m.donations += p.receivedAmount ?? 0;
  }
  for (const d of declaredRows) {
    const m = months.get(monthKey(d.createdAt));
    if (m) m.declarations += 1;
  }

  const countries = new Map<string, number>();
  for (const g of byCountry) countries.set(g.countryCode ?? "UNKNOWN", (countries.get(g.countryCode ?? "UNKNOWN") ?? 0) + g._count._all);

  return {
    interests: { players: interestPlayers, waitlist: waitlistPlayers },
    premium: {
      active: activePremium,
      pending: count("PREMIUM", "PENDING"),
      validated: count("PREMIUM", "VALIDATED"),
      rejected: count("PREMIUM", "REJECTED"),
      requests: count("PREMIUM", "PENDING") + count("PREMIUM", "VALIDATED") + count("PREMIUM", "REJECTED"),
      revenue: cashed("PREMIUM"),
    },
    donations: {
      pending: count("DONATION", "PENDING"),
      validated: count("DONATION", "VALIDATED"),
      rejected: count("DONATION", "REJECTED"),
      total: cashed("DONATION"),
    },
    providers: ["ORANGE_MONEY", "MTN_MOMO"].map((provider) => ({
      provider,
      count: byProvider.filter((g) => g.provider === provider).reduce((n, g) => n + g._count._all, 0),
      amount: byProvider.filter((g) => g.provider === provider).reduce((n, g) => n + (g._sum.receivedAmount ?? 0), 0),
    })),
    topFeatures: topFeatures.map((g) => ({ feature: g.feature, label: INTEREST_FEATURES[g.feature as InterestFeature] ?? g.feature, players: g._count._all })),
    countries: [...countries.entries()].map(([code, n]) => ({ code, count: n })).sort((a, b) => b.count - a.count).slice(0, 10),
    monthly: [...months.values()],
  };
}
