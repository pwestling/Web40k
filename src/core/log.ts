import { resolveIntent, type GameEvent, type Intent, type Rng } from "./actions";
import { BadFace, NeedDice, toldRng, type ToldRng } from "./dice";
import { applyEvent } from "./reducer";
import { createInitialState, type GameState, type PlayerId } from "./types";

/**
 * The game is an event log. The host turns every intent into a numbered
 * event, and everything else derives from the log: the current table, live
 * sync, undo, spectating, replays and stats.
 */
export interface LoggedEvent {
  seq: number;
  /** Peer who asked for it. */
  by: PlayerId;
  /** Host clock, ms since epoch. Used for replays, never for game logic. */
  at: number;
  event: GameEvent;
  /** Peer that was host when it was logged (and rolled its dice), once hosts can change. */
  host?: PlayerId;
  /** Its dice were rolled at the table and typed in, not rolled by the host (#37). */
  told?: true;
}

/**
 * An intent may carry the faces of real dice the player rolled (#37, table
 * companion): every die the intent rolls takes the next of them, in order.
 */
export interface Told {
  told?: number[];
}

const MAX_TOLD = 500;

/** A whole game: the starting table plus every event since. Also the replay file format. */
export interface GameRecord {
  format: "open-battle/record@1";
  initial: GameState;
  events: LoggedEvent[];
}

export function createRecord(initial: GameState = createInitialState()): GameRecord {
  return { format: "open-battle/record@1", initial, events: [] };
}

export function lastSeq(record: GameRecord): number {
  return record.events.at(-1)?.seq ?? record.initial.seq;
}

/** Seqs taken back by undo events at or before `uptoSeq`. */
export function undoneSeqs(record: GameRecord, uptoSeq = Infinity): Set<number> {
  const undone = new Set<number>();
  for (const { seq, event } of record.events) {
    if (seq > uptoSeq) break;
    if (event.type === "undo") for (const s of [event.seq, ...(event.also ?? [])]) undone.add(s);
  }
  return undone;
}

/** Rebuild the table as it stood after `uptoSeq` (default: now). Replays scrub with this. */
export function stateAt(record: GameRecord, uptoSeq = Infinity): GameState {
  const undone = undoneSeqs(record, uptoSeq);
  let state = record.initial;
  for (const logged of record.events) {
    if (logged.seq > uptoSeq) break;
    if (!undone.has(logged.seq)) state = applyEvent(state, logged.event);
    state = { ...state, seq: logged.seq };
  }
  return state;
}

/**
 * Host side: turn an intent into the next logged event, or null if it is
 * rejected. Only malformed requests are rejected; rules are advisory.
 */
export function resolveLogged(
  record: GameRecord,
  intent: Intent,
  by: PlayerId,
  rng: Rng,
  now: number,
  state: GameState = stateAt(record),
): LoggedEvent | null {
  if (intent.type === "undo" && ![intent.seq, ...(intent.also ?? [])].every((s) => canUndo(record, s)))
    return null;
  const told = (intent as Told).told;
  if (told !== undefined && (!Array.isArray(told) || told.length > MAX_TOLD)) return null;
  const real = told ? toldRng(told, rng) : null;
  let event: GameEvent | null;
  try {
    event = resolveIntent(bare(intent), by, real ?? rng, state, (seq) => stateAt(record, seq));
  } catch (e) {
    // Too few faces, or a face the die doesn't have: the player's screen asks again.
    if (real && (e instanceof NeedDice || e instanceof BadFace)) return null;
    throw e;
  }
  // Every face told must be used, so nothing typed in is quietly dropped.
  if (real && real.used() !== told!.length) return null;
  return (
    event && {
      seq: lastSeq(record) + 1,
      by,
      at: now,
      event,
      ...(real?.used() ? { told: true as const } : {}),
    }
  );
}

function bare(intent: Intent): Intent {
  if (!("told" in intent)) return intent;
  const { told: _told, ...rest } = intent as Intent & Told;
  return rest as Intent;
}

/** The next dice a player rolling real dice should roll: how many, and what kind. */
export interface DiceWanted {
  count: number;
  sides: number;
}

/**
 * Dry-run an intent with the faces told so far: null when they're all it
 * needs, else the next batch to roll (the run of same-sided dice that follows,
 * guessing each still-unrolled die comes up on its top face). "bad" when a
 * face can't be right, such as a 7 on a D6.
 */
export function diceWanted(
  record: GameRecord,
  intent: Intent,
  by: PlayerId,
  faces: number[],
  state: GameState = stateAt(record),
): DiceWanted | null | "bad" {
  const asked: number[] = [];
  const probe = toldRng(
    faces,
    () => 0.5,
    (sides) => {
      asked.push(sides);
      return sides;
    },
  ) as ToldRng;
  try {
    resolveIntent(bare(intent), by, probe, state, (seq) => stateAt(record, seq));
  } catch (e) {
    if (e instanceof BadFace) return "bad";
    throw e;
  }
  if (probe.used() < faces.length) return "bad";
  if (!asked.length) return null;
  const sides = asked[0]!;
  let count = 0;
  while (count < asked.length && asked[count] === sides) count++;
  return { count, sides };
}

/** An event can be undone once, and undo events themselves cannot be undone (yet). */
export function canUndo(record: GameRecord, seq: number): boolean {
  const target = record.events.find((e) => e.seq === seq);
  // A code procedure's steps can't be taken back one by one: its replay would no longer match.
  if (target?.event.type === "script/step" || target?.event.type === "module/set") return false;
  return !!target && target.event.type !== "undo" && !undoneSeqs(record).has(seq);
}

export function appendEvent(record: GameRecord, logged: LoggedEvent): GameRecord {
  return { ...record, events: [...record.events, logged] };
}
