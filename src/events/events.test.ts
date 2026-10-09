import { describe, expect, it } from "vitest";
import type { RankedResult } from "../core/ranked";
import { canonResult } from "../core/ranked";
import {
  armyHash,
  eventId,
  eventStandings,
  readDoc,
  resultOf,
  roomFor,
  roundIn,
  type EntryDoc,
  type EventDoc,
} from "./event";
import { advance } from "./store";

const key = (c: string) => `${c.repeat(43)}.${c.repeat(43)}`;
const [A, B, C, D, E] = ["a", "b", "c", "d", "e"].map(key) as [string, string, string, string, string];
const HASH = "f".repeat(64);

function event(over: Partial<EventDoc> = {}): EventDoc {
  return {
    kind: "event",
    v: 1,
    id: eventId(A, "club"),
    organiser: A,
    name: "Club night",
    system: "rift-lanterns",
    game: "Rift Lanterns",
    points: null,
    rounds: 2,
    start: 1000,
    missions: [null, null],
    clock: 60,
    live: true,
    entrants: [],
    dropped: [],
    pairings: [],
    hand: [],
    closed: false,
    done: false,
    at: 1,
    ...over,
  };
}

const entry = (k: string, name: string, out = false): EntryDoc => ({
  kind: "entry",
  v: 1,
  event: eventId(A, "club"),
  key: k,
  name,
  army: HASH,
  armyName: `${name}'s warband`,
  ...(out ? { out: true } : {}),
  at: 2,
});

/** A signed result for a pairing, as the players' tables write it. */
function played(
  id: string,
  round: number,
  table: number,
  a: string,
  va: number,
  b: string,
  vb: number,
): RankedResult {
  return {
    v: 1,
    system: "rift-lanterns",
    points: null,
    rounds: 5,
    players: [
      { key: a, name: "x", vp: va },
      { key: b, name: "y", vp: vb },
    ],
    winner: va === vb ? null : va > vb ? 0 : 1,
    replay: `${round}${table}`.padStart(64, "0"),
    at: 10_000 + round * 100 + table,
    event: { id, round, table },
  };
}

describe("online events (#67)", () => {
  it("ties an event to its organiser and reads only well-formed docs", () => {
    const e = event();
    expect(readDoc(e)).toEqual(e);
    // Someone else's key can't publish under this id.
    expect(readDoc({ ...e, organiser: B })).toBeNull();
    // Pairings can only name entrants.
    expect(readDoc({ ...e, pairings: [[{ table: 1, players: [B, C] }]] })).toBeNull();
    expect(readDoc(entry(B, "Ben"))).toEqual(entry(B, "Ben"));
    expect(readDoc({ ...entry(B, "Ben"), army: "nothex" })).toBeNull();
    expect(roomFor(e.id, 2, 3)).toMatch(/^[A-Za-z0-9_-]{4,64}$/);
  });

  it("locks an army by its roster, whatever frontages are set at deploy", () => {
    const roster = { name: "Lanterns", units: [{ name: "Wardens", files: 5 }], warnings: [] } as never;
    const again = { name: "Lanterns", units: [{ name: "Wardens", files: 4 }], warnings: [] } as never;
    const other = { name: "Lanterns", units: [{ name: "Wardens II" }], warnings: [] } as never;
    expect(armyHash(roster)).toBe(armyHash(again));
    expect(armyHash(roster)).not.toBe(armyHash(other));
  });

  it("takes entries, starts at its time, pairs each round once the last is in, then finishes", () => {
    let e = event();
    const entries = [
      entry(A, "Ana"),
      entry(B, "Ben"),
      entry(C, "Cy"),
      entry(D, "Dee"),
      entry(E, "Eve", true),
    ];
    // Before the start: entries are taken, the withdrawn one isn't.
    e = advance(e, [], { entries, now: 500 })!;
    expect(e.entrants.map((x) => x.name)).toEqual(["Ana", "Ben", "Cy", "Dee"]);
    expect(e.closed).toBe(false);
    expect(advance(e, [], { entries, now: 500 })).toBeNull();
    // The start: closed, round one paired, every player once.
    e = advance(e, [], { entries, now: 1000 })!;
    expect(e.closed).toBe(true);
    expect(e.pairings[0]!.flatMap((p) => p.players).sort()).toEqual([A, B, C, D].sort());
    // Nothing more until both games are in.
    const [t1, t2] = e.pairings[0]!;
    const r1 = [played(e.id, 1, 1, t1!.players[0]!, 5, t1!.players[1]!, 2)];
    expect(advance(e, r1)).toBeNull();
    expect(roundIn(e, 1, r1)).toBe(false);
    const all = [...r1, played(e.id, 1, 2, t2!.players[1]!, 3, t2!.players[0]!, 3)];
    expect(roundIn(e, 1, all)).toBe(true);
    e = advance(e, all)!;
    // Round two: winners meet, no rematches.
    const met = new Set(e.pairings[0]!.map((p) => [...p.players].sort().join()));
    expect(e.pairings[1]!.every((p) => !met.has([...p.players].sort().join()))).toBe(true);
    expect(e.pairings[1]![0]!.players).toContain(t1!.players[0]);
    // The last round in: done, and the standings are the same from any order of results.
    const r2 = e.pairings[1]!.map((p, i) => played(e.id, 2, p.table, p.players[0]!, 4 + i, p.players[1]!, 1));
    const end = advance(e, [...all, ...r2])!;
    expect(end.done).toBe(true);
    const one = eventStandings(end, [...all, ...r2]);
    expect(eventStandings(end, [...r2, ...all].reverse())).toEqual(one);
    expect(one[0]!.points).toBe(6);
  });

  it("counts only results that name the pairing, and the organiser's ruling over them", () => {
    let e = event({ entrants: [A, B].map((k, i) => ({ key: k, name: `P${i}`, army: HASH, armyName: "x" })) });
    e = advance(e, [], { now: 2000 })!;
    const p = e.pairings[0]![0]!;
    const [x, y] = p.players as [string, string];
    // A ranked game between the same two outside the event doesn't count for it.
    const outside = { ...played(e.id, 1, 1, x, 9, y, 0) };
    delete outside.event;
    expect(resultOf(e, 1, p, [outside])).toBeNull();
    const signed = played(e.id, 1, 1, x, 9, y, 0);
    expect(resultOf(e, 1, p, [signed])).toEqual({ vp: [9, 0], byHand: false });
    // A ruling on a dispute stands over the signed result.
    const ruled = { ...e, hand: [{ round: 1, table: 1, vp: [3, 3] as [number, number], note: "slow play" }] };
    expect(resultOf(ruled, 1, p, [signed])).toEqual({ vp: [3, 3], byHand: true });
    // The pairing is part of what both sign.
    expect(canonResult(signed)).toContain(`"event":{"id":"${e.id}","round":1,"table":1}`);
    expect(canonResult({ ...signed, event: { id: e.id, round: 0, table: 1 } })).toBeNull();
  });
});
