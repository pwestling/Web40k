import { describe, expect, it } from "vitest";
import { appendEvent, createInitialState, createRecord, resolveLogged, stateAt, type Intent } from "../core";
import "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { tableWarnings } from "../ui/warnings";
import { gameView } from "../core/script";
import { result } from "../share/cards";
import { SandboxEngine } from "./engine";
import { seededRng } from "./protocol";
import riftLanterns from "../../games/rift-lanterns/rift-lanterns.js?raw";

/**
 * Rules audit (#55) of Rift Lanterns against its own rules page
 * (games/rift-lanterns/RULES.md). See docs/rules-coverage/rift-lanterns.md.
 * The module's actions, hook and mission scoring are driven here directly
 * with a stand-in table: positions, sight and cover are set by each test and
 * the dice are loaded.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const mod = (await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(riftLanterns)}`))
  .default as Any;
const M = mod.module;
const app = M.app;
const action = (id: string) => M.actions.find((a: Any) => a.id === id);
const mission = (id: string) => app.missions.find((m: Any) => m.id === id);
const rule = (m: string, id: string) => mission(m).scoring.find((s: Any) => s.id === id);

const unitDef = (warband: string, name: string) =>
  app.armies.find((a: Any) => a.name === warband).units.find((u: Any) => u.name === name);

const radius = (m: Any) => m.base.diameterMm / 25.4 / 2;

/** A stand-in table: units placed by hand, sight and cover as each test says. */
function table() {
  const state: Any = {
    units: {},
    models: {},
    players: { p1: { id: "p1", seat: 0 }, p2: { id: "p2", seat: 1 } },
    turn: { round: 1, activeSeat: 0 },
    objectives: [],
    table: { width: 36, depth: 24 },
  };
  const hidden = new Set<string>();
  const covered = new Set<string>();
  const modelsOf = (id: string): Any[] =>
    state.units[id]
      ? state.units[id].modelIds.map((m: string) => state.models[m]).filter((m: Any) => !m.destroyed)
      : [state.models[id]];
  const view: Any = {
    state,
    get round() {
      return state.turn.round;
    },
    own: {} as Record<string, unknown>,
    atTable: false,
    distance: (a: string, b: string) => {
      let best = Infinity;
      for (const x of modelsOf(a))
        for (const y of modelsOf(b))
          best = Math.min(
            best,
            Math.max(
              0,
              Math.hypot(x.position.x - y.position.x, x.position.y - y.position.y) - radius(x) - radius(y),
            ),
          );
      return best;
    },
    visible: (a: string, b: string) =>
      modelsOf(a).some((x) => modelsOf(b).some((y) => !hidden.has(`${x.id}>${y.id}`))),
    inCover: (_a: string, b: string) => modelsOf(b).some((y) => covered.has(y.id)),
  };
  /** Put a unit on the table, its models in a row 1.5" apart from (x, y). */
  const add = (id: string, owner: string, def: Any, x: number, y: number) => {
    const modelIds = def.models.map((_: Any, i: number) => `${id}.${i}`);
    def.models.forEach((m: Any, i: number) => {
      state.models[`${id}.${i}`] = {
        id: `${id}.${i}`,
        unitId: id,
        owner,
        profile: m.profile,
        base: m.base ?? def.base,
        position: { x: x + i * 1.5, y },
      };
    });
    state.units[id] = { id, owner, name: def.name, sheet: def.sheet, modelIds, status: {} };
    return state.units[id];
  };
  const hide = (from: string, to: string) => {
    for (const x of modelsOf(from)) for (const y of modelsOf(to)) hidden.add(`${x.id}>${y.id}`);
  };
  return { state, view, add, hide, covered };
}

/** Run a module generator against the stand-in table, with these dice and answers. */
function drive(
  view: Any,
  gen: (ctx: Any) => Generator<Any, Any, Any>,
  dice: number[],
  answers: string[] = [],
) {
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
  const it = gen(ctx);
  let input: Any = undefined;
  for (;;) {
    const next = it.next(input);
    if (next.done) break;
    const cmd = next.value;
    log.push(cmd);
    input = undefined;
    if (cmd.k === "roll") {
      const n = Number(cmd.expr.split("d")[0]);
      if (dice.length < n) throw new Error(`Needs ${n} dice for ${cmd.label}, has ${dice.length}`);
      input = { rolls: dice.splice(0, n) };
    } else if (cmd.k === "ask") input = answers.shift() ?? cmd.options[0].id;
    else if (cmd.k === "emit" && cmd.event.type === "model/wounds") {
      const m = view.state.models[cmd.event.id];
      view.state.models[cmd.event.id] = {
        ...m,
        woundsLost: cmd.event.woundsLost,
        destroyed: cmd.event.destroyed,
      };
    } else if (cmd.k === "set") view.own[cmd.key] = cmd.value;
  }
  expect(dice).toEqual([]);
  return log;
}

const rolls = (log: Any[]) => log.filter((c) => c.k === "roll");
const lost = (state: Any, unitId: string) =>
  state.units[unitId].modelIds.map((id: string) =>
    state.models[id].destroyed ? "x" : (state.models[id].woundsLost ?? 0),
  );

describe("Rift Lanterns: the turn", () => {
  it("lasts 5 rounds of alternating activations, each a move then Shoot or Fight", () => {
    expect(M.system.turn.rounds).toBe(5);
    const slot = M.system.turn.round[0];
    expect(slot.kind).toBe("alternate");
    expect(slot.activation[0].actions).toEqual(["shoot", "fight"]);
    expect(M.system.constants.engagementRange).toBe(1);
  });

  it("lets only the unit whose go it is act, once a round", () => {
    const t = table();
    const guard = t.add("g", "p1", unitDef("Wardens of the Wick", "Wick Guard"), 0, 5);
    const lamps = t.add("l", "p1", unitDef("Wardens of the Wick", "Lamplighters"), 8, 5);
    const foe = t.add("s", "p2", unitDef("Thornkin", "Thorn Slingers"), 0, -5);
    const can = (u: Any) => action("shoot").available(t.view, { player: u.owner, unitId: u.id });
    expect(can(guard)).toBe(true);
    // The other side's go.
    expect(can(foe)).toBe("Not your go");
    // The Lamplighters are moving: nobody else acts until their go ends.
    lamps.status = { acting: true, activated: true };
    expect(can(guard)).toMatch(/Lamplighters are activating/);
    expect(can(lamps)).toBe(true);
    // They only moved, and their go ended: they don't act again this round.
    lamps.status = { activated: true };
    expect(can(lamps)).toBe("Already activated this round");
    expect(action("fight").available(t.view, { player: "p1", unitId: lamps.id })).toBe(
      "Already activated this round",
    );
    // Having shot, a unit is done for the round.
    t.view.own[`acted:${guard.id}`] = 1;
    expect(can(guard)).toBe("Already acted this round");
  });
});

describe("Rift Lanterns: shooting", () => {
  it("needs one shooter that both sees the target and has it in its own Range", () => {
    const t = table();
    // Two Lamplighters (Range 24): the first is 28" off but can see, the second 10" off but can't.
    const lamps = t.add("l", "p1", unitDef("Wardens of the Wick", "Lamplighters"), 0, 0);
    t.state.models["l.0"].position = { x: -18, y: 22 };
    t.state.models["l.1"].position = { x: 0, y: 6 };
    const foe = t.add("s", "p2", unitDef("Thornkin", "Thorn Slingers"), 0, -5);
    t.hide("l.1", foe.id);
    const targets = () => action("shoot").targets(t.view, { player: "p1", unitId: lamps.id });
    expect(t.view.distance("l.0", foe.id)).toBeGreaterThan(24);
    expect(targets()).toEqual([]);
    expect(action("shoot").available(t.view, { player: "p1", unitId: lamps.id })).toBe(
      "No enemy in sight and range",
    );
    // The far one steps into range: now one shooter does both.
    t.state.models["l.0"].position = { x: -10, y: 8 };
    expect(targets().map((x: Any) => x.unitId)).toEqual([foe.id]);
  });

  it("can't shoot while locked in a fight (an enemy within 1\")", () => {
    const t = table();
    const guard = t.add("g", "p1", unitDef("Wardens of the Wick", "Wick Guard"), 0, 1);
    t.add("h", "p2", unitDef("Thornkin", "Briar Hounds"), 0, -0.8);
    expect(action("shoot").available(t.view, { player: "p1", unitId: guard.id })).toBe("Locked in a fight");
  });

  it("Veiled: the Gloam Choir can't be shot from more than 12\" away", () => {
    const t = table();
    const gear = t.add("c", "p1", unitDef("Cogwright Guild", "Gearmen"), 0, 8);
    const choir = t.add("v", "p2", unitDef("Gloam Choir", "Hushed Choir"), 0, -6);
    expect(t.view.distance(gear.id, choir.id)).toBeGreaterThan(12);
    expect(action("shoot").available(t.view, { player: "p1", unitId: gear.id })).toMatch(/Veiled/);
    t.state.units.v.modelIds.forEach((id: string) => (t.state.models[id].position.y = -2));
    expect(t.view.distance(gear.id, choir.id)).toBeLessThanOrEqual(12);
    expect(action("shoot").available(t.view, { player: "p1", unitId: gear.id })).toBe(true);
  });

  it("hits on the Hits on number, one more when most seen target models are in cover", () => {
    const t = table();
    const lamps = t.add("l", "p1", unitDef("Wardens of the Wick", "Lamplighters"), 0, 6);
    const foe = t.add("s", "p2", unitDef("Thornkin", "Thorn Slingers"), 0, -5);
    const shoot = (dice: number[]) =>
      drive(t.view, (ctx) => action("shoot").run(ctx, { unit: lamps.id, target: foe.id }), dice);
    // 2 models x 2 dice at 3+; no cover. Two hits, Saves on 6+: a 6 saves one.
    let log = shoot([3, 2, 1, 5, 6, 1]);
    expect(rolls(log)[0]).toMatchObject({ expr: "4d6", need: 3 });
    expect(rolls(log)[1]).toMatchObject({ expr: "2d6", need: 6 });
    expect(lost(t.state, foe.id)).toEqual(["x", 0, 0, 0]);
    // One of four in a thicket isn't most of them: no cover.
    t.view.own = {};
    t.covered.add("s.1");
    log = shoot([1, 1, 1, 1]);
    expect(rolls(log)[0].need).toBe(3);
    // Three of the four seen: in cover, hits need 4+.
    t.view.own = {};
    t.covered.add("s.2").add("s.3");
    log = shoot([3, 3, 4, 1, 1]);
    expect(rolls(log)[0]).toMatchObject({ need: 4, label: "hits on 4+ (cover)" });
    expect(lost(t.state, foe.id)).toEqual(["x", "x", 0, 0]);
  });

  it("saves a die per hit, and each unsaved hit takes a wound, model by model", () => {
    const t = table();
    const strider = t.add("w", "p1", unitDef("Cogwright Guild", "Strider"), 0, 6);
    const hounds = t.add("h", "p2", unitDef("Thornkin", "Briar Hounds"), 0, -5);
    // Hold steady: 3 dice at 4+, three hits; hounds save on 6+ and save none; 2 wounds each.
    const log = drive(
      t.view,
      (ctx) => action("shoot").run(ctx, { unit: strider.id, target: hounds.id }),
      [4, 5, 6, 1, 2, 3],
      ["no"],
    );
    expect(rolls(log).map((r: Any) => r.expr)).toEqual(["3d6", "3d6"]);
    expect(lost(t.state, hounds.id)).toEqual(["x", 1, 0]);
    expect(t.view.own[`acted:${strider.id}`]).toBe(1);
  });

  it("Shieldwall: Wardens save shooting hits on one less", () => {
    const t = table();
    const gear = t.add("c", "p1", unitDef("Cogwright Guild", "Gearmen"), 0, 6);
    const guard = t.add("g", "p2", unitDef("Wardens of the Wick", "Wick Guard"), 0, -5);
    const log = drive(
      t.view,
      (ctx) => action("shoot").run(ctx, { unit: gear.id, target: guard.id }),
      [6, 6, 6, 1, 3, 3, 2],
      ["no"],
    );
    expect(rolls(log)[1]).toMatchObject({ need: 3 });
    expect(rolls(log)[1].label).toMatch(/Shieldwall/);
    expect(lost(t.state, guard.id)).toEqual(["x", 0, 0, 0, 0]);
  });

  it("Overcharge: 2 more dice, and each 1 rolled is a wound on the shooters, with no save", () => {
    const t = table();
    const gear = t.add("c", "p1", unitDef("Cogwright Guild", "Gearmen"), 0, 6);
    const foe = t.add("s", "p2", unitDef("Thornkin", "Thorn Slingers"), 0, -5);
    // 4 + 2 dice: two 1s burn two Gearmen; one hit, not saved.
    const log = drive(
      t.view,
      (ctx) => action("shoot").run(ctx, { unit: gear.id, target: foe.id }),
      [1, 1, 4, 2, 3, 3, 5],
      ["yes"],
    );
    expect(rolls(log).map((r: Any) => r.expr)).toEqual(["6d6", "1d6"]);
    expect(lost(t.state, foe.id)).toEqual(["x", 0, 0, 0]);
    expect(lost(t.state, gear.id)).toEqual(["x", "x", 0, 0]);
    // Holding steady rolls the unit's own dice only.
    t.view.own = {};
    const steady = drive(
      t.view,
      (ctx) => action("shoot").run(ctx, { unit: gear.id, target: foe.id }),
      [1, 1],
      ["no"],
    );
    expect(rolls(steady).map((r: Any) => r.expr)).toEqual(["2d6"]);
    expect(lost(t.state, gear.id)).toEqual(["x", "x", 0, 0]);
  });
});

describe("Rift Lanterns: fighting", () => {
  it('needs an enemy within 1"', () => {
    const t = table();
    const hounds = t.add("h", "p1", unitDef("Thornkin", "Briar Hounds"), 0, 3);
    const foe = t.add("s", "p2", unitDef("Gloam Choir", "Hushed Choir"), 0, -3);
    expect(action("fight").available(t.view, { player: "p1", unitId: hounds.id })).toBe('No enemy within 1"');
    foe.modelIds.forEach((id: string) => (t.state.models[id].position.y = 1.5));
    expect(action("fight").available(t.view, { player: "p1", unitId: hounds.id })).toBe(true);
  });

  it("the attackers strike, then whoever is left strikes back, with no cover and no Shieldwall", () => {
    const t = table();
    const hounds = t.add("h", "p1", unitDef("Thornkin", "Briar Hounds"), 0, 2);
    const guard = t.add("g", "p2", unitDef("Wardens of the Wick", "Wick Guard"), 0, 0.5);
    t.covered.add("g.0").add("g.1").add("g.2").add("g.3").add("g.4");
    // Hounds: 6 dice at 4+ (cover ignored), 3 hits; Guard save 4+ (no Shieldwall): one saved.
    // Three Guard left strike back: 3 dice at 4+, 2 hits; hounds save on 6+, none.
    const log = drive(
      t.view,
      (ctx) => action("fight").run(ctx, { unit: hounds.id, target: guard.id }),
      [4, 4, 4, 1, 1, 1, 4, 1, 1, 5, 5, 1, 2, 3],
    );
    expect(rolls(log).map((r: Any) => [r.expr, r.need])).toEqual([
      ["6d6", 4],
      ["3d6", 4],
      ["3d6", 4],
      ["2d6", 6],
    ]);
    expect(lost(t.state, guard.id)).toEqual(["x", "x", 0, 0, 0]);
    expect(lost(t.state, hounds.id)).toEqual(["x", 0, 0]);
  });

  it("a target wiped out doesn't strike back", () => {
    const t = table();
    const bramble = t.add("b", "p1", unitDef("Thornkin", "Old Bramble"), 0, 2);
    const lamps = t.add("l", "p2", unitDef("Wardens of the Wick", "Lamplighters"), 0, 0.5);
    const log = drive(
      t.view,
      (ctx) => action("fight").run(ctx, { unit: bramble.id, target: lamps.id }),
      [6, 6, 1, 1, 1, 1],
    );
    expect(rolls(log)).toHaveLength(2);
    expect(lost(t.state, lamps.id)).toEqual(["x", "x"]);
  });
});

describe("Rift Lanterns: Regrow", () => {
  it("heals 1 wound on every wounded Thornkin model as each round starts, and nobody else", () => {
    const t = table();
    t.add("h", "p1", unitDef("Thornkin", "Briar Hounds"), 0, 3);
    t.add("b", "p1", unitDef("Thornkin", "Old Bramble"), 6, 3);
    t.add("w", "p2", unitDef("Cogwright Guild", "Strider"), 0, -3);
    Object.assign(t.state.models["h.0"], { woundsLost: 1 });
    Object.assign(t.state.models["h.1"], { woundsLost: 2, destroyed: true });
    Object.assign(t.state.models["b.0"], { woundsLost: 3 });
    Object.assign(t.state.models["w.0"], { woundsLost: 2 });
    drive(t.view, (ctx) => M.hooks.roundStart(ctx), []);
    expect(t.state.models["h.0"].woundsLost).toBe(0);
    expect(t.state.models["h.1"]).toMatchObject({ woundsLost: 2, destroyed: true });
    expect(t.state.models["b.0"].woundsLost).toBe(2);
    expect(t.state.models["w.0"].woundsLost).toBe(2);
  });
});

describe("Rift Lanterns: lanterns and missions", () => {
  it("a side holds a lantern with more models within 3\" of it (from the base's edge); a tie holds nothing", () => {
    const t = table();
    t.state.objectives = [{ id: "middle", position: { x: 0, y: 0 } }];
    const hold = rule("snuff-them-out", "middle");
    // A Strider (50mm base) with its centre 3.9" off: its base is within 3".
    t.add("w", "p1", unitDef("Cogwright Guild", "Strider"), 0, 3.9);
    expect(hold.suggest(t.state, 0)).toEqual({ vp: 1, why: "holds the middle lantern" });
    expect(hold.suggest(t.state, 1)).toBeNull();
    // 4.1" off, it isn't.
    t.state.models["w.0"].position.y = 4.1;
    expect(hold.suggest(t.state, 0)).toBeNull();
    // One each: a tie.
    t.state.models["w.0"].position.y = 2;
    t.add("d", "p2", unitDef("Gloam Choir", "Dusk Stalkers"), 30, 0);
    t.state.models["d.0"].position = { x: 0, y: -2 };
    expect(hold.suggest(t.state, 0)).toBeNull();
    expect(hold.suggest(t.state, 1)).toBeNull();
  });

  it('deploys in strips 6" deep along the long edges', () => {
    const { zones } = mission("lantern-grab").setup({ width: 36, depth: 24 });
    const ys = (seat: number) => zones.find((z: Any) => z.seat === seat).points.map((p: Any) => p.y);
    expect(Math.min(...ys(0))).toBe(6);
    expect(Math.max(...ys(0))).toBe(12);
    expect(Math.min(...ys(1))).toBe(-12);
    expect(Math.max(...ys(1))).toBe(-6);
    for (const m of app.missions) expect(m.setup({ width: 36, depth: 24 }).zones).toEqual(zones);
  });

  it("Lantern Grab: 1 for each of the three lanterns held at each round's end", () => {
    const t = table();
    const { objectives } = mission("lantern-grab").setup({ width: 36, depth: 24 });
    expect(objectives).toHaveLength(3);
    t.state.objectives = objectives;
    t.add("a", "p1", unitDef("Wardens of the Wick", "Lamplighters"), -12, 0);
    t.add("b", "p1", unitDef("Wardens of the Wick", "Warden-Captain"), 0, 0);
    const r = rule("lantern-grab", "hold");
    expect(r.at).toEqual({ roundEnd: true });
    expect(r.suggest(t.state, 0)).toEqual({ vp: 2, why: "2 lanterns held" });
    expect(r.suggest(t.state, 1)).toEqual({ vp: 0, why: "0 lanterns held" });
  });

  it("Snuff Them Out: 2 at the game's end for each enemy unit wiped out", () => {
    const t = table();
    t.add("g", "p1", unitDef("Wardens of the Wick", "Warden-Captain"), 0, 5);
    t.add("l", "p2", unitDef("Wardens of the Wick", "Lamplighters"), 0, -5);
    t.add("s", "p2", unitDef("Thornkin", "Thorn Slingers"), 0, -8);
    t.state.models["l.0"].destroyed = true;
    t.state.models["l.1"].destroyed = true;
    t.state.models["s.0"].destroyed = true;
    const r = rule("snuff-them-out", "broken");
    expect(r.at).toEqual({ gameEnd: true });
    expect(r.suggest(t.state, 0)).toEqual({ vp: 2, why: "1 enemy unit wiped out" });
    expect(r.suggest(t.state, 1)).toEqual({ vp: 0, why: "0 enemy units wiped out" });
  });

  it("The Last Lantern: 2 for holding it from round 2, and 2 a unit in the enemy's strip at the end", () => {
    const t = table();
    t.state.objectives = mission("last-lantern").setup({ width: 36, depth: 24 }).objectives;
    t.add("g", "p1", unitDef("Wardens of the Wick", "Warden-Captain"), 0, 1);
    t.add("l", "p1", unitDef("Wardens of the Wick", "Lamplighters"), 0, -10);
    const last = rule("last-lantern", "last");
    t.state.turn.round = 1;
    expect(last.suggest(t.state, 0)).toBeNull();
    t.state.turn.round = 2;
    expect(last.suggest(t.state, 0)).toEqual({ vp: 2, why: "holds the last lantern" });
    const deep = rule("last-lantern", "deep");
    expect(deep.at).toEqual({ gameEnd: true });
    expect(deep.suggest(t.state, 0)).toEqual({ vp: 2, why: "1 unit in the enemy's ground" });
    expect(deep.suggest(t.state, 1)).toEqual({ vp: 0, why: "0 units in the enemy's ground" });
  });
});

const importSource = (source: string) =>
  import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`) as Promise<{
    default?: unknown;
  }>;

/** Rift Lanterns in a sandbox engine, two players joined and the game picked. */
async function sandbox() {
  const engine = new SandboxEngine(importSource);
  const loaded = (await engine.load([{ hash: "rl", source: riftLanterns }])).packages[0]!.provides!.app;
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
  const state = () => stateAt(record);
  play({ type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  play({ type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  play({ type: "game/system", system: "rift-lanterns" }, "p1");
  return { engine, loaded, play, state };
}

describe("Rift Lanterns: moving (Table warnings)", () => {
  it("flags a move past the unit's Move, and a move that ends inside a wreck", async () => {
    const { loaded, play, state } = await sandbox();
    const layout = loaded.layout as Any;
    const wreck = layout.terrain.find((p: Any) => p.category === "wreck");
    play({ type: "layout/set", layout: { ...layout, table: { width: 36, depth: 24 } } as never }, "p1");
    for (const i of spawnIntents(state(), "p1", loaded.armies[0]!.units.slice(2, 3), "p1", "a"))
      play(i, "p1");
    const captain = Object.values(state().units)[0]!;
    const id = captain.modelIds[0]!;
    play({ type: "models/move", setup: true, moves: [{ id, to: { x: wreck.position.x, y: 9 } }] }, "p1");
    play({ type: "turn/next" }, "p1");
    expect(state().turn.round).toBe(1);
    const warned = () => tableWarnings(state()).map((w) => w.checkId);
    // 4" on its 5" Move, into open ground: nothing to say.
    play({ type: "models/move", moves: [{ id, to: { x: wreck.position.x + 4, y: 9 } }] }, "p1");
    expect(warned()).toEqual([]);
    // Into the wreck, past its Move.
    play({ type: "models/move", moves: [{ id, to: wreck.position }] }, "p1");
    expect(warned()).toEqual(expect.arrayContaining(["moveDistance", "wreck"]));
  });
});

describe("Rift Lanterns: the rounds", () => {
  it("a side with no units left to activate waits while the other finishes; the game ends after round 5", async () => {
    const { engine, loaded, play, state } = await sandbox();
    const m = loaded.missions[1]!;
    play(
      { type: "mission/set", mission: { id: m.id, name: m.name }, zones: [], objectives: m.setup.objectives },
      "p1",
    );
    for (const i of spawnIntents(state(), "p1", loaded.armies[0]!.units.slice(1, 3), "p1", "a"))
      play(i, "p1");
    for (const i of spawnIntents(state(), "p2", loaded.armies[1]!.units.slice(2, 3), "p2", "b"))
      play(i, "p2");
    play({ type: "turn/next" }, "p1");
    for (let round = 1; round <= 5; round++) {
      expect(state().turn.round).toBe(round);
      const seats: number[] = [];
      while (state().turn.round === round) {
        const s = state();
        const seat = s.turn.activeSeat;
        const unit = Object.values(s.units).find(
          (u) => s.players[u.owner]?.seat === seat && !u.status?.activated,
        )!;
        seats.push(seat);
        play({ type: "turn/endActivation", unit: unit.id }, unit.owner);
      }
      // Three units, three activations: the side with two takes the last one in turn.
      expect(seats).toHaveLength(3);
      expect(seats.filter((x) => x === 0)).toHaveLength(2);
    }
    expect(state().turn.round).toBe(6);
    // The end-of-game scoring was offered once the fifth round was over.
    expect(Object.keys(engine.appState().scores)).toEqual(
      expect.arrayContaining(["broken:5:0", "broken:5:1"]),
    );
  });

  it("the side with more victory points wins", () => {
    const game = createInitialState();
    game.players = {
      p1: { id: "p1", name: "A", color: "#00f", seat: 0 },
      p2: { id: "p2", name: "B", color: "#f00", seat: 1 },
    } as Any;
    game.resources = { p1: { VP: 4 }, p2: { VP: 7 } };
    expect(result(game).title).toMatch(/^B wins 7.4$/);
  });
});

describe("Rift Lanterns: the starter table's terrain", () => {
  it("wrecks block sight; a ruin touched or a thicket seen past gives cover, in either line of sight", async () => {
    const { loaded, play, state } = await sandbox();
    play(
      { type: "layout/set", layout: { ...(loaded.layout as Any), table: { width: 36, depth: 24 } } as never },
      "p1",
    );
    for (const i of spawnIntents(state(), "p1", loaded.armies[0]!.units.slice(1, 2), "p1", "a"))
      play(i, "p1");
    for (const i of spawnIntents(state(), "p2", loaded.armies[2]!.units.slice(2, 3), "p2", "b"))
      play(i, "p2");
    const [lamps, strider] = Object.values(state().units) as Any[];
    const place = (shooterX: number, shooterY: number, x: number, y: number) =>
      play(
        {
          type: "models/move",
          setup: true,
          moves: [
            { id: lamps.modelIds[0], to: { x: shooterX - 0.6, y: shooterY } },
            { id: lamps.modelIds[1], to: { x: shooterX + 0.6, y: shooterY } },
            { id: strider.modelIds[0], to: { x, y } },
          ],
        },
        "p1",
      );
    /** The score the Lamplighters need to hit the Strider, and whether they can pick it at all. */
    const need = () => {
      const view = gameView(state(), "rift-lanterns");
      const targets = action("shoot").targets(view, { player: "p1", unitId: lamps.id });
      if (!targets.length) return "unseen";
      const log = drive(
        view,
        (ctx) => action("shoot").run(ctx, { unit: lamps.id, target: strider.id }),
        [1, 1, 1, 1],
      );
      return rolls(log)[0].need;
    };
    for (const los of ["true", "footprint"]) {
      play({ type: "settings/set", settings: { los } } as never, "p1");
      place(0, 9, 0, -1); // open ground
      expect(need()).toBe(3);
      place(10, 9, 10, -1); // a wreck between
      expect(need()).toBe("unseen");
      place(4.5, 10, 4.5, 1); // past a thicket
      expect(need()).toBe(4);
      place(-12.5, -3, -12.5, 2); // touching a ruin
      expect(need()).toBe(4);
    }
  });
});
