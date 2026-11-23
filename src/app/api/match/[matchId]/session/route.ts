import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { getMatchSession, SessionError } from "@/lib/match-session";

const noStore = { "Cache-Control": "no-store" };

/** Score de la session (affront) : parties successives entre les deux joueurs. */
export async function GET(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401, headers: noStore });
  const { matchId } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(matchId)) return NextResponse.json({ error: "Partie invalide." }, { status: 400, headers: noStore });
  try {
    return NextResponse.json({ session: await getMatchSession(matchId, user.id) }, { headers: noStore });
  } catch (error) {
    if (error instanceof SessionError) return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
    console.error("Score de session indisponible :", error);
    return NextResponse.json({ error: "Score momentanément indisponible." }, { status: 500, headers: noStore });
  }
}
