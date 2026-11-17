import { touchPresence } from "@/lib/community/core";
import { communityRoute, readJson, stringList } from "@/lib/community/http";
import { listNotifications, markRead, unreadCount } from "@/lib/community/notifications";

/** ?count=1 : compteur seul (appelé périodiquement par la navigation, sert aussi de signal de présence). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return communityRoute(request, async (user) => {
    await touchPresence(user!.id);
    if (url.searchParams.get("count")) return { unread: await unreadCount(user!.id) };
    const [page, unread] = await Promise.all([listNotifications(user!.id, url.searchParams.get("cursor")), unreadCount(user!.id)]);
    return { ...page, unread };
  });
}

export async function POST(request: Request) {
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    const marked = await markRead(user!.id, body.read === "all" ? "all" : stringList(body.read, 100));
    return { marked, unread: await unreadCount(user!.id) };
  });
}
