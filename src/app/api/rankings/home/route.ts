import { NextResponse } from "next/server";
import { getHomeRankings } from "@/lib/rankings/home";

/** Top 20 (ELO + points classiques) et Top 10 Or (ELO + points argent, sans montants). Public. */
export async function GET() {
  try {
    return NextResponse.json(await getHomeRankings(), { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (error) {
    console.error("Classements de l’accueil :", error);
    return NextResponse.json({ error: "Classements momentanément indisponibles." }, { status: 500 });
  }
}
