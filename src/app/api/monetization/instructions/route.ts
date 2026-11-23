import { apiRoute } from "@/lib/monetization/http";
import { paymentInstructions } from "@/lib/monetization/payments";

/** Instructions et codes USSD calculés par le serveur pour un niveau ou un don. */
export async function GET(request: Request) {
  return apiRoute(request, async () => {
    const url = new URL(request.url);
    const purpose = url.searchParams.get("purpose") === "DONATION" ? "DONATION" : "PREMIUM";
    const tierLevel = Number(url.searchParams.get("tier"));
    const amount = Number(url.searchParams.get("amount"));
    return {
      providers: await paymentInstructions({
        purpose,
        tierLevel: Number.isInteger(tierLevel) ? tierLevel : undefined,
        amount: Number.isInteger(amount) ? amount : undefined,
      }),
    };
  });
}
