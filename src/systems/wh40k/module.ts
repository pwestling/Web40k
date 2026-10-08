import { WH40K_MISSIONS } from "./missions";
import { DEFAULT_SYSTEM, getSystem } from "../../core/content";
import type { GameModule } from "../../sdk";
import type { GameState } from "../../core";
import type { SystemModule } from "../app";
import { standardLayout } from "./layout";
import { sampleRoster } from "./sample";
import { unitGap } from "../../core/manoeuvre";
import { opposed } from "../../core/teams";
import { maxWounds, woundsRemaining } from "../../core/attack";

/** Inches, base to base, from a unit to the nearest enemy unit still standing (Infinity if none). */
function enemyGap(view: { state: GameState }, unitId: unknown): number {
  const state = view.state;
  const unit = state.units[String(unitId)];
  if (!unit) return Infinity;
  let gap = Infinity;
  for (const u of Object.values(state.units))
    if (
      opposed(state, u.owner, unit.owner) &&
      u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed)
    )
      gap = Math.min(gap, unitGap(state, unit, u));
  return gap;
}

/**
 * Below half-strength: fewer than half its starting models left standing, or,
 * for a unit of one model, fewer than half its starting wounds left.
 */
function belowHalf(view: { state: GameState }, unitId: unknown): boolean {
  const state = view.state;
  const unit = state.units[String(unitId)];
  if (!unit) return false;
  const models = unit.modelIds.flatMap((id) => (state.models[id] ? [state.models[id]!] : []));
  const standing = models.filter((m) => !m.destroyed);
  if (models.length === 1) return woundsRemaining(models[0]!) * 2 < maxWounds(models[0]!);
  return standing.length * 2 < models.length;
}

/** Warhammer 40,000: the rules data in core/content/examples/forty-k.ts plus its own panels. */
export const wh40kModule: GameModule<SystemModule> = {
  id: DEFAULT_SYSTEM,
  version: getSystem(DEFAULT_SYSTEM).version,
  api: 1,
  system: getSystem(DEFAULT_SYSTEM),
  functions: {
    enemyGap: (view, unitId) => enemyGap(view, unitId),
    belowHalf: (view, unitId) => belowHalf(view, unitId),
  },
  app: {
    sample: sampleRoster,
    layout: (t) => standardLayout(t.width, t.depth),
    dedicatedUi: true,
    secretObjectives: "Secret objectives",
    missions: WH40K_MISSIONS,
  },
};
