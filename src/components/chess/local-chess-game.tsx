"use client";

import { Chess, SQUARES, type PieceSymbol, type Square } from "chess.js";
import {
  ArrowLeft,
  Bot,
  Check,
  Circle,
  RotateCcw,
  Swords,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Difficulty } from "@/lib/engine/game-settings";
import { requestComputerMove } from "@/lib/game-ai-client";
import {
  animateOpponentMove,
  playPieceMoveSound,
  waitForOpponent,
} from "@/lib/game-feedback";
import { DifficultySelector } from "@/components/games/difficulty-selector";
import { GameResultModal } from "@/components/games/game-result-modal";
import { useBoardPointerDrag } from "@/components/games/use-board-pointer-drag";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const PIECES: Record<"w" | "b", Record<PieceSymbol, string>> = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

interface LastMove {
  from: Square;
  to: Square;
}

interface LocalChessGameProps {
  initialDifficulty: Difficulty;
}

function getKingSquare(game: Chess, color: "w" | "b"): Square | null {
  for (const [row, squares] of game.board().entries()) {
    for (const [file, piece] of squares.entries()) {
      if (piece?.type === "k" && piece.color === color) {
        return `${FILES[file]}${8 - row}` as Square;
      }
    }
  }
  return null;
}

function replayHistory(history: string[]): Chess {
  const game = new Chess();
  for (const move of history) game.move(move);
  return game;
}

export function LocalChessGame({
  initialDifficulty,
}: LocalChessGameProps) {
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalDestinations, setLegalDestinations] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState(initialDifficulty);
  const [engineError, setEngineError] = useState("");
  const [opponentMovingFrom, setOpponentMovingFrom] = useState<Square | null>(
    null,
  );
  const boardRef = useRef<HTMLDivElement>(null);

  const game = replayHistory(moveHistory);
  const isGameOver = game.isGameOver();
  const isThinking = game.turn() === "b" && !isGameOver;
  const isHumanTurn = game.turn() === "w" && !isGameOver;
  const checkedKing = game.isCheck() ? getKingSquare(game, game.turn()) : null;
  const result = isGameOver
    ? game.isCheckmate()
      ? game.turn() === "b"
        ? "win"
        : "loss"
      : "draw"
    : null;

  useEffect(() => {
    const currentGame = replayHistory(moveHistory);
    if (currentGame.turn() !== "b" || currentGame.isGameOver()) return;
    let cancelled = false;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      const activeGame = replayHistory(moveHistory);
      void requestComputerMove({
        game: "chess",
        fen: activeGame.fen(),
        difficulty,
      }, controller.signal)
        .then(async (computerMove) => {
          if (cancelled) return;
          if (!computerMove || "captures" in computerMove) {
            setEngineError("Le moteur n’a retourné aucun coup possible.");
            return;
          }

          if (!(await waitForOpponent(550 + Math.random() * 550, controller.signal))) {
            return;
          }
          const glyph = PIECES.b[computerMove.piece];
          setOpponentMovingFrom(computerMove.from);
          const moved = await animateOpponentMove(
            boardRef.current,
            computerMove.from,
            computerMove.to,
            glyph,
            380 + Math.random() * 180,
            controller.signal,
          );
          if (!moved || cancelled) {
            if (!cancelled) setOpponentMovingFrom(null);
            return;
          }

          const playedMove = activeGame.move({
            from: computerMove.from,
            to: computerMove.to,
            promotion: computerMove.promotion ?? "q",
          });
          playPieceMoveSound();
          setOpponentMovingFrom(null);
          setLastMove({ from: playedMove.from, to: playedMove.to });
          setMoveHistory(activeGame.history());
          setEngineError("");
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setEngineError(
              error instanceof Error ? error.message : "Erreur du moteur de jeu.",
            );
          }
        });
    }, 120);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [difficulty, moveHistory]);

  const selectSquare = useCallback((square: Square) => {
    if (!isHumanTurn) return;
    const activeGame = replayHistory(moveHistory);

    if (selectedSquare && legalDestinations.includes(square)) {
      const move = activeGame.move({
        from: selectedSquare,
        to: square,
        promotion: "q",
      });
      playPieceMoveSound();
      setLastMove({ from: move.from, to: move.to });
      setMoveHistory(activeGame.history());
      setSelectedSquare(null);
      setLegalDestinations([]);
      setEngineError("");
      return;
    }

    const piece = activeGame.get(square);
    if (piece?.color === "w") {
      setSelectedSquare(square);
      setLegalDestinations(
        activeGame.moves({ square, verbose: true }).map((move) => move.to),
      );
      return;
    }

    setSelectedSquare(null);
    setLegalDestinations([]);
  }, [isHumanTurn, legalDestinations, moveHistory, selectedSquare]);

  const handleDrop = useCallback(
    (from: string, to: string) => {
      const source = SQUARES.find((square) => square === from);
      const destination = SQUARES.find((square) => square === to);
      if (!source || !destination || selectedSquare !== source) return;

      if (!legalDestinations.includes(destination)) {
        selectSquare(destination);
        return;
      }

      const activeGame = replayHistory(moveHistory);
      const move = activeGame.move({
        from: source,
        to: destination,
        promotion: "q",
      });
      playPieceMoveSound();
      setLastMove({ from: move.from, to: move.to });
      setMoveHistory(activeGame.history());
      setSelectedSquare(null);
      setLegalDestinations([]);
      setEngineError("");
    },
    [legalDestinations, moveHistory, selectedSquare, selectSquare],
  );
  const { drag, beginDrag, consumeClick } = useBoardPointerDrag(handleDrop);

  function startNewGame() {
    setMoveHistory([]);
    setSelectedSquare(null);
    setLegalDestinations([]);
    setLastMove(null);
    setEngineError("");
    setOpponentMovingFrom(null);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080d0b] text-[#f3f5ef]">
      <div className="pointer-events-none absolute -left-40 top-[-18rem] h-[38rem] w-[38rem] rounded-full bg-emerald-500/10 blur-[130px]" />
      <div className="pointer-events-none absolute -right-40 top-80 h-[30rem] w-[30rem] rounded-full bg-amber-400/5 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-10 sm:px-8">
        <header className="flex items-center justify-between border-b border-white/10 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-200">
              <Swords size={21} />
            </span>
            <span className="text-sm font-bold tracking-[0.18em]">
              THOT <span className="text-emerald-300">STRATÉGIE</span>
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition hover:border-white/25 hover:text-white"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Retour au dashboard</span>
            <span className="sm:hidden">Retour</span>
          </Link>
        </header>

        <section className="flex-1 py-8 sm:py-10">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.22em] text-emerald-300">
                <span className="h-px w-7 bg-emerald-300/70" />
                PARTIE LOCALE
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Échecs <span className="font-serif font-normal italic text-emerald-200">contre l’IA</span>
              </h1>
              <p className="mt-2 text-sm text-white/45">
                Jouez les blancs. Les coups sont vérifiés par le moteur d’échecs.
              </p>
            </div>
            <button
              type="button"
              onClick={startNewGame}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white/75 transition hover:border-emerald-200/30 hover:text-white"
            >
              <RotateCcw size={16} />
              Nouvelle partie
            </button>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.65fr)]">
            <section
              aria-label="Échiquier"
              className="mx-auto w-full max-w-[680px] rounded-3xl border border-white/10 bg-white/[0.035] p-3 shadow-2xl shadow-black/30 sm:p-5"
            >
              <div
                className={`mb-3 flex items-center justify-between rounded-xl border px-3 py-2 ${
                  isThinking
                    ? "border-amber-200/20 bg-amber-200/[0.05]"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-300/10 text-xl">
                    ♚
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Adversaire</p>
                    <p className="text-xs text-white/40">IA locale · {difficulty}</p>
                  </div>
                </div>
                <Bot className="text-emerald-200/70" size={20} />
              </div>

              <div
                ref={boardRef}
                className="grid touch-none select-none grid-cols-8 overflow-hidden rounded-xl border border-black/30"
              >
                {Array.from({ length: 8 }, (_, row) =>
                  FILES.map((file, column) => {
                    const square = `${file}${8 - row}` as Square;
                    const piece = game.get(square);
                    const isLight = (row + column) % 2 === 0;
                    const isSelected = selectedSquare === square;
                    const isLegalDestination = legalDestinations.includes(square);
                    const isLastMoveSquare =
                      lastMove?.from === square || lastMove?.to === square;
                    const isCheckedKing = checkedKing === square;
                    const isOpponentMoving = opponentMovingFrom === square;

                    return (
                      <button
                        key={square}
                        type="button"
                        data-square={square}
                        aria-label={`${square}${piece ? `, ${piece.color === "w" ? "blanc" : "noir"} ${piece.type}` : ""}`}
                        aria-pressed={isSelected}
                        disabled={!isHumanTurn}
                        onClick={() => {
                          if (consumeClick()) return;
                          selectSquare(square);
                        }}
                        onPointerDown={(event) => {
                          if (!isHumanTurn || piece?.color !== "w") return;
                          selectSquare(square);
                          beginDrag(event, square, PIECES[piece.color][piece.type]);
                        }}
                        className={[
                          "relative flex aspect-square touch-none select-none items-center justify-center transition-colors focus:z-10 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-emerald-300",
                          isLight ? "bg-[#d9dfc8]" : "bg-[#617d69]",
                          isLastMoveSquare ? "after:absolute after:inset-0 after:bg-amber-300/25" : "",
                          isCheckedKing ? "bg-red-500/75" : "",
                          isSelected ? "ring-4 ring-inset ring-emerald-300" : "",
                          isHumanTurn ? "cursor-pointer" : "cursor-default",
                          drag?.from === square || isOpponentMoving ? "opacity-0" : "",
                        ].join(" ")}
                      >
                        {isLegalDestination && (
                          <span className="absolute inset-0 z-[1] flex items-center justify-center">
                            {piece ? (
                              <span className="size-[82%] rounded-full border-[5px] border-emerald-950/45 sm:border-[7px]" />
                            ) : (
                              <Circle
                                aria-hidden="true"
                                className="size-3 fill-emerald-950/35 text-emerald-950/35 sm:size-4"
                              />
                            )}
                          </span>
                        )}
                        {piece && (
                          <span
                            aria-hidden="true"
                            className={[
                              "relative z-[2] select-none text-[clamp(1.7rem,7vw,3.8rem)] leading-none",
                              piece.color === "w"
                                ? "text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.45)]"
                                : "text-[#121713] drop-shadow-[0_1px_1px_rgba(255,255,255,0.45)]",
                            ].join(" ")}
                          >
                            {PIECES[piece.color][piece.type]}
                          </span>
                        )}
                        {column === 0 && (
                          <span
                            aria-hidden="true"
                            className={`absolute left-1 top-0.5 z-[3] text-[10px] font-semibold sm:left-1.5 sm:top-1 ${
                              isLight ? "text-[#617d69]" : "text-[#d9dfc8]"
                            }`}
                          >
                            {8 - row}
                          </span>
                        )}
                        {row === 7 && (
                          <span
                            aria-hidden="true"
                            className={`absolute bottom-0 right-1 z-[3] text-[10px] font-semibold sm:right-1.5 ${
                              isLight ? "text-[#617d69]" : "text-[#d9dfc8]"
                            }`}
                          >
                            {file}
                          </span>
                        )}
                      </button>
                    );
                  }),
                ).flat()}
              </div>

              <div
                className={`mt-3 flex items-center justify-between rounded-xl border px-3 py-2 ${
                  isHumanTurn
                    ? "border-emerald-200/25 bg-emerald-200/[0.06]"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-white/[0.08] text-xl">
                    ♔
                  </span>
                  <div>
                    <p className="text-sm font-semibold">Vous</p>
                    <p className="text-xs text-white/40">
                      Blancs{isHumanTurn ? " · à vous" : ""}
                    </p>
                  </div>
                </div>
                {isGameOver && (
                  <span className="flex items-center gap-1.5 rounded-full border border-emerald-200/15 bg-emerald-200/[0.07] px-3 py-1.5 text-xs text-emerald-100">
                    <Check size={13} />
                    Partie terminée
                  </span>
                )}
              </div>
            </section>

            <aside className="grid gap-4">
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <DifficultySelector
                  value={difficulty}
                  onChange={setDifficulty}
                  disabled={moveHistory.length > 0}
                />
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-xs font-semibold tracking-[0.18em] text-white/40">
                  ÉTAT DE LA PARTIE
                </p>
                <div className="mt-4 flex items-center gap-3">
                  <span
                    className={`size-2.5 rounded-full ${
                      isThinking
                        ? "animate-pulse bg-amber-300"
                        : isGameOver
                          ? "bg-white/30"
                          : "bg-emerald-300"
                    }`}
                  />
                  <p aria-live="polite" className="text-sm font-medium text-white/85">
                    {isGameOver
                      ? "Partie terminée"
                      : engineError
                        ? "Erreur de calcul de l’IA."
                        : isThinking
                          ? "Tour de l’adversaire"
                          : "À vous de jouer"}
                  </p>
                </div>
                {engineError && (
                  <p role="alert" className="mt-3 text-xs text-red-200">
                    {engineError}
                  </p>
                )}
                <p className="mt-4 border-t border-white/[0.08] pt-4 text-xs leading-5 text-white/40">
                  Glissez une pièce blanche vers une case surlignée, ou cliquez
                  une fois sur la pièce puis sur sa destination. Les promotions
                  se font automatiquement en dame.
                </p>
              </section>

              <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.18em] text-white/40">
                      COUPS JOUÉS
                    </p>
                    <p className="mt-1 text-sm text-white/65">
                      {moveHistory.length === 0
                        ? "La partie n’a pas encore commencé"
                        : `${Math.ceil(moveHistory.length / 2)} demi-coup${moveHistory.length > 1 ? "s" : ""}`}
                    </p>
                  </div>
                  <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs tabular-nums text-white/55">
                    {moveHistory.length}
                  </span>
                </div>
                <div
                  aria-label="Historique des coups"
                  className="max-h-64 min-h-24 overflow-y-auto p-3"
                >
                  {moveHistory.length === 0 ? (
                    <p className="px-2 py-5 text-center text-sm text-white/30">
                      Les coups apparaîtront ici.
                    </p>
                  ) : (
                    <ol className="grid grid-cols-[2rem_1fr_1fr] gap-x-2 gap-y-1">
                      {Array.from(
                        { length: Math.ceil(moveHistory.length / 2) },
                        (_, index) => (
                          <li
                            key={index}
                            className="contents text-sm tabular-nums"
                          >
                            <span className="py-2 text-white/30">{index + 1}.</span>
                            <span className="rounded-lg bg-emerald-300/[0.08] px-3 py-2 text-emerald-100">
                              {moveHistory[index * 2]}
                            </span>
                            <span className="rounded-lg px-3 py-2 text-white/65">
                              {moveHistory[index * 2 + 1] ?? ""}
                            </span>
                          </li>
                        ),
                      )}
                    </ol>
                  )}
                </div>
              </section>

              <div className="rounded-2xl border border-amber-200/10 bg-amber-200/[0.035] p-4">
                <p className="text-xs font-semibold text-amber-100/70">
                  Partie d’entraînement
                </p>
                <p className="mt-1 text-xs leading-5 text-white/40">
                  Entraînement local : le solde de points est modifié uniquement
                  pour les matchs dont le résultat est validé par le serveur.
                </p>
              </div>
            </aside>
          </div>
        </section>
      </div>
      {drag && (
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 text-6xl drop-shadow-[0_8px_8px_rgba(0,0,0,0.65)]"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.piece}
        </span>
      )}
      {result && (
        <GameResultModal
          result={result}
          gameName="Échecs"
          onNewGame={startNewGame}
        />
      )}
    </main>
  );
}
