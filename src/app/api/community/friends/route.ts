import { CommunityError, requireActor } from "@/lib/community/core";
import {
  blockUser,
  cancelFriendRequest,
  listBlocked,
  listFriends,
  listRequests,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  setFavorite,
  unblockUser,
} from "@/lib/community/friends";
import { communityRoute, readJson } from "@/lib/community/http";

export async function GET(request: Request) {
  return communityRoute(request, async (user) => {
    await requireActor(user!.id, "read");
    const [friends, requests, blocked] = await Promise.all([listFriends(user!.id), listRequests(user!.id), listBlocked(user!.id)]);
    return { friends, requests, blocked };
  });
}

export async function POST(request: Request) {
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    const id = user!.id;
    const target = typeof body.target === "string" ? body.target : "";
    const friendshipId = typeof body.friendshipId === "string" ? body.friendshipId : "";
    switch (body.action) {
      case "request":
        return sendFriendRequest(id, target);
      case "accept":
      case "decline":
      case "block-request":
        return respondFriendRequest(id, friendshipId, body.action === "block-request" ? "block" : body.action);
      case "cancel":
        await cancelFriendRequest(id, friendshipId);
        return { ok: true };
      case "remove":
        await removeFriend(id, target);
        return { ok: true };
      case "favorite":
        await setFavorite(id, target, body.favorite === true);
        return { ok: true };
      case "block":
        await blockUser(id, target);
        return { ok: true };
      case "unblock":
        await unblockUser(id, target);
        return { ok: true };
      default:
        throw new CommunityError("Action inconnue.", 400);
    }
  });
}
