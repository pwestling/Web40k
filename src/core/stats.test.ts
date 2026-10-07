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
import { biggestSwings, gameStats } from "./stats";

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

describe("game stats", () => {
  it("matches a hand count of one attack's luck, damage and points", () => {
    // Hits 1,3,5,6 at 3+: 3 pass, 4 × 2/3 = 2.67 expected.
    // Wounds 2,4,6 at 4+: 2 pass, 3 × 1/2 = 1.5 expected.
    // Saves 1,5 at 4+: 1 saved, 2 × 1/2 = 1 expected; 1 unsaved wound kills one model.
    const stats = gameStats(attackLog(table(), [1, 3, 5, 6, 2, 4, 6, 1, 5]));
    const [ana, bo] = stats.players;
    const step = (p: typeof ana, id: string) => p!.luck.find((l) => l.step === id);
    expect(step(ana, "hit")).toMatchObject({ rolled: 4, actual: 3 });
    expect(step(ana, "hit")!.expected).toBeCloseTo(8 / 3);
    expect(step(ana, "wound")).toMatchObject({ rolled: 3, actual: 2, expected: 1.5 });
    expect(step(ana, "save")).toBeUndefined();
    expect(step(bo, "save")).toMatchObject({ rolled: 2, actual: 1, expected: 1 });
    expect(bo!.luck.map((l) => l.step)).toEqual(["save"]);

    const shooters = stats.units.find((u) => u.id === "a")!;
    const targets = stats.units.find((u) => u.id === "t")!;
    expect(shooters).toMatchObject({ dealt: 1, slain: 1, taken: 0, lost: 0 });
    expect(targets).toMatchObject({ dealt: 0, slain: 0, taken: 1, lost: 1 });
    expect(ana!.pointsByRound).toEqual([10]);
    expect(bo!.pointsByRound).toEqual([0]);

    // Unsaved: 1 against 4 × 2/3 × 1/2 × 1/2 = 0.67 expected.
    expect(stats.runs).toHaveLength(1);
    expect(stats.runs[0]!.actual).toBe(1);
    expect(stats.runs[0]!.expected).toBeCloseTo(2 / 3);
    expect(stats.runs[0]).toMatchObject({ player: "p1", title: "Shooters at Targets", round: 1 });
    expect(biggestSwings(stats.runs).get(1)).toBe(stats.runs[0]);
  });

  it("leaves out undone events", () => {
    const record = attackLog(table(), [1, 3, 5, 6, 2, 4, 6, 1, 5]);
    // Take back the save roll and what followed: no damage, no save luck.
    const later = record.events.filter(
      (e) => e.event.type === "attack/roll" && e.event.attack.saveDice?.length,
    );
    expect(later.length).toBeGreaterThan(0);
    for (const [i, e] of later.entries())
      record.events.push({ seq: 99 + i, by: "p2", at: 0, event: { type: "undo", seq: e.seq } });
    const stats = gameStats(record);
    expect(stats.players[1]!.luck).toEqual([]);
    expect(stats.units.find((u) => u.id === "t")).toBeUndefined();
  });
});
