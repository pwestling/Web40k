import type { GameState } from "../types";
import { bool, evaluate, matchesEvent, num, resolve, type EvalContext } from "./expr";
import {
  diceTerm,
  formatDice,
  lookupRules,
  modelView,
  parseDiceSum,
  rollSum,
  tableGeometry,
  unitView,
  weaponView,
  type ModelView,
  type UnitView,
} from "./runtime";
import { blockSlots } from "../regiment";
import { callFor } from "./calls";
import type { Effect, EffectAction, Expr, GameSystem, Id, Procedure, RuleDef, RuleRef, Step } from "./schema";

/**
 * The procedure runner: executes a system's dice pipelines (an attack
 * sequence, a battle-shock test, combat resolution) step by step.
 *
 * A run is plain JSON (`ProcedureRun`) so it can sit in GameState, travel in
 * events and be replayed. The host advances it with its rng; every peer just
 * stores the result. A run pauses before each step that rolls dice, so every
 * stage is one event players can see and undo, and at `window` steps, where
 * another player may react mid-procedure.
 *
 * Numbers are worked out per step from the data: the step's own expressions,
 * then every effect listening for "step.before" (modifiers, re-rolls,
 * critical thresholds, characteristic changes, skipped steps). Players can
 * override any of them (rules are advisory) through `overrides`. Effects
 * listening for "die.result" fire per die (sustained hits, lethal hits,
 * devastating wounds) and tag the success so it bypasses later steps.
 */

/** What fills a procedure parameter: a unit, a unit's weapon, a model or a player. */
export type RoleRef = { unit: string; weapon?: string } | { model: string } | { player: string };

/** One success flowing down the pipeline. `bypass:<step>` tags skip that step. */
export interface Token {
  tags: string[];
  /** The natural roll that produced it, for opposed tests ("input.value"). */
  value?: number;
}

export interface RolledDie {
  /** The die (or kept / summed result) that counted. */
  value: number;
  rerolledFrom?: number;
  /** Every die rolled for a summed or keep-highest test. */
  dice?: number[];
  success: boolean;
  critical: boolean;
  /** The follow-up roll for a target above the die's maximum (7+). */
  followUp?: number;
}

export type Reroll = "none" | "ones" | "failed" | "any";

export interface PoolPlan {
  kind: "pool";
  /** Dice expression for the number of dice, e.g. "3D6+3". */
  count: string;
  /** Ids of the members counted (models in range), when the pool sums over some. */
  members?: string[];
}

export interface TestPlan {
  kind: "test";
  sides: number;
  /** Target number, or null when the test cannot be passed. */
  target: number | null;
  modifier: number;
  criticalOn: number | null;
  reroll: Reroll;
  alwaysFail: number[];
  alwaysPass: number[];
  /** Skipped: no dice, every input goes on. */
  skip: boolean;
  compare: "atLeast" | "atMost";
  passOn: "successes" | "failures" | "inputPlusFailures";
  sumOf: number;
  dicePerInput: number;
  keep?: "highest" | "lowest";
}

export interface DamagePlan {
  kind: "damage";
  amount: string;
  /** Roll per wound lost and ignore it on this or more (feel no pain). */
  ignoreDamage: number | null;
  spillover: boolean;
}

export type StepPlan = PoolPlan | TestPlan | DamagePlan | { kind: "other" };

export type PlanOverride = Partial<Omit<PoolPlan, "kind">> &
  Partial<Omit<TestPlan, "kind">> &
  Partial<Omit<DamagePlan, "kind">> & {
    /** For an allocate step: model ids in the order the chooser declared. */
    order?: string[];
  };

export interface DamageEntry {
  modelId: string;
  damage: number;
  /** Dice rolled to ignore wounds (feel no pain). */
  ignore: number[];
  lost: number;
  destroyed: boolean;
}

export interface StepRecord {
  id: Id;
  kind: Step["kind"];
  plan: StepPlan;
  /** Tokens in and out. */
  in: number;
  out: number;
  /** Dice rolled for a pool's size. */
  rolls?: number[];
  dice?: RolledDie[];
  successes?: number;
  criticals?: number;
  /** Extra successes added by effects (sustained hits). */
  extra?: number;
  /** Inputs that bypassed this step without rolling. */
  bypassed?: number;
  /** Output tokens carrying each tag, e.g. { "bypass:save": 2 }. */
  tagged?: Record<string, number>;
  damage?: DamageEntry[];
  /** Allocation order (model ids). */
  order?: string[];
  answer?: Id;
  /** Names of the rules that changed this step. */
  fired: string[];
  /** Rules that apply here but are not automated. */
  reminders: string[];
}

/** A change to the table, applied by the reducer when the step's event lands. */
export type Outcome =
  | { kind: "wounds"; modelId: string; lost: number }
  | { kind: "status"; unitId: string; status: Id; value: boolean }
  | { kind: "resource"; player: string; resource: Id; delta: number }
  /** Every model of the unit is removed (a red box on a damage chart). */
  | { kind: "destroy"; unitId: string }
  | { kind: "reminder"; text: string }
  /** What happened, for the panel and the log (damage chart rolls). */
  | { kind: "note"; text: string }
  /** A code procedure to start when the run is closed (`{ do: "script" }`). */
  | { kind: "script"; procedure: Id; args: Record<string, unknown> };

export interface PendingWindow {
  step: Id;
  side: "attacker" | "defender" | "active" | "opponent";
  options: { id: Id; label: string }[];
}

export interface ProcedureRun {
  system: Id;
  procedure: Id;
  roles: Record<string, RoleRef>;
  /** Rules to use for these roles instead of the ones bound from their keywords. */
  rules?: Record<string, RuleRef[]>;
  /** Only `rules` count: no core, status or keyword effects (the players set every number). */
  explicit?: boolean;
  overrides?: Record<Id, PlanOverride>;
  /** Index of the next step. */
  next: number;
  tokens: Token[];
  records: StepRecord[];
  /** Answers given at window steps. */
  reactions: Record<Id, Id>;
  pending: PendingWindow | null;
  /** Table changes made by the steps run so far, in order. */
  outcomes: Outcome[];
  done: boolean;
}

/** Everything a run reads besides its own JSON. */
export interface RunEnv {
  system: GameSystem;
  state: GameState;
  /** Pack and faction rules on top of the system's. */
  rules?: RuleDef[];
  /** Extra scope roles supplied by a system module, e.g. "sight" facts. */
  facts?: Record<string, unknown>;
  /** Without an rng nothing is rolled (previews). */
  rng?: () => number;
  /** Answer windows with their default instead of waiting (solo play, simulations). */
  autoAnswer?: boolean;
}

export interface StartOptions {
  rules?: ProcedureRun["rules"];
  explicit?: boolean;
  overrides?: ProcedureRun["overrides"];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function findProcedure(system: GameSystem, id: Id): Procedure {
  const p = system.procedures.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown procedure "${id}"`);
  return p;
}

/** Start a run and play it up to the first pause (usually after rolling the pool). */
export function startRun(
  env: RunEnv,
  procedure: Id,
  roles: Record<string, RoleRef>,
  opts: StartOptions = {},
): ProcedureRun {
  findProcedure(env.system, procedure);
  const run: ProcedureRun = {
    system: env.system.id,
    procedure,
    roles,
    ...(opts.rules ? { rules: opts.rules } : {}),
    ...(opts.explicit ? { explicit: true } : {}),
    ...(opts.overrides ? { overrides: opts.overrides } : {}),
    next: 0,
    tokens: [],
    records: [],
    reactions: {},
    pending: null,
    outcomes: [],
    done: false,
  };
  return advance(env, run);
}

/**
 * Play the run forward: run the next step, then any steps that roll nothing
 * (allocation, skipped tests), stopping before the next step that rolls dice,
 * at a window waiting for an answer, or at the end.
 */
export function advance(env: RunEnv, run: ProcedureRun): ProcedureRun {
  if (!env.rng) throw new Error("advance needs an rng");
  if (run.done || run.pending) return run;
  const proc = findProcedure(env.system, run.procedure);
  let cur = run;
  let rolled = false;
  while (!cur.done && !cur.pending) {
    const step = proc.steps[cur.next];
    if (!step) {
      cur = { ...cur, done: true };
      break;
    }
    if (rolled && rollsDice(env, cur, step)) break;
    const next = runStep(env, cur, step);
    if (next.pending) {
      cur = next;
      break;
    }
    const rec = next.records[next.records.length - 1];
    if (rec && (rec.dice?.length || rec.rolls?.length || rec.damage || rollsDice(env, cur, step)))
      rolled = true;
    cur = next;
  }
  if (!cur.pending && cur.next >= proc.steps.length) cur = { ...cur, done: true };
  return cur;
}

/** Answer a window: pick an option id, or "pass". The run then goes on from there. */
export function respond(env: RunEnv, run: ProcedureRun, answer: Id): ProcedureRun {
  if (!run.pending) return run;
  const step = run.pending.step;
  const record: StepRecord = {
    id: step,
    kind: "window",
    plan: { kind: "other" },
    in: run.tokens.length,
    out: run.tokens.length,
    answer,
    fired: [],
    reminders: [],
  };
  const answered: ProcedureRun = {
    ...run,
    pending: null,
    reactions: { ...run.reactions, [step]: answer },
    records: [...run.records, record],
    next: run.next + 1,
  };
  return env.rng ? advance(env, answered) : answered;
}

/** The step a run is waiting on, or null when it is done. */
export function nextStep(system: GameSystem, run: ProcedureRun): Step | null {
  if (run.done) return null;
  return findProcedure(system, run.procedure).steps[run.next] ?? null;
}

export interface Preview {
  plans: Record<Id, StepPlan>;
  fired: Record<Id, string[]>;
  reminders: string[];
  /** Rules bound to each role from its keywords and abilities. */
  rules: Record<string, RuleRef[]>;
}

/** Work out every step's numbers without rolling, for the attack panel and odds. */
export function previewRun(
  env: RunEnv,
  procedure: Id,
  roles: Record<string, RoleRef>,
  opts: StartOptions = {},
): Preview {
  const proc = findProcedure(env.system, procedure);
  const run: ProcedureRun = {
    system: env.system.id,
    procedure,
    roles,
    ...opts,
    next: 0,
    tokens: [],
    records: [],
    reactions: {},
    pending: null,
    outcomes: [],
    done: false,
  };
  const out: Preview = { plans: {}, fired: {}, reminders: [], rules: {} };
  const scope = buildScope(env, run);
  for (const role of Object.keys(roles)) out.rules[role] = rulesFor(run, role, scope[role]);
  const members: Record<Id, unknown[]> = {};
  for (const step of proc.steps) {
    const s = buildScope(env, { ...run, next: proc.steps.indexOf(step) }, members);
    const { plan, fired, reminders, members: m } = planStep(env, run, step, s);
    if (m) members[step.id] = m;
    // A step whose condition fails won't run: nothing to show for it.
    const passedOver = step.if !== undefined && !safe(() => bool(step.if!, ctxFor(env, s)));
    out.plans[step.id] = passedOver ? { kind: "other" } : plan;
    out.fired[step.id] = fired;
    for (const r of reminders) if (!out.reminders.includes(r)) out.reminders.push(r);
  }
  for (const r of collectReminders(env, run, buildScope(env, run, members)))
    if (!out.reminders.includes(r)) out.reminders.push(r);
  return out;
}

// ---------------------------------------------------------------------------
// Scope and effects
// ---------------------------------------------------------------------------

function buildScope(
  env: RunEnv,
  run: ProcedureRun,
  previewMembers?: Record<Id, unknown[]>,
): Record<string, unknown> {
  const { state, system } = env;
  const opts = { rules: env.rules };
  const scope: Record<string, unknown> = {
    const: system.constants ?? {},
    settings: state.settings,
    reaction: run.reactions,
    ...env.facts,
  };
  for (const [role, ref] of Object.entries(run.roles)) {
    if ("player" in ref) {
      scope[role] = { id: ref.player, ...(state.resources[ref.player] ?? {}) };
    } else if ("model" in ref) {
      const m = state.models[ref.model];
      if (m) scope[role] = modelView(state, system, m, opts);
    } else {
      const unit = state.units[ref.unit];
      if (!unit) continue;
      if (ref.weapon) {
        const w = unit.sheet?.weapons[ref.weapon];
        if (w) scope[role] = weaponView(state, system, unit, w, opts);
      } else scope[role] = unitView(state, system, unit, opts);
    }
  }
  // Results of earlier steps.
  const steps: Record<string, unknown> = {};
  for (const r of run.records) {
    steps[r.id] = {
      successes: r.successes ?? r.out,
      criticals: r.criticals ?? 0,
      out: r.out,
      members: membersOf(scope, r),
    };
  }
  for (const [id, members] of Object.entries(previewMembers ?? {}))
    steps[id] = { ...(steps[id] as object), members };
  scope.step = steps;
  // The model hits are being allocated to.
  const proc = findProcedure(system, run.procedure);
  const alloc = proc.steps.slice(0, run.next).filter((s) => s.kind === "allocate");
  const last = alloc[alloc.length - 1];
  if (last && last.kind === "allocate") {
    const order = allocationOrder(env, scope, last, undefined, run.overrides?.[last.id]?.order);
    if (order[0]) scope.model = order[0];
  }
  return scope;
}

function membersOf(scope: Record<string, unknown>, r: StepRecord): unknown[] {
  if (r.plan.kind !== "pool" || !r.plan.members) return [];
  const ids = new Set(r.plan.members);
  const out: unknown[] = [];
  for (const v of Object.values(scope)) {
    const bearers = (v as { bearers?: ModelView[] })?.bearers;
    const models = (v as { models?: ModelView[] })?.models;
    for (const m of [...(bearers ?? []), ...(models ?? [])])
      if (ids.has(m.id) && !out.includes(m)) out.push(m);
  }
  return out;
}

function rulesFor(run: ProcedureRun, role: string, view: unknown): RuleRef[] {
  const given = run.rules?.[role];
  if (given) return given;
  if (run.explicit) return [];
  return ((view as { rules?: RuleRef[] })?.rules ?? []) as RuleRef[];
}

interface Live {
  effect: Effect;
  param: Record<string, unknown>;
  name: string;
  /** The role whose rule this is, if any. */
  owner?: string;
}

function gatherEffects(env: RunEnv, run: ProcedureRun, scope: Record<string, unknown>): Live[] {
  const out: Live[] = [];
  for (const role of Object.keys(run.roles)) {
    for (const b of lookupRules(env.system, rulesFor(run, role, scope[role]), env.rules))
      for (const effect of b.def.effects) out.push({ effect, param: b.param, name: b.def.name, owner: role });
  }
  if (run.explicit) return out;
  for (const effect of env.system.coreEffects ?? [])
    out.push({ effect, param: {}, name: effect.id ?? "core" });
  for (const role of Object.keys(run.roles)) {
    const statuses = (scope[role] as { statuses?: string[] })?.statuses ?? [];
    for (const s of env.system.statuses ?? [])
      if (statuses.includes(s.id))
        for (const effect of s.effects ?? []) out.push({ effect, param: {}, name: s.name, owner: role });
  }
  return out;
}

function ctxFor(
  env: RunEnv,
  scope: Record<string, unknown>,
  param: Record<string, unknown> = {},
): EvalContext {
  const tables = Object.fromEntries((env.system.tables ?? []).map((t) => [t.id, t]));
  return {
    scope: { ...scope, param },
    tables,
    ...(env.rng ? { rng: env.rng } : {}),
    geometry: tableGeometry(env.state, env.system),
    call: callFor(env.state, env.system.id),
  };
}

function firing(env: RunEnv, live: Live[], event: string, payload: object, scope: Record<string, unknown>) {
  return live.filter((l) => {
    const ctx = ctxFor(env, scope, l.param);
    try {
      if (!matchesEvent(l.effect.when, event, payload, ctx)) return false;
      return (
        l.effect.if === undefined ||
        // "ruleOwner" is the role whose rule or status this is, e.g. "target" for Stealth.
        bool(l.effect.if, { ...ctx, scope: { ...ctx.scope, event: payload, ruleOwner: l.owner ?? null } })
      );
    } catch {
      // An expression that can't be answered here (missing data or an
      // unsupported geometry query) means the effect doesn't apply.
      return false;
    }
  });
}

/** Rules whose effects the runner does not automate, for the player to check by hand. */
function collectReminders(env: RunEnv, run: ProcedureRun, scope: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const l of gatherEffects(env, run, scope)) {
    const manual = l.effect.do.some((a) => a.do === "manual");
    const handled = ["step.before", "die.result", "always"].includes(l.effect.when.event);
    if (manual || (!handled && l.owner)) if (!out.includes(l.name)) out.push(l.name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Planning a step
// ---------------------------------------------------------------------------

interface Planned {
  plan: StepPlan;
  fired: string[];
  reminders: string[];
  /** Scope after characteristic changes made before this step. */
  scope: Record<string, unknown>;
  members?: unknown[];
}

function sidesOf(env: RunEnv, die: Id | Expr | undefined, ctx: EvalContext): number {
  const lookup = (id: string) => {
    const d = env.system.dice.find((x) => x.id === id);
    return d?.sides ?? d?.faces?.length ?? (Number(/\d+/.exec(id)?.[0]) || 6);
  };
  if (die === undefined) return lookup(env.system.defaultDie);
  if (typeof die === "string") return lookup(die);
  if (typeof die === "object" && die !== null && "ref" in die) {
    const v = resolve(die.ref, ctx);
    if (typeof v === "string") return lookup(v);
  }
  return num(die, ctx);
}

const REROLL_STRENGTH: Record<Reroll, number> = { none: 0, ones: 1, failed: 2, any: 3 };

function applyBefore(
  env: RunEnv,
  live: Live[],
  step: Step,
  run: ProcedureRun,
  scope: Record<string, unknown>,
) {
  const payload = { procedure: run.procedure, step: step.id };
  let s = scope;
  const acc = {
    modifier: 0,
    targetModifier: 0,
    reroll: "none" as Reroll,
    criticalOn: null as number | null,
    skip: false,
    ignoreDamage: null as number | null,
    fired: [] as string[],
    reminders: [] as string[],
  };
  const fire = (l: Live, action: EffectAction, ctx: EvalContext) => {
    switch (action.do) {
      case "modifyRoll":
        acc.modifier += num(action.by, ctx);
        return true;
      case "modifyTarget":
        acc.targetModifier += num(action.by, ctx);
        return true;
      case "reroll":
        if (typeof action.which === "string" && REROLL_STRENGTH[action.which] > REROLL_STRENGTH[acc.reroll])
          acc.reroll = action.which;
        return true;
      case "criticalOn": {
        const v = num(action.value, ctx);
        acc.criticalOn = acc.criticalOn === null ? v : Math.min(acc.criticalOn, v);
        return true;
      }
      case "skipStep":
        if (action.step === step.id) acc.skip = true;
        return action.step === step.id;
      case "modifyCharacteristic":
      case "setCharacteristic": {
        const role = action.target ?? "self";
        const view = s[role];
        if (!view || typeof view !== "object") return false;
        const patched = { ...(view as object) } as Record<string, unknown>;
        if (action.do === "setCharacteristic") patched[action.characteristic] = num(action.to, ctx);
        else {
          const sum = [
            ...parseDiceSum((view as Record<string, never>)[action.characteristic] ?? 0),
            ...diceTerm(action.by, ctx),
          ];
          const flat = sum.every((t) => t.sides === 0);
          patched[action.characteristic] = flat
            ? sum.reduce((n, t) => n + t.count, 0)
            : formatDice(parseDiceSum(formatDice(sum)));
        }
        const src = (view as { source?: unknown }).source;
        if (src) Object.defineProperty(patched, "source", { value: src, enumerable: false });
        s = { ...s, [role]: patched };
        return true;
      }
      case "ignoreDamage": {
        const v = num(action.atLeast, ctx);
        acc.ignoreDamage = acc.ignoreDamage === null ? v : Math.min(acc.ignoreDamage, v);
        return true;
      }
      case "manual":
        acc.reminders.push(l.name);
        return false;
      default:
        return false;
    }
  };
  for (const l of firing(env, live, "step.before", payload, s)) {
    const ctx = { ...ctxFor(env, s, l.param), scope: { ...ctxFor(env, s, l.param).scope, event: payload } };
    let any = false;
    for (const action of l.effect.do) if (fire(l, action, ctx)) any = true;
    if (any && !acc.fired.includes(l.name)) acc.fired.push(l.name);
  }
  return { ...acc, scope: s };
}

function planStep(env: RunEnv, run: ProcedureRun, step: Step, scope: Record<string, unknown>): Planned {
  const live = gatherEffects(env, run, scope);
  const override = run.overrides?.[step.id] ?? {};
  switch (step.kind) {
    case "pool": {
      if (override.count !== undefined)
        return { plan: { kind: "pool", count: override.count }, fired: [], reminders: [], scope };
      if (!step.each) {
        const b = applyBefore(env, live, step, run, scope);
        const count = safeDice(step.count, ctxFor(env, b.scope));
        return { plan: { kind: "pool", count }, fired: b.fired, reminders: b.reminders, scope: b.scope };
      }
      const as = step.as ?? "it";
      const items = resolve(step.each, ctxFor(env, scope));
      const kept: { id?: string }[] = [];
      const parts: ReturnType<typeof diceTerm>[] = [];
      const fired: string[] = [];
      const reminders: string[] = [];
      for (const item of Array.isArray(items) ? items : []) {
        const s = { ...scope, [as]: item };
        try {
          if (step.where !== undefined && !bool(step.where, ctxFor(env, s))) continue;
        } catch {
          continue;
        }
        kept.push(item as { id?: string });
        const b = applyBefore(env, live, step, run, s);
        parts.push(parseDiceSum(safeDice(step.count, ctxFor(env, b.scope))));
        for (const f of b.fired) if (!fired.includes(f)) fired.push(f);
        for (const r of b.reminders) if (!reminders.includes(r)) reminders.push(r);
      }
      const count = formatDice(parseDiceSum(formatDice(parts.flat())));
      const members = kept.map((k) => k.id ?? "");
      return { plan: { kind: "pool", count, members }, fired, reminders, scope, members: kept };
    }
    case "test": {
      const b = applyBefore(env, live, step, run, scope);
      const ctx = ctxFor(env, { ...b.scope, input: { value: 0 } });
      const sides = sidesOf(env, step.die, ctx);
      let target: number | null;
      try {
        const impossible = step.impossibleIf !== undefined && bool(step.impossibleIf, ctx);
        target = impossible ? null : num(step.target, ctx) + b.targetModifier;
      } catch {
        target = null;
      }
      const cap = step.modifierCap;
      const modifier = cap === undefined ? b.modifier : Math.max(-cap, Math.min(cap, b.modifier));
      let criticalOn: number | null = step.criticalOn === undefined ? null : num(step.criticalOn, ctx);
      if (b.criticalOn !== null)
        criticalOn = criticalOn === null ? b.criticalOn : Math.min(criticalOn, b.criticalOn);
      const plan: TestPlan = {
        kind: "test",
        sides,
        target,
        modifier,
        criticalOn,
        reroll: b.reroll,
        alwaysFail: step.alwaysFail ?? [],
        alwaysPass: step.alwaysPass ?? [],
        skip: b.skip,
        compare: step.compare,
        passOn: step.passOn ?? "successes",
        sumOf: step.sumOf === undefined ? 1 : num(step.sumOf, ctx),
        dicePerInput: step.dicePerInput === undefined ? 1 : Math.max(0, num(step.dicePerInput, ctx)),
        ...(step.keep ? { keep: step.keep } : {}),
      };
      const merged = { ...plan, ...pick(override, Object.keys(plan)) } as TestPlan;
      if (cap !== undefined) merged.modifier = Math.max(-cap, Math.min(cap, merged.modifier));
      return { plan: merged, fired: b.fired, reminders: b.reminders, scope: b.scope };
    }
    case "damage": {
      const b = applyBefore(env, live, step, run, scope);
      const ctx = ctxFor(env, b.scope);
      let ignore = b.ignoreDamage;
      // Continuous damage reduction belongs to the side taking the damage.
      const victimRole = allocUnitRole(env, run);
      for (const l of live) {
        if (l.effect.when.event !== "always" || l.owner !== victimRole) continue;
        for (const a of l.effect.do)
          if (a.do === "ignoreDamage") {
            const v = num(a.atLeast, ctxFor(env, b.scope, l.param));
            ignore = ignore === null ? v : Math.min(ignore, v);
            if (!b.fired.includes(l.name)) b.fired.push(l.name);
          }
      }
      const plan: DamagePlan = {
        kind: "damage",
        amount: override.amount ?? safeDice(step.amount, ctx),
        ignoreDamage: ignore,
        spillover: step.spillover,
      };
      return {
        plan: { ...plan, ...pick(override, ["amount", "ignoreDamage", "spillover"]) } as DamagePlan,
        fired: b.fired,
        reminders: b.reminders,
        scope: b.scope,
      };
    }
    default: {
      const b = applyBefore(env, live, step, run, scope);
      return { plan: { kind: "other" }, fired: b.fired, reminders: b.reminders, scope: b.scope };
    }
  }
}

function safe(f: () => boolean): boolean {
  try {
    return f();
  } catch {
    return false;
  }
}

/** A dice amount from data, or "0" when the data can't answer here (a missing characteristic). */
function safeDice(expr: Expr, ctx: EvalContext): string {
  try {
    return formatDice(diceTerm(expr, ctx));
  } catch {
    return "0";
  }
}

function pick(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => keys.includes(k) && v !== undefined));
}

/** Whether a step will roll dice (and so is worth its own event). */
function rollsDice(env: RunEnv, run: ProcedureRun, step: Step): boolean {
  if (step.if !== undefined) {
    const scope = buildScope(env, run);
    if (!safe(() => bool(step.if!, ctxFor(env, scope)))) return false;
  }
  if (step.kind === "pool" || step.kind === "damage") return true;
  if (step.kind !== "test") return false;
  const plan = planStep(env, run, step, buildScope(env, run)).plan as TestPlan;
  return !plan.skip;
}

// ---------------------------------------------------------------------------
// Running a step
// ---------------------------------------------------------------------------

function runStep(env: RunEnv, run: ProcedureRun, step: Step): ProcedureRun {
  const scope = buildScope(env, run);
  const planned = planStep(env, run, step, scope);
  const base: StepRecord = {
    id: step.id,
    kind: step.kind,
    plan: planned.plan,
    in: run.tokens.length,
    out: run.tokens.length,
    fired: planned.fired,
    reminders: planned.reminders,
  };
  const finish = (record: StepRecord, tokens: Token[], outcomes: Outcome[] = []): ProcedureRun => ({
    ...run,
    tokens,
    records: [...run.records, { ...record, out: tokens.length, tagged: countTags(tokens) }],
    outcomes: [...run.outcomes, ...outcomes],
    next: run.next + 1,
  });
  const rng = env.rng!;
  if (step.if !== undefined && !safe(() => bool(step.if!, ctxFor(env, planned.scope)))) {
    // A step whose condition fails is passed over; its input goes on unchanged.
    return finish({ ...base, plan: { kind: "other" }, bypassed: run.tokens.length }, run.tokens);
  }
  switch (step.kind) {
    case "pool": {
      const plan = planned.plan as PoolPlan;
      const { rolls, total } = rollSum(parseDiceSum(plan.count), rng);
      const tokens = Array.from({ length: Math.max(0, total) }, () => ({ tags: [] }));
      return finish({ ...base, rolls, successes: tokens.length }, tokens);
    }
    case "test":
      return runTest(env, run, step, planned, base, finish);
    case "allocate": {
      const order = allocationOrder(env, scope, step, undefined, run.overrides?.[step.id]?.order).map(
        (m) => m.id,
      );
      return finish({ ...base, order }, run.tokens);
    }
    case "damage":
      return runDamage(env, run, planned, base, finish);
    case "compare": {
      const ctx = ctxFor(env, planned.scope);
      const a = num(step.a, ctx);
      const b = num(step.b, ctx);
      const c = { ...ctx, scope: { ...ctx.scope, compare: { a, b } } };
      const outcomes: Outcome[] = [];
      for (const o of step.outcomes) if (bool(o.when, c)) outcomes.push(...doActions(env, run, o.do, c));
      return finish({ ...base, successes: a - b }, run.tokens, outcomes);
    }
    case "do": {
      const proc = findProcedure(env.system, run.procedure);
      const fed = run.tokens.length > 0 || !proc.steps.slice(0, run.next).some((x) => x.kind === "pool");
      return finish(base, run.tokens, fed ? doActions(env, run, step.do, ctxFor(env, planned.scope)) : []);
    }
    case "window": {
      const answer = run.reactions[step.id] ?? (env.autoAnswer ? step.default : undefined);
      if (answer !== undefined)
        return {
          ...finish({ ...base, answer }, run.tokens),
          reactions: { ...run.reactions, [step.id]: answer },
        };
      return {
        ...run,
        pending: { step: step.id, side: step.side, options: step.options ?? [] },
      };
    }
  }
}

function countTags(tokens: Token[]): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const t of tokens) for (const tag of t.tags) out[tag] = (out[tag] ?? 0) + 1;
  return Object.keys(out).length ? out : undefined;
}

function runTest(
  env: RunEnv,
  run: ProcedureRun,
  step: Extract<Step, { kind: "test" }>,
  planned: Planned,
  base: StepRecord,
  finish: (r: StepRecord, t: Token[]) => ProcedureRun,
): ProcedureRun {
  const plan = planned.plan as TestPlan;
  const rng = env.rng!;
  const bypassTag = `bypass:${step.id}`;
  const strip = (t: Token): Token => ({ ...t, tags: t.tags.filter((x) => x !== bypassTag) });
  if (plan.skip)
    return finish(
      { ...base, bypassed: run.tokens.length, successes: run.tokens.length },
      run.tokens.map(strip),
    );

  const live = gatherEffects(env, run, planned.scope).filter((l) => l.effect.when.event === "die.result");
  const perInput = JSON.stringify(step.target).includes('"input.');
  const roll = (): { value: number; dice?: number[] } => {
    const one = () => 1 + Math.floor(rng() * plan.sides);
    if (plan.sumOf > 1) {
      const dice = Array.from({ length: plan.sumOf }, one);
      return { value: dice.reduce((a, b) => a + b, 0), dice };
    }
    if (plan.dicePerInput !== 1) {
      const dice = Array.from({ length: plan.dicePerInput }, one);
      if (!dice.length) return { value: 0, dice };
      return { value: plan.keep === "lowest" ? Math.min(...dice) : Math.max(...dice), dice };
    }
    return { value: one() };
  };
  const judge = (natural: number, target: number | null) => {
    const critical = plan.criticalOn !== null && natural >= plan.criticalOn && natural > 0;
    if (target === null || natural === 0) return { success: false, critical: false };
    if (plan.alwaysFail.includes(natural)) return { success: false, critical: false };
    if (critical || plan.alwaysPass.includes(natural)) return { success: true, critical };
    const value = natural + plan.modifier;
    const max = plan.sides * plan.sumOf;
    const need = step.overflow && plan.compare === "atLeast" ? Math.min(target, max) : target;
    return { success: plan.compare === "atLeast" ? value >= need : value <= need, critical };
  };

  const dice: RolledDie[] = [];
  const out: Token[] = [];
  let bypassed = 0;
  let extra = 0;
  let successes = 0;
  let criticals = 0;
  for (const token of run.tokens) {
    if (token.tags.includes(bypassTag)) {
      bypassed++;
      out.push(strip(token));
      continue;
    }
    let target = plan.target;
    if (perInput && target !== null) {
      const ctx = ctxFor(env, { ...planned.scope, input: { value: token.value ?? 0 } });
      target = num(step.target, ctx) + (plan.target === null ? 0 : 0);
    }
    let r = roll();
    let j = judge(r.value, target);
    let rerolledFrom: number | undefined;
    const again =
      (plan.reroll === "ones" && r.value === 1) ||
      ((plan.reroll === "failed" || plan.reroll === "any") && !j.success);
    if (again) {
      rerolledFrom = r.value;
      r = roll();
      j = judge(r.value, target);
    }
    let followUp: number | undefined;
    if (j.success && step.overflow && target !== null && target > plan.sides * plan.sumOf) {
      const ctx = ctxFor(env, { ...planned.scope, test: { target } });
      const need = num(step.overflow.followUp, ctx);
      followUp = 1 + Math.floor(rng() * plan.sides);
      j = { ...j, success: followUp !== 1 && followUp >= need };
    }
    const die: RolledDie = {
      value: r.value,
      success: j.success,
      critical: j.critical,
      ...(rerolledFrom !== undefined ? { rerolledFrom } : {}),
      ...(r.dice ? { dice: r.dice } : {}),
      ...(followUp !== undefined ? { followUp } : {}),
    };
    dice.push(die);
    if (j.success) successes++;
    if (j.critical) criticals++;

    // Per-die effects: extra successes and bypass tags.
    const tags = [...token.tags];
    const payload = {
      procedure: run.procedure,
      step: step.id,
      value: r.value,
      natural: r.value,
      critical: j.critical,
      success: j.success,
    };
    const added: Token[] = [];
    for (const l of firing(env, live, "die.result", payload, planned.scope)) {
      const ctx = { ...ctxFor(env, planned.scope, l.param) };
      for (const a of l.effect.do) {
        if (a.do === "addSuccesses") {
          const n = rollSum(diceTerm(a.count, ctx), rng).total;
          for (let i = 0; i < n; i++) added.push({ tags: [], value: r.value });
        } else if (a.do === "autoPass" || a.do === "skipStep") tags.push(`bypass:${a.step}`);
      }
      if (!base.fired.includes(l.name)) base.fired.push(l.name);
    }
    extra += added.length;
    const self: Token = { tags, value: r.value };
    if (plan.passOn === "successes") {
      if (j.success) out.push(self, ...added);
    } else if (plan.passOn === "failures") {
      if (!j.success) out.push(self);
    } else {
      out.push(token);
      if (!j.success) out.push(self);
    }
  }
  return finish({ ...base, dice, successes, criticals, extra, bypassed }, out);
}

function allocUnitRole(env: RunEnv, run: ProcedureRun): string {
  const proc = findProcedure(env.system, run.procedure);
  const a = proc.steps.find((s) => s.kind === "allocate");
  return a && a.kind === "allocate" && a.unit ? a.unit : "target";
}

/** Models of the allocation unit in the order hits go to them. */
function allocationOrder(
  env: RunEnv,
  scope: Record<string, unknown>,
  step: Extract<Step, { kind: "allocate" }>,
  woundsLost?: Map<string, number>,
  chosen?: string[],
): ModelView[] {
  const unit = scope[step.unit ?? "target"] as UnitView | undefined;
  if (!unit?.models) return [];
  const models = unit.models
    .map((m) => (woundsLost?.has(m.id) ? { ...m, woundsLost: woundsLost.get(m.id)! } : m))
    .filter((m) => !m.destroyed && (Number(m.W ?? 1) || 1) - m.woundsLost > 0);
  if (step.formation === "rearRankFirst" && !chosen?.length) return rearRankFirst(env, unit, models);
  if (chosen?.length) {
    // The chooser's declared order wins; models it left out keep their place after.
    const rank = (m: ModelView) => {
      const i = chosen.indexOf(m.id);
      return i < 0 ? chosen.length : i;
    };
    return models
      .map((m, i) => ({ m, i }))
      .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
      .map((x) => x.m);
  }
  if (step.order === undefined) return models;
  const key = (m: ModelView) => {
    try {
      return num(step.order!, ctxFor(env, { ...scope, model: m }));
    } catch {
      return 0;
    }
  };
  return models
    .map((m, i) => ({ m, i, k: key(m) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.m);
}

/**
 * Casualties come off the back of a block so the front rank stays full:
 * rank and file from the rear forwards, then the command models and
 * characters (any model whose profile isn't the unit's commonest one). A
 * model that has already lost wounds takes the next one.
 */
function rearRankFirst(env: RunEnv, unit: UnitView, models: ModelView[]): ModelView[] {
  const source = env.state.units[unit.id];
  const slots = source ? blockSlots(env.state, source) : models.map((m) => m.id);
  const profile = (m: ModelView) => env.state.models[m.id]?.profile?.name ?? "";
  const counts = new Map<string, number>();
  for (const m of models) counts.set(profile(m), (counts.get(profile(m)) ?? 0) + 1);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const rank = (m: ModelView) =>
    (m.woundsLost > 0 ? 0 : 2) + (profile(m) === common ? 0 : 4) - slots.indexOf(m.id) / (slots.length + 1);
  return [...models].sort((a, b) => rank(a) - rank(b));
}

function runDamage(
  env: RunEnv,
  run: ProcedureRun,
  planned: Planned,
  base: StepRecord,
  finish: (r: StepRecord, t: Token[], o?: Outcome[]) => ProcedureRun,
): ProcedureRun {
  const plan = planned.plan as DamagePlan;
  const rng = env.rng!;
  const proc = findProcedure(env.system, run.procedure);
  const alloc = proc.steps
    .slice(0, run.next)
    .filter((s): s is Extract<Step, { kind: "allocate" }> => s.kind === "allocate")
    .pop() ?? { kind: "allocate" as const, id: "allocate", chooser: "defender" as const };
  const lost = new Map<string, number>();
  const sides = sidesOf(env, undefined, ctxFor(env, planned.scope));
  const amount = parseDiceSum(plan.amount);
  const entries: DamageEntry[] = [];
  outer: for (let i = 0; i < run.tokens.length; i++) {
    let damage = Math.max(0, rollSum(amount, rng).total);
    // With spillover, damage beyond a slain model's wounds goes on to the next.
    for (;;) {
      const victim = allocationOrder(env, planned.scope, alloc, lost, run.overrides?.[alloc.id]?.order)[0];
      if (!victim) break outer;
      const max = Number(victim.W ?? 1) || 1;
      const already = lost.get(victim.id) ?? victim.woundsLost;
      const remaining = max - already;
      const wouldLose = Math.min(damage, remaining);
      const ignore =
        plan.ignoreDamage === null
          ? []
          : Array.from({ length: wouldLose }, () => 1 + Math.floor(rng() * sides));
      const taken = wouldLose - ignore.filter((v) => v >= plan.ignoreDamage!).length;
      lost.set(victim.id, already + taken);
      const destroyed = remaining - taken <= 0;
      entries.push({ modelId: victim.id, damage, ignore, lost: taken, destroyed });
      if (!plan.spillover || !destroyed || damage <= wouldLose) break;
      damage -= wouldLose;
    }
  }
  const outcomes: Outcome[] = entries
    .filter((e) => e.lost > 0)
    .map((e) => ({ kind: "wounds", modelId: e.modelId, lost: e.lost }));
  return finish({ ...base, damage: entries }, [], outcomes);
}

function doActions(env: RunEnv, run: ProcedureRun, actions: EffectAction[], ctx: EvalContext): Outcome[] {
  const out: Outcome[] = [];
  const unitOf = (ref: string | undefined) => {
    const v = (ref ? resolve(ref, ctx) : undefined) as
      { kind?: string; id?: string; unitId?: string } | undefined;
    return v?.kind === "unit" ? v.id : v?.unitId;
  };
  const playerOf = (who: "owner" | "opponent" | undefined) => {
    const roles = Object.values(run.roles);
    const first = roles.find((r) => "unit" in r) as { unit: string } | undefined;
    const owner = first ? env.state.units[first.unit]?.owner : undefined;
    if (who !== "opponent") return owner;
    return Object.keys(env.state.players).find((p) => p !== owner);
  };
  for (const a of actions) {
    switch (a.do) {
      case "applyStatus":
      case "removeStatus": {
        const unitId = unitOf(a.target);
        if (unitId) out.push({ kind: "status", unitId, status: a.status, value: a.do === "applyStatus" });
        break;
      }
      case "gainResource":
      case "spendResource": {
        const player = playerOf(a.player);
        const n = num(a.amount, ctx);
        if (player)
          out.push({
            kind: "resource",
            player,
            resource: a.resource,
            delta: a.do === "gainResource" ? n : -n,
          });
        break;
      }
      case "roll": {
        if (!env.rng) break;
        const v = rollSum(parseDiceSum(a.dice), env.rng).total;
        for (const o of a.outcomes) if (v >= o.min && v <= o.max) out.push(...doActions(env, run, o.do, ctx));
        break;
      }
      case "manual":
        out.push({ kind: "reminder", text: a.reminder });
        break;
      case "script": {
        const args: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(a.args ?? {})) {
          if (typeof v === "object" && "ref" in v) {
            const named = resolve(v.ref, ctx) as { id?: string } | string | number | boolean | undefined;
            args[k] = typeof named === "object" ? named?.id : named;
          } else args[k] = evaluate(v, ctx);
        }
        out.push({ kind: "script", procedure: a.procedure, args });
        break;
      }
      case "damageTrack":
        if (env.rng) out.push(...damageTrack(run, a, ctx, env.rng));
        break;
      default:
        out.push({ kind: "reminder", text: a.do });
    }
  }
  return out;
}

/** One box of a damage track: the faces that hit it, its colour and effect. */
export interface TrackBox {
  min: number;
  max: number;
  colour: "red" | "orange" | "white";
  effect?: string;
}

/** Read "1:red, 2-3:orange:ARM, 4:white:MOV" into boxes. */
export function parseTrack(text: string): TrackBox[] {
  const out: TrackBox[] = [];
  for (const part of text.split(/[,;\s]+/)) {
    const m = /^(\d+)(?:-(\d+))?:(red|orange|white)(?::(\w+))?$/i.exec(part.trim());
    if (!m) continue;
    out.push({
      min: Number(m[1]),
      max: Number(m[2] ?? m[1]),
      colour: m[3]!.toLowerCase() as TrackBox["colour"],
      ...(m[4] ? { effect: m[4].toUpperCase() } : {}),
    });
  }
  return out;
}

function damageTrack(
  run: ProcedureRun,
  a: Extract<EffectAction, { do: "damageTrack" }>,
  ctx: EvalContext,
  rng: () => number,
): Outcome[] {
  const view = resolve(a.target, ctx) as { kind?: string; id?: string; flags?: string[] } | undefined;
  const text = resolve(a.chart, ctx);
  if (view?.kind !== "unit" || !view.id || typeof text !== "string") return [];
  const boxes = parseTrack(text);
  const hit = new Set((view.flags ?? []).filter((f) => f.startsWith("box")));
  const out: Outcome[] = [];
  const die = a.die ?? 6;
  for (let i = 0; i < run.tokens.length; i++) {
    const roll = 1 + Math.floor(rng() * die);
    const idx = boxes.findIndex((b) => roll >= b.min && roll <= b.max);
    const box = boxes[idx];
    if (a.status) out.push({ kind: "status", unitId: view.id, status: a.status, value: true });
    if (!box) {
      out.push({ kind: "note", text: `Damage roll ${roll}: no box` });
      continue;
    }
    const again = hit.has(`box${idx}`);
    const label = `${box.colour}${box.effect ? ` ${box.effect}` : ""}`;
    if (box.colour === "red" || (box.colour === "orange" && again)) {
      out.push({ kind: "note", text: `Damage roll ${roll}: ${label}${again ? " again" : ""}, destroyed` });
      out.push({ kind: "destroy", unitId: view.id });
      break;
    }
    hit.add(`box${idx}`);
    out.push({ kind: "status", unitId: view.id, status: `box${idx}`, value: true });
    if (box.effect && box.effect !== "PIN")
      out.push({ kind: "status", unitId: view.id, status: `damage${box.effect}`, value: true });
    out.push({ kind: "note", text: `Damage roll ${roll}: ${label}` });
  }
  return out;
}

/** Apply a run's table changes to the state: wounds, statuses and resources. */
export function applyOutcomes(
  state: GameState,
  outcomes: Outcome[],
  maxWounds: (modelId: string) => number,
): GameState {
  let models = state.models;
  let units = state.units;
  let resources = state.resources;
  for (const o of outcomes) {
    if (o.kind === "wounds") {
      const m = models[o.modelId];
      if (!m) continue;
      const woundsLost = (m.woundsLost ?? 0) + o.lost;
      models = {
        ...models,
        [m.id]: { ...m, woundsLost, destroyed: m.destroyed || woundsLost >= maxWounds(m.id) },
      };
    } else if (o.kind === "status") {
      const u = units[o.unitId];
      if (!u) continue;
      units = { ...units, [u.id]: { ...u, status: { ...u.status, [o.status]: o.value } } };
    } else if (o.kind === "destroy") {
      const u = units[o.unitId];
      for (const id of u?.modelIds ?? []) {
        const m = models[id];
        if (m && !m.destroyed) models = { ...models, [id]: { ...m, destroyed: true } };
      }
    } else if (o.kind === "resource") {
      const own = resources[o.player] ?? {};
      resources = { ...resources, [o.player]: { ...own, [o.resource]: (own[o.resource] ?? 0) + o.delta } };
    }
  }
  return { ...state, models, units, resources };
}
