import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await getRequestUser(request);

  const { searchParams } = new URL(request.url);
  const variant = searchParams.get("variant") ?? "CHESS";
  const timeControl = searchParams.get("timeControl") || undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  try {
    const [ratings, totalCount, userPosition] = await Promise.all([
      prisma.playerRating.findMany({
        where: {
          variant,
          ...(timeControl ? { timeControl } : {}),
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatar: true,
              country: true,
              city: true,
            },
          },
        },
        orderBy: { eloRating: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.playerRating.count({
        where: {
          variant,
          ...(timeControl ? { timeControl } : {}),
        },
      }),
      currentUser
        ? prisma.playerRating.findFirst({
            where: {
              userId: currentUser.id,
              variant,
              ...(timeControl ? { timeControl } : {}),
            },
          })
        : null,
    ]);

    return NextResponse.json({
      leaderboard: ratings.map((r, index) => ({
        position: offset + index + 1,
        user: {
          id: r.user.id,
          username: r.user.username,
          avatar: r.user.avatar,
          country: r.user.country,
          city: r.user.city,
        },
        rating: {
          variant: r.variant,
          timeControl: r.timeControl,
          eloRating: r.eloRating,
          gamesPlayed: r.gamesPlayed,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
        },
      })),
      totalCount,
      userPosition: userPosition
        ? {
            variant: userPosition.variant,
            timeControl: userPosition.timeControl,
            eloRating: userPosition.eloRating,
            gamesPlayed: userPosition.gamesPlayed,
          }
        : null,
    });
  } catch (error) {
    console.error("Erreur lors du chargement du leaderboard :", error);
    return NextResponse.json(
      { error: "Impossible de charger le classement." },
      { status: 500 },
    );
  }
}
