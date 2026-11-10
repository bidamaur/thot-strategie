import { chooseComputerMove } from "../lib/engine/chess-ai";
import { chooseDraughtsMove } from "../lib/engine/draughts";
import type {
  Difficulty,
  DraughtsVariant,
} from "../lib/engine/game-settings";
import type { DraughtsPosition } from "../lib/engine/draughts";

type AIRequest =
  | {
      requestId: number;
      game: "chess";
      fen: string;
      difficulty: Difficulty;
    }
  | {
      requestId: number;
      game: "draughts";
      position: DraughtsPosition;
      variant: DraughtsVariant;
      difficulty: Difficulty;
    };

self.addEventListener("message", (event: MessageEvent<AIRequest>) => {
  try {
    const request = event.data;
    const move =
      request.game === "chess"
        ? chooseComputerMove(request.fen, request.difficulty)
        : chooseDraughtsMove(request.position, request.difficulty);

    self.postMessage({ requestId: request.requestId, move });
  } catch (error) {
    self.postMessage({
      requestId: event.data.requestId,
      error:
        error instanceof Error ? error.message : "Erreur inattendue du moteur.",
    });
  }
});
