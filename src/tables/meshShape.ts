import type { TerrainPiece } from "../core";
import type { ModelAsset } from "../assets/types";

/** A piece's shape taken from a processed terrain model, at a scale. */
export function meshShape(
  asset: ModelAsset,
  scale: number,
): Pick<TerrainPiece, "width" | "depth" | "solids" | "hull" | "mesh"> {
  const { min, max } = asset.bounds;
  return {
    width: Math.max(0.5, (max[0] - min[0]) * scale),
    depth: Math.max(0.5, (max[2] - min[2]) * scale),
    solids: (asset.solids ?? []).map((b) => ({
      ...b,
      x: b.x * scale,
      y: b.y * scale,
      z: b.z * scale,
      w: b.w * scale,
      d: b.d * scale,
      h: b.h * scale,
    })),
    hull: asset.hull?.map((n) => n * scale),
    mesh: { asset: asset.id, name: asset.name, scale },
  };
}
