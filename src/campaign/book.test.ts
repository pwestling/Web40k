import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createInitialState,
  createRecord,
  resolveIntent,
  type GameRecord,
  type Intent,
  type PlayerId,
} from "../core";
import { spawnIntents } from "../systems/wh40k/deploy";
import { sampleRoster } from "../systems/wh40k/sample";
import { battleOver } from "../ui/StatsScreen";
import { campaignHash, campaignUnitKey, leagueTable, newCampaign, readCampaign, recordGame } from "./book";

function game() {
  const record: GameRecord = createRecord(createInitialState());
  let state = record.initial;
  const play = (intent: Intent, from: PlayerId) => {
    const event = resolveIntent(intent, from, () => 0.5, state);
    if (!event) throw new Error(`Rejected: ${JSON.stringify(intent)}`);
    const seq = state.seq + 1;
    state = { ...applyEvent(state, event), seq };
    record.events.push({ seq, by: from, at: 1000 + seq, event });
  };
  return {
    record,
    play,
    get state() {
      return state;
    },
  };
}

describe("campaign book", () => {
  it("records a finished game once: result, league, units and the map", () => {
    const book = { ...newCampaign("Crusade", "c1"), map: [{ name: "Hive Tertius" }] };
    const g = game();
    g.play({ type: "player/join", player: { id: "p1", name: "Ana", color: "#3b82f6", seat: 0 } }, "p1");
    g.play({ type: "player/join", player: { id: "p2", name: "Bo", color: "#f97316", seat: 1 } }, "p2");
    const roster = sampleRoster(0);
    for (const i of spawnIntents(g.state, "p1", roster.units, "p1-a", roster.name)) g.play(i, "p1");
    for (const i of spawnIntents(g.state, "p2", sampleRoster(1).units, "p2-b", "Them")) g.play(i, "p2");
    g.play(
      {
        type: "campaign/set",
        ref: { id: "c1", name: "Crusade", hash: campaignHash(book), territory: "Hive Tertius" },
      },
      "p1",
    );
    g.play({ type: "campaign/army", player: "p1", armyId: "army-1", prefix: "p1-a" }, "p1");
    expect(() => g.play({ type: "campaign/army", player: "p1", armyId: "x", prefix: "y" }, "p2")).toThrow();
    const victim = g.state.units["p2-b-0"]!.modelIds[0]!;
    g.play({ type: "model/wounds", id: victim, woundsLost: 1, destroyed: true }, "p1");
    g.play({ type: "resource/adjust", player: "p1", resource: "VP", delta: 10 }, "p1");
    g.play({ type: "resource/adjust", player: "p2", resource: "VP", delta: 5 }, "p2");
    for (let i = 0; i < 60 && !battleOver(g.state); i++) g.play({ type: "turn/next" }, "p1");
    expect(battleOver(g.state)).toBe(true);
    expect(campaignUnitKey(g.state, "p1-a-2")).toBe("army-1:2");
    expect(campaignUnitKey(g.state, "p2-b-0")).toBeNull();

    const shelf = { "army-1": { name: "Vanguard", system: "wh40k" } };
    const after = recordGame(book, g.record, g.state, { seats: [0, 1], vp: [10, 5] }, shelf);
    expect(after.games).toHaveLength(1);
    expect(after.games[0]).toMatchObject({ winner: 0, territory: "Hive Tertius" });
    expect(after.games[0]!.sides[0]).toMatchObject({ players: ["Ana"], armies: ["Vanguard"], vp: 10 });
    expect(after.players.find((p) => p.name === "Ana")?.armies[0]?.name).toBe("Vanguard");
    expect(after.map[0]!.holder).toBe("Ana");
    expect(after.units["army-1:0"]).toMatchObject({ games: 1, survived: 1, army: "Vanguard", honours: "" });
    expect(Object.keys(after.units).every((k) => k.startsWith("army-1:"))).toBe(true);
    const league = leagueTable(after);
    expect(league[0]).toMatchObject({ name: "Ana", won: 1, points: 3, vpFor: 10, vpAgainst: 5, held: 1 });
    expect(league[1]).toMatchObject({ name: "Bo", lost: 1, points: 0 });

    // The same game twice is one game; the same book hashes the same, whatever the key order.
    expect(recordGame(after, g.record, g.state, { seats: [0, 1], vp: [10, 5] }, shelf)).toBe(after);
    const reordered = Object.fromEntries(Object.entries(after).reverse());
    expect(campaignHash(readCampaign(reordered)!)).toBe(campaignHash(after));
    expect(readCampaign({ format: "nope" })).toBeNull();
  });
});
