"use client";

import { Chess, SQUARES, type PieceSymbol, type Square } from "chess.js";
import {
  ArrowLeft,
  Check,
  Crown,
  Flag,
  Handshake,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Send,
  Smile,
  UserRound,
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
  status: "IN_PROGRESS" | "FINISHED" | "ABANDONED";
  winnerId: string | null;
  scoreDelta: number | null;
  pointsChange?: number | null;
  pointsBalance?: number | null;
  opponentPointsChange?: number | null;
  opponentPointsBalance?: number | null;
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
    | "TIME_OUT";
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
      status,
      reason,
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
              drawOfferById: null,
              finishReason: reason,
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
    if (match.betStatus !== "PROPOSED") return;
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

  if (!match) {
    return (
      <section className="rounded-3xl border border-white/10 bg-[#101713] p-8 text-center">
        <LoaderCircle className="mx-auto mb-4 size-8 animate-spin text-emerald-300" />
        <h2 className="text-xl font-semibold">Connexion à la partie</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Synchronisation du plateau et des joueurs…
        </p>
        {!socketConnected && (
          <p className="mt-3 text-sm text-amber-300">Connexion au serveur en cours.</p>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      </section>
    );
  }

  const gameName = match.gameType === "CHESS" ? "Échecs" : "Dames";
  const resultDescription =
    match.finishReason === "RESIGNATION"
      ? match.winnerId === match.playerId
        ? "Votre adversaire a abandonné. La victoire et les points ont été enregistrés."
        : "Vous avez abandonné la partie. La victoire et les points de votre adversaire ont été enregistrés."
      : match.finishReason === "DISCONNECT_FORFEIT"
        ? match.winnerId === match.playerId
          ? "Votre adversaire ne s’est pas reconnecté à temps. La victoire et les points ont été enregistrés."
          : "Vous ne vous êtes pas reconnecté à temps. La victoire et les points de votre adversaire ont été enregistrés."
        : match.finishReason === "TIME_OUT"
          ? match.winnerId === match.playerId
            ? "Votre adversaire a dépassé le temps imparti. La victoire et les points ont été enregistrés."
            : "Vous avez dépassé le temps imparti. La victoire et les points de votre adversaire ont été enregistrés."
        : match.finishReason === "DRAW_OFFER"
          ? "La demande de match nul a été acceptée."
            : match.status === "ABANDONED"
              ? match.winnerId === match.playerId
                ? "Votre adversaire a abandonné. La victoire et les points ont été enregistrés."
                : "Vous avez abandonné la partie. La victoire et les points de votre adversaire ont été enregistrés."
              : "Le résultat de la partie a été enregistré.";
  const pointsChange =
    typeof match.pointsChange === "number" &&
    Number.isFinite(match.pointsChange)
      ? match.pointsChange
      : match.status !== "IN_PROGRESS" &&
          typeof match.scoreDelta === "number" &&
          Number.isFinite(match.scoreDelta)
        ? match.winnerId === null
          ? 0
          : match.winnerId === match.playerId
            ? match.scoreDelta
            : -match.scoreDelta
        : null;
  const pointsMessage =
    pointsChange === null
      ? "Points non disponibles"
      : `${pointsChange > 0 ? "+" : ""}${pointsChange} point${Math.abs(pointsChange) === 1 ? "" : "s"}`;

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-3xl border border-white/10 bg-[#101713] p-4 sm:p-6 flex flex-col">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">
                {gameName} · Partie amicale
              </p>
              <h2 className="mt-1 truncate text-xl font-semibold">
                Vous contre {match.opponentUsername}
              </h2>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full border-2 border-white" />
                  <span className="text-zinc-400">{match.playerColor === "w" ? "Blancs" : "Noirs"}</span>
                </div>
                <span className={`flex items-center gap-1.5 text-xs font-medium ${isYourTurn ? "text-emerald-300" : "text-zinc-500"}`}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isYourTurn ? "#10b981" : "#6b7280" }} />
                  {isYourTurn ? "Votre tour" : "Tour de l&apos;adversaire"}
                </span>
              </div>
            </div>
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              {socketConnected ? <Wifi className="size-4 text-emerald-300" /> : <WifiOff className="size-4 text-rose-300" />}
              {socketConnected ? "En ligne" : "Reconnexion"}
            </span>
          </div>

          <div className="mb-3 flex justify-between text-sm font-mono text-white/80">
            <span>Blancs : {Math.ceil((whiteTimeMs ?? 0) / 1000)}s</span>
            <span>Noirs : {Math.ceil((blackTimeMs ?? 0) / 1000)}s</span>
          </div>

          {timeProposal !== null && timeProposalBy && timeProposalBy === match.playerId && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-500/10 p-2 text-sm">
              <span>Proposition : {timeProposal} min</span>
              <div className="flex items-center gap-2 text-amber-200 text-xs animate-pulse">
                En attente de la réponse de l&apos;adversaire…
              </div>
            </div>
          )}
          {timeProposal !== null && timeProposalBy && timeProposalBy !== match.playerId && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-500/10 p-2 text-sm">
              <span>Proposition : {timeProposal} min</span>
              <div className="flex gap-2">
                <button onClick={() => socketRef.current?.emit("respond_time", { matchId: match!.matchId, accept: true })} className="rounded bg-emerald-500 px-2 py-1 text-xs">Accepter</button>
                <button onClick={() => socketRef.current?.emit("respond_time", { matchId: match!.matchId, accept: false })} className="rounded bg-rose-500 px-2 py-1 text-xs">Refuser</button>
              </div>
            </div>
          )}
          {timeProposal === null && match.moves.length === 0 && (
            <div className="mb-3 flex gap-2">
              <button
                onClick={() => {
                  const m = window.prompt("Minutes (4-12) ou vide pour sans temps", "12");
                  if (m === null) return;
                  const minutes = m.trim() === "" ? null : Number(m);
                  socketRef.current?.emit("propose_time", { matchId: match!.matchId, minutes: minutes ?? 12 });
                }}
                className="rounded bg-white/10 px-3 py-1 text-xs"
              >
                Proposer un temps
              </button>
            </div>
          )}

          <div
            className="mx-auto grid aspect-square w-full max-w-[640px] overflow-hidden rounded-xl border-4 border-[#26372d] shadow-2xl mb-4"
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
                const key = square;
                return (
                  <button
                    key={key}
                    type="button"
                    data-square={key}
                    aria-label={`${key}${piece ? `, ${piece.color === "w" ? "blanche" : "noire"}` : ""}`}
                    disabled={!isYourTurn}
                    onPointerDown={(event) => {
                      if (piece?.color !== match.playerColor || !isYourTurn) return;
                      setSelectedSquare(square);
                      beginDrag(event, key, CHESS_PIECES[piece.color][piece.type]);
                    }}
                    onClick={() => {
                      if (!consumeClick()) selectChessSquare(square);
                    }}
                    className={[
                      "relative flex aspect-square items-center justify-center touch-none text-[clamp(1.7rem,8vw,4rem)] leading-none focus:z-10 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-emerald-300",
                      (row + col) % 2 === 0 ? "bg-[#d9dfc8]" : "bg-[#617d69]",
                      isSelected ? "ring-4 ring-inset ring-emerald-300" : "",
                      isDestination ? "after:absolute after:size-3 after:rounded-full after:bg-emerald-200/75 sm:after:size-4" : "",
                      drag?.from === key ? "opacity-0" : "",
                    ].join(" ")}
                  >
                    {piece && CHESS_PIECES[piece.color][piece.type]}
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
                        "relative flex aspect-square items-center justify-center touch-none focus:z-10 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-emerald-300",
                        playable ? "bg-[#617d69]" : "bg-[#d9dfc8]",
                        selected ? "ring-4 ring-inset ring-emerald-300" : "",
                        drag?.from === key ? "opacity-0" : "",
                      ].join(" ")}
                    >
                      {isDestination && <span aria-hidden="true" className="absolute z-[1] size-3 rounded-full bg-emerald-200/70 sm:size-4" />}
                      {piece && (
                        <span className={[
                          "relative z-[2] flex size-[78%] items-center justify-center rounded-full border-2 text-[clamp(1rem,5vw,2.4rem)] shadow-md",
                          piece.color === "w" ? "border-zinc-300 bg-zinc-100 text-zinc-800" : "border-zinc-900 bg-zinc-800 text-white",
                        ].join(" ")}>
                          {piece.king ? <Crown className="size-2/3" /> : null}
                        </span>
                      )}
                    </button>
                  );
                }),
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
          {error && <p role="alert" className="mt-4 rounded-xl bg-rose-950/60 p-3 text-sm text-rose-200">{error}</p>}
          {networkNotice && (
            <p role="status" className="mt-4 rounded-xl bg-amber-950/60 p-3 text-sm text-amber-200">
              {networkNotice}
              {reconnectSeconds > 0 && ` ${reconnectSeconds} secondes.`}
            </p>
          )}
        </section>

      <aside className="space-y-4">
        <div className="rounded-3xl border border-white/10 bg-[#101713] p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-white/5 overflow-hidden border border-white/10">
              {match.opponentAvatar && (
                match.opponentAvatar.startsWith("http") || match.opponentAvatar.startsWith("/")
                  ? (
                    <img src={match.opponentAvatar} alt="Avatar adversaire" className="size-full object-cover" />
                  )
                  : (
                    <span className="text-lg">{match.opponentAvatar}</span>
                  )
              )}
              {!match.opponentAvatar && <UserRound size={20} />}
            </div>
            <div className="min-w-0">
              <p className="text-xs tracking-[0.2em] text-white/40">ADVERSAIRE</p>
              <h3 className="mt-0.5 truncate text-lg font-semibold">{match.opponentUsername}</h3>
              <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${match.playerColor === "w" ? "text-amber-100" : "text-zinc-400"}`}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: match.playerColor === "w" ? "#f59e0b" : "#6b7280" }} />
                {match.playerColor === "w" ? "Noirs" : "Blancs"}
              </span>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-zinc-400 uppercase">Vos points</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {typeof match.pointsBalance === "number" ? match.pointsBalance : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-zinc-400 uppercase">Points adversaire</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {typeof match.opponentPointsBalance === "number" ? match.opponentPointsBalance : "—"}
              </p>
            </div>
          </div>

          <div className="mb-4 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-zinc-400">Vous</span><span>{match.playerColor === "w" ? "Blancs" : "Noirs"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-zinc-400">Adversaire</span><span className="truncate">{match.opponentUsername}</span></div>
            <div className="flex justify-between gap-3"><span className="text-zinc-400">Coups joués</span><span>{match.moves.length}</span></div>
          </div>

          {match.status === "IN_PROGRESS" && match.moves.length === 0 && (
            <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Mise volontaire</p>
              {match.betStatus === "PROPOSED" && match.betAmount !== null && match.betProposedById ? (
                match.betProposedById === match.playerId ? (
                  <p role="status" className="rounded-xl bg-amber-950/50 p-3 text-sm text-amber-200">
                    Votre mise de {match.betAmount} point{match.betAmount > 1 ? "s" : ""} attend la réponse de l&apos;adversaire.
                  </p>
                ) : (
                  <div className="space-y-2 rounded-xl bg-amber-950/50 p-3">
                    <p className="text-sm text-amber-200">L&apos;adversaire propose une mise de {match.betAmount} point{match.betAmount > 1 ? "s" : ""}.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!socketConnected || pendingAction}
                        onClick={() => respondToBet(true)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-300 px-2 py-2 text-sm font-semibold text-[#08100c] disabled:opacity-50"
                      >
                        <Check className="size-4" /> Accepter
                      </button>
                      <button
                        type="button"
                        disabled={!socketConnected || pendingAction}
                        onClick={() => respondToBet(false)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 px-2 py-2 text-sm disabled:opacity-50"
                      >
                        <X className="size-4" /> Refuser
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        placeholder="Montant"
                        ref={counterBetAmountInputRef}
                        className="flex-1 rounded-xl border border-white/10 bg-[#111915] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/60 disabled:opacity-50"
                        disabled={!socketConnected || pendingAction}
                      />
                      <button
                        type="button"
                        disabled={!socketConnected || pendingAction}
                        onClick={() => {
                          const input = counterBetAmountInputRef.current;
                          const amount = input ? Number(input.value) : 0;
                          if (amount >= 1 && amount <= 1000) counterBet(amount);
                        }}
                        className="rounded-xl border border-amber-200/30 bg-amber-200/10 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-200/20 disabled:opacity-50"
                      >
                        Surmiser
                      </button>
                    </div>
                  </div>
                )
              ) : match.betStatus === "COUNTERED" && match.betAmount !== null && match.betProposedById ? (
                match.betProposedById === match.playerId ? (
                  <div className="space-y-2 rounded-xl bg-amber-950/50 p-3">
                    <p className="text-sm text-amber-200">L&apos;adversaire a surmisé à {match.betAmount} point{match.betAmount > 1 ? "s" : ""}.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!socketConnected || pendingAction}
                        onClick={() => respondToBet(true)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-300 px-2 py-2 text-sm font-semibold text-[#08100c] disabled:opacity-50"
                      >
                        <Check className="size-4" /> Accepter
                      </button>
                      <button
                        type="button"
                        disabled={!socketConnected || pendingAction}
                        onClick={() => respondToBet(false)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 px-2 py-2 text-sm disabled:opacity-50"
                      >
                        <X className="size-4" /> Refuser
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        placeholder="Montant"
                        ref={counterBetAmountInputRef}
                        className="flex-1 rounded-xl border border-white/10 bg-[#111915] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/60 disabled:opacity-50"
                        disabled={!socketConnected || pendingAction}
                      />
                      <button
                        type="button"
                        disabled={!socketConnected || pendingAction}
                        onClick={() => {
                          const input = counterBetAmountInputRef.current;
                          const amount = input ? Number(input.value) : 0;
                          if (amount >= 1 && amount <= 1000) counterBet(amount);
                        }}
                        className="rounded-xl border border-amber-200/30 bg-amber-200/10 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-200/20 disabled:opacity-50"
                      >
                        Surmiser
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl bg-amber-950/50 p-3">
                    <p className="text-sm text-amber-200">Votre surmise de {match.betAmount} point{match.betAmount > 1 ? "s" : ""} attend la réponse de l&apos;adversaire.</p>
                    <button
                      type="button"
                      disabled={!socketConnected || pendingAction}
                      onClick={() => respondToBet(false)}
                      className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-white/15 px-2 py-2 text-sm disabled:opacity-50"
                    >
                      <X className="size-4" /> Annuler la surmise
                    </button>
                  </div>
                )
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-zinc-400">Votre solde</span>
                    <span className="text-xs font-medium text-white">
                      {typeof match.pointsBalance === "number" ? match.pointsBalance : "—"} pts
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      placeholder="Montant"
                      ref={betAmountInputRef}
                      className="flex-1 rounded-xl border border-white/10 bg-[#111915] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/60 disabled:opacity-50"
                      disabled={!socketConnected || pendingAction}
                    />
                    <button
                      type="button"
                      disabled={
                        !socketConnected ||
                        pendingAction ||
                        typeof match.pointsBalance !== "number" ||
                        match.pointsBalance < 1
                      }
                      onClick={() => {
                        const input = betAmountInputRef.current;
                        const amount = input ? Number(input.value) : 0;
                        if (amount >= 1 && amount <= 1000) proposeBet(amount);
                      }}
                      className="rounded-xl border border-emerald-200/30 bg-emerald-600 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-500 disabled:opacity-50 transition"
                    >
                      Proposer une mise
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {match.status === "IN_PROGRESS" && (
            <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
              {match.drawOfferById === match.playerId ? (
                <p role="status" className="rounded-xl bg-amber-950/50 p-3 text-sm text-amber-200">
                  Votre demande de match nul attend la réponse de l&apos;adversaire.
                </p>
              ) : match.drawOfferById ? (
                <div className="space-y-2 rounded-xl bg-amber-950/50 p-3">
                  <p className="text-sm text-amber-200">L&apos;adversaire propose un match nul.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!socketConnected || pendingAction}
                      onClick={() => respondToDrawOffer(true)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-300 px-2 py-2 text-sm font-semibold text-[#08100c] disabled:opacity-50"
                    >
                      <Check className="size-4" /> Accepter
                    </button>
                    <button
                      type="button"
                      disabled={!socketConnected || pendingAction}
                      onClick={() => respondToDrawOffer(false)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 px-2 py-2 text-sm disabled:opacity-50"
                    >
                      <X className="size-4" /> Refuser
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {remainingPieceCount < 6 ? (
                    <button
                      type="button"
                      disabled={!canOfferDraw}
                      onClick={offerDraw}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200/30 px-4 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-200/10 disabled:opacity-50"
                    >
                      <Handshake className="size-4" /> Demander le match nul
                    </button>
                  ) : (
                    <p className="text-xs text-zinc-500">
                      Demande de nul disponible sous 6 pions ({remainingPieceCount} actuellement).
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!socketConnected || pendingAction}
                    onClick={resignMatch}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300/25 px-4 py-2.5 text-sm font-medium text-rose-200 hover:bg-rose-300/10 disabled:opacity-50"
                  >
                    <Flag className="size-4" /> Abandonner
                  </button>
                  <button
                    type="button"
                    disabled={!socketConnected || pendingAction || leavingMatch}
                    onClick={leaveMatch}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-white/5 disabled:opacity-50"
                  >
                    <LogOut className="size-4" />
                    {leavingMatch ? "Déconnexion…" : "Quitter la partie"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#101713] p-4 flex flex-col h-[320px]">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/5 transition"
            >
              <MessageCircle className="size-4" /> Chat
            </button>
            <span className="text-xs text-zinc-500">{chatMessages.length} message{chatMessages.length > 1 ? "s" : ""}</span>
          </div>
          <div
            id="chat-mini-messages"
            className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-track-[#111915] scrollbar-thumb-[#374151] scrollbar-thumb-hover-[#4b5563]"
          >
            {chatMessages.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">Aucun message pour l&apos;instant.</p>
            ) : (
              chatMessages.slice(-6).map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-2 ${m.from === match.playerId ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[80%] break-words">
                    <span className={`text-xs font-semibold block ${m.from === match.playerId ? "text-emerald-300" : "text-amber-100"}`}>
                      {m.from === match.playerId ? "Vous" : match.opponentUsername}
                    </span>
                    <span className={`inline-block rounded-lg px-2 py-1 text-xs text-white ${m.from === match.playerId ? "bg-emerald-600/70" : "bg-white/10"}`}>
                      {m.text}
                    </span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">
                      {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendChatMessage();
                }
              }}
              placeholder="Écrire un message…"
              className="flex-1 rounded-xl border border-white/10 bg-[#111915] px-3 py-2 text-sm text-white outline-none focus:border-emerald-300/60 disabled:opacity-50"
              disabled={!socketConnected}
            />
            <button
              type="button"
              onClick={sendChatMessage}
              disabled={!chatInput.trim() || !socketConnected}
              className="rounded-xl border border-emerald-200/20 bg-emerald-600 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-500 disabled:opacity-50 transition"
            >
              <Send className="size-4" />
            </button>
          </div>
          {chatMessages.length > 0 && (
            <p className="mt-2 text-[10px] text-zinc-500 italic">
              Cliquez sur &quot;Chat&quot; pour ouvrir la conversation complète avec emoji.
            </p>
          )}
        </div>

        <Link href="/match/en-ligne" className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium hover:bg-white/5">
          <ArrowLeft className="size-4" /> Retour au matchmaking
        </Link>
      </aside>

      {chatOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-4 backdrop-blur-sm sm:items-center">
          <section
            className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101713] p-5 shadow-2xl sm:max-w-lg sm:p-7"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Conversation — {match.opponentUsername}</h2>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition"
              >
                <X className="size-5" />
              </button>
            </div>
            <div ref={chatContainerRef} id="chat-full-messages" className="flex-1 overflow-y-auto space-y-3 pr-2 mb-4 scrollbar-thin scrollbar-track-[#111915] scrollbar-thumb-[#374151] scrollbar-thumb-hover-[#4b5563]">
              {chatMessages.length === 0 ? (
                <p className="text-xs text-zinc-500 italic text-center">Aucun message pour l&apos;instant.</p>
              ) : (
                chatMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex gap-2 ${m.from === match.playerId ? "justify-end" : "justify-start"}`}
                  >
                    <div className="max-w-[85%] break-words">
                      <span className={`text-xs font-semibold block ${m.from === match.playerId ? "text-emerald-300" : "text-amber-100"}`}>
                        {m.from === match.playerId ? "Vous" : match.opponentUsername}
                      </span>
                      <span className={`inline-block rounded-lg px-3 py-1.5 text-sm text-white ${m.from === match.playerId ? "bg-emerald-600/80" : "bg-white/10"}`}>
                        {m.text}
                      </span>
                      <span className="text-[10px] text-zinc-500 block mt-0.5">
                        {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void sendChatMessage();
                  }
                }}
                placeholder="Écrire un message…"
                className="flex-1 rounded-xl border border-white/10 bg-[#111915] px-4 py-3 text-sm text-white outline-none focus:border-emerald-300/60 disabled:opacity-50"
                disabled={!socketConnected}
              />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                  className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-emerald-300 transition"
                >
                  <Smile className="size-5" />
                </button>
                {emojiPickerOpen && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-xl border border-white/10 bg-[#111915] p-2 shadow-xl flex flex-wrap gap-1">
                    {["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😙","😚","😋","😛","😜","🤪","😝","🤗","🤭","🤫","🤔","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🤧","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","😟","🙁","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","💩","👻","👽","🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😿","😾"].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          setChatInput((prev) => prev + emoji);
                          setEmojiPickerOpen(false);
                        }}
                        className="text-center p-1 rounded hover:bg-white/10 text-lg"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={sendChatMessage}
                disabled={!chatInput.trim() || !socketConnected}
                className="rounded-xl border border-emerald-200/20 bg-emerald-600 px-4 py-3 text-sm font-semibold text-emerald-900 hover:bg-emerald-500 disabled:opacity-50 transition"
              >
                <Send className="size-5" />
              </button>
            </div>
          </section>
        </div>
      )}

      {rematchWaiting && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="rematch-waiting-title"
            className="w-full max-w-md rounded-3xl border border-white/10 bg-[#101713] p-7 text-center shadow-2xl"
          >
            <LoaderCircle className="mx-auto size-10 animate-spin text-emerald-300" />
            <h2 id="rematch-waiting-title" className="mt-5 text-2xl font-semibold">
              Nouvelle partie demandée
            </h2>
            <p className="mt-3 text-sm text-zinc-300">
              La partie redémarrera sur ce plateau dès que {match.opponentUsername} aura aussi choisi « Nouvelle partie ».
            </p>
            <button
              type="button"
              onClick={quitAfterMatch}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <LogOut size={16} /> Quitter le jeu
            </button>
          </section>
        </div>
      )}
      {result && !rematchWaiting && (
        <GameResultModal
          result={result}
          gameName={`${gameName} en ligne`}
          onNewGame={requestRematch}
          onQuit={quitAfterMatch}
          description={resultDescription}
          pointsMessage={pointsMessage}
          pointsBalance={match.pointsBalance}
          pointsOpponentName={match.opponentUsername}
          pointsOpponentChange={
            match.opponentPointsChange ??
            (pointsChange === null ? null : -pointsChange)
          }
          pointsOpponentBalance={match.opponentPointsBalance}
          actionError={error}
        />
      )}
    </div>
  );
}
