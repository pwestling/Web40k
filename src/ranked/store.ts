import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { board } from "../opentables/board";
import type { PlayerKey } from "../core/ranked";
import { ladder, type Rating } from "./ratings";
import { checkSigned, type SignedResult } from "./verify";

/**
 * The ranked results this browser has seen and checked (#65), kept on the
 * device so the ladder is there offline and after a reload, and read from the
 * Open tables relays (or the site's board) while anything shows a rating.
 * Results the board has lost are passed back to it.
 */

const KEY = "open-battle:ranked-results";
const KEEP = 5000;
/** Results passed back to a board that lacks them, per page. */
const PASS_BACK = 20;

function loadKept(): Record<string, SignedResult> {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SignedResult[];
    return Object.fromEntries(list.map((r) => [r.result.replay, r]));
  } catch {
    return {};
  }
}

interface ResultsState {
  /** Checked results, by replay hash. Read back from storage unchecked: only this device wrote them. */
  results: Record<string, SignedResult>;
  /** The board has answered at least once. */
  loaded: boolean;
}

const useResults = create<ResultsState>(() => ({ results: loadKept(), loaded: false }));

useResults.subscribe((s, prev) => {
  if (s.results === prev.results) return;
  try {
    const list = Object.values(s.results)
      .sort((a, b) => b.result.at - a.result.at)
      .slice(0, KEEP);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: the ladder rebuilds from the board next time.
  }
});

/** Check results from anywhere and keep the ones that hold. */
async function takeResults(raw: unknown[]): Promise<SignedResult[]> {
  const known = useResults.getState().results;
  const fresh = raw.filter((r) => {
    const replay = (r as { result?: { replay?: unknown } } | null)?.result?.replay;
    return typeof replay === "string" && !known[replay];
  });
  const ok = (await Promise.all(fresh.map((r) => checkSigned(r)))).filter((r): r is SignedResult => !!r);
  if (ok.length)
    useResults.setState((s) => ({
      results: { ...s.results, ...Object.fromEntries(ok.map((r) => [r.result.replay, r])) },
    }));
  return ok;
}

/** A result both players signed: kept here, and passed to the board for everyone else. */
export async function publishResult(r: SignedResult): Promise<boolean> {
  const [ok] = await takeResults([r]);
  if (!ok && !useResults.getState().results[r.result.replay]) return false;
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
            for (const r of Object.values(useResults.getState().results)) {
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

/** One system's ladder, from every result this browser has. */
export function useLadder(system: string): Rating[] {
  const results = useRankedResults();
  return useMemo(() => ladder(Object.values(results), system), [results, system]);
}

/** A player's standing in one system, or null before their first counted game. */
export function useRating(key: PlayerKey | undefined, system: string | undefined): Rating | null {
  const rows = useLadder(system ?? "");
  return (key && rows.find((r) => r.key === key)) || null;
}
