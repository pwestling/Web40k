import { describe, expect, it } from "vitest";
import type { Step } from "./content/schema";
import type { StepPlan, TestPlan } from "./content/runner";
import { passChance, procedureOdds, sumDist } from "./odds";

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
  });
});
