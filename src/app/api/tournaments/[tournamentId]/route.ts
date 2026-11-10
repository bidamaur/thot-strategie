import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { tournamentId } = await params;
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        creator: { select: { id: true, username: true } },
        participants: {
          orderBy: { seed: "asc" },
          include: { user: { select: { id: true, username: true } } },
        },
        bracketMatches: {
          orderBy: [{ round: "asc" }, { matchNumber: "asc" }],
          include: {
            playerWhite: { select: { id: true, username: true } },
            playerBlack: { select: { id: true, username: true } },
            winner: { select: { id: true, username: true } },
          },
        },
      },
    });
    if (!tournament) {
      return NextResponse.json({ error: "Tournoi introuvable." }, { status: 404 });
    }

    return NextResponse.json({
      tournament: {
        ...tournament,
        entryFee: tournament.entryFee.toString(),
        totalPrizePool: tournament.totalPrizePool.toString(),
        platformFee: tournament.platformFee.toString(),
      },
    });
  } catch (error) {
    console.error("Erreur lors de la lecture du tournoi :", error);
    return NextResponse.json(
      { error: "Impossible de charger le tournoi." },
      { status: 500 },
    );
  }
}
