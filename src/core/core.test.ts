import { describe, expect, it } from "vitest";
import {
  applyEvent,
  baseToBaseDistance,
  createInitialState,
  mmToInches,
  resolveIntent,
  type Model,
} from "./index";

const model = (id: string, x: number, y: number, baseMm = 32): Model => ({
  id,
  owner: "p1",
  label: id,
  position: { x, y },
  facing: 0,
  baseMm,
});

describe("reducer", () => {
  it("adds and moves a model without mutating the previous state", () => {
    const s0 = createInitialState();
    const s1 = applyEvent(s0, { type: "model/add", model: model("a", 0, 0) });
    const s2 = applyEvent(s1, { type: "model/move", id: "a", to: { x: 6, y: 0 } });

    expect(s1.models.a?.position).toEqual({ x: 0, y: 0 });
    expect(s2.models.a?.position).toEqual({ x: 6, y: 0 });
    expect(s2.seq).toBe(2);
    expect(s0.models).toEqual({});
  });

  it("logs dice rolls", () => {
    const s = applyEvent(createInitialState(), {
      type: "dice/roll",
      roll: { by: "p1", sides: 6, results: [1, 6] },
    });
    expect(s.log).toEqual([{ kind: "roll", seq: 1, roll: { by: "p1", sides: 6, results: [1, 6] } }]);
  });
});

describe("resolveIntent", () => {
  it("rolls dice on the host with the injected rng", () => {
    const rolls = [0, 0.99, 0.5];
    const event = resolveIntent({ type: "dice/roll", count: 3, sides: 6 }, "p1", () => rolls.shift()!);
    expect(event).toEqual({ type: "dice/roll", roll: { by: "p1", sides: 6, results: [1, 6, 4] } });
  });

  it("rejects nonsense rolls and impersonated joins", () => {
    expect(resolveIntent({ type: "dice/roll", count: 0, sides: 6 }, "p1")).toBeNull();
    expect(
      resolveIntent({ type: "player/join", player: { id: "p2", name: "x", color: "#fff" } }, "p1"),
    ).toBeNull();
  });
});

describe("geometry", () => {
  it("measures base to base in inches", () => {
    // Two 25.4mm (1") bases 3" apart centre to centre are 2" apart edge to edge.
    expect(baseToBaseDistance(model("a", 0, 0, 25.4), model("b", 3, 0, 25.4))).toBeCloseTo(2);
    expect(mmToInches(50.8)).toBeCloseTo(2);
  });
});
