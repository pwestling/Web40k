import type { Step } from "./content/schema";
import { parseDiceSum, type DiceSum } from "./content/runtime";
import type { StepPlan, StepRecord, TestPlan } from "./content/runner";
import { evaluate } from "./content/expr";
import type { GameState, UnitId } from "./types";

/**
 * Exact odds for a procedure, from the numbers a preview works out for each
 * step (no simulation): how many dice survive each step on average, how many
 * models die, and the chance the target is wiped out. Per-die rules that add
 * successes or skip steps (sustained hits, lethal hits) aren't counted; the
 * plan's modifiers, re-rolls, always-pass and always-fail faces are.
 */

/** A probability for each value: dist[n] = P(value = n). */
export type Dist = number[];

/** Most dice tracked through a procedure; beyond this the tail is folded in. */
const MAX_TOKENS = 400;

export function point(n: number): Dist {
  const d = new Array<number>(Math.max(0, n) + 1).fill(0);
  d[Math.max(0, n)] = 1;
  return d;
}

export function mean(d: Dist): number {
  return d.reduce((s, p, n) => s + p * n, 0);
}

function convolve(a: Dist, b: Dist): Dist {
  const out = new Array<number>(Math.min(a.length + b.length - 1, MAX_TOKENS + 1)).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length; j++) {
      const k = Math.min(i + j, MAX_TOKENS);
      out[k]! += a[i]! * b[j]!;
    }
  }
  return out;
}

/** Distribution of a dice sum such as "2D6+1" (negative totals count as 0). */
export function sumDist(sum: DiceSum): Dist {
  let offset = 0;
  let d: Dist = [1];
  for (const t of sum) {
    if (!t.sides) {
      offset += t.count;
      continue;
    }
    // A subtracted die -v is (s - v) - s: a 0..s-1 die and an offset.
    const die =
      t.count > 0
        ? [0, ...new Array<number>(t.sides).fill(1 / t.sides)]
        : new Array<number>(t.sides).fill(1 / t.sides);
    for (let i = 0; i < Math.abs(t.count); i++) {
      d = convolve(d, die);
      if (t.count < 0) offset -= t.sides;
    }
  }
  const out: Dist = [];
  d.forEach((p, n) => {
    const v = Math.max(0, n + offset);
    out[v] = (out[v] ?? 0) + p;
  });
  for (let i = 0; i < out.length; i++) out[i] ??= 0;
  return out;
}

/** n dice each passing with chance p, for every n in `count`. */
export function thin(count: Dist, p: number): Dist {
  const out = new Array<number>(count.length).fill(0);
  count.forEach((pn, n) => {
    if (!pn) return;
    // Binomial(n, p) by recurrence.
    let row = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array<number>(row.length + 1).fill(0);
      row.forEach((q, k) => {
        next[k]! += q * (1 - p);
        next[k + 1]! += q * p;
      });
      row = next;
    }
    row.forEach((q, k) => (out[k]! += pn * q));
  });
  return out;
}

/** The distribution of one die-roll result for a test: a single die, a sum, or the best/worst of several. */
function rollDist(plan: TestPlan): Dist {
  const s = plan.sides;
  if (plan.sumOf > 1) return sumDist([{ count: plan.sumOf, sides: s }]);
  const k = plan.dicePerInput;
  if (k === 1) return [0, ...new Array<number>(s).fill(1 / s)];
  if (k <= 0) return [1];
  const out: Dist = [0];
  for (let v = 1; v <= s; v++) {
    // P(max = v) = (v/s)^k - ((v-1)/s)^k; the lowest mirrors it.
    const hi = (v / s) ** k - ((v - 1) / s) ** k;
    const lo = ((s - v + 1) / s) ** k - ((s - v) / s) ** k;
    out[v] = plan.keep === "lowest" ? lo : hi;
  }
  return out;
}

/**
 * The chance one input passes a test, as the runner judges it: critical and
 * always-pass faces, always-fail faces, the modifier, then one re-roll.
 * `followUp` is the roll needed on a second die when the target is above
 * the die's maximum (The Old World's 7+). Null when the target depends on
 * each input (opposed rolls).
 */
export function passChance(plan: TestPlan, followUp?: number): number | null {
  if (plan.skip) return 1;
  if (plan.target === 0) return null;
  const dist = rollDist(plan);
  const max = plan.sides * plan.sumOf;
  const overflow =
    followUp !== undefined && plan.compare === "atLeast" && plan.target !== null && plan.target > max;
  const need = overflow ? max : plan.target;
  const judge = (natural: number): boolean => {
    if (need === null || natural === 0) return false;
    const critical = plan.criticalOn !== null && natural >= plan.criticalOn;
    if (plan.alwaysFail.includes(natural)) return false;
    if (critical || plan.alwaysPass.includes(natural)) return true;
    const value = natural + plan.modifier;
    return plan.compare === "atLeast" ? value >= need : value <= need;
  };
  let first = 0;
  let again = 0;
  dist.forEach((p, v) => {
    const ok = judge(v);
    if (ok) first += p;
    const reroll =
      (plan.reroll === "ones" && v === 1) || ((plan.reroll === "failed" || plan.reroll === "any") && !ok);
    if (reroll) again += p;
  });
  // A re-rolled die passes with the same chance as a fresh one; "ones" may re-roll a pass.
  const rerolledPasses = plan.reroll === "ones" ? (dist[1] ?? 0) * (judge(1) ? 1 : 0) : 0;
  const passed = first - rerolledPasses + again * first;
  if (!overflow) return passed;
  // The follow-up die fails on a 1 whatever it needs.
  const faces = Math.max(0, plan.sides - Math.max(2, followUp!) + 1);
  return passed * (faces / plan.sides);
}

/** The follow-up roll a step needs for a target above the die's maximum, if it has one. */
export function followUpNeed(step: Step | undefined, plan: StepPlan | undefined): number | undefined {
  if (!step || step.kind !== "test" || !step.overflow || plan?.kind !== "test" || plan.target === null)
    return undefined;
  try {
    const v = evaluate(step.overflow.followUp, { scope: { test: { target: plan.target } } });
    return typeof v === "number" ? v : undefined;
  } catch {
    return undefined;
  }
}

export interface StepOdds {
  id: string;
  kind: Step["kind"];
  /** Average number of dice (hits, wounds, unsaved wounds) coming out of the step. */
  expected: number;
}

export interface Odds {
  steps: StepOdds[];
  /** Average models slain, when the procedure deals damage. */
  slain?: number;
  /** Average wounds the target loses (capped by the wounds it has left). */
  damage?: number;
  /** Wounds the target has left before the attack, and its standing models. */
  woundsLeft?: number;
  models?: number;
  /** Chance every model of the target dies. */
  wipe?: number;
  /** False when a step couldn't be worked out (an opposed roll); later numbers are then missing. */
  complete: boolean;
}

/** A target model: wounds it has left. Models take damage in this order. */
export interface OddsModel {
  wounds: number;
}

/** The target's standing models with the wounds each has left, a wounded one first (it takes the next hit). */
export function targetModels(game: GameState, unitId: UnitId | undefined): OddsModel[] {
  const unit = unitId ? game.units[unitId] : undefined;
  if (!unit) return [];
  const models = unit.modelIds
    .map((id) => game.models[id])
    .filter((m) => m && !m.destroyed)
    .map((m) => {
      const w = Number(m!.profile?.chars.W ?? 1) || 1;
      return { wounds: Math.max(1, w - (m!.woundsLost ?? 0)), hurt: (m!.woundsLost ?? 0) > 0 };
    });
  return [...models.filter((m) => m.hurt), ...models.filter((m) => !m.hurt)].map(({ wounds }) => ({
    wounds,
  }));
}

/**
 * Odds for a whole procedure from its step definitions and a preview's plans.
 * `models` are the target's standing models in the order damage goes to them;
 * `ignoreSides` is the die rolled to ignore wounds (feel no pain).
 */
export function procedureOdds(
  steps: Step[],
  plans: Record<string, StepPlan | undefined>,
  models: OddsModel[] = [],
  ignoreSides = 6,
): Odds {
  let count: Dist = point(0);
  const out: Odds = { steps: [], complete: true };
  for (const step of steps) {
    const plan = plans[step.id];
    if (!plan) continue;
    if (plan.kind === "pool") {
      try {
        count = sumDist(parseDiceSum(plan.count));
      } catch {
        out.complete = false;
        return out;
      }
    } else if (plan.kind === "test") {
      const p = passChance(plan, followUpNeed(step, plan));
      if (p === null) {
        out.complete = false;
        return out;
      }
      if (plan.passOn === "successes") count = thin(count, p);
      else if (plan.passOn === "failures") count = thin(count, 1 - p);
      else {
        // Every input goes on, plus one more for each failure.
        const both = new Array<number>(count.length * 2).fill(0);
        count.forEach((pn, n) => {
          if (!pn) return;
          const f = thin(point(n), 1 - p);
          f.forEach((q, k) => (both[Math.min(n + k, MAX_TOKENS)]! += pn * q));
        });
        count = both;
      }
    } else if (plan.kind === "damage") {
      out.steps.push({ id: step.id, kind: step.kind, expected: mean(count) });
      const result = slainDist(count, plan.amount, plan.ignoreDamage, plan.spillover, models, ignoreSides);
      if (result) {
        out.slain = mean(result.slain);
        out.wipe = models.length ? (result.slain[models.length] ?? 0) : 0;
        out.damage = result.damage;
        out.woundsLeft = models.reduce((a, m) => a + m.wounds, 0);
        out.models = models.length;
      }
      count = point(0);
      continue;
    } else continue;
    out.steps.push({ id: step.id, kind: step.kind, expected: mean(count) });
  }
  return out;
}

/**
 * Models slain by `count` damaging dice, each dealing `amount` (a dice sum),
 * allocated in order (a wounded model takes the next one), with an optional
 * roll to ignore each wound and optional spillover to the next model.
 */
function slainDist(
  count: Dist,
  amount: string,
  ignoreOn: number | null,
  spillover: boolean,
  models: OddsModel[],
  ignoreSides: number,
): { slain: Dist; damage: number } | null {
  if (!models.length) return null;
  let dmg: Dist;
  try {
    dmg = sumDist(parseDiceSum(amount));
  } catch {
    return null;
  }
  const keep = ignoreOn === null ? 1 : Math.max(0, Math.min(1, (ignoreOn - 1) / ignoreSides));
  const n = models.length;
  // State: index of the model taking damage and wounds it has lost so far.
  const key = (i: number, lost: number) => i * 1000 + lost;
  let states = new Map<number, number>([[key(0, 0), 1]]);
  const slain: Dist = new Array<number>(n + 1).fill(0);
  // Wounds lost by the models before index i, for the expected damage.
  const before = models.reduce<number[]>((acc, m) => [...acc, acc.at(-1)! + m.wounds], [0]);
  let damage = 0;
  const hit = (i: number, lost: number, d: number, p: number, into: Map<number, number>) => {
    if (i >= n) {
      into.set(key(n, 0), (into.get(key(n, 0)) ?? 0) + p);
      return;
    }
    const left = models[i]!.wounds - lost;
    const would = Math.min(d, left);
    // Each wound is kept unless ignored.
    thin(point(would), keep).forEach((q, taken) => {
      if (!q) return;
      if (taken >= left) {
        if (spillover && d > would) hit(i + 1, 0, d - would, p * q, into);
        else into.set(key(i + 1, 0), (into.get(key(i + 1, 0)) ?? 0) + p * q);
      } else into.set(key(i, lost + taken), (into.get(key(i, lost + taken)) ?? 0) + p * q);
    });
  };
  for (let t = 0; t < count.length; t++) {
    // Those who stop after t dice.
    const stop = count[t] ?? 0;
    if (stop)
      for (const [k, p] of states) {
        const i = Math.min(n, Math.floor(k / 1000));
        slain[i]! += stop * p;
        damage += stop * p * (before[i]! + (i < n ? k % 1000 : 0));
      }
    const tail = count.slice(t + 1).reduce((a, b) => a + b, 0);
    if (tail < 1e-12) break;
    const next = new Map<number, number>();
    for (const [k, p] of states) {
      const i = Math.floor(k / 1000);
      const lost = k % 1000;
      dmg.forEach((q, d) => {
        if (q) hit(i, lost, d, p * q, next);
      });
    }
    states = next;
  }
  return { slain, damage };
}

/**
 * Luck at one rolled step: how many dice passed against how many were
 * expected to, from the step's own plan. Null for steps without dice or
 * whose odds can't be worked out.
 */
export function recordLuck(
  record: StepRecord,
  step?: Step,
): { rolled: number; actual: number; expected: number } | null {
  if (record.plan.kind !== "test" || !record.dice?.length) return null;
  const p = passChance(record.plan, followUpNeed(step, record.plan));
  if (p === null) return null;
  const rolled = record.dice.length;
  const actual = record.dice.filter((d) => d.success).length;
  return { rolled, actual, expected: rolled * p };
}
