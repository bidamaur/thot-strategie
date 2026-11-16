import { applyDraughtsMove, createDraughtsPosition, type DraughtsMove } from "./draughts";
import type { DraughtsVariant } from "./game-settings";

/**
 * Règles de nullité partagées entre le serveur (qui décide) et la salle de jeu
 * (qui affiche les compteurs). Aucune donnée du client n'est prise pour argent
 * comptant : le serveur recalcule tout à partir de l'historique validé.
 */

export interface DrawRules {
  /** Demi-coups consécutifs sans prise ni promotion avant le nul automatique (0 = désactivé). */
  noProgressPlies: number;
  /** Le compteur ne s'applique qu'une fois qu'une dame est apparue sur le plateau. */
  noProgressRequiresKing: boolean;
  /** Avancement minimal (en %) pour pouvoir proposer le nul. */
  drawOfferMinProgressPercent: number;
}

export function initialPieceCount(
  gameType: "CHESS" | "CHECKERS",
  variant: DraughtsVariant | null | undefined,
): number {
  if (gameType === "CHESS") return 32;
  return variant === "ENGLISH" ? 24 : 40;
}

/** Avancement de la partie : part des pièces de départ qui ont été prises (0–100). */
export function gameProgressPercent(
  gameType: "CHESS" | "CHECKERS",
  variant: DraughtsVariant | null | undefined,
  remainingPieces: number,
): number {
  const initial = initialPieceCount(gameType, variant);
  const ratio = (initial - Math.min(initial, Math.max(0, remainingPieces))) / initial;
  return Math.floor(ratio * 100);
}

export function canOfferDrawAt(progressPercent: number, rules: Pick<DrawRules, "drawOfferMinProgressPercent">) {
  return progressPercent >= rules.drawOfferMinProgressPercent;
}

export interface DraughtsQuietState {
  /** Demi-coups consécutifs, à la fin de l'historique, sans prise ni pion promu. */
  quietPlies: number;
  /** Au moins une dame est présente sur le plateau. */
  hasKing: boolean;
}

/** Rejoue l'historique (déjà validé) et compte les demi-coups « sans progrès ». */
export function draughtsQuietState(
  variant: DraughtsVariant,
  moves: readonly DraughtsMove[],
): DraughtsQuietState {
  let position = createDraughtsPosition(variant);
  let quietPlies = 0;
  for (const move of moves) {
    const piece = position.board[move.from.row]?.[move.from.col];
    const next = applyDraughtsMove(position, move);
    const destination = move.path[move.path.length - 1]!;
    const promoted = !!piece && !piece.king && !!next.board[destination.row]?.[destination.col]?.king;
    quietPlies = move.captures.length > 0 || promoted ? 0 : quietPlies + 1;
    position = next;
  }
  const hasKing = position.board.some((row) => row.some((p) => p?.king));
  return { quietPlies, hasKing };
}

/** Le compteur est-il actif (affichage) ? */
export function noProgressCounterActive(state: DraughtsQuietState, rules: DrawRules): boolean {
  return rules.noProgressPlies > 0 && (!rules.noProgressRequiresKing || state.hasKing);
}

export function isNoProgressDraw(state: DraughtsQuietState, rules: DrawRules): boolean {
  return noProgressCounterActive(state, rules) && state.quietPlies >= rules.noProgressPlies;
}
