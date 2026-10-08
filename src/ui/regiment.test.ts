import { describe, expect, it } from "vitest";
import { createInitialState, createRecord, type GameEvent, type GameRecord } from "../core";
import { blockMoves } from "./regiment";

function record(events: GameEvent[]): GameRecord {
  const r = createRecord(createInitialState());
  events.forEach((event, i) => r.events.push({ seq: i + 1, by: "a", at: 0, event }));
  return r;
}

const move = (how: "forward" | "back" | "sideways" | "wheel", distance: number): GameEvent => ({
  type: "unit/move",
  id: "u",
  pivot: { x: 0, y: 0 },
  turn: 0,
  delta: { x: 0, y: 0 },
  how,
  distance,
});

const form = (how: "turn" | "redress" | "reform", distance: number): GameEvent => ({
  type: "unit/form",
  id: "u",
  formation: { kind: "ranked", files: 5 },
  order: [],
  models: [],
  how,
  distance,
});

describe("block moves", () => {
  it("counts backwards and sideways steps at the slow rate", () => {
    const r = record([move("forward", 2), move("back", 1), move("sideways", 1)]);
    expect(blockMoves(r, "u").used).toBeCloseTo(4);
    expect(blockMoves(r, "u", Infinity, 2).used).toBeCloseTo(6);
  });

  it("lists manoeuvres, merging repeated steps and skipping wheels, moves ahead and free redresses", () => {
    const r = record([
      form("redress", 0),
      move("back", 1),
      move("back", 1),
      move("wheel", 2),
      move("forward", 1),
      form("turn", 1),
    ]);
    expect(blockMoves(r, "u").manoeuvres).toEqual(["back", "turn"]);
  });

  it("reads an old negative forward move as a step back", () => {
    expect(blockMoves(record([move("forward", -2)]), "u", Infinity, 2)).toEqual({
      used: 4,
      manoeuvres: ["back"],
    });
  });

  it("starts again each phase", () => {
    const r = record([move("back", 1), { type: "turn/next" }, move("sideways", 1)]);
    expect(blockMoves(r, "u").manoeuvres).toEqual(["sideways"]);
  });
});
