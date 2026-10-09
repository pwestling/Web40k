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

/**
 * Outlines already worked out, by model: game states are immutable, so a model
 * object keeps its outline; the position, facing and base are checked anyway.
 * The bot and the game review measure the same bases tens of thousands of
 * times a decision (perf/results.md, #63).
 */
const outlines = new WeakMap<
  object,
  { position: Vec2; x: number; y: number; facing: number; base: BaseShape; outline: Vec2[] }
>();

/** The base outline as a convex polygon in table space (curves approximated). Shared: don't change it. */
export function baseOutline(model: Pick<Model, "position" | "facing" | "base">): Vec2[] {
  const was = outlines.get(model);
  const { position, facing, base } = model;
  if (
    was &&
    was.position === position &&
    was.x === position.x &&
    was.y === position.y &&
    was.facing === facing &&
    was.base === base
  )
    return was.outline;
  const outline = outlineOf(model);
  outlines.set(model, { position, x: position.x, y: position.y, facing, base, outline });
  return outline;
}

/** The furthest a base's edge is from its centre, in inches. */
export function baseReach(base: BaseShape): number {
  const s = baseSizeInches(base);
  return base.shape === "round" ? s.width / 2 : Math.hypot(s.width, s.depth) / 2;
}

/**
 * Whether two bases are within `range` of each other, edge to edge: as
 * `baseToBaseDistance(a, b) <= range`, but bases whose centres are too far
 * apart for that are ruled out before the outline maths.
 */
export function basesWithin(a: Model, b: Model, range: number): boolean {
  const centres = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
  if (centres - baseReach(a.base) - baseReach(b.base) > range) return false;
  return baseToBaseDistance(a, b) <= range;
}

function outlineOf(model: Pick<Model, "position" | "facing" | "base">): Vec2[] {
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
  // Two models that haven't changed are as far apart as they were: kept by model pair, as outlines are.
  let byB = gaps.get(a);
  if (!byB) gaps.set(a, (byB = new WeakMap()));
  const was = byB.get(b);
  if (was && was.a === baseOutline(a) && was.b === baseOutline(b)) return was.d;
  const pa = baseOutline(a);
  const pb = baseOutline(b);
  const d = polygonDistance(pa, pb);
  byB.set(b, { a: pa, b: pb, d });
  return d;
}

const gaps = new WeakMap<object, WeakMap<object, { a: Vec2[]; b: Vec2[]; d: number }>>();

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

// The two below are on the bot's and the review's hottest path: no objects made per call.
function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** Separating axis test for convex polygons. */
function convexOverlap(p: Vec2[], q: Vec2[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const ax = a.y - b.y;
      const ay = b.x - a.x;
      let pMin = Infinity;
      let pMax = -Infinity;
      for (const v of p) {
        const d = v.x * ax + v.y * ay;
        pMin = Math.min(pMin, d);
        pMax = Math.max(pMax, d);
      }
      let qMin = Infinity;
      let qMax = -Infinity;
      for (const v of q) {
        const d = v.x * ax + v.y * ay;
        qMin = Math.min(qMin, d);
        qMax = Math.max(qMax, d);
      }
      if (pMax < qMin || qMax < pMin) return false;
    }
  }
  return true;
}
