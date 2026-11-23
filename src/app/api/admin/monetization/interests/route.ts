import { apiRoute, parseDate } from "@/lib/monetization/http";
import { interestStats } from "@/lib/monetization/interest";

export async function GET(request: Request) {
  return apiRoute(
    request,
    async () => {
      const p = new URL(request.url).searchParams;
      return interestStats({
        feature: p.get("feature"),
        countryCode: p.get("country"),
        waitlistOnly: p.get("waitlist") === "1",
        from: parseDate(p.get("from")),
        to: parseDate(p.get("to"), true),
      });
    },
    "admin",
  );
}
