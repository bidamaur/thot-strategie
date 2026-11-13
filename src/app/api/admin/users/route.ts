import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const currentUser = await getRequestUser(request);
  if (!currentUser || !currentUser.isAdmin) {
    return NextResponse.json({ error: "Accès administrateur requis." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const search = searchParams.get("search") ?? "";
  const role = searchParams.get("role") ?? "all"; // all, admin, premium, user

  const where: Record<string, unknown> = {};
  if (search) {
    where.username = { contains: search, mode: "insensitive" };
  }
  if (role === "admin") {
    where.isAdmin = true;
  } else if (role === "premium") {
    where.isPremium = true;
    where.isAdmin = false;
  } else if (role === "user") {
    where.isPremium = false;
    where.isAdmin = false;
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        isAdmin: true,
        isPremium: true,
        premiumLevel: true,
        pointsFree: true,
        walletReal: true,
        elo: true,
        country: true,
        city: true,
        neighborhood: true,
        avatar: true,
        createdAt: true,
        _count: {
          select: {
            tournamentParticipations: true,
            whiteMatches: true,
            wonMatches: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      walletReal: u.walletReal.toString(),
      totalTournaments: u._count.tournamentParticipations,
      totalMatches: u._count.whiteMatches + u._count.wonMatches,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
