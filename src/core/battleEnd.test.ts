import { describe, expect, it } from "vitest";
import "../systems";
import { createInitialState, resolveIntent } from "./index";
import { systemOf } from "./content/turn";

describe("a finished battle", () => {
  it("can't be moved on to another round (UX 70: ghost rounds from a stale peer)", () => {
    const base = { ...createInitialState(), system: "forty-k-11" };
    const rounds = systemOf(base).turn.rounds;
    expect(typeof rounds).toBe("number");
    const last = { ...base, turn: { ...base.turn, round: rounds as number } };
    expect(resolveIntent({ type: "turn/next" }, "p0", () => 0.5, last)).not.toBeNull();
    const over = { ...base, turn: { ...base.turn, round: (rounds as number) + 1 } };
    expect(resolveIntent({ type: "turn/next" }, "p0", () => 0.5, over)).toBeNull();
    expect(resolveIntent({ type: "turn/pass" }, "p0", () => 0.5, over)).toBeNull();
  });
});
