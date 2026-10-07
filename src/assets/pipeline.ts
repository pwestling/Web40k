import { MeshoptSimplifier } from "meshoptimizer";
import { boxProxy, figureProxy, hullTris } from "./proxy";
import { BUDGETS, type AssetKind, type AssetStats, type MeshData, type ModelAsset } from "./types";

export interface ProcessOptions {
  id: string;
  name: string;
  kind: AssetKind;
  /**
   * Source units to inches. Omit to guess: anything taller than a foot is
   * assumed to be millimetres, which is what print files and most sculpts use.
   */
  unitScale?: number;
}

/** Tallest thing, in inches, we believe was authored in inches. */
const MAX_INCH_HEIGHT = 12;

export const ready = MeshoptSimplifier.ready;

/**
 * Turn a raw upload into render levels and a rules proxy. Pure and
 * synchronous once `ready` has resolved, so it runs the same in a worker,
 * in Node tests and on every peer.
 */
export function processMesh(raw: MeshData, options: ProcessOptions): ModelAsset {
  const start = performance.now();
  const budget = BUDGETS[options.kind];
  const sourceTriangles = raw.indices.length / 3;
  const sourceVertices = raw.positions.length / 3;

  const welded = weld(raw);
  const unitScale = options.unitScale ?? guessUnitScale(welded.positions);
  const bounds = normalise(welded.positions, unitScale);

  // Each level simplifies the one before it: cheaper than going back to the
  // source every time, and the levels stay nested.
  const lods: MeshData[] = [];
  const lodErrors: number[] = [];
  let current = welded;
  for (const cap of budget.lods) {
    const [mesh, error] = simplify(current, cap, lods.length > 0);
    lods.push(mesh);
    lodErrors.push(error);
    current = mesh;
  }
  const proxy = sloppy(current, budget.proxy);

  const stats: AssetStats = {
    sourceTriangles,
    sourceVertices,
    lodTriangles: lods.map((l) => l.indices.length / 3),
    proxyTriangles: proxy.indices.length / 3,
    lodErrors,
    unitScale,
    ms: Math.round(performance.now() - start),
  };
  const asset: ModelAsset = { id: options.id, name: options.name, kind: options.kind, lods, proxy, bounds, stats };
  if (options.kind === "miniature") asset.figure = figureProxy(lods[0]!);
  else {
    asset.solids = boxProxy(lods[1] ?? lods[0]!);
    asset.hull = hullTris(proxy);
  }
  stats.ms = Math.round(performance.now() - start);
  return asset;
}

/**
 * Merge vertices that share a position. Loaders split vertices along UV and
 * normal seams; left split, the simplifier treats every seam as a border it
 * must not move and stalls well above the target.
 */
export function weld(mesh: MeshData): MeshData {
  const remap = MeshoptSimplifier.generatePositionRemap(mesh.positions, 3);
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[mesh.indices[i]!]!;
  return compact({ positions: mesh.positions, indices: dropDegenerate(indices) });
}

/** Keep only the vertices the indices use, renumbered in first-use order. */
function compact(mesh: MeshData): MeshData {
  const indices = mesh.indices.slice();
  const [remap, unique] = MeshoptSimplifier.compactMesh(indices);
  const positions = new Float32Array(unique * 3);
  for (let v = 0; v < remap.length; v++) {
    const to = remap[v]!;
    if (to === 0xffffffff) continue;
    positions[to * 3] = mesh.positions[v * 3]!;
    positions[to * 3 + 1] = mesh.positions[v * 3 + 1]!;
    positions[to * 3 + 2] = mesh.positions[v * 3 + 2]!;
  }
  return { positions, indices };
}

function dropDegenerate(indices: Uint32Array): Uint32Array {
  const out = new Uint32Array(indices.length);
  let n = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!;
    const b = indices[i + 1]!;
    const c = indices[i + 2]!;
    if (a === b || b === c || a === c) continue;
    out[n++] = a;
    out[n++] = b;
    out[n++] = c;
  }
  return out.slice(0, n);
}

export function guessUnitScale(positions: Float32Array): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    lo = Math.min(lo, positions[i]!);
    hi = Math.max(hi, positions[i]!);
  }
  return hi - lo > MAX_INCH_HEIGHT ? 1 / 25.4 : 1;
}

/** Scale to inches, centre the footprint on the origin and stand it on y = 0. In place. */
function normalise(positions: Float32Array, scale: number): ModelAsset["bounds"] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i]! * scale;
    positions[i] = v;
    const a = i % 3;
    if (v < min[a]!) min[a] = v;
    if (v > max[a]!) max[a] = v;
  }
  const offset = [-(min[0]! + max[0]!) / 2, -min[1]!, -(min[2]! + max[2]!) / 2];
  for (let i = 0; i < positions.length; i++) positions[i] = positions[i]! + offset[i % 3]!;
  return {
    min: [min[0]! + offset[0]!, 0, min[2]! + offset[2]!],
    max: [max[0]! + offset[0]!, max[1]! + offset[1]!, max[2]! + offset[2]!],
  };
}

/**
 * Simplify to at most `triangles`. The attribute-free simplifier keeps the
 * silhouette; if the mesh's topology stops it short of the cap (lots of
 * small disconnected parts, open borders), fall back to the sloppy
 * simplifier, which always gets there.
 */
function simplify(mesh: MeshData, triangles: number, prune: boolean): [MeshData, number] {
  if (mesh.indices.length / 3 <= triangles) return [mesh, 0];
  const target = triangles * 3;
  const flags: ("Prune" | "ErrorAbsolute")[] = prune ? ["Prune"] : [];
  const [indices, error] = MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, 1, flags);
  if (indices.length <= target * 1.1) return [compact({ positions: mesh.positions, indices }), error];
  return [sloppy(mesh, triangles), 1];
}

function sloppy(mesh: MeshData, triangles: number): MeshData {
  if (mesh.indices.length / 3 <= triangles) return mesh;
  const [indices] = MeshoptSimplifier.simplifySloppy(mesh.indices, mesh.positions, 3, null, triangles * 3, 1);
  return compact({ positions: mesh.positions, indices });
}
