import { communityRoute, readJson } from "@/lib/community/http";
import { parseReaction, reactToPost } from "@/lib/community/posts";

interface Ctx {
  params: Promise<{ postId: string }>;
}

export async function POST(request: Request, { params }: Ctx) {
  const { postId } = await params;
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    return { post: await reactToPost(user!.id, postId, body.type === null ? null : parseReaction(body.type)) };
  });
}
