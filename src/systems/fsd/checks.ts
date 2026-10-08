import type { GameView, Warning } from "../../sdk";
import { aliveModels, unitMoved } from "../wh40k/rules";

/**
 * FSD's table checks, run by the Table warnings panel (src/ui/warnings.ts).
 * A unit acts only once it is activated (spending an activation die), so a
 * unit dragged across the table without activating has moved for nothing.
 */
export function fsdChecks(view: GameView): Warning[] {
  const state = view.state;
  if (state.turn.round === 0) return [];
  const out: Warning[] = [];
  for (const unit of Object.values(state.units)) {
    const alive = aliveModels(state, unit);
    if (!alive.length || unit.status?.reserves || unit.status?.activated) continue;
    const moved = unitMoved(alive);
    if (moved > 0.05)
      out.push({
        id: "activateFirst",
        unitId: unit.id,
        message: "Moved without activating: activate it first, or put it back",
      });
  }
  return out;
}
