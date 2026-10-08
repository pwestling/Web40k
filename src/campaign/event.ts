import type { CampaignBook, CampaignGame, Territory } from "./book";

/**
 * Event night (roadmap #29): a tournament in the campaign book. Swiss
 * pairings over a set number of rounds: each round pairs players on the same
 * score, never twice against the same opponent when it can be helped, and
 * gives an odd player out a bye. Each pairing gets a table number and a
 * layout from the table library. Results come in as campaign games do (the
 * game is matched to its pairing by the players' names when it's recorded),
 * or are typed in by hand for a game played off the app.
 */

export interface EventPairing {
  /** Table number, from 1: the top pairing plays on table 1. */
  table: number;
  /** Two players, or one for a bye. */
  players: string[];
  /** The campaign game that settled it. */
  game?: string;
}

export interface CampaignEvent {
  rounds: number;
  /** Everyone who entered, by name as in the book. */
  entrants: string[];
  /** Players who left the event: not paired again, their results stand. */
  dropped: string[];
  /** Library tables the pairings are played on, by id and name; shared out in table order. */
  tables: { id: string; name: string }[];
  /** Each round's pairings, as they were made. */
  pairings: EventPairing[][];
}

export interface Standing {
  name: string;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  byes: number;
  vpFor: number;
  vpAgainst: number;
  /** Strength of schedule: the points of everyone they played. */
  sos: number;
  dropped: boolean;
}

export const WIN = 3;
export const DRAW = 1;

export function newEvent(entrants: string[], rounds: number, tables: CampaignEvent["tables"]): CampaignEvent {
  return { rounds, entrants: [...new Set(entrants)], dropped: [], tables, pairings: [] };
}

/** The library table a pairing is played on, if the event has any. */
export function pairingTable(
  event: CampaignEvent,
  pairing: EventPairing,
): { id: string; name: string } | null {
  return event.tables.length ? event.tables[(pairing.table - 1) % event.tables.length]! : null;
}

interface Result {
  /** Points scored by each of the pairing's players, in order. */
  vp: number[];
  winner: number | null;
}

/** A pairing's result from its game, by each player's side. */
function resultOf(pairing: EventPairing, games: Map<string, CampaignGame>): Result | null {
  const game = pairing.game ? games.get(pairing.game) : undefined;
  if (!game) return null;
  const sideOf = (name: string) => game.sides.findIndex((s) => s.players.includes(name));
  const sides = pairing.players.map(sideOf);
  if (sides.some((s) => s < 0)) return null;
  return {
    vp: sides.map((s) => game.sides[s]!.vp),
    winner: game.winner === null ? null : sides.indexOf(game.winner) < 0 ? null : sides.indexOf(game.winner),
  };
}

/** Whether every pairing in a round has a result (a bye always has). */
export function roundDone(book: CampaignBook, round: number): boolean {
  const games = new Map(book.games.map((g) => [g.id, g]));
  return (book.event?.pairings[round] ?? []).every((p) => p.players.length < 2 || !!resultOf(p, games));
}

/** The standings: points (3 a win or bye, 1 a draw), then strength of schedule, then VP difference, then VP. */
export function standings(book: CampaignBook): Standing[] {
  const event = book.event;
  if (!event) return [];
  const games = new Map(book.games.map((g) => [g.id, g]));
  const rows = new Map<string, Standing>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r)
      rows.set(
        name,
        (r = {
          name,
          points: 0,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          byes: 0,
          vpFor: 0,
          vpAgainst: 0,
          sos: 0,
          dropped: event.dropped.includes(name),
        }),
      );
    return r;
  };
  for (const name of event.entrants) row(name);
  const opponents = new Map<string, string[]>();
  for (const round of event.pairings)
    for (const p of round) {
      if (p.players.length === 1) {
        const r = row(p.players[0]!);
        r.byes++;
        r.points += WIN;
        continue;
      }
      const result = resultOf(p, games);
      if (!result) continue;
      p.players.forEach((name, i) => {
        const r = row(name);
        const them = 1 - i;
        r.played++;
        r.vpFor += result.vp[i] ?? 0;
        r.vpAgainst += result.vp[them] ?? 0;
        if (result.winner === null) {
          r.drawn++;
          r.points += DRAW;
        } else if (result.winner === i) {
          r.won++;
          r.points += WIN;
        } else r.lost++;
        opponents.set(name, [...(opponents.get(name) ?? []), p.players[them]!]);
      });
    }
  for (const r of rows.values()) r.sos = (opponents.get(r.name) ?? []).reduce((n, o) => n + row(o).points, 0);
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.sos - a.sos ||
      b.vpFor - b.vpAgainst - (a.vpFor - a.vpAgainst) ||
      b.vpFor - a.vpFor ||
      a.name.localeCompare(b.name),
  );
}

/** A small, fixed shuffle, so the first round's draw is the same on every device for the same book. */
function seededOrder(names: string[], seed: string): string[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...names];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Who has already played whom, as "a|b" keys. */
function played(event: CampaignEvent): Set<string> {
  const met = new Set<string>();
  for (const round of event.pairings)
    for (const p of round)
      if (p.players.length === 2) {
        met.add(`${p.players[0]}|${p.players[1]}`);
        met.add(`${p.players[1]}|${p.players[0]}`);
      }
  return met;
}

/**
 * Pair a list top-down: each player takes the nearest one below them they
 * haven't played, backing up when that strands someone. Falls back to
 * allowing rematches only when there's no way round them.
 */
function pairDown(order: string[], met: Set<string>): [string, string][] {
  // A big field late in an event can make avoiding every rematch a long search: give up on it in time.
  let budget = 20000;
  const go = (left: string[], rematch: boolean): [string, string][] | null => {
    if (!left.length) return [];
    if (!rematch && --budget < 0) return null;
    const [first, ...rest] = left as [string, ...string[]];
    for (let i = 0; i < rest.length; i++) {
      const other = rest[i]!;
      if (!rematch && met.has(`${first}|${other}`)) continue;
      const after = go([...rest.slice(0, i), ...rest.slice(i + 1)], rematch);
      if (after) return [[first, other], ...after];
    }
    return null;
  };
  return go(order, false) ?? go(order, true)!;
}

/** The next round's pairings: by the standings (round one, a fixed shuffle), with a bye for an odd player out. */
export function pairNextRound(book: CampaignBook): EventPairing[] {
  const event = book.event;
  if (!event) return [];
  const active = event.entrants.filter((n) => !event.dropped.includes(n));
  let order = event.pairings.length
    ? standings(book)
        .filter((s) => !s.dropped && active.includes(s.name))
        .map((s) => s.name)
    : seededOrder(active, `${book.id}:${active.join(",")}`);
  let bye: string | null = null;
  if (order.length % 2) {
    const hadBye = new Set(event.pairings.flat().flatMap((p) => (p.players.length === 1 ? p.players : [])));
    bye = [...order].reverse().find((n) => !hadBye.has(n)) ?? order.at(-1)!;
    order = order.filter((n) => n !== bye);
  }
  const pairs = pairDown(order, played(event));
  return [
    ...pairs.map((players, i) => ({ table: i + 1, players })),
    ...(bye ? [{ table: pairs.length + 1, players: [bye] }] : []),
  ];
}

/** The open pairing in the event's latest round for these players, if there is one. */
export function openPairing(
  book: CampaignBook,
  names: string[],
): { round: number; pairing: EventPairing } | null {
  const event = book.event;
  if (!event?.pairings.length) return null;
  const round = event.pairings.length - 1;
  const pairing = event.pairings[round]!.find(
    (p) => p.players.length === 2 && !p.game && p.players.every((n) => names.includes(n)),
  );
  return pairing ? { round, pairing } : null;
}

/** The book with a game settling its pairing, if it settles one. */
export function settlePairing(book: CampaignBook, game: CampaignGame): CampaignBook {
  const names = game.sides.flatMap((s) => s.players);
  const open = book.event && game.sides.length === 2 ? openPairing(book, names) : null;
  if (!book.event || !open) return book;
  const pairings = book.event.pairings.map((round, r) =>
    r === open.round ? round.map((p) => (p === open.pairing ? { ...p, game: game.id } : p)) : round,
  );
  return { ...book, event: { ...book.event, pairings } };
}

/** A result typed in for a game played off the app: a campaign game "by hand". */
export function handResult(
  book: CampaignBook,
  round: number,
  pairing: EventPairing,
  vp: [number, number],
  system: string,
): CampaignBook {
  const id = `hand-${round + 1}-${pairing.table}`;
  const game: CampaignGame = {
    id,
    at: Date.now(),
    system,
    rounds: 0,
    sides: pairing.players.map((name, i) => ({ players: [name], armies: [], vp: vp[i]!, slain: 0, lost: 0 })),
    winner: vp[0] === vp[1] ? null : vp[0] > vp[1] ? 0 : 1,
    byHand: true,
  };
  const games = [...book.games.filter((g) => g.id !== id), game];
  const pairings = book.event!.pairings.map((r, i) =>
    i === round ? r.map((p) => (p === pairing ? { ...p, game: id } : p)) : r,
  );
  return { ...book, games, event: { ...book.event!, pairings } };
}

/**
 * Two copies of the same book brought together, for event night: games
 * played at different tables land in different players' copies, and neither
 * should lose the other's. Games are joined by id; a unit's story comes from
 * the copy where it has played more games; a place goes to whoever won the
 * latest game for it; the event keeps the copy with more rounds paired, with
 * every result either copy has. `mine` wins anything else (name, notes).
 */
export function mergeBooks(mine: CampaignBook, theirs: CampaignBook): CampaignBook {
  const games = [...mine.games];
  for (const g of theirs.games) if (!games.some((x) => x.id === g.id)) games.push(g);
  games.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const players = mine.players.map((p) => ({ ...p, armies: [...p.armies] }));
  for (const p of theirs.players) {
    const here = players.find((x) => x.name === p.name);
    if (!here) players.push({ ...p, armies: [...p.armies] });
    else for (const a of p.armies) if (!here.armies.some((x) => x.id === a.id)) here.armies.push(a);
  }

  const units = { ...mine.units };
  for (const [key, u] of Object.entries(theirs.units))
    if (!units[key] || u.games > units[key].games) units[key] = u;

  const lastFor = (book: CampaignBook, place: string) =>
    book.games.filter((g) => g.territory === place).reduce((n, g) => Math.max(n, g.at), -1);
  const map: Territory[] = mine.map.map((t) => {
    const other = theirs.map.find((x) => x.name === t.name);
    return other && lastFor(theirs, t.name) > lastFor(mine, t.name) ? { ...t, holder: other.holder } : t;
  });
  for (const t of theirs.map) if (!map.some((x) => x.name === t.name)) map.push(t);

  let event = mine.event;
  if (theirs.event) {
    const base = !event || theirs.event.pairings.length > event.pairings.length ? theirs.event : event;
    const other = base === event ? theirs.event : event;
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((n) => b.includes(n));
    const settled = (round: number, p: EventPairing) =>
      other?.pairings[round]?.find((o) => o.table === p.table && same(o.players, p.players))?.game;
    event = {
      ...base,
      dropped: [...new Set([...base.dropped, ...(other?.dropped ?? [])])],
      pairings: base.pairings.map((round, r) =>
        round.map((p) => {
          const game = p.game ?? settled(r, p);
          return game ? { ...p, game } : p;
        }),
      ),
    };
  }
  return { ...mine, games, players, units, map, ...(event ? { event } : {}) };
}

/** Whether a copy has games another lacks: then taking it whole would lose them. */
export function hasGamesMissingFrom(copy: CampaignBook, other: CampaignBook): boolean {
  const ids = new Set(other.games.map((g) => g.id));
  return copy.games.some((g) => !ids.has(g.id));
}
