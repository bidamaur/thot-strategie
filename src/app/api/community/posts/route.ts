import { communityRoute, readJson } from "@/lib/community/http";
import { createPost } from "@/lib/community/posts";

export async function POST(request: Request) {
  return communityRoute(request, async (user) => ({ post: await createPost(user!.id, await readJson(request)) }));
}
