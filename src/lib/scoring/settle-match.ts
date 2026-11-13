import {
  MatchStatus,
  Prisma,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import {
  calculateScoreDelta,
  DEFAULT_POINTS_CONFIG,
} from "./points";
import { calculateElo, DEFAULT_RATING_CONFIG } from "../rating/elo";

export interface SettleMatchInput {
  matchId: string;
  winnerId: string | null;
  whiteRemainingPieces: number;
  blackRemainingPieces: number;
  finalStatus?: "FINISHED" | "ABANDONED";
  result?: "WIN" | "LOSS" | "DRAW"; // GameResult for white player
}

export class MatchSettlementError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_RESULT"
      | "MATCH_NOT_FOUND"
      | "MATCH_NOT_SETTLEABLE"
      | "PAID_MATCH_DISABLED"
      | "INSUFFICIENT_WALLET"
      | "ALREADY_SETTLED",
  ) {
    super(message);
    this.name = "MatchSettlementError";
  }
}

function assertPieceCount(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new MatchSettlementError(
      "Le nombre de pièces restantes doit être un entier positif ou nul.",
      "INVALID_RESULT",
    );
  }
}

/**
 * Règle une partie avec gestion complète : points de jeu, Elo, mises.
 * Toute la logique financière et de classement est côté serveur.
 */
export async function settleMatch(
  input: SettleMatchInput,
): Promise<{
  scoreDelta: number;
  whiteBalance: number;
  blackBalance: number;
  whiteEloChange: number;
  blackEloChange: number;
  betSettled: boolean;
  betAmount: number | null;
  whiteResult: "WIN" | "LOSS" | "DRAW" | null;
  blackResult: "WIN" | "LOSS" | "DRAW" | null;
}> {
  assertPieceCount(input.whiteRemainingPieces);
  assertPieceCount(input.blackRemainingPieces);

  return prisma.$transaction(async (transaction) => {
    const match = await transaction.match.findUnique({
      where: { id: input.matchId },
      include: {
        playerWhite: { select: { id: true, username: true, pointsFree: true, elo: true } },
        playerBlack: { select: { id: true, username: true, pointsFree: true, elo: true } },
        gameBet: true,
      },
    });
    if (!match) {
      throw new MatchSettlementError("Partie introuvable.", "MATCH_NOT_FOUND");
    }
    // Idempotence : une partie déjà réglée ne peut pas l'être deux fois
    const existingResult = await transaction.matchResult.findUnique({
      where: { matchId: input.matchId },
    });
    if (existingResult) {
      throw new MatchSettlementError(
        "La partie a déjà été réglée.",
        "ALREADY_SETTLED",
      );
    }
    if (match.status !== MatchStatus.IN_PROGRESS || !match.playerBlackId) {
      throw new MatchSettlementError(
        "Cette partie n’est pas en cours ou n’a pas deux joueurs valides.",
        "MATCH_NOT_SETTLEABLE",
      );
    }

    const whiteWon = input.winnerId === match.playerWhiteId;
    const blackWon = input.winnerId === match.playerBlackId;
    const isDraw = !whiteWon && !blackWon;

    // --- 1. Points de jeu (Mode A : sans mise, jamais de pénalité pour le perdant) ---
    let scoreDelta = 0;
    if (!isDraw && input.winnerId) {
      scoreDelta = calculateScoreDelta(
        match.gameType,
        whiteWon ? input.whiteRemainingPieces : input.blackRemainingPieces,
        whiteWon ? input.blackRemainingPieces : input.whiteRemainingPieces,
        DEFAULT_POINTS_CONFIG,
      );
      // Seul le gagnant gagne des points. Le perdant ne perd jamais de points en mode sans mise.
    }

    // --- 2. Elo (modifie toujours, même en mode sans mise) ---
    const whiteEloBefore = match.playerWhite.elo;
    const blackEloBefore = match.playerBlack!.elo;
    let whiteEloChange = 0;
    let blackEloChange = 0;

    if (match.rated) {
      const scoreA = isDraw ? 0.5 : whiteWon ? 1 : 0;
      const eloResult = calculateElo(
        whiteEloBefore,
        blackEloBefore,
        scoreA,
        DEFAULT_RATING_CONFIG,
      );
      whiteEloChange = eloResult.deltaA;
      blackEloChange = eloResult.deltaB;
    }

    // --- 3. Gestion de la mise volontaire (Mode B) ---
    let betSettled = false;
    let betAmount: number | null = null;

    if (match.betEnabled && match.gameBet && match.gameBet.status === "ACCEPTED") {
      betAmount = match.gameBet.amount;
      if (isDraw) {
        // Match nul : remboursement des deux mises
        await transaction.user.update({
          where: { id: match.playerWhiteId },
          data: { pointsFree: { increment: betAmount } },
        });
        await transaction.user.update({
          where: { id: match.playerBlackId },
          data: { pointsFree: { increment: betAmount } },
        });
        await transaction.gameBetTransaction.create({
          data: {
            betId: match.gameBet.id,
            userId: match.playerWhiteId,
            amount: betAmount,
            type: "BET_REFUNDED",
          },
        });
        await transaction.gameBetTransaction.create({
          data: {
            betId: match.gameBet.id,
            userId: match.playerBlackId,
            amount: betAmount,
            type: "BET_REFUNDED",
          },
        });
        await transaction.gameBet.update({
          where: { id: match.gameBet.id },
          data: { status: "REFUNDED", settledAt: new Date() },
        });
        betSettled = true;
      } else if (whiteWon) {
        // Blanc gagne : récupère sa mise + gagne celle du noir
        await transaction.user.update({
          where: { id: match.playerWhiteId },
          data: { pointsFree: { increment: betAmount } },
        });
        await transaction.user.update({
          where: { id: match.playerBlackId },
          data: { pointsFree: { decrement: betAmount } },
        });
        await transaction.gameBetTransaction.create({
          data: {
            betId: match.gameBet.id,
            userId: match.playerWhiteId,
            amount: betAmount,
            type: "BET_WON",
          },
        });
        await transaction.gameBetTransaction.create({
          data: {
            betId: match.gameBet.id,
            userId: match.playerBlackId,
            amount: -betAmount,
            type: "BET_LOST",
          },
        });
        await transaction.gameBet.update({
          where: { id: match.gameBet.id },
          data: { status: "SETTLED", settledAt: new Date() },
        });
        betSettled = true;
      } else if (blackWon) {
        // Noir gagne : récupère sa mise + gagne celle du blanc
        await transaction.user.update({
          where: { id: match.playerBlackId },
          data: { pointsFree: { increment: betAmount } },
        });
        await transaction.user.update({
          where: { id: match.playerWhiteId },
          data: { pointsFree: { decrement: betAmount } },
        });
        await transaction.gameBetTransaction.create({
          data: {
            betId: match.gameBet.id,
            userId: match.playerBlackId,
            amount: betAmount,
            type: "BET_WON",
          },
        });
        await transaction.gameBetTransaction.create({
          data: {
            betId: match.gameBet.id,
            userId: match.playerWhiteId,
            amount: -betAmount,
            type: "BET_LOST",
          },
        });
        await transaction.gameBet.update({
          where: { id: match.gameBet.id },
          data: { status: "SETTLED", settledAt: new Date() },
        });
        betSettled = true;
      }
    }

    // --- 4. Application des points de jeu (gagnant uniquement) ---
    const whiteWonAndScore = whiteWon && scoreDelta > 0;
    const blackWonAndScore = blackWon && scoreDelta > 0;

    const whiteUpdate =
      whiteWonAndScore
        ? transaction.user.update({
            where: { id: match.playerWhiteId },
            data: { pointsFree: { increment: scoreDelta } },
            select: { pointsFree: true },
          })
        : transaction.user.findUniqueOrThrow({
            where: { id: match.playerWhiteId },
            select: { pointsFree: true },
          });
    const blackUpdate =
      blackWonAndScore
        ? transaction.user.update({
            where: { id: match.playerBlackId },
            data: { pointsFree: { increment: scoreDelta } },
            select: { pointsFree: true },
          })
        : transaction.user.findUniqueOrThrow({
            where: { id: match.playerBlackId },
            select: { pointsFree: true },
          });

    // --- 5. Mise à jour de la partie ---
    const claimed = await transaction.match.updateMany({
      where: {
        id: match.id,
        status: MatchStatus.IN_PROGRESS,
        playerBlackId: { not: null },
      },
      data: {
        status: input.finalStatus ?? MatchStatus.FINISHED,
        winnerId: input.winnerId,
        result: input.result ?? null,
        whiteRemainingPieces: input.whiteRemainingPieces,
        blackRemainingPieces: input.blackRemainingPieces,
        scoreDelta,
        eloDeltaWhite: whiteEloChange,
        eloDeltaBlack: blackEloChange,
        disconnectedPlayerId: null,
        disconnectedAt: null,
        updatedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw new MatchSettlementError(
        "La partie a déjà été réglée ou n’est plus en cours.",
        "MATCH_NOT_SETTLEABLE",
      );
    }

    // --- 6. Mise à jour des Elo des joueurs ---
    if (match.rated && (whiteEloChange !== 0 || blackEloChange !== 0)) {
      await transaction.user.update({
        where: { id: match.playerWhiteId },
        data: { elo: { increment: whiteEloChange } },
      });
      await transaction.user.update({
        where: { id: match.playerBlackId },
        data: { elo: { increment: blackEloChange } },
      });
    }

    const [white, black] = await Promise.all([whiteUpdate, blackUpdate]);

    // --- 7. Enregistrement du résultat officiel ---
    await transaction.matchResult.create({
      data: {
        matchId: input.matchId,
        whiteResult: isDraw ? "DRAW" : whiteWon ? "WIN" : "LOSS",
        blackResult: isDraw ? "DRAW" : blackWon ? "WIN" : "LOSS",
        whitePointsChange: whiteWonAndScore ? scoreDelta : 0,
        blackPointsChange: blackWonAndScore ? scoreDelta : 0,
        whiteEloChange,
        blackEloChange,
        betSettled,
        settledAt: new Date(),
      },
    });

    // --- 8. Historique des variations Elo ---
    if (match.rated) {
      const variant = match.draughtsVariant
        ? match.draughtsVariant === "ENGLISH"
          ? "ENGLISH"
          : "INTERNATIONAL"
        : "CHESS";
      await transaction.ratingHistory.create({
        data: {
          userId: match.playerWhiteId,
          variant,
          timeControl: match.timeControlMinutes
            ? `${match.timeControlMinutes}min`
            : null,
          oldRating: whiteEloBefore,
          newRating: whiteEloBefore + whiteEloChange,
          change: whiteEloChange,
          reason: whiteWon
            ? "GAME_WIN"
            : isDraw
              ? "GAME_DRAW"
              : "GAME_LOSS",
          matchId: input.matchId,
          opponentId: match.playerBlackId,
          opponentRatingBefore: blackEloBefore,
        },
      });
      await transaction.ratingHistory.create({
        data: {
          userId: match.playerBlackId,
          variant,
          timeControl: match.timeControlMinutes
            ? `${match.timeControlMinutes}min`
            : null,
          oldRating: blackEloBefore,
          newRating: blackEloBefore + blackEloChange,
          change: blackEloChange,
          reason: blackWon
            ? "GAME_WIN"
            : isDraw
              ? "GAME_DRAW"
              : "GAME_LOSS",
          matchId: input.matchId,
          opponentId: match.playerWhiteId,
          opponentRatingBefore: whiteEloBefore,
        },
      });
    }

    // --- 9. Mise à jour ou création des PlayerRating ---
    await Promise.all([
      upsertPlayerRating(
        transaction,
        match.playerWhiteId,
        match.draughtsVariant
          ? match.draughtsVariant === "ENGLISH"
            ? "ENGLISH"
            : "INTERNATIONAL"
          : "CHESS",
        match.timeControlMinutes ? `${match.timeControlMinutes}min` : null,
        whiteEloBefore + whiteEloChange,
        whiteWon ? 1 : isDraw ? 0 : 0,
        whiteWon ? 1 : isDraw ? 1 : 0,
        isDraw ? 1 : 0,
      ),
      upsertPlayerRating(
        transaction,
        match.playerBlackId,
        match.draughtsVariant
          ? match.draughtsVariant === "ENGLISH"
            ? "ENGLISH"
            : "INTERNATIONAL"
          : "CHESS",
        match.timeControlMinutes ? `${match.timeControlMinutes}min` : null,
        blackEloBefore + blackEloChange,
        blackWon ? 1 : isDraw ? 0 : 0,
        blackWon ? 1 : isDraw ? 1 : 0,
        isDraw ? 1 : 0,
      ),
    ]);

    return {
      scoreDelta,
      whiteBalance: white.pointsFree,
      blackBalance: black.pointsFree,
      whiteEloChange,
      blackEloChange,
      betSettled,
      betAmount,
      whiteResult: isDraw ? "DRAW" : whiteWon ? "WIN" : "LOSS",
      blackResult: isDraw ? "DRAW" : blackWon ? "WIN" : "LOSS",
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

async function upsertPlayerRating(
  transaction: Prisma.TransactionClient,
  userId: string,
  variant: string,
  timeControl: string | null,
  newRating: number,
  wins: number,
  losses: number,
  draws: number,
): Promise<void> {
  const existing = await transaction.playerRating.findFirst({
    where: {
      userId,
      variant,
      timeControl,
    },
  });
  if (existing) {
    await transaction.playerRating.update({
      where: { id: existing.id },
      data: {
        eloRating: newRating,
        gamesPlayed: existing.gamesPlayed + 1,
        wins: existing.wins + wins,
        losses: existing.losses + losses,
        draws: existing.draws + draws,
        lastRatingUpdate: new Date(),
      },
    });
  } else {
    await transaction.playerRating.create({
      data: {
        userId,
        variant,
        timeControl,
        eloRating: newRating,
        gamesPlayed: 1,
        wins,
        losses,
        draws,
        lastRatingUpdate: new Date(),
      },
    });
  }
}

/**
 * Fonction legacy conservée pour compatibilité avec le socket-server existant.
 * Elle ne gère pas les mises ni l'Elo.
 */
export async function settleUnpaidMatch(
  input: Omit<SettleMatchInput, "result">,
): Promise<{ scoreDelta: number; whiteBalance: number; blackBalance: number }> {
  const result = await settleMatch({
    ...input,
    result: undefined,
  });
  return {
    scoreDelta: result.scoreDelta,
    whiteBalance: result.whiteBalance,
    blackBalance: result.blackBalance,
  };
}
