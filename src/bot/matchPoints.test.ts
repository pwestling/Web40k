import { describe, expect, it } from "vitest";
import type { ImportedRoster } from "../systems/wh40k/roster";
import { matchPoints, pointsOf } from "./matchPoints";

const army = (pts: number[]): ImportedRoster =>
  ({
    name: "Sample",
    points: 999,
    units: pts.map((p, i) => ({ name: `U${i}`, sheet: { points: p }, models: [] })),
    warnings: [],
  }) as unknown as ImportedRoster;

describe("Match my points", () => {
  it("counts the units, not the list's own total", () => {
    expect(pointsOf(army([90, 75]))).toBe(165);
  });
  it("cuts the computer's army down to about the player's", () => {
    const cut = matchPoints(army([200, 150, 100, 120, 80]), 335);
    expect(pointsOf(cut)).toBeLessThanOrEqual(335 * 1.1);
    expect(pointsOf(cut)).toBeGreaterThan(250);
    expect(cut.points).toBe(pointsOf(cut));
  });
  it("leaves a smaller army as it is, and keeps at least one unit", () => {
    const small = army([100, 50]);
    expect(matchPoints(small, 400)).toBe(small);
    expect(matchPoints(army([300, 200]), 50).units).toHaveLength(1);
  });
});
