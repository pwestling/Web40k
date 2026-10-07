/**
 * Imported 3D assets: miniatures and terrain that players upload. Uploads are
 * often sculpts or print files with hundreds of thousands to millions of
 * triangles; the pipeline turns each one into a few render levels of detail
 * and a coarse proxy for rules geometry (line of sight, footprint, height).
 *
 * Units: processed assets are in inches (1 world unit = 1"), y up, with the
 * footprint centred on the origin and the lowest point at y = 0.
 */

/** A triangle mesh as flat arrays: xyz per vertex, three indices per triangle. */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

import type { Box, FigureProxy } from "./proxy";

export type AssetKind = "miniature" | "terrain";

/** Triangle caps for each level of detail. */
export interface Budget {
  /** Triangles per level, most detailed first. */
  lods: number[];
  /** Triangles in the rules proxy used for line of sight. */
  proxy: number;
}

/**
 * Per-asset caps. A full 40k table is ~100 to 200 miniatures plus ~10 to 20
 * terrain pieces; see /mnt/project-files/perf/budget.md for the scene budget
 * these add up to.
 */
export const BUDGETS: Record<AssetKind, Budget> = {
  miniature: { lods: [12_000, 3_000, 600], proxy: 200 },
  terrain: { lods: [60_000, 15_000, 3_000], proxy: 500 },
};

export interface AssetStats {
  sourceTriangles: number;
  sourceVertices: number;
  /** Triangles per level after simplification. */
  lodTriangles: number[];
  proxyTriangles: number;
  /** Relative simplification error per level (fraction of the mesh's size). */
  lodErrors: number[];
  /** How much the source was scaled to reach inches (1/25.4 for millimetres). */
  unitScale: number;
  ms: number;
}

export interface ModelAsset {
  /** SHA-256 of the uploaded file, hex. The asset's identity on every peer. */
  id: string;
  name: string;
  kind: AssetKind;
  /** Render levels, most detailed first. */
  lods: MeshData[];
  /** Coarse mesh, the source of `hull` (y up, like the render levels). */
  proxy: MeshData;
  /** Miniatures: height and sight bands relative to the figure's feet (see sightBands). */
  figure?: FigureProxy;
  /** Terrain: boxes for floors and line of sight (TerrainPiece.solids). */
  solids?: Box[];
  /** Terrain: low-poly hull for line of sight (TerrainPiece.hull), 9 numbers per triangle, z up. */
  hull?: number[];
  /** Axis-aligned bounds in inches after normalisation. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  stats: AssetStats;
}

/** Bump when the pipeline's output changes so cached assets are rebuilt. */
export const PIPELINE_VERSION = 2;
