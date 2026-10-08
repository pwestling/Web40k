import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  resolveIntent,
  systemOf,
  type GameState,
  type Intent,
  type PlayerId,
} from "../core";
import { gameModule } from "../systems";
import { spawnIntents } from "../systems/wh40k/deploy";
import { overrideKey, placement, tableWarnings } from "./warnings";

const rng = () => 0.5;

function play(state: GameState, intent: Intent, from: PlayerId): GameState {
  const event = resolveIntent(intent, from, rng, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  return applyEvent({ ...state, seq: state.seq + 1 }, event);
}

/** Two players, the system's sample table and armies deployed. */
function setup(system: string): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#00f", seat: 0 } }, "p1");
  s = play(s, { type: "player/join", player: { id: "p2", name: "B", color: "#f00", seat: 1 } }, "p2");
  s = play(s, { type: "game/system", system }, "p1");
  const app = gameModule(system)!.app!;
  s = play(
    s,
    { type: "layout/set", layout: { ...app.layout(systemOf(s).defaultTable ?? s.table), terrain: [] } },
    "p1",
  );
  for (const [p, seat] of [
    ["p1", 0],
    ["p2", 1],
  ] as const)
    for (const i of spawnIntents(s, p, app.sample(seat).units, p, "army")) s = play(s, i, p);
  return s;
}

/** Pull one model of a unit far from the rest. */
function stray(s: GameState, owner: string, far: number): { state: GameState; unitId: string } {
  const unit = Object.values(s.units).find((u) => u.owner === owner && u.modelIds.length > 2)!;
  const id = unit.modelIds[0]!;
  const m = s.models[id]!;
  return {
    unitId: unit.id,
    state: {
      ...s,
      models: { ...s.models, [id]: { ...m, position: { x: m.position.x + far, y: m.position.y } } },
    },
  };
}

describe("tableWarnings", () => {
  for (const system of ["forty-k-11", "fsd-1.7"]) {
    it(`${system}: quiet on a fresh table, then flags a stray model`, () => {
      const s = setup(system);
      expect(tableWarnings(s)).toEqual([]);
      const { state, unitId } = stray(s, "p1", 15);
      const found = tableWarnings(state).filter((w) => w.unitId === unitId);
      expect(found.length).toBe(1);
    });
  }

  it("uses the 40k code check in place of the data check of the same id", () => {
    const { state } = stray(setup("forty-k-11"), "p1", 15);
    const w = tableWarnings(state);
    expect(w.map((x) => x.checkId)).toEqual(["coherency"]);
    expect(w[0]!.message).toMatch(/out of coherency/);
  });

  it("drops an overridden warning until the unit moves again", () => {
    const { state, unitId } = stray(setup("forty-k-11"), "p1", 15);
    const unit = state.units[unitId]!;
    const ok = {
      ...state,
      units: {
        ...state.units,
        [unitId]: { ...unit, status: { [overrideKey("coherency")]: placement(state, unit) } },
      },
    };
    expect(tableWarnings(ok)).toEqual([]);
    const moved = stray(ok, "p1", 3).state;
    expect(tableWarnings(moved).length).toBe(1);
  });
});
