import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { OpponentProfileError, getOpponentProfile } from "@/lib/opponent-profile/service";

const noStore = { "Cache-Control": "no-store" };

/** Profil et statistiques de l'adversaire d'une partie (joueurs de la partie uniquement). */
export async function GET(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401, headers: noStore });
  const { matchId } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(matchId)) {
    return NextResponse.json({ error: "Partie invalide." }, { status: 400, headers: noStore });
  }
  try {
    const profile = await getOpponentProfile(matchId, user);
    return NextResponse.json({ profile }, { headers: noStore });
  } catch (error) {
    if (error instanceof OpponentProfileError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
    }
    console.error("Profil de l’adversaire indisponible :", error);
    return NextResponse.json({ error: "Profil momentanément indisponible." }, { status: 500, headers: noStore });
  }
}
