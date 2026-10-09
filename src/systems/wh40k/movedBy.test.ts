import { describe, expect, it } from "vitest";
import "../index";
import {
  applyEvent,
  createInitialState,
  currentSlot,
  resolveIntent,
  type GameState,
  type Intent,
} from "../../core";

function play(state: GameState, intent: Intent, from: string): GameState {
  const event = resolveIntent(intent, from, () => 0.5, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  return applyEvent({ ...state, seq: state.seq + 1 }, event);
}

function goTo(s: GameState, phase: string, seat: number): GameState {
  for (let i = 0; i < 40; i++) {
    if (s.turn.round > 0 && currentSlot(s)?.id === phase && s.turn.activeSeat === seat) return s;
    s = play(s, { type: "turn/next" }, "p1");
  }
  throw new Error(`never reached ${phase}`);
}

function setup(): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system: "forty-k-11" }, "p1");
  return applyEvent(s, {
    type: "unit/add",
    unit: { id: "mine", owner: "p1", name: "Mine", modelIds: [], formation: { kind: "skirmish" } },
    models: [
      {
        id: "m1",
        owner: "p1",
        label: "m1",
        position: { x: 0, y: 0 },
        facing: 0,
        base: { shape: "round", diameterMm: 32 },
      },
    ],
  });
}

describe("how far a unit moved this turn (UX 397)", () => {
  it("is kept from the Movement phase into Shooting, and cleared at its next turn", () => {
    let s = goTo(setup(), "movement", 0);
    s = applyEvent(s, { type: "models/move", moves: [{ id: "m1", to: { x: 0, y: 4 } }] });
    s = goTo(s, "shooting", 0);
    expect(s.units.mine!.status).toMatchObject({ moved: true, movedBy: 4 });
    s = goTo(s, "command", 0);
    expect(s.units.mine!.status?.movedBy).toBeUndefined();
  });
});
