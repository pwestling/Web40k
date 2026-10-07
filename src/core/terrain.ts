import { baseSizeInches, baseToBaseDistance } from "./geometry";
import type { Model, TerrainPiece, TerrainSolid, Vec2 } from "./types";

/**
 * Terrain geometry. Pieces are boxes on a rotated footprint; the engine uses
 * the same boxes for drawing, line of sight and floors. Nothing here
 * simulates physics: models stand at a chosen floor height and never fall,
 * tip or collide.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Table position to a piece's local footprint coordinates. */
export function toLocal(piece: TerrainPiece, p: Vec2): Vec2 {
  const dx = p.x - piece.position.x;
  const dy = p.y - piece.position.y;
  const c = Math.cos(piece.facing);
  const s = Math.sin(piece.facing);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** Local footprint coordinates to table position (same rotation as models). */
export function toWorld(piece: TerrainPiece, p: Vec2): Vec2 {
  const c = Math.cos(piece.facing);
  const s = Math.sin(piece.facing);
  return { x: piece.position.x + p.x * c + p.y * s, y: piece.position.y - p.x * s + p.y * c };
}

export function inFootprint(piece: TerrainPiece, p: Vec2, margin = 0): boolean {
  const l = toLocal(piece, p);
  return Math.abs(l.x) <= piece.width / 2 + margin && Math.abs(l.y) <= piece.depth / 2 + margin;
}

/** Whether a model's whole base is inside the footprint. */
export function whollyWithin(piece: TerrainPiece, model: Model): boolean {
  const { width, depth } = baseSizeInches(model.base);
  const r = Math.max(width, depth) / 2;
  return inFootprint(piece, model.position, -r);
}

export function blocksSight(solid: TerrainSolid): boolean {
  return solid.kind !== "foliage";
}

function inSolidXY(solid: TerrainSolid, l: Vec2): boolean {
  return Math.abs(l.x - solid.x) <= solid.w / 2 && Math.abs(l.y - solid.y) <= solid.d / 2;
}

/**
 * Heights a model can stand at, at a point: the table (0) and the top of
 * every floor or block under it, lowest first.
 */
export function levelsAt(terrain: TerrainPiece[], p: Vec2): number[] {
  const levels = new Set([0]);
  for (const piece of terrain) {
    if (!inFootprint(piece, p, 0.01)) continue;
    const l = toLocal(piece, p);
    for (const s of piece.solids)
      if ((s.kind === "floor" || s.kind === "block") && inSolidXY(s, l)) levels.add(round(s.z + s.h));
  }
  return [...levels].sort((a, b) => a - b);
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Where a model ends up after being put down at `p`: the highest level at or
 * just above its current height, so dragging along a floor keeps it on that
 * floor and dragging off the edge drops it to the level below.
 */
export function settleZ(terrain: TerrainPiece[], p: Vec2, z: number): number {
  let level =
    levelsAt(terrain, p)
      .filter((l) => l <= z + 0.3)
      .at(-1) ?? 0;
  // Never leave a model inside something solid (a hill, a crate): step up onto it.
  for (let guard = 0; guard < 10; guard++) {
    const top = solidTopAround(terrain, p, level);
    if (top === null) break;
    level = top;
  }
  return level;
}

/** Top of a floor or block that fills the space just above `z` at a point, if any. */
function solidTopAround(terrain: TerrainPiece[], p: Vec2, z: number): number | null {
  for (const piece of terrain) {
    if (!inFootprint(piece, p, 0.01)) continue;
    const l = toLocal(piece, p);
    for (const s of piece.solids) {
      if (s.kind !== "floor" && s.kind !== "block") continue;
      if (inSolidXY(s, l) && s.z < z + 0.5 && s.z + s.h > z + 0.01) return round(s.z + s.h);
    }
  }
  return null;
}

/** The next level above (dir 1) or below (dir -1) a height at a point. */
export function stepLevel(terrain: TerrainPiece[], p: Vec2, z: number, dir: 1 | -1): number {
  const levels = levelsAt(terrain, p);
  if (dir === 1) return levels.find((l) => l > z + 0.05) ?? z;
  return [...levels].reverse().find((l) => l < z - 0.05) ?? 0;
}

/** Default miniature height from its base, until players set one. */
export function modelHeight(model: Model): number {
  if (model.height) return model.height;
  if (model.bands?.length) return Math.max(...model.bands.map((b) => b.z1));
  const { width, depth } = baseSizeInches(model.base);
  if (model.base.shape === "rect") return Math.min(3.5, 1 + Math.max(width, depth) * 0.3);
  return Math.min(5, 1.1 + (Math.min(width, depth) / 2) * 1.6);
}

/** Gap between two models' volumes in the vertical axis (0 if they overlap in height). */
export function verticalGap(a: Model, b: Model): number {
  const az = a.z ?? 0;
  const bz = b.z ?? 0;
  return Math.max(0, bz - (az + modelHeight(a)), az - (bz + modelHeight(b)));
}

/** Closest distance between two models, counting both the base gap and the height gap. */
export function modelDistance(a: Model, b: Model): number {
  return Math.hypot(baseToBaseDistance(a, b), verticalGap(a, b));
}

/**
 * Whether the segment a→b passes through a box (slab test), ignoring the very
 * ends so a model touching a wall can still see past it.
 */
export function segmentHitsBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3): boolean {
  let t0 = 0.001;
  let t1 = 0.999;
  for (const k of ["x", "y", "z"] as const) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) {
      if (a[k] < min[k] || a[k] > max[k]) return false;
      continue;
    }
    let ta = (min[k] - a[k]) / d;
    let tb = (max[k] - a[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** The first terrain piece whose solids block a sight line, or null. */
export function sightBlockedBy(terrain: TerrainPiece[], a: Vec3, b: Vec3): TerrainPiece | null {
  for (const piece of terrain) {
    // Quick reject: both ends on the same side of the footprint's bounding circle.
    const r = Math.hypot(piece.width, piece.depth) / 2;
    if (segmentPointDistance2D(a, b, piece.position) > r) continue;
    const la = { ...toLocal(piece, a), z: a.z };
    const lb = { ...toLocal(piece, b), z: b.z };
    if (piece.hull) {
      if (segmentHitsMesh(la, lb, piece.hull)) return piece;
      continue;
    }
    for (const s of piece.solids) {
      if (!blocksSight(s)) continue;
      const min = { x: s.x - s.w / 2, y: s.y - s.d / 2, z: s.z };
      const max = { x: s.x + s.w / 2, y: s.y + s.d / 2, z: s.z + s.h };
      if (segmentHitsBox(la, lb, min, max)) return piece;
    }
  }
  return null;
}

/** Whether the segment a→b crosses any triangle of a flat [x,y,z,...] list (Möller–Trumbore). */
export function segmentHitsMesh(a: Vec3, b: Vec3, tris: number[]): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = tris.slice(i, i + 9) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const e1x = x1 - x0,
      e1y = y1 - y0,
      e1z = z1 - z0;
    const e2x = x2 - x0,
      e2y = y2 - y0,
      e2z = z2 - z0;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = a.x - x0,
      ty = a.y - y0,
      tz = a.z - z0;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    // Ignore the very ends, as for boxes.
    if (t > 0.001 && t < 0.999) return true;
  }
  return false;
}

/** A piece's stand-in height for "heights" line of sight. */
export function standInHeight(piece: TerrainPiece): number {
  if (piece.losHeight !== undefined) return piece.losHeight;
  return piece.solids.reduce((h, s) => Math.max(h, s.z + s.h), 0);
}

/** Whether the segment passes over a piece's footprint, low enough to be "through" it. */
export function segmentCrossesFootprint(piece: TerrainPiece, a: Vec3, b: Vec3, below: number): boolean {
  const la = { ...toLocal(piece, a), z: a.z };
  const lb = { ...toLocal(piece, b), z: b.z };
  const min = { x: -piece.width / 2, y: -piece.depth / 2, z: -1 };
  const max = { x: piece.width / 2, y: piece.depth / 2, z: below };
  return segmentHitsBox(la, lb, min, max);
}

export function segmentPointDistance2D(a: Vec2, b: Vec2, p: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len = abx * abx + aby * aby;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len));
  return Math.hypot(p.x - a.x - t * abx, p.y - a.y - t * aby);
}

/** Whether a straight ground move crosses a solid taller than `climb` (a wall in the way). */
export function moveCrossesWall(
  terrain: TerrainPiece[],
  from: Vec2,
  to: Vec2,
  z: number,
): TerrainPiece | null {
  const a = { ...from, z: z + 0.25 };
  const b = { ...to, z: z + 0.25 };
  return sightBlockedBy(terrain, a, b);
}
