"use client";

import { DIFFICULTIES, type Difficulty } from "@/lib/engine/game-settings";

interface DifficultySelectorProps {
  value: Difficulty;
  onChange: (difficulty: Difficulty) => void;
  disabled?: boolean;
}

export function DifficultySelector({
  value,
  onChange,
  disabled = false,
}: DifficultySelectorProps) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs font-semibold tracking-[0.18em] text-white/40">
        DIFFICULTÉ DE L&apos;IA
      </legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DIFFICULTIES.map((difficulty) => {
          const selected = difficulty.value === value;
          return (
            <button
              key={difficulty.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(difficulty.value)}
              className={`rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? "border-emerald-200/50 bg-emerald-200/10 text-emerald-100"
                  : "border-white/10 bg-white/[0.025] text-white/70 hover:border-white/25"
              }`}
            >
              <span className="block text-sm font-semibold">
                {difficulty.label}
              </span>
              <span className="mt-1 block text-[11px] text-white/40">
                {difficulty.description}
              </span>
            </button>
          );
        })}
      </div>
      {disabled && (
        <p className="mt-2 text-[11px] text-white/35">
          Difficulté verrouillée pendant la partie.
        </p>
      )}
    </fieldset>
  );
}
