import { applyDraughtsMove, createDraughtsPosition, type DraughtsMove, type DraughtsPosition } from "./draughts";
import type { DraughtsVariant } from "./game-settings";

/**
 * Règles de nullité alignées sur les conventions officielles et les grandes plateformes.
 *
 * Dames internationales (règlement FMJD, appliqué par Lidraughts) :
 *  - même position répétée 3 fois avec le même joueur au trait ;
 *  - 25 coups de chaque joueur avec uniquement des dames, sans prise ni mouvement de pion ;
 *  - finales 3 dames, 2 dames + 1 pion ou 1 dame + 2 pions contre 1 dame : nul après 16 coups chacun ;
 *  - finales 2 dames, 1 dame + 1 pion ou 1 dame contre 1 dame : nul après 5 coups chacun.
 * Dames anglaises : répétition 3 fois, et 40 coups chacun sans prise ni mouvement de pion.
 * Échecs : pat, matériel insuffisant, triple répétition, 50 coups (moteur chess.js) ;
 *          temps écoulé alors que l'adversaire ne peut pas mater = nul (Lichess, Chess.com).
 * Proposition de nul : possible à tout moment après le début réel de la partie, l'offre reste
 * valable jusqu'à la réponse ou au coup suivant de l'adversaire ; délai anti-harcèlement après un refus.
 *
 * Le serveur décide, à partir de l'historique validé ; le client n'affiche que des compteurs.
 */

export type AutoDrawRule = "REPETITION" | "KING_MOVES" | "ENDGAME_16" | "ENDGAME_5" | "TIMEOUT_INSUFFICIENT";

export interface DrawRules {
  /** Nul automatique à la 3e occurrence d'une position (dames). */
  repetition: boolean;
  /** Dames internationales : coups par joueur avec uniquement des dames (0 = désactivé). */
  kingMovesInternational: number;
  /** Dames anglaises : coups par joueur sans prise ni mouvement de pion (0 = désactivé). */
  kingMovesEnglish: number;
  /** Dames internationales : règles de finale des 16 et 5 coups. */
  endgameRules: boolean;
  /** Demi-coups minimum avant de pouvoir proposer le nul (avant : on annule la partie). */
  drawOfferMinPlies: number;
  /** Avancement minimal (% de pièces prises) pour proposer le nul (0 = pas de restriction). */
  drawOfferMinProgressPercent: number;
  /** Après un refus, demi-coups à attendre avant de reproposer. */
  drawOfferCooldownPlies: number;
}

export const DEFAULT_DRAW_RULES: DrawRules = {
  repetition: true,
  kingMovesInternational: 25,
  kingMovesEnglish: 40,
  endgameRules: true,
  drawOfferMinPlies: 2,
  drawOfferMinProgressPercent: 0,
  drawOfferCooldownPlies: 10,
};

// ── Proposition de nul ────────────────────────────────────────────────

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

export type DrawOfferBlock =
  | { kind: "TOO_EARLY"; minPlies: number }
  | { kind: "PROGRESS"; minPercent: number; progress: number }
  | { kind: "COOLDOWN"; remainingPlies: number }
  | null;

/** Pourquoi ce joueur ne peut pas (encore) proposer le nul ; null s'il le peut. */
export function drawOfferBlock(input: {
  plies: number;
  progressPercent: number;
  playerId: string;
  lastDecline: { byPlayerId: string; atPly: number } | null;
  rules: DrawRules;
}): DrawOfferBlock {
  const { plies, progressPercent, playerId, lastDecline, rules } = input;
  if (plies < rules.drawOfferMinPlies) return { kind: "TOO_EARLY", minPlies: rules.drawOfferMinPlies };
  if (progressPercent < rules.drawOfferMinProgressPercent) {
    return { kind: "PROGRESS", minPercent: rules.drawOfferMinProgressPercent, progress: progressPercent };
  }
  if (lastDecline && lastDecline.byPlayerId === playerId) {
    const waited = plies - lastDecline.atPly;
    if (waited < rules.drawOfferCooldownPlies) {
      return { kind: "COOLDOWN", remainingPlies: rules.drawOfferCooldownPlies - waited };
    }
  }
  return null;
}

// ── Dames : nul automatique ──────────────────────────────────────────

export interface DraughtsDrawState {
  /** Demi-coups consécutifs joués avec une dame, sans prise (aucun pion déplacé). */
  kingOnlyPlies: number;
  /** Nombre d'occurrences de la position actuelle (même joueur au trait). */
  repetitions: number;
  /** Finale réglementée en cours (dames internationales) et demi-coups depuis son apparition. */
  endgame: { rule: "ENDGAME_16" | "ENDGAME_5"; plies: number } | null;
}

const positionKey = (position: DraughtsPosition) =>
  position.board
    .map((row) => row.map((p) => (p ? `${p.color}${p.king ? "K" : "M"}` : "..")).join(""))
    .join("/") + position.turn;

function material(position: DraughtsPosition) {
  const count = { w: { kings: 0, men: 0 }, b: { kings: 0, men: 0 } };
  for (const row of position.board) {
    for (const p of row) if (p) count[p.color][p.king ? "kings" : "men"] += 1;
  }
  return count;
}

/** Classe la finale selon le règlement FMJD (article 6). */
export function endgameRuleFor(position: DraughtsPosition): "ENDGAME_16" | "ENDGAME_5" | null {
  const m = material(position);
  const lone = (side: { kings: number; men: number }) => side.kings === 1 && side.men === 0;
  let strong: { kings: number; men: number };
  if (lone(m.b)) strong = m.w;
  else if (lone(m.w)) strong = m.b;
  else return null;
  const total = strong.kings + strong.men;
  if (strong.kings < 1) return null;
  if (total === 3) return "ENDGAME_16"; // 3 D, 2 D + 1 P, 1 D + 2 P contre 1 D
  if (total <= 2) return "ENDGAME_5"; // 2 D, 1 D + 1 P, 1 D contre 1 D
  return null;
}

/** Rejoue l'historique (déjà validé par le serveur) et calcule les compteurs de nullité. */
export function draughtsDrawState(
  variant: DraughtsVariant,
  moves: readonly DraughtsMove[],
  start: DraughtsPosition = createDraughtsPosition(variant),
): DraughtsDrawState {
  let position = start;
  const seen = new Map<string, number>([[positionKey(position), 1]]);
  let kingOnlyPlies = 0;
  let endgamePlies = 0;
  let signature = JSON.stringify(material(position));

  for (const move of moves) {
    const piece = position.board[move.from.row]?.[move.from.col];
    const next = applyDraughtsMove(position, move);
    const irreversible = move.captures.length > 0 || !piece?.king;
    kingOnlyPlies = irreversible ? 0 : kingOnlyPlies + 1;

    const nextSignature = JSON.stringify(material(next));
    endgamePlies = nextSignature === signature ? endgamePlies + 1 : 0;
    signature = nextSignature;

    // Une prise ou un pion avancé rend toute position antérieure impossible à retrouver.
    if (irreversible) seen.clear();
    const key = positionKey(next);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    position = next;
  }

  const rule = variant === "ENGLISH" ? null : endgameRuleFor(position);
  return {
    kingOnlyPlies,
    repetitions: seen.get(positionKey(position)) ?? 1,
    endgame: rule ? { rule, plies: endgamePlies } : null,
  };
}

const endgameLimitPlies = (rule: "ENDGAME_16" | "ENDGAME_5") => (rule === "ENDGAME_16" ? 32 : 10);
const kingMovesLimit = (variant: DraughtsVariant, rules: DrawRules) =>
  variant === "ENGLISH" ? rules.kingMovesEnglish : rules.kingMovesInternational;

/** Règle de nul atteinte, ou null si la partie continue. */
export function draughtsDrawVerdict(
  variant: DraughtsVariant,
  state: DraughtsDrawState,
  rules: DrawRules,
): Exclude<AutoDrawRule, "TIMEOUT_INSUFFICIENT"> | null {
  if (rules.repetition && state.repetitions >= 3) return "REPETITION";
  if (variant !== "ENGLISH" && rules.endgameRules && state.endgame) {
    if (state.endgame.plies >= endgameLimitPlies(state.endgame.rule)) return state.endgame.rule;
  }
  const limit = kingMovesLimit(variant, rules);
  if (limit > 0 && state.kingOnlyPlies >= limit * 2) return "KING_MOVES";
  return null;
}

export interface DrawCounter {
  rule: AutoDrawRule;
  label: string;
  /** En coups par joueur (ou en occurrences pour la répétition). */
  current: number;
  limit: number;
}

/** Compteurs à afficher pendant la partie (seulement ceux qui ont commencé). */
export function draughtsDrawCounters(
  variant: DraughtsVariant,
  state: DraughtsDrawState,
  rules: DrawRules,
): DrawCounter[] {
  const counters: DrawCounter[] = [];
  if (variant !== "ENGLISH" && rules.endgameRules && state.endgame) {
    const limit = endgameLimitPlies(state.endgame.rule) / 2;
    counters.push({
      rule: state.endgame.rule,
      label: `Finale réglementée (nul après ${limit} coups chacun)`,
      current: Math.floor(state.endgame.plies / 2),
      limit,
    });
  }
  const limit = kingMovesLimit(variant, rules);
  if (limit > 0 && state.kingOnlyPlies > 0) {
    counters.push({
      rule: "KING_MOVES",
      label: variant === "ENGLISH" ? "Coups sans prise ni pion avancé" : "Coups de dames sans prise ni pion joué",
      current: Math.floor(state.kingOnlyPlies / 2),
      limit,
    });
  }
  if (rules.repetition && state.repetitions >= 2) {
    counters.push({ rule: "REPETITION", label: "Position répétée", current: state.repetitions, limit: 3 });
  }
  return counters;
}

export function autoDrawMessage(rule: AutoDrawRule, rules: DrawRules, variant: DraughtsVariant | null): string {
  switch (rule) {
    case "REPETITION":
      return "Match nul : la même position s’est répétée trois fois.";
    case "KING_MOVES":
      return variant === "ENGLISH"
        ? `Match nul : ${rules.kingMovesEnglish} coups chacun sans prise ni pion avancé.`
        : `Match nul : ${rules.kingMovesInternational} coups chacun avec uniquement des dames, sans prise.`;
    case "ENDGAME_16":
      return "Match nul : finale contre une dame seule non gagnée en 16 coups.";
    case "ENDGAME_5":
      return "Match nul : finale contre une dame seule non gagnée en 5 coups.";
    case "TIMEOUT_INSUFFICIENT":
      return "Match nul : temps écoulé, mais l’adversaire n’avait plus de quoi mater.";
  }
}

// ── Échecs : temps écoulé contre matériel insuffisant ────────────────

/** Le camp peut-il encore mater ? Roi seul, roi + fou ou roi + cavalier : non. */
export function chessSideCanMate(pieceTypes: readonly string[]): boolean {
  const others = pieceTypes.filter((t) => t !== "k");
  if (others.length === 0) return false;
  if (others.length === 1 && (others[0] === "b" || others[0] === "n")) return false;
  return true;
}
