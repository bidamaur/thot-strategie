import { requireActor } from "@/lib/community/core";
import { searchPlayers } from "@/lib/community/friends";
import { communityRoute } from "@/lib/community/http";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return communityRoute(request, async (user) => {
    await requireActor(user!.id, "read");
    return { players: await searchPlayers(user!.id, q) };
  });
}
