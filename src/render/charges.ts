import { create } from "zustand";
import { undoneSeqs } from "../core";
import { useGame } from "../ui/hooks";
import { useStore } from "../store";

/**
 * Charges that struck home, as seen by this peer (PX-3c): the unit card keeps
 * "Charged 7.2"" for the rest of the round once the stamp has faded. Filled by
 * WatchEffects from the logged move, so every peer and a playing replay see it.
 */
interface Mark {
  seq: number;
  round: number;
  distance: number;
}

const useCharges = create<{ marks: Record<string, Mark> }>(() => ({ marks: {} }));

export function markCharge(unitId: string, mark: Mark): void {
  useCharges.setState((s) => ({ marks: { ...s.marks, [unitId]: mark } }));
}

/** How far the unit charged this round, or null (not charged, undone, or scrubbed back before it). */
export function useCharged(unitId: string): number | null {
  const mark = useCharges((s) => s.marks[unitId]);
  const game = useGame();
  const record = useStore((s) => s.record);
  if (!mark || mark.round !== game.turn.round || mark.seq > game.seq) return null;
  return undoneSeqs(record).has(mark.seq) ? null : mark.distance;
}
