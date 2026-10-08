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
    expect(words("Intercessor_Squad_v2_presupported")).toEqual(["intercessor"]);
    expect(words("Boyz with Choppas")).toEqual(["boyz", "choppa"]);
  });

  it("suggests a figure that dressed the unit before, then figures named like it", () => {
    const library = [
      entry("Space marine sergeant"),
      entry("intercessors body A", { tags: ["marines"] }),
      entry("my favourite mini", { units: ["Intercessor Squad"] }),
      entry("Gretchin"),
      entry("Intercessor ruin", { kind: "terrain" }),
    ];
    expect(fit(library[2]!, "intercessor squad")).toBe(1);
    expect(suggestions(library, "Intercessor Squad").map((e) => e.name)).toEqual([
      "my favourite mini",
      "intercessors body A",
    ]);
    expect(suggestions(library, "Ork Boyz")).toEqual([]);
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
