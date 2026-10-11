import { describe, expect, it } from "vitest";
import {
  appendEvent,
  createRecord,
  resolveLogged,
  stateAt,
  type AttackSpec,
  type GameRecord,
  type Intent,
  type Model,
} from "./index";

const trooper = (id: string, x: number): Model => ({
  id,
  owner: "p2",
  label: id,
  position: { x, y: 0 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: "Trooper", chars: { T: "4", SV: "4+", W: "1" } },
});

const spec = (rerollHits = "none"): AttackSpec =>
  ({
    ...{ attackerUnitId: "a", targetUnitId: "t", weaponId: "w", weaponName: "Rifle", kind: "ranged" },
    ...{ attacks: "3", hit: 3, hitMod: 0, critHit: 6, rerollHits, sustained: 0, lethal: false },
    ...{ wound: 4, woundMod: 0, critWound: 6, rerollWounds: "none", devastating: false, save: 4 },
    ...{ damage: "1", fnp: null },
  }) as AttackSpec;

function step(record: GameRecord, intent: Intent, by = "p1", told?: number[]): GameRecord | null {
  const logged = resolveLogged(record, (told ? { ...intent, told } : intent) as Intent, by, Math.random, 0);
  return logged && appendEvent(record, logged);
}

function rolled(rerollHits?: string): GameRecord {
  let r = createRecord();
  r = step(r, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } })!;
  r = step(r, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2")!;
  r = step(r, {
    type: "unit/add",
    unit: { id: "t", owner: "p2", name: "Targets", modelIds: [], formation: { kind: "skirmish" } },
    models: [trooper("m1", 0), trooper("m2", 2)],
  } as Intent)!;
  r = step(r, { type: "attack/declare", spec: spec(rerollHits) })!;
  return r;
}
const last = (r: GameRecord) => r.events.at(-1)!.seq;

describe("re-rolling one die (Command Re-roll)", () => {
  it("re-rolls the die picked and keeps the rest", () => {
    let r = step(rolled(), { type: "attack/roll" }, "p1", [2, 4, 6])!;
    expect(stateAt(r).attack?.hits).toBe(2);
    const seq = last(r);
    r = step(r, { type: "attack/reroll", seq, die: 0 }, "p1", [5])!;
    expect(r.events.at(-1)!.event).toMatchObject({
      type: "attack/roll",
      reroll: { step: "hit", die: 0, from: 2, to: 5 },
    });
    const attack = stateAt(r).attack!;
    expect(attack.hits).toBe(3);
    expect(attack.stage).toBe("wound");
    expect(attack.hitDice).toEqual([{ value: 5, rerolledFrom: 2 }, { value: 4 }, { value: 6 }]);
    // A die is re-rolled once.
    expect(step(r, { type: "attack/reroll", seq: last(r), die: 0 }, "p1", [6])).toBeNull();
    // Another of them may be.
    expect(step(r, { type: "attack/reroll", seq: last(r), die: 1 }, "p1", [1])).not.toBeNull();
    // Not a roll from before the attack moved on.
    const wounded = step(r, { type: "attack/roll" }, "p1", [4, 4, 4])!;
    expect(step(wounded, { type: "attack/reroll", seq: last(r), die: 1 })).toBeNull();
    // Nor anything that isn't a roll.
    expect(step(rolled(), { type: "attack/reroll", seq: 3, die: 0 })).toBeNull();
  });

  it("can turn a miss into the attack's end", () => {
    let r = step(rolled(), { type: "attack/roll" }, "p1", [5, 2, 2])!;
    r = step(r, { type: "attack/reroll", seq: last(r), die: 0 }, "p1", [1])!;
    expect(stateAt(r).attack).toMatchObject({ hits: 0 });
  });

  it("won't re-roll a die its rules re-rolled already", () => {
    const r = step(rolled("ones"), { type: "attack/roll" }, "p1", [1, 4, 4, 6])!;
    expect(stateAt(r).attack?.hitDice?.[0]).toEqual({ value: 4, rerolledFrom: 1 });
    expect(step(r, { type: "attack/reroll", seq: last(r), die: 0 }, "p1", [5])).toBeNull();
    expect(step(r, { type: "attack/reroll", seq: last(r), die: 1 }, "p1", [5])).not.toBeNull();
  });
});

describe("playing a stratagem anyway", () => {
  it("takes it against the rules only when forced, and says why", () => {
    let r = createRecord();
    r = step(r, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } })!;
    r = step(r, { type: "game/system", system: "forty-k-11" })!;
    const use: Intent = { type: "player/action", action: "commandReroll" };
    expect(step(r, use)).toBeNull();
    const forced = step(r, { ...use, force: true } as Intent)!;
    expect(forced.events.at(-1)!.event).toMatchObject({
      type: "player/action",
      action: "commandReroll",
      forced: "Once the battle starts",
    });
  });
});
