import { create } from "zustand";
import type { Moment } from "../core/moments";

interface ReelState {
  /** The card on show in the end-of-game reel, or null. */
  index: number | null;
  /** The reel has run (or been skipped) for this game. */
  done: boolean;
  /** A moment card up on its own: in a replay, or brought up by a commentator. */
  replay: Moment | null;
}

/** Moments of the game on show (src/broadcast/Moments.tsx); the director cuts faster while the reel runs. */
export const useReel = create<ReelState>(() => ({ index: null, done: false, replay: null }));
