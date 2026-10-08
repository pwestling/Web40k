import { sidePlayers, undoneSeqs, type GameEvent, type GameRecord, type GameState } from "../core";
import { currentSlot } from "../core/content/turn";
import { battleOver } from "../soak/bot";
import type { Lesson, Until } from "./lesson";

/**
 * The coach's progress through a lesson, worked out from the game log: each
 * step is done once its `until` holds, judged on the events logged since the
 * step began and on the table as it stands. Pure, so a test can walk a
 * lesson the same way the coach card does.
 */

export interface Progress {
  /** The step on now (lesson.steps.length once the lesson is finished). */
  step: number;
  /** The log's seq as each step began, for "Redo this step" (a What if branch from there). */
  began: number[];
}

/**
 * Ids a logged event counts as having done: its type, the action or
 * procedure it started, and "roll:<label>" for a labelled roll (the 40k
 * card's Charge (2D6) is a roll labelled "charge").
 */
export function didIds(event: GameEvent): string[] {
  const ids: string[] = [event.type];
  if (event.type === "dice/roll" && event.roll.label) ids.push(`roll:${event.roll.label}`);
  if (event.type === "action/take" || event.type === "player/action") ids.push(event.action);
  if (event.type === "script/step" && event.started) ids.push(event.started);
  return ids;
}

/** Whether the opponent is owed a move: a question or a roll for them, or their turn. */
export function waitsOn(state: GameState, seat: number): boolean {
  const q = state.script?.waiting;
  if (q) return state.players[q.player]?.seat === seat;
  if (state.pending) return state.pending.seat === seat;
  return state.turn.activeSeat === seat;
}

interface Seen {
  /** Ids done by the learner since the step began. */
  did: Set<string>;
  state: GameState;
  you: number;
}

function holds(u: Until, seen: Seen): boolean {
  const { state, you } = seen;
  const them = 1 - you;
  if ("any" in u) return u.any.some((x) => holds(x, seen));
  if ("did" in u) return (Array.isArray(u.did) ? u.did : [u.did]).some((id) => seen.did.has(id));
  if ("phase" in u)
    return (
      state.turn.round > 0 &&
      currentSlot(state)?.id === u.phase &&
      state.turn.activeSeat === (u.side === "them" ? them : you)
    );
  if ("round" in u) return state.turn.round >= u.round;
  if ("over" in u) return state.turn.round > 0 && battleOver(state);
  if ("yourTurn" in u) return state.turn.round > 0 && !waitsOn(state, them) && state.turn.activeSeat === you;
  if ("theirTurn" in u) return state.turn.round > 0 && state.turn.activeSeat === them;
  return false;
}

/**
 * Move the lesson on as far as the log allows. Steps without an `until`
 * wait for the learner's "Got it" (`gotIt` moves one of them on).
 */
export function advance(
  lesson: Lesson,
  progress: Progress,
  record: GameRecord,
  state: GameState,
  gotIt = false,
): Progress {
  const you = lesson.you ?? 0;
  const learners = new Set(sidePlayers(state, you).map((p) => p.id));
  const undone = undoneSeqs(record);
  let { step } = progress;
  const began = [...progress.began];
  let pressed = gotIt;
  for (;;) {
    const s = lesson.steps[step];
    if (!s) break;
    const from = began[step] ?? state.seq;
    began[step] = from;
    let done: boolean;
    if (!s.until) {
      done = pressed;
      pressed = false;
    } else {
      const did = new Set<string>();
      for (const l of record.events)
        if (l.seq > from && !undone.has(l.seq) && learners.has(l.by))
          for (const id of didIds(l.event)) did.add(id);
      done = holds(s.until, { did, state, you });
    }
    if (!done) break;
    step++;
    began[step] = state.seq;
  }
  return { step, began: began.slice(0, step + 1) };
}
