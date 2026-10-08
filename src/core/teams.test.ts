import { describe, expect, it } from "vitest";
import "../systems";
import { opposed, teamShare, zoneSlice } from "./teams";
import {
  applyEvent,
  createInitialState,
  resolveIntent,
  sideName,
  type GameState,
  type Intent,
} from "./index";

const play = (s: GameState, intent: Intent, from: string): GameState => {
  const e = resolveIntent(intent, from, () => 0.5, s);
  if (!e) throw new Error(`Rejected ${intent.type}`);
  return applyEvent({ ...s, seq: s.seq + 1 }, e);
};

function twoVsTwo(): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "a", name: "", color: "#00f", seat: 0 } }, "a");
  s = play(s, { type: "settings/set", settings: { teamSize: 2 } }, "a");
  for (const id of ["b", "c", "d"])
    s = play(s, { type: "player/join", player: { id, name: "", color: "#888" } }, id);
  return s;
}

describe("team games", () => {
  it("seats four players two a side, numbered by side", () => {
    const s = twoVsTwo();
    expect(Object.values(s.players).map((p) => [p.id, p.seat, p.name])).toEqual([
      ["a", 0, "Player 1"],
      ["b", 1, "Player 2"],
      ["c", 0, "Player 3"],
      ["d", 1, "Player 4"],
    ]);
    expect(sideName(s, 0)).toBe("Player 1 & Player 3");
    // A fifth player watches.
    const e = play(s, { type: "player/join", player: { id: "e", name: "", color: "#888" } }, "e");
    expect(e.players.e?.seat).toBeUndefined();
  });

  it("shares a side's CP and VP, and gains them once a side", () => {
    let s = twoVsTwo();
    s = play(s, { type: "resource/adjust", player: "c", resource: "VP", delta: 3 }, "c");
    expect([s.resources.a?.VP, s.resources.c?.VP, s.resources.b?.VP]).toEqual([3, 3, 0]);
    const cp = s.resources.a?.CP ?? 0;
    const cpB = s.resources.b?.CP ?? 0;
    s = play(s, { type: "turn/next" }, "a");
    // Every command phase both sides gain 1 CP (40k): once per side, not per player.
    const gainedA = (s.resources.a?.CP ?? 0) - cp;
    const gainedB = (s.resources.b?.CP ?? 0) - cpB;
    expect(gainedA).toBeLessThanOrEqual(1);
    expect(gainedB).toBeLessThanOrEqual(1);
    expect(s.resources.c).toEqual(s.resources.a);
    expect(s.resources.d).toEqual(s.resources.b);
  });

  it("treats teammates as allies, not enemies", () => {
    const s = twoVsTwo();
    expect(opposed(s, "a", "c")).toBe(false);
    expect(opposed(s, "a", "a")).toBe(false);
    expect(opposed(s, "a", "b")).toBe(true);
    expect(opposed(s, "c", "d")).toBe(true);
  });

  it("gives each teammate their own slice of the side's zone", () => {
    const s = twoVsTwo();
    expect(teamShare(s, "a")).toEqual({ index: 0, of: 2 });
    expect(teamShare(s, "c")).toEqual({ index: 1, of: 2 });
    const zone = [
      { x: -30, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 22 },
      { x: -30, y: 22 },
    ];
    const xs = (i: number) => zoneSlice(zone, i, 2).map((p) => p.x);
    expect(Math.min(...xs(0))).toBe(-30);
    expect(Math.max(...xs(0))).toBe(0);
    expect(Math.min(...xs(1))).toBe(0);
    expect(Math.max(...xs(1))).toBe(30);
    expect(zoneSlice(zone, 0, 1)).toBe(zone);
  });
});

describe("renaming", () => {
  it("lets a player rename only themselves", () => {
    const s = twoVsTwo();
    const after = play(s, { type: "player/rename", player: "c", name: "  Cy " }, "c");
    expect(after.players.c?.name).toBe("Cy");
    expect(resolveIntent({ type: "player/rename", player: "c", name: "X" }, "a", () => 0.5, s)).toBeNull();
    expect(resolveIntent({ type: "player/rename", player: "c", name: " " }, "c", () => 0.5, s)).toBeNull();
  });
});
