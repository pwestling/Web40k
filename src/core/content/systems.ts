import { fortyK } from "./examples/forty-k";
import type { GameSystem, Id } from "./schema";

/**
 * Game systems the engine can run. 40k is built in while it is the only
 * playable system; others register at startup or when a player imports one.
 */
const systems = new Map<Id, GameSystem>([[fortyK.id, fortyK]]);

export function registerSystem(system: GameSystem): void {
  systems.set(system.id, system);
}

export function getSystem(id: Id): GameSystem {
  const s = systems.get(id);
  if (!s) throw new Error(`Unknown game system "${id}"`);
  return s;
}
