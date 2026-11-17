import { communityRoute, readJson } from "@/lib/community/http";
import { adminDeleteRoom, adminUpdateRoom } from "@/lib/community/rooms";

interface Ctx {
  params: Promise<{ roomId: string }>;
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { roomId } = await params;
  return communityRoute(request, async (user) => ({ room: await adminUpdateRoom(user!.id, roomId, await readJson(request)) }), { auth: "admin" });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { roomId } = await params;
  return communityRoute(request, async (user) => {
    await adminDeleteRoom(user!.id, roomId);
    return { ok: true };
  }, { auth: "admin" });
}
