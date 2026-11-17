import { communityRoute, readJson } from "@/lib/community/http";
import { deletePost, getPost, updatePost } from "@/lib/community/posts";

interface Ctx {
  params: Promise<{ postId: string }>;
}

export async function GET(request: Request, { params }: Ctx) {
  const { postId } = await params;
  return communityRoute(request, async (user) => ({ post: await getPost(postId, user ? { id: user.id, isAdmin: user.isAdmin } : null) }), { auth: "optional" });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { postId } = await params;
  return communityRoute(request, async (user) => ({ post: await updatePost(user!.id, postId, await readJson(request)) }));
}

export async function DELETE(request: Request, { params }: Ctx) {
  const { postId } = await params;
  return communityRoute(request, (user) => deletePost(user!.id, postId));
}
