import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  currentSlot,
  resolveIntent,
  type GameState,
  type Intent,
  type PlayerId,
} from "../../core";
import { procedureEnv, procedureRoles, unitActions } from "../../core/content/play";
import { abilityReminders, attackReminders } from "../../core/content/player";
import { previewRun, type TestPlan } from "../../core/content/runner";
import { fsd } from "../../core/content/examples/fsd";
import { gameView } from "../../core/script";
import { modelSight } from "../../core/los";
import { baseSizeInches } from "../../core/geometry";
import { inFootprint } from "../../core/terrain";
import { spawnIntents } from "../wh40k/deploy";
import { makePiece } from "../wh40k/layout";
import { fsdChecks } from "./checks";
import { fsdLayout } from "./layout";
import { fsdBehemothSample, fsdSample } from "./sample";

/**
 * Rules audit (#55): one test per automated core rule not already covered in
 * fsd.test.ts. See docs/rules-coverage/fsd.md for the matrix.
 */

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
  const next = applyEvent({ ...state, seq: state.seq + 1 }, event);
  // These tests have p1 go first: whoever wins the Initiative hands it to them.
  if (handOver && next.rolledOff?.chooses && next.turn.firstSeat !== 0)
    return applyEvent({ ...next, seq: next.seq + 1 }, { type: "turn/first", seat: 0 });
  return next;
}
let handOver = true;

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
  // Park everything far apart, off to the sides, so only the units a test places matter.
  let x = -16;
  for (const u of Object.values(s.units)) {
    s = place(s, u.id, x, u.owner === "p1" ? 11 : -11);
    x += 6;
  }
  return s;
}

const unitNamed = (s: GameState, name: string, owner: string) =>
  Object.values(s.units).find((u) => u.name === name && u.owner === owner)!;

function toActivations(s: GameState): GameState {
  for (let i = 0; i < 4 && currentSlot(s)?.kind !== "alternate"; i++)
    s = play(s, { type: "turn/next" }, "p1");
  return s;
}

/** Put a unit's bases in a row from (x, y), 1.5" apart; `facing` in radians (0 looks along +y). */
function place(s: GameState, unitId: string, x: number, y: number, facing?: number): GameState {
  const unit = s.units[unitId]!;
  let next = s;
  unit.modelIds.forEach((id, i) => {
    const to = { x: x + i * 1.5, y };
    next = applyEvent(next, { type: "model/move", id, to, facing: facing ?? s.models[id]!.facing });
  });
  return next;
}

/** Change a weapon's characteristics or keywords. */
function editWeapon(
  s: GameState,
  unitId: string,
  weapon: string,
  patch: { chars?: Record<string, string>; keywords?: string[] },
): GameState {
  const u = s.units[unitId]!;
  const w = u.sheet!.weapons[weapon]!;
  const next = { ...w, chars: { ...w.chars, ...patch.chars }, keywords: patch.keywords ?? w.keywords };
  return {
    ...s,
    units: {
      ...s.units,
      [unitId]: { ...u, sheet: { ...u.sheet!, weapons: { ...u.sheet!.weapons, [weapon]: next } } },
    },
  };
}

function editUnit(
  s: GameState,
  unitId: string,
  patch: { keywords?: string[]; abilities?: string[] },
): GameState {
  const u = s.units[unitId]!;
  const sheet = {
    ...u.sheet!,
    ...(patch.keywords ? { keywords: patch.keywords } : {}),
    ...(patch.abilities ? { abilities: patch.abilities.map((name) => ({ name, text: "" })) } : {}),
  };
  return { ...s, units: { ...s.units, [unitId]: { ...u, sheet } } };
}

const status = (s: GameState, unitId: string, key: string, value: boolean) =>
  applyEvent(s, { type: "unit/status", id: unitId, key, value });

/** The attack's planned steps, without rolling. */
function preview(s: GameState, attacker: string, weapon: string, target: string) {
  const roles = procedureRoles(fsd, "attack", attacker, { weapon, targetId: target });
  return previewRun(procedureEnv(s), "attack", roles);
}
const hitTarget = (s: GameState, a: string, w: string, t: string) =>
  (preview(s, a, w, t).plans.hit as TestPlan).target;
const savePlan = (s: GameState, a: string, w: string, t: string) =>
  preview(s, a, w, t).plans.save as TestPlan;
const attackDice = (s: GameState, a: string, w: string, t: string) =>
  (preview(s, a, w, t).plans.attacks as { count: string }).count;

const option = (s: GameState, unitId: string, action: string, req = {}) =>
  unitActions(s, unitId, req).find((o) => o.def.id === action)!;

describe("FSD rules audit: combat", () => {
  it("hits on Defense, +1 beyond range, not past double range or inside minimum range", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const squad = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, tank, 0, 6);
    // Coax MG: range 3 DU (9"). 2 DU away: Defense 4.
    s = place(s, squad, 0, 0);
    expect(hitTarget(s, tank, "coax-mg", squad)).toBe(4);
    // 4 DU away: long range, +1.
    s = place(s, squad, 0, -6);
    expect(hitTarget(s, tank, "coax-mg", squad)).toBe(5);
    // 7 DU away: past double range.
    s = place(s, squad, 0, -15);
    expect(hitTarget(s, tank, "coax-mg", squad)).toBeNull();
    // A minimum range of 3 DU, target at 2 DU: can't be targeted.
    s = place(s, squad, 0, 0);
    s = editWeapon(s, tank, "coax-mg", { chars: { Min: "3" } });
    expect(hitTarget(s, tank, "coax-mg", squad)).toBeNull();
  });

  it("cover adds +2 for infantry and +1 for vehicles, ignored in close combat and by IC", () => {
    let s = setup();
    s = { ...s, terrain: [makePiece("Woods", "w", { x: 0, y: 0 }, 0, "obscuring")] };
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const squad = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, tank, 0, 9);
    s = place(s, squad, 0, -6);
    // Light cannon range 6 DU: the gang is in range behind the woods.
    expect(hitTarget(s, tank, "light-cannon", squad)).toBe(4 + 2);
    // The gang shooting the tank through the woods: Defense 3 + 1 (and long range +1).
    expect(hitTarget(s, squad, "carbines", tank)).toBe(3 + 1 + 1);
    // Ignore Cover.
    const ic = editWeapon(s, tank, "light-cannon", { keywords: ["IC"] });
    expect(hitTarget(ic, tank, "light-cannon", squad)).toBe(4);
    // Within 1 DU there's no cover.
    let cc = { ...s, terrain: [makePiece("Woods", "w", { x: 0, y: 1.5 }, 0, "obscuring")] };
    cc = place(cc, squad, 0, 0);
    cc = place(cc, tank, 0, 2.9);
    expect(hitTarget(cc, tank, "coax-mg", squad)).toBe(4);
  });

  it("saves keep the highest die, AP removes dice to one, close combat is AP1 not stacking", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const crawler = unitNamed(s, "Scrap Crawler", "p2").id;
    const walker = unitNamed(s, "Junk Walker", "p2").id;
    // Facing the shooter, so no rear penalty.
    s = place(s, tank, 0, 6, Math.PI);
    s = place(s, crawler, 0, -3, 0);
    // Coax MG (AP0) at range: d8(3), keep highest.
    let save = savePlan(s, tank, "coax-mg", crawler);
    expect(save).toMatchObject({ sides: 8, dicePerInput: 3, keep: "highest", passOn: "failures" });
    // Light cannon AP1: two dice.
    expect(savePlan(s, tank, "light-cannon", crawler).dicePerInput).toBe(2);
    // AP 5 still leaves one die.
    const ap5 = editWeapon(s, tank, "light-cannon", { chars: { AP: "5" } });
    expect(savePlan(ap5, tank, "light-cannon", crawler).dicePerInput).toBe(1);
    // Close combat: the coax MG gains AP1; the AP2 claw gains nothing more.
    s = place(s, crawler, 0, 3.5, 0);
    expect(savePlan(s, tank, "coax-mg", crawler).dicePerInput).toBe(2);
    s = place(s, walker, 0, 3.5);
    s = place(s, crawler, 10, -10);
    save = savePlan(s, walker, "power-claw", tank);
    expect(save).toMatchObject({ sides: 10, dicePerInput: 1 });
  });

  it("a vehicle saves against the rear with a die one size smaller, never below d6", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const crawler = unitNamed(s, "Scrap Crawler", "p2").id;
    // The crawler faces +y; the tank is behind it.
    s = place(s, crawler, 0, 0, 0);
    s = place(s, tank, 0, -6, 0);
    expect(savePlan(s, tank, "coax-mg", crawler).sides).toBe(6);
    // A d6 save stays d6 from the rear (the walker is a mech: no facing rule).
    s = place(s, crawler, 0, 6, Math.PI);
    expect(savePlan(s, tank, "coax-mg", crawler).sides).toBe(8);
  });

  it("ARM damage drops the save die one size (fix: was two), MOV damage leaves 1 DU of movement", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const crawler = unitNamed(s, "Scrap Crawler", "p2").id;
    s = place(s, tank, 0, 6, Math.PI);
    s = place(s, crawler, 0, -3, Math.PI);
    expect(savePlan(s, crawler, "heavy-stubber", tank).sides).toBe(10);
    s = status(s, tank, "damageARM", true);
    expect(savePlan(s, crawler, "heavy-stubber", tank).sides).toBe(8);
    // And one more from the rear.
    expect(savePlan(place(s, crawler, 0, 10.5), crawler, "heavy-stubber", tank).sides).toBe(6);
    s = status(s, tank, "damageMOV", true);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    expect(s.units[tank]?.status?.allowance).toBe(3);
  });

  it("Per Base attacks come only from bases in range and sight of the target (fix)", () => {
    let s = setup();
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    s = place(s, gang, 0, 0);
    // Carbines: range 3 DU, so up to 6 DU (18"). All three bases reach.
    s = place(s, tank, 0, 15);
    expect(attackDice(s, gang, "carbines", tank)).toBe("3");
    // Move one base far away: two attack.
    const far = s.units[gang]!.modelIds[2]!;
    s = applyEvent(s, { type: "model/move", id: far, to: { x: 0, y: -10 } });
    expect(attackDice(s, gang, "carbines", tank)).toBe("2");
  });

  it("a weapon with a minimum range of 1 DU or more can't attack in close combat (fix)", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 3);
    s = editWeapon(s, tank, "light-cannon", { chars: { Min: "1" } });
    // Exactly 1 DU: close combat, so the 1 DU minimum range rules it out.
    expect(hitTarget(s, tank, "light-cannon", gang)).toBeNull();
    s = place(s, tank, 0, 4);
    expect(hitTarget(s, tank, "light-cannon", gang)).toBe(4);
  });

  it("weapon keywords: Short Range, Contact, Indirect Fire", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 12);
    // Short Range: no long-range shots.
    const short = editWeapon(s, tank, "coax-mg", { keywords: ["Short Range"] });
    expect(hitTarget(s, tank, "coax-mg", gang)).toBe(5);
    expect(hitTarget(short, tank, "coax-mg", gang)).toBeNull();
    // Contact: only in base contact, and then it's close combat (AP1).
    let contact = editWeapon(s, tank, "coax-mg", { keywords: ["Contact"] });
    expect(hitTarget(contact, tank, "coax-mg", gang)).toBeNull();
    // The tank's hull is 80 mm deep; the gang's bases are 30 mm round: centres ~2.16" apart touch.
    contact = place(contact, tank, 0, (80 / 2 + 30 / 2) / 25.4);
    expect(hitTarget(contact, tank, "coax-mg", gang)).toBe(4);
    expect(savePlan(contact, tank, "coax-mg", gang).dicePerInput).toBe(1);
    const flying = editUnit(contact, gang, { keywords: ["INFANTRY", "FLYING"] });
    expect(hitTarget(flying, tank, "coax-mg", gang)).toBeNull();
    // Indirect Fire: +1 Defense against a target out of sight.
    let indirect = editWeapon(s, tank, "light-cannon", { keywords: ["Indirect Fire"] });
    indirect = place(indirect, tank, 0, 9);
    expect(hitTarget(indirect, tank, "light-cannon", gang)).toBe(4);
    indirect = { ...indirect, terrain: [makePiece("Ruin", "r", { x: 0, y: 4.5 }, 0, "blocking")] };
    expect(hitTarget(indirect, tank, "light-cannon", gang)).toBe(4 + 1);
  });

  it("allocates unsaved hits to the closest base first", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 6, 6);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    // Find a seed where exactly one base is lost: it is the closest one (the third, at x = 3).
    for (let seed = 1; seed < 60; seed++) {
      let t = play(
        s,
        { type: "action/take", unitId: tank, action: "fire", weapon: "coax-mg", targetId: gang },
        "p1",
      );
      if (t.pending) t = play(t, { type: "reaction/pass" }, "p2");
      const r = rng(seed);
      while (t.procedure && !t.procedure.run.done) t = play(t, { type: "procedure/roll" }, "p1", r);
      t = play(t, { type: "procedure/clear" }, "p1");
      const lost = t.units[gang]!.modelIds.filter((id) => t.models[id]?.destroyed);
      if (lost.length === 1) {
        expect(lost[0]).toBe(t.units[gang]!.modelIds[2]);
        return;
      }
    }
    throw new Error("no seed lost exactly one base");
  });

  it("a hit beyond the bases the attacker sees is lost, not taken by a hidden base (#55)", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 4.5);
    // A container between the tank and the gang's third base only.
    s = { ...s, terrain: [makePiece("Container", "c", { x: 4, y: 2 }, 0, "blocking")] };
    const hidden = s.units[gang]!.modelIds[2]!;
    const shooter = s.models[s.units[tank]!.modelIds[0]!]!;
    expect(modelSight(s, shooter, s.models[hidden]!).visible).toBe(false);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    let t = play(
      s,
      { type: "action/take", unitId: tank, action: "fire", weapon: "coax-mg", targetId: gang },
      "p1",
    );
    if (t.pending) t = play(t, { type: "reaction/pass" }, "p2");
    // Every attack hits (high rolls), then every save fails (low rolls): three hits through.
    let n = 0;
    const r = () => (n++ < 3 ? 0.999 : 0.001);
    while (t.procedure && !t.procedure.run.done) t = play(t, { type: "procedure/roll" }, "p1", r);
    const records = t.procedure!.run.records;
    expect(records.find((x) => x.id === "hit")?.out).toBe(3);
    t = play(t, { type: "procedure/clear" }, "p1");
    // The two bases it sees go; the third hit is lost, not taken by the hidden base.
    const seen = t.units[gang]!.modelIds.filter((id) => id !== hidden);
    expect(seen.every((id) => t.models[id]?.destroyed)).toBe(true);
    expect(t.models[hidden]?.destroyed).toBeFalsy();
  });

  it("an infantry unit is pinned by a saved hit, and getting pinned ends interacting (fix)", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 6);
    s = status(s, gang, "interacting", true);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    let seen = false;
    for (let seed = 1; seed < 80 && !seen; seed++) {
      let t = play(
        s,
        { type: "action/take", unitId: tank, action: "fire", weapon: "coax-mg", targetId: gang },
        "p1",
      );
      if (t.pending) t = play(t, { type: "reaction/pass" }, "p2");
      const r = rng(seed);
      while (t.procedure && !t.procedure.run.done) t = play(t, { type: "procedure/roll" }, "p1", r);
      const recs = t.procedure!.run.records;
      const hits = recs.find((x) => x.id === "hit")!.out;
      const unsaved = recs.find((x) => x.id === "save")?.out ?? 0;
      t = play(t, { type: "procedure/clear" }, "p1");
      if (hits > 0 && unsaved === 0) {
        seen = true;
        expect(t.units[gang]?.status?.pinned).toBe(true);
        expect(t.units[gang]?.status?.interacting).toBeFalsy();
      }
      if (hits === 0) expect(t.units[gang]?.status?.pinned).toBeFalsy();
    }
    expect(seen).toBe(true);
  });

  it("units without a save can't cancel hits", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 6);
    const u = s.units[gang]!;
    for (const id of u.modelIds) {
      const m = s.models[id]!;
      const chars = { ...m.profile!.chars };
      delete chars.Save;
      s = { ...s, models: { ...s.models, [id]: { ...m, profile: { ...m.profile!, chars } } } };
    }
    expect(savePlan(s, tank, "coax-mg", gang).target).toBeNull();
  });
});

describe("FSD rules audit: terrain and damage", () => {
  it("terrain cover: behind a corner of blocking terrain, and infantry touching traversable terrain", () => {
    let s = setup();
    const strider = unitNamed(s, "Strider Walker", "p1").id;
    const crawler = unitNamed(s, "Scrap Crawler", "p2").id;
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, strider, 0, 9);
    s = place(s, crawler, 3.5, -4);
    // Autocannon range 4 DU; 4.5 DU away: +1. In the open: Defense 3 + 1.
    expect(hitTarget(s, strider, "autocannon", crawler)).toBe(4);
    // A container hides part of the crawler: corner cover, +1 for a vehicle.
    const corner = { ...s, terrain: [makePiece("Container", "c", { x: 0, y: 0 }, 0, "blocking")] };
    expect(hitTarget(corner, strider, "autocannon", crawler)).toBe(5);
    // A barricade (traversable) behind the gang, touching it: infantry in cover from all sides.
    let wall = { ...s, terrain: [makePiece("Barricade", "b", { x: 0, y: -2 }, 0, "traversable")] };
    wall = place(wall, tank, 0, 8);
    wall = place(wall, crawler, 10, -10);
    wall = place(wall, gang, 0, -0.7);
    expect(hitTarget(wall, tank, "coax-mg", gang)).toBe(4 + 2);
    // A vehicle touching it from the same side gets nothing.
    wall = place(wall, gang, -12, -10);
    wall = place(wall, crawler, 0, 0.3);
    expect(hitTarget(wall, tank, "coax-mg", crawler)).toBe(3);
    // A vehicle touching a building in full view gets nothing either (#55): only a hidden part counts.
    let building = { ...s, terrain: [makePiece("Container", "c", { x: 0, y: -3 }, 0, "blocking")] };
    building = place(building, gang, -12, -10);
    building = place(building, tank, 0, 8);
    // Its base brought up until it just touches the container, in full view of the tank.
    const size = baseSizeInches(s.models[s.units[crawler]!.modelIds[0]!]!.base);
    const r = Math.max(size.width, size.depth) / 2;
    let y = 4;
    while (!inFootprint(building.terrain[0]!, { x: 0, y }, r)) y -= 0.02;
    building = place(building, crawler, 0, y);
    const seen = modelSight(
      building,
      building.models[building.units[tank]!.modelIds[0]!]!,
      building.models[building.units[crawler]!.modelIds[0]!]!,
    );
    expect(seen.fully).toBe(true);
    expect(hitTarget(building, tank, "coax-mg", crawler)).toBe(3);
  });

  /** Fire the tank's coax MG at the crawler until some hit goes unsaved; the state after. */
  function shootUntilDamaged(s: GameState, tank: string, crawler: string): GameState {
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    for (let seed = 1; seed < 200; seed++) {
      let t = play(
        s,
        { type: "action/take", unitId: tank, action: "fire", weapon: "coax-mg", targetId: crawler },
        "p1",
      );
      if (t.pending) t = play(t, { type: "reaction/pass" }, "p2");
      const r = rng(seed);
      while (t.procedure && !t.procedure.run.done) t = play(t, { type: "procedure/roll" }, "p1", r);
      const unsaved = t.procedure!.run.records.find((x) => x.id === "save")?.out ?? 0;
      t = play(t, { type: "procedure/clear" }, "p1");
      if (unsaved === 1) return t;
    }
    throw new Error("never exactly one unsaved hit");
  }

  it("damage chart: red destroys, a second orange destroys, white boxes only pin again", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const crawler = unitNamed(s, "Scrap Crawler", "p2").id;
    s = place(s, tank, 0, 6, Math.PI);
    s = place(s, crawler, 0, 0, Math.PI);
    const chart = (t: GameState, text: string) => {
      const id = t.units[crawler]!.modelIds[0]!;
      const m = t.models[id]!;
      return {
        ...t,
        models: {
          ...t.models,
          [id]: { ...m, profile: { ...m.profile!, chars: { ...m.profile!.chars, Chart: text } } },
        },
      };
    };
    const alive = (t: GameState) => !t.models[t.units[crawler]!.modelIds[0]!]!.destroyed;
    expect(alive(shootUntilDamaged(chart(s, "1-6:red"), tank, crawler))).toBe(false);
    const orange = chart(s, "1-6:orange:MOV");
    const once = shootUntilDamaged(orange, tank, crawler);
    expect(alive(once)).toBe(true);
    expect(once.units[crawler]?.status).toMatchObject({ damageMOV: true, pinned: true });
    expect(alive(shootUntilDamaged(status(orange, crawler, "box0", true), tank, crawler))).toBe(false);
    const white = shootUntilDamaged(status(chart(s, "1-6:white:PIN"), crawler, "box0", true), tank, crawler);
    expect(alive(white)).toBe(true);
    expect(white.units[crawler]?.status?.pinned).toBe(true);
  });

  it("a WPN hit loses the behemoth's attachment weapon; a disabled prepared action keeps its token", () => {
    let s = setup(fsdBehemothSample);
    const hauler = unitNamed(s, "Siege Hauler", "p2").id;
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    s = place(s, hauler, 0, 0);
    s = place(s, tank, 0, 9);
    s = status(s, hauler, "damageWPN", true);
    s = toActivations(s);
    s = play(s, { type: "turn/pass" }, "p1");
    s = play(s, { type: "action/take", unitId: hauler, action: "activate" }, "p2");
    expect(option(s, hauler, "fire", { weapon: "bastion-cannon", targetId: tank }).why).toBe(
      "The attachment is destroyed",
    );
    expect(option(s, hauler, "fire", { weapon: "hull-guns", targetId: tank }).ok).toBe(true);
    // Prepared overwatch guns on the strider's line 3, then System 3 damaged.
    let t = setup();
    const strider = unitNamed(t, "Strider Walker", "p1").id;
    t = status(t, strider, "prepared.overwatch-guns", true);
    t = status(t, strider, "damageS3", true);
    t = toActivations(t);
    t = play(t, { type: "action/take", unitId: strider, action: "activate" }, "p1");
    expect(option(t, strider, "prepare", { weapon: "overwatch-guns" }).why).toBe("System 3 is damaged");
    expect(t.units[strider]?.status?.["prepared.overwatch-guns"]).toBe(true);
  });
});

describe("FSD rules audit: activations", () => {
  it("moves after the first are 1 DU shorter, but at least 1 DU", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    if (s.pending) s = play(s, { type: "reaction/pass" }, "p2");
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    // 4 DU then 3 DU: 21".
    expect(s.units[tank]?.status?.allowance).toBe(21);
  });

  it("each special action once a round, and a pinned unit must unpin before anything else", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 6);
    s = status(s, tank, "pinned", true);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    expect(option(s, tank, "move").ok).toBe(false);
    expect(option(s, tank, "fire", { weapon: "coax-mg", targetId: gang }).ok).toBe(false);
    expect(option(s, tank, "interact").ok).toBe(false);
    s = play(s, { type: "action/take", unitId: tank, action: "unpin" }, "p1");
    expect(s.units[tank]?.status?.pinned).toBeFalsy();
    s = play(
      s,
      { type: "action/take", unitId: tank, action: "fire", weapon: "coax-mg", targetId: gang },
      "p1",
    );
    if (s.pending) s = play(s, { type: "reaction/pass" }, "p2");
    const r = rng(2);
    while (s.procedure && !s.procedure.run.done) s = play(s, { type: "procedure/roll" }, "p1", r);
    if (s.procedure) s = play(s, { type: "procedure/clear" }, "p1");
    s = {
      ...s,
      units: {
        ...s.units,
        [tank]: { ...s.units[tank]!, status: { ...s.units[tank]!.status, actionsTaken: 0 } },
      },
    };
    expect(option(s, tank, "fire", { weapon: "coax-mg", targetId: gang }).why).toBe(
      "Weapon already used this round",
    );
  });

  it("pinned units can't react or command; reactions answer a shot at them or a move in sight", () => {
    let s = setup();
    const boss = unitNamed(s, "Command Team", "p1").id;
    const squad = unitNamed(s, "Rifle Squad", "p1").id;
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    const walker = unitNamed(s, "Junk Walker", "p2").id;
    s = place(s, boss, -6, 8);
    s = place(s, squad, -6, 10);
    s = place(s, tank, 0, 6);
    s = place(s, gang, 0, 0);
    s = place(s, walker, 6, 0);
    s = toActivations(s);
    expect(option(status(s, boss, "pinned", true), boss, "activate").commands?.count ?? 0).toBe(0);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    // Shooting the gang: only the gang may react.
    const shot = play(
      s,
      { type: "action/take", unitId: tank, action: "fire", weapon: "coax-mg", targetId: gang },
      "p1",
    );
    expect(option(shot, gang, "react").ok).toBe(true);
    expect(option(shot, walker, "react").ok).toBe(false);
    expect(option(status(shot, gang, "pinned", true), gang, "react").ok).toBe(false);
    // A move in sight: both may react.
    const moved = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    expect(option(moved, gang, "react").ok).toBe(true);
    expect(option(moved, walker, "react").ok).toBe(true);
  });

  it("Heavy weapons can't fire in a round the unit moved", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 6);
    s = editWeapon(s, tank, "coax-mg", { keywords: ["Heavy"] });
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    expect(option(s, tank, "fire", { weapon: "coax-mg", targetId: gang }).ok).toBe(true);
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    if (s.pending) s = play(s, { type: "reaction/pass" }, "p2");
    expect(option(s, tank, "fire", { weapon: "coax-mg", targetId: gang }).why).toBe(
      "Heavy: not in a round the unit moved",
    );
  });

  it("a behemoth's System can react and its Core still activate later, and the other way round (fix)", () => {
    let s = setup(fsdBehemothSample);
    const hauler = unitNamed(s, "Siege Hauler", "p2").id;
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    s = place(s, hauler, 0, 0);
    s = place(s, tank, 0, 9);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    expect(option(s, hauler, "react").ok).toBe(true);
    s = play(s, { type: "action/take", unitId: hauler, action: "react" }, "p2");
    s = play(s, { type: "reaction/pass" }, "p2");
    s = play(s, { type: "turn/endActivation" }, "p1");
    expect(s.turn.activeSeat).toBe(1);
    // The Core activates, with its parts.
    expect(option(s, hauler, "activate").ok).toBe(true);
    s = play(s, { type: "action/take", unitId: hauler, action: "activate" }, "p2");
    s = play(s, { type: "turn/endActivation" }, "p2");
    // Only once a round.
    s = play(s, { type: "turn/pass" }, "p1");
    expect(option(s, hauler, "activate").ok).toBe(false);
    // An ordinary unit that reacted can't activate later.
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = status(s, gang, "activated", true);
    s = status(s, gang, "reacted", true);
    expect(option(s, gang, "activate").ok).toBe(false);
  });

  it("support cards and units in reserve: deploying gives no command", () => {
    let s = setup();
    const boss = unitNamed(s, "Command Team", "p1").id;
    s = play(s, { type: "unit/reserve", id: boss, reserve: true }, "p1");
    s = toActivations(s);
    const deploy = option(s, boss, "deploy");
    expect(deploy.ok).toBe(true);
    expect(deploy.commands).toBeUndefined();
  });

  it('the game lasts six rounds; 1 DU is 3"; the AD Pool is 12 with a capacity of 8', () => {
    expect(fsd.turn.rounds).toBe(6);
    expect(fsd.units).toEqual({ name: "DU", inches: 3 });
    expect(fsd.constants).toMatchObject({ adPool: 12, adCapacity: 8 });
  });
});

describe("FSD rules audit: reminders and checks", () => {
  it("reminds of weapon special rules in the attack, and unit special rules when they matter", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 6);
    s = editWeapon(s, tank, "coax-mg", { keywords: ["Lethal", "Area 2"] });
    expect(preview(s, tank, "coax-mg", gang).reminders).toEqual(expect.arrayContaining(["Lethal", "Area"]));
    s = editUnit(s, gang, { abilities: ["Evasive", "Fast"] });
    s = editUnit(s, tank, { abilities: ["Charger"] });
    const names = attackReminders(s, tank, gang, "ranged").map((r) => r.ability.name);
    expect(names).toEqual(expect.arrayContaining(["Evasive", "Charger"]));
    expect(names).not.toContain("Fast");
    s = toActivations(s);
    const now = abilityReminders(s).map((r) => r.ability.name);
    expect(now).toContain("Fast");
    expect(now).not.toContain("Evasive");
  });

  it("warns when a multi-base unit is out of coherence after losing a base", () => {
    let s = toActivations(setup());
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    const checks = (t: GameState) => fsdChecks(gameView(t, "fsd-1.7")).map((w) => [w.id, w.unitId]);
    s = place(s, gang, 0, 0);
    expect(checks(s)).not.toContainEqual(["coherence", gang]);
    // The middle base lost: the outer two are 3" (1 DU) apart, still fine.
    const [, b, c] = s.units[gang]!.modelIds;
    s = applyEvent(s, { type: "model/move", id: c!, to: { x: 3.5, y: 0 } });
    s = { ...s, models: { ...s.models, [b!]: { ...s.models[b!]!, destroyed: true } } };
    expect(checks(s)).toContainEqual(["coherence", gang]);
  });
});

describe("FSD rules audit: initiative (#55)", () => {
  beforeAll(() => {
    handOver = false;
  });
  afterAll(() => {
    handOver = true;
  });

  const bestCmd = (s: GameState, owner: string) =>
    Math.max(
      0,
      ...Object.values(s.units)
        .filter((u) => u.owner === owner && !u.status?.pinned && !u.status?.reserves)
        .flatMap((u) => u.modelIds.map((id) => Number(s.models[id]?.profile?.chars?.Cmd ?? 0))),
    );

  it("rolls a D6 each plus the best Command among units on the table; the winner picks", () => {
    let s = setup();
    const best = [bestCmd(s, "p1"), bestCmd(s, "p2")];
    s = play(s, { type: "turn/next" }, "p1");
    const r = s.rolledOff!;
    expect(r.chooses).toBe(true);
    expect(r.modifiers ?? [0, 0]).toEqual(best);
    const last = r.rolls.map((rolls) => rolls.at(-1)!);
    expect(last[r.seat]).toBe(Math.max(...last));
    expect(s.turn.firstSeat).toBe(r.seat);
  });

  it("leaves pinned units out of the best Command", () => {
    let s = setup();
    const top = Object.values(s.units)
      .filter((u) => u.owner === "p1")
      .sort(
        (a, b) =>
          Number(s.models[b.modelIds[0]!]?.profile?.chars?.Cmd ?? 0) -
          Number(s.models[a.modelIds[0]!]?.profile?.chars?.Cmd ?? 0),
      )[0]!;
    s = applyEvent(s, { type: "unit/status", id: top.id, key: "pinned", value: true });
    const best = bestCmd(s, "p1");
    s = play(s, { type: "turn/next" }, "p1");
    expect((s.rolledOff!.modifiers ?? [0, 0])[0]).toBe(best);
  });
});

describe("FSD rules audit: bases in the way (#55)", () => {
  /** One base of the unit at (x, y), the rest parked off to the side. */
  const put = (s: GameState, unitId: string, x: number, y: number) => {
    let next = s;
    s.units[unitId]!.modelIds.forEach((id, i) => {
      const to = i ? { x: 30 + i * 2, y: y } : { x, y };
      next = applyEvent(next, { type: "model/move", id, to, facing: 0 });
    });
    return next;
  };
  const sees = (s: GameState, from: string, to: string) =>
    modelSight(s, s.models[s.units[from]!.modelIds[0]!]!, s.models[s.units[to]!.modelIds[0]!]!, {
      modelsBlock: s.settings.modelsBlock,
    }).visible;

  it("only enemy bases block, and vehicles and mechs hide only behind vehicles, mechs or behemoths", () => {
    let s = setup();
    const raiders = unitNamed(s, "Raider Gang", "p2").id;
    const raidersB = unitNamed(s, "Raider Gang B", "p2").id;
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const walker = unitNamed(s, "Strider Walker", "p1").id;
    const rifles = unitNamed(s, "Rifle Squad", "p1").id;
    const command = unitNamed(s, "Command Team", "p1").id;
    s = put(s, raiders, 0, -8);
    // Their own gang in front doesn't hide the enemy infantry behind it.
    s = put(s, command, 0, 8);
    s = put(s, raidersB, 0, 0);
    expect(sees(s, raiders, command)).toBe(true);
    // An enemy infantry base hides infantry...
    s = put(s, raidersB, 30, -20);
    s = put(s, rifles, 0, 0);
    expect(sees(s, raiders, command)).toBe(false);
    // ...but not a tank behind it; a mech does.
    s = put(s, command, 30, 20);
    s = put(s, tank, 0, 8);
    expect(sees(s, raiders, tank)).toBe(true);
    s = put(s, rifles, 30, 24);
    s = put(s, walker, 0, 0);
    expect(sees(s, raiders, tank)).toBe(false);
  });
});
