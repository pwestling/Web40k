import { describe, expect, it } from "vitest";
import type { FigureEntry } from "./library";
import { fit, suggestions, words } from "./match";
import { packHash, type PackFigure } from "./pack";

const entry = (name: string, extra: Partial<FigureEntry> = {}): FigureEntry => ({
  id: name,
  name,
  kind: "miniature",
  tags: [],
  units: [],
  bytes: 1,
  triangles: 1,
  height: 1,
  addedAt: 0,
  ...extra,
});

describe("figure library", () => {
  it("reads names as words, without plurals or file noise", () => {
    expect(words("Warden_Squad_v2_presupported")).toEqual(["warden"]);
    expect(words("Raiders with Cleavers")).toEqual(["raider", "cleaver"]);
  });

  it("suggests a figure that dressed the unit before, then figures named like it", () => {
    const library = [
      entry("Iron sergeant"),
      entry("wardens body A", { tags: ["wardens"] }),
      entry("my favourite mini", { units: ["Warden Squad"] }),
      entry("Gutter runts"),
      entry("Warden ruin", { kind: "terrain" }),
    ];
    expect(fit(library[2]!, "warden squad")).toBe(1);
    expect(suggestions(library, "Warden Squad").map((e) => e.name)).toEqual([
      "my favourite mini",
      "wardens body A",
    ]);
    expect(suggestions(library, "Scrap Brutes")).toEqual([]);
  });

  it("hashes a pack the same whatever order its figures are in", async () => {
    const a: PackFigure = {
      id: "a".repeat(64),
      name: "A",
      kind: "miniature",
      tags: [],
      units: [],
      data: "AA",
    };
    const b: PackFigure = { ...a, id: "b".repeat(64), name: "B" };
    expect(await packHash([a, b])).toBe(await packHash([b, a]));
    expect(await packHash([a, b])).not.toBe(await packHash([a, { ...b, name: "C" }]));
  });
});

describe("figure packs", () => {
  it("shares identical levels again after decoding, so a pack's model isn't stored twice", async () => {
    const { shareLevels } = await import("../assets/levels");
    const { assetBuffers } = await import("../assets/types");
    const mesh = () => ({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    });
    const asset = {
      id: "x",
      name: "x",
      kind: "miniature" as const,
      lods: [mesh(), mesh(), mesh()],
      proxy: mesh(),
      bounds: { min: [0, 0, 0] as [number, number, number], max: [1, 1, 0] as [number, number, number] },
      stats: {
        sourceTriangles: 1,
        sourceVertices: 3,
        lodTriangles: [1, 1, 1],
        proxyTriangles: 1,
        lodErrors: [0, 0, 0],
        unitScale: 1,
        ms: 0,
      },
    };
    expect(assetBuffers(asset)).toHaveLength(8);
    expect(assetBuffers(shareLevels(asset))).toHaveLength(2);
  });
});
