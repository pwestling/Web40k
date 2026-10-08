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
import { previewRun } from "../../core/content";
import { procedureEnv, procedureRoles } from "../../core/content/play";
import { getSystem } from "../../core/content/systems";
import { blockSlots } from "../../core/regiment";
import "../index";
import { spawnIntents } from "../wh40k/deploy";
import { towSample } from "./sample";

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
  s = play(s, { type: "game/system", system: "tow-hand" }, "p1");
  s = play(s, { type: "layout/set", layout: { terrain: [], objectives: [], zones: [] } }, "p1");
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(s, p, towSample(seat).units, p, "army")) s = play(s, i, p);
  return s;
}

const unitNamed = (s: GameState, name: string) => Object.values(s.units).find((u) => u.name === name)!;

/** Line a unit's models up in ranks of `files` facing +y around (x, y). */
function block(s: GameState, unitId: string, x: number, y: number, files = 5, facing = 0): GameState {
  const unit = s.units[unitId]!;
  const dir = facing === 0 ? -1 : 1;
  const moves = unit.modelIds.map((id, i) => ({
    id,
    to: { x: x + ((i % files) - (files - 1) / 2) * 0.8, y: y + dir * Math.floor(i / files) * 0.8 },
    facing,
  }));
  return applyEvent(
    { ...s, units: { ...s.units, [unitId]: { ...unit, formation: { kind: "ranked", files } } } },
    { type: "models/move", moves },
  );
}

function toShooting(s: GameState, seat: number): GameState {
  for (let i = 0; i < 20; i++) {
    if (s.turn.round > 0 && currentSlot(s)?.id === "shooting" && s.turn.activeSeat === seat) return s;
    s = play(s, { type: "turn/next" }, "p1");
  }
  throw new Error("no shooting phase");
}

describe("The Old World shooting", () => {
  it("works out to hit from BS with stacked penalties and 7+ follow-ups", () => {
    let s = setup();
    const bows = unitNamed(s, "Fen Bowmen");
    const warband = unitNamed(s, "Reaver Warband");
    s = block(s, bows.id, 0, -10);
    s = block(s, warband.id, 0, 4, 6, Math.PI);
    s = toShooting(s, s.players.p1!.seat!);
    const plan = (state: GameState) =>
      previewRun(
        procedureEnv(state),
        "shoot",
        procedureRoles(getSystem("tow-hand"), "shoot", bows.id, { weapon: "missile", targetId: warband.id }),
      );
    // BS 3 within half range: 4+; the front rank of five shoots, and Volley Fire adds 3 + 2 of the ranks behind.
    let p = plan(s);
    expect(p.plans.hit).toMatchObject({ target: 4 });
    expect(p.plans.attacks).toMatchObject({
      count: "11",
      why: "the front rank, and Volley Fire: half of each rank behind",
    });
    // S3 against T3 wounds on 4+; no armour, no ward.
    expect(p.plans.wound).toMatchObject({ target: 4 });
    // Long range and having moved: 6+.
    const far = block(
      { ...s, units: { ...s.units, [bows.id]: { ...s.units[bows.id]!, status: { moved: true } } } },
      bows.id,
      0,
      -25,
    );
    p = plan(far);
    expect(p.plans.hit).toMatchObject({ target: 6 });
    // Having moved: no Volley Fire, the front rank only (UX 332 names why).
    expect(p.plans.attacks).toMatchObject({ count: "5", why: "the front rank" });
    expect(p.fired.hit).toEqual(["Long range", "Moved and shot"]);
  });

  it("takes casualties from the rear rank, leaving the front rank and command", () => {
    let s = setup();
    const bows = unitNamed(s, "Fen Bowmen");
    const warband = unitNamed(s, "Reaver Warband");
    s = block(s, bows.id, 0, -10);
    s = block(s, warband.id, 0, 4, 6, Math.PI);
    s = toShooting(s, s.players.p1!.seat!);
    const before = blockSlots(s, s.units[warband.id]!);
    const r = rng(11);
    s = play(
      s,
      { type: "action/take", unitId: bows.id, action: "shoot", weapon: "missile", targetId: warband.id },
      "p1",
      r,
    );
    while (s.procedure && !s.procedure.run.done) s = play(s, { type: "procedure/roll" }, "p1", r);
    const dead = before.filter((id) => s.models[id]?.destroyed);
    expect(dead.length).toBeGreaterThan(0);
    // The dead are exactly the last rank-and-file slots.
    const rankAndFile = before.filter((id) => s.models[id]?.profile?.name === "Reaver Warband");
    expect(dead).toEqual(rankAndFile.slice(rankAndFile.length - dead.length));
    expect(s.models[before[0]!]?.destroyed).toBeFalsy();
  });
});
