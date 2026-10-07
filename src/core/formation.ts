import { baseSizeInches, rotate } from "./geometry";
import type { BaseShape, Vec2 } from "./types";

/**
 * Model offsets for a ranked block, relative to the centre of its front edge,
 * in local space (x = right, y = forward). Models fill the front rank first,
 * left to right, with bases touching.
 */
export function rankedOffsets(count: number, files: number, base: BaseShape): Vec2[] {
  const { width, depth } = baseSizeInches(base);
  const frontage = Math.min(files, count) * width;
  return Array.from({ length: count }, (_, i) => {
    const file = i % files;
    const rank = Math.floor(i / files);
    return { x: -frontage / 2 + width * (file + 0.5), y: -depth * (rank + 0.5) };
  });
}

/**
 * Rigidly move a group of positions: rotate them by `turn` around `pivot`,
 * then translate by `delta`. Used for whole-unit moves, wheels and pivots.
 */
export function transformPositions(positions: Vec2[], pivot: Vec2, turn: number, delta: Vec2): Vec2[] {
  return positions.map((p) => {
    const r = rotate({ x: p.x - pivot.x, y: p.y - pivot.y }, turn);
    return { x: pivot.x + r.x + delta.x, y: pivot.y + r.y + delta.y };
  });
}
