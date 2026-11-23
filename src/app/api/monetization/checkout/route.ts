import { apiRoute } from "@/lib/monetization/http";
import { isOnWaitlist } from "@/lib/monetization/interest";
import { getCheckoutConfig } from "@/lib/monetization/payments";

/** Offres achetables, canaux de paiement et éligibilité du joueur connecté (montants issus des paramètres). */
export async function GET(request: Request) {
  return apiRoute(
    request,
    async (user) => ({
      ...(await getCheckoutConfig(user?.id ?? null)),
      loggedIn: Boolean(user),
      onWaitlist: user ? await isOnWaitlist(user.id) : false,
    }),
    "optional",
  );
}
