import { Prisma, TournamentMatchStatus, TournamentParticipantStatus } from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";

export class TournamentMatchmakingError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "NO_ELIGIBLE_PLAYERS" | "ALREADY_PAIRED" | "TOURNAMENT_NOT_ACTIVE",
  ) {
    super(message);
    this.name = "TournamentMatchmakingError";
  }
}

interface PlayerScore {
  userId: string;
  walletId: string;
  elo: number;
  capital: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  lastOpponentIds: string[];
}

export class TournamentMatchmakingEngine {
  /**
   * Trouve un adversaire pour un joueur dans un tournoi Survival Bank
   * Algorithme de priorité :
   * 1. Même variante et cadence
   * 2. Différence Elo faible
   * 3. Différence de capital faible
   * 4. Joueurs n'ayant pas récemment joué ensemble
   * 5. Temps d'attente
   */
  static async findOpponent(
    tournamentId: string,
    playerUserId: string,
    minBet: number,
  ): Promise<{
    opponentUserId: string;
    opponentWalletId: string;
    opponentElo: number;
    opponentCapital: number;
  } | null> {
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        minElo: true,
        maxElo: true,
        minPoints: true,
        maxPoints: true,
        draughtsVariant: true,
        timeControlMinutes: true,
        rebuyEnabled: true,
      },
    });
    if (!tournament) {
      throw new TournamentMatchmakingError("Tournoi introuvable.", "NOT_FOUND");
    }

    // Récupérer le joueur actuel
    const currentWallet = await prisma.tournamentWallet.findFirst({
      where: { tournamentId, userId: playerUserId },
      include: { user: { select: { elo: true } } },
    });
    if (!currentWallet) {
      throw new TournamentMatchmakingError("Portefeuille introuvable.", "NOT_FOUND");
    }
    if (currentWallet.status === TournamentParticipantStatus.ELIMINATED) {
      throw new TournamentMatchmakingError("Joueur éliminé.", "NOT_FOUND");
    }

    // Récupérer les joueurs actifs éligibles
    const eligiblePlayers = await prisma.tournamentWallet.findMany({
      where: {
        tournamentId,
        status: TournamentParticipantStatus.ACTIVE,
        userId: { not: playerUserId },
        capital: { gte: minBet },
      },
      include: {
        user: { select: { elo: true, username: true } },
      },
    });

    if (eligiblePlayers.length === 0) {
      return null;
    }

    // Filtrer par critères Elo si définis
    let candidates = eligiblePlayers;
    if (tournament.minElo !== undefined) {
      candidates = candidates.filter((p) => p.user.elo >= tournament.minElo!);
    }
    if (tournament.maxElo !== undefined) {
      candidates = candidates.filter((p) => p.user.elo <= tournament.maxElo!);
    }

    if (candidates.length === 0) {
      return null;
    }

    // Scorer chaque candidat
    const scored = candidates.map((candidate) => {
      const eloDiff = Math.abs(currentWallet.user.elo - candidate.user.elo);
      const capitalDiff = Math.abs(currentWallet.capital - candidate.capital);
      const matchesDiff = Math.abs(currentWallet.matchesPlayed - candidate.matchesPlayed);

      // Score plus bas = meilleur match
      let score = eloDiff * 1.0 + capitalDiff * 0.1 + matchesDiff * 0.5;

      // Pénaliser si ils ont déjà joué ensemble récemment
      // (On pourrait regarder l'historique des matchs ici)

      return {
        ...candidate,
        score,
        eloDiff,
        capitalDiff,
      };
    });

    // Trier par score (meilleur en premier)
    scored.sort((a, b) => a.score - b.score);

    const best = scored[0];
    return {
      opponentUserId: best.userId,
      opponentWalletId: best.id,
      opponentElo: best.user.elo,
      opponentCapital: best.capital,
    };
  }

  /**
   * Crée un match de tournoi entre deux joueurs
   */
  static async createTournamentMatch(
    tournamentId: string,
    playerWhiteId: string,
    playerBlackId: string,
    round: number,
    matchNumber: number,
    betAmount: number | null,
  ) {
    return prisma.tournamentMatch.create({
      data: {
        tournamentId,
        playerWhiteId,
        playerBlackId,
        round,
        matchNumber,
        status: TournamentMatchStatus.WAITING,
        betAmount,
        betStatus: betAmount ? "PROPOSED" : null,
      },
    });
  }

  /**
   * Génère les appariements pour un round donné
   * Utilise l'algorithme de appariement par score (Suisse simplifié)
   */
  static async generateRoundPairings(
    tournamentId: string,
    roundNumber: number,
    minBet: number,
  ): Promise<Array<{ whiteUserId: string; blackUserId: string }>> {
    const participants = await prisma.tournamentWallet.findMany({
      where: {
        tournamentId,
        status: TournamentParticipantStatus.ACTIVE,
        capital: { gte: minBet },
      },
      include: { user: { select: { elo: true } } },
    });

    if (participants.length < 2) {
      return [];
    }

    // Trier par Elo décroissant, puis par capital
    const sorted = [...participants].sort((a, b) => {
      if (b.user.elo !== a.user.elo) return b.user.elo - a.user.elo;
      return b.capital - a.capital;
    });

    const pairings: Array<{ whiteUserId: string; blackUserId: string }> = [];
    const used = new Set<string>();

    // Appariement : premier avec dernier, etc. (style Suisse)
    for (let i = 0; i < sorted.length / 2; i++) {
      const white = sorted[i];
      const black = sorted[sorted.length - 1 - i];

      if (used.has(white.userId) || used.has(black.userId)) continue;
      if (white.userId === black.userId) continue;

      pairings.push({ whiteUserId: white.userId, blackUserId: black.userId });
      used.add(white.userId);
      used.add(black.userId);
    }

    return pairings;
  }

  /**
   * Vérifie si un joueur a déjà un match en cours dans ce tournoi
   */
  static async hasActiveMatch(
    tournamentId: string,
    userId: string,
  ): Promise<boolean> {
    const activeMatch = await prisma.tournamentMatch.findFirst({
      where: {
        tournamentId,
        status: { in: ["WAITING", "IN_PROGRESS"] },
        OR: [{ playerWhiteId: userId }, { playerBlackId: userId }],
      },
    });
    return !!activeMatch;
  }

  /**
   * Récupère le match en cours d'un joueur
   */
  static async getActiveMatch(tournamentId: string, userId: string) {
    return prisma.tournamentMatch.findFirst({
      where: {
        tournamentId,
        status: { in: ["WAITING", "IN_PROGRESS"] },
        OR: [{ playerWhiteId: userId }, { playerBlackId: userId }],
      },
    });
  }
}
