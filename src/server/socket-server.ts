import type { Server as HttpServer } from "node:http";
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
import { prisma } from "../lib/prisma";
import { settleMatch } from "../lib/scoring/settle-match";
import {
  applyDraughtsMove,
  createDraughtsPosition,
  getLegalDraughtsMoves,
  type DraughtsMove,
  type DraughtsPosition,
} from "../lib/engine/draughts";
import { Server, type Socket } from "socket.io";
import type {
  ClientToServerEvents,
  JoinQueuePayload,
  MatchmakingCriteria,
  MatchmakingStrategy,
  OnlinePly,
  ServerToClientEvents,
} from "../types";

const RECONNECT_GRACE_MS = 60_000;

interface PlayerProfile {
  username: string;
  pointsFree: number;
  country: string | null;
  city: string | null;
  neighborhood: string | null;
  draughtsVariant: "ENGLISH" | "INTERNATIONAL";
}

interface SocketData {
  playerId: string;
  profile: PlayerProfile;
}

interface QueueEntry {
  gameType: JoinQueuePayload["gameType"];
  strategy: MatchmakingStrategy;
  criteria: MatchmakingCriteria;
  timeControlMinutes: number | null;
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
  moves: OnlinePly[];
  status: "IN_PROGRESS" | "FINISHED" | "ABANDONED";
  winnerId: string | null;
  scoreDelta: number | null;
  whitePointsBalance: number | null;
  blackPointsBalance: number | null;
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
}

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

function normalizeLocation(value: string | null): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function meetsCriteria(
  profile: PlayerProfile,
  criteria: MatchmakingCriteria,
): boolean {
  if (criteria.minPoints !== undefined && profile.pointsFree < criteria.minPoints) {
    return false;
  }
  if (criteria.maxPoints !== undefined && profile.pointsFree > criteria.maxPoints) {
    return false;
  }
  for (const key of ["country", "city", "neighborhood"] as const) {
    const wanted = criteria[key];
    if (
      wanted &&
      normalizeLocation(profile[key]) !== wanted.trim().toLocaleLowerCase()
    ) {
      return false;
    }
  }
  return true;
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
  const joinedMatchSockets = new Map<string, string>();
  const socketJoinedMatches = new Map<string, string>();
  const queuedPlayers = new Map<string, QueueEntry>();
  const rematchRequests = new Map<string, Set<string>>();
  const rematchTimers = new Map<string, NodeJS.Timeout>();
  const rematchesBeingCreated = new Set<string>();
  const queues: Record<JoinQueuePayload["gameType"], string[]> = {
    CHESS: [],
    CHECKERS: [],
  };
  const matches = new Map<string, ActiveMatch>();

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

  const removeFromQueue = (playerId: string): void => {
    const entry = queuedPlayers.get(playerId);
    if (!entry) return;

    queues[entry.gameType] = queues[entry.gameType].filter(
      (id) => id !== playerId,
    );
    queuedPlayers.delete(playerId);
  };

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
        playerWhite: { select: { id: true, username: true, pointsFree: true } },
        playerBlack: { select: { id: true, username: true, pointsFree: true } },
      },
    });
    if (!stored?.playerBlackId || !stored.playerBlack) return null;

    const match: ActiveMatch = {
      matchId,
      gameType: stored.gameType,
      playerIds: [stored.playerWhiteId, stored.playerBlackId],
      usernames: [stored.playerWhite.username, stored.playerBlack.username],
       draughtsVariant: stored.draughtsVariant,
       timeControlMinutes: stored.timeControlMinutes,
       moves: Array.isArray(stored.movesHistory)
        ? (stored.movesHistory as unknown as OnlinePly[])
        : [],
      status:
        stored.status === MatchStatus.FINISHED
          ? "FINISHED"
          : stored.status === MatchStatus.ABANDONED
            ? "ABANDONED"
            : "IN_PROGRESS",
      winnerId: stored.winnerId,
      scoreDelta: stored.scoreDelta,
      whitePointsBalance: stored.playerWhite.pointsFree,
      blackPointsBalance: stored.playerBlack.pointsFree,
      betEnabled: stored.betEnabled,
      betAmount: stored.betAmount,
      betStatus: stored.betStatus,
      betProposedById: stored.betProposedById,
       drawOfferById: null,
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
       drawOfferById: match.drawOfferById,
       whiteTimeMs: match.whiteTimeMs,
       blackTimeMs: match.blackTimeMs,
        pointsBalance: isWhite
         ? match.whitePointsBalance
         : match.blackPointsBalance,
      opponentPointsBalance: isWhite
        ? match.blackPointsBalance
        : match.whitePointsBalance,
      betEnabled: match.betEnabled,
      betAmount: match.betAmount,
      betStatus: match.betStatus,
      betProposedById: match.betProposedById,
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
    });
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
      | "TIME_OUT",
  ): Promise<boolean> => {
    if (match.status !== "IN_PROGRESS" || match.processingAction) return false;
    match.processingAction = true;
    try {
      const pieces = getRemainingPieces(match);
      const finalStatus =
        reason === "RESIGNATION" || reason === "DISCONNECT_FORFEIT"
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
      match.whitePointsBalance = result.whiteBalance;
      match.blackPointsBalance = result.blackBalance;
      match.drawOfferById = null;
      for (const timer of match.reconnectTimers.values()) clearTimeout(timer);
      match.reconnectTimers.clear();
      matches.delete(match.matchId);

      for (const playerId of match.playerIds) {
        const isWhite = playerId === match.playerIds[0];
        const balance = isWhite ? result.whiteBalance : result.blackBalance;
        const opponentBalance = isWhite ? result.blackBalance : result.whiteBalance;
        const pointsChange =
          winnerId === null
            ? 0
            : winnerId === playerId
              ? result.scoreDelta
              : -result.scoreDelta;
        const eloChange = isWhite ? result.whiteEloChange : result.blackEloChange;
        const opponentEloChange = isWhite ? result.blackEloChange : result.whiteEloChange;
        connectedPlayers.get(playerId)?.emit("match_finished", {
          matchId: match.matchId,
          winnerId,
          scoreDelta: result.scoreDelta,
          pointsChange,
          pointsBalance: balance,
          opponentPointsChange: -pointsChange,
          opponentPointsBalance: opponentBalance,
          whiteEloChange: result.whiteEloChange,
          blackEloChange: result.blackEloChange,
          status: finalStatus,
          reason,
          betSettled: result.betSettled,
          betAmount: result.betAmount,
          whiteResult: result.whiteResult,
          blackResult: result.blackResult,
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
      if (match.drawOfferById) {
        match.drawOfferById = null;
        publishDrawOffer(match);
      }

      match.turnStartedAt = Date.now();

      if (isFinished) {
        if (!(await finishMatch(match, winnerId, "GAME_OVER"))) {
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
      if (opponentId) {
        connectedPlayers.get(opponentId)?.emit("player_reconnect_expired", {
          playerId,
        });
      }
      if (!opponentId) return;
      void finishMatch(match, opponentId, "DISCONNECT_FORFEIT").catch(
        (error: unknown) => {
          console.error(
            "Erreur lors du règlement après expiration de la reconnexion :",
            error,
          );
          connectedPlayers.get(opponentId)?.emit("server_error", {
            message: "Impossible de clôturer la partie après la déconnexion.",
          });
        },
      );
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
    if (
      !isJoinedSocket(socket) ||
      (match.status !== "FINISHED" && match.status !== "ABANDONED")
    ) {
      socket.emit("server_error", {
        message: "Cette partie ne peut pas être relancée.",
      });
      return;
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
      socketJoinedMatches.get(
        connectedPlayers.get(opponentId)?.id ?? "",
      ) !== matchId ||
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
      const { id: nextMatchId } = await prisma.match.create({
        data: {
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
         },
        select: { id: true },
      });
      const nextMatch: ActiveMatch = {
        matchId: nextMatchId,
        gameType: match.gameType,
        playerIds: [match.playerIds[1], match.playerIds[0]],
        usernames: [match.usernames[1], match.usernames[0]],
         draughtsVariant: match.draughtsVariant,
         timeControlMinutes: match.timeControlMinutes,
         moves: [],
        status: "IN_PROGRESS",
        winnerId: null,
        scoreDelta: null,
        whitePointsBalance: match.blackPointsBalance,
        blackPointsBalance: match.whitePointsBalance,
        betEnabled: false,
        betAmount: null,
        betStatus: null,
        betProposedById: null,
        drawOfferById: null,
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
          message: "Impossible de relancer cette partie. Réessayez.",
        });
      }
      throw error;
    } finally {
      rematchesBeingCreated.delete(matchId);
    }
  };

  const onConnection = (socket: GameSocket): void => {
    const { playerId } = socket.data;
    const previousSocket = connectedPlayers.get(playerId);

    if (previousSocket && previousSocket.id !== socket.id) {
      previousSocket.disconnect(true);
    }
    connectedPlayers.set(playerId, socket);
    publishPresence();

    socket.on("join_queue", (payload) => {
      if (!isRecord(payload) || !isGameType(payload.gameType)) {
        socket.emit("server_error", { message: "Type de jeu invalide." });
        return;
      }
      if (payload.isPaid === true) {
        socket.emit("server_error", {
          message:
            "Les matchs rémunérés sont désactivés tant que l’identité des joueurs et les résultats ne sont pas validés côté serveur.",
        });
        return;
      }

      if (findMatchForPlayer(playerId)) {
        socket.emit("server_error", {
          message: "Vous êtes déjà dans une partie.",
        });
        return;
      }

      const strategy =
        payload.strategy === undefined ? "RANDOM" : payload.strategy;
      if (strategy !== "RANDOM" && strategy !== "TARGETED") {
        socket.emit("server_error", {
          message: "Mode de recherche invalide.",
        });
        return;
      }
       const criteria = parseCriteria(payload.criteria);
       if (!criteria) {
         socket.emit("server_error", {
           message: "Les critères de recherche sont invalides.",
         });
         return;
       }
       const rawTime = payload.timeControlMinutes;
       const timeControlMinutes =
         rawTime === null
           ? null
           : typeof rawTime === "number" && rawTime >= 4 && rawTime <= 12
             ? rawTime
             : 12;

      removeFromQueue(playerId);
       const entry: QueueEntry = {
         gameType: payload.gameType,
         strategy,
         criteria,
         timeControlMinutes,
       };
      const opponentId = queues[payload.gameType].find((candidateId) => {
        if (candidateId === playerId || !connectedPlayers.has(candidateId)) {
          return false;
        }
        const candidateEntry = queuedPlayers.get(candidateId);
        const candidateSocket = connectedPlayers.get(candidateId);
        if (!candidateEntry || !candidateSocket) return false;
        return (
          (strategy === "RANDOM" ||
            meetsCriteria(candidateSocket.data.profile, criteria)) &&
          (candidateEntry.strategy === "RANDOM" ||
            meetsCriteria(socket.data.profile, candidateEntry.criteria))
        );
      });

      if (!opponentId) {
        queues[payload.gameType].push(playerId);
        queuedPlayers.set(playerId, entry);
        socket.emit("queue_joined", {
          gameType: payload.gameType,
          strategy,
        });
        return;
      }

      const opponentEntry = queuedPlayers.get(opponentId);
      const opponentSocket = connectedPlayers.get(opponentId);
      if (!opponentEntry || !opponentSocket) {
        socket.emit("server_error", {
          message: "Le joueur adverse n'est plus connecté.",
        });
        return;
      }
      removeFromQueue(opponentId);

      void prisma.match
        .create({
          data: {
            playerWhiteId: opponentId,
            playerBlackId: playerId,
            gameType:
              payload.gameType === "CHESS"
                ? PrismaGameType.CHESS
                : PrismaGameType.CHECKERS,
            draughtsVariant:
              payload.gameType === "CHECKERS"
                ? (opponentSocket.data.profile.draughtsVariant === "ENGLISH"
                    ? PrismaDraughtsVariant.ENGLISH
                    : PrismaDraughtsVariant.INTERNATIONAL)
                : null,
            movesHistory: [],
            rated: payload.rated === true,
            status: MatchStatus.IN_PROGRESS,
          },
          select: { id: true },
        })
        .then(({ id: matchId }) => {
          const match: ActiveMatch = {
            matchId,
            gameType: payload.gameType,
            playerIds: [opponentId, playerId],
            usernames: [
              opponentSocket.data.profile.username,
              socket.data.profile.username,
            ],
             draughtsVariant:
               payload.gameType === "CHECKERS"
                 ? opponentSocket.data.profile.draughtsVariant
                 : null,
             timeControlMinutes,
             moves: [],
            status: "IN_PROGRESS",
            winnerId: null,
            scoreDelta: null,
            whitePointsBalance: null,
            blackPointsBalance: null,
            betEnabled: false,
            betAmount: null,
            betStatus: null,
            betProposedById: null,
            drawOfferById: null,
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
          };
          matches.set(matchId, match);
          void socket.join(matchId);
          void opponentSocket.join(matchId);
          socket.emit("match_found", {
            matchId,
            gameType: payload.gameType,
            opponentId,
          });
          opponentSocket.emit("match_found", {
            matchId,
            gameType: payload.gameType,
            opponentId: playerId,
          });
        })
        .catch((error: unknown) => {
          console.error("Erreur lors de la création du match en ligne :", error);
          socket.emit("server_error", {
            message: "Impossible de créer la partie. Réessayez.",
          });
          opponentSocket.emit("server_error", {
            message: "Impossible de créer la partie. Réessayez.",
          });
          for (const [queuedId, queuedSocket, queuedEntry] of [
            [playerId, socket, entry],
            [opponentId, opponentSocket, opponentEntry],
          ] as const) {
            if (!connectedPlayers.has(queuedId)) continue;
            queues[queuedEntry.gameType].push(queuedId);
            queuedPlayers.set(queuedId, queuedEntry);
            queuedSocket.emit("queue_joined", {
              gameType: queuedEntry.gameType,
              strategy: queuedEntry.strategy,
            });
          }
        });
    });

    socket.on("leave_queue", () => {
      removeFromQueue(playerId);
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

    socket.on("propose_bet", (payload) => {
      if (
        !isRecord(payload) ||
        typeof payload.matchId !== "string" ||
        typeof payload.amount !== "number"
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
      const amount = Math.min(1000, Math.max(1, Math.round(payload.amount)));
      const proposerIdx = match.playerIds.indexOf(playerId);
      const proposerBalance =
        proposerIdx === 0 ? match.whitePointsBalance : match.blackPointsBalance;
      if (proposerBalance === null || proposerBalance < amount) {
        socket.emit("server_error", { message: "Solde insuffisant pour proposer cette mise." });
        return;
      }
      // Annuler toute mise précédente
      if (match.betStatus && match.betStatus !== "PROPOSED") {
        socket.emit("server_error", { message: "Une mise est déjà en cours sur cette partie." });
        return;
      }
      match.betEnabled = true;
      match.betAmount = amount;
      match.betStatus = "PROPOSED";
      match.betProposedById = playerId;
      io.to(payload.matchId).emit("bet_proposed", {
        matchId: payload.matchId,
        amount,
        by: playerId,
      });
    });

    socket.on("accept_bet", (payload) => {
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
      if (!match.betEnabled || match.betStatus !== "PROPOSED" || !match.betAmount) {
        socket.emit("server_error", { message: "Aucune mise en attente sur cette partie." });
        return;
      }
      if (match.betProposedById === playerId) {
        socket.emit("server_error", { message: "Vous ne pouvez pas accepter votre propre mise." });
        return;
      }
      const opponentIdx = match.playerIds.indexOf(playerId);
      const opponentBalance =
        opponentIdx === 0 ? match.whitePointsBalance : match.blackPointsBalance;
      if (opponentBalance === null || opponentBalance < match.betAmount) {
        socket.emit("server_error", { message: "Solde insuffisant pour accepter la mise." });
        return;
      }
      match.betStatus = "ACCEPTED";
      io.to(payload.matchId).emit("bet_accepted", {
        matchId: payload.matchId,
        amount: match.betAmount,
        by: playerId,
      });
    });

    socket.on("reject_bet", (payload) => {
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
      if (match.betStatus !== "PROPOSED") {
        socket.emit("server_error", { message: "Aucune mise en attente sur cette partie." });
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

    socket.on("counter_bet", (payload) => {
      if (
        !isRecord(payload) ||
        typeof payload.matchId !== "string" ||
        typeof payload.amount !== "number"
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
      if (match.betStatus !== "PROPOSED" || !match.betAmount) {
        socket.emit("server_error", { message: "Aucune mise en attente sur cette partie." });
        return;
      }
      if (match.betProposedById === playerId) {
        socket.emit("server_error", { message: "Vous ne pouvez pas contrer votre propre mise." });
        return;
      }
      const amount = Math.min(1000, Math.max(1, Math.round(payload.amount)));
      const opponentIdx = match.playerIds.indexOf(playerId);
      const opponentBalance =
        opponentIdx === 0 ? match.whitePointsBalance : match.blackPointsBalance;
      if (opponentBalance === null || opponentBalance < amount) {
        socket.emit("server_error", { message: "Solde insuffisant pour cette contre-proposition." });
        return;
      }
      match.betAmount = amount;
      match.betStatus = "COUNTERED";
      io.to(payload.matchId).emit("bet_countered", {
        matchId: payload.matchId,
        amount,
        by: playerId,
      });
    });

    socket.on("chat_message", (payload) => {
      if (!isRecord(payload) || typeof payload.matchId !== "string" || typeof payload.message !== "string") {
        socket.emit("server_error", { message: "Message de chat invalide." });
        return;
      }
      const match = matches.get(payload.matchId);
      if (!match) return;
      if (!match.playerIds.includes(playerId)) return;
      const trimmed = payload.message.trim();
      if (trimmed.length === 0) return;
      if (trimmed.length > 500) {
        socket.emit("server_error", { message: "Message trop long." });
        return;
      }
      io.to(payload.matchId).emit("chat_message", {
        matchId: payload.matchId,
        from: playerId,
        text: trimmed,
        ts: Date.now(),
      });
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
        const minutes = Math.min(12, Math.max(4, Math.round(payload.minutes)));
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
        .then((match) => {
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
          if (match.drawOfferById) {
            socket.emit("server_error", {
              message: "Une demande de match nul est déjà en attente.",
            });
            return;
          }
          if (getRemainingPieces(match).total >= 6) {
            socket.emit("server_error", {
              message: "Le match nul peut être demandé quand il reste moins de 6 pions.",
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
        removeFromQueue(playerId);
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
