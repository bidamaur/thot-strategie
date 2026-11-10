import {
  MatchStatus,
  Prisma,
} from "@/generated/prisma-client";
import { prisma } from "@/lib/prisma";
import {
  calculateScoreDelta,
  CFA_PER_POINT,
  MIN_PAID_MATCH_WALLET_CFA,
  PAID_MATCHES_ENABLED,
} from "./points";

export interface SettleUnpaidMatchInput {
  matchId: string;
  winnerId: string | null;
  whiteRemainingPieces: number;
  blackRemainingPieces: number;
  finalStatus?: "FINISHED" | "ABANDONED";
}

export class MatchSettlementError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_RESULT"
      | "MATCH_NOT_FOUND"
      | "MATCH_NOT_SETTLEABLE"
      | "PAID_MATCH_DISABLED"
      | "INSUFFICIENT_WALLET",
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

export async function assertPaidMatchEligible(
  playerIds: readonly [string, string],
): Promise<void> {
  if (!PAID_MATCHES_ENABLED) {
    throw new MatchSettlementError(
      "Les matchs rémunérés sont désactivés tant que les parties ne sont pas validées côté serveur.",
      "PAID_MATCH_DISABLED",
    );
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(playerIds)] } },
    select: { id: true, walletReal: true },
  });
  if (users.length !== 2) {
    throw new MatchSettlementError("Un profil joueur est introuvable.", "INVALID_RESULT");
  }
  if (users.some((user) => user.walletReal.lessThan(MIN_PAID_MATCH_WALLET_CFA))) {
    throw new MatchSettlementError(
      `Chaque joueur doit disposer d’au moins ${MIN_PAID_MATCH_WALLET_CFA} FCFA.`,
      "INSUFFICIENT_WALLET",
    );
  }
}

export async function settleUnpaidMatch(
  input: SettleUnpaidMatchInput,
): Promise<{ scoreDelta: number; whiteBalance: number; blackBalance: number }> {
  assertPieceCount(input.whiteRemainingPieces);
  assertPieceCount(input.blackRemainingPieces);

  return prisma.$transaction(async (transaction) => {
    const match = await transaction.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        gameType: true,
        isPaid: true,
        status: true,
        playerWhiteId: true,
        playerBlackId: true,
      },
    });
    if (!match) {
      throw new MatchSettlementError("Partie introuvable.", "MATCH_NOT_FOUND");
    }
    if (match.isPaid) {
      throw new MatchSettlementError(
        "Le règlement des parties rémunérées est désactivé.",
        "PAID_MATCH_DISABLED",
      );
    }
    if (
      match.status !== MatchStatus.IN_PROGRESS ||
      !match.playerBlackId ||
      match.playerWhiteId === match.playerBlackId
    ) {
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
      throw new MatchSettlementError(
        "Le vainqueur ne participe pas à cette partie.",
        "INVALID_RESULT",
      );
    }

    const whiteWon = input.winnerId === match.playerWhiteId;
    const blackWon = input.winnerId === match.playerBlackId;
    const scoreDelta = input.winnerId
      ? calculateScoreDelta(
          match.gameType,
          whiteWon ? input.whiteRemainingPieces : input.blackRemainingPieces,
          whiteWon ? input.blackRemainingPieces : input.whiteRemainingPieces,
        )
      : 0;

    const claimed = await transaction.match.updateMany({
      where: {
        id: match.id,
        status: MatchStatus.IN_PROGRESS,
        isPaid: false,
        playerBlackId: { not: null },
      },
      data: {
        status: input.finalStatus ?? MatchStatus.FINISHED,
        winnerId: input.winnerId,
        whiteRemainingPieces: input.whiteRemainingPieces,
        blackRemainingPieces: input.blackRemainingPieces,
        scoreDelta,
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

    const whiteUpdate =
      whiteWon && scoreDelta > 0
        ? transaction.user.update({
            where: { id: match.playerWhiteId },
            data: { pointsFree: { increment: scoreDelta } },
            select: { pointsFree: true },
          })
        : blackWon && scoreDelta > 0
          ? transaction.user.update({
              where: { id: match.playerWhiteId },
              data: { pointsFree: { decrement: scoreDelta } },
              select: { pointsFree: true },
            })
          : transaction.user.findUniqueOrThrow({
              where: { id: match.playerWhiteId },
              select: { pointsFree: true },
            });
    const blackUpdate =
      blackWon && scoreDelta > 0
        ? transaction.user.update({
            where: { id: match.playerBlackId },
            data: { pointsFree: { increment: scoreDelta } },
            select: { pointsFree: true },
          })
        : whiteWon && scoreDelta > 0
          ? transaction.user.update({
              where: { id: match.playerBlackId },
              data: { pointsFree: { decrement: scoreDelta } },
              select: { pointsFree: true },
            })
          : transaction.user.findUniqueOrThrow({
              where: { id: match.playerBlackId },
              select: { pointsFree: true },
            });
    const [white, black] = await Promise.all([whiteUpdate, blackUpdate]);

    return {
      scoreDelta,
      whiteBalance: white.pointsFree,
      blackBalance: black.pointsFree,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export function pointsToCfa(points: number): Prisma.Decimal {
  if (!Number.isInteger(points) || points < 0) {
    throw new Error("Le nombre de points doit être positif ou nul.");
  }
  return new Prisma.Decimal(points).mul(CFA_PER_POINT);
}
