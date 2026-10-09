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

  it("starts no code action after Battle over, forced or not (dogfood round 2: Rift's Shoot after the end)", () => {
    const base = { ...createInitialState(), system: "forty-k-11" };
    const rounds = systemOf(base).turn.rounds as number;
    const over = {
      ...base,
      players: { p0: { id: "p0", name: "A", color: "#fff", seat: 0 } },
      turn: { ...base.turn, round: rounds + 1 },
    } as typeof base;
    const start = { type: "script/start", procedure: "anything", args: { unit: "u1" }, force: true } as const;
    expect(resolveIntent(start, "p0", () => 0.5, over)).toBeNull();
    const live = { ...over, turn: { ...over.turn, round: rounds } };
    expect(resolveIntent(start, "p0", () => 0.5, live)).not.toBeNull();
  });
});
