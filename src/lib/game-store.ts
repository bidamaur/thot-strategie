import { create } from "zustand";
import type { GameType } from "@/types";

interface GameState {
  activeMatchId: string | null;
  gameType: GameType | null;
  setActiveMatch: (
    matchId: string | null,
    gameType?: GameType | null,
  ) => void;
}

export const useGameStore = create<GameState>((set) => ({
  activeMatchId: null,
  gameType: null,
  setActiveMatch: (activeMatchId, gameType = null) =>
    set({ activeMatchId, gameType }),
}));
