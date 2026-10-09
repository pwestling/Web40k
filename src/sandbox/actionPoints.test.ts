import { describe, expect, it } from "vitest";
import {
  appendEvent,
  createInitialState,
  createRecord,
  resolveLogged,
  stateAt,
  type GameState,
  type Intent,
} from "../core";
import "../systems";
import { actionPointsLeft } from "../core/content/turn";
import { hookIntents } from "../core/script";
import { SandboxEngine } from "./engine";
import { seededRng } from "./protocol";

/**
 * Action points in a game of plain activations (#69, made for Brinewatch):
 * the alternate slot's `actionsPerActivation`, CodeAction `cost`, and the
 * `moved` hook. A tiny package game written for the test.
 */
const SOURCE = `
export const manifest = { id: "t.points", name: "Points", version: "1.0.0", author: "t", api: 1,
  kind: "system", systems: ["points"], requires: [], adds: "test" };
const unit = (name, W) => ({ name, base: { shape: "round", diameterMm: 25 }, sheet: { weapons: {}, abilities: [], keywords: [] },
  models: [{ profile: { name, chars: { M: "6", W: String(W) } }, weapons: [] }] });
const system = { id: "points", name: "Points", version: "1", units: "inch", dice: [{ id: "d6", sides: 6 }], defaultDie: "d6",
  characteristics: [{ id: "M", name: "Move", of: "model", type: "distance" }, { id: "W", name: "W", of: "model", type: "number" }],
  weaponKinds: [], terrain: [], unitShape: { kind: "skirmish" }, rules: [], procedures: [], actions: [],
  turn: { rounds: 2, round: [{ kind: "alternate", id: "go", pool: { kind: "units" }, actionsPerActivation: 3,
    activation: [{ kind: "phase", id: "a", name: "Activation", actions: [] }] }] } };
const act = (id, cost, run) => ({ id, name: id, by: "unit", phases: ["go"], ...(cost === undefined ? {} : { cost }),
  available: () => true, run });
export default { module: { id: "points", version: "1", api: 1, system,
  app: { sample: (seat) => ({ name: "S" + seat, units: [unit("A" + seat, 1), unit("B" + seat, 1)], warnings: [] }),
    layout: () => ({ terrain: [], objectives: [], zones: [] }) },
  actions: [
    act("look", undefined, function* (ctx) { yield ctx.note("looks"); }),
    act("free", 0, function* (ctx) { yield ctx.note("free"); }),
    act("heavy", 2, function* (ctx) { yield ctx.note("heavy"); }),
    act("fall", 1, function* (ctx, args) {
      const m = ctx.view.state.units[args.unit].modelIds[0];
      yield ctx.emit({ type: "model/wounds", id: m, woundsLost: 1, destroyed: true });
    }),
  ],
  hooks: { moved: function* (ctx, args) { yield ctx.set("moved", [...(ctx.view.own.moved ?? []), args.unitId]); } },
} };
`;

async function game() {
  const importSource = (s: string) =>
    import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(s)}`) as Promise<{
      default?: unknown;
    }>;
  const engine = new SandboxEngine(importSource);
  const app = (await engine.load([{ hash: "pt", source: SOURCE }])).packages[0]!.provides!.app as {
    samples: { units: unknown[] }[];
  };
  let record = createRecord(createInitialState());
  engine.init(record);
  let n = 1;
  const play = (intent: Intent, from: string): boolean => {
    const event =
      engine.resolve(intent, from, n) ?? resolveLogged(record, intent, from, seededRng(n), 0)?.event ?? null;
    n++;
    if (!event) return false;
    const before = stateAt(record);
    const logged = { seq: (record.events.at(-1)?.seq ?? 0) + 1, by: from, at: 0, event };
    record = appendEvent(record, logged);
    engine.events([logged]);
    for (const h of hookIntents(before, stateAt(record), event)) play(h, from);
    return true;
  };
  const state = () => stateAt(record);
  play({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  play({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  play({ type: "game/system", system: "points" }, "p1");
  const { spawnIntents } = await import("../systems/wh40k/deploy");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(state(), p, app.samples[seat]!.units as never, p, "s")) play(i, p);
  play({ type: "turn/next" }, "p1");
  const act = (procedure: string, unit: string) =>
    play({ type: "script/start", procedure, args: { unit } } as Intent, state().units[unit]!.owner);
  const s = (u: string) => state().units[u]!.status ?? {};
  return { play, state, act, s };
}

const left = (state: GameState, id: string) => actionPointsLeft(state, state.units[id]!);

describe("action points in plain activations", () => {
  it("a go has the slot's points; each code action spends its cost, and the go lasts while any are left", async () => {
    const g = await game();
    expect(left(g.state(), "p1-0")).toBe(3);
    expect(g.act("look", "p1-0")).toBe(true);
    expect(g.s("p1-0")).toMatchObject({ acting: true, actionBudget: 3, actionsTaken: 1 });
    expect(g.act("free", "p1-0")).toBe(true);
    expect(left(g.state(), "p1-0")).toBe(2);
    expect(g.act("heavy", "p1-0")).toBe(true);
    // All three spent: the go is over and the other side is up.
    expect(g.s("p1-0").acting).toBeUndefined();
    expect(g.s("p1-0").activated).toBe(true);
    expect(left(g.state(), "p1-0")).toBe(0);
    expect(g.state().turn.activeSeat).toBe(1);
  });

  it("the host refuses an action that costs more than the unit has left", async () => {
    const g = await game();
    expect(g.act("heavy", "p1-0")).toBe(true);
    expect(g.act("heavy", "p1-0")).toBe(false);
    expect(g.act("look", "p1-0")).toBe(true);
    expect(g.s("p1-0").activated).toBe(true);
  });

  it("a go ends when its unit is taken out in the middle of it", async () => {
    const g = await game();
    expect(g.act("fall", "p1-0")).toBe(true);
    expect(g.s("p1-0").acting).toBeUndefined();
    expect(g.state().turn.activeSeat).toBe(1);
  });

  it("the moved hook runs after a unit's move in the battle, not after setting up", async () => {
    const g = await game();
    const id = g.state().units["p1-0"]!.modelIds[0]!;
    const at = g.state().models[id]!.position;
    g.play({ type: "models/move", setup: true, moves: [{ id, to: { x: at.x + 1, y: at.y } }] }, "p1");
    expect(g.state().modules?.points?.moved).toBeUndefined();
    g.play({ type: "models/move", moves: [{ id, to: { x: at.x + 3, y: at.y } }] }, "p1");
    expect(g.state().modules?.points?.moved).toEqual(["p1-0"]);
    // Moving started its go, with all its points.
    expect(g.s("p1-0")).toMatchObject({ acting: true, actionBudget: 3, actionsTaken: 0 });
  });
});
