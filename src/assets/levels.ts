import type { MeshData, ModelAsset } from "./types";

const sameArray = (a?: ArrayLike<number>, b?: ArrayLike<number>) => {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const sameMesh = (a: MeshData, b: MeshData) =>
  sameArray(a.positions, b.positions) &&
  sameArray(a.indices, b.indices) &&
  sameArray(a.uvs, b.uvs) &&
  sameArray(a.colors, b.colors);

/**
 * A small model keeps one mesh for every level (it was already under budget),
 * but a decoded copy has a mesh per level: share them again, so the model
 * takes the space it took where it was made, in memory, on the GPU and in
 * the cache (IndexedDB stores a shared array once). UX 242.
 */
export function shareLevels(asset: ModelAsset): ModelAsset {
  const lods: MeshData[] = [];
  for (const mesh of asset.lods) lods.push(lods.find((m) => sameMesh(m, mesh)) ?? mesh);
  const proxy = lods.find((m) => sameMesh(m, asset.proxy)) ?? asset.proxy;
  if (proxy === asset.proxy && lods.every((m, i) => m === asset.lods[i])) return asset;
  return { ...asset, lods, proxy };
}
