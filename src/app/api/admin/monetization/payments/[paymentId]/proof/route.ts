import { NextResponse } from "next/server";
import { apiRoute, ID } from "@/lib/monetization/http";
import { getPaymentProofName } from "@/lib/monetization/payments";
import { readProof } from "@/lib/monetization/proof";

/** Capture du SMS : visible uniquement par les administrateurs, jamais mise en cache. */
export async function GET(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  return apiRoute(
    request,
    async () => {
      if (!ID.test(paymentId)) return NextResponse.json({ error: "Identifiant invalide." }, { status: 400 });
      const name = await getPaymentProofName(paymentId);
      const file = name ? await readProof(name) : null;
      if (!file) return NextResponse.json({ error: "Aucune capture." }, { status: 404 });
      return new NextResponse(new Uint8Array(file), {
        headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      });
    },
    "admin",
  );
}
