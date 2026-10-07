import { useMemo } from "react";
import { rareMoments, stateAt, type GameState, type RareOutcome } from "../core";
import { useStore } from "../store";
import { useHold } from "./hold";

/** The table to show: live, or as it stood at the replay scrubber's position. */
export function useGame(): GameState {
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const held = useHold((s) => s.held);
  return useMemo(() => {
    if (scrub !== null) return stateAt(record, scrub);
    // The dice tray is still rolling: show the table from before the roll.
    return held !== null ? stateAt(record, held - 1) : game;
  }, [game, record, scrub, held]);
}

/** The table without the dice tray's hold: what the log says now (or at the scrubber). */
export function useLiveGame(): GameState {
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  return useMemo(() => (scrub === null ? game : stateAt(record, scrub)), [game, record, scrub]);
}

/** The last event shown: the scrubber's, else the newest one the dice tray has let through. */
export function useShownSeq(): number {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const held = useHold((s) => s.held);
  return scrub ?? (held !== null ? held - 1 : (record.events.at(-1)?.seq ?? record.initial.seq));
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
/**
 * Jump the replay to a rare roll (UX 103): one event before it, then onto it,
 * so the dice tray stages the roll again. Back to live when it was the latest.
 */
export function replayRoll(seq: number) {
  const { record, session, setScrub } = useStore.getState();
  const last = record.events.at(-1)?.seq ?? 0;
  setScrub(seq - 1);
  setTimeout(() => useStore.getState().setScrub(seq >= last && session ? null : seq), 80);
}

export function useRareStars(unitId: string | null | undefined): RareOutcome[] {
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const all = useMemo(() => rareMoments(record), [record]);
  return all.filter((m) => m.unitId === unitId && m.seq <= (scrub ?? Infinity));
}
