import { getSystem } from "./content/systems";
import { systemOf } from "./content/turn";
import { findProcedure, type ProcedureRun, type StepRecord } from "./content/runner";
import type { GameRecord } from "./log";
import { undoneSeqs } from "./log";
import { applyEvent } from "./reducer";
import { followUpNeed, passChance, procedureOdds, recordLuck, targetModels } from "./odds";
import type { Step } from "./content/schema";
import type { GameState, Model, PlayerId, UnitId } from "./types";

/**
 * After-game numbers, worked out from the event log alone (so a replay gives
 * the same screen): damage each unit dealt and took, points destroyed each
 * round, and how each player's dice ran against the odds.
 */

export interface UnitStats {
  id: UnitId;
  name: string;
  owner: PlayerId;
  /** Wounds this unit's attacks took off enemy models. */
  dealt: number;
  /** Enemy models this unit's attacks destroyed. */
  slain: number;
  /** Wounds the unit lost, from any cause. */
  taken: number;
  /** Its own models destroyed, from any cause. */
  lost: number;
}

/** One rolled step (hit, wound, save…) for one player, summed over the game. */
export interface StepLuck {
  step: string;
  rolled: number;
  /** Dice that passed. */
  actual: number;
  /** Dice expected to pass, from each roll's own odds. */
  expected: number;
}

export interface PlayerStats {
  id: PlayerId;
  name: string;
  color: string;
  /** Enemy points destroyed in each round (index 0 is round 1). */
  pointsByRound: number[];
  luck: StepLuck[];
}

/** One attack or procedure that ran: what came out of it against what was expected. */
export interface RunSwing {
  /** Event that started it. */
  seq: number;
  round: number;
  player: PlayerId | undefined;
  title: string;
  /**
   * What was counted: models "slain", "damage" to a lone model, or (for a
   * procedure without damage) the id of its last rolled step.
   */
  measure: string;
  /** What came out, and the exact odds' expectation shown before the roll. */
  actual: number;
  expected: number;
}

export interface GameStats {
  units: UnitStats[];
  players: PlayerStats[];
  runs: RunSwing[];
  rounds: number;
}

/** Wounds a model has lost so far, counting a destroyed model as all of them. */
function woundsOf(m: Model | undefined): number {
  if (!m) return 0;
  const w = Number(m.profile?.chars.W ?? 1) || 1;
  return m.destroyed ? Math.max(w, m.woundsLost ?? 0) : (m.woundsLost ?? 0);
}

const unitRole = (run: ProcedureRun, role: string): UnitId | undefined => {
  const r = run.roles[role];
  return r && "unit" in r ? r.unit : undefined;
};

/** The step definitions behind a run, when its system is loaded. */
function stepsOf(run: ProcedureRun): Step[] {
  try {
    return findProcedure(getSystem(run.system), run.procedure).steps;
  } catch {
    return [];
  }
}

/** Who rolled a step: the defender for saves, the attacker otherwise. */
function rollerOf(run: ProcedureRun, step: Step | undefined, state: GameState): PlayerId | undefined {
  const roller = step && step.kind === "test" ? step.roller : undefined;
  const unit =
    roller === "defender"
      ? (unitRole(run, "target") ?? unitRole(run, "defender"))
      : (unitRole(run, "attacker") ?? unitRole(run, "unit"));
  return unit ? state.units[unit]?.owner : undefined;
}

/** A run the event carried on rather than replaced (same procedure, same roles, more records). */
function continues(before: ProcedureRun | undefined, after: ProcedureRun): boolean {
  return (
    !!before &&
    !before.done &&
    before.procedure === after.procedure &&
    JSON.stringify(before.roles) === JSON.stringify(after.roles) &&
    after.records.length >= before.records.length
  );
}

/**
 * Expected dice reaching the end of a run, given the pool it actually rolled:
 * each test's odds applied to the expected number going in.
 */
export function runExpectation(
  records: StepRecord[],
  steps: Step[] = [],
): { actual: number; expected: number } | null {
  let expected: number | null = null;
  let actual = 0;
  for (const r of records) {
    if (r.kind === "pool") {
      expected = r.out;
      actual = r.out;
    } else if (r.plan.kind === "test" && expected !== null) {
      const p = passChance(
        r.plan,
        followUpNeed(
          steps.find((s) => s.id === r.id),
          r.plan,
        ),
      );
      const passOn = r.plan.passOn;
      if (p === null) expected = r.out;
      else if (passOn === "successes") expected *= p;
      else if (passOn === "failures") expected *= 1 - p;
      else expected *= 2 - p;
      actual = r.out;
    } else if (r.kind === "damage") break;
  }
  return expected === null ? null : { actual, expected };
}

/**
 * How a run went against the odds a player saw before rolling it: models
 * slain (or damage, against a lone model) from the same exact odds as the
 * attack panel. Without damage, the dice left after its last test.
 */
function swingOf(t: Tracked, steps: Step[]): Pick<RunSwing, "measure" | "actual" | "expected"> | null {
  const plans = Object.fromEntries(t.run.records.map((r) => [r.id, r.plan]));
  const models = targetModels(t.state, unitRole(t.run, "target"));
  const odds = procedureOdds(steps, plans, models);
  if (odds.slain !== undefined) {
    return models.length === 1
      ? { measure: "damage", actual: t.damage, expected: odds.damage ?? 0 }
      : { measure: "slain", actual: t.slain, expected: odds.slain };
  }
  const left = runExpectation(t.run.records, steps);
  const last = [...t.run.records].reverse().find((r) => r.plan.kind === "test");
  return left && last ? { measure: last.id, ...left } : null;
}

interface Tracked {
  seq: number;
  round: number;
  run: ProcedureRun;
  title: string;
  /** The state when the run started, for owners, names and the target's wounds. */
  state: GameState;
  /** Target models destroyed and wounds it lost while this run was the one acting. */
  slain: number;
  damage: number;
}

export function gameStats(record: GameRecord): GameStats {
  const undone = undoneSeqs(record);
  let state = record.initial;
  const units: Record<UnitId, UnitStats> = {};
  const tracked: Tracked[] = [];
  const points: Record<PlayerId, number[]> = {};
  const live: { attack?: Tracked; procedure?: Tracked } = {};
  let maxRounds = Infinity;

  const unitStats = (s: GameState, id: UnitId): UnitStats | undefined => {
    const u = s.units[id];
    if (!u) return undefined;
    return (units[id] ??= { id, name: u.name, owner: u.owner, dealt: 0, slain: 0, taken: 0, lost: 0 });
  };

  for (const logged of record.events) {
    if (undone.has(logged.seq)) continue;
    const before = state;
    state = applyEvent(state, logged.event);
    try {
      const sys = systemOf(state);
      if (typeof sys.turn.rounds === "number") maxRounds = sys.turn.rounds;
    } catch {
      // No system loaded yet.
    }
    const round = Math.max(1, Math.min(state.turn.round, maxRounds));

    // Runs: a new one, or more steps of the one going on.
    const slots = [
      ["attack", before.attack?.run, state.attack?.run, state.attack] as const,
      ["procedure", before.procedure?.run, state.procedure?.run, state.procedure] as const,
    ];
    let source: ProcedureRun | undefined;
    let acting: Tracked | undefined;
    for (const [slot, was, now] of slots) {
      if (!now || now === was) continue;
      source = now;
      const current = live[slot];
      if (current && continues(was, now)) {
        current.run = now;
        acting = current;
      } else {
        const attacker = unitRole(now, "attacker");
        const target = unitRole(now, "target");
        const title =
          slot === "procedure" && state.procedure?.title
            ? state.procedure.title
            : `${state.units[attacker ?? ""]?.name ?? "Attack"}${target ? ` at ${state.units[target]?.name ?? "target"}` : ""}`;
        const t: Tracked = { seq: logged.seq, round, run: now, title, state, slain: 0, damage: 0 };
        tracked.push(t);
        live[slot] = t;
        acting = t;
      }
    }
    const dealer = source ? unitRole(source, "attacker") : undefined;

    // Damage: every model whose wounds went up in this event.
    for (const [id, m] of Object.entries(state.models)) {
      const was = before.models[id];
      const gained = woundsOf(m) - woundsOf(was);
      const died = m.destroyed && !was?.destroyed;
      if (gained <= 0 && !died) continue;
      const unitId = Object.values(state.units).find((u) => u.modelIds.includes(id))?.id;
      const victim = unitId ? unitStats(state, unitId) : undefined;
      if (victim) {
        victim.taken += Math.max(0, gained);
        if (died) victim.lost++;
      }
      if (acting && unitId && unitId === unitRole(acting.run, "target")) {
        acting.damage += Math.max(0, gained);
        if (died) acting.slain++;
      }
      const by = dealer ? unitStats(state, dealer) : undefined;
      if (by && by.owner !== m.owner) {
        by.dealt += Math.max(0, gained);
        if (died) by.slain++;
      }
      if (died && unitId) {
        const unit = state.units[unitId]!;
        const each = (unit.sheet?.points ?? 0) / Math.max(1, unit.modelIds.length);
        // Credited to every other seated player (in a two-player game, the opponent).
        for (const p of Object.values(state.players))
          if (p.seat !== undefined && p.id !== m.owner) {
            const row = (points[p.id] ??= []);
            row[round - 1] = (row[round - 1] ?? 0) + each;
          }
      }
    }
  }

  const rounds = Math.min(Math.max(1, state.turn.round), maxRounds);
  const luck: Record<PlayerId, Record<string, StepLuck>> = {};
  const runs: RunSwing[] = [];
  // Rolled steps in the order procedures run them, so every player's rows line up.
  const order: string[] = [];
  for (const t of tracked) {
    const steps = stepsOf(t.run);
    for (const r of t.run.records) {
      const step = steps.find((s) => s.id === r.id);
      const l = recordLuck(r, step);
      const player = l && rollerOf(t.run, step, t.state);
      if (!l || !player) continue;
      const row = ((luck[player] ??= {})[r.id] ??= { step: r.id, rolled: 0, actual: 0, expected: 0 });
      row.rolled += l.rolled;
      row.actual += l.actual;
      row.expected += l.expected;
    }
    for (const r of t.run.records) if (!order.includes(r.id)) order.push(r.id);
    if (!t.run.records.some((r) => r.plan.kind === "test" && r.dice?.length)) continue;
    const swing = swingOf(t, steps);
    if (swing)
      runs.push({
        seq: t.seq,
        round: t.round,
        player: t.state.units[unitRole(t.run, "attacker") ?? ""]?.owner,
        title: t.title,
        ...swing,
      });
  }

  const players = Object.values(state.players)
    .filter((p) => p.seat !== undefined)
    .sort((a, b) => a.seat! - b.seat!)
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      pointsByRound: Array.from({ length: rounds }, (_, i) => points[p.id]?.[i] ?? 0),
      luck: Object.values(luck[p.id] ?? {}).sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step)),
    }));
  return { units: Object.values(units), players, runs, rounds };
}

/** The run in each round that beat (or missed) its odds by the most. */
export function biggestSwings(runs: RunSwing[]): Map<number, RunSwing> {
  const out = new Map<number, RunSwing>();
  for (const r of runs) {
    const best = out.get(r.round);
    if (!best || Math.abs(r.actual - r.expected) > Math.abs(best.actual - best.expected)) out.set(r.round, r);
  }
  return out;
}
