import { describe, expect, it } from "vitest";
import { createInitialState, type GameState } from "./index";
import { oneIn, rareOf, tailAtLeast, tailAtMost } from "./rare";
import type { TrayRoll } from "./rolls";

const state: GameState = {
  ...createInitialState(),
  players: {
    p1: { id: "p1", name: "Ana", color: "#00f", seat: 0 },
    p2: { id: "p2", name: "Bo", color: "#f00", seat: 1 },
  },
};

const roll = (oks: boolean[], p: number, extra: Partial<TrayRoll> = {}): TrayRoll => ({
  id: "r",
  title: "Save 4+",
  sides: 6,
  dice: oks.map((ok) => ({ value: ok ? 5 : 2, ok })),
  by: "p2",
  defender: true,
  sum: false,
  step: "save",
  p,
  unitId: "a",
  targetId: "t",
  ...extra,
});

describe("rare outcomes", () => {
  it("binomial tails", () => {
    expect(tailAtLeast(10, 10, 0.5)).toBeCloseTo(1 / 1024, 10);
    expect(tailAtMost(4, 0, 5 / 6)).toBeCloseTo(1 / 1296, 10);
    expect(tailAtLeast(5, 0, 0.3)).toBeCloseTo(1);
  });

  it("calls out ten 4+ saves all holding, for the defender", () => {
    const rare = rareOf([roll(Array(10).fill(true), 0.5)], state, 9);
    expect(rare).toMatchObject({
      lucky: true,
      favours: "p2",
      unitId: "t",
      title: "They will not fall",
      line: "10 of 10 saves · 1 in 1,024",
    });
  });

  it("calls out the attacker's dice collapsing, in the defender's favour", () => {
    const rare = rareOf(
      [roll(Array(4).fill(false), 5 / 6, { by: "p1", defender: false, step: "hit", title: "Hit 2+" })],
      state,
      3,
    );
    expect(rare).toMatchObject({ lucky: false, favours: "p2", unitId: "a", title: "Not a single hit" });
    expect(rare!.line).toBe("0 of 4 hits · 1 in 1,296");
  });

  it("ignores ordinary rolls, two dice and summed tests", () => {
    expect(rareOf([roll([true, true, false, true, false], 0.5)], state, 1)).toBeNull();
    expect(rareOf([roll([true, true], 0.01)], state, 1)).toBeNull();
    expect(rareOf([roll(Array(12).fill(true), 0.5, { sum: true })], state, 1)).toBeNull();
  });

  it("rounds big odds to two figures", () => {
    expect(oneIn(1 / 36_812)).toBe("37,000");
  });
});
