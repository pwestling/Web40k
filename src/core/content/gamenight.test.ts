import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  currentSlot,
  previewAttack,
  resolveIntent,
  type Ability,
  type GameState,
  type Intent,
  type Model,
  type PlayerId,
} from "../index";
import { getSystem } from "./systems";
import { abilityReminders, attackReminders, manualAbilities, playerActions } from "./player";

/** A seeded rng, so every run rolls the same dice. */
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

const rejected = (state: GameState, intent: Intent, from: PlayerId) =>
  !resolveIntent(intent, from, rng(1), state);

const model = (id: string, owner: string, x: number, y: number, W = "1"): Model => ({
  id,
  owner,
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars: { M: '6"', T: "4", SV: "3+", W, LD: "6+", OC: "1" } },
  weapons: ["gun"],
});

/** Invented abilities in the shape imported rosters use (never real rules text). */
const abilities: Record<string, Ability[]> = {
  sneaks: [
    { name: "Stealth", text: "Harder to hit at range." },
    { name: 'Scouts 6"', text: "Moves before the battle." },
    { name: "Shout Orders", text: "At the start of your Command phase, pick a friendly unit." },
    { name: "Sharp Eyes", text: "Each time a model in this unit makes a ranged attack, do something." },
    { name: "Heavy", text: "Weapons with [HEAVY] get a bonus when stationary." },
  ],
  loner: [
    { name: "Lone Operative", text: "Hard to target from far away." },
    { name: "Leader", text: "This model can be attached to the following units: ■ Sneaks" },
  ],
  troops: [{ name: "Hold Fast", text: "Each time an attack targets this unit, worsen its AP." }],
};

function addUnit(s: GameState, id: string, owner: string, keywords: string[], models: Model[]): GameState {
  return applyEvent(s, {
    type: "unit/add",
    unit: {
      id,
      owner,
      name: id,
      modelIds: [],
      formation: { kind: "skirmish" },
      sheet: {
        keywords,
        abilities: abilities[id] ?? [],
        weapons: {
          gun: {
            id: "gun",
            name: "Gun",
            kind: "ranged",
            chars: { Range: '24"', A: "2", BS: "3+", S: "4", AP: "0", D: "1" },
            keywords: [],
          },
        },
      },
    },
    models,
  });
}

function setup(): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system: "forty-k-11" }, "p1");
  s = addUnit(
    s,
    "sneaks",
    "p1",
    ["INFANTRY", "SMOKE"],
    [model("s1", "p1", 0, -10), model("s2", "p1", 1.5, -10)],
  );
  s = addUnit(s, "loner", "p1", ["INFANTRY", "CHARACTER"], [model("l1", "p1", -10, -10, "4")]);
  s = addUnit(
    s,
    "troops",
    "p2",
    ["INFANTRY", "GRENADES"],
    [model("t1", "p2", 0, 10, "2"), model("t2", "p2", 1.5, 10, "2"), model("t3", "p2", 3, 10, "2")],
  );
  return s;
}

/** Step the turn marker to the named phase of the given seat's turn. */
function goTo(s: GameState, phase: string, seat: number): GameState {
  for (let i = 0; i < 30; i++) {
    if (s.turn.round > 0 && currentSlot(s)?.id === phase && s.turn.activeSeat === seat) return s;
    s = play(s, { type: "turn/next" }, "p1");
  }
  throw new Error(`never reached ${phase}`);
}

describe("40k game night", () => {
  it("offers stratagems by phase and side, spends CP and limits them to once a phase", () => {
    let s = goTo(setup(), "shooting", 0);
    expect(s.resources.p2?.CP).toBe(1);
    const gtg = playerActions(s, "p2").find((o) => o.def.id === "goToGround")!;
    expect(gtg.ok).toBe(true);
    expect(gtg.cost).toBe("1 Command points");
    expect(gtg.targets).toEqual(["troops"]);
    // The active player can't: it's for the opponent's Shooting phase.
    expect(playerActions(s, "p1").find((o) => o.def.id === "goToGround")?.why).toBe(
      "Only in your opponent's turn",
    );
    expect(playerActions(s, "p1").find((o) => o.def.id === "tankShock")?.why).toBe("Not in this phase");

    s = play(s, { type: "player/action", action: "goToGround", targetId: "troops" }, "p2");
    expect(s.resources.p2?.CP).toBe(0);
    expect(s.units.troops?.status?.goneToGround).toBe(true);
    expect(playerActions(s, "p2").find((o) => o.def.id === "goToGround")?.why).toBe(
      "Already used this phase",
    );
    // Gone to ground gives a 6+ invulnerable save against the attack.
    const p = previewAttack(s, "sneaks", "gun", "troops")!;
    expect(p.spec.save).toBe(3);
    // The status lasts until the end of the phase.
    s = play(s, { type: "turn/next" }, "p1");
    expect(s.units.troops?.status?.goneToGround).toBeUndefined();
  });

  it("lets a player name a faction stratagem and its cost", () => {
    let s = goTo(setup(), "movement", 0);
    expect(s.resources.p1?.CP).toBe(1);
    expect(
      rejected(s, { type: "player/action", action: "otherStratagem", label: "Big Plan", cost: 2 }, "p1"),
    ).toBe(true);
    s = play(s, { type: "player/action", action: "otherStratagem", label: "Big Plan", cost: 1 }, "p1");
    expect(s.resources.p1?.CP).toBe(0);
  });

  it("applies Stealth and Lone Operative from ability names", () => {
    const s = goTo(setup(), "shooting", 1);
    const stealthy = previewAttack(s, "troops", "gun", "sneaks")!;
    expect(stealthy.fired.hit).toEqual(["Stealth"]);
    expect(stealthy.members).toHaveLength(3);
    expect(stealthy.spec.hitMod).toBe(-1);
    // The loner stands 21" away: out of reach unless attached.
    expect(previewAttack(s, "troops", "gun", "loner")!.spec.hit).toBe(7);
    const near = applyEvent(s, { type: "models/move", moves: [{ id: "l1", to: { x: 0, y: 0 } }] });
    expect(previewAttack(near, "troops", "gun", "loner")!.spec.hit).toBe(3);
    const attached = play(s, { type: "unit/attach", id: "loner", to: "sneaks" }, "p1");
    expect(attached.units.sneaks?.status?.attached).toBe(true);
  });

  it("lets the defender choose which model takes the wounds", () => {
    let s = goTo(setup(), "shooting", 0);
    s = play(
      s,
      {
        type: "attack/declare",
        spec: {
          ...previewAttack(s, "sneaks", "gun", "troops")!.spec,
          attacks: "6",
          hit: 2,
          wound: 2,
          save: null,
          damage: "1",
        },
      },
      "p1",
    );
    // Only the defender may declare, and only their own models.
    expect(rejected(s, { type: "attack/allocate", order: ["t3", "t1"] }, "p1")).toBe(true);
    expect(rejected(s, { type: "attack/allocate", order: ["s1"] }, "p2")).toBe(true);
    s = play(s, { type: "attack/allocate", order: ["t3", "t2", "t1"] }, "p2");
    const r = rng(3);
    while (s.attack && s.attack.stage !== "done") s = play(s, { type: "attack/roll" }, "p1", r);
    const lost = s.attack!.damage!.map((d) => d.modelId);
    expect(lost[0]).toBe("t3");
    expect(s.models.t3?.destroyed).toBe(true);
  });

  it("reminds players of abilities when their text says they matter, with manual apply", () => {
    let s = setup();
    // Weapon-keyword glossary entries and automated abilities aren't reminders.
    expect(manualAbilities(getSystem("forty-k-11"), s.units.sneaks!).map((a) => a.name)).toEqual([
      "Shout Orders",
      "Sharp Eyes",
    ]);
    s = goTo(s, "command", 0);
    const now = abilityReminders(s).map((r) => r.ability.name);
    expect(now).toContain("Shout Orders");
    expect(now).not.toContain("Stealth");
    expect(now).not.toContain("Heavy");
    s = play(s, { type: "ability/apply", unitId: "sneaks", ability: "Shout Orders" }, "p1");
    expect(abilityReminders(s).find((r) => r.ability.name === "Shout Orders")?.applied).toBe(true);
    // Not in the opponent's Command phase.
    s = goTo(s, "command", 1);
    expect(abilityReminders(s).map((r) => r.ability.name)).not.toContain("Shout Orders");
    // During an attack: the attacker's and the defender's.
    const names = attackReminders(s, "sneaks", "troops", "ranged").map((r) => r.ability.name);
    expect(names).toEqual(["Sharp Eyes", "Hold Fast"]);
    expect(attackReminders(s, "sneaks", "troops", "melee").map((r) => r.ability.name)).toEqual(["Hold Fast"]);
  });

  it("puts deep strikers in reserve off the table and starts scout moves", () => {
    let s = setup();
    s = play(s, { type: "unit/reserve", id: "sneaks", reserve: true }, "p1");
    expect(s.units.sneaks?.status?.reserves).toBe(true);
    expect(Math.abs(s.models.s1!.position.x)).toBeGreaterThan(s.table.width / 2);
    s = play(s, { type: "unit/reserve", id: "sneaks", reserve: false }, "p1");
    expect(s.units.sneaks?.status).toMatchObject({ arrived: true });
    expect(s.units.sneaks?.status?.reserves).toBeUndefined();

    s = play(s, { type: "unit/specialMove", id: "loner", inches: 6, flag: "scouting" }, "p1");
    expect(s.units.loner?.status).toMatchObject({ allowance: 6, scouting: true });
    expect(s.models.l1?.phaseStart).toEqual({ x: -10, y: -10 });
  });
});
