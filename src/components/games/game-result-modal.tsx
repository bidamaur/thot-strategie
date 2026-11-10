"use client";

import { ArrowLeft, Bot, RotateCcw, Trophy } from "lucide-react";

interface GameResultModalProps {
  result: "win" | "loss" | "draw";
  gameName: string;
  onNewGame: () => void;
  onQuit?: () => void;
  description?: string;
  pointsMessage?: string;
  pointsBalance?: number | null;
  pointsOpponentName?: string;
  pointsOpponentChange?: number | null;
  pointsOpponentBalance?: number | null;
  actionError?: string;
}

const CONFETTI_COLORS = ["#6ee7b7", "#fcd34d", "#f9a8d4", "#93c5fd", "#f5f5f4"];
const DEFEAT_COLORS = ["#94a3b8", "#64748b", "#a1a1aa", "#cbd5e1", "#475569"];

export function GameResultModal({
  result,
  gameName,
  onNewGame,
  onQuit,
  description,
  pointsMessage,
  pointsBalance,
  pointsOpponentName,
  pointsOpponentChange,
  pointsOpponentBalance,
  actionError,
}: GameResultModalProps) {
  const won = result === "win";
  const drawn = result === "draw";
  const formatChange = (change: number | null | undefined) =>
    typeof change === "number" && Number.isFinite(change)
      ? `${change > 0 ? "+" : ""}${change} point${Math.abs(change) === 1 ? "" : "s"}`
      : "Non disponible";
  const formatBalance = (balance: number | null | undefined) =>
    typeof balance === "number" && Number.isFinite(balance)
      ? `${balance} points`
      : "Solde non disponible";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden bg-black/75 p-4 backdrop-blur-sm"
      role="presentation"
    >
      {!drawn &&
        Array.from({ length: 36 }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="game-confetti pointer-events-none absolute top-[-1rem] h-2.5 w-2 rounded-sm"
            style={{
              left: `${(index * 37) % 100}%`,
              backgroundColor: (won ? CONFETTI_COLORS : DEFEAT_COLORS)[
                index % CONFETTI_COLORS.length
              ],
              animationDelay: `${(index % 9) * 0.12}s`,
              animationDuration: `${2.8 + (index % 5) * 0.35}s`,
            }}
          />
        ))}
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-result-title"
        className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#101713] p-7 text-center shadow-2xl shadow-black/50"
      >
        <span
          className={`mx-auto flex size-16 items-center justify-center rounded-2xl ${
            won
              ? "bg-emerald-300/10 text-emerald-200"
              : drawn
                ? "bg-amber-200/10 text-amber-100"
                : "bg-white/[0.08] text-white/60"
          }`}
        >
          {won ? <Trophy size={30} /> : drawn ? <Bot size={30} /> : <Bot size={30} />}
        </span>
        <p className="mt-5 text-xs font-semibold tracking-[0.2em] text-white/40">
          {gameName.toUpperCase()} · PARTIE TERMINÉE
        </p>
        <h2 id="game-result-title" className="mt-2 text-3xl font-semibold">
          {won ? "Victoire !" : drawn ? "Match nul" : "Défaite"}
        </h2>
        <p className="mt-3 text-sm leading-6 text-white/55">
          {description ??
            (won
              ? "Belle partie. Vous avez battu la machine."
              : drawn
                ? "Aucun vainqueur cette fois. Rejouez pour prendre l’avantage."
                : "La machine prend cette partie. Vous pourrez prendre votre revanche.")}
        </p>

        {typeof pointsMessage === "string" && pointsMessage.trim() ? (
          <div className="mt-5 rounded-xl border border-emerald-300/25 bg-emerald-950/40 p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200/70">
              Points de la partie
            </p>
            <div className="mt-3 space-y-3">
              <div className="flex items-start justify-between gap-4 border-b border-emerald-100/10 pb-3">
                <div>
                  <p className="font-semibold text-emerald-50">Vous</p>
                  <p className="text-sm text-emerald-100/70">
                    {formatBalance(pointsBalance)}
                  </p>
                </div>
                <p className="text-xl font-bold text-emerald-100">
                  {pointsMessage ?? formatChange(null)}
                </p>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-emerald-50">
                    {pointsOpponentName ?? "Adversaire"}
                  </p>
                  <p className="text-sm text-emerald-100/70">
                    {formatBalance(pointsOpponentBalance)}
                  </p>
                </div>
                <p className="shrink-0 text-xl font-bold text-emerald-100">
                  {formatChange(pointsOpponentChange)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-white/50">
            Partie locale d’entraînement : aucun point n’est crédité. Les points
            sont attribués uniquement aux matchs validés côté serveur.
          </p>
        )}
        {actionError && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-rose-300/20 bg-rose-950/50 p-3 text-left text-sm text-rose-200"
          >
            {actionError}
          </p>
        )}
        <div className={`mt-6 grid gap-3 ${onQuit ? "sm:grid-cols-2" : ""}`}>
          <button
            type="button"
            onClick={onNewGame}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-[#08100c] transition hover:bg-emerald-200"
          >
            <RotateCcw size={16} />
            Nouvelle partie
          </button>
          {onQuit && (
            <button
              type="button"
              onClick={onQuit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <ArrowLeft size={16} />
              Quitter le jeu
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
