import { getRequestUser } from "@/lib/auth/session";
import { SurvivalStopError, voteSurvivalStop } from "@/lib/economy/tournaments";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string }>;
}

/** Survival : { agree: true } pour demander l'arrêt, { agree: false } pour retirer son vote. */
export async function POST(request: Request, { params }: RouteContext) {
  const currentUser = await getRequestUser(request);
  if (!currentUser) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const { tournamentId } = await params;
  let body: { agree?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }
  if (typeof body.agree !== "boolean") {
    return NextResponse.json({ error: "Réponse attendue : agree true ou false." }, { status: 400 });
  }
  try {
    const result = await voteSurvivalStop(tournamentId, currentUser.id, body.agree);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SurvivalStopError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Vote d'arrêt impossible :", error);
    return NextResponse.json({ error: "Vote impossible." }, { status: 500 });
  }
}
