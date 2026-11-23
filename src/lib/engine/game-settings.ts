export type DraughtsVariant = "ENGLISH" | "INTERNATIONAL";

/**
 * Niveaux de l'IA d'entraînement : 1 (le plus facile) à 5 (« niveau super »).
 * Chaque niveau calcule plus loin que le précédent ; les niveaux 1 et 2 jouent
 * aussi volontairement des coups au hasard (taux décroissant).
 */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const AI_LEVELS: readonly Difficulty[] = [1, 2, 3, 4, 5];
export const DEFAULT_DIFFICULTY: Difficulty = 3;
/** Niveau « super » : réservé au Premium, avec un essai offert par jour. */
export const SUPER_LEVEL: Difficulty = 5;

export const DIFFICULTIES: {
  value: Difficulty;
  label: string;
  description: string;
}[] = [
  { value: 1, label: "Niveau 1 · Débutant", description: "Joue vite et laisse passer des erreurs" },
  { value: 2, label: "Niveau 2 · Amateur", description: "Voit les prises, se trompe parfois" },
  { value: 3, label: "Niveau 3 · Confirmé", description: "Calcule plusieurs coups, sans erreur volontaire" },
  { value: 4, label: "Niveau 4 · Expert", description: "Analyse approfondie" },
  { value: 5, label: "Niveau 5 · Maître", description: "Niveau super : recherche maximale" },
];

/** Paramètre d'adresse → niveau (accepte aussi les anciens libellés). */
export function parseDifficulty(value: unknown): Difficulty {
  const legacy: Record<string, Difficulty> = { simple: 1, moyen: 3, expert: 4, pro: 5 };
  if (typeof value === "string" && value in legacy) return legacy[value]!;
  const n = Number(value);
  return (AI_LEVELS as readonly number[]).includes(n) ? (n as Difficulty) : DEFAULT_DIFFICULTY;
}

export const DRAUGHTS_VARIANTS: {
  value: DraughtsVariant;
  label: string;
  boardSize: number;
}[] = [
  { value: "ENGLISH", label: "Dames anglaises · 8×8", boardSize: 8 },
  {
    value: "INTERNATIONAL",
    label: "Dames internationales · 10×10",
    boardSize: 10,
  },
];

/** Mode Entraînement : qui joue le premier coup de la partie. */
export type FirstPlayer = "ai" | "me";

export const DEFAULT_FIRST_PLAYER: FirstPlayer = "ai";

export const parseFirstPlayer = (value: unknown): FirstPlayer =>
  value === "me" ? "me" : DEFAULT_FIRST_PLAYER;

/**
 * Couleur du joueur selon qui commence. `startingColor` est le camp au trait dans
 * la position initiale du moteur (on ne suppose pas que les blancs commencent).
 */
export function humanColorFor<C extends "w" | "b">(firstPlayer: FirstPlayer, startingColor: C): "w" | "b" {
  const other = startingColor === "w" ? "b" : "w";
  return firstPlayer === "me" ? startingColor : other;
}
