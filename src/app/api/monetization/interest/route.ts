import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/lib/monetization/http";
import { recordInterest } from "@/lib/monetization/interest";
import { isInterestFeature } from "@/lib/monetization/rules";
import { getSetting } from "@/lib/settings/service";

/**
 * Sollicitation d'une fonctionnalité Premium (consultation) ou inscription
 * volontaire à la liste d'attente (`waitlist: true`). Agrégé par joueur et fonctionnalité.
 */
export async function POST(request: Request) {
  return apiRoute(
    request,
    async (user) => {
      // Visiteur non connecté : rien n'est enregistré (aucun joueur à qui rattacher l'intérêt).
      if (!user) return new NextResponse(null, { status: 204 });
      const body = await readJson(request);
      if (!isInterestFeature(body.feature)) return NextResponse.json({ error: "Fonctionnalité inconnue." }, { status: 400 });
      const waitlist = body.waitlist === true;
      if (waitlist && !(await getSetting("waitlist.enabled"))) return NextResponse.json({ error: "La liste d’attente est fermée." }, { status: 403 });
      const tierLevel = typeof body.tierLevel === "number" ? body.tierLevel : undefined;
      return { interest: await recordInterest(user.id, { feature: body.feature, tierLevel, waitlist }) };
    },
    "optional",
  );
}
