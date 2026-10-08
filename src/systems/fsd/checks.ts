import type { GameView, Warning } from "../../sdk";
import {
  baseOutline,
  baseToBaseDistance,
  polygonDistance,
  type Model,
  type Unit,
  type Vec2,
} from "../../core";
import { inchesPerUnit, systemOf } from "../../core/content";
import { opposed } from "../../core/teams";
import { aliveModels, unitMoved } from "../wh40k/rules";

/**
 * FSD's table checks, run by the Table warnings panel (src/ui/warnings.ts).
 *
 *  - A unit acts only once it is activated (spending an activation die), so a
 *    unit dragged across the table without activating has moved for nothing.
 *    Once activated, a move is a Move action (an action spent, a reaction
 *    offered), so a drag without one is flagged too.
 *  - Areas of control: every unit controls 1 DU around its bases. An enemy
 *    can't enter and leave it in one move, and a move that starts in it must
 *    end outside it or in base contact. Ignored while the controlling unit is
 *    pinned or out of sight, and for units that fly or jump. A unit's move is
 *    measured from where it stood when the activations began; with two or
 *    more move actions the rules allow either, so only single moves are
 *    checked.
 *  - A unit deployed from reserve arrives at least 2 DU from every enemy.
 */
export function fsdChecks(view: GameView): Warning[] {
  const state = view.state;
  if (state.turn.round === 0) return [];
  const out: Warning[] = [];
  const aoc = inchesPerUnit(systemOf(state));
  for (const unit of Object.values(state.units)) {
    const alive = aliveModels(state, unit);
    if (!alive.length || unit.status?.reserves) continue;
    // Deployed from reserve: at least 2 DU from every enemy.
    if (unit.status?.arrived && unit.status?.acting) {
      const near = Object.values(state.units).some(
        (e) =>
          opposed(state, e.owner, unit.owner) &&
          aliveModels(state, e).some((o) => alive.some((m) => baseToBaseDistance(m, o) < 2 * aoc)),
      );
      if (near)
        out.push({
          id: "deployDistance",
          unitId: unit.id,
          message: "Deployed within 2 DU of an enemy: units from reserve arrive at least 2 DU away",
        });
    }
    const moved = unitMoved(alive);
    if (!unit.status?.activated) {
      if (moved > 0.05)
        out.push({
          id: "activateFirst",
          unitId: unit.id,
          message: "Moved without activating: activate it first, or put it back",
        });
      continue;
    }
    // Dragged without a move action: no action spent and no reaction offered (UX 262).
    if (moved > 0.05 && !(Number(unit.status?.allowance ?? 0) > 0) && !unit.status?.arrived) {
      out.push({
        id: "moveAction",
        unitId: unit.id,
        message:
          "Moved without a Move action: take Move on its card (the other side may react), or put it back",
      });
      continue;
    }
    if (moved > 0.05 && Number(unit.status?.moves ?? 0) <= 1 && !fliesOrJumps(unit)) {
      const w = areaOfControl(view, unit, alive, aoc);
      if (w) out.push(w);
    }
  }
  return out;
}

function fliesOrJumps(unit: Unit): boolean {
  const words = [...(unit.sheet?.keywords ?? []), ...(unit.sheet?.abilities ?? []).map((a) => a.name)];
  return words.some((w) => /\b(flying|flyer|jump)/i.test(w));
}

/** The first area of control this unit's single move broke, as a warning. */
function areaOfControl(view: GameView, unit: Unit, alive: Model[], aoc: number): Warning | null {
  const state = view.state;
  const started = alive.map((m) => ({ ...m, position: m.phaseStart ?? m.position }));
  for (const enemy of Object.values(state.units)) {
    if (!opposed(state, enemy.owner, unit.owner) || enemy.status?.pinned) continue;
    const theirs = aliveModels(state, enemy);
    if (!theirs.length || !view.visible(enemy.id, unit.id)) continue;
    const near = (ms: Model[]) => ms.some((m) => theirs.some((e) => baseToBaseDistance(m, e) <= aoc));
    const startIn = near(started);
    const endIn = near(alive);
    if (startIn && endIn) {
      const contact = alive.some((m) => theirs.some((e) => baseToBaseDistance(m, e) <= 0.1));
      if (!contact)
        return {
          id: "areaOfControl",
          unitId: unit.id,
          message: `Started in ${enemy.name}'s area of control: the move must end outside it or in base contact`,
        };
    } else if (!startIn && !endIn) {
      // Did the path between pass through it? The base swept along a straight line.
      const crossed = alive.some((m, i) => {
        const swept = hull([...baseOutline(started[i]!), ...baseOutline(m)]);
        return theirs.some((e) => polygonDistance(swept, baseOutline(e)) <= aoc);
      });
      if (crossed)
        return {
          id: "areaOfControl",
          unitId: unit.id,
          message: `Passed through ${enemy.name}'s area of control: a unit can't enter and leave it in one move`,
        };
    }
  }
  return null;
}

/** Convex hull of points (monotone chain). */
function hull(points: Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: Vec2[]) => {
    const out: Vec2[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}
