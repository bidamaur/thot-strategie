"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Calque d'animation des pièces, commun aux damiers (dames, échecs, en ligne,
 * contre l'ordinateur).
 *
 * Principe : le plateau affiche toujours l'état RÉEL du jeu (source de vérité).
 * Pour le dernier coup validé, ce calque superpose des « fantômes » identiques
 * aux vraies pièces : la pièce qui se déplace (case par case pour les prises
 * multiples) et les pièces prises, qui réagissent puis s'effacent au moment
 * exact où la pièce attaquante passe sur elles. Pendant ce temps, le plateau
 * masque la pièce d'arrivée ; à la fin, le calque disparaît et la vraie pièce
 * est déjà à sa place, au centre de sa case.
 *
 * Technique : Web Animations API (transform et opacity uniquement, calculées par
 * le compositeur, indépendantes de la fréquence d'affichage, annulables).
 * Aucune dépendance ajoutée.
 */

export interface Cell {
  /** Ligne et colonne À L'ÉCRAN (orientation du joueur déjà appliquée). */
  r: number;
  c: number;
}

export interface MotionMover {
  key: string;
  /** Trajet complet, départ compris : une étape par saut pour les prises multiples. */
  path: Cell[];
  node: ReactNode;
}

export interface MotionCapture {
  key: string;
  at: Cell;
  node: ReactNode;
  /** Étape du trajet pendant laquelle l'attaquant passe sur la pièce (0 = première). */
  step: number;
  /** Position sur cette étape (0 = début, 1 = fin). */
  fraction: number;
}

export interface MotionPlan {
  id: string;
  movers: MotionMover[];
  captures: MotionCapture[];
  /** Coup joué au glisser : la pièce est déjà posée, seules les prises s'animent. */
  instant?: boolean;
}

export type MotionStyle = "slide" | "lift";

const LIFT_MS = 80;
const SETTLE_MS = 80;
const CAPTURE_MS = 160;

/** La pièce traverse une case : instant (0..1 de l'étape) où elle passe sur `at`. */
export function fractionOnSegment(from: Cell, to: Cell, at: Cell): number | null {
  const dr = to.r - from.r;
  const dc = to.c - from.c;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (steps === 0) return null;
  const k = Math.abs(dr) >= Math.abs(dc) ? (at.r - from.r) / dr : (at.c - from.c) / dc;
  if (!(k > 0 && k < 1)) return null;
  // La case doit être sur la ligne parcourue.
  if (Math.round(from.r + dr * k) !== at.r || Math.round(from.c + dc * k) !== at.c) return null;
  return k;
}

/** Durées réelles d'un plan (utiles aux tests et à l'appelant). */
export function planTiming(plan: MotionPlan, stepMs: number) {
  const steps = plan.instant ? 0 : Math.max(0, ...plan.movers.map((m) => m.path.length - 1));
  const travel = steps * stepMs;
  const captureStarts = plan.captures.map((c, i) =>
    plan.instant ? i * (CAPTURE_MS * 0.6) : Math.max(0, (c.step + c.fraction) * stepMs - CAPTURE_MS * 0.35),
  );
  const end = Math.max(
    plan.instant ? 0 : travel + SETTLE_MS,
    ...captureStarts.map((t) => t + CAPTURE_MS),
  );
  return { travel, captureStarts, end };
}

const percent = (value: number) => `${value * 100}%`;

export function PieceMotionLayer({
  plan,
  size,
  stepMs,
  style,
  onDone,
}: {
  plan: MotionPlan;
  /** Nombre de cases par côté. */
  size: number;
  /** Durée d'une étape de déplacement (ms). */
  stepMs: number;
  style: MotionStyle;
  onDone: (id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);

  useLayoutEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const animations: Animation[] = [];
    const { travel, captureStarts } = planTiming(plan, stepMs);
    const lift = style === "lift" ? { y: -7, s: 1.06, shadow: 0.55 } : { y: -3, s: 1.025, shadow: 0.4 };

    if (!plan.instant) {
      for (const mover of plan.movers) {
        const ghost = root.querySelector<HTMLElement>(`[data-mover="${mover.key}"]`);
        const body = ghost?.querySelector<HTMLElement>("[data-body]");
        const shadow = ghost?.querySelector<HTMLElement>("[data-shadow]");
        if (!ghost || !body || !shadow || mover.path.length < 2) continue;
        const start = mover.path[0]!;
        const hops = mover.path.length - 1;
        const total = travel + SETTLE_MS;

        // Trajectoire : une image clé par case d'arrivée. Chaque saut décélère
        // à l'approche de sa case ; le dernier se pose en douceur.
        const frames: Keyframe[] = mover.path.map((cell, i) => ({
          offset: (i * stepMs) / total,
          transform: `translate(${percent(cell.c - start.c)}, ${percent(cell.r - start.r)})`,
          easing: i === hops - 1 ? "cubic-bezier(.4,0,.2,1)" : "cubic-bezier(.45,0,.3,1)",
        }));
        const last = mover.path[hops]!;
        frames.push({ offset: 1, transform: `translate(${percent(last.c - start.c)}, ${percent(last.r - start.r)})` });
        animations.push(ghost.animate(frames, { duration: total, fill: "both" }));

        // Soulèvement (80 ms), transport, pose avec une très légère stabilisation.
        const up = Math.min(LIFT_MS / total, 0.3);
        const land = travel / total;
        animations.push(
          body.animate(
            [
              { offset: 0, transform: "translateY(0) scale(1)" },
              { offset: up, transform: `translateY(${lift.y}%) scale(${lift.s})`, easing: "linear" },
              { offset: Math.max(up, land - up * 0.6), transform: `translateY(${lift.y}%) scale(${lift.s})`, easing: "cubic-bezier(.3,0,.2,1)" },
              { offset: land, transform: "translateY(0) scale(0.985)", easing: "ease-out" },
              { offset: 1, transform: "translateY(0) scale(1)" },
            ],
            { duration: total, fill: "both" },
          ),
        );
        // L'ombre reste au sol et s'élargit quand la pièce est soulevée.
        animations.push(
          shadow.animate(
            [
              { offset: 0, opacity: 0, transform: "scale(0.85)" },
              { offset: up, opacity: lift.shadow, transform: "scale(1)" },
              { offset: Math.max(up, land - up * 0.6), opacity: lift.shadow, transform: "scale(1)" },
              { offset: land, opacity: 0.15, transform: "scale(0.9)" },
              { offset: 1, opacity: 0, transform: "scale(0.85)" },
            ],
            { duration: total, fill: "both" },
          ),
        );
      }
    }

    // Prises : légère compression au passage de l'attaquant, puis effacement.
    plan.captures.forEach((capture, i) => {
      const ghost = root.querySelector<HTMLElement>(`[data-capture="${capture.key}"]`);
      if (!ghost) return;
      animations.push(
        ghost.animate(
          [
            { offset: 0, opacity: 1, transform: "scale(1)" },
            { offset: 0.35, opacity: 0.95, transform: "scale(1.04, 0.9)", easing: "ease-in" },
            { offset: 1, opacity: 0, transform: "scale(0.6)" },
          ],
          { duration: CAPTURE_MS, delay: captureStarts[i], fill: "both" },
        ),
      );
    });

    let cancelled = false;
    void Promise.all(animations.map((a) => a.finished))
      .then(() => {
        if (!cancelled) onDoneRef.current(plan.id);
      })
      .catch(() => {
        // animation annulée par un nouveau coup : le plan suivant prend le relais
      });
    if (animations.length === 0) onDoneRef.current(plan.id);

    return () => {
      cancelled = true;
      for (const animation of animations) animation.cancel();
    };
  }, [plan, size, stepMs, style]);

  const box = (cell: Cell) => ({
    left: percent(cell.c / size),
    top: percent(cell.r / size),
    width: percent(1 / size),
    height: percent(1 / size),
  });

  return (
    <div ref={rootRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[6]">
      {plan.captures.map((capture) => (
        <div key={capture.key} data-capture={capture.key} className="absolute flex items-center justify-center" style={box(capture.at)}>
          {capture.node}
        </div>
      ))}
      {!plan.instant &&
        plan.movers.map((mover) => (
          <div key={mover.key} data-mover={mover.key} className="absolute will-change-transform" style={box(mover.path[0]!)}>
            <span
              data-shadow
              className="absolute inset-[14%] top-[22%] rounded-full bg-black/60 opacity-0 blur-[3px]"
            />
            <div data-body className="absolute inset-0 flex items-center justify-center will-change-transform">
              {mover.node}
            </div>
          </div>
        ))}
    </div>
  );
}

/**
 * Réglages d'animation : durée d'une étape selon la préférence du joueur et le
 * réglage système « réduire les animations ».
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
