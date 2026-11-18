"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { BoardDrag } from "./use-board-pointer-drag";

/**
 * Pièce tenue pendant un glisser : exactement la taille de sa case, centrée
 * sous le doigt (ou le curseur). Rendue à la racine du document pour qu'aucun
 * conteneur (transformation, flou, défilement) ne puisse la décaler.
 */
export function DragGhost({ drag, children }: { drag: BoardDrag | null; children: ReactNode }) {
  if (!drag || typeof document === "undefined") return null;
  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[90] flex items-center justify-center drop-shadow-[0_6px_6px_rgb(0_0_0/0.45)]"
      style={{
        left: drag.x,
        top: drag.y,
        width: drag.size,
        height: drag.size,
        transform: "translate(-50%, -50%) scale(1.04)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
