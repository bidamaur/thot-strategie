import { communityRoute } from "@/lib/community/http";
import { getFeed } from "@/lib/community/posts";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return communityRoute(
    request,
    (user) =>
      getFeed(user ? { id: user.id, isAdmin: user.isAdmin } : null, {
        room: url.searchParams.get("room"),
        club: url.searchParams.get("club"),
        author: url.searchParams.get("author"),
        cursor: url.searchParams.get("cursor"),
        limit: Number(url.searchParams.get("limit") ?? 15) || 15,
      }),
    { auth: "optional" },
  );
}
