import type { GameEvent } from "./actions";
import { findProcedure, type ProcedureRun, type RoleRef, type StepRecord } from "./content/runner";
import { getSystem } from "./content/systems";
import { followUpNeed, passChance } from "./odds";
import type { GameState, PlayerId } from "./types";

/**
 * The dice a change to the table rolled, for the dice tray to stage. Pure:
 * every peer (and a replay) gets the same rolls from the same events.
 */
export interface TrayRoll {
  /** Stable within a game, so the tray never plays one roll twice. */
  id: string;
  /** "Hit 3+", "Charge roll". */
  title: string;
  sides: number;
  dice: TrayDie[];
  /** Who rolled; dice come in from their side and in their colour. */
  by?: PlayerId;
  /** The defending side rolled (saves, ward saves): dice come in from the top. */
  defender: boolean;
  /** One total that counts (2D6 leadership, a charge), not dice judged one by one. */
  sum: boolean;
  /** Rolls in the same chain (one attack's steps) carry their survivors over. */
  chain?: string;
  /** For a summed test: whether it passed. */
  passed?: boolean;
  /** Each die's chance to pass before it was rolled (re-rolls included), for tests judged die by die. */
  p?: number;
  /** A test's target, and whether it is roll-high (3+) or roll-under. */
  need?: number | null;
  compare?: "atLeast" | "atMost";
  /** The step's id (hit, wound, save), for callers that judge stakes. */
  step?: string;
  /** For a test: dice that succeed go on, unless the step passes its failures (a save's failures wound). */
  passOn?: "successes" | "failures" | "inputPlusFailures";
  unitId?: string;
  /** The unit on the receiving end, when the roll is part of an attack or action against one. */
  targetId?: string;
  label?: string;
}

export interface TrayDie {
  value: number;
  /** Judged against a target: true passes, false fails; absent for plain dice. */
  ok?: boolean;
  crit?: boolean;
}

/**
 * The rolls made going from `before` to `after` by `events` (those applied in
 * between, in order; `seq` is the last one's). Procedure and attack runs are
 * compared step by step; plain dice rolls come from their events. Undo shows
 * nothing.
 */
export function rollsIn(before: GameState, after: GameState, events: GameEvent[], seq: number): TrayRoll[] {
  if (events.some((e) => e.type === "undo")) return [];
  const out: TrayRoll[] = [];
  for (const [slot, run] of runsOf(after)) {
    const key = runKey(slot, run);
    const prev = runsOf(before).find(([s, r]) => s === slot && runKey(s, r) === key)?.[1];
    if (prev && prev.records.length > run.records.length) continue;
    const from = prev?.records.length ?? 0;
    run.records.slice(from).forEach((r, i) => {
      const roll = recordRoll(after, run, r, `${seq}:${slot}:${from + i}`);
      if (roll) out.push({ ...roll, chain: key });
    });
  }
  flat(events).forEach((e, i) => {
    if (e.type !== "dice/roll" || e.roll.faces?.length) return;
    const { roll } = e;
    out.push({
      id: `${seq}:dice:${i}`,
      title: roll.label ? cap(roll.label) : `${roll.results.length}D${roll.sides}`,
      sides: roll.sides,
      dice: roll.results.map((v) =>
        roll.need ? { value: v, ok: v >= roll.need, crit: v === roll.sides } : { value: v },
      ),
      by: roll.by,
      defender: false,
      sum: !roll.need && roll.results.length <= 3,
      unitId: roll.unitId,
      label: roll.label,
      need: roll.need,
    });
  });
  return out;
}

/** Events with a script's own events (its dice rolls) spliced in. */
function flat(events: GameEvent[]): GameEvent[] {
  return events.flatMap((e) => (e.type === "script/step" ? [e, ...flat(e.events)] : [e]));
}

function runsOf(state: GameState): [string, ProcedureRun][] {
  const out: [string, ProcedureRun][] = [];
  if (state.attack?.run) out.push(["attack", state.attack.run]);
  if (state.procedure?.run) out.push(["procedure", state.procedure.run]);
  return out;
}

const runKey = (slot: string, run: ProcedureRun) => `${slot}:${run.procedure}:${JSON.stringify(run.roles)}`;

function recordRoll(state: GameState, run: ProcedureRun, r: StepRecord, id: string): TrayRoll | null {
  const base = {
    id,
    step: r.id,
    unitId: unitOf(run.roles.attacker ?? Object.values(run.roles)[0]),
    targetId: unitOf(run.roles.target ?? run.roles.defender),
  };
  if (r.kind === "pool" && r.rolls?.length && r.plan.kind === "pool") {
    const sides = Number(/D(\d+)/i.exec(r.plan.count)?.[1] ?? 6);
    return {
      ...base,
      title: "Attacks",
      sides,
      dice: r.rolls.map((value) => ({ value })),
      by: ownerOf(state, run.roles.attacker),
      defender: false,
      sum: false,
    };
  }
  if (r.plan.kind !== "test" || r.plan.skip || !r.dice?.length) return null;
  const plan = r.plan;
  const step = stepOf(run, r.id);
  const roller = step?.kind === "test" ? step.roller : "attacker";
  const defender = roller === "defender" || roller === "opponent";
  const role = defender ? (run.roles.target ?? run.roles.defender) : (run.roles.attacker ?? run.roles.target);
  const summed = plan.sumOf > 1 || !!plan.keep;
  const need =
    plan.target === null
      ? " (can't pass)"
      : plan.compare === "atLeast"
        ? ` ${plan.target}+`
        : ` ${plan.target} or less`;
  return {
    ...base,
    title: `${cap(r.id)}${need}`,
    sides: plan.sides,
    dice: r.dice.flatMap((d) =>
      summed && d.dice?.length
        ? d.dice.map((value) => ({ value, ok: d.success }))
        : [{ value: d.value, ok: d.success, crit: d.critical }],
    ),
    by: ownerOf(state, role),
    defender,
    sum: summed && r.dice.length === 1,
    passed: summed && r.dice.length === 1 ? r.dice[0]!.success : undefined,
    passOn: plan.passOn,
    need: plan.target,
    compare: plan.compare,
    p: summed ? undefined : (passChance(plan, followUpNeed(step, plan)) ?? undefined),
  };
}

function stepOf(run: ProcedureRun, id: string) {
  try {
    return findProcedure(getSystem(run.system), run.procedure).steps.find((s) => s.id === id);
  } catch {
    return undefined;
  }
}

function unitOf(ref: RoleRef | undefined): string | undefined {
  return ref && "unit" in ref ? ref.unit : undefined;
}

/**
 * Who rolls a procedure's next dice: the attacker for a pool, the test's
 * roller for a test (a save is the defender's). Undefined when unsure.
 */
export function nextRoller(state: GameState, run: ProcedureRun): PlayerId | undefined {
  let steps;
  try {
    steps = findProcedure(getSystem(run.system), run.procedure).steps;
  } catch {
    return undefined;
  }
  for (const step of steps.slice(run.next)) {
    if (step.kind !== "test" && step.kind !== "pool") continue;
    const roller = step.kind === "test" ? step.roller : "attacker";
    const defender = roller === "defender" || roller === "opponent";
    return ownerOf(
      state,
      defender ? (run.roles.target ?? run.roles.defender) : (run.roles.attacker ?? run.roles.target),
    );
  }
  return undefined;
}

function ownerOf(state: GameState, ref: RoleRef | undefined): PlayerId | undefined {
  if (!ref) return undefined;
  if ("player" in ref) return ref.player;
  if ("unit" in ref) return state.units[ref.unit]?.owner;
  return state.models[ref.model]?.owner;
}

const cap = (s: string) => {
  const t = s.replace(/[-_]/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
