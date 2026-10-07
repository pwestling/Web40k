import { describe, expect, it } from "vitest";
import {
  applyEvent,
  baseToBaseDistance,
  createInitialState,
  mmToInches,
  rankedOffsets,
  resolveIntent,
  type BaseShape,
  type Model,
} from "./index";

const round32: BaseShape = { shape: "round", diameterMm: 32 };

const model = (id: string, x: number, y: number, base: BaseShape = round32, facing = 0): Model => ({
  id,
  owner: "p1",
  label: id,
  position: { x, y },
  facing,
  base,
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

  it("wheels a ranked unit as one block around its front-left corner", () => {
    const base: BaseShape = { shape: "rect", widthMm: 25.4, depthMm: 25.4 };
    const models = rankedOffsets(4, 2, base).map((o, i) => model(`m${i}`, o.x, o.y, base));
    let s = applyEvent(createInitialState(), {
      type: "unit/add",
      unit: { id: "u", owner: "p1", name: "Regiment", modelIds: [], formation: { kind: "ranked", files: 2 } },
      models,
    });
    // The front rank is 2" wide with its left corner at (-1, 0). Wheel left 90°:
    // the right end swings forward and the unit ends up facing -x.
    s = applyEvent(s, {
      type: "unit/move",
      id: "u",
      pivot: { x: -1, y: 0 },
      turn: -Math.PI / 2,
      delta: { x: 0, y: 0 },
    });

    expect(s.models.m0!.position.x).toBeCloseTo(-0.5);
    expect(s.models.m0!.position.y).toBeCloseTo(0.5);
    expect(s.models.m1!.position.x).toBeCloseTo(-0.5);
    expect(s.models.m1!.position.y).toBeCloseTo(1.5);
    expect(s.models.m0!.facing).toBeCloseTo(-Math.PI / 2);
    expect(s.units.u?.modelIds).toEqual(["m0", "m1", "m2", "m3"]);
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
  const inch: BaseShape = { shape: "round", diameterMm: 25.4 };
  const square: BaseShape = { shape: "rect", widthMm: 25.4, depthMm: 25.4 };

  it("measures round bases edge to edge in inches", () => {
    expect(baseToBaseDistance(model("a", 0, 0, inch), model("b", 3, 0, inch))).toBeCloseTo(2);
    expect(mmToInches(50.8)).toBeCloseTo(2);
  });

  it("measures rectangular bases, respecting facing", () => {
    expect(baseToBaseDistance(model("a", 0, 0, square), model("b", 3, 0, square))).toBeCloseTo(2);
    // Rotated 45°, the corner sticks out by (√2 - 1) / 2".
    const turned = model("b", 3, 0, square, Math.PI / 4);
    expect(baseToBaseDistance(model("a", 0, 0, square), turned)).toBeCloseTo(2 - (Math.SQRT2 - 1) / 2);
    expect(baseToBaseDistance(model("a", 0, 0, square), model("b", 0.5, 0.5, square))).toBe(0);
  });

  it("measures between a round and a rectangular base", () => {
    expect(baseToBaseDistance(model("a", 0, 0, inch), model("b", 0, 3, square))).toBeCloseTo(2, 2);
  });
});
