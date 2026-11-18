/**
 * Préférences d'affichage du plateau, propres à chaque joueur.
 * Module pur (client et serveur) : valeurs par défaut, liste fermée, validation.
 * Purement visuel : aucune incidence sur les règles ni sur les résultats.
 */

export const BOARD_THEMES = [
  { id: "wood", label: "Bois", light: "#ecd3a8", dark: "#b07a45", frame: "#5b3a1f" },
  { id: "walnut", label: "Noyer", light: "#d8b48c", dark: "#7c5133", frame: "#3a2416" },
  { id: "green", label: "Vert tournoi", light: "#e2e4d2", dark: "#7b927f", frame: "#26332d" },
  { id: "blue", label: "Bleu", light: "#dfe5e8", dark: "#7f9aab", frame: "#2c3b45" },
  { id: "marble", label: "Marbre", light: "#ece9e2", dark: "#a29d93", frame: "#4a4640" },
  { id: "night", label: "Nuit", light: "#9e9888", dark: "#4f4a3f", frame: "#1c1a16" },
] as const;

export type BoardTheme = (typeof BOARD_THEMES)[number]["id"];

export const PIECE_ANIMATIONS = [
  { id: "slide", label: "Glisser", description: "La pièce glisse de sa case à sa destination." },
  { id: "lift", label: "Porter-déposer", description: "La pièce se soulève, se déplace et se pose." },
  { id: "none", label: "Aucune", description: "La pièce apparaît directement à sa place." },
] as const;
export type PieceAnimation = (typeof PIECE_ANIMATIONS)[number]["id"];

export const ANIMATION_SPEEDS = [
  { id: "fast", label: "Rapide", ms: 140 },
  { id: "normal", label: "Normale", ms: 220 },
  { id: "slow", label: "Lente", ms: 360 },
] as const;
export type AnimationSpeed = (typeof ANIMATION_SPEEDS)[number]["id"];

export const INPUT_MODES = [
  { id: "both", label: "Glisser ou toucher", description: "Faites glisser la pièce, ou touchez-la puis touchez la case d’arrivée." },
  { id: "tap", label: "Toucher seulement", description: "Touchez la pièce puis la case d’arrivée : aucun glisser accidentel." },
  { id: "drag", label: "Glisser seulement", description: "Faites glisser la pièce jusqu’à sa case." },
] as const;
export type InputMode = (typeof INPUT_MODES)[number]["id"];

export interface BoardPrefs {
  theme: BoardTheme;
  animation: PieceAnimation;
  speed: AnimationSpeed;
  input: InputMode;
  coordinates: boolean;
  legalMoves: boolean;
  lastMove: boolean;
}

export const DEFAULT_BOARD_PREFS: BoardPrefs = {
  theme: "wood",
  animation: "slide",
  speed: "normal",
  input: "both",
  coordinates: true,
  legalMoves: true,
  lastMove: true,
};

const pick = <T extends string>(value: unknown, allowed: readonly { id: T }[], fallback: T): T =>
  typeof value === "string" && allowed.some((a) => a.id === value) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** Toute valeur inconnue retombe sur la valeur par défaut (jamais d'erreur côté affichage). */
export function sanitizeBoardPrefs(input: unknown): BoardPrefs {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const d = DEFAULT_BOARD_PREFS;
  return {
    theme: pick(raw.theme, BOARD_THEMES, d.theme),
    animation: pick(raw.animation, PIECE_ANIMATIONS, d.animation),
    speed: pick(raw.speed, ANIMATION_SPEEDS, d.speed),
    input: pick(raw.input, INPUT_MODES, d.input),
    coordinates: bool(raw.coordinates, d.coordinates),
    legalMoves: bool(raw.legalMoves, d.legalMoves),
    lastMove: bool(raw.lastMove, d.lastMove),
  };
}

export function animationMs(prefs: BoardPrefs): number {
  if (prefs.animation === "none") return 0;
  return ANIMATION_SPEEDS.find((s) => s.id === prefs.speed)?.ms ?? 220;
}

export const BOARD_PREFS_STORAGE_KEY = "thot.boardPrefs";

/** Script exécuté avant l'affichage : applique le thème enregistré sans clignotement. */
export const BOARD_PREFS_BOOT_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${BOARD_PREFS_STORAGE_KEY}")||"{}");var d=document.documentElement;if(typeof p.theme==="string")d.dataset.boardTheme=p.theme;d.dataset.boardCoords=p.coordinates===false?"off":"on";}catch(e){}`;
