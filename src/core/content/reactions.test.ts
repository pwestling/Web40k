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
        },
      },
    },
    models,
  });
}

function setup(): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "Ann", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "Ben", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system: "forty-k-11" }, "p1");
  s = addUnit(
    s,
    "smokers",
    "p1",
    ["INFANTRY", "SMOKE"],
    [model("s1", "p1", 0, -10), model("s2", "p1", 1.5, -10)],
  );
  s = addUnit(s, "plain", "p1", ["INFANTRY"], [model("l1", "p1", -10, -10)]);
  s = addUnit(s, "raiders", "p2", ["INFANTRY"], [model("t1", "p2", 0, 10), model("t2", "p2", 1.5, 10)]);
  return s;
}

function goTo(s: GameState, phase: string, seat: number): GameState {
  for (let i = 0; i < 30; i++) {
    if (s.turn.round > 0 && currentSlot(s)?.id === phase && s.turn.activeSeat === seat) return s;
    s = play(s, { type: "turn/next" }, "p1");
  }
  throw new Error(`never reached ${phase}`);
}

const declare = (s: GameState, attacker: string, target: string, by: PlayerId) =>
  play(s, { type: "attack/declare", spec: previewAttack(s, attacker, "gun", target)!.spec }, by);

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
});
