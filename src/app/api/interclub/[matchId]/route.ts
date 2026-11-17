import { CommunityError } from "@/lib/community/core";
import { communityRoute, readJson, stringList } from "@/lib/community/http";
import { cancelClubMatch, getClubMatch, respondClubMatch, setLineup, startBoardGame } from "@/lib/community/interclub";

interface Ctx {
  params: Promise<{ matchId: string }>;
}

export async function GET(request: Request, { params }: Ctx) {
  const { matchId } = await params;
  return communityRoute(request, async (user) => ({ match: await getClubMatch(matchId, user ? { id: user.id, isAdmin: user.isAdmin } : null) }), { auth: "optional" });
}

/** { action: accept | decline | cancel | lineup (side, playerIds) | play (boardId) } */
export async function POST(request: Request, { params }: Ctx) {
  const { matchId } = await params;
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    switch (body.action) {
      case "accept":
      case "decline":
        await respondClubMatch(user!.id, matchId, body.action === "accept");
        return { ok: true };
      case "cancel":
        await cancelClubMatch(user!.id, matchId);
        return { ok: true };
      case "lineup":
        if (body.side !== "HOME" && body.side !== "AWAY") throw new CommunityError("Équipe invalide.", 400);
        return setLineup(user!.id, matchId, body.side, stringList(body.playerIds, 20));
      case "play":
        return startBoardGame(user!.id, typeof body.boardId === "string" ? body.boardId : "");
      default:
        throw new CommunityError("Action inconnue.", 400);
    }
  });
}
