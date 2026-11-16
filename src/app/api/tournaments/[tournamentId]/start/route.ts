import { getRequestUser } from "@/lib/auth/session";
import { startTournamentNow, TournamentGameError } from "@/lib/economy/tournaments";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string }>;
}

/** Démarrage anticipé par l'organisateur (Suisse, toutes rondes, ligue, Survival, Arena). */
export async function POST(request: Request, { params }: RouteContext) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const { tournamentId } = await params;
  try {
    await startTournamentNow(tournamentId, currentUser.id);
    return NextResponse.json({ started: true });
  } catch (error) {
    if (error instanceof TournamentGameError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Démarrage du tournoi impossible :", error);
    return NextResponse.json({ error: "Démarrage impossible." }, { status: 500 });
  }
}
