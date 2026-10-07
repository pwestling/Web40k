import { describe, expect, it } from "vitest";
import {
  applyEvent,
  arcOf,
  blockCorners,
  blockFrame,
  blockOffsets,
  blockSlots,
  createInitialState,
  formBlock,
  forwardMove,
  rankCount,
  unitStrength,
  wheelMove,
  type BaseShape,
  type GameState,
  type Model,
} from ".";

const inf: BaseShape = { shape: "rect", widthMm: 25.4, depthMm: 25.4 }; // 1" square
const cav: BaseShape = { shape: "rect", widthMm: 25.4, depthMm: 50.8 }; // 1" x 2"

/** A ranked unit of `n` 1" models, `files` wide, front edge centred on `front`, facing `facing`. */
function block(n: number, files: number, front = { x: 0, y: 0 }, facing = 0, bases?: BaseShape[]): GameState {
  const b = bases ?? Array.from({ length: n }, () => inf);
  const offsets = blockOffsets(b, files);
  const models: Model[] = offsets.map((o, i) => ({
    id: `m${i}`,
    owner: "a",
    label: `m${i}`,
    position: {
      x: front.x + o.x * Math.cos(facing) + o.y * Math.sin(facing),
      y: front.y - o.x * Math.sin(facing) + o.y * Math.cos(facing),
    },
    facing,
    base: b[i]!,
  }));
  return applyEvent(createInitialState(), {
    type: "unit/add",
    unit: { id: "u", owner: "a", name: "Block", modelIds: [], formation: { kind: "ranked", files } },
    models,
  });
}

describe("regiment blocks", () => {
  it("lays mixed bases out rank by rank, deeper bases pushing the next rank back", () => {
    const o = blockOffsets([cav, inf, inf, inf], 3);
    expect(o[0]!.x).toBeCloseTo(-1);
    expect(o[0]!.y).toBeCloseTo(-1);
    expect(o[1]!.y).toBeCloseTo(-0.5);
    // The second rank starts behind the cavalry base, 2" back.
    expect(o[3]!.y).toBeCloseTo(-2.5);
    expect(o[3]!.x).toBeCloseTo(0);
  });

  it("finds the block's frame from its models", () => {
    const s = block(10, 5, { x: 3, y: 4 }, Math.PI / 2);
    const f = blockFrame(s, s.units.u!)!;
    expect(f.front.x).toBeCloseTo(3);
    expect(f.front.y).toBeCloseTo(4);
    expect(f.width).toBeCloseTo(5);
    expect(f.depth).toBeCloseTo(2);
    expect(f.ranks).toBe(2);
    expect(blockSlots(s, s.units.u!)).toHaveLength(10);
  });

  it("moves forward along its facing and wheels around a front corner", () => {
    let s = block(10, 5);
    const f = blockFrame(s, s.units.u!)!;
    s = applyEvent(s, forwardMove(f, "u", 4));
    expect(blockFrame(s, s.units.u!)!.front.y).toBeCloseTo(4);
    const before = blockFrame(s, s.units.u!)!;
    const pivot = blockCorners(before).frontRight;
    const wheel = wheelMove(before, "u", Math.PI / 2);
    expect(wheel.distance).toBeCloseTo(5 * (Math.PI / 2));
    s = applyEvent(s, wheel);
    const after = blockFrame(s, s.units.u!)!;
    // The pivot corner stays put; the block now faces its old right.
    expect(blockCorners(after).frontRight.x).toBeCloseTo(pivot.x);
    expect(blockCorners(after).frontRight.y).toBeCloseTo(pivot.y);
    expect(Math.sin(after.facing)).toBeCloseTo(1);
  });

  it("reforms to a new frontage around the same centre, casualties to the back", () => {
    let s = block(10, 5);
    s = applyEvent(s, { type: "model/wounds", id: "m0", woundsLost: 1, destroyed: true });
    const unit = s.units.u!;
    const { order, models } = formBlock(s, unit, 3, 0);
    expect(order.at(-1)).toBe("m0");
    s = applyEvent(s, { type: "unit/form", id: "u", formation: { kind: "ranked", files: 3 }, order, models });
    const f = blockFrame(s, s.units.u!)!;
    expect(f.width).toBeCloseTo(3);
    expect(f.ranks).toBe(3);
    // Same centre as before: the 5 x 2 block's centre was 1" behind its front.
    expect(f.front.y - f.depth / 2).toBeCloseTo(-1);
    expect(s.units.u!.modelIds[0]).toBe("m1");
  });

  it("counts ranks at least the minimum width and unit strength", () => {
    const s = block(13, 5);
    expect(rankCount(s, s.units.u!, 5)).toBe(2);
    expect(rankCount(s, s.units.u!, 6)).toBe(0);
    expect(unitStrength(s, s.units.u!)).toBe(13);
  });

  it("tells front, flank and rear arcs apart from the corners", () => {
    const s = block(10, 5);
    const f = blockFrame(s, s.units.u!)!;
    expect(arcOf(f, { x: 0, y: 5 })).toBe("front");
    // Just outside the front-right corner's 45 degree line.
    expect(arcOf(f, { x: 4, y: 1 })).toBe("right");
    expect(arcOf(f, { x: 3.4, y: 1 })).toBe("front");
    expect(arcOf(f, { x: -6, y: -1 })).toBe("left");
    expect(arcOf(f, { x: 0, y: -6 })).toBe("rear");
  });
});
