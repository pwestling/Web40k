import { describe, expect, it } from "vitest";
import { averageDice, parseDice, rollDice } from "../dice";
import { rollModifiers, saveTarget, woundTarget, type Effect, type Weapon } from "./index";

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

describe("attack mechanics", () => {
  it("compares strength and toughness", () => {
    expect([
      woundTarget(8, 4),
      woundTarget(5, 4),
      woundTarget(4, 4),
      woundTarget(3, 4),
      woundTarget(2, 4),
    ]).toEqual([2, 3, 4, 5, 6]);
  });

  it("applies AP and invulnerable saves", () => {
    expect(saveTarget(3, -1)).toBe(4);
    expect(saveTarget(3, -4, 4)).toBe(4);
    expect(saveTarget(4, -3)).toBeNull();
  });
});

describe("rollModifiers", () => {
  const bolter: Weapon = {
    id: "w",
    name: "Rifle",
    type: "ranged",
    range: 24,
    attacks: "2",
    skill: 3,
    strength: 4,
    ap: 0,
    damage: "1",
    keywords: [{ kind: "rapidFire", x: "1" }],
  };
  const effects: Effect[] = [
    {
      when: { kind: "roll", roll: "hit", side: "attacker" },
      if: [{ kind: "withinHalfRange" }],
      do: { kind: "modifyRoll", by: 1 },
    },
    { when: { kind: "roll", roll: "hit", side: "attacker" }, do: { kind: "modifyRoll", by: 1 } },
    { when: { kind: "roll", roll: "hit", side: "attacker" }, do: { kind: "reroll", which: "ones" } },
    {
      when: { kind: "roll", roll: "wound", side: "attacker" },
      if: [{ kind: "targetHasKeyword", keyword: "VEHICLE" }],
      do: { kind: "criticalOn", value: 4 },
    },
  ];

  it("applies matching effects and caps hit modifiers at +1", () => {
    const ctx = {
      roll: "hit" as const,
      side: "attacker" as const,
      weapon: bolter,
      selfKeywords: [],
      targetKeywords: [],
      distance: 10,
    };
    expect(rollModifiers(effects, ctx)).toEqual({
      modifier: 1,
      reroll: "ones",
      criticalOn: 6,
      reminders: [],
    });
  });

  it("checks conditions against the target", () => {
    const base = { roll: "wound" as const, side: "attacker" as const, weapon: bolter, selfKeywords: [] };
    expect(rollModifiers(effects, { ...base, targetKeywords: ["VEHICLE"] }).criticalOn).toBe(4);
    expect(rollModifiers(effects, { ...base, targetKeywords: ["INFANTRY"] }).criticalOn).toBe(6);
  });
});
