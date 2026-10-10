import { create } from "zustand";

/**
 * Touch play (#60): what the board's gestures need to share with the screen around it. A long press opens
 * `menu`; Select several turns one-finger drags on the table into a box that picks units (`picked`, moved
 * together); One model makes a drag move just the model touched (Shift with a mouse).
 */
export const useTouch = create<{
  boxMode: boolean;
  oneModel: boolean;
  /** The box being drawn, in client pixels. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Units picked by the box: dragging one of them moves them all. */
  picked: string[];
  /** The context menu of a long press: where it was (client pixels and on the table), on which unit. */
  /** `mouse`: opened by a right-click rather than a finger, so its hints are a mouse's. */
  menu: { x: number; y: number; at: { x: number; y: number }; unitId?: string; mouse?: boolean } | null;
  /** A two-finger twist on a unit: the turn so far (radians, screen clockwise), shown by the fingers. */
  twist: { unitId: string; angle: number; x: number; y: number } | null;
}>(() => ({
  boxMode: false,
  oneModel: false,
  box: null,
  picked: [],
  menu: null,
  twist: null,
}));

/** How long a finger stays still before it counts as a long press (ms). */
export const HOLD_MS = 450;
/** How far a finger can wander (px) and still be pressing, not dragging. */
export const SLOP_PX = 10;
/** How far a finger may drift and still be holding: past this, a long press is a drag on its way. */
export const STILL_PX = 5;
