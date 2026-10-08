import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { shareLevels } from "./levels";
import { encodeTexture } from "./paint";
import type { RawModel } from "./parse";
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

export const ready = Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]).then(() => undefined);

/** processMesh, plus the paint: the atlas compressed within the texture budget. */
export async function processModel(raw: RawModel, options: ProcessOptions): Promise<ModelAsset> {
  const { atlas, sourceTexture, ...mesh } = raw;
  const asset = processMesh(mesh, options);
  if (atlas) {
    const start = performance.now();
    asset.texture = await encodeTexture(atlas, BUDGETS[options.kind].texture);
    asset.stats.textureBytes = asset.texture.bytes.byteLength;
    if (sourceTexture) asset.stats.sourceTexture = sourceTexture;
    asset.stats.ms += Math.round(performance.now() - start);
  }
  return asset;
}

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
  // Vertex order for the GPU's cache, which also makes the meshes compress well for peers (codec.ts).
  const ordered = new Map<MeshData, MeshData>();
  const order = (m: MeshData) => ordered.get(m) ?? ordered.set(m, reorder(m)).get(m)!;
  // The proxy is rules geometry only: no paint.
  const coarse = sloppy(current, budget.proxy);
  const proxy = order({ positions: coarse.positions, indices: coarse.indices });
  lods.splice(0, lods.length, ...lods.map(order));

  const stats: AssetStats = {
    sourceTriangles,
    sourceVertices,
    lodTriangles: lods.map((l) => l.indices.length / 3),
    proxyTriangles: proxy.indices.length / 3,
    lodErrors,
    unitScale,
    ms: Math.round(performance.now() - start),
  };
  const asset: ModelAsset = {
    id: options.id,
    name: options.name,
    kind: options.kind,
    lods,
    proxy,
    bounds,
    stats,
  };
  if (options.kind === "miniature") asset.figure = figureProxy(lods[0]!);
  else {
    asset.solids = boxProxy(lods[1] ?? lods[0]!);
    asset.hull = hullTris(proxy);
  }
  stats.ms = Math.round(performance.now() - start);
  // A small model's proxy can come out the same as its coarsest level: keep one copy, as a peer's decode does.
  return shareLevels(asset);
}

/**
 * Merge vertices that share a position (and, on painted models, the same
 * uv and colour). Loaders split vertices along UV and normal seams; left
 * split, the simplifier treats every seam as a border it must not move and
 * stalls well above the target. Paint seams stay split, and the simplifier
 * keeps them where they are.
 */
export function weld(mesh: MeshData): MeshData {
  const remap = MeshoptSimplifier.generatePositionRemap(mesh.positions, 3);
  if (mesh.uvs || mesh.colors) {
    const { uvs, colors } = mesh;
    const same = (a: number, b: number) =>
      (!uvs || (uvs[a * 2] === uvs[b * 2] && uvs[a * 2 + 1] === uvs[b * 2 + 1])) &&
      (!colors ||
        (colors[a * 4] === colors[b * 4] &&
          colors[a * 4 + 1] === colors[b * 4 + 1] &&
          colors[a * 4 + 2] === colors[b * 4 + 2] &&
          colors[a * 4 + 3] === colors[b * 4 + 3]));
    // Vertices at one position, chained from the first one seen there.
    const n = remap.length;
    const head = new Int32Array(n).fill(-1);
    const next = new Int32Array(n).fill(-1);
    for (let v = 0; v < n; v++) {
      const at = remap[v]!;
      let w = head[at]!;
      while (w !== -1 && !same(v, w)) w = next[w]!;
      if (w !== -1) remap[v] = w;
      else {
        next[v] = head[at]!;
        head[at] = v;
        remap[v] = v;
      }
    }
  }
  const indices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < indices.length; i++) indices[i] = remap[mesh.indices[i]!]!;
  return compact({ ...mesh, indices: dropDegenerate(indices) });
}

/** Keep only the vertices the indices use, renumbered in first-use order. */
function compact(mesh: MeshData): MeshData {
  const indices = mesh.indices.slice();
  const [remap, unique] = MeshoptSimplifier.compactMesh(indices);
  return withVertices(mesh, indices, remap, unique);
}

/** Vertex cache and fetch order (meshopt's reorderMesh): faster to draw, about 2x smaller compressed. */
function reorder(mesh: MeshData): MeshData {
  const indices = mesh.indices.slice();
  if (!indices.length) return mesh;
  const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
  return withVertices(mesh, indices, remap, unique);
}

/** `mesh`'s vertices moved to `remap[old]` (0xffffffff: dropped), every attribute with them. */
function withVertices(mesh: MeshData, indices: Uint32Array, remap: Uint32Array, unique: number): MeshData {
  const out: MeshData = { positions: new Float32Array(unique * 3), indices };
  if (mesh.uvs) out.uvs = new Float32Array(unique * 2);
  if (mesh.colors) out.colors = new Uint8Array(unique * 4);
  for (let v = 0; v < remap.length; v++) {
    const to = remap[v]!;
    if (to === 0xffffffff) continue;
    out.positions.set(mesh.positions.subarray(v * 3, v * 3 + 3), to * 3);
    if (out.uvs) out.uvs.set(mesh.uvs!.subarray(v * 2, v * 2 + 2), to * 2);
    if (out.colors) out.colors.set(mesh.colors!.subarray(v * 4, v * 4 + 4), to * 4);
  }
  return out;
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
  const flags: ("Prune" | "Permissive")[] = prune ? ["Prune"] : [];
  const paint = paintAttributes(mesh);
  const run = (permissive: boolean) =>
    paint
      ? MeshoptSimplifier.simplifyWithAttributes(
          mesh.indices,
          mesh.positions,
          3,
          paint.values,
          paint.stride,
          paint.weights,
          null,
          target,
          1,
          permissive ? [...flags, "Permissive"] : flags,
        )
      : MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, 1, flags);
  // Reached the cap without pruning away the whole mesh (Prune drops small parts outright).
  const ok = (n: number) => n > 0 && n <= target * 1.1;
  let [indices, error] = run(false);
  // Paint seams can stall it: let collapses cross them (a little texture smear) before going sloppy.
  if (paint && !ok(indices.length)) [indices, error] = run(true);
  if (ok(indices.length)) return [compact({ ...mesh, indices }), error];
  return [sloppy(mesh, triangles), 1];
}

/**
 * Paint as simplifier attributes, so collapses that would smear the texture
 * or blend colours cost more: uv (weight 1) and colour 0..1 (weight 0.5).
 */
function paintAttributes(mesh: MeshData) {
  const { uvs, colors } = mesh;
  if (!uvs && !colors) return null;
  const n = mesh.positions.length / 3;
  const stride = (uvs ? 2 : 0) + (colors ? 3 : 0);
  const values = new Float32Array(n * stride);
  for (let v = 0; v < n; v++) {
    let o = v * stride;
    if (uvs) {
      values[o++] = uvs[v * 2]!;
      values[o++] = uvs[v * 2 + 1]!;
    }
    if (colors) for (let c = 0; c < 3; c++) values[o++] = colors[v * 4 + c]! / 255;
  }
  const weights = [...(uvs ? [1, 1] : []), ...(colors ? [0.5, 0.5, 0.5] : [])];
  return { values, stride, weights };
}

function sloppy(mesh: MeshData, triangles: number): MeshData {
  if (mesh.indices.length / 3 <= triangles) return mesh;
  // The smallest error that reaches the cap: at error 1 it may collapse a small mesh to nothing.
  for (const error of [0.01, 0.03, 0.1, 0.3, 1]) {
    const [indices] = MeshoptSimplifier.simplifySloppy(
      mesh.indices,
      mesh.positions,
      3,
      null,
      triangles * 3,
      error,
    );
    if (indices.length && (indices.length <= triangles * 3 * 1.1 || error === 1))
      return compact({ ...mesh, indices });
  }
  return mesh;
}
