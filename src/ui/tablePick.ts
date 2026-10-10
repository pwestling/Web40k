import { create } from "zustand";
import type { UnitId } from "../core";

/**
 * The table as seen from the page: what's under a screen point, for things
 * dragged from the page onto it (the stratagem hand, UX 499). The Board sets
 * these once its camera is up; until then nothing is on the table.
 */
export const tablePick: {
  unitAt(x: number, y: number): UnitId | null;
  onTable(x: number, y: number): boolean;
  /** Where a unit is on screen (client pixels), if it's in view. */
  screenOf(unitId: UnitId): { x: number; y: number } | null;
} = { unitAt: () => null, onTable: () => false, screenOf: () => null };

/** The units a card in hand could be played on: lit on the table under the pointer while it's held. */
export const useHandTargets = create<{ ids: UnitId[] | null }>(() => ({ ids: null }));
