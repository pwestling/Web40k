import { describe, expect, it } from "vitest";
import {
  createInitialState,
  levelsAt,
  modelDistance,
  modelSight,
  segmentHitsBox,
  settleZ,
  stepLevel,
  type GameState,
  type Model,
  type TerrainPiece,
} from "./index";

const wallPiece = (h: number): TerrainPiece => ({
  id: "w",
  name: "Wall",
  category: "light",
  position: { x: 0, y: 0 },
  width: 4,
  depth: 1,
  facing: 0,
  solids: [{ kind: "wall", x: 0, y: 0, z: 0, w: 4, d: 0.4, h }],
});

const tower: TerrainPiece = {
  id: "t",
  name: "Tower",
  category: "light",
  position: { x: 10, y: 0 },
  width: 6,
  depth: 6,
  facing: Math.PI / 2,
  solids: [
    { kind: "floor", x: 0, y: 0, z: 2.8, w: 6, d: 6, h: 0.2 },
    { kind: "floor", x: 0, y: 0, z: 5.8, w: 6, d: 6, h: 0.2 },
  ],
};

const model = (id: string, x: number, y: number, z = 0): Model => ({
  id,
  owner: "p",
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  height: 1.5,
  z,
});

function table(terrain: TerrainPiece[], models: Model[]): GameState {
  const s = createInitialState();
  return { ...s, terrain, models: Object.fromEntries(models.map((m) => [m.id, m])) };
}

describe("terrain levels", () => {
  it("lists the floors under a point and settles models without physics", () => {
    expect(levelsAt([tower], { x: 10, y: 1 })).toEqual([0, 3, 6]);
    expect(levelsAt([tower], { x: 20, y: 0 })).toEqual([0]);
    // Dragged along the top floor it stays there; dragged off the edge it drops to the table.
    expect(settleZ([tower], { x: 11, y: 0 }, 6)).toBe(6);
    expect(settleZ([tower], { x: 20, y: 0 }, 6)).toBe(0);
    expect(stepLevel([tower], { x: 10, y: 0 }, 0, 1)).toBe(3);
    expect(stepLevel([tower], { x: 10, y: 0 }, 6, 1)).toBe(6);
    expect(stepLevel([tower], { x: 10, y: 0 }, 6, -1)).toBe(3);
  });

  it("steps onto a hill or crate instead of sinking into it", () => {
    const hill: TerrainPiece = {
      ...tower,
      id: "h",
      solids: [{ kind: "block", x: 0, y: 0, z: 0, w: 6, d: 6, h: 2 }],
    };
    expect(settleZ([hill], { x: 10, y: 0 }, 0)).toBe(2);
    expect(settleZ([hill], { x: 20, y: 0 }, 2)).toBe(0);
  });

  it("measures distance including the height gap", () => {
    const a = model("a", 0, 0, 0);
    const b = model("b", 0, 0, 5.5);
    expect(modelDistance(a, b)).toBeCloseTo(4);
  });
});

describe("line of sight", () => {
  it("clips segments against boxes", () => {
    const min = { x: -1, y: -1, z: 0 };
    const max = { x: 1, y: 1, z: 2 };
    expect(segmentHitsBox({ x: -5, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }, min, max)).toBe(true);
    expect(segmentHitsBox({ x: -5, y: 0, z: 3 }, { x: 5, y: 0, z: 3 }, min, max)).toBe(false);
  });

  it("is blocked by a tall wall and sees over a low one", () => {
    const a = model("a", 0, -3);
    const b = model("b", 0, 3);
    expect(modelSight(table([wallPiece(4)], [a, b]), a, b).visible).toBe(false);
    const low = modelSight(table([wallPiece(0.8)], [a, b]), a, b);
    expect(low.visible).toBe(true);
    expect(low.fully).toBe(false);
    expect(low.obscuredBy.map((p) => p.id)).toEqual(["w"]);
  });

  it("uses an imported hull instead of the boxes when a piece has one", () => {
    const a = model("a", 0, -3);
    const b = model("b", 0, 3);
    // A 4"-wide, 4"-tall vertical quad across the line of fire, as two triangles.
    const quad = [-2, 0, 0, 2, 0, 0, 2, 0, 4, -2, 0, 0, 2, 0, 4, -2, 0, 4];
    const hulled = { ...wallPiece(0.1), hull: quad };
    expect(modelSight(table([wallPiece(0.1)], [a, b]), a, b).fully).toBe(true);
    expect(modelSight(table([hulled], [a, b]), a, b).visible).toBe(false);
  });

  it("uses a model's imported bands for its height and what it hides", () => {
    // A thin 6"-tall model: tall enough to be seen over a 4" wall.
    const tall = { ...model("b", 0, 3), height: undefined, bands: [{ r: 0.3, z0: 0, z1: 6 }] };
    const a = { ...model("a", 0, -3), height: 5 };
    const s = modelSight(table([wallPiece(4)], [a, tall]), a, tall);
    expect(s.visible).toBe(true);
    expect(s.fully).toBe(false);
    const short = model("c", 0, 3);
    expect(modelSight(table([wallPiece(4)], [a, short]), a, short).visible).toBe(false);
  });

  it("lets a model on a high floor see over a wall", () => {
    const shooter = model("a", 0, -3, 6);
    const target = model("b", 0, 3);
    const wall = { ...wallPiece(3), position: { x: 0, y: -1 } };
    const s = table([wall], [shooter, target]);
    expect(modelSight(s, shooter, target).visible).toBe(true);
    expect(modelSight(s, target, { ...shooter, z: 0 }).visible).toBe(false);
  });

  it("blocks sight through other models unless told not to", () => {
    const a = model("a", 0, -4);
    const blocker = { ...model("m", 0, 0), height: 4, base: { shape: "round" as const, diameterMm: 100 } };
    const b = model("b", 0, 4);
    const s = table([], [a, blocker, b]);
    expect(modelSight(s, a, b).visible).toBe(false);
    expect(modelSight(s, a, b, { modelsBlock: false }).visible).toBe(true);
  });
});

describe("stand-in heights line of sight", () => {
  const heights = (terrain: TerrainPiece[], models: Model[]): GameState => {
    const s = table(terrain, models);
    return { ...s, settings: { ...s.settings, los: "heights" } };
  };
  const block = (h: number, losHeight?: number): TerrainPiece => ({
    ...wallPiece(h),
    width: 4,
    depth: 2,
    ...(losHeight === undefined ? {} : { losHeight }),
  });

  it("blocks with the piece's stand-in height, not its shape", () => {
    const a = model("a", 0, -3);
    const b = model("b", 0, 3);
    expect(modelSight(heights([block(4)], [a, b]), a, b).visible).toBe(false);
    // The same wall given a low stand-in height: the over-the-top line clears it.
    const low = modelSight(heights([block(4, 1)], [a, b]), a, b);
    expect(low.visible).toBe(true);
    expect(low.fully).toBe(false);
  });

  it("lets a tall model see over terrain shorter than the line between the tops", () => {
    const giant = { ...model("a", 0, -3), height: 6 };
    const b = model("b", 0, 3);
    expect(modelSight(heights([block(2.5)], [giant, b]), giant, b).visible).toBe(true);
    expect(modelSight(heights([block(2.5)], [model("c", 0, -3), b]), model("c", 0, -3), b).visible).toBe(
      false,
    );
  });

  it("lets models see out of the terrain they stand in", () => {
    const a = model("a", 0, 0);
    const b = model("b", 0, 6);
    expect(modelSight(heights([block(4)], [a, b]), a, b).visible).toBe(true);
  });

  it("lets a single piece use its stand-in height in a true line of sight game", () => {
    const a = model("a", 0, -3);
    const b = model("b", 0, 3);
    const hill = { ...block(4, 1), sight: "heights" as const };
    expect(modelSight(table([block(4)], [a, b]), a, b).visible).toBe(false);
    expect(modelSight(table([hill], [a, b]), a, b).visible).toBe(true);
  });

  it("only sees inside the vision arc when the game has one", () => {
    const a = model("a", 0, 0); // facing 0 looks along +y
    const ahead = model("b", 1, 6);
    const behind = model("c", 0, -6);
    const s = table([], [a, ahead, behind]);
    const arc = { ...s, settings: { ...s.settings, visionArc: 90 } };
    expect(modelSight(s, a, behind).visible).toBe(true);
    expect(modelSight(arc, a, ahead).visible).toBe(true);
    expect(modelSight(arc, a, behind).visible).toBe(false);
  });
});
