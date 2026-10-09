import { ShapeUtils, Vector2 } from "three";
import type { Box, Mask } from "./cutout";

/**
 * A standee's shape (#68): the cut-out's outline, traced and smoothed, made
 * into a thin card with the photo on the front and the back photo (or the
 * front, mirrored and darker) behind. Cut along the miniature's outline, so it
 * needs no transparency and draws like any other figure.
 *
 * Inches, y up, the card in the x/y plane facing +z (a model's front).
 */

type Pt = [number, number];

/** The grid the outline is traced on: the mask's box, at most this many cells on its long side. */
const GRID = 160;
/** How far, in cells, the smoothed outline may stray from the traced one. */
const SMOOTH = 0.7;
/** The card's thickness, in inches. */
export const THICKNESS = 0.04;

interface StandeeShape {
  positions: Float32Array;
  indices: Uint32Array;
  /** Into an atlas with the front on its left half and the back on its right (v down). */
  uvs: Float32Array;
}

/**
 * Trace the outlines of a mask (marching squares on a coarse grid over `box`):
 * closed loops in grid cells, outer outlines one way round and holes the other.
 */
export function traceOutlines(mask: Mask, w: number, box: Box): { loops: Pt[][]; cell: number } {
  const cell = Math.max(1, Math.max(box.width, box.height) / GRID);
  const gw = Math.ceil(box.width / cell) + 2;
  const gh = Math.ceil(box.height / cell) + 2;
  // Sample: a grid point is in when most of its cell's pixels are kept. One cell of empty border round it.
  const inside = new Uint8Array(gw * gh);
  for (let gy = 1; gy < gh - 1; gy++)
    for (let gx = 1; gx < gw - 1; gx++) {
      const x0 = box.x + Math.floor((gx - 1) * cell);
      const y0 = box.y + Math.floor((gy - 1) * cell);
      const x1 = Math.min(box.x + box.width, Math.max(x0 + 1, Math.floor(gx * cell)));
      const y1 = Math.min(box.y + box.height, Math.max(y0 + 1, Math.floor(gy * cell)));
      let kept = 0;
      let all = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          all++;
          if (mask[y * w + x]) kept++;
        }
      inside[gy * gw + gx] = all && kept * 2 >= all ? 1 : 0;
    }
  const at = (x: number, y: number) => inside[y * gw + x]!;
  // Edges between in and out cells, each directed with the inside on its left, keyed by start point.
  const next = new Map<string, Pt[]>();
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const add = (a: Pt, b: Pt) => {
    const k = key(a);
    const list = next.get(k);
    if (list) list.push(b);
    else next.set(k, [b]);
  };
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      if (!at(x, y)) continue;
      // Cell (x, y) spans corners (x, y) to (x+1, y+1); walk its edges that face out, counter-clockwise (y down).
      if (y === 0 || !at(x, y - 1)) add([x + 1, y], [x, y]);
      if (x === 0 || !at(x - 1, y)) add([x, y], [x, y + 1]);
      if (y === gh - 1 || !at(x, y + 1)) add([x, y + 1], [x + 1, y + 1]);
      if (x === gw - 1 || !at(x + 1, y)) add([x + 1, y + 1], [x + 1, y]);
    }
  const loops: Pt[][] = [];
  for (const [start, ends] of next) {
    while (ends.length) {
      const first = start.split(",").map(Number) as Pt;
      const loop: Pt[] = [first];
      let cur = ends.pop()!;
      let guard = 0;
      while (key(cur) !== start && guard++ < 1e6) {
        loop.push(cur);
        const list = next.get(key(cur));
        if (!list?.length) break;
        cur = list.pop()!;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  // Back to the photo's pixels (grid point 1 is the box's corner).
  const px = loops.map((l) => l.map(([x, y]) => [box.x + (x - 1) * cell, box.y + (y - 1) * cell] as Pt));
  return { loops: px, cell };
}

/** Douglas–Peucker on a closed loop: fewer points, within `eps` of the original. */
function simplifyLoop(loop: Pt[], eps: number): Pt[] {
  if (loop.length < 8) return loop;
  // Split at the two points farthest apart so both halves are open polylines.
  let far = 0;
  let best = -1;
  for (let i = 0; i < loop.length; i++) {
    const d = (loop[i]![0] - loop[0]![0]) ** 2 + (loop[i]![1] - loop[0]![1]) ** 2;
    if (d > best) [best, far] = [d, i];
  }
  const a = dp(loop.slice(0, far + 1), eps);
  const b = dp([...loop.slice(far), loop[0]!], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function dp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0]!;
  const [bx, by] = pts[pts.length - 1]!;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let idx = 0;
  let dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]!;
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > dmax) [dmax, idx] = [d, i];
  }
  if (dmax <= eps) return [pts[0]!, pts[pts.length - 1]!];
  return [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)];
}

const area = (loop: Pt[]) => {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i]!;
    const [x1, y1] = loop[(i + 1) % loop.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
};

function insideLoop(p: Pt, loop: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i]!;
    const [xj, yj] = loop[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

interface ShapeOptions {
  /** Inches per photo pixel. */
  scale: number;
  /** The cut-out's bounds in the photo: the atlas holds this box. */
  box: Box;
}

/**
 * The card: front and back faces cut to the outline, and its edge. UVs map
 * each face into its half of the atlas; the back is seen from behind, so its
 * half is mirrored.
 */
export function standeeShape(mask: Mask, w: number, options: ShapeOptions): StandeeShape {
  const { box, scale } = options;
  const { loops, cell } = traceOutlines(mask, w, box);
  const smooth = loops.map((l) => simplifyLoop(l, SMOOTH * cell)).filter((l) => l.length >= 3);
  // Outer outlines one way round, holes the other; each hole goes with the outline around it.
  const outers = smooth.filter((l) => area(l) < 0);
  const holes = smooth.filter((l) => area(l) > 0);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cx = box.x + box.width / 2;
  const bottom = box.y + box.height;
  const u = (x: number) => Math.min(1, Math.max(0, (x - box.x) / box.width));
  const v = (y: number) => Math.min(1, Math.max(0, (y - box.y) / box.height));
  const vertex = (x: number, y: number, z: number, back: boolean) => {
    positions.push((x - cx) * scale, (bottom - y) * scale, z);
    uvs.push(back ? 0.5 + (1 - u(x)) * 0.5 : u(x) * 0.5, v(y));
    return positions.length / 3 - 1;
  };
  const half = THICKNESS / 2;
  for (const outer of outers) {
    const mine = holes.filter((h) => insideLoop(h[0]!, outer));
    const contour = outer.map(([x, y]) => new Vector2(x, y));
    const hs = mine.map((h) => h.map(([x, y]) => new Vector2(x, y)));
    const tris = ShapeUtils.triangulateShape(contour, hs);
    const all = [...outer, ...mine.flat()];
    const front = all.map(([x, y]) => vertex(x, y, half, false));
    const back = all.map(([x, y]) => vertex(x, y, -half, true));
    // Photo y runs down, so a triangle earcut gives is clockwise seen from +z: flip it for the front.
    for (const [a, b, c] of tris as [number, number, number][]) {
      indices.push(front[a]!, front[c]!, front[b]!);
      indices.push(back[a]!, back[b]!, back[c]!);
    }
    // The edge: a strip round every loop, coloured from the front's rim.
    for (const loop of [outer, ...mine]) {
      for (let i = 0; i < loop.length; i++) {
        const [x0, y0] = loop[i]!;
        const [x1, y1] = loop[(i + 1) % loop.length]!;
        const a = vertex(x0, y0, half, false);
        const b = vertex(x1, y1, half, false);
        const c = vertex(x1, y1, -half, false);
        const d = vertex(x0, y0, -half, false);
        indices.push(a, c, b, a, d, c);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
  };
}
