"use client";

import { Chess, SQUARES, type PieceSymbol, type Square } from "chess.js";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Coins,
  Crown,
  Flag,
  Handshake,
  History,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Send,
  Swords,
  Trophy,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { GameResultModal } from "@/components/games/game-result-modal";
import { useBoardPointerDrag } from "@/components/games/use-board-pointer-drag";
import {
  applyDraughtsMove,
  createDraughtsPosition,
  getLegalDraughtsMoves,
  type DraughtsCoordinate,
  type DraughtsPosition,
} from "@/lib/engine/draughts";
import { playPieceMoveSound } from "@/lib/game-feedback";
import type {
  ClientToServerEvents,
  OnlinePly,
  ServerToClientEvents,
} from "@/types";

type OnlineSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type PlayerColor = "w" | "b";

interface MatchState {
  matchId: string;
  gameType: "CHESS" | "CHECKERS";
  playerId: string;
  playerColor: PlayerColor;
  opponentUsername: string;
  opponentAvatar: string | null;
  draughtsVariant: "ENGLISH" | "INTERNATIONAL" | null;
  moves: OnlinePly[];
  status: "IN_PROGRESS" | "FINISHED" | "ABANDONED" | "ABORTED";
  winnerId: string | null;
  scoreDelta: number | null;
  mode?: "CASUAL" | "RATED" | "MONEY";
  stakeAmount?: number | null;
  timeControlMinutes?: number | null;
  chatEnabled?: boolean;
  tournamentId?: string | null;
  moneyChange?: number | null;
  moneyCommission?: number | null;
  pointsChange?: number | null;
  pointsBalance?: number | null;
  opponentPointsChange?: number | null;
  opponentPointsBalance?: number | null;
  eloChange?: number | null;
  eloBalance?: number | null;
  opponentEloChange?: number | null;
  opponentEloBalance?: number | null;
  drawOfferById: string | null;
  betEnabled: boolean;
  betAmount: number | null;
  betStatus: "PROPOSED" | "ACCEPTED" | "REJECTED" | "COUNTERED" | null;
  betProposedById: string | null;
  finishReason?:
    | "GAME_OVER"
    | "DRAW_OFFER"
    | "RESIGNATION"
    | "DISCONNECT_FORFEIT"
    | "TIME_OUT"
    | "ABORTED";
}

interface OnlineMatchClientProps {
  matchId: string;
}

const CHESS_PIECES: Record<PlayerColor, Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const coordinateKey = ({ row, col }: DraughtsCoordinate) => `${row},${col}`;

function replayChess(moves: OnlinePly[]): Chess {
  const game = new Chess();
  for (const move of moves) {
    if (move.kind !== "CHESS") throw new Error("Historique d’échecs invalide.");
    game.move({
      from: move.from as Square,
      to: move.to as Square,
      promotion: move.promotion ?? "q",
    });
  }
  return game;
}

function replayDraughts(
  moves: OnlinePly[],
  variant: "ENGLISH" | "INTERNATIONAL",
): DraughtsPosition | null {
  try {
    return moves.reduce((position, move) => {
      if (move.kind !== "CHECKERS") {
        throw new Error("Historique de dames invalide.");
      }
      const legalMove = getLegalDraughtsMoves(position).find(
        (candidate) =>
          coordinateKey(candidate.from) === coordinateKey(move.from) &&
          JSON.stringify(candidate.path) === JSON.stringify(move.path) &&
          JSON.stringify(candidate.captures) === JSON.stringify(move.captures),
      );
      if (!legalMove) throw new Error("Un coup reçu est invalide.");
      return applyDraughtsMove(position, legalMove);
    }, createDraughtsPosition(variant));
  } catch {
    return null;
  }
}

export function OnlineMatchClient({ matchId }: OnlineMatchClientProps) {
  const router = useRouter();
  const [match, setMatch] = useState<MatchState | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [error, setError] = useState("");
  const [networkNotice, setNetworkNotice] = useState("");
  const [pendingMove, setPendingMove] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [leavingMatch, setLeavingMatch] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [whiteTimeMs, setWhiteTimeMs] = useState<number | null>(null);
  const [blackTimeMs, setBlackTimeMs] = useState<number | null>(null);
  const [timeProposal, setTimeProposal] = useState<number | null>(null);
  const [timeProposalBy, setTimeProposalBy] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ id: string; from: string; text: string; ts: number }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [reconnectSeconds, setReconnectSeconds] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [betProposal, setBetProposal] = useState<{ amount: number; by: string } | null>(null);
  const sendChatMessage = () => {
    if (!chatInput.trim() || !socketRef.current || !match) return;
    const text = chatInput.trim();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const message = { id, from: match.playerId, text, ts: Date.now() };
    setChatMessages((prev) => [...prev, message]);
    socketRef.current.emit("chat_message", {
      matchId: match.matchId,
      message: text,
    });
    setChatInput("");
  };

  const socketRef = useRef<OnlineSocket | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const betAmountInputRef = useRef<HTMLInputElement | null>(null);
  const counterBetAmountInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const scrollToBottom = () => {
      const full = chatContainerRef.current;
      if (full) {
        full.scrollTop = full.scrollHeight;
      } else {
        const mini = document.getElementById("chat-mini-messages");
        if (mini) {
          mini.scrollTop = mini.scrollHeight;
        }
      }
    };
    scrollToBottom();
  }, [chatMessages]);

  useEffect(() => {
    if (whiteTimeMs === null || blackTimeMs === null || !match || match.status !== "IN_PROGRESS") return;
    const interval = window.setInterval(() => {
      const isWhiteTurn = match.moves.length % 2 === 0;
      if (isWhiteTurn) {
        setWhiteTimeMs((t) => (t !== null && t > 0 ? t - 1000 : t));
      } else {
        setBlackTimeMs((t) => (t !== null && t > 0 ? t - 1000 : t));
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [match?.moves.length, match?.status]);
  const rematchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket: OnlineSocket = io({
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      setError("");
      socket.emit("join_match", { matchId });
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => {
      setError("Connexion refusée. Connectez-vous avec un compte joueur.");
    });
    socket.on("server_error", ({ message }) => {
      setPendingMove(false);
      setPendingAction(false);
      setLeavingMatch(false);
      setRematchWaiting(false);
      if (rematchTimeoutRef.current) {
        clearTimeout(rematchTimeoutRef.current);
        rematchTimeoutRef.current = null;
      }
      setError(message);
    });
    let reconnectInterval: ReturnType<typeof setInterval> | null = null;
    socket.on("player_disconnected", ({ gracePeriodMs }) => {
      const seconds = Math.ceil(gracePeriodMs / 1000);
      setReconnectSeconds(seconds);
      setNetworkNotice("Adversaire déconnecté. Reconnexion possible pendant");
      if (reconnectInterval) clearInterval(reconnectInterval);
      reconnectInterval = setInterval(() => {
        setReconnectSeconds((remaining) => Math.max(remaining - 1, 0));
      }, 1000);
    });
    const clearReconnectNotice = () => {
      if (reconnectInterval) clearInterval(reconnectInterval);
      reconnectInterval = null;
      setReconnectSeconds(0);
      setNetworkNotice("");
    };
    socket.on("player_reconnected", clearReconnectNotice);
    socket.on("player_reconnect_expired", () => {
      clearReconnectNotice();
      setNetworkNotice("Le délai de reconnexion de l’adversaire est expiré.");
    });
    socket.on("match_state", (state) => {
      setMatch({
        ...state,
        betStatus: state.betStatus as MatchState["betStatus"],
      });
      setWhiteTimeMs(state.whiteTimeMs);
      setBlackTimeMs(state.blackTimeMs);
      setPendingMove(false);
      setSelectedSquare(null);
      setError("");
    });
    socket.on("move_accepted", (state) => {
      setMatch((current) => {
        if (!current || current.matchId !== state.matchId) return current;
        if (state.moves.length > current.moves.length) playPieceMoveSound();
        setWhiteTimeMs(state.whiteTimeMs);
        setBlackTimeMs(state.blackTimeMs);
        return { ...current, ...state };
      });
      setPendingMove(false);
      setSelectedSquare(null);
      setError("");
    });
    socket.on("time_proposed", ({ minutes, by }) => {
      setTimeProposal(minutes);
      setTimeProposalBy(by);
    });
    socket.on("time_accepted", ({ minutes }) => {
      setTimeProposal(null);
      if (minutes) {
        setWhiteTimeMs(minutes * 60 * 1000);
        setBlackTimeMs(minutes * 60 * 1000);
      }
    });
    socket.on("time_rejected", () => {
      setTimeProposal(null);
    });
    socket.on("draw_offer_updated", ({ matchId: updatedMatchId, offeredByPlayerId }) => {
      setMatch((current) =>
        current?.matchId === updatedMatchId
          ? { ...current, drawOfferById: offeredByPlayerId }
          : current,
      );
      setPendingAction(false);
    });
    socket.on("match_finished", ({
      matchId: finishedMatchId,
      winnerId,
      scoreDelta,
      pointsChange,
      pointsBalance,
      opponentPointsChange,
      opponentPointsBalance,
      eloChange,
      opponentEloChange,
      eloBalance,
      opponentEloBalance,
      status,
      reason,
      mode,
      moneyChange,
      moneyCommission,
    }) => {
      setMatch((current) =>
        current?.matchId === finishedMatchId
          ? {
              ...current,
              status,
              winnerId,
              scoreDelta,
              pointsChange,
              pointsBalance,
              opponentPointsChange,
              opponentPointsBalance,
              eloChange,
              opponentEloChange,
              eloBalance,
              opponentEloBalance,
              drawOfferById: null,
              finishReason: reason,
              mode: mode ?? current.mode,
              moneyChange: moneyChange ?? null,
              moneyCommission: moneyCommission ?? null,
            }
          : current,
      );
      setPendingMove(false);
      setPendingAction(false);
      clearReconnectNotice();
      setError("");
    });
    socket.on("rematch_waiting", ({ matchId: requestedMatchId }) => {
      if (requestedMatchId === matchId) setRematchWaiting(true);
    });
    socket.on("rematch_started", ({ previousMatchId, matchId: nextMatchId }) => {
      if (previousMatchId !== matchId) return;
      if (rematchTimeoutRef.current) {
        clearTimeout(rematchTimeoutRef.current);
        rematchTimeoutRef.current = null;
      }
      setRematchWaiting(false);
      setPendingMove(false);
      setPendingAction(false);
      setSelectedSquare(null);
      setError("");
      router.replace(`/match/${encodeURIComponent(nextMatchId)}`);
    });
    socket.on("rematch_expired", ({ matchId: expiredMatchId }) => {
      if (expiredMatchId !== matchId) return;
      if (rematchTimeoutRef.current) {
        clearTimeout(rematchTimeoutRef.current);
        rematchTimeoutRef.current = null;
      }
      setRematchWaiting(false);
      setError("L’adversaire n’a pas confirmé la nouvelle partie. Vous pouvez réessayer.");
    });
    socket.on("match_left", () => {
      setLeavingMatch(false);
      socket.disconnect();
      router.push("/match/en-ligne");
    });
    socket.on("chat_message", ({ matchId: msgMatchId, from, text, ts }) => {
      if (msgMatchId !== matchId) return;
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === `${ts}-${from}`)) return prev;
        return [...prev, { id: `${ts}-${from}`, from, text, ts: ts ?? Date.now() }];
      });
    });
    socket.on("bet_proposed", ({ matchId: betMatchId, amount, by }) => {
      if (betMatchId !== matchId) return;
      setMatch((current) =>
        current?.matchId === betMatchId
          ? {
              ...current,
              betEnabled: true,
              betAmount: amount,
              betStatus: "PROPOSED",
              betProposedById: by,
            }
          : current,
      );
      setPendingAction(false);
      setError("");
    });
    socket.on("bet_accepted", ({ matchId: betMatchId, amount, by }) => {
      if (betMatchId !== matchId) return;
      setMatch((current) =>
        current?.matchId === betMatchId
          ? {
              ...current,
              betEnabled: true,
              betAmount: amount,
              betStatus: "ACCEPTED",
              betProposedById: by,
            }
          : current,
      );
      setPendingAction(false);
      setError("");
    });
    socket.on("bet_rejected", ({ matchId: betMatchId, by }) => {
      if (betMatchId !== matchId) return;
      setMatch((current) =>
        current?.matchId === betMatchId
          ? {
              ...current,
              betEnabled: false,
              betAmount: null,
              betStatus: "REJECTED",
              betProposedById: null,
            }
          : current,
      );
      setPendingAction(false);
      setBetProposal(null);
      setError("");
    });
    socket.on("bet_countered", ({ matchId: betMatchId, amount, by }) => {
      if (betMatchId !== matchId) return;
      setMatch((current) =>
        current?.matchId === betMatchId
          ? {
              ...current,
              betEnabled: true,
              betAmount: amount,
              betStatus: "COUNTERED",
              betProposedById: by,
            }
          : current,
      );
      setPendingAction(false);
      setError("");
    });

    return () => {
      if (reconnectInterval) clearInterval(reconnectInterval);
      if (rematchTimeoutRef.current) {
        clearTimeout(rematchTimeoutRef.current);
        rematchTimeoutRef.current = null;
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [matchId, router]);

  const chessGame = useMemo(
    () => (match?.gameType === "CHESS" ? replayChess(match.moves) : null),
    [match],
  );
  const draughtsPosition = useMemo(
    () =>
      match?.gameType === "CHECKERS"
        ? replayDraughts(
            match.moves,
            match.draughtsVariant ?? "INTERNATIONAL",
          )
        : null,
    [match],
  );
  const remainingPieceCount =
    match?.gameType === "CHESS"
      ? chessGame?.board().flat().filter(Boolean).length ?? 0
      : draughtsPosition?.board.flat().filter(Boolean).length ?? 0;

  const chessLegalMoves = useMemo(
    () =>
      chessGame && !chessGame.isGameOver()
        ? chessGame.moves({ verbose: true })
        : [],
    [chessGame],
  );
  const draughtsLegalMoves = useMemo(
    () => (draughtsPosition ? getLegalDraughtsMoves(draughtsPosition) : []),
    [draughtsPosition],
  );
  const isYourTurn =
    match?.status === "IN_PROGRESS" &&
    (chessGame?.turn() ?? draughtsPosition?.turn) === match?.playerColor &&
    !pendingMove &&
    !pendingAction;
  const canOfferDraw =
    match?.status === "IN_PROGRESS" &&
    remainingPieceCount < 6 &&
    !match.drawOfferById &&
    socketConnected &&
    !pendingAction;

  const sendMove = useCallback(
    (move: OnlinePly) => {
      if (!match || !isYourTurn || !socketConnected) return;
      setPendingMove(true);
      setError("");
      socketRef.current?.emit("make_move", { matchId: match.matchId, move });
    },
    [isYourTurn, match, socketConnected],
  );

  const offerDraw = () => {
    if (!match || !canOfferDraw) return;
    setPendingAction(true);
    setError("");
    socketRef.current?.emit("offer_draw", { matchId: match.matchId });
  };

  const respondToDrawOffer = (accept: boolean) => {
    if (!match || !match.drawOfferById || match.drawOfferById === match.playerId) {
      return;
    }
    setPendingAction(true);
    setError("");
    socketRef.current?.emit("respond_draw_offer", {
      matchId: match.matchId,
      accept,
    });
  };

  const resignMatch = () => {
    if (
      !match ||
      match.status !== "IN_PROGRESS" ||
      !socketConnected ||
      pendingAction
    ) {
      return;
    }
    if (!window.confirm("Confirmer l’abandon ? Votre adversaire remportera la partie.")) {
      return;
    }
    setPendingAction(true);
    setError("");
    socketRef.current?.emit("resign_match", { matchId: match.matchId });
  };

  const leaveMatch = () => {
    if (
      !match ||
      match.status !== "IN_PROGRESS" ||
      !socketConnected ||
      pendingAction
    ) {
      return;
    }
    if (
      !window.confirm(
        "Quitter la partie ? Votre adversaire gagnera si vous ne revenez pas dans les 60 secondes.",
      )
    ) {
      return;
    }
    setPendingAction(true);
    setLeavingMatch(true);
    setError("");
    socketRef.current?.emit("leave_match", { matchId: match.matchId });
  };

  const proposeBet = (amount: number) => {
    if (!match || !socketConnected || pendingAction) return;
    if (match.moves.length > 0) {
      setError("La mise ne peut être proposée qu'avant le premier coup.");
      return;
    }
    setPendingAction(true);
    setError("");
    socketRef.current?.emit("propose_bet", { matchId: match.matchId, amount });
  };

  const respondToBet = (accept: boolean) => {
    if (!match || !socketConnected || pendingAction) return;
    if (match.betStatus !== "PROPOSED" && match.betStatus !== "COUNTERED") return;
    setPendingAction(true);
    setError("");
    socketRef.current?.emit(
      accept ? "accept_bet" : "reject_bet",
      { matchId: match.matchId },
    );
  };

  const counterBet = (amount: number) => {
    if (!match || !socketConnected || pendingAction) return;
    if (match.betStatus !== "PROPOSED" && match.betStatus !== "COUNTERED") return;
    setPendingAction(true);
    setError("");
    socketRef.current?.emit("counter_bet", { matchId: match.matchId, amount });
  };

  const requestRematch = () => {
    if (!match || !socketConnected || rematchWaiting) return;
    setError("");
    setRematchWaiting(true);
    if (rematchTimeoutRef.current) clearTimeout(rematchTimeoutRef.current);
    rematchTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit("cancel_rematch", { matchId: match.matchId });
      setRematchWaiting(false);
      setError("Le serveur n’a pas répondu à la demande. Vous pouvez réessayer.");
      rematchTimeoutRef.current = null;
    }, 65_000);
    socketRef.current?.emit("request_rematch", { matchId: match.matchId });
  };

  const quitAfterMatch = () => {
    if (rematchTimeoutRef.current) {
      clearTimeout(rematchTimeoutRef.current);
      rematchTimeoutRef.current = null;
    }
    if (match && rematchWaiting) {
      socketRef.current?.emit("cancel_rematch", { matchId: match.matchId });
    }
    router.push("/dashboard");
  };

  const selectChessSquare = useCallback(
    (square: Square) => {
      if (!isYourTurn || !chessGame) return;
      if (
        selectedSquare &&
        chessLegalMoves.some(
          (move) => move.from === selectedSquare && move.to === square,
        )
      ) {
        sendMove({
          kind: "CHESS",
          from: selectedSquare,
          to: square,
          ...(chessGame.get(selectedSquare as Square)?.type === "p" &&
          (square.endsWith("8") || square.endsWith("1"))
            ? { promotion: "q" }
            : {}),
        });
        return;
      }

      const piece = chessGame.get(square);
      if (piece?.color === match?.playerColor) {
        setSelectedSquare(square);
      } else {
        setSelectedSquare(null);
      }
    },
    [chessGame, chessLegalMoves, isYourTurn, match?.playerColor, selectedSquare, sendMove],
  );

  const selectDraughtsSquare = useCallback(
    (coordinate: DraughtsCoordinate) => {
      if (!isYourTurn || !draughtsPosition) return;
      const key = coordinateKey(coordinate);
      const legalMove = draughtsLegalMoves.find(
        (move) =>
          coordinateKey(move.from) === selectedSquare &&
          coordinateKey(move.path[move.path.length - 1]!) === key,
      );
      if (legalMove) {
        sendMove({ kind: "CHECKERS", ...legalMove });
        return;
      }
      const piece = draughtsPosition.board[coordinate.row]?.[coordinate.col];
      setSelectedSquare(
        piece?.color === match?.playerColor ? key : null,
      );
    },
    [
      draughtsLegalMoves,
      draughtsPosition,
      isYourTurn,
      match?.playerColor,
      selectedSquare,
      sendMove,
    ],
  );

  const handleDrop = useCallback(
    (from: string, to: string) => {
      if (!isYourTurn || from === to) return;
      if (match?.gameType === "CHESS") {
        const source = SQUARES.find((square) => square === from);
        const destination = SQUARES.find((square) => square === to);
        if (!source || !destination) return;
        if (
          chessLegalMoves.some(
            (move) => move.from === source && move.to === destination,
          )
        ) {
          selectChessSquare(destination);
        } else {
          selectChessSquare(source);
        }
      } else if (match?.gameType === "CHECKERS") {
        const [fromRow, fromCol] = from.split(",").map(Number);
        const [toRow, toCol] = to.split(",").map(Number);
        const source = { row: fromRow, col: fromCol };
        const destination = { row: toRow, col: toCol };
        const legalMove = draughtsLegalMoves.find(
          (move) =>
            coordinateKey(move.from) === coordinateKey(source) &&
            coordinateKey(move.path[move.path.length - 1]!) ===
              coordinateKey(destination),
        );
        if (legalMove) sendMove({ kind: "CHECKERS", ...legalMove });
        else selectDraughtsSquare(source);
      }
    },
    [
      chessLegalMoves,
      draughtsLegalMoves,
      isYourTurn,
      match?.gameType,
      selectChessSquare,
      selectDraughtsSquare,
      sendMove,
    ],
  );
  const { drag, beginDrag, consumeClick } = useBoardPointerDrag(handleDrop);

  const result =
    match?.status === "FINISHED" ||
    (match?.status === "ABANDONED" && match.winnerId !== null)
      ? match.winnerId === null
        ? "draw"
        : match.winnerId === match.playerId
          ? "win"
          : "loss"
      : null;

  const moveList = useMemo(() => {
    if (!match) return [] as string[];
    if (match.gameType === "CHESS") return chessGame?.history() ?? [];
    const size = draughtsPosition?.board.length ?? 10;
    const squareNumber = ({ row, col }: { row: number; col: number }) =>
      row * (size / 2) + Math.floor(col / 2) + 1;
    return match.moves.map((ply) =>
      ply.kind === "CHECKERS"
        ? `${squareNumber(ply.from)}${ply.captures.length ? "x" : "-"}${squareNumber(ply.path[ply.path.length - 1]!)}`
        : "",
    );
  }, [match, chessGame, draughtsPosition]);

  const moveListRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = moveListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [moveList.length]);

  if (!match) {
    return (
      <section className="card mx-auto w-full max-w-md p-8 text-center animate-fade-in">
        <LoaderCircle className="mx-auto mb-4 size-8 animate-spin text-accent" />
        <h2 className="text-lg font-semibold">Connexion à la partie</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Synchronisation du plateau et des joueurs…
        </p>
        {!socketConnected && (
          <p className="mt-3 text-sm text-gold">Connexion au serveur en cours.</p>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </section>
    );
  }

  const gameName = match.gameType === "CHESS" ? "Échecs" : "Dames";
  const mode = match.mode ?? "CASUAL";
  const modeLabel = mode === "MONEY" ? "Rémunérée" : mode === "RATED" ? "Classée" : "Amicale";
  const resultDescription =
    match.finishReason === "RESIGNATION"
      ? match.winnerId === match.playerId
        ? "Votre adversaire a abandonné."
        : "Vous avez abandonné la partie."
      : match.finishReason === "DISCONNECT_FORFEIT"
        ? match.winnerId === match.playerId
          ? "Votre adversaire ne s’est pas reconnecté à temps."
          : "Vous ne vous êtes pas reconnecté à temps."
        : match.finishReason === "TIME_OUT"
          ? match.winnerId === match.playerId
            ? "Votre adversaire a dépassé le temps imparti."
            : "Vous avez dépassé le temps imparti."
          : match.finishReason === "DRAW_OFFER"
            ? "La proposition de match nul a été acceptée."
            : "Le résultat de la partie a été enregistré côté serveur.";
  const pointsChange =
    typeof match.pointsChange === "number" && Number.isFinite(match.pointsChange)
      ? match.pointsChange
      : null;
  const pointsMessage =
    mode === "MONEY"
      ? "0 point"
      : pointsChange === null
        ? "Points non disponibles"
        : `${pointsChange > 0 ? "+" : ""}${pointsChange} point${Math.abs(pointsChange) === 1 ? "" : "s"}`;

  const whiteToMove = (chessGame?.turn() ?? draughtsPosition?.turn) === "w";
  const selfTime = match.playerColor === "w" ? whiteTimeMs : blackTimeMs;
  const opponentTime = match.playerColor === "w" ? blackTimeMs : whiteTimeMs;
  const selfActive = match.status === "IN_PROGRESS" && whiteToMove === (match.playerColor === "w");
  const opponentActive = match.status === "IN_PROGRESS" && !selfActive;
  const chatAvailable = match.chatEnabled !== false;
  const showFriendlyStake =
    mode !== "MONEY" && match.status === "IN_PROGRESS" && match.moves.length === 0;

  const respondToTime = (accept: boolean) =>
    socketRef.current?.emit("respond_time", { matchId: match.matchId, accept });

  const actionButtons = match.status === "IN_PROGRESS" && (
    <div className="grid grid-cols-3 gap-2">
      <button
        type="button"
        disabled={!canOfferDraw}
        onClick={offerDraw}
        title={
          remainingPieceCount < 6
            ? "Proposer le match nul"
            : `Nulle possible sous 6 pièces (${remainingPieceCount})`
        }
        className="btn btn-ghost px-2"
      >
        <Handshake className="size-4" />
        <span className="hidden sm:inline">Nulle</span>
      </button>
      <button
        type="button"
        disabled={!socketConnected || pendingAction}
        onClick={resignMatch}
        className="btn btn-danger px-2"
      >
        <Flag className="size-4" />
        <span className="hidden sm:inline">Abandon</span>
      </button>
      <button
        type="button"
        disabled={!socketConnected || pendingAction || leavingMatch}
        onClick={leaveMatch}
        className="btn btn-ghost px-2"
        title="Quitter (60 s pour revenir)"
      >
        <LogOut className="size-4" />
        <span className="hidden sm:inline">{leavingMatch ? "…" : "Quitter"}</span>
      </button>
    </div>
  );

  const drawOfferPanel =
    match.status === "IN_PROGRESS" && match.drawOfferById ? (
      match.drawOfferById === match.playerId ? (
        <p role="status" className="card-muted px-3 py-2 text-sm text-gold">
          Proposition de nulle envoyée…
        </p>
      ) : (
        <div className="card-muted flex items-center justify-between gap-2 px-3 py-2">
          <p className="text-sm text-gold">Nulle proposée</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!socketConnected || pendingAction}
              onClick={() => respondToDrawOffer(true)}
              className="btn btn-primary min-h-0 px-3 py-1.5"
            >
              <Check className="size-4" /> Accepter
            </button>
            <button
              type="button"
              disabled={!socketConnected || pendingAction}
              onClick={() => respondToDrawOffer(false)}
              className="btn btn-ghost min-h-0 px-3 py-1.5"
              aria-label="Refuser la nulle"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )
    ) : null;

  const playerStrip = (who: "self" | "opponent") => {
    const isSelf = who === "self";
    const time = isSelf ? selfTime : opponentTime;
    const active = isSelf ? selfActive : opponentActive;
    const color = isSelf ? match.playerColor : match.playerColor === "w" ? "b" : "w";
    const rating = isSelf ? match.eloBalance : match.opponentEloBalance;
    const low = typeof time === "number" && time <= 30_000;
    return (
      <div className="board-fit flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border ${
              active ? "border-accent/50" : "border-line"
            } bg-surface-2`}
          >
            {!isSelf && match.opponentAvatar ? (
              match.opponentAvatar.startsWith("http") || match.opponentAvatar.startsWith("/") ? (
                <img src={match.opponentAvatar} alt="" className="size-full object-cover" />
              ) : (
                <span className="text-lg">{match.opponentAvatar}</span>
              )
            ) : (
              <UserRound className="size-4 text-ink-muted" />
            )}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate text-sm font-semibold">
              <span className="truncate">{isSelf ? "Vous" : match.opponentUsername}</span>
              <span
                aria-label={color === "w" ? "Blancs" : "Noirs"}
                className={`size-2.5 shrink-0 rounded-full border ${
                  color === "w" ? "border-zinc-300 bg-zinc-100" : "border-zinc-500 bg-zinc-900"
                }`}
              />
            </p>
            <p className="tabular text-xs text-ink-muted">
              {mode !== "CASUAL" && typeof rating === "number" ? `${rating} ELO` : modeLabel}
            </p>
          </div>
        </div>
        {time !== null && (
          <span
            className={`tabular rounded-lg px-3 py-1.5 font-mono text-lg font-semibold transition-colors ${
              active
                ? low
                  ? "bg-danger/20 text-danger"
                  : "bg-accent text-accent-ink"
                : "bg-surface-2 text-ink-muted"
            }`}
            aria-label={`Temps ${isSelf ? "restant" : "de l'adversaire"}`}
          >
            {formatClock(time)}
          </span>
        )}
        {time === null && active && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <span className="size-2 animate-pulse rounded-full bg-accent" />
            {isSelf ? "À vous" : "Réfléchit…"}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
      {/* ── Colonne plateau ───────────────────────────────────────── */}
      <section className="flex flex-col items-center gap-2 animate-fade-in">
        {playerStrip("opponent")}

        <div className="board-fit relative">
          <div
            className="grid aspect-square w-full overflow-hidden rounded-xl border-[6px] border-board-frame shadow-[0_24px_60px_-28px_rgb(0_0_0/0.8)]"
            style={{
              gridTemplateColumns: `repeat(${match.gameType === "CHESS" ? 8 : draughtsPosition?.board.length ?? 10}, minmax(0, 1fr))`,
            }}
          >
            {match.gameType === "CHESS" && chessGame &&
              Array.from({ length: 64 }, (_, index) => {
                const displayRow = Math.floor(index / 8);
                const displayCol = index % 8;
                const row = match.playerColor === "w" ? displayRow : 7 - displayRow;
                const col = match.playerColor === "w" ? displayCol : 7 - displayCol;
                const square = `${String.fromCharCode(97 + col)}${8 - row}` as Square;
                const piece = chessGame.get(square);
                const isSelected = selectedSquare === square;
                const isDestination = chessLegalMoves.some(
                  (move) => move.from === selectedSquare && move.to === square,
                );
                const lastMove = chessGame.history({ verbose: true }).at(-1);
                const isLast = lastMove?.from === square || lastMove?.to === square;
                const light = (row + col) % 2 === 0;
                return (
                  <button
                    key={square}
                    type="button"
                    data-square={square}
                    aria-label={`${square}${piece ? `, ${piece.color === "w" ? "blanche" : "noire"}` : ""}`}
                    disabled={!isYourTurn}
                    onPointerDown={(event) => {
                      if (piece?.color !== match.playerColor || !isYourTurn) return;
                      setSelectedSquare(square);
                      beginDrag(event, square, CHESS_PIECES[piece.color][piece.type]);
                    }}
                    onClick={() => {
                      if (!consumeClick()) selectChessSquare(square);
                    }}
                    className={[
                      "relative flex aspect-square items-center justify-center touch-none select-none text-[clamp(1.6rem,7.5vw,3.6rem)] leading-none focus:z-10 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-accent",
                      light ? "bg-board-light text-zinc-900" : "bg-board-dark text-zinc-900",
                      isLast ? "after:absolute after:inset-0 after:bg-amber-300/30" : "",
                      isSelected ? "ring-4 ring-inset ring-accent-strong" : "",
                      drag?.from === square ? "opacity-0" : "",
                    ].join(" ")}
                  >
                    {isDestination && (
                      <span
                        aria-hidden="true"
                        className={`absolute z-[1] rounded-full ${piece ? "inset-1 border-4 border-zinc-900/25" : "size-[28%] bg-zinc-900/25"}`}
                      />
                    )}
                    <span className="relative z-[2] drop-shadow-[0_1px_0_rgb(255_255_255/0.25)]">
                      {piece && CHESS_PIECES[piece.color][piece.type]}
                    </span>
                    {displayCol === 0 && (
                      <span className={`pointer-events-none absolute left-0.5 top-0.5 text-[9px] font-semibold sm:text-[10px] ${light ? "text-board-dark" : "text-board-light"}`}>
                        {8 - row}
                      </span>
                    )}
                    {displayRow === 7 && (
                      <span className={`pointer-events-none absolute bottom-0.5 right-1 text-[9px] font-semibold sm:text-[10px] ${light ? "text-board-dark" : "text-board-light"}`}>
                        {String.fromCharCode(97 + col)}
                      </span>
                    )}
                  </button>
                );
              })}

            {match.gameType === "CHECKERS" && draughtsPosition &&
              draughtsPosition.board.flatMap((rowPieces, displayRow) =>
                rowPieces.map((_, displayCol) => {
                  const boardSize = draughtsPosition.board.length;
                  const row = match.playerColor === "w" ? displayRow : boardSize - 1 - displayRow;
                  const col = match.playerColor === "w" ? displayCol : boardSize - 1 - displayCol;
                  const coordinate = { row, col };
                  const key = coordinateKey(coordinate);
                  const piece = draughtsPosition.board[row]?.[col];
                  const playable = (row + col) % 2 === 1;
                  const selected = selectedSquare === key;
                  const isDestination = draughtsLegalMoves.some(
                    (move) =>
                      coordinateKey(move.from) === selectedSquare &&
                      coordinateKey(move.path[move.path.length - 1]!) === key,
                  );
                  const canMoveFrom =
                    isYourTurn &&
                    piece?.color === match.playerColor &&
                    draughtsLegalMoves.some((move) => coordinateKey(move.from) === key);
                  return (
                    <button
                      key={key}
                      type="button"
                      data-square={key}
                      aria-label={`Case ${row + 1}, ${col + 1}${piece ? `, pion ${piece.color === "w" ? "blanc" : "noir"}${piece.king ? " dame" : ""}` : ""}`}
                      disabled={!playable || !isYourTurn}
                      onPointerDown={(event) => {
                        if (piece?.color !== match.playerColor || !isYourTurn) return;
                        setSelectedSquare(key);
                        beginDrag(event, key, piece.king ? "♛" : "●");
                      }}
                      onClick={() => {
                        if (!consumeClick() && playable) selectDraughtsSquare(coordinate);
                      }}
                      className={[
                        "relative flex aspect-square items-center justify-center touch-none select-none focus:z-10 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-accent",
                        playable ? "bg-board-dark" : "bg-board-light",
                        selected ? "ring-4 ring-inset ring-accent-strong" : "",
                        drag?.from === key ? "opacity-0" : "",
                      ].join(" ")}
                    >
                      {isDestination && (
                        <span aria-hidden="true" className="absolute z-[1] size-[30%] rounded-full bg-accent-strong/70" />
                      )}
                      {piece && (
                        <span
                          className={[
                            "relative z-[2] flex size-[78%] items-center justify-center rounded-full border-2 shadow-[inset_0_-3px_0_rgb(0_0_0/0.18),0_2px_4px_rgb(0_0_0/0.35)]",
                            piece.color === "w"
                              ? "border-[#cfc9b6] bg-[#f1ece0] text-zinc-700"
                              : "border-[#14100d] bg-[#2b241f] text-amber-200",
                            canMoveFrom && !selected ? "ring-2 ring-accent/60" : "",
                          ].join(" ")}
                        >
                          {piece.king ? <Crown className="size-1/2" /> : null}
                        </span>
                      )}
                    </button>
                  );
                }),
              )}
          </div>
        </div>

        {playerStrip("self")}

        {/* Barre d'actions compacte (toujours visible sous le plateau) */}
        <div className="board-fit mt-1 space-y-2">
          {drawOfferPanel}
          <div className="flex gap-2">
            <div className="flex-1">{actionButtons}</div>
            {chatAvailable && (
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="btn btn-ghost relative px-3 lg:hidden"
                aria-label="Ouvrir le chat"
              >
                <MessageCircle className="size-4" />
                {chatMessages.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-ink">
                    {Math.min(chatMessages.length, 9)}
                  </span>
                )}
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {networkNotice && (
            <p role="status" className="rounded-xl border border-gold/25 bg-gold/10 px-3 py-2 text-sm text-gold">
              {networkNotice}
              {reconnectSeconds > 0 && ` ${reconnectSeconds} s.`}
            </p>
          )}
        </div>

        {drag && (
          <span
            aria-hidden="true"
            className="pointer-events-none fixed z-[80] flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center text-5xl drop-shadow-xl"
            style={{ left: drag.x, top: drag.y }}
          >
            {drag.piece}
          </span>
        )}
      </section>

      {/* ── Panneau latéral : informations secondaires ────────────── */}
      <aside className="flex flex-col gap-3 lg:max-h-[calc(100dvh-7rem)]">
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`chip ${mode === "MONEY" ? "chip-money" : mode === "RATED" ? "chip-rated" : "chip-casual"}`}
            >
              {mode === "MONEY" ? <Coins className="size-3.5" /> : mode === "RATED" ? <Trophy className="size-3.5" /> : <Users className="size-3.5" />}
              {modeLabel}
              {mode === "MONEY" && match.stakeAmount ? ` · ${formatCfa(match.stakeAmount)}` : ""}
            </span>
            {match.tournamentId && (
              <Link href={`/tournois/${encodeURIComponent(match.tournamentId)}`} className="chip hover:text-ink">
                <Trophy className="size-3.5" /> Tournoi
              </Link>
            )}
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              {socketConnected ? <Wifi className="size-3.5 text-accent" /> : <WifiOff className="size-3.5 text-danger" />}
              {socketConnected ? "Connecté" : "Reconnexion…"}
            </span>
          </div>
          <p className="mt-3 text-sm font-semibold">
            {gameName}
            {match.gameType === "CHECKERS" && (
              <span className="font-normal text-ink-muted">
                {" "}· {match.draughtsVariant === "ENGLISH" ? "anglaises 8×8" : "internationales 10×10"}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {match.timeControlMinutes ? `${match.timeControlMinutes} min par joueur` : "Sans pendule"}
            {" · "}
            {mode === "MONEY"
              ? "points argent uniquement"
              : mode === "RATED"
                ? "compte pour votre ELO"
                : "n’affecte pas votre ELO"}
          </p>

          {timeProposal !== null && timeProposalBy && (
            <div className="card-muted mt-3 flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-1.5">
                <Clock className="size-4 text-gold" /> {timeProposal} min proposées
              </span>
              {timeProposalBy === match.playerId ? (
                <span className="text-xs text-ink-muted">En attente…</span>
              ) : (
                <span className="flex gap-1.5">
                  <button type="button" onClick={() => respondToTime(true)} className="btn btn-primary min-h-0 px-2.5 py-1 text-xs">Oui</button>
                  <button type="button" onClick={() => respondToTime(false)} className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs">Non</button>
                </span>
              )}
            </div>
          )}
          {timeProposal === null && match.status === "IN_PROGRESS" && match.moves.length === 0 && mode === "CASUAL" && (
            <div className="mt-3">
              <p className="eyebrow mb-1.5">Proposer une cadence</p>
              <div className="flex flex-wrap gap-1.5">
                {[3, 5, 10, 15].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => socketRef.current?.emit("propose_time", { matchId: match.matchId, minutes })}
                    className="btn btn-ghost min-h-0 px-2.5 py-1 text-xs"
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {showFriendlyStake && (
          <details className="card group p-4" open={match.betStatus === "PROPOSED" || match.betStatus === "COUNTERED"}>
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2">
                <Swords className="size-4 text-accent" /> Défi en points classiques
              </span>
              <ChevronDown className="size-4 text-ink-muted transition group-open:rotate-180" />
            </summary>
            <p className="mt-2 text-xs text-ink-muted">
              Facultatif, avant le premier coup. Aucune valeur monétaire.
            </p>
            {(match.betStatus === "PROPOSED" || match.betStatus === "COUNTERED") &&
            match.betAmount !== null &&
            match.betProposedById ? (
              match.betProposedById === match.playerId ? (
                <div className="mt-3 space-y-2">
                  <p role="status" className="text-sm text-gold">
                    Défi de {match.betAmount} pts en attente de réponse.
                  </p>
                  {match.betStatus === "COUNTERED" && (
                    <button type="button" disabled={!socketConnected || pendingAction} onClick={() => respondToBet(false)} className="btn btn-ghost w-full">
                      Annuler
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-gold">
                    {match.betStatus === "COUNTERED" ? "Contre-proposition" : "Défi proposé"} : {match.betAmount} pts
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={!socketConnected || pendingAction} onClick={() => respondToBet(true)} className="btn btn-primary">
                      <Check className="size-4" /> Accepter
                    </button>
                    <button type="button" disabled={!socketConnected || pendingAction} onClick={() => respondToBet(false)} className="btn btn-ghost">
                      <X className="size-4" /> Refuser
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input type="number" min="1" placeholder="Autre montant" ref={counterBetAmountInputRef} className="field" disabled={!socketConnected || pendingAction} />
                    <button
                      type="button"
                      disabled={!socketConnected || pendingAction}
                      onClick={() => {
                        const amount = Number(counterBetAmountInputRef.current?.value ?? 0);
                        if (Number.isInteger(amount) && amount >= 1) counterBet(amount);
                      }}
                      className="btn btn-ghost shrink-0"
                    >
                      Relancer
                    </button>
                  </div>
                </div>
              )
            ) : match.betStatus === "ACCEPTED" ? (
              <p className="mt-3 text-sm text-accent">Défi accepté : {match.betAmount} pts chacun.</p>
            ) : (
              <div className="mt-3 flex gap-2">
                <input type="number" min="1" placeholder="Montant" ref={betAmountInputRef} className="field" disabled={!socketConnected || pendingAction} />
                <button
                  type="button"
                  disabled={!socketConnected || pendingAction || typeof match.pointsBalance !== "number" || match.pointsBalance < 1}
                  onClick={() => {
                    const amount = Number(betAmountInputRef.current?.value ?? 0);
                    if (Number.isInteger(amount) && amount >= 1) proposeBet(amount);
                  }}
                  className="btn btn-primary shrink-0"
                >
                  Proposer
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-ink-muted tabular">
              Votre solde : {typeof match.pointsBalance === "number" ? match.pointsBalance : "—"} pts
            </p>
          </details>
        )}

        <div className="card flex min-h-0 flex-col p-4">
          <p className="eyebrow flex items-center gap-1.5">
            <History className="size-3.5" /> Coups ({match.moves.length})
          </p>
          {moveList.length === 0 ? (
            <p className="mt-2 text-xs text-ink-muted">La partie n’a pas encore commencé.</p>
          ) : (
            <ol
              ref={moveListRef}
              className="tabular mt-2 grid max-h-44 grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-0.5 overflow-y-auto font-mono text-xs lg:max-h-56"
            >
              {Array.from({ length: Math.ceil(moveList.length / 2) }, (_, i) => (
                <li key={i} className="contents">
                  <span className="text-ink-muted">{i + 1}.</span>
                  <span className={i * 2 === moveList.length - 1 ? "text-accent" : ""}>{moveList[i * 2]}</span>
                  <span className={i * 2 + 1 === moveList.length - 1 ? "text-accent" : ""}>{moveList[i * 2 + 1] ?? ""}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {chatAvailable && (
          <div className="card hidden min-h-[220px] flex-1 flex-col p-4 lg:flex">
            <div className="flex items-center justify-between">
              <p className="eyebrow flex items-center gap-1.5">
                <MessageCircle className="size-3.5" /> Chat
              </p>
              <button type="button" onClick={() => setChatOpen(true)} className="text-xs text-ink-muted hover:text-ink">
                Agrandir
              </button>
            </div>
            <div id="chat-mini-messages" className="mt-2 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {chatMessages.length === 0 ? (
                <p className="text-xs text-ink-muted">Aucun message.</p>
              ) : (
                chatMessages.slice(-30).map((m) => (
                  <p key={m.id} className="text-sm leading-5">
                    <span className={`font-semibold ${m.from === match.playerId ? "text-accent" : "text-gold"}`}>
                      {m.from === match.playerId ? "Vous" : match.opponentUsername}
                    </span>{" "}
                    <span className="break-words text-ink-soft">{m.text}</span>
                  </p>
                ))
              )}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendChatMessage();
              }}
            >
              <input
                type="text"
                value={chatInput}
                maxLength={500}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message…"
                className="field"
                disabled={!socketConnected}
              />
              <button type="submit" disabled={!chatInput.trim() || !socketConnected} className="btn btn-primary shrink-0 px-3" aria-label="Envoyer">
                <Send className="size-4" />
              </button>
            </form>
          </div>
        )}

        <Link href="/match/en-ligne" className="btn btn-ghost">
          <ArrowLeft className="size-4" /> Matchmaking
        </Link>
      </aside>

      {chatOpen && chatAvailable && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4" onClick={() => setChatOpen(false)}>
          <section
            className="card flex max-h-[80dvh] w-full max-w-lg flex-col rounded-b-none p-5 animate-rise sm:rounded-b-[var(--radius-card)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Chat — {match.opponentUsername}</h2>
              <button type="button" onClick={() => setChatOpen(false)} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-3 hover:text-ink" aria-label="Fermer">
                <X className="size-5" />
              </button>
            </div>
            <div ref={chatContainerRef} className="mb-3 min-h-[30dvh] flex-1 space-y-2 overflow-y-auto pr-1">
              {chatMessages.length === 0 ? (
                <p className="text-center text-xs text-ink-muted">Aucun message pour l’instant.</p>
              ) : (
                chatMessages.map((m) => (
                  <div key={m.id} className={`flex ${m.from === match.playerId ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[85%]">
                      <span
                        className={`inline-block break-words rounded-2xl px-3 py-1.5 text-sm ${
                          m.from === match.playerId ? "bg-accent/20 text-ink" : "bg-surface-3 text-ink"
                        }`}
                      >
                        {m.text}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-ink-muted">
                        {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              {["👍", "👏", "😄", "😮", "🤝", "🔥", "😅", "🙏"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setChatInput((prev) => prev + emoji)}
                  className="rounded-lg px-1.5 py-0.5 text-lg hover:bg-surface-3"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendChatMessage();
              }}
            >
              <input
                type="text"
                value={chatInput}
                maxLength={500}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Écrire un message…"
                className="field"
                disabled={!socketConnected}
                autoFocus
              />
              <button type="submit" disabled={!chatInput.trim() || !socketConnected} className="btn btn-primary shrink-0" aria-label="Envoyer">
                <Send className="size-4" />
              </button>
            </form>
          </section>
        </div>
      )}

      {rematchWaiting && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <section role="dialog" aria-modal="true" aria-labelledby="rematch-waiting-title" className="card w-full max-w-md p-7 text-center animate-rise">
            <LoaderCircle className="mx-auto size-9 animate-spin text-accent" />
            <h2 id="rematch-waiting-title" className="mt-5 text-xl font-semibold">Revanche demandée</h2>
            <p className="mt-2 text-sm text-ink-muted">
              La partie redémarre dès que {match.opponentUsername} accepte.
              {mode === "MONEY" && match.stakeAmount ? ` Une nouvelle mise de ${formatCfa(match.stakeAmount)} sera bloquée.` : ""}
            </p>
            <button type="button" onClick={quitAfterMatch} className="btn btn-ghost mt-6 w-full">
              <LogOut size={16} /> Quitter
            </button>
          </section>
        </div>
      )}

      {match.status === "ABORTED" && !rematchWaiting && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <section role="dialog" aria-modal="true" className="card w-full max-w-md p-7 text-center animate-rise">
            <h2 className="text-xl font-semibold">Partie annulée</h2>
            <p className="mt-2 text-sm text-ink-muted">
              La partie s’est arrêtée avant de vraiment commencer : aucun point, aucun ELO
              {mode === "MONEY" ? " et les mises ont été intégralement rendues" : ""}.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <Link href="/match/en-ligne" className="btn btn-primary">Nouvelle recherche</Link>
              <button type="button" onClick={quitAfterMatch} className="btn btn-ghost">Accueil</button>
            </div>
          </section>
        </div>
      )}

      {result && !rematchWaiting && (
        <GameResultModal
          result={result}
          gameName={`${gameName} en ligne`}
          modeLabel={modeLabel}
          onNewGame={
            match.tournamentId
              ? () => router.push(`/tournois/${encodeURIComponent(match.tournamentId!)}`)
              : requestRematch
          }
          newGameLabel={match.tournamentId ? "Retour au tournoi" : undefined}
          onQuit={quitAfterMatch}
          description={resultDescription}
          pointsMessage={pointsMessage}
          pointsChange={mode === "MONEY" ? 0 : pointsChange}
          pointsBalance={match.pointsBalance}
          pointsOpponentName={match.opponentUsername}
          pointsOpponentChange={mode === "MONEY" ? 0 : match.opponentPointsChange}
          pointsOpponentBalance={match.opponentPointsBalance}
          showElo={mode === "RATED" || (match.eloChange ?? 0) !== 0}
          eloChange={match.eloChange}
          eloBalance={match.eloBalance}
          eloOpponentChange={match.opponentEloChange}
          eloOpponentBalance={match.opponentEloBalance}
          moneyChange={mode === "MONEY" ? match.moneyChange ?? 0 : null}
          moneyCommission={match.moneyCommission}
          actionError={error}
        />
      )}
    </div>
  );
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatCfa(value: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;
}
