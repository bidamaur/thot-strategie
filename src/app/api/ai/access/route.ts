import { getAiAccess } from "@/lib/ai-training/access";
import { apiRoute } from "@/lib/monetization/http";

/** Niveaux d'IA accessibles et état de l'essai quotidien du niveau 5. */
export async function GET(request: Request) {
  return apiRoute(request, async (user) => ({ access: await getAiAccess(user?.id ?? null) }), "optional");
}
