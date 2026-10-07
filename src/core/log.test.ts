import { describe, expect, it } from "vitest";
import {
  appendEvent,
  canUndo,
  createRecord,
  resolveLogged,
  stateAt,
  type GameRecord,
  type Intent,
  type Model,
} from "./index";

const model: Model = {
  id: "m",
  owner: "p1",
  label: "m",
  position: { x: 0, y: 0 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
};

function play(intents: Intent[], record: GameRecord = createRecord()): GameRecord {
  for (const intent of intents) {
    const logged = resolveLogged(record, intent, "p1", () => 0.5, 1000);
    if (logged) record = appendEvent(record, logged);
  }
  return record;
}

describe("event log", () => {
  const moves: Intent[] = [
    { type: "model/add", model },
    { type: "model/move", id: "m", to: { x: 3, y: 0 } },
    { type: "dice/roll", count: 2, sides: 6 },
    { type: "model/move", id: "m", to: { x: 6, y: 0 } },
  ];

  it("numbers events and rebuilds any point in time", () => {
    const record = play(moves);
    expect(record.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(record.events[2]?.event).toEqual({
      type: "dice/roll",
      roll: { by: "p1", sides: 6, results: [4, 4] },
    });
    expect(stateAt(record).models.m?.position).toEqual({ x: 6, y: 0 });
    expect(stateAt(record, 2).models.m?.position).toEqual({ x: 3, y: 0 });
    expect(stateAt(record, 0).models).toEqual({});
  });

  it("undoes an earlier event by replaying without it", () => {
    const record = play([...moves, { type: "undo", seq: 4 }]);
    expect(record.events.at(-1)?.event).toEqual({ type: "undo", seq: 4 });
    expect(stateAt(record).models.m?.position).toEqual({ x: 3, y: 0 });
    expect(stateAt(record).seq).toBe(5);
    // Scrubbing to before the undo still shows the move.
    expect(stateAt(record, 4).models.m?.position).toEqual({ x: 6, y: 0 });
  });

  it("rejects undoing twice, undoing an undo, or a missing event", () => {
    const record = play([...moves, { type: "undo", seq: 4 }]);
    expect(canUndo(record, 4)).toBe(false);
    expect(canUndo(record, 5)).toBe(false);
    expect(canUndo(record, 99)).toBe(false);
    expect(play([{ type: "undo", seq: 4 }], record).events).toHaveLength(5);
  });

  it("round-trips through JSON as a replay file", () => {
    const record = play(moves);
    expect(stateAt(JSON.parse(JSON.stringify(record)) as GameRecord)).toEqual(stateAt(record));
  });
});
