import { communityRoute } from "@/lib/community/http";
import { getPublicProfile } from "@/lib/community/profile";

interface Ctx {
  params: Promise<{ username: string }>;
}

export async function GET(request: Request, { params }: Ctx) {
  const { username } = await params;
  return communityRoute(
    request,
    async (user) => ({ profile: await getPublicProfile(decodeURIComponent(username), user ? { id: user.id, isAdmin: user.isAdmin } : null) }),
    { auth: "optional" },
  );
}
