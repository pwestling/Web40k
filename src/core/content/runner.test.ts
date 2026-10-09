import { describe, expect, it } from "vitest";
import { applyEvent, createInitialState, type Model, type Unit } from "../index";
import { fortyK } from "./examples/forty-k";
import { advance, applyOutcomes, previewRun, respond, startRun, type RunEnv, type TestPlan } from "./runner";
import { bindRules, parseDiceSum, readCharacteristics, unitView, formatDice } from "./runtime";
import type { GameSystem } from "./schema";

/** An rng that yields the given faces in order; each entry is [face, sides] or a d6 face. */
const dice = (...faces: (number | [number, number])[]) => {
  const queue = faces.map((f) => (typeof f === "number" ? ([f, 6] as const) : f));
  return () => {
    const next = queue.shift();
    if (!next) throw new Error("ran out of dice");
    return (next[0] - 1) / next[1] + 0.0001;
  };
};

const fig = (id: string, owner: string, x: number, y: number, chars: Record<string, string>): Model => ({
  id,
  owner,
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 25 },
  profile: { name: id, chars },
  weapons: ["w"],
});

function table(
  attacker: Partial<Unit>,
  aChars: Record<string, string>,
  tChars: Record<string, string>,
  n = 2,
) {
  let s = createInitialState();
  s = applyEvent(s, {
    type: "unit/add",
    unit: { id: "a", owner: "p1", name: "A", modelIds: [], formation: { kind: "skirmish" }, ...attacker },
    models: Array.from({ length: n }, (_, i) => fig(`a${i}`, "p1", i, 0, aChars)),
  });
  s = applyEvent(s, {
    type: "unit/add",
    unit: { id: "t", owner: "p2", name: "T", modelIds: [], formation: { kind: "skirmish" } },
    models: Array.from({ length: n }, (_, i) => fig(`t${i}`, "p2", i, 20, tChars)),
  });
  return s;
}

const roles = {
  attacker: { unit: "a" },
  weapon: { unit: "a", weapon: "w" },
  target: { unit: "t" },
};

/** A rank-and-flank system: chart to-hit, stacked modifiers, 7+, armour then ward, reactions. */
const rankAndFlank: GameSystem = {
  id: "rank-test",
  name: "Rank and flank (test)",
  version: "0",
  units: "inch",
  dice: [{ id: "d6", sides: 6 }],
  defaultDie: "d6",
  characteristics: [
    { id: "BS", name: "BS", of: "model", type: "number" },
    { id: "T", name: "T", of: "model", type: "number" },
    { id: "armour", name: "Armour", of: "model", type: "target", aliases: ["Sv"], default: 7 },
    { id: "ward", name: "Ward", of: "model", type: "target", default: 0 },
    { id: "W", name: "W", of: "model", type: "number", default: 1 },
    { id: "range", name: "Range", of: "weapon", type: "distance" },
    { id: "S", name: "S", of: "weapon", type: "number" },
    { id: "AP", name: "AP", of: "weapon", type: "number", default: 0 },
  ],
  weaponKinds: ["ranged"],
  unitShape: { kind: "ranked" },
  tables: [{ id: "toHit", rows: [1, 2, 3, 4, 5], values: [[6], [5], [4], [3], [2]] }],
  statuses: [{ id: "fleeing", name: "Fleeing", on: "unit" }],
  rules: [],
  coreEffects: [
    {
      id: "Moving",
      when: { event: "step.before", where: { is: "event.step", value: "hit" } },
      if: { hasFlag: "attacker", flag: "moved" },
      do: [{ do: "modifyTarget", by: 1 }],
    },
    {
      id: "Long range",
      when: { event: "step.before", where: { is: "event.step", value: "hit" } },
      if: {
        cmp: ">",
        a: { query: { kind: "distance", from: "attacker", to: "target" } },
        b: { op: "/", args: [{ ref: "weapon.range" }, 2] },
      },
      do: [{ do: "modifyTarget", by: 1 }],
    },
  ],
  procedures: [
    {
      id: "shoot",
      name: "Shoot",
      steps: [
        { kind: "pool", id: "attacks", count: { count: "attacker.models" } },
        {
          kind: "test",
          id: "hit",
          compare: "atLeast",
          target: { table: "toHit", row: { ref: "attacker.BS" } },
          alwaysFail: [1],
          roller: "attacker",
          overflow: { followUp: { op: "-", args: [{ ref: "test.target" }, 3] } },
        },
        {
          kind: "test",
          id: "wound",
          compare: "atLeast",
          target: {
            op: "max",
            args: [2, { op: "+", args: [4, { op: "-", args: [{ ref: "target.T" }, { ref: "weapon.S" }] }] }],
          },
          alwaysFail: [1],
          roller: "attacker",
        },
        {
          kind: "test",
          id: "armour",
          compare: "atLeast",
          target: { op: "-", args: [{ ref: "model.armour" }, { ref: "weapon.AP" }] },
          impossibleIf: {
            cmp: ">",
            a: { op: "-", args: [{ ref: "model.armour" }, { ref: "weapon.AP" }] },
            b: 6,
          },
          alwaysFail: [1],
          roller: "defender",
          passOn: "failures",
        },
        {
          kind: "test",
          id: "ward",
          if: { cmp: ">", a: { ref: "model.ward" }, b: 0 },
          compare: "atLeast",
          target: { ref: "model.ward" },
          roller: "defender",
          passOn: "failures",
        },
        { kind: "allocate", id: "casualties", chooser: "defender" },
        { kind: "damage", id: "damage", amount: 1, spillover: true },
      ],
    },
    {
      id: "charge",
      name: "Charge",
      steps: [
        {
          kind: "window",
          id: "react",
          side: "defender",
          options: [
            { id: "hold", label: "Hold" },
            { id: "flee", label: "Flee" },
          ],
          default: "hold",
        },
        {
          kind: "do",
          id: "flee",
          if: { is: "reaction.react", value: "flee" },
          do: [{ do: "applyStatus", target: "target", status: "fleeing" }],
        },
        { kind: "pool", id: "roll", count: { dice: "2D6" } },
      ],
    },
  ],
  actions: [],
  turn: { rounds: 6, round: [] },
};

describe("procedure runner: rank and flank", () => {
  const weapon = {
    w: { id: "w", name: "Bow", kind: "ranged" as const, chars: { range: '24"', S: "3" }, keywords: [] },
  };

  it("stacks modifiers into a 7+ that needs a 6 then a follow-up roll", () => {
    const s = table(
      { sheet: { weapons: weapon, abilities: [], keywords: [] }, status: { moved: true } },
      { BS: "3" },
      { T: "3", Sv: "5+" },
    );
    const env: RunEnv = { system: rankAndFlank, state: s };
    const plan = previewRun(env, "shoot", roles).plans.hit as TestPlan;
    // BS 3 hits on 4+; moving and long range (19" of 24") make it 6+.
    expect(plan.target).toBe(6);

    const s2 = table(
      { sheet: { weapons: weapon, abilities: [], keywords: [] }, status: { moved: true } },
      { BS: "2" },
      { T: "3", Sv: "5+" },
    );
    let run = startRun({ ...env, state: s2, rng: dice() }, "shoot", roles);
    expect(run.tokens).toHaveLength(2);
    // 7+: a 6 then a 4+; one passes the follow-up, one fails it.
    run = advance({ ...env, state: s2, rng: dice(6, 5, 6, 2) }, run);
    const hit = run.records.find((r) => r.id === "hit")!;
    expect((hit.plan as TestPlan).target).toBe(7);
    expect(hit.dice).toEqual([
      { value: 6, success: true, critical: false, followUp: 5 },
      { value: 6, success: false, critical: false, followUp: 2 },
    ]);
    expect(run.tokens).toHaveLength(1);
    expect(hit.fired).toEqual(["Moving", "Long range"]);
  });

  it("runs armour, skips a missing ward save, and removes casualties", () => {
    const s = table(
      { sheet: { weapons: weapon, abilities: [], keywords: [] } },
      { BS: "5" },
      { T: "3", Sv: "5+" },
    );
    const env = (rng: () => number): RunEnv => ({ system: rankAndFlank, state: s, rng });
    let run = startRun(env(dice()), "shoot", roles);
    run = advance(env(dice(3, 4)), run); // 2+ to hit (long range makes it 3+): both hit
    run = advance(env(dice(4, 2)), run); // S3 v T3 wounds on 4+: one wound
    run = advance(env(dice(2)), run); // armour 5+ fails; no ward step
    expect(run.records.map((r) => r.id)).toEqual(["attacks", "hit", "wound", "armour", "ward", "casualties"]);
    expect(run.records.find((r) => r.id === "ward")?.bypassed).toBe(1);
    run = advance(env(dice()), run);
    expect(run.done).toBe(true);
    expect(run.outcomes).toEqual([{ kind: "wounds", modelId: "t0", lost: 1 }]);
    const after = applyOutcomes(s, run.outcomes, () => 1);
    expect(after.models.t0?.destroyed).toBe(true);
  });

  it("goes straight to the end when nothing hits: no wound, save or damage rolls (dogfood #54)", () => {
    const s = table(
      { sheet: { weapons: weapon, abilities: [], keywords: [] } },
      { BS: "5" },
      { T: "3", Sv: "5+" },
    );
    const env = (rng: () => number): RunEnv => ({ system: rankAndFlank, state: s, rng });
    let run = startRun(env(dice()), "shoot", roles);
    run = advance(env(dice(1, 1)), run); // both miss
    expect(run.done).toBe(true);
    expect(run.outcomes).toEqual([]);
  });

  it("waits for the defender's reaction mid-procedure and acts on the answer", () => {
    const s = table({ sheet: { weapons: weapon, abilities: [], keywords: [] } }, { BS: "3" }, { T: "3" });
    const env: RunEnv = { system: rankAndFlank, state: s, rng: dice(3, 4) };
    const run = startRun(env, "charge", { attacker: { unit: "a" }, target: { unit: "t" } });
    expect(run.pending).toEqual({ step: "react", side: "defender", options: expect.any(Array) });
    expect(run.records).toHaveLength(0);

    const fled = respond(env, run, "flee");
    expect(fled.outcomes).toEqual([{ kind: "status", unitId: "t", status: "fleeing", value: true }]);
    expect(fled.records.find((r) => r.id === "roll")?.rolls).toEqual([3, 4]);
    expect(applyOutcomes(s, fled.outcomes, () => 1).units.t?.status?.fleeing).toBe(true);

    const held = respond({ ...env, rng: dice(1, 1) }, run, "hold");
    expect(held.outcomes).toEqual([]);

    const auto = startRun({ ...env, rng: dice(2, 2), autoAnswer: true }, "charge", {
      attacker: { unit: "a" },
      target: { unit: "t" },
    });
    expect(auto.reactions).toEqual({ react: "hold" });
    expect(auto.done).toBe(true);
  });
});

describe("procedure runner: other dice mechanics", () => {
  it("rolls under (Conquest) and adds failed resolve tests to the wounds", () => {
    const system: GameSystem = {
      ...rankAndFlank,
      id: "roll-under",
      characteristics: [{ id: "C", name: "Clash", of: "model", type: "number" }],
      coreEffects: [],
      procedures: [
        {
          id: "clash",
          name: "Clash",
          steps: [
            { kind: "pool", id: "attacks", count: 2 },
            { kind: "test", id: "hit", compare: "atMost", target: { ref: "attacker.C" }, roller: "attacker" },
            {
              kind: "test",
              id: "resolve",
              compare: "atMost",
              target: 3,
              roller: "defender",
              passOn: "inputPlusFailures",
            },
          ],
        },
      ],
    };
    const s = table({}, { C: "3" }, {});
    let run = startRun({ system, state: s, rng: dice() }, "clash", roles);
    run = advance({ system, state: s, rng: dice(2, 5) }, run);
    expect(run.tokens).toHaveLength(1);
    run = advance({ system, state: s, rng: dice(6) }, run);
    expect(run.tokens).toHaveLength(2);
    expect(run.done).toBe(true);
  });

  it("keeps the highest of several save dice against the hit roll on other die sizes (FSD)", () => {
    const system: GameSystem = {
      ...rankAndFlank,
      id: "fsd-test",
      dice: [
        { id: "d6", sides: 6 },
        { id: "d8", sides: 8 },
      ],
      characteristics: [
        { id: "saveDice", name: "Save dice", of: "model", type: "number" },
        { id: "die", name: "Die", of: "weapon", type: "dice" },
      ],
      coreEffects: [],
      procedures: [
        {
          id: "attack",
          name: "Attack",
          steps: [
            { kind: "pool", id: "attacks", count: 2 },
            { kind: "test", id: "hit", die: "d8", compare: "atLeast", target: 4, roller: "attacker" },
            {
              kind: "test",
              id: "save",
              dicePerInput: { ref: "target.saveDice" },
              keep: "highest",
              compare: "atLeast",
              target: { ref: "input.value" },
              roller: "defender",
              passOn: "failures",
            },
          ],
        },
      ],
    };
    const s = table({}, {}, { saveDice: "2" });
    const env = (rng: () => number): RunEnv => ({ system, state: s, rng });
    let run = startRun(env(dice()), "attack", roles);
    run = advance(env(dice([7, 8], [3, 8])), run);
    expect(run.tokens).toEqual([{ tags: [], value: 7 }]);
    run = advance(env(dice(4, 6)), run); // keeps 6, which does not beat a 7
    expect(run.records.find((r) => r.id === "save")?.dice).toEqual([
      { value: 6, dice: [4, 6], success: false, critical: false },
    ]);
    expect(run.tokens).toHaveLength(1);
  });

  it("applies a status's relative change once, not again on the unit's view of its models (#55)", () => {
    const slowed: GameSystem = {
      ...fortyK,
      statuses: [
        ...(fortyK.statuses ?? []),
        {
          id: "slowed",
          name: "Slowed",
          on: "unit",
          effects: [
            { when: { event: "always" }, do: [{ do: "modifyCharacteristic", characteristic: "M", by: -2 }] },
          ],
        },
      ],
    };
    let s = createInitialState();
    s = applyEvent(s, {
      type: "unit/add",
      unit: { id: "u", owner: "p1", name: "U", modelIds: [], formation: { kind: "skirmish" } },
      models: [fig("m", "p1", 0, 0, { M: '6"', OC: "2" })],
    });
    s = applyEvent(s, { type: "unit/status", id: "u", key: "slowed", value: true });
    const view = unitView(s, slowed, s.units.u!, { rules: [] });
    expect(parseFloat(String(view.models[0]!.M))).toBe(4);
    expect(parseFloat(String(view.M))).toBe(4);
  });

  it("runs 40k's battle-shock test from data and applies the status on a failure", () => {
    let s = createInitialState();
    s = applyEvent(s, {
      type: "unit/add",
      unit: { id: "u", owner: "p1", name: "U", modelIds: [], formation: { kind: "skirmish" } },
      models: [fig("m", "p1", 0, 0, { LD: "6+", OC: "2" })],
    });
    const env = (rng: () => number): RunEnv => ({ system: fortyK, state: s, rng });
    let run = startRun(env(dice()), "battleShockTest", { unit: { unit: "u" } });
    run = advance(env(dice(2, 1)), run);
    expect(run.done).toBe(true);
    expect(run.outcomes).toEqual([{ kind: "status", unitId: "u", status: "battleShocked", value: true }]);
    const shocked = applyOutcomes(s, run.outcomes, () => 1);
    // Battle-shocked units have OC 0, from the status's continuous effect.
    expect(unitView(shocked, fortyK, shocked.units.u!).OC).toBe(0);
    expect(unitView(s, fortyK, s.units.u!).OC).toBe(2);

    let passed = startRun(env(dice()), "battleShockTest", { unit: { unit: "u" } });
    passed = advance(env(dice(4, 5)), passed);
    expect(passed.outcomes).toEqual([]);
  });
});

describe("runtime views", () => {
  it("reads imported characteristics through the system's aliases", () => {
    expect(
      readCharacteristics(fortyK, "model", { M: '6"', T: "4", SV: "3+", W: "2", INV: "4+" }),
    ).toMatchObject({
      M: 6,
      T: 4,
      Sv: 3,
      W: 2,
      InSv: 4,
    });
    expect(
      readCharacteristics(fortyK, "weapon", { RANGE: "Melee", A: "D6+1", WS: "3+", AP: "-2" }),
    ).toMatchObject({
      range: 0,
      A: "D6+1",
      skill: 3,
      AP: -2,
      S: 4,
      D: 1,
    });
  });

  it("binds weapon keywords and abilities to the system's rules", () => {
    expect(
      bindRules(
        fortyK.rules,
        ["Sustained Hits D3", "Lethal Hits", "Anti-Infantry 4+", "Anti-Fly 2+", "Assault"],
        "weapon",
      ),
    ).toEqual([
      { rule: "sustainedHits", params: { x: "D3" } },
      { rule: "lethalHits" },
      { rule: "anti", params: { keyword: "Infantry", threshold: 4 } },
      { rule: "anti", params: { keyword: "Fly", threshold: 2 } },
      { rule: "assault" },
    ]);
    expect(bindRules(fortyK.rules, ["Feel No Pain 5+: ignore wounds", "Deep Strike"], "unit")).toEqual([
      { rule: "feelNoPain", params: { threshold: 5 } },
      { rule: "deepStrike" },
    ]);
  });

  it("adds and formats dice sums", () => {
    expect(formatDice(parseDiceSum("D6+1+D6+2"))).toBe("2D6+3");
    expect(formatDice(parseDiceSum("10"))).toBe("10");
    expect(formatDice(parseDiceSum("2D3-1"))).toBe("2D3-1");
  });
});
