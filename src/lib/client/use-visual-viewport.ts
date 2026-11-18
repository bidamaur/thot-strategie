"use client";

import { useEffect, useState } from "react";

/**
 * Zone réellement visible de l'écran (le clavier mobile la réduit).
 * Permet de garder une fenêtre de saisie entièrement au-dessus du clavier,
 * y compris sur iPhone où la page n'est pas redimensionnée.
 */
export function useVisualViewport(active: boolean) {
  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const visual = window.visualViewport;
    if (!active || !visual) return;
    const update = () => setViewport({ height: visual.height, top: visual.offsetTop });
    const frame = window.requestAnimationFrame(update);
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => {
      window.cancelAnimationFrame(frame);
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
    };
  }, [active]);
  return active ? viewport : null;
}
