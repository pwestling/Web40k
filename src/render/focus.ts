import { create } from "zustand";

/** A point on the table the camera should ease to (Table warnings, keyboard play). */
export const useFocus = create<{ x: number; y: number; at: number } | null>(() => null);

export function focusOn(x: number, y: number): void {
  useFocus.setState({ x, y, at: performance.now() }, true);
}
