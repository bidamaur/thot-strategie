import { getRequestUser } from "@/lib/auth/session";
import { getPrivileges } from "@/lib/premium/privileges";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { NextResponse } from "next/server";

/**
 * Configuration publicitaire publique pour le navigateur. Les membres dont le
 * niveau Premium inclut « sans publicité » reçoivent `hidden: true`.
 */
export async function GET(request: Request) {
  const s = await getSettings([
    "ads.enabled",
    "ads.clientId",
    "ads.slots",
    "ads.placements",
    "ads.showPlaceholder",
  ] as const);
  let hidden = false;
  const currentUser = await getRequestUser(request);
  if (currentUser) {
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { isAdmin: true, isPremium: true, premiumLevel: true, premiumExpiresAt: true },
    });
    if (user) hidden = Boolean((await getPrivileges(user)).privileges.adFree);
  }
  return NextResponse.json(
    {
      enabled: s["ads.enabled"],
      clientId: s["ads.clientId"] || null,
      slots: s["ads.slots"],
      placements: s["ads.placements"],
      showPlaceholder: s["ads.showPlaceholder"],
      hidden,
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
