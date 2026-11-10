import type { Difficulty, DraughtsVariant } from "./game-settings";

export type DraughtsColor = "w" | "b";

export interface DraughtsPiece {
  color: DraughtsColor;
  king: boolean;
}

export interface DraughtsCoordinate {
  row: number;
  col: number;
}

export interface DraughtsMove {
  from: DraughtsCoordinate;
  path: DraughtsCoordinate[];
  captures: DraughtsCoordinate[];
}

export interface DraughtsPosition {
  board: (DraughtsPiece | null)[][];
  turn: DraughtsColor;
  variant: DraughtsVariant;
}

interface CaptureStep {
  to: DraughtsCoordinate;
  captured: DraughtsCoordinate;
}

const DIRECTIONS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

const SEARCH_SETTINGS: Record<Difficulty, { depth: number; nodes: number }> = {
  simple: { depth: 1, nodes: 1_000 },
  moyen: { depth: 4, nodes: 10_000 },
  expert: { depth: 7, nodes: 60_000 },
  pro: { depth: 10, nodes: 180_000 },
};

interface TableEntry {
  depth: number;
  score: number;
  bestMove?: string;
  bound: "exact" | "lower" | "upper";
}

function isInside(position: DraughtsPosition, row: number, col: number) {
  return (
    row >= 0 &&
    col >= 0 &&
    row < position.board.length &&
    col < position.board.length
  );
}

function promotionRow(color: DraughtsColor, size: number) {
  return color === "w" ? 0 : size - 1;
}

export function createDraughtsPosition(
  variant: DraughtsVariant,
): DraughtsPosition {
  const size = variant === "ENGLISH" ? 8 : 10;
  const rowsPerSide = variant === "ENGLISH" ? 3 : 4;
  const board: DraughtsPosition["board"] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null),
  );

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if ((row + col) % 2 !== 1) continue;

      if (row < rowsPerSide) board[row][col] = { color: "b", king: false };
      if (row >= size - rowsPerSide) {
        board[row][col] = { color: "w", king: false };
      }
    }
  }

  return { board, turn: "w", variant };
}

function getCaptureSteps(
  position: DraughtsPosition,
  from: DraughtsCoordinate,
  piece: DraughtsPiece,
): CaptureStep[] {
  const { board, variant } = position;
  const flyingKing = piece.king && variant === "INTERNATIONAL";
  // Men may capture in any diagonal direction, even though their quiet moves are forward-only.
  const directions = DIRECTIONS;
  const steps: CaptureStep[] = [];

  for (const [dr, dc] of directions) {
    if (flyingKing) {
      let capturedRow = from.row + dr;
      let capturedCol = from.col + dc;
      while (
        isInside(position, capturedRow, capturedCol) &&
        !board[capturedRow][capturedCol]
      ) {
        capturedRow += dr;
        capturedCol += dc;
      }

      const capturedPiece = isInside(position, capturedRow, capturedCol)
        ? board[capturedRow][capturedCol]
        : null;
      if (!capturedPiece || capturedPiece.color === piece.color) continue;

      for (
        let landingRow = capturedRow + dr, landingCol = capturedCol + dc;
        isInside(position, landingRow, landingCol) &&
        !board[landingRow][landingCol];
        landingRow += dr, landingCol += dc
      ) {
        steps.push({
          to: { row: landingRow, col: landingCol },
          captured: { row: capturedRow, col: capturedCol },
        });
      }
      continue;
    }

    const adjacentRow = from.row + dr;
    const adjacentCol = from.col + dc;
    if (!isInside(position, adjacentRow, adjacentCol)) continue;

    const adjacent = board[adjacentRow][adjacentCol];
    if (!adjacent || adjacent.color === piece.color) continue;

    if (!flyingKing) {
      const landingRow = adjacentRow + dr;
      const landingCol = adjacentCol + dc;
      if (
        isInside(position, landingRow, landingCol) &&
        !board[landingRow][landingCol]
      ) {
        steps.push({
          to: { row: landingRow, col: landingCol },
          captured: { row: adjacentRow, col: adjacentCol },
        });
      }
      continue;
    }

  }

  return steps;
}

function findCapturesFrom(
  position: DraughtsPosition,
  origin: DraughtsCoordinate,
  from: DraughtsCoordinate,
  piece: DraughtsPiece,
  path: DraughtsCoordinate[],
  captures: DraughtsCoordinate[],
): DraughtsMove[] {
  const steps = getCaptureSteps(position, from, piece);
  if (steps.length === 0) {
    return captures.length > 0 ? [{ from: origin, path, captures }] : [];
  }

  const completeMoves: DraughtsMove[] = [];
  for (const step of steps) {
    const board = position.board.map((row) => row.slice());
    board[from.row][from.col] = null;
    board[step.captured.row][step.captured.col] = null;

    const movedPiece = { ...piece };
    const reachedPromotionRow =
      step.to.row === promotionRow(piece.color, board.length);
    if (reachedPromotionRow) movedPiece.king = true;
    board[step.to.row][step.to.col] = movedPiece;

    const nextPosition = { ...position, board };
    const nextPath = [...path, step.to];
    const nextCaptures = [...captures, step.captured];

    if (reachedPromotionRow && !piece.king) {
      completeMoves.push({
        from: origin,
        path: nextPath,
        captures: nextCaptures,
      });
      continue;
    }

    const continuations = findCapturesFrom(
      nextPosition,
      origin,
      step.to,
      movedPiece,
      nextPath,
      nextCaptures,
    );
    if (continuations.length > 0) {
      completeMoves.push(...continuations);
    } else {
      completeMoves.push({
        from: origin,
        path: nextPath,
        captures: nextCaptures,
      });
    }
  }

  return completeMoves;
}

function getQuietMoves(
  position: DraughtsPosition,
  from: DraughtsCoordinate,
  piece: DraughtsPiece,
): DraughtsMove[] {
  const flyingKing = piece.king && position.variant === "INTERNATIONAL";
  const directions = piece.king
    ? DIRECTIONS
    : DIRECTIONS.filter(([dr]) => dr === (piece.color === "w" ? -1 : 1));
  const moves: DraughtsMove[] = [];

  for (const [dr, dc] of directions) {
    for (let distance = 1; ; distance += 1) {
      if (!flyingKing && distance > 1) break;
      const row = from.row + dr * distance;
      const col = from.col + dc * distance;
      if (!isInside(position, row, col) || position.board[row][col]) break;
      moves.push({
        from,
        path: [{ row, col }],
        captures: [],
      });
    }
  }

  return moves;
}

export function getLegalDraughtsMoves(
  position: DraughtsPosition,
): DraughtsMove[] {
  const captures: DraughtsMove[] = [];
  const quiet: DraughtsMove[] = [];

  for (let row = 0; row < position.board.length; row += 1) {
    for (let col = 0; col < position.board.length; col += 1) {
      const piece = position.board[row][col];
      if (!piece || piece.color !== position.turn) continue;

      const from = { row, col };
      captures.push(
        ...findCapturesFrom(position, from, from, piece, [], []),
      );
      quiet.push(...getQuietMoves(position, from, piece));
    }
  }

  if (captures.length === 0) return quiet;
  if (position.variant === "ENGLISH") return captures;

  const longestCapture = Math.max(...captures.map((move) => move.captures.length));
  return captures.filter((move) => move.captures.length === longestCapture);
}

export function applyDraughtsMove(
  position: DraughtsPosition,
  move: DraughtsMove,
): DraughtsPosition {
  const board = position.board.map((row) => row.slice());
  const piece = board[move.from.row][move.from.col];
  if (!piece) throw new Error("Impossible de déplacer une case vide.");

  board[move.from.row][move.from.col] = null;
  for (const captured of move.captures) {
    board[captured.row][captured.col] = null;
  }

  const destination = move.path[move.path.length - 1];
  if (!destination) throw new Error("Le coup ne possède aucune destination.");

  const movedPiece = { ...piece };
  if (destination.row === promotionRow(piece.color, board.length)) {
    movedPiece.king = true;
  }
  board[destination.row][destination.col] = movedPiece;

  return {
    board,
    turn: position.turn === "w" ? "b" : "w",
    variant: position.variant,
  };
}

function positionKey(position: DraughtsPosition): string {
  const pieces = position.board
    .map((row) =>
      row
        .map((piece) =>
          piece ? `${piece.color}${piece.king ? "k" : "m"}` : "--",
        )
        .join(""),
    )
    .join("");
  return `${position.variant}:${position.turn}:${pieces}`;
}

function evaluate(position: DraughtsPosition): number {
  let score = 0;
  const center = (position.board.length - 1) / 2;

  for (let row = 0; row < position.board.length; row += 1) {
    for (let col = 0; col < position.board.length; col += 1) {
      const piece = position.board[row][col];
      if (!piece) continue;

      const direction = piece.color === "w" ? 1 : -1;
      const advancement =
        piece.color === "w"
          ? position.board.length - 1 - row
          : row;
      const centerBonus =
        Math.max(0, 4 - (Math.abs(center - row) + Math.abs(center - col))) * 3;
      const value = (piece.king ? 320 : 100) +
        (piece.king ? centerBonus : advancement * 7 + centerBonus);
      score += direction * value;
    }
  }

  return score;
}

function moveKey(move: DraughtsMove): string {
  const destination = move.path[move.path.length - 1];
  return `${move.from.row},${move.from.col}:${destination?.row},${destination?.col}:${move.captures.length}`;
}

function orderMoves(moves: DraughtsMove[]): DraughtsMove[] {
  return moves.sort(
    (a, b) =>
      b.captures.length * 100 +
      b.captures.reduce((sum, captured) => sum + captured.row, 0) -
      (a.captures.length * 100 +
        a.captures.reduce((sum, captured) => sum + captured.row, 0)),
  );
}

function search(
  position: DraughtsPosition,
  depth: number,
  alpha: number,
  beta: number,
  state: {
    nodes: number;
    maxNodes: number;
    table: Map<string, TableEntry>;
  },
): number {
  state.nodes += 1;
  if (depth === 0 || state.nodes >= state.maxNodes) return evaluate(position);

  const moves = getLegalDraughtsMoves(position);
  if (moves.length === 0) return position.turn === "w" ? -100_000 : 100_000;

  const key = positionKey(position);
  const cached = state.table.get(key);
  const originalAlpha = alpha;
  const originalBeta = beta;
  if (cached && cached.depth >= depth) {
    if (cached.bound === "exact") return cached.score;
    if (cached.bound === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.bound === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }

  const maximizing = position.turn === "w";
  let bestScore = maximizing ? -Infinity : Infinity;
  let bestMove: string | undefined;
  const orderedMoves = orderMoves(moves);
  if (cached?.bestMove) {
    orderedMoves.sort(
      (a, b) =>
        Number(moveKey(b) === cached.bestMove) -
        Number(moveKey(a) === cached.bestMove),
    );
  }

  for (const move of orderedMoves) {
    const score = search(
      applyDraughtsMove(position, move),
      depth - 1,
      alpha,
      beta,
      state,
    );

    if (maximizing) {
      if (score > bestScore) bestMove = moveKey(move);
      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, bestScore);
    } else {
      if (score < bestScore) bestMove = moveKey(move);
      bestScore = Math.min(bestScore, score);
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha || state.nodes >= state.maxNodes) break;
  }

  state.table.set(key, {
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

export function chooseDraughtsMove(
  position: DraughtsPosition,
  difficulty: Difficulty,
): DraughtsMove | null {
  if (position.turn !== "b") return null;

  const legalMoves = orderMoves(getLegalDraughtsMoves(position));
  if (legalMoves.length === 0) return null;

  const settings = SEARCH_SETTINGS[difficulty];
  const state = {
    nodes: 0,
    maxNodes: settings.nodes,
    table: new Map<string, TableEntry>(),
  };
  let completedBestMove: DraughtsMove | null = null;
  let previousBestMove: string | undefined;

  for (let depth = 1; depth <= settings.depth; depth += 1) {
    let bestScore = Infinity;
    let bestMoves: DraughtsMove[] = [];
    let completed = state.nodes < settings.nodes;

    if (previousBestMove) {
      legalMoves.sort(
        (a, b) =>
          Number(moveKey(b) === previousBestMove) -
          Number(moveKey(a) === previousBestMove),
      );
    }

    for (const move of legalMoves) {
      const score = search(
        applyDraughtsMove(position, move),
        depth - 1,
        -Infinity,
        Infinity,
        state,
      );
      if (score < bestScore) {
        bestScore = score;
        bestMoves = [move];
      } else if (score === bestScore) {
        bestMoves.push(move);
      }

      if (state.nodes >= settings.nodes) {
        completed = false;
        break;
      }
    }

    if (completed && bestMoves.length > 0) {
      completedBestMove = bestMoves[Math.floor(Math.random() * bestMoves.length)];
      previousBestMove = moveKey(completedBestMove);
    }
  }

  return completedBestMove ?? legalMoves[0] ?? null;
}
