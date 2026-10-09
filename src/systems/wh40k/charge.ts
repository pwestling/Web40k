import { unitGap, type GameState, type UnitId } from "../../core";

/** Inches a charge must close: into Engagement Range (1") of every target. */
const ENGAGEMENT = 1;

/** The 2D6 a charge from this unit needs to reach every declared target (0 if it's already there). */
export function chargeNeeded(state: GameState, unitId: UnitId, targets: UnitId[]): number {
  const unit = state.units[unitId];
  if (!unit) return 0;
  return Math.max(
    0,
    ...targets.map((id) => {
      const other = state.units[id];
      return other ? Math.ceil(Math.max(0, unitGap(state, unit, other) - ENGAGEMENT)) : 0;
    }),
  );
}
