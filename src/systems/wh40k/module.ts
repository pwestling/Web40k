import { WH40K_MISSIONS } from "./missions";
import { wh40kChecks } from "./checks";
import { DEFAULT_SYSTEM, getSystem } from "../../core/content";
import type { GameModule } from "../../sdk";
import type { GameState } from "../../core";
import type { SystemModule } from "../app";
import { standardLayout } from "./layout";
import { sampleRoster } from "./sample";
import { recognize } from "./recognize";
import { unitGap } from "../../core/manoeuvre";
import { opposed } from "../../core/teams";
import { maxWounds, woundsRemaining } from "../../core/attack";
import { engagedWith } from "./rules";

/** Inches, base to base, from a unit to the nearest enemy unit still standing (Infinity if none). */
function enemyGap(view: { state: GameState }, unitId: unknown): number {
  const state = view.state;
  const unit = state.units[String(unitId)];
  if (!unit) return Infinity;
  // Asked by every eligibility check: kept while the models and units stay the same (the bot asks it a lot, #51).
  let memo = gapMemo.get(state.models);
  if (!memo || memo.units !== state.units)
    gapMemo.set(state.models, (memo = { units: state.units, gaps: new Map() }));
  const known = memo.gaps.get(unit.id);
  if (known !== undefined) return known;
  let gap = Infinity;
  for (const u of Object.values(state.units))
    if (
      opposed(state, u.owner, unit.owner) &&
      u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed)
    )
      gap = Math.min(gap, unitGap(state, unit, u));
  memo.gaps.set(unit.id, gap);
  return gap;
}
const gapMemo = new WeakMap<object, { units: unknown; gaps: Map<string, number> }>();

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
    // Inches, base to base, between two units (a charge target within 12").
    unitGap: (view, a, b) => {
      const [x, y] = [view.state.units[String(a)], view.state.units[String(b)]];
      return x && y ? unitGap(view.state, x, y) : Infinity;
    },
    // Within engagement range of an enemy unit, read from the table (the data's "engaged" status isn't derived).
    engaged: (view, unitId) => {
      const unit = view.state.units[String(unitId)];
      return !!unit && engagedWith(view.state, unit).length > 0;
    },
  },
  checks: wh40kChecks,
  // Coherency here counts floors, a move counts climbing and the phase's allowance, and walls by unit type.
  replacesChecks: ["coherency", "moveDistance", "terrain"],
  app: {
    sample: sampleRoster,
    layout: (t) => standardLayout(t.width, t.depth),
    dedicatedUi: true,
    secretObjectives: "Secret objectives",
    missions: WH40K_MISSIONS,
    recognizeAbility: recognize,
  },
};
