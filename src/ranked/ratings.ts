import type { PlayerKey } from "../core/ranked";
import type { SignedResult } from "./verify";

/**
 * Ratings with no server (#65): every client works the ladder out for itself
 * from the signed results it has seen, in one order (time, then replay hash),
 * so two clients with the same results agree to the point. Plain Elo per
 * game system, from 1500, K 32.
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

export interface Rating {
  key: PlayerKey;
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

/** The results that count for `system`, in counting order: each replay once, the pair cap applied. */
export function counted(results: SignedResult[], system: string): SignedResult[] {
  const seen = new Set<string>();
  const pairs = new Map<string, number[]>();
  const out: SignedResult[] = [];
  for (const r of results.filter((x) => x.result.system === system).sort(order)) {
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

/** The ladder for one game system, best first. */
export function ladder(results: SignedResult[], system: string): Rating[] {
  const by = new Map<PlayerKey, Rating>();
  const get = (key: PlayerKey, name: string) => {
    const r = by.get(key) ?? { key, name, rating: START, games: 0, wins: 0, losses: 0, draws: 0 };
    r.name = name;
    by.set(key, r);
    return r;
  };
  for (const { result } of counted(results, system)) {
    const [a, b] = [
      get(result.players[0].key, result.players[0].name),
      get(result.players[1].key, result.players[1].name),
    ];
    const score = result.winner === null ? 0.5 : result.winner === 0 ? 1 : 0;
    const d = change(a.rating, b.rating, score);
    a.rating += d;
    b.rating -= d;
    for (const [p, s] of [
      [a, score],
      [b, 1 - score],
    ] as const) {
      p.games++;
      if (s === 1) p.wins++;
      else if (s === 0) p.losses++;
      else p.draws++;
    }
  }
  return [...by.values()]
    .map((r) => ({ ...r, rating: Math.round(r.rating) }))
    .sort((x, y) => y.rating - x.rating || y.games - x.games || (x.key < y.key ? -1 : 1));
}

/** The game systems with ranked results, most played first. */
export function rankedSystems(results: SignedResult[]): string[] {
  const n = new Map<string, number>();
  for (const r of results) n.set(r.result.system, (n.get(r.result.system) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([s]) => s);
}
