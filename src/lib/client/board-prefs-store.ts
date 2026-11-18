"use client";

import { useSyncExternalStore } from "react";
import { BOARD_PREFS_STORAGE_KEY, DEFAULT_BOARD_PREFS, sanitizeBoardPrefs, type BoardPrefs } from "@/lib/board-prefs";

/**
 * Préférences de plateau côté navigateur : lues immédiatement sur l'appareil
 * (aucun clignotement), puis synchronisées avec le compte du joueur connecté.
 */

const STORAGE_KEY = BOARD_PREFS_STORAGE_KEY;
let current: BoardPrefs = DEFAULT_BOARD_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function applyToDocument(prefs: BoardPrefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.boardTheme = prefs.theme;
  root.dataset.boardCoords = prefs.coordinates ? "on" : "off";
}

function readLocal(): BoardPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeBoardPrefs(JSON.parse(raw)) : DEFAULT_BOARD_PREFS;
  } catch {
    return DEFAULT_BOARD_PREFS;
  }
}

function writeLocal(prefs: BoardPrefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // stockage indisponible (navigation privée) : préférences pour cette visite seulement
  }
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  current = readLocal();
  applyToDocument(current);
}

function set(prefs: BoardPrefs) {
  current = prefs;
  writeLocal(prefs);
  applyToDocument(prefs);
  for (const listener of listeners) listener();
}

export function getBoardPrefs(): BoardPrefs {
  ensureLoaded();
  return current;
}

export function useBoardPrefs(): BoardPrefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getBoardPrefs,
    () => DEFAULT_BOARD_PREFS,
  );
}

/** Modifie une ou plusieurs préférences et les enregistre sur le compte (si connecté). */
export async function updateBoardPrefs(patch: Partial<BoardPrefs>): Promise<void> {
  const next = sanitizeBoardPrefs({ ...getBoardPrefs(), ...patch });
  set(next);
  try {
    await fetch("/api/player/board-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs: next }),
    });
  } catch {
    // hors ligne : la préférence reste enregistrée sur l'appareil
  }
}

/** Récupère les préférences du compte (elles priment sur celles de l'appareil). */
export async function syncBoardPrefs(): Promise<void> {
  ensureLoaded();
  try {
    const response = await fetch("/api/player/board-prefs", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { prefs?: unknown };
    set(sanitizeBoardPrefs(data.prefs));
  } catch {
    // on garde les préférences de l'appareil
  }
}
