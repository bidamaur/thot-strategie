import { CommunityError, requireActor, actorPrivileges } from "@/lib/community/core";
import { communityRoute } from "@/lib/community/http";
import { prisma } from "@/lib/prisma";

/** Statistiques communautaires avancées (privilège Premium « communityStats »). */
export async function GET(request: Request) {
  return communityRoute(request, async (user) => {
    const actor = await requireActor(user!.id, "read");
    const privileges = await actorPrivileges(actor);
    if (!privileges.communityStats) throw new CommunityError("Statistiques avancées réservées aux membres Premium.", 403);
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const [posts, reactionsReceived, commentsReceived, newFriends, topPosts] = await Promise.all([
      prisma.communityPost.count({ where: { authorId: actor.id, deletedAt: null, createdAt: { gte: since } } }),
      prisma.communityReaction.count({ where: { post: { authorId: actor.id }, createdAt: { gte: since } } }),
      prisma.communityComment.count({ where: { post: { authorId: actor.id }, authorId: { not: actor.id }, createdAt: { gte: since }, deletedAt: null } }),
      prisma.friendship.count({ where: { status: "ACCEPTED", respondedAt: { gte: since }, OR: [{ requesterId: actor.id }, { addresseeId: actor.id }] } }),
      prisma.communityPost.findMany({
        where: { authorId: actor.id, deletedAt: null },
        orderBy: [{ reactionCount: "desc" }, { commentCount: "desc" }],
        take: 5,
        select: { id: true, title: true, body: true, reactionCount: true, commentCount: true, createdAt: true },
      }),
    ]);
    const { decodeFromDb } = await import("@/lib/community/text");
    return {
      period: 30,
      posts,
      reactionsReceived,
      commentsReceived,
      newFriends,
      topPosts: topPosts.map((p) => ({ id: p.id, title: decodeFromDb(p.title) ?? decodeFromDb(p.body).slice(0, 80), reactions: p.reactionCount, comments: p.commentCount, createdAt: p.createdAt.toISOString() })),
    };
  });
}
