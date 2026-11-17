import { communityRoute, readJson } from "@/lib/community/http";
import { setPinned } from "@/lib/community/posts";

interface Ctx {
  params: Promise<{ postId: string }>;
}

export async function POST(request: Request, { params }: Ctx) {
  const { postId } = await params;
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    await setPinned(user!.id, postId, body.pinned === true);
    return { ok: true };
  });
}
