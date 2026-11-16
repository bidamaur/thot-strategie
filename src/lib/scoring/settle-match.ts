import {
  BalanceTransactionType,
  BalanceType,
  MatchMode,
  MatchStatus,
  Prisma,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings/service";
import { refundStake, settleStakeWin } from "@/lib/economy/money-wallet";
import { loadRatingSettings } from "@/lib/rating/load-config";
import {
  cadenceOf,
  computePoolElo,
  poolKey,
  ratingVariantOf,
} from "@/lib/rating/pools";
import { calculateScoreDelta, type PointsConfig } from "./points";
import { isUniqueViolation, withSerializableRetry } from "@/lib/db/retry";

/**
 * Règlement d'une partie en ligne — UNIQUE point d'entrée pour modifier les
 * trois systèmes de points à l'issue d'une partie :
 *
 *  1. Points classiques (non monétaires)  → `User.pointsFree`
 *  2. Classement ALO/ELO par pool          → `PlayerRating` (+ `User.elo` global historique)
 *  3. Points argent (mode MONEY seulement) → `User.walletReal` / `walletLocked`
 *
 * Tout est calculé côté serveur, dans une transaction sérialisable, et rendu
 * idempotent par la contrainte unique `MatchResult.matchId`.
 */

export interface SettleMatchInput {
  matchId: string;
  winnerId: string | null;
  whiteRemainingPieces: number;
  blackRemainingPieces: number;
  finalStatus?: "FINISHED" | "ABANDONED";
  result?: "WIN" | "LOSS" | "DRAW"; // résultat du joueur blanc
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

export interface SettleMatchResult {
  scoreDelta: number;
  whitePointsChange: number;
  blackPointsChange: number;
  whiteBalance: number;
  blackBalance: number;
  whiteEloBalance: number;
  blackEloBalance: number;
  whiteEloChange: number;
  blackEloChange: number;
  betSettled: boolean;
  betAmount: number | null;
  whiteResult: "WIN" | "LOSS" | "DRAW" | null;
  blackResult: "WIN" | "LOSS" | "DRAW" | null;
  mode: "CASUAL" | "RATED" | "MONEY";
  moneyStake: number | null;
  whiteMoneyChange: number;
  blackMoneyChange: number;
  moneyCommission: number;
}

function assertPieceCount(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new MatchSettlementError(
      "Le nombre de pièces restantes doit être un entier positif ou nul.",
      "INVALID_RESULT",
    );
  }
}

async function loadPointsRules() {
  const s = await getSettings([
    "points.classic.enabled",
    "points.classic.winBase",
    "points.classic.pieceBonusCap",
    "points.classic.lossPercent",
    "points.classic.drawPoints",
    "points.classic.floorAtZero",
    "points.classic.casualAwards",
    "points.classic.ratedAwards",
    "points.classic.dailyGainCap",
    "money.commissionPercent",
    "money.affectsRating",
  ] as const);
  return s;
}

async function gainedToday(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const sum = await tx.balanceTransaction.aggregate({
    where: {
      userId,
      transactionType: BalanceTransactionType.GAME_POINTS_WON,
      createdAt: { gte: start },
    },
    _sum: { amount: true },
  });
  return sum._sum.amount?.toNumber() ?? 0;
}

export async function settleMatch(input: SettleMatchInput): Promise<SettleMatchResult> {
  assertPieceCount(input.whiteRemainingPieces);
  assertPieceCount(input.blackRemainingPieces);

  // Paramètres lus AVANT la transaction (cache) pour ne pas l'allonger.
  const [rules, rating] = await Promise.all([loadPointsRules(), loadRatingSettings()]);

  try {
    return await withSerializableRetry(() => settleInTransaction(input, rules, rating));
  } catch (error) {
    // La contrainte d'unicité du grand livre / du résultat a bloqué un double règlement.
    if (isUniqueViolation(error)) {
      throw new MatchSettlementError("La partie a déjà été réglée.", "ALREADY_SETTLED");
    }
    throw error;
  }
}

function settleInTransaction(
  input: SettleMatchInput,
  rules: Awaited<ReturnType<typeof loadPointsRules>>,
  rating: Awaited<ReturnType<typeof loadRatingSettings>>,
): Promise<SettleMatchResult> {
  return prisma.$transaction(
    async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: input.matchId },
        include: {
          playerWhite: { select: { id: true, pointsFree: true, elo: true } },
          playerBlack: { select: { id: true, pointsFree: true, elo: true } },
          gameBet: true,
          resultRecord: { select: { id: true } },
        },
      });
      if (!match) throw new MatchSettlementError("Partie introuvable.", "MATCH_NOT_FOUND");
      if (match.resultRecord) {
        throw new MatchSettlementError("La partie a déjà été réglée.", "ALREADY_SETTLED");
      }
      if (match.status !== MatchStatus.IN_PROGRESS || !match.playerBlackId || !match.playerBlack) {
        throw new MatchSettlementError(
          "Cette partie n’est pas en cours ou n’a pas deux joueurs valides.",
          "MATCH_NOT_SETTLEABLE",
        );
      }
      if (
        input.winnerId !== null &&
        input.winnerId !== match.playerWhiteId &&
        input.winnerId !== match.playerBlackId
      ) {
        throw new MatchSettlementError("Vainqueur invalide.", "INVALID_RESULT");
      }

      const whiteId = match.playerWhiteId;
      const blackId = match.playerBlackId;
      const whiteWon = input.winnerId === whiteId;
      const blackWon = input.winnerId === blackId;
      const isDraw = !whiteWon && !blackWon;
      // Compatibilité : une partie marquée `rated` par l'ancien code est classée.
      const mode =
        match.mode === MatchMode.CASUAL && match.rated ? MatchMode.RATED : match.mode;

      // ── 1. Points classiques ──────────────────────────────────────────
      const awardsClassic =
        rules["points.classic.enabled"] &&
        ((mode === MatchMode.CASUAL && rules["points.classic.casualAwards"]) ||
          (mode === MatchMode.RATED && rules["points.classic.ratedAwards"]));
      // Les parties rémunérées n'affectent jamais les points classiques.

      let scoreDelta = 0;
      let whitePointsChange = 0;
      let blackPointsChange = 0;
      if (awardsClassic) {
        const pointsConfig: PointsConfig = {
          bonusVictory: rules["points.classic.winBase"],
          maxPieceDifference: rules["points.classic.pieceBonusCap"],
          maxGain: rules["points.classic.winBase"] + rules["points.classic.pieceBonusCap"],
        };
        if (isDraw) {
          whitePointsChange = rules["points.classic.drawPoints"];
          blackPointsChange = rules["points.classic.drawPoints"];
        } else {
          scoreDelta = calculateScoreDelta(
            match.gameType,
            whiteWon ? input.whiteRemainingPieces : input.blackRemainingPieces,
            whiteWon ? input.blackRemainingPieces : input.whiteRemainingPieces,
            pointsConfig,
          );
          let gain = scoreDelta;
          const winnerId = whiteWon ? whiteId : blackId;
          const cap = rules["points.classic.dailyGainCap"];
          if (cap > 0) {
            const today = await gainedToday(tx, winnerId);
            gain = Math.max(0, Math.min(gain, cap - today));
          }
          let loss = Math.round((scoreDelta * rules["points.classic.lossPercent"]) / 100);
          const loserBalance = whiteWon ? match.playerBlack.pointsFree : match.playerWhite.pointsFree;
          if (rules["points.classic.floorAtZero"]) {
            loss = Math.max(0, Math.min(loss, Math.floor(loserBalance)));
          }
          whitePointsChange = whiteWon ? gain : -loss;
          blackPointsChange = blackWon ? gain : -loss;
        }
      }

      const pointsRows: Prisma.BalanceTransactionCreateManyInput[] = [];
      for (const [userId, change] of [
        [whiteId, whitePointsChange],
        [blackId, blackPointsChange],
      ] as const) {
        if (change === 0) continue;
        pointsRows.push({
          userId,
          balanceType: BalanceType.FREE_POINTS,
          transactionType:
            change > 0 ? BalanceTransactionType.GAME_POINTS_WON : BalanceTransactionType.GAME_POINTS_LOST,
          amount: new Prisma.Decimal(change),
          referenceId: input.matchId,
          description: "Variation des points classiques",
        });
      }
      if (pointsRows.length) await tx.balanceTransaction.createMany({ data: pointsRows });

      // ── 2. Défi amical en points classiques (hors mode rémunéré) ──────
      let betSettled = false;
      let betAmount: number | null = null;
      if (mode !== MatchMode.MONEY && match.betEnabled && match.gameBet?.status === "ACCEPTED") {
        const bet = match.gameBet;
        betAmount = bet.amount;
        const credits: [string, number, "BET_REFUNDED" | "BET_WON"][] = isDraw
          ? [
              [whiteId, bet.amount, "BET_REFUNDED"],
              [blackId, bet.amount, "BET_REFUNDED"],
            ]
          : [[whiteWon ? whiteId : blackId, bet.amount * 2, "BET_WON"]];
        for (const [userId, amount, type] of credits) {
          await tx.balanceTransaction.create({
            data: {
              userId,
              balanceType: BalanceType.FREE_POINTS,
              transactionType: BalanceTransactionType[type],
              amount: new Prisma.Decimal(amount),
              referenceId: bet.id,
              description:
                type === "BET_WON"
                  ? `Pot gagné sur la partie ${input.matchId}`
                  : `Remboursement du défi de la partie ${input.matchId}`,
            },
          });
          await tx.gameBetTransaction.create({ data: { betId: bet.id, userId, amount, type } });
        }
        // Crédit des pots en un seul update par joueur.
        const potByUser = new Map<string, number>();
        for (const [userId, amount] of credits) potByUser.set(userId, (potByUser.get(userId) ?? 0) + amount);
        for (const [userId, amount] of potByUser) {
          await tx.user.update({ where: { id: userId }, data: { pointsFree: { increment: amount } } });
        }
        await tx.gameBet.update({
          where: { id: bet.id },
          data: { status: isDraw ? "REFUNDED" : "SETTLED", settledAt: new Date() },
        });
        betSettled = true;
      }

      // ── 3. Points argent (mode MONEY) ─────────────────────────────────
      let whiteMoneyChange = 0;
      let blackMoneyChange = 0;
      let moneyCommission = 0;
      const stake = match.stakeAmount;
      if (mode === MatchMode.MONEY && stake && stake.gt(0)) {
        if (isDraw) {
          for (const userId of [whiteId, blackId].sort()) {
            await refundStake(tx, {
              userId,
              amount: stake,
              referenceId: input.matchId,
              description: `Mise rendue (nulle) — partie ${input.matchId}`,
            });
          }
        } else {
          const winnerId = whiteWon ? whiteId : blackId;
          const loserId = whiteWon ? blackId : whiteId;
          const { payout, commission } = await settleStakeWin(tx, {
            winnerId,
            loserId,
            stake,
            commissionPercent: rules["money.commissionPercent"],
            referenceId: input.matchId,
          });
          const winnerNet = payout.minus(stake).toNumber();
          moneyCommission = commission.toNumber();
          whiteMoneyChange = whiteWon ? winnerNet : -stake.toNumber();
          blackMoneyChange = blackWon ? winnerNet : -stake.toNumber();
        }
      }

      // ── 4. ALO/ELO par pool ───────────────────────────────────────────
      const isRated =
        mode === MatchMode.RATED || (mode === MatchMode.MONEY && rules["money.affectsRating"]);
      const variant = ratingVariantOf(match.gameType, match.draughtsVariant);
      const cadence = cadenceOf(match.timeControlMinutes, rating.cadences);
      let whiteEloChange = 0;
      let blackEloChange = 0;
      let whiteEloAfter = match.playerWhite.elo;
      let blackEloAfter = match.playerBlack.elo;

      if (isRated) {
        const pools = await tx.playerRating.findMany({
          where: { userId: { in: [whiteId, blackId] }, variant, timeControl: cadence },
        });
        const whitePool = pools.find((p) => p.userId === whiteId);
        const blackPool = pools.find((p) => p.userId === blackId);
        // Premier match dans ce pool : on part du classement global existant.
        const whiteBefore = whitePool?.eloRating ?? match.playerWhite.elo;
        const blackBefore = blackPool?.eloRating ?? match.playerBlack.elo;
        const scoreWhite = isDraw ? 0.5 : whiteWon ? 1 : 0;
        const { deltaWhite, deltaBlack } = computePoolElo(
          { rating: whiteBefore, gamesPlayed: whitePool?.gamesPlayed ?? 0 },
          { rating: blackBefore, gamesPlayed: blackPool?.gamesPlayed ?? 0 },
          scoreWhite,
          rating.config,
        );
        whiteEloChange = deltaWhite;
        blackEloChange = deltaBlack;
        whiteEloAfter = whiteBefore + deltaWhite;
        blackEloAfter = blackBefore + deltaBlack;

        for (const [userId, pool, before, after, change, won, lost, oppId, oppBefore] of [
          [whiteId, whitePool, whiteBefore, whiteEloAfter, deltaWhite, whiteWon, blackWon, blackId, blackBefore],
          [blackId, blackPool, blackBefore, blackEloAfter, deltaBlack, blackWon, whiteWon, whiteId, whiteBefore],
        ] as const) {
          if (pool) {
            await tx.playerRating.update({
              where: { id: pool.id },
              data: {
                eloRating: after,
                gamesPlayed: { increment: 1 },
                wins: { increment: won ? 1 : 0 },
                losses: { increment: lost ? 1 : 0 },
                draws: { increment: isDraw ? 1 : 0 },
                lastRatingUpdate: new Date(),
              },
            });
          } else {
            await tx.playerRating.create({
              data: {
                userId,
                variant,
                timeControl: cadence,
                eloRating: after,
                gamesPlayed: 1,
                wins: won ? 1 : 0,
                losses: lost ? 1 : 0,
                draws: isDraw ? 1 : 0,
              },
            });
          }
          await tx.ratingHistory.create({
            data: {
              userId,
              variant,
              timeControl: cadence,
              oldRating: before,
              newRating: after,
              change,
              reason: won ? "GAME_WIN" : isDraw ? "GAME_DRAW" : "GAME_LOSS",
              matchId: input.matchId,
              opponentId: oppId,
              opponentRatingBefore: oppBefore,
            },
          });
          // Classement global historique conservé pour compatibilité (tournois, profil).
          if (change !== 0) {
            await tx.user.update({ where: { id: userId }, data: { elo: { increment: change } } });
          }
        }
      }

      // ── 5. Clôture de la partie (verrou optimiste) ────────────────────
      const claimed = await tx.match.updateMany({
        where: { id: match.id, status: MatchStatus.IN_PROGRESS },
        data: {
          status: input.finalStatus ?? MatchStatus.FINISHED,
          winnerId: input.winnerId,
          result: input.result ?? (isDraw ? "DRAW" : whiteWon ? "WIN" : "LOSS"),
          whiteRemainingPieces: input.whiteRemainingPieces,
          blackRemainingPieces: input.blackRemainingPieces,
          scoreDelta,
          eloDeltaWhite: whiteEloChange,
          eloDeltaBlack: blackEloChange,
          stakeCommission: mode === MatchMode.MONEY ? new Prisma.Decimal(moneyCommission) : undefined,
          ratingPool: isRated ? poolKey(variant, cadence) : null,
          disconnectedPlayerId: null,
          disconnectedAt: null,
        },
      });
      if (claimed.count !== 1) {
        throw new MatchSettlementError(
          "La partie a déjà été réglée ou n’est plus en cours.",
          "MATCH_NOT_SETTLEABLE",
        );
      }

      // Application des variations de points classiques.
      for (const [userId, change] of [
        [whiteId, whitePointsChange],
        [blackId, blackPointsChange],
      ] as const) {
        if (change > 0) {
          await tx.user.update({ where: { id: userId }, data: { pointsFree: { increment: change } } });
        } else if (change < 0) {
          await tx.user.update({ where: { id: userId }, data: { pointsFree: { decrement: -change } } });
        }
      }

      await tx.matchResult.create({
        data: {
          matchId: input.matchId,
          whiteResult: isDraw ? "DRAW" : whiteWon ? "WIN" : "LOSS",
          blackResult: isDraw ? "DRAW" : blackWon ? "WIN" : "LOSS",
          whitePointsChange,
          blackPointsChange,
          whiteEloChange,
          blackEloChange,
          betSettled,
          settledAt: new Date(),
        },
      });

      const balances = await tx.user.findMany({
        where: { id: { in: [whiteId, blackId] } },
        select: { id: true, pointsFree: true },
      });
      const balanceOf = (id: string) => balances.find((b) => b.id === id)?.pointsFree ?? 0;

      return {
        scoreDelta,
        whitePointsChange,
        blackPointsChange,
        whiteBalance: balanceOf(whiteId),
        blackBalance: balanceOf(blackId),
        whiteEloBalance: whiteEloAfter,
        blackEloBalance: blackEloAfter,
        whiteEloChange,
        blackEloChange,
        betSettled,
        betAmount,
        whiteResult: isDraw ? "DRAW" : whiteWon ? "WIN" : "LOSS",
        blackResult: isDraw ? "DRAW" : blackWon ? "WIN" : "LOSS",
        mode,
        moneyStake: stake ? stake.toNumber() : null,
        whiteMoneyChange,
        blackMoneyChange,
        moneyCommission,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Annule une partie sans conséquence (abandon ou déconnexion avant que les
 * deux joueurs aient réellement joué) : aucun point, aucun ELO, mises rendues.
 */
export async function abortMatch(matchId: string): Promise<{ aborted: boolean }> {
  try {
    return await withSerializableRetry(() => abortInTransaction(matchId));
  } catch (error) {
    if (isUniqueViolation(error)) return { aborted: false };
    throw error;
  }
}

function abortInTransaction(matchId: string): Promise<{ aborted: boolean }> {
  return prisma.$transaction(
    async (tx) => {
      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { gameBet: true, resultRecord: { select: { id: true } } },
      });
      if (!match || match.resultRecord || match.status !== MatchStatus.IN_PROGRESS) {
        return { aborted: false };
      }
      const claimed = await tx.match.updateMany({
        where: { id: matchId, status: MatchStatus.IN_PROGRESS },
        data: {
          status: MatchStatus.ABORTED,
          winnerId: null,
          result: null,
          disconnectedPlayerId: null,
          disconnectedAt: null,
        },
      });
      if (claimed.count !== 1) return { aborted: false };

      const players = [match.playerWhiteId, match.playerBlackId].filter(
        (id): id is string => Boolean(id),
      );
      if (match.mode === MatchMode.MONEY && match.stakeAmount?.gt(0)) {
        for (const userId of [...players].sort()) {
          await refundStake(tx, {
            userId,
            amount: match.stakeAmount,
            referenceId: matchId,
            description: `Mise rendue (partie annulée) — ${matchId}`,
          });
        }
      }
      if (match.gameBet?.status === "ACCEPTED") {
        for (const userId of players) {
          await tx.user.update({
            where: { id: userId },
            data: { pointsFree: { increment: match.gameBet.amount } },
          });
          await tx.balanceTransaction.create({
            data: {
              userId,
              balanceType: BalanceType.FREE_POINTS,
              transactionType: BalanceTransactionType.BET_REFUNDED,
              amount: new Prisma.Decimal(match.gameBet.amount),
              referenceId: match.gameBet.id,
              description: `Défi remboursé (partie annulée) — ${matchId}`,
            },
          });
        }
        await tx.gameBet.update({
          where: { id: match.gameBet.id },
          data: { status: "REFUNDED", settledAt: new Date() },
        });
      }
      return { aborted: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** Conservée pour compatibilité avec d'anciens appels. */
export async function settleUnpaidMatch(
  input: Omit<SettleMatchInput, "result">,
): Promise<{ scoreDelta: number; whiteBalance: number; blackBalance: number }> {
  const result = await settleMatch({ ...input, result: undefined });
  return {
    scoreDelta: result.scoreDelta,
    whiteBalance: result.whiteBalance,
    blackBalance: result.blackBalance,
  };
}
