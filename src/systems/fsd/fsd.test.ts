import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  currentSlot,
  resolveIntent,
  type GameState,
  type Intent,
  type PlayerId,
} from "../../core";
import { actionTargets, cantPlace, unitActions } from "../../core/content/play";
import { poolUsed } from "../../core/content/player";
import { spawnIntents } from "../wh40k/deploy";
import { fsdLayout } from "./layout";
import { fsdBehemothSample, fsdSample } from "./sample";
import { fsdChecks } from "./checks";
import { gameView } from "../../core/script";

/** A seeded rng, so every run of the test rolls the same dice. */
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

function play(state: GameState, intent: Intent, from: PlayerId, r = rng(1)): GameState {
  const event = resolveIntent(intent, from, r, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  return applyEvent({ ...state, seq: state.seq + 1 }, event);
}

/** Two seated players, FSD chosen, the sample table and warbands deployed. */
function setup(sample = fsdSample): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system: "fsd-1.7" }, "p1");
  s = play(s, { type: "layout/set", layout: { ...fsdLayout(), terrain: [] } }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(s, p, sample(seat).units, p, "army")) s = play(s, i, p);
  return s;
}

const unitNamed = (s: GameState, name: string, owner: string) =>
  Object.values(s.units).find((u) => u.name === name && u.owner === owner)!;

/** Start the round and go past pre-assigning ADs to the activations. */
function toActivations(s: GameState): GameState {
  for (let i = 0; i < 4 && currentSlot(s)?.kind !== "alternate"; i++)
    s = play(s, { type: "turn/next" }, "p1");
  return s;
}

const checks = (s: GameState) => fsdChecks(gameView(s, "fsd-1.7"));

/** Put every model of a unit in a row around (x, y). */
function place(s: GameState, unitId: string, x: number, y: number): GameState {
  const unit = s.units[unitId]!;
  const moves = unit.modelIds.map((id, i) => ({ id, to: { x: x + i * 1.5, y } }));
  return applyEvent(s, { type: "models/move", moves });
}

describe("Full Spectrum Dominance in play", () => {
  it("warns about a unit moved without activating", () => {
    let s = toActivations(setup());
    const squad = unitNamed(s, "Rifle Squad", "p1");
    expect(checks(s)).toEqual([]);
    s = place(s, squad.id, 0, 4);
    expect(checks(s).map((w) => [w.id, w.unitId])).toEqual([["activateFirst", squad.id]]);
    s = play(s, { type: "action/take", unitId: squad.id, action: "activate" }, "p1");
    // Activated, the drag still needs a Move action (UX 262).
    expect(checks(s).map((w) => w.id)).toEqual(["moveAction"]);
    s = play(s, { type: "action/take", unitId: squad.id, action: "move" }, "p1");
    expect(checks(s)).toEqual([]);
  });

  it("sets the table and rolls activation dice at the start of each round", () => {
    let s = setup();
    expect(s.table).toEqual({ width: 36, depth: 24 });
    expect(s.settings.los).toBe("footprint");
    expect(s.resources.p1).toEqual({ VP: 0 });
    s = play(s, { type: "turn/next" }, "p1");
    // The dice roll is a step: the marker goes straight on to pre-assigning ADs.
    expect(currentSlot(s)?.name).toBe("Pre-assign ADs");
    expect(s.pools?.p1?.readyDice).toHaveLength(8);
    expect(s.pools?.p2?.readyDice).toHaveLength(8);
  });

  it("activates, moves, fires with a reaction window, and alternates", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1");
    const gang = unitNamed(s, "Raider Gang", "p2");
    s = place(s, tank.id, 0, 4);
    s = place(s, gang.id, -1.5, -2);
    s = toActivations(s);

    // Before activating, only Activate is open; the enemy can't act on our turn.
    const before = unitActions(s, tank.id);
    expect(before.find((o) => o.def.id === "activate")?.ok).toBe(true);
    expect(before.find((o) => o.def.id === "move")?.why).toBe("Activate the unit first");
    expect(unitActions(s, gang.id).find((o) => o.def.id === "activate")?.why).toBe("Not your turn");

    s = play(s, { type: "action/take", unitId: tank.id, action: "activate" }, "p1");
    expect(s.pools?.p1?.readyDice).toHaveLength(7);
    expect(s.units[tank.id]?.status).toMatchObject({ acting: true, activated: true, actionBudget: 2 });

    // Moving lets the tank go 4 DU (12"); the gang can see it and may react.
    s = play(s, { type: "action/take", unitId: tank.id, action: "move" }, "p1");
    expect(s.units[tank.id]?.status?.allowance).toBe(12);
    expect(s.pending?.seat).toBe(1);
    expect(unitActions(s, tank.id).find((o) => o.def.id === "fire")?.why).toBe("Waiting on a reaction");
    s = play(s, { type: "reaction/pass" }, "p2");
    expect(s.pending).toBeNull();

    // Fire the coax MG at the gang: the gang may react first. It reacts and fires back.
    const targets = actionTargets(s, tank.id, "fire");
    expect(targets[0]?.unitId).toBe(gang.id);
    s = play(
      s,
      { type: "action/take", unitId: tank.id, action: "fire", weapon: "coax-mg", targetId: gang.id },
      "p1",
    );
    expect(s.pending?.trigger.action).toBe("fire");
    expect(s.procedure ?? null).toBeNull();
    s = play(s, { type: "action/take", unitId: gang.id, action: "react" }, "p2");
    expect(s.pending?.reactor).toBe(gang.id);
    s = play(
      s,
      { type: "action/take", unitId: gang.id, action: "fire", weapon: "carbines", targetId: tank.id },
      "p2",
    );
    expect(s.procedure?.unitId).toBe(gang.id);
    let r = rng(7);
    while (!s.procedure!.run.done) s = play(s, { type: "procedure/roll" }, "p2", r);
    // Closing the reaction's roll resumes the tank's held attack.
    s = play(s, { type: "procedure/clear" }, "p2");
    expect(s.pending).toBeNull();
    expect(s.units[gang.id]?.status?.activated).toBe(true);
    if (s.procedure) {
      expect(s.procedure.unitId).toBe(tank.id);
      r = rng(9);
      while (!s.procedure!.run.done) s = play(s, { type: "procedure/roll" }, "p1", r);
      s = play(s, { type: "procedure/clear" }, "p1");
    }
    // Two actions used: the tank is done; the other player activates next.
    expect(unitActions(s, tank.id).find((o) => o.def.id === "move")?.ok).toBe(false);
    s = play(s, { type: "turn/endActivation" }, "p1");
    expect(s.turn.activeSeat).toBe(1);
    expect(s.units[tank.id]?.status?.acting).toBeUndefined();
    expect(unitActions(s, tank.id).find((o) => o.def.id === "activate")?.why).toBe("Not your turn");
  });

  it("commands nearby units and ends the round when both players pass", () => {
    let s = setup();
    const boss = unitNamed(s, "Command Team", "p1");
    const squad = unitNamed(s, "Rifle Squad", "p1");
    s = place(s, boss.id, -6, 8);
    s = place(s, squad.id, -6, 10);
    s = toActivations(s);
    const activate = unitActions(s, boss.id).find((o) => o.def.id === "activate")!;
    expect(activate.commands?.count).toBe(2);
    expect(activate.commands?.candidates).toContain(squad.id);
    s = play(s, { type: "action/take", unitId: boss.id, action: "activate", with: [squad.id] }, "p1");
    expect(s.pools?.p1?.readyDice).toHaveLength(7);
    expect(s.units[squad.id]?.status).toMatchObject({ acting: true, commanded: true });
    s = play(s, { type: "turn/endActivation" }, "p1");
    s = play(s, { type: "turn/pass" }, "p2");
    s = play(s, { type: "turn/pass" }, "p1");
    expect(currentSlot(s)?.name).toBe("Scoring");
    s = play(s, { type: "turn/next" }, "p1");
    expect(currentSlot(s)?.name).toBe("Cleanup");
    s = play(s, { type: "turn/next" }, "p1");
    expect(s.turn.round).toBe(2);
    expect(s.units[boss.id]?.status?.activated).toBeUndefined();
    expect(s.pools?.p1?.readyDice).toHaveLength(8);
  });

  it("re-rolls activation dice once, then ready, and pays with the die the player picks", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1");
    s = play(s, { type: "turn/next" }, "p1");
    s = play(s, { type: "pool/reroll", player: "p1", resource: "readyDice", indices: [0, 1] }, "p1");
    expect(poolUsed(s, "p1", "readyDice")).toBe("rerolled");
    const again = resolveIntent(
      { type: "pool/reroll", player: "p1", resource: "readyDice", indices: [2] },
      "p1",
      rng(2),
      s,
    );
    expect(again).toBeNull();
    s = play(s, { type: "pool/ready", player: "p1", resource: "readyDice" }, "p1");
    expect(poolUsed(s, "p1", "readyDice")).toBe("ready");
    s = toActivations(s);
    const faces = s.pools!.p1!.readyDice!;
    const highest = faces.indexOf(Math.max(...faces));
    const option = unitActions(s, tank.id, { dice: [highest] }).find((o) => o.def.id === "activate")!;
    expect(option.faces).toEqual([faces[highest]]);
    s = play(s, { type: "action/take", unitId: tank.id, action: "activate", dice: [highest] }, "p1");
    const left = [...faces];
    left.splice(highest, 1);
    expect(s.pools?.p1?.readyDice).toEqual(left);
  });

  it("rolls on the damage chart for units that have one", () => {
    let s = setup();
    const walker = unitNamed(s, "Junk Walker", "p2");
    const tank = unitNamed(s, "Lancer Tank", "p1");
    s = place(s, tank.id, 0, 2);
    s = place(s, walker.id, 0, -1);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank.id, action: "activate" }, "p1");
    let pinned = false;
    let notes = 0;
    for (let seed = 1; seed < 40 && !pinned; seed++) {
      let t: GameState = {
        ...s,
        pending: null,
        units: {
          ...s.units,
          [tank.id]: { ...s.units[tank.id]!, status: { ...s.units[tank.id]!.status, actionsTaken: 0 } },
        },
      };
      t = play(
        t,
        { type: "action/take", unitId: tank.id, action: "fire", weapon: "coax-mg", targetId: walker.id },
        "p1",
      );
      if (t.pending) t = play(t, { type: "reaction/pass" }, "p2");
      const r = rng(seed);
      while (t.procedure && !t.procedure.run.done) t = play(t, { type: "procedure/roll" }, "p1", r);
      const outcomes = t.procedure?.run.outcomes ?? [];
      notes += outcomes.filter((o) => o.kind === "note").length;
      pinned = !!t.units[walker.id]?.status?.pinned;
    }
    expect(notes).toBeGreaterThan(0);
    expect(pinned).toBe(true);
  });
  it("a behemoth's Systems shield its Core from their side, and activate with it (#40)", () => {
    let s = setup(fsdBehemothSample);
    const hauler = unitNamed(s, "Siege Hauler", "p2");
    const tank = unitNamed(s, "Lancer Tank", "p1");
    const core = hauler.modelIds[0]!;
    s = applyEvent(s, { type: "model/move", id: core, to: { x: 0, y: 0 }, facing: 0 });
    s = toActivations(s);
    const shoot = (from: { x: number; y: number }, seed: number) => {
      let t = place(s, tank.id, from.x, from.y);
      t = play(t, { type: "action/take", unitId: tank.id, action: "activate" }, "p1");
      t = play(
        t,
        { type: "action/take", unitId: tank.id, action: "fire", weapon: "coax-mg", targetId: hauler.id },
        "p1",
      );
      if (t.pending) t = play(t, { type: "reaction/pass" }, "p2");
      const r = rng(seed);
      while (t.procedure && !t.procedure.run.done) t = play(t, { type: "procedure/roll" }, "p1", r);
      return t;
    };
    const rec = (t: GameState, id: string) => t.procedure?.run.records.find((r) => r.id === id);
    // From the left the Port Plate takes it: Defense 4 and a d8 save.
    let throughs = 0;
    let soaked = 0;
    for (let seed = 1; seed < 30; seed++) {
      const t = shoot({ x: -6, y: 0 }, seed);
      expect((rec(t, "hit")!.plan as { target: number }).target).toBe(4);
      expect((rec(t, "save")?.plan as { sides?: number } | undefined)?.sides ?? 8).toBe(8);
      const notes = (t.procedure?.run.outcomes ?? []).filter((o) => o.kind === "note").map((o) => o.text);
      throughs += notes.filter((n) => /through to the core/.test(n)).length;
      soaked += notes.filter((n) => /^Port Plate damage roll \d: (white|orange)/.test(n)).length;
      // Soaked hits don't pin it; only the Core's own damage does.
      if (!throughs) expect(t.units[hauler.id]?.status?.pinned).toBeFalsy();
    }
    expect(soaked).toBeGreaterThan(0);
    expect(throughs).toBeGreaterThan(0);
    // From behind nothing shields it: the Core's Defense 3, and no rear penalty to its d10 save.
    const rear = shoot({ x: 0, y: -6 }, 3);
    expect((rec(rear, "hit")!.plan as { target: number }).target).toBe(3);
    // The Core and its four parts: two actions each.
    let a = play(s, { type: "turn/pass" }, "p1");
    a = play(a, { type: "action/take", unitId: hauler.id, action: "activate" }, "p2");
    expect(a.units[hauler.id]?.status?.actionBudget).toBe(10);
  });

  it("pre-assigns dice to card slots, and a reacting unit fires with them", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1");
    const gang = unitNamed(s, "Raider Gang", "p2");
    s = place(s, tank.id, 0, 3);
    s = place(s, gang.id, -1.5, 0.5);
    s = play(s, { type: "turn/next" }, "p1");
    expect(currentSlot(s)?.name).toBe("Pre-assign ADs");
    s = { ...s, pools: { ...s.pools, p2: { readyDice: [5, 2, 6] } } };
    // A 5 doesn't fit the charges' 1-3 slot; a 2 does.
    expect(cantPlace(s, "p2", gang.id, "breaching-charges", 0)).toBe("A 5 doesn't fit its slots");
    expect(cantPlace(s, "p2", gang.id, "carbines", 1)).toBe("No AD slots");
    s = play(s, { type: "dice/place", unitId: gang.id, weapon: "breaching-charges", index: 1 }, "p2");
    expect(s.placed?.p2).toEqual({ [`${gang.id}/breaching-charges`]: [2] });
    expect(s.pools?.p2?.readyDice).toEqual([5, 6]);
    expect(cantPlace(s, "p2", gang.id, "breaching-charges", 0)).toBe("Its slots are full");

    // In the activations, placing is for the active player before an activation.
    s = toActivations(s);
    expect(cantPlace(s, "p2", gang.id, "breaching-charges", 0)).toBe(
      "Dice go on cards at the start of your turn",
    );
    s = play(s, { type: "action/take", unitId: tank.id, action: "activate" }, "p1");
    s = play(
      s,
      { type: "action/take", unitId: tank.id, action: "fire", weapon: "coax-mg", targetId: gang.id },
      "p1",
    );
    s = play(s, { type: "action/take", unitId: gang.id, action: "react" }, "p2");
    const fire = (w: string) =>
      unitActions(s, gang.id, { weapon: w, targetId: tank.id }).find((o) => o.def.id === "fire")!;
    expect(fire("breaching-charges").ok).toBe(true);
    expect(fire("breaching-charges").faces).toEqual([2]);
    s = play(
      s,
      {
        type: "action/take",
        unitId: gang.id,
        action: "fire",
        weapon: "breaching-charges",
        targetId: tank.id,
      },
      "p2",
    );
    // The die on the card is spent; the Ready dice are untouched by the shot.
    expect(s.placed?.p2).toEqual({});
    expect(s.pools?.p2?.readyDice).toHaveLength(1);

    // The reaction's results wait for the tank's shot and land with it.
    let r = rng(3);
    while (!s.procedure!.run.done) s = play(s, { type: "procedure/roll" }, "p2", r);
    const reaction = s.procedure!.run.outcomes.filter((o) => o.kind !== "note");
    const before = JSON.stringify(s.models);
    s = play(s, { type: "procedure/clear" }, "p2");
    expect(s.pending).toBeNull();
    // (With these dice the charges pin the tank, but it still gets its shot off.)
    expect(reaction).toContainEqual(expect.objectContaining({ unitId: tank.id, status: "pinned" }));
    expect(s.deferred).toEqual(expect.arrayContaining(reaction));
    expect(s.units[tank.id]?.status?.pinned).toBeUndefined();
    expect(JSON.stringify(s.models)).toBe(before);
    expect(s.procedure?.unitId).toBe(tank.id);
    r = rng(4);
    while (!s.procedure!.run.done) s = play(s, { type: "procedure/roll" }, "p1", r);
    expect(s.deferred ?? null).toBeNull();
    expect(s.units[tank.id]?.status?.pinned).toBe(true);
  });

  it("a reacting unit without placed dice can't use a slotted weapon", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1");
    const gang = unitNamed(s, "Raider Gang", "p2");
    s = place(s, tank.id, 0, 3);
    s = place(s, gang.id, -1.5, 0.5);
    s = toActivations(s);
    s = { ...s, pools: { ...s.pools, p2: { readyDice: [5, 2, 6] } } };
    s = play(s, { type: "action/take", unitId: tank.id, action: "activate" }, "p1");
    s = play(
      s,
      { type: "action/take", unitId: tank.id, action: "fire", weapon: "coax-mg", targetId: gang.id },
      "p1",
    );
    s = play(s, { type: "action/take", unitId: gang.id, action: "react" }, "p2");
    const charges = unitActions(s, gang.id, { weapon: "breaching-charges", targetId: tank.id }).find(
      (o) => o.def.id === "fire",
    )!;
    expect(charges.why).toBe("Needs a die showing 1-3 placed on its slots");
  });

  it("switches off a damaged system's action and drops the dice on it", () => {
    let s = toActivations(setup());
    const tank = unitNamed(s, "Lancer Tank", "p1");
    s = { ...s, pools: { ...s.pools, p1: { readyDice: [5, 1] } } };
    s = play(s, { type: "dice/place", unitId: tank.id, weapon: "light-cannon", index: 0 }, "p1");
    expect(s.placed?.p1?.[`${tank.id}/light-cannon`]).toEqual([5]);
    // The light cannon is the first line on the card: System 1.
    s = applyEvent(s, { type: "unit/status", id: tank.id, key: "damageS1", value: true });
    expect(s.placed?.p1).toEqual({});
    s = play(s, { type: "action/take", unitId: tank.id, action: "activate" }, "p1");
    const fire = (w: string) => unitActions(s, tank.id, { weapon: w }).find((o) => o.def.id === "fire")!;
    expect(fire("light-cannon").why).toBe("System 1 is damaged");
    expect(fire("coax-mg").why).not.toBe("System 2 is damaged");
  });

  it("keeps placed dice over the round, rolling fewer, and discards them at cleanup", () => {
    let s = toActivations(setup());
    const tank = unitNamed(s, "Lancer Tank", "p1");
    s = { ...s, placed: { p1: { [`${tank.id}/light-cannon`]: [6], "x/y": [1, 2, 3, 4] } } };
    s = play(s, { type: "turn/pass" }, "p1");
    s = play(s, { type: "turn/pass" }, "p2");
    s = play(s, { type: "turn/next" }, "p1");
    expect(currentSlot(s)?.name).toBe("Cleanup");
    s = play(s, { type: "dice/discard", unitId: "x", weapon: "y" }, "p1");
    expect(Object.keys(s.placed?.p1 ?? {})).toEqual([`${tank.id}/light-cannon`]);
    s = play(s, { type: "turn/next" }, "p1");
    expect(s.turn.round).toBe(2);
    // 12 dice in the AD Pool, one still on a card: the roll is the full 8.
    expect(s.pools?.p1?.readyDice).toHaveLength(8);
    s = { ...s, placed: { p1: { a: [1, 2, 3, 4, 5] } } };
    s = play(s, { type: "turn/next" }, "p1");
    s = play(s, { type: "turn/pass" }, "p1");
    s = play(s, { type: "turn/pass" }, "p2");
    s = play(s, { type: "turn/next" }, "p1");
    s = play(s, { type: "turn/next" }, "p1");
    expect(s.turn.round).toBe(3);
    expect(s.pools?.p1?.readyDice).toHaveLength(7);
  });
  it("warns when a single move breaks an enemy's area of control", () => {
    let s = setup();
    const squad = unitNamed(s, "Rifle Squad", "p1");
    const gang = unitNamed(s, "Raider Gang", "p2");
    s = place(s, gang.id, 0, 0);
    s = place(s, squad.id, -12, 0);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: squad.id, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: squad.id, action: "move" }, "p1");
    if (s.pending) s = play(s, { type: "reaction/pass" }, "p2");
    // Straight past the gang, within 1 DU of it, and out the other side.
    const past = place(s, squad.id, 1, -4.5);
    expect(checks(past).map((w) => w.id)).toContain("areaOfControl");
    expect(checks(past).find((w) => w.id === "areaOfControl")?.message).toMatch(/enter and leave/);
    // Pinned enemies control nothing.
    const pinned = applyEvent(past, { type: "unit/status", id: gang.id, key: "pinned", value: true });
    expect(checks(pinned).map((w) => w.id)).not.toContain("areaOfControl");
    // A second move may leave it.
    s = play(s, { type: "action/take", unitId: squad.id, action: "move" }, "p1");
    if (s.pending) s = play(s, { type: "reaction/pass" }, "p2");
    expect(checks(place(s, squad.id, 1, -4.5)).map((w) => w.id)).not.toContain("areaOfControl");
  });

  it("prepares a prepared action instead of firing it, and other actions end interacting", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1");
    const cannon = s.units[tank.id]!.sheet!.weapons["light-cannon"]!;
    s = {
      ...s,
      units: {
        ...s.units,
        [tank.id]: {
          ...s.units[tank.id]!,
          sheet: {
            ...s.units[tank.id]!.sheet!,
            weapons: {
              ...s.units[tank.id]!.sheet!.weapons,
              "light-cannon": { ...cannon, keywords: ["Prepared"] },
            },
          },
        },
      },
    };
    s = toActivations(s);
    s = { ...s, pools: { ...s.pools, p1: { readyDice: [5, 1, 1] } } };
    s = play(s, { type: "action/take", unitId: tank.id, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: tank.id, action: "interact" }, "p1");
    expect(s.units[tank.id]?.status?.interacting).toBe(true);
    const fire = unitActions(s, tank.id, { weapon: "light-cannon" }).find((o) => o.def.id === "fire")!;
    expect(fire.why).toBe("Not for this weapon");
    s = play(s, { type: "action/take", unitId: tank.id, action: "prepare", weapon: "light-cannon" }, "p1");
    expect(s.units[tank.id]?.status).toMatchObject({ "prepared.light-cannon": true });
    expect(s.units[tank.id]?.status?.interacting).toBeUndefined();
    expect(s.pools?.p1?.readyDice).toEqual([1]);
  });

  it("a unit in reserve can't be commanded and projects no area of control (UX 293)", () => {
    let s = setup();
    const boss = unitNamed(s, "Command Team", "p1");
    const squad = unitNamed(s, "Rifle Squad", "p1");
    s = place(s, boss.id, -6, 8);
    s = place(s, squad.id, -6, 10);
    s = play(s, { type: "unit/reserve", id: squad.id, reserve: true }, "p1");
    s = toActivations(s);
    const activate = unitActions(s, boss.id).find((o) => o.def.id === "activate")!;
    expect(activate.commands?.candidates ?? []).not.toContain(squad.id);
    // An enemy in reserve right beside a moving unit: no area of control warning from it.
    const gang = unitNamed(s, "Raider Gang", "p2");
    let t = play(s, { type: "unit/reserve", id: gang.id, reserve: true }, "p2");
    t = place(t, gang.id, -6, 6);
    expect(
      checks(t)
        .map((w) => w.message)
        .join("\n"),
    ).not.toMatch(/Raider Gang's area of control/);
  });

  it("deploys a unit from reserve as an activation with one action and no die", () => {
    let s = setup();
    const squad = unitNamed(s, "Rifle Squad", "p1");
    s = play(s, { type: "unit/reserve", id: squad.id, reserve: true }, "p1");
    s = toActivations(s);
    const opts = unitActions(s, squad.id);
    expect(opts.find((o) => o.def.id === "activate")?.ok).toBe(false);
    const deploy = opts.find((o) => o.def.id === "deploy")!;
    expect(deploy.ok).toBe(true);
    expect(deploy.cost).toBe("");
    const before = s.pools?.p1?.readyDice?.length;
    s = play(s, { type: "action/take", unitId: squad.id, action: "deploy" }, "p1");
    expect(s.pools?.p1?.readyDice?.length).toBe(before);
    expect(s.units[squad.id]?.status).toMatchObject({ acting: true, actionBudget: 1 });
    s = play(s, { type: "unit/reserve", id: squad.id, reserve: false }, "p1");
    const gang = unitNamed(s, "Raider Gang", "p2");
    s = place(s, gang.id, 0, 0);
    expect(checks(place(s, squad.id, 0, 4)).map((w) => w.id)).toContain("deployDistance");
    expect(checks(place(s, squad.id, 0, 9)).map((w) => w.id)).not.toContain("deployDistance");
  });

  it("uses a support card by spending ADs instead of activating", () => {
    let s = toActivations(setup());
    s = { ...s, pools: { ...s.pools, p1: { readyDice: [6, 2, 4] } } };
    s = play(
      s,
      { type: "player/action", action: "support", label: "Artillery strike", cost: 2, dice: [0] },
      "p1",
    );
    expect(s.pools?.p1?.readyDice).toEqual([4]);
    // Used instead of an activation: the other side goes next (UX 263).
    expect(s.turn.activeSeat).toBe(1);
    expect(
      resolveIntent({ type: "player/action", action: "support", label: "Recon", cost: 1 }, "p1", rng(1), s),
    ).toBeNull();
  });
});
