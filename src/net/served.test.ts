import { describe, expect, it } from "vitest";
import { createInitialState, type GameState } from "../core";
import { hostPowers, serverHost } from "../store";
import type { Session } from "./session";

const game = (ids: string[]): GameState => {
  const g = createInitialState();
  ids.forEach((id, seat) => (g.players[id] = { id, name: id, color: "#000", seat }));
  return g;
};
const table = (me: string, ids: string[], peers: string[], hostId = "server", served = true) => ({
  mode: "online" as const,
  role: "client" as const,
  served,
  game: game(ids),
  session: { selfId: me } as Session,
  net: { role: "client" as const, hostId, peers, migrating: false, desync: null, otherBuilds: [] },
});

describe("a room the host server hosts", () => {
  it("gives the host's choices to the first seated player still here", () => {
    expect(hostPowers(table("ana", ["ana", "ben"], ["server", "ben"]))).toBe(true);
    expect(hostPowers(table("ben", ["ana", "ben"], ["server", "ana"]))).toBe(false);
    // Ana has gone: Ben has them now.
    expect(hostPowers(table("ben", ["ana", "ben"], ["server"]))).toBe(true);
    // Not a served room: only the host has them.
    expect(hostPowers(table("ana", ["ana", "ben"], ["server", "ben"], "server", false))).toBe(false);
  });

  it("stops counting as served once a player hosts (a game handed over for its rules package)", () => {
    expect(serverHost(table("ben", ["ana", "ben"], ["server", "ana"]))).toBe("server");
    expect(serverHost(table("ben", ["ana", "ben"], ["ana"], "ana"))).toBeNull();
    expect(hostPowers(table("ana", ["ana", "ben"], ["ben"], "ana"))).toBe(false);
  });
});
