import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  rollStage,
  startAttack,
  type AttackSpec,
  type GameState,
  type Model,
} from "../core";
import { specOdds } from "./odds";

/** The exact odds against the real 40k runner: the mean of many rolled attacks lands on them. */

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const model = (id: string, W: string): Model => ({
  id,
  owner: "p2",
  label: id,
  position: { x: Number(id.slice(1)) * 2, y: 10 },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars: { T: "4", SV: "3+", W } },
  weapons: [],
});

function table(count: number, W: string, hurt: number[] = []): GameState {
  let s = applyEvent(createInitialState(), {
    type: "unit/add",
    unit: { id: "t", owner: "p2", name: "Targets", modelIds: [], formation: { kind: "skirmish" } },
    models: Array.from({ length: count }, (_, i) => model(`t${i}`, W)),
  });
  for (const i of hurt)
    s = applyEvent(s, { type: "model/wounds", id: `t${i}`, woundsLost: 1, destroyed: false });
  return s;
}

const spec = (more: Partial<AttackSpec>): AttackSpec => ({
  attackerUnitId: "a",
  targetUnitId: "t",
  weaponId: "w",
  weaponName: "W",
  kind: "ranged",
  attacks: "10",
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
  ...more,
});

function simulate(state: GameState, s: AttackSpec, runs: number, seed: number) {
  const rng = mulberry(seed);
  let slain = 0;
  let wiped = 0;
  let unsaved = 0;
  const models = state.units.t!.modelIds.length;
  for (let i = 0; i < runs; i++) {
    let a = startAttack(s, rng, state);
    while (a.stage !== "done") a = rollStage(state, a, rng);
    const dead = new Set((a.damage ?? []).filter((d) => d.destroyed).map((d) => d.modelId)).size;
    slain += dead;
    if (dead === models) wiped++;
    unsaved += a.unsaved ?? 0;
  }
  return { slain: slain / runs, wipe: wiped / runs, unsaved: unsaved / runs };
}

describe("attack odds against the runner", () => {
  const cases: [string, GameState, Partial<AttackSpec>][] = [
    ["bolters at W1", table(10, "1"), {}],
    [
      "re-rolls, modifiers and D3 at W3",
      table(5, "3", [2]),
      { attacks: "D6+3", rerollHits: "ones", woundMod: 1, rerollWounds: "failed", damage: "D3" },
    ],
    [
      "feel no pain and D6 attacks",
      table(4, "2"),
      { attacks: "2D6", hitMod: -1, save: 5, damage: "2", fnp: 5 },
    ],
    ["no save, big damage", table(3, "6"), { attacks: "6", hit: null, save: null, damage: "D6+1" }],
  ];
  it.each(cases)(
    "%s: the mean of 4000 rolls matches the exact odds",
    { timeout: 30000 },
    (_name, state, more) => {
      const s = spec(more);
      const odds = specOdds(state, s)!;
      expect(odds.complete).toBe(true);
      const sim = simulate(state, s, 4000, 99);
      const unsaved = odds.steps.find((st) => st.kind === "damage")!.expected;
      expect(sim.unsaved).toBeCloseTo(unsaved, 0);
      expect(Math.abs(sim.slain - odds.slain!)).toBeLessThan(0.08 + odds.slain! * 0.03);
      expect(Math.abs(sim.wipe - odds.wipe!)).toBeLessThan(0.025);
    },
  );
});
