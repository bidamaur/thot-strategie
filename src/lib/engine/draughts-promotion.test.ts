import { describe, expect, it } from "vitest";
import type { DraughtsVariant } from "./game-settings";
import {
  applyDraughtsMove,
  chooseDraughtsMove,
  getLegalDraughtsMoves,
  type DraughtsColor,
  type DraughtsCoordinate,
  type DraughtsPosition,
} from "./draughts";

type Placement = [row: number, col: number, color: DraughtsColor, king?: boolean];

/** Position vide + pièces données (rangée 0 = promotion des blancs, dernière rangée = des noirs). */
function position(variant: DraughtsVariant, turn: DraughtsColor, pieces: Placement[]): DraughtsPosition {
  const size = variant === "ENGLISH" ? 8 : 10;
  const board: DraughtsPosition["board"] = Array.from({ length: size }, () => Array.from({ length: size }, () => null));
  for (const [row, col, color, king = false] of pieces) {
    if ((row + col) % 2 !== 1) throw new Error(`case claire ${row},${col}`);
    board[row][col] = { color, king };
  }
  return { board, turn, variant };
}

const at = (row: number, col: number): DraughtsCoordinate => ({ row, col });
const end = (path: DraughtsCoordinate[]) => path[path.length - 1];
const pieceAt = (p: DraughtsPosition, c: DraughtsCoordinate) => p.board[c.row][c.col];

describe("dames internationales : promotion pendant une rafle", () => {
  it("cas 1 : atteint la dernière rangée à la 3e prise, effectue la 4e et reste pion", () => {
    const start = position("INTERNATIONAL", "w", [
      [6, 1, "w"],
      [5, 2, "b"], [3, 4, "b"], [1, 6, "b"], [1, 8, "b"],
    ]);
    const moves = getLegalDraughtsMoves(start);
    expect(moves).toHaveLength(1);
    const [move] = moves;
    expect(move.captures).toHaveLength(4);
    expect(move.path).toEqual([at(4, 3), at(2, 5), at(0, 7), at(2, 9)]);
    const after = applyDraughtsMove(start, move);
    expect(pieceAt(after, at(2, 9))).toEqual({ color: "w", king: false });
    expect(after.board.flat().filter((p) => p?.color === "b")).toHaveLength(0);
  });

  it("cas 2 : la dernière prise arrive sur la dernière rangée → dame à la fin", () => {
    const start = position("INTERNATIONAL", "w", [
      [4, 3, "w"],
      [3, 4, "b"], [1, 6, "b"],
    ]);
    const [move, ...rest] = getLegalDraughtsMoves(start);
    expect(rest).toHaveLength(0);
    expect(move.captures).toHaveLength(2);
    expect(end(move.path)).toEqual(at(0, 7));
    expect(pieceAt(applyDraughtsMove(start, move), at(0, 7))).toEqual({ color: "w", king: true });
  });

  it("cas 3 : passage temporaire par la dernière rangée → aucune promotion", () => {
    const start = position("INTERNATIONAL", "w", [
      [2, 5, "w"],
      [1, 6, "b"], [1, 8, "b"],
    ]);
    const [move, ...rest] = getLegalDraughtsMoves(start);
    expect(rest).toHaveLength(0);
    expect(move.path).toEqual([at(0, 7), at(2, 9)]);
    expect(pieceAt(applyDraughtsMove(start, move), at(2, 9))).toEqual({ color: "w", king: false });
  });

  it("pendant la rafle, le pion capture en pion (pas de prise à distance de dame)", () => {
    // Depuis (0,7), une dame volante pourrait prendre (3,4) en revenant en diagonale ;
    // un pion ne le peut pas : la rafle s'arrête donc sur la dernière rangée, promue.
    const start = position("INTERNATIONAL", "w", [
      [2, 5, "w"],
      [1, 6, "b"], [4, 3, "b"],
    ]);
    const [move, ...rest] = getLegalDraughtsMoves(start);
    expect(rest).toHaveLength(0);
    expect(move.captures).toEqual([at(1, 6)]);
    expect(pieceAt(applyDraughtsMove(start, move), at(0, 7))).toEqual({ color: "w", king: true });
  });

  it("cas 4 : rafle sans atteindre la dernière rangée → reste pion", () => {
    const start = position("INTERNATIONAL", "w", [
      [6, 1, "w"],
      [5, 2, "b"], [5, 4, "b"],
    ]);
    const [move, ...rest] = getLegalDraughtsMoves(start);
    expect(rest).toHaveLength(0);
    expect(move.path).toEqual([at(4, 3), at(6, 5)]);
    expect(pieceAt(applyDraughtsMove(start, move), at(6, 5))).toEqual({ color: "w", king: false });
  });

  it("cas 5 : prise multiple d'une dame volante inchangée", () => {
    const start = position("INTERNATIONAL", "w", [
      [9, 0, "w", true],
      [7, 2, "b"], [4, 1, "b"],
    ]);
    const moves = getLegalDraughtsMoves(start);
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([at(6, 3), at(3, 0)]);
    expect(moves[0].captures).toEqual([at(7, 2), at(4, 1)]);
    expect(pieceAt(applyDraughtsMove(start, moves[0]), at(3, 0))).toEqual({ color: "w", king: true });
  });

  it("cas 6 : même rafle côté noirs (sens opposé) → 4 prises, reste pion", () => {
    const start = position("INTERNATIONAL", "b", [
      [3, 8, "b"],
      [4, 7, "w"], [6, 5, "w"], [8, 3, "w"], [8, 1, "w"],
    ]);
    const moves = getLegalDraughtsMoves(start);
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([at(5, 6), at(7, 4), at(9, 2), at(7, 0)]);
    expect(pieceAt(applyDraughtsMove(start, moves[0]), at(7, 0))).toEqual({ color: "b", king: false });
  });

  it("cas 6 bis : noirs, la dernière prise arrive sur leur rangée de promotion → dame", () => {
    const start = position("INTERNATIONAL", "b", [
      [5, 6, "b"],
      [6, 5, "w"], [8, 3, "w"],
    ]);
    const [move] = getLegalDraughtsMoves(start);
    expect(end(move.path)).toEqual(at(9, 2));
    expect(pieceAt(applyDraughtsMove(start, move), at(9, 2))).toEqual({ color: "b", king: true });
  });

  it("l'IA joue la rafle complète (prise majoritaire)", () => {
    const start = position("INTERNATIONAL", "w", [
      [6, 1, "w"],
      [5, 2, "b"], [3, 4, "b"], [1, 6, "b"], [1, 8, "b"], [0, 1, "b"],
    ]);
    const move = chooseDraughtsMove(start, 3);
    expect(move?.captures).toHaveLength(4);
    expect(end(move!.path)).toEqual(at(2, 9));
  });
});

describe("dames anglaises : règle propre inchangée", () => {
  it("un pion couronné pendant une prise termine son coup", () => {
    const start = position("ENGLISH", "w", [
      [4, 1, "w"],
      [3, 2, "b"], [1, 4, "b"], [1, 6, "b"],
    ]);
    const moves = getLegalDraughtsMoves(start);
    expect(moves).toHaveLength(1);
    expect(moves[0].path).toEqual([at(2, 3), at(0, 5)]);
    expect(pieceAt(applyDraughtsMove(start, moves[0]), at(0, 5))).toEqual({ color: "w", king: true });
  });
});
