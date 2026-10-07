import { describe, expect, it } from "vitest";
import { delayedSeq } from "./broadcast";

describe("spectator delay", () => {
  const seen = new Map([
    [1, 0],
    [2, 0],
    [3, 50_000],
    [4, 75_000],
  ]);
  it("shows the newest event at least the delay old", () => {
    expect(delayedSeq([1, 2, 3, 4], seen, 30, 70_000)).toBe(2);
    expect(delayedSeq([1, 2, 3, 4], seen, 30, 90_000)).toBe(3);
  });
  it("shows everything once caught up, or with no delay", () => {
    expect(delayedSeq([1, 2, 3, 4], seen, 30, 200_000)).toBeNull();
    expect(delayedSeq([1, 2, 3, 4], seen, 0, 70_000)).toBeNull();
  });
});
