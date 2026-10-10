import type { Model, Vec2 } from "./types";

/**
 * Moves in legs (round a ruin, say): a model's move this phase runs from its
 * phase start through its corners (`phaseVia`) to where it stands, and is
 * measured along them, not as the crow flies.
 */

/** Most corners one move keeps. */
export const MAX_CORNERS = 24;

/** The points of a model's move this phase, ending at `to` (where it stands), through `extra` corners last. */
export function movePath(m: Model, to: Vec2 = m.position, extra: Vec2[] = []): Vec2[] {
  return [m.phaseStart ?? m.position, ...(m.phaseVia ?? []), ...extra, to];
}

export function pathLength(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}

/** How far the model has come this phase (to `to`, through `extra` corners), along its legs. */
export function movedSoFar(m: Model, to: Vec2 = m.position, extra: Vec2[] = []): number {
  return pathLength(movePath(m, to, extra));
}

/** Each leg of a path, as from and to. */
export function legsOf(points: Vec2[]): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1]!, points[i]!]);
  return out;
}

/** The point `d` along a path (its end when the path is shorter). */
export function alongPath(points: Vec2[], d: number): Vec2 {
  let left = Math.max(0, d);
  for (const [a, b] of legsOf(points)) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len && len > 0)
      return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
    left -= len;
  }
  return points.at(-1)!;
}

/** Corners as an intent sends them: finite points, at most MAX_CORNERS. */
export function cleanCorners(via: unknown): Vec2[] {
  if (!Array.isArray(via)) return [];
  return via
    .filter((p): p is Vec2 => !!p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice(0, MAX_CORNERS)
    .map((p) => ({ x: p.x, y: p.y }));
}
