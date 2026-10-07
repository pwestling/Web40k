import type { Layout, TerrainPiece, Zone } from "../../core";
import { makePiece } from "../wh40k/layout";

/** What the shared terrain templates count as in Conquest. */
export const CONQUEST_CATEGORIES: Record<string, string> = {
  Ruin: "garrison",
  "Small ruin": "garrison",
  "Tall ruin": "obscuring",
  Container: "impassable",
  Woods: "forest",
  Barricade: "defensible",
  Crater: "open",
  Hill: "hill",
};

/**
 * A 72" x 48" field with forests and hills on the flanks, a garrison and a
 * wall either side of the middle, and deployment zones 12" deep along the
 * long edges. The centre stays open for regiments to wheel and charge.
 */
export function conquestLayout(width = 72, depth = 48): Layout {
  const half: [string, string, number, number, number][] = [
    ["h", "Hill", -26, 4, 0],
    ["w", "Woods", 24, 9, 0.4],
    ["g", "Small ruin", -8, 10, 0],
    ["f", "Barricade", 8, 5, 0],
  ];
  const terrain: TerrainPiece[] = [];
  for (const [id, name, x, y, f] of half) {
    const category = CONQUEST_CATEGORIES[name];
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
  return { terrain, objectives: [], zones: [strip(0, hy - 12, hy), strip(1, -hy, -(hy - 12))] };
}
