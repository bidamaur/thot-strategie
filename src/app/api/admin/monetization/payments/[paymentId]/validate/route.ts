import { NextResponse } from "next/server";
import { apiRoute, ID, readJson } from "@/lib/monetization/http";
import { validatePayment } from "@/lib/monetization/payments";

/** VALIDER LE PAIEMENT : après vérification de la réception effective sur le compte Mobile Money. */
export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return apiRoute(
    request,
    async (admin) => {
      if (!ID.test(paymentId)) return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
      const body = await readJson(request);
      if (body.confirm !== true) return NextResponse.json({ error: "Confirmation requise." }, { status: 400 });
      return validatePayment(admin!.id, paymentId, { receivedAmount: body.receivedAmount });
    },
    "admin",
  );
}
