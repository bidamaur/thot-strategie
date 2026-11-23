import { apiRoute, readJson } from "@/lib/monetization/http";
import { checkDeclaration, declarePayment, myPayments, PaymentError, type DeclareInput } from "@/lib/monetization/payments";
import { saveProof } from "@/lib/monetization/proof";
import { getSetting } from "@/lib/settings/service";

/** Mes déclarations de paiement et leur statut. */
export async function GET(request: Request) {
  return apiRoute(request, async (user) => ({ payments: await myPayments(user!.id) }));
}

const FIELDS = ["purpose", "provider", "tierLevel", "amount", "senderPhone", "declaredAmount", "transactionRef", "paidAt"] as const;

/**
 * Déclaration « J'ai effectué le paiement » : JSON, ou multipart avec une
 * capture facultative du SMS (champ `proof`). Statut : EN ATTENTE ; rien n'est activé.
 */
export async function POST(request: Request) {
  return apiRoute(request, async (user) => {
    const input = {} as DeclareInput;
    let proof: File | null = null;
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      for (const name of FIELDS) {
        const v = form.get(name);
        (input as unknown as Record<string, unknown>)[name] = typeof v === "string" ? v : undefined;
      }
      const file = form.get("proof");
      if (file instanceof File && file.size > 0) proof = file;
    } else {
      const body = await readJson(request);
      for (const name of FIELDS) (input as unknown as Record<string, unknown>)[name] = body[name];
    }
    let proofName: string | null = null;
    if (proof) {
      if (!(await getSetting("payments.proofImageEnabled"))) throw new PaymentError("Les captures d’écran ne sont pas acceptées actuellement.");
      // Contrôles d'abord : aucune image n'est enregistrée pour une déclaration refusée.
      await checkDeclaration(user!.id, input);
      proofName = await saveProof(proof, user!.id);
    }
    return { payment: await declarePayment(user!.id, input, proofName) };
  });
}
