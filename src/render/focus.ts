import { create } from "zustand";

/** A point on the table the camera should ease to (Table warnings, keyboard play). */
export const useFocus = create<{ x: number; y: number; at: number } | null>(() => null);

export function focusOn(x: number, y: number): void {
  useFocus.setState({ x, y, at: performance.now() }, true);
}

/** Which way the camera looks across the table (x, y), kept up to date by FocusCamera: arrow-key moves go "up the screen". */
export const cameraForward = { x: 0, y: -1 };

/**
 * A still for a picture (Share the battle cards): the camera jumps to look at
 * (x, y) from `span` away, keeping its angle, and `restore` puts it back.
 * FocusCamera applies both on its next frame.
 */
export const shot: {
  request: { x: number; y: number; span: number } | null;
  restore: boolean;
  /** A picture or clip is being taken: nothing right in front of the lens (UX 369). */
  capturing: number;
} = { request: null, restore: false, capturing: 0 };
