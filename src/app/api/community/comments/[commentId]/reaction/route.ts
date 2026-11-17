import { communityRoute, readJson } from "@/lib/community/http";
import { parseReaction, reactToComment } from "@/lib/community/posts";

interface Ctx {
  params: Promise<{ commentId: string }>;
}

export async function POST(request: Request, { params }: Ctx) {
  const { commentId } = await params;
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    return reactToComment(user!.id, commentId, body.type === null ? null : parseReaction(body.type));
  });
}
