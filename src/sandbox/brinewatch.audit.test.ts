import { describe, expect, it } from "vitest";
import {
  appendEvent,
  createInitialState,
  createRecord,
  resolveLogged,
  stateAt,
  type GameEvent,
  type GameState,
  type Intent,
} from "../core";
import "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { tableWarnings } from "../ui/warnings";
import { gameView, hookIntents } from "../core/script";
import { commitmentOf } from "../core/secrets";
import { SandboxEngine } from "./engine";
import { seededRng } from "./protocol";
import { result } from "../share/cards";
import brinewatch from "../../games/brinewatch/brinewatch.js?raw";

/**
 * Rules audit of Brinewatch (#69) against its own rules page
 * (games/brinewatch/RULES.md). See docs/rules-coverage/brinewatch.md. Most
 * tests play the game through the sandbox engine as the host would, hooks
 * and all; the dice-by-dice ones drive the module's code against a stand-in
 * table with loaded dice.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const importSource = (source: string) =>
  import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`) as Promise<{
    default?: unknown;
  }>;
const M = ((await importSource(brinewatch)).default as Any).module;
const action = (id: string) => M.actions.find((a: Any) => a.id === id);
const crewOf = (name: string) => M.app.armies.find((a: Any) => a.name === name);
const modelDef = (crew: string, name: string) => crewOf(crew).units.find((u: Any) => u.name === name);

// ---------------------------------------------------------------------------
// The game through the sandbox engine
// ---------------------------------------------------------------------------

/**
 * Brinewatch in a sandbox engine, two players joined, the game picked and
 * the starter table laid. `play` resolves an intent as the host does, then
 * starts the hooks it sets off (a round's start, a move) as the session does.
 * Secrets are answered from this "device" (`kept`).
 */
async function sandbox(opts: { layout?: boolean } = {}) {
  const engine = new SandboxEngine(importSource);
  const loaded = (await engine.load([{ hash: "bw", source: brinewatch }])).packages[0]!.provides!.app as Any;
  let record = createRecord(createInitialState());
  engine.init(record);
  let seed = 1;
  const kept = new Map<string, { value: unknown; salt: string }>();
  const events: GameEvent[] = [];
  const log = (event: GameEvent, from: string) => {
    const before = stateAt(record);
    const logged = { seq: (record.events.at(-1)?.seq ?? 0) + 1, by: from, at: 0, event };
    record = appendEvent(record, logged);
    engine.events([logged]);
    events.push(event, ...(event.type === "script/step" ? event.events : []));
    return hookIntents(before, stateAt(record), event);
  };
  const resolve = (intent: Intent, from: string) => {
    const s = seed++ * 7919;
    return (
      engine.resolve(intent, from, s) ?? resolveLogged(record, intent, from, seededRng(s), 0)?.event ?? null
    );
  };
  const queue: [Intent, string][] = [];
  const settle = () => {
    for (let i = 0; i < 50; i++) {
      const s = stateAt(record);
      const q = s.script?.waiting;
      if (q?.secret) {
        const value = q.options[0]!.id;
        const salt = `salt${kept.size}`;
        const commitment = commitmentOf(value, salt);
        kept.set(commitment, { value, salt });
        queue.unshift([{ type: "script/answer", answer: commitment } as Intent, q.player]);
      } else if (q?.reveal) {
        const c = s.secrets?.[q.player]?.[q.reveal]?.commitment ?? "";
        queue.unshift([{ type: "script/answer", answer: JSON.stringify(kept.get(c)) } as Intent, q.player]);
      } else if (q) return;
      const next = queue.shift();
      if (!next) return;
      const event = resolve(next[0], next[1]);
      if (event) queue.push(...log(event, next[1]).map((h) => [h, next[1]] as [Intent, string]));
    }
  };
  const play = (intent: Intent, from: string) => {
    const event = resolve(intent, from);
    if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
    queue.push(...log(event, from).map((h) => [h, from] as [Intent, string]));
    settle();
  };
  const state = () => stateAt(record);
  play({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  play({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  play({ type: "game/system", system: "brinewatch" }, "p1");
  if (opts.layout !== false)
    play(
      { type: "layout/set", layout: { ...loaded.layout, table: { width: 30, depth: 22 } } as never },
      "p1",
    );
  /** Field these models of a crew for a player. */
  const field = (player: string, crew: string, names: string[], prefix: string) => {
    const units = names.map((n) => modelDef(crew, n));
    for (const i of spawnIntents(state(), player, units, prefix, crew)) play(i, player);
    return names.map((_, i) => `${prefix}-${i}`);
  };
  /** Put a model at a spot (and height), as set-up. */
  const put = (unitId: string, x: number, y: number, z = 0) => {
    const id = state().units[unitId]!.modelIds[0]!;
    play(
      { type: "models/move", setup: true, moves: [{ id, to: { x, y }, z }] },
      state().units[unitId]!.owner,
    );
  };
  /** Move a model in the battle. */
  const move = (unitId: string, x: number, y: number, z?: number) => {
    const id = state().units[unitId]!.modelIds[0]!;
    play(
      { type: "models/move", moves: [{ id, to: { x, y }, ...(z === undefined ? {} : { z }) }] },
      state().units[unitId]!.owner,
    );
  };
  const act = (procedure: string, unit: string, target?: string) =>
    play(
      { type: "script/start", procedure, args: { unit, ...(target ? { target } : {}) } } as Intent,
      state().units[unit]!.owner,
    );
  const can = (procedure: string, unit: string, target?: string) =>
    engine.resolve(
      { type: "script/start", procedure, args: { unit, ...(target ? { target } : {}) } } as Intent,
      state().units[unit]!.owner,
      1,
    ) !== null;
  const notes = () => events.flatMap((e) => (e.type === "log/note" ? [e.text] : []));
  return { engine, loaded, play, state, field, put, move, act, can, notes, events, record: () => record };
}

const status = (s: GameState, id: string) => s.units[id]!.status ?? {};

describe("Brinewatch: goes and action points", () => {
  it("each model has one go a round with 2 action points, and every model is ready again next round", async () => {
    const t = await sandbox({ layout: false });
    const [a, b] = t.field("p1", "Tollkeepers", ["Brack", "Tamsin"], "a");
    const [c] = t.field("p2", "Gullrunners", ["Fin"], "c");
    t.put(a!, -10, 9);
    t.put(b!, 10, 9);
    t.put(c!, 0, -9);
    t.play({ type: "turn/next" }, "p1");
    expect(t.state().turn.round).toBe(1);
    // A go starts with 2 action points.
    t.move(a!, -10, 6);
    expect(status(t.state(), a!)).toMatchObject({ acting: true, actionBudget: 2, actionsTaken: 1 });
    t.play({ type: "turn/endActivation" }, "p1");
    expect(status(t.state(), a!)).toMatchObject({ activated: true });
    expect(status(t.state(), a!).acting).toBeFalsy();
    // Expended: it can't act again this round.
    expect(t.can("guard", a!)).toBe(false);
    t.play({ type: "turn/endActivation", unit: c! }, "p2");
    // The side with models left takes the rest of the goes in turn.
    expect(t.state().turn.activeSeat).toBe(0);
    t.play({ type: "turn/endActivation", unit: b! }, "p1");
    expect(t.state().turn.round).toBe(2);
    expect([a, b, c].every((u) => !status(t.state(), u!).activated)).toBe(true);
  });

  it("moving costs a point for each Move's worth, climbing counted, and the go ends when the points are spent", async () => {
    const t = await sandbox();
    const [a] = t.field("p1", "Tollkeepers", ["Brack"], "a");
    const [c] = t.field("p2", "Gullrunners", ["Fin"], "c");
    t.put(a!, 0, 10);
    t.put(c!, 14, -10);
    t.play({ type: "turn/next" }, "p1");
    // 4" on a 6" Move: one point.
    t.move(a!, 0, 6);
    expect(status(t.state(), a!).actionsTaken).toBe(1);
    expect(status(t.state(), a!).allowance).toBe(12);
    // On to 8" in all: still within two Moves, a second point, and the go is over.
    t.move(a!, 0, 2);
    expect(status(t.state(), a!).acting).toBeFalsy();
    expect(status(t.state(), a!).activated).toBe(true);
    expect(tableWarnings(t.state()).map((w) => w.checkId)).toEqual([]);
  });

  it("flags a move past what its points allow, and a move through a hulk; a hulk blocks sight", async () => {
    const t = await sandbox();
    const hulk = (t.loaded.layout.terrain as Any[]).find((p) => p.category === "hulk");
    const [a] = t.field("p1", "Tollkeepers", ["Brack"], "a");
    const [c] = t.field("p2", "Gullrunners", ["Fin"], "c");
    t.put(a!, hulk.position.x, hulk.position.y + 6);
    t.put(c!, hulk.position.x, hulk.position.y - 6);
    t.play({ type: "turn/next" }, "p1");
    // The hulk stands between them: Brack can't see Fin to shoot.
    expect(t.can("shoot", a!, c!)).toBe(false);
    const warned = () => tableWarnings(t.state()).map((w) => w.checkId);
    // 5" sideways in the open: within one Move, nothing to say.
    t.move(a!, hulk.position.x - 5, hulk.position.y + 6);
    expect(warned()).toEqual([]);
    // On through the hulk to 13" from where it started: the path is checked, and that is past two Moves.
    t.move(a!, hulk.position.x + 2, hulk.position.y - 7);
    expect(warned()).toEqual(expect.arrayContaining(["moveDistance", "terrain"]));
  });

  it("an action spends a point; the engine refuses one without a point left, and Shoot or Fight twice in a go", async () => {
    const t = await sandbox({ layout: false });
    const [a] = t.field("p1", "Tollkeepers", ["Ness"], "a");
    const [c] = t.field("p2", "Gullrunners", ["Fin"], "c");
    t.put(a!, 0, 8);
    t.put(c!, 0, -8);
    t.play({ type: "turn/next" }, "p1");
    t.act("shoot", a!, c!);
    expect(status(t.state(), a!)).toMatchObject({ acting: true, actionsTaken: 1, shot: true });
    expect(t.can("shoot", a!, c!)).toBe(false);
    t.move(a!, 0, 4);
    expect(status(t.state(), a!).acting).toBeFalsy();
    // The point is spent, so the engine says no to a raw action for it.
    expect(t.can("guard", a!)).toBe(false);
  });

  it("standing guard spends the rest of the go", async () => {
    const t = await sandbox({ layout: false });
    const [a] = t.field("p1", "Tollkeepers", ["Ness"], "a");
    const [c] = t.field("p2", "Gullrunners", ["Fin"], "c");
    t.put(a!, 0, 8);
    t.put(c!, 10, -8);
    t.play({ type: "turn/next" }, "p1");
    t.act("guard", a!);
    expect(status(t.state(), a!)).toMatchObject({ guard: true, activated: true });
    expect(status(t.state(), a!).acting).toBeFalsy();
    expect(t.state().turn.activeSeat).toBe(1);
  });
});

describe("Brinewatch: guards", () => {
  it("a guard snap-fires at the first enemy that ends a move in its sight and range, once", async () => {
    const t = await sandbox({ layout: false });
    const [g] = t.field("p1", "Tollkeepers", ["Ness"], "g");
    const [m, n] = t.field("p2", "Gullrunners", ["Fin", "Wick"], "m");
    t.put(g!, 0, 8);
    t.put(m!, -14, -9);
    t.put(n!, 14, -9);
    t.play({ type: "turn/next" }, "p1");
    t.act("guard", g!);
    t.move(m!, -12, -6);
    expect(t.notes()).toContain("Ness, on guard, sees Fin move");
    expect(
      t
        .notes()
        .some((x) => /Ness fires from guard at Fin \(snap shot, 🔭 Steady Watch, 🪝 Slippery\)/.test(x)),
    ).toBe(true);
    expect(status(t.state(), g!).guard).toBeUndefined();
    t.play({ type: "turn/endActivation" }, "p2");
    // Off guard now: the next move draws no fire.
    const before = t.notes().length;
    t.move(n!, 12, -6);
    expect(
      t
        .notes()
        .slice(before)
        .some((x) => /on guard/.test(x)),
    ).toBe(false);
  });

  it("a guard fires before an enemy in its sight shoots, and its guard ends with the round", async () => {
    const t = await sandbox({ layout: false });
    const [g, h] = t.field("p1", "Gullrunners", ["Sable", "Lugg"], "g");
    const [s] = t.field("p2", "Deepkin", ["Ilse"], "s");
    t.put(g!, 0, 8);
    t.put(h!, 12, 8);
    t.put(s!, 0, -8);
    t.play({ type: "turn/next" }, "p1");
    t.act("guard", g!);
    t.act("shoot", s!, h!);
    t.play({ type: "turn/endActivation" }, "p2");
    const said = t.notes();
    const fired = said.findIndex((x) => x === "Sable, on guard, sees Ilse take aim");
    expect(fired).toBeGreaterThan(-1);
    expect(said.findIndex((x) => x.startsWith("Ilse shoots at Lugg"))).toBeGreaterThan(fired);
    // Whatever Ilse's dice did to Lugg, a guard set this round is gone when the next begins.
    if (t.state().turn.round === 1) t.act("guard", h!);
    expect(t.state().turn.round).toBe(2);
    expect(status(t.state(), h!).guard).toBeUndefined();
  });
});

describe("Brinewatch: locked in a fight", () => {
  it("a model with an enemy within 1\" can't shoot, and on guard holds its fire; a lurker emerging in a guard's sight draws it", async () => {
    const t = await sandbox({ layout: false });
    const [brack, tamsin, pim] = t.field("p1", "Tollkeepers", ["Brack", "Tamsin", "Pim"], "a");
    const [lugg, sable] = t.field("p2", "Gullrunners", ["Lugg", "Sable"], "b");
    t.put(brack!, 8, 9);
    t.put(tamsin!, 12, 9);
    t.put(pim!, 0, 9);
    t.put(lugg!, 8, 7.8);
    t.put(sable!, -10, -4);
    t.play({ type: "turn/next" }, "p1");
    // Brack and Lugg are within 1": neither may shoot.
    expect(t.can("shoot", brack!, lugg!)).toBe(false);
    t.play({ type: "turn/endActivation", unit: brack! }, "p1");
    t.act("guard", lugg!);
    t.play({ type: "turn/endActivation", unit: tamsin! }, "p1");
    t.act("guard", sable!);
    // Pim comes out of the west hideout, in sight and range of both guards: only Sable is free to fire.
    t.act("emerge", pim!);
    expect(t.notes()).toContain("Sable, on guard, sees Pim come out of hiding");
    expect(t.notes().some((x) => x.startsWith("Lugg, on guard"))).toBe(false);
    expect(status(t.state(), lugg!).guard).toBe(true);
  });
});

describe("Brinewatch: hidden lurkers", () => {
  it("lurkers are set aside as the battle starts and their hideouts committed in secret; Emerge reveals one and sets it there", async () => {
    const t = await sandbox({ layout: false });
    const [l] = t.field("p1", "Tollkeepers", ["Pim"], "l");
    const [e] = t.field("p2", "Gullrunners", ["Fin"], "e");
    t.put(l!, 0, 9);
    t.put(e!, 0, -9);
    t.play({ type: "turn/next" }, "p1");
    const s = t.state();
    expect(status(s, l!)).toMatchObject({ reserves: true, hidden: true });
    // Only the commitment is on the table, not the hideout.
    const secret = s.secrets?.p1?.[`hideout:${l}`];
    expect(secret?.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(secret?.revealed).toBeUndefined();
    // Hidden, it can't shoot or guard.
    expect(t.can("guard", l!)).toBe(false);
    t.act("emerge", l!);
    const after = t.state();
    expect(after.secrets?.p1?.[`hideout:${l}`]?.revealed?.value).toBe("west");
    expect(status(after, l!).reserves).toBeUndefined();
    const pos = after.models[after.units[l!]!.modelIds[0]!]!.position;
    expect(pos.x).toBeCloseTo(-10, 0);
    expect(pos.y).toBeCloseTo(6.5, 0);
    // Emerging spent one point: the other is left.
    expect(status(after, l!)).toMatchObject({ acting: true, actionsTaken: 1 });
  });

  it("a lurker still hidden when round 3 begins emerges then, without a go", async () => {
    const t = await sandbox({ layout: false });
    const [l] = t.field("p1", "Deepkin", ["The Drowned One"], "l");
    const [e] = t.field("p2", "Gullrunners", ["Fin"], "e");
    t.put(l!, 0, 9);
    t.put(e!, 0, -9);
    t.play({ type: "turn/next" }, "p1");
    for (let round = 1; round <= 2; round++)
      for (const u of [l!, e!]) {
        const s = t.state();
        const who = Object.values(s.units).find(
          (x) => s.players[x.owner]?.seat === s.turn.activeSeat && !x.status?.activated,
        )!;
        t.play({ type: "turn/endActivation", unit: who.id }, who.owner);
        void u;
      }
    expect(t.state().turn.round).toBe(3);
    expect(status(t.state(), l!).reserves).toBeUndefined();
    expect(t.notes()).toContain("The Drowned One emerges from the west hideout");
    expect(status(t.state(), l!).activated).toBeFalsy();
  });
});

describe("Brinewatch: vantage from the floors", () => {
  it("up a floor of a tall ruin, a shooter has vantage over a model in the ruin below", async () => {
    const t = await sandbox();
    const [a] = t.field("p1", "Tollkeepers", ["Ness"], "a");
    const [c] = t.field("p2", "Gullrunners", ["Fin"], "c");
    const tower = (t.loaded.layout.terrain as Any[]).find((p) => p.id === "a1");
    // On the tall ruin's first floor (3" up), and a target behind the small ruin's low wall south-east of it.
    t.put(a!, tower.position.x - 1, tower.position.y - 1, 3);
    t.put(c!, -2, -4);
    t.play({ type: "turn/next" }, "p1");
    const view = gameView(t.state(), "brinewatch");
    expect(
      action("shoot")
        .targets(view, { player: "p1", unitId: a })
        .map((x: Any) => x.unitId),
    ).toContain(c);
    t.act("shoot", a!, c!);
    expect(t.notes().some((x) => /Ness shoots at Fin \(vantage.*Long Eye\)/.test(x))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dice by dice, on a stand-in table
// ---------------------------------------------------------------------------

/** A stand-in table: models placed by hand, sight and cover as each test says. */
function table() {
  const state: Any = {
    units: {},
    models: {},
    players: { p1: { id: "p1", seat: 0 }, p2: { id: "p2", seat: 1 } },
    turn: { round: 1, activeSeat: 0 },
    objectives: [],
    terrain: [],
    modules: { brinewatch: {} },
    table: { width: 30, depth: 22 },
  };
  const covered = new Set<string>();
  const one = (id: string) =>
    state.units[id] ? state.models[state.units[id].modelIds[0]] : state.models[id];
  const view: Any = {
    state,
    get round() {
      return state.turn.round;
    },
    get own() {
      return state.modules.brinewatch;
    },
    atTable: false,
    distance: (a: string, b: string) => {
      const x = one(a);
      const y = one(b);
      return Math.max(0, Math.hypot(x.position.x - y.position.x, x.position.y - y.position.y) - 0.55 - 0.55);
    },
    visible: () => true,
    inCover: (_a: string, b: string) => covered.has(one(b).unitId),
  };
  const add = (id: string, owner: string, def: Any, x: number, y: number, z = 0) => {
    state.models[`${id}.0`] = {
      id: `${id}.0`,
      unitId: id,
      owner,
      profile: def.models[0].profile,
      base: def.base,
      position: { x, y },
      z,
    };
    state.units[id] = { id, owner, name: def.name, sheet: def.sheet, modelIds: [`${id}.0`], status: {} };
  };
  return { state, view, add, covered };
}

/** Run a module generator against the stand-in table with these dice. */
function drive(view: Any, gen: (ctx: Any) => Generator<Any, Any, Any>, dice: number[]) {
  const log: Any[] = [];
  const ctx = {
    view,
    roll: (expr: string, label: string, unitId: string, need: number) => ({
      k: "roll",
      expr,
      label,
      unitId,
      need,
    }),
    ask: (player: string, question: string, options: Any[]) => ({ k: "ask", player, question, options }),
    note: (text: string) => ({ k: "note", text }),
    emit: (event: Any) => ({ k: "emit", event }),
    set: (key: string, value: unknown) => ({ k: "set", key, value }),
  };
  const run = gen(ctx);
  let input: Any = undefined;
  for (;;) {
    const next = run.next(input);
    if (next.done) break;
    const cmd = next.value;
    log.push(cmd);
    input = undefined;
    if (cmd.k === "roll") {
      const n = Number(cmd.expr.split("d")[0]);
      if (dice.length < n) throw new Error(`Needs ${n} dice for ${cmd.label}, has ${dice.length}`);
      input = { rolls: dice.splice(0, n) };
    } else if (cmd.k === "ask") input = cmd.options[0].id;
    else if (cmd.k === "emit" && cmd.event.type === "model/wounds") {
      const m = view.state.models[cmd.event.id];
      view.state.models[cmd.event.id] = {
        ...m,
        woundsLost: cmd.event.woundsLost,
        destroyed: cmd.event.destroyed,
      };
    } else if (cmd.k === "emit" && cmd.event.type === "unit/status") {
      const u = view.state.units[cmd.event.id];
      u.status = { ...u.status, [cmd.event.key]: cmd.event.value };
    } else if (cmd.k === "set") view.state.modules.brinewatch[cmd.key] = cmd.value;
  }
  expect(dice).toEqual([]);
  return log;
}

const needs = (log: Any[]) => log.filter((c) => c.k === "roll").map((c) => c.need);

describe("Brinewatch: shooting", () => {
  const shoot = (t: ReturnType<typeof table>, a: string, b: string, dice: number[]) =>
    drive(t.view, (ctx) => action("shoot").run(ctx, { unit: a, target: b }), dice);

  it("hits on the Hits on number; each hit not saved is a wound; out of action at no wounds left", () => {
    const t = table();
    t.add("w", "p1", modelDef("Tollkeepers", "Brack"), 0, 5);
    t.add("f", "p2", modelDef("Gullrunners", "Fin"), 0, -5);
    // Brack: 2 dice hitting on 4+; Fin saves on 5+, 2 wounds.
    const log = shoot(t, "w", "f", [4, 3, 2]);
    expect(needs(log)).toEqual([4, 5]);
    expect(t.state.models["f.0"]).toMatchObject({ woundsLost: 1, destroyed: false });
    shoot(t, "w", "f", [6, 6, 1, 1]);
    expect(t.state.models["f.0"]).toMatchObject({ destroyed: true });
  });

  it('cover saves on one less; vantage (2" higher) takes the cover away; Long Eye hits on one less with vantage', () => {
    const t = table();
    t.add("n", "p1", modelDef("Tollkeepers", "Ness"), 0, 5);
    t.add("b", "p1", modelDef("Tollkeepers", "Brack"), 4, 5);
    t.add("s", "p2", modelDef("Deepkin", "Corran"), 0, -5);
    t.covered.add("s");
    // In cover: Corran's 3+ save becomes 2+.
    expect(needs(shoot(t, "b", "s", [4, 1, 6]))).toEqual([4, 2]);
    // From 3" up: no cover, and Ness (Long Eye) hits on 2+ instead of 3+.
    t.state.models["n.0"].z = 3;
    t.state.models["b.0"].z = 3;
    expect(needs(shoot(t, "b", "s", [4, 1, 6]))).toEqual([4, 3]);
    expect(needs(shoot(t, "n", "s", [2, 1, 6]))).toEqual([2, 3]);
    // Only 1" up: no vantage.
    t.state.models["n.0"].z = 1;
    expect(needs(shoot(t, "n", "s", [3, 1, 6]))).toEqual([3, 2]);
  });

  it("a shot through a reed bed neither model stands in is Obscured: one more to hit", () => {
    const t = table();
    t.add("b", "p1", modelDef("Tollkeepers", "Brack"), 0, 6);
    t.add("f", "p2", modelDef("Gullrunners", "Fin"), 0, -6);
    t.state.terrain.push({
      id: "r",
      category: "reeds",
      position: { x: 0, y: 0 },
      width: 6,
      depth: 3,
      facing: 0,
    });
    expect(needs(shoot(t, "b", "f", [1, 1]))).toEqual([5]);
    // Standing in the reeds itself, the target isn't obscured by them (it may be in cover instead).
    t.state.models["f.0"].position = { x: 0, y: 1 };
    expect(needs(shoot(t, "b", "f", [1, 1]))).toEqual([4]);
  });

  it("a guard's snap shot needs one more; Steady Watch takes no penalty; Slippery targets need one more again", () => {
    const t = table();
    t.add("w", "p1", modelDef("Gullrunners", "Sable"), 0, 6);
    t.add("k", "p1", modelDef("Tollkeepers", "Brack"), 4, 6);
    t.add("s", "p2", modelDef("Deepkin", "Corran"), 0, -6);
    t.add("f", "p2", modelDef("Gullrunners", "Fin"), 4, -6);
    t.state.units.w.status.guard = true;
    // Sable on guard at Corran moving: hits on 4+ becomes 5+.
    const log = drive(t.view, (ctx) => M.hooks.moved(ctx, { unitId: "s" }), [1, 1, 1]);
    expect(needs(log)).toEqual([5]);
    expect(t.state.units.w.status.guard).toBeNull();
    // Brack (Steady Watch) at Fin (Slippery): the snap penalty is waived, Slippery adds one.
    t.state.units.k.status.guard = true;
    t.state.players.p1.seat = 1;
    t.state.players.p1.seat = 0;
    t.state.units.s.owner = "p1";
    const log2 = drive(t.view, (ctx) => M.hooks.moved(ctx, { unitId: "f" }), [1, 1]);
    expect(needs(log2)).toEqual([5]);
  });
});

describe("Brinewatch: fighting", () => {
  const fight = (t: ReturnType<typeof table>, a: string, b: string, dice: number[]) =>
    drive(t.view, (ctx) => action("fight").run(ctx, { unit: a, target: b }), dice);

  it("the attacker strikes, then the target strikes back if it still stands; no cover in a fight", () => {
    const t = table();
    t.add("c", "p1", modelDef("Gullrunners", "Fin"), 0, 0);
    t.add("w", "p2", modelDef("Tollkeepers", "Brack"), 0, 1);
    t.covered.add("w");
    // Fin: 3 dice hitting on 4+ (2 hits); Brack saves on 4+ with no cover (one fails); Brack strikes back.
    const log = fight(t, "c", "w", [4, 5, 1, 6, 1, 4, 4, 1, 6]);
    expect(needs(log)).toEqual([4, 4, 4, 5]);
    expect(t.state.models["w.0"].woundsLost).toBe(1);
    expect(t.state.models["c.0"].woundsLost).toBe(1);
  });

  it("a target taken out doesn't strike back; Undertow gives a Deepkin a point back for it", () => {
    const t = table();
    t.add("d", "p1", modelDef("Deepkin", "The Drowned One"), 0, 0);
    t.add("f", "p2", modelDef("Gullrunners", "Fin"), 0, 1);
    t.state.units.d.status = { acting: true, actionBudget: 2, actionsTaken: 1 };
    const log = fight(t, "d", "f", [6, 6, 1, 1, 1, 1]);
    expect(needs(log)).toEqual([3, 5]);
    expect(t.state.models["f.0"].destroyed).toBe(true);
    expect(t.state.units.d.status.actionsTaken).toBe(0);
    expect(log.some((c: Any) => c.k === "note" && /Undertow/.test(c.text))).toBe(true);
  });
});

describe("Brinewatch: missions", () => {
  const rule = (m: string, id: string) =>
    M.app.missions.find((x: Any) => x.id === m).scoring.find((s: Any) => s.id === id);

  it('deploys in strips 4" deep along the long edges; 4 rounds, and the side with more victory points wins', () => {
    for (const m of M.app.missions) {
      const { zones } = m.setup({ width: 30, depth: 22 });
      const ys = (seat: number) => zones.find((z: Any) => z.seat === seat).points.map((p: Any) => p.y);
      expect([Math.min(...ys(0)), Math.max(...ys(0))]).toEqual([7, 11]);
      expect([Math.min(...ys(1)), Math.max(...ys(1))]).toEqual([-11, -7]);
    }
    expect(M.system.turn.rounds).toBe(4);
    const game = createInitialState();
    game.players = {
      p1: { id: "p1", name: "A", color: "#00f", seat: 0 },
      p2: { id: "p2", name: "B", color: "#f00", seat: 1 },
    } as Any;
    game.resources = { p1: { VP: 6 }, p2: { VP: 3 } };
    expect(result(game).title).toMatch(/^A wins 6.3$/);
  });

  it('Low Tide Salvage: 1 for each cache held at the end of a round, by more models within 2"', () => {
    const t = table();
    t.state.objectives = M.app.missions[0].setup(t.state.table).objectives;
    t.add("a", "p1", modelDef("Tollkeepers", "Brack"), -10, 1.5);
    t.add("b", "p1", modelDef("Tollkeepers", "Joss"), 0, 1.5);
    t.add("c", "p2", modelDef("Gullrunners", "Fin"), 0, -1.5);
    expect(rule("salvage", "caches").suggest(t.state, 0)).toEqual({ vp: 1, why: "1 cache held" });
    expect(rule("salvage", "caches").suggest(t.state, 1)).toEqual({ vp: 0, why: "0 caches held" });
  });

  it('The Bell Towers: from round 2, 2 for each bell held from 2" or more up', () => {
    const t = table();
    t.state.objectives = M.app.missions[1].setup(t.state.table).objectives;
    const bell = t.state.objectives[0].position;
    t.add("a", "p1", modelDef("Tollkeepers", "Ness"), bell.x, bell.y, 6);
    t.add("c", "p2", modelDef("Gullrunners", "Fin"), bell.x + 1, bell.y, 0);
    t.state.turn.round = 1;
    expect(rule("bells", "bells").suggest(t.state, 0)).toBeNull();
    t.state.turn.round = 2;
    expect(rule("bells", "bells").suggest(t.state, 0)).toEqual({ vp: 2, why: "1 bell held from the floors" });
    expect(rule("bells", "bells").suggest(t.state, 1)).toBeNull();
  });

  it("Cut the Line: the line each round; the enemy Leader out scores 3 and half their crew out 2", () => {
    const t = table();
    t.state.objectives = M.app.missions[2].setup(t.state.table).objectives;
    t.add("cap", "p1", modelDef("Tollkeepers", "Captain Orrin"), 0, 1);
    t.add("b", "p1", modelDef("Tollkeepers", "Brack"), 8, 5);
    t.add("c", "p2", modelDef("Gullrunners", "Fin"), 8, -5);
    expect(rule("cut-the-line", "line").suggest(t.state, 0)).toEqual({ vp: 1, why: "holds the line" });
    expect(rule("cut-the-line", "leader").suggest(t.state, 1)).toBeNull();
    t.state.models["cap.0"].destroyed = true;
    expect(rule("cut-the-line", "leader").suggest(t.state, 1)).toEqual({
      vp: 3,
      why: "the enemy Leader is out of action",
    });
    expect(rule("cut-the-line", "broken").suggest(t.state, 1)).toEqual({
      vp: 2,
      why: "half or more of the enemy crew out",
    });
  });
});

describe("Brinewatch: the campaign", () => {
  const story = (over: Any) => ({
    key: "k",
    unitId: "u",
    name: "Brack",
    owner: "p1",
    games: 1,
    kills: 0,
    xp: 0,
    honours: "",
    scars: "",
    ...over,
  });
  const awards = (log: Any[]) =>
    log.filter((c) => c.k === "emit" && c.event.type === "campaign/award").map((c) => c.event);

  it("after a game: experience for coming through and for enemies taken out, an honour at 3, a scar roll when taken out", () => {
    const t = table();
    const log = drive(
      t.view,
      (ctx) =>
        M.hooks.afterGame(ctx, {
          units: [
            story({ xp: 1, survived: true, slain: 3 }),
            story({ key: "j", unitId: "v", name: "Joss", survived: false, slain: 0 }),
          ],
        }),
      [2, 1],
    );
    expect(awards(log)).toEqual([
      { type: "campaign/award", key: "k", unitId: "u", xp: 3 },
      { type: "campaign/award", key: "k", unitId: "u", honour: "Brawler" },
      { type: "campaign/award", key: "j", unitId: "v", scar: "Lost" },
    ]);
  });

  it("before a game: honours and scars change the model, and a Lost model sits the game out", () => {
    const t = table();
    t.add("u", "p1", modelDef("Tollkeepers", "Brack"), 0, 0);
    t.add("v", "p1", modelDef("Tollkeepers", "Joss"), 4, 0);
    t.add("w", "p1", modelDef("Tollkeepers", "Tamsin"), -4, 0);
    drive(
      t.view,
      (ctx) =>
        M.hooks.beforeGame(ctx, {
          units: [
            story({ honours: "Fleet, Brawler", scars: "Shaky Hand" }),
            story({ key: "j", unitId: "v", scars: "Lost" }),
            story({ key: "m", unitId: "w", honours: "Keen Eye", scars: "Limp" }),
          ],
        }),
      [],
    );
    expect(t.state.modules.brinewatch["story:u"]).toEqual({
      honours: ["Fleet", "Brawler"],
      scars: ["Shaky Hand"],
    });
    expect(t.state.models["v.0"].destroyed).toBe(true);
    t.add("f", "p2", modelDef("Gullrunners", "Fin"), 0, -5);
    // Shaky Hand: Brack hits on 5+, not 4+.
    expect(
      needs(drive(t.view, (ctx) => action("shoot").run(ctx, { unit: "u", target: "f" }), [1, 1])),
    ).toEqual([5]);
    expect(M.bot.moveInches(t.state, t.state.units.u)).toBe(7);
    // Keen Eye: Tamsin hits on 3+; Limp: a 5" Move.
    expect(
      needs(drive(t.view, (ctx) => action("shoot").run(ctx, { unit: "w", target: "f" }), [1, 1])),
    ).toEqual([3]);
    expect(M.bot.moveInches(t.state, t.state.units.w)).toBe(5);
  });
});
