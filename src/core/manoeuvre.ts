import type { UnitMove } from "./actions";
import { baseOutline, baseSizeInches, distance, polygonDistance, rotate } from "./geometry";
import { arcOf, blockCentre, blockCorners, blockFrame, blockModels, type Arc } from "./regiment";
import type { GameState, Model, Unit, Vec2 } from "./types";

/**
 * Charges, flight and pursuit for regiment games: geometry helpers that turn
 * a decision ("close the door on that unit", "flee from the charger 7\"")
 * into one rigid unit/move. A combat flow can call them; the panels offer
 * them by hand. All advisory: they say what they did, nothing is blocked.
 */

/** The facing that looks along `v` (0 looks along +y). */
export function facingOf(v: Vec2): number {
  return Math.atan2(v.x, v.y);
}

/** The direction a facing looks along. */
export function lookAlong(facing: number): Vec2 {
  return rotate({ x: 0, y: 1 }, facing);
}

/** Turn in (-pi, pi]. */
function wrap(a: number): number {
  let x = a % (Math.PI * 2);
  if (x <= -Math.PI) x += Math.PI * 2;
  if (x > Math.PI) x -= Math.PI * 2;
  return x;
}

/** Middle of a unit's standing models (a block's centre). */
export function unitCentre(state: GameState, unit: Unit): Vec2 {
  const frame = blockFrame(state, unit);
  if (frame) return blockCentre(frame);
  const ms = blockModels(state, unit);
  const n = Math.max(1, ms.length);
  return {
    x: ms.reduce((a, m) => a + m.position.x, 0) / n,
    y: ms.reduce((a, m) => a + m.position.y, 0) / n,
  };
}

export interface DoorClose {
  move: UnitMove;
  /** Which of the target's edges the charger lines up against. */
  arc: Arc;
  /** How far the charger's furthest-travelling front corner moves. */
  distance: number;
}

/**
 * Close the door: after a charge reaches its target, the charger swings and
 * slides so its front edge sits flush against the target's facing edge (the
 * edge of the arc it charged into), lined up as close to where it arrived as
 * the edge allows. Both units must be blocks.
 */
export function closeDoor(state: GameState, charger: Unit, target: Unit): DoorClose | null {
  const cf = blockFrame(state, charger);
  const tf = blockFrame(state, target);
  if (!cf || !tf) return null;
  const arc = arcOf(tf, cf.front);
  const c = blockCorners(tf);
  const [a, b] =
    arc === "front"
      ? [c.frontLeft, c.frontRight]
      : arc === "rear"
        ? [c.rearLeft, c.rearRight]
        : arc === "left"
          ? [c.frontLeft, c.rearLeft]
          : [c.frontRight, c.rearRight];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = len > 1e-9 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
  // The edge's outward normal: away from the target's centre.
  const tc = blockCentre(tf);
  let n = { x: -u.y, y: u.x };
  if ((mid.x - tc.x) * n.x + (mid.y - tc.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  // Slide along the edge no further than keeps the narrower front fully in contact.
  const along = (cf.front.x - mid.x) * u.x + (cf.front.y - mid.y) * u.y;
  const slack = Math.abs(len - cf.width) / 2;
  const s = Math.max(-slack, Math.min(slack, along));
  const front = { x: mid.x + u.x * s, y: mid.y + u.y * s };
  const facing = facingOf({ x: -n.x, y: -n.y });
  const turn = wrap(facing - cf.facing);
  const delta = { x: front.x - cf.front.x, y: front.y - cf.front.y };
  // Distance: the further of the two front corners' straight-line moves.
  const before = blockCorners(cf);
  const after = blockCorners({ ...cf, front, facing });
  const distance = Math.max(
    Math.hypot(after.frontLeft.x - before.frontLeft.x, after.frontLeft.y - before.frontLeft.y),
    Math.hypot(after.frontRight.x - before.frontRight.x, after.frontRight.y - before.frontRight.y),
  );
  return {
    move: { type: "unit/move", id: charger.id, pivot: cf.front, turn, delta, how: "door", distance },
    arc,
    distance,
  };
}

/**
 * A flee: the unit turns to face along `away` (about its centre) and runs
 * `inches` that way, keeping its formation.
 */
export function fleeMove(state: GameState, unit: Unit, away: Vec2, inches: number): UnitMove | null {
  const len = Math.hypot(away.x, away.y);
  const models = blockModels(state, unit);
  if (len < 1e-9 || !models.length) return null;
  const dir = { x: away.x / len, y: away.y / len };
  const facing = blockFrame(state, unit)?.facing ?? models[0]!.facing;
  return {
    type: "unit/move",
    id: unit.id,
    pivot: unitCentre(state, unit),
    turn: wrap(facingOf(dir) - facing),
    delta: { x: dir.x * inches, y: dir.y * inches },
    how: "flee",
    distance: inches,
  };
}

/** Directly away from a point (the unit it flees from). */
export function awayFrom(state: GameState, unit: Unit, from: Vec2): Vec2 {
  const c = unitCentre(state, unit);
  return { x: c.x - from.x, y: c.y - from.y };
}

/** Towards the nearest table edge, for a unit that keeps fleeing in later turns. */
export function towardsNearestEdge(state: GameState, unit: Unit): Vec2 {
  const c = unitCentre(state, unit);
  const hx = state.table.width / 2;
  const hy = state.table.depth / 2;
  const options: [number, Vec2][] = [
    [hx - c.x, { x: 1, y: 0 }],
    [hx + c.x, { x: -1, y: 0 }],
    [hy - c.y, { x: 0, y: 1 }],
    [hy + c.y, { x: 0, y: -1 }],
  ];
  return options.reduce((a, b) => (b[0] < a[0] ? b : a))[1];
}

export interface Pursuit {
  move: UnitMove;
  /** It reached the fleeing unit within its roll. */
  caught: boolean;
  /** How far it moved (to contact, or its full roll). */
  moved: number;
  /** Inches still between them after the move (0 when caught). */
  gap: number;
}

/**
 * A pursuit: the pursuer turns to face the fleeing unit and moves straight at
 * it up to `inches`, stopping at contact. Bases are treated as circles, so
 * the contact point is approximate (advisory).
 */
export function pursue(state: GameState, pursuer: Unit, quarry: Unit, inches: number): Pursuit | null {
  const own = blockModels(state, pursuer);
  const prey = blockModels(state, quarry);
  if (!own.length || !prey.length) return null;
  const from = unitCentre(state, pursuer);
  const to = unitCentre(state, quarry);
  const dir0 = { x: to.x - from.x, y: to.y - from.y };
  const len = Math.hypot(dir0.x, dir0.y);
  if (len < 1e-9) return null;
  const dir = { x: dir0.x / len, y: dir0.y / len };
  const facing = blockFrame(state, pursuer)?.facing ?? own[0]!.facing;
  const turn = wrap(facingOf(dir) - facing);
  const r = (b: (typeof own)[number]) => {
    const s = baseSizeInches(b.base);
    return Math.max(s.width, s.depth) / 2;
  };
  // The pursuer as turned in place, then how far it can go before touching.
  const turned = own.map((m) => {
    const o = rotate({ x: m.position.x - from.x, y: m.position.y - from.y }, turn);
    return { x: from.x + o.x, y: from.y + o.y, r: r(m) };
  });
  const targets = prey.map((m) => ({ x: m.position.x, y: m.position.y, r: r(m) }));
  // Earliest t along dir at which any pair of circles touches.
  let hit = Infinity;
  for (const p of turned)
    for (const q of targets) {
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const rr = p.r + q.r;
      const b = dx * dir.x + dy * dir.y;
      const c = dx * dx + dy * dy - rr * rr;
      if (c <= 0) hit = 0;
      else {
        const disc = b * b - c;
        if (disc >= 0 && b > 0) hit = Math.min(hit, b - Math.sqrt(disc));
      }
    }
  const caught = hit <= inches + 1e-6;
  const moved = caught ? Math.max(0, hit) : inches;
  return {
    move: {
      type: "unit/move",
      id: pursuer.id,
      pivot: from,
      turn,
      delta: { x: dir.x * moved, y: dir.y * moved },
      how: "pursue",
      distance: moved,
    },
    caught,
    moved,
    gap: caught ? 0 : Number.isFinite(hit) ? hit - inches : Infinity,
  };
}

/** Closest base-to-base gap between two units' standing models (0 when touching). */
export function unitGap(state: GameState, a: Unit, b: Unit): number {
  let best = Infinity;
  const bs = blockModels(state, b);
  const outlines = new Map<Model, Vec2[]>();
  const outline = (m: Model) => outlines.get(m) ?? outlines.set(m, baseOutline(m)).get(m)!;
  // Round bases are measured exactly; others only when their corners could be nearer than the best so far.
  const reach = (m: Model) => {
    const s = baseSizeInches(m.base);
    return m.base.shape === "round" ? s.width / 2 : Math.hypot(s.width, s.depth) / 2;
  };
  for (const m of blockModels(state, a)) {
    const rm = reach(m);
    for (const n of bs) {
      const d = distance(m.position, n.position) - rm - reach(n);
      if (m.base.shape === "round" && n.base.shape === "round") best = Math.min(best, Math.max(0, d));
      else if (d < best) best = Math.min(best, polygonDistance(outline(m), outline(n)));
    }
  }
  return best;
}
