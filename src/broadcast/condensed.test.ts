import { describe, expect, it } from "vitest";
import type { GameRecord } from "../core";
import { condensedBeats, condensedLength } from "./Moments";

/** A record of plain events: only their types and seqs matter here. */
function record(types: string[]): GameRecord {
  return {
    format: "open-battle/record@1",
    initial: { seq: 0 },
    events: types.map((type, i) => ({ seq: i + 1, at: i, event: { type, roll: { results: [3] } } })),
  } as unknown as GameRecord;
}

describe("the whole battle, cut down (PX dogfood 3)", () => {
  it("opens each round on a card, jumps over moves and keeps an attack's last roll", () => {
    const r = record([
      "turn/next",
      "models/move",
      "models/move",
      "attack/declare",
      "attack/roll",
      "attack/roll",
      "attack/clear",
      "turn/next",
    ]);
    const beats = condensedBeats(r, 1, 8, [{ seq: 8, round: 1 }]);
    expect(beats.map((b) => `${b.kind}@${b.seq}`)).toEqual(["round@1", "move@3", "roll@6"]);
  });

  it("stays near a minute however long the battle, the last roll kept", () => {
    const long = Array.from({ length: 200 }, (_, i) => (i % 2 ? "dice/roll" : "models/move"));
    const beats = condensedBeats(record(long), 1, 200, [{ seq: 200, round: 1 }]);
    expect(condensedLength(beats)).toBeLessThanOrEqual(62000);
    expect(beats.at(-1)).toMatchObject({ kind: "roll", seq: 200 });
    expect(beats.some((b) => b.kind === "move")).toBe(false);
  });
});
