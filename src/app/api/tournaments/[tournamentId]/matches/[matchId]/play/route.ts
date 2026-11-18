import { getRequestUser } from "@/lib/auth/session";
import { startTournamentGame, TournamentGameError } from "@/lib/economy/tournaments";
import { PlayerBusyError } from "@/lib/game-exit/busy";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string; matchId: string }>;
}

/** Ouvre la partie en ligne d'un match de tournoi et renvoie son identifiant. */
export async function POST(request: Request, { params }: RouteContext) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }
  const { tournamentId, matchId } = await params;
  const belongs = await prisma.tournamentMatch.findFirst({
    where: { id: matchId, tournamentId },
    select: { id: true },
  });
  if (!belongs) return NextResponse.json({ error: "Match introuvable." }, { status: 404 });

  try {
    const game = await startTournamentGame(matchId, currentUser.id);
    return NextResponse.json(game);
  } catch (error) {
    if (error instanceof PlayerBusyError) {
      return NextResponse.json(error.toJSON(), { status: error.status });
    }
    if (error instanceof TournamentGameError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Lancement d'une partie de tournoi impossible :", error);
    return NextResponse.json({ error: "Impossible de lancer la partie." }, { status: 500 });
  }
}
