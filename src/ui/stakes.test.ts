import { describe, expect, it } from "vitest";
import { atLeastMax, atLeastSum } from "./stakes";

describe("decisive roll odds", () => {
  it("counts 2D6 totals and the highest of 2D6", () => {
    expect(atLeastSum(2, 6, 7)).toBeCloseTo(21 / 36);
    expect(atLeastSum(2, 6, 2)).toBeCloseTo(1);
    expect(atLeastSum(2, 6, 13)).toBe(0);
    expect(atLeastMax(2, 6, 6)).toBeCloseTo(11 / 36);
    expect(atLeastMax(2, 6, 0.5)).toBe(1);
  });
});
