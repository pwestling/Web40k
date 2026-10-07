import type { GameSystem } from "../core";
import { wh40k } from "./wh40k";

/** Game systems the engine can run. Others (The Old World, Conquest) slot in here. */
export const systems: Record<string, GameSystem> = {
  [wh40k.id]: wh40k,
};
