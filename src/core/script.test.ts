import { describe, expect, it } from "vitest";
import type { CodeProcedure, RunResult } from "../sdk";
import "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { sampleRoster } from "../systems/wh40k/sample";
import {
  appendEvent,
  createInitialState,
  createRecord,
  resolveLogged,
  stateAt,
  type GameRecord,
  type Intent,
  type PlayerId,
} from "./index";
import { registerFunctions } from "./content/calls";
import { evaluate } from "./content/expr";
import { evalCtx, procedureEnv } from "./content/play";
import { startRun } from "./content/runner";
import { systemOf } from "./content/turn";
import { applyEvent, resolveIntent } from "./index";
import { registerCode } from "./script";
import { commitmentOf } from "./secrets";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYSTEM = createInitialState().system ?? "forty-k-11";

/** An invented test rule: roll off, the loser picks a forfeit, the winner gains a point. */
const duel: CodeProcedure = function* (ctx, args) {
  const a = (yield ctx.roll("2d6", "Duel: attacker")) as { total: number };
  const b = (yield ctx.roll("2d6", "Duel: defender")) as { total: number };
  const loser = a.total >= b.total ? String(args.defender) : String(args.attacker);
  const pick = yield ctx.ask(loser, "Forfeit what?", [
    { id: "cp", label: "A command point" },
    { id: "nothing", label: "Nothing" },
  ]);
  if (pick === "cp") yield ctx.emit({ type: "resource/adjust", player: loser, resource: "CP", delta: -1 });
  const seen = (ctx.view.own.duels as number | undefined) ?? 0;
  yield ctx.set("duels", seen + 1);
};

let flip = 0;
/** Breaks the rules: yields something different each time it runs. */
const fickle: CodeProcedure = function* (ctx) {
  flip++;
  yield ctx.roll(flip % 2 ? "1d6" : "2d6");
  yield ctx.ask("p1", "Go on?", [{ id: "yes", label: "Yes" }]);
};

/** Calls a data procedure from code: a Battle-shock test, then asks, so the run is replayed. */
const shock: CodeProcedure = function* (ctx, args) {
  const r = (yield ctx.run("battleShockTest", { unit: String(args.unit) })) as RunResult;
  yield ctx.set("shockDice", r.steps.test?.dice ?? []);
  yield ctx.ask("p1", "Seen it?", [{ id: "ok", label: "OK" }]);
  // After the answer the run is replayed: its outcome is still on the table.
  yield ctx.set(
    "shockedAfterReplay",
    Boolean(ctx.view.state.units[String(args.unit)]?.status?.battleShocked),
  );
};

/** A secret pick, then the other player rolls, then the pick is revealed and scored. */
const gambit: CodeProcedure = function* (ctx) {
  yield ctx.secret("p1", "gambit", "Pick a number", [
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ]);
  const r = (yield ctx.roll("1d6", "Gambit")) as { total: number };
  const pick = yield ctx.reveal("p1", "gambit");
  yield ctx.set("gambitWon", (pick === "high") === r.total > 3);
};

registerCode(SYSTEM, { duel, fickle, shock, gambit });

function game(): GameRecord {
  let record = createRecord(createInitialState());
  for (const [id, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    record = host(record, { type: "player/join", player: { id, name: id, seat, color: "#fff" } }, id)!;
  return record;
}

/** The host resolves an intent and logs it; null if rejected. */
function host(record: GameRecord, intent: Intent, by: PlayerId, seed = 1): GameRecord | null {
  const logged = resolveLogged(record, intent, by, rng(seed), 0);
  return logged ? appendEvent(record, logged) : null;
}

describe("code procedures", () => {
  it("roll, wait for the loser's choice, then apply it", () => {
    let record = game();
    record = host(
      record,
      { type: "script/start", procedure: "duel", args: { attacker: "p1", defender: "p2" } },
      "p1",
    )!;
    const waiting = stateAt(record).script!;
    expect(waiting.waiting?.question).toBe("Forfeit what?");
    expect(waiting.results).toHaveLength(2);
    const loser = waiting.waiting!.player;
    const other = loser === "p1" ? "p2" : "p1";
    const cpBefore = stateAt(record).resources[loser]?.CP ?? 0;

    // Only the loser answers, and only with an offered option.
    expect(host(record, { type: "script/answer", answer: "cp" }, other)).toBeNull();
    expect(host(record, { type: "script/answer", answer: "gold" }, loser)).toBeNull();

    record = host(record, { type: "script/answer", answer: "cp" }, loser)!;
    const after = stateAt(record);
    expect(after.script).toBeNull();
    expect(after.resources[loser]?.CP ?? 0).toBe(cpBefore - 1);
    expect(after.modules?.[SYSTEM]?.duels).toBe(1);
  });

  it("a new host resumes with the same dice: replays never re-roll", () => {
    let record = game();
    record = host(
      record,
      { type: "script/start", procedure: "duel", args: { attacker: "p1", defender: "p2" } },
      "p1",
      7,
    )!;
    const before = stateAt(record).script!;
    // Another peer takes over with its own rng and only the log.
    const migrated: GameRecord = JSON.parse(JSON.stringify(record));
    const answered = host(
      migrated,
      { type: "script/answer", answer: "nothing" },
      before.waiting!.player,
      999,
    )!;
    const step = answered.events.at(-1)!.event;
    expect(step.type).toBe("script/step");
    // No new dice in the answer step: the two rolls came from the record.
    expect(step.type === "script/step" && step.events.some((e) => e.type === "dice/roll")).toBe(false);
    expect(stateAt(answered).modules?.[SYSTEM]?.duels).toBe(1);
  });

  it("stops a procedure that yields different commands on replay", () => {
    let record = game();
    record = host(record, { type: "script/start", procedure: "fickle" }, "p1")!;
    expect(stateAt(record).script?.waiting).toBeTruthy();
    record = host(record, { type: "script/answer", answer: "yes" }, "p1")!;
    const step = record.events.at(-1)!.event;
    expect(step.type === "script/step" && step.error).toMatch(/differently on replay/);
    expect(stateAt(record).script).toBeNull();
  });

  it("one procedure at a time, and unknown procedures end with an error", () => {
    let record = game();
    record = host(
      record,
      { type: "script/start", procedure: "duel", args: { attacker: "p1", defender: "p2" } },
      "p1",
    )!;
    expect(host(record, { type: "script/start", procedure: "duel" }, "p2")).toBeNull();
    const fresh = host(game(), { type: "script/start", procedure: "nope" }, "p1")!;
    const step = fresh.events.at(-1)!.event;
    expect(step.type === "script/step" && step.error).toMatch(/No procedure/);
  });

  it("ctx.run plays a data procedure with the host's dice and applies its outcomes", () => {
    let record = game();
    for (const i of spawnIntents(stateAt(record), "p1", sampleRoster(0).units, "p1", "army"))
      record = host(record, i, "p1")!;
    const unit = Object.values(stateAt(record).units)[0]!;
    // Seed until a failed test, so the outcome (battle-shocked) shows.
    for (let seed = 1; seed < 50; seed++) {
      let r = host(
        record,
        { type: "script/start", procedure: "shock", args: { unit: unit.id } },
        "p1",
        seed,
      )!;
      const own = () => (stateAt(r).modules?.[SYSTEM] ?? {}) as Record<string, unknown>;
      expect((own().shockDice as number[]).length).toBe(1);
      const shocked = Boolean(stateAt(r).units[unit.id]!.status?.battleShocked);
      r = host(r, { type: "script/answer", answer: "ok" }, "p1", seed + 100)!;
      expect(stateAt(r).script).toBeNull();
      expect(own().shockedAfterReplay).toBe(shocked);
      if (shocked) return;
    }
    throw new Error("never failed a Battle-shock test");
  });

  it("data calls module functions with { call }, refs passed as what they name", () => {
    registerFunctions(SYSTEM, {
      double: (_view, n) => Number(n) * 2,
      isRound: (view) => view.round === 0,
      named: (_view, unit) => (unit as { name?: string }).name === "Bob",
    });
    const state = stateAt(game());
    const ctx = evalCtx(state, systemOf(state), { it: { name: "Bob" } });
    expect(evaluate({ call: "double", args: [{ op: "+", args: [1, 2] }] }, ctx)).toBe(6);
    expect(evaluate({ call: "isRound" }, ctx)).toBe(true);
    expect(evaluate({ call: "named", args: [{ ref: "it" }] }, ctx)).toBe(true);
    expect(() => evaluate({ call: "missing" }, ctx)).toThrow(/No function "missing"/);
  });

  it("a data procedure's { do: script } starts the code procedure when the run is closed", () => {
    let record = game();
    for (const i of spawnIntents(stateAt(record), "p1", sampleRoster(0).units, "p1", "army"))
      record = host(record, i, "p1")!;
    const state = stateAt(record);
    const unit = Object.values(state.units)[0]!;
    // A data procedure (added for the test) whose only step asks for the duel.
    const base = systemOf(state);
    const system = {
      ...base,
      procedures: [
        ...base.procedures,
        {
          id: "callsDuel",
          name: "Calls a duel",
          params: ["unit"],
          steps: [
            {
              kind: "do" as const,
              id: "go",
              do: [
                {
                  do: "script" as const,
                  procedure: "duel",
                  args: { attacker: 1, defender: 2, unit: { ref: "unit" } },
                },
              ],
            },
          ],
        },
      ],
    };
    const run = startRun({ ...procedureEnv(state, rng(1)), system }, "callsDuel", {
      unit: { unit: unit.id },
    });
    expect(run.done).toBe(true);
    expect(run.outcomes).toEqual([
      { kind: "script", procedure: "duel", args: { attacker: 1, defender: 2, unit: unit.id } },
    ]);
    const withRun = {
      ...state,
      procedure: {
        run,
        title: "Calls a duel",
        unitId: unit.id,
        action: "callsDuel",
        by: "p1",
        applied: true,
      },
    };
    const event = resolveIntent({ type: "procedure/clear" }, "p1", rng(2), withRun)!;
    expect(event.type === "procedure/clear" && event.script?.script?.procedure).toBe("duel");
    const after = applyEvent(withRun, event);
    expect(after.procedure).toBeNull();
    expect(after.script?.waiting?.question).toBe("Forfeit what?");
  });

  it("commits a secret choice without the host seeing it, then reveals and checks it", () => {
    let record = game();
    record = host(record, { type: "script/start", procedure: "gambit" }, "p2")!;
    expect(stateAt(record).script?.waiting).toMatchObject({ player: "p1", secret: "gambit" });
    // p1's device keeps "high" and answers with only the commitment.
    const commitment = commitmentOf("high", "pepper");
    expect(host(record, { type: "script/answer", answer: commitment }, "p2")).toBeNull();
    record = host(record, { type: "script/answer", answer: commitment }, "p1")!;
    const waiting = stateAt(record);
    expect(waiting.secrets?.p1?.gambit).toEqual({ commitment });
    expect(waiting.script?.waiting).toMatchObject({ player: "p1", reveal: "gambit" });
    expect(JSON.stringify(record)).not.toContain(`"value":"high"`);
    // A reveal that doesn't match stays waiting; the right one goes through.
    const wrong = host(
      record,
      { type: "script/answer", answer: JSON.stringify({ value: "low", salt: "pepper" }) },
      "p1",
    )!;
    expect(stateAt(wrong).script?.waiting?.reveal).toBe("gambit");
    record = host(
      record,
      { type: "script/answer", answer: JSON.stringify({ value: "high", salt: "pepper" }) },
      "p1",
    )!;
    const done = stateAt(record);
    expect(done.script).toBeNull();
    expect(done.secrets?.p1?.gambit?.revealed).toEqual({ value: "high" });
    expect(typeof done.modules?.[SYSTEM]?.gambitWon).toBe("boolean");
  });
});
