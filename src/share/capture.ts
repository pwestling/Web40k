import { addAfterEffect } from "@react-three/fiber";

/**
 * The table's canvas, for sharing (#46): a picture of it for the cards, and
 * every frame for a clip. The WebGL canvas keeps no copy of a frame once it's
 * shown, so it is read right after R3F renders (an after effect), in the same
 * task.
 */

let table: HTMLCanvasElement | null = null;

/** Called by the board when its canvas is made (render/Board.tsx). */
export function setTableCanvas(canvas: HTMLCanvasElement | null): void {
  table = canvas;
}

export function tableCanvas(): HTMLCanvasElement | null {
  return table;
}

/** Run `draw` with the table's canvas after each render, until the returned function is called. */
export function everyFrame(draw: (canvas: HTMLCanvasElement) => void): () => void {
  return addAfterEffect(() => {
    if (table) draw(table);
  });
}

/** The table as it is drawn next, copied into a plain canvas (null with no table on screen). */
export function grabTable(): Promise<HTMLCanvasElement | null> {
  if (!table) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const stop = everyFrame((src) => {
      if (done) return;
      done = true;
      const copy = document.createElement("canvas");
      copy.width = src.width;
      copy.height = src.height;
      copy.getContext("2d")?.drawImage(src, 0, 0);
      queueMicrotask(stop);
      resolve(copy);
    });
    // A table that isn't rendering (a hidden tab) gives no frame.
    setTimeout(() => {
      if (done) return;
      done = true;
      stop();
      resolve(null);
    }, 1500);
  });
}

/** Two frames from now: long enough for a scrub to reach the table. */
export const settle = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
