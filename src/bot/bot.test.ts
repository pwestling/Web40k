import { describe, expect, it } from "vitest";
import "../systems";
import { appendEvent, createInitialState, createRecord, resolveLogged, stateAt, type Intent } from "../core";
import { SandboxEngine } from "../sandbox/engine";
import { gameStats } from "../core/stats";
import { seededRng } from "../sandbox/protocol";
import { spawnIntents } from "../systems/wh40k/deploy";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";
import { evaluate, judge, STEADY } from "./evaluate";
import { playMatch } from "./match";
import { botPolicy } from "./player";
import { missionOf } from "./policy";
import { Sim } from "./sim";

const importSource = (source: string) =>
  import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`) as Promise<{
    default?: unknown;
  }>;

describe("a computer opponent (#45)", () => {
  it("plays a whole 40k game against the soak bot, and wins it", async () => {
    const r = await playMatch({ system: "forty-k-11", seed: 1 }, (start) => [
      botPolicy("steady", start, 0, { seed: 1 }),
      botPolicy("random", start, 1, { seed: 2 }),
    ]);
    expect(r.error).toBeUndefined();
    expect(r.finished).toBe(true);
    expect(r.winner).toBe(0);
    // It thinks quickly: well under the 2 s a turn the roadmap asks of 40k.
    expect(r.thinking[0] / r.decisions[0]).toBeLessThan(200);
  }, 120_000);

  it("plays Conquest's command stacks and activations", async () => {
    const r = await playMatch({ system: "conquest-hand", seed: 3 }, (start) => [
      botPolicy("sharp", start, 0, { seed: 1 }),
      botPolicy("steady", start, 1, { seed: 2 }),
    ]);
    expect(r.error).toBeUndefined();
    expect(r.finished).toBe(true);
    expect(r.vp[0] + r.vp[1]).toBeGreaterThan(0);
  }, 120_000);

  // UX 351: Easy turned one Rift Lanterns unit on the spot forever when nobody told it of its own moves.
  for (const level of ["random", "steady", "sharp"] as const)
    it(`never loops on one unit's go, even unwatched (${level}, Rift Lanterns)`, async () => {
      for (const seed of [1, 2]) {
        const r = await playMatch(
          {
            system: "rift-lanterns",
            systemPkg: { source: riftLanterns },
            seed,
            blind: true,
          },
          (start) => [botPolicy(level, start, 0, { seed }), botPolicy(level, start, 1, { seed: seed + 1 })],
        );
        expect(r.error).toBeUndefined();
        expect(r.finished).toBe(true);
      }
    }, 120_000);

  it("never loops on one unit's go in the built-in systems either (Easy, unwatched)", async () => {
    for (const system of ["forty-k-11", "tow-hand", "conquest-hand", "fsd-1"]) {
      const r = await playMatch({ system, seed: 5, blind: true, maxSteps: 500 }, (start) => [
        botPolicy("random", start, 0, { seed: 5 }),
        botPolicy("random", start, 1, { seed: 6 }),
      ]);
      expect(r.error, system).toBeUndefined();
    }
  }, 240_000);

  // PX: after a Rift Lanterns game the stats sheet showed no rolls and no damage dealt.
  it("counts a package game's rolls and damage in the after-game stats", async () => {
    const r = await playMatch(
      { system: "rift-lanterns", systemPkg: { source: riftLanterns }, seed: 3 },
      (start) => [botPolicy("steady", start, 0, { seed: 3 }), botPolicy("steady", start, 1, { seed: 4 })],
    );
    expect(r.error).toBeUndefined();
    const stats = gameStats(r.record!);
    expect(stats.units.reduce((a, u) => a + u.dealt, 0)).toBeGreaterThan(0);
    for (const p of stats.players) expect(p.luck.map((l) => l.step)).toContain("hits");
  }, 120_000);

  it("tries a move out on a copy of the table, leaving the game as it was", async () => {
    let start = createInitialState();
    const r = await playMatch({ system: "forty-k-11", seed: 2, maxSteps: 60 }, (s) => {
      start = s;
      return [botPolicy("steady", s, 0, { seed: 1 }), botPolicy("steady", s, 1, { seed: 2 })];
    });
    expect(r.error).toBeUndefined();
    const sim = new Sim(createRecord(start));
    const unit = Object.values(start.units).find((u) => u.owner === "p0")!;
    const m = start.models[unit.modelIds[0]!]!;
    const moved = sim.step(
      start,
      { type: "models/move", moves: [{ id: m.id, to: { x: m.position.x + 1, y: m.position.y } }] },
      "p0",
      seededRng(1),
      new Map(),
    );
    expect(moved?.models[m.id]?.position.x).toBeCloseTo(m.position.x + 1);
    expect(start.models[m.id]!.position.x).toBe(m.position.x);
    // The table as each side sees it: the same armies, judged from either side.
    const j0 = judge(start, 0, STEADY, missionOf(start));
    const j1 = judge(start, 1, STEADY, missionOf(start));
    expect(Number.isFinite(evaluate(start, j0))).toBe(true);
    expect(Math.abs(evaluate(start, j0) + evaluate(start, j1))).toBeLessThan(2);
  }, 60_000);

  it("plays a package game in its sandbox, where the game's code is (Rift Lanterns)", async () => {
    const engine = new SandboxEngine(importSource);
    const loaded = await engine.load([{ hash: "rl", source: riftLanterns }]);
    expect(loaded.errors).toEqual([]);
    let record = createRecord(createInitialState());
    engine.init(record);
    let seed = 1;
    const play = (intent: Intent, from: string) => {
      const s = seed++ * 7919;
      const event =
        engine.resolve(intent, from, s) ?? resolveLogged(record, intent, from, seededRng(s), 0)?.event;
      if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
      const logged = { seq: (record.events.at(-1)?.seq ?? 0) + 1, by: from, at: 0, event };
      record = appendEvent(record, logged);
      engine.events([logged]);
    };
    play({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
    play({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
    play({ type: "game/system", system: "rift-lanterns" }, "p1");
    const app = loaded.packages[0]!.provides!.app;
    const mission = app.missions[0]!;
    play(
      {
        type: "mission/set",
        mission: { id: mission.id, name: mission.name },
        zones: mission.setup.zones,
        objectives: mission.setup.objectives,
      },
      "p1",
    );
    for (const [p, army] of [
      ["p1", app.armies[0]!],
      ["p2", app.armies[2]!],
    ] as const)
      for (const i of spawnIntents(stateAt(record), p, army.units, p, "army")) play(i, p);
    play({ type: "turn/next" }, "p1");
    // The computer plays seat 1 a few times over: each move it picks, the game takes.
    for (let i = 0; i < 12; i++) {
      const state = stateAt(record);
      const me = state.turn.activeSeat === 1 ? "p2" : "p1";
      const move = engine.botMove("steady", state.turn.activeSeat, me, 5);
      if (!move) break;
      play(move.intent, move.as);
      if (move.then) play(move.then.intent, move.then.as);
    }
    const types = record.events.map((e) => e.event.type);
    expect(types).toContain("models/move");
    expect(types).toContain("script/step");
  }, 60_000);
});
