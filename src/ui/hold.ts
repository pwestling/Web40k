import { create } from "zustand";
import { rollsIn } from "../core";
import { useStore } from "../store";

/**
 * While the dice tray stages a roll, the rest of the screen (panels, log,
 * labels, casualties) keeps showing the table as it was before that event,
 * so the answer arrives when the dice land (UX 100). `held` is the first
 * event being staged; null shows everything. The tray lets go when its
 * queue is empty (and never holds for more than 30 s).
 */
export const useHold = create<{ held: number | null }>(() => ({ held: null }));

// Set in the same update as the new event, before anything renders it, so the result never flashes up early.
useStore.subscribe((s, prev) => {
  if (s.record === prev.record || s.scrub !== null || prev.scrub !== null) return;
  if (typeof document === "undefined" || document.hidden || useHold.getState().held !== null) return;
  if (s.record.initial !== prev.record.initial) return;
  const from = prev.record.events.at(-1)?.seq ?? prev.record.initial.seq;
  const fresh = s.record.events.filter((e) => e.seq > from);
  if (!fresh.length || fresh.length > 8) return;
  const last = fresh.at(-1)!.seq;
  if (
    rollsIn(
      prev.game,
      s.game,
      fresh.map((e) => e.event),
      last,
    ).length
  )
    useHold.setState({ held: fresh[0]!.seq });
});
