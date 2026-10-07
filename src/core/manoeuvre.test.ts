import { describe, expect, it } from "vitest";
import { applyEvent, createRecord, stateAt, type GameState, type Model, type Unit } from ".";
import { blockFrame, formBlock } from "./regiment";
import { closeDoor, fleeMove, pursue, towardsNearestEdge, awayFrom } from "./manoeuvre";
import { templateHits } from "./templates";

const base = { shape: "rect" as const, widthMm: 25, depthMm: 25 };

function withBlock(
  state: GameState,
  id: string,
  owner: string,
  n: number,
  files: number,
  facing: number,
  centre: { x: number; y: number },
): GameState {
  const models: Model[] = Array.from({ length: n }, (_, i) => ({
    id: `${id}${i}`,
    owner,
    unitId: id,
    label: id,
    position: { x: 0, y: 0 },
    facing,
    base,
    profile: { name: id, chars: {} },
    weapons: [],
  }));
  const unit: Unit = {
    id,
    owner,
    name: id,
    modelIds: models.map((m) => m.id),
    formation: { kind: "ranked", files },
  };
  let s: GameState = {
    ...state,
    units: { ...state.units, [id]: unit },
    models: { ...state.models, ...Object.fromEntries(models.map((m) => [m.id, m])) },
  };
  const laid = formBlock(s, unit, files, facing, centre);
  s = applyEvent(s, { type: "unit/form", id, formation: unit.formation, ...laid });
  return s;
}

const empty = () => stateAt(createRecord());

describe("closeDoor", () => {
  it("lines a charger up flush with the target's front", () => {
    // Target faces +y at the origin; the charger comes in from the front, skewed.
    let s = withBlock(empty(), "t", "b", 10, 5, 0, { x: 0, y: 0 });
    s = withBlock(s, "c", "a", 10, 5, Math.PI + 0.4, { x: 2, y: 4.5 });
    const door = closeDoor(s, s.units.c!, s.units.t!)!;
    expect(door.arc).toBe("front");
    const after = applyEvent(s, door.move);
    const cf = blockFrame(after, after.units.c!)!;
    const tf = blockFrame(after, after.units.t!)!;
    expect(Math.cos(cf.facing - Math.PI)).toBeCloseTo(1, 6);
    // Front to front: the charger's front edge lies on the target's front edge.
    expect(cf.front.y).toBeCloseTo(tf.front.y, 6);
    expect(door.distance).toBeGreaterThan(0);
  });

  it("closes onto a flank", () => {
    let s = withBlock(empty(), "t", "b", 10, 5, 0, { x: 0, y: 0 });
    s = withBlock(s, "c", "a", 10, 5, -Math.PI / 2 + 0.3, { x: 9, y: -1 });
    const door = closeDoor(s, s.units.c!, s.units.t!)!;
    expect(["left", "right"]).toContain(door.arc);
    const cf = blockFrame(applyEvent(s, door.move), s.units.c!)!;
    // Facing straight across the table, at the target.
    expect(Math.abs(Math.sin(cf.facing))).toBeCloseTo(1, 6);
  });
});

describe("flee and pursuit", () => {
  it("flees directly away and is caught only by a long enough pursuit", () => {
    let s = withBlock(empty(), "f", "b", 10, 5, 0, { x: 0, y: 0 });
    s = withBlock(s, "p", "a", 10, 5, Math.PI, { x: 0, y: 6 });
    const flee = fleeMove(s, s.units.f!, awayFrom(s, s.units.f!, { x: 0, y: 6 }), 7)!;
    s = applyEvent(s, flee);
    const ff = blockFrame(s, s.units.f!)!;
    expect(Math.cos(ff.facing - Math.PI)).toBeCloseTo(1, 6);
    expect(pursue(s, s.units.p!, s.units.f!, 3)!.caught).toBe(false);
    const caught = pursue(s, s.units.p!, s.units.f!, 12)!;
    expect(caught.caught).toBe(true);
    expect(caught.moved).toBeLessThan(12);
  });

  it("heads for the nearest edge", () => {
    const s = withBlock(empty(), "f", "b", 5, 5, 0, { x: 25, y: 0 });
    expect(towardsNearestEdge(s, s.units.f!)).toEqual({ x: 1, y: 0 });
  });
});

describe("templates", () => {
  it("counts models fully and partly under a blast", () => {
    const s = withBlock(empty(), "u", "b", 10, 5, 0, { x: 0, y: 0 });
    const [hit] = templateHits(s, { id: "t", by: "a", shape: "circle", size: 5, at: { x: 0, y: -1 } });
    expect(hit!.full).toBeGreaterThan(0);
    expect(hit!.full + hit!.partial).toBeLessThanOrEqual(10);
    expect(hit!.partial).toBeGreaterThan(0);
    const line = templateHits(s, {
      id: "l",
      by: "a",
      shape: "line",
      size: 0,
      at: { x: -10, y: -0.5 },
      to: { x: 10, y: -0.5 },
    });
    expect(line[0]!.full).toBe(0);
    expect(line[0]!.partial).toBe(5);
  });
});
