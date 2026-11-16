export type GameType = "CHESS" | "CHECKERS";

export type MatchmakingStrategy = "RANDOM" | "TARGETED";

/**
 * CASUAL : partie amicale (points classiques, pas d'ELO)
 * RATED  : partie classée (ELO du pool jeu × variante × cadence)
 * MONEY  : partie rémunérée (points argent, consentement explicite des deux joueurs)
 */
export type GameMode = "CASUAL" | "RATED" | "MONEY";

export interface MatchmakingCriteria {
  minPoints?: number;
  maxPoints?: number;
  country?: string;
  city?: string;
  neighborhood?: string;
}

export interface JoinQueuePayload {
  gameType: GameType;
  /** Mode explicite. Absent : déduit de `rated` (compatibilité). */
  mode?: GameMode;
  /** Mise en FCFA, obligatoire en mode MONEY. */
  stake?: number | null;
  draughtsVariant?: "ENGLISH" | "INTERNATIONAL";
  isPaid?: boolean;
  rated?: boolean;
  betAmount?: number | null;
  strategy?: MatchmakingStrategy;
  criteria?: MatchmakingCriteria;
  timeControlMinutes?: number | null;
}

export interface ClientToServerEvents {
  join_queue: (payload: JoinQueuePayload) => void;
  leave_queue: () => void;
  cut_match: (payload: { matchId: string }) => void;
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
  chat_message: (payload: { matchId: string; message: string }) => void;
  propose_bet: (payload: { matchId: string; amount: number }) => void;
  accept_bet: (payload: { matchId: string }) => void;
  reject_bet: (payload: { matchId: string }) => void;
  counter_bet: (payload: { matchId: string; amount: number }) => void;
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
    mode?: GameMode;
    stake?: number | null;
  }) => void;
  queue_stats: (payload: { waiting: Record<string, number> }) => void;
  queue_left: () => void;
  match_found: (payload: {
    matchId: string;
    gameType: GameType;
    opponentId: string;
    mode?: GameMode;
  }) => void;
  active_match_conflict: (payload: {
    matchId: string;
    opponentUsername: string;
    disconnectedPlayerId: string | null;
    gracePeriodMs: number;
  }) => void;
  match_state: (payload: {
    matchId: string;
    gameType: GameType;
    playerId: string;
    playerColor: "w" | "b";
    opponentUsername: string;
    opponentAvatar: string | null;
    draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null;
    moves: OnlinePly[];
    status: "IN_PROGRESS" | "FINISHED" | "ABANDONED" | "ABORTED";
    winnerId: string | null;
    scoreDelta: number | null;
    pointsChange?: number | null;
    opponentPointsChange?: number | null;
    drawOfferById: string | null;
    whiteTimeMs: number | null;
    blackTimeMs: number | null;
    pointsBalance: number | null;
    opponentPointsBalance: number | null;
    eloChange?: number | null;
    opponentEloChange?: number | null;
    eloBalance?: number | null;
    opponentEloBalance?: number | null;
    betEnabled: boolean;
    betAmount: number | null;
    betStatus: string | null;
    betProposedById: string | null;
    mode?: GameMode;
    stakeAmount?: number | null;
    timeControlMinutes?: number | null;
    rating?: number | null;
    opponentRating?: number | null;
    chatEnabled?: boolean;
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
    status: "FINISHED" | "ABANDONED" | "ABORTED";
    reason: "GAME_OVER" | "DRAW_OFFER" | "RESIGNATION" | "DISCONNECT_FORFEIT" | "TIME_OUT" | "ABORTED";
    mode?: GameMode;
    moneyChange?: number;
    moneyStake?: number | null;
    moneyCommission?: number;
    eloChange: number;
    opponentEloChange: number;
    eloBalance: number;
    opponentEloBalance: number;
    betSettled: boolean;
    betAmount: number | null;
    whiteResult: "WIN" | "LOSS" | "DRAW" | null;
    blackResult: "WIN" | "LOSS" | "DRAW" | null;
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
  chat_message: (payload: { matchId: string; from: string; text: string; ts: number }) => void;
  bet_proposed: (payload: { matchId: string; amount: number; by: string }) => void;
  bet_accepted: (payload: { matchId: string; amount: number; by: string }) => void;
  bet_rejected: (payload: { matchId: string; by: string }) => void;
  bet_countered: (payload: { matchId: string; amount: number; by: string }) => void;
}

export interface QueuedGame {
  gameType: GameType;
}

export interface GameMovePayload {
  matchId: string;
  move: unknown;
}
