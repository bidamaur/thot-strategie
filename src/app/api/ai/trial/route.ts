import { NextResponse } from "next/server";
import { startTrialAd, consumeTrial } from "@/lib/ai-training/access";
import { apiRoute, readJson } from "@/lib/monetization/http";

/**
 * Essai quotidien du niveau 5 :
 *  - { step: "ad" } : démarre la publicité (horodatage serveur) ;
 *  - { step: "start", gameType } : lance la partie si la publicité a duré le temps prévu.
 */
export async function POST(request: Request) {
  return apiRoute(request, async (user) => {
    const body = await readJson(request);
    if (body.step === "ad") return startTrialAd(user!.id);
    if (body.step === "start") {
      const gameType = body.gameType === "CHESS" ? "CHESS" : body.gameType === "CHECKERS" ? "CHECKERS" : null;
      if (!gameType) return NextResponse.json({ error: "Jeu invalide." }, { status: 400 });
      return consumeTrial(user!.id, gameType);
    }
    return NextResponse.json({ error: "Étape inconnue." }, { status: 400 });
  });
}
