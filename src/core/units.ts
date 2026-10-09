import { modelHeight } from "./terrain";
import type { GameState, Model, Unit } from "./types";

/**
 * Small questions about a unit that every system and screen asks: which of
 * its models are still on the table, and where it is. One place, so a
 * "destroyed" or a "reserves" rule means the same everywhere (#48).
 */

/** A unit's models that aren't destroyed. */
export function aliveModels(state: GameState, unit: Unit | undefined): Model[] {
  if (!unit) return [];
  return unit.modelIds.flatMap((id) => {
    const m = state.models[id];
    return m && !m.destroyed ? [m] : [];
  });
}

/** Whether any of a unit's models are left. */
export function isAlive(state: GameState, unit: Unit | undefined): boolean {
  return !!unit && unit.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed);
}

/** The middle of some models, at the height of the tallest's top: where a label or a camera looks. */
export function centreAbove(models: Model[]): { x: number; y: number; z: number } {
  const n = Math.max(1, models.length);
  return {
    x: models.reduce((a, m) => a + m.position.x, 0) / n,
    y: models.reduce((a, m) => a + m.position.y, 0) / n,
    z: Math.max(0, ...models.map((m) => (m.z ?? 0) + modelHeight(m))),
  };
}

/**
 * Wounds a unit regains, one at a time: each goes to its most hurt standing
 * model. With `revive`, once none is hurt, a destroyed model comes back where
 * it fell with one wound, and the wounds after that heal it. Returns the
 * models that changed, the wounds regained and the models brought back.
 */
export function regainWounds(
  models: Model[],
  amount: number,
  maxWounds: (m: Model) => number,
  revive = false,
): { changed: Model[]; healed: number; revived: number } {
  const now = new Map(models.map((m) => [m.id, m]));
  let healed = 0;
  let revived = 0;
  for (let n = Math.max(0, Math.floor(amount)); n > 0; n--) {
    const hurt = [...now.values()]
      .filter((m) => !m.destroyed && (m.woundsLost ?? 0) > 0)
      .sort((a, b) => (b.woundsLost ?? 0) - (a.woundsLost ?? 0))[0];
    if (hurt) now.set(hurt.id, { ...hurt, woundsLost: (hurt.woundsLost ?? 0) - 1 });
    else {
      const dead = revive ? [...now.values()].find((m) => m.destroyed) : undefined;
      if (!dead) break;
      now.set(dead.id, { ...dead, destroyed: false, woundsLost: maxWounds(dead) - 1 });
      revived++;
    }
    healed++;
  }
  return { changed: models.flatMap((m) => (now.get(m.id) !== m ? [now.get(m.id)!] : [])), healed, revived };
}
