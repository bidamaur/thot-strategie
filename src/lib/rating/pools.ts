import { calculateElo, type RatingConfig } from "./elo";

/**
 * Classements séparés par jeu/variante ET par cadence, comme sur les grandes
 * plateformes (un joueur blitz n'a pas le même niveau en partie lente).
 *
 * Stockage : `PlayerRating.variant` = CHESS | INTERNATIONAL | ENGLISH,
 *            `PlayerRating.timeControl` = BULLET | BLITZ | RAPID | CLASSICAL | UNLIMITED.
 */

export type RatingVariant = "CHESS" | "INTERNATIONAL" | "ENGLISH";
export type Cadence = "BULLET" | "BLITZ" | "RAPID" | "CLASSICAL" | "UNLIMITED";

export const CADENCE_LABELS: Record<Cadence, string> = {
  BULLET: "Bullet",
  BLITZ: "Blitz",
  RAPID: "Rapide",
  CLASSICAL: "Classique",
  UNLIMITED: "Sans pendule",
};

export const VARIANT_LABELS: Record<RatingVariant, string> = {
  CHESS: "Échecs",
  INTERNATIONAL: "Dames internationales",
  ENGLISH: "Dames anglaises",
};

export interface CadenceThresholds {
  bulletMax: number;
  blitzMax: number;
  rapidMax: number;
}

export const DEFAULT_CADENCE_THRESHOLDS: CadenceThresholds = {
  bulletMax: 2,
  blitzMax: 5,
  rapidMax: 15,
};

export function cadenceOf(
  minutes: number | null | undefined,
  thresholds: CadenceThresholds = DEFAULT_CADENCE_THRESHOLDS,
): Cadence {
  if (!minutes || minutes <= 0) return "UNLIMITED";
  if (minutes <= thresholds.bulletMax) return "BULLET";
  if (minutes <= thresholds.blitzMax) return "BLITZ";
  if (minutes <= thresholds.rapidMax) return "RAPID";
  return "CLASSICAL";
}

export function ratingVariantOf(
  gameType: "CHESS" | "CHECKERS",
  draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null | undefined,
): RatingVariant {
  if (gameType === "CHESS") return "CHESS";
  return draughtsVariant === "ENGLISH" ? "ENGLISH" : "INTERNATIONAL";
}

export function poolKey(variant: RatingVariant, cadence: Cadence): string {
  return `${variant}:${cadence}`;
}

export interface PoolPlayer {
  rating: number;
  gamesPlayed: number;
}

export interface PoolRatingConfig extends RatingConfig {
  provisionalGames: number;
  kProvisional: number;
  floor: number;
}

export function isProvisional(gamesPlayed: number, provisionalGames: number): boolean {
  return gamesPlayed < provisionalGames;
}

/**
 * Calcule les variations ELO de deux joueurs d'un même pool.
 * Un joueur provisoire utilise un K plus élevé pour converger rapidement ;
 * son adversaire confirmé est protégé (K divisé par deux face à un provisoire),
 * pratique classique pour limiter la volatilité induite par les nouveaux comptes.
 */
export function computePoolElo(
  white: PoolPlayer,
  black: PoolPlayer,
  scoreWhite: 0 | 0.5 | 1,
  config: PoolRatingConfig,
): { deltaWhite: number; deltaBlack: number } {
  const whiteProv = isProvisional(white.gamesPlayed, config.provisionalGames);
  const blackProv = isProvisional(black.gamesPlayed, config.provisionalGames);

  const base = calculateElo(white.rating, black.rating, scoreWhite, config);
  const scale = (delta: number, rating: number, selfProv: boolean, oppProv: boolean) => {
    const k = selfProv
      ? config.kProvisional
      : kFor(rating, config) / (oppProv ? 2 : 1);
    const kBase = kFor(rating, config);
    return kBase === 0 ? 0 : Math.round((delta * k) / kBase);
  };

  let deltaWhite = scale(base.deltaA, white.rating, whiteProv, blackProv);
  let deltaBlack = scale(base.deltaB, black.rating, blackProv, whiteProv);

  // Plancher de classement.
  if (white.rating + deltaWhite < config.floor) deltaWhite = config.floor - white.rating;
  if (black.rating + deltaBlack < config.floor) deltaBlack = config.floor - black.rating;
  return { deltaWhite, deltaBlack };
}

function kFor(rating: number, config: RatingConfig): number {
  if (rating < config.ratingBands.beginner) return config.kBeginner;
  if (rating < config.ratingBands.amateur) return config.kAmateur;
  if (rating < config.ratingBands.confirmed) return config.kConfirmed;
  if (rating < config.ratingBands.expert) return config.kExpert;
  return config.kProfessional;
}

export function levelFor(
  rating: number,
  levels: { label: string; minRating: number }[],
): string {
  let label = levels[0]?.label ?? "";
  for (const level of levels) if (rating >= level.minRating) label = level.label;
  return label;
}
