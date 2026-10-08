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
