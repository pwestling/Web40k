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
import { unitActions } from "../../core/content/play";
import type { StepRecord } from "../../core/content";
import { spawnIntents } from "../wh40k/deploy";
import "../index";
import { nextCard, stackOf } from "./command";
import { conquestLayout } from "./layout";
import { reservesOf } from "./reinforce";
import { conquestSample } from "./sample";

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

/** Two seated players, Conquest chosen, an empty table and the sample armies deployed as blocks. */
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
  const half = 0.79; // a 40mm stand's half depth
  const xs = ms.map((m) => m.position.x);
  const dx = -(Math.min(...xs) + Math.max(...xs)) / 2;
  const ys = ms.map((m) => m.position.y);
  // Seat 0 faces -y (its front is its lowest y), seat 1 faces +y.
  const dy = ms[0]!.owner === "p1" ? gap + half - Math.min(...ys) : -gap - half - Math.max(...ys);
  return applyEvent(s, {
    type: "models/move",
    moves: ms.map((m) => ({ id: m.id, to: { x: m.position.x + dx, y: m.position.y + dy } })),
  });
}

const step = (s: GameState, id: string): StepRecord | undefined =>
  s.procedure?.run.records.find((r) => r.id === id);

describe("Conquest", () => {
  it("deploys regiments of stands as blocks on a 6' by 4' table", () => {
    const s = setup();
    expect(s.table).toEqual({ width: 72, depth: 48 });
    const spears = unitNamed(s, "Shieldwall Spears");
    expect(spears.formation).toMatchObject({ kind: "ranked", files: 3 });
    expect(spears.modelIds).toHaveLength(6);
    expect(s.models[spears.modelIds[0]!]?.profile?.chars.C).toBe("2");
  });

  it("activates regiments in command stack order, two actions each", () => {
    let s = setup();
    const p1 = Object.values(s.units).filter((u) => u.owner === "p1");
    s = play(s, { type: "turn/next" }, "p1");
    expect(currentSlot(s)?.id).toBe("command");
    const order = [p1[2]!.id, p1[0]!.id, p1[1]!.id, p1[3]!.id];
    s = play(s, { type: "script/start", procedure: "setStack", args: { player: "p1", order } }, "p1");
    expect(stackOf(s, s.modules!["conquest-hand"]!, "p1")).toEqual(order);
    s = play(s, { type: "turn/next" }, "p1");
    expect(currentSlot(s)?.kind).toBe("alternate");

    // Only the top card may go.
    const active = s.turn.activeSeat === 0 ? "p1" : "p2";
    if (active === "p2") {
      // p2 set no stack, so any of their regiments may go.
      const any = Object.values(s.units).find((u) => u.owner === "p2")!;
      expect(unitActions(s, any.id).find((o) => o.def.id === "activate")?.ok).toBe(true);
      s = play(s, { type: "action/take", unitId: any.id, action: "activate" }, "p2");
      s = play(s, { type: "turn/endActivation" }, "p2");
    }
    expect(unitActions(s, p1[0]!.id).find((o) => o.def.id === "activate")?.ok).toBe(false);
    expect(unitActions(s, order[0]!).find((o) => o.def.id === "activate")?.ok).toBe(true);
    s = play(s, { type: "action/take", unitId: order[0]!, action: "activate" }, "p1");
    expect(s.units[order[0]!]?.status).toMatchObject({ acting: true, activated: true, actionBudget: 2 });
    s = play(s, { type: "action/take", unitId: order[0]!, action: "march" }, "p1");
    s = play(s, { type: "action/take", unitId: order[0]!, action: "march" }, "p1");
    expect(unitActions(s, order[0]!).find((o) => o.def.id === "march")?.why).toBe("No actions left");
    s = play(s, { type: "turn/endActivation" }, "p1");
    expect(nextCard(s, order)?.id).toBe(order[1]);
  });

  it("clashes roll-under: hits on Clash, Defense less Cleave, Resolve with the size bonus", () => {
    let s = setup();
    const guard = unitNamed(s, "Warden Guard");
    const thralls = unitNamed(s, "Thrall Host");
    s = toCentre(s, guard.id, 0.25);
    s = toCentre(s, thralls.id, 0.25);
    s = play(s, { type: "turn/next" }, "p1");
    s = play(s, { type: "turn/next" }, "p1");
    if (s.turn.activeSeat !== 0) s = play(s, { type: "turn/pass" }, "p2");
    s = play(s, { type: "action/take", unitId: guard.id, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: guard.id, action: "inspire" }, "p1");
    const clash = unitActions(s, guard.id, { targetId: thralls.id }).find((o) => o.def.id === "clash");
    expect(clash?.ok).toBe(true);
    s = play(s, { type: "action/take", unitId: guard.id, action: "clash", targetId: thralls.id }, "p1");
    const r = rng(7);
    while (s.procedure && !s.procedure.run.done) s = play(s, { type: "procedure/roll" }, "p1", r);
    // Three stands of A 5 in front, three supporting at 1 each.
    expect(step(s, "attacks")?.out).toBe(18);
    const plan = (id: string) => step(s, id)?.plan as { target: number | null; compare: string };
    // Clash 3, +1 for Inspired.
    expect(plan("hit")).toMatchObject({ target: 4, compare: "atMost" });
    // Defense 1 less Cleave 1, Evasion 0: nothing saves.
    expect(plan("defense").target).toBe(0);
    // Resolve 1, +2 for 7-9 stands.
    expect(plan("resolve").target).toBe(3);
    const wounds = step(s, "resolve")!.out;
    expect(wounds).toBeGreaterThanOrEqual(step(s, "defense")!.out);
    s = play(s, { type: "procedure/clear" }, "p1");
    const lost = thralls.modelIds.filter((id) => s.models[id]?.destroyed).length;
    expect(lost).toBe(Math.min(9, Math.floor(wounds / 4)));
  });

  it("breaks a regiment that lost half its stands this round, and shatters it if it loses half again", () => {
    let s = setup();
    s = play(s, { type: "turn/next" }, "p1");
    const hounds = unitNamed(s, "Grave Hounds");
    const kill = (ids: string[]) => {
      for (const id of ids) s = applyEvent(s, { type: "model/wounds", id, woundsLost: 5, destroyed: true });
    };
    const after = (before: number) =>
      (s = play(
        s,
        { type: "script/start", procedure: "aftermath", args: { unit: hounds.id, before } },
        "p2",
      ));
    kill(hounds.modelIds.slice(0, 1));
    after(4);
    expect(s.units[hounds.id]?.status?.broken).toBeFalsy();
    kill(hounds.modelIds.slice(1, 2));
    after(3);
    // 2 of the 4 it began the round with are gone.
    expect(s.units[hounds.id]?.status?.broken).toBe(true);
    kill(hounds.modelIds.slice(2, 3));
    after(2);
    expect(hounds.modelIds.every((id) => s.models[id]?.destroyed)).toBe(true);
  });

  it("runs the aftermath when a clash that caused casualties is closed", () => {
    const clashWith = (seed: number) => {
      let s = setup();
      const colossus = unitNamed(s, "Ossuary Colossus");
      const spears = unitNamed(s, "Ironmarch Crossbows");
      s = toCentre(s, spears.id, 0.25);
      s = toCentre(s, colossus.id, 0.25);
      s = play(s, { type: "turn/next" }, "p1");
      s = play(s, { type: "turn/next" }, "p1");
      if (s.turn.activeSeat !== 1) s = play(s, { type: "turn/pass" }, "p1");
      s = play(s, { type: "action/take", unitId: colossus.id, action: "activate" }, "p2");
      s = play(s, { type: "action/take", unitId: colossus.id, action: "clash", targetId: spears.id }, "p2");
      const r = rng(seed);
      while (s.procedure && !s.procedure.run.done) s = play(s, { type: "procedure/roll" }, "p2", r);
      s = play(s, { type: "procedure/clear" }, "p2");
      const left = spears.modelIds.filter((id) => !s.models[id]?.destroyed).length;
      return { s, spears, left };
    };
    // Some dice that cost the Crossbows a stand, and some that cost them half (3 stands to 1).
    let bruised = false;
    let broken = false;
    for (let seed = 1; seed < 40 && !(bruised && broken); seed++) {
      const { s, spears, left } = clashWith(seed);
      expect(s.script ?? null).toBeNull();
      if (left === 3 || left === 0) continue;
      expect(s.modules?.["conquest-hand"]?.[`round:${spears.id}`]).toEqual({ round: 1, start: 3 });
      expect(!!s.units[spears.id]?.status?.broken).toBe(left <= 1);
      if (left <= 1) broken = true;
      else bruised = true;
    }
    expect(bruised && broken).toBe(true);
  });

  it("charges Inspired, then Impact attacks without using an action", () => {
    let s = setup();
    const colossus = unitNamed(s, "Ossuary Colossus");
    const spears = unitNamed(s, "Shieldwall Spears");
    s = toCentre(s, spears.id, 0.25);
    s = toCentre(s, colossus.id, 0.25);
    s = play(s, { type: "turn/next" }, "p1");
    s = play(s, { type: "turn/next" }, "p1");
    if (s.turn.activeSeat !== 1) s = play(s, { type: "turn/pass" }, "p1");
    s = play(s, { type: "action/take", unitId: colossus.id, action: "activate" }, "p2");
    expect(unitActions(s, colossus.id, { targetId: spears.id }).find((o) => o.def.id === "impact")?.ok).toBe(
      false,
    );
    s = play(s, { type: "action/take", unitId: colossus.id, action: "charge" }, "p2");
    expect(s.units[colossus.id]?.status).toMatchObject({ inspired: true, actionsTaken: 1 });
    s = play(s, { type: "action/take", unitId: colossus.id, action: "impact", targetId: spears.id }, "p2");
    const r = rng(5);
    while (s.procedure && !s.procedure.run.done) s = play(s, { type: "procedure/roll" }, "p2", r);
    // Impact 4 from its one stand.
    expect(step(s, "attacks")?.out).toBe(4);
    s = play(s, { type: "procedure/clear" }, "p2");
    expect(s.units[colossus.id]?.status?.actionsTaken).toBe(1);
    expect(unitActions(s, colossus.id, { targetId: spears.id }).find((o) => o.def.id === "clash")?.ok).toBe(
      true,
    );
  });

  it("re-rolls passed Resolve tests against a flank attack", () => {
    let base = setup();
    const colossus = unitNamed(base, "Ossuary Colossus");
    const spears = unitNamed(base, "Shieldwall Spears");
    base = toCentre(base, spears.id, 0.25);
    // The Colossus (a 100mm stand) against the Spears' side.
    const sm = spears.modelIds.map((id) => base.models[id]!);
    const x = Math.max(...sm.map((m) => m.position.x)) + 0.79 + 0.25 + 1.97;
    const y = sm.reduce((t, m) => t + m.position.y, 0) / sm.length;
    base = applyEvent(base, { type: "models/move", moves: [{ id: colossus.modelIds[0]!, to: { x, y } }] });
    base = play(base, { type: "turn/next" }, "p1");
    base = play(base, { type: "turn/next" }, "p1");
    if (base.turn.activeSeat !== 1) base = play(base, { type: "turn/pass" }, "p1");
    base = play(base, { type: "action/take", unitId: colossus.id, action: "activate" }, "p2");
    let tested = false;
    for (let seed = 1; seed < 20 && !tested; seed++) {
      let s = play(
        base,
        { type: "action/take", unitId: colossus.id, action: "clash", targetId: spears.id },
        "p2",
      );
      const r = rng(seed);
      while (s.procedure && !s.procedure.run.done) s = play(s, { type: "procedure/roll" }, "p2", r);
      expect(step(s, "resolve")?.bypassed).toBe(step(s, "defense")?.out);
      const flank = step(s, "resolve_flanked");
      if (!flank?.in) continue;
      tested = true;
      expect(flank.plan).toMatchObject({ dicePerInput: 2, keep: "highest", compare: "atMost" });
      // Each test passes only when both its dice pass.
      const need = (flank.plan as { target: number }).target;
      expect(need).toBe(3);
      for (const d of flank.dice ?? []) {
        const worst = Math.max(...(d.dice ?? [d.value]));
        expect(d.success).toBe(worst === 1 || (worst <= need && worst !== 6));
      }
    }
    expect(tested).toBe(true);
  });

  it("a character joins a regiment's front rank", () => {
    let s = setup();
    const marshal = unitNamed(s, "Marshal of the March");
    const spears = unitNamed(s, "Shieldwall Spears");
    const front = s.models[spears.modelIds[0]!]!;
    // Just in front of the Spears (seat 0 faces -y).
    s = applyEvent(s, {
      type: "models/move",
      moves: [{ id: marshal.modelIds[0]!, to: { x: front.position.x, y: front.position.y - 2.5 } }],
    });
    s = play(
      s,
      { type: "script/start", procedure: "joinRegiment", args: { unit: marshal.id, target: spears.id } },
      "p1",
    );
    expect(s.units[marshal.id]).toBeUndefined();
    const joined = s.units[spears.id]!;
    expect(joined.name).toBe("Shieldwall Spears + Marshal of the March");
    expect(joined.modelIds).toHaveLength(7);
    expect(joined.modelIds[1]).toBe(marshal.modelIds[0]);
    // Front rank: the first three slots stand level with each other, the character among them.
    const ys = joined.modelIds.slice(0, 3).map((id) => s.models[id]!.position.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
  });

  it("brings regiments in from reserve by class and round; an arrival marches first and can't charge", () => {
    let s = setup();
    for (const u of Object.values(s.units).filter((u) => u.owner === "p1"))
      s = play(s, { type: "unit/reserve", id: u.id, reserve: true }, "p1");
    expect(reservesOf(s, "p1")).toHaveLength(5);
    s = play(s, { type: "turn/next" }, "p1");
    expect([s.turn.round, currentSlot(s)?.id]).toEqual([1, "command"]);
    const reinforce = (st: GameState) =>
      play(st, { type: "script/start", procedure: "reinforcements", args: { player: "p1" } }, "p1");

    // Round 1: only Light may come, and the one Light regiment needs no roll.
    s = reinforce(s);
    const bows = unitNamed(s, "Ironmarch Crossbows");
    expect(bows.status).toMatchObject({ arrived: true, reinforced: true });
    expect(
      reservesOf(s, "p1")
        .map((u) => u.name)
        .sort(),
    ).toEqual(["Iron Riders", "Marshal of the March", "Shieldwall Spears", "Warden Guard"].sort());
    s = play(s, { type: "turn/next" }, "p1");
    if (s.turn.activeSeat === 1) {
      s = play(s, { type: "turn/pass" }, "p2");
    }
    // A regiment in reserve has no card to play.
    expect(unitActions(s, unitNamed(s, "Warden Guard").id).find((o) => o.def.id === "activate")?.ok).toBe(
      false,
    );

    s = play(s, { type: "action/take", unitId: bows.id, action: "activate" }, "p1");
    const ok = (action: string) => unitActions(s, bows.id).find((o) => o.def.id === action)?.ok;
    expect([ok("takeAim"), ok("charge"), ok("march")]).toEqual([false, false, true]);
    s = play(s, { type: "action/take", unitId: bows.id, action: "march" }, "p1");
    expect([ok("takeAim"), ok("charge")]).toEqual([true, false]);

    // Round 3: Light and Medium are in; of the two Heavy regiments one comes without a roll.
    const toRound = (st: GameState, round: number) => {
      while (st.turn.round < round) st = play(st, { type: "turn/next" }, "p1");
      return st;
    };
    s = toRound(s, 3);
    expect(s.units[bows.id]!.status?.reinforced).toBeFalsy();
    s = reinforce(s);
    const heavy = ["Warden Guard", "Iron Riders"].filter((n) => !unitNamed(s, n).status?.reserves);
    expect(heavy.length).toBeGreaterThanOrEqual(1);
    s = toRound(s, 5);
    s = reinforce(s);
    expect(reservesOf(s, "p1")).toHaveLength(0);
  });
});
