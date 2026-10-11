import { describe, expect, it } from "vitest";
import { fortyK } from "../core/content/examples/forty-k";
import type { Ability, Army } from "../core/types";
import { applyPack, readFactionPack } from "../packages/faction";
import { teach } from "../systems/wh40k/teach";
import { sampleRoster } from "../systems/wh40k/sample";
import { ENHANCEMENTS, type ImportedRoster } from "../systems/wh40k/roster";
import template from "../../examples/workshop/faction-pack.js?raw";
import {
  checkNames,
  draftPack,
  pullTaught,
  putEntry,
  rosterNames,
  ruleFrom,
  stratagemFrom,
  toLiteral,
  writeFaction,
} from "./packDraft";
import { problems } from "./drafts";

// The pack workshop (#79). Every name here is invented: the Vanguard Legion is one of the app's own
// sample armies, and the Gloam Wardens list below was made up for this file.

const unit = (name: string, abilities: Ability[]): ImportedRoster["units"][number] => ({
  name,
  sheet: { weapons: {}, abilities, keywords: ["Infantry"] },
  models: [{ profile: { name, chars: { M: '6"', T: "4", SV: "4+", W: "2" } }, weapons: [] }],
  base: { shape: "round", diameterMm: 32 },
});

const taughtHeal = teach(
  {
    when: { kind: "phase", phase: "command", at: "start" },
    who: { kind: "self" },
    what: [{ kind: "heal", amount: "1" }],
  },
  fortyK,
)!;

/** A Gloam Wardens list: one taught ability, one by hand, an enhancement, a detachment rule and a stratagem. */
function wardens(): ImportedRoster {
  const army: Army = {
    faction: "Gloam Wardens",
    detachment: "Lantern Vigil",
    rules: [{ name: "Lamplight Oath", text: "The player's own text.", group: "Detachment rule" }],
    stratagems: [
      {
        id: "veil-step",
        name: "Veil Step (1CP)",
        cp: 1,
        side: "inactive",
        targetsUnit: true,
        text: "Theirs.",
      },
    ],
  };
  return {
    name: "Wardens",
    units: [
      unit("Wick Guard", [
        { name: "Mothwing Ward", text: "Played by hand." },
        { name: "Slow Burn", text: "", auto: taughtHeal },
      ]),
      unit("Lamp Keeper", [
        { name: "Mothwing Ward", text: "" },
        { name: "Ember Locket", text: "", group: ENHANCEMENTS },
      ]),
    ],
    army,
    warnings: [],
  };
}

describe("pack workshop (#79)", () => {
  it("the faction pack template reads as a data-only pack and plays on the sample army it names", () => {
    expect(problems(template)).toEqual([]);
    const read = readFactionPack(template);
    if ("error" in read) throw new Error(read.error);
    expect(read.code).toBe(false);
    const army = sampleRoster(0);
    const done = applyPack(
      army,
      read.pack,
      { id: "t", name: "T", version: "1", hash: "h", bytes: 1 },
      fortyK,
    );
    expect(done.count).toBeGreaterThan(4);
    // Every name in it is the sample army's, or one the pack adds; Steady Gait has no effect, so it's not covered.
    const check = checkNames(template, read.pack, army, fortyK);
    expect(check.problems).toEqual([]);
    expect(check.added.sort()).toEqual(["Shoulder to Shoulder", "Smoke Drill"]);
    expect(check.uncovered.map((n) => n.name)).toContain("Steady Gait");
    expect(check.matched).toBeGreaterThan(3);
  });

  it("lists an army's names with how each plays now", () => {
    const names = rosterNames(wardens(), fortyK);
    expect(names.map((n) => [n.name, n.kind, n.status])).toEqual([
      ["Lamplight Oath", "detachment", "manual"],
      ["Mothwing Ward", "ability", "manual"],
      ["Slow Burn", "ability", "taught"],
      ["Ember Locket", "enhancement", "manual"],
      ["Veil Step (1CP)", "stratagem", "manual"],
    ]);
    expect(names.find((n) => n.name === "Mothwing Ward")?.units).toEqual(["Wick Guard", "Lamp Keeper"]);
  });

  it("writes a built rule into the draft as data, in the builder's terms, where its kind goes", () => {
    const made = teach(
      {
        when: { kind: "attacks", weapon: "melee" },
        who: { kind: "self" },
        what: [{ kind: "reroll", roll: "wound", which: "ones" }],
      },
      fortyK,
    );
    const rule = ruleFrom("Mothwing Ward", made, fortyK, "My words.");
    expect(rule).toEqual({
      name: "Mothwing Ward",
      summary: "My words.",
      teach: {
        when: { kind: "attacks", weapon: "melee" },
        who: { kind: "self" },
        what: [{ kind: "reroll", roll: "wound", which: "ones" }],
      },
    });
    // A rule the builder can't say (the app's reader made it) comes back as its parts.
    const damage = { kind: "attack" as const, side: "targeted" as const, roll: "damage" as const, by: -1 };
    expect(ruleFrom("Y", { parts: [damage], effects: [] }, fortyK)).toEqual({
      name: "Y",
      auto: { parts: [damage] },
    });

    const draft = `export const manifest = { id: "a", name: "A", version: "1", api: 1, kind: "faction", systems: ["forty-k"] };\n// keep me\n`;
    let pack = putEntry({}, "ability", rule);
    pack = putEntry(pack, "enhancement", ruleFrom("Ember Locket", made, fortyK), "Lantern Vigil");
    pack = putEntry(
      pack,
      "stratagem",
      stratagemFrom(
        { name: "Veil Step", cp: 2, side: "inactive", phases: ["shooting"], targetsUnit: true },
        made,
        fortyK,
      ),
      "Lantern Vigil",
    );
    const source = writeFaction(draft, pack);
    expect(source).toContain("// keep me");
    const read = readFactionPack(source);
    if ("error" in read) throw new Error(read.error);
    expect(read.pack.abilities?.map((r) => r.name)).toEqual(["Mothwing Ward"]);
    expect(read.pack.detachments).toMatchObject([
      {
        name: "Lantern Vigil",
        enhancements: [{ name: "Ember Locket" }],
        stratagems: [{ name: "Veil Step", cp: 2 }],
      },
    ]);
    // Built again: it replaces the entry where it is, and keeps the author's summary.
    const again = writeFaction(
      source,
      putEntry(read.pack, "ability", ruleFrom("mothwing ward", null, fortyK)),
    );
    expect(draftPack(again)).toMatchObject({ abilities: [{ name: "mothwing ward", summary: "My words." }] });
    expect((draftPack(again) as { abilities: object[] }).abilities[0]).not.toHaveProperty("teach");
    // Writing the template's own pack back gives the same pack.
    const tpl = draftPack(template);
    if (typeof tpl === "string") throw new Error(tpl);
    expect(draftPack(writeFaction(template, tpl))).toEqual(tpl);
    expect(toLiteral({ a: [1, "b"], "c-d": null })).toBe('{ a: [1, "b"], "c-d": null }');
  });

  it("pulls every taught rule of the army into the pack in one go", () => {
    const roster = wardens();
    roster.army!.stratagems[0] = {
      ...roster.army!.stratagems[0]!,
      auto: { ...taughtHeal, parts: [{ kind: "fnp", x: 6 }] },
    };
    const fnp = teach(
      { when: { kind: "attacks" }, who: { kind: "self" }, what: [{ kind: "fnp", x: 6 }] },
      fortyK,
    )!;
    roster.army!.stratagems[0]!.auto = fnp;
    roster.army!.rules[0]!.auto = fnp;
    const { pack, count } = pullTaught({ faction: "Gloam Wardens" }, roster, fortyK);
    expect(count).toBe(3);
    expect(pack.abilities?.map((r) => [r.name, r.teach?.what[0]?.kind])).toEqual([["Slow Burn", "heal"]]);
    expect(pack.detachments?.[0]?.rules?.map((r) => r.name)).toEqual(["Lamplight Oath"]);
    expect(pack.detachments?.[0]?.stratagems?.[0]).toMatchObject({
      name: "Veil Step (1CP)",
      cp: 1,
      side: "inactive",
    });
  });

  it("checks every name in the pack against the army, with lines, and lists what isn't covered", () => {
    const pack = {
      faction: "Gloam Wardens",
      abilities: [
        {
          name: "Mothwing Ward",
          teach: { when: { kind: "attacks" }, who: { kind: "self" }, what: [{ kind: "fnp", x: 5 }] },
        },
        {
          name: "MOTHWING WARD",
          teach: { when: { kind: "attacks" }, who: { kind: "self" }, what: [{ kind: "fnp", x: 5 }] },
        },
        { name: "Glass Lungs", summary: "No unit has it." },
      ],
      detachments: [
        { name: "Lantern Vigil", stratagems: [{ name: "Dim the Wicks", cp: 1, side: "active" }] },
        { name: "Night Patrol", rules: [{ name: "Patrol Rule" }] },
      ],
    };
    const source = writeFaction(
      `export const manifest = { id: "a", name: "A", version: "1", api: 1, kind: "faction", systems: ["forty-k"] };\n`,
      pack as never,
    );
    const read = readFactionPack(source);
    if ("error" in read) throw new Error(read.error);
    const check = checkNames(source, read.pack, wardens(), fortyK);
    const lines = source.split("\n");
    expect(check.problems.map((p) => [p.name, p.why, p.where])).toEqual([
      ["MOTHWING WARD", "twice", "abilities"],
      ["Glass Lungs", "no-unit", "abilities"],
      ["Night Patrol", "detachment", "detachments[1]"],
    ]);
    for (const p of check.problems) expect(lines[p.line! - 1]).toContain(p.name);
    expect(check.added).toEqual(["Dim the Wicks"]);
    expect(check.matched).toBe(1);
    expect(check.uncovered.map((n) => n.name)).toEqual(["Lamplight Oath", "Ember Locket", "Veil Step (1CP)"]);
    // Another faction's army rule is one too.
    const other = checkNames(
      source,
      { faction: "Someone Else", rules: [{ name: "Far Rule" }] },
      wardens(),
      fortyK,
    );
    expect(other.problems.map((p) => p.why)).toEqual(["faction"]);
  });
});
