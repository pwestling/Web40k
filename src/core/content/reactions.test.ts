import { describe, expect, it } from "vitest";
import "../../systems";
import {
  applyEvent,
  createInitialState,
  currentSlot,
  previewAttack,
  resolveIntent,
  type GameState,
  type Intent,
  type Model,
  type PlayerId,
} from "../index";
import { createRecord, type GameRecord } from "../log";
import { extendSystem, restoreSystems } from "./systems";
import { botPolicy } from "../../bot/player";
import { fortyK } from "./examples/forty-k";
import {
  mayReact,
  playableReactions,
  reactionHoldUntil,
  reactionWindow,
  type PlayableReaction,
  type ReactionWindowView,
} from "./reactions";

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

/** Like the session: the event is folded into the state before it, then the state takes its seq. */
function play(state: GameState, intent: Intent, from: PlayerId, r: () => number = rng(1)): GameState {
  const event = resolveIntent(intent, from, r, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  return { ...applyEvent(state, event), seq: state.seq + 1 };
}

const model = (id: string, owner: string, x: number, y: number): Model => ({
  id,
  owner,
  label: id,
  position: { x, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars: { M: '6"', T: "4", SV: "3+", W: "1", LD: "6+", OC: "1" } },
  weapons: ["gun"],
});

/** Invented units: no real rules or stats. */
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
        abilities: [],
        weapons: {
          gun: {
            id: "gun",
            name: "Gun",
            kind: "ranged",
            chars: { Range: '24"', A: "2", BS: "3+", S: "4", AP: "0", D: "1" },
            keywords: [],
          },
          blade: {
            id: "blade",
            name: "Blade",
            kind: "melee",
            chars: { Range: "Melee", A: "3", WS: "3+", S: "4", AP: "0", D: "1" },
            keywords: [],
          },
        },
      },
    },
    models,
  });
}

/** Where the units stand: the defaults leave everyone well apart (raiders 20" from the smokers). */
interface Spots {
  smokers?: [number, number];
  plain?: [number, number];
  raiders?: [number, number];
}

function setup(at: Spots = {}): GameState {
  const [sx, sy] = at.smokers ?? [0, -10];
  const [px, py] = at.plain ?? [-10, -10];
  const [rx, ry] = at.raiders ?? [0, 10];
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "Ann", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "Ben", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system: "forty-k-11" }, "p1");
  s = addUnit(
    s,
    "smokers",
    "p1",
    ["INFANTRY", "SMOKE"],
    [model("s1", "p1", sx, sy), model("s2", "p1", sx + 1.5, sy)],
  );
  s = addUnit(s, "plain", "p1", ["INFANTRY"], [model("l1", "p1", px, py)]);
  s = addUnit(s, "raiders", "p2", ["INFANTRY"], [model("t1", "p2", rx, ry), model("t2", "p2", rx + 1.5, ry)]);
  return s;
}

function goTo(s: GameState, phase: string, seat: number): GameState {
  for (let i = 0; i < 30; i++) {
    if (s.turn.round > 0 && currentSlot(s)?.id === phase && s.turn.activeSeat === seat) return s;
    s = play(s, { type: "turn/next" }, "p1");
  }
  throw new Error(`never reached ${phase}`);
}

const declare = (s: GameState, attacker: string, target: string, by: PlayerId, weapon = "gun") =>
  play(s, { type: "attack/declare", spec: previewAttack(s, attacker, weapon, target)!.spec }, by);

/** Set a player's CP to exactly this. */
const cp = (s: GameState, player: PlayerId, n: number) =>
  play(
    s,
    { type: "resource/adjust", player, resource: "CP", delta: n - (s.resources[player]?.CP ?? 0) },
    player,
  );

/** Dice that come up as listed (each 1-6), then 6s. */
function faces(...list: number[]) {
  let i = 0;
  return () => ((list[i++] ?? 6) - 0.5) / 6;
}

const ids = (s: GameState, p: PlayerId) => playableReactions(s, p).map((r) => r.id);

/** Move a unit's models (all, or those listed) by dx, dy in one drag. */
const moveBy = (s: GameState, unit: string, dx: number, dy: number, only?: string[]): Intent => ({
  type: "models/move",
  moves: s.units[unit]!.modelIds.filter((id) => !only || only.includes(id)).map((id) => {
    const at = s.models[id]!.position;
    return { id, to: { x: at.x + dx, y: at.y + dy } };
  }),
});

/** Ann's army gets an invented stratagem answering each enemy move, reaching 9" from the unit that moved. */
const withSidestep = (s: GameState) =>
  play(
    s,
    {
      type: "player/army",
      army: {
        rules: [],
        stratagems: [
          {
            id: "sidestep",
            name: "Sidestep",
            cp: 1,
            side: "inactive",
            phases: ["movement"],
            targetsUnit: true,
            when: "Your opponent's Movement phase, just after an enemy unit ends a Normal, Advance or Fall Back move.",
            target: 'One unit from your army within 9" of that enemy unit.',
            text: "Invented for the test.",
          },
        ],
      },
    },
    "p1",
  );

describe("reaction windows (#80)", () => {
  it("opens targetDeclared for the unit attacked, with Smokescreen on that unit only", () => {
    let s = goTo(setup(), "shooting", 1);
    expect(s.resources.p1?.CP).toBeGreaterThan(0);
    s = declare(s, "raiders", "smokers", "p2");
    const open = reactionWindow(s);
    expect(open).toMatchObject({ window: "targetDeclared", seat: 0, source: "window", blocking: false });
    expect(open?.trigger).toMatchObject({ unitId: "raiders", targetId: "smokers" });
    const smoke = playableReactions(s, "p1").find((r) => r.id === "smokescreen")!;
    expect(smoke).toMatchObject({ units: ["smokers"], needsUnit: true, cost: "1 CP", muted: false });
    expect(smoke.play).toEqual({ type: "player/action", action: "smokescreen" });
    // The attacker sees only that Ann may react, never which card.
    expect(mayReact(s, "p2")).toEqual({ seat: 0, name: "Ann" });
    expect(playableReactions(s, "p2")).toEqual([]);
  });

  it("holds the active side until the opening event's host time plus the hold", () => {
    let s = goTo(setup(), "shooting", 1);
    s = declare(s, "raiders", "smokers", "p2");
    const open: ReactionWindowView | null = reactionWindow(s);
    expect(open?.hold).toBe(6000);
    const record: GameRecord = {
      ...createRecord(),
      events: [{ seq: open!.opened, by: "p2", at: 1000, event: { type: "turn/prev" } }],
    };
    expect(reactionHoldUntil(record, s)).toBe(7000);
    const none: PlayableReaction[] = playableReactions(s, "p2");
    expect(none).toEqual([]);
  });

  it("movementEnded: Fire Overwatch as the enemy's Movement phase ends, only for units in range", () => {
    let s = goTo(setup({ plain: [-28, -20] }), "movement", 1);
    s = cp(s, "p1", 2);
    s = play(s, { type: "action/take", unitId: "raiders", action: "normalMove" }, "p2");
    expect(reactionWindow(s)).toBeNull();
    // Overwatch waits for the end of the phase (11th edition): a whole-unit move opens no window for it.
    s = play(s, moveBy(s, "raiders", 0, -3), "p2");
    expect(reactionWindow(s)).toBeNull();
    s = play(s, { type: "turn/next" }, "p2");
    const open = reactionWindow(s);
    expect(open).toMatchObject({ window: "movementEnded", seat: 0, trigger: { units: ["raiders"] } });
    // Out of range: the plain unit is 40" away from the raiders.
    expect(playableReactions(s, "p1").find((r) => r.id === "fireOverwatch")?.units).toEqual(["smokers"]);
    // Played now, in the Shooting phase, it counts as played as the Movement phase ended.
    s = play(s, { type: "player/action", action: "fireOverwatch", targetId: "smokers" }, "p1");
    expect(s.resources.p1?.CP).toBe(1);
    expect(reactionWindow(s)).toBeNull();
  });

  it("moveEnded: a window as each enemy unit's move ends, for a unit in range of the unit that moved", () => {
    // Raiders 14" from the smokers, 30" from the plain unit; Sidestep reaches 9".
    let s = goTo(setup({ smokers: [0, -4], plain: [-28, -10] }), "movement", 1);
    s = withSidestep(s);
    s = cp(s, "p1", 2);
    s = play(s, { type: "action/take", unitId: "raiders", action: "normalMove" }, "p2");
    expect(reactionWindow(s)).toBeNull();
    // Model by model: the move ends with the last of the unit's models, not the first.
    s = play(s, moveBy(s, "raiders", 0, -5, ["t1"]), "p2");
    expect(reactionWindow(s)).toBeNull();
    s = play(s, moveBy(s, "raiders", 0, -5, ["t2"]), "p2");
    const open = reactionWindow(s);
    expect(open).toMatchObject({ window: "moveEnded", seat: 0, trigger: { unitId: "raiders", seq: s.seq } });
    const side = playableReactions(s, "p1").find((r) => r.name === "Sidestep")!;
    // Only the unit within 9" of the unit that moved; Fire Overwatch isn't offered here.
    expect(side).toMatchObject({ id: "army:p1:sidestep", units: ["smokers"], needsUnit: true });
    expect(ids(s, "p1")).not.toContain("fireOverwatch");
    expect(mayReact(s, "p2")).toEqual({ seat: 0, name: "Ann" });
    // Passed: the same unit straightening up later in the phase isn't asked about again.
    s = play(s, { type: "reaction/pass" }, "p1");
    s = play(s, moveBy(s, "raiders", 0.5, 0), "p2");
    expect(reactionWindow(s)).toBeNull();
  });

  it("moveEnded: Fire Overwatch moved to each move by one line (reacts moveEnded, range 24) is offered per move", () => {
    const overwatch = fortyK.actions.find((a) => a.id === "fireOverwatch")!;
    extendSystem("forty-k-11", { actions: [{ ...overwatch, reacts: [{ window: "moveEnded", range: 24 }] }] });
    try {
      let s = goTo(setup({ plain: [-28, -20] }), "movement", 1);
      s = cp(s, "p1", 2);
      s = play(s, moveBy(s, "raiders", 0, -3), "p2");
      expect(reactionWindow(s)).toMatchObject({ window: "moveEnded", trigger: { unitId: "raiders" } });
      expect(playableReactions(s, "p1").find((r) => r.id === "fireOverwatch")?.units).toEqual(["smokers"]);
      s = play(s, { type: "reaction/pass" }, "p1");
      // No second ask at the phase's end: Overwatch no longer answers movementEnded.
      s = play(s, { type: "turn/next" }, "p2");
      expect(reactionWindow(s)).toBeNull();
    } finally {
      restoreSystems();
    }
  });

  it("moveEnded: no window for a move out of range, a waiting side's own move, or with nothing in hand", () => {
    let s = goTo(setup({ smokers: [0, -4], plain: [-28, -10] }), "movement", 1);
    s = cp(s, "p1", 2);
    // Nothing in hand that answers a move (Fire Overwatch waits for the phase's end).
    s = play(s, moveBy(s, "raiders", 0, -5), "p2");
    expect(reactionWindow(s)).toBeNull();
    s = withSidestep(s);
    // Too far: the raiders end 20" from the smokers.
    s = play(s, moveBy(s, "raiders", 0, 11), "p2");
    expect(reactionWindow(s)).toBeNull();
    // The waiting side's own unit moving (a reaction's move) isn't an enemy move.
    s = play(s, moveBy(s, "smokers", 0, 2), "p1");
    expect(reactionWindow(s)).toBeNull();
  });

  it("moveEnded: no window when nothing of the enemy moved", () => {
    let s = goTo(setup(), "movement", 1);
    s = cp(s, "p1", 2);
    s = play(s, { type: "turn/next" }, "p2");
    expect(reactionWindow(s)).toBeNull();
  });

  it("rerollable: Command Re-roll for the roller, with the failed dice and the roll's seq", () => {
    let s = goTo(setup(), "shooting", 0);
    s = cp(s, "p1", 1);
    s = declare(s, "smokers", "raiders", "p1");
    // Smokescreen isn't the attacker's, and the raiders have no SMOKE: no window yet.
    expect(reactionWindow(s)).toBeNull();
    s = play(s, { type: "attack/roll" }, "p1", faces(1, 6, 6, 6));
    const open = reactionWindow(s)!;
    expect(open).toMatchObject({
      window: "rerollable",
      seat: 0,
      trigger: { step: "hit", sides: 6, seq: s.seq },
    });
    expect(open.trigger.dice).toEqual([{ die: 0, value: 1 }]);
    const reroll = playableReactions(s, "p1").find((r) => r.id === "commandReroll")!;
    expect(reroll).toMatchObject({ needsUnit: false, reroll: { seq: s.seq, dice: [{ die: 0, value: 1 }] } });
    // Playing it: the stratagem, then the die; the window closes with nothing left to play.
    s = play(s, reroll.play, "p1");
    expect(reactionWindow(s)).toBeNull();
    // The dice are still in front of everyone, for attack/reroll.
    expect(s.attack?.stage).toBe("wound");
  });

  it("beforeSaves: an imported stratagem whose When text says saving throws, on the unit attacked", () => {
    let s = goTo(setup(), "shooting", 1);
    s = play(
      s,
      {
        type: "player/army",
        army: {
          rules: [],
          stratagems: [
            {
              id: "brace",
              name: "Brace Up",
              cp: 1,
              side: "inactive",
              phases: ["shooting"],
              targetsUnit: true,
              when: "Opponent's Shooting phase, just before your unit makes its saving throws.",
              text: "Invented for the test.",
            },
          ],
        },
      },
      "p1",
    );
    s = cp(s, "p1", 1);
    s = cp(s, "p2", 0);
    s = declare(s, "raiders", "plain", "p2");
    expect(reactionWindow(s)).toBeNull();
    s = play(s, { type: "attack/roll" }, "p2", faces(6, 6, 6, 6));
    expect(reactionWindow(s)).toBeNull();
    s = play(s, { type: "attack/roll" }, "p2", faces(6, 6, 6, 6));
    expect(s.attack?.stage).toBe("save");
    expect(reactionWindow(s)).toMatchObject({
      window: "beforeSaves",
      seat: 0,
      trigger: { targetId: "plain" },
    });
    const brace = playableReactions(s, "p1").find((r) => r.name === "Brace Up")!;
    expect(brace).toMatchObject({ id: "army:p1:brace", units: ["plain"], needsUnit: true });
    // Passing closes it.
    s = play(s, { type: "reaction/pass" }, "p1");
    expect(reactionWindow(s)).toBeNull();
  });

  it("queues the defender's window behind the attacker's re-roll at the same roll", () => {
    let s = goTo(setup(), "shooting", 1);
    s = play(
      s,
      {
        type: "player/army",
        army: {
          rules: [],
          stratagems: [
            {
              id: "brace",
              name: "Brace Up",
              cp: 1,
              side: "inactive",
              targetsUnit: true,
              reacts: ["beforeSaves"],
              text: "",
            },
          ],
        },
      },
      "p1",
    );
    s = cp(s, "p1", 1);
    s = cp(s, "p2", 1);
    s = declare(s, "raiders", "plain", "p2");
    s = play(s, { type: "attack/roll" }, "p2", faces(6, 6, 6, 6));
    s = play(s, { type: "attack/roll" }, "p2", faces(1, 6, 6, 6));
    expect(reactionWindow(s)).toMatchObject({ window: "rerollable", seat: 1 });
    expect(reactionWindow(s)?.then?.map((w) => w.window)).toEqual(["beforeSaves"]);
    s = play(s, { type: "reaction/pass" }, "p2");
    expect(reactionWindow(s)).toMatchObject({ window: "beforeSaves", seat: 0 });
  });

  it("fightPick: Counter-offensive after an enemy unit has fought, for an engaged unit that hasn't", () => {
    let s = goTo(setup({ raiders: [0, -8.6] }), "fight", 1);
    s = cp(s, "p1", 2);
    s = declare(s, "raiders", "smokers", "p2", "blade");
    while (s.attack && s.attack.stage !== "done")
      s = play(s, { type: "attack/roll" }, "p2", faces(6, 6, 6, 6, 6, 6));
    expect(reactionWindow(s)?.window).not.toBe("fightPick");
    s = play(s, { type: "attack/clear" }, "p2");
    expect(reactionWindow(s)).toMatchObject({ window: "fightPick", seat: 0, trigger: { unitId: "raiders" } });
    const counter = playableReactions(s, "p1").find((r) => r.id === "counterOffensive")!;
    // The plain unit isn't engaged: only the smokers can fight next.
    expect(counter).toMatchObject({ units: ["smokers"], cost: "2 CP" });
    // The active side going on closes it.
    s = play(s, { type: "turn/next" }, "p2");
    expect(reactionWindow(s)).toBeNull();
  });

  it("chargeRolled: Heroic Intervention for a unit near the charging enemy", () => {
    let s = goTo(setup({ raiders: [0, 0], plain: [-28, -20] }), "charge", 1);
    s = cp(s, "p1", 1);
    s = play(
      s,
      { type: "dice/roll", count: 2, sides: 6, label: "charge", unitId: "raiders", targets: ["smokers"] },
      "p2",
    );
    expect(reactionWindow(s)).toMatchObject({
      window: "chargeRolled",
      seat: 0,
      trigger: { unitId: "raiders", targetId: "smokers", step: "charge" },
    });
    expect(playableReactions(s, "p1").find((r) => r.id === "heroicIntervention")?.units).toEqual(["smokers"]);
  });

  it("filters: no window without CP, once a phase, or on a unit without the keyword", () => {
    let s = goTo(setup(), "shooting", 1);
    s = cp(s, "p1", 0);
    expect(reactionWindow(declare(s, "raiders", "smokers", "p2"))).toBeNull();
    s = cp(s, "p1", 3);
    // Wrong keyword: the plain unit has no SMOKE.
    expect(reactionWindow(declare(s, "raiders", "plain", "p2"))).toBeNull();
    s = declare(s, "raiders", "smokers", "p2");
    expect(ids(s, "p1")).toContain("smokescreen");
    s = play(s, { type: "player/action", action: "smokescreen", targetId: "smokers" }, "p1");
    expect(reactionWindow(s)).toBeNull();
    s = play(s, { type: "attack/clear" }, "p2");
    // Used once this phase: no window the second time.
    expect(reactionWindow(declare(s, "raiders", "smokers", "p2"))).toBeNull();
  });

  it("asks no more once the player mutes it, and asks again when they unmute", () => {
    let s = goTo(setup(), "shooting", 1);
    s = cp(s, "p1", 1);
    s = play(s, { type: "reaction/mute", action: "smokescreen", mute: true }, "p1");
    expect(s.reactionMute).toEqual({ p1: ["smokescreen"] });
    expect(reactionWindow(declare(s, "raiders", "smokers", "p2"))).toBeNull();
    s = play(s, { type: "reaction/mute", action: "smokescreen", mute: false }, "p1");
    s = declare(s, "raiders", "smokers", "p2");
    expect(reactionWindow(s)?.window).toBe("targetDeclared");
    // Muting what is open closes it; only the reacting side can pass.
    expect(resolveIntent({ type: "reaction/pass" }, "p2", rng(1), s)).toBeNull();
    s = play(s, { type: "reaction/mute", action: "*", mute: true }, "p1");
    expect(reactionWindow(s)).toBeNull();
  });

  it("keeps the window through table talk", () => {
    let s = goTo(setup(), "shooting", 1);
    s = cp(s, "p1", 1);
    s = declare(s, "raiders", "smokers", "p2");
    s = play(s, { type: "clock/call", kind: "last-turn", text: "Last turn" }, "p2");
    expect(reactionWindow(s)?.window).toBe("targetDeclared");
  });

  it("a package adds a window and a card that answers it", () => {
    extendSystem("forty-k-11", {
      reactionWindows: [
        { id: "ambush", opens: "attackDeclared", units: { same: ["it.id", "event.target.id"] } },
      ],
      actions: [
        {
          id: "ambushCard",
          name: "Ambush",
          by: "player",
          side: "inactive",
          cost: [{ resource: "CP", amount: 1 }],
          limit: { count: 1, per: "phase" },
          target: { filter: { same: ["it.owner", "player.id"] } },
          reacts: [{ window: "ambush" }],
        },
      ],
    });
    try {
      let s = goTo(setup(), "shooting", 1);
      s = cp(s, "p1", 1);
      s = declare(s, "raiders", "plain", "p2");
      expect(reactionWindow(s)).toMatchObject({ window: "ambush", seat: 0 });
      expect(playableReactions(s, "p1")).toMatchObject([{ id: "ambushCard", units: ["plain"] }]);
    } finally {
      restoreSystems();
    }
  });

  it("the bot re-rolls its failed die with CP to spare, and passes quickly otherwise", () => {
    let s = goTo(setup(), "shooting", 0);
    s = cp(s, "p1", 2);
    s = declare(s, "smokers", "raiders", "p1");
    s = play(s, { type: "attack/roll" }, "p1", faces(1, 6, 6, 6));
    const think = (state: GameState) =>
      botPolicy("steady", state, 0, { seed: 1 }).move(createRecord(state), state, { seat: 0, player: "p1" });
    expect(think(s)).toMatchObject({
      intent: { type: "player/action", action: "commandReroll" },
      then: { intent: { type: "attack/reroll", seq: s.seq, die: 0 } },
    });
    // With its last CP it keeps it.
    let t = cp(goTo(setup(), "shooting", 0), "p1", 1);
    t = declare(t, "smokers", "raiders", "p1");
    t = play(t, { type: "attack/roll" }, "p1", faces(1, 6, 6, 6));
    expect(reactionWindow(t)?.window).toBe("rerollable");
    expect(think(t)).toMatchObject({ intent: { type: "reaction/pass" }, as: "p1" });
  });

  it("opens on the data-procedure path too (the bot's attacks and charges): target, saves, fight, charge", () => {
    const brace = {
      id: "brace",
      name: "Brace Up",
      cp: 1,
      side: "inactive" as const,
      targetsUnit: true,
      reacts: ["beforeSaves"],
      text: "",
    };
    let s = goTo(setup(), "shooting", 1);
    s = play(s, { type: "player/army", army: { rules: [], stratagems: [brace] } }, "p1");
    s = cp(s, "p1", 3);
    s = play(
      s,
      { type: "action/take", unitId: "raiders", action: "shoot", weapon: "gun", targetId: "smokers" },
      "p2",
    );
    expect(reactionWindow(s)).toMatchObject({ window: "targetDeclared", trigger: { targetId: "smokers" } });
    for (let i = 0; i < 6 && reactionWindow(s)?.window !== "beforeSaves"; i++)
      s = play(s, { type: "procedure/roll" }, "p2", faces(6, 6, 6, 6));
    expect(reactionWindow(s)).toMatchObject({
      window: "beforeSaves",
      seat: 0,
      trigger: { targetId: "smokers" },
    });

    let f = goTo(setup({ raiders: [0, -8.6] }), "fight", 1);
    f = cp(f, "p1", 2);
    f = play(
      f,
      { type: "action/take", unitId: "raiders", action: "fight", weapon: "blade", targetId: "smokers" },
      "p2",
    );
    while (f.procedure && !f.procedure.run.done)
      f = play(f, { type: "procedure/roll" }, "p2", faces(6, 6, 6));
    f = play(f, { type: "procedure/clear" }, "p2");
    expect(reactionWindow(f)).toMatchObject({ window: "fightPick", seat: 0, trigger: { unitId: "raiders" } });

    let c = goTo(setup({ raiders: [0, 0] }), "charge", 1);
    c = cp(c, "p1", 1);
    c = play(c, { type: "action/take", unitId: "raiders", action: "charge", targetId: "smokers" }, "p2");
    expect(reactionWindow(c)).toMatchObject({
      window: "chargeRolled",
      seat: 0,
      trigger: { unitId: "raiders" },
    });
  });
});
