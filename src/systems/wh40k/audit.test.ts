import { describe, expect, it } from "vitest";
import { playerActions } from "../../core/content/player";
import "../index";
import {
  applyEvent,
  createInitialState,
  currentSlot,
  previewAttack,
  resolveIntent,
  type GameState,
  type Intent,
  type Model,
  type Ability,
  type PlayerId,
  type UnitSheet,
} from "../../core";
import { actionTargets, unitActions } from "../../core/content/play";
import { abilityReminders, attackReminders } from "../../core/content/player";
import { wh40kChecks } from "./checks";
import { makePiece } from "./layout";
import { WH40K_MISSIONS } from "./missions";
import { getSystem } from "../../core/content";

function play(state: GameState, intent: Intent, from: PlayerId): GameState {
  const event = resolveIntent(intent, from, () => 0.5, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  return applyEvent({ ...state, seq: state.seq + 1 }, event);
}

const model = (
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
  weapons: ["gun", "pistol", "blade"],
});

type Weapon = UnitSheet["weapons"][string];
const gun = (keywords: string[] = [], chars: Record<string, string> = {}): Weapon => ({
  id: "gun",
  name: "Gun",
  kind: "ranged",
  chars: { RANGE: '24"', A: "2", BS: "3+", S: "4", AP: "0", D: "1", ...chars },
  keywords,
});

function addUnit(
  s: GameState,
  id: string,
  owner: string,
  models: Model[],
  opts: { keywords?: string[]; gun?: Weapon; abilities?: Ability[] } = {},
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
        abilities: opts.abilities ?? [],
        weapons: {
          gun: opts.gun ?? gun(),
          pistol: { ...gun(["Pistol"]), id: "pistol", name: "Pistol" },
          blade: {
            id: "blade",
            name: "Blade",
            kind: "melee",
            chars: { RANGE: "Melee", A: "2", WS: "3+", S: "4", AP: "0", D: "1" },
            keywords: [],
          },
        },
      },
    },
    models,
  });
}

/** Two players, a unit each 10" apart. */
function setup(opts: { keywords?: string[]; gun?: Weapon; abilities?: Ability[] } = {}): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system: "forty-k-11" }, "p1");
  s = addUnit(s, "mine", "p1", [model("m1", "p1", 0, 0), model("m2", "p1", 1.5, 0)], opts);
  s = addUnit(s, "theirs", "p2", [model("t1", "p2", 0, 10), model("t2", "p2", 1.5, 10)]);
  return s;
}

function goTo(s: GameState, phase: string, seat: number): GameState {
  for (let i = 0; i < 40; i++) {
    if (s.turn.round > 0 && currentSlot(s)?.id === phase && s.turn.activeSeat === seat) return s;
    s = play(s, { type: "turn/next" }, "p1");
  }
  throw new Error(`never reached ${phase}`);
}

const moveTo = (s: GameState, id: string, x: number, y: number) =>
  applyEvent(s, { type: "models/move", moves: [{ id, to: { x, y } }] });

/** Bring the enemy into base contact. */
const engage = (s: GameState) => moveTo(moveTo(s, "t1", 0, 1.4), "t2", 1.5, 1.4);

const action = (s: GameState, unit: string, id: string, req: { weapon?: string; targetId?: string } = {}) =>
  unitActions(s, unit, req).find((o) => o.def.id === id);

const take = (s: GameState, unitId: string, id: string, by = "p1") =>
  play(s, { type: "action/take", unitId, action: id } as Intent, by);

const setStatus = (s: GameState, unitId: string, status: Record<string, boolean>): GameState => ({
  ...s,
  units: { ...s.units, [unitId]: { ...s.units[unitId]!, status: { ...s.units[unitId]!.status, ...status } } },
});

const hitMod = (s: GameState, sight = { cover: false, higherGround: false }) =>
  previewAttack(s, "mine", "gun", "theirs", sight)!.spec.hitMod;

describe("40k audit: Fight phase moves (#55)", () => {
  it("warns when a pile in or consolidation ends further from the closest enemy", () => {
    let s = goTo(setup(), "fight", 0);
    s = moveTo(moveTo(s, "t1", 0, 4), "t2", 1.5, 4);
    s = goTo(s, "fight", 0);
    const warned = (st: GameState) => wh40kChecks({ state: st } as never).some((w) => w.id === "pileIn");
    expect(warned(moveTo(s, "m1", 0, 2))).toBe(false);
    expect(warned(moveTo(s, "m1", 0, -2))).toBe(true);
  });
});

describe("40k audit: stratagems for unengaged units (#55)", () => {
  it("Fire Overwatch doesn't pick a unit engaged with the enemy", () => {
    const s = goTo(setup(), "movement", 1);
    const targets = (st: GameState) =>
      playerActions(st, "p1").find((o) => o.def.id === "fireOverwatch")?.targets ?? [];
    expect(targets(s)).toContain("mine");
    expect(targets(engage(s))).not.toContain("mine");
  });
});

describe("40k audit: Crushing Impact (#55)", () => {
  it("is offered only for a Monster or Vehicle that has charged", () => {
    let s = goTo(setup({ keywords: ["VEHICLE"] }), "charge", 0);
    const targets = (st: GameState) =>
      playerActions(st, "p1").find((o) => o.def.id === "tankShock")?.targets ?? [];
    expect(targets(s)).not.toContain("mine");
    s = setStatus(s, "mine", { charged: true });
    expect(targets(s)).toContain("mine");
  });
});

describe("40k audit: Movement phase", () => {
  it("offers Fall Back only when engaged, and Normal move and Advance only when not", () => {
    const free = goTo(setup(), "movement", 0);
    expect(action(free, "mine", "normalMove")?.ok).toBe(true);
    expect(action(free, "mine", "advance")?.ok).toBe(true);
    expect(action(free, "mine", "fallBack")?.ok).toBe(false);
    const engaged = engage(free);
    expect(action(engaged, "mine", "normalMove")?.ok).toBe(false);
    expect(action(engaged, "mine", "advance")?.ok).toBe(false);
    expect(action(engaged, "mine", "fallBack")?.ok).toBe(true);
  });

  it("makes one move a turn: Remain stationary, Normal move or Advance", () => {
    const s = goTo(setup(), "movement", 0);
    const moved = take(s, "mine", "normalMove");
    expect(action(moved, "mine", "advance")?.why).toBe("Already moved this turn");
    expect(action(moved, "mine", "remainStationary")?.why).toBe("Already moved this turn");
    expect(action(take(s, "mine", "remainStationary"), "mine", "normalMove")?.why).toBe(
      "Already moved this turn",
    );
    // A new turn, a new move.
    expect(action(goTo(goTo(moved, "movement", 1), "movement", 0), "mine", "advance")?.ok).toBe(true);
  });

  it("a unit that Fell Back neither shoots nor charges", () => {
    let s = take(engage(goTo(setup(), "movement", 0)), "mine", "fallBack");
    s = moveTo(moveTo(s, "m1", 0, -3), "m2", 1.5, -3);
    s = goTo(s, "shooting", 0);
    expect(action(s, "mine", "shoot", { weapon: "gun", targetId: "theirs" })?.ok).toBe(false);
    s = goTo(s, "charge", 0);
    expect(action(s, "mine", "charge")?.ok).toBe(false);
  });

  it('lists charge targets within 12" as ok, and those further away with a reason', () => {
    const s = goTo(setup(), "charge", 0);
    // 10" apart, centre to centre: in reach.
    expect(actionTargets(s, "mine", "charge")).toMatchObject([{ unitId: "theirs", ok: true }]);
    const far = goTo(moveTo(moveTo(s, "t1", 0, 20), "t2", 1.5, 20), "charge", 0);
    expect(actionTargets(far, "mine", "charge")).toMatchObject([
      { unitId: "theirs", ok: false, why: 'Further than 12"' },
    ]);
  });

  it("a unit that Advanced can't charge", () => {
    const s = goTo(setup(), "movement", 0);
    expect(action(goTo(s, "charge", 0), "mine", "charge")?.ok).toBe(true);
    expect(action(goTo(take(s, "mine", "advance"), "charge", 0), "mine", "charge")?.ok).toBe(false);
  });

  it("warns when a unit moves further than its allowance", () => {
    let s = goTo(setup(), "movement", 0);
    s = take(s, "mine", "normalMove");
    s = moveTo(moveTo(s, "m1", 0, -5), "m2", 1.5, -5);
    expect(wh40kChecks({ state: s } as never).filter((w) => w.id === "moveDistance")).toEqual([]);
    s = moveTo(moveTo(s, "m1", 0, -8), "m2", 1.5, -8);
    expect(wh40kChecks({ state: s } as never).find((w) => w.id === "moveDistance")?.unitId).toBe("mine");
  });

  it("warns when reserves arrive in the first battle round or within 9 inches of an enemy", () => {
    let s = setup();
    s = play(s, { type: "unit/reserve", id: "mine", reserve: true }, "p1");
    s = goTo(s, "movement", 0);
    const arrive = (st: GameState, y: number) =>
      play(
        st,
        {
          type: "unit/reserve",
          id: "mine",
          reserve: false,
          moves: [
            { id: "m1", to: { x: 0, y } },
            { id: "m2", to: { x: 1.5, y } },
          ],
        },
        "p1",
      );
    const ids = (st: GameState) => wh40kChecks({ state: st } as never).map((w) => w.id);
    expect(ids(arrive(s, -10))).toContain("reservesRound");
    expect(ids(arrive(s, -10))).not.toContain("deepStrike");
    expect(ids(arrive(s, 5))).toContain("deepStrike");
    const later = goTo(s, "movement", 1);
    const round2 = goTo(later, "movement", 0);
    expect(round2.turn.round).toBe(2);
    expect(ids(arrive(round2, -10))).not.toContain("reservesRound");
  });
});

describe("40k audit: Shooting phase", () => {
  it("an engaged unit shoots only Pistols, unless it is a Monster or Vehicle", () => {
    const s = engage(goTo(setup(), "shooting", 0));
    expect(action(s, "mine", "shoot", { weapon: "gun", targetId: "theirs" })?.why).toBe(
      "Engaged: only Pistols",
    );
    expect(action(s, "mine", "shoot", { weapon: "pistol", targetId: "theirs" })?.why).not.toBe(
      "Engaged: only Pistols",
    );
    const tank = engage(goTo(setup({ keywords: ["VEHICLE"] }), "shooting", 0));
    expect(action(tank, "mine", "shoot", { weapon: "gun", targetId: "theirs" })?.why).not.toBe(
      "Engaged: only Pistols",
    );
  });

  it("targets only visible units", () => {
    let s = goTo(setup(), "shooting", 0);
    expect(actionTargets(s, "mine", "shoot").find((t) => t.unitId === "theirs")?.ok).toBe(true);
    s = applyEvent(s, {
      type: "layout/set",
      layout: { terrain: [makePiece("Container", "c", { x: 0.75, y: 5 })], objectives: [], zones: [] },
    });
    expect(actionTargets(s, "mine", "shoot").find((t) => t.unitId === "theirs")?.ok).toBe(false);
  });

  it("Heavy: +1 to hit only if the unit didn't move this turn", () => {
    const base = goTo(setup({ gun: gun(["Heavy"]) }), "movement", 0);
    expect(hitMod(goTo(base, "shooting", 0))).toBe(1);
    expect(hitMod(goTo(take(base, "mine", "remainStationary"), "shooting", 0))).toBe(1);
    expect(hitMod(goTo(take(base, "mine", "normalMove"), "shooting", 0))).toBe(0);
    expect(hitMod(goTo(take(base, "mine", "advance"), "shooting", 0))).toBe(0);
    // Moved by hand, without taking a move action.
    const byHand = play(base, { type: "models/move", moves: [{ id: "m1", to: { x: 0, y: -2 } }] }, "p1");
    expect(hitMod(goTo(byHand, "shooting", 0))).toBe(0);
    // The flag clears when the unit's next turn begins.
    const moved = goTo(take(base, "mine", "normalMove"), "shooting", 0);
    expect(hitMod(goTo(moved, "shooting", 1))).toBe(0);
    expect(hitMod(goTo(goTo(moved, "shooting", 1), "shooting", 0))).toBe(1);
  });

  it("Heavy: a unit set up from reserves this turn counts as having moved", () => {
    let s = setup({ gun: gun(["Heavy"]) });
    s = play(s, { type: "unit/reserve", id: "mine", reserve: true }, "p1");
    s = goTo(s, "movement", 0);
    s = play(
      s,
      {
        type: "unit/reserve",
        id: "mine",
        reserve: false,
        moves: [
          { id: "m1", to: { x: 0, y: -10 } },
          { id: "m2", to: { x: 1.5, y: -10 } },
        ],
      },
      "p1",
    );
    expect(hitMod(goTo(s, "shooting", 0))).toBe(0);
  });

  it("cover: Ballistic Skill 1 worse, or +1 to the armour save (not 3+ against AP 0); Ignores Cover cancels it", () => {
    const s = goTo(setup(), "shooting", 0);
    const covered = { cover: true, higherGround: false };
    const hitOn = (st: GameState, sight = { cover: false, higherGround: false }) =>
      previewAttack(st, "mine", "gun", "theirs", sight)!.spec.hit;
    // 11th edition: the skill gets worse, not the roll, so it doesn't count toward the ±1 cap.
    expect(hitOn(s, covered)).toBe(hitOn(s)! + 1);
    expect(hitMod(s, covered)).toBe(0);
    const ignores = goTo(setup({ gun: gun(["Ignores Cover"]) }), "shooting", 0);
    expect(hitOn(ignores, covered)).toBe(hitOn(ignores));
    const bySave = { ...s, settings: { ...s.settings, cover: "save" as const } };
    expect(hitOn(bySave, covered)).toBe(hitOn(bySave));
    // 3+ save against AP 0: no better.
    expect(previewAttack(bySave, "mine", "gun", "theirs", covered)!.spec.save).toBe(3);
    const ap1 = goTo(setup({ gun: gun([], { AP: "-1" }) }), "shooting", 0);
    const ap1Save = { ...ap1, settings: { ...ap1.settings, cover: "save" as const } };
    expect(previewAttack(ap1Save, "mine", "gun", "theirs")!.spec.save).toBe(4);
    expect(previewAttack(ap1Save, "mine", "gun", "theirs", covered)!.spec.save).toBe(3);
  });

  it("higher ground: +1 to hit", () => {
    const s = goTo(setup(), "shooting", 0);
    expect(hitMod(s, { cover: false, higherGround: true })).toBe(1);
  });
});

describe("40k audit: weapon abilities", () => {
  const spec = (keywords: string[], s0?: (s: GameState) => GameState) => {
    let s = goTo(setup({ gun: gun(keywords) }), "shooting", 0);
    if (s0) s = s0(s);
    return previewAttack(s, "mine", "gun", "theirs")!.spec;
  };

  it("Sustained Hits, Lethal Hits and Devastating Wounds", () => {
    expect(spec(["Sustained Hits 2"]).sustained).toBe(2);
    expect(spec([]).sustained).toBe(0);
    expect(spec(["Lethal Hits"]).lethal).toBe(true);
    expect(spec([]).lethal).toBe(false);
    expect(spec(["Devastating Wounds"]).devastating).toBe(true);
  });

  it("Torrent hits automatically", () => {
    expect(spec(["Torrent"]).hit).toBeNull();
    expect(spec([]).hit).toBe(3);
  });

  it("Blast: one more attack per model for every five target models", () => {
    const ten = (s: GameState) =>
      addUnit(
        s,
        "horde",
        "p2",
        Array.from({ length: 10 }, (_, i) =>
          model(`h${i}`, "p2", (i % 5) * 1.5, 12 + Math.floor(i / 5) * 1.5),
        ),
      );
    let s = ten(goTo(setup({ gun: gun(["Blast"]) }), "shooting", 0));
    // 2 models, A2 + 2 each.
    expect(previewAttack(s, "mine", "gun", "horde")!.spec.attacks).toBe("8");
    s = ten(goTo(setup(), "shooting", 0));
    expect(previewAttack(s, "mine", "gun", "horde")!.spec.attacks).toBe("4");
  });

  it("Lance: +1 to wound after a charge", () => {
    expect(spec(["Lance"]).woundMod).toBe(0);
    expect(spec(["Lance"], (s) => setStatus(s, "mine", { charged: true })).woundMod).toBe(1);
  });

  it("Indirect Fire, Pistol, Precision, Extra Attacks and Hazardous are reminders", () => {
    for (const k of ["Indirect Fire", "Pistol", "Precision", "Extra Attacks", "Hazardous"]) {
      const s = goTo(setup({ gun: gun([k]) }), "shooting", 0);
      expect(previewAttack(s, "mine", "gun", "theirs")!.reminders).toContain(k);
    }
  });
});

describe("40k audit: Fight phase", () => {
  it("a unit engaged with the enemy may fight, even in the opponent's turn and without charging", () => {
    const s = goTo(setup(), "fight", 0);
    expect(action(s, "theirs", "fight")?.ok).toBe(false);
    expect(action(engage(s), "theirs", "fight")?.ok).toBe(true);
    expect(action(engage(s), "mine", "fight")?.ok).toBe(true);
  });
});

describe("40k audit: Battle-shock", () => {
  it("lasts until the start of the unit's next turn, and Insane Bravery lifts it", () => {
    let s = setStatus(goTo(setup(), "command", 0), "mine", { battleShocked: true });
    expect(goTo(s, "command", 1).units.mine?.status?.battleShocked).toBe(true);
    expect(goTo(goTo(s, "command", 1), "command", 0).units.mine?.status?.battleShocked).toBeUndefined();
    s = play(s, { type: "player/action", action: "insaneBravery", targetId: "mine" }, "p1");
    expect(s.units.mine?.status?.battleShocked).toBeUndefined();
    expect(s.resources.p1?.CP).toBe(0);
  });
});

describe("40k audit: reminders for core abilities", () => {
  it("shows Infiltrators at deployment, Firing Deck when shooting, Fights First when fighting, Deadly Demise when attacked", () => {
    const named = (...names: string[]) => names.map((name) => ({ name, text: "" }));
    let s = setup({ abilities: named("Infiltrators", "Firing Deck 2", "Fights First", "Deadly Demise D3") });
    const now = (st: GameState) => abilityReminders(st).map((r) => r.ability.name);
    expect(now(s)).toContain("Infiltrators");
    s = goTo(s, "shooting", 0);
    expect(now(s)).toContain("Firing Deck 2");
    expect(now(goTo(s, "fight", 0))).toContain("Fights First");
    expect(attackReminders(s, "theirs", "mine", "ranged").map((r) => r.ability.name)).toContain(
      "Deadly Demise D3",
    );
  });
});

describe("40k audit: whose Command phase", () => {
  it("lists a 'your Command phase' rule only in its owner's Command phase (dogfood #54)", () => {
    // Imported rule text can carry non-breaking spaces (BSData).
    const yours = { name: "Rise Again", text: "At the end of your\u00a0Command\u00a0phase, return a model." };
    const theirs = { name: "Spite", text: "In your opponent's Command phase, roll a D6." };
    const s = setup({ abilities: [yours, theirs] });
    const now = (st: GameState) => abilityReminders(st).map((r) => r.ability.name);
    expect(now(goTo(s, "command", 0))).toEqual(["Rise Again"]);
    expect(now(goTo(s, "command", 1))).toEqual(["Spite"]);
  });
});

describe("40k audit: sample mission scoring", () => {
  it("suggests VP for the objectives a side controls", () => {
    let s = setup();
    s = applyEvent(s, {
      type: "layout/set",
      layout: {
        terrain: [],
        zones: [],
        objectives: [
          { id: "centre", position: { x: 0, y: -2 } },
          { id: "west", position: { x: 0, y: 12 } },
        ],
      },
    });
    const crossfire = WH40K_MISSIONS.find((m) => m.id === "crossfire")!;
    expect(crossfire.scoring[0]!.suggest!(s, 0)).toMatchObject({ vp: 5 });
    expect(crossfire.deck!.find((c) => c.id === "seize-centre")!.suggest!(s, 0)).toMatchObject({ vp: 5 });
    expect(crossfire.deck!.find((c) => c.id === "seize-centre")!.suggest!(s, 1)).toMatchObject({ vp: 0 });
  });
});

describe("40k audit: attack sequence and battle length", () => {
  it("loses excess damage: one unsaved wound destroys at most one model", () => {
    let s = goTo(setup(), "shooting", 0);
    const spec = previewAttack(s, "mine", "gun", "theirs")!.spec;
    s = play(
      s,
      { type: "attack/declare", spec: { ...spec, attacks: "1", hit: 2, wound: 2, save: null, damage: "3" } },
      "p1",
    );
    s = play(s, { type: "attack/allocate", order: ["t1", "t2"] }, "p2");
    while (s.attack && s.attack.stage !== "done") s = play(s, { type: "attack/roll" }, "p1");
    expect(s.models.t1?.destroyed).toBe(true);
    expect(s.models.t2?.destroyed ?? false).toBe(false);
  });

  it("lasts five battle rounds", () => {
    expect(getSystem("forty-k-11").turn.rounds).toBe(5);
  });
});
