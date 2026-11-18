"use client";

import { useEffect, useState } from "react";

/** Distance (px) au bord de l'écran sous laquelle un geste peut être pris pour « retour / avance ». */
const SCREEN_EDGE_PX = 32;
const TAP_SLOP_PX = 10;

/**
 * Protection du DAMIER UNIQUEMENT contre les gestes de navigation du navigateur.
 *
 * - CSS du conteneur (classe `board-touch-zone`) : `touch-action: none` et
 *   `overscroll-behavior: contain` — aucun défilement, zoom ni balayage d'historique
 *   du navigateur ne naît d'un toucher sur le damier (Chrome, Samsung Internet).
 * - Toucher commencé sur le damier près du bord de l'écran : `preventDefault()` sur
 *   `touchstart`, pour que Safari (iPhone) ne le prenne pas pour son geste « retour ».
 *   Les événements « pointer » (glisser des pièces) ne sont pas concernés ; seul le
 *   clic d'un simple toucher serait perdu : il est rejoué une fois, sur la case
 *   touchée (aucun double déclenchement, le navigateur n'en produit pas).
 *
 * Limite : les gestes du SYSTÈME (navigation par gestes d'Android, bord de l'écran
 * réservé par iOS) passent avant la page ; aucun code web ne peut les supprimer.
 */
export function useBoardTouchGuard() {
  // Référence de rappel : le damier peut apparaître après le premier rendu.
  const [zone, setZone] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!zone) return;
    let start: { x: number; y: number; target: EventTarget | null } | null = null;

    const onStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      if (touch.clientX > SCREEN_EDGE_PX && touch.clientX < window.innerWidth - SCREEN_EDGE_PX) return;
      event.preventDefault();
      start = { x: touch.clientX, y: touch.clientY, target: event.target };
    };

    const onEnd = (event: TouchEvent) => {
      const began = start;
      start = null;
      const touch = event.changedTouches[0];
      if (!began || !touch || Math.hypot(touch.clientX - began.x, touch.clientY - began.y) > TAP_SLOP_PX) return;
      const square = began.target instanceof Element ? began.target.closest<HTMLElement>("[data-square]") : null;
      square?.click();
    };

    zone.addEventListener("touchstart", onStart, { passive: false });
    zone.addEventListener("touchend", onEnd);
    return () => {
      zone.removeEventListener("touchstart", onStart);
      zone.removeEventListener("touchend", onEnd);
    };
  }, [zone]);
  return setZone;
}
