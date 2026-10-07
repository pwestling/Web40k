import { describe, expect, it } from "vitest";
import { fingerprint, NOT_LITERAL, readManifest } from "./manifest";

const good = `// bundled
import x from "y";
export const manifest = {
  id: "fenwick.old-world-factions", // reverse-domain
  'name': "Old World Factions",
  version: "1.2.0",
  author: \`fenwick\`,
  api: 1,
  kind: "extension",
  systems: ["tow",],
  requires: [],
  adds: "14 faction rule sets",
  /* trailing comma */
};
export default definePackage({});`;

describe("readManifest", () => {
  it("reads a literal manifest without running the code", () => {
    const r = readManifest(good);
    expect("manifest" in r && r.manifest).toMatchObject({
      id: "fenwick.old-world-factions",
      name: "Old World Factions",
      version: "1.2.0",
      author: "fenwick",
      api: 1,
      kind: "extension",
      systems: ["tow"],
      adds: "14 faction rule sets",
    });
  });

  it("rejects anything that would need the code to run", () => {
    for (const bad of [
      `export const manifest = { id: NAME, name: "a", version: "1", api: 1, kind: "system", systems: [] };`,
      `export const manifest = { id: f(), name: "a" };`,
      `export const manifest = { ...base, id: "a" };`,
      "export const manifest = { id: `a${b}` };",
    ])
      expect(readManifest(bad)).toEqual({ error: NOT_LITERAL });
  });

  it("names missing required fields", () => {
    const r = readManifest(`export const manifest = { id: "a", name: "A", version: "1" };`);
    expect("error" in r && r.error).toMatch(/api, kind, systems/);
  });

  it("prints a short fingerprint", () => {
    expect(fingerprint("a3f912c4deadbeef")).toBe("a3f9 12c4");
  });
});
