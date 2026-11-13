import type { GameType } from "@/generated/prisma-client";

export interface PointsConfig {
  bonusVictory: number;
  maxPieceDifference: number;
  maxGain: number;
}

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  bonusVictory: 3,
  maxPieceDifference: 10,
  maxGain: 13,
};

export function calculateScoreDelta(
  gameType: GameType,
  winnerScore: number,
  loserScore: number,
  config: PointsConfig = DEFAULT_POINTS_CONFIG,
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

  const pieceDifference = Math.abs(winnerScore - loserScore);
  const cappedDifference = Math.min(pieceDifference, config.maxPieceDifference);
  return config.bonusVictory + cappedDifference;
}

export function calculateChessPoints(
  result: "win" | "draw" | "loss",
  config: Partial<PointsConfig> = {},
): number {
  const merged = { ...DEFAULT_POINTS_CONFIG, ...config };
  if (result === "draw") return 0;
  if (result === "loss") return 0;
  return merged.bonusVictory;
}

export const MIN_PAID_MATCH_WALLET_CFA = 1_000;
export const CFA_PER_POINT = 100;
export const PAID_MATCHES_ENABLED = false;
