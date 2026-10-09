import type { GameState } from "../types";
import { num } from "./expr";
import type { GameSystem, Id } from "./schema";

/**
 * Numbers that follow the game's size (GameSystem.gameSize): FSD's AD Pool
 * and Capacity grow with the points played. The size is what the players set
 * (settings.points), else the system's standard size.
 */

/** The game's size in points, for a system whose numbers follow it. */
export function gamePoints(state: GameState, system: GameSystem): number | undefined {
  if (!system.gameSize) return undefined;
  const set = state.settings.points;
  return typeof set === "number" && set > 0 ? set : system.gameSize.points;
}

/** The system's constants, with those that follow the game size worked out for this game. */
export function systemConstants(state: GameState, system: GameSystem): Record<Id, number> {
  const base = system.constants ?? {};
  const size = system.gameSize;
  if (!size) return base;
  const points = gamePoints(state, system);
  const out = { ...base };
  for (const [id, expr] of Object.entries(size.constants)) {
    try {
      out[id] = num(expr, { scope: { game: { points }, const: base } });
    } catch {
      // A size rule that can't be worked out keeps the standard value.
    }
  }
  return out;
}
