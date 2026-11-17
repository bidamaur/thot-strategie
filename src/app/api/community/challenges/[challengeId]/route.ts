import { cancelChallenge, respondChallenge } from "@/lib/community/challenges";
import { CommunityError } from "@/lib/community/core";
import { communityRoute, readJson } from "@/lib/community/http";

interface Ctx {
  params: Promise<{ challengeId: string }>;
}

export async function POST(request: Request, { params }: Ctx) {
  const { challengeId } = await params;
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    if (body.action === "cancel") {
      await cancelChallenge(user!.id, challengeId);
      return { status: "CANCELLED" };
    }
    if (body.action !== "accept" && body.action !== "decline") throw new CommunityError("Action inconnue.", 400);
    return respondChallenge(user!.id, challengeId, body.action, { acceptMoney: body.acceptMoney });
  });
}
