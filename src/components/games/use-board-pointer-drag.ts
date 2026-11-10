"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";

export interface BoardDrag {
  from: string;
  piece: string;
  x: number;
  y: number;
  pointerId: number;
}

export function useBoardPointerDrag(
  onDrop: (from: string, to: string) => void,
) {
  const [drag, setDrag] = useState<BoardDrag | null>(null);
  const dragRef = useRef<BoardDrag | null>(null);
  const onDropRef = useRef(onDrop);
  const ignoreNextClickRef = useRef(false);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    function handlePointerMove(event: globalThis.PointerEvent) {
      const currentDrag = dragRef.current;
      if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

      const updatedDrag = { ...currentDrag, x: event.clientX, y: event.clientY };
      dragRef.current = updatedDrag;
      setDrag(updatedDrag);
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
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
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    const newDrag = {
      from,
      piece,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    dragRef.current = newDrag;
    setDrag(newDrag);
  }

  function consumeClick(): boolean {
    if (!ignoreNextClickRef.current) return false;
    ignoreNextClickRef.current = false;
    return true;
  }

  return { drag, beginDrag, consumeClick };
}
