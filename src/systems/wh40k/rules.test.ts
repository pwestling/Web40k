import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, type GameState, type Model, type UnitSheet } from "../../core";
import { makePiece } from "./layout";
import {
  aliveModels,
  blockedMoves,
  incoherentModels,
  objectiveControl,
  suggestAttack,
  unitSight,
} from "./rules";

const m = (
  id: string,
  owner: string,
  x: number,
  y: number,
  chars: Record<string, string>,
  weapons: string[] = [],
): Model => ({
  id,
  owner,
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars },
  weapons,
});

const sheet = (
  weapons: UnitSheet["weapons"] = {},
  abilities: UnitSheet["abilities"] = [],
  keywords: string[] = [],
): UnitSheet => ({
  weapons,
  abilities,
  keywords,
});

function table(): GameState {
  let s = createInitialState();
  s = applyEvent(s, {
    type: "unit/add",
    unit: {
      id: "a",
      owner: "p1",
      name: "Shooters",
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: sheet({
        rifle: {
          id: "rifle",
          name: "Rifle",
          kind: "ranged",
          chars: { RANGE: '24"', A: "2", BS: "3+", S: "4", AP: "-1", D: "1" },
          keywords: ["Rapid Fire 1", "Anti-Infantry 4+"],
        },
        melta: {
          id: "melta",
          name: "Melta",
          kind: "ranged",
          chars: { RANGE: '12"', A: "D3", BS: "4+", S: "9", AP: "-4", D: "D6" },
          keywords: ["Melta 2"],
        },
      }),
    },
    models: [
      m("s1", "p1", 0, 0, { M: '6"' }, ["rifle", "melta"]),
      m("s2", "p1", 0, -30, { M: '6"' }, ["rifle"]),
    ],
  });
  s = applyEvent(s, {
    type: "unit/add",
    unit: {
      id: "t",
      owner: "p2",
      name: "Targets",
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: sheet({}, [{ name: "Feel No Pain 5+", text: "" }], ["Infantry"]),
    },
    models: [m("t1", "p2", 0, 6, { T: "4", SV: "3+", W: "2", INV: "5+", OC: "2" })],
  });
  return s;
}

describe("40k suggestions", () => {
  it("counts models in range, rapid fire, anti, AP and feel no pain", () => {
    const s = suggestAttack(table(), "a", "rifle", "t")!;
    expect(s.inRange).toBe(1);
    expect(s.spec.attacks).toBe("3"); // 2 + rapid fire 1 within 12"
    expect(s.spec.hit).toBe(3);
    expect(s.spec.wound).toBe(4);
    expect(s.spec.critWound).toBe(4);
    expect(s.spec.save).toBe(4);
    expect(s.spec.fnp).toBe(5);
  });

  it("uses dice attacks, melta and the invulnerable save", () => {
    const s = suggestAttack(table(), "a", "melta", "t")!;
    expect(s.spec.attacks).toBe("D3");
    expect(s.spec.damage).toBe("D6+2");
    expect(s.spec.save).toBe(5);
  });

  it("adds Melta when every bearer is within half range, else reminds for the ones that are (#55)", () => {
    let st = table();
    // A second melta 8" away: in range, not within half.
    st = {
      ...st,
      models: {
        ...st.models,
        s2: { ...st.models.s2!, position: { x: 0, y: -2 }, weapons: ["rifle", "melta"] },
      },
    };
    const split = suggestAttack(st, "a", "melta", "t")!;
    expect(split.spec.damage).toBe("D6");
    const byHand = (n: string[]) => n.find((x) => x.startsWith("Check by hand")) ?? "";
    expect(byHand(split.notes)).toContain("Melta");
    const close = suggestAttack(table(), "a", "melta", "t")!;
    expect(close.spec.damage).toBe("D6+2");
    expect(byHand(close.notes)).not.toContain("Melta");
  });

  it("flags models out of coherency", () => {
    const st = table();
    expect([...incoherentModels([st.models.s1!, st.models.s2!])].sort()).toEqual(["s1", "s2"]);
  });

  it("gives objectives to the side with more OC in range", () => {
    let s = table();
    s = applyEvent(s, {
      type: "layout/set",
      layout: { terrain: [], zones: [], objectives: [{ id: "o", position: { x: 0, y: 7 } }] },
    });
    expect(objectiveControl(s)[0]).toMatchObject({ controller: "p2", oc: { p2: 2 } });
  });
});

describe("terrain rules", () => {
  const unit = (id: string, owner: string, keywords: string[], models: Model[]) => ({
    type: "unit/add" as const,
    unit: {
      id,
      owner,
      name: id,
      modelIds: [],
      formation: { kind: "skirmish" as const },
      sheet: sheet({}, [], keywords),
    },
    models,
  });

  it('gives cover in light terrain and hides infantry in dense terrain beyond 15"', () => {
    let s = createInitialState();
    s = applyEvent(s, {
      type: "layout/set",
      layout: { terrain: [makePiece("Crater", "c", { x: 0, y: 0 })], objectives: [], zones: [] },
    });
    s = applyEvent(s, unit("t", "p2", ["Infantry"], [m("t1", "p2", 0, 0, {})]));
    s = applyEvent(s, unit("s", "p1", [], [m("s1", "p1", 0, -10, {}), m("s2", "p1", 0, -20, {})]));
    const shooters = aliveModels(s, s.units.s);
    // A crater is exposed: no cover.
    expect(unitSight(s, shooters, s.units.t!).inCover).toBe(0);
    const light = { ...s.terrain[0]!, category: "light" as const };
    s = applyEvent(s, { type: "terrain/update", piece: light });
    expect(unitSight(s, shooters, s.units.t!).inCover).toBe(1);
    s = applyEvent(s, { type: "terrain/update", piece: { ...light, category: "dense" } });
    expect(unitSight(s, [shooters[1]!], s.units.t!)).toMatchObject({ visible: 0, hidden: 1 });
    expect(unitSight(s, [shooters[0]!], s.units.t!).visible).toBe(1);
  });

  it("warns when a vehicle drives through a wall but lets infantry pass", () => {
    let s = createInitialState();
    s = applyEvent(s, {
      type: "layout/set",
      layout: { terrain: [makePiece("Barricade", "b", { x: 0, y: 0 })], objectives: [], zones: [] },
    });
    s = applyEvent(s, unit("v", "p1", ["Vehicle"], [m("v1", "p1", 0, -3, {})]));
    s = applyEvent(s, unit("i", "p1", ["Infantry"], [m("i1", "p1", 1, -3, {})]));
    s = applyEvent(s, {
      type: "models/move",
      moves: [
        { id: "v1", to: { x: 0, y: 3 } },
        { id: "i1", to: { x: 1, y: 3 } },
      ],
    });
    expect(blockedMoves(s, s.units.v!).map((p) => p.id)).toEqual(["b"]);
    expect(blockedMoves(s, s.units.i!)).toEqual([]);
  });

  it("warns when a vehicle drives through a ruin's wall, not when infantry walks through it (PX #57)", () => {
    let s = createInitialState();
    s = applyEvent(s, {
      type: "layout/set",
      layout: { terrain: [makePiece("Ruin", "r", { x: 0, y: 0 })], objectives: [], zones: [] },
    });
    // The ruin's long back wall runs along y = -3 (its depth is 6), with a doorway in the middle:
    // the tank's hull doesn't fit through it, though its centre would.
    const tank = { ...m("v1", "p1", 0, -6, {}), base: { shape: "round" as const, diameterMm: 100 } };
    s = applyEvent(s, unit("v", "p1", ["Vehicle"], [tank]));
    s = applyEvent(s, unit("i", "p1", ["Infantry"], [m("i1", "p1", 1, -6, {})]));
    s = applyEvent(s, {
      type: "models/move",
      moves: [
        { id: "v1", to: { x: 0, y: 1 } },
        { id: "i1", to: { x: 1, y: 1 } },
      ],
    });
    expect(blockedMoves(s, s.units.v!).map((p) => p.id)).toEqual(["r"]);
    expect(blockedMoves(s, s.units.i!)).toEqual([]);
  });
});
