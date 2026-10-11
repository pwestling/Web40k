import { useMemo } from "react";
import { rareMoments, stateAt, type GameRecord, type GameState, type RareOutcome } from "../core";
import { useStore } from "../store";
import { useHold } from "./hold";

/** The last few tables shown at a seq: every useGame (dozens of components) shares one replay. */
const shown: { record: GameRecord; seq: number; state: GameState }[] = [];

/**
 * The table as it stood at `seq`. A state there depends only on the events up
 * to it (an undo only counts from where it is logged), so a newer record that
 * logged events after `seq` reuses the replay: the dice tray's hold no longer
 * replays the whole log once per component and per event (#80 slowdown).
 */
function tableAt(record: GameRecord, seq: number): GameState {
  const upTo = (r: GameRecord) => r.events.findLast((e) => e.seq <= seq);
  const last = upTo(record);
  const hit = shown.find(
    (c) =>
      c.seq === seq &&
      c.record.initial === record.initial &&
      (c.record === record || upTo(c.record) === last),
  );
  if (hit) return hit.state;
  const state = stateAt(record, seq);
  shown.unshift({ record, seq, state });
  shown.length = Math.min(shown.length, 4);
  return state;
}

/** The table to show: live, or as it stood at the replay scrubber's position. */
export function useGame(): GameState {
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const held = useHold((s) => s.held);
  return useMemo(() => {
    if (scrub !== null) return tableAt(record, scrub);
    // The dice tray is still rolling: show the table from before the roll.
    return held !== null ? tableAt(record, held - 1) : game;
  }, [game, record, scrub, held]);
}

/** The table without the dice tray's hold: what the log says now (or at the scrubber). */
export function useLiveGame(): GameState {
  const game = useStore((s) => s.game);
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  return useMemo(() => (scrub === null ? game : tableAt(record, scrub)), [game, record, scrub]);
}

/** This browser's seat, or the active seat in hotseat; spectators see seat 0's side. */
export function useSelfSeat(): number {
  const selfId = useStore((s) => s.session?.selfId);
  const mode = useStore((s) => s.mode);
  const game = useStore((s) => s.game);
  // A mail game is a hotseat under the hood; this device still plays one side (dogfood).
  const mailSeat = useStore((s) => s.mail?.seat);
  if (mode === "hotseat") return mailSeat ?? 0;
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
