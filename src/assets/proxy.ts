import type { MeshData } from "./types";

/**
 * Rules proxies built from an uploaded mesh, in the shapes line of sight
 * already understands (see /mnt/project-files/engine/los-proxy-interface.md).
 * They go into game events, never the render meshes, so every peer gets the
 * same answer however detailed the sculpt is.
 *
 * Input meshes are normalised (inches, y up, footprint centred, standing on
 * y = 0). Output follows the engine's terrain convention: x right, y
 * forward, z up.
 */

/** A stepped cylinder: radius bands from the bottom of the figure up. */
export interface FigureProxy {
  height: number;
  bands: { r: number; z0: number; z1: number }[];
}

export interface Box {
  kind: "wall" | "floor" | "block";
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** Three figure bands plus the base keeps within the engine's four. */
const BANDS = 3;
/**
 * Radius percentile per band. A spear or banner sticking out shouldn't turn
 * the whole band into a wide disc that is "visible" through every gap.
 */
const RADIUS_PERCENTILE = 0.9;

export function figureProxy(mesh: MeshData): FigureProxy {
  const p = mesh.positions;
  let height = 0;
  for (let i = 1; i < p.length; i += 3) height = Math.max(height, p[i]!);
  const radii: number[][] = Array.from({ length: BANDS }, () => []);
  for (let i = 0; i < p.length; i += 3) {
    // Rounding can leave a vertex a hair below the feet (y = 0): it belongs to the lowest band.
    const band = Math.max(0, Math.min(BANDS - 1, Math.floor((p[i + 1]! / height) * BANDS)));
    radii[band]!.push(Math.hypot(p[i]!, p[i + 2]!));
  }
  const bands: FigureProxy["bands"] = [];
  radii.forEach((rs, b) => {
    rs.sort((a, c) => a - c);
    const r = rs.length ? rs[Math.min(rs.length - 1, Math.floor(rs.length * RADIUS_PERCENTILE))]! : 0;
    const z0 = (b / BANDS) * height;
    const z1 = ((b + 1) / BANDS) * height;
    const last = bands[bands.length - 1];
    // Merge bands of about the same width.
    if (last && Math.abs(last.r - r) <= 0.1 * Math.max(last.r, r)) {
      last.r = Math.max(last.r, r);
      last.z1 = z1;
    } else bands.push({ r: round(r), z0: round(z0), z1: round(z1) });
  });
  for (const band of bands) band.z1 = round(band.z1);
  return { height: round(height), bands };
}

/**
 * Rules geometry for a terrain model, rebuilt from its visual mesh (a TTS
 * collider is never trusted): voxelise the surface, fill the inside, then
 *
 * - stand-on boxes (`floor`, `block`): the tops of solid columns with room
 *   above them where a 1" base fits, levelled across rubble, each box the
 *   solid run under its level so a model put inside steps up onto it;
 * - sight boxes (`wall`): every solid voxel merged into boxes, small enough
 *   to keep windows, minus loose rubble lying on a floor.
 *
 * Fine voxels first; the sight boxes coarsen when a model needs too many.
 */
export function terrainProxy(mesh: MeshData): Box[] {
  const fine = voxelise(mesh, CELL);
  const stand = standBoxes(fine);
  for (let cell = CELL, grid = fine; ; cell *= 2, grid = voxelise(mesh, cell)) {
    const sight = sightBoxes(grid, stand);
    if (sight.length <= MAX_SIGHT || cell >= CELL * 16) return [...stand, ...sight.slice(0, MAX_SIGHT)];
  }
}

/** How far samples keep in from a triangle's edges, as a share of the way to its middle. */
const EDGE_IN = 0.01;
/** Voxel size to start from, inches. */
const CELL = 0.25;
/** Most sight boxes a piece may have before the voxels coarsen. */
const MAX_SIGHT = 160;
/** Most stand-on boxes before neighbouring levels merge more loosely. */
const MAX_STAND = 64;
/** Room a model needs above a level to stand there, inches. */
const HEADROOM = 1;
/** A small base: a level must have this much of itself, square, to be stood on. */
const BASE = 1;
/** Levels this close count as the same floor (rubble, a warped slab). */
const SAME_FLOOR = 0.35;
/** Loose bits lower than this over the floor under them, and smaller across, don't block sight. */
const DEBRIS = 0.6;

interface Grid {
  n: [number, number, number];
  step: [number, number, number];
  min: [number, number, number];
  size: [number, number, number];
  solid: Uint8Array;
  /** The highest surface sample in each voxel (y up), -Infinity where only filled in. */
  top: Float32Array;
}

const at = (g: Grid, x: number, y: number, z: number) => (x * g.n[1] + y) * g.n[2] + z;

function voxelise(mesh: MeshData, cell: number): Grid {
  const p = mesh.positions;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, p[i]!);
    max[i % 3] = Math.max(max[i % 3]!, p[i]!);
  }
  const size = [0, 1, 2].map((a) => Math.max(max[a]! - min[a]!, 1e-6)) as Grid["size"];
  // Never more than 128 voxels a side.
  const step = [0, 1, 2].map((a) => Math.max(cell, size[a]! / 128)) as Grid["step"];
  const n = [0, 1, 2].map((a) => Math.max(1, Math.ceil(size[a]! / step[a]! - 1e-6))) as Grid["n"];
  const g: Grid = { n, step, min, size, solid: new Uint8Array(n[0] * n[1] * n[2]), top: new Float32Array(0) };
  g.top = new Float32Array(g.solid.length).fill(-Infinity);
  const voxel = (v: number, a: number) =>
    Math.min(n[a]! - 1, Math.max(0, Math.floor((v - min[a]!) / step[a]!)));

  // Mark voxels the surface passes through by sampling each triangle densely enough.
  const idx = mesh.indices;
  const minStep = Math.min(...step);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3;
    const b = idx[t + 1]! * 3;
    const c = idx[t + 2]! * 3;
    const edge = Math.max(dist(p, a, b), dist(p, b, c), dist(p, c, a));
    const k = Math.max(1, Math.ceil((edge / minStep) * 2));
    // Sample a hair inside the surface, so a face lying exactly on a voxel
    // boundary marks the voxel behind it and not the empty one in front.
    const [nx0, ny0, nz0] = inward(p, a, b, c, minStep * 0.01);
    // And a hair in from its edges, so an edge on a voxel boundary doesn't mark the voxel beyond it either.
    for (let i = 0; i <= k; i++) {
      for (let j = 0; j <= k - i; j++) {
        const u = (i / k) * (1 - EDGE_IN) + EDGE_IN / 3;
        const v = (j / k) * (1 - EDGE_IN) + EDGE_IN / 3;
        const w = 1 - u - v;
        const y = p[a + 1]! * w + p[b + 1]! * u + p[c + 1]! * v;
        const vi = at(
          g,
          voxel(p[a]! * w + p[b]! * u + p[c]! * v + nx0, 0),
          voxel(y + ny0, 1),
          voxel(p[a + 2]! * w + p[b + 2]! * u + p[c + 2]! * v + nz0, 2),
        );
        g.solid[vi] = 1;
        if (y > g.top[vi]!) g.top[vi] = y;
      }
    }
  }

  // Fill the inside: anything empty that can't be reached from outside.
  const [nx, ny, nz] = n;
  const outside = new Uint8Array(g.solid.length);
  const stack: number[] = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const edge = x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1;
        const i = at(g, x, y, z);
        if (edge && !g.solid[i] && !outside[i]) {
          outside[i] = 1;
          stack.push(i);
        }
      }
  while (stack.length) {
    const i = stack.pop()!;
    const z = i % nz;
    const y = Math.floor(i / nz) % ny;
    const x = Math.floor(i / (nz * ny));
    for (const [dx, dy, dz] of NEIGHBOURS) {
      const X = x + dx;
      const Y = y + dy;
      const Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const j = at(g, X, Y, Z);
      if (g.solid[j] || outside[j]) continue;
      outside[j] = 1;
      stack.push(j);
    }
  }
  for (let i = 0; i < g.solid.length; i++) if (!outside[i]) g.solid[i] = 1;
  return g;
}

/** A place to stand in one column: the level, and the voxel row its solid run starts at. */
interface Spot {
  level: number;
  from: number;
}

function standBoxes(g: Grid): Box[] {
  const [nx, ny, nz] = g.n;
  const col = (x: number, z: number) => x * nz + z;
  const spots: Spot[][] = Array.from({ length: nx * nz }, () => []);
  const room = Math.ceil(HEADROOM / g.step[1] - 1e-6);
  for (let x = 0; x < nx; x++)
    for (let z = 0; z < nz; z++) {
      let y = 0;
      while (y < ny) {
        if (!g.solid[at(g, x, y, z)]) {
          y++;
          continue;
        }
        const from = y;
        while (y < ny && g.solid[at(g, x, y, z)]) y++;
        let free = 0;
        while (y + free < ny && !g.solid[at(g, x, y + free, z)]) free++;
        if (y + free < ny && free < room) continue;
        const sampled = g.top[at(g, x, y - 1, z)]!;
        const level = Number.isFinite(sampled) ? sampled : g.min[1] + y * g.step[1];
        if (level - g.min[1] > 0.05) spots[col(x, z)]!.push({ level, from });
      }
    }

  // Keep a spot only where a base fits on that floor: a BASE-wide square of columns, all with a level near it.
  const k = [0, 2].map((a) => Math.max(1, Math.ceil(BASE / g.step[a]! - 1e-6))) as [number, number];
  const near = (x: number, z: number, level: number) =>
    spots[col(x, z)]!.find((s) => Math.abs(s.level - level) <= SAME_FLOOR);
  const fits = (x: number, z: number, level: number) => {
    for (let x0 = Math.max(0, x - k[0] + 1); x0 <= Math.min(x, nx - k[0]); x0++)
      search: for (let z0 = Math.max(0, z - k[1] + 1); z0 <= Math.min(z, nz - k[1]); z0++) {
        for (let i = x0; i < x0 + k[0]; i++)
          for (let j = z0; j < z0 + k[1]; j++) if (!near(i, j, level)) continue search;
        return true;
      }
    return false;
  };
  const kept: Spot[][] = spots.map((list, c) =>
    list.filter((s) => fits(Math.floor(c / nz), c % nz, s.level)),
  );
  // Level each spot with its neighbours on the same floor (their lower quarter): rubble doesn't lift a model unless
  // it covers the floor, and slopes stay slopes.
  const levelled: Spot[][] = kept.map((list, c) => {
    const x = Math.floor(c / nz);
    const z = c % nz;
    return list.map((s) => {
      const around: number[] = [];
      for (let i = Math.max(0, x - 2); i <= Math.min(nx - 1, x + 2); i++)
        for (let j = Math.max(0, z - 2); j <= Math.min(nz - 1, z + 2); j++) {
          const o = kept[col(i, j)]!.find((t) => Math.abs(t.level - s.level) <= SAME_FLOOR);
          if (o) around.push(o.level);
        }
      around.sort((a, b) => a - b);
      return { level: around[Math.floor(around.length / 4)] ?? s.level, from: s.from };
    });
  });

  for (let tolerance = 0.12; ; tolerance *= 2) {
    const boxes = mergeSpots(g, levelled, tolerance);
    if (boxes.length <= MAX_STAND || tolerance > SAME_FLOOR) return boxes.slice(0, MAX_STAND);
  }
}

/** Greedy rectangles of spots on about the same level over the same run, each a box from the run's foot to the level. */
function mergeSpots(g: Grid, spots: Spot[][], tolerance: number): Box[] {
  const [nx, , nz] = g.n;
  const col = (x: number, z: number) => x * nz + z;
  const used = spots.map((list) => list.map(() => false));
  const take = (x: number, z: number, seed: Spot) =>
    spots[col(x, z)]!.findIndex(
      (s, i) => !used[col(x, z)]![i] && s.from === seed.from && Math.abs(s.level - seed.level) <= tolerance,
    );
  const boxes: Box[] = [];
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++)
      spots[col(x, z)]!.forEach((seed, si) => {
        if (used[col(x, z)]![si]) return;
        used[col(x, z)]![si] = true;
        let x1 = x + 1;
        while (x1 < nx && take(x1, z, seed) >= 0) x1++;
        let z1 = z + 1;
        while (z1 < nz && range(x, x1).every((i) => take(i, z1, seed) >= 0)) z1++;
        let sum = 0;
        let count = 0;
        for (let i = x; i < x1; i++)
          for (let j = z; j < z1; j++) {
            const c = col(i, j);
            const t = i === x && j === z ? si : take(i, j, seed);
            if (t < 0) continue;
            used[c]![t] = true;
            sum += spots[c]![t]!.level;
            count++;
          }
        const w = Math.min(x1 * g.step[0], g.size[0]) - x * g.step[0];
        const d = Math.min(z1 * g.step[2], g.size[2]) - z * g.step[2];
        const foot = g.min[1] + seed.from * g.step[1];
        const h = Math.max(0.05, sum / count - foot);
        boxes.push({
          kind: h <= 0.6 ? "floor" : "block",
          x: round(g.min[0] + x * g.step[0] + w / 2),
          y: round(g.min[2] + z * g.step[2] + d / 2),
          z: round(foot),
          w: round(w),
          d: round(d),
          h: round(h),
        });
      });
  return boxes;
}

/** Every solid voxel in boxes that block sight, without loose rubble lying on the floors. */
function sightBoxes(g: Grid, stand: Box[]): Box[] {
  const [nx, ny, nz] = g.n;
  const used = new Uint8Array(g.solid.length);
  const free = (x: number, y: number, z: number) => g.solid[at(g, x, y, z)] && !used[at(g, x, y, z)];
  const boxes: Box[] = [];
  // Greedy merge: grow each box along x, then z (forward), then y (up).
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        if (!free(x, y, z)) continue;
        let x1 = x + 1;
        while (x1 < nx && free(x1, y, z)) x1++;
        let z1 = z + 1;
        while (z1 < nz && range(x, x1).every((i) => free(i, y, z1))) z1++;
        let y1 = y + 1;
        while (y1 < ny && range(x, x1).every((i) => range(z, z1).every((k) => free(i, y1, k)))) y1++;
        for (let i = x; i < x1; i++)
          for (let j = y; j < y1; j++) for (let k = z; k < z1; k++) used[at(g, i, j, k)] = 1;
        const w = Math.min(x1 * g.step[0], g.size[0]) - x * g.step[0];
        const h = Math.min(y1 * g.step[1], g.size[1]) - y * g.step[1];
        const d = Math.min(z1 * g.step[2], g.size[2]) - z * g.step[2];
        boxes.push({
          kind: "wall",
          x: round(g.min[0] + x * g.step[0] + w / 2),
          y: round(g.min[2] + z * g.step[2] + d / 2),
          z: round(g.min[1] + y * g.step[1]),
          w: round(w),
          d: round(d),
          h: round(h),
        });
      }
  const floorUnder = (b: Box) =>
    Math.max(
      g.min[1],
      ...stand
        .filter(
          (s) => Math.abs(b.x - s.x) <= s.w / 2 && Math.abs(b.y - s.y) <= s.d / 2 && s.z + s.h <= b.z + 0.05,
        )
        .map((s) => s.z + s.h),
    );
  return boxes.filter((b) => Math.max(b.w, b.d, b.h) >= DEBRIS || b.z + b.h > floorUnder(b) + DEBRIS);
}

const NEIGHBOURS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

/** Offset of length `len` against the triangle's outward (counter-clockwise) normal. */
function inward(p: Float32Array, a: number, b: number, c: number, len: number): [number, number, number] {
  const ux = p[b]! - p[a]!;
  const uy = p[b + 1]! - p[a + 1]!;
  const uz = p[b + 2]! - p[a + 2]!;
  const vx = p[c]! - p[a]!;
  const vy = p[c + 1]! - p[a + 1]!;
  const vz = p[c + 2]! - p[a + 2]!;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [(-nx / l) * len, (-ny / l) * len, (-nz / l) * len];
}

function dist(p: Float32Array, a: number, b: number): number {
  return Math.hypot(p[a]! - p[b]!, p[a + 1]! - p[b + 1]!, p[a + 2]! - p[b + 2]!);
}

const round = (v: number) => Math.round(v * 1000) / 1000;
