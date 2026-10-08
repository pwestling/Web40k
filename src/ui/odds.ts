import { findProcedure, previewRun, procedureEnv, type RoleRef, type StartOptions } from "../core/content";
import { procedureOdds, targetModels, type Odds } from "../core/odds";
import type { RunSwing } from "../core/stats";

import { ATTACK_PROCEDURE, specToRun } from "../core/attack";
import type { AttackSpec, GameState, UnitId } from "../core";

/** The unit a procedure's damage goes to: its "target" role, else the first unit role that isn't a weapon. */
function targetOf(roles: Record<string, RoleRef>): UnitId | undefined {
  const t = roles.target;
  if (t && "unit" in t) return t.unit;
  return undefined;
}

/** Odds for a procedure before it is rolled, from the same preview the panel shows. */
function previewOdds(
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

/** A 40k attack's odds from its spec, with every edit the player made. */
export function specOdds(game: GameState, s: AttackSpec): Odds | null {
  const roles: Record<string, RoleRef> = {
    attacker: { unit: s.attackerUnitId },
    weapon: { unit: s.attackerUnitId, weapon: s.weaponId },
    target: { unit: s.targetUnitId },
  };
  return previewOdds(game, ATTACK_PROCEDURE, roles, specToRun(s));
}

/** What a run came to against its odds: "0 slain where 1.7 were expected". */
export function swingResult(r: RunSwing): string {
  const verb = r.measure !== "damage" && r.expected >= 1.05 ? "were" : "was";
  return `${r.actual} ${r.measure} where ${r.expected.toFixed(1)} ${verb} expected`;
}
