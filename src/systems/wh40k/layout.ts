import {
  inFootprint,
  type Layout,
  type TerrainCategory,
  type TerrainPiece,
  type TerrainSolid,
  type Vec2,
  type Zone,
} from "../../core";

/** Point in a terrain piece's footprint. */
export function pointInTerrain(p: Vec2, piece: TerrainPiece): boolean {
  return inFootprint(piece, p);
}

/** One floor of a ruin is this tall. */
export const STOREY = 3;
const WALL = 0.35;
const FLOOR = 0.2;

/**
 * A wall along x (or y when `alongY`), with a doorway gap in the middle at
 * ground level so models can see and walk through.
 */
function wall(
  cx: number,
  cy: number,
  length: number,
  height: number,
  alongY: boolean,
  door: boolean,
): TerrainSolid[] {
  const box = (offset: number, len: number, z: number, h: number): TerrainSolid =>
    alongY
      ? { kind: "wall", x: cx, y: cy + offset, z, w: WALL, d: len, h }
      : { kind: "wall", x: cx + offset, y: cy, z, w: len, d: WALL, h };
  if (!door || length < 4) return [box(0, length, 0, height)];
  const gap = 1.6;
  const side = (length - gap) / 2;
  const doorTop = Math.min(2.4, height);
  return [
    box(-(gap + side) / 2, side, 0, height),
    box((gap + side) / 2, side, 0, height),
    ...(height > doorTop ? [box(0, gap, doorTop, height - doorTop)] : []),
  ];
}

/** A ruin: an L of broken walls with `floors` upper floors over the back corner. */
function ruinSolids(w: number, d: number, floors: number): TerrainSolid[] {
  const height = floors * STOREY + 1.5;
  const solids: TerrainSolid[] = [
    ...wall(0, -d / 2 + WALL / 2, w, height, false, true),
    ...wall(-w / 2 + WALL / 2, -d / 2 + (d * 0.75) / 2, d * 0.75, height - 1, true, d >= 5),
    // A low broken wall at the front.
    { kind: "wall", x: w / 4, y: d / 2 - WALL / 2, z: 0, w: w / 3, d: WALL, h: 1.2 },
  ];
  for (let i = 1; i <= floors; i++) {
    const fw = w * (0.8 - 0.15 * (i - 1));
    const fd = d * (0.75 - 0.1 * (i - 1));
    solids.push({
      kind: "floor",
      x: -w / 2 + fw / 2,
      y: -d / 2 + fd / 2,
      z: i * STOREY - FLOOR,
      w: fw,
      d: fd,
      h: FLOOR,
    });
  }
  return solids;
}

export interface TerrainTemplate {
  name: string;
  category: TerrainCategory;
  width: number;
  depth: number;
  solids: () => TerrainSolid[];
}

/**
 * Generic terrain to build a table from. Categories are defaults; players
 * can change them per piece.
 */
export const TEMPLATES: TerrainTemplate[] = [
  { name: "Ruin", category: "light", width: 10, depth: 6, solids: () => ruinSolids(10, 6, 1) },
  { name: "Small ruin", category: "light", width: 6, depth: 4, solids: () => ruinSolids(6, 4, 0) },
  { name: "Tall ruin", category: "light", width: 8, depth: 8, solids: () => ruinSolids(8, 8, 2) },
  {
    name: "Container",
    category: "solid",
    width: 5,
    depth: 2.5,
    solids: () => [{ kind: "block", x: 0, y: 0, z: 0, w: 5, d: 2.5, h: 2.5 }],
  },
  {
    name: "Woods",
    category: "dense",
    width: 9,
    depth: 6,
    solids: () =>
      [
        [-3, -1.5],
        [0.5, -2],
        [3, 0],
        [-1.5, 1.5],
        [2, 2.2],
      ].map(([x, y]) => ({ kind: "foliage", x: x!, y: y!, z: 0, w: 1.6, d: 1.6, h: 4.5 })),
  },
  {
    name: "Barricade",
    category: "light",
    width: 5,
    depth: 1.5,
    solids: () => [{ kind: "wall", x: 0, y: 0, z: 0, w: 5, d: 0.5, h: 1.1 }],
  },
  { name: "Crater", category: "exposed", width: 5, depth: 5, solids: () => [] },
  {
    name: "Hill",
    category: "exposed",
    width: 10,
    depth: 7,
    solids: () => [{ kind: "block", x: 0, y: 0, z: 0, w: 10, d: 7, h: 2 }],
  },
];

export function makePiece(templateName: string, id: string, position: Vec2, facing = 0): TerrainPiece {
  const t = TEMPLATES.find((x) => x.name === templateName) ?? TEMPLATES[0]!;
  return {
    id,
    name: t.name,
    category: t.category,
    position,
    width: t.width,
    depth: t.depth,
    facing,
    solids: t.solids(),
  };
}

export type ZonePreset = "long" | "short" | "none";

/** Deployment zones: 12" deep along the long edges, 18" along the short edges, or none. */
export function zones(preset: ZonePreset, width = 60, depth = 44): Zone[] {
  const hx = width / 2;
  const hy = depth / 2;
  const rect = (seat: number, x0: number, y0: number, x1: number, y1: number): Zone => ({
    seat,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  });
  if (preset === "long") return [rect(0, -hx, hy - 12, hx, hy), rect(1, -hx, -hy, hx, -(hy - 12))];
  if (preset === "short") return [rect(0, hx - 18, -hy, hx, hy), rect(1, -hx, -hy, -(hx - 18), hy)];
  return [];
}

/**
 * A generic, point-symmetric layout for a 60" x 44" table: ruins of several
 * heights, containers and woods, five objectives and 12"-deep deployment
 * zones on the long edges. Seat 0 deploys along the +y edge, seat 1 along -y.
 */
export function standardLayout(width = 60, depth = 44): Layout {
  const half: [string, string, number, number, number][] = [
    ["a", "Ruin", -12, 7, 0],
    ["b", "Tall ruin", -24, -8, Math.PI / 2],
    ["c", "Small ruin", -5, -7, Math.PI],
    ["d", "Ruin", -21, 13, Math.PI / 2],
    ["e", "Container", -8, 15, 0.4],
    ["f", "Woods", -15, -2, 0],
  ];
  const terrain: TerrainPiece[] = [];
  for (const [id, name, x, y, f] of half) {
    terrain.push(makePiece(name, `${id}1`, { x, y }, f));
    // The mirror image through the table centre.
    terrain.push(makePiece(name, `${id}2`, { x: -x, y: -y }, f + Math.PI));
  }
  const hy = depth / 2;
  return {
    terrain,
    objectives: [
      { id: "o1", position: { x: 0, y: 0 } },
      { id: "o2", position: { x: -20, y: 0 } },
      { id: "o3", position: { x: 20, y: 0 } },
      { id: "o4", position: { x: 0, y: hy - 6 } },
      { id: "o5", position: { x: 0, y: -(hy - 6) } },
    ],
    zones: zones("long", width, depth),
  };
}
