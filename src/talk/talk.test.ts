import { beforeEach, describe, expect, it } from "vitest";
import { cleanItem, clearDrawings, hear, useTalk } from "./talk";

describe("table talk", () => {
  beforeEach(() => useTalk.setState({ items: [], chat: [], unread: 0, open: false, tool: null }));

  it("drops malformed or oversized items from peers", () => {
    expect(cleanItem({ id: "a", kind: "ping", at: { x: 1, y: 2 } })).toEqual({
      id: "a",
      kind: "ping",
      at: { x: 1, y: 2 },
    });
    expect(cleanItem({ id: "a", kind: "ping", at: { x: Infinity, y: 2 } })).toBeNull();
    expect(cleanItem({ id: "a", kind: "react", emoji: "<script>" })).toBeNull();
    expect(cleanItem({ id: "a", kind: "chat", text: "   " })).toBeNull();
    expect(
      (cleanItem({ id: "a", kind: "chat", text: "x".repeat(500) }) as { text: string }).text,
    ).toHaveLength(280);
    expect(cleanItem({ id: "a", kind: "area", at: { x: 0, y: 0 }, radius: -1 })).toBeNull();
    expect(cleanItem({ id: "a", kind: "move", unitId: "u" })).toBeNull();
  });

  it("keeps chat, counts unread lines, and limits a flood from one peer", () => {
    const t = 1_000_000;
    for (let i = 0; i < 20; i++) hear({ id: `c${i}`, kind: "chat", text: `hi ${i}` }, "peer", t + i);
    const s = useTalk.getState();
    expect(s.chat).toHaveLength(12);
    expect(s.unread).toBe(12);
    expect(s.chat[0]!.name).toBe("Spectator");
  });

  it("clears only the sender's drawings", () => {
    const t = 2_000_000;
    hear({ id: "a", kind: "arrow", from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }, "p1", t);
    hear({ id: "b", kind: "area", at: { x: 0, y: 0 }, radius: 3 }, "p2", t);
    hear({ id: "c", kind: "chat", text: "look" }, "p1", t);
    clearDrawings("p1");
    expect(useTalk.getState().items.map((i) => i.id)).toEqual(["b", "c"]);
  });
});
