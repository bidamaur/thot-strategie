import { apiRoute, ID, parseDate } from "@/lib/monetization/http";
import { listPayments } from "@/lib/monetization/payments";

/** Déclarations de paiement (Premium ou dons) avec filtres. */
export async function GET(request: Request) {
  return apiRoute(
    request,
    async () => {
      const p = new URL(request.url).searchParams;
      const tier = Number(p.get("tier"));
      const cursor = p.get("cursor");
      return listPayments({
        purpose: p.get("purpose"),
        status: p.get("status"),
        provider: p.get("provider"),
        tierLevel: Number.isInteger(tier) && tier > 0 ? tier : null,
        from: parseDate(p.get("from")),
        to: parseDate(p.get("to"), true),
        q: p.get("q")?.slice(0, 60) ?? null,
        cursor: cursor && ID.test(cursor) ? cursor : null,
      });
    },
    "admin",
  );
}
