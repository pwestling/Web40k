import { describe, expect, it } from "vitest";
import { boxProxy, figureProxy } from "./proxy";
import { synthMiniature } from "./synth";
import type { MeshData } from "./types";

/** Closed boxes (min corner, size), y up, merged into one mesh. */
function boxes(list: [number, number, number, number, number, number][]): MeshData {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [x, y, z, w, h, d] of list) {
    const o = positions.length / 3;
    for (let i = 0; i < 8; i++) positions.push(x + (i & 1 ? w : 0), y + (i & 2 ? h : 0), z + (i & 4 ? d : 0));
    // prettier-ignore
    indices.push(0,2,1, 1,2,3, 4,5,6, 5,7,6, 0,1,4, 1,5,4, 2,6,3, 3,6,7, 0,4,2, 2,4,6, 1,3,5, 3,7,5);
    for (let i = indices.length - 36; i < indices.length; i++) indices[i]! += o;
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

describe("figure proxy", () => {
  it("gives the figure's height and a few radius bands", () => {
    const mesh = synthMiniature(20_000, 1);
    const proxy = figureProxy(mesh);
    expect(proxy.height).toBeGreaterThan(1.2);
    expect(proxy.bands.length).toBeGreaterThanOrEqual(1);
    expect(proxy.bands.length).toBeLessThanOrEqual(4);
    expect(proxy.bands[0]!.z0).toBe(0);
    expect(proxy.bands.at(-1)!.z1).toBeCloseTo(proxy.height, 2);
    for (const b of proxy.bands) expect(b.r).toBeLessThan(0.7);
  });
});

describe("box proxy", () => {
  it("rebuilds a ruin's walls and floor from its mesh", () => {
    // A 6" x 4" floor slab with two 3" walls on it, in y-up mesh space.
    const ruin = boxes([
      [-3, 0, -2, 6, 0.25, 4],
      [-3, 0.25, -2, 0.5, 3, 4],
      [-3, 0.25, -2, 6, 3, 0.5],
    ]);
    const proxy = boxProxy(ruin);
    expect(proxy.length).toBeLessThanOrEqual(32);
    const volume = proxy.reduce((v, b) => v + b.w * b.d * b.h, 0);
    const real = 6 * 0.25 * 4 + 0.5 * 3 * 4 + 6 * 3 * 0.5 - 0.5 * 3 * 0.5;
    expect(volume).toBeGreaterThan(real * 0.8);
    expect(volume).toBeLessThan(real * 1.6);
    expect(Math.max(...proxy.map((b) => b.z + b.h))).toBeCloseTo(3.25, 0);
    expect(proxy.some((b) => b.kind === "floor")).toBe(true);
    expect(proxy.some((b) => b.kind === "wall")).toBe(true);
  });

  it("fills closed shapes rather than leaving a hollow shell", () => {
    const proxy = boxProxy(boxes([[0, 0, 0, 4, 2, 4]]));
    expect(proxy).toHaveLength(1);
    expect(proxy[0]).toMatchObject({ w: 4, d: 4, h: 2, z: 0, x: 2, y: 2 });
  });

  it("stays under the box limit for a detailed mesh", () => {
    const proxy = boxProxy(synthMiniature(20_000, 4));
    expect(proxy.length).toBeLessThanOrEqual(32);
    expect(proxy.length).toBeGreaterThan(0);
  });
});
