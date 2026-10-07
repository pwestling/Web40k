import { describe, expect, it } from "vitest";
import {
  appendEvent,
  createInitialState,
  createRecord,
  resolveLogged,
  stateAt,
  type GameRecord,
  type Intent,
  type LoggedEvent,
} from "../core";
import { evaluate } from "../core/content/expr";
import { evalCtx } from "../core/content/play";
import { getSystem, restoreSystems } from "../core/content/systems";
import { currentSlot, systemOf } from "../core/content/turn";
import "../systems";
import { conquestModule } from "../systems/conquest/module";
import { towModule } from "../systems/tow/module";
import { spawnIntents } from "../systems/wh40k/deploy";
import { SandboxEngine } from "./engine";
import { seededRng } from "./protocol";
import arena from "../../examples/packages/arena.js?raw";
import secondWind from "../../examples/packages/second-wind.js?raw";

/** Node imports a package's source from a data: URL; the worker uses a blob. */
const importSource = (source: string) =>
  import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`) as Promise<{
    default?: unknown;
  }>;

/**
 * Two hosts side by side: the app's engine resolving on the main thread, and
 * the sandbox engine with its replica fed the same log. Both get the same
 * seed per intent; the events they produce must be identical.
 */
class Twin {
  record: GameRecord = createRecord(createInitialState());
  readonly sandbox = new SandboxEngine(importSource);
  private seed = 1;
  constructor() {
    this.sandbox.init(this.record);
  }
  /** Resolve inline, check the sandbox agrees, and log it. */
  play(intent: Intent, from: string): LoggedEvent | null {
    const seed = this.seed++ * 7919;
    const inline = resolveLogged(this.record, intent, from, seededRng(seed), 0);
    const boxed = this.sandbox.resolve(intent, from, seed);
    expect(boxed).toEqual(inline?.event ?? null);
    if (!inline) return null;
    this.record = appendEvent(this.record, inline);
    this.sandbox.events([inline]);
    return inline;
  }
  /** Resolve in the sandbox only (package code the app doesn't have), and log it. */
  playBoxed(intent: Intent, from: string): void {
    const event = this.sandbox.resolve(intent, from, this.seed++ * 7919);
    if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
    const logged = { seq: (this.record.events.at(-1)?.seq ?? 0) + 1, by: from, at: 0, event };
    this.record = appendEvent(this.record, logged);
    this.sandbox.events([logged]);
  }
  get state() {
    return stateAt(this.record);
  }
}

function table(system: string, sample: (seat: 0 | 1) => { units: Parameters<typeof spawnIntents>[2] }): Twin {
  const t = new Twin();
  t.play({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  t.play({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  t.play({ type: "game/system", system }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(t.state, p, sample(seat).units, p, "army")) t.play(i, p);
  return t;
}

describe("the package sandbox", () => {
  it("resolves every built-in code procedure exactly as the app does (parity)", () => {
    let ran = 0;
    for (const mod of [towModule, conquestModule]) {
      const ids = [...Object.keys(mod.procedures ?? {}), ...(mod.actions ?? []).map((a) => a.id)];
      const t = table(mod.system.id, (seat) => mod.app!.sample(seat));
      const mine = Object.values(t.state.units).filter((u) => u.owner === "p1");
      const theirs = Object.values(t.state.units).filter((u) => u.owner === "p2");
      for (let round = 0; round < 3; round++) {
        if (round) t.play({ type: "turn/next" }, "p1");
        for (const id of ids) {
          const args = {
            unit: mine[0]!.id,
            target: theirs[0]!.id,
            player: "p1",
            order: "march",
            first: "p1",
          };
          t.play({ type: "script/start", procedure: id, args }, "p1");
          // Answer every question with each option in turn until the procedure ends.
          for (let q = 0; t.state.script?.waiting && q < 10; q++) {
            const w = t.state.script.waiting;
            t.play({ type: "script/answer", answer: w.options[q % w.options.length]!.id }, w.player);
          }
          if (t.state.script) throw new Error(`${id} didn't finish`);
          ran++;
        }
      }
    }
    expect(ran).toBeGreaterThan(10);
  });

  it("runs a package's code: the example Second Wind brings fallen models back", async () => {
    const t = table("tow-hand", (seat) => towModule.app!.sample(seat));
    const loaded = await t.sandbox.load([{ hash: "h", source: secondWind }]);
    expect(loaded.errors).toEqual([]);
    expect(loaded.packages[0]).toMatchObject({ systems: ["tow-hand"], actions: ["secondWind"] });

    const unit = Object.values(t.state.units).find((u) => u.owner === "p1" && u.modelIds.length >= 10)!;
    for (let r = 0; r < 4 && (t.state.turn.round === 0 || currentSlot(t.state)?.id !== "strategy"); r++)
      t.play({ type: "turn/next" }, "p1");
    // Not offered while nobody has fallen.
    expect(t.sandbox.unitActions(unit.id, "p1")).toEqual([]);
    const fallen = () => unit.modelIds.filter((id) => t.state.models[id]!.destroyed).length;
    // Six casualties, logged as a rule would log them.
    for (const id of unit.modelIds.slice(-6)) {
      const logged = {
        seq: (t.record.events.at(-1)?.seq ?? 0) + 1,
        by: "p1",
        at: 0,
        event: { type: "model/wounds" as const, id, woundsLost: 1, destroyed: true },
      };
      t.record = appendEvent(t.record, logged);
      t.sandbox.events([logged]);
    }
    expect(fallen()).toBe(6);
    expect(t.sandbox.unitActions(unit.id, "p1")).toEqual([
      { id: "secondWind", name: "Second wind", available: true, targets: [], targeted: false },
    ]);
    t.playBoxed({ type: "script/start", procedure: "secondWind", args: { unit: unit.id } }, "p1");
    expect(t.state.script?.waiting?.player).toBe("p1");
    t.playBoxed({ type: "script/answer", answer: "roll" }, "p1");
    expect(t.state.script).toBeNull();
    const step = t.record.events.at(-1)!.event;
    const roll = step.type === "script/step" ? step.events.find((e) => e.type === "dice/roll") : undefined;
    const sixes = roll?.type === "dice/roll" ? roll.roll.results.filter((r) => r === 6).length : -1;
    expect(fallen()).toBe(6 - sixes);
    expect(t.sandbox.unitActions(unit.id, "p1")[0]!.available).toBe("Already used this battle");
  });

  it("loads a package's data rules, functions and turn hooks", async () => {
    const t = table("tow-hand", (seat) => towModule.app!.sample(seat));
    const source = `export const manifest = { id: "t.data", name: "Data", version: "1.0.0", api: 1, kind: "extension", systems: ["tow"], requires: [] };
      export default {
        rules: [{ id: "steady", name: "Steady", effects: [] }],
        functions: { twice: (view, n) => n * 2 },
        hooks: { phaseStart: { strategy: function* (ctx) { yield ctx.note("strategy hook"); } } },
      };`;
    const loaded = await t.sandbox.load([{ hash: "abcdef0123", source }]);
    expect(loaded.errors).toEqual([]);
    const pkg = loaded.packages[0]!;
    expect(pkg.data.rules?.map((r) => r.id)).toEqual(["steady"]);
    expect(pkg.hooks).toEqual({ phaseStart: { strategy: ["hook:abcdef01:phaseStart:strategy"] } });
    expect(pkg.procedures).toContain("hook:abcdef01:phaseStart:strategy");
    expect(getSystem("tow-hand").rules.some((r) => r.id === "steady")).toBe(true);
    const state = t.state;
    expect(evaluate({ call: "twice", args: [21] }, evalCtx(state, systemOf(state), {}))).toBe(42);
    // The hook runs as the procedure it was registered under.
    t.playBoxed({ type: "script/start", procedure: pkg.hooks.phaseStart!.strategy![0]!, args: {} }, "p1");
    const last = t.record.events.at(-1)!.event;
    expect(
      last.type === "script/step" &&
        last.events.some((e) => e.type === "log/note" && e.text === "strategy hook"),
    ).toBe(true);
    restoreSystems();
    expect(getSystem("tow-hand").rules.some((r) => r.id === "steady")).toBe(false);
  });

  it("loads a whole game from a package: its system, samples, code and hooks", async () => {
    const box = new SandboxEngine(importSource);
    const loaded = await box.load([{ hash: "a1", source: arena }]);
    expect(loaded.errors).toEqual([]);
    const pkg = loaded.packages[0]!;
    expect(pkg.provides?.system.id).toBe("arena");
    expect(pkg.provides?.app.samples.map((r) => r.name)).toEqual(["Red gladiators", "Blue gladiators"]);
    expect(pkg.hooks).toEqual({ roundStart: ["hook:arena:roundStart"] });

    const t = table("arena", (seat) => pkg.provides!.app.samples[seat]!);
    await t.sandbox.load([{ hash: "a1", source: arena }]);
    const red = Object.values(t.state.units).find((u) => u.name === "Champion")!;
    const blue = Object.values(t.state.units).find((u) => u.name === "Spear fighters")!;
    t.playBoxed({ type: "script/start", procedure: "strike", args: { unit: red.id, target: blue.id } }, "p1");
    const step = t.record.events.at(-1)!.event;
    const roll = step.type === "script/step" ? step.events.find((e) => e.type === "dice/roll") : undefined;
    const hits = roll?.type === "dice/roll" ? roll.roll.results.filter((r) => r >= 3).length : -1;
    const fallen = blue.modelIds.filter((id) => t.state.models[id]!.destroyed).length;
    expect(fallen).toBe(Math.min(hits, 5));
    t.playBoxed({ type: "script/start", procedure: "hook:arena:roundStart", args: { round: 1 } }, "p1");
    const hook = t.record.events.at(-1)!.event;
    expect(
      hook.type === "script/step" &&
        hook.events.some((e) => e.type === "log/note" && /crowd roars/.test(e.text)),
    ).toBe(true);
  });
  it("gives a package game its own army list reader and side panel", async () => {
    const box = new SandboxEngine(importSource);
    const pkg = (await box.load([{ hash: "a1", source: arena }])).packages[0]!;
    expect(pkg.provides?.app.has).toMatchObject({ importRoster: true, sidePanel: true, rankRules: false });

    const t = table("arena", (seat) => pkg.provides!.app.samples[seat]!);
    await t.sandbox.load([{ hash: "a1", source: arena }]);
    const list = { name: "Mine", units: [{ name: "Brute", count: 2, M: 4, A: 3, Hit: 4, W: 4 }] };
    const roster = (await t.sandbox.importRoster(
      "mine.json",
      new TextEncoder().encode(JSON.stringify(list)),
    )) as {
      name: string;
      units: { name: string; models: unknown[] }[];
    };
    expect(roster.name).toBe("Mine");
    expect(roster.units.map((u) => [u.name, u.models.length])).toEqual([["Brute", 2]]);

    const blue = Object.values(t.state.units).find((u) => u.name === "Spear fighters")!;
    t.play({ type: "model/wounds", id: blue.modelIds[0]!, woundsLost: 1, destroyed: true }, "p2");
    const app = t.sandbox.appState();
    expect(app.seq).toBe(t.state.seq);
    expect(app.panel?.lines).toEqual(["A: 0 fallen", "B: 1 fallen"]);
    expect(app.panel?.buttons?.[0]).toMatchObject({ label: "Taunt", procedure: "taunt" });
    expect(app.leaving).toEqual([]);
  });
});
