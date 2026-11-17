import { communityRoute, readJson } from "@/lib/community/http";
import { reportContent } from "@/lib/community/moderation";

export async function POST(request: Request) {
  return communityRoute(request, async (user) => reportContent(user!.id, await readJson(request)));
}
