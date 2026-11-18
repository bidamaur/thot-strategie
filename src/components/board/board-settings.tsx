"use client";

import { Check, Crown } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  ANIMATION_SPEEDS,
  animationMs,
  BOARD_THEMES,
  INPUT_MODES,
  PIECE_ANIMATIONS,
  type BoardPrefs,
} from "@/lib/board-prefs";
import { updateBoardPrefs, useBoardPrefs } from "@/lib/client/board-prefs-store";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors ${
        active ? "border-accent/60 bg-accent/10 text-ink" : "border-line bg-surface-2 text-ink-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
      {label}
      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Aperçu 4×4 : thème, coordonnées, coup possible, dernier coup et animation rejouée. */
function Preview({ prefs }: { prefs: BoardPrefs }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (prefs.animation === "none") return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1600);
    return () => window.clearInterval(timer);
  }, [prefs.animation]);
  const ms = prefs.animation === "lift" ? Math.round(animationMs(prefs) * 1.6) : animationMs(prefs);
  // Le pion blanc va alternativement de (3,0) à (2,1) puis revient.
  const forward = tick % 2 === 0;
  const pawnAt = forward ? "2,1" : "3,0";
  const from = forward ? { r: 3, c: 0 } : { r: 2, c: 1 };
  const to = forward ? { r: 2, c: 1 } : { r: 3, c: 0 };
  return (
    <div className="mx-auto w-full max-w-[220px]">
      <div className="grid aspect-square grid-cols-4 overflow-hidden rounded-md border-[4px] border-board-frame shadow-lg">
        {Array.from({ length: 16 }, (_, i) => {
          const r = Math.floor(i / 4);
          const c = i % 4;
          const dark = (r + c) % 2 === 1;
          const key = `${r},${c}`;
          const black = key === "0,1" || key === "0,3" || key === "1,2";
          const white = key === pawnAt || key === "3,2";
          const last = prefs.lastMove && (key === `${from.r},${from.c}` || key === `${to.r},${to.c}`);
          const hint = prefs.legalMoves && key === "2,3";
          return (
            <div key={key} className={`relative flex items-center justify-center ${dark ? "bg-board-dark" : "bg-board-light"}`}>
              {last && <span className="absolute inset-0 bg-[rgb(155_199_0/0.38)]" />}
              {hint && <span className="absolute size-[30%] rounded-full bg-accent-strong/70" />}
              {dark && c === 0 && <span className="board-coord absolute left-0.5 top-0 text-[9px] font-semibold text-board-light">{r * 2 + 1}</span>}
              {(black || white) && (
                <span
                  key={key === pawnAt ? `p${tick}` : key}
                  className={`absolute inset-0 flex items-center justify-center ${key === pawnAt && prefs.animation !== "none" && tick > 0 ? `piece-anim piece-anim-${prefs.animation}` : ""}`}
                  style={
                    key === pawnAt
                      ? ({ "--dx": from.c - to.c, "--dy": from.r - to.r, "--anim-ms": `${ms}ms` } as CSSProperties)
                      : undefined
                  }
                >
                  <span
                    className={`flex size-[76%] items-center justify-center rounded-full border-2 shadow-[inset_0_-3px_0_rgb(0_0_0/0.18),0_2px_4px_rgb(0_0_0/0.35)] ${
                      white ? "border-[#cfc9b6] bg-[#f1ece0] text-zinc-700" : "border-[#14100d] bg-[#2b241f] text-amber-200"
                    }`}
                  >
                    {key === "1,2" && <Crown className="size-1/2" />}
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Réglages du plateau : enregistrés sur le compte (et sur l'appareil). */
export function BoardSettings() {
  const prefs = useBoardPrefs();
  const set = (patch: Partial<BoardPrefs>) => void updateBoardPrefs(patch);

  return (
    <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
      <div className="md:sticky md:top-20">
        <Preview prefs={prefs} />
        <p className="mt-2 text-center text-xs text-ink-muted">Aperçu en direct · enregistré automatiquement</p>
      </div>

      <div className="flex flex-col gap-6">
        <Section title="Thème du plateau">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {BOARD_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                aria-pressed={prefs.theme === theme.id}
                onClick={() => set({ theme: theme.id })}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-xs transition-colors ${
                  prefs.theme === theme.id ? "border-accent/60 bg-accent/10 text-ink" : "border-line bg-surface-2 text-ink-soft"
                }`}
              >
                <span className="relative grid size-11 grid-cols-2 overflow-hidden rounded-md border-2" style={{ borderColor: theme.frame }}>
                  {[theme.light, theme.dark, theme.dark, theme.light].map((color, i) => (
                    <span key={i} style={{ background: color }} />
                  ))}
                  {prefs.theme === theme.id && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                      <Check className="size-4 text-white" />
                    </span>
                  )}
                </span>
                {theme.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Animation des pièces" hint={PIECE_ANIMATIONS.find((a) => a.id === prefs.animation)?.description}>
          <div className="flex gap-2">
            {PIECE_ANIMATIONS.map((a) => (
              <Choice key={a.id} active={prefs.animation === a.id} onClick={() => set({ animation: a.id })}>
                {a.label}
              </Choice>
            ))}
          </div>
          {prefs.animation !== "none" && (
            <div className="flex gap-2">
              {ANIMATION_SPEEDS.map((s) => (
                <Choice key={s.id} active={prefs.speed === s.id} onClick={() => set({ speed: s.id })}>
                  {s.label}
                </Choice>
              ))}
            </div>
          )}
        </Section>

        <Section title="Manière de jouer" hint={INPUT_MODES.find((m) => m.id === prefs.input)?.description}>
          <div className="flex flex-col gap-2 sm:flex-row">
            {INPUT_MODES.map((m) => (
              <Choice key={m.id} active={prefs.input === m.id} onClick={() => set({ input: m.id })}>
                {m.label}
              </Choice>
            ))}
          </div>
        </Section>

        <Section title="Aides visuelles">
          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle label="Coordonnées" checked={prefs.coordinates} onChange={(v) => set({ coordinates: v })} />
            <Toggle label="Coups possibles" checked={prefs.legalMoves} onChange={(v) => set({ legalMoves: v })} />
            <Toggle label="Dernier coup" checked={prefs.lastMove} onChange={(v) => set({ lastMove: v })} />
          </div>
        </Section>
      </div>
    </div>
  );
}
