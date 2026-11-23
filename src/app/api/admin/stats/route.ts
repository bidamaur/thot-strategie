import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser || !currentUser.isAdmin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }

  const [
    totalUsers,
    totalAdmins,
    totalPremium,
    totalTournaments,
    activeTournaments,
    completedTournaments,
    totalMatches,
    finishedMatches,
    totalPointsDistributed,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isAdmin: true } }),
    // Abonnements en cours uniquement (les abonnements expirés ne comptent plus).
    prisma.user.count({ where: { isPremium: true, isAdmin: false, OR: [{ premiumExpiresAt: null }, { premiumExpiresAt: { gt: new Date() } }] } }),
    prisma.tournament.count(),
    prisma.tournament.count({ where: { status: "IN_PROGRESS" } }),
    prisma.tournament.count({ where: { status: "COMPLETED" } }),
    prisma.match.count(),
    prisma.match.count({ where: { status: "FINISHED" } }),
    prisma.user.aggregate({ _sum: { pointsFree: true } }),
  ]);

  return NextResponse.json({
    totalUsers,
    totalAdmins,
    totalPremium,
    totalTournaments,
    activeTournaments,
    completedTournaments,
    totalMatches,
    finishedMatches,
    totalPointsDistributed: totalPointsDistributed._sum.pointsFree ?? 0,
  });
}
