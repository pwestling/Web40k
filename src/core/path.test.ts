import { describe, expect, it } from "vitest";
import "../systems";
import {
  alongPath,
  applyEvent,
  createInitialState,
  movedSoFar,
  pathLength,
  type GameState,
  type Model,
} from "./index";

const model = (over: Partial<Model> = {}): Model => ({
  id: "m1",
  owner: "a",
  label: "M",
  position: { x: 0, y: 0 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  phaseStart: { x: 0, y: 0 },
  ...over,
});

function table(m: Model): GameState {
  return { ...createInitialState(), models: { [m.id]: m } };
}
const move = (s: GameState, to: { x: number; y: number }, extra: Record<string, unknown> = {}) =>
  applyEvent(s, { type: "models/move", moves: [{ id: "m1", to, ...extra }] });

describe("moves in legs", () => {
  it("measures along the corners", () => {
    expect(
      pathLength([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBe(7);
    expect(
      alongPath(
        [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 4 },
        ],
        5,
      ),
    ).toEqual({ x: 3, y: 2 });
    expect(movedSoFar(model({ position: { x: 3, y: 4 }, phaseVia: [{ x: 3, y: 0 }] }))).toBe(7);
  });

  it("keeps a drag's corners, adds where it stood when it moves on, and forgets them back at the start", () => {
    let s = move(table(model()), { x: 3, y: 4 }, { via: [{ x: 3, y: 0 }] });
    expect(s.models.m1!.phaseVia).toEqual([{ x: 3, y: 0 }]);
    expect(movedSoFar(s.models.m1!)).toBe(7);
    // A plain re-placement keeps the corners.
    s = move(s, { x: 3, y: 5 });
    expect(movedSoFar(s.models.m1!)).toBe(8);
    // Another leg from there: where it stood becomes a corner.
    s = move(s, { x: 6, y: 9 }, { via: [{ x: 6, y: 5 }] });
    expect(s.models.m1!.phaseVia).toEqual([
      { x: 3, y: 0 },
      { x: 3, y: 5 },
      { x: 6, y: 5 },
    ]);
    // Pulled back along its legs: the corners are replaced.
    s = move(s, { x: 3, y: 2 }, { path: [{ x: 3, y: 0 }] });
    expect(movedSoFar(s.models.m1!)).toBe(5);
    s = move(s, { x: 0, y: 0 });
    expect(s.models.m1!.phaseVia).toBeUndefined();
  });
});
