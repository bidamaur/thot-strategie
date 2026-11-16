"use client";

import {
  ArrowLeft,
  Bot,
  Check,
  Crown,
  RotateCcw,
  Swords,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DIFFICULTIES, type Difficulty, type DraughtsVariant } from "@/lib/engine/game-settings";
import {
  applyDraughtsMove,
  createDraughtsPosition,
  getLegalDraughtsMoves,
  type DraughtsCoordinate,
  type DraughtsMove,
  type DraughtsPosition,
} from "@/lib/engine/draughts";
import { requestComputerMove } from "@/lib/game-ai-client";
import {
  animateOpponentMove,
  playPieceMoveSound,
  waitForOpponent,
} from "@/lib/game-feedback";
import { DifficultySelector } from "@/components/games/difficulty-selector";
import { GameResultModal } from "@/components/games/game-result-modal";
import { useBoardPointerDrag } from "@/components/games/use-board-pointer-drag";

interface LocalDraughtsGameProps {
  initialDifficulty: Difficulty;
  initialVariant: DraughtsVariant;
}

interface LastMove {
  from: DraughtsCoordinate;
  to: DraughtsCoordinate;
}

function squareKey(square: DraughtsCoordinate): string {
  return `${square.row},${square.col}`;
}

function parseSquareKey(value: string): DraughtsCoordinate | null {
  const [row, col] = value.split(",").map(Number);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
}

function notation(move: DraughtsMove): string {
  const destination = move.path[move.path.length - 1];
  if (!destination) return "";
  const letter = (index: number) => String.fromCharCode(97 + index);
  const coordinate = ({ row, col }: DraughtsCoordinate) =>
    `${letter(col)}${row + 1}`;
  const from = coordinate(move.from);
  const path = move.path.map(coordinate).join(move.captures.length ? "×" : "-");
  return `${from}${move.captures.length ? "×" : "-"}${path}`;
}

function moveDestination(move: DraughtsMove): DraughtsCoordinate | undefined {
  return move.path[move.path.length - 1];
}

function endsAt(move: DraughtsMove, key: string): boolean {
  const destination = moveDestination(move);
  return destination !== undefined && squareKey(destination) === key;
}

function getPieceLabel(
  piece: NonNullable<DraughtsPosition["board"][number][number]>,
): string {
  return `${piece.color === "w" ? "blanche" : "noire"}${piece.king ? " dame" : ""}`;
}

export function LocalDraughtsGame({
  initialDifficulty,
  initialVariant,
}: LocalDraughtsGameProps) {
  const [position, setPosition] = useState(() =>
    createDraughtsPosition(initialVariant),
  );
  const [difficulty, setDifficulty] = useState(initialDifficulty);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [engineError, setEngineError] = useState("");
  const [opponentMovingFrom, setOpponentMovingFrom] =
    useState<DraughtsCoordinate | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const legalMoves = useMemo(
    () => getLegalDraughtsMoves(position),
    [position],
  );
  const isGameOver = legalMoves.length === 0;
  const isThinking = position.turn === "b" && !isGameOver;
  const isHumanTurn = position.turn === "w" && !isGameOver;
  const result = isGameOver ? (position.turn === "b" ? "win" : "loss") : null;
  const selectedMoves = selectedSquare
    ? legalMoves.filter((move) => squareKey(move.from) === selectedSquare)
    : [];
  const destinations = new Set(
    selectedMoves.map((move) => {
      const last = move.path[move.path.length - 1];
      return last ? squareKey(last) : "";
    }),
  );

  const playMove = useCallback((move: DraughtsMove) => {
    const destination = moveDestination(move);
    if (!destination) return;
    setPosition(applyDraughtsMove(position, move));
    setLastMove({ from: move.from, to: destination });
    setHistory((previous) => [...previous, notation(move)]);
    playPieceMoveSound();
    setSelectedSquare(null);
    setEngineError("");
  }, [position]);

  const handleDrop = useCallback(
    (from: string, to: string) => {
      if (!isHumanTurn) return;
      const move = legalMoves.find(
        (candidate) =>
          squareKey(candidate.from) === from &&
          endsAt(candidate, to),
      );
      if (move) {
        playMove(move);
        return;
      }

      const square = parseSquareKey(to);
      const piece = square ? position.board[square.row]?.[square.col] : null;
      if (piece?.color === "w") setSelectedSquare(to);
    },
    [isHumanTurn, legalMoves, playMove, position],
  );
  const { drag, beginDrag, consumeClick } = useBoardPointerDrag(handleDrop);

  useEffect(() => {
    if (position.turn !== "b" || isGameOver) return;
    let cancelled = false;
    const controller = new AbortController();

    void requestComputerMove({
      game: "draughts",
      position,
      variant: position.variant,
      difficulty,
    }, controller.signal)
      .then(async (move) => {
        if (cancelled) return;
        if (!move || !("captures" in move)) {
          setEngineError("Le moteur n’a retourné aucun coup possible.");
          return;
        }
        const nextPosition = applyDraughtsMove(position, move);
        const destination = moveDestination(move);
        if (!destination) {
          setEngineError("Le moteur a retourné un coup incomplet.");
          return;
        }
        if (!(await waitForOpponent(550 + Math.random() * 550, controller.signal))) {
          return;
        }
        setOpponentMovingFrom(move.from);
        let from = move.from;
        for (const step of move.path) {
          const moved = await animateOpponentMove(
            boardRef.current,
            squareKey(from),
            squareKey(step),
            move.path.length && position.board[move.from.row]?.[move.from.col]?.king
              ? "♛"
              : "●",
            300 + Math.random() * 150,
            controller.signal,
          );
          if (!moved || cancelled) {
            if (!cancelled) setOpponentMovingFrom(null);
            return;
          }
          playPieceMoveSound();
          from = step;
        }
        setPosition(nextPosition);
        setLastMove({ from: move.from, to: destination });
        setHistory((previous) => [...previous, notation(move)]);
        setOpponentMovingFrom(null);
        setEngineError("");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setEngineError(
            error instanceof Error ? error.message : "Erreur du moteur de jeu.",
          );
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [difficulty, isGameOver, position]);

  function selectSquare(square: DraughtsCoordinate) {
    if (!isHumanTurn) return;
    const key = squareKey(square);
    const piece = position.board[square.row]?.[square.col];

    if (
      selectedSquare &&
      destinations.has(key)
    ) {
      const move = selectedMoves.find(
        (candidate) => endsAt(candidate, key),
      );
      if (move) playMove(move);
      return;
    }

    if (piece?.color === "w") {
      setSelectedSquare(key);
    } else {
      setSelectedSquare(null);
    }
  }

  function startNewGame() {
    setPosition(createDraughtsPosition(initialVariant));
    setHistory([]);
    setLastMove(null);
    setSelectedSquare(null);
    setEngineError("");
    setOpponentMovingFrom(null);
  }

  const boardSize = position.board.length;
  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas text-ink">
      <div className="pointer-events-none absolute -left-40 top-[-18rem] h-[38rem] w-[38rem] rounded-full bg-emerald-500/10 blur-[130px]" />
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
            href="/match/ia"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Choisir un jeu
          </Link>
        </header>

        <section className="flex-1 py-8 sm:py-10">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-[0.22em] text-emerald-300">
                DAMES CONTRE LA MACHINE
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Dames{" "}
                <span className="font-serif font-normal italic text-emerald-200">
                  {initialVariant === "ENGLISH"
                    ? "anglaises · 8×8"
                    : "internationales · 10×10"}
                </span>
              </h1>
              <p className="mt-2 text-sm text-white/45">
                Déplacez vos pions en les glissant sur le damier.
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

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.65fr)]">
            <section
              aria-label="Damier"
              className="mx-auto w-full max-w-[720px] rounded-3xl border border-white/10 bg-white/[0.035] p-3 shadow-2xl shadow-black/30 sm:p-5"
            >
              <div
                className={`mb-3 flex items-center gap-3 rounded-xl border px-3 py-2 ${
                  isThinking
                    ? "border-amber-200/20 bg-amber-200/[0.05]"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-200">
                  <Bot size={21} />
                </span>
                <div>
                  <p className="text-sm font-semibold">Adversaire</p>
                  <p className="text-xs text-white/40">
                    IA locale · {DIFFICULTIES.find((item) => item.value === difficulty)?.label}
                  </p>
                </div>
              </div>

              <div
                ref={boardRef}
                className="grid touch-none select-none overflow-hidden rounded-xl border border-black/30"
                style={{
                  gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
                }}
              >
                {position.board.flatMap((row, rowIndex) =>
                  row.map((piece, colIndex) => {
                    const coordinate = { row: rowIndex, col: colIndex };
                    const key = squareKey(coordinate);
                    const playable = (rowIndex + colIndex) % 2 === 1;
                    const selected = selectedSquare === key;
                    const isDestination = destinations.has(key);
                    const isLastMove =
                      lastMove &&
                      (squareKey(lastMove.from) === key ||
                        squareKey(lastMove.to) === key);
                    const isDragging = drag?.from === key;
                    const isOpponentMoving =
                      opponentMovingFrom !== null &&
                      squareKey(opponentMovingFrom) === key;

                    return (
                      <button
                        key={key}
                        type="button"
                        data-square={key}
                        aria-label={
                          `${String.fromCharCode(97 + colIndex)}${rowIndex + 1}` +
                          (piece ? `, pion ${getPieceLabel(piece)}` : "")
                        }
                        aria-pressed={selected}
                        disabled={!playable || !isHumanTurn}
                        onPointerDown={(event) => {
                          if (piece?.color !== "w" || !isHumanTurn) return;
                          setSelectedSquare(key);
                          beginDrag(
                            event,
                            key,
                            piece.king ? "♛" : "●",
                          );
                        }}
                        onClick={() => {
                          if (consumeClick()) return;
                          if (playable) selectSquare(coordinate);
                        }}
                        className={[
                          "relative flex aspect-square items-center justify-center focus:z-10 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-emerald-300",
                          playable ? "bg-board-dark" : "bg-board-light",
                          playable && isHumanTurn ? "cursor-grab active:cursor-grabbing" : "",
                          selected ? "ring-4 ring-inset ring-emerald-300" : "",
                          isLastMove ? "after:absolute after:inset-0 after:bg-amber-300/25" : "",
                          isDragging || isOpponentMoving ? "opacity-0" : "",
                        ].join(" ")}
                      >
                        {isDestination && (
                          <span
                            aria-hidden="true"
                            className="absolute z-[1] size-3 rounded-full bg-emerald-200/70 sm:size-4"
                          />
                        )}
                        {piece && (
                          <span
                            aria-hidden="true"
                            className={`relative z-[2] flex size-[76%] items-center justify-center rounded-full border-[3px] shadow-lg sm:border-4 ${
                              piece.color === "w"
                                ? "border-[#eef0dc] bg-[#f7f5e9] shadow-black/25"
                                : "border-line bg-surface-3 shadow-black/55"
                            }`}
                          >
                            {piece.king && (
                              <Crown
                                className={
                                  piece.color === "w"
                                    ? "size-1/2 text-board-dark"
                                    : "size-1/2 text-amber-200"
                                }
                              />
                            )}
                          </span>
                        )}
                      </button>
                    );
                  }),
                )}
              </div>

              <div
                className={`mt-3 flex items-center gap-3 rounded-xl border px-3 py-2 ${
                  isHumanTurn
                    ? "border-emerald-200/25 bg-emerald-200/[0.06]"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-white/[0.08]">
                  <span className="size-6 rounded-full border-[3px] border-[#eef0dc] bg-[#f7f5e9]" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Vous</p>
                  <p className="text-xs text-white/40">
                    Pions blancs{isHumanTurn ? " · à vous" : ""}
                  </p>
                </div>
              </div>
            </section>

            <aside className="grid gap-4">
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <DifficultySelector
                  value={difficulty}
                  onChange={setDifficulty}
                  disabled={history.length > 0}
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
                  {position.variant === "INTERNATIONAL"
                    ? "Prise obligatoire et prise de la plus grande quantité de pièces. Les dames se déplacent en diagonale sur plusieurs cases."
                    : "Prise obligatoire. Les pions capturent vers l’avant et les dames se déplacent d’une seule case."}
                </p>
              </section>

              <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.18em] text-white/40">
                      COUPS JOUÉS
                    </p>
                    <p className="mt-1 text-sm text-white/65">
                      {history.length === 0
                        ? "La partie n’a pas encore commencé"
                        : `${history.length} coups`}
                    </p>
                  </div>
                  {isGameOver && (
                    <Check className="text-emerald-200" size={18} />
                  )}
                </div>
                <ol className="max-h-52 min-h-20 space-y-1 overflow-y-auto p-3">
                  {history.length === 0 ? (
                    <li className="px-2 py-4 text-center text-sm text-white/30">
                      Les coups apparaîtront ici.
                    </li>
                  ) : (
                    history.map((move, index) => (
                      <li
                        key={`${index}-${move}`}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
                      >
                        <span className="w-7 text-white/30">{index + 1}.</span>
                        <span
                          className={
                            index % 2 === 0
                              ? "text-emerald-100"
                              : "text-white/65"
                          }
                        >
                          {move}
                        </span>
                      </li>
                    ))
                  )}
                </ol>
              </section>

              <p className="rounded-2xl border border-amber-200/10 bg-amber-200/[0.035] p-4 text-xs leading-5 text-white/40">
                Entraînement local : le solde de points est modifié uniquement
                pour les matchs dont le résultat est validé par le serveur.
              </p>
            </aside>
          </div>
        </section>
      </div>

      {drag && (
        <span
          aria-hidden="true"
          className={`pointer-events-none fixed z-50 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 text-3xl shadow-2xl ${
            drag.piece === "●"
              ? "border-[#eef0dc] bg-[#f7f5e9] text-board-dark"
              : "border-[#eef0dc] bg-[#f7f5e9] text-amber-500"
          }`}
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.piece === "●" ? "" : <Crown size={24} />}
        </span>
      )}
      {result && (
        <GameResultModal
          result={result}
          gameName="Dames"
          onNewGame={startNewGame}
        />
      )}
    </main>
  );
}
