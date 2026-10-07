import { baseOutline, polygonDistance } from "./geometry";
import type { GameState, Template, UnitId, Vec2 } from "./types";

const SEGMENTS = 40;

function circle(c: Vec2, r: number, n = SEGMENTS): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });
}

/** Convex hull (monotone chain), counter-clockwise. */
function hull(points: Vec2[]): Vec2[] {
  const ps = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (ps.length < 3) return ps;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of ps) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (const p of [...ps].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Where a flame's (or line's) far end is: `to`, or straight up the table when unset. */
export function templateEnd(t: Template): Vec2 {
  return t.to ?? { x: t.at.x, y: t.at.y + t.size };
}

/**
 * The template's outline on the table (convex). A circle is a polygon; a
 * flame is a teardrop from its point at `at` to a round end `size` away
 * towards `to`; a line is its two ends.
 */
export function templateOutline(t: Template): Vec2[] {
  if (t.shape === "circle") return circle(t.at, t.size / 2);
  const end = templateEnd(t);
  if (t.shape === "line") return [t.at, end];
  const dx = end.x - t.at.x;
  const dy = end.y - t.at.y;
  const len = Math.hypot(dx, dy) || 1;
  const r = (t.width ?? t.size / 3) / 2;
  const c = { x: t.at.x + (dx / len) * (t.size - r), y: t.at.y + (dy / len) * (t.size - r) };
  return hull([t.at, ...circle(c, r)]);
}

function insideConvex(p: Vec2, poly: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export interface TemplateHit {
  unitId: UnitId | undefined;
  /** Models whose whole base is under the template. */
  full: number;
  /** Models only partly under it (a line touches, so everything it crosses is here). */
  partial: number;
}

/** Models under a template, counted per unit: wholly under, and partly under. */
export function templateHits(state: GameState, t: Template): TemplateHit[] {
  const outline = templateOutline(t);
  const byUnit = new Map<UnitId | undefined, TemplateHit>();
  for (const m of Object.values(state.models)) {
    if (m.destroyed) continue;
    const base = baseOutline(m);
    if (polygonDistance(base, outline) > 1e-6) continue;
    const full = t.shape !== "line" && base.every((p) => insideConvex(p, outline));
    const hit = byUnit.get(m.unitId) ?? { unitId: m.unitId, full: 0, partial: 0 };
    if (full) hit.full++;
    else hit.partial++;
    byUnit.set(m.unitId, hit);
  }
  return [...byUnit.values()];
}
