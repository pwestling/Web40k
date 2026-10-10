import { describe, expect, it } from "vitest";
import type { ImportedModel, ImportedRoster } from "../systems/wh40k/roster";
import { cleanName, descriptionLines, readDescription } from "./describe";
import { mergeWithRoster, nameScore } from "./merge";
import { unitFromTts } from "./profiles";

// Invented units written in the shapes TTS army converters use; no published rules text or stats.

/** A converter's coloured table: header rows, then values; weapons as rows with keywords in brackets. */
const COLOURED = `[56f442]M       T      SV     W      LD     OC[-]
5"      4      3+      2      7+     1[-][-]

[e85545]Ranged Weapons[-]
[c6c930]Range   A   BS   S   AP   D[-]
[c6c930]Ember carbine[-]  18"  2  4+  4  0  1  [c6c930][Assault, Ignites][-]
[e85545]Melee Weapons[-]
[c6c930]Cinder blade[-]  Melee  3  3+  5  -1  1
[dc61ed]Abilities[-]
[dc61ed]Braced Firing:[-] Each time a model in this unit makes a ranged attack, if this unit Remained Stationary this turn, re-roll a Hit roll of 1.
[dc61ed]Deep Strike[-]
5+ invulnerable save
[b]Keywords:[/b] Infantry, Ashen Host`;

/** Labelled pairs on one line, bars between them. */
const LABELLED = `[b]Pyre Warden[/b]
M: 6" | T: 5 | SV: 2+ | W: 4 | LD: 6+ | OC: 1 | INV: 4+
Ranged weapons
Flame lance: Range 12" | A D6 | BS N/A | S 5 | AP -1 | D 1 | Torrent
Melee weapons
Warden maul: Range Melee | A 4 | WS 3+ | S 6 | AP -2 | D 2
Abilities: Leader, Kindle the Pyre
Steady Orders: While this model is leading a unit, each time a model in that unit makes a ranged attack, re-roll a Wound roll of 1.
Points: 85`;

/** Plain text: one header row for the weapons, the name on its own line before the numbers. */
const PLAIN = `Ember Crawler
M T SV W LD OC
10" 9 3+ 12 7+ 3
Weapons Range A BS S AP D Keywords
Twin cinder cannon
36" 2D6 4+ 7 -1 2 Blast
Crushing treads Melee 6 4+ 6 0 1
Damaged: 1-4 wounds remaining, subtract 1 from its Hit rolls.
Keywords: Vehicle, Ashen Host`;

describe("reading TTS descriptions", () => {
  it("automates abilities whose name ends in a closing colour tag (PX TTS veteran review)", () => {
    const desc = `[56f442]M T SV W LD OC[-]
6" 4 3+ 2 6+ 2[-][-]
[dc61ed]Abilities[-]
[dc61ed]Vow of Tin:[/dc61ed] Each time a model in this unit makes an attack, re-roll a Hit roll of 1.
[dc61ed]Pewter Will:[-] While this model is leading a unit, models in that unit have a 4+ invulnerable save.`;
    expect(readDescription(desc, []).abilities[0]?.text).toBe(
      "Each time a model in this unit makes an attack, re-roll a Hit roll of 1.",
    );
    const unit = unitFromTts({
      system: "forty-k-11",
      name: "Tinmen",
      models: [{ nickname: "Tinman", description: desc }],
    });
    expect(unit?.sheet?.abilities?.map((a) => [a.name, !!a.auto])).toEqual([
      ["Vow of Tin", true],
      ["Pewter Will", true],
    ]);
  });

  it("strips BBCode but keeps weapon keywords in brackets", () => {
    expect(descriptionLines("[b]Ember[/b] [ff0000]18”[-] [Assault, Heavy]\r\n\r\n[sup]x[/sup]")).toEqual([
      'Ember 18" [Assault, Heavy]',
      "x",
    ]);
    expect(cleanName("[00ff16]Ember Sergeant 2/2[-]")).toBe("Ember Sergeant");
    expect(cleanName("5x Ember Kin")).toBe("Ember Kin");
  });

  it("reads a coloured converter table", () => {
    const p = readDescription(COLOURED);
    expect(p.chars).toEqual({ M: '5"', T: "4", SV: "3+", W: "2", LD: "7+", OC: "1", INV: "5+" });
    expect(p.weapons).toEqual([
      {
        name: "Ember carbine",
        kind: "ranged",
        chars: { RANGE: '18"', A: "2", BS: "4+", S: "4", AP: "0", D: "1" },
        keywords: ["Assault", "Ignites"],
      },
      {
        name: "Cinder blade",
        kind: "melee",
        chars: { RANGE: "Melee", A: "3", WS: "3+", S: "5", AP: "-1", D: "1" },
        keywords: [],
      },
    ]);
    expect(p.abilities.map((a) => a.name)).toEqual(["Braced Firing", "Deep Strike"]);
    expect(p.abilities[0]!.text).toMatch(/^Each time a model/);
    expect(p.keywords).toEqual(["Infantry", "Ashen Host"]);
    expect(p.unparsed).toEqual([]);
  });

  it("reads labelled characteristics and weapons", () => {
    const p = readDescription(LABELLED, ["Pyre Warden"]);
    expect(p.chars).toEqual({ M: '6"', T: "5", SV: "2+", W: "4", LD: "6+", OC: "1", INV: "4+" });
    expect(p.weapons[0]).toEqual({
      name: "Flame lance",
      kind: "ranged",
      chars: { RANGE: '12"', A: "D6", BS: "N/A", S: "5", AP: "-1", D: "1" },
      keywords: ["Torrent"],
    });
    expect(p.weapons[1]).toMatchObject({ name: "Warden maul", kind: "melee", chars: { WS: "3+", D: "2" } });
    expect(p.abilities.map((a) => a.name)).toEqual(["Leader", "Kindle the Pyre", "Steady Orders"]);
    expect(p.points).toBe(85);
    expect(p.unparsed).toEqual([]);
  });

  it("reads plain rows, a name on its own line, and keeps what it can't place", () => {
    const p = readDescription(PLAIN, ["Ember Crawler"]);
    expect(p.chars).toMatchObject({ M: '10"', T: "9", W: "12" });
    expect(p.weapons.map((w) => [w.name, w.kind, w.chars.A, w.keywords])).toEqual([
      ["Twin cinder cannon", "ranged", "2D6", ["Blast"]],
      ["Crushing treads", "melee", "6", []],
    ]);
    expect(p.unparsed).toEqual(["Damaged: 1-4 wounds remaining, subtract 1 from its Hit rolls."]);
    expect(p.keywords).toEqual(["Vehicle", "Ashen Host"]);
  });
});

describe("a unit from its TTS models", () => {
  const squad = [
    { nickname: "[b]Ember Sergeant[/b] 2/2", description: COLOURED.replace("Ember carbine", "Ember pistol") },
    { nickname: "Ember Kin 2/2", description: COLOURED },
    { nickname: "Ember Kin 2/2", description: "" },
    { nickname: "Ember Kin 2/2", description: "" },
  ];

  it("gives every model a profile and loadout, and automates the abilities it can read", () => {
    const u = unitFromTts({ system: "forty-k-11", name: "Ember Kin Squad", models: squad })!;
    expect(u.name).toBe("Ember Kin Squad");
    expect(u.models!.map((m) => m.profile.name)).toEqual([
      "Ember Sergeant",
      "Ember Kin",
      "Ember Kin",
      "Ember Kin",
    ]);
    expect(u.models!.every((m) => m.profile.chars.W === "2")).toBe(true);
    expect(Object.keys(u.sheet!.weapons)).toEqual([
      "ember-pistol-ranged",
      "cinder-blade-melee",
      "ember-carbine-ranged",
    ]);
    expect(u.models![0]!.weapons).toEqual(["ember-pistol-ranged", "cinder-blade-melee"]);
    expect(u.models![3]!.weapons).toEqual(["ember-carbine-ranged", "cinder-blade-melee"]);
    const braced = u.sheet!.abilities.find((a) => a.name === "Braced Firing")!;
    expect(braced.auto?.parts[0]).toMatchObject({ kind: "attack", roll: "hit", reroll: "ones" });
    // A name with no text is left to the core rules or to Teach it.
    expect(u.sheet!.abilities.find((a) => a.name === "Deep Strike")!.auto).toBeUndefined();
    expect(u.missing).toBeUndefined();
  });

  it("is null for models that say nothing of a profile, and lists what's missing", () => {
    expect(
      unitFromTts({
        system: "forty-k-11",
        name: "Crate",
        models: [{ nickname: "Crate", description: "Scenery" }],
      }),
    ).toBeNull();
    const u = unitFromTts({
      system: "forty-k-11",
      name: "Lone Ember",
      models: [{ nickname: "Lone Ember", description: 'Ember carbine 18" 2 4+ 4 0 1' }],
    })!;
    expect(u.missing).toEqual(["M", "T", "SV", "W", "LD", "OC"]);
  });
});

describe("merging a TTS army with a roster", () => {
  const model = (name: string, w: string, weapons: string[]) => ({
    profile: { name, chars: { W: w } },
    weapons,
  });
  const unit = (name: string, models: ImportedModel[], points?: number) => ({
    name,
    sheet: { weapons: {}, abilities: [], keywords: [], ...(points ? { points } : {}) },
    models,
    base: { shape: "round" as const, diameterMm: 32 },
  });

  it("matches names loosely", () => {
    expect(nameScore("Ember Kin Squad", "Ember Kin")).toBe(3);
    expect(nameScore("5x Ember Kins", "Ember Kin")).toBe(3);
    expect(nameScore("Ember Kin Veterans", "Ember Kin")).toBe(2);
    expect(nameScore("Pyre Warden", "Ember Kin")).toBe(0);
  });

  it("takes stats and points from the list, models and their extras from the table", () => {
    const table: ImportedRoster = {
      name: "TTS save",
      units: [
        {
          ...unit("Ember Kin Squad", [
            { ...model("Ember Kin", "1", ["x"]), height: 1.2 },
            model("Ember Sergeant", "1", ["x"]),
            model("Ember Kin", "1", ["x"]),
          ]),
          missing: ["M"],
        },
        unit("Old Crate Walker", [model("Old Crate Walker", "9", [])]),
      ],
      warnings: [],
    };
    const list: ImportedRoster = {
      name: "My list",
      points: 500,
      units: [
        unit("Pyre Warden", [model("Pyre Warden", "4", ["maul"])], 85),
        unit(
          "Ember Kin",
          [model("Ember Sergeant", "2", ["pistol"]), model("Ember Kin", "2", ["carbine"])],
          100,
        ),
      ],
      warnings: [],
    };
    const m = mergeWithRoster(table, list);
    expect(m.matched).toBe(1);
    expect(m.ttsOnly).toEqual(["Old Crate Walker"]);
    expect(m.rosterOnly).toEqual(["Pyre Warden"]);
    expect(m.roster.points).toBe(500);
    expect(m.roster.name).toBe("My list");
    const kin = m.roster.units[0]!;
    expect(kin.name).toBe("Ember Kin");
    expect(kin.sheet.points).toBe(100);
    expect(kin.missing).toBeUndefined();
    // The sergeant finds the sergeant's profile; the third model reuses a list model.
    expect(kin.models.map((x) => [x.profile.name, x.profile.chars.W, x.weapons[0]])).toEqual([
      ["Ember Kin", "2", "carbine"],
      ["Ember Sergeant", "2", "pistol"],
      ["Ember Kin", "2", "carbine"],
    ]);
    expect(kin.models[0]!.height).toBe(1.2);
    expect(m.roster.units.map((u) => u.name)).toEqual(["Ember Kin", "Old Crate Walker", "Pyre Warden"]);
    expect(m.roster.warnings[0]).toMatch(/3 models on the TTS table, 2 in the list/);
  });
});
