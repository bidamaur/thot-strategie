import { describe, expect, it } from "vitest";
import {
  applyDraughtsMove,
  createDraughtsPosition,
  getLegalDraughtsMoves,
  type DraughtsMove,
} from "./draughts";
import {
  canOfferDrawAt,
  draughtsQuietState,
  gameProgressPercent,
  isNoProgressDraw,
  type DrawRules,
} from "./draw-rules";

const rules: DrawRules = { noProgressPlies: 20, noProgressRequiresKing: true, drawOfferMinProgressPercent: 70 };

/** Partie déterministe : on joue toujours le dernier coup légal, jusqu'à N demi-coups. */
function playLine(variant: "ENGLISH" | "INTERNATIONAL", plies: number) {
  let position = createDraughtsPosition(variant);
  const moves: DraughtsMove[] = [];
  const events: { capture: boolean; promotion: boolean }[] = [];
  for (let i = 0; i < plies; i += 1) {
    const legal = getLegalDraughtsMoves(position);
    if (legal.length === 0) break;
    const move = legal[(i * 7) % legal.length]!;
    const piece = position.board[move.from.row]![move.from.col]!;
    const next = applyDraughtsMove(position, move);
    const to = move.path[move.path.length - 1]!;
    events.push({ capture: move.captures.length > 0, promotion: !piece.king && !!next.board[to.row]![to.col]!.king });
    moves.push(move);
    position = next;
  }
  return { moves, events };
}

describe("draughtsQuietState", () => {
  it("compte les demi-coups depuis la dernière prise ou promotion", () => {
    for (const variant of ["ENGLISH", "INTERNATIONAL"] as const) {
      const { moves, events } = playLine(variant, 160);
      let expected = 0;
      for (let i = 0; i < moves.length; i += 1) {
        expected = events[i]!.capture || events[i]!.promotion ? 0 : expected + 1;
        expect(draughtsQuietState(variant, moves.slice(0, i + 1)).quietPlies).toBe(expected);
      }
    }
  });

  it("un départ calme sans dame ne déclenche pas le nul quand la fin de partie est exigée", () => {
    const state = { quietPlies: 25, hasKing: false };
    expect(isNoProgressDraw(state, rules)).toBe(false);
    expect(isNoProgressDraw(state, { ...rules, noProgressRequiresKing: false })).toBe(true);
  });

  it("nul à 20 demi-coups (10 par joueur) avec une dame sur le plateau", () => {
    expect(isNoProgressDraw({ quietPlies: 19, hasKing: true }, rules)).toBe(false);
    expect(isNoProgressDraw({ quietPlies: 20, hasKing: true }, rules)).toBe(true);
    expect(isNoProgressDraw({ quietPlies: 99, hasKing: true }, { ...rules, noProgressPlies: 0 })).toBe(false);
  });
});

describe("proposition de nul à 7/10 de la partie", () => {
  it("mesure l'avancement par les pièces prises", () => {
    expect(gameProgressPercent("CHECKERS", "INTERNATIONAL", 40)).toBe(0);
    expect(gameProgressPercent("CHECKERS", "INTERNATIONAL", 12)).toBe(70);
    expect(gameProgressPercent("CHECKERS", "INTERNATIONAL", 13)).toBe(67);
    expect(gameProgressPercent("CHECKERS", "ENGLISH", 7)).toBe(70);
    expect(gameProgressPercent("CHESS", null, 9)).toBe(71);
    expect(canOfferDrawAt(70, rules)).toBe(true);
    expect(canOfferDrawAt(69, rules)).toBe(false);
  });
});
