import { CommunityError } from "@/lib/community/core";
import { communityRoute, readJson, stringList } from "@/lib/community/http";
import { getRoom, inviteToRoom, setRoomMembership } from "@/lib/community/rooms";

interface Ctx {
  params: Promise<{ slug: string }>;
}

export async function GET(request: Request, { params }: Ctx) {
  const { slug } = await params;
  return communityRoute(request, async (user) => ({ room: await getRoom(slug, user ? { id: user.id, isAdmin: user.isAdmin } : null) }), { auth: "optional" });
}

export async function POST(request: Request, { params }: Ctx) {
  const { slug } = await params;
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    if (body.action === "invite") return inviteToRoom(user!.id, slug, stringList(body.userIds));
    if (body.action === "join" || body.action === "leave" || body.action === "follow" || body.action === "unfollow") {
      await setRoomMembership(user!.id, slug, body.action);
      return { ok: true };
    }
    throw new CommunityError("Action inconnue.", 400);
  });
}
