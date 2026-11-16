import { getRequestUser } from "@/lib/auth/session";
import { getPrivileges } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/service";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const [tiers, currentUser] = await Promise.all([getSetting("premium.tiers"), getRequestUser(request)]);
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
    tiers: [...tiers].sort((a, b) => a.level - b.level),
    me,
  });
}
