import { describe, expect, it } from "vitest";
import { sightBlockedBy } from "../core/terrain";
import type { TerrainPiece } from "../core/types";
import { clearDirection } from "./clearShot";

const wall = (kind: "wall" | "foliage"): TerrainPiece => ({
  id: "w",
  name: "Ruin",
  category: "dense",
  position: { x: 0, y: 8 },
  width: 12,
  depth: 2,
  facing: 0,
  solids: [{ kind, x: 0, y: 0, z: 0, w: 12, d: 1, h: 8 }],
});

describe("close-ups that see the fight (PX Live now 7)", () => {
  const focus = { x: 0, y: 0, z: 0 };
  // The camera low behind a tall wall, looking at a fight just past it.
  const low: [number, number, number] = [0, Math.sin(0.25), Math.cos(0.25)];

  for (const kind of ["wall", "foliage"] as const)
    it(`moves the camera when a ${kind} is in the way, and the new line is clear`, () => {
      const dir = clearDirection([wall(kind)], focus, 6, low, 30);
      expect(dir).not.toEqual(low);
      const eye = { x: dir[0] * 30, y: dir[2] * 30, z: dir[1] * 30 };
      const solid = { ...wall("wall") };
      expect(sightBlockedBy([solid], eye, { x: 0, y: 0, z: 1 })).toBeNull();
      expect(Math.hypot(...dir)).toBeCloseTo(1);
    });

  it("keeps the angle when nothing is in the way", () => {
    const behind: [number, number, number] = [0, Math.sin(0.25), -Math.cos(0.25)];
    expect(clearDirection([wall("wall")], focus, 6, behind, 30)).toEqual(behind);
    expect(clearDirection([], focus, 6, low, 30)).toBe(low);
  });
});
