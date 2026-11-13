import { getRequestUser } from "@/lib/auth/session";
import {
  TournamentEconomyError,
  recordValidatedTournamentResult,
} from "@/lib/economy/tournaments";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string; matchId: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json(
      { error: "Connectez-vous pour enregistrer un résultat." },
      { status: 401 },
    );
  }

  const { tournamentId, matchId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("winnerId" in body) ||
    typeof body.winnerId !== "string"
  ) {
    return NextResponse.json({ error: "Vainqueur requis." }, { status: 400 });
  }

  try {
    const match = await prisma.tournamentMatch.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        tournamentId: true,
        playerWhiteId: true,
        playerBlackId: true,
      },
    });
    if (!match || match.tournamentId !== tournamentId) {
      return NextResponse.json({ error: "Match introuvable." }, { status: 404 });
    }
    if (
      !currentUser.isAdmin &&
      currentUser.id !== match.playerWhiteId &&
      currentUser.id !== match.playerBlackId
    ) {
      return NextResponse.json(
        { error: "Seuls les joueurs du match ou un administrateur peuvent valider son résultat." },
        { status: 403 },
      );
    }

    await recordValidatedTournamentResult(matchId, body.winnerId);
    const updatedMatch = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: matchId },
    });
    return NextResponse.json({ match: updatedMatch });
  } catch (error) {
    if (error instanceof TournamentEconomyError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "INSUFFICIENT_FUNDS"
            ? 402
            : error.code === "NOT_OPEN" ||
                error.code === "NOT_SETTLEABLE" ||
                error.code === "ALREADY_JOINED"
              ? 409
              : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Erreur lors de l'enregistrement du résultat :", error);
    return NextResponse.json(
      { error: "Impossible d'enregistrer le résultat." },
      { status: 500 },
    );
  }
}
