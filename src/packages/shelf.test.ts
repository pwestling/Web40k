import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  resolveIntent,
  type GameState,
  type Intent,
  type PlayerId,
} from "../core";
import { spawnIntents } from "../systems/wh40k/deploy";
import { sampleRoster } from "../systems/wh40k/sample";
import { getSystem } from "../core/content/systems";
import { teach } from "../systems/wh40k/teach";
import { ARMY_FORMAT, armyAssets, armyFromGame, readArmy } from "./shelf";

function play(state: GameState, intent: Intent, from: PlayerId): GameState {
  const event = resolveIntent(intent, from, () => 0.5, state);
  if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
  return applyEvent({ ...state, seq: state.seq + 1 }, event);
}

describe("army shelf", () => {
  it("saves a deployed army with its unit names, figures, dice and colour, and reads it back", () => {
    let s = createInitialState();
    s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#3b82f6", seat: 0 } }, "p1");
    const roster = sampleRoster(0);
    for (const i of spawnIntents(s, "p1", roster.units, "p1-abc", roster.name)) s = play(s, i, "p1");
    const unit = s.units["p1-abc-1"]!;
    const key = s.models[unit.modelIds[0]!]!.profile!.name;
    const figure = { asset: "a".repeat(64), name: "squad.glb", yaw: 0, scale: 1 };
    s = play(s, { type: "unit/figure", id: unit.id, keys: [key], figure }, "p1");
    s = play(s, { type: "player/color", player: "p1", color: "#F97316" }, "p1");

    const army = armyFromGame(s, "p1", { roster, prefix: "p1-abc" });
    expect(army.format).toBe(ARMY_FORMAT);
    expect(army.roster.units.length).toBe(roster.units.length);
    expect(army.figures[1]?.[key]?.figure).toEqual(figure);
    expect(army.color).toBe("#f97316");
    expect(armyAssets(army)).toEqual(["a".repeat(64)]);

    const back = readArmy(JSON.parse(JSON.stringify({ ...army, attachments: { assets: {} } })));
    expect(back).toEqual(army);
    expect(readArmy({ format: "something else" })).toBeNull();
  });

  it("keeps rules taught at the table, and the next game deploys them automated (#53)", () => {
    let s = createInitialState();
    s = play(s, { type: "game/system", system: "forty-k-11" }, "p1");
    s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#3b82f6", seat: 0 } }, "p1");
    const roster = sampleRoster(0);
    for (const i of spawnIntents(s, "p1", roster.units, "p1-abc", roster.name)) s = play(s, i, "p1");
    const unit = s.units["p1-abc-0"]!;
    const ability = unit.sheet!.abilities[0]!.name;
    const auto = teach(
      { when: { kind: "attacks" }, who: { kind: "self" }, what: [{ kind: "fnp", x: 5 }] },
      getSystem("forty-k-11"),
    )!;
    s = play(s, { type: "unit/automate", id: unit.id, ability, auto }, "p1");
    const stratagem = {
      id: "hold-fast",
      name: "Hold Fast",
      cp: 1,
      side: "either" as const,
      text: "",
      auto,
      targetsUnit: true,
    };
    s = play(s, { type: "player/army", army: { rules: [], stratagems: [stratagem] } }, "p1");

    const army = readArmy(JSON.parse(JSON.stringify(armyFromGame(s, "p1", { roster, prefix: "p1-abc" }))))!;
    expect(army.roster.units[0]!.sheet.abilities.find((a) => a.name === ability)?.auto).toEqual(auto);
    expect(army.roster.army?.stratagems[0]?.auto).toEqual(auto);
    // Deployed again: the unit starts with it automated.
    let next = createInitialState();
    next = play(next, { type: "game/system", system: "forty-k-11" }, "p1");
    next = play(
      next,
      { type: "player/join", player: { id: "p1", name: "A", color: "#3b82f6", seat: 0 } },
      "p1",
    );
    for (const i of spawnIntents(next, "p1", army.roster.units, "p1-xyz", army.roster.name))
      next = play(next, i, "p1");
    expect(next.units["p1-xyz-0"]!.sheet!.abilities.find((a) => a.name === ability)?.auto?.taught).toBe(true);
  });

  it("refuses a colour that isn't a hex colour", () => {
    let s = createInitialState();
    s = play(s, { type: "player/join", player: { id: "p1", name: "A", color: "#3b82f6", seat: 0 } }, "p1");
    expect(
      resolveIntent({ type: "player/color", player: "p1", color: "red" }, "p1", () => 0.5, s),
    ).toBeNull();
    expect(
      resolveIntent({ type: "player/color", player: "p1", color: "#123456" }, "p2", () => 0.5, s),
    ).toBeNull();
  });
});
