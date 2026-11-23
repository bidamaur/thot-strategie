"use client";

import { Crown, Lock } from "lucide-react";
import { openPremiumGate } from "@/lib/client/premium-gate";
import { DIFFICULTIES, type Difficulty } from "@/lib/engine/game-settings";

interface DifficultySelectorProps {
  value: Difficulty;
  onChange: (difficulty: Difficulty) => void;
  disabled?: boolean;
  /** Niveau maximal accessible (offre gratuite : 3). */
  maxLevel?: Difficulty;
  /** Niveau débloqué exceptionnellement (essai offert du niveau 5). */
  unlocked?: Difficulty | null;
}

/** Choix du niveau de l'IA ; les niveaux réservés au Premium ouvrent la fenêtre Premium. */
export function DifficultySelector({ value, onChange, disabled = false, maxLevel = 5, unlocked = null }: DifficultySelectorProps) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs font-semibold tracking-[0.18em] text-white/40">
        NIVEAU DE L&apos;IA
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {DIFFICULTIES.map((difficulty) => {
          const selected = difficulty.value === value;
          const locked = difficulty.value > maxLevel && difficulty.value !== unlocked;
          return (
            <button
              key={difficulty.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              aria-label={locked ? `${difficulty.label} : réservé au Premium` : undefined}
              onClick={() => (locked ? openPremiumGate("AI_LEVELS", undefined) : onChange(difficulty.value))}
              className={`rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "border-emerald-200/50 bg-emerald-200/10 text-emerald-100"
                  : locked
                    ? "border-gold/20 bg-gold/[0.03] text-white/50 hover:border-gold/40"
                    : "border-white/10 bg-white/[0.025] text-white/70 hover:border-white/25"
              }`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {difficulty.label}
                {locked && <Lock className="ml-auto size-3.5 text-gold" aria-hidden />}
                {!locked && difficulty.value > maxLevel && <Crown className="ml-auto size-3.5 text-gold" aria-hidden />}
              </span>
              <span className="mt-1 block text-[11px] text-white/40">
                {locked ? "Premium" : difficulty.description}
              </span>
            </button>
          );
        })}
      </div>
      {disabled && (
        <p className="mt-2 text-[11px] text-white/35">
          Niveau verrouillé pendant la partie.
        </p>
      )}
    </fieldset>
  );
}
