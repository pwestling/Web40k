import type { GameView, Warning } from "../../sdk";
import { opposed } from "../../core/teams";
import { currentSlot } from "../../core/content/turn";
import {
  aliveModels,
  blockedMoves,
  engagedWith,
  hasKeyword,
  incoherentModels,
  moveAllowance,
  unitDistance,
  unitMoved,
} from "./rules";
import { baseToBaseDistance } from "../../core/geometry";
import type { GameState, Unit } from "../../core";

const DEEP_STRIKE_GAP = 9;
/** Extra CP a player may gain in a battle round besides the Command phase's (edition value, unverified). */
const EXTRA_CP_PER_ROUND = 1;

/**
 * Models of the unit whose move this phase passed over an enemy model's
 * base (sampled along the straight line from where they started). Units
 * that can Fly go over.
 */
function movedThroughEnemies(state: GameState, unit: Unit): number {
  if (hasKeyword(unit.sheet?.keywords ?? [], "Fly")) return 0;
  const enemies = Object.values(state.units)
    .filter((u) => opposed(state, u.owner, unit.owner))
    .flatMap((u) => aliveModels(state, u));
  return aliveModels(state, unit).filter((m) => {
    const from = m.phaseStart;
    if (!from) return false;
    const length = Math.hypot(m.position.x - from.x, m.position.y - from.y);
    if (length < 0.05) return false;
    const steps = Math.ceil(length / 0.25);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const at = {
        ...m,
        position: { x: from.x + (m.position.x - from.x) * k, y: from.y + (m.position.y - from.y) * k },
      };
      if (enemies.some((e) => baseToBaseDistance(at, e) < 0.01)) return true;
    }
    return false;
  }).length;
}

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
  // CP gained by hand this round, past the Command phase's (the reducer notes each gain).
  for (const p of Object.values(state.players)) {
    const extra = (state.used?.[p.id] ?? []).filter(
      (u) => u.action === "gain:CP" && u.round === state.turn.round,
    ).length;
    if (playing && extra > EXTRA_CP_PER_ROUND)
      out.push({
        id: "cpCap",
        message: `${p.name} gained ${extra} extra CP this round (${EXTRA_CP_PER_ROUND} at most)`,
      });
  }
  const moving = playing && currentSlot(state)?.id === "movement";
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
    // Movement phase moves go around enemy models and end out of engagement range.
    if (moving && state.players[unit.owner]?.seat === state.turn.activeSeat) {
      const through = movedThroughEnemies(state, unit);
      if (through)
        out.push({
          id: "throughEnemies",
          unitId: unit.id,
          message: `${through} model${through === 1 ? "" : "s"} moved through enemy models`,
        });
      const moved = alive.some(
        (m) =>
          m.phaseStart && Math.hypot(m.position.x - m.phaseStart.x, m.position.y - m.phaseStart.y) >= 0.05,
      );
      if (moved && engagedWith(state, unit).length)
        out.push({
          id: "endsEngaged",
          unitId: unit.id,
          message: "Ended a move within engagement range of an enemy",
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
    // Piling in and consolidating: each model that moved ends closer to the closest enemy model.
    if (playing && currentSlot(state)?.id === "fight") {
      const enemies = Object.values(state.units)
        .filter((u) => opposed(state, u.owner, unit.owner))
        .flatMap((u) => aliveModels(state, u));
      const nearest = (p: { x: number; y: number }) =>
        enemies.reduce((d, e) => Math.min(d, Math.hypot(e.position.x - p.x, e.position.y - p.y)), Infinity);
      const away = alive.filter((m) => {
        const from = m.phaseStart;
        if (!from || Math.hypot(m.position.x - from.x, m.position.y - from.y) < 0.05) return false;
        return nearest(m.position) > nearest(from) + 0.05;
      }).length;
      if (away > 0)
        out.push({
          id: "pileIn",
          unitId: unit.id,
          message: `${away} model${away === 1 ? "" : "s"} moved away from the closest enemy (pile in and consolidate move closer)`,
        });
    }
    if (unit.status?.arrived && state.turn.round === 1)
      out.push({
        id: "reservesRound",
        unitId: unit.id,
        message: "Arrived from reserves in the first battle round",
      });
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
