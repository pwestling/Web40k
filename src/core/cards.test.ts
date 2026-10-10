import { describe, expect, it } from "vitest";
import "../systems";
import {
  applyEvent,
  cleanDecks,
  commitmentOf,
  createInitialState,
  inHand,
  leftToDraw,
  nextCardKey,
  pileOf,
  resolveIntent,
  type CardDeck,
  type GameState,
  type Intent,
} from "./index";

const play = (s: GameState, intent: Intent, from: string): GameState => {
  const e = resolveIntent(intent, from, () => 0.5, s);
  if (!e) throw new Error(`Rejected ${intent.type}`);
  return applyEvent({ ...s, seq: s.seq + 1 }, e);
};
const refused = (s: GameState, intent: Intent, from: string) =>
  resolveIntent(intent, from, () => 0.5, s) === null;

const sheet = (index: number) => ({ url: "https://example.com/cards.png", cols: 3, rows: 2, index });
const deck: CardDeck = {
  id: "d0",
  name: "Secondaries",
  cards: ["Assassinate", "Behind Enemy Lines", "Engage"].map((name, i) => ({
    id: `c${i}`,
    name,
    face: sheet(i),
  })),
};

function table(): GameState {
  let s = createInitialState();
  s = play(s, { type: "player/join", player: { id: "a", name: "", color: "#00f", seat: 0 } }, "a");
  s = play(s, { type: "player/join", player: { id: "b", name: "", color: "#f00", seat: 1 } }, "b");
  return play(
    s,
    { type: "layout/set", layout: { terrain: [], objectives: [], zones: [], decks: [deck] } },
    "a",
  );
}

describe("card decks (#75)", () => {
  it("keeps only cards it can show, with web pictures", () => {
    const clean = cleanDecks([
      deck,
      { id: "d0", name: "again", cards: deck.cards },
      { id: "d1", name: "bad", cards: [{ id: "x", name: "x", face: { url: 'javascript:alert("1")' } }] },
      {
        id: "d2",
        name: "odd",
        cards: [{ id: "y", name: "y", face: { url: "https://e.com/a.png", cols: 99, rows: 0, index: 500 } }],
      },
    ]);
    expect(clean.map((d) => d.id)).toEqual(["d0", "d2"]);
    expect(clean[1]!.cards[0]!.face).toEqual({ url: "https://e.com/a.png", cols: 10, rows: 1, index: 9 });
  });

  it("draws into a hidden hand, discards, and shuffles discards back", () => {
    let s = table();
    expect(s.decks?.map((d) => d.name)).toEqual(["Secondaries"]);
    const commit = (card: string, salt: string) => {
      const key = nextCardKey(s, "a", "d0");
      s = play(
        s,
        { type: "secret/commit", player: "a", secrets: [{ key, commitment: commitmentOf(card, salt) }] },
        "a",
      );
      return key;
    };
    const k0 = commit("c1", "s0");
    const k1 = commit("c2", "s1");
    expect(k0).toBe("deck:d0:000");
    const mine = new Map([
      [commitmentOf("c1", "s0"), "c1"],
      [commitmentOf("c2", "s1"), "c2"],
    ]);
    const left = () => leftToDraw(s, "a", deck, (e) => mine.get(e.commitment)).map((c) => c.id);
    expect(left()).toEqual(["c0"]);
    // The other player's copy is whole.
    expect(leftToDraw(s, "b", deck, () => undefined)).toHaveLength(3);
    // Only the holder discards their own cards.
    expect(refused(s, { type: "deck/discard", deck: "d0", key: k0 }, "b")).toBe(true);
    s = play(s, { type: "secret/reveal", player: "a", key: k0, value: "c1", salt: "s0" }, "a");
    s = play(s, { type: "deck/discard", deck: "d0", key: k0 }, "a");
    expect(refused(s, { type: "deck/discard", deck: "d0", key: k0 }, "a")).toBe(true);
    expect(inHand(s, "a", "d0").map(([k]) => k)).toEqual([k1]);
    expect(left()).toEqual(["c0"]);
    s = play(s, { type: "deck/shuffle", deck: "d0" }, "a");
    expect(pileOf(s, "a", "d0")).toEqual({ discarded: [], returned: [k0] });
    expect(left()).toEqual(["c0", "c1"]);
    expect(nextCardKey(s, "a", "d0")).toBe("deck:d0:002");
  });

  it("puts a deck away, and a table without decks leaves them", () => {
    let s = table();
    s = play(s, { type: "layout/set", layout: { terrain: [], objectives: [], zones: [] } }, "a");
    expect(s.decks).toHaveLength(1);
    s = play(s, { type: "deck/remove", id: "d0" }, "b");
    expect(s.decks).toEqual([]);
  });
});
