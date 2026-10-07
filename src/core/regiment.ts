import type { UnitMove } from "./actions";
import { baseSizeInches, rotate } from "./geometry";
import type { BaseShape, GameState, Model, ModelId, Unit, UnitId, Vec2 } from "./types";

/**
 * Regiment blocks (The Old World, Conquest): a ranked unit is a rigid block
 * of ranks and files with a facing. Its models are kept in slot order, front
 * rank first, left to right, so `unit.modelIds` is also the order from front
 * to rear (characters and command models go first).
 *
 * The block's frame (front edge centre, facing, frontage and depth) is worked
 * out from where its models stand, so any move that keeps the block rigid
 * keeps the frame right.
 */

export interface BlockFrame {
  /** Centre of the front edge. */
  front: Vec2;
  /** Facing of the block, as model facing (0 looks along +y). */
  facing: number;
  /** Frontage and depth in inches. */
  width: number;
  depth: number;
  files: number;
  /** Ranks with at least one model standing. */
  ranks: number;
}

/**
 * Offsets for a block of mixed bases, relative to the centre of its front edge
 * (x = right, y = forward). Each rank holds `files` models side by side,
 * centred; a rank is as deep as its deepest base, so a cavalry or monster base
 * in the front rank pushes the next rank back rather than overlapping it.
 */
export function blockOffsets(bases: BaseShape[], files: number): Vec2[] {
  const f = Math.max(1, Math.floor(files));
  const out: Vec2[] = [];
  let top = 0;
  for (let start = 0; start < bases.length; start += f) {
    const rank = bases.slice(start, start + f).map(baseSizeInches);
    const width = rank.reduce((a, b) => a + b.width, 0);
    let x = -width / 2;
    for (const b of rank) {
      out.push({ x: x + b.width / 2, y: top - b.depth / 2 });
      x += b.width;
    }
    top -= Math.max(...rank.map((b) => b.depth));
  }
  return out;
}

/** The unit's models in slot order, front rank first; `alive` drops casualties. */
export function blockModels(state: GameState, unit: Unit, alive = true): Model[] {
  return unit.modelIds.flatMap((id) => {
    const m = state.models[id];
    return m && (!alive || !m.destroyed) ? [m] : [];
  });
}

/** Alive models from front to rear: who is in which slot, for removing casualties from the rear. */
export function blockSlots(state: GameState, unit: Unit): ModelId[] {
  return blockModels(state, unit).map((m) => m.id);
}

export function isBlock(unit: Unit | undefined): boolean {
  return unit?.formation.kind === "ranked";
}

/** Where a ranked unit's block stands, or null for skirmishers and empty units. */
export function blockFrame(state: GameState, unit: Unit): BlockFrame | null {
  if (unit.formation.kind !== "ranked") return null;
  const all = blockModels(state, unit, false);
  const alive = all.filter((m) => !m.destroyed);
  if (!alive.length) return null;
  const files = Math.max(1, Math.min(unit.formation.files, all.length));
  const offsets = blockOffsets(
    all.map((m) => m.base),
    files,
  );
  const facing = alive[0]!.facing;
  // The front centre, averaged over every model so a nudged model barely moves it.
  let fx = 0;
  let fy = 0;
  all.forEach((m, i) => {
    const o = rotate(offsets[i]!, facing);
    fx += m.position.x - o.x;
    fy += m.position.y - o.y;
  });
  const front = { x: fx / all.length, y: fy / all.length };
  const sizes = all.map((m) => baseSizeInches(m.base));
  const width = sizes.slice(0, files).reduce((a, b) => a + b.width, 0);
  let depth = 0;
  all.forEach((m, i) => {
    if (!m.destroyed) depth = Math.max(depth, -offsets[i]!.y + sizes[i]!.depth / 2);
  });
  const lastAlive = Math.max(...alive.map((m) => all.indexOf(m)));
  return { front, facing, width, depth, files, ranks: Math.floor(lastAlive / files) + 1 };
}

/** Table point for a point in the block's own frame (x = right, y = forward from the front edge). */
export function blockToWorld(frame: BlockFrame, local: Vec2): Vec2 {
  const o = rotate(local, frame.facing);
  return { x: frame.front.x + o.x, y: frame.front.y + o.y };
}

/** A table point in the block's own frame. */
export function blockToLocal(frame: BlockFrame, p: Vec2): Vec2 {
  return rotate({ x: p.x - frame.front.x, y: p.y - frame.front.y }, -frame.facing);
}

/**
 * Which way local +x points, seen from above the table: `rotate` turns the
 * forward axis so that local +x lands on the block's left (and a positive
 * turn swings it to the left). Left and right in this file go through this.
 */
export const BLOCK_LEFT = 1;

export function blockCorners(frame: BlockFrame): {
  frontLeft: Vec2;
  frontRight: Vec2;
  rearLeft: Vec2;
  rearRight: Vec2;
} {
  // Seen from above, the block's local +x is on its left (see BLOCK_LEFT).
  const w = (frame.width / 2) * BLOCK_LEFT;
  return {
    frontLeft: blockToWorld(frame, { x: w, y: 0 }),
    frontRight: blockToWorld(frame, { x: -w, y: 0 }),
    rearLeft: blockToWorld(frame, { x: w, y: -frame.depth }),
    rearRight: blockToWorld(frame, { x: -w, y: -frame.depth }),
  };
}

export function blockCentre(frame: BlockFrame): Vec2 {
  return blockToWorld(frame, { x: 0, y: -frame.depth / 2 });
}

export type Arc = "front" | "left" | "right" | "rear";

/**
 * Which of the block's arcs a point is in. The arcs are split by lines drawn
 * out from the block's corners at 45 degrees to its edges: in front of the
 * front edge and between the front corners' lines is the front arc, and so on.
 * Points inside the block count as front.
 */
export function arcOf(frame: BlockFrame, p: Vec2): Arc {
  const l = blockToLocal(frame, p);
  const side = Math.abs(l.x) - frame.width / 2;
  if (l.y >= 0 && side <= l.y) return "front";
  const behind = -frame.depth - l.y;
  if (behind >= 0 && side <= behind) return "rear";
  if (side <= 0) return "front";
  return l.x * BLOCK_LEFT > 0 ? "left" : "right";
}

/**
 * The arc of `target` that a point (or another unit) is in, or null when the
 * target isn't a block. A unit counts by the centre of its front edge (a
 * block) or the middle of its models (skirmishers).
 */
export function inArc(state: GameState, target: Unit, from: Vec2 | Unit): Arc | null {
  const frame = blockFrame(state, target);
  if (!frame) return null;
  return arcOf(frame, "id" in from ? unitPoint(state, from) : from);
}

function unitPoint(state: GameState, unit: Unit): Vec2 {
  const frame = blockFrame(state, unit);
  if (frame) return frame.front;
  const ms = blockModels(state, unit);
  const n = Math.max(1, ms.length);
  return {
    x: ms.reduce((a, m) => a + m.position.x, 0) / n,
    y: ms.reduce((a, m) => a + m.position.y, 0) / n,
  };
}

/**
 * Lay a unit out as a fresh block: its standing models in slot order at
 * `files` wide, facing `facing`, centred on `centre` (default: where the
 * block's centre is now). Casualties go to the back of the slot order and
 * are moved there too, out of sight.
 */
export function formBlock(
  state: GameState,
  unit: Unit,
  files: number,
  facing: number,
  centre?: Vec2,
): { order: ModelId[]; models: { id: ModelId; to: Vec2; facing: number }[] } {
  const alive = blockModels(state, unit);
  const dead = blockModels(state, unit, false).filter((m) => m.destroyed);
  const f = Math.max(1, Math.min(Math.floor(files), alive.length || 1));
  // Casualties keep a slot at the back so the block's frame stays true.
  const offsets = blockOffsets(
    [...alive, ...dead].map((m) => m.base),
    f,
  );
  const depth = Math.max(0, ...alive.map((m, i) => -offsets[i]!.y + baseSizeInches(m.base).depth / 2));
  const frame = blockFrame(state, unit);
  const c = centre ?? (frame ? blockCentre(frame) : (alive[0]?.position ?? { x: 0, y: 0 }));
  const back = rotate({ x: 0, y: depth / 2 }, facing);
  const front = { x: c.x + back.x, y: c.y + back.y };
  return {
    order: [...alive, ...dead].map((m) => m.id),
    models: [...alive, ...dead].map((m, i) => {
      const o = rotate(offsets[i]!, facing);
      return { id: m.id, to: { x: front.x + o.x, y: front.y + o.y }, facing };
    }),
  };
}

/** A straight move along the block's facing (negative backs up). */
export function forwardMove(frame: BlockFrame, unitId: UnitId, distance: number): UnitMove {
  const d = rotate({ x: 0, y: distance }, frame.facing);
  return { type: "unit/move", id: unitId, pivot: frame.front, turn: 0, delta: d, how: "forward", distance };
}

/**
 * A wheel: the block swings around one front corner, `angle` radians
 * (positive towards its right, pivoting on the right corner). It costs the
 * distance the outside front corner travels. A positive turn in table space
 * swings to the left, hence the sign flip.
 */
export function wheelMove(frame: BlockFrame, unitId: UnitId, angle: number): UnitMove {
  const c = blockCorners(frame);
  const pivot = angle > 0 ? c.frontRight : c.frontLeft;
  return {
    type: "unit/move",
    id: unitId,
    pivot,
    turn: -angle,
    delta: { x: 0, y: 0 },
    how: "wheel",
    distance: frame.width * Math.abs(angle),
  };
}

/** Ranks that count: at least `minWidth` models wide (front rank included). */
export function rankCount(state: GameState, unit: Unit, minWidth: number): number {
  if (unit.formation.kind !== "ranked") return 0;
  const files = unit.formation.files;
  if (files < minWidth) return 0;
  const all = blockModels(state, unit, false);
  let ranks = 0;
  for (let start = 0; start < all.length; start += files) {
    const standing = all.slice(start, start + files).filter((m) => !m.destroyed).length;
    if (standing >= minWidth) ranks++;
  }
  return ranks;
}

/** Unit strength: each standing model counts its "US" characteristic, or 1. */
export function unitStrength(state: GameState, unit: Unit): number {
  return blockModels(state, unit).reduce((a, m) => {
    const us = Number.parseFloat(m.profile?.chars.US ?? "");
    return a + (Number.isFinite(us) ? us : 1);
  }, 0);
}
