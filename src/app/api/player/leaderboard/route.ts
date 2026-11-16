import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { loadRatingSettings } from "@/lib/rating/load-config";
import { isProvisional, levelFor } from "@/lib/rating/pools";
import { NextResponse } from "next/server";

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await getRequestUser(request);

  const { searchParams } = new URL(request.url);
  const variant = searchParams.get("variant") ?? "CHESS";
  const timeControl = searchParams.get("timeControl") || undefined;
  const limit = Math.max(1, Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 100));
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  // Par défaut, seuls les classements confirmés apparaissent (pratique Lichess).
  const includeProvisional = searchParams.get("provisional") === "1";
  const { config, levels } = await loadRatingSettings();
  const minGames = includeProvisional ? 0 : config.provisionalGames;

  try {
    const [ratings, totalCount, userPosition] = await Promise.all([
      prisma.playerRating.findMany({
        where: {
          variant,
          gamesPlayed: { gte: minGames },
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
          gamesPlayed: { gte: minGames },
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
          provisional: isProvisional(r.gamesPlayed, config.provisionalGames),
          level: levelFor(r.eloRating, levels),
        },
      })),
      totalCount,
      userPosition: userPosition
        ? {
            variant: userPosition.variant,
            timeControl: userPosition.timeControl,
            eloRating: userPosition.eloRating,
            gamesPlayed: userPosition.gamesPlayed,
            provisional: isProvisional(userPosition.gamesPlayed, config.provisionalGames),
            level: levelFor(userPosition.eloRating, levels),
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
