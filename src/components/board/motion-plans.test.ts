import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { applyDraughtsMove, getLegalDraughtsMoves, type DraughtsPiece, type DraughtsPosition } from "@/lib/engine/draughts";
import { planChessMove, planDraughtsMove } from "./motion-plans";
import { fractionOnSegment, planTiming } from "./piece-motion";

/** Position internationale vide sur laquelle on pose quelques pièces. */
function board(pieces: Record<string, DraughtsPiece>, turn: "w" | "b" = "w"): DraughtsPosition {
  const grid: (DraughtsPiece | null)[][] = Array.from({ length: 10 }, () => Array<DraughtsPiece | null>(10).fill(null));
  for (const [key, piece] of Object.entries(pieces)) {
    const [row, col] = key.split(",").map(Number);
    grid[row!]![col!] = piece;
  }
  return { board: grid, turn, variant: "INTERNATIONAL" } as DraughtsPosition;
}

const W = { color: "w", king: false } as const;
const B = { color: "b", king: false } as const;
const identity = ({ row, col }: { row: number; col: number }) => ({ r: row, c: col });
const key = ({ row, col }: { row: number; col: number }) => `${row},${col}`;

function planFor(position: DraughtsPosition, pick: (moves: ReturnType<typeof getLegalDraughtsMoves>) => ReturnType<typeof getLegalDraughtsMoves>[number]) {
  const move = pick(getLegalDraughtsMoves(position));
  const after = applyDraughtsMove(position, move);
  return {
    move,
    planned: planDraughtsMove({ id: "t", move, before: position, after, keyOf: key, toDisplay: identity, renderPiece: () => null })!,
  };
}

describe("animation : géométrie", () => {
  it("situe la pièce sautée sur l'étape parcourue", () => {
    expect(fractionOnSegment({ r: 6, c: 1 }, { r: 4, c: 3 }, { r: 5, c: 2 })).toBeCloseTo(0.5);
    expect(fractionOnSegment({ r: 6, c: 1 }, { r: 4, c: 3 }, { r: 5, c: 0 })).toBeNull();
    // Dame volante : pièce prise loin du départ.
    expect(fractionOnSegment({ r: 9, c: 0 }, { r: 3, c: 6 }, { r: 5, c: 4 })).toBeCloseTo(4 / 6);
  });
});

describe("animation des dames", () => {
  it("prise multiple : un saut par étape, prises effacées dans l'ordre réel du passage", () => {
    // Blanc en (6,1) ; noirs en (5,2) puis (3,4) : rafle de deux pièces.
    const position = board({ "6,1": W, "5,2": B, "3,4": B, "0,9": B });
    const { move, planned } = planFor(position, (moves) => moves.find((m) => m.captures.length === 2)!);
    expect(move.captures).toHaveLength(2);
    const mover = planned.plan.movers[0]!;
    expect(mover.path).toEqual([{ r: 6, c: 1 }, { r: 4, c: 3 }, { r: 2, c: 5 }]);
    const byStep = [...planned.plan.captures].sort((a, b) => a.step - b.step);
    expect(byStep.map((c) => `${c.at.r},${c.at.c}`)).toEqual(["5,2", "3,4"]);
    expect(byStep.every((c) => c.fraction > 0 && c.fraction < 1)).toBe(true);
    const timing = planTiming(planned.plan, 200);
    const [first, second] = byStep.map((c) => timing.captureStarts[planned.plan.captures.indexOf(c)]!);
    expect(second).toBeGreaterThan(first!);
    expect(timing.travel).toBe(400);
    expect(planned.hide).toEqual(["2,5"]);
  });

  it("transformation en dame lue dans la position validée par le moteur", () => {
    const position = board({ "1,2": W, "9,9": B });
    const { planned } = planFor(position, (moves) => moves[0]!);
    expect(planned.promotionKey).toMatch(/^0,/);
    const plain = planFor(board({ "6,1": W, "0,9": B }), (moves) => moves[0]!);
    expect(plain.planned.promotionKey).toBeNull();
  });

  it("coup posé au glisser : aucune pièce masquée ni rejouée", () => {
    const position = board({ "6,1": W, "5,2": B, "0,9": B });
    const move = getLegalDraughtsMoves(position)[0]!;
    const planned = planDraughtsMove({
      id: "g",
      instant: true,
      move,
      before: position,
      after: applyDraughtsMove(position, move),
      keyOf: key,
      toDisplay: identity,
      renderPiece: () => null,
    })!;
    expect(planned.hide).toEqual([]);
    expect(planned.plan.captures).toHaveLength(1);
    expect(planTiming(planned.plan, 220).travel).toBe(0);
  });
});

describe("animation des échecs", () => {
  const toDisplay = (square: string) => ({ r: 8 - Number(square[1]), c: square.charCodeAt(0) - 97 });
  const plan = (game: Chess) => planChessMove({ id: "c", move: game.history({ verbose: true }).at(-1)!, toDisplay, renderPiece: () => null });

  it("roque : roi et tour déplacés ensemble", () => {
    const game = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    game.move("O-O");
    const planned = plan(game);
    expect(planned.plan.movers.map((m) => m.key)).toEqual(["m", "r"]);
    expect(planned.plan.movers[1]!.path).toEqual([toDisplay("h1"), toDisplay("f1")]);
    expect(planned.hide.sort()).toEqual(["f1", "g1"]);
  });

  it("prise en passant : le pion pris est à côté de la case d'arrivée", () => {
    const game = new Chess("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    game.move("exd6");
    const planned = plan(game);
    expect(planned.plan.captures[0]!.at).toEqual(toDisplay("d5"));
  });

  it("promotion signalée sur la case d'arrivée", () => {
    const game = new Chess("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    game.move({ from: "a7", to: "a8", promotion: "q" });
    expect(plan(game).promotionKey).toBe("a8");
  });

  it("capture simple : la pièce prise s'efface à l'arrivée de l'attaquant", () => {
    const game = new Chess("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
    game.move("exd5");
    const planned = plan(game);
    expect(planned.plan.captures[0]!.at).toEqual(toDisplay("d5"));
    expect(planned.plan.captures[0]!.fraction).toBeGreaterThan(0.5);
  });
});
