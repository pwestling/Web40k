import type { Layout, TerrainPiece, Vec2 } from "../../core";

/** Point in a terrain piece's footprint. */
export function pointInTerrain(p: Vec2, piece: TerrainPiece): boolean {
  const dx = p.x - piece.position.x;
  const dy = p.y - piece.position.y;
  const c = Math.cos(piece.facing);
  const s = Math.sin(piece.facing);
  // Inverse of the local-to-table rotation used for walls.
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= piece.width / 2 && Math.abs(ly) <= piece.depth / 2;
}

function ruin(id: string, x: number, y: number, width: number, depth: number, facing: number): TerrainPiece {
  const h = 4;
  // An L of walls along the back and left edges of the footprint.
  return {
    id,
    kind: "ruin",
    position: { x, y },
    width,
    depth,
    facing,
    walls: [
      { from: { x: -width / 2, y: -depth / 2 }, to: { x: width / 2 - 1, y: -depth / 2 }, height: h },
      { from: { x: -width / 2, y: -depth / 2 }, to: { x: -width / 2, y: depth / 2 - 1 }, height: h },
    ],
  };
}

/**
 * A generic, point-symmetric layout for a 60" x 44" table: eight ruins,
 * five objectives and 12"-deep deployment zones on the long edges. Seat 0
 * deploys along the +y edge, seat 1 along the -y edge.
 */
export function standardLayout(width = 60, depth = 44): Layout {
  const half: [string, number, number, number, number, number][] = [
    ["a", -12, 7, 10, 5, 0],
    ["b", -24, -9, 6, 9, Math.PI / 2],
    ["c", -5, -7, 7, 4, Math.PI],
    ["d", -21, 13, 8, 5, Math.PI / 2],
  ];
  const terrain: TerrainPiece[] = [];
  for (const [id, x, y, w, d, f] of half) {
    terrain.push(ruin(`${id}1`, x, y, w, d, f));
    // The mirror image through the table centre.
    terrain.push(ruin(`${id}2`, -x, -y, w, d, f + Math.PI));
  }
  const hx = width / 2;
  const hy = depth / 2;
  const zone = (seat: number, y0: number, y1: number) => ({
    seat,
    points: [
      { x: -hx, y: y0 },
      { x: hx, y: y0 },
      { x: hx, y: y1 },
      { x: -hx, y: y1 },
    ],
  });
  return {
    terrain,
    objectives: [
      { id: "o1", position: { x: 0, y: 0 } },
      { id: "o2", position: { x: -20, y: 0 } },
      { id: "o3", position: { x: 20, y: 0 } },
      { id: "o4", position: { x: 0, y: hy - 6 } },
      { id: "o5", position: { x: 0, y: -(hy - 6) } },
    ],
    zones: [zone(0, hy - 12, hy), zone(1, -hy, -(hy - 12))],
  };
}
