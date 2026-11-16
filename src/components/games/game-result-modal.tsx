"use client";

import { ArrowLeft, Bot, CircleX, RotateCcw, Trophy } from "lucide-react";

interface GameResultModalProps {
  result: "win" | "loss" | "draw";
  gameName: string;
  onNewGame: () => void;
  onQuit?: () => void;
  description?: string;
  pointsMessage?: string;
  pointsChange?: number | null;
  pointsBalance?: number | null;
  pointsOpponentName?: string;
  pointsOpponentChange?: number | null;
  pointsOpponentBalance?: number | null;
  eloChange?: number | null;
  eloBalance?: number | null;
  eloOpponentChange?: number | null;
  eloOpponentBalance?: number | null;
  actionError?: string;
  /** Afficher le bloc ELO (faux pour une partie amicale non classée). */
  showElo?: boolean;
  /** Variation en points argent (partie rémunérée uniquement). */
  moneyChange?: number | null;
  moneyCommission?: number | null;
  modeLabel?: string;
  newGameLabel?: string;
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
  pointsChange,
  pointsBalance,
  pointsOpponentName,
  pointsOpponentChange,
  pointsOpponentBalance,
  eloChange,
  eloBalance,
  eloOpponentChange,
  eloOpponentBalance,
  actionError,
  showElo = true,
  moneyChange,
  moneyCommission,
  modeLabel,
  newGameLabel = "Nouvelle partie",
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
  const formatElo = (rating: number | null | undefined) =>
    typeof rating === "number" && Number.isFinite(rating)
      ? `Elo ${rating}`
      : "Elo non disponible";
  const formatEloChange = (change: number | null | undefined) =>
    typeof change === "number" && Number.isFinite(change)
      ? `${change > 0 ? "+" : ""}${change} Elo`
      : "Variation non disponible";
  const changeColor = (change: number | null | undefined) =>
    typeof change === "number" && change > 0
      ? "text-emerald-200"
      : typeof change === "number" && change < 0
        ? "text-rose-300"
        : "text-amber-100";
  const playerResultLabel = (
    name: string,
    change: number | null | undefined,
  ) =>
    typeof change === "number" && change > 0
      ? `${name} · points gagnés`
      : typeof change === "number" && change < 0
        ? `${name} · points perdus`
        : name;
  const resultTone = won
    ? "border-emerald-300/25 bg-emerald-950/40"
    : drawn
      ? "border-amber-200/25 bg-amber-950/30"
      : "border-rose-300/25 bg-rose-950/35";
  const resultLabelTone = won
    ? "text-emerald-200/70"
    : drawn
      ? "text-amber-100/70"
      : "text-rose-200/70";

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
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-surface p-7 text-center shadow-2xl shadow-black/50"
      >
        <span
          className={`mx-auto flex size-16 items-center justify-center rounded-2xl ${
            won
              ? "bg-emerald-300/10 text-emerald-200"
              : drawn
                ? "bg-amber-200/10 text-amber-100"
                  : "bg-rose-300/10 text-rose-200"
          }`}
        >
          {won ? (
              <Trophy size={30} />
          ) : drawn ? (
              <Bot size={30} />
          ) : (
              <CircleX size={30} />
          )}
        </span>
        <p className="mt-5 text-xs font-semibold tracking-[0.2em] text-white/40">
          {gameName.toUpperCase()}{modeLabel ? ` · ${modeLabel.toUpperCase()}` : ""} · PARTIE TERMINÉE
        </p>
        <h2
          id="game-result-title"
          className={`mt-2 text-3xl font-semibold ${
            won ? "text-emerald-200" : drawn ? "text-amber-100" : "text-rose-200"
          }`}
        >
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
          <div className={`mt-5 rounded-xl border p-4 text-left ${resultTone}`}>
            <p className={`text-xs font-semibold uppercase tracking-wider ${resultLabelTone}`}>
              Points classiques
            </p>
            <div className="mt-3 space-y-3">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3">
                <div>
                  <p className="font-semibold text-white">
                    {playerResultLabel("Vous", pointsChange)}
                  </p>
                  <p className="text-sm text-emerald-100/70">
                    {formatBalance(pointsBalance)}
                  </p>
                </div>
                <p className={`text-xl font-bold ${changeColor(pointsChange)}`}>
                  {pointsMessage ?? formatChange(null)}
                </p>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">
                    {playerResultLabel(
                      pointsOpponentName ?? "Adversaire",
                      pointsOpponentChange,
                    )}
                  </p>
                  <p className="text-sm text-emerald-100/70">
                    {formatBalance(pointsOpponentBalance)}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-xl font-bold ${changeColor(pointsOpponentChange)}`}
                >
                  {formatChange(pointsOpponentChange)}
                </p>
              </div>
            </div>
            {typeof moneyChange === "number" && (
              <div className="mt-4 border-t border-white/10 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-money">
                  Points argent
                </p>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <p className="text-sm text-white/60">
                    {moneyChange > 0
                      ? "Gain net crédité sur votre solde disponible"
                      : moneyChange < 0
                        ? "Mise perdue"
                        : "Mise rendue"}
                    {moneyCommission ? ` · commission ${moneyCommission} FCFA` : ""}
                  </p>
                  <p className={`shrink-0 text-lg font-bold tabular-nums ${changeColor(moneyChange)}`}>
                    {moneyChange > 0 ? "+" : ""}
                    {new Intl.NumberFormat("fr-FR").format(moneyChange)} FCFA
                  </p>
                </div>
              </div>
            )}
            {showElo && (
            <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
              <p className={`text-xs font-semibold uppercase tracking-wider ${resultLabelTone}`}>
                Classement ELO
              </p>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-white">Vous</p>
                  <p className="text-sm text-emerald-100/70">
                    {formatElo(eloBalance)}
                  </p>
                </div>
                <p className={`text-lg font-bold ${changeColor(eloChange)}`}>
                  {formatEloChange(eloChange)}
                </p>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">
                    {pointsOpponentName ?? "Adversaire"}
                  </p>
                  <p className="text-sm text-emerald-100/70">
                    {formatElo(eloOpponentBalance)}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-lg font-bold ${changeColor(eloOpponentChange)}`}
                >
                  {formatEloChange(eloOpponentChange)}
                </p>
              </div>
            </div>
            )}
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-semibold text-accent-ink transition hover:bg-emerald-200"
          >
            <RotateCcw size={16} />
            {newGameLabel}
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
