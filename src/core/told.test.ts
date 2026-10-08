import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  createRecord,
  diceWanted,
  resolveLogged,
  startAttack,
  type AttackSpec,
  type GameEvent,
  type Intent,
  type Model,
} from "./index";

const record = createRecord();
const roll = (told?: number[]): Intent =>
  ({ type: "dice/roll", count: 2, sides: 6, ...(told ? { told } : {}) }) as Intent;

describe("dice rolled at the table (#37)", () => {
  it("uses the faces told, in order, and marks the event", () => {
    const logged = resolveLogged(record, roll([3, 5]), "p1", () => 0.99, 0);
    expect(logged?.event).toMatchObject({ type: "dice/roll", roll: { results: [3, 5] } });
    expect(logged?.told).toBe(true);
    expect(resolveLogged(record, roll(), "p1", () => 0.99, 0)?.told).toBeUndefined();
  });

  it("rejects too few faces, too many, or a face the die doesn't have", () => {
    expect(resolveLogged(record, roll([3]), "p1", Math.random, 0)).toBeNull();
    expect(resolveLogged(record, roll([3, 4, 5]), "p1", Math.random, 0)).toBeNull();
    expect(resolveLogged(record, roll([3, 7]), "p1", Math.random, 0)).toBeNull();
  });

  it("says what to roll next", () => {
    expect(diceWanted(record, roll(), "p1", [])).toEqual({ count: 2, sides: 6 });
    expect(diceWanted(record, roll(), "p1", [2])).toEqual({ count: 1, sides: 6 });
    expect(diceWanted(record, roll(), "p1", [2, 2])).toBeNull();
    expect(diceWanted(record, roll(), "p1", [2, 9])).toBe("bad");
    expect(diceWanted(record, roll(), "p1", [2, 2, 2])).toBe("bad");
  });

  it("runs an attack's hit roll from real dice, re-rolls asked for after", () => {
    const trooper = (id: string, x: number): Model => ({
      id,
      owner: "p2",
      label: id,
      position: { x, y: 0 },
      facing: 0,
      base: { shape: "round", diameterMm: 32 },
      profile: { name: "Trooper", chars: { T: "4", SV: "4+", W: "1" } },
    });
    const spec: AttackSpec = {
      ...{ attackerUnitId: "a", targetUnitId: "t", weaponId: "w", weaponName: "Rifle", kind: "ranged" },
      ...{ attacks: "3", hit: 3, hitMod: 0, critHit: 6, rerollHits: "ones", sustained: 0, lethal: false },
      ...{ wound: 4, woundMod: 0, critWound: 6, rerollWounds: "none", devastating: false, save: 4 },
      ...{ damage: "1", fnp: null },
    } as AttackSpec;
    let state = applyEvent(createInitialState(), {
      type: "unit/add",
      unit: { id: "t", owner: "p2", name: "Targets", modelIds: [], formation: { kind: "skirmish" } },
      models: [trooper("m1", 0), trooper("m2", 2)],
    } as GameEvent);
    state = applyEvent(state, { type: "attack/declare", attack: startAttack(spec, () => 0.5, state) });
    const hit: Intent = { type: "attack/roll" };
    expect(diceWanted(record, hit, "p1", [], state)).toEqual({ count: 3, sides: 6 });
    // A 1 is re-rolled: one more die to roll.
    expect(diceWanted(record, hit, "p1", [1, 4, 6], state)).toEqual({ count: 1, sides: 6 });
    expect(diceWanted(record, hit, "p1", [1, 4, 6, 5], state)).toBeNull();
    const logged = resolveLogged(
      record,
      { ...hit, told: [1, 4, 6, 5] } as Intent,
      "p1",
      Math.random,
      0,
      state,
    );
    expect(logged?.event).toMatchObject({ type: "attack/roll", attack: { hits: 3 } });
  });
});
