import { CommunityError, requireActor } from "@/lib/community/core";
import { communityRoute, readJson, stringList } from "@/lib/community/http";
import {
  inviteFriendsToClub,
  inviteFriendsToTournament,
  listMyInvitations,
  respondClubInvite,
  respondTournamentInvite,
} from "@/lib/community/invites";

export async function GET(request: Request) {
  return communityRoute(request, async (user) => {
    await requireActor(user!.id, "read");
    return listMyInvitations(user!.id);
  });
}

/**
 * - { action: "send", kind: "tournament" | "club", target, userIds }
 * - { action: "respond", kind: "tournament" | "club", invitationId, accept }
 */
export async function POST(request: Request) {
  return communityRoute(request, async (user) => {
    const body = await readJson(request);
    const target = typeof body.target === "string" ? body.target : "";
    const invitationId = typeof body.invitationId === "string" ? body.invitationId : "";
    if (body.action === "send") {
      const userIds = stringList(body.userIds);
      if (body.kind === "tournament") return inviteFriendsToTournament(user!.id, target, userIds);
      if (body.kind === "club") return inviteFriendsToClub(user!.id, target, userIds);
    }
    if (body.action === "respond") {
      if (body.kind === "tournament") return respondTournamentInvite(user!.id, invitationId, body.accept === true);
      if (body.kind === "club") return respondClubInvite(user!.id, invitationId, body.accept === true);
    }
    throw new CommunityError("Action inconnue.", 400);
  });
}
