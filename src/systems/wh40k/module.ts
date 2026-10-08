import { WH40K_MISSIONS } from "./missions";
import { DEFAULT_SYSTEM, getSystem } from "../../core/content";
import type { GameModule } from "../../sdk";
import type { GameState } from "../../core";
import type { SystemModule } from "../app";
import { standardLayout } from "./layout";
import { sampleRoster } from "./sample";
import { unitGap } from "../../core/manoeuvre";
import { opposed } from "../../core/teams";

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

/** Warhammer 40,000: the rules data in core/content/examples/forty-k.ts plus its own panels. */
export const wh40kModule: GameModule<SystemModule> = {
  id: DEFAULT_SYSTEM,
  version: getSystem(DEFAULT_SYSTEM).version,
  api: 1,
  system: getSystem(DEFAULT_SYSTEM),
  functions: { enemyGap: (view, unitId) => enemyGap(view, unitId) },
  app: {
    sample: sampleRoster,
    layout: (t) => standardLayout(t.width, t.depth),
    dedicatedUi: true,
    secretObjectives: "Secret objectives",
    missions: WH40K_MISSIONS,
  },
};
