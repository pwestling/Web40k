import type { Layout, TerrainPiece, Zone } from "../../core";
import { makePiece } from "../wh40k/layout";

/** What the shared terrain templates count as in Full Spectrum Dominance. */
export const FSD_CATEGORIES: Record<string, string> = {
  Ruin: "blocking",
  "Small ruin": "blocking",
  "Tall ruin": "blocking",
  Container: "blocking",
  Woods: "obscuring",
  Barricade: "fragile",
  Crater: "broken",
  Hill: "open",
};

/**
 * A point-symmetric table for a 36" x 24" (12 x 8 DU) board: a building,
 * woods, a wall and a container on each half, three objectives on the centre
 * line, and deployment strips 2 DU (6") deep along the long edges.
 */
export function fsdLayout(width = 36, depth = 24): Layout {
  const half: [string, string, number, number, number][] = [
    ["a", "Small ruin", -9, 4, 0],
    ["b", "Woods", -3, -5, 0],
    ["c", "Barricade", -14, -4, Math.PI / 2],
    ["e", "Container", -15, 7, 0.4],
  ];
  const terrain: TerrainPiece[] = [];
  for (const [id, name, x, y, f] of half) {
    const category = FSD_CATEGORIES[name];
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
    objectives: [
      { id: "o1", position: { x: 0, y: 0 } },
      { id: "o2", position: { x: -12, y: 0 } },
      { id: "o3", position: { x: 12, y: 0 } },
    ],
    zones: [strip(0, hy - 6, hy), strip(1, -hy, -(hy - 6))],
  };
}
