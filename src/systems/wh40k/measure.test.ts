import { describe, expect, it } from "vitest";
import { createInitialState, rulerLength, type GameState, type Model } from "../../core";
import { clampFraction } from "./measure";

const m = (id: string, x: number, y: number, start?: { x: number; y: number }): Model => ({
  id,
  owner: "p",
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 25.4 },
  ...(start ? { phaseStart: start } : {}),
});

const table = (models: Model[]): GameState => ({
  ...createInitialState(),
  models: Object.fromEntries(models.map((x) => [x.id, x])),
});

describe("measuring", () => {
  it("measures base to base, base to point and point to point", () => {
    const s = table([m("a", 0, 0), m("b", 10, 0)]);
    // 1" bases: half an inch off each end.
    expect(
      rulerLength(s, { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, fromModel: "a", toModel: "b" }),
    ).toBeCloseTo(9);
    expect(rulerLength(s, { from: { x: 0, y: 0 }, to: { x: 5, y: 0 }, fromModel: "a" })).toBeCloseTo(4.5);
    expect(rulerLength(s, { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } })).toBeCloseTo(5);
  });

  it("finds how far along a move the unit can go within its limit", () => {
    const s = table([m("a", 0, 10, { x: 0, y: 0 }), m("b", 2, 5, { x: 2, y: 0 })]);
    const at = (id: string, k: number) => {
      const x = s.models[id]!;
      return {
        x: x.phaseStart!.x + (x.position.x - x.phaseStart!.x) * k,
        y: x.phaseStart!.y + (x.position.y - x.phaseStart!.y) * k,
      };
    };
    // Model a moved 10", so a 6" limit allows 60% of the way.
    expect(clampFraction(s, ["a", "b"], at, 6)).toBeCloseTo(0.6, 3);
    expect(clampFraction(s, ["a", "b"], at, 12)).toBe(1);
  });

  it("counts climbing towards the limit, as the unit card does", () => {
    const s = table([m("a", 0, 5, { x: 0, y: 0 })]);
    // Ends 2.5" up a crate after 5" across: 7.5" in all, so a 5" limit stops it short.
    const at = (_: string, k: number) => ({ x: 0, y: 5 * k, z: k > 0.5 ? 2.5 : 0 });
    const k = clampFraction(s, ["a"], at, 5);
    expect(k).toBeCloseTo(0.5, 4);
  });
});
