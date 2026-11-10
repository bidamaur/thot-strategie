import { Chess } from "chess.js";

export function createChessGame(fen?: string): Chess {
  return new Chess(fen);
}
