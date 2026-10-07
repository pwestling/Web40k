import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  rollStage,
  startAttack,
  type AttackSpec,
  type GameState,
  type Model,
} from "./index";

/** An rng that yields the given d6 faces in order. */
const faces = (...values: number[]) => {
  const queue = [...values];
  return () => (queue.shift()! - 1) / 6 + 0.01;
};

const trooper = (id: string, x: number, W = "1"): Model => ({
  id,
  owner: "p2",
  label: id,
  position: { x, y: 0 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: "Trooper", chars: { T: "4", SV: "4+", W } },
});

const spec: AttackSpec = {
  attackerUnitId: "a",
  targetUnitId: "t",
  weaponId: "w",
  weaponName: "Rifle",
  kind: "ranged",
  attacks: "4",
  hit: 3,
  hitMod: 0,
  critHit: 6,
  rerollHits: "none",
  sustained: 0,
  lethal: false,
  wound: 4,
  woundMod: 0,
  critWound: 6,
  rerollWounds: "none",
  devastating: false,
  save: 4,
  damage: "1",
  fnp: null,
};

function withTarget(models: Model[]): GameState {
  return applyEvent(createInitialState(), {
    type: "unit/add",
    unit: { id: "t", owner: "p2", name: "Targets", modelIds: [], formation: { kind: "skirmish" } },
    models,
  });
}

describe("attack sequence", () => {
  it("runs hit, wound, save and damage, removing slain models", () => {
    let state = withTarget([trooper("m1", 0), trooper("m2", 2)]);
    let attack = startAttack(spec, faces());
    expect(attack.attackCount).toBe(4);
    attack = rollStage(state, attack, faces(1, 3, 5, 6)); // 3 hits
    expect(attack.hits).toBe(3);
    attack = rollStage(state, attack, faces(4, 2, 6)); // 2 wounds
    expect(attack.wounds).toBe(2);
    attack = rollStage(state, attack, faces(3, 5)); // 1 unsaved
    expect(attack.unsaved).toBe(1);
    attack = rollStage(state, attack, faces());
    expect(attack.stage).toBe("done");
    state = applyEvent(state, { type: "attack/roll", attack });
    expect(state.models.m1?.destroyed).toBe(true);
    expect(state.models.m2?.destroyed).toBeFalsy();
  });

  it("applies sustained and lethal hits, and devastating wounds skip saves", () => {
    const state = withTarget([trooper("m1", 0)]);
    let attack = startAttack({ ...spec, sustained: 1, lethal: true, devastating: true }, faces());
    attack = rollStage(state, attack, faces(6, 6, 2, 4)); // 2 crits (+2 sustained), 1 normal
    expect(attack.hits).toBe(5);
    expect(attack.autoWounds).toBe(2);
    attack = rollStage(state, attack, faces(6, 1, 1)); // 3 rolled: 1 critical wound
    expect(attack.wounds).toBe(3);
    expect(attack.unsavable).toBe(1);
    attack = rollStage(state, attack, faces(6, 6)); // the other 2 saved
    expect(attack.unsaved).toBe(1);
  });

  it("hits automatically with torrent and re-rolls failed wounds", () => {
    const state = withTarget([trooper("m1", 0)]);
    let attack = startAttack({ ...spec, hit: null, attacks: "2", rerollWounds: "failed" }, faces());
    expect(attack.stage).toBe("wound");
    attack = rollStage(state, attack, faces(1, 5, 4));
    expect(attack.woundDice).toEqual([{ value: 5, rerolledFrom: 1 }, { value: 4 }]);
    expect(attack.wounds).toBe(2);
  });

  it("puts damage on a wounded model first, loses excess and rolls feel no pain per wound", () => {
    let state = withTarget([trooper("m1", 0, "3"), trooper("m2", 2, "3")]);
    state = applyEvent(state, { type: "model/wounds", id: "m2", woundsLost: 2, destroyed: false });
    let attack = startAttack({ ...spec, attacks: "2", damage: "3", fnp: 5 }, faces(), state);
    attack = rollStage(state, attack, faces(6, 6)); // 2 hits
    attack = rollStage(state, attack, faces(6, 6)); // 2 wounds
    attack = rollStage(state, attack, faces(1, 1)); // 2 unsaved
    expect(attack.stage).toBe("damage");
    // m2 has 1 wound left: one FNP die (fails); m1 takes 3: dice 5, 1, 1 → loses 2.
    const done = rollStage(state, attack, faces(2, 5, 1, 1));
    expect(done.damage).toEqual([
      { modelId: "m2", damage: 3, fnp: [2], lost: 1, destroyed: true },
      { modelId: "m1", damage: 3, fnp: [5, 1, 1], lost: 2, destroyed: false },
    ]);
  });
});

describe("turn sequence", () => {
  it("goes from deployment through both players' turns, giving CP each command phase", () => {
    let s = createInitialState();
    for (const [id, seat] of [
      ["p1", 0],
      ["p2", 1],
    ] as const)
      s = applyEvent(s, { type: "player/join", player: { id, name: id, color: "#fff", seat } });
    s = applyEvent(s, { type: "turn/next" });
    expect(s.turn).toMatchObject({ round: 1, activeSeat: 0, phase: 0 });
    expect(s.resources.p1?.CP).toBe(1);
    for (let i = 0; i < 5; i++) s = applyEvent(s, { type: "turn/next" });
    expect(s.turn).toMatchObject({ round: 1, activeSeat: 1, phase: 0 });
    expect(s.resources.p2?.CP).toBe(2);
    for (let i = 0; i < 5; i++) s = applyEvent(s, { type: "turn/next" });
    expect(s.turn).toMatchObject({ round: 2, activeSeat: 0, phase: 0 });
    s = applyEvent(s, { type: "turn/prev" });
    expect(s.turn).toMatchObject({ round: 1, activeSeat: 1, phase: 4 });
  });

  it("attaches a leader to a unit, placing the leader last", () => {
    let s = withTarget([trooper("m1", 0)]);
    s = applyEvent(s, {
      type: "unit/add",
      unit: { id: "l", owner: "p2", name: "Leader", modelIds: [], formation: { kind: "skirmish" } },
      models: [trooper("boss", 1, "4")],
    });
    s = applyEvent(s, { type: "unit/attach", id: "l", to: "t" });
    expect(s.units.l).toBeUndefined();
    expect(s.units.t?.modelIds).toEqual(["m1", "boss"]);
    expect(s.models.boss?.unitId).toBe("t");
  });

  it("hands a reconnecting player's seat and army to their new id", () => {
    let s = withTarget([trooper("m1", 0)]);
    s = applyEvent(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } });
    s = applyEvent(s, { type: "player/claim", player: "p2", by: "new" });
    expect(s.players.new).toMatchObject({ name: "B", seat: 1 });
    expect(s.players.p2).toBeUndefined();
    expect(s.units.t?.owner).toBe("new");
    expect(s.models.m1?.owner).toBe("new");
  });
});
