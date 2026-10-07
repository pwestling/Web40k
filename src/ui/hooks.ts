import { useMemo } from "react";
import { rareMoments, stateAt, type GameState, type RareOutcome } from "../core";
import { useStore } from "../store";

/** The table to show: live, or as it stood at the replay scrubber's position. */
export function useGame(): GameState {
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  return useMemo(() => (scrub === null ? game : stateAt(record, scrub)), [game, record, scrub]);
}

/** This browser's seat, or the active seat in hotseat; spectators see seat 0's side. */
export function useSelfSeat(): number {
  const selfId = useStore((s) => s.session?.selfId);
  const mode = useStore((s) => s.mode);
  const game = useStore((s) => s.game);
  if (mode === "hotseat") return 0;
  return (selfId ? game.players[selfId]?.seat : undefined) ?? 0;
}

/** A unit's rare moments so far (Against all odds), for the star on its card. */
export function useRareStars(unitId: string | null | undefined): RareOutcome[] {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const all = useMemo(() => rareMoments(record), [record]);
  return all.filter((m) => m.unitId === unitId && m.seq <= (scrub ?? Infinity));
}
