import { describe, expect, it } from "vitest";
import { fortyK } from "../../core/content/examples/forty-k";
import { automateArmy, recognizeArmyRule, recognizeStratagem } from "./recognize";
import {
  ENHANCEMENTS,
  loadRosterParsers,
  parseRosterText,
  parseStratagemText,
  stratagemPhases,
  stratagemSide,
} from "./roster";

// The XML reader loads on demand (front door bundle budget).
await loadRosterParsers();

// Faction rules from the roster (#49). Every name and sentence below is invented test data in the
// shape BattleScribe and New Recruit exports use; no published rules text.
const unitXml = (id: string, name: string, inner = "") => `
        <selection id="${id}" name="${name}" type="model" number="1">
          <profiles>
            <profile name="${name}" typeName="Unit">
              <characteristics>
                <characteristic name="M">6"</characteristic><characteristic name="T">4</characteristic>
                <characteristic name="SV">3+</characteristic><characteristic name="W">4</characteristic>
                <characteristic name="LD">6+</characteristic><characteristic name="OC">1</characteristic>
              </characteristics>
            </profile>
          </profiles>
          <categories><category name="Character"/><category name="Infantry"/></categories>
          ${inner}
        </selection>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<roster id="r" name="Lantern Host" xmlns="http://www.battlescribe.net/schema/rosterSchema">
  <forces>
    <force id="f" name="Main" catalogueName="Invented Order">
      <rules><rule name="Vow of Embers"><description>An army rule the units carry.</description></rule></rules>
      <selections>
        <selection id="d" name="Detachment" type="upgrade" number="1">
          <selections>
            <selection id="d1" name="Ember Vigil" type="upgrade" number="1">
              <rules><rule name="Kindled Resolve"><description>Each time a model in a unit from your army makes a melee attack, add 1 to the Wound roll.</description></rule></rules>
              <profiles>
                <profile name="Smouldering Watch" typeName="Abilities">
                  <characteristics><characteristic name="Description">Players roll off and sing a short song.</characteristic></characteristics>
                </profile>
                <profile name="Banked Fires (1CP)" typeName="Stratagem">
                  <characteristics>
                    <characteristic name="When">Your Shooting phase.</characteristic>
                    <characteristic name="Target">One Infantry unit from your army that has not shot this phase.</characteristic>
                    <characteristic name="Effect">Until the end of the phase, each time a model in your unit makes an attack, re-roll a Hit roll of 1.</characteristic>
                    <characteristic name="Restrictions">Not twice in one game round.</characteristic>
                  </characteristics>
                </profile>
                <profile name="Ash Veil" typeName="Stratagem">
                  <characteristics>
                    <characteristic name="CP">2</characteristic>
                    <characteristic name="When">Your opponent's Shooting phase or the Fight phase, just after an enemy unit selects targets.</characteristic>
                    <characteristic name="Target">One unit from your army that was selected as a target.</characteristic>
                    <characteristic name="Effect">Until the end of the phase, each time an attack targets your unit, subtract 1 from the Hit roll.</characteristic>
                  </characteristics>
                </profile>
                <profile name="Signal Flare" typeName="Stratagem">
                  <characteristics>
                    <characteristic name="CP">1</characteristic>
                    <characteristic name="When">Any phase.</characteristic>
                    <characteristic name="Target">One enemy unit.</characteristic>
                    <characteristic name="Effect">Mark it with a flare until the end of the turn.</characteristic>
                  </characteristics>
                </profile>
              </profiles>
            </selection>
          </selections>
        </selection>
        ${unitXml(
          "c1",
          "Lamp Warden",
          `<selections>
            <selection id="e1" name="Cinder Crown" type="upgrade" number="1">
              <profiles>
                <profile name="Cinder Crown" typeName="Abilities">
                  <characteristics><characteristic name="Description">The bearer glows faintly.</characteristic></characteristics>
                </profile>
              </profiles>
              <categories><category name="Enhancements"/></categories>
            </selection>
          </selections>`,
        )}
        ${unitXml(
          "c2",
          "Wick Keeper",
          `<selections>
            <selection id="g" name="Enhancements" type="upgrade" number="1">
              <selections><selection id="e2" name="Ember Seal" type="upgrade" number="1"/></selections>
            </selection>
          </selections>`,
        )}
      </selections>
    </force>
  </forces>
</roster>`;

const JSON_ROSTER = JSON.stringify({
  roster: {
    name: "Ash Chorus List",
    forces: [
      {
        catalogueName: "Invented Choir",
        rules: [
          {
            name: "Hymn of Cinders",
            description:
              "Stratagem (1CP). WHEN: Your Fight phase. TARGET: One unit from your army that has not fought this phase. EFFECT: Until the end of the phase, each time a model in your unit makes a melee attack, that attack has the [Lethal Hits] ability.",
          },
        ],
        selections: [
          {
            name: "Detachment: Ash Chorus",
            type: "upgrade",
            rules: [
              { name: "Choir Steps", description: "Each unit from your army can sing while it moves." },
            ],
          },
          {
            name: "Cantor",
            type: "model",
            number: 1,
            profiles: [
              {
                name: "Cantor",
                typeName: "Unit",
                characteristics: [
                  { name: "M", $text: '6"' },
                  { name: "T", $text: "4" },
                  { name: "SV", $text: "4+" },
                  { name: "W", $text: "3" },
                ],
              },
            ],
            selections: [
              {
                name: "Ringing Bell",
                type: "upgrade",
                group: "Enhancements",
                rules: [
                  {
                    name: "Ringing Bell",
                    description: "Models in this unit have the Feel No Pain 5+ ability.",
                  },
                ],
              },
              {
                name: "Hidden Verse",
                type: "upgrade",
                rules: [
                  {
                    name: "Hidden Verse",
                    description:
                      "WHEN: Command phase. TARGET: One unit from your army. EFFECT: It hums. Costs 2CP.",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
});

describe("army from the roster (#49)", () => {
  it("reads the faction, the detachment under its parent and its rule", () => {
    const r = parseRosterText(XML);
    expect(r.army?.faction).toBe("Invented Order");
    expect(r.army?.detachment).toBe("Ember Vigil");
    expect(r.army?.rules.map((a) => a.name)).toEqual(["Smouldering Watch", "Kindled Resolve"]);
    expect(r.army?.rules.every((a) => a.group === "Detachment rule")).toBe(true);
  });

  it("reads stratagem profiles: cost from the name or a column, side, phases and target", () => {
    const s = parseRosterText(XML).army!.stratagems;
    expect(s.map((x) => [x.id, x.name, x.cp, x.side, x.phases, !!x.targetsUnit])).toEqual([
      ["banked-fires", "Banked Fires", 1, "active", ["shooting"], true],
      ["ash-veil", "Ash Veil", 2, "either", ["shooting", "fight"], true],
      ["signal-flare", "Signal Flare", 1, "either", undefined, false],
    ]);
    expect(s[0]!.effect).toMatch(/^Until the end of the phase/);
    expect(s[0]!.text).toMatch(/Restrictions: Not twice/);
  });

  it("marks enhancements by category and by the selection they were picked under", () => {
    const r = parseRosterText(XML);
    const warden = r.units.find((u) => u.name === "Lamp Warden")!.sheet.abilities;
    expect(warden.find((a) => a.name === "Cinder Crown")?.group).toBe(ENHANCEMENTS);
    const keeper = r.units.find((u) => u.name === "Wick Keeper")!.sheet.abilities;
    expect(keeper.find((a) => a.name === "Ember Seal")).toEqual({
      name: "Ember Seal",
      text: "",
      group: ENHANCEMENTS,
    });
    // The detachment is not a unit, and stratagems aren't unit abilities.
    expect(r.units.map((u) => u.name)).toEqual(["Lamp Warden", "Wick Keeper"]);
  });

  it("reads JSON: a detachment named in its selection, rule-text stratagems and grouped enhancements", () => {
    const r = parseRosterText(JSON_ROSTER);
    expect(r.army?.faction).toBe("Invented Choir");
    expect(r.army?.detachment).toBe("Ash Chorus");
    expect(r.army?.rules.map((a) => a.name)).toEqual(["Choir Steps"]);
    const s = r.army!.stratagems;
    expect(s.map((x) => [x.name, x.cp, x.side, x.phases, !!x.targetsUnit])).toEqual([
      ["Hymn of Cinders", 1, "active", ["fight"], true],
      ["Hidden Verse", 2, "either", ["command"], true],
    ]);
    expect(s[0]!.effect).toMatch(/Lethal Hits/);
    const cantor = r.units[0]!.sheet.abilities;
    expect(cantor.find((a) => a.name === "Ringing Bell")?.group).toBe(ENHANCEMENTS);
    expect(cantor.some((a) => a.name === "Hidden Verse")).toBe(false);
  });

  it("has no army when the roster names no detachment or stratagems", () => {
    const plain = JSON.stringify({ roster: { name: "x", forces: [{ selections: [] }] } });
    expect(parseRosterText(plain).army).toBeUndefined();
  });

  it("reads the side and phases of When text", () => {
    expect(stratagemSide("Your opponent's Movement phase")).toBe("inactive");
    expect(stratagemSide("Your Command phase")).toBe("active");
    expect(stratagemSide("Fight phase")).toBe("either");
    expect(stratagemPhases("Your Shooting phase or the Fight phase")).toEqual(["shooting", "fight"]);
  });
});

describe("faction rules the recognizer reads (#49)", () => {
  it("reads army-wide and stratagem wording as the unit's own", () => {
    expect(
      recognizeArmyRule(
        {
          name: "x",
          text: "Each time a model in a unit from your army makes a melee attack, add 1 to the Wound roll.",
        },
        fortyK,
      )?.parts,
    ).toEqual([{ kind: "attack", side: "making", weapon: "melee", roll: "wound", by: 1 }]);
    expect(
      recognizeStratagem(
        "Until the end of the phase, each time an attack targets your unit, subtract 1 from the Hit roll.",
        fortyK,
      )?.parts,
    ).toEqual([{ kind: "attack", side: "targeted", roll: "hit", by: -1 }]);
    expect(recognizeStratagem("Mark it with a flare until the end of the turn.", fortyK)).toBeNull();
  });

  it("automates what it reads and leaves the rest as reminders", () => {
    const army = automateArmy(parseRosterText(XML).army!, fortyK);
    expect(army.rules.map((r) => !!r.auto)).toEqual([false, true]);
    expect(army.stratagems.map((s) => !!s.auto)).toEqual([true, true, false]);
  });
});

describe("a pasted stratagem (#51)", () => {
  it("reads its name, cost, side, phases and effect", () => {
    const s = parseStratagemText(
      "Glowing Embers (2CP)\nWHEN: Your Shooting phase.\nTARGET: One unit from your army.\nEFFECT: Until the end of the phase, each time a model in your unit makes an attack, add 1 to the Hit roll.",
      ["glowing-embers"],
    );
    expect(s && [s.id, s.name, s.cp, s.side, s.phases, s.targetsUnit]).toEqual([
      "glowing-embers-2",
      "Glowing Embers",
      2,
      "active",
      ["shooting"],
      true,
    ]);
    expect(recognizeStratagem(s!.effect!, fortyK)?.parts).toEqual([
      { kind: "attack", side: "making", roll: "hit", by: 1 },
    ]);
    expect(parseStratagemText("Just a name")).toBeNull();
  });
});
