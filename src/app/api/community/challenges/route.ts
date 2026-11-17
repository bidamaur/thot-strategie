import { createChallenge, listChallenges } from "@/lib/community/challenges";
import { requireActor } from "@/lib/community/core";
import { communityRoute, readJson } from "@/lib/community/http";

export async function GET(request: Request) {
  return communityRoute(request, async (user) => {
    await requireActor(user!.id, "read");
    return { challenges: await listChallenges(user!.id) };
  });
}

export async function POST(request: Request) {
  return communityRoute(request, async (user) => ({ challenge: await createChallenge(user!.id, await readJson(request)) }));
}
