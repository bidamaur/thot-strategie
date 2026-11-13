import { getRequestUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const variant = searchParams.get("variant") || undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

  try {
    const history = await prisma.ratingHistory.findMany({
      where: {
        userId: currentUser.id,
        ...(variant ? { variant } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        match: {
          select: {
            id: true,
            gameType: true,
            status: true,
          },
        },
      },
    });

    return NextResponse.json({
      history: history.map((h) => ({
        id: h.id,
        variant: h.variant,
        timeControl: h.timeControl,
        oldRating: h.oldRating,
        newRating: h.newRating,
        change: h.change,
        reason: h.reason,
        matchId: h.matchId,
        opponentId: h.opponentId,
        opponentRatingBefore: h.opponentRatingBefore,
        createdAt: h.createdAt,
      })),
    });
  } catch (error) {
    console.error("Erreur lors du chargement de l'historique Elo :", error);
    return NextResponse.json(
      { error: "Impossible de charger l'historique Elo." },
      { status: 500 },
    );
  }
}
