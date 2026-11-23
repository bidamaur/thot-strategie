import { NextResponse } from "next/server";
import { apiRoute, ID } from "@/lib/monetization/http";
import { getPaymentForAdmin } from "@/lib/monetization/payments";

export async function GET(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return apiRoute(
    request,
    async () => {
      if (!ID.test(paymentId)) return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
      const payment = await getPaymentForAdmin(paymentId);
      return payment ? { payment } : NextResponse.json({ error: "Déclaration introuvable." }, { status: 404 });
    },
    "admin",
  );
}
