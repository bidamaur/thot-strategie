import { CommunityError } from "@/lib/community/core";
import { communityRoute, readJson } from "@/lib/community/http";
import {
  issueSanction,
  listReports,
  listSanctions,
  moderateContent,
  moderationStats,
  resolveReport,
  revokeSanction,
} from "@/lib/community/moderation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  return communityRoute(
    request,
    async () => {
      const [reports, sanctions, stats] = await Promise.all([
        listReports(status === "RESOLVED" || status === "DISMISSED" ? status : "OPEN"),
        listSanctions(url.searchParams.get("user")),
        moderationStats(),
      ]);
      return { reports, sanctions, stats };
    },
    { auth: "admin" },
  );
}

/**
 * - { action: "resolve", reportId, decision: DISMISS|HIDE|RESTORE|DELETE, note }
 * - { action: "moderate", target: POST|COMMENT, id, decision: HIDE|RESTORE|DELETE }
 * - { action: "sanction", userId, type: WARNING|MUTE|SUSPENSION, reason, durationHours }
 * - { action: "revoke", sanctionId }
 */
export async function POST(request: Request) {
  return communityRoute(
    request,
    async (user) => {
      const body = await readJson(request);
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      switch (body.action) {
        case "resolve": {
          const decision = str(body.decision);
          if (!["DISMISS", "HIDE", "RESTORE", "DELETE"].includes(decision)) throw new CommunityError("Décision invalide.", 400);
          await resolveReport(user!.id, str(body.reportId), decision as "DISMISS", body.note);
          return { ok: true };
        }
        case "moderate": {
          const decision = str(body.decision);
          if (!["HIDE", "RESTORE", "DELETE"].includes(decision) || (body.target !== "POST" && body.target !== "COMMENT")) {
            throw new CommunityError("Action de modération invalide.", 400);
          }
          await moderateContent(user!.id, body.target, str(body.id), decision as "HIDE");
          return { ok: true };
        }
        case "sanction":
          return issueSanction(user!.id, body);
        case "revoke":
          await revokeSanction(user!.id, str(body.sanctionId));
          return { ok: true };
        default:
          throw new CommunityError("Action inconnue.", 400);
      }
    },
    { auth: "admin" },
  );
}
