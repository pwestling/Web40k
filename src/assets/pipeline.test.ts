import { beforeAll, describe, expect, it } from "vitest";
import { processMesh, ready } from "./pipeline";
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
