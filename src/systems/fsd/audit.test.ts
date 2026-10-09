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
import { actionTargets, procedureEnv, procedureRoles, unitActions } from "../../core/content/play";
import { abilityReminders, attackReminders, isAutomated } from "../../core/content/player";
import { previewRun, type TestPlan } from "../../core/content/runner";
import { fsd } from "../../core/content/examples/fsd";
import { systemConstants } from "../../core/content/gameSize";
import { terrainMoveWarning, terrainOnMove } from "../../core/content/moves";
import { phaseHint, schedule } from "../../core/content/turn";
import { tableWarnings } from "../../ui/warnings";
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
    const now = () => abilityReminders(s).map((r) => r.ability.name);
    // The gang's Fast is for when it moves (#57), the tank's Charger once it has moved.
    expect(now()).toEqual([]);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    expect(now()).toContain("Charger");
    expect(now()).not.toContain("Fast");
    expect(now()).not.toContain("Evasive");
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

describe("FSD rules audit: engine gaps (#57)", () => {
  it("the AD Pool and Capacity follow the game size: 6 plus 2 per 20 points or part, the Capacity 4 less", () => {
    let s = setup();
    expect(systemConstants(s, fsd)).toMatchObject({ adPool: 12, adCapacity: 8 });
    const at = (points: number) => systemConstants({ ...s, settings: { ...s.settings, points } }, fsd);
    expect(at(40)).toMatchObject({ adPool: 10, adCapacity: 6 });
    expect(at(50)).toMatchObject({ adPool: 12, adCapacity: 8 });
    expect(at(80)).toMatchObject({ adPool: 14, adCapacity: 10 });
    // A 40-point game rolls 6 dice a round.
    s = play(s, { type: "settings/set", settings: { points: 40 } }, "p1");
    s = toActivations(s);
    expect(s.pools?.p1?.readyDice).toHaveLength(6);
  });

  it("a multiple attack (x2) rolls once per target named, in one action with one reaction, landing together", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gangA = unitNamed(s, "Raider Gang", "p2").id;
    const gangB = unitNamed(s, "Raider Gang B", "p2").id;
    s = place(s, tank, 0, 6, Math.PI);
    s = place(s, gangA, -6, 0);
    s = place(s, gangB, 3, 0);
    s = editWeapon(s, tank, "coax-mg", { chars: { x: "x2" } });
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    expect(option(s, tank, "fire", { weapon: "coax-mg" }).repeat).toBe(2);
    s = play(
      s,
      {
        type: "action/take",
        unitId: tank,
        action: "fire",
        weapon: "coax-mg",
        targetId: gangA,
        more: [gangB],
      },
      "p1",
    );
    // Either target may react, but only one reaction answers the action.
    expect(s.pending?.trigger.more).toEqual([gangB]);
    expect(option(s, gangB, "react").ok).toBe(true);
    s = play(s, { type: "reaction/pass" }, "p2");
    expect(s.procedure?.targetId).toBe(gangA);
    const r = rng(3);
    while (!s.procedure!.run.done) s = play(s, { type: "procedure/roll" }, "p1", r);
    // The first attack's results wait for the second.
    expect(s.deferred ?? []).toEqual(s.procedure!.run.outcomes);
    const before = s.units[gangA]!;
    s = play(s, { type: "procedure/clear" }, "p1");
    expect(s.procedure?.targetId).toBe(gangB);
    expect(s.units[gangA]).toEqual(before);
    while (!s.procedure!.run.done) s = play(s, { type: "procedure/roll" }, "p1", r);
    expect(s.deferred ?? null).toBeNull();
    s = play(s, { type: "procedure/clear" }, "p1");
    expect(s.procedure ?? null).toBeNull();
    // One action, the weapon's once-a-round use spent once.
    expect(s.units[tank]!.status).toMatchObject({ actionsTaken: 1, "used.fire.coax-mg": 1 });
    // Without other targets named, every attack goes at the first.
    const one = resolveIntent(
      { type: "action/take", unitId: gangA, action: "fire", weapon: "carbines", targetId: tank },
      "p2",
      rng(1),
      s,
    );
    expect(one && "more" in one ? one.more : undefined).toBeUndefined();
  });

  it("terrain movement by unit type: infantry crosses walls for 1 DU, vehicles can't, fliers pass, fragile is driven through", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    const wall = makePiece("Barricade", "wall", { x: 0, y: 0 }, 0, "traversable");
    const fence = makePiece("Barricade", "fence", { x: 12, y: 0 }, 0, "fragile");
    const rock = makePiece("Barricade", "rock", { x: -12, y: 0 }, 0, "impassable");
    s = { ...s, terrain: [wall, fence, rock] };
    s = place(s, tank, 0, 3);
    s = place(s, gang, -12, 3);
    s = toActivations(s);
    const moveTo = (t: GameState, unitId: string, x: number, y: number) => place(t, unitId, x, y);
    const blocked = (t: GameState, unitId: string) =>
      terrainOnMove(t, fsd, t.units[unitId]!).blocked.map((p) => p.id);
    // The tank across the wall: blocked. Across the fence: driven through.
    expect(blocked(moveTo(s, tank, 0, -3), tank)).toEqual(["wall"]);
    const byFence = toActivations(place({ ...setup(), terrain: [fence] }, tank, 12, 3));
    expect(blocked(moveTo(byFence, tank, 12, -3), tank)).toEqual([]);
    // The gang over the rocks: impassable, even for infantry.
    expect(blocked(moveTo(s, gang, -12, -3), gang)).toEqual(["rock"]);
    // Infantry over the wall: crossed, at 1 DU's cost.
    const over = moveTo(place(s, gang, -1.5, 3), gang, -1.5, -3);
    expect(blocked(over, gang)).toEqual([]);
    expect(terrainOnMove(over, fsd, over.units[gang]!).slowed).toMatchObject({ by: 1 });
    // A flying unit passes over the rocks.
    const flier = editUnit(moveTo(s, gang, -12, -3), gang, { abilities: ["Flying"] });
    expect(blocked(flier, gang)).toEqual([]);
    // Moving through warns on the table.
    const warned = tableWarnings(moveTo(s, tank, 0, -3)).filter((w) => w.unitId === tank);
    expect(warned.map((w) => w.checkId)).toContain("terrain");
  });

  it("terrain areas: a move entering or starting in broken ground has 1 DU less", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    s = { ...s, terrain: [makePiece("Crater", "crater", { x: 0, y: 0 }, 0, "broken")] };
    s = place(s, tank, 0, 9);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    if (s.pending) s = play(s, { type: "reaction/pass" }, "p2");
    // Move 4 DU (12"): into the crater it may go 3 DU (9").
    expect(s.units[tank]!.status?.allowance).toBe(12);
    expect(terrainMoveWarning(place(s, tank, 0, 1), fsd, s.units[tank]!)).toBeNull();
    const far = place(s, tank, 0, -1.5);
    expect(terrainMoveWarning(far, fsd, far.units[tank]!)).toMatch(/costs 1 of its move/);
    // Infantry ignores broken ground.
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    const g = place(place(s, gang, 0, -9), gang, 0, 0);
    expect(terrainOnMove(g, fsd, g.units[gang]!).slowed).toBeNull();
  });

  it("an arc of fire limits a weapon to targets inside it", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    // The tank faces -y, towards the gang.
    s = place(s, tank, 0, 6, Math.PI);
    s = place(s, gang, 0, 0);
    s = editWeapon(s, tank, "coax-mg", { chars: { Arc: "90" } });
    expect(hitTarget(s, tank, "coax-mg", gang)).toBe(4);
    // Turned away: the gang is behind it.
    expect(hitTarget(place(s, tank, 0, 6, 0), tank, "coax-mg", gang)).toBeNull();
    // All round by default.
    const round = editWeapon(place(s, tank, 0, 6, 0), tank, "coax-mg", { chars: { Arc: "0" } });
    expect(hitTarget(round, tank, "coax-mg", gang)).toBe(4);
  });

  it("Fire's targets follow the weapon: outside its arc greyed out with why, Indirect Fire picks unseen units at +1", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    const pick = (t: GameState, weapon: string) =>
      actionTargets(t, tank, "fire", weapon).find((x) => x.unitId === gang)!;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 9, Math.PI);
    s = editWeapon(s, tank, "coax-mg", { chars: { Arc: "90" } });
    expect(pick(s, "coax-mg")).toMatchObject({ ok: true });
    // Turned away: listed, greyed out, and why.
    const away = place(s, tank, 0, 9, 0);
    expect(pick(away, "coax-mg")).toMatchObject({ ok: false, why: "Outside the weapon's arc of fire" });
    expect(pick(away, "light-cannon").ok).toBe(true);
    // A ruin between: out of sight, so not a target, unless the weapon fires indirectly.
    const hidden = { ...s, terrain: [makePiece("Ruin", "r", { x: 0, y: 4.5 }, 0, "blocking")] };
    expect(pick(hidden, "light-cannon").ok).toBe(false);
    const indirect = editWeapon(hidden, tank, "light-cannon", { keywords: ["Indirect Fire"] });
    expect(pick(indirect, "light-cannon").ok).toBe(true);
    // At +1 Defense out of sight, and it takes the closest bases.
    expect(hitTarget(indirect, tank, "light-cannon", gang)).toBe(4 + 1);
  });

  it("terrain touching the shooter's base is ignored for its own shots' cover", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, -6);
    // Woods between, the tank well clear of them: the gang is in cover.
    s = { ...s, terrain: [makePiece("Woods", "w", { x: 0, y: 0 }, 0, "obscuring")] };
    s = place(s, tank, 0, 9);
    expect(hitTarget(s, tank, "light-cannon", gang)).toBe(4 + 2);
    // The tank touching the woods' edge, shooting out past them: no cover.
    s = place(s, tank, 0, 3.6);
    expect(hitTarget(s, tank, "light-cannon", gang)).toBe(4);
  });

  it("unit special rules show for the unit activated, or once it moves", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    s = place(s, tank, 0, 4);
    // Fast is played by the Move action now (#66): only the hand-played ones are reminded.
    s = editUnit(s, tank, { abilities: ["Fast", "Fire Base", "Side Movement"] });
    const now = (t: GameState) => abilityReminders(t).map((r) => r.ability.name);
    s = toActivations(s);
    expect(now(s)).toEqual([]);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    expect(now(s)).toEqual(["Fire Base"]);
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    expect(now(s)).toEqual(expect.arrayContaining(["Fire Base", "Side Movement"]));
    expect(now(s)).not.toContain("Fast");
  });

  it("reminds of hand-played rules in the attack: lost when firing, transported units, wrecks, a System's own damage", () => {
    let s = setup(fsdBehemothSample);
    const mine = unitNamed(s, "Siege Hauler", "p1").id;
    const theirs = unitNamed(s, "Siege Hauler", "p2").id;
    // Their hauler faces us: its front System shields it.
    s = place(s, theirs, 0, 0, 0);
    s = place(s, mine, 0, 10, Math.PI);
    s = editUnit(s, theirs, { keywords: ["VEHICLE", "BEHEMOTH", "TRANSPORT"] });
    expect(preview(s, mine, "hull-guns", theirs).reminders).toEqual(
      expect.arrayContaining([
        "Lost when firing",
        "Damage to transported units",
        "Wrecks (optional)",
        "System damage effects",
      ]),
    );
    // An infantry target, by a unit that isn't a behemoth: none of them.
    const tank = unitNamed(setup(), "Lancer Tank", "p1").id;
    let t = setup();
    const gang = unitNamed(t, "Raider Gang", "p2").id;
    t = place(place(t, tank, 0, 6), gang, 0, 0);
    expect(preview(t, tank, "coax-mg", gang).reminders).toEqual([]);
  });

  it("shows the rules played by hand at their moment: scoring, reinforcements, reactions, deploying, support cards, prepared tokens", () => {
    let s = setup();
    const hints = (id: string) => fsd.actions.find((a) => a.id === id)?.hint;
    for (const id of ["react", "deploy", "support", "prepare"]) expect(hints(id)).toBeTruthy();
    s = toActivations(s);
    for (let i = 0; i < 6 && currentSlot(s)?.id !== "scoring"; i++) {
      s = play(s, { type: "turn/pass" }, s.turn.activeSeat === 0 ? "p1" : "p2");
    }
    expect(currentSlot(s)?.id).toBe("scoring");
    expect(currentSlot(s)?.hint).toMatch(/Victory Cards/);
    const preassign = schedule(fsd).find((x) => x.id === "preassign");
    expect(preassign?.hint).toMatch(/Reinforcement/);
  });

  it("flags an army over the game's points, a Unique unit fielded twice, and a move ending on another base", () => {
    let s = setup();
    const ids = (t: GameState) => fsdChecks(gameView(t, "fsd-1.7")).map((w) => w.id);
    expect(ids(s)).not.toContain("points");
    s = play(s, { type: "settings/set", settings: { points: 20 } }, "p1");
    expect(ids(s)).toContain("points");
    const a = unitNamed(s, "Rifle Squad", "p1").id;
    const b = unitNamed(s, "Rifle Squad B", "p1").id;
    s = editUnit(editUnit(s, a, { abilities: ["Unique"] }), b, { abilities: ["Unique"] });
    expect(ids(s)).not.toContain("unique");
    s = { ...s, units: { ...s.units, [a]: { ...s.units[a]!, name: "Rifle Squad B" } } };
    expect(ids(s)).toContain("unique");
    // Moving onto another unit's base.
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(place(s, tank, 0, 6), gang, 0, 0);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    s = play(s, { type: "action/take", unitId: tank, action: "move" }, "p1");
    if (s.pending) s = play(s, { type: "reaction/pass" }, "p2");
    expect(ids(s)).not.toContain("overlap");
    expect(ids(place(s, tank, 0.5, 0.5))).toContain("overlap");
  });
});

describe("FSD rules audit: the last missing rows (#58)", () => {
  /** One base of the unit at (x, y), the others taken off. */
  const put = (s: GameState, unitId: string, x: number, y: number) => {
    let next = s;
    s.units[unitId]!.modelIds.forEach((id, i) => {
      next = i
        ? applyEvent(next, { type: "model/remove", id })
        : applyEvent(next, { type: "model/move", id, to: { x, y }, facing: 0 });
    });
    return next;
  };

  it("Selective Fire ignores units for sight: a target hidden by a base can be shot, one behind terrain can't", () => {
    let s = setup();
    const raiders = unitNamed(s, "Raider Gang", "p2").id;
    const rifles = unitNamed(s, "Rifle Squad", "p1").id;
    const command = unitNamed(s, "Command Team", "p1").id;
    s = put(s, raiders, 0, -8);
    s = put(s, rifles, 0, -3);
    s = put(s, command, 0, 8);
    const pick = (t: GameState) =>
      actionTargets(t, raiders, "fire", "carbines").find((x) => x.unitId === command)!;
    // The rifle squad's base hides the command team.
    expect(pick(s).ok).toBe(false);
    // Per Base: no base sees it, so no dice.
    expect(attackDice(s, raiders, "carbines", command)).toBe("0");
    const selective = editWeapon(s, raiders, "carbines", { keywords: ["Per Base", "Selective Fire"] });
    expect(pick(selective).ok).toBe(true);
    expect(attackDice(selective, raiders, "carbines", command)).toBe("1");
    // Beyond its 3 DU range: Defense 4, +1.
    expect(hitTarget(selective, raiders, "carbines", command)).toBe(5);
    // Terrain still blocks it.
    const ruin = { ...selective, terrain: [makePiece("Ruin", "r", { x: 0, y: 2.5 }, 0, "blocking")] };
    expect(pick(ruin).ok).toBe(false);
  });

  it("a move sets the facing: each base ends looking the way it went, not while setting up", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    s = place(s, tank, 0, 6, 0);
    const id = s.units[tank]!.modelIds[0]!;
    const drag = (t: GameState, dx: number, dy: number, extra = {}) =>
      applyEvent(t, {
        type: "models/move",
        moves: [{ id, to: { x: t.models[id]!.position.x + dx, y: t.models[id]!.position.y + dy } }],
        ...extra,
      });
    // Setting up: facing stays.
    expect(drag(s, 3, 0).models[id]!.facing).toBe(0);
    s = toActivations(s);
    const moved = drag(s, 3, 0);
    expect(moved.models[id]!.facing).toBeCloseTo(Math.PI / 2);
    // Then backwards along -y: it ends facing -y.
    expect(Math.abs(drag(moved, 0, -3).models[id]!.facing)).toBeCloseTo(Math.PI);
    // A move pulled back to its limit keeps the facing it had.
    expect(drag(moved, -1, 0, { snap: 6 }).models[id]!.facing).toBeCloseTo(Math.PI / 2);
  });

  it("setting up: who places first, terrain to agree on, tiled tables and bidding are shown before the first round", () => {
    let s = setup();
    expect(s.turn.round).toBe(0);
    expect(phaseHint(s)).toMatch(/lowest/);
    expect(phaseHint(s)).toMatch(/smoke/);
    expect(phaseHint(s)).toMatch(/tiled/);
    expect(phaseHint(s)).toMatch(/bid ADs/);
    s = toActivations(s);
    expect(phaseHint(s)).toBe(currentSlot(s)?.hint);
    expect(phaseHint(s) ?? "").not.toMatch(/lowest/);
  });

  it("abilities that re-roll a Ready AD or roll a Spent one show when the dice are rolled, with wave points", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const u = s.units[tank]!;
    s = {
      ...s,
      units: {
        ...s.units,
        [tank]: {
          ...u,
          sheet: {
            ...u.sheet!,
            abilities: [{ name: "Field Mechanic", text: "Once a round, re-roll a Ready AD." }],
          },
        },
      },
    };
    const now = (t: GameState) => abilityReminders(t).map((r) => r.ability.name);
    expect(now(s)).toEqual([]);
    for (let i = 0; i < 4 && currentSlot(s)?.id !== "preassign"; i++)
      s = play(s, { type: "turn/next" }, "p1");
    expect(currentSlot(s)?.id).toBe("preassign");
    expect(now(s)).toContain("Field Mechanic");
    expect(phaseHint(s)).toMatch(/points the scenario gives it/);
    expect(phaseHint(s)).toMatch(/Ready AD/);
  });

  it("a Character's abilities show while its unit is activated; two on one unit are flagged", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    s = editUnit(s, tank, { abilities: ["Character: Ace Driver"] });
    const now = (t: GameState) => abilityReminders(t).map((r) => r.ability.name);
    s = toActivations(s);
    expect(now(s)).not.toContain("Character: Ace Driver");
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    expect(now(s)).toContain("Character: Ace Driver");
    expect(fsd.actions.find((a) => a.id === "activate")?.hint).toMatch(/Character/);
    const ids = (t: GameState) => fsdChecks(gameView(t, "fsd-1.7")).map((w) => w.id);
    expect(ids(s)).not.toContain("character");
    expect(ids(editUnit(s, tank, { abilities: ["Character: Ace Driver", "Character: Spotter"] }))).toContain(
      "character",
    );
  });

  it("reminds a behemoth's Core of its 45° turns while it is activated, and no one else", () => {
    let s = setup(fsdBehemothSample);
    const hauler = unitNamed(s, "Siege Hauler", "p1").id;
    const now = (t: GameState) => abilityReminders(t).map((r) => `${r.unitId}:${r.ability.name}`);
    s = toActivations(s);
    expect(now(s)).not.toContain(`${hauler}:Behemoth turning`);
    s = play(s, { type: "action/take", unitId: hauler, action: "activate" }, "p1");
    expect(now(s)).toContain(`${hauler}:Behemoth turning`);
    expect(now(s).filter((r) => r.endsWith(":Behemoth turning"))).toHaveLength(1);
  });

  it("Interact says how retrieved and extracted objectives work", () => {
    expect(fsd.actions.find((a) => a.id === "interact")?.hint).toMatch(/Retrieve.*Extract/);
  });
});

describe("FSD special rules by name (#66)", () => {
  /** Fire one weapon to the end: no reaction, rolled with `seed`, closed. */
  function fire(s: GameState, a: string, w: string, t: string, seed: number): GameState {
    s = play(s, { type: "action/take", unitId: a, action: "fire", weapon: w, targetId: t }, "p1");
    if (s.pending) s = play(s, { type: "reaction/pass" }, "p2");
    const r = rng(seed);
    while (s.procedure && !s.procedure.run.done) s = play(s, { type: "procedure/roll" }, "p1", r);
    if (s.procedure) s = play(s, { type: "procedure/clear" }, "p1");
    return s;
  }
  const woods = (s: GameState): GameState => ({
    ...s,
    terrain: [makePiece("Woods", "w", { x: 0, y: 0 }, 0, "obscuring")],
  });

  it("the target's rules in the hit roll: Nimble, Small and Large Target, Terrain Expert, Flying, Mounted", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, tank, 0, 6);
    s = place(s, gang, 0, 0);
    const as = (abilities: string[]) => editUnit(s, gang, { abilities });
    // Nimble: the light cannon's d10 rolls a d8.
    expect((preview(as(["Nimble"]), tank, "light-cannon", gang).plans.hit as TestPlan).sides).toBe(8);
    expect((preview(s, tank, "light-cannon", gang).plans.hit as TestPlan).sides).toBe(10);
    // At long range (coax MG, 3 DU): +1, +2 for a Small Target, nothing for a Large one.
    s = place(s, gang, 0, -6);
    expect(hitTarget(s, tank, "coax-mg", gang)).toBe(5);
    expect(hitTarget(as(["Small Target"]), tank, "coax-mg", gang)).toBe(6);
    expect(hitTarget(as(["Large Target"]), tank, "coax-mg", gang)).toBe(4);
    // Behind woods (light cannon in range): infantry +2; Terrain Expert one more; Flying none;
    // Mounted infantry +1, as a mech.
    s = woods(place(place(s, tank, 0, 9), gang, 0, -6));
    expect(hitTarget(s, tank, "light-cannon", gang)).toBe(6);
    expect(hitTarget(as(["Terrain Expert"]), tank, "light-cannon", gang)).toBe(7);
    expect(hitTarget(as(["Flying"]), tank, "light-cannon", gang)).toBe(4);
    expect(hitTarget(as(["Mounted"]), tank, "light-cannon", gang)).toBe(5);
    // A Large Target at long range gets no cover either.
    const far = woods(place(place(setup(), tank, 0, 12), gang, 0, -9));
    expect(hitTarget(editUnit(far, gang, { abilities: ["Large Target"] }), tank, "light-cannon", gang)).toBe(
      4,
    );
  });

  it("Camouflage: in cover, infantry can't be targeted from beyond 2 DU", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = woods(place(place(s, tank, 0, 9), gang, 0, -6));
    s = editUnit(s, gang, { abilities: ["Camouflage"] });
    expect(hitTarget(s, tank, "light-cannon", gang)).toBeNull();
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    const t = actionTargets(s, tank, "fire", "light-cannon").find((x) => x.unitId === gang);
    expect(t?.why).toBe("Camouflage: in cover and too far to target");
  });

  it("Thick Armor: AP one less, close combat's AP1 too", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const crawler = unitNamed(s, "Scrap Crawler", "p2").id;
    s = place(s, tank, 0, 6, Math.PI);
    s = place(s, crawler, 0, -3, 0);
    s = editUnit(s, crawler, { abilities: ["Thick Armor"] });
    expect(savePlan(s, tank, "light-cannon", crawler).dicePerInput).toBe(3);
    s = place(s, crawler, 0, 3.5, 0);
    expect(savePlan(s, tank, "coax-mg", crawler).dicePerInput).toBe(3);
  });

  it("Suppress pins the target on a hit instead of damaging it; an Unpinnable unit is never pinned", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const walker = unitNamed(s, "Junk Walker", "p2").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, tank, 0, 6);
    s = place(s, walker, 0, 0);
    s = editWeapon(s, tank, "coax-mg", { keywords: ["Suppress"] });
    // Played, not reminded.
    expect(preview(s, tank, "coax-mg", walker).reminders).not.toContain("Suppress");
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    let pinned = false;
    for (let seed = 1; seed < 10 && !pinned; seed++) {
      const t = fire(s, tank, "coax-mg", walker, seed);
      const w = t.units[walker]!;
      pinned = !!w.status?.pinned;
      // No damage boxes, whatever was hit.
      expect(Object.keys(w.status ?? {}).filter((k) => k.startsWith("damage"))).toEqual([]);
    }
    expect(pinned).toBe(true);
    // An Unpinnable gang shot with the plain MG: hit, but never pinned.
    let u = place(editUnit(s, gang, { abilities: ["Unpinnable"] }), gang, 0, 0);
    u = place(u, walker, 10, -10);
    u = editWeapon(u, tank, "coax-mg", { keywords: [] });
    for (let seed = 1; seed < 6; seed++)
      expect(fire(u, tank, "coax-mg", gang, seed).units[gang]?.status?.pinned).toBeFalsy();
  });

  it("Fast moves again at full Move; Slow moves once an activation", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const twice = (abilities: string[]) => {
      let t = toActivations(editUnit(s, tank, { abilities }));
      t = play(t, { type: "action/take", unitId: tank, action: "activate" }, "p1");
      t = play(t, { type: "action/take", unitId: tank, action: "move" }, "p1");
      if (t.pending) t = play(t, { type: "reaction/pass" }, "p2");
      return t;
    };
    const fast = play(twice(["Fast"]), { type: "action/take", unitId: tank, action: "move" }, "p1");
    expect(fast.units[tank]?.status?.allowance).toBe(24);
    expect(option(twice(["Slow"]), tank, "move").why).toBe("Slow: one move per activation");
    s = twice([]);
    expect(option(s, tank, "move").ok).toBe(true);
  });

  it("Capable takes one more action; Reactive reacts with two; Inert never reacts; a Silent unit sets off none", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, tank, 0, 6);
    s = place(s, gang, 0, 0);
    s = toActivations(s);
    const on = (st: GameState, id: string, abilities: string[]) => editUnit(st, id, { abilities });
    const capable = play(
      on(s, tank, ["Capable"]),
      { type: "action/take", unitId: tank, action: "activate" },
      "p1",
    );
    expect(capable.units[tank]?.status?.actionBudget).toBe(3);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    const moved = (st: GameState) => play(st, { type: "action/take", unitId: tank, action: "move" }, "p1");
    const reactive = play(
      moved(on(s, gang, ["Reactive"])),
      { type: "action/take", unitId: gang, action: "react" },
      "p2",
    );
    expect(reactive.units[gang]?.status?.actionBudget).toBe(2);
    expect(option(moved(on(s, gang, ["Inert"])), gang, "react").ok).toBe(false);
    expect(option(moved(on(s, tank, ["Silent"])), gang, "react").ok).toBe(false);
    expect(option(moved(s), gang, "react").ok).toBe(true);
  });

  it("Lone Wolf and Disciplined activate without an AD and don't command; Commander commands at any range", () => {
    let s = setup();
    const boss = unitNamed(s, "Command Team", "p1").id;
    const squad = unitNamed(s, "Rifle Squad", "p1").id;
    s = place(s, boss, -6, 8);
    s = place(s, squad, 6, 0);
    s = toActivations(s);
    const on = (st: GameState, id: string, abilities: string[]) => editUnit(st, id, { abilities });
    expect(option(s, boss, "activateFree").ok).toBe(false);
    const dice = (st: GameState) => JSON.stringify(st.pools?.p1?.readyDice);
    const wolf = play(
      on(s, boss, ["Lone Wolf"]),
      { type: "action/take", unitId: boss, action: "activateFree" },
      "p1",
    );
    expect(wolf.units[boss]?.status?.actionBudget).toBe(2);
    expect(dice(wolf)).toBe(dice(s));
    // (Activating as usual spends one.)
    expect(dice(play(s, { type: "action/take", unitId: boss, action: "activate" }, "p1"))).not.toBe(dice(s));
    const disc = play(
      on(s, boss, ["Disciplined"]),
      { type: "action/take", unitId: boss, action: "activateFree" },
      "p1",
    );
    expect(disc.units[boss]?.status?.actionBudget).toBe(1);
    // Commanding: the squad is 4 DU away, too far; a Commander reaches it; a Lone Wolf commands no one.
    expect(option(s, boss, "activate").commands?.candidates).not.toContain(squad);
    expect(option(on(s, boss, ["Commander"]), boss, "activate").commands?.candidates).toContain(squad);
    expect(option(on(s, boss, ["Lone Wolf", "Commander"]), boss, "activate").commands?.count).toBe(0);
    const lone = on(on(s, boss, ["Commander"]), squad, ["Lone Wolf"]);
    expect(option(lone, boss, "activate").commands?.candidates).not.toContain(squad);
  });

  it("Unwavering acts while pinned, but still can't interact", () => {
    let s = setup();
    const tank = unitNamed(s, "Lancer Tank", "p1").id;
    const gang = unitNamed(s, "Raider Gang", "p2").id;
    s = place(s, gang, 0, 0);
    s = place(s, tank, 0, 6);
    s = status(editUnit(s, tank, { abilities: ["Unwavering"] }), tank, "pinned", true);
    s = toActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    expect(option(s, tank, "move").ok).toBe(true);
    expect(option(s, tank, "fire", { weapon: "coax-mg", targetId: gang }).ok).toBe(true);
    expect(option(s, tank, "interact").ok).toBe(false);
  });

  it("counts the rulebook's named special rules as automated or reminders by name", () => {
    const unitAuto = [
      "Nimble",
      "Small Target",
      "Large Target",
      "Terrain Expert",
      "Camouflage",
      "Thick Armor",
    ];
    const more = ["Unpinnable", "Flying", "Mounted", "Fast", "Slow", "Capable", "Disciplined", "Lone Wolf"];
    for (const name of [...unitAuto, ...more, "Inert", "Silent", "Commander", "Reactive", "Unwavering"])
      expect(isAutomated(fsd, { name, text: "" }), name).toBe(true);
    for (const name of [
      "Evasive",
      "Hard Shell",
      "Charger",
      "Fire Base",
      "Jamming 2",
      "Side Movement",
      "Blunt",
    ])
      expect(isAutomated(fsd, { name, text: "" }), name).toBe(false);
  });
});
