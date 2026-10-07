import { describe, expect, it } from "vitest";
import { averageDice, parseDice, rollDice } from "./dice";

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
