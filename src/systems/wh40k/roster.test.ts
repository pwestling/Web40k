import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  loadRosterParsers,
  parseRosterFile,
  parseRosterText,
  suggestBase,
  type ImportedUnit,
  type UnitSheet,
} from "./roster";
import { sampleRoster } from "./sample";

// The XML reader loads on demand (front door bundle budget).
await loadRosterParsers();

// All names and numbers below are invented test data.
const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<roster id="r1" name="Test Muster" battleScribeVersion="2.03" gameSystemName="Test" xmlns="http://www.battlescribe.net/schema/rosterSchema">
  <costs><cost name="pts" typeId="p" value="335.0"/></costs>
  <forces>
    <force id="f1" name="Main Force" catalogueName="Test">
      <selections>
        <selection id="s0" name="Detachment" type="upgrade" number="1">
          <rules><rule name="Detachment Rule"><description>Should not become a unit.</description></rule></rules>
        </selection>
        <selection id="s1" name="Line Troopers" type="unit" number="1">
          <costs><cost name="pts" typeId="p" value="90.0"/></costs>
          <rules><rule name="Steadfast"><description>Invented rule text.</description></rule></rules>
          <profiles>
            <profile name="Hold Fast" typeName="Abilities">
              <characteristics><characteristic name="Description">Add 1 to Leadership.</characteristic></characteristics>
            </profile>
          </profiles>
          <categories>
            <category name="Faction: Test Legion" primary="false"/>
            <category name="Infantry" primary="false"/>
            <category name="Battleline" primary="true"/>
          </categories>
          <selections>
            <selection id="s2" name="Line Sergeant" type="model" number="1">
              <profiles>
                <profile name="Line Sergeant" typeName="Unit">
                  <characteristics>
                    <characteristic name="M">6&quot;</characteristic>
                    <characteristic name="T">4</characteristic>
                    <characteristic name="SV">3+</characteristic>
                    <characteristic name="W">2</characteristic>
                    <characteristic name="LD">6+</characteristic>
                    <characteristic name="OC">2</characteristic>
                  </characteristics>
                </profile>
              </profiles>
              <selections>
                <selection id="s3" name="Plasma Caster" type="upgrade" number="1">
                  <profiles>
                    <profile name="➤ Plasma Caster - standard" typeName="Ranged Weapons">
                      <characteristics>
                        <characteristic name="Range">12"</characteristic>
                        <characteristic name="A">1</characteristic>
                        <characteristic name="BS">3+</characteristic>
                        <characteristic name="S">7</characteristic>
                        <characteristic name="AP">-2</characteristic>
                        <characteristic name="D">1</characteristic>
                        <characteristic name="Keywords">Pistol</characteristic>
                      </characteristics>
                    </profile>
                    <profile name="➤ Plasma Caster - overcharge" typeName="Ranged Weapons">
                      <characteristics>
                        <characteristic name="Range">12"</characteristic>
                        <characteristic name="A">1</characteristic>
                        <characteristic name="BS">3+</characteristic>
                        <characteristic name="S">8</characteristic>
                        <characteristic name="AP">-3</characteristic>
                        <characteristic name="D">2</characteristic>
                        <characteristic name="Keywords">Hazardous, Pistol</characteristic>
                      </characteristics>
                    </profile>
                  </profiles>
                </selection>
              </selections>
            </selection>
            <selection id="s4" name="Line Trooper" type="model" number="4">
              <costs><cost name="pts" typeId="p" value="0.0"/></costs>
              <profiles>
                <profile name="Line Trooper" typeName="Unit">
                  <characteristics>
                    <characteristic name="M">6"</characteristic>
                    <characteristic name="T">4</characteristic>
                    <characteristic name="SV">3+</characteristic>
                    <characteristic name="W">1</characteristic>
                    <characteristic name="LD">6+</characteristic>
                    <characteristic name="OC">2</characteristic>
                  </characteristics>
                </profile>
              </profiles>
              <selections>
                <selection id="s5" name="Pattern Rifle" type="upgrade" number="3">
                  <profiles>
                    <profile name="Pattern Rifle" typeName="Ranged Weapons">
                      <characteristics>
                        <characteristic name="Range">24"</characteristic>
                        <characteristic name="A">2</characteristic>
                        <characteristic name="BS">3+</characteristic>
                        <characteristic name="S">4</characteristic>
                        <characteristic name="AP">0</characteristic>
                        <characteristic name="D">1</characteristic>
                        <characteristic name="Keywords">Rapid Fire 1</characteristic>
                      </characteristics>
                    </profile>
                  </profiles>
                </selection>
                <selection id="s6" name="Heavy Lance" type="upgrade" number="1">
                  <profiles>
                    <profile name="Heavy Lance" typeName="Ranged Weapons">
                      <characteristics>
                        <characteristic name="Range">36"</characteristic>
                        <characteristic name="A">D6</characteristic>
                        <characteristic name="BS">4+</characteristic>
                        <characteristic name="S">9</characteristic>
                        <characteristic name="AP">-3</characteristic>
                        <characteristic name="D">D6+1</characteristic>
                        <characteristic name="Keywords">Heavy, Blast</characteristic>
                      </characteristics>
                    </profile>
                  </profiles>
                </selection>
              </selections>
            </selection>
            <selection id="s7" name="Combat Knife" type="upgrade" number="1">
              <profiles>
                <profile name="Combat Knife" typeName="Melee Weapons">
                  <characteristics>
                    <characteristic name="Range">Melee</characteristic>
                    <characteristic name="A">3</characteristic>
                    <characteristic name="WS">3+</characteristic>
                    <characteristic name="S">4</characteristic>
                    <characteristic name="AP">0</characteristic>
                    <characteristic name="D">1</characteristic>
                    <characteristic name="Keywords">-</characteristic>
                  </characteristics>
                </profile>
              </profiles>
            </selection>
          </selections>
        </selection>
      </selections>
      <forces>
        <force id="f2" name="Allied Force">
          <selections>
            <selection id="s8" name="Field Marshal" type="model" number="1">
              <costs><cost name="pts" typeId="p" value="75.0"/></costs>
              <profiles>
                <profile name="Field Marshal" typeName="Unit">
                  <characteristics>
                    <characteristic name="M">6"</characteristic>
                    <characteristic name="T">4</characteristic>
                    <characteristic name="SV">3+</characteristic>
                    <characteristic name="W">5</characteristic>
                    <characteristic name="LD">5+</characteristic>
                    <characteristic name="OC">1</characteristic>
                  </characteristics>
                </profile>
                <profile name="Invulnerable Save" typeName="Abilities">
                  <characteristics><characteristic name="Description">4+</characteristic></characteristics>
                </profile>
                <profile name="Duty Blade" typeName="Melee Weapons">
                  <characteristics>
                    <characteristic name="Range">Melee</characteristic>
                    <characteristic name="A">5</characteristic>
                    <characteristic name="WS">2+</characteristic>
                    <characteristic name="S">5</characteristic>
                    <characteristic name="AP">-2</characteristic>
                    <characteristic name="D">2</characteristic>
                    <characteristic name="Keywords">Lethal Hits</characteristic>
                  </characteristics>
                </profile>
              </profiles>
              <categories>
                <category name="Character" primary="true"/>
                <category name="Infantry" primary="false"/>
              </categories>
            </selection>
          </selections>
        </force>
      </forces>
    </force>
  </forces>
</roster>`;

function find(units: ImportedUnit[], name: string): ImportedUnit {
  const u = units.find((x) => x.name === name);
  if (!u) throw new Error(`no unit ${name}`);
  return u;
}

function weaponNames(u: ImportedUnit, i: number): string[] {
  return (u.models[i]?.weapons ?? []).map((k) => u.sheet.weapons[k]?.name ?? "?");
}

describe("parseRosterText (XML)", () => {
  const r = parseRosterText(XML);

  it("reads roster name, points and units", () => {
    expect(r.name).toBe("Test Muster");
    expect(r.points).toBe(335);
    expect(r.units.map((u) => u.name)).toEqual(["Line Troopers", "Field Marshal"]);
    expect(r.warnings).toEqual([]);
  });

  it("builds model groups with a sergeant profile", () => {
    const u = find(r.units, "Line Troopers");
    expect(u.models).toHaveLength(5);
    expect(u.models[0]?.profile).toEqual({
      name: "Line Sergeant",
      chars: { M: '6"', T: "4", SV: "3+", W: "2", LD: "6+", OC: "2" },
    });
    expect(
      u.models.slice(1).every((m) => m.profile.name === "Line Trooper" && m.profile.chars.W === "1"),
    ).toBe(true);
    expect(u.sheet.points).toBe(90);
    expect(u.sheet.keywords).toEqual(["Test Legion", "Infantry", "Battleline"]);
    expect(u.sheet.abilities.map((a) => a.name).sort()).toEqual(["Hold Fast", "Steadfast"]);
    expect(u.base).toEqual({ shape: "round", diameterMm: 32 });
  });

  it("parses multi-profile weapons and hands weapons out round robin", () => {
    const u = find(r.units, "Line Troopers");
    expect(weaponNames(u, 0)).toEqual([
      "Plasma Caster - standard",
      "Plasma Caster - overcharge",
      "Combat Knife",
    ]);
    expect(weaponNames(u, 1)).toEqual(["Pattern Rifle", "Combat Knife"]);
    expect(weaponNames(u, 3)).toEqual(["Pattern Rifle", "Combat Knife"]);
    expect(weaponNames(u, 4)).toEqual(["Heavy Lance", "Combat Knife"]);

    const over = Object.values(u.sheet.weapons).find((w) => w.name === "Plasma Caster - overcharge");
    expect(over).toMatchObject({
      kind: "ranged",
      chars: { RANGE: '12"', A: "1", BS: "3+", S: "8", AP: "-3", D: "2" },
      keywords: ["Hazardous", "Pistol"],
    });
    const lance = Object.values(u.sheet.weapons).find((w) => w.name === "Heavy Lance");
    expect(lance?.chars.D).toBe("D6+1");
    expect(lance?.keywords).toEqual(["Heavy", "Blast"]);
    const knife = Object.values(u.sheet.weapons).find((w) => w.name === "Combat Knife");
    expect(knife?.kind).toBe("melee");
    expect(knife?.keywords).toEqual([]);
    expect(knife?.chars.WS).toBe("3+");
    // ids are unique slugs
    expect(new Set(Object.keys(u.sheet.weapons)).size).toBe(5);
    expect(Object.keys(u.sheet.weapons)).toContain("combat-knife-melee");
  });

  it("reads a single-model character from a nested force with an invulnerable save", () => {
    const u = find(r.units, "Field Marshal");
    expect(u.models).toHaveLength(1);
    expect(u.models[0]?.profile.chars.INV).toBe("4+");
    expect(weaponNames(u, 0)).toEqual(["Duty Blade"]);
    expect(u.sheet.points).toBe(75);
    expect(u.base).toEqual({ shape: "round", diameterMm: 50 });
  });
});

const JSON_ROSTER = {
  roster: {
    name: "Json Host",
    costs: [{ name: "pts", value: 200 }],
    forces: [
      {
        selections: {
          selection: [
            {
              name: "Heavy Walker",
              type: "model",
              number: 1,
              costs: { cost: { name: "pts", value: "200" } },
              categories: [
                { name: "Vehicle" },
                { name: "Walker" },
                { name: "Faction: Json Host", primary: false },
              ],
              rules: [{ name: "Stomp", description: "Invented." }],
              profiles: [
                {
                  name: "Heavy Walker",
                  typeName: "Unit",
                  characteristics: [
                    { name: "M", $text: '8"' },
                    { name: "T", "#text": "9" },
                    { name: "Sv", value: "2+" },
                    { name: "W", $text: "10" },
                    { name: "Ld", $text: "7+" },
                    { name: "OC", $text: "4" },
                    { name: "InvSv", $text: "5+" },
                  ],
                },
              ],
              selections: [
                {
                  name: "Twin Autocannon",
                  type: "upgrade",
                  number: 2,
                  profiles: {
                    profile: {
                      name: "Twin Autocannon",
                      typeName: "Ranged Weapons",
                      characteristics: {
                        characteristic: [
                          { name: "Range", $text: '36"' },
                          { name: "A", $text: "2" },
                          { name: "BS", $text: "3+" },
                          { name: "S", $text: "7" },
                          { name: "AP", $text: "-1" },
                          { name: "D", $text: "2" },
                          { name: "Keywords", $text: "Twin-linked" },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  },
};

describe("parseRosterText (JSON)", () => {
  it("handles wrapped arrays, single objects and text keys", () => {
    const r = parseRosterText(JSON.stringify(JSON_ROSTER));
    expect(r.name).toBe("Json Host");
    expect(r.points).toBe(200);
    expect(r.units).toHaveLength(1);
    const u = r.units[0]!;
    expect(u.models[0]?.profile.chars).toEqual({
      M: '8"',
      T: "9",
      SV: "2+",
      W: "10",
      LD: "7+",
      OC: "4",
      INV: "5+",
    });
    expect(weaponNames(u, 0)).toEqual(["Twin Autocannon", "Twin Autocannon"]);
    expect(u.sheet.keywords).toEqual(["Vehicle", "Walker", "Json Host"]);
    expect(u.base).toEqual({ shape: "round", diameterMm: 90 });
  });

  it("warns on garbage", () => {
    expect(parseRosterText("hello").warnings[0]).toMatch(/Unrecognised/);
    expect(parseRosterText("{ nope").warnings[0]).toMatch(/JSON/);
    expect(parseRosterText("<roster><oops></roster>").warnings[0]).toMatch(/XML/);
  });
});

describe("parseRosterFile", () => {
  it("unzips .rosz", async () => {
    const zip = zipSync({ "Test Muster.ros": strToU8(XML) });
    const r = await parseRosterFile("Test Muster.rosz", zip);
    expect(r.units).toHaveLength(2);
    expect(r.warnings).toEqual([]);
  });

  it("reads .ros and .json, warns on unknown extensions", async () => {
    expect((await parseRosterFile("a.ros", strToU8(XML))).units).toHaveLength(2);
    expect((await parseRosterFile("a.json", strToU8(JSON.stringify(JSON_ROSTER)))).units).toHaveLength(1);
    const odd = await parseRosterFile("a.dat", strToU8(XML));
    expect(odd.units).toHaveLength(2);
    expect(odd.warnings[0]).toMatch(/Unknown file type/);
  });
});

describe("suggestBase", () => {
  const mk = (keywords: string[], w: string) => ({
    sheet: { weapons: {}, abilities: [], keywords } satisfies UnitSheet,
    models: [{ profile: { name: "x", chars: { W: w } }, weapons: [] }],
  });
  it.each([
    [["Vehicle"], "9", { shape: "rect", widthMm: 70, depthMm: 105 }],
    [["Vehicle"], "13", { shape: "rect", widthMm: 90, depthMm: 150 }],
    [["Vehicle"], "20", { shape: "rect", widthMm: 110, depthMm: 180 }],
    [["Vehicle", "Walker"], "8", { shape: "round", diameterMm: 60 }],
    [["Monster"], "12", { shape: "round", diameterMm: 90 }],
    [["Monster"], "16", { shape: "round", diameterMm: 100 }],
    [["Monster"], "22", { shape: "round", diameterMm: 130 }],
    [["Mounted"], "3", { shape: "oval", widthMm: 75, depthMm: 42 }],
    [["Infantry"], "5", { shape: "round", diameterMm: 50 }],
    [["Infantry"], "3", { shape: "round", diameterMm: 40 }],
    [["Infantry", "Character"], "2", { shape: "round", diameterMm: 40 }],
    [["Infantry"], "1", { shape: "round", diameterMm: 28 }],
    [["Infantry"], "2", { shape: "round", diameterMm: 32 }],
  ])("%j W%s", (kw, w, base) => {
    expect(suggestBase(mk(kw, w))).toEqual(base);
  });
});

describe("sampleRoster", () => {
  it.each([0, 1] as const)("variant %i is well formed", (v) => {
    const r = sampleRoster(v);
    expect(r.units).toHaveLength(5);
    expect(r.points).toBe(r.units.reduce((t, u) => t + (u.sheet.points ?? 0), 0));
    const sizes = r.units.map((u) => u.models.length);
    expect(sizes).toContain(10);
    expect(sizes).toContain(5);
    for (const u of r.units) {
      for (const m of u.models) {
        expect(m.weapons.length).toBeGreaterThan(0);
        for (const k of m.weapons) expect(u.sheet.weapons[k]?.id).toBe(k);
      }
    }
  });

  it("differs between variants and covers key weapon rules", () => {
    expect(sampleRoster(0).name).not.toBe(sampleRoster(1).name);
    const kws = new Set(
      [0, 1].flatMap((v) =>
        sampleRoster(v as 0 | 1).units.flatMap((u) =>
          Object.values(u.sheet.weapons).flatMap((w) => w.keywords),
        ),
      ),
    );
    for (const k of [
      "Rapid Fire 1",
      "Heavy",
      "Sustained Hits 1",
      "Lethal Hits",
      "Devastating Wounds",
      "Torrent",
    ]) {
      expect(kws).toContain(k);
    }
    for (const k of ["Blast", "Twin-linked", "Anti-Infantry 4+", "Melta 2"]) expect(kws).toContain(k);
    const inv = sampleRoster(0).units.find((u) => u.models[0]?.profile.chars.INV === "4+");
    expect(inv).toBeDefined();
  });
});
