import { communityRoute, readJson } from "@/lib/community/http";
import { createPrivateRoom, listRooms } from "@/lib/community/rooms";

export async function GET(request: Request) {
  return communityRoute(request, async (user) => ({ rooms: await listRooms(user ? { id: user.id, isAdmin: user.isAdmin } : null) }), { auth: "optional" });
}

/** Salon privé (privilège Premium). */
export async function POST(request: Request) {
  return communityRoute(request, async (user) => ({ room: await createPrivateRoom(user!.id, await readJson(request)) }));
}
