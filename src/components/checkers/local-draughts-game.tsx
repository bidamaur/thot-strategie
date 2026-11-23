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
import { DIFFICULTIES, humanColorFor, type Difficulty, type DraughtsVariant, type FirstPlayer } from "@/lib/engine/game-settings";
import {
  applyDraughtsMove,
  createDraughtsPosition,
  getLegalDraughtsMoves,
  type DraughtsCoordinate,
  type DraughtsMove,
  type DraughtsPosition,
} from "@/lib/engine/draughts";
import { requestComputerMove } from "@/lib/game-ai-client";
import { playPieceMoveSound, waitForOpponent } from "@/lib/game-feedback";
import { planDraughtsMove, usePieceMotion } from "@/components/board/motion-plans";
import { PieceMotionLayer, prefersReducedMotion } from "@/components/board/piece-motion";
import { animationMs } from "@/lib/board-prefs";
import { getBoardPrefs, useBoardPrefs } from "@/lib/client/board-prefs-store";
import { DifficultySelector } from "@/components/games/difficulty-selector";
import { GameResultModal } from "@/components/games/game-result-modal";
import { useBoardPointerDrag } from "@/components/games/use-board-pointer-drag";
import { DragGhost } from "@/components/games/drag-ghost";
import { useBoardTouchGuard } from "@/components/games/use-board-touch-guard";

interface LocalDraughtsGameProps {
  initialDifficulty: Difficulty;
  /** Niveau maximal accessible (offre gratuite : 3, Premium : 5). */
  maxLevel?: Difficulty;
  /** Partie offerte du jour contre le niveau 5 (une seule partie). */
  trial?: boolean;
  initialVariant: DraughtsVariant;
  /** Qui joue le premier coup (choisi au lancement de l'entraînement). */
  firstPlayer: FirstPlayer;
}

interface LastMove {
  from: DraughtsCoordinate;
  to: DraughtsCoordinate;
  /** Coup complet et positions avant/après : servent uniquement à l'animation. */
  move: DraughtsMove;
  before: DraughtsPosition;
  after: DraughtsPosition;
  seq: number;
  /** Coup posé au glisser : pas de trajet à rejouer. */
  instant: boolean;
}

// Apparence des pions : identique sur le plateau et dans le calque d'animation.
const pieceClasses = (color: string) =>
  `flex size-[76%] items-center justify-center rounded-full border-[3px] shadow-lg sm:border-4 ${
    color === "w" ? "border-[#eef0dc] bg-[#f7f5e9] shadow-black/25" : "border-line bg-surface-3 shadow-black/55"
  }`;
const crownClasses = (color: string) => (color === "w" ? "size-1/2 text-board-dark" : "size-1/2 text-amber-200");

function renderPieceGhost(piece: { color: string; king: boolean }) {
  return <span className={pieceClasses(piece.color)}>{piece.king && <Crown className={crownClasses(piece.color)} />}</span>;
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
  maxLevel = 5,
  trial = false,
  initialVariant,
  firstPlayer,
}: LocalDraughtsGameProps) {
  // Camp au trait dans la position initiale, selon le moteur (règles de la variante).
  const humanColor = humanColorFor(firstPlayer, createDraughtsPosition(initialVariant).turn);
  const aiColor = humanColor === "w" ? "b" : "w";
  // Le joueur a toujours ses pions en bas : damier retourné s'il joue les noirs.
  const flipped = humanColor === "b";
  const [position, setPosition] = useState(() =>
    createDraughtsPosition(initialVariant),
  );
  const [difficulty, setDifficulty] = useState(initialDifficulty);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [engineError, setEngineError] = useState("");
  const boardPrefs = useBoardPrefs();
  const moveSeqRef = useRef(0);
  const boardZoneRef = useBoardTouchGuard();

  const legalMoves = useMemo(
    () => getLegalDraughtsMoves(position),
    [position],
  );
  const isGameOver = legalMoves.length === 0;
  const isThinking = position.turn === aiColor && !isGameOver;
  const isHumanTurn = position.turn === humanColor && !isGameOver;
  const result = isGameOver ? (position.turn === aiColor ? "win" : "loss") : null;
  const selectedMoves = selectedSquare
    ? legalMoves.filter((move) => squareKey(move.from) === selectedSquare)
    : [];
  const destinations = new Set(
    selectedMoves.map((move) => {
      const last = move.path[move.path.length - 1];
      return last ? squareKey(last) : "";
    }),
  );

  const playMove = useCallback((move: DraughtsMove, instant = false) => {
    const destination = moveDestination(move);
    if (!destination) return;
    const after = applyDraughtsMove(position, move);
    moveSeqRef.current += 1;
    setPosition(after);
    setLastMove({ from: move.from, to: destination, move, before: position, after, seq: moveSeqRef.current, instant });
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
        playMove(move, true);
        return;
      }

      const square = parseSquareKey(to);
      const piece = square ? position.board[square.row]?.[square.col] : null;
      if (piece?.color === humanColor) setSelectedSquare(to);
    },
    [humanColor, isHumanTurn, legalMoves, playMove, position],
  );
  const { drag, beginDrag, consumeClick } = useBoardPointerDrag(handleDrop);

  useEffect(() => {
    if (position.turn !== aiColor || isGameOver) return;
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
        if (cancelled) return;
        moveSeqRef.current += 1;
        setPosition(nextPosition);
        setLastMove({ from: move.from, to: destination, move, before: position, after: nextPosition, seq: moveSeqRef.current, instant: false });
        setHistory((previous) => [...previous, notation(move)]);
        setEngineError("");
        // Un son par saut, au rythme de l'animation (comme auparavant).
        for (let hop = 0; hop < move.path.length; hop += 1) {
          window.setTimeout(playPieceMoveSound, (hop + 1) * animationMs(getBoardPrefs()));
        }
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
  }, [aiColor, difficulty, isGameOver, position]);

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

    if (piece?.color === humanColor) {
      setSelectedSquare(key);
    } else {
      setSelectedSquare(null);
    }
  }

  // Essai offert : une seule partie au niveau 5 ; la suivante repasse au niveau autorisé.
  const [trialActive, setTrialActive] = useState(trial);

  function startNewGame() {
    if (trialActive) {
      setTrialActive(false);
      setDifficulty((d) => (d > maxLevel ? maxLevel : d));
    }
    setPosition(createDraughtsPosition(initialVariant));
    setHistory([]);
    setLastMove(null);
    setSelectedSquare(null);
    setEngineError("");
  }

  const boardSize = position.board.length;
  const motionCandidate = useMemo(
    () =>
      lastMove
        ? planDraughtsMove({
            id: `ia:${lastMove.seq}`,
            instant: lastMove.instant,
            move: lastMove.move,
            before: lastMove.before,
            after: lastMove.after,
            keyOf: squareKey,
            renderPiece: renderPieceGhost,
            toDisplay: ({ row, col }) =>
              flipped ? { r: boardSize - 1 - row, c: boardSize - 1 - col } : { r: row, c: col },
          })
        : null,
    [lastMove, flipped, boardSize],
  );
  const motion = usePieceMotion(motionCandidate, boardPrefs.animation !== "none" && !prefersReducedMotion());
  return (
    <main className="game-no-select relative min-h-screen overflow-hidden bg-canvas text-ink">
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
                Vous jouez les {humanColor === "w" ? "blancs" : "noirs"} ·{" "}
                {firstPlayer === "ai" ? "l’IA commence" : "vous commencez"}.
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
                ref={boardZoneRef}
                className="board-touch-zone relative grid touch-none select-none overflow-hidden rounded-xl border border-black/30"
                style={{
                  gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
                }}
              >
                {position.board.flatMap((_, displayRow) =>
                  position.board[displayRow].map((__, displayCol) => {
                    const rowIndex = flipped ? boardSize - 1 - displayRow : displayRow;
                    const colIndex = flipped ? boardSize - 1 - displayCol : displayCol;
                    const piece = position.board[rowIndex][colIndex];
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
                          if (piece?.color !== humanColor || !isHumanTurn) return;
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
                        ].join(" ")}
                      >
                        {isDestination && (
                          <span
                            aria-hidden="true"
                            className="absolute z-[1] size-3 rounded-full bg-emerald-200/70 sm:size-4"
                          />
                        )}
                        {piece && !motion.isHidden(key) && (
                          <span
                            key={motion.promotionKey === key ? `promo${lastMove?.seq}` : "p"}
                            aria-hidden="true"
                            className={`absolute inset-0 z-[2] flex items-center justify-center ${isDragging ? "opacity-0" : ""}`}
                          >
                            <span className={`piece-base piece-disc ${pieceClasses(piece.color)} ${selected ? "piece-selected" : ""}`}>
                              {piece.king && (
                                <Crown className={`${crownClasses(piece.color)} ${motion.promotionKey === key ? "crown-appear" : ""}`} />
                              )}
                            </span>
                          </span>
                        )}
                      </button>
                    );
                  }),
                )}
                {motion.active && (
                  <PieceMotionLayer
                    plan={motion.active.plan}
                    size={boardSize}
                    stepMs={animationMs(boardPrefs)}
                    style={boardPrefs.animation === "lift" ? "lift" : "slide"}
                    onDone={motion.finish}
                  />
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
                  <span
                    className={`size-6 rounded-full border-[3px] ${
                      humanColor === "w" ? "border-[#eef0dc] bg-[#f7f5e9]" : "border-line bg-surface-3"
                    }`}
                  />
                </span>
                <div>
                  <p className="text-sm font-semibold">Vous</p>
                  <p className="text-xs text-white/40">
                    Pions {humanColor === "w" ? "blancs" : "noirs"}{isHumanTurn ? " · à vous" : ""}
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
                  maxLevel={maxLevel}
                  unlocked={trialActive ? 5 : null}
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

      <DragGhost drag={drag}>{renderPieceGhost({ color: humanColor, king: drag?.piece === "♛" })}</DragGhost>
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
