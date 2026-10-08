import { create } from "zustand";

type V3 = [number, number, number];

/** One camera move in the army showcase (PX-5a): from one pose to another over `dur` ms. */
export interface Shot {
  from: V3;
  to: V3;
  lookFrom: V3;
  lookTo: V3;
  start: number;
  dur: number;
}

/** The army showcase at battle start: running, and the camera move under way (none: a still view). */
export const useShowcase = create<{ on: boolean; shot: Shot | null }>(() => ({ on: false, shot: null }));

/** The showcase has the camera: the director and a followed commentator stand aside. */
export const showcasing = (): boolean => useShowcase.getState().on;
