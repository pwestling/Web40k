import { describe, expect, it } from "vitest";
import "../systems";
import {
  applyEvent,
  createInitialState,
  createRecord,
  currentSlot,
  resolveIntent,
  type GameState,
  type Intent,
  type Model,
  type PlayerId,
  type ArmyStratagem,
  type UnitSheet,
} from "../core";
import { teach, type Teaching } from "../systems/wh40k/teach";
import { actionTargets } from "../core/content/play";
import { terrainOnMove } from "../core/content/moves";
import { systemOf } from "../core/content/turn";
import { hookIntents } from "../core/script";
import { inArc } from "../core/regiment";
import { makePiece } from "../systems/wh40k/layout";
import { spawnIntents } from "../systems/wh40k/deploy";
import { fsdLayout } from "../systems/fsd/layout";
import { fsdSample } from "../systems/fsd/sample";
import { conquestLayout } from "../systems/conquest/layout";
import { conquestSample } from "../systems/conquest/sample";
import { botPolicy, type Level } from "./player";
import { destinations, moveInches } from "./moves";
import type { BotMove } from "../soak/bot";
import { applyPack, readFactionPack, type ReadPack } from "../packages/faction";
import cinderCourt from "../../examples/faction-packs/cinder-court.js?raw";

/**
 * The computer opponent plays the rules #57 added (#58): small tables set up
 * by hand, one decision each, with invented units.
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

/** An intent as the host plays it: the event, then the turn hooks it sets off. */
function play(state: GameState, intent: Intent, from: PlayerId, r = rng(1)): GameState {
  const event = resolveIntent(intent, from, r, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  let s = applyEvent({ ...state, seq: state.seq + 1 }, event);
  for (const hook of hookIntents(state, s, event)) {
    const e = resolveIntent(hook, from, r, s);
    if (e) s = applyEvent({ ...s, seq: s.seq + 1 }, e);
  }
  return s;
}

/** The decision the computer makes for `seat` at this table. */
function decide(
  s: GameState,
  seat: number,
  level: Level = "steady",
  opts: { tries?: number; seed?: number } = {},
): BotMove | null {
  const player = Object.values(s.players).find((p) => p.seat === seat)!.id;
  return botPolicy(level, s, seat, { seed: 1, ...opts }).move(createRecord(s), s, {
    seat,
    player,
  });
}

function join(system: string): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  return play(s, { type: "game/system", system }, "p1");
}

function goTo(s: GameState, phase: string, seat: number): GameState {
  for (let i = 0; i < 40; i++) {
    if (s.turn.round > 0 && currentSlot(s)?.id === phase && s.turn.activeSeat === seat) return s;
    s = play(s, { type: "turn/next" }, "p1");
  }
  throw new Error(`never reached ${phase}`);
}

// --- 40k --------------------------------------------------------------------

type Weapon = UnitSheet["weapons"][string];
const gun = (keywords: string[] = [], chars: Record<string, string> = {}): Weapon => ({
  id: "gun",
  name: "Gun",
  kind: "ranged",
  chars: { RANGE: '24"', A: "2", BS: "3+", S: "4", AP: "0", D: "1", ...chars },
  keywords,
});
const blade: Weapon = {
  id: "blade",
  name: "Blade",
  kind: "melee",
  chars: { RANGE: "Melee", A: "2", WS: "3+", S: "4", AP: "0", D: "1" },
  keywords: [],
};

const trooper = (
  id: string,
  owner: string,
  x: number,
  y: number,
  chars: Record<string, string> = {},
): Model => ({
  id,
  owner,
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars: { M: '6"', T: "4", SV: "3+", W: "1", LD: "6+", OC: "1", ...chars } },
  weapons: ["gun", "blade"],
});

function squad(
  s: GameState,
  id: string,
  owner: string,
  models: Model[],
  opts: { keywords?: string[]; weapons?: Weapon[] } = {},
): GameState {
  return applyEvent(s, {
    type: "unit/add",
    unit: {
      id,
      owner,
      name: id,
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: {
        keywords: opts.keywords ?? ["INFANTRY"],
        abilities: [],
        weapons: Object.fromEntries((opts.weapons ?? [gun(), blade]).map((w) => [w.id, w])),
      },
    },
    models,
  });
}

function forty(
  mine: { weapons?: Weapon[]; keywords?: string[]; chars?: Record<string, string> } = {},
  theirs = true,
) {
  let s = join("forty-k-11");
  s = squad(
    s,
    "mine",
    "p1",
    [trooper("m1", "p1", 0, 0, mine.chars), trooper("m2", "p1", 1.5, 0, mine.chars)],
    mine,
  );
  return theirs ? squad(s, "theirs", "p2", [trooper("t1", "p2", 0, 10), trooper("t2", "p2", 1.5, 10)]) : s;
}

/** A wall between the two squads, so neither sees the other. */
const wall = (s: GameState) =>
  applyEvent(s, {
    type: "layout/set",
    layout: { terrain: [makePiece("Container", "c", { x: 0.75, y: 5 })], objectives: [], zones: [] },
  });

const setStatus = (s: GameState, unitId: string, status: Record<string, boolean>): GameState => ({
  ...s,
  units: { ...s.units, [unitId]: { ...s.units[unitId]!, status: { ...s.units[unitId]!.status, ...status } } },
});

/** A player's army with one stratagem, taught as a player would (#53). */
function withArmy(
  s: GameState,
  player: PlayerId,
  strat: Omit<ArmyStratagem, "text" | "auto" | "targetsUnit"> & { teaching: Teaching },
): GameState {
  const { teaching, ...rest } = strat;
  const auto = teach(teaching, systemOf(s))!;
  return applyEvent(s, {
    type: "player/army",
    player,
    army: { rules: [], stratagems: [{ ...rest, text: "", targetsUnit: true, auto }] },
  });
}

function editWeapon(s: GameState, unitId: string, weapon: string, chars: Record<string, string>): GameState {
  const u = s.units[unitId]!;
  const w = u.sheet!.weapons[weapon]!;
  const weapons = { ...u.sheet!.weapons, [weapon]: { ...w, chars: { ...w.chars, ...chars } } };
  return { ...s, units: { ...s.units, [unitId]: { ...u, sheet: { ...u.sheet!, weapons } } } };
}

const took = (m: BotMove | null) =>
  m?.intent.type === "action/take"
    ? {
        unit: m.intent.unitId,
        action: m.intent.action,
        weapon: m.intent.weapon,
        target: m.intent.targetId,
        more: m.intent.more,
      }
    : null;

describe("the computer opponent plays #57's rules (#58)", () => {
  it("shoots an Indirect Fire weapon at a unit it can't see, and nothing else at it", () => {
    const hidden = goTo(
      wall(forty({ weapons: [gun(["Indirect Fire"], { A: "10" }), blade] })),
      "shooting",
      0,
    );
    for (const level of ["steady", "sharp"] as const)
      expect(took(decide(hidden, 0, level))).toMatchObject({
        action: "shoot",
        weapon: "gun",
        target: "theirs",
      });
    // An ordinary gun has nothing to shoot at behind the wall.
    const plain = goTo(wall(forty()), "shooting", 0);
    expect(took(decide(plain, 0))).toBeNull();
  });

  it("weighs Indirect Fire's penalty: a target in sight before an equal one out of it", () => {
    let s = forty({ weapons: [gun(["Indirect Fire"], { A: "20" })] }, false);
    // Two tough enemy squads, one behind the wall and one in the open.
    s = squad(s, "seen", "p2", [trooper("s1", "p2", 8, 0, { W: "30" })]);
    s = squad(s, "unseen", "p2", [trooper("u1", "p2", 0.75, 10, { W: "30" })]);
    s = goTo(wall(s), "shooting", 0);
    expect(actionTargets(s, "mine", "shoot", "gun").map((t) => [t.unitId, t.ok])).toEqual(
      expect.arrayContaining([
        ["seen", true],
        ["unseen", true],
      ]),
    );
    expect(took(decide(s, 0, "sharp"))).toMatchObject({ weapon: "gun", target: "seen" });
  });

  it("picks its fights in the 40k fight order: Fights First, then the player whose turn it isn't", () => {
    let s = goTo(forty(), "fight", 0);
    s = applyEvent(s, {
      type: "models/move",
      moves: [
        { id: "t1", to: { x: 0, y: 1.4 } },
        { id: "t2", to: { x: 1.5, y: 1.4 } },
      ],
    });
    // Nobody charged: p2, whose turn it isn't, picks first; p1 lets them.
    expect(took(decide(s, 1))).toMatchObject({ unit: "theirs", action: "fight" });
    expect(decide(s, 0)).toBeNull();
    // A unit that charged fights first.
    const charged = setStatus(s, "mine", { charged: true });
    expect(took(decide(charged, 0))).toMatchObject({ unit: "mine", action: "fight" });
    expect(decide(charged, 1)).toBeNull();
  });

  it("weighs a Hazardous weapon's expected harm to its own bearer", () => {
    const lone = (keywords: string[]) => {
      let s = join("forty-k-11");
      s = squad(s, "mine", "p1", [trooper("m1", "p1", 0, 0, { W: "3" })], {
        keywords: ["INFANTRY", "CHARACTER"],
        weapons: [gun(keywords, { A: "3" })],
      });
      s = squad(s, "theirs", "p2", [trooper("t1", "p2", 0, 10), trooper("t2", "p2", 1.5, 10)]);
      // Most of the enemy army is far off: a model of theirs is a tenth of it, the Character all of ours.
      s = squad(s, "far", "p2", [trooper("f1", "p2", 0, -20, { W: "8" })]);
      return goTo(s, "shooting", 0);
    };
    // Worth a shot with an ordinary gun...
    expect(took(decide(lone([]), 0, "steady", { tries: 12 }))).toMatchObject({
      action: "shoot",
      weapon: "gun",
    });
    // ...but not a one-in-three chance of three mortal wounds on the Character, however its own
    // few tries of the roll come out.
    for (let seed = 1; seed <= 6; seed++)
      expect(took(decide(lone(["Hazardous"]), 0, "steady", { seed }))).toBeNull();
  });

  it("spends CP on a stratagem a player taught it (#53), before its unit shoots", () => {
    let s = forty({ weapons: [gun([], { A: "10", BS: "5+" })] });
    s = withArmy(s, "p1", {
      id: "steady-aim",
      name: "Steady Aim",
      cp: 1,
      side: "active",
      phases: ["shooting"],
      teaching: {
        when: { kind: "attacks", weapon: "ranged" },
        who: { kind: "self" },
        what: [{ kind: "modify", roll: "hit", by: 1 }],
      },
    });
    s = goTo(s, "shooting", 0);
    s = applyEvent(s, { type: "resource/adjust", player: "p1", resource: "CP", delta: 3 });
    const m = decide(s, 0, "steady", { tries: 8 });
    expect(m?.intent).toMatchObject({
      type: "player/action",
      action: "army:p1:steady-aim",
      targetId: "mine",
    });
  });

  it("spends CP on a faction pack's stratagem (#76) the same way, before its unit shoots", () => {
    let s = forty({ weapons: [gun([], { A: "10", BS: "5+" })] });
    const { pack } = readFactionPack(cinderCourt) as ReadPack;
    const ref = { id: "example.cinder-court", name: "Cinder Court", version: "1.0.0", hash: "cc", bytes: 1 };
    const listed = {
      name: "Mine",
      units: [],
      army: { detachment: "Cinder Court", rules: [], stratagems: [] },
      warnings: [],
    };
    const army = applyPack(listed, pack, ref, systemOf(s)).roster.army!;
    s = applyEvent(s, { type: "player/army", player: "p1", army });
    s = goTo(s, "shooting", 0);
    s = applyEvent(s, { type: "resource/adjust", player: "p1", resource: "CP", delta: 3 });
    expect(decide(s, 0, "steady", { tries: 8 })?.intent).toMatchObject({
      type: "player/action",
      action: "army:p1:banked-embers",
      targetId: "mine",
    });
  });

  it("uses a taught stratagem that protects a unit under attack in the enemy's turn, when it's worth its CP", () => {
    const attacked = (chars: Record<string, string>) => {
      let s = forty({ chars: { W: "3" } });
      s = withArmy(s, "p1", {
        id: "shield",
        name: "Shield Wall",
        cp: 1,
        side: "inactive",
        teaching: { when: { kind: "attacks" }, who: { kind: "self" }, what: [{ kind: "invuln", x: 4 }] },
      });
      s = goTo(s, "shooting", 1);
      s = applyEvent(s, { type: "resource/adjust", player: "p1", resource: "CP", delta: 3 });
      s = editWeapon(s, "theirs", "gun", chars);
      return play(
        s,
        { type: "action/take", unitId: "theirs", action: "shoot", weapon: "gun", targetId: "mine" },
        "p2",
      );
    };
    // A heavy gun, armour-piercing: a 4+ invulnerable save is worth a CP.
    const heavy = attacked({ A: "4", S: "8", AP: "-3", D: "2" });
    expect(heavy.procedure?.targetId).toBe("mine");
    expect(decide(heavy, 0)?.intent).toMatchObject({
      type: "player/action",
      action: "army:p1:shield",
      targetId: "mine",
    });
    // Against a gun that can't pierce the armour, it isn't.
    expect(decide(attacked({ A: "4", S: "3", AP: "0" }), 0)?.intent.type).not.toBe("player/action");
  });
});

// --- Full Spectrum Dominance -----------------------------------------------------

function fsdTable(): GameState {
  let s = join("fsd-1.7");
  s = play(s, { type: "layout/set", layout: { ...fsdLayout(), terrain: [] } }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(s, p, fsdSample(seat).units, p, "army")) s = play(s, i, p);
  // Everything parked far apart, out of reach: only the units a test places matter.
  let x = -20;
  for (const u of Object.values(s.units)) {
    s = place(s, u.id, x, u.owner === "p1" ? 20 : -20);
    x += 6;
  }
  return s;
}

const unitNamed = (s: GameState, name: string, owner: string) =>
  Object.values(s.units).find((u) => u.name === name && u.owner === owner)!.id;

/** A unit's bases in a row from (x, y), 1.5" apart; `facing` in radians (0 looks along +y). */
function place(s: GameState, unitId: string, x: number, y: number, facing?: number): GameState {
  let next = s;
  s.units[unitId]!.modelIds.forEach((id, i) => {
    next = applyEvent(next, {
      type: "model/move",
      id,
      to: { x: x + i * 1.5, y },
      facing: facing ?? s.models[id]!.facing,
    });
  });
  return next;
}

/** Into the activations, p1 to act first. */
function fsdActivations(s: GameState): GameState {
  for (let i = 0; i < 6 && currentSlot(s)?.kind !== "alternate"; i++) {
    s = play(s, { type: "turn/next" }, "p1");
    if (s.rolledOff?.chooses && s.turn.firstSeat !== 0)
      s = applyEvent({ ...s, seq: s.seq + 1 }, { type: "turn/first", seat: 0 });
  }
  return s;
}

describe("the computer opponent in Full Spectrum Dominance (#58)", () => {
  it("shares out a multiple attack (x2) between targets instead of spending both on one", () => {
    let s = fsdTable();
    const tank = unitNamed(s, "Lancer Tank", "p1");
    const a = unitNamed(s, "Raider Gang", "p2");
    const b = unitNamed(s, "Raider Gang B", "p2");
    // Only its machine gun, firing twice, hard enough to finish a lone base.
    const u = s.units[tank]!;
    const mg = {
      ...u.sheet!.weapons["coax-mg"]!,
      chars: { ...u.sheet!.weapons["coax-mg"]!.chars, x: "x2", Attack: "8d6", AP: "2" },
    };
    s = { ...s, units: { ...s.units, [tank]: { ...u, sheet: { ...u.sheet!, weapons: { "coax-mg": mg } } } } };
    s = place(s, tank, 0, 6, Math.PI);
    // Two gangs down to their last base each.
    s = place(s, a, -3, 0);
    s = place(s, b, 3, 0);
    for (const id of [...s.units[a]!.modelIds.slice(1), ...s.units[b]!.modelIds.slice(1)])
      s = { ...s, models: { ...s.models, [id]: { ...s.models[id]!, destroyed: true } } };
    s = fsdActivations(s);
    s = play(s, { type: "action/take", unitId: tank, action: "activate" }, "p1");
    const fire = took(decide(s, 0, "steady", { tries: 4 }));
    expect(fire).toMatchObject({ action: "fire", weapon: "coax-mg" });
    expect([fire!.target, ...(fire!.more ?? [])].sort()).toEqual([a, b].sort());
  });

  it("moves around terrain its unit type can't cross, and counts what crossing costs", () => {
    let s = fsdTable();
    const tank = unitNamed(s, "Lancer Tank", "p1");
    const squad = unitNamed(s, "Rifle Squad", "p1");
    const foe = unitNamed(s, "Raider Gang", "p2");
    const rock = makePiece("Ruin", "rock", { x: -20, y: 3 }, 0, "impassable");
    const wall = makePiece("Barricade", "wall", { x: 20, y: 0 }, 0, "traversable");
    s = { ...s, terrain: [rock, wall] };
    // The tank behind the rock from a gang, the squad behind the wall from another.
    s = place(s, tank, -20, 10, Math.PI);
    s = place(s, foe, -20, -6);
    s = place(s, squad, 18.5, 4, Math.PI);
    s = place(s, unitNamed(s, "Raider Gang B", "p2"), 18.5, -6);
    const after = (m: BotMove, unitId: string) => {
      if (m.intent.type !== "models/move") throw new Error(m.intent.type);
      const moved = { ...s.models };
      for (const x of m.intent.moves)
        moved[x.id] = { ...moved[x.id]!, phaseStart: moved[x.id]!.position, position: x.to };
      const far = Math.max(
        ...m.intent.moves.map((x) =>
          Math.hypot(x.to.x - s.models[x.id]!.position.x, x.to.y - s.models[x.id]!.position.y),
        ),
      );
      return {
        terrain: terrainOnMove({ ...s, models: moved }, systemOf(s), s.units[unitId]!),
        far,
      };
    };
    const tankMoves = destinations(s, s.units[tank]!, 12);
    expect(tankMoves.length).toBeGreaterThan(0);
    for (const m of tankMoves) expect(after(m, tank).terrain.blocked).toEqual([]);
    // Infantry crosses the wall, for 1 DU (3") of its 6".
    const squadMoves = destinations(s, s.units[squad]!, 6);
    expect(squadMoves.length).toBeGreaterThan(0);
    for (const m of squadMoves) {
      const { terrain, far } = after(m, squad);
      expect(terrain.blocked).toEqual([]);
      if (terrain.slowed) expect(far).toBeLessThanOrEqual(3.05);
    }
  });
});

// --- Conquest -----------------------------------------------------------------

function conquestTable(): GameState {
  let s = join("conquest-hand");
  s = play(s, { type: "layout/set", layout: { ...conquestLayout(), terrain: [] } }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(s, p, conquestSample(seat).units, p, "army")) s = play(s, i, p);
  return s;
}

const named = (s: GameState, name: string) => Object.values(s.units).find((u) => u.name === name)!.id;

/** Slide a block so its front edge sits `gap` inches from the centre line, centred on x = 0. */
function toCentre(s: GameState, unitId: string, gap: number): GameState {
  const ms = s.units[unitId]!.modelIds.map((id) => s.models[id]!);
  const xs = ms.map((m) => m.position.x);
  const ys = ms.map((m) => m.position.y);
  const dx = -(Math.min(...xs) + Math.max(...xs)) / 2;
  const dy = ms[0]!.owner === "p1" ? gap + 0.79 - Math.min(...ys) : -gap - 0.79 - Math.max(...ys);
  return applyEvent(s, {
    type: "models/move",
    moves: ms.map((m) => ({ id: m.id, to: { x: m.position.x + dx, y: m.position.y + dy } })),
  });
}

/** The Warden Guard (p1) facing the Thrall Host (p2) `gap` * 2 inches apart, the Guard activated. */
function guardFacing(gap: number, turned = false) {
  let s = conquestTable();
  const guard = named(s, "Warden Guard");
  const thralls = named(s, "Thrall Host");
  s = toCentre(s, guard, gap);
  s = toCentre(s, thralls, gap);
  if (turned) {
    const models = { ...s.models };
    for (const id of s.units[guard]!.modelIds)
      models[id] = { ...models[id]!, facing: models[id]!.facing + Math.PI };
    s = { ...s, models };
  }
  s = play(s, { type: "turn/next" }, "p1");
  s = play(s, { type: "turn/next" }, "p1");
  if (s.turn.activeSeat !== 0) s = play(s, { type: "turn/pass" }, "p2");
  s = play(s, { type: "action/take", unitId: guard, action: "activate" }, "p1");
  // Its command stack for the round, locked in first (the bot's own secret orders).
  for (let m = decide(s, 0); m?.intent.type === "secret/commit"; m = decide(s, 0))
    s = play(s, m.intent, m.as);
  return { s, guard, thralls };
}

describe("the computer opponent in Conquest (#58)", () => {
  it("charges an enemy in its front arc and in sight, rolls, and lands the charge when the roll reaches", () => {
    const { s, guard, thralls } = guardFacing(1.5);
    expect(actionTargets(s, guard, "charge").find((t) => t.unitId === thralls)?.ok).toBe(true);
    const charge = decide(s, 0);
    expect(charge?.intent).toMatchObject({
      type: "action/take",
      unitId: guard,
      action: "charge",
      targetId: thralls,
    });
    expect(charge?.then?.intent).toMatchObject({ type: "dice/roll", label: "charge", unitId: guard });
    // A 6: it reaches, and the charge move comes next, into contact (Inspired, landed).
    let t = play(s, charge!.intent, "p1");
    t = play(t, charge!.then!.intent, "p1", () => 0.99);
    const land = decide(t, 0);
    expect(land?.intent).toMatchObject({ type: "unit/move", id: guard, how: "charge" });
    t = play(t, land!.intent, "p1");
    expect(t.units[guard]?.status?.inspired).toBe(true);
    expect(t.modules?.["conquest-hand"]?.[`landed:${guard}`]).toBe(t.turn.round);
  });

  it("doesn't charge an enemy behind it", () => {
    const { s } = guardFacing(1.5, true);
    const m = decide(s, 0);
    expect(m?.intent.type === "action/take" && m.intent.action).not.toBe("charge");
  });

  it("marches to face where it goes, or the nearest enemy, so it can charge next", () => {
    const { s, guard, thralls } = guardFacing(6, true);
    const moves = destinations(s, s.units[guard]!, 5);
    expect(moves.every((m) => m.intent.type === "unit/move")).toBe(true);
    const ends = moves.map((m) => applyEvent(s, m.intent as never));
    expect(ends.some((t) => inArc(t, t.units[guard]!, t.units[thralls]!) === "front")).toBe(true);
  });

  it("volleys all round with Fluid Formation, at enemies behind it it couldn't otherwise shoot (#66)", () => {
    const volleyed = (rules: string[]) => {
      let s = conquestTable();
      const bows = named(s, "Ironmarch Crossbows");
      const thralls = named(s, "Thrall Host");
      s = toCentre(s, bows, 4);
      s = toCentre(s, thralls, 4);
      const models = { ...s.models };
      for (const id of s.units[bows]!.modelIds)
        models[id] = { ...models[id]!, facing: models[id]!.facing + Math.PI };
      const u = s.units[bows]!;
      s = {
        ...s,
        models,
        units: {
          ...s.units,
          [bows]: { ...u, sheet: { ...u.sheet!, abilities: rules.map((name) => ({ name, text: "" })) } },
        },
      };
      s = play(s, { type: "turn/next" }, "p1");
      s = play(s, { type: "turn/next" }, "p1");
      if (s.turn.activeSeat !== 0) s = play(s, { type: "turn/pass" }, "p2");
      s = play(s, { type: "action/take", unitId: bows, action: "activate" }, "p1");
      for (let m = decide(s, 0); m?.intent.type === "secret/commit"; m = decide(s, 0))
        s = play(s, m.intent, m.as);
      const m = decide(s, 0);
      return m?.intent.type === "action/take" && m.intent.action === "volley";
    };
    expect(volleyed(["Fluid Formation"])).toBe(true);
    expect(volleyed([])).toBe(false);
  });

  it("Sharp stacks its command cards with the regiment nearest the enemy last, to answer the enemy's moves", () => {
    let s = conquestTable();
    const guard = named(s, "Warden Guard");
    s = toCentre(s, guard, 1);
    s = play(s, { type: "turn/next" }, "p1");
    s = play(s, { type: "turn/next" }, "p1");
    const kept = new Map();
    const player = Object.values(s.players).find((p) => p.seat === 0)!.id;
    const m = botPolicy("sharp", s, 0, { seed: 1, kept }).move(createRecord(s), s, { seat: 0, player });
    expect(m?.intent.type).toBe("secret/commit");
    const order = (m!.intent as unknown as { secrets: { commitment: string }[] }).secrets.map(
      (c) => kept.get(c.commitment)?.value,
    );
    expect(order.length).toBeGreaterThan(1);
    expect(order.at(-1)).toBe(guard);
  });
});

describe("the computer opponent and Random Movement (#66)", () => {
  it('reads a Movement of "2D6+1" as its average (8"), not 2', () => {
    const s = conquestTable();
    const u = s.units[named(s, "Iron Riders")]!;
    const withM = (m: string): GameState => {
      const models = { ...s.models };
      for (const id of u.modelIds) {
        const was = models[id]!;
        models[id] = { ...was, profile: { ...was.profile!, chars: { ...was.profile!.chars, M: m } } };
      }
      return { ...s, models };
    };
    expect(moveInches(withM("2D6+1"), u)).toBe(8);
    expect(moveInches(withM("3D6"), u)).toBe(10.5);
    expect(moveInches(withM("8"), u)).toBe(8);
  });
});
