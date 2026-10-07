import { describe, expect, it } from "vitest";
import { createRecord, appendEvent, stateAt, type GameEvent, type GameRecord } from "../core";
import { deployChecks, insidePolygon } from "./deployment";

const log = (events: GameEvent[]): GameRecord =>
  events.reduce((r, event, i) => appendEvent(r, { seq: i + 1, at: i, by: "p1", event }), createRecord());

const model = (id: string, x: number, y: number) => ({
  id,
  owner: "p1",
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round" as const, diameterMm: 32 },
  profile: { name: id, chars: {} },
  weapons: [],
});

describe("deployChecks", () => {
  it("lists units not yet placed by hand and units outside the zone", () => {
    const events: GameEvent[] = [
      { type: "player/join", player: { id: "p1", name: "A", color: "#f00" } },
      {
        type: "layout/set",
        layout: {
          terrain: [],
          objectives: [],
          zones: [
            {
              seat: 0,
              points: [
                { x: -30, y: 10 },
                { x: 30, y: 10 },
                { x: 30, y: 22 },
                { x: -30, y: 22 },
              ],
            },
          ],
        },
      },
      {
        type: "unit/add",
        unit: { id: "a", owner: "p1", name: "A", modelIds: [], formation: { kind: "skirmish" } },
        models: [model("a1", 0, 20)],
      },
      {
        type: "unit/add",
        unit: { id: "b", owner: "p1", name: "B", modelIds: [], formation: { kind: "skirmish" } },
        models: [model("b1", 5, 20)],
      },
      { type: "models/move", moves: [{ id: "b1", to: { x: 5, y: 0 } }] },
    ];
    const record = log(events);
    const checks = deployChecks(record, stateAt(record), "p1");
    const by = Object.fromEntries(checks.map((c) => [c.unit.id, c]));
    expect(by.a).toMatchObject({ untouched: false, outside: false });
    expect(by.b).toMatchObject({ untouched: false, outside: true });
  });

  it("tests points against a polygon", () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(insidePolygon({ x: 1, y: 1 }, sq)).toBe(true);
    expect(insidePolygon({ x: 3, y: 1 }, sq)).toBe(false);
  });
});
