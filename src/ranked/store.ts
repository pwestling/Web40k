import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { board } from "../opentables/board";
import type { PlayerKey } from "../core/ranked";
import { ladder, ladderAbout, plainLadder, ratingMove, type Rating, type RatingMove } from "./ratings";
import { systemTitle } from "../ui/systemLabels";
import { t, tn } from "../i18n";
import { APP_BUILD } from "../version";
import { checkDeclined, checkSigned, type DeclinedResult, type SignedResult } from "./verify";

/**
 * The ranked results this browser has seen and checked (#65), kept on the
 * device so the ladder is there offline and after a reload, and read from the
 * Open tables relays (or the site's board) while anything shows a rating.
 * Results the board has lost are passed back to it.
 */

const KEY = "open-battle:ranked-results";
const DECLINED_KEY = "open-battle:ranked-declined";
const KEEP = 5000;
/** Results passed back to a board that lacks them, per page. */
const PASS_BACK = 20;

function loadKept<T extends { result: { replay: string } }>(key: string): Record<string, T> {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
    return Object.fromEntries(list.map((r) => [r.result.replay, r]));
  } catch {
    return {};
  }
}

function keep(key: string, all: Record<string, { result: { at: number } }>): void {
  try {
    const list = Object.values(all)
      .sort((a, b) => b.result.at - a.result.at)
      .slice(0, KEEP);
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the ladder rebuilds from the board next time.
  }
}

interface ResultsState {
  /** Checked results, by replay hash. Read back from storage unchecked: only this device wrote them. */
  results: Record<string, SignedResult>;
  /** Results one player declined (PX ranked 1): never on the ladder, only in the sign rate. */
  declined: Record<string, DeclinedResult>;
  /** The board has answered at least once. */
  loaded: boolean;
}

const useResults = create<ResultsState>(() => ({
  results: loadKept<SignedResult>(KEY),
  declined: loadKept<DeclinedResult>(DECLINED_KEY),
  loaded: false,
}));

useResults.subscribe((s, prev) => {
  if (s.results !== prev.results) keep(KEY, s.results);
  if (s.declined !== prev.declined) keep(DECLINED_KEY, s.declined);
});

/** Check results from anywhere (signed or declined) and keep the ones that hold. */
async function takeResults(raw: unknown[]): Promise<(SignedResult | DeclinedResult)[]> {
  const { results: known, declined } = useResults.getState();
  const fresh = raw.filter((r) => {
    const replay = (r as { result?: { replay?: unknown } } | null)?.result?.replay;
    return typeof replay === "string" && !known[replay] && !declined[replay];
  });
  const checked = await Promise.all(
    fresh.map((r) => ((r as { declined?: unknown }).declined ? checkDeclined(r) : checkSigned(r))),
  );
  const ok = checked.filter((r): r is SignedResult | DeclinedResult => !!r);
  const by = <T extends SignedResult | DeclinedResult>(list: T[]): Record<string, T> =>
    Object.fromEntries(list.map((r) => [r.result.replay, r]));
  const signed = ok.filter((r) => !("declined" in r)) as SignedResult[];
  const refused = ok.filter((r) => "declined" in r) as DeclinedResult[];
  if (ok.length)
    useResults.setState((s) => ({
      ...(signed.length ? { results: { ...s.results, ...by(signed) } } : {}),
      ...(refused.length ? { declined: { ...s.declined, ...by(refused) } } : {}),
    }));
  return ok;
}

/** A result both players signed: kept here, and passed to the board for everyone else. */
export async function publishResult(r: SignedResult | DeclinedResult): Promise<boolean> {
  const [ok] = await takeResults([r]);
  const { results, declined } = useResults.getState();
  if (!ok && !results[r.result.replay] && !declined[r.result.replay]) return false;
  await (await board())?.publishResult(r).catch(() => {});
  return true;
}

let watchers = 0;
let stop: (() => void) | null = null;
let passedBack = 0;

/** Read the board's results while mounted (shared by every rating on screen). */
export function useRankedResults(): Record<string, SignedResult> {
  useEffect(() => {
    if (watchers++ === 0)
      void board().then((b) => {
        if (!b || watchers === 0 || stop) return;
        const there = new Set<string>();
        let passBack: ReturnType<typeof setTimeout> | null = null;
        stop = b.watchResults((raw) => {
          for (const r of raw) {
            const replay = (r as { result?: { replay?: unknown } } | null)?.result?.replay;
            if (typeof replay === "string") there.add(replay);
          }
          void takeResults(raw).then(() => useResults.setState({ loaded: true }));
          // The board forgets (a restart, a relay's pruning): once it has had its say, what this browser kept goes back.
          passBack ??= setTimeout(() => {
            if (!stop) return;
            const { results, declined } = useResults.getState();
            for (const r of [...Object.values(results), ...Object.values(declined)]) {
              if (there.has(r.result.replay) || passedBack >= PASS_BACK) continue;
              passedBack++;
              void b.publishResult(r).catch(() => {});
            }
          }, 10_000);
        });
      });
    return () => {
      if (--watchers === 0) {
        stop?.();
        stop = null;
      }
    };
  }, []);
  return useResults((s) => s.results);
}

/** A ladder's name: its game, and the house rules it plays with if any ("Rift Lanterns with Battle Scars 1.0.0"). */
export function ladderTitle(results: SignedResult[], key: string): string {
  const about = ladderAbout(results, key);
  if (about.name) return about.name;
  const game = systemTitle(about.system);
  // The game's own package is the game; anything else is house rules.
  const rules = about.packages.filter((p) => !p.game);
  const own = about.packages.find((p) => p.game);
  const named = own ? `${game} ${own.version}` : about.version ? `${game} (${about.version})` : game;
  return rules.length
    ? t("{game} with {rules}", { game: named, rules: rules.map((p) => `${p.name} ${p.version}`).join(", ") })
    : named;
}

/** One ladder's ratings (ratings.ts ladderKey), from every result this browser has. */
export function useLadder(system: string): Rating[] {
  const results = useRankedResults();
  return useMemo(() => ladder(Object.values(results), system), [results, system]);
}

/** A player's standing on the plain ladder of a system played on this build, or null before their first counted game. */
export function useRating(key: PlayerKey | undefined, system: string | undefined): Rating | null {
  const rows = useLadder(system ? plainLadder(system, APP_BUILD) : "");
  return (key && rows.find((r) => r.key === key)) || null;
}

/** How one game moved a player's rating, once its signed result is here. */
export function useRatingMove(
  key: PlayerKey | undefined,
  system: string | undefined,
  replay: string | undefined,
): RatingMove | null {
  const results = useRankedResults();
  return useMemo(
    () => (key && system && replay ? ratingMove(Object.values(results), system, replay, key) : null),
    [results, key, system, replay],
  );
}

/** How often a player signs (PX ranked 1): results they signed, of every result put to them that went out. */
export function signRate(
  key: PlayerKey,
  results: Record<string, SignedResult>,
  declined: Record<string, DeclinedResult>,
): { signed: number; of: number } {
  const has = (r: { result: { players: { key: string }[] } }) => r.result.players.some((p) => p.key === key);
  const signed = Object.values(results).filter(has).length;
  const refusals = Object.values(declined).filter(has);
  const refused = refusals.filter((r) => r.result.players[r.declined.seat]!.key === key).length;
  return { signed: signed + refusals.length - refused, of: signed + refusals.length };
}

export function useSignRate(key: PlayerKey | null | undefined): { signed: number; of: number } | null {
  useRankedResults();
  const results = useResults((s) => s.results);
  const declined = useResults((s) => s.declined);
  return useMemo(() => (key ? signRate(key, results, declined) : null), [key, results, declined]);
}

/** "signs 9 of 10 results" (PX ranked 1): how often a player signs the results put to them. */
export function signsLine(rate: { signed: number; of: number } | null): string | null {
  return rate && rate.of > 0
    ? tn(rate.of, "signs {signed} of {n} result", "signs {signed} of {n} results", { signed: rate.signed })
    : null;
}

/**
 * Read the board's results often while something needs them soon (an event's
 * round under way, #67): the usual watch looks once a minute.
 */
export function useResultsOften(on: boolean): void {
  useRankedResults();
  useEffect(() => {
    if (!on) return;
    let stop: (() => void) | null = null;
    let live = true;
    void board().then((b) => {
      if (!b || !live) return;
      stop = b.watchResults((raw) => void takeResults(raw), 10_000);
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [on]);
}
