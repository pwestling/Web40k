import type { PointerEvent } from "react";

/**
 * A finger flicking a side panel toward its edge (right) or down puts it away (PX touch pass: on a tablet the
 * unit card and the coach left the table under half the screen). Touch only; a scroll inside the panel, mostly
 * vertical from anywhere but its top, stays a scroll.
 */
// Kept outside the panel's render, which can run again between finger down and up.
let from: { x: number; y: number; top: boolean } | null = null;

export function swipeAway(away: () => void) {
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "touch") return;
      const r = e.currentTarget.getBoundingClientRect();
      from = { x: e.clientX, y: e.clientY, top: e.clientY - r.top < 56 };
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const f = from;
      from = null;
      if (!f || e.pointerType !== "touch") return;
      const dx = e.clientX - f.x;
      const dy = e.clientY - f.y;
      if ((dx > 70 && Math.abs(dy) < dx / 2) || (f.top && dy > 70 && Math.abs(dx) < dy / 2)) {
        // A flick that began on a button isn't a press of it.
        const swallow = (c: MouseEvent) => {
          c.preventDefault();
          c.stopPropagation();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
        away();
      }
    },
  };
}
