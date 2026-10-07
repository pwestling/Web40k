import type { BaseShape, Model, Vec2 } from "./types";

export const MM_PER_INCH = 25.4;

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Base width (frontage) and depth in inches. */
export function baseSizeInches(base: BaseShape): { width: number; depth: number } {
  if (base.shape === "round")
    return { width: mmToInches(base.diameterMm), depth: mmToInches(base.diameterMm) };
  return { width: mmToInches(base.widthMm), depth: mmToInches(base.depthMm) };
}

/** Rotate a local offset (x = right, y = forward) by `facing` into table space. */
export function rotate(v: Vec2, facing: number): Vec2 {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c };
}

const CURVE_SEGMENTS = 48;

/** The base outline as a convex polygon in table space (curves approximated). */
export function baseOutline(model: Pick<Model, "position" | "facing" | "base">): Vec2[] {
  const { width, depth } = baseSizeInches(model.base);
  const local: Vec2[] =
    model.base.shape === "rect"
      ? [
          { x: -width / 2, y: -depth / 2 },
          { x: width / 2, y: -depth / 2 },
          { x: width / 2, y: depth / 2 },
          { x: -width / 2, y: depth / 2 },
        ]
      : Array.from({ length: CURVE_SEGMENTS }, (_, i) => {
          const a = (i / CURVE_SEGMENTS) * Math.PI * 2;
          return { x: (Math.cos(a) * width) / 2, y: (Math.sin(a) * depth) / 2 };
        });
  return local.map((p) => {
    const r = rotate(p, model.facing);
    return { x: r.x + model.position.x, y: r.y + model.position.y };
  });
}

/**
 * Shortest distance between two bases, measured edge to edge. This is how
 * most miniatures games measure; 0 means the bases touch or overlap.
 */
export function baseToBaseDistance(a: Model, b: Model): number {
  if (a.base.shape === "round" && b.base.shape === "round") {
    const r = mmToInches(a.base.diameterMm) / 2 + mmToInches(b.base.diameterMm) / 2;
    return Math.max(0, distance(a.position, b.position) - r);
  }
  return polygonDistance(baseOutline(a), baseOutline(b));
}

/** Distance between two convex polygons; 0 if they overlap. */
export function polygonDistance(p: Vec2[], q: Vec2[]): number {
  if (convexOverlap(p, q)) return 0;
  let best = Infinity;
  for (const [poly, other] of [
    [p, q],
    [q, p],
  ] as const) {
    for (const point of poly) {
      for (let i = 0; i < other.length; i++) {
        best = Math.min(best, pointSegmentDistance(point, other[i]!, other[(i + 1) % other.length]!));
      }
    }
  }
  return best;
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return distance(p, { x: a.x + t * abx, y: a.y + t * aby });
}

/** Separating axis test for convex polygons. */
function convexOverlap(p: Vec2[], q: Vec2[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const axis = { x: a.y - b.y, y: b.x - a.x };
      const [pMin, pMax] = project(p, axis);
      const [qMin, qMax] = project(q, axis);
      if (pMax < qMin || qMax < pMin) return false;
    }
  }
  return true;
}

function project(poly: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of poly) {
    const d = v.x * axis.x + v.y * axis.y;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return [min, max];
}
