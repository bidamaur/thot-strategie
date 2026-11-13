export interface RatingConfig {
  initialRating: number;
  kBeginner: number;
  kAmateur: number;
  kConfirmed: number;
  kExpert: number;
  kProfessional: number;
  ratingBands: {
    beginner: number;   // < 1200
    amateur: number;    // 1200 - 1399
    confirmed: number;  // 1400 - 1599
    expert: number;     // 1600 - 1799
    professional: number; // >= 1800
  };
}

export const DEFAULT_RATING_CONFIG: RatingConfig = {
  initialRating: 1200,
  kBeginner: 40,
  kAmateur: 32,
  kConfirmed: 24,
  kExpert: 20,
  kProfessional: 16,
  ratingBands: {
    beginner: 1200,
    amateur: 1400,
    confirmed: 1600,
    expert: 1800,
    professional: 2200,
  },
};

export function getKFactor(rating: number, config: RatingConfig): number {
  if (rating < config.ratingBands.beginner) return config.kBeginner;
  if (rating < config.ratingBands.amateur) return config.kAmateur;
  if (rating < config.ratingBands.confirmed) return config.kConfirmed;
  if (rating < config.ratingBands.expert) return config.kExpert;
  return config.kProfessional;
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface EloResult {
  newRatingA: number;
  newRatingB: number;
  deltaA: number;
  deltaB: number;
  expectedA: number;
  expectedB: number;
}

export function calculateElo(
  ratingA: number,
  ratingB: number,
  scoreA: number, // 1 = win, 0.5 = draw, 0 = loss
  config: RatingConfig = DEFAULT_RATING_CONFIG,
): EloResult {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;
  const scoreB = 1 - scoreA;

  const kA = getKFactor(ratingA, config);
  const kB = getKFactor(ratingB, config);

  const deltaA = Math.round(kA * (scoreA - expectedA));
  const deltaB = Math.round(kB * (scoreB - expectedB));

  return {
    newRatingA: ratingA + deltaA,
    newRatingB: ratingB + deltaB,
    deltaA,
    deltaB,
    expectedA,
    expectedB,
  };
}

export interface LevelInfo {
  label: string;
  minPoints: number;
  maxPoints: number | null;
}

export const DEFAULT_LEVELS: LevelInfo[] = [
  { label: "Débutant", minPoints: 0, maxPoints: 999 },
  { label: "Amateur", minPoints: 1000, maxPoints: 1199 },
  { label: "Confirmé", minPoints: 1200, maxPoints: 1399 },
  { label: "Expert", minPoints: 1400, maxPoints: 1599 },
  { label: "Maître", minPoints: 1600, maxPoints: 1799 },
  { label: "Grand Maître", minPoints: 1800, maxPoints: 1999 },
  { label: "Grand Maître Élite", minPoints: 2000, maxPoints: 2199 },
  { label: "Légende", minPoints: 2200, maxPoints: null },
];

export function getLevel(points: number, levels: LevelInfo[] = DEFAULT_LEVELS): LevelInfo | null {
  return (
    levels.find(
      (level) => points >= level.minPoints && (level.maxPoints === null || points <= level.maxPoints),
    ) ?? null
  );
}
