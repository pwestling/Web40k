import { describe, expect, it } from "vitest";
import { scanDecks } from "./decks";

const sheet = {
  "12": {
    FaceURL: "https://example.com/faces.png",
    BackURL: "https://example.com/back.png",
    NumWidth: 5,
    NumHeight: 2,
  },
};
const card = (id: number, name: string) => ({ Name: "Card", Nickname: name, CardID: id, CustomDeck: sheet });

describe("TTS decks (#75)", () => {
  it("cuts each card from its sheet, finds decks in bags, and keeps one of each", () => {
    const deck = {
      Name: "Deck",
      Nickname: "Secondary Missions",
      DeckIDs: [1200, 1206],
      CustomDeck: sheet,
      ContainedObjects: [card(1200, "Assassination"), card(1206, "[b]Bring It Down[/b]")],
    };
    const decks = scanDecks([
      deck,
      { Name: "Bag", ContainedObjects: [{ ...deck }] },
      { Name: "Deck", Nickname: "Primary", DeckIDs: [1203, 1204], CustomDeck: sheet },
      card(1209, "Loose one"),
    ]);
    expect(decks.map((d) => [d.name, d.cards.map((c) => c.name)])).toEqual([
      ["Secondary Missions", ["Assassination", "Bring It Down"]],
      ["Primary", ["Primary 1", "Primary 2"]],
      ["Cards on the table", ["Loose one"]],
    ]);
    expect(decks[0]!.cards[1]).toMatchObject({
      id: "c1",
      face: { url: "https://example.com/faces.png", cols: 5, rows: 2, index: 6 },
      back: { url: "https://example.com/back.png", cols: 1, rows: 1, index: 0 },
    });
  });
});
