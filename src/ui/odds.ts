import { findProcedure, previewRun, procedureEnv, type RoleRef, type StartOptions } from "../core/content";
import { procedureOdds, targetModels, type Odds } from "../core/odds";
import type { RunSwing } from "../core/stats";

export { targetModels };
import { ATTACK_PROCEDURE, specToRun } from "../core/attack";
import { systemOf, type AttackSpec, type GameState, type UnitId } from "../core";

/** The unit a procedure's damage goes to: its "target" role, else the first unit role that isn't a weapon. */
function targetOf(roles: Record<string, RoleRef>): UnitId | undefined {
  const t = roles.target;
  if (t && "unit" in t) return t.unit;
  return undefined;
}

/** Odds for a procedure before it is rolled, from the same preview the panel shows. */
export function previewOdds(
  game: GameState,
  procedure: string,
  roles: Record<string, RoleRef>,
  opts: StartOptions = {},
): Odds | null {
  try {
    const env = procedureEnv(game);
    const preview = previewRun(env, procedure, roles, opts);
    const steps = findProcedure(env.system, procedure).steps;
    const die = env.system.dice.find((d) => d.id === env.system.defaultDie);
    return procedureOdds(steps, preview.plans, targetModels(game, targetOf(roles)), die?.sides ?? 6);
  } catch {
    return null;
  }
}

/** "expects 2.4 slain, 18% to wipe", or the last step's average when nothing is slain by damage. */
export function oddsLine(odds: Odds | null): string | null {
  if (!odds || !odds.steps.length) return null;
  if (odds.slain !== undefined) {
    const wipe = odds.wipe ?? 0;
    const pct = wipe > 0 && wipe < 0.005 ? "<1%" : `${Math.round(wipe * 100)}%`;
    const left = odds.woundsLeft ?? 0;
    const damage = (odds.damage ?? 0).toFixed(1);
    // One model: what it loses counts, not whether it dies.
    if (odds.models === 1) return `expects ${damage} damage (of ${left} W left), ${pct} to destroy`;
    const big = left > (odds.models ?? 0);
    return `expects ${odds.slain.toFixed(1)} slain${big ? ` (${damage} damage)` : ""}, ${pct} to wipe`;
  }
  const last = odds.steps.at(-1)!;
  return `expects ${last.expected.toFixed(1)} ${last.id}`;
}

/** A 40k attack's odds from its spec, with every edit the player made. */
export function specOdds(game: GameState, s: AttackSpec): Odds | null {
  const roles: Record<string, RoleRef> = {
    attacker: { unit: s.attackerUnitId },
    weapon: { unit: s.attackerUnitId, weapon: s.weaponId },
    target: { unit: s.targetUnitId },
  };
  return previewOdds(game, ATTACK_PROCEDURE, roles, specToRun(s));
}

/** The roll in progress (a 40k attack or any system's procedure) and its odds from the start, for the caption. */
export function liveOdds(game: GameState): { odds: Odds | null; title: string } | null {
  const attack = game.attack;
  if (attack && attack.stage !== "done") {
    const s = attack.spec;
    return {
      odds: specOdds(game, s),
      title: `${game.units[s.attackerUnitId]?.name ?? "Attacker"} at ${game.units[s.targetUnitId]?.name ?? "target"}`,
    };
  }
  const proc = game.procedure;
  if (proc && !proc.run.done && systemOf(game)) {
    const { run } = proc;
    const opts: StartOptions = {
      ...(run.rules ? { rules: run.rules } : {}),
      ...(run.explicit ? { explicit: run.explicit } : {}),
      ...(run.overrides ? { overrides: run.overrides } : {}),
    };
    return { odds: previewOdds(game, run.procedure, run.roles, opts), title: proc.title };
  }
  return null;
}

/** What a run came to against its odds: "0 slain where 1.7 were expected". */
export function swingResult(r: RunSwing): string {
  const verb = r.measure !== "damage" && r.expected >= 1.05 ? "were" : "was";
  return `${r.actual} ${r.measure} where ${r.expected.toFixed(1)} ${verb} expected`;
}
