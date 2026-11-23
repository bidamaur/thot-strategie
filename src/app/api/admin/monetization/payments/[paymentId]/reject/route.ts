import { NextResponse } from "next/server";
import { apiRoute, ID, readJson } from "@/lib/monetization/http";
import { rejectPayment } from "@/lib/monetization/payments";

/** REJETER LE PAIEMENT : motif obligatoire ; le joueur est notifié et peut déclarer à nouveau. */
export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return apiRoute(
    request,
    async (admin) => {
      if (!ID.test(paymentId)) return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
      const body = await readJson(request);
      return rejectPayment(admin!.id, paymentId, { reason: body.reason, note: body.note });
    },
    "admin",
  );
}
