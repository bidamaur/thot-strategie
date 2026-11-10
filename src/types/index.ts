export type GameType = "CHESS" | "CHECKERS";

export type MatchmakingStrategy = "RANDOM" | "TARGETED";

export interface MatchmakingCriteria {
  minPoints?: number;
  maxPoints?: number;
  country?: string;
  city?: string;
  neighborhood?: string;
}

export interface JoinQueuePayload {
  gameType: GameType;
  isPaid?: boolean;
  strategy?: MatchmakingStrategy;
  criteria?: MatchmakingCriteria;
  timeControlMinutes?: number | null;
}

export interface ClientToServerEvents {
  join_queue: (payload: JoinQueuePayload) => void;
  leave_queue: () => void;
  join_match: (payload: { matchId: string }) => void;
  make_move: (payload: { matchId: string; move: unknown }) => void;
  offer_draw: (payload: { matchId: string }) => void;
  respond_draw_offer: (payload: { matchId: string; accept: boolean }) => void;
  resign_match: (payload: { matchId: string }) => void;
  leave_match: (payload: { matchId: string }) => void;
  propose_time: (payload: { matchId: string; minutes: number | null }) => void;
  respond_time: (payload: { matchId: string; accept: boolean }) => void;
  request_rematch: (payload: { matchId: string }) => void;
  cancel_rematch: (payload: { matchId: string }) => void;
}

export interface OnlineMatchPly {
  kind: "CHESS";
  from: string;
  to: string;
  promotion?: string;
}

export interface OnlineDraughtsPly {
  kind: "CHECKERS";
  from: { row: number; col: number };
  path: { row: number; col: number }[];
  captures: { row: number; col: number }[];
}

export type OnlinePly = OnlineMatchPly | OnlineDraughtsPly;

export interface ServerToClientEvents {
  presence_update: (payload: { onlinePlayers: number }) => void;
  queue_joined: (payload: {
    gameType: GameType;
    strategy: MatchmakingStrategy;
  }) => void;
  queue_left: () => void;
  match_found: (payload: {
    matchId: string;
    gameType: GameType;
    opponentId: string;
  }) => void;
  match_state: (payload: {
    matchId: string;
    gameType: GameType;
    playerId: string;
    playerColor: "w" | "b";
    opponentUsername: string;
    draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null;
    moves: OnlinePly[];
    status: "IN_PROGRESS" | "FINISHED" | "ABANDONED";
    winnerId: string | null;
    scoreDelta: number | null;
    drawOfferById: string | null;
    whiteTimeMs: number | null;
    blackTimeMs: number | null;
    pointsBalance: number | null;
    opponentPointsBalance: number | null;
  }) => void;
  move_accepted: (payload: {
    matchId: string;
    moves: OnlinePly[];
    status: "IN_PROGRESS" | "FINISHED";
    winnerId: string | null;
    drawOfferById: string | null;
    whiteTimeMs: number | null;
    blackTimeMs: number | null;
  }) => void;
  draw_offer_updated: (payload: {
    matchId: string;
    offeredByPlayerId: string | null;
  }) => void;
  time_proposed: (payload: { matchId: string; minutes: number; by: string }) => void;
  time_accepted: (payload: { matchId: string; minutes: number | null }) => void;
  time_rejected: (payload: { matchId: string }) => void;
  match_finished: (payload: {
    matchId: string;
    winnerId: string | null;
    scoreDelta: number;
    pointsChange: number;
    pointsBalance: number;
    opponentPointsChange: number;
    opponentPointsBalance: number;
    status: "FINISHED" | "ABANDONED";
    reason: "GAME_OVER" | "DRAW_OFFER" | "RESIGNATION" | "DISCONNECT_FORFEIT" | "TIME_OUT";
  }) => void;
  match_left: (payload: { matchId: string; gracePeriodMs: number }) => void;
  rematch_waiting: (payload: { matchId: string }) => void;
  rematch_started: (payload: { previousMatchId: string; matchId: string }) => void;
  rematch_expired: (payload: { matchId: string }) => void;
  opponent_move: (payload: {
    matchId: string;
    playerId: string;
    move: unknown;
  }) => void;
  player_disconnected: (payload: {
    playerId: string;
    gracePeriodMs: number;
  }) => void;
  player_reconnected: (payload: { playerId: string }) => void;
  player_reconnect_expired: (payload: { playerId: string }) => void;
  server_error: (payload: { message: string }) => void;
}

export interface QueuedGame {
  gameType: GameType;
}

export interface GameMovePayload {
  matchId: string;
  move: unknown;
}
