import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { Chess, type Square } from "chess.js";
import {
  DraughtsVariant as PrismaDraughtsVariant,
  GameType as PrismaGameType,
  MatchStatus,
} from "../generated/prisma-client";
import type { Prisma } from "../generated/prisma-client";
import {
  getSessionUserByToken,
  readSessionCookie,
} from "../lib/auth/session";
import { escrowGameBet, InsufficientBetBalanceError } from "../lib/economy/game-bets";
import { prisma } from "../lib/prisma";
import { abortMatch, settleMatch } from "../lib/scoring/settle-match";
import { closeExpiredTimedTournaments, reportTournamentGame } from "../lib/economy/tournaments";
import { expireChallenges, staleChallengeMatchIds } from "../lib/community/challenges";
import { staleInterclubMatchIds } from "../lib/community/interclub";
import { assertCanStartGame, QuotaReachedError, serializeQuota } from "../lib/quota";
import { withSerializableRetry } from "../lib/db/retry";
import {
  chessSideCanMate,
  draughtsDrawState,
  draughtsDrawVerdict,
  drawOfferBlock,
  gameProgressPercent,
  type AutoDrawRule,
  type DrawRules,
} from "../lib/engine/draw-rules";
import { getSettings, peekSetting } from "../lib/settings/service";
import {
  assertCanQueueForMoney,
  lockMoneyMatchStakes,
  MoneyEligibilityError,
} from "../lib/economy/money-matches";
import { loadRatingSettings } from "../lib/rating/load-config";
import { cadenceOf, ratingVariantOf } from "../lib/rating/pools";
import {
  applyDraughtsMove,
  createDraughtsPosition,
  getLegalDraughtsMoves,
  type DraughtsMove,
  type DraughtsPosition,
} from "../lib/engine/draughts";
import { Server, type Socket } from "socket.io";
import type {
  ChatMessagePayload,
  ClientToServerEvents,
  GameMode,
  JoinQueuePayload,
  MatchmakingCriteria,
  MatchmakingStrategy,
  OnlinePly,
  ServerToClientEvents,
} from "../types";
import {
  MatchmakingQueue,
  type PlayerProfile,
  type QueueEntry,
} from "./matchmaking-queue";

const RECONNECT_GRACE_MS = 60_000;

interface SocketData {
  playerId: string;
  profile: PlayerProfile;
}

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

interface ActiveMatch {
  matchId: string;
  gameType: JoinQueuePayload["gameType"];
  playerIds: [string, string];
  usernames: [string, string];
  draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null;
  timeControlMinutes: number | null;
  mode: GameMode;
  stakeAmount: number | null;
  /** Tournoi auquel appartient la partie (résultat reporté automatiquement). */
  tournamentId: string | null;
  whiteMoneyChange: number | null;
  blackMoneyChange: number | null;
  moves: OnlinePly[];
  status: "IN_PROGRESS" | "FINISHED" | "ABANDONED" | "ABORTED";
  winnerId: string | null;
  scoreDelta: number | null;
  whitePointsChange: number | null;
  blackPointsChange: number | null;
  whitePointsBalance: number | null;
  blackPointsBalance: number | null;
  whiteEloChange: number | null;
  blackEloChange: number | null;
  whiteEloBalance: number | null;
  blackEloBalance: number | null;
  betEnabled: boolean;
  betAmount: number | null;
  betStatus:
    | "PROPOSED"
    | "ACCEPTED"
    | "REJECTED"
    | "COUNTERED"
    | "SETTLED"
    | "REFUNDED"
    | "EXPIRED"
    | null;
  betProposedById: string | null;
  drawOfferById: string | null;
  /** Dernière proposition de nul refusée (délai avant de reproposer). */
  lastDrawDecline: { byPlayerId: string; atPly: number } | null;
  timeProposal: number | null;
  timeProposalBy: string | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  turnStartedAt: number | null;
  disconnectedPlayerId: string | null;
  disconnectedAt: Date | null;
  processingMove: boolean;
  processingAction: boolean;
  reconnectTimers: Map<string, NodeJS.Timeout>;
  /** Joueurs ayant effectivement rejoint la partie (forfait si l'un ne vient jamais). */
  joinedPlayerIds: Set<string>;
  noShowTimer: NodeJS.Timeout | null;
  /** Derniers messages de la salle (mémoire du serveur, renvoyés à l'entrée). */
  chatHistory: ChatMessagePayload[];
}

const CHAT_HISTORY_LIMIT = 50;

const isGameType = (value: unknown): value is JoinQueuePayload["gameType"] =>
  value === "CHESS" || value === "CHECKERS";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseCriteria(value: unknown): MatchmakingCriteria | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;

  const criteria: MatchmakingCriteria = {};
  for (const key of ["minPoints", "maxPoints"] as const) {
    const pointValue = value[key];
    if (pointValue !== undefined) {
      if (typeof pointValue !== "number" || !Number.isFinite(pointValue)) {
        return null;
      }
      criteria[key] = pointValue;
    }
  }
  if (
    criteria.minPoints !== undefined &&
    criteria.maxPoints !== undefined &&
    criteria.minPoints > criteria.maxPoints
  ) {
    return null;
  }

  for (const key of ["country", "city", "neighborhood"] as const) {
    const location = value[key];
    if (location !== undefined) {
      if (typeof location !== "string" || location.length > 80) return null;
      const trimmed = location.trim();
      if (trimmed) criteria[key] = trimmed;
    }
  }
  return criteria;
}

export function attachSocketServer(httpServer: HttpServer): Server {
  const port = process.env.PORT ?? "3000";
  const allowedOrigins = new Set([
    process.env.APP_ORIGIN ?? `http://localhost:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => `http://${entry.address}:${port}`),
  ]);
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: {
      origin: (origin, callback) => {
        callback(null, !origin || allowedOrigins.has(origin));
      },
      credentials: true,
    },
  });

  const connectedPlayers = new Map<string, GameSocket>();
  // Présence partagée avec les API communautaires (même processus Node).
  (globalThis as { __thotIsOnline?: (userId: string) => boolean }).__thotIsOnline = (userId) =>
    connectedPlayers.has(userId);
  const joinedMatchSockets = new Map<string, string>();
  const socketJoinedMatches = new Map<string, string>();
  const matchmaking = new MatchmakingQueue();
  const rematchRequests = new Map<string, Set<string>>();
  const rematchTimers = new Map<string, NodeJS.Timeout>();
  const rematchesBeingCreated = new Set<string>();
  const matches = new Map<string, ActiveMatch>();
  const turnTimeouts = new Map<string, NodeJS.Timeout>();

  const publishPresence = (): void => {
    io.emit("presence_update", { onlinePlayers: connectedPlayers.size });
  };

  io.use((socket, next) => {
    const token = readSessionCookie(socket.handshake.headers.cookie ?? null);
    void getSessionUserByToken(token)
      .then((user) => {
        if (!user) {
          next(new Error("Connectez-vous pour rejoindre le matchmaking."));
          return;
        }
        socket.data.playerId = user.id;
        socket.data.profile = {
          username: user.username,
          pointsFree: user.pointsFree,
          country: user.country,
          city: user.city,
          neighborhood: user.neighborhood,
          draughtsVariant: user.draughtsVariant,
        };
        next();
      })
      .catch((error: unknown) => {
        console.error("Erreur lors de l’identification Socket.IO :", error);
        next(new Error("Impossible de vérifier le profil joueur."));
      });
  });

  const findMatchForPlayer = (playerId: string) => {
    for (const match of matches.values()) {
      if (
        match.status === "IN_PROGRESS" &&
        match.playerIds.includes(playerId)
      ) {
        return match;
      }
    }
    return undefined;
  };

  const loadMatch = async (matchId: string): Promise<ActiveMatch | null> => {
    const active = matches.get(matchId);
    if (active) return active;

    const stored = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        playerWhite: {
          select: { id: true, username: true, pointsFree: true, elo: true },
        },
        playerBlack: {
          select: { id: true, username: true, pointsFree: true, elo: true },
        },
        resultRecord: {
          select: { betSettled: true, whitePointsChange: true, blackPointsChange: true },
        },
        ratingHistory: {
          select: { userId: true, newRating: true },
        },
        tournamentMatch: { select: { tournamentId: true } },
      },
    });
    if (!stored?.playerBlackId || !stored.playerBlack) return null;
    const whiteRating = stored.ratingHistory.find(
      (rating) => rating.userId === stored.playerWhiteId,
    );
    const blackRating = stored.ratingHistory.find(
      (rating) => rating.userId === stored.playerBlackId,
    );
    // Les variations enregistrées font foi (pertes et gains ne sont plus forcément symétriques).
    const whitePointsChange = stored.resultRecord
      ? stored.resultRecord.whitePointsChange
      : null;
    const blackPointsChange = stored.resultRecord
      ? stored.resultRecord.blackPointsChange
      : null;

    const match: ActiveMatch = {
      matchId,
      gameType: stored.gameType,
      playerIds: [stored.playerWhiteId, stored.playerBlackId],
      usernames: [stored.playerWhite.username, stored.playerBlack.username],
       draughtsVariant: stored.draughtsVariant,
       timeControlMinutes: stored.timeControlMinutes,
       mode: stored.mode,
       stakeAmount: stored.stakeAmount ? stored.stakeAmount.toNumber() : null,
       tournamentId: stored.tournamentMatch?.tournamentId ?? null,
       whiteMoneyChange: null,
       blackMoneyChange: null,
       moves: Array.isArray(stored.movesHistory)
        ? (stored.movesHistory as unknown as OnlinePly[])
        : [],
      status:
        stored.status === MatchStatus.FINISHED
          ? "FINISHED"
          : stored.status === MatchStatus.ABANDONED
            ? "ABANDONED"
            : stored.status === MatchStatus.ABORTED
              ? "ABORTED"
              : "IN_PROGRESS",
      winnerId: stored.winnerId,
      scoreDelta: stored.scoreDelta,
      whitePointsChange,
      blackPointsChange,
      whitePointsBalance: stored.playerWhite.pointsFree,
      blackPointsBalance: stored.playerBlack.pointsFree,
      whiteEloChange: stored.eloDeltaWhite,
      blackEloChange: stored.eloDeltaBlack,
      whiteEloBalance: whiteRating?.newRating ?? stored.playerWhite.elo,
      blackEloBalance: blackRating?.newRating ?? stored.playerBlack.elo,
      betEnabled: stored.betEnabled,
      betAmount: stored.betAmount,
      betStatus: stored.betStatus,
      betProposedById: stored.betProposedById,
       drawOfferById: null,
      lastDrawDecline: null,
       timeProposal: null,
       timeProposalBy: null,
       whiteTimeMs: null,
       blackTimeMs: null,
       turnStartedAt: null,
       disconnectedPlayerId: stored.disconnectedPlayerId,
      disconnectedAt: stored.disconnectedAt,
      processingMove: false,
      processingAction: false,
      reconnectTimers: new Map(),
      joinedPlayerIds: new Set(),
      noShowTimer: null,
      chatHistory: [],
    };
    matches.set(matchId, match);
    if (
      match.status === "IN_PROGRESS" &&
      match.disconnectedPlayerId &&
      match.disconnectedAt
    ) {
      scheduleReconnectExpiry(
        match,
        match.disconnectedPlayerId,
        Math.max(
          0,
          RECONNECT_GRACE_MS - (Date.now() - match.disconnectedAt.getTime()),
        ),
      );
    }
    return match;
  };

  const currentDrawRules = (): DrawRules => ({
    repetition: peekSetting("match.drawRepetitionEnabled"),
    kingMovesInternational: peekSetting("match.draughtsKingMovesDrawInternational"),
    kingMovesEnglish: peekSetting("match.draughtsKingMovesDrawEnglish"),
    endgameRules: peekSetting("match.draughtsEndgameDrawRules"),
    drawOfferMinPlies: peekSetting("match.abortMovesThreshold"),
    drawOfferMinProgressPercent: peekSetting("match.drawOfferMinProgressPercent"),
    drawOfferCooldownPlies: peekSetting("match.drawOfferCooldownPlies"),
  });

  const sendMatchState = (socket: GameSocket, match: ActiveMatch): void => {
    const isWhite = match.playerIds[0] === socket.data.playerId;
    socket.emit("match_state", {
      matchId: match.matchId,
      gameType: match.gameType,
      playerId: socket.data.playerId,
      playerColor: isWhite ? "w" : "b",
      opponentUsername: match.usernames[isWhite ? 1 : 0],
      opponentAvatar: null,
      draughtsVariant: match.draughtsVariant,
      moves: match.moves,
      status: match.status,
      winnerId: match.winnerId,
      scoreDelta: match.scoreDelta,
       pointsChange: isWhite
         ? match.whitePointsChange
         : match.blackPointsChange,
       opponentPointsChange: isWhite
         ? match.blackPointsChange
         : match.whitePointsChange,
       drawOfferById: match.drawOfferById,
       whiteTimeMs: match.whiteTimeMs,
       blackTimeMs: match.blackTimeMs,
        pointsBalance: isWhite
         ? match.whitePointsBalance
         : match.blackPointsBalance,
      opponentPointsBalance: isWhite
        ? match.blackPointsBalance
        : match.whitePointsBalance,
      eloChange: isWhite ? match.whiteEloChange : match.blackEloChange,
      opponentEloChange: isWhite ? match.blackEloChange : match.whiteEloChange,
      eloBalance: isWhite ? match.whiteEloBalance : match.blackEloBalance,
      opponentEloBalance: isWhite
        ? match.blackEloBalance
        : match.whiteEloBalance,
      betEnabled: match.betEnabled,
      betAmount: match.betAmount,
      betStatus: match.betStatus,
      betProposedById: match.betProposedById,
      mode: match.mode,
      stakeAmount: match.stakeAmount,
      timeControlMinutes: match.timeControlMinutes,
      chatEnabled: peekSetting("match.chatEnabled"),
      tournamentId: match.tournamentId,
      drawRules: currentDrawRules(),
      lastDrawDecline: match.lastDrawDecline,
    });
  };

  const isCoordinate = (
    value: unknown,
    boardSize: number,
  ): value is { row: number; col: number } =>
    isRecord(value) &&
    Number.isInteger(value.row) &&
    Number.isInteger(value.col) &&
    Number(value.row) >= 0 &&
    Number(value.col) >= 0 &&
    Number(value.row) < boardSize &&
    Number(value.col) < boardSize;

  const parseDraughtsPly = (
    value: unknown,
    boardSize: number,
  ): OnlinePly | null => {
    if (
      !isRecord(value) ||
      !isCoordinate(value.from, boardSize) ||
      !Array.isArray(value.path) ||
      !Array.isArray(value.captures) ||
      value.path.length === 0 ||
      value.path.length > boardSize ||
      value.captures.length > boardSize ||
      !value.path.every((coordinate) => isCoordinate(coordinate, boardSize)) ||
      !value.captures.every((coordinate) =>
        isCoordinate(coordinate, boardSize),
      )
    ) {
      return null;
    }

    return {
      kind: "CHECKERS",
      from: value.from,
      path: value.path,
      captures: value.captures,
    };
  };

  const sameCoordinate = (
    left: { row: number; col: number },
    right: { row: number; col: number },
  ) => left.row === right.row && left.col === right.col;

  const sameDraughtsMove = (left: DraughtsMove, right: DraughtsMove) =>
    sameCoordinate(left.from, right.from) &&
    left.path.length === right.path.length &&
    left.path.every((point, index) =>
      sameCoordinate(point, right.path[index]!),
    ) &&
    left.captures.length === right.captures.length &&
    left.captures.every((point, index) =>
      sameCoordinate(point, right.captures[index]!),
    );

  const rebuildDraughtsPosition = (match: ActiveMatch): DraughtsPosition => {
    let position = createDraughtsPosition(
      match.draughtsVariant ?? "INTERNATIONAL",
    );
    for (const ply of match.moves) {
      if (ply.kind !== "CHECKERS") {
        throw new Error("Historique de dames invalide.");
      }
      const move = getLegalDraughtsMoves(position).find((candidate) =>
        sameDraughtsMove(candidate, ply),
      );
      if (!move) throw new Error("Un coup enregistré est invalide.");
      position = applyDraughtsMove(position, move);
    }
    return position;
  };

  const getRemainingPieces = (
    match: ActiveMatch,
  ): { white: number; black: number; total: number } => {
    if (match.gameType === "CHESS") {
      const game = new Chess();
      for (const ply of match.moves) {
        if (ply.kind !== "CHESS") {
          throw new Error("Historique d’échecs invalide.");
        }
        game.move({
          from: ply.from as Square,
          to: ply.to as Square,
          promotion: ply.promotion ?? "q",
        });
      }
      const pieces = game.board().flat().filter((piece) => piece !== null);
      const white = pieces.filter((piece) => piece.color === "w").length;
      const black = pieces.length - white;
      return { white, black, total: pieces.length };
    }

    const pieces = rebuildDraughtsPosition(match).board
      .flat()
      .filter((piece) => piece !== null);
    const white = pieces.filter((piece) => piece.color === "w").length;
    const black = pieces.length - white;
    return { white, black, total: pieces.length };
  };

  const publishDrawOffer = (match: ActiveMatch): void => {
    io.to(match.matchId).emit("draw_offer_updated", {
      matchId: match.matchId,
      offeredByPlayerId: match.drawOfferById,
      lastDrawDecline: match.lastDrawDecline,
    });
  };

  /** Types de pièces (p, n, b, r, q, k) d'un camp aux échecs, d'après l'historique validé. */
  const chessPieceTypes = (match: ActiveMatch, color: "w" | "b"): string[] => {
    const game = new Chess();
    for (const ply of match.moves) {
      if (ply.kind !== "CHESS") return [];
      game.move({ from: ply.from as Square, to: ply.to as Square, promotion: ply.promotion ?? "q" });
    }
    return game
      .board()
      .flat()
      .filter((piece) => piece !== null && piece.color === color)
      .map((piece) => piece!.type);
  };

  const isJoinedSocket = (socket: GameSocket): boolean =>
    joinedMatchSockets.get(socket.data.playerId) === socket.id;

  const finishMatch = async (
    match: ActiveMatch,
    winnerId: string | null,
    reason:
      | "GAME_OVER"
      | "DRAW_OFFER"
      | "RESIGNATION"
      | "DISCONNECT_FORFEIT"
      | "TIME_OUT"
      | "NO_SHOW"
      | "AUTO_DRAW",
    autoDrawRule: AutoDrawRule | null = null,
  ): Promise<boolean> => {
    if (match.status !== "IN_PROGRESS" || match.processingAction) return false;
    match.processingAction = true;
    if (match.noShowTimer) {
      clearTimeout(match.noShowTimer);
      match.noShowTimer = null;
    }
    const turnTimeout = turnTimeouts.get(match.matchId);
    if (turnTimeout) clearTimeout(turnTimeout);
    turnTimeouts.delete(match.matchId);
    try {
      const pieces = getRemainingPieces(match);
      const releaseSockets = () => {
        for (const playerId of match.playerIds) {
          const participantSocket = connectedPlayers.get(playerId);
          if (
            participantSocket &&
            socketJoinedMatches.get(participantSocket.id) === match.matchId
          ) {
            socketJoinedMatches.delete(participantSocket.id);
            if (joinedMatchSockets.get(playerId) === participantSocket.id) {
              joinedMatchSockets.delete(playerId);
            }
            void participantSocket.leave(match.matchId);
          }
        }
        void io.in(match.matchId).socketsLeave(match.matchId);
      };

      // Annulation sans conséquence : abandon, déconnexion ou temps écoulé
      // avant que la partie ait réellement commencé (pratique Lichess/Chess.com).
      const abortThreshold = peekSetting("match.abortMovesThreshold");
      if (
        reason !== "GAME_OVER" &&
        reason !== "DRAW_OFFER" &&
        reason !== "AUTO_DRAW" &&
        reason !== "NO_SHOW" &&
        match.moves.length < abortThreshold
      ) {
        const { aborted } = await abortMatch(match.matchId);
        if (aborted) {
          match.status = "ABORTED";
          match.winnerId = null;
          match.drawOfferById = null;
          for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
          match.reconnectTimers.clear();
          matches.delete(match.matchId);
          for (const playerId of match.playerIds) {
            const isWhite = playerId === match.playerIds[0];
            connectedPlayers.get(playerId)?.emit("match_finished", {
              matchId: match.matchId,
              winnerId: null,
              scoreDelta: 0,
              pointsChange: 0,
              pointsBalance: (isWhite ? match.whitePointsBalance : match.blackPointsBalance) ?? 0,
              opponentPointsChange: 0,
              opponentPointsBalance: (isWhite ? match.blackPointsBalance : match.whitePointsBalance) ?? 0,
              eloChange: 0,
              opponentEloChange: 0,
              eloBalance: (isWhite ? match.whiteEloBalance : match.blackEloBalance) ?? 0,
              opponentEloBalance: (isWhite ? match.blackEloBalance : match.whiteEloBalance) ?? 0,
              status: "ABORTED",
              reason: "ABORTED",
              betSettled: false,
              betAmount: null,
              whiteResult: null,
              blackResult: null,
              mode: match.mode,
              moneyChange: 0,
              moneyStake: match.stakeAmount,
              moneyCommission: 0,
            });
          }
          releaseSockets();
          return true;
        }
      }

      // Échecs : temps écoulé alors que l'adversaire ne peut plus mater = nul (Lichess, Chess.com).
      let drawRule = autoDrawRule;
      if (
        reason === "TIME_OUT" &&
        winnerId !== null &&
        match.gameType === "CHESS" &&
        peekSetting("match.timeoutInsufficientMaterialDraw") &&
        !chessSideCanMate(chessPieceTypes(match, winnerId === match.playerIds[0] ? "w" : "b"))
      ) {
        winnerId = null;
        drawRule = "TIMEOUT_INSUFFICIENT";
      }

      const finalStatus =
        reason === "RESIGNATION" || reason === "DISCONNECT_FORFEIT" || reason === "NO_SHOW"
          ? MatchStatus.ABANDONED
          : MatchStatus.FINISHED;

      const result = await settleMatch({
        matchId: match.matchId,
        winnerId,
        whiteRemainingPieces: pieces.white,
        blackRemainingPieces: pieces.black,
        finalStatus,
        result: winnerId === null ? "DRAW" : winnerId === match.playerIds[0] ? "WIN" : "LOSS",
      });

      match.status = finalStatus;
      match.winnerId = winnerId;
      match.scoreDelta = result.scoreDelta;
      match.whitePointsChange = result.whitePointsChange;
      match.blackPointsChange = result.blackPointsChange;
      match.whitePointsBalance = result.whiteBalance;
      match.blackPointsBalance = result.blackBalance;
      match.whiteEloChange = result.whiteEloChange;
      match.blackEloChange = result.blackEloChange;
      match.whiteEloBalance = result.whiteEloBalance;
      match.blackEloBalance = result.blackEloBalance;
      match.whiteMoneyChange = result.whiteMoneyChange;
      match.blackMoneyChange = result.blackMoneyChange;
      if (match.tournamentId) {
        // Le serveur reporte lui-même le résultat dans le tableau du tournoi.
        await reportTournamentGame(match.matchId).catch((error: unknown) =>
          console.error("Report du résultat de tournoi impossible (réconciliation ultérieure) :", error),
        );
      }
      match.drawOfferById = null;
      for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
      match.reconnectTimers.clear();
      matches.delete(match.matchId);
      if (finalStatus === MatchStatus.ABANDONED) releaseSockets();

      for (const playerId of match.playerIds) {
        const isWhite = playerId === match.playerIds[0];
        // Le pot d'un défi amical gagné s'ajoute à la variation affichée.
        const betGain = (won: boolean) =>
          result.betSettled && result.betAmount && winnerId !== null
            ? won ? result.betAmount : -result.betAmount
            : 0;
        const pointsChange =
          (isWhite ? result.whitePointsChange : result.blackPointsChange) +
          betGain(winnerId === playerId);
        const opponentPointsChange =
          (isWhite ? result.blackPointsChange : result.whitePointsChange) +
          betGain(winnerId !== null && winnerId !== playerId);
        connectedPlayers.get(playerId)?.emit("match_finished", {
          matchId: match.matchId,
          winnerId,
          scoreDelta: result.scoreDelta,
          pointsChange,
          pointsBalance: isWhite ? result.whiteBalance : result.blackBalance,
          opponentPointsChange,
          opponentPointsBalance: isWhite ? result.blackBalance : result.whiteBalance,
          eloChange: isWhite ? result.whiteEloChange : result.blackEloChange,
          opponentEloChange: isWhite ? result.blackEloChange : result.whiteEloChange,
          eloBalance: isWhite ? result.whiteEloBalance : result.blackEloBalance,
          opponentEloBalance: isWhite ? result.blackEloBalance : result.whiteEloBalance,
          status: finalStatus,
          reason,
          drawRule,
          betSettled: result.betSettled,
          betAmount: result.betAmount,
          whiteResult: result.whiteResult,
          blackResult: result.blackResult,
          mode: result.mode,
          moneyChange: isWhite ? result.whiteMoneyChange : result.blackMoneyChange,
          moneyStake: result.moneyStake,
          moneyCommission: result.moneyCommission,
        });
        connectedPlayers.get(playerId)?.emit("draw_offer_updated", {
          matchId: match.matchId,
          offeredByPlayerId: null,
        });
      }
      return true;
    } finally {
      match.processingAction = false;
    }
  };

  const scheduleTurnTimeout = (
    match: ActiveMatch,
    retryDelay?: number,
  ): void => {
    const previousTimer = turnTimeouts.get(match.matchId);
    if (previousTimer) clearTimeout(previousTimer);
    turnTimeouts.delete(match.matchId);
    if (
      match.status !== "IN_PROGRESS" ||
      !match.timeControlMinutes ||
      match.turnStartedAt === null
    ) {
      return;
    }

    const isWhiteTurn = match.moves.length % 2 === 0;
    const remainingMs = isWhiteTurn ? match.whiteTimeMs : match.blackTimeMs;
    if (remainingMs === null) return;
    const delay =
      retryDelay ??
      Math.max(0, remainingMs - (Date.now() - match.turnStartedAt));
    const timer = setTimeout(() => {
      if (turnTimeouts.get(match.matchId) !== timer) return;
      turnTimeouts.delete(match.matchId);
      if (match.status !== "IN_PROGRESS") return;
      if (match.processingMove || match.processingAction) {
        scheduleTurnTimeout(match, 100);
        return;
      }

      const currentRemainingMs = isWhiteTurn
        ? match.whiteTimeMs
        : match.blackTimeMs;
      const elapsedMs =
        match.turnStartedAt === null ? 0 : Date.now() - match.turnStartedAt;
      if (
        currentRemainingMs !== null &&
        currentRemainingMs - elapsedMs > 0
      ) {
        scheduleTurnTimeout(match);
        return;
      }

      const winnerId = isWhiteTurn
        ? match.playerIds[1]
        : match.playerIds[0];
      void finishMatch(match, winnerId, "TIME_OUT").catch(
        (error: unknown) => {
          console.error("Erreur lors du règlement après expiration du temps :", error);
          for (const playerId of match.playerIds) {
            connectedPlayers.get(playerId)?.emit("server_error", {
              message: "Impossible de clôturer la partie après expiration du temps.",
            });
          }
          scheduleTurnTimeout(match, 1_000);
        },
      );
    }, delay);
    turnTimeouts.set(match.matchId, timer);
  };

  const expireReconnectGrace = async (
    match: ActiveMatch,
  ): Promise<boolean> => {
    if (
      match.status !== "IN_PROGRESS" ||
      !match.disconnectedPlayerId ||
      !match.disconnectedAt ||
      Date.now() - match.disconnectedAt.getTime() < RECONNECT_GRACE_MS ||
      match.processingMove ||
      match.processingAction
    ) {
      return false;
    }

    const winnerId = match.playerIds.find(
      (id) => id !== match.disconnectedPlayerId,
    );
    if (!winnerId) return false;
    return finishMatch(match, winnerId, "DISCONNECT_FORFEIT");
  };

  const handleMakeMove = async (
    socket: GameSocket,
    matchId: string,
    rawMove: unknown,
  ): Promise<void> => {
    const match = await loadMatch(matchId);
    const playerId = socket.data.playerId;
    if (!match || !match.playerIds.includes(playerId)) {
      socket.emit("server_error", {
        message: "Vous ne participez pas à cette partie.",
      });
      return;
    }
    if (!isJoinedSocket(socket)) {
      socket.emit("server_error", {
        message: "Reconnectez-vous à la partie pour jouer.",
      });
      return;
    }
    if (match.status !== "IN_PROGRESS") {
      socket.emit("server_error", { message: "Cette partie est terminée." });
      return;
    }
    if (match.processingMove || match.processingAction) {
      socket.emit("server_error", {
        message: "Une action est en cours de validation. Réessayez.",
      });
      return;
    }

    match.processingMove = true;
    try {
      if (match.moves.length === 0 && match.timeControlMinutes && match.whiteTimeMs === null) {
        match.whiteTimeMs = match.timeControlMinutes * 60 * 1000;
        match.blackTimeMs = match.timeControlMinutes * 60 * 1000;
        match.turnStartedAt = Date.now();
      }
      const playerColor = match.playerIds[0] === playerId ? "w" : "b";

      if (match.timeControlMinutes) {
        if (match.whiteTimeMs === null) {
          match.whiteTimeMs = match.timeControlMinutes * 60 * 1000;
          match.blackTimeMs = match.timeControlMinutes * 60 * 1000;
          match.turnStartedAt = Date.now();
        }
        const now = Date.now();
        if (match.turnStartedAt !== null) {
          const elapsed = now - match.turnStartedAt;
          if (playerColor === "w") {
            match.whiteTimeMs = Math.max(0, (match.whiteTimeMs ?? 0) - elapsed);
          } else {
            match.blackTimeMs = Math.max(0, (match.blackTimeMs ?? 0) - elapsed);
          }
        }
        const moverTime = playerColor === "w" ? match.whiteTimeMs : match.blackTimeMs;
        if ((moverTime ?? 0) <= 0) {
          const winnerId = playerColor === "w" ? match.playerIds[1] : match.playerIds[0];
          await finishMatch(match, winnerId, "TIME_OUT");
          return;
        }
      }

      let normalizedMove: OnlinePly;
      let isFinished = false;
      let winnerId: string | null = null;
      // Dames : nul automatique selon le règlement (répétition, 25/40 coups, finales 16/5).
      let autoDraw: AutoDrawRule | null = null;

      if (match.gameType === "CHESS") {
        if (
          !isRecord(rawMove) ||
          typeof rawMove.from !== "string" ||
          !/^[a-h][1-8]$/.test(rawMove.from) ||
          typeof rawMove.to !== "string" ||
          !/^[a-h][1-8]$/.test(rawMove.to) ||
          (rawMove.promotion !== undefined &&
            (typeof rawMove.promotion !== "string" ||
              !["q", "r", "b", "n"].includes(rawMove.promotion)))
        ) {
          socket.emit("server_error", { message: "Coup d’échecs invalide." });
          return;
        }

        const game = new Chess();
        for (const previousMove of match.moves) {
          if (previousMove.kind !== "CHESS") {
            throw new Error("Historique d’échecs invalide.");
          }
          game.move({
            from: previousMove.from as Square,
            to: previousMove.to as Square,
            promotion: previousMove.promotion ?? "q",
          });
        }
        if (game.turn() !== playerColor) {
          socket.emit("server_error", { message: "Ce n’est pas votre tour." });
          return;
        }

        try {
          game.move({
            from: rawMove.from as Square,
            to: rawMove.to as Square,
            promotion: (rawMove.promotion as string | undefined) ?? "q",
          });
        } catch {
          socket.emit("server_error", {
            message: "Ce coup d’échecs est illégal.",
          });
          return;
        }
        normalizedMove = {
          kind: "CHESS",
          from: rawMove.from,
          to: rawMove.to,
          ...(rawMove.promotion
            ? { promotion: rawMove.promotion as string }
            : {}),
        };
        isFinished = game.isGameOver();
        winnerId = isFinished && !game.isDraw() ? playerId : null;
      } else {
        const boardSize = match.draughtsVariant === "ENGLISH" ? 8 : 10;
        const move = parseDraughtsPly(rawMove, boardSize);
        if (!move || move.kind !== "CHECKERS") {
          socket.emit("server_error", { message: "Coup de dames invalide." });
          return;
        }

        const position = rebuildDraughtsPosition(match);
        if (position.turn !== playerColor) {
          socket.emit("server_error", { message: "Ce n’est pas votre tour." });
          return;
        }
        const legalMove = getLegalDraughtsMoves(position).find((candidate) =>
          sameDraughtsMove(candidate, move),
        );
        if (!legalMove) {
          socket.emit("server_error", {
            message: "Ce coup de dames est illégal.",
          });
          return;
        }
        const nextPosition = applyDraughtsMove(position, legalMove);
        normalizedMove = move;
        isFinished = getLegalDraughtsMoves(nextPosition).length === 0;
        winnerId = isFinished ? playerId : null;
        if (!isFinished) {
          const history = [...match.moves, move].filter(
            (ply): ply is Extract<OnlinePly, { kind: "CHECKERS" }> => ply.kind === "CHECKERS",
          );
          const variant = match.draughtsVariant ?? "INTERNATIONAL";
          autoDraw = draughtsDrawVerdict(variant, draughtsDrawState(variant, history), currentDrawRules());
        }
      }

      const moves = [...match.moves, normalizedMove];
      const movesHistory = JSON.parse(
        JSON.stringify(moves),
      ) as Prisma.InputJsonValue;
      await prisma.match.update({
        where: { id: match.matchId },
        data: {
          movesHistory,
        },
      });
       match.moves = moves;
      // Comme sur Lichess : l'offre reste valable pendant le coup de son auteur ;
      // si l'adversaire joue au lieu de répondre, elle est considérée comme refusée.
      if (match.drawOfferById && match.drawOfferById !== playerId) {
        match.lastDrawDecline = { byPlayerId: match.drawOfferById, atPly: match.moves.length - 1 };
        match.drawOfferById = null;
        publishDrawOffer(match);
      }

      match.turnStartedAt = Date.now();

      if (isFinished) {
        if (!(await finishMatch(match, winnerId, "GAME_OVER"))) {
          throw new Error("La partie n’a pas pu être clôturée.");
        }
      } else if (autoDraw) {
        if (!(await finishMatch(match, null, "AUTO_DRAW", autoDraw))) {
          throw new Error("La partie n’a pas pu être clôturée.");
        }
      } else {
        for (const participantId of match.playerIds) {
          connectedPlayers.get(participantId)?.emit("move_accepted", {
            matchId: match.matchId,
            moves: match.moves,
            status: match.status,
             winnerId: match.winnerId,
             drawOfferById: match.drawOfferById,
             whiteTimeMs: match.whiteTimeMs,
             blackTimeMs: match.blackTimeMs,
          });
        }
      }
    } catch (error) {
      console.error("Erreur lors de la validation du coup :", error);
      socket.emit("server_error", {
        message: "Le serveur n’a pas pu valider ce coup.",
      });
    } finally {
      match.processingMove = false;
      if (match.status === "IN_PROGRESS") scheduleTurnTimeout(match);
    }
  };

  const scheduleReconnectExpiry = (
    match: ActiveMatch,
    playerId: string,
    delay: number,
  ): void => {
    const timer = setTimeout(() => {
      if (match.reconnectTimers.get(playerId) !== timer) return;
      if (match.status !== "IN_PROGRESS") {
        match.reconnectTimers.delete(playerId);
        return;
      }
      if (match.processingMove || match.processingAction) {
        scheduleReconnectExpiry(match, playerId, 250);
        return;
      }

      match.reconnectTimers.delete(playerId);
      const opponentId = match.playerIds.find((id) => id !== playerId);
      void expireReconnectGrace(match)
        .then((finished) => {
          if (finished && opponentId) {
            connectedPlayers.get(opponentId)?.emit("player_reconnect_expired", {
              playerId,
            });
          } else if (
            match.status === "IN_PROGRESS" &&
            match.disconnectedPlayerId === playerId &&
            match.disconnectedAt &&
            Date.now() - match.disconnectedAt.getTime() >= RECONNECT_GRACE_MS
          ) {
            scheduleReconnectExpiry(match, playerId, 250);
          }
        })
        .catch((error: unknown) => {
          console.error(
            "Erreur lors du règlement après expiration de la reconnexion :",
            error,
          );
          for (const participantId of match.playerIds) {
            connectedPlayers.get(participantId)?.emit("server_error", {
              message: "Impossible de clôturer la partie après la déconnexion.",
            });
          }
          scheduleReconnectExpiry(match, playerId, 1_000);
        });
    }, delay);
    match.reconnectTimers.set(playerId, timer);
  };

  const startReconnectGrace = async (
    socket: GameSocket,
    match: ActiveMatch,
  ): Promise<boolean> => {
    const playerId = socket.data.playerId;
    if (
      match.status !== "IN_PROGRESS" ||
      !match.playerIds.includes(playerId) ||
      !isJoinedSocket(socket)
    ) {
      return false;
    }

    if (joinedMatchSockets.get(playerId) === socket.id) {
      joinedMatchSockets.delete(playerId);
    }
    socketJoinedMatches.delete(socket.id);
    void socket.leave(match.matchId);
    if (match.reconnectTimers.has(playerId)) return true;

    const disconnectedAt = new Date();
    match.disconnectedPlayerId = playerId;
    match.disconnectedAt = disconnectedAt;
    if (match.drawOfferById) {
      match.drawOfferById = null;
      publishDrawOffer(match);
    }
    await prisma.match.updateMany({
      where: { id: match.matchId, status: MatchStatus.IN_PROGRESS },
      data: {
        disconnectedPlayerId: playerId,
        disconnectedAt,
      },
    });

    const opponentId = match.playerIds.find((id) => id !== playerId);
    if (opponentId) {
      connectedPlayers.get(opponentId)?.emit("player_disconnected", {
        playerId,
        gracePeriodMs: RECONNECT_GRACE_MS,
      });
    }
    scheduleReconnectExpiry(match, playerId, RECONNECT_GRACE_MS);
    return true;
  };

  const handleResign = async (
    socket: GameSocket,
    matchId: string,
  ): Promise<void> => {
    const match = await loadMatch(matchId);
    const playerId = socket.data.playerId;
    if (!match || !match.playerIds.includes(playerId)) {
      socket.emit("server_error", {
        message: "Vous ne participez pas à cette partie.",
      });
      return;
    }
    if (!isJoinedSocket(socket)) {
      socket.emit("server_error", {
        message: "Reconnectez-vous à la partie pour abandonner.",
      });
      return;
    }
    if (match.processingMove || match.processingAction) {
      socket.emit("server_error", {
        message: "Une action est en cours de validation. Réessayez.",
      });
      return;
    }
    const winnerId = match.playerIds.find((id) => id !== playerId) ?? null;
    if (!(await finishMatch(match, winnerId, "RESIGNATION"))) {
      socket.emit("server_error", { message: "Cette partie est déjà terminée." });
    }
  };

  /**
   * Abandon, à la demande explicite du joueur, de toutes ses parties en cours
   * (bouton « Quitter ma partie » ou demande de sortie acceptée). Même chemin
   * que l'abandon en partie : annulation sans conséquence avant le seuil de
   * coups, sinon défaite réglée par settleMatch.
   */
  const forfeitPlayerGames = async (playerId: string): Promise<{ ended: number; remaining: number }> => {
    const where = {
      status: MatchStatus.IN_PROGRESS,
      OR: [{ playerWhiteId: playerId }, { playerBlackId: playerId }],
    };
    const rows = await prisma.match.findMany({ where, select: { id: true } });
    let ended = 0;
    for (const { id } of rows) {
      const match = await loadMatch(id);
      if (!match) {
        // Partie sans adversaire enregistré : simple annulation.
        if ((await abortMatch(id)).aborted) ended += 1;
        continue;
      }
      // Un coup en cours de validation se termine en quelques millisecondes.
      for (let attempt = 0; attempt < 40 && match.status === "IN_PROGRESS"; attempt += 1) {
        if (!match.processingMove && !match.processingAction) {
          const winnerId = match.playerIds.find((id) => id !== playerId) ?? null;
          if (await finishMatch(match, winnerId, "RESIGNATION")) {
            ended += 1;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return { ended, remaining: await prisma.match.count({ where }) };
  };
  (globalThis as { __thotForfeitPlayerGames?: typeof forfeitPlayerGames }).__thotForfeitPlayerGames =
    forfeitPlayerGames;

  const cancelRematchRequest = (matchId: string, playerId: string): void => {
    const requests = rematchRequests.get(matchId);
    if (!requests?.delete(playerId)) return;
    const waitingPlayers = [...requests];
    const timer = rematchTimers.get(matchId);
    if (timer) clearTimeout(timer);
    rematchTimers.delete(matchId);
    rematchRequests.delete(matchId);
    for (const waitingPlayerId of waitingPlayers) {
      connectedPlayers.get(waitingPlayerId)?.emit("rematch_expired", { matchId });
    }
  };

  const requestRematch = async (
    socket: GameSocket,
    matchId: string,
  ): Promise<void> => {
    const match = await loadMatch(matchId);
    const playerId = socket.data.playerId;
    if (!match || !match.playerIds.includes(playerId)) {
      socket.emit("server_error", {
        message: "Vous ne participez pas à cette partie.",
      });
      return;
    }
    if (match.status !== "FINISHED" && match.status !== "ABANDONED") {
      socket.emit("server_error", {
        message: "Cette partie doit être terminée avant de la relancer.",
      });
      return;
    }
    if (match.tournamentId) {
      socket.emit("server_error", {
        message: "Pas de revanche dans un tournoi : la suite se joue depuis la page du tournoi.",
      });
      return;
    }
    try {
      await assertCanStartGame(playerId, match.mode, "rematch");
    } catch (error) {
      if (error instanceof QuotaReachedError) {
        socket.emit("quota_reached", serializeQuota(error.status));
        socket.emit("server_error", { message: error.message });
        return;
      }
      console.error("Vérification du quota impossible :", error);
    }

    let requests = rematchRequests.get(matchId);
    if (!requests) {
      requests = new Set();
      rematchRequests.set(matchId, requests);
      const timer = setTimeout(() => {
        rematchTimers.delete(matchId);
        const waitingPlayers = rematchRequests.get(matchId);
        rematchRequests.delete(matchId);
        for (const waitingPlayerId of waitingPlayers ?? []) {
          connectedPlayers.get(waitingPlayerId)?.emit("rematch_expired", {
            matchId,
          });
        }
      }, RECONNECT_GRACE_MS);
      rematchTimers.set(matchId, timer);
    }
    requests.add(playerId);
    socket.emit("rematch_waiting", { matchId });

    const opponentId = match.playerIds.find((id) => id !== playerId);
    if (
      requests.size !== 2 ||
      !opponentId ||
      !connectedPlayers.has(opponentId) ||
      rematchesBeingCreated.has(matchId)
    ) {
      return;
    }

    rematchesBeingCreated.add(matchId);
    const timer = rematchTimers.get(matchId);
    if (timer) clearTimeout(timer);
    rematchTimers.delete(matchId);
    rematchRequests.delete(matchId);
    try {
      const { id: nextMatchId } = await prisma.$transaction(async (tx) => {
        const created = await tx.match.create({
        data: {
          mode: match.mode,
          rated: match.mode === "RATED",
          stakeAmount: match.mode === "MONEY" ? match.stakeAmount : null,
          playerWhiteId: match.playerIds[1],
          playerBlackId: match.playerIds[0],
          gameType:
            match.gameType === "CHESS"
              ? PrismaGameType.CHESS
              : PrismaGameType.CHECKERS,
           draughtsVariant:
             match.gameType === "CHECKERS"
               ? match.draughtsVariant === "ENGLISH"
                 ? PrismaDraughtsVariant.ENGLISH
                 : PrismaDraughtsVariant.INTERNATIONAL
               : null,
           movesHistory: [],
           status: MatchStatus.IN_PROGRESS,
           timeControlMinutes: match.timeControlMinutes,
           // Même affront : la série de revanches permet d'afficher le score de la session.
           rematchOfId: matchId,
         },
        select: { id: true },
        });
        // Revanche rémunérée : nouvelles mises bloquées, avec les mêmes contrôles.
        if (match.mode === "MONEY" && match.stakeAmount) {
          await lockMoneyMatchStakes(tx, {
            matchId: created.id,
            playerIds: [match.playerIds[1], match.playerIds[0]],
            stake: match.stakeAmount,
          });
        }
        return created;
      });
      const nextMatch: ActiveMatch = {
        matchId: nextMatchId,
        gameType: match.gameType,
        playerIds: [match.playerIds[1], match.playerIds[0]],
        usernames: [match.usernames[1], match.usernames[0]],
         draughtsVariant: match.draughtsVariant,
         timeControlMinutes: match.timeControlMinutes,
         mode: match.mode,
         stakeAmount: match.stakeAmount,
         tournamentId: null,
         whiteMoneyChange: null,
         blackMoneyChange: null,
         moves: [],
        status: "IN_PROGRESS",
        winnerId: null,
        scoreDelta: null,
        whitePointsChange: null,
        blackPointsChange: null,
        whitePointsBalance: match.blackPointsBalance,
        blackPointsBalance: match.whitePointsBalance,
        whiteEloChange: null,
        blackEloChange: null,
        whiteEloBalance: match.blackEloBalance,
        blackEloBalance: match.whiteEloBalance,
        betEnabled: false,
        betAmount: 0,
        betStatus: null,
        betProposedById: null,
        drawOfferById: null,
      lastDrawDecline: null,
       timeProposal: null,
       timeProposalBy: null,
       whiteTimeMs: null,
       blackTimeMs: null,
       turnStartedAt: null,
        disconnectedPlayerId: null,
        disconnectedAt: null,
        processingMove: false,
        processingAction: false,
        reconnectTimers: new Map(),
      joinedPlayerIds: new Set(),
      noShowTimer: null,
      chatHistory: [],
      };
      matches.set(nextMatchId, nextMatch);
      for (const participantId of match.playerIds) {
        const participantSocket = connectedPlayers.get(participantId);
        if (!participantSocket) continue;
        sendMatchState(participantSocket, nextMatch);
        participantSocket.emit("rematch_started", {
          previousMatchId: matchId,
          matchId: nextMatchId,
        });
      }
    } catch (error) {
      for (const participantId of match.playerIds) {
        connectedPlayers.get(participantId)?.emit("server_error", {
          message:
            error instanceof MoneyEligibilityError
              ? `Revanche impossible : ${error.message}`
              : "Impossible de relancer cette partie. Réessayez.",
        });
      }
      if (error instanceof MoneyEligibilityError) return;
      throw error;
    } finally {
      rematchesBeingCreated.delete(matchId);
    }
  };

  const lookupPoolRating = async (
    userId: string,
    gameType: "CHESS" | "CHECKERS",
    draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null,
    timeControlMinutes: number | null,
  ): Promise<number> => {
    const { cadences } = await loadRatingSettings();
    const pool = await prisma.playerRating.findFirst({
      where: {
        userId,
        variant: ratingVariantOf(gameType, draughtsVariant),
        timeControl: cadenceOf(timeControlMinutes, cadences),
      },
      select: { eloRating: true },
    });
    if (pool) return pool.eloRating;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { elo: true } });
    return user?.elo ?? 1200;
  };

  const requeueAfterFailure = async (entries: QueueEntry[]) => {
    for (const entry of entries) {
      const entrySocket = connectedPlayers.get(entry.playerId);
      if (!entrySocket) {
        await matchmaking.finalizeMatch(entry.playerId);
        continue;
      }
      await matchmaking.requeueFrontIfConnected(entry.playerId, entry, () =>
        connectedPlayers.has(entry.playerId),
      );
      entrySocket.emit("queue_joined", {
        gameType: entry.gameType,
        strategy: entry.strategy,
        mode: entry.mode,
        stake: entry.stake,
      });
    }
  };

  /**
   * Crée la partie entre deux joueurs réservés par la file. Le joueur qui
   * attendait (opponent) prend les blancs. En mode rémunéré, les deux mises
   * sont bloquées dans la MÊME transaction que la création de la partie.
   */
  const startPairedMatch = async (self: QueueEntry, opponent: QueueEntry): Promise<void> => {
    const selfSocket = connectedPlayers.get(self.playerId);
    const opponentSocket = connectedPlayers.get(opponent.playerId);
    if (!selfSocket || !opponentSocket) {
      await matchmaking.finalizeMatch(self.playerId);
      await matchmaking.finalizeMatch(opponent.playerId);
      await requeueAfterFailure([self, opponent].filter((e) => connectedPlayers.has(e.playerId)));
      return;
    }

    type CreatedMatch = {
      id: string;
      playerWhite: { pointsFree: number };
      playerBlack: { pointsFree: number } | null;
    };
    let createdMatch: CreatedMatch;
    try {
      createdMatch = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        const created = await tx.match.create({
          data: {
            playerWhiteId: opponent.playerId,
            playerBlackId: self.playerId,
            gameType: self.gameType === "CHESS" ? PrismaGameType.CHESS : PrismaGameType.CHECKERS,
            draughtsVariant:
              self.gameType === "CHECKERS"
                ? self.draughtsVariant === "ENGLISH"
                  ? PrismaDraughtsVariant.ENGLISH
                  : PrismaDraughtsVariant.INTERNATIONAL
                : null,
            movesHistory: [],
            mode: self.mode,
            rated: self.mode === "RATED",
            stakeAmount: self.mode === "MONEY" ? self.stake : null,
            timeControlMinutes: self.timeControlMinutes,
            status: MatchStatus.IN_PROGRESS,
          },
          select: {
            id: true,
            playerWhite: { select: { pointsFree: true } },
            playerBlack: { select: { pointsFree: true } },
          },
        });
        if (self.mode === "MONEY" && self.stake) {
          await lockMoneyMatchStakes(tx, {
            matchId: created.id,
            playerIds: [opponent.playerId, self.playerId],
            stake: self.stake,
          });
        }
        return created;
      }, { isolationLevel: "Serializable" }));
    } catch (error) {
      await matchmaking.finalizeMatch(self.playerId);
      await matchmaking.finalizeMatch(opponent.playerId);
      if (error instanceof MoneyEligibilityError) {
        // Ne pas réapparier immédiatement les mêmes joueurs.
        matchmaking.recordPairing(self.playerId, opponent.playerId);
        for (const entry of [self, opponent]) {
          connectedPlayers.get(entry.playerId)?.emit("server_error", { message: error.message });
        }
      } else {
        console.error("Erreur lors de la création du match en ligne :", error);
        for (const entry of [self, opponent]) {
          connectedPlayers.get(entry.playerId)?.emit("server_error", {
            message: "Impossible de créer la partie. Réessayez.",
          });
        }
      }
      await requeueAfterFailure([self, opponent]);
      return;
    }

    const matchId = createdMatch.id;
    await matchmaking.finalizeMatch(self.playerId);
    await matchmaking.finalizeMatch(opponent.playerId);
    matchmaking.recordPairing(self.playerId, opponent.playerId);

    if (
      !connectedPlayers.has(self.playerId) ||
      !connectedPlayers.has(opponent.playerId) ||
      !createdMatch.playerBlack
    ) {
      // Un joueur est parti entre-temps : annulation propre (mises rendues).
      await abortMatch(matchId).catch((error) => console.error("Annulation impossible :", error));
      await requeueAfterFailure([self, opponent].filter((e) => connectedPlayers.has(e.playerId)));
      return;
    }

    const match: ActiveMatch = {
      matchId,
      gameType: self.gameType,
      playerIds: [opponent.playerId, self.playerId],
      usernames: [opponentSocket.data.profile.username, selfSocket.data.profile.username],
      draughtsVariant: self.gameType === "CHECKERS" ? self.draughtsVariant : null,
      timeControlMinutes: self.timeControlMinutes,
      mode: self.mode,
      stakeAmount: self.mode === "MONEY" ? self.stake : null,
      tournamentId: null,
      whiteMoneyChange: null,
      blackMoneyChange: null,
      moves: [],
      status: "IN_PROGRESS",
      winnerId: null,
      scoreDelta: null,
      whitePointsChange: null,
      blackPointsChange: null,
      whitePointsBalance: createdMatch.playerWhite.pointsFree,
      blackPointsBalance: createdMatch.playerBlack.pointsFree,
      whiteEloChange: null,
      blackEloChange: null,
      whiteEloBalance: opponent.rating,
      blackEloBalance: self.rating,
      betEnabled: false,
      betAmount: 0,
      betStatus: null,
      betProposedById: null,
      drawOfferById: null,
      lastDrawDecline: null,
      timeProposal: null,
      timeProposalBy: null,
      whiteTimeMs: null,
      blackTimeMs: null,
      turnStartedAt: null,
      disconnectedPlayerId: null,
      disconnectedAt: null,
      processingMove: false,
      processingAction: false,
      reconnectTimers: new Map(),
      joinedPlayerIds: new Set(),
      noShowTimer: null,
      chatHistory: [],
    };
    matches.set(matchId, match);
    void selfSocket.join(matchId);
    void opponentSocket.join(matchId);
    selfSocket.emit("match_found", {
      matchId,
      gameType: self.gameType,
      opponentId: opponent.playerId,
      mode: self.mode,
    });
    opponentSocket.emit("match_found", {
      matchId,
      gameType: self.gameType,
      opponentId: self.playerId,
      mode: self.mode,
    });
  };

  // Balayage périodique : la tolérance ELO s'élargit avec l'attente.
  let lastStats = "";
  let sweeping = false;
  const sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void (async () => {
      const rules = await getSettings([
        "matchmaking.eloToleranceBase",
        "matchmaking.eloToleranceGrowthPerSec",
        "matchmaking.eloToleranceMax",
        "matchmaking.casualUsesElo",
        "matchmaking.avoidRepeatSeconds",
      ] as const);
      matchmaking.setRules({
        eloToleranceBase: rules["matchmaking.eloToleranceBase"],
        eloToleranceGrowthPerSec: rules["matchmaking.eloToleranceGrowthPerSec"],
        eloToleranceMax: rules["matchmaking.eloToleranceMax"],
        casualUsesElo: rules["matchmaking.casualUsesElo"],
        avoidRepeatSeconds: rules["matchmaking.avoidRepeatSeconds"],
      });
      const pairs = await matchmaking.sweep();
      for (const pair of pairs) await startPairedMatch(pair.self, pair.opponent);
      const serialized = JSON.stringify(matchmaking.stats());
      if (serialized !== lastStats) {
        lastStats = serialized;
        io.emit("queue_stats", { waiting: JSON.parse(serialized) });
      }
    })()
      .catch((error) => console.error("Erreur du balayage de matchmaking :", error))
      .finally(() => {
        sweeping = false;
      });
  }, 2_000);
  sweepTimer.unref?.();

  /**
   * Partie de tournoi : si un seul joueur a rejoint la partie au bout du délai
   * configuré, il gagne par forfait (le tournoi ne reste jamais bloqué).
   */
  const scheduleNoShowForfeit = (match: ActiveMatch): void => {
    if (!match.tournamentId || match.status !== "IN_PROGRESS") return;
    if (match.joinedPlayerIds.size >= 2) {
      if (match.noShowTimer) clearTimeout(match.noShowTimer);
      match.noShowTimer = null;
      return;
    }
    if (match.noShowTimer || match.moves.length > 0) return;
    const minutes = peekSetting("tournaments.noShowForfeitMinutes");
    if (!minutes) return;
    match.noShowTimer = setTimeout(() => {
      match.noShowTimer = null;
      if (match.status !== "IN_PROGRESS" || match.joinedPlayerIds.size !== 1 || match.moves.length > 0) return;
      const presentId = [...match.joinedPlayerIds][0]!;
      void finishMatch(match, presentId, "NO_SHOW").catch((error: unknown) =>
        console.error("Forfait pour absence impossible :", error),
      );
    }, minutes * 60_000);
    match.noShowTimer.unref?.();
  };

  // Arrêt automatique des Survival arrivés au terme de leur durée.
  const survivalTimer = setInterval(() => {
    void closeExpiredTimedTournaments().catch((error: unknown) =>
      console.error("Clôture périodique des Survival impossible :", error),
    );
  }, 5 * 60_000);
  survivalTimer.unref?.();

  // Défis entre amis : expiration des défis sans réponse et annulation (sans conséquence)
  // des parties acceptées que personne n'a commencées.
  const challengeTimer = setInterval(() => {
    void (async () => {
      await expireChallenges();
      const stale = [...(await staleChallengeMatchIds()), ...(await staleInterclubMatchIds())];
      for (const matchId of stale) {
        const active = matches.get(matchId);
        if (active) {
          if (active.moves.length === 0 && active.joinedPlayerIds.size < 2) {
            await finishMatch(active, null, "DISCONNECT_FORFEIT");
          }
        } else {
          await abortMatch(matchId);
        }
      }
    })().catch((error: unknown) => console.error("Nettoyage des défis impossible :", error));
  }, 60_000);
  challengeTimer.unref?.();

  const onConnection = (socket: GameSocket): void => {
    const { playerId } = socket.data;
    const previousSocket = connectedPlayers.get(playerId);

    if (previousSocket && previousSocket.id !== socket.id) {
      previousSocket.disconnect(true);
    }
    connectedPlayers.set(playerId, socket);
    publishPresence();
    const chatTimestamps: number[] = [];

    socket.on("join_queue", async (payload) => {
      if (!isRecord(payload) || !isGameType(payload.gameType)) {
        socket.emit("server_error", { message: "Type de jeu invalide." });
        return;
      }

      // Mode explicite : jamais déduit du solde du joueur.
      const requestedMode: GameMode =
        payload.mode === "CASUAL" || payload.mode === "RATED" || payload.mode === "MONEY"
          ? payload.mode
          : payload.isPaid === true
            ? "MONEY"
            : payload.rated === true
              ? "RATED"
              : "CASUAL";

      let activeMatch = findMatchForPlayer(playerId);
      if (!activeMatch) {
        try {
          const storedMatch = await prisma.match.findFirst({
            where: {
              status: MatchStatus.IN_PROGRESS,
              OR: [{ playerWhiteId: playerId }, { playerBlackId: playerId }],
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (storedMatch) activeMatch = await loadMatch(storedMatch.id) ?? undefined;
        } catch (error) {
          console.error("Erreur lors de la vérification des parties actives :", error);
          socket.emit("server_error", {
            message: "Impossible de vérifier si vous avez une partie en cours.",
          });
          return;
        }
      }

      if (
        activeMatch?.disconnectedAt &&
        Date.now() - activeMatch.disconnectedAt.getTime() >= RECONNECT_GRACE_MS
      ) {
        try {
          await expireReconnectGrace(activeMatch);
        } catch (error) {
          console.error("Erreur lors de la clôture du délai de reconnexion :", error);
          socket.emit("server_error", {
            message: "Impossible de clôturer la partie après le délai de reconnexion.",
          });
          return;
        }
        activeMatch = findMatchForPlayer(playerId);
      }
      if (activeMatch) {
        const opponentIndex = activeMatch.playerIds.indexOf(playerId) === 0 ? 1 : 0;
        socket.emit("active_match_conflict", {
          matchId: activeMatch.matchId,
          opponentUsername: activeMatch.usernames[opponentIndex],
          disconnectedPlayerId: activeMatch.disconnectedPlayerId,
          gracePeriodMs: activeMatch.disconnectedAt
            ? Math.max(
                0,
                RECONNECT_GRACE_MS -
                  (Date.now() - activeMatch.disconnectedAt.getTime()),
              )
            : 0,
        });
        return;
      }

      const strategy =
        payload.strategy === undefined ? "RANDOM" : payload.strategy;
      if (strategy !== "RANDOM" && strategy !== "TARGETED") {
        socket.emit("server_error", { message: "Mode de recherche invalide." });
        return;
      }
      const criteria = parseCriteria(payload.criteria);
      if (!criteria) {
        socket.emit("server_error", {
          message: "Les critères de recherche sont invalides.",
        });
        return;
      }

      const queueSettings = await getSettings([
        "matchmaking.casualEnabled",
        "matchmaking.ratedEnabled",
        "matchmaking.timeControlMin",
        "matchmaking.timeControlMax",
      ] as const);
      if (requestedMode === "CASUAL" && !queueSettings["matchmaking.casualEnabled"]) {
        socket.emit("server_error", { message: "Les parties amicales sont momentanément fermées." });
        return;
      }
      if (requestedMode === "RATED" && !queueSettings["matchmaking.ratedEnabled"]) {
        socket.emit("server_error", { message: "Les parties classées sont momentanément fermées." });
        return;
      }

      const rawTime = payload.timeControlMinutes;
      const timeControlMinutes =
        typeof rawTime === "number" &&
        Number.isInteger(rawTime) &&
        rawTime >= queueSettings["matchmaking.timeControlMin"] &&
        rawTime <= queueSettings["matchmaking.timeControlMax"]
          ? rawTime
          : null;

      // Quota quotidien de l'offre gratuite : vérifié au lancement seulement,
      // jamais pendant une partie (aucune partie commencée n'est interrompue).
      try {
        await assertCanStartGame(playerId, requestedMode, "queue");
      } catch (error) {
        if (error instanceof QuotaReachedError) {
          socket.emit("quota_reached", serializeQuota(error.status));
          socket.emit("server_error", { message: error.message });
          return;
        }
        console.error("Vérification du quota impossible :", error);
      }

      let stake: number | null = null;
      if (requestedMode === "MONEY") {
        stake = typeof payload.stake === "number" ? payload.stake : NaN;
        try {
          await assertCanQueueForMoney(playerId, stake);
        } catch (error) {
          socket.emit("server_error", {
            message:
              error instanceof MoneyEligibilityError
                ? error.message
                : "Impossible de vérifier votre éligibilité au mode rémunéré.",
          });
          return;
        }
      }

      const draughtsVariant =
        payload.gameType === "CHECKERS"
          ? payload.draughtsVariant === "ENGLISH" || payload.draughtsVariant === "INTERNATIONAL"
            ? payload.draughtsVariant
            : socket.data.profile.draughtsVariant
          : null;

      let rating = 1200;
      try {
        rating = await lookupPoolRating(playerId, payload.gameType, draughtsVariant, timeControlMinutes);
      } catch (error) {
        console.error("Lecture du classement impossible :", error);
      }

      const entry: QueueEntry = {
        playerId,
        gameType: payload.gameType,
        draughtsVariant,
        mode: requestedMode,
        stake,
        rating,
        strategy,
        criteria,
        timeControlMinutes,
        profile: socket.data.profile,
        enqueuedAt: Date.now(),
      };

      const result = await matchmaking.enqueue(entry);
      if (result.status === "queued") {
        socket.emit("queue_joined", {
          gameType: payload.gameType,
          strategy,
          mode: requestedMode,
          stake,
        });
        return;
      }
      await startPairedMatch(result.self, result.opponent);
    });

    socket.on("leave_queue", () => {
      void matchmaking.remove(playerId);
      socket.emit("queue_left");
    });

    socket.on("join_match", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string") {
        socket.emit("server_error", { message: "Identifiant de partie invalide." });
        return;
      }

      void loadMatch(payload.matchId)
        .then(async (match) => {
          if (!match || !match.playerIds.includes(playerId)) {
            socket.emit("server_error", {
              message: "Vous ne participez pas à cette partie.",
            });
            return;
          }
          if (match.status !== "IN_PROGRESS") {
            sendMatchState(socket, match);
            return;
          }
          if (
            match.disconnectedPlayerId &&
            match.disconnectedAt &&
            Date.now() - match.disconnectedAt.getTime() >= RECONNECT_GRACE_MS
          ) {
            await expireReconnectGrace(match);
            socket.emit("server_error", {
              message: "Le délai de reconnexion est expiré. Cette partie est clôturée.",
            });
            return;
          }
          void socket.join(match.matchId);
          const timer = match.reconnectTimers.get(playerId);
          if (timer) {
            clearTimeout(timer);
            match.reconnectTimers.delete(playerId);
          }
          await prisma.match.updateMany({
            where: {
              id: match.matchId,
              disconnectedPlayerId: playerId,
            },
            data: { disconnectedPlayerId: null, disconnectedAt: null },
          });
          if (match.disconnectedPlayerId === playerId) {
            match.disconnectedPlayerId = null;
            match.disconnectedAt = null;
          } else if (match.disconnectedPlayerId && match.disconnectedAt) {
            socket.emit("player_disconnected", {
              playerId: match.disconnectedPlayerId,
              gracePeriodMs: Math.max(
                0,
                RECONNECT_GRACE_MS -
                  (Date.now() - match.disconnectedAt.getTime()),
              ),
            });
          }
          joinedMatchSockets.set(playerId, socket.id);
          socketJoinedMatches.set(socket.id, match.matchId);
          sendMatchState(socket, match);
          if (match.chatHistory.length > 0) {
            socket.emit("chat_history", { matchId: match.matchId, messages: match.chatHistory });
          }
          match.joinedPlayerIds.add(playerId);
          scheduleNoShowForfeit(match);
          const opponentId = match.playerIds.find((id) => id !== playerId);
          if (opponentId) {
            connectedPlayers
              .get(opponentId)
              ?.emit("player_reconnected", { playerId });
          }
        })
        .catch((error: unknown) => {
          console.error("Erreur lors du chargement du match :", error);
          socket.emit("server_error", {
            message: "Impossible de charger cette partie.",
          });
        });
    });

    socket.on("make_move", (payload) => {
      if (
        !isRecord(payload) ||
        typeof payload.matchId !== "string" ||
        !Object.hasOwn(payload, "move")
      ) {
        socket.emit("server_error", { message: "Coup invalide." });
        return;
      }

      void handleMakeMove(socket, payload.matchId, payload.move);
    });

    socket.on("request_rematch", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string") {
        socket.emit("server_error", {
          message: "Demande de nouvelle partie invalide.",
        });
        return;
      }
      void requestRematch(socket, payload.matchId).catch((error: unknown) => {
        console.error("Erreur lors de la création de la revanche :", error);
        rematchesBeingCreated.delete(payload.matchId as string);
        const timer = rematchTimers.get(payload.matchId as string);
        if (timer) clearTimeout(timer);
        rematchTimers.delete(payload.matchId as string);
        rematchRequests.delete(payload.matchId as string);
        for (const participantId of [playerId]) {
          connectedPlayers.get(participantId)?.emit("server_error", {
            message: "Impossible de relancer cette partie. Réessayez.",
          });
        }
      });
    });

    socket.on("cancel_rematch", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string") {
        socket.emit("server_error", {
          message: "Annulation de la revanche invalide.",
        });
        return;
      }
      cancelRematchRequest(payload.matchId, playerId);
    });

    socket.on("propose_bet", async (payload) => {
      if (
        !isRecord(payload) ||
        typeof payload.matchId !== "string" ||
        typeof payload.amount !== "number" ||
        !Number.isInteger(payload.amount)
      ) {
        socket.emit("server_error", { message: "Proposition de mise invalide." });
        return;
      }
      const match = matches.get(payload.matchId);
      if (!match) {
        socket.emit("server_error", { message: "Partie introuvable." });
        return;
      }
      if (!match.playerIds.includes(playerId)) {
        socket.emit("server_error", { message: "Vous ne participez pas à cette partie." });
        return;
      }
      if (match.moves.length > 0) {
        socket.emit("server_error", { message: "La mise ne peut être proposée qu'avant le premier coup." });
        return;
      }
      if (match.drawOfferById) {
        socket.emit("server_error", { message: "Une demande de nul est déjà en cours." });
        return;
      }
      if (match.mode === "MONEY") {
        socket.emit("server_error", {
          message: "Une partie rémunérée a déjà une mise fixée : aucun défi supplémentaire possible.",
        });
        return;
      }
      if (match.tournamentId) {
        socket.emit("server_error", { message: "Pas de défi en points pendant une partie de tournoi." });
        return;
      }
      if (!peekSetting("points.classic.friendlyStakesEnabled")) {
        socket.emit("server_error", { message: "Les défis en points classiques sont désactivés." });
        return;
      }
      const maxFriendlyStake = peekSetting("points.classic.friendlyStakeMax");
      if (payload.amount < 1 || payload.amount > maxFriendlyStake) {
        socket.emit("server_error", {
          message: `Le défi doit être compris entre 1 et ${maxFriendlyStake} points classiques.`,
        });
        return;
      }
      if (
        match.betStatus &&
        match.betStatus !== "REJECTED" &&
        match.betStatus !== "EXPIRED"
      ) {
        socket.emit("server_error", {
          message: "Une mise est déjà en cours sur cette partie.",
        });
        return;
      }
      const amount = payload.amount;
      const opponentId = match.playerIds.find((id) => id !== playerId);
      if (!opponentId) return;

      try {
        await prisma.$transaction(async (transaction) => {
          const storedMatch = await transaction.match.findUnique({
            where: { id: match.matchId },
            select: { status: true, movesHistory: true },
          });
          if (
            storedMatch?.status !== MatchStatus.IN_PROGRESS ||
            !Array.isArray(storedMatch.movesHistory) ||
            storedMatch.movesHistory.length > 0
          ) {
            throw new Error("BET_NOT_PROPOSABLE");
          }
          const proposer = await transaction.user.findUnique({
            where: { id: playerId },
            select: { pointsFree: true },
          });
          if (!proposer || proposer.pointsFree < amount) {
            throw new InsufficientBetBalanceError();
          }

          await transaction.gameBet.upsert({
            where: { matchId: match.matchId },
            create: {
              matchId: match.matchId,
              proposerId: playerId,
              opponentId,
              amount,
              status: "PROPOSED",
            },
            update: {
              proposerId: playerId,
              opponentId,
              amount,
              status: "PROPOSED",
              acceptedAt: null,
              settledAt: null,
              counterProposal: null,
              counterProposedBy: null,
            },
          });
          await transaction.match.update({
            where: { id: match.matchId },
            data: {
              betEnabled: true,
              betAmount: amount,
              betStatus: "PROPOSED",
              betProposedById: playerId,
              betAcceptedAt: null,
              betSettledAt: null,
            },
          });
        });
        match.betEnabled = true;
        match.betAmount = amount;
        match.betStatus = "PROPOSED";
        match.betProposedById = playerId;
        io.to(payload.matchId).emit("bet_proposed", {
          matchId: payload.matchId,
          amount,
          by: playerId,
        });
      } catch (error) {
        if (error instanceof InsufficientBetBalanceError) {
          socket.emit("server_error", {
            message: "Solde insuffisant pour proposer cette mise.",
          });
          return;
        }
        if (error instanceof Error && error.message === "BET_NOT_PROPOSABLE") {
          socket.emit("server_error", {
            message: "La mise ne peut être proposée qu’avant le premier coup.",
          });
          return;
        }
        console.error("Erreur lors de l’enregistrement de la mise :", error);
        socket.emit("server_error", {
          message: "Impossible d’enregistrer la proposition de mise.",
        });
      }
    });

    socket.on("accept_bet", async (payload) => {
      if (
        !isRecord(payload) ||
        typeof payload.matchId !== "string"
      ) {
        socket.emit("server_error", { message: "Acceptation de mise invalide." });
        return;
      }
      const match = matches.get(payload.matchId);
      if (!match) {
        socket.emit("server_error", { message: "Partie introuvable." });
        return;
      }
      if (!match.playerIds.includes(playerId)) {
        socket.emit("server_error", { message: "Vous ne participez pas à cette partie." });
        return;
      }
      if (
        !match.betEnabled ||
        (match.betStatus !== "PROPOSED" && match.betStatus !== "COUNTERED") ||
        !match.betAmount
      ) {
        socket.emit("server_error", { message: "Aucune mise en attente sur cette partie." });
        return;
      }
      if (match.betProposedById === playerId) {
        socket.emit("server_error", { message: "Vous ne pouvez pas accepter votre propre mise." });
        return;
      }
      try {
        const accepted = await prisma.$transaction(async (transaction) => {
          const storedMatch = await transaction.match.findUnique({
            where: { id: match.matchId },
            select: { status: true, movesHistory: true },
          });
          if (
            storedMatch?.status !== MatchStatus.IN_PROGRESS ||
            !Array.isArray(storedMatch.movesHistory) ||
            storedMatch.movesHistory.length > 0
          ) {
            throw new Error("BET_NOT_OPEN");
          }
          const bet = await transaction.gameBet.findUnique({
            where: { matchId: match.matchId },
          });
          if (
            !bet ||
            (bet.status !== "PROPOSED" && bet.status !== "COUNTERED")
          ) {
            throw new Error("BET_NOT_PENDING");
          }
          const amount =
            bet.status === "COUNTERED" ? bet.counterProposal : bet.amount;
          const proposerId =
            bet.status === "COUNTERED"
              ? bet.counterProposedBy
              : bet.proposerId;
          if (!amount || !proposerId || proposerId === playerId) {
            throw new Error("BET_NOT_ACCEPTABLE");
          }
          const claimed = await transaction.gameBet.updateMany({
            where: { id: bet.id, status: bet.status },
            data: {
              amount,
              status: "ACCEPTED",
              acceptedAt: new Date(),
            },
          });
          if (claimed.count !== 1) throw new Error("BET_NOT_PENDING");

          const balances = await escrowGameBet(transaction, {
            betId: bet.id,
            matchId: match.matchId,
            playerIds: match.playerIds,
            amount,
          });
          await transaction.match.update({
            where: { id: match.matchId },
            data: {
              betEnabled: true,
              betAmount: amount,
              betStatus: "ACCEPTED",
              betProposedById: proposerId,
              betAcceptedAt: new Date(),
            },
          });
          return { amount, proposerId, balances };
        });
        match.betEnabled = true;
        match.betAmount = accepted.amount;
        match.betStatus = "ACCEPTED";
        match.betProposedById = accepted.proposerId;
        match.whitePointsBalance =
          accepted.balances.get(match.playerIds[0]) ?? match.whitePointsBalance;
        match.blackPointsBalance =
          accepted.balances.get(match.playerIds[1]) ?? match.blackPointsBalance;
        io.to(payload.matchId).emit("bet_accepted", {
          matchId: payload.matchId,
          amount: accepted.amount,
          by: playerId,
        });
      } catch (error) {
        if (error instanceof InsufficientBetBalanceError) {
          socket.emit("server_error", {
            message: "Solde insuffisant pour bloquer les deux mises.",
          });
          return;
        }
        if (error instanceof Error && error.message === "BET_NOT_PENDING") {
          socket.emit("server_error", {
            message: "Cette mise n’est plus en attente.",
          });
          return;
        }
        if (error instanceof Error && error.message === "BET_NOT_OPEN") {
          socket.emit("server_error", {
            message: "La mise ne peut être acceptée qu’avant le premier coup.",
          });
          return;
        }
        if (error instanceof Error && error.message === "BET_NOT_ACCEPTABLE") {
          socket.emit("server_error", {
            message: "Vous ne pouvez pas accepter votre propre mise.",
          });
          return;
        }
        console.error("Erreur lors du blocage des mises :", error);
        socket.emit("server_error", {
          message: "Impossible de bloquer les deux mises.",
        });
      }
    });

    socket.on("reject_bet", async (payload) => {
      if (
        !isRecord(payload) ||
        typeof payload.matchId !== "string"
      ) {
        socket.emit("server_error", { message: "Refus de mise invalide." });
        return;
      }
      const match = matches.get(payload.matchId);
      if (!match) {
        socket.emit("server_error", { message: "Partie introuvable." });
        return;
      }
      if (!match.playerIds.includes(playerId)) {
        socket.emit("server_error", { message: "Vous ne participez pas à cette partie." });
        return;
      }
      if (match.betStatus !== "PROPOSED" && match.betStatus !== "COUNTERED") {
        socket.emit("server_error", { message: "Aucune mise en attente sur cette partie." });
        return;
      }
      if (match.betProposedById === playerId) {
        socket.emit("server_error", { message: "Vous ne pouvez pas refuser votre propre mise." });
        return;
      }
      try {
        await prisma.$transaction(async (transaction) => {
          const bet = await transaction.gameBet.findUnique({
            where: { matchId: match.matchId },
            select: {
              id: true,
              status: true,
              proposerId: true,
              counterProposedBy: true,
            },
          });
          if (
            !bet ||
            (bet.status !== "PROPOSED" && bet.status !== "COUNTERED")
          ) {
            throw new Error("BET_NOT_PENDING");
          }
          const pendingProposerId =
            bet.status === "COUNTERED"
              ? bet.counterProposedBy ?? bet.proposerId
              : bet.proposerId;
          if (pendingProposerId === playerId) {
            throw new Error("BET_NOT_RESPONDABLE");
          }
          const rejected = await transaction.gameBet.updateMany({
            where: { id: bet.id, status: bet.status },
            data: { status: "REJECTED" },
          });
          if (rejected.count !== 1) throw new Error("BET_NOT_PENDING");
          await transaction.match.update({
            where: { id: match.matchId },
            data: {
              betEnabled: false,
              betAmount: 0,
              betStatus: "REJECTED",
              betProposedById: null,
            },
          });
        });
      } catch (error) {
        if (error instanceof Error && error.message === "BET_NOT_RESPONDABLE") {
          socket.emit("server_error", {
            message: "Vous ne pouvez pas refuser votre propre mise.",
          });
          return;
        }
        if (error instanceof Error && error.message === "BET_NOT_PENDING") {
          socket.emit("server_error", {
            message: "Aucune mise en attente sur cette partie.",
          });
          return;
        }
        console.error("Erreur lors du refus de la mise :", error);
        socket.emit("server_error", {
          message: "Impossible de refuser cette mise.",
        });
        return;
      }
      match.betEnabled = false;
      match.betAmount = null;
      match.betStatus = null;
      match.betProposedById = null;
      io.to(payload.matchId).emit("bet_rejected", {
        matchId: payload.matchId,
        by: playerId,
      });
    });

    socket.on("counter_bet", async (payload) => {
      if (
        !isRecord(payload) ||
        typeof payload.matchId !== "string" ||
        typeof payload.amount !== "number" ||
        !Number.isInteger(payload.amount)
      ) {
        socket.emit("server_error", { message: "Contre-proposition de mise invalide." });
        return;
      }
      const match = matches.get(payload.matchId);
      if (!match) {
        socket.emit("server_error", { message: "Partie introuvable." });
        return;
      }
      if (!match.playerIds.includes(playerId)) {
        socket.emit("server_error", { message: "Vous ne participez pas à cette partie." });
        return;
      }
      if (
        (match.betStatus !== "PROPOSED" && match.betStatus !== "COUNTERED") ||
        !match.betAmount
      ) {
        socket.emit("server_error", { message: "Aucune mise en attente sur cette partie." });
        return;
      }
      if (match.betProposedById === playerId) {
        socket.emit("server_error", { message: "Vous ne pouvez pas contrer votre propre mise." });
        return;
      }
      const amount = payload.amount;
      if (amount < 1 || amount > 1000) {
        socket.emit("server_error", {
          message: "Le montant de la contre-proposition doit être compris entre 1 et 1000 points.",
        });
        return;
      }
      try {
        const countered = await prisma.$transaction(async (transaction) => {
          const storedMatch = await transaction.match.findUnique({
            where: { id: match.matchId },
            select: { status: true, movesHistory: true },
          });
          if (
            storedMatch?.status !== MatchStatus.IN_PROGRESS ||
            !Array.isArray(storedMatch.movesHistory) ||
            storedMatch.movesHistory.length > 0
          ) {
            throw new Error("BET_NOT_OPEN");
          }
          const bet = await transaction.gameBet.findUnique({
            where: { matchId: match.matchId },
          });
          if (
            !bet ||
            (bet.status !== "PROPOSED" && bet.status !== "COUNTERED")
          ) {
            throw new Error("BET_NOT_PENDING");
          }
          const pendingProposerId =
            bet.status === "COUNTERED"
              ? bet.counterProposedBy ?? bet.proposerId
              : bet.proposerId;
          if (pendingProposerId === playerId) {
            throw new Error("BET_NOT_RESPONDABLE");
          }
          const counterer = await transaction.user.findUnique({
            where: { id: playerId },
            select: { pointsFree: true },
          });
          if (!counterer || counterer.pointsFree < amount) {
            throw new InsufficientBetBalanceError();
          }
          const claimed = await transaction.gameBet.updateMany({
            where: { id: bet.id, status: bet.status },
            data: {
              status: "COUNTERED",
              counterProposal: amount,
              counterProposedBy: playerId,
            },
          });
          if (claimed.count !== 1) throw new Error("BET_NOT_PENDING");
          await transaction.match.update({
            where: { id: match.matchId },
            data: {
              betEnabled: true,
              betAmount: amount,
              betStatus: "COUNTERED",
              betProposedById: playerId,
            },
          });
          return { amount };
        });
        match.betAmount = countered.amount;
        match.betStatus = "COUNTERED";
        match.betProposedById = playerId;
        io.to(payload.matchId).emit("bet_countered", {
          matchId: payload.matchId,
          amount: countered.amount,
          by: playerId,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "BET_NOT_OPEN") {
          socket.emit("server_error", {
            message: "La mise ne peut être contrée qu’avant le premier coup.",
          });
          return;
        }
        if (error instanceof Error && error.message === "BET_NOT_RESPONDABLE") {
          socket.emit("server_error", {
            message: "Vous ne pouvez pas contrer votre propre mise.",
          });
          return;
        }
        if (error instanceof InsufficientBetBalanceError) {
          socket.emit("server_error", {
            message: "Solde insuffisant pour cette contre-proposition.",
          });
          return;
        }
        if (error instanceof Error && error.message === "BET_NOT_PENDING") {
          socket.emit("server_error", {
            message: "Aucune mise en attente sur cette partie.",
          });
          return;
        }
        console.error("Erreur lors de la contre-proposition :", error);
        socket.emit("server_error", {
          message: "Impossible d’enregistrer cette contre-proposition.",
        });
      }
    });

    socket.on("chat_message", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string" || typeof payload.message !== "string") {
        socket.emit("server_error", { message: "Message de chat invalide." });
        return;
      }
      const match = matches.get(payload.matchId);
      if (!match) return;
      if (!match.playerIds.includes(playerId)) return;
      if (!peekSetting("match.chatEnabled")) return;
      // Anti-spam : 5 messages maximum par fenêtre glissante de 5 secondes.
      const now = Date.now();
      chatTimestamps.push(now);
      while (chatTimestamps.length && now - chatTimestamps[0] > 5_000) chatTimestamps.shift();
      if (chatTimestamps.length > 5) {
        socket.emit("server_error", { message: "Vous envoyez des messages trop rapidement." });
        return;
      }
      const trimmed = payload.message.trim();
      if (trimmed.length === 0) return;
      if (trimmed.length > 500) {
        socket.emit("server_error", { message: "Message trop long." });
        return;
      }
      // Identifiant unique attribué ici ; le clientId permet à l'expéditeur de
      // remplacer son message optimiste au lieu de l'ajouter une deuxième fois.
      const clientId =
        typeof payload.clientId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(payload.clientId)
          ? payload.clientId
          : null;
      const message: ChatMessagePayload = {
        matchId: payload.matchId,
        id: randomUUID(),
        clientId,
        from: playerId,
        text: trimmed,
        ts: now,
      };
      match.chatHistory.push(message);
      if (match.chatHistory.length > CHAT_HISTORY_LIMIT) match.chatHistory.shift();
      io.to(payload.matchId).emit("chat_message", message);
    });

     socket.on("propose_time", (payload) => {
        if (!isRecord(payload) || typeof payload.matchId !== "string") {
          socket.emit("server_error", { message: "Proposition de temps invalide." });
          return;
        }
        const match = matches.get(payload.matchId);
        if (!match) return;
        if (match.moves.length > 0) {
          socket.emit("server_error", { message: "Le temps ne peut être proposé qu'au début de la partie." });
          return;
        }
        if (payload.minutes === null) {
          match.timeProposal = null;
          match.timeProposalBy = null;
          io.to(payload.matchId).emit("time_proposed", { matchId: payload.matchId, minutes: 0, by: playerId });
          return;
        }
        if (typeof payload.minutes !== "number") {
          socket.emit("server_error", { message: "Proposition de temps invalide." });
          return;
        }
        const minutes = Math.min(
          peekSetting("matchmaking.timeControlMax"),
          Math.max(peekSetting("matchmaking.timeControlMin"), Math.round(payload.minutes)),
        );
        match.timeProposal = minutes;
        match.timeProposalBy = playerId;
        io.to(payload.matchId).emit("time_proposed", { matchId: payload.matchId, minutes, by: playerId });
      });

     socket.on("respond_time", (payload) => {
       if (!isRecord(payload) || typeof payload.matchId !== "string" || typeof payload.accept !== "boolean") {
         socket.emit("server_error", { message: "Réponse de temps invalide." });
         return;
       }
       const match = matches.get(payload.matchId);
       if (!match) return;
       if (payload.accept && match.timeProposal !== null) {
         match.timeControlMinutes = match.timeProposal;
         match.timeProposal = null;
         io.to(payload.matchId).emit("time_accepted", { matchId: payload.matchId, minutes: match.timeControlMinutes });
       } else {
         match.timeProposal = null;
         io.to(payload.matchId).emit("time_rejected", { matchId: payload.matchId });
       }
     });

     socket.on("offer_draw", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string") {
        socket.emit("server_error", { message: "Demande de nul invalide." });
        return;
      }

      void loadMatch(payload.matchId)
        .then(async (match) => {
          if (!match || !match.playerIds.includes(playerId)) {
            socket.emit("server_error", {
              message: "Vous ne participez pas à cette partie.",
            });
            return;
          }
          if (!isJoinedSocket(socket)) {
            socket.emit("server_error", {
              message: "Reconnectez-vous à la partie pour proposer un nul.",
            });
            return;
          }
          if (match.status !== "IN_PROGRESS") {
            socket.emit("server_error", { message: "Cette partie est terminée." });
            return;
          }
          if (match.processingMove || match.processingAction) {
            socket.emit("server_error", {
              message: "Une action est en cours de validation. Réessayez.",
            });
            return;
          }
          // Les deux joueurs proposent le nul : il est conclu (convention Lichess).
          if (match.drawOfferById && match.drawOfferById !== playerId) {
            if (!(await finishMatch(match, null, "DRAW_OFFER"))) {
              socket.emit("server_error", { message: "La partie est déjà terminée." });
            }
            return;
          }
          if (match.drawOfferById) {
            socket.emit("server_error", {
              message: "Votre proposition de match nul est déjà en attente.",
            });
            return;
          }
          const drawRules = currentDrawRules();
          const block = drawOfferBlock({
            plies: match.moves.length,
            progressPercent:
              drawRules.drawOfferMinProgressPercent > 0
                ? gameProgressPercent(match.gameType, match.draughtsVariant, getRemainingPieces(match).total)
                : 100,
            playerId,
            lastDecline: match.lastDrawDecline,
            rules: drawRules,
          });
          if (block) {
            socket.emit("server_error", {
              message:
                block.kind === "TOO_EARLY"
                  ? "Le nul peut être proposé une fois que chaque joueur a joué. Avant, utilisez « Quitter » : la partie est annulée."
                  : block.kind === "PROGRESS"
                    ? `Le match nul peut être proposé à partir de ${block.minPercent} % de la partie (actuellement ${block.progress} %).`
                    : `Votre adversaire a refusé le nul : attendez encore ${Math.ceil(block.remainingPlies / 2)} coup(s) avant de le reproposer.`,
            });
            return;
          }
          match.drawOfferById = playerId;
          publishDrawOffer(match);
        })
        .catch((error: unknown) => {
          console.error("Erreur lors de la demande de match nul :", error);
          socket.emit("server_error", {
            message: "Impossible d’envoyer la demande de match nul.",
          });
        });
    });

    socket.on("respond_draw_offer", (payload) => {
      if (
        !isRecord(payload) ||
        typeof payload.matchId !== "string" ||
        typeof payload.accept !== "boolean"
      ) {
        socket.emit("server_error", { message: "Réponse à la demande invalide." });
        return;
      }

      void loadMatch(payload.matchId)
        .then(async (match) => {
          if (!match || !match.playerIds.includes(playerId)) {
            socket.emit("server_error", {
              message: "Vous ne participez pas à cette partie.",
            });
            return;
          }
          if (!isJoinedSocket(socket)) {
            socket.emit("server_error", {
              message: "Reconnectez-vous à la partie pour répondre.",
            });
            return;
          }
          if (
            match.status !== "IN_PROGRESS" ||
            !match.drawOfferById ||
            match.drawOfferById === playerId
          ) {
            socket.emit("server_error", {
              message: "Aucune demande de match nul ne vous attend.",
            });
            return;
          }
          if (match.processingMove || match.processingAction) {
            socket.emit("server_error", {
              message: "Une action est en cours de validation. Réessayez.",
            });
            return;
          }
          if (payload.accept) {
            if (!(await finishMatch(match, null, "DRAW_OFFER"))) {
              socket.emit("server_error", {
                message: "La partie est déjà terminée.",
              });
            }
            return;
          }

          match.lastDrawDecline = { byPlayerId: match.drawOfferById, atPly: match.moves.length };
          match.drawOfferById = null;
          publishDrawOffer(match);
        })
        .catch((error: unknown) => {
          console.error("Erreur lors de la réponse à la demande de nul :", error);
          socket.emit("server_error", {
            message: "Impossible de traiter la réponse au match nul.",
          });
        });
    });

    socket.on("resign_match", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string") {
        socket.emit("server_error", { message: "Abandon invalide." });
        return;
      }
      void handleResign(socket, payload.matchId).catch((error: unknown) => {
        console.error("Erreur lors de l’abandon de la partie :", error);
        socket.emit("server_error", {
          message: "Impossible d’enregistrer l’abandon.",
        });
      });
    });

    socket.on("cut_match", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string") {
        socket.emit("server_error", {
          message: "Demande de coupure de partie invalide.",
        });
        return;
      }

      void loadMatch(payload.matchId)
        .then(async (match) => {
          if (!match || !match.playerIds.includes(playerId)) {
            socket.emit("server_error", {
              message: "Vous ne participez pas à cette partie.",
            });
            return;
          }
          if (match.status !== "IN_PROGRESS") {
            socket.emit("server_error", {
              message: "Cette partie est déjà clôturée.",
            });
            return;
          }
          if (match.processingMove || match.processingAction) {
            socket.emit("server_error", {
              message: "Une action est en cours de validation. Réessayez.",
            });
            return;
          }

          const winnerId = match.playerIds.find((id) => id !== playerId) ?? null;
          if (!(await finishMatch(match, winnerId, "RESIGNATION"))) {
            socket.emit("server_error", {
              message: "La partie n’a pas pu être coupée. Réessayez.",
            });
          }
        })
        .catch((error: unknown) => {
          console.error("Erreur lors de la coupure de la partie :", error);
          socket.emit("server_error", {
            message: "Impossible de couper la partie et d’enregistrer l’abandon.",
          });
        });
    });

    socket.on("leave_match", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string") {
        socket.emit("server_error", { message: "Sortie de partie invalide." });
        return;
      }
      void loadMatch(payload.matchId)
        .then(async (match) => {
          if (!match || !match.playerIds.includes(playerId)) {
            socket.emit("server_error", {
              message: "Vous ne participez pas à cette partie.",
            });
            return;
          }
          if (!isJoinedSocket(socket)) {
            socket.emit("server_error", {
              message: "Reconnectez-vous à la partie pour quitter.",
            });
            return;
          }
          if (!(await startReconnectGrace(socket, match))) {
            socket.emit("server_error", { message: "Cette partie est terminée." });
            return;
          }
          socket.emit("match_left", {
            matchId: match.matchId,
            gracePeriodMs: RECONNECT_GRACE_MS,
          });
        })
        .catch((error: unknown) => {
          console.error("Erreur lors de la sortie de la partie :", error);
          socket.emit("server_error", {
            message: "Impossible de quitter la partie.",
          });
        });
    });

    socket.on("disconnect", () => {
      for (const [rematchMatchId, requests] of rematchRequests) {
        if (requests.has(playerId)) {
          cancelRematchRequest(rematchMatchId, playerId);
        }
      }
      if (connectedPlayers.get(playerId) === socket) {
        connectedPlayers.delete(playerId);
        publishPresence();
        void matchmaking.remove(playerId);
      }

      const joinedMatchId = socketJoinedMatches.get(socket.id);
      socketJoinedMatches.delete(socket.id);
      if (joinedMatchSockets.get(playerId) !== socket.id) return;
      const activeMatch = joinedMatchId
        ? matches.get(joinedMatchId)
        : undefined;
      if (!activeMatch) {
        joinedMatchSockets.delete(playerId);
        return;
      }
      void startReconnectGrace(socket, activeMatch).catch((error: unknown) => {
        console.error(
          "Erreur lors de l’enregistrement de la déconnexion :",
          error,
        );
      });
    });
  };

  io.on("connection", onConnection);
  return io;
}
