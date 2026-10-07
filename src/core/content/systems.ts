import { fortyK } from "./examples/forty-k";
import { fsd } from "./examples/fsd";
import type { GameSystem, Id } from "./schema";

/**
 * Game systems the engine can run. 40k and Full Spectrum Dominance are built
 * in; others register at startup or when a player imports one.
 */
const systems = new Map<Id, GameSystem>([
  [fortyK.id, fortyK],
  [fsd.id, fsd],
]);

/** Every registered system, for the lobby's picker. */
export function listSystems(): GameSystem[] {
  return [...systems.values()];
}

export function registerSystem(system: GameSystem): void {
  systems.set(system.id, system);
}

export function getSystem(id: Id): GameSystem {
  const s = systems.get(id);
  if (!s) throw new Error(`Unknown game system "${id}"`);
  return s;
}
