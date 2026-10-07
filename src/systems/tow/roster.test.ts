import { describe, expect, it } from "vitest";
import { importTowRoster } from "./roster";

// All names and numbers below are invented test data.
const stats = (name: string, type: string, v: string[], extra = "") => `
  <profile name="${name}" typeName="${type}"><characteristics>
    ${["M", "WS", "BS", "S", "T", "W", "I", "A", "Ld"].map((k, i) => `<characteristic name="${k}">${v[i]}</characteristic>`).join("")}
    ${extra}
  </characteristics></profile>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<roster name="Fenland Muster" xmlns="http://www.battlescribe.net/schema/rosterSchema">
  <costs><cost name="pts" value="400"/></costs>
  <forces><force name="Main" catalogueName="Test">
    <selections>
      <selection name="Allegiance" type="upgrade"><rules><rule name="Oaths"><description>Not a unit.</description></rule></rules></selection>
      <selection name="Fen Spearmen" type="unit" number="1">
        <costs><cost name="pts" value="100"/></costs>
        <categories><category name="Core"/><category name="Regular Infantry"/></categories>
        <selections>
          <selection name="Fen Spearman" type="model" number="12">
            <profiles>${stats("Fen Spearman", "Model", ["4", "3", "3", "3", "3", "1", "3", "1", "7"])}</profiles>
            <selections>
              <selection name="Thrusting spear" type="upgrade" number="12">
                <profiles><profile name="Thrusting spear" typeName="Weapon"><characteristics>
                  <characteristic name="R">Combat</characteristic><characteristic name="S">S</characteristic>
                  <characteristic name="AP">-</characteristic><characteristic name="Special Rules">Fight in Extra Rank</characteristic>
                </characteristics></profile></profiles>
              </selection>
            </selections>
          </selection>
          <selection name="Sergeant (champion)" type="upgrade" number="1">
            <costs><cost name="pts" value="6"/></costs>
            <profiles>${stats("Sergeant", "Model", ["4", "3", "3", "3", "3", "1", "3", "2", "7"])}</profiles>
          </selection>
          <selection name="Standard bearer" type="upgrade" number="1">
            <costs><cost name="pts" value="6"/></costs>
            <selections>
              <selection name="Banner of the Marsh" type="upgrade" number="1">
                <costs><cost name="pts" value="20"/></costs>
                <rules><rule name="Banner of the Marsh"><description>Invented banner.</description></rule></rules>
              </selection>
            </selections>
          </selection>
        </selections>
      </selection>
      <selection name="Marsh Lord" type="model" number="1">
        <costs><cost name="pts" value="80"/></costs>
        <categories><category name="Characters"/></categories>
        <profiles>${stats("Marsh Lord", "Model", ["4", "5", "5", "4", "4", "2", "5", "3", "9"], '<characteristic name="Troop Type">Heavy Cavalry</characteristic>')}</profiles>
        <selections>
          <selection name="Fen Strider" type="upgrade" number="1">
            <costs><cost name="pts" value="20"/></costs>
            <profiles>${stats("Fen Strider", "Model", ["8", "3", "-", "3", "3", "1", "3", "1", "-"])}</profiles>
          </selection>
          <selection name="Charm of Mud" type="upgrade" number="1"><costs><cost name="pts" value="15"/></costs></selection>
          <selection name="Long bow" type="upgrade" number="1">
            <profiles><profile name="Long bow" typeName="Weapon"><characteristics>
              <characteristic name="R">30"</characteristic><characteristic name="S">3</characteristic><characteristic name="AP">-</characteristic>
            </characteristics></profile></profiles>
          </selection>
        </selections>
      </selection>
      <selection name="Bog Thing" type="model" number="1">
        <profiles><profile name="Bog Thing" typeName="Model"><characteristics>
          <characteristic name="M">6</characteristic><characteristic name="WS">3</characteristic><characteristic name="S">5</characteristic>
          <characteristic name="T">5</characteristic><characteristic name="W">4</characteristic><characteristic name="A">3</characteristic>
        </characteristics></profile></profiles>
      </selection>
    </selections>
  </force></forces>
</roster>`;

describe("Old World roster import", async () => {
  const roster = await importTowRoster("army.ros", new TextEncoder().encode(XML));
  const [spears, lord, thing] = roster.units;

  it("finds the units, not the army-wide options", () => {
    expect(roster.name).toBe("Fenland Muster");
    expect(roster.points).toBe(400);
    expect(roster.units.map((u) => u.name)).toEqual(["Fen Spearmen", "Marsh Lord", "Bog Thing"]);
  });

  it("maps the profile, troop type, command and magic standard", () => {
    expect(spears!.models).toHaveLength(12);
    expect(spears!.models[0]!.profile).toEqual({
      name: "Sergeant (champion)",
      chars: {
        M: "4",
        WS: "3",
        BS: "3",
        S: "3",
        T: "3",
        W: "1",
        I: "3",
        A: "2",
        Ld: "7",
        Troop: "Regular Infantry",
      },
    });
    expect(spears!.models[1]!.profile.name).toBe("Standard bearer");
    expect(spears!.models[2]!.profile.name).toBe("Fen Spearman");
    expect(spears!.sheet.points).toBe(132);
    expect(spears!.sheet.abilities.map((a) => a.name)).toContain("Banner of the Marsh");
    expect(spears!.base).toEqual({ shape: "rect", widthMm: 20, depthMm: 20 });
    expect(Object.values(spears!.sheet.weapons)[0]).toMatchObject({
      kind: "melee",
      keywords: ["Fight in Extra Rank"],
    });
    expect(spears!.missing).toBeUndefined();
  });

  it("puts a character on its mount, with magic items and a missile weapon", () => {
    expect(lord!.models).toHaveLength(1);
    expect(lord!.models[0]!.profile.chars).toMatchObject({
      M: "8",
      WS: "5",
      Mount: "Fen Strider",
      Troop: "Heavy Cavalry",
    });
    expect(lord!.base).toEqual({ shape: "rect", widthMm: 25, depthMm: 50 });
    expect(lord!.sheet.abilities.map((a) => a.name)).toEqual(["Fen Strider", "Charm of Mud"]);
    expect(lord!.sheet.weapons["long-bow"]).toMatchObject({
      kind: "ranged",
      chars: { Range: '30"', S: "3" },
    });
    expect(lord!.sheet.points).toBe(115);
  });

  it("lists what the roster left out for the player to fill in", () => {
    expect(thing!.missing).toEqual(["BS", "I", "Ld", "Troop"]);
  });
});
