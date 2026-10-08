import { describe, expect, it } from "vitest";
import riftSource from "../../games/rift-lanterns/rift-lanterns.js?raw";
import rulebookJson from "../../games/rift-lanterns/rulebook.json?raw";
import rulesMd from "../../games/rift-lanterns/RULES.md?raw";
import tableSvg from "../../games/rift-lanterns/table.svg?raw";
import { mapSvg, rulebookMarkdown, rulebookOf, type RulebookSource } from "./rulebook";

/**
 * The rulebook files in a game's folder are made from its module (#47): this
 * fails when they're stale. `pnpm rulebook` writes them afresh.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe("Rift Lanterns rulebook", async () => {
  const mod = (await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(riftSource)}`)) as {
    default: { module: RulebookSource };
  };
  const doc = rulebookOf({ ...mod.default.module, licence: "CC BY 4.0" });
  const files: [string, string, string][] = [
    ["rulebook.json", `${JSON.stringify(doc, null, 2)}\n`, rulebookJson],
    ["RULES.md", rulebookMarkdown(doc), rulesMd],
    ["table.svg", `${mapSvg(doc)}\n`, tableSvg],
  ];

  it("has the game's warbands, missions and table", () => {
    expect(doc.armies).toHaveLength(4);
    expect(doc.armies.flatMap((a) => a.units)).toHaveLength(12);
    expect(doc.missions.map((m) => m.name)).toEqual(["Lantern Grab", "Snuff Them Out", "The Last Lantern"]);
    expect(doc.map.pieces).toHaveLength(10);
    expect(doc.sections.map((s) => s.id)).toContain("shooting");
  });

  for (const [name, text, onDisk] of files)
    it(`${name} is up to date (pnpm rulebook)`, async () => {
      if (env.RULEBOOK_WRITE) {
        const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
          writeFileSync(path: URL, text: string): void;
        };
        fs.writeFileSync(new URL(`../../games/rift-lanterns/${name}`, import.meta.url), text);
        return;
      }
      expect(onDisk).toBe(text);
    });
});
