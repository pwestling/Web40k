import { sidePlayers, stateAt, undoneSeqs, type GameEvent, type GameRecord, type GameState } from "../core";
import { currentSlot } from "../core/content/turn";
import { battleOver } from "../soak/bot";
import { aliveModels, unitDistance } from "../systems/wh40k/rules";
import { afterLine, factTest, type Facts, type Lesson, type Until } from "./lesson";

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
  /** What happened in the step just finished, for the coach's `after` line and the next step's text. */
  facts?: Facts;
  /** The coach's line about how the last step went (its `after`). */
  said?: string | null;
}

const NO_FACTS: Facts = { roll: 0, slain: 0, lost: 0, target: "", engaged: 0 };

/** How many of a seat's units stand in contact with (within 1" of) an enemy unit. */
function engagedUnits(state: GameState, seat: number): number {
  const seatOf = (owner: string) => state.players[owner]?.seat;
  const units = Object.values(state.units).filter((u) => aliveModels(state, u).length && !u.status?.reserves);
  return units.filter(
    (u) =>
      seatOf(u.owner) === seat &&
      units.some(
        (e) =>
          seatOf(e.owner) !== undefined &&
          seatOf(e.owner) !== seat &&
          unitDistance(aliveModels(state, u), aliveModels(state, e)) <= 1.05,
      ),
  ).length;
}

/** What the learner's side did and suffered since `from` (see Facts). */
function factsSince(record: GameRecord, state: GameState, from: number, you: number): Facts {
  const learners = new Set(sidePlayers(state, you).map((p) => p.id));
  const undone = undoneSeqs(record);
  const before = stateAt(record, from);
  const seatOf = (owner: string) => state.players[owner]?.seat;
  let slain = 0;
  let lost = 0;
  for (const m of Object.values(state.models))
    if (m.destroyed && !before.models[m.id]?.destroyed) {
      if (seatOf(m.owner) === you) lost++;
      else slain++;
    }
  let roll = 0;
  let target = "";
  const said: string[] = [];
  for (const l of record.events) {
    if (undone.has(l.seq)) continue;
    const e = l.event;
    // What rules written as code logged (a break test, a Panic test), whoever's rule it was.
    if (l.seq > from) {
      const steps =
        e.type === "script/step" ? [e] : e.type === "procedure/clear" && e.script ? [e.script] : [];
      for (const x of steps) for (const n of x.events) if (n.type === "log/note") said.push(n.text);
    }
    if (!learners.has(l.by)) continue;
    // The target can be picked a step earlier (declare, then roll), so look back for it.
    if (e.type === "dice/roll" && l.seq > from) roll = e.roll.results.reduce((a, b) => a + b, 0);
    const hit =
      e.type === "attack/declare"
        ? e.attack.spec.targetUnitId
        : e.type === "action/take"
          ? e.targetId
          : undefined;
    if (hit && state.units[hit]) target = state.units[hit]!.name;
  }
  return { roll, slain, lost, target, engaged: engagedUnits(state, you), said: said.join("\n") };
}

/**
 * Ids a logged event counts as having done: its type, the action or
 * procedure it started, and "roll:<label>" for a labelled roll (the 40k
 * card's Charge (2D6) is a roll labelled "charge"), and "attack:ranged" or
 * "attack:melee" for an attack declared from the attack panel, and
 * "attack:done" once its last roll is in.
 */
export function didIds(event: GameEvent): string[] {
  const ids: string[] = [event.type];
  if (event.type === "dice/roll" && event.roll.label) ids.push(`roll:${event.roll.label}`);
  if (event.type === "action/take" || event.type === "player/action") ids.push(event.action);
  if (event.type === "attack/declare") ids.push(`attack:${event.attack.spec.kind}`);
  if (event.type === "attack/roll" && event.attack.stage === "done") ids.push("attack:done");
  if (event.type === "script/step" && event.started) ids.push(event.started);
  return ids;
}

function attackerOf(event: GameEvent): string {
  return event.type === "attack/roll" ? event.attack.spec.attackerUnitId : "";
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
  if ("all" in u) return u.all.every((x) => holds(x, seen));
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
  if ("engaged" in u) return engagedUnits(state, you) > 0;
  return false;
}

/**
 * Move the lesson on as far as the log allows. Steps without an `until`
 * wait for the learner's "Got it"; `gotIt` moves the current step on
 * either way (a skipped step).
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
  let { facts, said } = progress;
  let pressed = gotIt;
  for (;;) {
    const s = lesson.steps[step];
    if (!s) break;
    const from = began[step] ?? state.seq;
    // A step that doesn't apply as it comes up (say, "They charged you!" when nobody did) is skipped.
    if (
      began[step] === undefined &&
      s.if &&
      !factTest(s.if, { ...(facts ?? NO_FACTS), engaged: engagedUnits(state, you) })
    ) {
      began[step] = from;
      step++;
      continue;
    }
    began[step] = from;
    let done: boolean;
    let skipped = false;
    if (!s.until || pressed) {
      // "Got it", or "Skip" on a step the learner passes up.
      done = pressed;
      skipped = pressed && !!s.until;
      pressed = false;
    } else {
      const did = new Set<string>();
      for (const l of record.events)
        if (l.seq > from && !undone.has(l.seq) && learners.has(l.by))
          for (const id of didIds(l.event))
            // Rolling saves against their attack doesn't finish an attack of yours.
            if (id !== "attack:done" || learners.has(state.units[attackerOf(l.event)]?.owner ?? ""))
              did.add(id);
      done = holds(s.until, { did, state, you });
    }
    if (!done) break;
    facts = factsSince(record, state, from, you);
    // A skipped step didn't happen, so it has nothing to say about it.
    said = skipped ? undefined : afterLine(s, facts);
    step++;
  }
  return { step, began: began.slice(0, step + 1), ...(facts ? { facts } : {}), said: said ?? null };
}
