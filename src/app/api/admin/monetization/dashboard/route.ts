import { monetizationDashboard } from "@/lib/monetization/dashboard";
import { apiRoute } from "@/lib/monetization/http";

export async function GET(request: Request) {
  return apiRoute(request, () => monetizationDashboard(), "admin");
}
