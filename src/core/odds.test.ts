import { describe, expect, it } from "vitest";
import type { Step } from "./content/schema";
import type { StepPlan, TestPlan } from "./content/runner";
import { damageDist, mean, passChance, procedureOdds, sumDist } from "./odds";

const test = (target: number | null, more: Partial<TestPlan> = {}): TestPlan => ({
  kind: "test",
  sides: 6,
  target,
  modifier: 0,
  criticalOn: null,
  reroll: "none",
  alwaysFail: [1],
  alwaysPass: [6],
  skip: false,
  compare: "atLeast",
  passOn: "successes",
  sumOf: 1,
  dicePerInput: 1,
  ...more,
});

const steps = [
  { kind: "pool", id: "attacks" },
  { kind: "test", id: "hit" },
  { kind: "test", id: "wound" },
  { kind: "allocate", id: "allocate" },
  { kind: "test", id: "save" },
  { kind: "damage", id: "damage" },
] as unknown as Step[];

describe("odds", () => {
  it("passes a test with the plan's faces, modifier and re-rolls", () => {
    expect(passChance(test(3))).toBeCloseTo(4 / 6);
    expect(passChance(test(3, { modifier: -1 }))).toBeCloseTo(3 / 6);
    expect(passChance(test(7))).toBeCloseTo(1 / 6); // a 6 always passes
    expect(passChance(test(3, { reroll: "failed" }))).toBeCloseTo(4 / 6 + (2 / 6) * (4 / 6));
    expect(passChance(test(3, { reroll: "ones" }))).toBeCloseTo(4 / 6 + (1 / 6) * (4 / 6));
    // The Old World's 7+: a 6, then 4+ on a second die.
    expect(passChance(test(7, { alwaysPass: [] }), 4)).toBeCloseTo((1 / 6) * (3 / 6));
    expect(
      passChance(test(4, { dicePerInput: 2, keep: "highest", alwaysFail: [], alwaysPass: [] })),
    ).toBeCloseTo(0.75);
    expect(passChance(test(7, { sumOf: 2, alwaysFail: [], alwaysPass: [] }))).toBeCloseTo(21 / 36);
    expect(passChance(test(null))).toBe(0);
    expect(passChance(test(0))).toBeNull();
  });

  it("knows dice sums", () => {
    const d = sumDist([
      { count: 1, sides: 3 },
      { count: 1, sides: 0 },
    ]);
    expect(d).toEqual([0, 0, 1 / 3, 1 / 3, 1 / 3]);
    const neg = sumDist([
      { count: 1, sides: 6 },
      { count: -3, sides: 0 },
    ]);
    expect(neg[0]).toBeCloseTo(3 / 6); // 1, 2 and 3 all count as 0
  });

  it("re-rolls damage and keeps it at its floor (#40)", () => {
    const d6 = [{ count: 1, sides: 6 }];
    expect(mean(damageDist(d6, undefined))).toBeCloseTo(3.5);
    // A 1 re-rolled: 3.5 + (1/6)(3.5 − 1).
    expect(mean(damageDist(d6, "ones"))).toBeCloseTo(3.5 + 2.5 / 6);
    // 1–3 re-rolled: half the time 5 on average, half the time 3.5.
    expect(mean(damageDist(d6, "failed"))).toBeCloseTo(0.5 * 5 + 0.5 * 3.5);
    // D6 − 1, never below 1.
    const minus = damageDist([...d6, { count: -1, sides: 0 }], undefined, 1);
    expect(minus[0]).toBe(0);
    expect(minus[1]).toBeCloseTo(2 / 6);
  });

  it("carries the average through hit, wound, save and damage", () => {
    const plans: Record<string, StepPlan> = {
      attacks: { kind: "pool", count: "10" },
      hit: test(3),
      wound: test(4),
      allocate: { kind: "other" },
      save: test(5, { passOn: "failures", alwaysPass: [] }),
      damage: { kind: "damage", amount: "1", ignoreDamage: null, spillover: false },
    };
    const models = Array.from({ length: 10 }, () => ({ wounds: 1 }));
    const odds = procedureOdds(steps, plans, models);
    expect(odds.steps.map((s) => [s.id, Number(s.expected.toFixed(3))])).toEqual([
      ["attacks", 10],
      ["hit", 6.667],
      ["wound", 3.333],
      ["save", 2.222],
      ["damage", 2.222],
    ]);
    expect(odds.slain).toBeCloseTo(10 * (4 / 6) * (3 / 6) * (4 / 6));
    // Every one of ten dice gets through: (2/9)^10.
    expect(odds.wipe).toBeCloseTo((2 / 9) ** 10, 12);
  });

  it("deals damage model by model, with feel no pain and spillover", () => {
    const one = (amount: string, extra: Partial<{ ignoreDamage: number | null; spillover: boolean }> = {}) =>
      procedureOdds(
        [steps[0]!, steps[5]!],
        {
          attacks: { kind: "pool", count: "1" },
          damage: { kind: "damage", amount, ignoreDamage: null, spillover: false, ...extra },
        },
        [{ wounds: 3 }, { wounds: 3 }],
      );
    expect(one("D3").slain).toBeCloseTo(1 / 3);
    expect(one("6").slain).toBeCloseTo(1); // no spillover: the rest is lost
    expect(one("6", { spillover: true }).slain).toBeCloseTo(2);
    expect(one("6", { spillover: true }).wipe).toBeCloseTo(1);
    // Ignore each wound on a 5+: all three of a 3-damage hit must get through.
    expect(one("3", { ignoreDamage: 5 }).slain).toBeCloseTo((4 / 6) ** 3);
    // Expected wounds lost: D3 on a W3 model averages 2; 6 without spillover is capped at 3.
    expect(one("D3").damage).toBeCloseTo(2);
    expect(one("6").damage).toBeCloseTo(3);
    expect(one("6", { spillover: true }).damage).toBeCloseTo(6);
    expect(one("3", { ignoreDamage: 5 }).damage).toBeCloseTo(3 * (4 / 6));
    expect(one("D3")).toMatchObject({ woundsLeft: 6, models: 2 });
  });
});
