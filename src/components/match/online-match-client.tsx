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
  const [reconnectSeconds, setReconnectSeconds] = useState(0);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const socketRef = useRef<OnlineSocket | null>(null);

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
      setMatch(state);
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
  const statusText =
    match.status === "ABANDONED"
      ? match.winnerId === null
        ? "La partie a été interrompue."
        : match.winnerId === match.playerId
          ? "Victoire par abandon de l’adversaire."
          : "Défaite par abandon."
      : match.status === "FINISHED"
        ? match.winnerId === null
          ? "Match nul accepté."
          : match.winnerId === match.playerId
            ? match.finishReason === "RESIGNATION" ||
              match.finishReason === "DISCONNECT_FORFEIT" ||
              match.finishReason === "TIME_OUT"
              ? "Victoire par abandon de l’adversaire."
              : "Vous avez remporté la partie."
            : match.finishReason === "RESIGNATION" ||
                match.finishReason === "DISCONNECT_FORFEIT" ||
                match.finishReason === "TIME_OUT"
              ? "Défaite par abandon."
              : "Votre adversaire a remporté la partie."
        : pendingMove
          ? "Validation du coup…"
          : pendingAction
            ? "Validation de votre action…"
          : isYourTurn
            ? "À vous de jouer"
            : "Tour de l’adversaire";

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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-3xl border border-white/10 bg-[#101713] p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">{gameName} · Partie amicale</p>
            <h2 className="mt-1 truncate text-xl font-semibold">
              Vous contre {match.opponentUsername}
            </h2>
          </div>
          <span className="flex items-center gap-2 text-xs text-zinc-400">
            {socketConnected ? <Wifi className="size-4 text-emerald-300" /> : <WifiOff className="size-4 text-rose-300" />}
            {socketConnected ? "En ligne" : "Reconnexion"}
          </span>
         </div>

         {whiteTimeMs !== null && (
           <div className="mb-3 flex justify-between text-sm font-mono text-white/80">
             <span>Blancs : {Math.ceil((whiteTimeMs ?? 0) / 1000)}s</span>
             <span>Noirs : {Math.ceil((blackTimeMs ?? 0) / 1000)}s</span>
           </div>
         )}
         {timeProposal !== null && timeProposalBy && timeProposalBy === match.playerId && (
           <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-500/10 p-2 text-sm">
             <span>Proposition : {timeProposal} min</span>
             <div className="flex items-center gap-2 text-amber-200 text-xs animate-pulse">
               En attente de la réponse de l’adversaire…
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
          className="mx-auto grid aspect-square w-full max-w-[640px] overflow-hidden rounded-xl border-4 border-[#26372d] shadow-2xl"
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
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">État de la partie</h3>
          <p className={`mt-3 text-lg font-semibold ${isYourTurn ? "text-emerald-300" : "text-zinc-100"}`}>{statusText}</p>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-3"><span className="text-zinc-400">Vous</span><span>{match.playerColor === "w" ? "Blancs" : "Noirs"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-zinc-400">Adversaire</span><span className="truncate">{match.opponentUsername}</span></div>
            <div className="flex justify-between gap-3"><span className="text-zinc-400">Coups joués</span><span>{match.moves.length}</span></div>
          </div>
          <p className="mt-4 rounded-xl bg-emerald-950/50 p-3 text-xs leading-relaxed text-emerald-100">
            Les points sont réglés automatiquement à la fin selon le résultat et les pièces restantes.
          </p>
          {match.status === "IN_PROGRESS" && (
            <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
              {match.drawOfferById === match.playerId ? (
                <p role="status" className="rounded-xl bg-amber-950/50 p-3 text-sm text-amber-200">
                  Votre demande de match nul attend la réponse de l’adversaire.
                </p>
              ) : match.drawOfferById ? (
                <div className="space-y-2 rounded-xl bg-amber-950/50 p-3">
                  <p className="text-sm text-amber-200">L’adversaire propose un match nul.</p>
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
        <Link href="/match/en-ligne" className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm font-medium hover:bg-white/5">
          <ArrowLeft className="size-4" /> Retour au matchmaking
        </Link>
      </aside>

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
