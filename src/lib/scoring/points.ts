import type { GameType } from "@/generated/prisma-client";

export function calculateScoreDelta(
  gameType: GameType,
  winnerScore: number,
  loserScore: number,
): number {
  if (
    (gameType !== "CHESS" && gameType !== "CHECKERS") ||
    !Number.isInteger(winnerScore) ||
    !Number.isInteger(loserScore) ||
    winnerScore < 0 ||
    loserScore < 0
  ) {
    throw new Error("Scores de pièces invalides.");
  }

  const pieceDifference = winnerScore - loserScore;
  if (pieceDifference <= 0) return 1;
  if (pieceDifference >= 4) return 5;
  return pieceDifference;
}

export const MIN_PAID_MATCH_WALLET_CFA = 1_000;
export const CFA_PER_POINT = 100;
export const PAID_MATCHES_ENABLED = false;
