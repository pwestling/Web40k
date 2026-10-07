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
import { actionTargets, unitActions } from "../../core/content/play";
import { poolUsed } from "../../core/content/player";
import { spawnIntents } from "../wh40k/deploy";
import { fsdLayout } from "./layout";
import { fsdSample } from "./sample";

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
function setup(): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system: "fsd-1.7" }, "p1");
  s = play(s, { type: "layout/set", layout: { ...fsdLayout(), terrain: [] } }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(s, p, fsdSample(seat).units, p, "army")) s = play(s, i, p);
  return s;
}

const unitNamed = (s: GameState, name: string, owner: string) =>
  Object.values(s.units).find((u) => u.name === name && u.owner === owner)!;

/** Put every model of a unit in a row around (x, y). */
function place(s: GameState, unitId: string, x: number, y: number): GameState {
  const unit = s.units[unitId]!;
  const moves = unit.modelIds.map((id, i) => ({ id, to: { x: x + i * 1.5, y } }));
  return applyEvent(s, { type: "models/move", moves });
}

describe("Full Spectrum Dominance in play", () => {
  it("sets the table and rolls activation dice at the start of each round", () => {
    let s = setup();
    expect(s.table).toEqual({ width: 36, depth: 24 });
    expect(s.settings.los).toBe("footprint");
    expect(s.resources.p1).toEqual({ VP: 0 });
    s = play(s, { type: "turn/next" }, "p1");
    // The dice roll is a step: the marker goes straight on to activations.
    expect(currentSlot(s)?.kind).toBe("alternate");
    expect(s.pools?.p1?.readyDice).toHaveLength(8);
    expect(s.pools?.p2?.readyDice).toHaveLength(8);
  });

  it("activates, moves, fires with a reaction window, and alternates", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1");
    const gang = unitNamed(s, "Raider Gang", "p2");
    s = place(s, tank.id, 0, 4);
    s = place(s, gang.id, -1.5, -2);
    s = play(s, { type: "turn/next" }, "p1");

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
    s = play(s, { type: "turn/next" }, "p1");
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
    s = play(s, { type: "turn/next" }, "p1");
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
});
