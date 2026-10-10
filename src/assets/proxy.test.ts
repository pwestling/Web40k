import { describe, expect, it } from "vitest";
import type { TerrainPiece } from "../core";
import { levelsAt, settleZ, sightBlockedBy } from "../core/terrain";
import { figureProxy, terrainProxy, type Box } from "./proxy";
import { synthBoxes, synthMiniature, synthRuin } from "./synth";

describe("figure proxy", () => {
  it("gives the figure's height and a few radius bands", () => {
    const mesh = synthMiniature(20_000, 1);
    const proxy = figureProxy(mesh);
    expect(proxy.height).toBeGreaterThan(1.2);
    expect(proxy.bands.length).toBeGreaterThanOrEqual(1);
    expect(proxy.bands.length).toBeLessThanOrEqual(3);
    expect(proxy.bands[0]!.z0).toBe(0);
    expect(proxy.bands.at(-1)!.z1).toBeCloseTo(proxy.height, 2);
    for (const b of proxy.bands) expect(b.r).toBeLessThan(0.7);
  });
});

describe("terrain proxy", () => {
  // The ruin centred on its footprint as the pipeline leaves it: x −5..5, forward −3..3 (back wall at 2.6..3).
  const ruin = (rubble: number) => {
    const m = synthRuin(rubble);
    for (let i = 0; i < m.positions.length; i += 3) {
      m.positions[i]! -= 5;
      m.positions[i + 2]! -= 3;
    }
    return terrainProxy(m);
  };
  const piece = (solids: Box[]) =>
    ({
      id: "t",
      name: "t",
      position: { x: 0, y: 0 },
      facing: 0,
      width: 10,
      depth: 6,
      solids,
    }) as TerrainPiece;

  it("finds the floors a model can stand on, levelled across rubble, and not the wall tops", () => {
    const p = piece(ruin(120));
    expect(levelsAt([p], { x: 0, y: 1.5 })).toEqual([0, 0.25, 3.25]);
    expect(levelsAt([p], { x: 0, y: -1.5 })).toEqual([0, 0.25]);
    expect(levelsAt([p], { x: 0, y: 2.8 })).toEqual([0]);
    expect(settleZ([p], { x: 0, y: 1.5 }, 3.3)).toBe(3.25);
  });

  it("keeps windows open to sight and walls shut, rubble or not", () => {
    for (const rubble of [0, 400]) {
      const p = [piece(ruin(rubble))];
      const across = (x: number, z: number) => !!sightBlockedBy(p, { x, y: -2.9, z }, { x, y: 5, z });
      expect(across(-2.25, 1.75)).toBe(false);
      expect(across(2.25, 4.75)).toBe(false);
      expect(across(-2.9, 1.1)).toBe(false);
      expect(across(0, 1.75)).toBe(true);
      expect(across(-3.1, 4.75)).toBe(true);
    }
  });

  it("makes a crate a block to stand on, so a model put inside steps up", () => {
    const boxes = terrainProxy(synthBoxes([[-1, 0, -1, 2, 2, 2]]));
    const p = piece(boxes);
    expect(levelsAt([p], { x: 0, y: 0 })).toEqual([0, 2]);
    expect(settleZ([p], { x: 0, y: 0 }, 0)).toBe(2);
    expect(sightBlockedBy([p], { x: -3, y: 0, z: 1 }, { x: 3, y: 0, z: 1 })).not.toBeNull();
  });

  it("climbs a slope in steps", () => {
    // A wedge 8" long rising to 2".
    const positions = new Float32Array([-4, 0, -2, 4, 0, -2, 4, 2, -2, -4, 0, 2, 4, 0, 2, 4, 2, 2]);
    // prettier-ignore
    const indices = new Uint32Array([0,2,1, 3,4,5, 0,1,4, 0,4,3, 1,2,5, 1,5,4, 0,3,5, 0,5,2]);
    const p = piece(terrainProxy({ positions, indices }));
    const at = (x: number) => levelsAt([p], { x, y: 0 }).at(-1)!;
    expect(at(-3)).toBeLessThan(at(0));
    expect(at(0)).toBeLessThan(at(3));
    expect(at(3)).toBeGreaterThan(1.4);
  });

  it("stays within its box limits for a detailed mesh", () => {
    const proxy = terrainProxy(synthMiniature(20_000, 4));
    expect(proxy.filter((b) => b.kind === "wall").length).toBeLessThanOrEqual(160);
    expect(proxy.filter((b) => b.kind !== "wall").length).toBeLessThanOrEqual(64);
    expect(proxy.length).toBeGreaterThan(0);
  });
});

describe("figure bands", () => {
  it("keeps a vertex rounded a hair below the feet in the lowest band", () => {
    const positions = new Float32Array([1, -1e-7, 0, -1, 0, 0, 0, 1, 1, 0, 2, 0]);
    const proxy = figureProxy({ positions, indices: new Uint32Array([0, 1, 2, 1, 3, 2]) });
    expect(proxy.bands.length).toBeGreaterThan(0);
  });
});
