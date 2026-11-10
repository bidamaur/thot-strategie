export const MOCK_POINT_PACKS = {
  points_10: { points: 10, priceCfa: 1_000 },
  points_50: { points: 50, priceCfa: 5_000 },
} as const;

export type MockPointPackId = keyof typeof MOCK_POINT_PACKS;
