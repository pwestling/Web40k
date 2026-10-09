import { sightBlockedBy, type Vec3 } from "../core/terrain";
import type { TerrainPiece } from "../core/types";

/**
 * A close-up that sees the fight (PX Live now 7): in about a quarter of the
 * director's close-ups a ruin wall or a tree filled the frame. Before easing
 * in, look along the camera's line to the action; if terrain is in the way,
 * raise the camera, then swing it round, until the line is clear.
 *
 * Directions are three.js offsets from the target to the camera: x across the
 * table, y up, z along the table's depth (table y).
 */

/** Trees count for the camera (they hide the fight), though not for line of sight. */
function solidForCamera(terrain: TerrainPiece[]): TerrainPiece[] {
  return terrain.map((p) =>
    p.solids.some((s) => s.kind === "foliage")
      ? { ...p, solids: p.solids.map((s) => (s.kind === "foliage" ? { ...s, kind: "block" as const } : s)) }
      : p,
  );
}

const DEG = Math.PI / 180;
/** Never flatter than this when looking for a way round; never steeper than nearly overhead. */
const LOWEST = 20 * DEG;
const HIGHEST = 80 * DEG;

type Dir = [number, number, number];

function fromAngles(azimuth: number, elevation: number): Dir {
  const c = Math.cos(elevation);
  return [c * Math.sin(azimuth), Math.sin(elevation), c * Math.cos(azimuth)];
}

/**
 * The direction (unit, three.js) to put the camera at `distance` from the
 * focus so nothing stands between it and the action, or `dir` itself when
 * that is already clear. `focus` is on the table (x, y) with a height z;
 * `span` is how wide the action is, so its two sides are checked too.
 */
export function clearDirection(
  terrain: TerrainPiece[],
  focus: Vec3,
  span: number,
  dir: Dir,
  distance: number,
): Dir {
  if (!terrain.length) return dir;
  const pieces = solidForCamera(terrain);
  const len = Math.hypot(...dir) || 1;
  const [dx, dy, dz] = [dir[0] / len, dir[1] / len, dir[2] / len];
  const azimuth = Math.atan2(dx, dz);
  const elevation = Math.asin(Math.max(-1, Math.min(1, dy)));
  // The middle and both sides of the action, a little above the table, as the camera sees them.
  const side = { x: Math.cos(azimuth), y: -Math.sin(azimuth) };
  const half = Math.max(0, span / 2 - 1);
  const looks: Vec3[] = [0, -half, half].map((k) => ({
    x: focus.x + side.x * k,
    y: focus.y + side.y * k,
    z: focus.z + 1,
  }));
  const clear = (d: Dir) => {
    const eye = { x: focus.x + d[0] * distance, y: focus.y + d[2] * distance, z: focus.z + d[1] * distance };
    return looks.every((p) => !sightBlockedBy(pieces, eye, p));
  };
  const start = Math.max(LOWEST, elevation);
  const tries: Dir[] = [[dx, dy, dz]];
  for (let e = start; e <= HIGHEST + 1e-6; e += 10 * DEG) {
    for (const swing of [0, 25, -25, 50, -50]) tries.push(fromAngles(azimuth + swing * DEG, e));
  }
  return tries.find(clear) ?? fromAngles(azimuth, HIGHEST);
}
