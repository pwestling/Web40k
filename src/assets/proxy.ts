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
    const band = Math.min(BANDS - 1, Math.floor((p[i + 1]! / height) * BANDS));
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
 * Sight bands for a model wearing this figure, as `Model.bands` wants them:
 * inches above the bottom of the base, with the figure standing on a base
 * `baseTop` thick and scaled by `scale`.
 */
export function sightBands(figure: FigureProxy, scale: number, baseTop: number, baseRadius: number) {
  return [
    { r: round(baseRadius), z0: 0, z1: baseTop },
    ...figure.bands.map((b) => ({
      r: round(b.r * scale),
      z0: round(baseTop + b.z0 * scale),
      z1: round(baseTop + b.z1 * scale),
    })),
  ];
}

/** A y-up mesh as a flat z-up triangle list (x right, y forward, z up), for `TerrainPiece.hull`. */
export function hullTris(mesh: MeshData): number[] {
  const out: number[] = [];
  const p = mesh.positions;
  for (const i of mesh.indices) out.push(round(p[i * 3]!), round(p[i * 3 + 2]!), round(p[i * 3 + 1]!));
  return out;
}

/** Most boxes a terrain piece's proxy may have. */
export const MAX_BOXES = 32;

/**
 * Approximate a terrain mesh with at most `maxBoxes` axis-aligned boxes:
 * voxelise the surface, fill the inside, then merge voxels into boxes. If
 * there are too many boxes, retry with voxels twice the size.
 */
export function boxProxy(mesh: MeshData, maxBoxes = MAX_BOXES, startCell = 0.25): Box[] {
  let cell = startCell;
  for (let attempt = 0; attempt < 6; attempt++, cell *= 2) {
    const boxes = boxesAt(mesh, cell);
    if (boxes.length <= maxBoxes) return boxes;
  }
  // Give up on detail: one box around the whole thing.
  return [bounds(mesh)];
}

function bounds(mesh: MeshData): Box {
  const p = mesh.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, p[i]!);
    max[i % 3] = Math.max(max[i % 3]!, p[i]!);
  }
  const [w, h, d] = [0, 1, 2].map((a) => max[a]! - min[a]!) as [number, number, number];
  return {
    kind: classify(w, d, h),
    x: round((min[0]! + max[0]!) / 2),
    y: round((min[2]! + max[2]!) / 2),
    z: round(min[1]!),
    w: round(w),
    d: round(d),
    h: round(h),
  };
}

function boxesAt(mesh: MeshData, cell: number): Box[] {
  const p = mesh.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, p[i]!);
    max[i % 3] = Math.max(max[i % 3]!, p[i]!);
  }
  const size = [0, 1, 2].map((a) => max[a]! - min[a]!);
  // Never more than 128 voxels a side.
  const step = [0, 1, 2].map((a) => Math.max(cell, size[a]! / 128, 1e-6));
  const n = [0, 1, 2].map((a) => Math.max(1, Math.ceil(size[a]! / step[a]!)));
  const [nx, ny, nz] = n as [number, number, number];
  const at = (x: number, y: number, z: number) => (x * ny + y) * nz + z;
  const solid = new Uint8Array(nx * ny * nz);
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
    for (let i = 0; i <= k; i++) {
      for (let j = 0; j <= k - i; j++) {
        const u = i / k;
        const v = j / k;
        const w = 1 - u - v;
        solid[
          at(
            voxel(p[a]! * w + p[b]! * u + p[c]! * v + nx0, 0),
            voxel(p[a + 1]! * w + p[b + 1]! * u + p[c + 1]! * v + ny0, 1),
            voxel(p[a + 2]! * w + p[b + 2]! * u + p[c + 2]! * v + nz0, 2),
          )
        ] = 1;
      }
    }
  }

  // Fill the inside: anything empty that can't be reached from outside.
  const outside = new Uint8Array(solid.length);
  const stack: number[] = [];
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++) {
        const edge = x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1;
        const i = at(x, y, z);
        if (edge && !solid[i] && !outside[i]) {
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
      const j = at(X, Y, Z);
      if (solid[j] || outside[j]) continue;
      outside[j] = 1;
      stack.push(j);
    }
  }
  for (let i = 0; i < solid.length; i++) if (!outside[i]) solid[i] = 1;

  // Greedy merge: grow each box along x, then z (forward), then y (up).
  const used = new Uint8Array(solid.length);
  const free = (x: number, y: number, z: number) => solid[at(x, y, z)] && !used[at(x, y, z)];
  const boxes: Box[] = [];
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
          for (let j = y; j < y1; j++) for (let k = z; k < z1; k++) used[at(i, j, k)] = 1;
        const w = Math.min(x1 * step[0]!, size[0]!) - x * step[0]!;
        const h = Math.min(y1 * step[1]!, size[1]!) - y * step[1]!;
        const d = Math.min(z1 * step[2]!, size[2]!) - z * step[2]!;
        boxes.push({
          kind: classify(w, d, h),
          x: round(min[0]! + x * step[0]! + w / 2),
          y: round(min[2]! + z * step[2]! + d / 2),
          z: round(min[1]! + y * step[1]!),
          w: round(w),
          d: round(d),
          h: round(h),
        });
      }
  return boxes;
}

/** Flat boxes are floors models can stand on; thin tall ones are walls. */
function classify(w: number, d: number, h: number): Box["kind"] {
  if (h <= 0.6 && Math.min(w, d) > 1) return "floor";
  if (Math.min(w, d) <= 1 && h > 1) return "wall";
  return "block";
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
