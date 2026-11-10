"use client";

import type { Move as ChessMove } from "chess.js";
import type { Difficulty, DraughtsVariant } from "./engine/game-settings";
import type { DraughtsMove, DraughtsPosition } from "./engine/draughts";

type MoveRequest =
  | { game: "chess"; fen: string; difficulty: Difficulty }
  | {
      game: "draughts";
      position: DraughtsPosition;
      variant: DraughtsVariant;
      difficulty: Difficulty;
    };

type ComputerMove = ChessMove | DraughtsMove | null;
let requestId = 0;

export function requestComputerMove(
  request: MoveRequest,
  signal?: AbortSignal,
): Promise<ComputerMove> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Calcul annulé.", "AbortError"));
      return;
    }

    const worker = new Worker(
      new URL("../workers/game-ai.worker.ts", import.meta.url),
      { type: "module" },
    );
    const currentRequestId = ++requestId;
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Calcul annulé.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });

    worker.onmessage = (
      event: MessageEvent<{
        requestId: number;
        move?: ComputerMove;
        error?: string;
      }>,
    ) => {
      if (event.data.requestId !== currentRequestId) return;
      cleanup();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data.move ?? null);
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Le moteur de jeu a échoué."));
    };

    worker.postMessage({ ...request, requestId: currentRequestId });
  });
}
