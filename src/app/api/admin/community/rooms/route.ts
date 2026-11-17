import { communityRoute, readJson } from "@/lib/community/http";
import { adminCreateRoom, adminListRooms } from "@/lib/community/rooms";

export async function GET(request: Request) {
  return communityRoute(request, async () => ({ rooms: await adminListRooms() }), { auth: "admin" });
}

export async function POST(request: Request) {
  return communityRoute(request, async (user) => ({ room: await adminCreateRoom(user!.id, await readJson(request)) }), { auth: "admin" });
}
