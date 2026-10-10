import rulesetsFile from "../../rulesets.json";
import type { PlayerKey, RankedPackage, RankedResult } from "../core/ranked";
import type { SignedResult } from "./verify";

/**
 * Ratings with no server (#65): every client works the ladder out for itself
 * from the signed results it has seen, in one order (time, then replay hash),
 * so two clients with the same results agree to the point. Plain Elo per
 * ladder, from 1500, K 32.
 *
 * A ladder is a game system plus the house rules played with it
 * (docs/compatibility.md): games with a rules package added count on that
 * package set's own ladder, never the plain one. The game's own package (a
 * package that is the whole game) doesn't split it.
 *
 * The abuse floor: only results both players signed get here (verify.ts), a
 * replay counts once, and the same two players count at most PAIR_CAP games
 * in any PAIR_WINDOW_MS (more is farming, not playing).
 */

export const START = 1500;
export const K = 32;
export const PAIR_CAP = 3;
const PAIR_WINDOW_MS = 24 * 3600_000;
/** Fewer games than this and the rating is still finding its level. */
export const PROVISIONAL = 5;
/** Different opponents a player must have met before beating them moves anyone's rating (keys cost nothing to make). */
const ESTABLISHED_OPPONENTS = 3;

/** When a player's games start moving their opponents' ratings. */
interface Bar {
  games: number;
  opponents: number;
}
const BAR: Bar = { games: PROVISIONAL, opponents: ESTABLISHED_OPPONENTS };

export interface Rating {
  key: PlayerKey;
  /** Played PROVISIONAL counted games against at least ESTABLISHED_OPPONENTS different keys: their games move other ratings. */
  established: boolean;
  /** The name on their latest counted result. */
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

/** The chance the first player beats the second, by rating. */
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

/** One game's change for the first player: score 1 a win, 0.5 a draw, 0 a loss. */
export const change = (a: number, b: number, score: number) => K * (score - expected(a, b));

const order = (x: SignedResult, y: SignedResult) =>
  x.result.at - y.result.at ||
  (x.result.replay < y.result.replay ? -1 : x.result.replay > y.result.replay ? 1 : 0);

/** A named ruleset (rulesets.json): one ladder for these rules, across the builds and package versions listed. */
interface Ruleset {
  id: string;
  name: string;
  system: string;
  /** App versions (the build before "+"), e.g. "0.1.0". */
  versions: string[];
  /** Each a set of package hashes that plays as this ruleset; [] for a built-in game with none. */
  packages: string[][];
}

const RULESETS: Ruleset[] = (rulesetsFile as { rulesets: Ruleset[] }).rulesets;

/** A build's version: "0.1.0+abc1234" is "0.1.0"; a fork's "0.1.0-fork.name+abc" is "0.1.0-fork.name". */
const versionOf = (build: string) => build.split("+")[0]!;

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/** The named ruleset a result was played under, if it is one. */
export function rulesetOf(r: RankedResult, rulesets: Ruleset[] = RULESETS): Ruleset | undefined {
  const app = r.rules?.app;
  if (!r.rules || !app) return undefined;
  const hashes = r.rules.packages.map((p) => p.hash);
  return rulesets.find(
    (x) =>
      x.system === r.system &&
      x.versions.includes(versionOf(app)) &&
      x.packages.some((set) => sameSet(set, hashes)),
  );
}

/**
 * The ladder a result counts on (docs/compatibility.md): a named ruleset's
 * id, or else the system with the app version and the sorted hashes of every
 * package, so different rules never share a ladder. Results from before
 * rulesets say no rules and go on a ladder of their own.
 */
export function ladderKey(r: RankedResult, rulesets: Ruleset[] = RULESETS): string {
  if (!r.rules) return `${r.system}+legacy`;
  const named = rulesetOf(r, rulesets);
  if (named) return named.id;
  const hashes = r.rules.packages.map((p) => p.hash).sort();
  return [`${r.system}@${versionOf(r.rules.app ?? "?")}`, ...hashes].join("+");
}

/** The ladder a game of `system` with no house rules counts on, played on `build`. */
export function plainLadder(system: string, build: string, rulesets: Ruleset[] = RULESETS): string {
  const named = rulesets.find((x) => x.system === system && x.versions.includes(versionOf(build)));
  return named?.id ?? `${system}@${versionOf(build)}`;
}

/** A ladder's name parts, from any result on it: a named ruleset, or the system, version and packages. */
export function ladderAbout(
  results: SignedResult[],
  key: string,
): { name?: string; system: string; version?: string; packages: RankedPackage[] } {
  const named = RULESETS.find((x) => x.id === key);
  if (named) return { name: named.name, system: named.system, packages: [] };
  const one = results.find((r) => ladderKey(r.result) === key)?.result;
  const [head] = key.split("+");
  const [system, version] = head!.split("@");
  return { system: one?.system ?? system!, version, packages: one?.rules?.packages ?? [] };
}

/** The results that count on ladder `on` (ladderKey), in counting order: each replay once, the pair cap applied. */
export function counted(results: SignedResult[], on: string): SignedResult[] {
  const seen = new Set<string>();
  const pairs = new Map<string, number[]>();
  const out: SignedResult[] = [];
  for (const r of results.filter((x) => ladderKey(x.result) === on).sort(order)) {
    if (seen.has(r.result.replay)) continue;
    seen.add(r.result.replay);
    const pair = r.result.players
      .map((p) => p.key)
      .sort()
      .join("|");
    const recent = (pairs.get(pair) ?? []).filter((at) => r.result.at - at < PAIR_WINDOW_MS);
    if (recent.length >= PAIR_CAP) continue;
    pairs.set(pair, [...recent, r.result.at]);
    out.push(r);
  }
  return out;
}

/** Every rating after each counted game, in order; `each` sees each game's change for its first player. */
function fold(
  results: SignedResult[],
  on: string,
  bar: Bar,
  each?: (
    result: SignedResult["result"],
    a: Rating,
    b: Rating,
    da: number,
    db: number,
    /** Each side's change was held at 0: its opponent isn't established yet. */
    heldA: boolean,
    heldB: boolean,
  ) => void,
): Map<PlayerKey, Rating> {
  const by = new Map<PlayerKey, Rating>();
  const met = new Map<PlayerKey, Set<PlayerKey>>();
  const get = (key: PlayerKey, name: string) => {
    const r = by.get(key) ?? {
      key,
      name,
      rating: START,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      established: bar.games === 0 && bar.opponents === 0,
    };
    r.name = name;
    by.set(key, r);
    return r;
  };
  for (const { result } of counted(results, on)) {
    const [a, b] = [
      get(result.players[0].key, result.players[0].name),
      get(result.players[1].key, result.players[1].name),
    ];
    const score = result.winner === null ? 0.5 : result.winner === 0 ? 1 : 0;
    // A side's rating moves only against an established opponent, so a new key can't feed anyone.
    const d = change(a.rating, b.rating, score);
    const [ea, eb] = [a.established, b.established];
    const [da, db] = [eb ? d : 0, ea ? -d : 0];
    a.rating += da;
    b.rating += db;
    for (const [p, s] of [
      [a, score],
      [b, 1 - score],
    ] as const) {
      p.games++;
      if (s === 1) p.wins++;
      else if (s === 0) p.losses++;
      else p.draws++;
    }
    for (const [p, q] of [
      [a, b],
      [b, a],
    ] as const) {
      const seen = met.get(p.key) ?? new Set();
      met.set(p.key, seen.add(q.key));
      p.established = p.games >= bar.games && seen.size >= bar.opponents;
    }
    each?.(result, a, b, da, db, !eb, !ea);
  }
  return by;
}

/** One ladder (ladderKey), best first; on equal ratings (new players' are held), the better record first. */
export function ladder(results: SignedResult[], on: string, bar: Bar = BAR): Rating[] {
  return [...fold(results, on, bar).values()]
    .map((r) => ({ ...r, rating: Math.round(r.rating) }))
    .sort(
      (x, y) =>
        y.rating - x.rating ||
        y.wins - y.losses - (x.wins - x.losses) ||
        y.games - x.games ||
        (x.key < y.key ? -1 : 1),
    );
}

/** What one game did to a player's rating (PX ranked 2): before, after, and the opponent's after. */
export interface RatingMove {
  before: number;
  after: number;
  /** Rounded, as shown: after − before. */
  delta: number;
  games: number;
  them: { name: string; rating: number };
  /** It didn't move: the opponent hadn't played enough different players yet. */
  held?: true;
}

/** How the game with this replay moved `key`'s rating, or null if it didn't count (unsigned, past the pair cap). */
export function ratingMove(
  results: SignedResult[],
  on: string,
  replay: string,
  key: PlayerKey,
  bar: Bar = BAR,
): RatingMove | null {
  let move: RatingMove | null = null;
  fold(results, on, bar, (result, a, b, da, db, heldA, heldB) => {
    if (result.replay !== replay) return;
    const seat = result.players.findIndex((p) => p.key === key);
    if (seat < 0) return;
    const [me, them, mine, held] = seat === 0 ? [a, b, da, heldA] : [b, a, db, heldB];
    const after = Math.round(me.rating);
    const before = Math.round(me.rating - mine);
    move = {
      before,
      after,
      delta: after - before,
      games: me.games,
      them: { name: them.name, rating: Math.round(them.rating) },
      ...(held ? { held: true } : {}),
    };
  });
  return move;
}

/** The ladders with ranked results, most played first. */
export function rankedSystems(results: SignedResult[]): string[] {
  const n = new Map<string, number>();
  for (const r of results) n.set(ladderKey(r.result), (n.get(ladderKey(r.result)) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([s]) => s);
}
