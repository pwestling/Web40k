import type { GameView, Warning } from "../../sdk";
import {
  baseOutline,
  baseToBaseDistance,
  polygonDistance,
  type GameState,
  type Model,
  type Unit,
  type Vec2,
} from "../../core";
import { inchesPerUnit, systemOf } from "../../core/content";
import { gamePoints } from "../../core/content/gameSize";
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
 *  - A multi-base unit out of coherence while not moving (it lost a base): it
 *    is pinned, and must move back within 1 DU before any special action.
 *  - A move can't end with a base overlapping another.
 *  - List building: an army over the game's points, two copies of a Unique unit, or a
 *    unit with more than one Character.
 */
export function fsdChecks(view: GameView): Warning[] {
  const state = view.state;
  const out: Warning[] = listChecks(state);
  if (state.turn.round === 0) return out;
  const aoc = inchesPerUnit(systemOf(state));
  for (const unit of Object.values(state.units)) {
    const alive = aliveModels(state, unit);
    if (!alive.length || unit.status?.reserves) continue;
    // Deployed from reserve: at least 2 DU from every enemy.
    if (unit.status?.arrived && unit.status?.acting) {
      const near = Object.values(state.units).some(
        (e) =>
          opposed(state, e.owner, unit.owner) &&
          !e.status?.reserves &&
          aliveModels(state, e).some((o) => alive.some((m) => baseToBaseDistance(m, o) < 2 * aoc)),
      );
      if (near)
        out.push({
          id: "deployDistance",
          unitId: unit.id,
          message: "Deployed within 2 DU of an enemy: units from reserve arrive at least 2 DU away",
        });
    }
    // Out of coherence while not moving (a base was lost): pinned, and must move back in.
    if (!unit.status?.acting && alive.length > 1 && outOfCoherence(alive, aoc))
      out.push({
        id: "coherence",
        unitId: unit.id,
        message:
          "Out of coherence: a unit split by losing a base is Pinned, and must move back within 1 DU before any special action",
      });
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
    if (moved > 0.05 && overlapping(state, alive))
      out.push({ id: "overlap", unitId: unit.id, message: "A base ends its move overlapping another base" });
    if (moved > 0.05 && Number(unit.status?.moves ?? 0) <= 1 && !fliesOrJumps(unit)) {
      const w = areaOfControl(view, unit, alive, aoc);
      if (w) out.push(w);
    }
  }
  return out;
}

/** The army's points against the game size, and Unique units fielded twice. */
function listChecks(state: GameState): Warning[] {
  const out: Warning[] = [];
  const size = gamePoints(state, systemOf(state));
  for (const player of Object.keys(state.players)) {
    const units = Object.values(state.units).filter((u) => u.owner === player);
    const points = units.reduce((t, u) => t + (u.sheet?.points ?? 0), 0);
    if (size && points > size)
      out.push({
        id: "points",
        unitId: units[0]?.id,
        message: `${state.players[player]?.name ?? player}'s army is ${points} points, over the game's ${size}`,
      });
    const seen = new Set<string>();
    for (const u of units) {
      // One Character card per unit (an ability named "Character: ...").
      if ((u.sheet?.abilities ?? []).filter((a) => /^character\b/i.test(a.name.trim())).length > 1)
        out.push({ id: "character", unitId: u.id, message: `${u.name} has more than one Character` });
      if (!(u.sheet?.abilities ?? []).some((a) => /^unique\b/i.test(a.name.trim()))) continue;
      if (seen.has(u.name))
        out.push({ id: "unique", unitId: u.id, message: `${u.name} is Unique: only one may be fielded` });
      seen.add(u.name);
    }
  }
  return out;
}

/** A base, shrunk a little so touching isn't overlapping. */
function inner(m: Model): Model {
  const b = m.base;
  const base =
    b.shape === "round"
      ? { ...b, diameterMm: b.diameterMm * 0.9 }
      : { ...b, widthMm: b.widthMm * 0.9, depthMm: b.depthMm * 0.9 };
  return { ...m, base };
}

/** Some base of the unit overlaps another model's base. */
function overlapping(state: GameState, alive: Model[]): boolean {
  const others = Object.values(state.models).filter((o) => !o.destroyed && !alive.includes(o));
  return alive.some((m) =>
    [...others, ...alive.filter((o) => o !== m)].some(
      (o) =>
        Math.hypot(o.position.x - m.position.x, o.position.y - m.position.y) < 6 &&
        baseToBaseDistance(inner(m), inner(o)) === 0,
    ),
  );
}

/** Some base has no other base of the unit within 1 DU (centre to centre). */
function outOfCoherence(alive: Model[], du: number): boolean {
  return alive.some((m) =>
    alive.every(
      (o) => o === m || Math.hypot(o.position.x - m.position.x, o.position.y - m.position.y) > du + 1e-6,
    ),
  );
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
    // Pinned enemies and those still in reserve project no area of control (UX 293).
    if (!opposed(state, enemy.owner, unit.owner) || enemy.status?.pinned || enemy.status?.reserves) continue;
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
