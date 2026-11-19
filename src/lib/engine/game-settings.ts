export type Difficulty = "simple" | "moyen" | "expert" | "pro";
export type DraughtsVariant = "ENGLISH" | "INTERNATIONAL";

export const DIFFICULTIES: {
  value: Difficulty;
  label: string;
  description: string;
}[] = [
  { value: "simple", label: "Simple", description: "Coups rapides" },
  { value: "moyen", label: "Moyen", description: "Jeu équilibré" },
  { value: "expert", label: "Expert", description: "Analyse approfondie" },
  { value: "pro", label: "Pro", description: "Recherche poussée" },
];

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
