import { create } from "zustand";

/** Text sizes a player can pick (#25), as a scale on the root font size (styles.css --text-scale). */
export const TEXT_SIZES = [
  { id: "normal", label: "Normal", scale: 1 },
  { id: "large", label: "Large", scale: 1.15 },
  { id: "larger", label: "Larger", scale: 1.3 },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]["id"];

const KEY = "open-battle:text-size";

function stored(): TextSize {
  try {
    const v = localStorage.getItem(KEY);
    return TEXT_SIZES.some((t) => t.id === v) ? (v as TextSize) : "normal";
  } catch {
    return "normal";
  }
}

function apply(size: TextSize) {
  const scale = TEXT_SIZES.find((t) => t.id === size)?.scale ?? 1;
  document.documentElement.style.setProperty("--text-scale", String(scale));
}

export const useTextSize = create<{ size: TextSize }>(() => ({ size: stored() }));

/** Apply the saved size at startup. */
export function applyTextSize(): void {
  if (typeof document !== "undefined") apply(useTextSize.getState().size);
}

export function setTextSize(size: TextSize): void {
  useTextSize.setState({ size });
  apply(size);
  try {
    localStorage.setItem(KEY, size);
  } catch {
    // Private windows: it lasts until the page closes.
  }
}
