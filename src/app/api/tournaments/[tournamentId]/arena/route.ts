import { getRequestUser } from "@/lib/auth/session";
import {
  arenaCancelSearch,
  arenaSearch,
  startTournamentGame,
  TournamentGameError,
} from "@/lib/economy/tournaments";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string }>;
}

/**
 * Arena : { action: "search" } met le joueur en recherche (ou l'apparie et
 * renvoie la partie en ligne) ; { action: "cancel" } annule la recherche.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const { tournamentId } = await params;
  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  try {
    if (body.action === "cancel") {
      await arenaCancelSearch(tournamentId, currentUser.id);
      return NextResponse.json({ status: "IDLE" });
    }
    if (body.action !== "search") {
      return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
    }
    const result = await arenaSearch(tournamentId, currentUser.id);
    if (result.status === "WAITING") return NextResponse.json(result);
    const game = await startTournamentGame(result.tournamentMatchId, currentUser.id);
    return NextResponse.json({ status: "MATCHED", matchId: game.matchId });
  } catch (error) {
    if (error instanceof TournamentGameError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Arena : appariement impossible :", error);
    return NextResponse.json({ error: "Appariement impossible." }, { status: 500 });
  }
}
