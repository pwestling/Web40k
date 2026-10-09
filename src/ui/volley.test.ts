import { describe, expect, it } from "vitest";
import "../systems/index";
import {
  applyEvent,
  createInitialState,
  resolveIntent,
  type GameState,
  type Intent,
  type Model,
} from "../core";
import { volleyWeapons } from "./volley";

function play(state: GameState, intent: Intent, from: string): GameState {
  const event = resolveIntent(intent, from, () => 0.5, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  return applyEvent({ ...state, seq: state.seq + 1 }, event);
}

const model = (id: string, owner: string, y: number): Model => ({
  id,
  owner,
  label: id,
  position: { x: 0, y },
  facing: 0,
  base: { shape: "round", diameterMm: 32 },
  profile: { name: id, chars: { M: '6"', T: "4", SV: "3+", W: "1", LD: "6+", OC: "1" } },
});

const gun = (id: string, range: number) => ({
  id,
  name: id,
  kind: "ranged" as const,
  chars: { RANGE: `${range}"`, A: "1", BS: "3+", S: "4", AP: "0", D: "1" },
  keywords: [],
});

describe("Shoot everything at… (UX 398)", () => {
  it("offers the weapons that reach the target, and says why the others can't", () => {
    let s = createInitialState();
    s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
    s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
    s = play(s, { type: "game/system", system: "forty-k-11" }, "p1");
    s = applyEvent(s, {
      type: "unit/add",
      unit: {
        id: "mine",
        owner: "p1",
        name: "Mine",
        modelIds: [],
        formation: { kind: "skirmish" },
        sheet: {
          keywords: ["INFANTRY"],
          abilities: [],
          weapons: { rifle: gun("rifle", 24), pistol: gun("pistol", 12) },
        },
      },
      models: [{ ...model("m1", "p1", 0), weapons: ["rifle", "pistol"] }],
    });
    s = applyEvent(s, {
      type: "unit/add",
      unit: { id: "theirs", owner: "p2", name: "Theirs", modelIds: [], formation: { kind: "skirmish" } },
      models: [model("t1", "p2", 18)],
    });
    expect(volleyWeapons(s, "mine", "theirs")).toEqual([
      { id: "rifle", name: "rifle", inRange: 1 },
      { id: "pistol", name: "pistol", inRange: 0, why: "out of range" },
    ]);
  });
});
