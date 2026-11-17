import { describe, expect, it } from "vitest";
import {
  applyDraughtsMove,
  createDraughtsPosition,
  getLegalDraughtsMoves,
  type DraughtsMove,
  type DraughtsPosition,
} from "./draughts";
import {
  chessSideCanMate,
  DEFAULT_DRAW_RULES,
  draughtsDrawState,
  draughtsDrawVerdict,
  drawOfferBlock,
  endgameRuleFor,
  gameProgressPercent,
} from "./draw-rules";

const rules = DEFAULT_DRAW_RULES;
const noRepetition = { ...rules, repetition: false };

/** Plateau 10×10 vide avec les pièces indiquées (toutes des dames sauf "m"). */
function board(pieces: { at: [number, number]; color: "w" | "b"; man?: boolean }[]): DraughtsPosition {
  const position = createDraughtsPosition("INTERNATIONAL");
  const grid = position.board.map((row) => row.map(() => null)) as DraughtsPosition["board"];
  for (const p of pieces) grid[p.at[0]]![p.at[1]] = { color: p.color, king: !p.man };
  return { board: grid, turn: "w", variant: "INTERNATIONAL" };
}

const step = (from: [number, number], to: [number, number]): DraughtsMove => ({
  from: { row: from[0], col: from[1] },
  path: [{ row: to[0], col: to[1] }],
  captures: [],
});

/** Va-et-vient : chaque camp déplace une dame d'une case puis revient. */
function shuffle(plies: number, white: [number, number], black: [number, number]) {
  const moves: DraughtsMove[] = [];
  const pos = { w: white, b: black };
  const away = { w: [white[0] - 1, white[1] + 1] as [number, number], b: [black[0] + 1, black[1] - 1] as [number, number] };
  for (let i = 0; i < plies; i += 1) {
    const color = i % 2 === 0 ? "w" : "b";
    const from = pos[color];
    const to = from === (color === "w" ? white : black) ? away[color] : color === "w" ? white : black;
    moves.push(step(from, to));
    pos[color] = to;
  }
  return moves;
}

describe("dames : nul automatique (règlement FMJD)", () => {
  it("une ouverture normale ne déclenche aucun nul", () => {
    let position = createDraughtsPosition("INTERNATIONAL");
    const moves: DraughtsMove[] = [];
    for (let i = 0; i < 30; i += 1) {
      const legal = getLegalDraughtsMoves(position);
      const move = legal[(i * 7) % legal.length]!;
      moves.push(move);
      position = applyDraughtsMove(position, move);
    }
    const state = draughtsDrawState("INTERNATIONAL", moves);
    expect(state.kingOnlyPlies).toBe(0);
    expect(draughtsDrawVerdict("INTERNATIONAL", state, rules)).toBeNull();
  });

  it("répétition : nul à la 3e occurrence de la même position", () => {
    const start = board([{ at: [9, 0], color: "w" }, { at: [0, 9], color: "b" }, { at: [5, 0], color: "w" }, { at: [5, 2], color: "w" }, { at: [0, 1], color: "b" }, { at: [0, 3], color: "b" }]);
    const s4 = draughtsDrawState("INTERNATIONAL", shuffle(4, [9, 0], [0, 9]), start);
    expect(s4.repetitions).toBe(2);
    expect(draughtsDrawVerdict("INTERNATIONAL", s4, rules)).toBeNull();
    const s8 = draughtsDrawState("INTERNATIONAL", shuffle(8, [9, 0], [0, 9]), start);
    expect(s8.repetitions).toBe(3);
    expect(draughtsDrawVerdict("INTERNATIONAL", s8, rules)).toBe("REPETITION");
  });

  it("25 coups chacun avec uniquement des dames", () => {
    const start = board([{ at: [9, 0], color: "w" }, { at: [0, 9], color: "b" }, { at: [5, 0], color: "w" }, { at: [5, 2], color: "w" }, { at: [0, 1], color: "b" }, { at: [0, 3], color: "b" }]);
    expect(draughtsDrawVerdict("INTERNATIONAL", draughtsDrawState("INTERNATIONAL", shuffle(49, [9, 0], [0, 9]), start), noRepetition)).toBeNull();
    expect(draughtsDrawVerdict("INTERNATIONAL", draughtsDrawState("INTERNATIONAL", shuffle(50, [9, 0], [0, 9]), start), noRepetition)).toBe("KING_MOVES");
  });

  it("un déplacement de pion remet le compteur à zéro", () => {
    const start = board([{ at: [9, 0], color: "w" }, { at: [6, 3], color: "w", man: true }, { at: [0, 9], color: "b" }, { at: [0, 1], color: "b" }, { at: [0, 3], color: "b" }]);
    const moves = [...shuffle(20, [9, 0], [0, 9]), step([6, 3], [5, 4])];
    expect(draughtsDrawState("INTERNATIONAL", moves, start).kingOnlyPlies).toBe(0);
  });

  it("finales : 16 coups (3 dames contre 1) et 5 coups (2 dames contre 1)", () => {
    const three = board([{ at: [9, 0], color: "w" }, { at: [5, 0], color: "w" }, { at: [5, 2], color: "w" }, { at: [0, 9], color: "b" }]);
    expect(endgameRuleFor(three)).toBe("ENDGAME_16");
    expect(draughtsDrawVerdict("INTERNATIONAL", draughtsDrawState("INTERNATIONAL", shuffle(31, [9, 0], [0, 9]), three), noRepetition)).toBeNull();
    expect(draughtsDrawVerdict("INTERNATIONAL", draughtsDrawState("INTERNATIONAL", shuffle(32, [9, 0], [0, 9]), three), noRepetition)).toBe("ENDGAME_16");

    const two = board([{ at: [9, 0], color: "w" }, { at: [5, 0], color: "w" }, { at: [0, 9], color: "b" }]);
    expect(endgameRuleFor(two)).toBe("ENDGAME_5");
    expect(draughtsDrawVerdict("INTERNATIONAL", draughtsDrawState("INTERNATIONAL", shuffle(10, [9, 0], [0, 9]), two), noRepetition)).toBe("ENDGAME_5");
    expect(endgameRuleFor(board([{ at: [9, 0], color: "w" }, { at: [5, 0], color: "w" }, { at: [0, 9], color: "b" }, { at: [0, 1], color: "b" }]))).toBeNull();
  });
});

describe("proposition de nul", () => {
  const base = { progressPercent: 10, playerId: "a", lastDecline: null, rules };
  it("possible dès que chacun a joué, comme sur Lichess", () => {
    expect(drawOfferBlock({ ...base, plies: 1 })).toEqual({ kind: "TOO_EARLY", minPlies: 2 });
    expect(drawOfferBlock({ ...base, plies: 2 })).toBeNull();
  });
  it("délai après un refus pour éviter le harcèlement", () => {
    const lastDecline = { byPlayerId: "a", atPly: 20 };
    expect(drawOfferBlock({ ...base, plies: 24, lastDecline })).toEqual({ kind: "COOLDOWN", remainingPlies: 6 });
    expect(drawOfferBlock({ ...base, plies: 30, lastDecline })).toBeNull();
    expect(drawOfferBlock({ ...base, plies: 24, playerId: "b", lastDecline })).toBeNull();
  });
  it("seuil d'avancement optionnel (désactivé par défaut)", () => {
    expect(gameProgressPercent("CHECKERS", "INTERNATIONAL", 12)).toBe(70);
    expect(drawOfferBlock({ ...base, plies: 10, rules: { ...rules, drawOfferMinProgressPercent: 70 } })?.kind).toBe("PROGRESS");
  });
});

describe("échecs : temps écoulé contre matériel insuffisant", () => {
  it("roi seul, roi + fou, roi + cavalier ne peuvent pas mater", () => {
    expect(chessSideCanMate(["k"])).toBe(false);
    expect(chessSideCanMate(["k", "b"])).toBe(false);
    expect(chessSideCanMate(["k", "n"])).toBe(false);
    expect(chessSideCanMate(["k", "p"])).toBe(true);
    expect(chessSideCanMate(["k", "n", "n"])).toBe(true);
  });
});
