"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useBoardPrefs } from "@/lib/client/board-prefs-store";

export interface BoardDrag {
  from: string;
  piece: string;
  x: number;
  y: number;
  pointerId: number;
  /** Taille réelle de la case de départ (px) : la pièce glissée garde exactement sa taille. */
  size: number;
}

/** Déplacement minimal (px) avant qu'un appui devienne un glisser : un simple toucher reste un toucher. */
const DRAG_THRESHOLD_PX = 6;

/**
 * Glisser-déposer des pièces, selon la préférence du joueur :
 * - « both » : glisser ou toucher la pièce puis la case ;
 * - « tap » : toucher seulement (aucun glisser) ;
 * - « drag » : glisser seulement (le toucher de la case d'arrivée est ignoré).
 */
export function useBoardPointerDrag(
  onDrop: (from: string, to: string) => void,
) {
  const { input } = useBoardPrefs();
  const [drag, setDrag] = useState<BoardDrag | null>(null);
  const dragRef = useRef<BoardDrag | null>(null);
  const pendingRef = useRef<(BoardDrag & { startX: number; startY: number }) | null>(null);
  const onDropRef = useRef(onDrop);
  const ignoreNextClickRef = useRef(false);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      const pending = pendingRef.current;
      if (pending && pending.pointerId === event.pointerId && !dragRef.current) {
        const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if (distance < DRAG_THRESHOLD_PX) return;
        const started = { from: pending.from, piece: pending.piece, pointerId: pending.pointerId, size: pending.size, x: event.clientX, y: event.clientY };
        pendingRef.current = null;
        dragRef.current = started;
        setDrag(started);
        return;
      }
      const currentDrag = dragRef.current;
      if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

      const updatedDrag = { ...currentDrag, x: event.clientX, y: event.clientY };
      dragRef.current = updatedDrag;
      setDrag(updatedDrag);
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      if (pendingRef.current?.pointerId === event.pointerId) pendingRef.current = null;
      const currentDrag = dragRef.current;
      if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-square]")?.dataset.square;

      dragRef.current = null;
      setDrag(null);
      ignoreNextClickRef.current = true;
      window.setTimeout(() => {
        ignoreNextClickRef.current = false;
      }, 0);

      if (target) onDropRef.current(currentDrag.from, target);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  function beginDrag(
    event: PointerEvent<HTMLElement>,
    from: string,
    piece: string,
  ) {
    if (input === "tap") return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    pendingRef.current = {
      size: Math.min(rect.width, rect.height),
      from,
      piece,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
  }

  /** Vrai si le clic doit être ignoré (fin d'un glisser, ou mode « glisser seulement »). */
  function consumeClick(): boolean {
    if (input === "drag") return true;
    if (!ignoreNextClickRef.current) return false;
    ignoreNextClickRef.current = false;
    return true;
  }

  return { drag, beginDrag, consumeClick };
}
