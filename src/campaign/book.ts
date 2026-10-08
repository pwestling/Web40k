import { sha256Hex, stableJson } from "../core/secrets";
import type { GameRecord, GameState } from "../core";
import { gameStats } from "../core/stats";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { settlePairing, type CampaignEvent } from "./event";
import { applyAwards, awardsIn } from "./rules";

/**
 * The campaign book (roadmap 24a): a small file a group of players share,
 * kept in step between peers by its hash, as packages are. It holds who is
 * playing and with which shelf armies, every game played for it (filled in
 * when a game ends), a league table worked out from those, a simple map of
 * places to fight over, and each unit's story so far: kills, games survived,
 * wounds carried, honours and scars, shown on its unit card next time.
 * No rules run from it (that's 24b): every field is the players' to edit.
 */

export const CAMPAIGN_FORMAT = "open-battle/campaign@1";

export interface CampaignArmy {
  /** Its id on the shelf (src/packages/shelf.ts). */
  id: string;
  name: string;
  system: string;
}

export interface CampaignPlayer {
  name: string;
  armies: CampaignArmy[];
}

export interface CampaignSide {
  players: string[];
  armies: string[];
  vp: number;
  /** Enemy models this side destroyed, and its own it lost. */
  slain: number;
  lost: number;
}

export interface CampaignGame {
  /** The game's own id (its first event), so the same game is never recorded twice. */
  id: string;
  /** When it ended (ms). */
  at: number;
  system: string;
  mission?: string;
  rounds: number;
  sides: CampaignSide[];
  /** The winning side's index, or null for a draw. */
  winner: number | null;
  territory?: string;
  /** Typed in for a game played off the app (an event result). */
  byHand?: boolean;
}

/** A unit's story so far: the numbers are filled in after each game, and everything can be edited. */
export interface CampaignUnit {
  name: string;
  army: string;
  kills: number;
  games: number;
  survived: number;
  /** Wounds it carries into its next game. */
  wounds: number;
  honours: string;
  scars: string;
  /** Experience, from campaign rules (rules.ts); missing until a rule awards some. */
  xp?: number;
}

export interface Territory {
  name: string;
  /** The player holding it. */
  holder?: string;
  /** The table it's fought on, from the table library (#28), by id and name. */
  table?: { id: string; name: string };
}

export interface CampaignBook {
  format: typeof CAMPAIGN_FORMAT;
  id: string;
  name: string;
  players: CampaignPlayer[];
  games: CampaignGame[];
  map: Territory[];
  /** By `${shelf army id}:${index in its roster}`. */
  units: Record<string, CampaignUnit>;
  notes: string;
  /** An event night: Swiss rounds, pairings and tables (event.ts). */
  event?: CampaignEvent;
}

export function newCampaign(name: string, id: string = crypto.randomUUID()): CampaignBook {
  return { format: CAMPAIGN_FORMAT, id, name, players: [], games: [], map: [], units: {}, notes: "" };
}

/** The hash peers compare: the same book, in any key order, hashes the same. */
export function campaignHash(book: CampaignBook): string {
  return sha256Hex(stableJson(book));
}

export const unitKey = (armyId: string, index: number) => `${armyId}:${index}`;

/** The campaign unit a unit on the table is, if its player brought a shelf army for this book. */
export function campaignUnitKey(game: GameState, unitId: string): string | null {
  const unit = game.units[unitId];
  const link = unit && game.campaign?.armies[unit.owner];
  if (!link || !unitId.startsWith(`${link.prefix}-`)) return null;
  const n = Number(unitId.slice(link.prefix.length + 1));
  return Number.isInteger(n) ? unitKey(link.armyId, n) : null;
}

/** Whether a file's contents look like a campaign book, with any missing parts filled in. */
export function readCampaign(data: unknown): CampaignBook | null {
  const b = data as Partial<CampaignBook> | null;
  if (!b || b.format !== CAMPAIGN_FORMAT || typeof b.id !== "string" || typeof b.name !== "string")
    return null;
  return {
    format: CAMPAIGN_FORMAT,
    id: b.id,
    name: b.name,
    players: Array.isArray(b.players) ? b.players : [],
    games: Array.isArray(b.games) ? b.games : [],
    map: Array.isArray(b.map) ? b.map : [],
    units: b.units && typeof b.units === "object" ? b.units : {},
    notes: typeof b.notes === "string" ? b.notes : "",
    ...(b.event && Array.isArray(b.event.pairings) && Array.isArray(b.event.entrants)
      ? {
          event: {
            ...b.event,
            dropped: Array.isArray(b.event.dropped) ? b.event.dropped : [],
            tables: Array.isArray(b.event.tables) ? b.event.tables : [],
          },
        }
      : {}),
  };
}

/** The game's id: its first event, the same on every peer. */
export function gameId(record: GameRecord): string | null {
  const first = record.events[0];
  return first ? `${first.at}-${first.seq}` : null;
}

/**
 * The book with a finished game added: its result, the players and their
 * armies, the map, and each campaign unit's kills, games and wounds. Every
 * peer works this out from the same game, so their copies stay the same.
 * A game already in the book leaves it as it is.
 */
export function recordGame(
  book: CampaignBook,
  record: GameRecord,
  game: GameState,
  result: { vp: number[]; seats: number[] },
): CampaignBook {
  const id = gameId(record);
  const ref = game.campaign;
  if (!id || !ref || ref.id !== book.id || book.games.some((g) => g.id === id)) return book;
  const stats = gameStats(record);
  const players = Object.values(game.players);
  // Only what the game itself says, so every peer writes the same bytes (UX 201).
  const armyName = (armyId: string) =>
    Object.values(ref.armies).find((a) => a.armyId === armyId && a.name)?.name ??
    book.players.flatMap((p) => p.armies).find((a) => a.id === armyId)?.name ??
    "an army";
  const sides: CampaignSide[] = result.seats.map((seat, i) => {
    const here = players.filter((p) => p.seat === seat);
    const ids = new Set(here.map((p) => p.id));
    const units = stats.units.filter((u) => ids.has(u.owner));
    return {
      players: here.map((p) => p.name),
      armies: here.flatMap((p) => (ref.armies[p.id] ? [armyName(ref.armies[p.id]!.armyId)] : [])),
      vp: result.vp[i] ?? 0,
      slain: units.reduce((n, u) => n + u.slain, 0),
      lost: units.reduce((n, u) => n + u.lost, 0),
    };
  });
  const best = Math.max(...sides.map((s) => s.vp));
  const top = sides.flatMap((s, i) => (s.vp === best ? [i] : []));
  const winner = top.length === 1 ? top[0]! : null;
  const entry: CampaignGame = {
    id,
    // The turn that ended the battle: the same on every peer, whatever came after it.
    at:
      [...record.events].reverse().find((e) => e.event.type === "turn/next")?.at ??
      record.events.at(-1)?.at ??
      0,
    system: game.system ?? DEFAULT_SYSTEM,
    ...(game.mission ? { mission: game.mission.name } : {}),
    rounds: Math.max(0, game.turn.round - 1),
    sides,
    winner,
    ...(ref.territory ? { territory: ref.territory } : {}),
  };

  // Players, and the shelf armies they brought.
  const roster = book.players.map((p) => ({ ...p, armies: [...p.armies] }));
  for (const p of players) {
    let entryFor = roster.find((r) => r.name === p.name);
    if (!entryFor) roster.push((entryFor = { name: p.name, armies: [] }));
    const link = ref.armies[p.id];
    if (link && !entryFor.armies.some((a) => a.id === link.armyId))
      entryFor.armies.push({
        id: link.armyId,
        name: armyName(link.armyId),
        system: link.system ?? game.system ?? DEFAULT_SYSTEM,
      });
  }

  // Each campaign unit's numbers.
  const units = { ...book.units };
  const byId = new Map(stats.units.map((u) => [u.id, u]));
  for (const unit of Object.values(game.units)) {
    const key = campaignUnitKey(game, unit.id);
    if (!key) continue;
    const alive = unit.modelIds.map((m) => game.models[m]).filter((m) => m && !m.destroyed);
    const was = units[key];
    units[key] = {
      name: unit.name,
      army: armyName(ref.armies[unit.owner]!.armyId),
      kills: (was?.kills ?? 0) + (byId.get(unit.id)?.slain ?? 0),
      games: (was?.games ?? 0) + 1,
      survived: (was?.survived ?? 0) + (alive.length ? 1 : 0),
      wounds: alive.reduce((n, m) => n + (m!.woundsLost ?? 0), 0),
      honours: was?.honours ?? "",
      scars: was?.scars ?? "",
      ...(was?.xp !== undefined ? { xp: was.xp } : {}),
    };
  }

  // The winner takes the territory fought over.
  const map = book.map.map((t) =>
    ref.territory && t.name === ref.territory && winner !== null
      ? { ...t, holder: sides[winner]!.players[0] }
      : t,
  );

  // At an event, the game settles its pairing.
  // What the campaign rules awarded after the battle (24b), from the log like everything else.
  const awarded = applyAwards(units, awardsIn(record));
  return settlePairing(
    { ...book, players: roster, games: [...book.games, entry], units: awarded, map },
    entry,
  );
}

export interface LeagueRow {
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  vpFor: number;
  vpAgainst: number;
  /** 3 for a win, 1 for a draw. */
  points: number;
  /** Places on the map they hold. */
  held: number;
}

/** The league table: by points, then VP difference, then VP scored. */
export function leagueTable(book: CampaignBook): LeagueRow[] {
  const rows = new Map<string, LeagueRow>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r)
      rows.set(
        name,
        (r = { name, played: 0, won: 0, drawn: 0, lost: 0, vpFor: 0, vpAgainst: 0, points: 0, held: 0 }),
      );
    return r;
  };
  for (const p of book.players) row(p.name);
  for (const g of book.games)
    g.sides.forEach((side, i) => {
      const against = g.sides.filter((_, j) => j !== i).reduce((n, s) => Math.max(n, s.vp), 0);
      for (const name of side.players) {
        const r = row(name);
        r.played++;
        r.vpFor += side.vp;
        r.vpAgainst += against;
        if (g.winner === null) {
          r.drawn++;
          r.points += 1;
        } else if (g.winner === i) {
          r.won++;
          r.points += 3;
        } else r.lost++;
      }
    });
  for (const t of book.map) if (t.holder) row(t.holder).held++;
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.vpFor - b.vpAgainst - (a.vpFor - a.vpAgainst) ||
      b.vpFor - a.vpFor ||
      a.name.localeCompare(b.name),
  );
}
