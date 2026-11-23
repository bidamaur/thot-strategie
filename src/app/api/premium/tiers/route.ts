import { getRequestUser } from "@/lib/auth/session";
import { isMockEconomyEnabled } from "@/lib/economy/mock-mode";
import { getPrivileges, resolvedPrivileges } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { getSetting, getSettings } from "@/lib/settings/service";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const [tiers, currentUser, free] = await Promise.all([
    getSetting("premium.tiers"),
    getRequestUser(request),
    getSettings(["freePlan.dailyGamesEnabled", "freePlan.dailyGames"] as const),
  ]);
  let me: { level: number; tierName: string; expiresAt: string | null } | null = null;
  if (currentUser) {
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { isAdmin: true, isPremium: true, premiumLevel: true, premiumExpiresAt: true },
    });
    if (user) {
      const { level, tier } = await getPrivileges(user);
      me = { level, tierName: tier.name, expiresAt: user.premiumExpiresAt?.toISOString() ?? null };
    }
  }
  return NextResponse.json({
    // Même règle que celle qui applique les droits (getPrivileges).
    tiers: [...tiers]
      .sort((a, b) => a.level - b.level)
      .map((t) => ({ ...t, available: t.level === 0 || (t.available !== false && t.priceCfa > 0 && t.durationDays > 0), privileges: resolvedPrivileges(t) })),
    me,
    freePlan: { dailyGames: free["freePlan.dailyGamesEnabled"] ? free["freePlan.dailyGames"] : null },
    // Paiement simulé (développement, administrateur) conservé ; le paiement réel passe par /api/monetization.
    purchase: { available: Boolean(currentUser?.isAdmin) && isMockEconomyEnabled(), simulated: true },
  });
}
