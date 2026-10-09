import { isPlayerKey, type PlayerKey, type RankedResult } from "../core/ranked";
import { sha256Hex, stableJson } from "../core/secrets";
import { newCampaign, type CampaignBook, type CampaignGame } from "../campaign/book";
import { newEvent, pairNextRound, standings, type EventPairing } from "../campaign/event";
import type { ImportedRoster } from "../systems/wh40k/roster";

/**
 * Online events (#67): a club night or a tournament run with no server. The
 * organiser's browser publishes the event (signed with their player key) on
 * the Open tables relays or the site's board: what it is, who is in, each
 * round's Swiss pairings (the #29 logic) and any rulings. Players publish
 * their own entries, signed with theirs, naming the shelf army they bring,
 * locked by its hash. Results are the players' double-signed ranked results
 * (#65) naming the pairing, so every browser works the standings out the same.
 */

/** A player in the event, as the organiser accepted them: their key, name and the army they're locked to. */
export interface Entrant {
  key: PlayerKey;
  name: string;
  /** SHA-256 of the army's roster (armyHash), fixed at registration. */
  army: string;
  armyName: string;
}

/** A result the organiser entered or ruled on: it stands over any signed result for that pairing. */
export interface HandResult {
  round: number;
  table: number;
  /** By the pairing's players, in order. */
  vp: [number, number];
  note?: string;
}

export interface EventDoc {
  kind: "event";
  v: 1;
  id: string;
  organiser: PlayerKey;
  name: string;
  system: string;
  /** The system's name as the organiser's app shows it. */
  game: string;
  points: number | null;
  rounds: number;
  /** When it starts (epoch ms). */
  start: number;
  /** A mission per round, by id and name; null: the players choose. */
  missions: ({ id: string; name: string } | null)[];
  /** Minutes on each player's clock; null: untimed. */
  clock: number | null;
  /** The top tables go on Live now. */
  live: boolean;
  entrants: Entrant[];
  dropped: PlayerKey[];
  /** Each round's pairings by player key (two, or one for a bye), as published. */
  pairings: EventPairing[][];
  hand: HandResult[];
  /** Registration is closed (the event has started). */
  closed: boolean;
  /** The last round is in: these are the final standings. */
  done: boolean;
  /** When this version was published (the newest of the organiser's wins). */
  at: number;
}

/** A player's entry: who they are, and the shelf army they bring. `out`: they withdrew before the start. */
export interface EntryDoc {
  kind: "entry";
  v: 1;
  event: string;
  key: PlayerKey;
  name: string;
  army: string;
  armyName: string;
  out?: boolean;
  at: number;
}

export type EventItem = EventDoc | EntryDoc;

/** A doc as it travels: signed by the key it names (the organiser's, or the entrant's). */
export interface SignedDoc {
  doc: EventItem;
  sig: string;
}

/** What the author signs: the doc in one spelling, marked so the signature means nothing else. */
export const docText = (doc: EventItem) => `open-battle-event:${stableJson(doc)}`;

/** Who must have signed a doc. */
export const authorOf = (doc: EventItem): PlayerKey => (doc.kind === "event" ? doc.organiser : doc.key);

/** An event's id is tied to its organiser's key, so nobody else can publish under it. */
export function eventId(organiser: PlayerKey, salt: string): string {
  return `${sha256Hex(organiser).slice(0, 12)}${salt
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8)}`;
}

const ownsId = (id: string, organiser: PlayerKey) => id.startsWith(sha256Hex(organiser).slice(0, 12));

/** The army a player is locked to: its roster, frontages aside (a rank-and-flank player sets those at deploy). */
export function armyHash(roster: ImportedRoster): string {
  return sha256Hex(
    stableJson({
      name: roster.name,
      units: roster.units.map((u) => ({ ...u, files: undefined })),
    }),
  );
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.length <= max ? v : null;
const int = (v: unknown, lo: number, hi: number): number | null =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null;
const hex64 = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

/** A doc read off the board, checked for shape (its signature is checked by the store); null if it isn't one. */
export function readDoc(raw: unknown): EventItem | null {
  const d = raw as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || d.v !== 1 || !Number.isFinite(d.at)) return null;
  if (d.kind === "entry") {
    const event = str(d.event, 40);
    const name = str(d.name, 32);
    const armyName = str(d.armyName, 80);
    if (!event || !name || !armyName || !isPlayerKey(d.key) || !hex64(d.army)) return null;
    return {
      kind: "entry",
      v: 1,
      event,
      key: d.key,
      name,
      army: d.army,
      armyName,
      ...(d.out === true ? { out: true } : {}),
      at: d.at as number,
    };
  }
  if (d.kind !== "event") return null;
  const id = str(d.id, 40);
  const name = str(d.name, 60);
  const system = str(d.system, 64);
  const game = str(d.game, 64);
  const rounds = int(d.rounds, 1, 12);
  const start = Number.isFinite(d.start) ? (d.start as number) : null;
  if (!id || !/^[a-z0-9]{12,20}$/.test(id) || !name || !system || !game || !rounds || start === null)
    return null;
  if (!isPlayerKey(d.organiser) || !ownsId(id, d.organiser)) return null;
  const points = d.points === null ? null : int(d.points, 1, 100_000);
  if (points === null && d.points !== null) return null;
  const clock = d.clock === null ? null : int(d.clock, 1, 600);
  if (clock === null && d.clock !== null) return null;
  const missions = Array.isArray(d.missions) ? d.missions.slice(0, rounds) : [];
  const entrants = Array.isArray(d.entrants) ? d.entrants : [];
  const pairings = Array.isArray(d.pairings) ? d.pairings : [];
  const hand = Array.isArray(d.hand) ? d.hand : [];
  const dropped = Array.isArray(d.dropped) ? d.dropped : [];
  const okEntrant = (e: Partial<Entrant> | null) =>
    !!e && isPlayerKey(e.key) && !!str(e.name, 32) && hex64(e.army) && !!str(e.armyName, 80);
  if (entrants.length > 256 || !entrants.every(okEntrant)) return null;
  const keys = new Set((entrants as Entrant[]).map((e) => e.key));
  if (keys.size !== entrants.length || !dropped.every((k) => keys.has(k as string))) return null;
  if (pairings.length > rounds) return null;
  for (const round of pairings) {
    if (!Array.isArray(round)) return null;
    for (const p of round as Partial<EventPairing>[]) {
      if (
        !p ||
        !int(p.table, 1, 500) ||
        !Array.isArray(p.players) ||
        p.players.length < 1 ||
        p.players.length > 2
      )
        return null;
      if (!p.players.every((k) => keys.has(k))) return null;
    }
  }
  for (const h of hand as Partial<HandResult>[])
    if (
      !h ||
      !int(h.round, 1, rounds) ||
      !int(h.table, 1, 500) ||
      !Array.isArray(h.vp) ||
      h.vp.length !== 2 ||
      !h.vp.every((v) => int(v, 0, 9999) !== null) ||
      (h.note !== undefined && !str(h.note, 140))
    )
      return null;
  return {
    kind: "event",
    v: 1,
    id,
    organiser: d.organiser,
    name,
    system,
    game,
    points,
    rounds,
    start,
    missions: missions.map((m) => {
      const x = m as { id?: unknown; name?: unknown } | null;
      return x && str(x.id, 64) && str(x.name, 80) ? { id: x.id as string, name: x.name as string } : null;
    }),
    clock,
    live: d.live === true,
    entrants: entrants as Entrant[],
    dropped: dropped as PlayerKey[],
    pairings: (pairings as EventPairing[][]).map((r) =>
      r.map((p) => ({ table: p.table, players: p.players })),
    ),
    hand: (hand as HandResult[]).map((h) => ({
      round: h.round,
      table: h.table,
      vp: [h.vp[0], h.vp[1]],
      ...(h.note ? { note: h.note } : {}),
    })),
    closed: d.closed === true,
    done: d.done === true,
    at: d.at as number,
  };
}

/** A pairing's room: one per event, round and table, the same on every device. */
export const roomFor = (id: string, round: number, table: number) => `ev${id}r${round}t${table}`;

/** A pairing's result: the organiser's ruling if there is one, else the signed ranked result that names it. */
function pairingResult(
  event: EventDoc,
  round: number,
  pairing: EventPairing,
  results: RankedResult[],
): { vp: [number, number]; at: number; byHand: boolean } | null {
  const hand = event.hand.find((h) => h.round === round && h.table === pairing.table);
  if (hand) return { vp: hand.vp, at: event.at, byHand: true };
  if (pairing.players.length < 2) return null;
  const [a, b] = pairing.players as [PlayerKey, PlayerKey];
  const r = results
    .filter(
      (x) =>
        x.system === event.system &&
        x.event?.id === event.id &&
        x.event.round === round &&
        x.event.table === pairing.table &&
        x.players.some((p) => p.key === a) &&
        x.players.some((p) => p.key === b),
    )
    // The same pairing played twice (a restart): the first result signed stands, on every device.
    .sort((x, y) => x.at - y.at || (x.replay < y.replay ? -1 : 1))[0];
  if (!r) return null;
  const vpOf = (k: PlayerKey) => r.players.find((p) => p.key === k)!.vp;
  return { vp: [vpOf(a), vpOf(b)], at: r.at, byHand: false };
}

/**
 * The event as a campaign book (the #29 Swiss logic works on those): entrants
 * by key, each settled pairing a game.
 */
function asBook(event: EventDoc, results: RankedResult[]): CampaignBook {
  const book = newCampaign(event.name, event.id);
  const games: CampaignGame[] = [];
  const pairings = event.pairings.map((round, r) =>
    round.map((p) => {
      const res = pairingResult(event, r + 1, p, results);
      if (!res || p.players.length < 2) return { ...p };
      const id = `r${r + 1}t${p.table}`;
      games.push({
        id,
        at: res.at,
        system: event.system,
        rounds: 0,
        sides: p.players.map((key, i) => ({ players: [key], armies: [], vp: res.vp[i]!, slain: 0, lost: 0 })),
        winner: res.vp[0] === res.vp[1] ? null : res.vp[0] > res.vp[1] ? 0 : 1,
        ...(res.byHand ? { byHand: true } : {}),
      });
      return { ...p, game: id };
    }),
  );
  const base = newEvent(
    event.entrants.map((e) => e.key),
    event.rounds,
    [],
  );
  return { ...book, games, event: { ...base, dropped: [...event.dropped], pairings } };
}

interface EventStanding {
  key: PlayerKey;
  name: string;
  points: number;
  won: number;
  drawn: number;
  lost: number;
  byes: number;
  vpFor: number;
  vpAgainst: number;
  sos: number;
  dropped: boolean;
}

/** The standings, as every device works them out: 3 a win or bye, 1 a draw, then SoS, VP difference, VP. */
export function eventStandings(event: EventDoc, results: RankedResult[]): EventStanding[] {
  const names = new Map(event.entrants.map((e) => [e.key, e.name]));
  return standings(asBook(event, results)).map((s) => ({
    key: s.name,
    name: names.get(s.name) ?? "?",
    points: s.points,
    won: s.won,
    drawn: s.drawn,
    lost: s.lost,
    byes: s.byes,
    vpFor: s.vpFor,
    vpAgainst: s.vpAgainst,
    sos: s.sos,
    dropped: s.dropped,
  }));
}

/**
 * Each place's label: "1", or "=2" for players level on everything the order
 * looks at; none ("–") before anyone has a result, so no one's ranked unearned (PX).
 */
export function rankLabels(rows: EventStanding[]): string[] {
  if (!rows.some((r) => r.won + r.drawn + r.lost + r.byes > 0)) return rows.map(() => "–");
  const level = (a: EventStanding, b: EventStanding) =>
    a.points === b.points &&
    a.sos === b.sos &&
    a.vpFor - a.vpAgainst === b.vpFor - b.vpAgainst &&
    a.vpFor === b.vpFor;
  return rows.map((r, i) => {
    let first = i;
    while (first > 0 && level(rows[first - 1]!, r)) first--;
    const tied = first < i || (i + 1 < rows.length && level(rows[i + 1]!, r));
    return `${tied ? "=" : ""}${first + 1}`;
  });
}

/** Whether every pairing in a round (from 1) has a result. */
export function roundIn(event: EventDoc, round: number, results: RankedResult[]): boolean {
  const pairs = event.pairings[round - 1];
  return !!pairs && pairs.every((p) => p.players.length < 2 || !!pairingResult(event, round, p, results));
}

/** A pairing's result as the event shows it, or null while it's being played. */
export function resultOf(
  event: EventDoc,
  round: number,
  pairing: EventPairing,
  results: RankedResult[],
): { vp: [number, number]; byHand: boolean } | null {
  const r = pairingResult(event, round, pairing, results);
  return r && { vp: r.vp, byHand: r.byHand };
}

/** The next round's pairings, by key. */
export function nextPairings(event: EventDoc, results: RankedResult[]): EventPairing[] {
  return pairNextRound(asBook(event, results)).map((p) => ({ table: p.table, players: p.players }));
}

/** This player's pairing in a round, if they have one. */
export function myPairing(event: EventDoc, round: number, key: PlayerKey | null): EventPairing | null {
  if (!key) return null;
  return event.pairings[round - 1]?.find((p) => p.players.includes(key)) ?? null;
}
