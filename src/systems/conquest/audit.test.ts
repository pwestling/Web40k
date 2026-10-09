import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  resolveIntent,
  type GameState,
  type Intent,
  type PlayerId,
} from "../../core";
import { actionTargets, unitActions } from "../../core/content/play";
import { closeDoor } from "../../core/manoeuvre";
import { hookIntents } from "../../core/script";
import type { StepRecord } from "../../core/content";
import { spawnIntents } from "../wh40k/deploy";
import "../index";
import { commitmentOf } from "../../core/secrets";
import { cardKey, nextCard, stackOf } from "./command";
import { conquestLayout } from "./layout";
import { arrivalTarget } from "./reinforce";
import { conquestSample } from "./sample";
import { conquest } from "./system";

/** Rules audit (#55): the automations in docs/rules-coverage/conquest.md not covered in conquest.test.ts. */

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

function setup(): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system: "conquest-hand" }, "p1");
  s = play(s, { type: "layout/set", layout: { ...conquestLayout(), terrain: [] } }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(s, p, conquestSample(seat).units, p, "army")) s = play(s, i, p);
  return s;
}

const unitNamed = (s: GameState, name: string) => Object.values(s.units).find((u) => u.name === name)!;

/** Slide a block so its front edge sits `gap` inches from the centre line, centred on x = 0. */
function toCentre(s: GameState, unitId: string, gap: number): GameState {
  const ms = s.units[unitId]!.modelIds.map((id) => s.models[id]!);
  const half = 0.79;
  const xs = ms.map((m) => m.position.x);
  const dx = -(Math.min(...xs) + Math.max(...xs)) / 2;
  const ys = ms.map((m) => m.position.y);
  const dy = ms[0]!.owner === "p1" ? gap + half - Math.min(...ys) : -gap - half - Math.max(...ys);
  return applyEvent(s, {
    type: "models/move",
    moves: ms.map((m) => ({ id: m.id, to: { x: m.position.x + dx, y: m.position.y + dy } })),
  });
}

/** Every stand of a regiment with these characteristics changed. */
function withChars(s: GameState, unitId: string, chars: Record<string, string>): GameState {
  const models = { ...s.models };
  for (const id of s.units[unitId]!.modelIds) {
    const m = models[id]!;
    models[id] = { ...m, profile: { ...m.profile!, chars: { ...m.profile!.chars, ...chars } } };
  }
  return { ...s, models };
}

function withAbilities(s: GameState, id: string, names: string[]): GameState {
  const u = s.units[id]!;
  return {
    ...s,
    units: {
      ...s.units,
      [id]: { ...u, sheet: { ...u.sheet!, abilities: names.map((name) => ({ name, text: "" })) } },
    },
  };
}

/** Into the Action phase with `seat` to act. */
function toActions(s: GameState, seat: 0 | 1): GameState {
  s = play(s, { type: "turn/next" }, "p1");
  s = play(s, { type: "turn/next" }, "p1");
  if (s.turn.activeSeat !== seat) s = play(s, { type: "turn/pass" }, seat === 0 ? "p2" : "p1");
  return s;
}

function attack(s: GameState, unitId: string, action: string, targetId: string, by: PlayerId, seed = 3) {
  s = play(s, { type: "action/take", unitId, action, targetId }, by);
  const r = rng(seed);
  while (s.procedure && !s.procedure.run.done) s = play(s, { type: "procedure/roll" }, by, r);
  return s;
}

const step = (s: GameState, id: string): StepRecord | undefined =>
  s.procedure?.run.records.find((r) => r.id === id);
const target = (s: GameState, id: string) => (step(s, id)?.plan as { target: number | null }).target;
const option = (s: GameState, unitId: string, action: string, targetId?: string) =>
  unitActions(s, unitId, targetId ? { targetId } : undefined).find((o) => o.def.id === action);

/** Warden Guard (p1) and Thrall Host (p2) in contact, the Guard activated. */
function guardInContact(patch: (s: GameState, guard: string, thralls: string) => GameState = (s) => s) {
  let s = setup();
  const guard = unitNamed(s, "Warden Guard").id;
  const thralls = unitNamed(s, "Thrall Host").id;
  s = toCentre(s, guard, 0.25);
  s = toCentre(s, thralls, 0.25);
  s = patch(s, guard, thralls);
  s = toActions(s, 0);
  s = play(s, { type: "action/take", unitId: guard, action: "activate" }, "p1");
  return { s, guard, thralls };
}

/** Play an intent as the host does: the event, then the turn hooks it sets off (core hookIntents). */
function hosted(state: GameState, intent: Intent, from: PlayerId, r = rng(1)): GameState {
  const event = resolveIntent(intent, from, r, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  let s = applyEvent({ ...state, seq: state.seq + 1 }, event);
  for (const hook of hookIntents(state, s, event)) s = play(s, hook, from, r);
  return s;
}

/** Warden Guard (p1) and Thrall Host (p2) facing each other `gap` * 2 inches apart, the Guard activated. */
function guardFacing(gap: number) {
  let s = setup();
  const guard = unitNamed(s, "Warden Guard").id;
  const thralls = unitNamed(s, "Thrall Host").id;
  s = toCentre(s, guard, gap);
  s = toCentre(s, thralls, gap);
  s = toActions(s, 0);
  s = play(s, { type: "action/take", unitId: guard, action: "activate" }, "p1");
  return { s, guard, thralls };
}

describe("Conquest rules audit", () => {
  it("a charge targets only enemies in the front arc and in sight", () => {
    const { s, guard, thralls } = guardFacing(1.5);
    const targets = actionTargets(s, guard, "charge");
    expect(targets.find((t) => t.unitId === thralls)?.ok).toBe(true);
    // Every other enemy regiment stands well off to the side or behind the Thrall Host: none ahead and seen.
    expect(option(s, guard, "charge")?.ok).toBe(true);
    // Turned about, the Guard has no enemy in its front arc.
    const turned = { ...s, models: { ...s.models } };
    for (const id of s.units[guard]!.modelIds)
      turned.models[id] = { ...s.models[id]!, facing: s.models[id]!.facing + Math.PI };
    expect(actionTargets(turned, guard, "charge").find((t) => t.unitId === thralls)?.ok).toBe(false);
    expect(option(turned, guard, "charge")?.why).toBe("No enemy in the front arc and in sight");
  });

  it("a charge roll that can't reach falls short: Inspired lost, activation over", () => {
    // 12" apart: March 5 and a D6 can't reach.
    const g = guardFacing(6);
    const guard = g.guard;
    let s = g.s;
    s = hosted(s, { type: "action/take", unitId: guard, action: "charge" }, "p1");
    expect(s.units[guard]?.status).toMatchObject({ inspired: true, charged: true });
    s = hosted(s, { type: "dice/roll", count: 1, sides: 6, label: "charge roll", unitId: guard }, "p1");
    expect(s.units[guard]?.status?.inspired).toBeFalsy();
    expect(option(s, guard, "march")?.why).toBe("No actions left");
    expect(s.modules?.["conquest-hand"]?.[`short:${guard}`]).toBe(1);
  });

  it("a charge move into contact lands: Inspired, and the landing is noted", () => {
    const g = guardFacing(1.5);
    const { guard, thralls } = g;
    let s = g.s;
    s = hosted(s, { type: "action/take", unitId: guard, action: "charge" }, "p1");
    // Clear Inspired, to see the landing give it.
    s = applyEvent(s, { type: "unit/status", id: guard, key: "inspired", value: null });
    s = hosted(s, { type: "dice/roll", count: 1, sides: 6, label: "charge roll", unitId: guard }, "p1");
    expect(option(s, guard, "march")?.why).not.toBe("No actions left");
    const door = closeDoor(s, s.units[guard]!, s.units[thralls]!)!;
    s = hosted(s, { ...door.move, how: "charge" }, "p1");
    expect(s.units[guard]?.status?.inspired).toBe(true);
    expect(s.modules?.["conquest-hand"]?.[`landed:${guard}`]).toBe(1);
  });

  it("Inspired adds 1 to Clash only while Clash stays under 5; from Clash 4 it is a reminder", () => {
    const g = guardInContact((st, g) => withChars(st, g, { C: "4" }));
    let s = g.s;
    const { guard, thralls } = g;
    s = play(s, { type: "action/take", unitId: guard, action: "inspire" }, "p1");
    s = attack(s, guard, "clash", thralls, "p1");
    expect(target(s, "hit")).toBe(4);
    expect(step(s, "hit")?.reminders?.some((r) => r.startsWith("Inspired: re-roll natural 6s"))).toBe(true);
  });

  it("a Broken regiment gets nothing from Inspired", () => {
    const g = guardInContact();
    let s = g.s;
    const { guard, thralls } = g;
    s = play(s, { type: "action/take", unitId: guard, action: "inspire" }, "p1");
    s = applyEvent(s, { type: "unit/status", id: guard, key: "broken", value: true });
    s = attack(s, guard, "clash", thralls, "p1");
    // Clash 3, no +1.
    expect(target(s, "hit")).toBe(3);
  });

  it("Shield raises Defense, not Evasion", () => {
    const { s, guard, thralls } = guardInContact((st, _g, t) =>
      withChars(withAbilities(st, t, ["Shield"]), t, { D: "1", E: "3" }),
    );
    const after = attack(s, guard, "clash", thralls, "p1");
    // Defense 1 + 1 Shield − 1 Cleave = 1; Evasion 3 is higher and stays 3.
    expect(target(after, "defense")).toBe(3);
  });

  it("an engaged regiment takes only combat actions; Withdraw, Combat Rally and Combat Reform need an enemy in reach", () => {
    const { s, guard } = guardInContact();
    for (const a of ["march", "charge", "volley", "takeAim", "rally", "reform"])
      expect(option(s, guard, a)?.why).toBe("Engaged: combat actions only");
    expect(option(s, guard, "combatRally")?.ok).toBe(true);
    expect(option(s, guard, "combatReform")?.ok).toBe(true);
    // Withdraw: Light and Medium only (the Guard is Heavy).
    expect(option(s, guard, "withdraw")?.ok).toBe(false);

    // Shieldwall Spears (Medium) out of reach: no combat actions.
    let t = setup();
    const spears = unitNamed(t, "Shieldwall Spears").id;
    t = toActions(t, 0);
    t = play(t, { type: "action/take", unitId: spears, action: "activate" }, "p1");
    expect(option(t, spears, "march")?.ok).toBe(true);
    for (const a of ["withdraw", "combatRally", "combatReform", "inspire"])
      expect(option(t, spears, a)?.why).toBe("Not engaged");
  });

  it("a Broken regiment can't Charge; Rally clears Broken", () => {
    let t = setup();
    const spears = unitNamed(t, "Shieldwall Spears").id;
    t = applyEvent(t, { type: "unit/status", id: spears, key: "broken", value: true });
    t = toActions(t, 0);
    t = play(t, { type: "action/take", unitId: spears, action: "activate" }, "p1");
    expect(option(t, spears, "charge")?.ok).toBe(false);
    expect(option(t, spears, "rally")?.ok).toBe(true);
    t = play(t, { type: "action/take", unitId: spears, action: "rally" }, "p1");
    expect(t.units[spears]?.status?.broken).toBeFalsy();
  });

  it("a volley gets one more shot per front-rank stand within half range", () => {
    const shots = (gap: number) => {
      let s = setup();
      const bows = unitNamed(s, "Ironmarch Crossbows").id;
      const thralls = unitNamed(s, "Thrall Host").id;
      s = toCentre(s, bows, gap);
      s = toCentre(s, thralls, gap);
      s = toActions(s, 0);
      s = play(s, { type: "action/take", unitId: bows, action: "activate" }, "p1");
      s = attack(s, bows, "volley", thralls, "p1");
      return step(s, "attacks")!.out;
    };
    // Barrage 2, Range 24: 3 shots a stand at 6", 2 at 16".
    expect(shots(3) * 2).toBe(shots(8) * 3);
  });

  it("plays 10 rounds", () => {
    expect(conquest.turn.rounds).toBe(10);
  });

  it("Support(X): each stand behind the front rank adds X attacks", () => {
    let s = setup();
    const spears = unitNamed(s, "Shieldwall Spears").id;
    const thralls = unitNamed(s, "Thrall Host").id;
    s = toCentre(s, spears, 0.25);
    s = toCentre(s, thralls, 0.25);
    s = toActions(s, 0);
    s = play(s, { type: "action/take", unitId: spears, action: "activate" }, "p1");
    s = attack(s, spears, "clash", thralls, "p1");
    // Three front stands of A 4, three behind at Support 2.
    expect(step(s, "attacks")?.out).toBe(18);
  });

  it("Take Aim: this round's volley re-rolls its misses", () => {
    let s = setup();
    const bows = unitNamed(s, "Ironmarch Crossbows").id;
    const thralls = unitNamed(s, "Thrall Host").id;
    s = toCentre(s, bows, 4);
    s = toCentre(s, thralls, 4);
    s = toActions(s, 0);
    s = play(s, { type: "action/take", unitId: bows, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: bows, action: "takeAim" }, "p1");
    s = attack(s, bows, "volley", thralls, "p1");
    expect((step(s, "hit")?.plan as { reroll: string }).reroll).toBe("failed");
  });

  it("every Resolve test against an attack from the rear fails", () => {
    let s = setup();
    const colossus = unitNamed(s, "Ossuary Colossus").id;
    const spears = unitNamed(s, "Shieldwall Spears").id;
    s = toCentre(s, spears, 0.25);
    // Seat 0 faces -y: its rear is +y.
    const sm = s.units[spears]!.modelIds.map((id) => s.models[id]!);
    const y = Math.max(...sm.map((m) => m.position.y)) + 0.79 + 0.25 + 1.97;
    s = applyEvent(s, {
      type: "models/move",
      moves: [{ id: s.units[colossus]!.modelIds[0]!, to: { x: 0, y } }],
    });
    s = toActions(s, 1);
    s = play(s, { type: "action/take", unitId: colossus, action: "activate" }, "p2");
    let tested = false;
    for (let seed = 1; seed < 20 && !tested; seed++) {
      const t = attack(s, colossus, "clash", spears, "p2", seed);
      const r = step(t, "resolve")!;
      if (!r.in) continue;
      tested = true;
      expect(r.out).toBe(r.in * 2);
    }
    expect(tested).toBe(true);
  });

  it("removes casualties from the rear rank first", () => {
    const g = guardInContact();
    let s = g.s;
    const { guard, thralls } = g;
    const ids = s.units[thralls]!.modelIds;
    s = attack(s, guard, "clash", thralls, "p1", 7);
    s = play(s, { type: "procedure/clear" }, "p1");
    const lost = ids.filter((id) => s.models[id]?.destroyed).length;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(ids.length);
    // The last stands of the block go first; the command stand (the first) stays.
    expect(ids.slice(ids.length - lost).every((id) => s.models[id]?.destroyed)).toBe(true);
    expect(s.models[ids[0]!]?.destroyed).toBeFalsy();
  });

  it("takes a rank's casualties from its two ends in turn (#55)", () => {
    // 9 stands in 3 files: slots 6-8 are the rear rank, 3-5 the middle.
    const expected: Record<number, number[]> = { 1: [8], 2: [6, 8], 4: [5, 6, 7, 8], 5: [3, 5, 6, 7, 8] };
    let checked = 0;
    for (let seed = 1; seed <= 60 && checked < 2; seed++) {
      const g = guardInContact();
      let s = g.s;
      const { guard, thralls } = g;
      const ids = s.units[thralls]!.modelIds;
      s = attack(s, guard, "clash", thralls, "p1", seed);
      s = play(s, { type: "procedure/clear" }, "p1");
      const dead = ids.flatMap((id, i) => (s.models[id]?.destroyed ? [i] : []));
      const want = expected[dead.length];
      if (!want || (dead.length !== 2 && dead.length !== 5)) continue;
      expect(dead).toEqual(want);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("discards a drawn card whose regiment has fallen and draws the next", () => {
    let s = setup();
    const p1 = Object.values(s.units).filter((u) => u.owner === "p1");
    s = play(s, { type: "turn/next" }, "p1");
    const order = [p1[0]!.id, p1[1]!.id];
    const secrets = order.map((id, i) => ({ key: cardKey(1, i), commitment: commitmentOf(id, `s${i}`) }));
    s = play(s, { type: "secret/commit", player: "p1", secrets }, "p1");
    for (const id of p1[0]!.modelIds)
      s = applyEvent(s, { type: "model/wounds", id, woundsLost: 9, destroyed: true });
    s = play(
      s,
      { type: "secret/reveal", player: "p1", key: cardKey(1, 0), value: order[0], salt: "s0" },
      "p1",
    );
    expect(nextCard(s, stackOf(s, "p1"))?.key).toBe(cardKey(1, 1));
  });

  it("brings reserves in on the class's number for the round, the rest automatically from round 5", () => {
    const table = [1, 2, 3, 4, 5].map((r) =>
      (["Light", "Medium", "Heavy"] as const).map((c) => arrivalTarget(r, c)),
    );
    expect(table).toEqual([
      [4, null, null],
      [4, 2, null],
      ["auto", 4, 2],
      ["auto", "auto", 4],
      ["auto", "auto", "auto"],
    ]);
  });
});
