import { findProcedure } from "./content/runner";
import { systemOf } from "./content/turn";
import { undoneSeqs, type GameRecord } from "./log";
import { applyEvent } from "./reducer";
import type { GameState } from "./types";

/**
 * Chess clocks (roadmap #29), worked out from the game log: between one
 * logged event and the next, the time (by the host's clock, the same on every
 * peer) goes to the side that had to act. That is the side whose turn it is,
 * except while the other side decides on a reaction or rolls its saves. The
 * clocks run from the first battle round until the battle is over, and stop
 * while paused (by hand, or while a player is disconnected). Nothing is
 * enforced: a side out of time is shown, and the players decide.
 */

export interface ClockSettings {
  /** Minutes on each side's clock. */
  minutes: number;
  /** Minutes for each battle round, if rounds are timed. */
  roundMinutes?: number;
  /** Minutes for the whole battle, if it's timed (the "last turn" call). */
  gameMinutes?: number;
}

export interface Clocks {
  /** Milliseconds each seat has used, up to `at`. */
  used: Record<number, number>;
  /** Milliseconds added (or taken) by hand, per seat. */
  adjusted: Record<number, number>;
  /** The seat whose clock is running at `at`, or null. */
  running: number | null;
  paused: false | "hand" | "disconnect";
  /** When the battle started and the current round started (ms), if they have. */
  battleStart: number | null;
  roundStart: number | null;
  /** Battle rounds finished, for the average round length. */
  roundsDone: number;
  over: boolean;
  /** The time of the last event counted. */
  at: number;
}

/** The seat that has to act: a reaction's or a save's roller, else the side whose turn it is. */
export function actingSeat(state: GameState): number | null {
  if (state.pending) return state.pending.seat;
  const seatOf = (unitId: string | undefined) => {
    const owner = unitId ? state.units[unitId]?.owner : undefined;
    return owner ? (state.players[owner]?.seat ?? null) : null;
  };
  if (state.attack?.stage === "save") return seatOf(state.attack.spec.targetUnitId) ?? state.turn.activeSeat;
  const proc = state.procedure;
  if (proc && !proc.run.done) {
    try {
      const step = findProcedure(systemOf(state), proc.run.procedure).steps[proc.run.next];
      if (step?.kind === "test" && step.roller === "defender")
        return seatOf(proc.targetId) ?? state.turn.activeSeat;
    } catch {
      // A procedure this table can't find: the turn's side.
    }
  }
  return state.turn.activeSeat;
}

function battleOver(state: GameState): boolean {
  try {
    const rounds = systemOf(state).turn.rounds;
    return typeof rounds === "number" && state.turn.round > rounds;
  } catch {
    return false;
  }
}

export function clocks(record: GameRecord): Clocks {
  const undone = undoneSeqs(record);
  let state = record.initial;
  const c: Clocks = {
    used: {},
    adjusted: {},
    running: null,
    paused: false,
    battleStart: null,
    roundStart: null,
    roundsDone: 0,
    over: false,
    at: 0,
  };
  for (const logged of record.events) {
    // The interval just gone goes to whoever was running.
    if (c.running !== null && !c.paused && c.at)
      c.used[c.running] = (c.used[c.running] ?? 0) + logged.at - c.at;
    c.at = logged.at;
    const { event } = logged;
    if (event.type === "clock/pause") c.paused = event.paused ? (event.reason ?? "hand") : false;
    if (event.type === "clock/adjust") c.adjusted[event.seat] = (c.adjusted[event.seat] ?? 0) + event.ms;
    if (undone.has(logged.seq)) continue;
    const round = state.turn.round;
    state = applyEvent(state, event);
    if (state.turn.round > round) {
      if (round > 0) c.roundsDone++;
      if (round === 0 && state.turn.round > 0) c.battleStart = logged.at;
      c.roundStart = logged.at;
    }
    c.over = battleOver(state);
    c.running = state.turn.round > 0 && !c.over ? actingSeat(state) : null;
  }
  return c;
}

/** Milliseconds a seat has left at `now`: its allowance, plus adjustments, less what it used. */
export function timeLeft(c: Clocks, settings: ClockSettings, seat: number, now: number): number {
  const live = c.running === seat && !c.paused ? Math.max(0, now - c.at) : 0;
  return settings.minutes * 60_000 + (c.adjusted[seat] ?? 0) - (c.used[seat] ?? 0) - live;
}

/** What the time limits say now, in plain words, or null when there's nothing to call. */
export function timeCall(c: Clocks, settings: ClockSettings, now: number): string | null {
  if (c.over || c.battleStart === null) return null;
  if (settings.gameMinutes) {
    const elapsed = now - c.battleStart;
    const left = settings.gameMinutes * 60_000 - elapsed;
    if (left <= 0) return "Time's up for the battle: finish the turn you're in, then stop.";
    // After this round (at the pace so far), not enough time for another like it: this is the last.
    const average = c.roundsDone ? (c.roundStart! - c.battleStart) / c.roundsDone : null;
    const roundLeft = average !== null ? average - (now - c.roundStart!) : null;
    if (average !== null && left - Math.max(0, roundLeft ?? 0) < average)
      return "Last turn: there's time to finish this battle round, not another.";
  }
  if (settings.roundMinutes && c.roundStart !== null && now - c.roundStart > settings.roundMinutes * 60_000)
    return "This battle round is over its time: finish it off.";
  return null;
}

/** "1:23:45", "4:05", or "−0:12" for a clock past zero. */
export function clockText(ms: number): string {
  const sign = ms < 0 ? "−" : "";
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${sign}${h}:${String(m).padStart(2, "0")}:${sec}` : `${sign}${m}:${sec}`;
}
