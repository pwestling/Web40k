import { describe, expect, it } from "vitest";
import {
  loadRosterParsers,
  parseRosterFile,
  parseRosterText,
  suggestBase,
  type ImportedRoster,
} from "./roster";
import { isYellowscribe, readYellowscribe, toYellowscribe } from "./yellowscribe";

// Invented units in Yellowscribe's serialized shape (as its 10e/11e data model writes it); no published data.

const TEN = {
  edition: "10e",
  order: ["84435948", "1f00aa01"],
  units: {
    "1f00aa01": {
      name: "Ember Strider",
      factionKeywords: ["Lantern Host"],
      keywords: ["Vehicle", "Walker"],
      abilities: {
        "Steady Gait": {
          name: "Steady Gait",
          desc: "Each time this model makes a ranged attack, re-roll a Hit roll of 1.",
        },
      },
      models: {
        models: {
          aa: {
            name: "Ember Strider",
            abilities: ["Steady Gait"],
            weapons: [{ name: "Cinder lobber", number: 2 }],
            number: 1,
          },
        },
        totalNumberOfModels: 1,
      },
      modelProfiles: {
        "Ember Strider": { name: "Ember Strider", m: '8"', t: "9", sv: "3+", w: "10", ld: "7+", oc: "3" },
      },
      weapons: {
        "Cinder lobber": {
          name: "Cinder lobber",
          range: '36"',
          a: "D6",
          bsws: "4+",
          s: "6",
          ap: "-1",
          d: "2",
          number: 1,
          abilities: "Blast, Indirect Fire\nScorch: Hits set the ground alight.",
          shortAbilities: "Blast, Indirect Fire",
        },
      },
      isSingleModel: true,
      uuid: "1f00aa01",
      rules: [],
    },
    "84435948": {
      name: "Glimmer Wardens",
      factionKeywords: ["Lantern Host"],
      keywords: ["Infantry", "Battleline"],
      abilities: {
        Sparkstep: { name: "Sparkstep", desc: "Once per battle this unit can hop 3 inches." },
        Faction: { name: "Faction", desc: "Lantern Oath" },
        Core: { name: "Core", desc: 'Deep Strike, Scouts 6"' },
      },
      models: {
        models: {
          d631e7091094b7ed: {
            name: "Warden Captain",
            abilities: ["Sparkstep"],
            weapons: [
              { name: "Glow lance", number: 1 },
              { name: "Wardblade", number: 1 },
            ],
            number: 1,
          },
          a88a505389cfe063: {
            name: "Warden",
            abilities: ["Sparkstep"],
            weapons: [
              { name: "Spark carbine", number: 1 },
              { name: "Wardblade", number: 1 },
            ],
            number: 4,
          },
        },
        totalNumberOfModels: 5,
      },
      modelProfiles: {
        "Warden Captain": {
          name: "Warden Captain",
          m: '6"',
          t: "4",
          sv: "3+",
          w: "3",
          ld: "6+",
          oc: "1",
          insv: "5+",
        },
        Warden: { name: "Warden", m: '6"', t: "4", sv: "3+", w: "2", ld: "7+", oc: "2" },
      },
      weapons: {
        "Glow lance": {
          name: "Glow lance",
          range: '18"',
          a: "2",
          bsws: "3+",
          s: "5",
          ap: "-1",
          d: "2",
          number: 1,
          abilities: "Lance, Anti-Gloom 4+\nAnti-Gloom 4+: ",
          shortAbilities: "Lance, Anti-Gloom 4+",
        },
        "Spark carbine": {
          name: "Spark carbine",
          range: '24"',
          a: "2",
          bsws: "4+",
          s: "4",
          ap: "0",
          d: "1",
          number: 1,
          abilities: "Rapid Fire 1",
          shortAbilities: "Rapid Fire 1",
        },
        Wardblade: {
          name: "Wardblade",
          range: "Melee",
          a: "3",
          bsws: "3+",
          s: "4",
          ap: "-1",
          d: "1",
          number: 1,
          abilities: "-",
          shortAbilities: "-",
        },
      },
      isSingleModel: false,
      uuid: "84435948",
      rules: [],
      unassignedWeapons: [],
    },
  },
  errors: [],
  wargearAllocationMode: "allModels",
};

/** 9th edition's shape: weapon type instead of A/BS, and a wound track on a "*" profile. */
const NINE = {
  edition: "9e",
  order: ["00000000"],
  units: {
    "00000000": {
      name: "Gloom Behemoth",
      factionKeywords: ["Gloomkin"],
      keywords: ["Monster"],
      abilities: {
        "Dread Hide": { name: "Dread Hide", desc: "This model has a 4+ invulnerable save." },
      },
      rules: ["Lumbering"],
      models: {
        models: {
          "0606": { name: "Gloom Behemoth", weapons: [{ name: "Gloom spitter", number: 1 }], number: 1 },
        },
        totalNumberOfModels: 1,
      },
      modelProfiles: {
        "Gloom Behemoth": {
          name: "Gloom Behemoth",
          m: "*",
          ws: "*",
          bs: "4+",
          s: "7",
          t: "8",
          w: "14",
          a: "4",
          ld: "8",
          sv: "3+",
        },
      },
      weapons: {
        "Gloom spitter": {
          name: "Gloom spitter",
          range: '24"',
          type: "Assault 2D6",
          s: "5",
          ap: "-1",
          d: "1",
          abilities: "-",
        },
      },
      woundTrack: {
        "Gloom Behemoth": { "8+": ['10\\"', "3+"], "4-7": ['8\\"', "4+"], "1-3": ['6\\"', "5+"] },
      },
    },
  },
};

const read = (doc: unknown): ImportedRoster => readYellowscribe(doc, suggestBase)!;

describe("Yellowscribe army data (#75)", () => {
  it("reads units, models, profiles, weapons and abilities in the roster's order", () => {
    const r = read(TEN);
    expect(r.units.map((u) => u.name)).toEqual(["Glimmer Wardens", "Ember Strider"]);
    const [wardens, strider] = r.units as [ImportedRoster["units"][0], ImportedRoster["units"][0]];
    expect(wardens.models.map((m) => m.profile.name)).toEqual([
      "Warden Captain",
      "Warden",
      "Warden",
      "Warden",
      "Warden",
    ]);
    expect(wardens.models[0]!.profile.chars).toEqual({
      M: '6"',
      T: "4",
      SV: "3+",
      W: "3",
      LD: "6+",
      OC: "1",
      INV: "5+",
    });
    expect(wardens.models[0]!.weapons).toEqual(["glow-lance-ranged", "wardblade-melee"]);
    expect(wardens.models[4]!.weapons).toEqual(["spark-carbine-ranged", "wardblade-melee"]);
    expect(wardens.sheet.weapons["glow-lance-ranged"]).toEqual({
      id: "glow-lance-ranged",
      name: "Glow lance",
      kind: "ranged",
      chars: { RANGE: '18"', A: "2", BS: "3+", S: "5", AP: "-1", D: "2" },
      keywords: ["Lance", "Anti-Gloom 4+"],
    });
    expect(wardens.sheet.weapons["wardblade-melee"]!.chars).toEqual({
      RANGE: "Melee",
      A: "3",
      WS: "3+",
      S: "4",
      AP: "-1",
      D: "1",
    });
    // Core and faction lines come apart into their abilities.
    expect(wardens.sheet.abilities.map((a) => a.name)).toEqual([
      "Sparkstep",
      "Lantern Oath",
      "Deep Strike",
      'Scouts 6"',
    ]);
    expect(wardens.sheet.keywords).toEqual(["Lantern Host", "Infantry", "Battleline"]);
    expect(wardens.base).toEqual({ shape: "round", diameterMm: 40 });
    // A weapon count and a keyword with its own text.
    expect(strider.models[0]!.weapons).toEqual(["cinder-lobber-ranged", "cinder-lobber-ranged"]);
    expect(strider.sheet.weapons["cinder-lobber-ranged"]!.keywords).toEqual([
      "Blast",
      "Indirect Fire",
      "Scorch",
    ]);
    expect(strider.missing).toBeUndefined();
  });

  it("reads 9th edition data: weapon type, the top wound bracket, the rest as a reminder", () => {
    const r = read(NINE);
    const u = r.units[0]!;
    expect(r.warnings[0]).toMatch(/9e/);
    expect(u.models[0]!.profile.chars).toMatchObject({ M: '10"', WS: "3+", BS: "4+", W: "14", INV: "4+" });
    expect(u.sheet.weapons["gloom-spitter-ranged"]!.chars).toMatchObject({ RANGE: '24"', A: "2D6", S: "5" });
    expect(u.sheet.weapons["gloom-spitter-ranged"]!.keywords).toEqual(["Assault"]);
    const track = u.sheet.abilities.find((a) => a.name.startsWith("Wound track"))!;
    expect(track.text).toBe('8+: M 10", WS 3+; 4-7: M 8", WS 4+; 1-3: M 6", WS 5+');
    expect(u.sheet.abilities.map((a) => a.name)).toContain("Lumbering");
  });

  it("is told by its shape, from a .json or any other name, and from the site's stored file", async () => {
    expect(isYellowscribe(TEN)).toBe(true);
    expect(isYellowscribe({ roster: { forces: [] } })).toBe(false);
    expect(isYellowscribe({ units: {} })).toBe(false);
    expect(parseRosterText(JSON.stringify(TEN)).units).toHaveLength(2);
    await loadRosterParsers();
    const file = await parseRosterFile("army.txt", new TextEncoder().encode(JSON.stringify(TEN)));
    expect(file.units.map((u) => u.name)).toEqual(["Glimmer Wardens", "Ember Strider"]);
    // Unnamed data goes by its units' faction (UX 487).
    expect(file.name).toBe("Lantern Host");
    // yellowscribe.link keeps a code's army with the units under armyData.
    const stored = { edition: "10e", order: TEN.order, armyData: TEN.units, uiHeight: "700" };
    expect(parseRosterText(JSON.stringify(stored)).units[1]!.name).toBe("Ember Strider");
  });

  it("writes an army back out that reads in the same: units, models, profiles, weapons, abilities and points", () => {
    const first = read(TEN);
    first.units[0]!.sheet.points = 120;
    first.units[1]!.sheet.points = 155;
    first.units[0]!.sheet.abilities.push({ name: "Bright Mantle", text: "Glows.", group: "Enhancements" });
    // Two models of one name with different characteristics stay apart.
    first.units[0]!.models[4]!.profile.chars = { ...first.units[0]!.models[4]!.profile.chars, W: "3" };
    const out = toYellowscribe(first);
    expect(out.edition).toBe("10e");
    expect(out.order).toHaveLength(2);
    expect(isYellowscribe(JSON.parse(JSON.stringify(out)))).toBe(true);
    const again = read(JSON.parse(JSON.stringify(out)));
    const shape = (r: ImportedRoster) =>
      r.units.map((u) => ({ name: u.name, sheet: u.sheet, models: u.models, base: u.base }));
    expect(shape(again)).toEqual(shape(first));
    expect(again.points).toBe(275);
    // And as Yellowscribe's TTS script reads it: weapons by name, models stacked by number.
    const w = Object.values(out.units)[0]!;
    expect(Object.values(w.models!.models).map((m) => [m.name, m.number])).toEqual([
      ["Warden Captain", 1],
      ["Warden", 3],
      ["Warden", 1],
    ]);
    expect((w.weapons as Record<string, { abilities: string }>)["Glow lance"]!.abilities).toBe(
      "Lance, Anti-Gloom 4+",
    );
  });
});
