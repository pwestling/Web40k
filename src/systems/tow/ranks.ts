import { inFootprint } from "../../core/terrain";
import type { GameState, Unit } from "../../core/types";
import type { GameView } from "../../sdk";
import { blockModels } from "../../core/regiment";
import { hasRule } from "./specialRules";

/**
 * How many of a unit's models shoot (tow.whfb.app, shooting with more than
 * one rank and Volley Fire, checked 2026-10-08): the front rank; two ranks
 * when the unit stands on a hill; and with Volley Fire, half of each rank
 * behind those (rounding up), unless the unit moved this turn or is standing
 * and shooting at a charger.
 */

/** Whether most of the unit's front rank stands on a hill. */
export function onHill(state: GameState, u: Unit): boolean {
  const models = blockModels(state, u);
  const files = u.formation.kind === "ranked" ? Math.min(u.formation.files, models.length) : models.length;
  const front = models.slice(0, Math.max(1, files));
  const hills = state.terrain.filter((p) => p.category === "hill");
  if (!hills.length || !front.length) return false;
  return front.filter((m) => hills.some((p) => inFootprint(p, m.position))).length * 2 > front.length;
}

export function shooterCount(state: GameState, u: Unit, opts: { standAndShoot?: boolean } = {}): number {
  const models = blockModels(state, u).length;
  if (u.formation.kind !== "ranked") return models;
  const files = Math.min(u.formation.files, models);
  if (!files) return 0;
  const ranks = onHill(state, u) ? 2 : 1;
  let shooting = Math.min(models, files * ranks);
  if (hasRule(u, /\bvolley fire\b/i) && !u.status?.moved && !u.status?.marching && !opts.standAndShoot)
    for (let left = models - shooting; left > 0; left -= files)
      shooting += Math.ceil(Math.min(files, left) / 2);
  return shooting;
}

/** For data: `{ call: "shooters", args: [unit id] }`. */
export const shooters = (view: GameView, unitId: unknown): number => {
  const u = view.state.units[String(unitId)];
  return u ? shooterCount(view.state, u) : 0;
};
