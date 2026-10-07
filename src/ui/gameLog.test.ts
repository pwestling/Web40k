import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, createRecord, type GameEvent, type GameRecord } from "../core";
import { buildLog } from "./gameLog";

function record(events: [string, GameEvent][]): GameRecord {
  return {
    ...createRecord(),
    events: events.map(([by, event], i) => ({ seq: i + 1, by, at: 0, event })),
  };
}

const join = (id: string, name: string, seat: number): [string, GameEvent] => [
  id,
  { type: "player/join", player: { id, name, color: "#fff", seat } },
];

describe("player names", () => {
  it("defaults blank names by seat and never repeats a name", () => {
    let s = createInitialState();
    s = applyEvent(s, join("a", "", 0)[1]);
    s = applyEvent(s, join("b", "Player", 1)[1]);
    expect(s.players.a!.name).toBe("Player 1");
    expect(s.players.b!.name).toBe("Player 2");
    let t = createInitialState();
    t = applyEvent(t, join("a", "Sam", 0)[1]);
    t = applyEvent(t, join("b", "Sam", 1)[1]);
    expect(t.players.b!.name).toBe("Player 2");
  });
});

describe("game log", () => {
  it("names the unit and distance on moves and turns phases into headers", () => {
    const log = buildLog(
      record([
        join("a", "Ann", 0),
        [
          "a",
          {
            type: "unit/add",
            unit: {
              id: "u",
              name: "Troopers",
              owner: "a",
              modelIds: ["m1", "m2"],
              formation: { kind: "skirmish" },
            },
            models: ["m1", "m2"].map((id, i) => ({
              id,
              unitId: "u",
              owner: "a",
              label: id,
              position: { x: i, y: 0 },
              facing: 0,
              base: { shape: "round", diameterMm: 32 },
            })),
          },
        ],
        ["a", { type: "turn/next" }],
        [
          "a",
          {
            type: "models/move",
            moves: [
              { id: "m1", to: { x: 0, y: 5 } },
              { id: "m2", to: { x: 1, y: 6 } },
            ],
          },
        ],
      ]),
    );
    expect(log.map((l) => l.text)).toEqual([
      "Ann joined",
      "Ann deployed Troopers (2)",
      "Round 1 · Ann · Command",
      'Ann moved Troopers 6.0"',
    ]);
    expect(log[2]!.kind).toBe("header");
  });
});
