import type { GameState, Unit } from "../../core";
import { hasRule } from "./specialRules";

/**
 * Rank width and largest rank bonus by troop type, from the rules index's
 * troop type table (tow.whfb.app, checked 2026-10-07). Units name their type
 * in a "Troop" characteristic, e.g. "Heavy Infantry".
 */
const TROOPS: [RegExp, { width: number; maxBonus: number }][] = [
  [/swarm/i, { width: 5, maxBonus: 0 }],
  [/monstrous/i, { width: 3, maxBonus: 0 }],
  [/light chariot/i, { width: 3, maxBonus: 1 }],
  [/heavy chariot|monster|war machine|behemoth/i, { width: 5, maxBonus: 0 }],
  [/heavy cavalry/i, { width: 4, maxBonus: 1 }],
  [/cavalry/i, { width: 5, maxBonus: 1 }],
  [/war beast/i, { width: 5, maxBonus: 2 }],
  [/heavy infantry/i, { width: 4, maxBonus: 2 }],
  [/infantry/i, { width: 5, maxBonus: 2 }],
];

/** A unit's rank width and rank bonus cap, from its first model's troop type (infantry if none). */
export function towRanks(game: GameState, unit: Unit): { width: number; maxBonus: number } {
  const first = unit.modelIds.map((id) => game.models[id]).find((m) => m && !m.destroyed);
  const type = first?.profile?.chars.Troop ?? "";
  const ranks = TROOPS.find(([re]) => re.test(type))?.[1] ?? { width: 5, maxBonus: 2 };
  // Horde: one more rank bonus than its troop type allows (#66).
  return hasRule(unit, /^horde\b/i) ? { ...ranks, maxBonus: ranks.maxBonus + 1 } : ranks;
}
