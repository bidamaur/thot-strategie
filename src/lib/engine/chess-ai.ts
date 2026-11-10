import { Chess, type Move } from "chess.js";
import type { Difficulty } from "./game-settings";

const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
} as const;

const MATE_SCORE = 100_000;

const SEARCH_SETTINGS: Record<
  Difficulty,
  { depth: number; nodes: number; timeMs: number }
> = {
  simple: { depth: 1, nodes: 600, timeMs: 500 },
  moyen: { depth: 3, nodes: 1_500, timeMs: 1_500 },
  expert: { depth: 5, nodes: 3_000, timeMs: 3_000 },
  pro: { depth: 7, nodes: 5_000, timeMs: 4_500 },
};

interface SearchEntry {
  depth: number;
  score: number;
  bestMove?: string;
  bound: "exact" | "lower" | "upper";
}

function evaluate(position: Chess): number {
  let score = 0;
  for (const [row, squares] of position.board().entries()) {
    for (const [file, piece] of squares.entries()) {
      if (!piece) continue;

      const direction = piece.color === "w" ? 1 : -1;
      const advancement =
        piece.type === "p" ? (piece.color === "w" ? 6 - row : row - 1) : 0;
      const centerDistance =
        Math.abs(3.5 - file) + Math.abs(3.5 - row);
      const positionalBonus =
        piece.type === "k" ? 0 : Math.round((7 - centerDistance) * 3);
      const value =
        PIECE_VALUES[piece.type] +
        advancement * 8 +
        positionalBonus;

      score += direction * value;
    }
  }

  return score;
}

function orderMoves(moves: Move[]): Move[] {
  return moves.sort((a, b) => {
    const valueA = a.captured ? PIECE_VALUES[a.captured] : 0;
    const valueB = b.captured ? PIECE_VALUES[b.captured] : 0;
    return valueB - valueA;
  });
}

function search(
  position: Chess,
  depth: number,
  alpha: number,
  beta: number,
  searchState: {
    nodes: number;
    maxNodes: number;
    deadline: number;
    expired: boolean;
    table: Map<string, SearchEntry>;
  },
): number {
  searchState.nodes += 1;
  if (searchState.expired) return evaluate(position);
  if (searchState.nodes % 128 === 0 && Date.now() >= searchState.deadline) {
    searchState.expired = true;
    return evaluate(position);
  }

  const legalMoves = position.moves({ verbose: true });
  if (legalMoves.length === 0) {
    return position.isCheck()
      ? position.turn() === "w"
        ? -MATE_SCORE
        : MATE_SCORE
      : 0;
  }
  if (depth === 0 || searchState.nodes >= searchState.maxNodes) {
    if (
      position.isDrawByFiftyMoves() ||
      position.isInsufficientMaterial()
    ) {
      return 0;
    }
    return evaluate(position);
  }

  const hash = position.hash();
  const cached = searchState.table.get(hash);
  const originalAlpha = alpha;
  const originalBeta = beta;
  if (cached && cached.depth >= depth) {
    if (cached.bound === "exact") return cached.score;
    if (cached.bound === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.bound === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  const isMaximizing = position.turn() === "w";
  let bestScore = isMaximizing ? -Infinity : Infinity;
  const moves = orderMoves(legalMoves);
  if (cached?.bestMove) {
    moves.sort(
      (a, b) =>
        Number(`${b.from}${b.to}` === cached.bestMove) -
        Number(`${a.from}${a.to}` === cached.bestMove),
    );
  }
  let bestMove: string | undefined;

  for (const move of moves) {
    position.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion,
    });
    const score = search(
      position,
      depth - 1,
      alpha,
      beta,
      searchState,
    );
    position.undo();

    if (isMaximizing) {
      if (score > bestScore) bestMove = `${move.from}${move.to}`;
      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, bestScore);
    } else {
      if (score < bestScore) bestMove = `${move.from}${move.to}`;
      bestScore = Math.min(bestScore, score);
      beta = Math.min(beta, bestScore);
    }

    if (beta <= alpha || searchState.expired) break;
  }

  searchState.table.set(hash, {
    depth,
    score: bestScore,
    bestMove,
    bound:
      bestScore <= originalAlpha
        ? "upper"
        : bestScore >= originalBeta
          ? "lower"
          : "exact",
  });
  return bestScore;
}

export function chooseComputerMove(
  fen: string,
  difficulty: Difficulty = "moyen",
): Move | null {
  const position = new Chess(fen);
  if (position.isGameOver() || position.turn() !== "b") return null;

  const settings = SEARCH_SETTINGS[difficulty];
  const searchState = {
    nodes: 0,
    maxNodes: settings.nodes,
    deadline: Date.now() + settings.timeMs,
    expired: false,
    table: new Map<string, SearchEntry>(),
  };
  let completedBestMove: Move | null = null;
  let previousBestMove: string | undefined;

  const legalMoves = orderMoves(position.moves({ verbose: true }));
  for (let depth = 1; depth <= settings.depth; depth += 1) {
    let bestScore = Infinity;
    let bestMoves: Move[] = [];
    let completed =
      searchState.nodes < settings.nodes &&
      !searchState.expired &&
      Date.now() < searchState.deadline;

    if (previousBestMove) {
      legalMoves.sort(
        (a, b) =>
          Number(`${b.from}${b.to}` === previousBestMove) -
          Number(`${a.from}${a.to}` === previousBestMove),
      );
    }

    for (const move of legalMoves) {
      position.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion,
      });
      const score = search(
        position,
        depth - 1,
        -Infinity,
        Infinity,
        searchState,
      );
      position.undo();

      if (score < bestScore) {
        bestScore = score;
        bestMoves = [move];
      } else if (score === bestScore) {
        bestMoves.push(move);
      }

      if (
        searchState.nodes >= settings.nodes ||
        searchState.expired ||
        Date.now() >= searchState.deadline
      ) {
        completed = false;
        break;
      }
    }

    if (completed && bestMoves.length > 0) {
      completedBestMove = bestMoves[Math.floor(Math.random() * bestMoves.length)];
      previousBestMove = `${completedBestMove.from}${completedBestMove.to}`;
    }

    if (!completed) break;
  }

  return completedBestMove ?? legalMoves[0] ?? null;
}
