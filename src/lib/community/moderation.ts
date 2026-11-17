import { CommunityReportStatus, CommunityReportTarget, CommunitySanctionType, Prisma } from "@/generated/prisma-client";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { AUTHOR_SELECT, authorCard, CommunityError, isUniqueViolation, requireActor } from "./core";
import { notify } from "./notifications";
import { cleanText, decodeFromDb, encodeBounded } from "./text";

export const REPORT_REASONS = {
  SPAM: "Spam ou publicité",
  HARASSMENT: "Harcèlement ou insultes",
  HATE: "Propos haineux",
  CHEATING: "Triche ou arrangement de parties",
  INAPPROPRIATE: "Contenu inapproprié",
  SCAM: "Arnaque ou fraude",
  OTHER: "Autre",
} as const;

export async function reportContent(
  userId: string,
  input: { targetType?: unknown; targetId?: unknown; reason?: unknown; details?: unknown },
) {
  await requireActor(userId, "read");
  const reason = typeof input.reason === "string" && input.reason in REPORT_REASONS ? input.reason : null;
  if (!reason) throw new CommunityError("Choisissez un motif de signalement.", 400);
  const details = cleanText(input.details, 500);
  const targetId = typeof input.targetId === "string" ? input.targetId : "";
  const data: Prisma.CommunityReportUncheckedCreateInput = {
    reporterId: userId,
    targetType: CommunityReportTarget.POST,
    reason,
    details: details ? encodeBounded(details, 500) : null,
  };

  if (input.targetType === "POST") {
    const post = await prisma.communityPost.findUnique({ where: { id: targetId }, select: { id: true, authorId: true, deletedAt: true } });
    if (!post || post.deletedAt) throw new CommunityError("Publication introuvable.", 404);
    if (post.authorId === userId) throw new CommunityError("Vous ne pouvez pas signaler votre propre publication.", 400);
    Object.assign(data, { targetType: CommunityReportTarget.POST, postId: post.id, targetUserId: post.authorId });
  } else if (input.targetType === "COMMENT") {
    const comment = await prisma.communityComment.findUnique({ where: { id: targetId }, select: { id: true, authorId: true, postId: true, deletedAt: true } });
    if (!comment || comment.deletedAt) throw new CommunityError("Commentaire introuvable.", 404);
    if (comment.authorId === userId) throw new CommunityError("Vous ne pouvez pas signaler votre propre commentaire.", 400);
    Object.assign(data, { targetType: CommunityReportTarget.COMMENT, commentId: comment.id, targetUserId: comment.authorId });
  } else if (input.targetType === "USER") {
    const user = await prisma.user.findFirst({ where: { OR: [{ id: targetId }, { username: targetId }] }, select: { id: true } });
    if (!user || user.id === userId) throw new CommunityError("Joueur introuvable.", 404);
    const recent = await prisma.communityReport.count({
      where: { reporterId: userId, targetUserId: user.id, targetType: "USER", status: "OPEN" },
    });
    if (recent > 0) throw new CommunityError("Vous avez déjà signalé ce joueur.", 409);
    Object.assign(data, { targetType: CommunityReportTarget.USER, targetUserId: user.id });
  } else {
    throw new CommunityError("Contenu à signaler invalide.", 400);
  }

  try {
    await prisma.communityReport.create({ data });
  } catch (error) {
    if (isUniqueViolation(error)) throw new CommunityError("Vous avez déjà signalé ce contenu.", 409);
    throw error;
  }

  // Masquage automatique au-delà du seuil de signalements distincts (en attente d'un modérateur).
  const settings = await getSettings(["community.reportAutoHideThreshold"] as const);
  const threshold = settings["community.reportAutoHideThreshold"];
  if (threshold > 0 && (data.postId || data.commentId)) {
    const count = await prisma.communityReport.count({
      where: { status: "OPEN", ...(data.postId ? { postId: data.postId } : { commentId: data.commentId }) },
    });
    if (count >= threshold) {
      if (data.postId) await prisma.communityPost.update({ where: { id: data.postId }, data: { isHidden: true } });
      else await prisma.communityComment.update({ where: { id: data.commentId! }, data: { isHidden: true } });
    }
  }
  return { ok: true };
}

// ── Espace de modération (administrateurs) ────────────────────────────

export async function listReports(status: CommunityReportStatus = "OPEN", limit = 50) {
  const rows = await prisma.communityReport.findMany({
    where: { status },
    orderBy: { createdAt: status === "OPEN" ? "asc" : "desc" },
    take: Math.min(limit, 200),
    include: {
      reporter: { select: { username: true } },
      targetUser: { select: AUTHOR_SELECT },
      resolvedBy: { select: { username: true } },
      post: { select: { id: true, title: true, body: true, isHidden: true, deletedAt: true, imageUrl: true } },
      comment: { select: { id: true, body: true, isHidden: true, deletedAt: true, postId: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    targetType: r.targetType,
    reason: r.reason,
    reasonLabel: REPORT_REASONS[r.reason as keyof typeof REPORT_REASONS] ?? r.reason,
    details: decodeFromDb(r.details),
    status: r.status,
    resolution: decodeFromDb(r.resolution),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    reporter: r.reporter.username,
    resolvedBy: r.resolvedBy?.username ?? null,
    targetUser: r.targetUser ? authorCard(r.targetUser) : null,
    post: r.post
      ? { id: r.post.id, title: decodeFromDb(r.post.title), body: decodeFromDb(r.post.body).slice(0, 600), isHidden: r.post.isHidden, deleted: !!r.post.deletedAt, imageUrl: r.post.imageUrl }
      : null,
    comment: r.comment
      ? { id: r.comment.id, body: decodeFromDb(r.comment.body).slice(0, 600), isHidden: r.comment.isHidden, deleted: !!r.comment.deletedAt, postId: r.comment.postId }
      : null,
  }));
}

export type ModerationAction = "DISMISS" | "HIDE" | "RESTORE" | "DELETE";

/** Traite un signalement ; l'action s'applique au contenu et clôt tous les signalements le visant. */
export async function resolveReport(adminId: string, reportId: string, action: ModerationAction, note?: unknown) {
  const report = await prisma.communityReport.findUnique({ where: { id: reportId } });
  if (!report) throw new CommunityError("Signalement introuvable.", 404);
  const resolution = cleanText(note, 300);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (report.postId && action !== "DISMISS") {
      await tx.communityPost.update({
        where: { id: report.postId },
        data: action === "HIDE" ? { isHidden: true } : action === "RESTORE" ? { isHidden: false } : { deletedAt: now, isPinned: false },
      });
    }
    if (report.commentId && action !== "DISMISS") {
      const comment = await tx.communityComment.findUniqueOrThrow({ where: { id: report.commentId } });
      if (action === "DELETE" && !comment.deletedAt) {
        await tx.communityComment.update({ where: { id: comment.id }, data: { deletedAt: now } });
        await tx.communityPost.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
        if (comment.parentId) await tx.communityComment.update({ where: { id: comment.parentId }, data: { replyCount: { decrement: 1 } } });
      } else if (action !== "DELETE") {
        await tx.communityComment.update({ where: { id: comment.id }, data: { isHidden: action === "HIDE" } });
      }
    }
    const scope = report.postId
      ? { postId: report.postId }
      : report.commentId
        ? { commentId: report.commentId }
        : { id: report.id };
    await tx.communityReport.updateMany({
      where: { ...scope, status: "OPEN" },
      data: {
        status: action === "DISMISS" || action === "RESTORE" ? "DISMISSED" : "RESOLVED",
        resolvedById: adminId,
        resolvedAt: now,
        resolution: resolution ? encodeBounded(resolution, 300) : null,
      },
    });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: `COMMUNITY_REPORT_${action}`,
      entity: report.postId ? "CommunityPost" : report.commentId ? "CommunityComment" : "User",
      entityId: report.postId ?? report.commentId ?? report.targetUserId,
      after: { reportId, reason: report.reason, note: resolution || null },
    });
  });
  if ((action === "HIDE" || action === "DELETE") && report.targetUserId) {
    await notify({
      userId: report.targetUserId,
      type: "MODERATION",
      title: action === "DELETE" ? "Un de vos contenus a été supprimé par la modération" : "Un de vos contenus a été masqué par la modération",
      body: resolution || REPORT_REASONS[report.reason as keyof typeof REPORT_REASONS] || null,
      link: "/communaute",
    });
  }
}

/** Modération directe d'un contenu (sans signalement préalable). */
export async function moderateContent(adminId: string, target: "POST" | "COMMENT", id: string, action: "HIDE" | "RESTORE" | "DELETE") {
  await prisma.$transaction(async (tx) => {
    if (target === "POST") {
      const post = await tx.communityPost.findUnique({ where: { id } });
      if (!post) throw new CommunityError("Publication introuvable.", 404);
      await tx.communityPost.update({
        where: { id },
        data: action === "HIDE" ? { isHidden: true } : action === "RESTORE" ? { isHidden: false, deletedAt: null } : { deletedAt: new Date(), isPinned: false },
      });
    } else {
      const comment = await tx.communityComment.findUnique({ where: { id } });
      if (!comment) throw new CommunityError("Commentaire introuvable.", 404);
      if (action === "DELETE") {
        if (!comment.deletedAt) {
          await tx.communityComment.update({ where: { id }, data: { deletedAt: new Date() } });
          await tx.communityPost.update({ where: { id: comment.postId }, data: { commentCount: { decrement: 1 } } });
          if (comment.parentId) await tx.communityComment.update({ where: { id: comment.parentId }, data: { replyCount: { decrement: 1 } } });
        }
      } else {
        await tx.communityComment.update({ where: { id }, data: { isHidden: action === "HIDE" } });
      }
    }
    await writeAuditLog(tx, { actorId: adminId, action: `COMMUNITY_${target}_${action}`, entity: target === "POST" ? "CommunityPost" : "CommunityComment", entityId: id });
  });
}

// ── Sanctions ─────────────────────────────────────────────────────────

export async function issueSanction(
  adminId: string,
  input: { userId?: unknown; type?: unknown; reason?: unknown; durationHours?: unknown },
) {
  const type = input.type === "WARNING" || input.type === "MUTE" || input.type === "SUSPENSION" ? (input.type as CommunitySanctionType) : null;
  if (!type) throw new CommunityError("Type de sanction invalide.", 400);
  const reason = cleanText(input.reason, 300);
  if (reason.length < 3) throw new CommunityError("Indiquez le motif de la sanction.", 400);
  const target = typeof input.userId === "string"
    ? await prisma.user.findFirst({ where: { OR: [{ id: input.userId }, { username: input.userId }] }, select: { id: true, username: true, isAdmin: true } })
    : null;
  if (!target) throw new CommunityError("Joueur introuvable.", 404);
  if (target.isAdmin) throw new CommunityError("Un administrateur ne peut pas être sanctionné ici.", 400);
  const hours = input.durationHours === undefined || input.durationHours === null || input.durationHours === "" ? null : Number(input.durationHours);
  if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 3650)) throw new CommunityError("Durée invalide.", 400);
  const expiresAt = type === "WARNING" ? null : hours ? new Date(Date.now() + hours * 3600_000) : null;

  const sanction = await prisma.$transaction(async (tx) => {
    const created = await tx.communitySanction.create({
      data: { userId: target.id, type, reason: encodeBounded(reason, 300), issuedById: adminId, expiresAt },
    });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: `COMMUNITY_SANCTION_${type}`,
      entity: "User",
      entityId: target.id,
      after: { reason, expiresAt: expiresAt?.toISOString() ?? null },
    });
    return created;
  });
  const label = type === "WARNING" ? "Avertissement" : type === "MUTE" ? "Restriction temporaire" : "Suspension de l’accès communautaire";
  await notify({
    userId: target.id,
    type: "MODERATION",
    title: `${label}${expiresAt ? ` jusqu’au ${expiresAt.toLocaleString("fr-FR")}` : ""}`,
    body: reason,
    link: "/communaute",
  });
  return { id: sanction.id };
}

export async function revokeSanction(adminId: string, sanctionId: string) {
  await prisma.$transaction(async (tx) => {
    const sanction = await tx.communitySanction.findUnique({ where: { id: sanctionId } });
    if (!sanction || sanction.revokedAt) throw new CommunityError("Sanction introuvable ou déjà levée.", 404);
    await tx.communitySanction.update({ where: { id: sanctionId }, data: { revokedAt: new Date() } });
    await writeAuditLog(tx, { actorId: adminId, action: "COMMUNITY_SANCTION_REVOKED", entity: "User", entityId: sanction.userId, before: { type: sanction.type } });
  });
}

export async function listSanctions(username?: string | null) {
  const user = username ? await prisma.user.findUnique({ where: { username }, select: { id: true } }) : null;
  if (username && !user) return [];
  const rows = await prisma.communitySanction.findMany({
    where: user ? { userId: user.id } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { username: true } }, issuedBy: { select: { username: true } } },
  });
  const now = Date.now();
  return rows.map((s) => ({
    id: s.id,
    username: s.user.username,
    type: s.type,
    reason: decodeFromDb(s.reason),
    issuedBy: s.issuedBy?.username ?? null,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt?.toISOString() ?? null,
    revokedAt: s.revokedAt?.toISOString() ?? null,
    active: s.type !== "WARNING" && !s.revokedAt && (!s.expiresAt || s.expiresAt.getTime() > now),
  }));
}

export async function moderationStats() {
  const [openReports, hiddenPosts, activeSanctions, posts24h] = await Promise.all([
    prisma.communityReport.count({ where: { status: "OPEN" } }),
    prisma.communityPost.count({ where: { isHidden: true, deletedAt: null } }),
    prisma.communitySanction.count({
      where: { revokedAt: null, type: { not: "WARNING" }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    }),
    prisma.communityPost.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
  ]);
  return { openReports, hiddenPosts, activeSanctions, posts24h };
}
