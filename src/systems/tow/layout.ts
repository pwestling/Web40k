import type { Layout, TerrainPiece, Zone } from "../../core";
import { makePiece } from "../wh40k/layout";

/** What the shared terrain templates count as in the rank-and-flank system. */
export const TOW_CATEGORIES: Record<string, string> = {
  Ruin: "building",
  "Small ruin": "building",
  "Tall ruin": "building",
  Container: "impassable",
  Woods: "woods",
  Barricade: "lowObstacle",
  Crater: "difficult",
  Hill: "hill",
};

/**
 * A 72" x 48" field: a hill and woods on each flank, a building and walls in
 * the middle ground, and deployment zones 12" deep along the long edges. The
 * centre is kept open so regiments have room to manoeuvre.
 */
export function towLayout(width = 72, depth = 48): Layout {
  const half: [string, string, number, number, number][] = [
    ["h", "Hill", -24, 6, 0],
    ["w", "Woods", 22, 8, 0.3],
    ["b", "Small ruin", -6, 9, 0],
    ["f", "Barricade", 10, 4, 0],
  ];
  const terrain: TerrainPiece[] = [];
  for (const [id, name, x, y, f] of half) {
    const category = TOW_CATEGORIES[name];
    terrain.push(makePiece(name, `${id}1`, { x, y }, f, category));
    terrain.push(makePiece(name, `${id}2`, { x: -x, y: -y }, f + Math.PI, category));
  }
  const hx = width / 2;
  const hy = depth / 2;
  const strip = (seat: number, y0: number, y1: number): Zone => ({
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
    objectives: [],
    zones: [strip(0, hy - 12, hy), strip(1, -hy, -(hy - 12))],
  };
}
