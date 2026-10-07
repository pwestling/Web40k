import { describe, expect, it } from "vitest";
import { appendEvent, createRecord, resolveLogged, type GameRecord, type Intent, type Model } from "../core";
import { roundsLost } from "./Casualties";

const model = (id: string): Model => ({
  id,
  owner: "p1",
  label: id,
  position: { x: 0, y: 0 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
});

function play(intents: Intent[], record: GameRecord = createRecord()): GameRecord {
  for (const intent of intents) {
    const logged = resolveLogged(record, intent, "p1", () => 0.5, 1000);
    if (logged) record = appendEvent(record, logged);
  }
  return record;
}

describe("casualty pile", () => {
  it("reads the round each model fell in from the log, skipping undone kills", () => {
    const record = play([
      { type: "model/add", model: model("a") },
      { type: "model/add", model: model("b") },
      { type: "model/wounds", id: "a", woundsLost: 1, destroyed: true },
      { type: "model/wounds", id: "b", woundsLost: 1, destroyed: true },
      { type: "undo", seq: 4 },
    ]);
    const lost = roundsLost(record, Infinity);
    expect([...lost]).toEqual([["a", 0]]);
    // Scrubbed back to before the undo, both lie in the pile.
    expect([...roundsLost(record, 4).keys()].sort()).toEqual(["a", "b"]);
  });
});
