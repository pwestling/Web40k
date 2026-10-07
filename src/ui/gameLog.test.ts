import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, createRecord, type GameEvent, type GameRecord } from "../core";
import { buildLog, collapseEmpty, lossText } from "./gameLog";

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
      "Ann deployed Troopers",
      "Round 1 · Ann · Command",
      'Ann moved Troopers 6.0"',
    ]);
    expect(log[2]!.kind).toBe("header");
  });

  it("collapses a deployed army into one line", () => {
    const unit = (id: string, pts: number): [string, GameEvent] => [
      "a",
      {
        type: "unit/add",
        unit: {
          id,
          name: id,
          owner: "a",
          modelIds: [],
          formation: { kind: "skirmish" },
          army: "Vanguard",
          sheet: { weapons: {}, abilities: [], keywords: [], points: pts },
        },
        models: [],
      },
    ];
    const log = buildLog(record([join("a", "Ann", 0), unit("u1", 100), unit("u2", 150)]));
    expect(log.map((l) => l.text)).toEqual(["Ann joined", "Ann deployed Vanguard (2 units, 250 pts)"]);
  });
});

describe("collapseEmpty", () => {
  const h = (key: string, text: string) => ({ kind: "header" as const, key, text });
  const l = (key: string, text: string) => ({
    kind: "line" as const,
    key,
    seq: Number(key),
    text,
    undone: false,
  });
  it("folds a player turn with no actions into one line and drops empty phases before actions", () => {
    const out = collapseEmpty([
      h("1", "Round 1 · Ann · Command"),
      h("2", "Round 1 · Ann · Movement"),
      l("3", "Ann moved Troopers"),
      h("3a", "Round 1 · Ann · Shooting"),
      h("4", "Round 1 · Bo · Command"),
      h("5", "Round 1 · Bo · Movement"),
      h("6", "Round 2 · Ann · Command"),
      h("7", "Round 2 · Ann · Movement"),
    ]).map((i) => i.text);
    expect(out).toEqual([
      "Round 1 · Ann · Movement",
      "Ann moved Troopers",
      "Round 1 · Bo: no actions",
      "Round 2 · Ann · Movement",
    ]);
  });
});

describe("lossText", () => {
  const state = (destroyed: string[]) =>
    ({
      models: Object.fromEntries(["a", "b"].map((id) => [id, { id, destroyed: destroyed.includes(id) }])),
    }) as unknown as Parameters<typeof lossText>[0];

  it("says wounds and stands apart when stands take several wounds (UX 106)", () => {
    const hits = [1, 1, 1, 1].map(() => ({ kind: "wounds", modelId: "a", lost: 1 }));
    expect(lossText(state(["a"]), hits)).toBe("4 wounds · 1 base removed");
    expect(lossText(state([]), hits.slice(0, 2))).toBe("2 wounds · 0 bases removed");
  });

  it("keeps the short form when each wound is a model", () => {
    const hits = ["a", "b"].map((modelId) => ({ kind: "wounds", modelId, lost: 1 }));
    expect(lossText(state(["a", "b"]), hits)).toBe("2 bases lost");
    expect(lossText(state([]), [])).toBe("no losses");
  });
});
