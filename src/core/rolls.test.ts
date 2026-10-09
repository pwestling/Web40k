import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  rollStage,
  startAttack,
  type AttackSpec,
  type GameEvent,
  type GameRecord,
  type GameState,
  type Model,
} from "./index";
import { rollsIn, type TrayRoll } from "./rolls";

/** Dice that come up exactly as listed, in order. */
function loaded(faces: number[]): () => number {
  const queue = [...faces];
  return () => {
    const f = queue.shift();
    if (f === undefined) throw new Error("ran out of dice");
    return (f - 0.5) / 6;
  };
}

const model = (id: string, owner: string, chars: Record<string, string>): Model => ({
  id,
  owner,
  label: id,
  position: { x: Number(id.slice(1)) * 2, y: owner === "p1" ? 0 : 10 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars },
  weapons: [],
});

function table(): GameState {
  let s: GameState = {
    ...createInitialState(),
    players: {
      p1: { id: "p1", name: "Ana", color: "#00f", seat: 0 },
      p2: { id: "p2", name: "Bo", color: "#f00", seat: 1 },
    },
  };
  s = applyEvent(s, {
    type: "unit/add",
    unit: { id: "a", owner: "p1", name: "Shooters", modelIds: [], formation: { kind: "skirmish" } },
    models: [model("a0", "p1", { T: "4", SV: "3+", W: "1" })],
  });
  s = applyEvent(s, {
    type: "unit/add",
    unit: {
      id: "t",
      owner: "p2",
      name: "Targets",
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: { weapons: {}, abilities: [], keywords: [], points: 40 },
    },
    models: [0, 1, 2, 3].map((i) => model(`t${i}`, "p2", { T: "4", SV: "4+", W: "1" })),
  });
  return { ...s, turn: { ...s.turn, round: 1 } };
}

const spec: AttackSpec = {
  attackerUnitId: "a",
  targetUnitId: "t",
  weaponId: "w",
  weaponName: "Gun",
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

/** The attack as the host would log it: declared, then one event per stage. */
function attackLog(initial: GameState, faces: number[]): GameRecord {
  const rng = loaded(faces);
  const events: GameEvent[] = [];
  let attack = startAttack(spec, rng, initial);
  events.push({ type: "attack/declare", attack });
  while (attack.stage !== "done") {
    attack = rollStage(initial, attack, rng);
    events.push({ type: "attack/roll", attack });
  }
  events.push({ type: "attack/clear" });
  return {
    format: "open-battle/record@1",
    initial,
    events: events.map((event, i) => ({ seq: i + 1, by: "p1", at: 0, event })),
  };
}

/** Every roll the tray would play, folding the log one event at a time. */
function trayRolls(record: GameRecord): TrayRoll[] {
  let s = record.initial;
  const out: TrayRoll[] = [];
  for (const { seq, event } of record.events) {
    const next = applyEvent(s, event);
    out.push(...rollsIn(s, next, [event], seq));
    s = next;
  }
  return out;
}

describe("rollsIn", () => {
  it("stages each step of an attack once, from the side that rolled", () => {
    const rolls = trayRolls(attackLog(table(), [1, 3, 5, 6, 2, 4, 6, 1, 5]));
    expect(rolls.map((r) => [r.step, r.dice.map((d) => d.value), r.by, r.defender])).toEqual([
      ["hit", [1, 3, 5, 6], "p1", false],
      ["wound", [2, 4, 6], "p1", false],
      ["save", [1, 5], "p2", true],
    ]);
    expect(rolls[0]!.dice.map((d) => d.ok)).toEqual([false, true, true, true]);
    expect(rolls[0]!.dice[3]!.crit).toBe(true);
    expect(rolls[0]!.title).toBe("Hit 3+");
    expect(new Set(rolls.map((r) => r.chain)).size).toBe(1);
    expect(new Set(rolls.map((r) => r.id)).size).toBe(3);
  });

  it("shows a plain roll, and nothing for an undo", () => {
    const s = table();
    const event: GameEvent = {
      type: "dice/roll",
      roll: { by: "p1", sides: 6, results: [4, 5], label: "charge roll" },
    } as GameEvent;
    const [roll] = rollsIn(s, s, [event], 7);
    expect(roll).toMatchObject({
      title: "Charge roll",
      sum: true,
      by: "p1",
      dice: [{ value: 4 }, { value: 5 }],
    });
    expect(rollsIn(s, s, [event, { type: "undo", seq: 3 }], 8)).toEqual([]);
  });

  it("keeps a game's own roll label as written: a hyphen stays (PX #66 'To hit re-roll')", () => {
    const s = table();
    const event = {
      type: "dice/roll",
      roll: { by: "p1", sides: 6, results: [2], label: "to hit re-roll (Hatred)" },
    } as GameEvent;
    expect(rollsIn(s, s, [event], 7)[0]!.title).toBe("To hit re-roll (Hatred)");
  });
});
