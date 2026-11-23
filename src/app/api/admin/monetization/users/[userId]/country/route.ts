import { NextResponse } from "next/server";
import { apiRoute, ID, readJson } from "@/lib/monetization/http";
import { setVerifiedCountry } from "@/lib/monetization/payments";

/** Contrôle administratif du pays retenu pour les paiements (prime sur le pays déclaré). */
export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return apiRoute(
    request,
    async (admin) => {
      if (!ID.test(userId)) return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
      const body = await readJson(request);
      return setVerifiedCountry(admin!.id, userId, body.verifiedCountryCode ?? null);
    },
    "admin",
  );
}
