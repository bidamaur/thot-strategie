import { Prisma, TournamentInvitationStatus } from "@/generated/prisma-client";
import { isMockEconomyEnabled } from "@/lib/economy/mock-mode";
import { respondToTournamentInvitation, TournamentEconomyError } from "@/lib/economy/tournaments";
import { prisma } from "@/lib/prisma";
import { getSetting, getSettings } from "@/lib/settings/service";
import { actorPrivileges, blockedIdsFor, CommunityError, isUniqueViolation, requireActor } from "./core";
import { friendIds } from "./friends";
import { notify } from "./notifications";

/**
 * Invitations entre amis — réutilisent la table TournamentInvitation existante.
 * Une invitation n'ouvre aucun passe-droit : l'inscription passe toujours par
 * le service d'inscription habituel (éligibilité, places, Premium, droits d'entrée).
 * Seul l'organisateur peut inviter à un tournoi privé (l'invitation y vaut accès).
 */
export async function inviteFriendsToTournament(userId: string, tournamentId: string, userIds: string[]) {
  const actor = await requireActor(userId);
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, name: true, status: true, creatorId: true, visibility: true, clubId: true, maxPlayers: true, _count: { select: { participants: true } } },
  });
  if (!tournament) throw new CommunityError("Tournoi introuvable.", 404);
  if (tournament.status !== "OPEN") throw new CommunityError("Les inscriptions de ce tournoi sont fermées.", 409);
  if (tournament.visibility === "PRIVATE" && tournament.creatorId !== userId && !actor.isAdmin) {
    throw new CommunityError("Seul l’organisateur peut inviter à un tournoi privé.", 403);
  }
  const settings = await getSettings(["community.tournamentInvitesPerDay"] as const);
  const sentToday = await prisma.tournamentInvitation.count({
    where: { invitedById: userId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
  });
  const privileges = await actorPrivileges(actor);
  const friends = new Set(await friendIds(userId));
  const blocked = new Set(await blockedIdsFor(userId));
  const targets = [...new Set(userIds)]
    .filter((id) => id !== userId && friends.has(id) && !blocked.has(id))
    .slice(0, privileges.maxBulkInvites ?? 5);
  if (targets.length === 0) throw new CommunityError("Sélectionnez au moins un ami.", 400);
  if (sentToday + targets.length > settings["community.tournamentInvitesPerDay"]) {
    throw new CommunityError("Limite quotidienne d’invitations atteinte.", 429);
  }
  const already = await prisma.tournamentParticipant.findMany({
    where: { tournamentId, userId: { in: targets } },
    select: { userId: true },
  });
  const registered = new Set(already.map((p) => p.userId));
  const toInvite = targets.filter((id) => !registered.has(id));
  const result = await prisma.tournamentInvitation.createMany({
    data: toInvite.map((id) => ({ tournamentId, userId: id, invitedById: userId })),
    skipDuplicates: true,
  });
  const created = await prisma.tournamentInvitation.findMany({
    where: { tournamentId, userId: { in: toInvite }, invitedById: userId, status: TournamentInvitationStatus.PENDING },
    select: { userId: true },
  });
  await notify(
    created.map((inv) => ({
      userId: inv.userId,
      actorId: userId,
      type: "TOURNAMENT_INVITE" as const,
      title: `${actor.username} vous invite au tournoi « ${tournament.name} »`,
      link: `/tournois/${tournament.id}`,
    })),
  );
  return { invited: result.count, alreadyRegistered: registered.size };
}

export async function listMyInvitations(userId: string) {
  const [tournaments, clubs] = await Promise.all([
    prisma.tournamentInvitation.findMany({
      where: { userId, status: TournamentInvitationStatus.PENDING, tournament: { status: "OPEN" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        tournament: { select: { id: true, name: true, gameType: true, type: true, isPaid: true, entryPoints: true, entryFee: true, maxPlayers: true, _count: { select: { participants: true } } } },
        invitedBy: { select: { username: true } },
      },
    }),
    prisma.clubInvitation.findMany({
      where: { userId, status: TournamentInvitationStatus.PENDING },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { club: { select: { id: true, name: true, slug: true, _count: { select: { members: true } } } }, invitedBy: { select: { username: true } } },
    }),
  ]);
  return {
    tournaments: tournaments.map((i) => ({
      id: i.id,
      tournament: {
        id: i.tournament.id,
        name: i.tournament.name,
        gameType: i.tournament.gameType,
        type: i.tournament.type,
        isPaid: i.tournament.isPaid,
        entryPoints: i.tournament.entryPoints,
        entryFee: i.tournament.entryFee.toString(),
        players: i.tournament._count.participants,
        maxPlayers: i.tournament.maxPlayers,
      },
      invitedBy: i.invitedBy?.username ?? "L’organisateur",
      createdAt: i.createdAt.toISOString(),
    })),
    clubs: clubs.map((i) => ({
      id: i.id,
      club: { id: i.club.id, name: i.club.name, slug: i.club.slug, members: i.club._count.members },
      invitedBy: i.invitedBy.username,
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

/** Accepter = s'inscrire via le service habituel (mêmes règles que le bouton « S'inscrire »). */
export async function respondTournamentInvite(userId: string, invitationId: string, accept: boolean) {
  await requireActor(userId, "read");
  const invitation = await prisma.tournamentInvitation.findUnique({
    where: { id: invitationId },
    select: { userId: true, tournamentId: true, tournament: { select: { isPaid: true } } },
  });
  if (!invitation || invitation.userId !== userId) throw new CommunityError("Invitation introuvable.", 404);
  if (accept && invitation.tournament.isPaid) {
    if (!isMockEconomyEnabled() || !(await getSetting("money.tournamentsEnabled"))) {
      throw new CommunityError("Les tournois payants sont momentanément fermés.", 403);
    }
  }
  try {
    await respondToTournamentInvitation(invitation.tournamentId, invitationId, userId, accept);
    return { tournamentId: invitation.tournamentId, accepted: accept };
  } catch (error) {
    if (error instanceof TournamentEconomyError) {
      throw new CommunityError(error.message, error.code === "INSUFFICIENT_FUNDS" ? 402 : error.code === "NOT_FOUND" ? 404 : 409);
    }
    throw error;
  }
}

// ── Clubs ─────────────────────────────────────────────────────────────

export async function inviteFriendsToClub(userId: string, slug: string, userIds: string[]) {
  const actor = await requireActor(userId);
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, name: true, isPrivate: true, maxMembers: true, _count: { select: { members: true } } } });
  if (!club) throw new CommunityError("Club introuvable.", 404);
  const member = await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId } }, select: { role: true } });
  if (!member && !actor.isAdmin) throw new CommunityError("Seuls les membres peuvent inviter dans ce club.", 403);
  if (club.isPrivate && member?.role === "MEMBER" && !actor.isAdmin) {
    throw new CommunityError("Dans un club privé, seuls les responsables invitent.", 403);
  }
  const privileges = await actorPrivileges(actor);
  const friends = new Set(await friendIds(userId));
  const targets = [...new Set(userIds)].filter((id) => friends.has(id)).slice(0, privileges.maxBulkInvites ?? 5);
  if (targets.length === 0) throw new CommunityError("Sélectionnez au moins un ami.", 400);
  const existingMembers = new Set(
    (await prisma.clubMember.findMany({ where: { clubId: club.id, userId: { in: targets } }, select: { userId: true } })).map((m) => m.userId),
  );
  const toInvite = targets.filter((id) => !existingMembers.has(id));
  // Une invitation refusée peut être renouvelée.
  await prisma.clubInvitation.deleteMany({ where: { clubId: club.id, userId: { in: toInvite }, status: TournamentInvitationStatus.DECLINED } });
  const result = await prisma.clubInvitation.createMany({
    data: toInvite.map((id) => ({ clubId: club.id, userId: id, invitedById: userId })),
    skipDuplicates: true,
  });
  await notify(
    toInvite.map((id) => ({
      userId: id,
      actorId: userId,
      type: "CLUB_INVITE" as const,
      title: `${actor.username} vous invite à rejoindre le club « ${club.name} »`,
      link: "/communaute?tab=defis",
    })),
  );
  return { invited: result.count };
}

export async function respondClubInvite(userId: string, invitationId: string, accept: boolean) {
  await requireActor(userId, "read");
  return prisma.$transaction(
    async (tx) => {
      const invitation = await tx.clubInvitation.findUnique({
        where: { id: invitationId },
        include: { club: { select: { id: true, slug: true, maxMembers: true, _count: { select: { members: true } } } } },
      });
      if (!invitation || invitation.userId !== userId) throw new CommunityError("Invitation introuvable.", 404);
      if (invitation.status !== TournamentInvitationStatus.PENDING) throw new CommunityError("Invitation déjà traitée.", 409);
      if (accept) {
        if (invitation.club._count.members >= invitation.club.maxMembers) throw new CommunityError("Le club est complet.", 409);
        try {
          await tx.clubMember.create({ data: { clubId: invitation.clubId, userId } });
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }
      await tx.clubInvitation.update({
        where: { id: invitationId },
        data: { status: accept ? TournamentInvitationStatus.ACCEPTED : TournamentInvitationStatus.DECLINED, respondedAt: new Date() },
      });
      return { slug: invitation.club.slug, accepted: accept };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
