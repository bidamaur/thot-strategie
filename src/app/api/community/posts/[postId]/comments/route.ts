import { communityRoute, readJson } from "@/lib/community/http";
import { createComment, listComments } from "@/lib/community/posts";

interface Ctx {
  params: Promise<{ postId: string }>;
}

export async function GET(request: Request, { params }: Ctx) {
  const { postId } = await params;
  const url = new URL(request.url);
  return communityRoute(
    request,
    (user) =>
      listComments(user ? { id: user.id, isAdmin: user.isAdmin } : null, postId, {
        parentId: url.searchParams.get("parentId"),
        cursor: url.searchParams.get("cursor"),
        limit: Number(url.searchParams.get("limit") ?? 10) || 10,
      }),
    { auth: "optional" },
  );
}

export async function POST(request: Request, { params }: Ctx) {
  const { postId } = await params;
  return communityRoute(request, async (user) => ({ comment: await createComment(user!.id, postId, await readJson(request)) }));
}
