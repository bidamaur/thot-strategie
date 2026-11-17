import { communityRoute, readJson } from "@/lib/community/http";
import { deleteComment, updateComment } from "@/lib/community/posts";

interface Ctx {
  params: Promise<{ commentId: string }>;
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { commentId } = await params;
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    return { comment: await updateComment(user!.id, commentId, body.body) };
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { commentId } = await params;
  return communityRoute(request, (user) => deleteComment(user!.id, commentId));
}
