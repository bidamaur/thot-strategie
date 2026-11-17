"use client";

import { assignVariant } from "@/lib/engagement/definitions";

/**
 * Mesure d'audience côté navigateur : identifiant aléatoire local (aucune
 * donnée personnelle), envoi groupé, respect de « Ne pas suivre ».
 * Toutes les lectures/écritures de stockage sont protégées : navigation
 * privée ou stockage bloqué ne cassent jamais l'interface.
 */

const ANON_KEY = "thot.anon";
let enabled = true;
let queue: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let experiments: { id: string; variants: string[] }[] = [];

export function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // stockage indisponible : la fonctionnalité continue sans mémoire locale
  }
}

export function anonId(): string {
  let id = storageGet(ANON_KEY);
  if (!id) {
    id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    storageSet(ANON_KEY, id);
  }
  return id;
}

export function deviceClass(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const w = Math.min(window.screen?.width ?? window.innerWidth, window.innerWidth);
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse && w < 640) return "mobile";
  if (coarse && w < 1100) return "tablet";
  return w < 640 ? "mobile" : "desktop";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function configureTelemetry(options: { enabled: boolean; experiments: { id: string; variants: string[] }[] }) {
  const dnt = typeof navigator !== "undefined" && (navigator.doNotTrack === "1" || (window as Window & { doNotTrack?: string }).doNotTrack === "1");
  enabled = options.enabled && !dnt;
  experiments = options.experiments;
}

/** Variante d'une expérience A/B active, stable pour ce navigateur ; null si inactive. */
export function variantOf(experimentId: string): string | null {
  const exp = experiments.find((e) => e.id === experimentId);
  return exp ? assignVariant(anonId(), exp.id, exp.variants) : null;
}

function flush(useBeacon = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue });
  queue = [];
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // jamais bloquant
  }
}

export function track(name: string, props?: Record<string, string | number | boolean>, experiment?: { id: string; variant: string | null }) {
  if (!enabled || typeof window === "undefined") return;
  queue.push({
    name,
    anonId: anonId(),
    device: deviceClass(),
    standalone: isStandalone(),
    ...(experiment?.variant ? { experiment: experiment.id, variant: experiment.variant } : {}),
    ...(props ? { props } : {}),
  });
  if (queue.length >= 10) flush();
  else if (!timer) timer = setTimeout(() => flush(), 4000);
}

let sessionStart = 0;
let visibleMs = 0;

/** Ouverture quotidienne + durée de visite visible (envoyée à la fermeture). */
export function startSessionTracking() {
  const today = new Date().toISOString().slice(0, 10);
  if (storageGet("thot.lastOpen") !== today) {
    storageSet("thot.lastOpen", today);
    track("app_open");
  }
  sessionStart = document.visibilityState === "visible" ? Date.now() : 0;
  const onHide = () => {
    if (sessionStart) visibleMs += Date.now() - sessionStart;
    sessionStart = 0;
    if (visibleMs >= 5000) {
      track("session_time", { seconds: Math.min(Math.round(visibleMs / 1000), 4 * 3600) });
      visibleMs = 0;
    }
    flush(true);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") onHide();
    else sessionStart = Date.now();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onHide);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", onHide);
  };
}

export function visitCount(): number {
  return Number(storageGet("thot.visits") ?? "0") || 0;
}

/** Compte une visite par jour au plus (sert au moment de la proposition d'installation). */
export function registerVisit() {
  const today = new Date().toISOString().slice(0, 10);
  if (storageGet("thot.visitDay") === today) return visitCount();
  storageSet("thot.visitDay", today);
  const n = visitCount() + 1;
  storageSet("thot.visits", String(n));
  return n;
}
