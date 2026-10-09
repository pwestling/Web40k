import { describe, expect, it } from "vitest";
import { autoMask, baseTop, baseWidth, bounds, brush, keptShape, type Pixels } from "./cutout";
import { standeeShape, THICKNESS, traceOutlines } from "./mesh";

/** A photo: a backdrop with a soft gradient and a shadow, and a "miniature" drawn by `paint`. */
function photo(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number] | null,
): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Paper, lit from the left, a little noise.
      const shade = 235 - (x / w) * 30 + ((x * 7 + y * 13) % 5);
      const c = paint(x, y) ?? [shade, shade - 2, shade - 6];
      data.set([c[0], c[1], c[2], 255], i);
    }
  return { width: w, height: h, data };
}

/** A painted trooper: a dark round base, legs with a gap, a body, a head; red and silver. */
function trooper(x: number, y: number): [number, number, number] | null {
  const base =
    (x - 60) ** 2 / 30 ** 2 + (y - 150) ** 2 / 6 ** 2 <= 1 ||
    (y >= 140 && y <= 150 && Math.abs(x - 60) <= 30);
  if (base) return [40, 40, 45];
  if (y >= 100 && y < 140 && ((x >= 45 && x < 56) || (x >= 64 && x < 75))) return [150, 150, 160];
  if (y >= 50 && y < 100 && x >= 40 && x < 80) return [170, 30, 35];
  if ((x - 60) ** 2 + (y - 38) ** 2 <= 12 ** 2) return [200, 160, 130];
  return null;
}

describe("photo standees (#68)", () => {
  it("cuts a miniature out of a plain backdrop, gap between the legs included", () => {
    const img = photo(120, 170, trooper);
    const mask = autoMask(img);
    const at = (x: number, y: number) => mask[y * img.width + x];
    // The miniature stays: body, head, legs, base.
    expect(at(60, 70)).toBe(255);
    expect(at(60, 38)).toBe(255);
    expect(at(50, 120)).toBe(255);
    expect(at(60, 146)).toBe(255);
    // The backdrop goes, and so does the gap between the legs (enclosed by the base).
    expect(at(5, 5)).toBe(0);
    expect(at(110, 80)).toBe(0);
    expect(at(60, 120)).toBe(0);
    const box = bounds(mask, img.width, img.height)!;
    expect(box.x).toBeGreaterThanOrEqual(28);
    expect(box.x + box.width).toBeLessThanOrEqual(92);
    expect(box.y).toBeGreaterThanOrEqual(24);
    // The base is the widest thing at the bottom: about its 61 px.
    const base = baseWidth(mask, img.width, box);
    expect(Math.abs(base - 61)).toBeLessThanOrEqual(3);
    // The base starts where the legs meet it.
    expect(Math.abs(baseTop(mask, img.width, box, base) - 140)).toBeLessThanOrEqual(2);
  });

  it("takes the paper in shadow beside the feet with the paper, but keeps a dark grey miniature", () => {
    // A lamp's shadow to the right of the base: the paper's hue, a third darker.
    const shadowed = (x: number, y: number): [number, number, number] | null => {
      const t = trooper(x, y);
      if (t) return t;
      if (y >= 130 && y <= 156 && x > 90 && x < 115) return [150, 149, 146];
      return null;
    };
    const img = photo(120, 170, shadowed);
    const mask = autoMask(img);
    expect(mask[145 * img.width + 100]).toBe(0);
    expect(mask[70 * img.width + 60]).toBe(255);
    // Dark grey armour, the same unsaturated grey as a shadow but walled by its outline, stays.
    const grey = photo(120, 170, (x, y) => (trooper(x, y) ? [70, 70, 72] : null));
    const g = autoMask(grey);
    expect(g[70 * grey.width + 60]).toBe(255);
    expect(keptShape(g, grey.width, grey.height).whole).toBeGreaterThan(0.9);
  });

  it("the brush keeps or cuts", () => {
    const mask = new Uint8Array(20 * 20);
    brush(mask, 20, 20, 10, 10, 3, true);
    expect(mask[10 * 20 + 10]).toBe(255);
    expect(mask[10 * 20 + 13]).toBe(255);
    expect(mask[10 * 20 + 14]).toBe(0);
    brush(mask, 20, 20, 10, 10, 1, false);
    expect(mask[10 * 20 + 10]).toBe(0);
    expect(mask[10 * 20 + 13]).toBe(255);
  });

  it("makes a card cut to the outline: front faces forward, the edge faces out, scaled to the base", () => {
    const w = 100;
    const h = 100;
    // A ring: a disc of radius 40 with a hole of radius 15.
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x + 0.5 - 50, y + 0.5 - 50);
        if (r <= 40 && r >= 15) mask[y * w + x] = 255;
      }
    const box = bounds(mask, w, h)!;
    const { loops } = traceOutlines(mask, w, box);
    expect(loops).toHaveLength(2);
    const scale = 1 / 80; // the ring is 80 px across: 1"
    const shape = standeeShape(mask, w, { box, scale });
    const p = shape.positions;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]!);
      maxX = Math.max(maxX, p[i]!);
      minY = Math.min(minY, p[i + 1]!);
      maxY = Math.max(maxY, p[i + 1]!);
      expect(Math.abs(Math.abs(p[i + 2]!) - THICKNESS / 2)).toBeLessThan(1e-6);
    }
    expect(maxX - minX).toBeCloseTo(1, 1);
    expect(minY).toBeCloseTo(0, 2);
    expect(maxY).toBeCloseTo(1, 1);
    // Every face points away from the card's middle: forward, back, or out of the rim (or into the hole).
    const tris = shape.indices.length / 3;
    let front = 0;
    let wrong = 0;
    let area = 0;
    for (let t = 0; t < tris; t++) {
      const [a, b, c] = [0, 1, 2].map((k) => shape.indices[t * 3 + k]!) as [number, number, number];
      const v = (i: number) => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
      const [A, B, C] = [v(a), v(b), v(c)];
      const e1 = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!];
      const e2 = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
      const n = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const mid = [
        (A[0]! + B[0]! + C[0]!) / 3,
        (A[1]! + B[1]! + C[1]!) / 3 - 0.5,
        (A[2]! + B[2]! + C[2]!) / 3,
      ];
      if (Math.abs(n[2]!) > Math.hypot(n[0]!, n[1]!)) {
        if (Math.sign(n[2]!) !== Math.sign(mid[2]!)) wrong++;
        if (n[2]! > 0) {
          front++;
          area += Math.hypot(...n) / 2;
        }
      } else {
        // The rim: out of the disc, or into the hole.
        const r = Math.hypot(mid[0]!, mid[1]!);
        const out = n[0]! * mid[0]! + n[1]! * mid[1]!;
        if (r > 0.3 ? out <= 0 : out >= 0) wrong++;
      }
    }
    expect(wrong).toBe(0);
    expect(front).toBeGreaterThan(10);
    // The ring's area: π(0.5² − 0.1875²) ≈ 0.675 sq in.
    expect(area).toBeGreaterThan(0.6);
    expect(area).toBeLessThan(0.75);
    // UVs: the front in the atlas's left half, the back in its right.
    for (let i = 0; i < shape.uvs.length; i += 2) {
      expect(shape.uvs[i]!).toBeGreaterThanOrEqual(0);
      expect(shape.uvs[i]!).toBeLessThanOrEqual(1);
    }
  });
});
