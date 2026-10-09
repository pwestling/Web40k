import type { GameState, PlayerId, UnitId } from "../core";
import { fightOrder } from "../systems/wh40k/fight";

/**
 * 40k's Fight phase: both sides pick a unit in turn, whoever's turn it is
 * (wh40k/fight.ts). Whether the pick is this side's now, and which units it
 * may fight with; null when no order applies (another phase or game, or
 * nobody has a unit left to fight).
 */
export function fightPick(state: GameState, mine: Set<PlayerId>): { ours: boolean; units: UnitId[] } | null {
  const order = fightOrder(state);
  if (!order?.picker) return null;
  return { ours: mine.has(order.picker), units: order.eligible };
}
