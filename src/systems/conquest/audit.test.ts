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
import { gameView, hookIntents } from "../../core/script";
import { marchWarnings } from "./march";
import type { StepRecord } from "../../core/content";
import { spawnIntents } from "../wh40k/deploy";
import "../index";
import { commitmentOf } from "../../core/secrets";
import { cardKey, nextCard, stackOf } from "./command";
import { conquestLayout } from "./layout";
import { arrivalTarget } from "./reinforce";
import { conquestSample } from "./sample";
import { conquest } from "./system";
import { parseConquestList } from "./roster";
import { seizers, seizeTheField, standOf, standWarnings } from "./stands";

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
function hosted(
  state: GameState,
  intent: Intent,
  from: PlayerId,
  r = rng(1),
  notes: string[] = [],
): GameState {
  const event = resolveIntent(intent, from, r, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  let s = applyEvent({ ...state, seq: state.seq + 1 }, event);
  for (const hook of hookIntents(state, s, event)) {
    const e = resolveIntent(hook, from, r, s);
    if (!e) throw new Error(`Rejected: ${JSON.stringify(hook)}`);
    if (e.type === "script/step") for (const x of e.events) if (x.type === "log/note") notes.push(x.text);
    s = applyEvent({ ...s, seq: s.seq + 1 }, e);
  }
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

  it("a charge with no enemy ahead and in sight can be taken anyway, and the log says so (PX #57)", () => {
    const { s, guard } = guardFacing(1.5);
    const turned = { ...s, models: { ...s.models } };
    for (const id of s.units[guard]!.modelIds)
      turned.models[id] = { ...s.models[id]!, facing: s.models[id]!.facing + Math.PI };
    expect(option(turned, guard, "charge")?.overridable).toBe(true);
    expect(
      resolveIntent({ type: "action/take", unitId: guard, action: "charge" }, "p1", rng(1), turned),
    ).toBeNull();
    const event = resolveIntent(
      { type: "action/take", unitId: guard, action: "charge", force: true },
      "p1",
      rng(1),
      turned,
    );
    expect(event).toMatchObject({ type: "action/take", forced: "No enemy in the front arc and in sight" });
    expect(
      hosted(turned, { type: "action/take", unitId: guard, action: "charge", force: true }, "p1").units[guard]
        ?.status,
    ).toMatchObject({ charged: true });
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

  it("a charge move into contact lands: Inspired, and the landing is noted; a roll that reaches reminds how to move", () => {
    const g = guardFacing(1.5);
    const { guard, thralls } = g;
    let s = g.s;
    s = hosted(s, { type: "action/take", unitId: guard, action: "charge" }, "p1");
    // Clear Inspired, to see the landing give it.
    s = applyEvent(s, { type: "unit/status", id: guard, key: "inspired", value: null });
    const notes: string[] = [];
    s = hosted(
      s,
      { type: "dice/roll", count: 1, sides: 6, label: "charge roll", unitId: guard },
      "p1",
      rng(1),
      notes,
    );
    expect(option(s, guard, "march")?.why).not.toBe("No actions left");
    // The roll reaches: a reminder of how the charge move goes.
    expect(notes.join(" ")).toMatch(/charges straight ahead, with one free wheel/);
    const door = closeDoor(s, s.units[guard]!, s.units[thralls]!)!;
    s = hosted(s, { ...door.move, how: "charge" }, "p1");
    expect(s.units[guard]?.status?.inspired).toBe(true);
    expect(s.modules?.["conquest-hand"]?.[`landed:${guard}`]).toBe(1);
  });

  it('warns when a march goes sideways or back past half rate, or ends within 1" of an enemy', () => {
    const g = guardFacing(6);
    const { guard } = g;
    let s = play(g.s, { type: "action/take", unitId: guard, action: "march" }, "p1");
    // The Guard (seat 0) faces -y; March 5.
    const shift = (st: GameState, dx: number, dy: number) =>
      applyEvent(st, {
        type: "models/move",
        moves: st.units[guard]!.modelIds.map((id) => {
          const p = st.models[id]!.position;
          return { id, to: { x: p.x + dx, y: p.y + dy } };
        }),
      });
    const ids = (st: GameState) => marchWarnings(gameView(st, "conquest-hand")).map((w) => w.id);
    expect(ids(shift(s, 0, -4))).toEqual([]);
    // 2" sideways is fine (4 of 5); 3" isn't (6 of 5); 2" back plus 2" forward isn't either.
    expect(ids(shift(s, 2, 0))).toEqual([]);
    expect(ids(shift(s, 3, 0))).toEqual(["marchRate"]);
    expect(ids(shift(s, 2, -2))).toEqual(["marchRate"]);
    expect(ids(shift(s, 0, 3))).toEqual(["marchRate"]);
    // 11.5" forward ends half an inch from the Thrall Host (over March too, which the move check says).
    s = shift(s, 0, -11.5);
    expect(ids(s)).toEqual(["marchNearEnemy"]);
  });

  it("Inspired adds 1 to Clash only while Clash stays under 5; from Clash 4 it re-rolls natural 6s", () => {
    const g = guardInContact((st, g) => withChars(st, g, { C: "4" }));
    let s = g.s;
    const { guard, thralls } = g;
    s = play(s, { type: "action/take", unitId: guard, action: "inspire" }, "p1");
    s = attack(s, guard, "clash", thralls, "p1");
    expect(target(s, "hit")).toBe(4);
    const hit = step(s, "hit")!;
    expect((hit.plan as { rerollValues?: number[] }).rerollValues).toEqual([6]);
    expect(hit.fired).toContain("Inspired: re-roll natural 6s to hit (Clash already 4+)");
    // Only natural 6s were re-rolled.
    for (const d of hit.dice ?? []) if (d.rerolledFrom !== undefined) expect(d.rerolledFrom).toBe(6);
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

  it("a volley counts only the front-rank stands with a clear shot", () => {
    const shots = (wall: boolean) => {
      let s = setup();
      const bows = unitNamed(s, "Ironmarch Crossbows").id;
      const thralls = unitNamed(s, "Thrall Host").id;
      s = toCentre(s, bows, 4);
      s = toCentre(s, thralls, 4);
      if (wall) {
        // A tall wall right in front of the Crossbows' leftmost stand.
        const stand = s.models[s.units[bows]!.modelIds[0]!]!;
        s = {
          ...s,
          terrain: [
            {
              id: "wall",
              name: "Wall",
              category: "obscuring",
              position: { x: stand.position.x, y: stand.position.y - 0.95 },
              width: 1.7,
              depth: 0.3,
              facing: 0,
              solids: [{ kind: "wall", x: 0, y: 0, z: 0, w: 1.7, d: 0.3, h: 6 }],
            },
          ],
        };
      }
      s = toActions(s, 0);
      s = play(s, { type: "action/take", unitId: bows, action: "activate" }, "p1");
      s = attack(s, bows, "volley", thralls, "p1");
      return step(s, "attacks")!.out;
    };
    // Barrage 2 + 1 within half range, from three front stands, one of them walled in.
    expect(shots(false)).toBe(9);
    expect(shots(true)).toBe(6);
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
    // The last stands of the block go first; the command stand stays.
    expect(ids.slice(ids.length - lost).every((id) => s.models[id]?.destroyed)).toBe(true);
    expect(s.models[ids[1]!]?.destroyed).toBeFalsy();
  });

  it("removes the named command stand last, after any other stand", () => {
    let seen = false;
    for (let seed = 1; seed <= 80 && !seen; seed++) {
      const g = guardInContact((st, guard, thralls) => {
        st = withChars(st, guard, { A: "6", C: "4" });
        st = withChars(st, thralls, { D: "0", E: "0", R: "0" });
        // A stand unlike the rest (a character's, say) and the command stand (the centre of the front rank), named so.
        const ids = st.units[thralls]!.modelIds;
        const m = st.models[ids[0]!]!;
        return {
          ...st,
          models: { ...st.models, [m.id]: { ...m, profile: { ...m.profile!, name: "Bone banner" } } },
        };
      });
      let s = g.s;
      const ids = s.units[g.thralls]!.modelIds;
      expect(s.models[ids[1]!]?.profile?.name).toMatch(/command/);
      s = attack(s, g.guard, "clash", g.thralls, "p1", seed);
      s = play(s, { type: "procedure/clear" }, "p1");
      const dead = ids.filter((id) => s.models[id]?.destroyed).length;
      if (dead !== ids.length - 1) continue;
      // Everything else is gone, the odd stand too: only the command stand stands.
      expect(s.models[ids[0]!]?.destroyed).toBe(true);
      expect(s.models[ids[1]!]?.destroyed).toBeFalsy();
      seen = true;
    }
    expect(seen).toBe(true);
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

describe("Conquest rules audit: the last missing rows (#58)", () => {
  const ids = (s: GameState) => standWarnings(gameView(s, "conquest-hand")).map((w) => w.id);
  const withKeywords = (s: GameState, id: string, keywords: string[]): GameState => ({
    ...s,
    units: { ...s.units, [id]: { ...s.units[id]!, sheet: { ...s.units[id]!.sheet!, keywords } } },
  });

  it("gives each stand its models and Size by type: infantry 4 and 1, cavalry 1 and 2, monsters 1 and 3", () => {
    expect(standOf("Infantry")).toEqual({ models: 4, size: 1 });
    expect(standOf("Cavalry")).toEqual({ models: 1, size: 2 });
    expect(standOf("Brute")).toEqual({ models: 1, size: 2 });
    expect(standOf("Monster")).toEqual({ models: 1, size: 3 });
    const s = setup();
    const size = (name: string) => s.models[unitNamed(s, name).modelIds[0]!]!.profile?.chars.Size;
    expect([size("Shieldwall Spears"), size("Iron Riders"), size("Ossuary Colossus")]).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("flags a command stand out of the centre of the front rank", () => {
    let s = setup();
    const spears = unitNamed(s, "Shieldwall Spears");
    const order = spears.modelIds;
    expect(s.models[order[1]!]!.profile?.name).toMatch(/command/);
    expect(ids(s)).not.toContain("commandStand");
    // The command stand swapped into the second rank.
    const swapped = [order[0]!, order[3]!, order[2]!, order[1]!, ...order.slice(4)];
    s = { ...s, units: { ...s.units, [spears.id]: { ...spears, modelIds: swapped } } };
    expect(ids(s)).toContain("commandStand");
  });

  it("flags an army without exactly one Warlord, or characters leading fewer than 1 or more than 4 regiments", () => {
    let s = setup();
    expect(ids(s)).not.toContain("warlord");
    expect(ids(s)).not.toContain("regimentsPerCharacter");
    const marshal = unitNamed(s, "Marshal of the March").id;
    expect(ids(withKeywords(s, marshal, ["Character", "Medium"]))).toContain("warlord");
    // Four characters and one regiment.
    for (const name of ["Shieldwall Spears", "Ironmarch Crossbows", "Warden Guard"])
      s = withKeywords(s, unitNamed(s, name).id, ["Character", "Medium"]);
    expect(ids(s)).toContain("regimentsPerCharacter");
  });

  it("seizes an objective zone by seize value (Light 0, Medium and Heavy 1, Monster 3), then stands", () => {
    let s = setup();
    s = { ...s, objectives: [{ id: "o", position: { x: 0, y: 0 } }] };
    const move = (t: GameState, name: string, x: number, y: number) => {
      const u = unitNamed(t, name);
      return applyEvent(t, {
        type: "models/move",
        moves: u.modelIds.map((id, i) => ({
          id,
          to: { x: x + (i % 3) * 1.6, y: y + Math.floor(i / 3) * 1.6 },
        })),
      });
    };
    const reserve = (t: GameState) => {
      for (const u of Object.values(t.units))
        t = { ...t, units: { ...t.units, [u.id]: { ...u, status: { ...u.status, reserves: true } } } };
      return t;
    };
    const field = (t: GameState, ...names: string[]) => {
      for (const n of names) {
        const u = unitNamed(t, n);
        t = { ...t, units: { ...t.units, [u.id]: { ...u, status: { ...u.status, reserves: false } } } };
      }
      return t;
    };
    s = reserve(s);
    // Light stands alone seize nothing.
    let t = field(move(s, "Thrall Host", -2, 1), "Thrall Host");
    expect(seizers(t, 6).o).toBeNull();
    // Medium infantry seize it from them.
    t = field(move(t, "Shieldwall Spears", -2, -4), "Shieldwall Spears");
    expect(seizers(t, 6).o).toBe(0);
    // The monster (3) against three Medium stands (3), the spears having more stands.
    t = field(move(t, "Ossuary Colossus", 3, 2), "Ossuary Colossus");
    expect(seizers(t, 6).o).toBe(0);
    // Out of the zone (6"), a stand doesn't count.
    t = move(t, "Shieldwall Spears", -2, -12);
    expect(seizers(t, 6).o).toBe(1);
    expect(seizeTheField().scoring[0]!.suggest(t, 1)).toMatchObject({ vp: 1 });
  });

  it("reads a list shared as text: characters, regiments with their stands, points and options; profiles to fill in", () => {
    const r = parseConquestList(
      [
        "Border Host",
        "== Captain Vey [100]: Warhorn",
        "* Pikemen (4) [150]: Officer, Standard",
        "* Archers (3) [120]",
      ].join("\n"),
    );
    expect(r.name).toBe("Border Host");
    expect(r.points).toBe(370);
    expect(r.units.map((u) => [u.name, u.models.length, u.sheet.points])).toEqual([
      ["Captain Vey", 1, 100],
      ["Pikemen", 4, 150],
      ["Archers", 3, 120],
    ]);
    expect(r.units[0]!.sheet.keywords).toEqual(["Character"]);
    expect(r.units[1]!.sheet.abilities.map((a) => a.name)).toEqual(["Officer", "Standard"]);
    expect(r.units[1]!.missing).toEqual(["M", "V", "C", "A", "W", "R", "D", "Type", "Class"]);
    // The command stand in the centre of a three-wide front rank.
    expect(r.units[1]!.models[1]!.profile.name).toBe("Pikemen command");
    expect(() => parseConquestList("just some notes")).toThrow(/no Conquest list lines/);
  });
});
