import { describe, expect, it } from "vitest";
import riftSource from "../../games/rift-lanterns/rift-lanterns.js?raw";
import rulebookJson from "../../games/rift-lanterns/rulebook.json?raw";
import rulesMd from "../../games/rift-lanterns/RULES.md?raw";
import tableSvg from "../../games/rift-lanterns/table.svg?raw";
import brineSource from "../../games/brinewatch/brinewatch.js?raw";
import brineJson from "../../games/brinewatch/rulebook.json?raw";
import brineMd from "../../games/brinewatch/RULES.md?raw";
import brineSvg from "../../games/brinewatch/table.svg?raw";
import { mapSvg, rulebookMarkdown, rulebookOf, type RulebookDoc, type RulebookSource } from "./rulebook";

/**
 * The rulebook files in a game's folder are made from its module (#47): this
 * fails when they're stale. `pnpm rulebook` writes them afresh.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

async function docOf(source: string): Promise<RulebookDoc> {
  const mod = (await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`)) as {
    default: { module: RulebookSource };
  };
  return rulebookOf({ ...mod.default.module, licence: "CC BY 4.0" });
}

/** Each of a game's rulebook files matches what its module makes now. */
function upToDate(folder: string, doc: RulebookDoc, onDisk: { json: string; md: string; svg: string }) {
  const files: [string, string, string][] = [
    ["rulebook.json", `${JSON.stringify(doc, null, 2)}\n`, onDisk.json],
    ["RULES.md", rulebookMarkdown(doc), onDisk.md],
    ["table.svg", `${mapSvg(doc)}\n`, onDisk.svg],
  ];
  for (const [name, text, was] of files)
    it(`${name} is up to date (pnpm rulebook)`, async () => {
      if (env.RULEBOOK_WRITE) {
        const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
          writeFileSync(path: URL, text: string): void;
        };
        fs.writeFileSync(new URL(`../../games/${folder}/${name}`, import.meta.url), text);
        return;
      }
      expect(was).toBe(text);
    });
}

describe("Rift Lanterns rulebook", async () => {
  const doc = await docOf(riftSource);

  it("has the game's warbands, missions and table", () => {
    expect(doc.armies).toHaveLength(4);
    expect(doc.armies.flatMap((a) => a.units)).toHaveLength(12);
    expect(doc.missions.map((m) => m.name)).toEqual(["Lantern Grab", "Snuff Them Out", "The Last Lantern"]);
    expect(doc.map.pieces).toHaveLength(10);
    expect(doc.sections.map((s) => s.id)).toContain("shooting");
  });

  upToDate("rift-lanterns", doc, { json: rulebookJson, md: rulesMd, svg: tableSvg });
});

describe("Brinewatch rulebook", async () => {
  const doc = await docOf(brineSource);

  it("has the game's crews of named models with their roles and rules, missions, campaign and table", () => {
    expect(doc.armies.map((a) => [a.name, a.units.length])).toEqual([
      ["Tollkeepers", 7],
      ["Gullrunners", 8],
      ["Deepkin", 6],
    ]);
    const ness = doc.armies[0]!.units.find((u) => u.name === "Ness")!;
    expect(ness.role).toBe("Long-gun");
    expect(ness.abilities?.map((r) => r.name)).toEqual(["Long Eye"]);
    expect(doc.missions.map((m) => m.name)).toEqual(["Low Tide Salvage", "The Bell Towers", "Cut the Line"]);
    expect(doc.sections.map((s) => s.id)).toEqual(expect.arrayContaining(["guard", "lurkers", "campaign"]));
    expect(rulebookMarkdown(doc)).toContain("## The crews");
    expect(doc.map.pieces).toHaveLength(10);
  });

  upToDate("brinewatch", doc, { json: brineJson, md: brineMd, svg: brineSvg });
});
