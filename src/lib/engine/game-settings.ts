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
