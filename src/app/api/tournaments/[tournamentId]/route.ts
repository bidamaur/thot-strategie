import { MatchStatus } from "@/generated/prisma-client";
import { getRequestUser } from "@/lib/auth/session";
import {
  closeExpiredTimedTournaments,
  getArenaStandings,
  getGroupStandings,
  getTournamentStandings,
  isStandingsFormat,
  reconcileTournamentGames,
} from "@/lib/economy/tournaments";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{ tournamentId: string }>;
}

export async function GET(request: Request, { params }: RouteContext) {
  const { tournamentId } = await params;
  const currentUser = await getRequestUser(request);
  try {
    // Reprise après incident : reporte les parties terminées non encore comptées.
    await reconcileTournamentGames(tournamentId);
    await closeExpiredTimedTournaments();

    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        creator: { select: { id: true, username: true } },
        club: { select: { id: true, name: true, slug: true } },
        participants: {
          orderBy: { seed: "asc" },
          include: { user: { select: { id: true, username: true, elo: true } } },
        },
        invitations: currentUser
          ? { where: { userId: currentUser.id }, select: { status: true } }
          : false,
        wallets: {
          orderBy: { capital: "desc" },
          include: { user: { select: { id: true, username: true } } },
        },
        stopVotes: { select: { userId: true } },
        bracketMatches: {
          orderBy: [{ round: "asc" }, { stage: "asc" }, { matchNumber: "asc" }],
          include: {
            playerWhite: { select: { id: true, username: true } },
            playerBlack: { select: { id: true, username: true } },
            winner: { select: { id: true, username: true } },
            games: {
              where: { status: MatchStatus.IN_PROGRESS },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!tournament) {
      return NextResponse.json({ error: "Tournoi introuvable." }, { status: 404 });
    }

    // Visibilité : privé (créateur, invités, inscrits), club (membres).
    const isParticipant = currentUser
      ? tournament.participants.some((p) => p.userId === currentUser.id)
      : false;
    if (!currentUser?.isAdmin && tournament.visibility !== "PUBLIC" && currentUser?.id !== tournament.creatorId && !isParticipant) {
      let allowed = false;
      if (currentUser && tournament.visibility === "PRIVATE") {
        allowed = Array.isArray(tournament.invitations) && tournament.invitations.length > 0;
      }
      if (currentUser && tournament.visibility === "CLUB" && tournament.clubId) {
        allowed = Boolean(
          await prisma.clubMember.findUnique({
            where: { clubId_userId: { clubId: tournament.clubId, userId: currentUser.id } },
            select: { id: true },
          }),
        );
      }
      if (!allowed) {
        return NextResponse.json({ error: "Ce tournoi n’est pas public." }, { status: 403 });
      }
    }

    const standings = isStandingsFormat(tournament.type)
      ? await getTournamentStandings(prisma, tournamentId)
      : null;
    const names = new Map(tournament.participants.map((p) => [p.userId, p.user.username]));
    const groups =
      tournament.type === "GROUPS_ELIMINATION"
        ? (await getGroupStandings(prisma, tournamentId)).map((g) => ({
            group: g.group,
            rows: g.rows.map((row) => ({ ...row, username: names.get(row.userId) ?? "?" })),
          }))
        : null;
    const arena =
      tournament.type === "ARENA"
        ? (await getArenaStandings(prisma, tournamentId)).map((row) => ({ ...row, username: names.get(row.userId) ?? "?" }))
        : null;
    const me = currentUser ? tournament.participants.find((p) => p.userId === currentUser.id) : undefined;

    return NextResponse.json({
      tournament: {
        ...tournament,
        invitations: undefined,
        entryFee: tournament.entryFee.toString(),
        totalPrizePool: tournament.totalPrizePool.toString(),
        platformFee: tournament.platformFee.toString(),
        wallets: tournament.wallets.map((w) => ({
          userId: w.userId,
          username: w.user.username,
          capital: w.capital,
          initialCapital: w.initialCapital,
          status: w.status,
          matchesPlayed: w.matchesPlayed,
          matchesWon: w.matchesWon,
          matchesLost: w.matchesLost,
          matchesDrawn: w.matchesDrawn,
          eliminatedAt: w.eliminatedAt,
        })),
        stopVotes: tournament.stopVotes.map((v) => v.userId),
        bracketMatches: tournament.bracketMatches.map(({ games, ...m }) => ({
          ...m,
          liveGameId: games[0]?.id ?? null,
        })),
      },
      format:
        tournament.type === "SURVIVAL_BANK"
          ? "SURVIVAL"
          : tournament.type === "ARENA"
            ? "ARENA"
            : tournament.type === "GROUPS_ELIMINATION"
              ? "GROUPS"
              : tournament.type === "DOUBLE_ELIMINATION"
                ? "DOUBLE"
                : standings
                  ? "STANDINGS"
                  : "BRACKET",
      groups,
      arena,
      arenaWaiting: Boolean(me?.arenaWaitingSince),
      standings: standings?.map((row) => ({ ...row, username: names.get(row.userId) ?? "?" })) ?? null,
      viewer: currentUser
        ? {
            id: currentUser.id,
            isParticipant,
            isOrganizer: currentUser.id === tournament.creatorId || currentUser.isAdmin,
            isAdmin: currentUser.isAdmin,
          }
        : null,
    });
  } catch (error) {
    console.error("Erreur lors de la lecture du tournoi :", error);
    return NextResponse.json(
      { error: "Impossible de charger le tournoi." },
      { status: 500 },
    );
  }
}
