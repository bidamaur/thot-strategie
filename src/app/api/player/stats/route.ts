import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth/session";
import { myStats } from "@/lib/player-stats";

/** Statistiques essentielles (tous) et avancées (privilège advancedStats). */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  try {
    return NextResponse.json(await myStats(user.id));
  } catch (error) {
    console.error("Statistiques :", error);
    return NextResponse.json({ error: "Impossible de calculer vos statistiques." }, { status: 500 });
  }
}
