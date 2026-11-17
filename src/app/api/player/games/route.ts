import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { listMyGames } from "@/lib/player-stats";

/** Historique de MES parties, limité selon le niveau (privilège historyDays). */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  const url = new URL(request.url);
  try {
    return NextResponse.json(await listMyGames(user.id, { cursor: url.searchParams.get("cursor"), gameType: url.searchParams.get("type") }));
  } catch (error) {
    console.error("Historique :", error);
    return NextResponse.json({ error: "Impossible de charger l’historique." }, { status: 500 });
  }
}
