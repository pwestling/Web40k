import type { GameView, Warning } from "../../sdk";
import { opposed } from "../../core/teams";
import { aliveModels, blockedMoves, incoherentModels, moveAllowance, unitDistance, unitMoved } from "./rules";

const DEEP_STRIKE_GAP = 9;

/**
 * The 40k table checks, run by the Table warnings panel (src/ui/warnings.ts).
 * Code, not data, where the data checks in forty-k.ts can't say it: coherency
 * counts floors, a move counts climbing and the phase's allowance, and Deep
 * Strike looks at where a unit arrived. A check here with the same id as a
 * data check replaces it.
 */
export function wh40kChecks(view: GameView): Warning[] {
  const state = view.state;
  const out: Warning[] = [];
  const playing = state.turn.round > 0;
  for (const unit of Object.values(state.units)) {
    const alive = aliveModels(state, unit);
    if (!alive.length || unit.status?.reserves) continue;
    const bad = incoherentModels(alive).size;
    if (bad > 0)
      out.push({
        id: "coherency",
        unitId: unit.id,
        message: `${bad} model${bad === 1 ? "" : "s"} out of coherency`,
      });
    if (playing || unit.status?.scouting) {
      const allowed = moveAllowance(state, unit);
      const moved = unitMoved(alive);
      if (allowed !== null && moved > allowed + 0.05)
        out.push({
          id: "moveDistance",
          unitId: unit.id,
          message: `Moved ${moved.toFixed(1)}" of ${allowed}" this phase`,
        });
    }
    if (playing) {
      const through = blockedMoves(state, unit);
      if (through.length)
        out.push({
          id: "terrain",
          unitId: unit.id,
          message: `Moved through ${through.map((p) => p.name.toLowerCase()).join(", ")}`,
        });
    }
    if (unit.status?.arrived) {
      const enemies = Object.values(state.units).filter((u) => opposed(state, u.owner, unit.owner));
      const gap = unitDistance(
        alive,
        enemies.flatMap((u) => aliveModels(state, u)),
      );
      if (gap <= DEEP_STRIKE_GAP)
        out.push({
          id: "deepStrike",
          unitId: unit.id,
          message: `Arrived from reserves ${gap.toFixed(1)}" from an enemy (needs more than ${DEEP_STRIKE_GAP}")`,
        });
    }
  }
  return out;
}
