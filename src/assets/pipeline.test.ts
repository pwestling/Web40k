import { beforeAll, describe, expect, it } from "vitest";
import { processMesh, ready, weld } from "./pipeline";
import { synthMiniature } from "./synth";
import { BUDGETS } from "./types";

beforeAll(() => ready);

describe("asset pipeline", () => {
  it("brings a dense sculpt under every level's budget", () => {
    const raw = synthMiniature(400_000);
    const asset = processMesh(raw, { id: "x", name: "blob", kind: "miniature" });
    const budget = BUDGETS.miniature;
    expect(asset.stats.sourceTriangles).toBeGreaterThan(300_000);
    asset.stats.lodTriangles.forEach((t, i) => expect(t).toBeLessThanOrEqual(budget.lods[i]! * 1.1));
    expect(asset.stats.proxyTriangles).toBeLessThanOrEqual(budget.proxy);
    expect(asset.stats.proxyTriangles).toBeGreaterThan(20);
  });

  it("converts millimetres to inches and stands the model on the table", () => {
    const asset = processMesh(synthMiniature(20_000), { id: "x", name: "blob", kind: "miniature" });
    expect(asset.stats.unitScale).toBeCloseTo(1 / 25.4);
    expect(asset.bounds.min[1]).toBe(0);
    const height = asset.bounds.max[1];
    expect(height).toBeGreaterThan(1);
    expect(height).toBeLessThan(2);
    // Footprint centred on the origin.
    expect(asset.bounds.min[0] + asset.bounds.max[0]).toBeCloseTo(0);
    expect(asset.bounds.min[2] + asset.bounds.max[2]).toBeCloseTo(0);
  });

  it("leaves models already in inches alone", () => {
    const asset = processMesh(synthMiniature(5_000, 1), { id: "x", name: "blob", kind: "miniature" });
    expect(asset.stats.unitScale).toBe(1);
  });

  it("keeps small meshes as they are", () => {
    const asset = processMesh(synthMiniature(400), { id: "x", name: "blob", kind: "miniature" });
    // Only the degenerate triangles at the poles go.
    expect(asset.stats.lodTriangles[0]).toBeGreaterThan(asset.stats.sourceTriangles * 0.9);
    expect(asset.stats.lodErrors[0]).toBe(0);
  });

  it("indexes only vertices the triangles use", () => {
    const asset = processMesh(synthMiniature(50_000), { id: "x", name: "blob", kind: "miniature" });
    for (const lod of [...asset.lods, asset.proxy]) {
      const used = new Set(lod.indices);
      expect(used.size).toBe(lod.positions.length / 3);
    }
  });
});

describe("rules proxies", () => {
  it("gives miniatures sight bands and terrain boxes to stand on and to block sight", () => {
    const mini = processMesh(synthMiniature(50_000), { id: "m", name: "mini", kind: "miniature" });
    expect(mini.figure?.height).toBeCloseTo(mini.bounds.max[1], 1);
    expect(mini.solids).toBeUndefined();

    const rock = processMesh(synthMiniature(200_000, 25.4 * 4), { id: "t", name: "rock", kind: "terrain" });
    const sight = rock.solids!.filter((b) => b.kind === "wall");
    expect(sight.length).toBeGreaterThan(0);
    expect(sight.length).toBeLessThanOrEqual(160);
    expect(rock.solids!.some((b) => b.kind !== "wall")).toBe(true);
    // No hull: sight comes from the boxes. Their top is the rock's height.
    expect(rock.hull).toBeUndefined();
    expect(Math.max(...sight.map((b) => b.z + b.h))).toBeCloseTo(rock.bounds.max[1], 0);
  });
});

describe("painted models", () => {
  it("keeps uvs and colours through every level, within budget, and leaves the proxy plain", () => {
    const asset = processMesh(synthMiniature(200_000, 25.4, true), { id: "p", name: "p", kind: "miniature" });
    asset.lods.forEach((l, i) => {
      const vertices = l.positions.length / 3;
      expect(l.uvs!.length).toBe(vertices * 2);
      expect(l.colors!.length).toBe(vertices * 4);
      expect(l.indices.length / 3).toBeLessThanOrEqual(BUDGETS.miniature.lods[i]! * 1.1);
    });
    expect(asset.proxy.uvs).toBeUndefined();
    expect(asset.proxy.colors).toBeUndefined();
    // Both colour bands survive simplification.
    const tints = new Set<number>();
    const last = asset.lods.at(-1)!.colors!;
    for (let v = 0; v < last.length; v += 4) tints.add(last[v]!);
    expect(tints.has(255) && tints.has(200)).toBe(true);
  });

  it("welds by position and paint: the uv seam stays split", () => {
    const raw = synthMiniature(2_000, 25.4, true);
    const plain = weld({ positions: raw.positions.slice(), indices: raw.indices });
    const painted = weld({ ...raw, positions: raw.positions.slice() });
    // The seam column (u = 0 and u = 1 at one position) keeps both copies.
    expect(painted.positions.length).toBeGreaterThan(plain.positions.length);
  });
});
