import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getLevel } from "@/lib/rating/elo";

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const variant = searchParams.get("variant") ?? "CHESS";
  const timeControl = searchParams.get("timeControl") || undefined;

  try {
    const [rating, user] = await Promise.all([
      prisma.playerRating.findFirst({
        where: {
          userId: currentUser.id,
          variant,
          timeControl,
        },
      }),
      prisma.user.findUnique({
        where: { id: currentUser.id },
        select: { id: true, username: true, elo: true, pointsFree: true, isPremium: true, avatar: true },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
    }

    const level = getLevel(user.pointsFree);

    return NextResponse.json({
      rating: rating
        ? {
            variant: rating.variant,
            timeControl: rating.timeControl,
            eloRating: rating.eloRating,
            gamesPlayed: rating.gamesPlayed,
            wins: rating.wins,
            losses: rating.losses,
            draws: rating.draws,
            ratingDeviation: rating.ratingDeviation,
            lastRatingUpdate: rating.lastRatingUpdate,
          }
        : {
            variant,
            timeControl,
            eloRating: user.elo,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            ratingDeviation: 350,
            lastRatingUpdate: null,
          },
      points: {
        pointsFree: user.pointsFree,
        level: level ? { label: level.label, minPoints: level.minPoints, maxPoints: level.maxPoints } : null,
      },
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        isPremium: user.isPremium,
      },
    });
  } catch (error) {
    console.error("Erreur lors de la lecture du rating :", error);
    return NextResponse.json(
      { error: "Impossible de charger le rating." },
      { status: 500 },
    );
  }
}
