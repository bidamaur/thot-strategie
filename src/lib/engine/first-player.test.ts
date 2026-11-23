import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { chooseComputerMove } from "./chess-ai";
import { applyDraughtsMove, chooseDraughtsMove, createDraughtsPosition, getLegalDraughtsMoves } from "./draughts";
import { humanColorFor, parseFirstPlayer } from "./game-settings";

describe("entraînement : qui commence", () => {
  it("l'IA commence par défaut (paramètre absent ou inconnu)", () => {
    expect(parseFirstPlayer(undefined)).toBe("ai");
    expect(parseFirstPlayer("n'importe quoi")).toBe("ai");
    expect(parseFirstPlayer("me")).toBe("me");
  });

  it("le joueur prend le camp au trait s'il commence, l'autre sinon", () => {
    expect(humanColorFor("me", "w")).toBe("w");
    expect(humanColorFor("ai", "w")).toBe("b");
    // Le camp de départ vient du moteur : aucune hypothèse « les blancs commencent ».
    expect(humanColorFor("me", "b")).toBe("b");
    expect(humanColorFor("ai", "b")).toBe("w");
  });

  it("l'IA d'échecs sait jouer le premier coup avec les blancs", () => {
    const game = new Chess();
    const move = chooseComputerMove(game.fen(), 1);
    expect(move).not.toBeNull();
    expect(game.move({ from: move!.from, to: move!.to })).toBeTruthy();
    expect(game.turn()).toBe("b");
  });

  it("l'IA d'échecs avec les blancs saisit un mat en un", () => {
    // Mat du berger possible : Dxf7#.
    const setup = new Chess();
    for (const san of ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"]) setup.move(san);
    const fen = setup.fen();
    const move = chooseComputerMove(fen, 3);
    const game = new Chess(fen);
    game.move({ from: move!.from, to: move!.to, promotion: move!.promotion });
    expect(game.isCheckmate()).toBe(true);
  });

  it("l'IA de dames sait jouer le premier coup (les deux variantes)", () => {
    for (const variant of ["ENGLISH", "INTERNATIONAL"] as const) {
      const start = createDraughtsPosition(variant);
      const move = chooseDraughtsMove(start, 1);
      expect(move).not.toBeNull();
      const legal = getLegalDraughtsMoves(start);
      expect(legal.some((m) => JSON.stringify(m) === JSON.stringify(move))).toBe(true);
      expect(applyDraughtsMove(start, move!).turn).not.toBe(start.turn);
    }
  });

  it("l'IA de dames continue de jouer les noirs normalement", () => {
    const start = createDraughtsPosition("INTERNATIONAL");
    const afterWhite = applyDraughtsMove(start, getLegalDraughtsMoves(start)[0]);
    const move = chooseDraughtsMove(afterWhite, 1);
    expect(move).not.toBeNull();
    expect(afterWhite.board[move!.from.row][move!.from.col]?.color).toBe("b");
  });
});
