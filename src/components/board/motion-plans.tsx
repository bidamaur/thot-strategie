"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { DraughtsCoordinate, DraughtsPiece, DraughtsPosition } from "@/lib/engine/draughts";
import { fractionOnSegment, type Cell, type MotionCapture, type MotionPlan } from "./piece-motion";

/**
 * Traduction d'un coup DÉJÀ VALIDÉ par le moteur en séquence visuelle.
 * Lecture seule : rien ici ne modifie la position ni ne décide d'un résultat.
 */

export interface PlannedMotion {
  plan: MotionPlan;
  /** Cases (format du plateau) dont la vraie pièce est masquée pendant l'animation. */
  hide: string[];
  /** Case d'une promotion à mettre en valeur une fois la pièce posée. */
  promotionKey: string | null;
}

/** Dames : trajet case par case (prises multiples dans l'ordre réel), prises au passage, promotion. */
export function planDraughtsMove(input: {
  id: string;
  move: { from: DraughtsCoordinate; path: DraughtsCoordinate[]; captures: DraughtsCoordinate[] };
  before: DraughtsPosition;
  after: DraughtsPosition;
  toDisplay: (coordinate: DraughtsCoordinate) => Cell;
  keyOf: (coordinate: DraughtsCoordinate) => string;
  renderPiece: (piece: DraughtsPiece) => ReactNode;
  instant?: boolean;
}): PlannedMotion | null {
  const { move, before, toDisplay, keyOf, renderPiece } = input;
  const piece = before.board[move.from.row]?.[move.from.col];
  const end = move.path[move.path.length - 1];
  if (!piece || !end) return null;

  const cells = [move.from, ...move.path].map(toDisplay);
  const captures: MotionCapture[] = move.captures.flatMap((captured, index) => {
    const victim = before.board[captured.row]?.[captured.col];
    if (!victim) return [];
    const at = toDisplay(captured);
    let step = Math.min(index, cells.length - 2);
    let fraction = 0.5;
    for (let i = 0; i < cells.length - 1; i += 1) {
      const k = fractionOnSegment(cells[i]!, cells[i + 1]!, at);
      if (k !== null) {
        step = i;
        fraction = k;
        break;
      }
    }
    return [{ key: `x${index}`, at, step: Math.max(0, step), fraction, node: renderPiece(victim) }];
  });

  // Promotion lue dans la position validée par le moteur (jamais recalculée ici).
  const promoted = !piece.king && input.after.board[end.row]?.[end.col]?.king === true;

  return {
    plan: {
      id: input.id,
      movers: [{ key: "m", path: cells, node: renderPiece(piece) }],
      captures,
      instant: input.instant,
    },
    hide: input.instant ? [] : [keyOf(end)],
    promotionKey: promoted ? keyOf(end) : null,
  };
}

export interface ChessMoveInfo {
  from: string;
  to: string;
  color: "w" | "b";
  piece: string;
  captured?: string;
  flags: string;
  promotion?: string;
}

/** Échecs : pièce jouée, tour du roque synchronisée, prise (en passant compris), promotion. */
export function planChessMove(input: {
  id: string;
  move: ChessMoveInfo;
  toDisplay: (square: string) => Cell;
  renderPiece: (color: "w" | "b", type: string) => ReactNode;
  instant?: boolean;
}): PlannedMotion {
  const { move, toDisplay, renderPiece } = input;
  const rank = move.from[1]!;
  const movers = [{ key: "m", path: [toDisplay(move.from), toDisplay(move.to)], node: renderPiece(move.color, move.piece) }];
  const hide = [move.to];

  // Roque : le roi et la tour se déplacent ensemble.
  const rook = move.flags.includes("k") ? { from: `h${rank}`, to: `f${rank}` } : move.flags.includes("q") ? { from: `a${rank}`, to: `d${rank}` } : null;
  if (rook) {
    movers.push({ key: "r", path: [toDisplay(rook.from), toDisplay(rook.to)], node: renderPiece(move.color, "r") });
    hide.push(rook.to);
  }

  const captures: MotionCapture[] = [];
  if (move.captured) {
    // En passant : le pion pris est à côté de la case d'arrivée.
    const square = move.flags.includes("e") ? `${move.to[0]}${rank}` : move.to;
    captures.push({
      key: "x0",
      at: toDisplay(square),
      step: 0,
      fraction: 0.8,
      node: renderPiece(move.color === "w" ? "b" : "w", move.captured),
    });
  }

  return {
    plan: { id: input.id, movers, captures, instant: input.instant },
    hide: input.instant ? [] : hide,
    promotionKey: move.flags.includes("p") ? move.to : null,
  };
}

/**
 * État visuel du dernier coup : actif tant que son animation n'est pas finie.
 * L'état du jeu n'en dépend jamais.
 */
export function usePieceMotion(candidate: PlannedMotion | null, enabled: boolean) {
  const [doneId, setDoneId] = useState<string | null>(null);
  const active = enabled && candidate && candidate.plan.id !== doneId ? candidate : null;
  const finish = useCallback((id: string) => setDoneId(id), []);
  return {
    active,
    finish,
    isHidden: (key: string) => !!active && active.hide.includes(key),
    /** Promotion du dernier coup, signalée une fois la pièce posée. */
    promotionKey: active ? null : candidate?.promotionKey ?? null,
  };
}
