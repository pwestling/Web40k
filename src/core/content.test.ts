import { describe, expect, it } from "vitest";
import { averageDice, parseDice, rollDice } from "./dice";
import { rollModifiers, type Effect, type GameSystem, type Weapon } from "./index";

describe("dice expressions", () => {
  it("parses datasheet-style expressions", () => {
    expect(parseDice("D6")).toEqual({ count: 1, sides: 6, bonus: 0 });
    expect(parseDice("2D3+1")).toEqual({ count: 2, sides: 3, bonus: 1 });
    expect(parseDice("4")).toEqual({ count: 0, sides: 0, bonus: 4 });
    expect(() => parseDice("lots")).toThrow();
  });

  it("rolls and averages", () => {
    expect(rollDice(parseDice("2D6+1"), () => 0.99)).toEqual({ rolls: [6, 6], total: 13 });
    expect(averageDice(parseDice("D3+3"))).toBe(5);
  });
});

describe("rollModifiers", () => {
  const system: GameSystem = {
    id: "test",
    name: "Test",
    characteristics: [],
    weaponCharacteristics: [],
    phases: ["shooting"],
    turnStructure: "playerTurn",
    defaultFormation: "skirmish",
    defaultTable: { width: 60, depth: 44 },
    rollModifierCaps: { hit: 1 },
  };
  const rifle: Weapon = {
    id: "w",
    name: "Rifle",
    type: "ranged",
    range: 24,
    characteristics: { A: 2, S: 4 },
    keywords: [{ name: "rapidFire", value: 1 }],
  };
  const hit = { kind: "roll", roll: "hit", side: "attacker" } as const;
  const effects: Effect[] = [
    { when: hit, if: [{ kind: "withinHalfRange" }], do: { kind: "modifyRoll", by: 1 } },
    { when: hit, do: { kind: "modifyRoll", by: 1 } },
    { when: hit, do: { kind: "reroll", which: "ones" } },
    { when: hit, if: [{ kind: "inArc", arc: "rear" }], do: { kind: "manual", reminder: "Rear attack" } },
    {
      when: { kind: "roll", roll: "wound", side: "attacker" },
      if: [{ kind: "targetHasKeyword", keyword: "VEHICLE" }],
      do: { kind: "criticalOn", value: 4 },
    },
  ];
  const ctx = { side: "attacker" as const, weapon: rifle, selfKeywords: [], targetKeywords: [] };

  it("applies matching effects and respects the system's modifier cap", () => {
    expect(rollModifiers(system, effects, { ...ctx, roll: "hit", distance: 10 })).toEqual({
      modifier: 1,
      reroll: "ones",
      criticalOn: 6,
      reminders: [],
    });
  });

  it("checks conditions against the target and facing", () => {
    expect(
      rollModifiers(system, effects, { ...ctx, roll: "wound", targetKeywords: ["VEHICLE"] }).criticalOn,
    ).toBe(4);
    expect(
      rollModifiers(system, effects, { ...ctx, roll: "wound", targetKeywords: ["INFANTRY"] }).criticalOn,
    ).toBe(6);
    expect(rollModifiers(system, effects, { ...ctx, roll: "hit", arc: "rear" }).reminders).toEqual([
      "Rear attack",
    ]);
  });
});
