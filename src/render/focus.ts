import { create } from "zustand";

/** A point on the table the camera should ease to (Table warnings, keyboard play). */
export const useFocus = create<{ x: number; y: number; at: number } | null>(() => null);

export function focusOn(x: number, y: number): void {
  useFocus.setState({ x, y, at: performance.now() }, true);
}

/** Which way the camera looks across the table (x, y), kept up to date by FocusCamera: arrow-key moves go "up the screen". */
export const cameraForward = { x: 0, y: -1 };
