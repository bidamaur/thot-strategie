import { getRequestUser } from "@/lib/auth/session";
import { isMockEconomyEnabled } from "@/lib/economy/mock-mode";
import { getPrivileges, tierFor } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PREMIUM_TIERS } from "@/lib/settings/registry";
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
    // Les privilèges ajoutés après coup prennent la valeur par défaut du niveau (même règle que getPrivileges).
    tiers: [...tiers]
      .sort((a, b) => a.level - b.level)
      .map((t) => ({ ...t, privileges: { ...tierFor(DEFAULT_PREMIUM_TIERS, t.level).privileges, ...t.privileges } })),
    me,
    freePlan: { dailyGames: free["freePlan.dailyGamesEnabled"] ? free["freePlan.dailyGames"] : null },
    // Le paiement réel n'est pas encore branché : achat possible uniquement en paiement simulé (développement, administrateur).
    purchase: { available: Boolean(currentUser?.isAdmin) && isMockEconomyEnabled(), simulated: true },
  });
}
