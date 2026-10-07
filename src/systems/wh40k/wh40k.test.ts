import { describe, expect, it } from "vitest";
import { saveTarget, woundTarget } from "./index";

describe("40k attack mechanics", () => {
  it("compares strength and toughness", () => {
    expect([8, 5, 4, 3, 2].map((s) => woundTarget(s, 4))).toEqual([2, 3, 4, 5, 6]);
  });

  it("applies AP and invulnerable saves", () => {
    expect(saveTarget(3, -1)).toBe(4);
    expect(saveTarget(3, -4, 4)).toBe(4);
    expect(saveTarget(4, -3)).toBeNull();
  });
});
