import { describe, expect, it } from "vitest";
import { newCampaign, type CampaignBook, type CampaignGame } from "./book";
import {
  handResult,
  mergeBooks,
  newEvent,
  pairingTable,
  pairNextRound,
  roundDone,
  settlePairing,
  standings,
} from "./event";

const NAMES = ["Ana", "Bo", "Cy", "Di", "Ed"];

function eventBook(names = NAMES): CampaignBook {
  return {
    ...newCampaign("Event night", "ev1"),
    event: newEvent(names, 3, [
      { id: "t1", name: "Hab row" },
      { id: "t2", name: "Chapel crossing" },
    ]),
  };
}

const pair = (book: CampaignBook): CampaignBook => ({
  ...book,
  event: { ...book.event!, pairings: [...book.event!.pairings, pairNextRound(book)] },
});

/** Play out the latest round: the first-named player wins each game. */
function playRound(book: CampaignBook): CampaignBook {
  const round = book.event!.pairings.length - 1;
  let b = book;
  for (const p of book.event!.pairings[round]!)
    if (p.players.length === 2) b = handResult(b, round, p, [10, 5], "forty-k-11");
  return b;
}

describe("event night", () => {
  it("pairs round one with a bye for the odd player out, and tables in order", () => {
    const book = pair(eventBook());
    const round = book.event!.pairings[0]!;
    expect(round.map((p) => p.table)).toEqual([1, 2, 3]);
    expect(round.filter((p) => p.players.length === 1)).toHaveLength(1);
    expect(new Set(round.flatMap((p) => p.players)).size).toBe(5);
    expect(pairingTable(book.event!, round[0]!)?.name).toBe("Hab row");
    expect(pairingTable(book.event!, round[2]!)?.name).toBe("Hab row");
    // The same book draws the same first round on every device.
    expect(pairNextRound(eventBook())).toEqual(round);
  });

  it("scores wins, byes and strength of schedule, and never repeats a pairing or a bye", () => {
    let book = eventBook();
    const byes: string[] = [];
    const met = new Set<string>();
    for (let r = 0; r < 3; r++) {
      book = pair(book);
      expect(roundDone(book, r)).toBe(false);
      for (const p of book.event!.pairings[r]!) {
        if (p.players.length === 1) byes.push(p.players[0]!);
        else {
          const key = [...p.players].sort().join("|");
          expect(met.has(key)).toBe(false);
          met.add(key);
        }
      }
      book = playRound(book);
      expect(roundDone(book, r)).toBe(true);
    }
    expect(new Set(byes).size).toBe(3);
    const table = standings(book);
    expect(table).toHaveLength(5);
    // Three rounds of 3 points for a win or bye: 9 points total each round across 5 players... 2 wins + 1 bye.
    expect(table.reduce((n, s) => n + s.points, 0)).toBe(3 * (2 * 3 + 3));
    expect(table[0]!.points).toBeGreaterThanOrEqual(table[4]!.points);
    // Round two pairs winners with winners.
    const top = book.event!.pairings[1]![0]!.players;
    expect(top.length).toBe(2);
  });

  it("settles a pairing from a recorded game by its players", () => {
    let book = pair(eventBook(["Ana", "Bo"]));
    const game: CampaignGame = {
      id: "g1",
      at: 5,
      system: "forty-k-11",
      rounds: 5,
      sides: [
        { players: ["Bo"], armies: [], vp: 40, slain: 3, lost: 1 },
        { players: ["Ana"], armies: [], vp: 55, slain: 1, lost: 3 },
      ],
      winner: 1,
    };
    book = settlePairing({ ...book, games: [game] }, game);
    expect(book.event!.pairings[0]![0]!.game).toBe("g1");
    const [first, second] = standings(book);
    expect(first).toMatchObject({ name: "Ana", won: 1, points: 3, vpFor: 55, vpAgainst: 40 });
    expect(second).toMatchObject({ name: "Bo", lost: 1, points: 0 });
    // A second game between them isn't a result for a pairing already settled.
    expect(settlePairing(book, { ...game, id: "g2" })).toBe(book);
  });

  it("brings two copies together without losing a game from either", () => {
    const start = pair(eventBook(["Ana", "Bo", "Cy", "Di"]));
    const [p1, p2] = start.event!.pairings[0]!;
    const a = handResult(start, 0, p1!, [10, 2], "forty-k-11");
    const b = handResult(start, 0, p2!, [3, 3], "forty-k-11");
    const merged = mergeBooks(a, b);
    expect(merged.games.map((g) => g.id).sort()).toEqual(["hand-1-1", "hand-1-2"]);
    expect(roundDone(merged, 0)).toBe(true);
    // Either way round gives the same games and results.
    const other = mergeBooks(b, a);
    expect(standings(other)).toEqual(standings(merged));
    // Merging a copy into itself changes nothing.
    expect(mergeBooks(merged, merged)).toEqual(merged);
  });
});
