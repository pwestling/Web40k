import { undoneSeqs, type GameRecord } from "./log";
import { applyEvent } from "./reducer";
import { rollsIn, type TrayRoll } from "./rolls";
import type { GameState, PlayerId } from "./types";

/**
 * "Against all odds" (PX-2): a roll step whose result had at most a 1 in
 * 1,000 chance of coming out at least this far in its direction. The one
 * piece of odds anyone sees during a game. Pure, so every peer, the replay
 * and the after-game moments agree.
 */
export const RARE_P = 0.001;

export interface RareOutcome {
  seq: number;
  round: number;
  /** The roll it was, so the tray can stage it. */
  rollId: string;
  chain?: string;
  /** The tail probability. */
  p: number;
  /** Went the roller's way. */
  lucky: boolean;
  /** Who it favours: the roller when lucky, else the other side (unknown in a one-player test). */
  favours?: PlayerId;
  roller?: PlayerId;
  step?: string;
  /** The unit whose dice did it: the roller's. */
  unitId?: string;
  unitName?: string;
  title: string;
  /** "10 of 10 saves · 1 in 1,024": the only number shown. */
  line: string;
}

/** The rarest qualifying roll among these (at least 3 dice, judged die by die). */
export function rareOf(rolls: TrayRoll[], state: GameState, seq: number): RareOutcome | null {
  let best: RareOutcome | null = null;
  for (const roll of rolls) {
    const p = roll.p;
    const n = roll.dice.length;
    if (p === undefined || roll.sum || n < 3 || p <= 0 || p >= 1) continue;
    const k = roll.dice.filter((d) => d.ok).length;
    const high = tailAtLeast(n, k, p);
    const low = tailAtMost(n, k, p);
    const lucky = high <= low;
    const tail = Math.min(high, low);
    if (tail > RARE_P || (best && best.p <= tail)) continue;
    const roller = roll.by;
    const other = roller
      ? Object.values(state.players).find((pl) => pl.id !== roller && pl.seat !== undefined)
      : undefined;
    best = {
      seq,
      round: state.turn.round,
      rollId: roll.id,
      chain: roll.chain,
      p: tail,
      lucky,
      favours: lucky ? roller : other?.id,
      roller,
      step: roll.step,
      unitId: roll.defender ? roll.targetId : roll.unitId,
      unitName: state.units[(roll.defender ? roll.targetId : roll.unitId) ?? ""]?.name,
      title: titleOf(roll, lucky, k, n),
      line: `${k} of ${n} ${noun(roll)} · 1 in ${oneIn(tail)}`,
    };
  }
  return best;
}

/** Every rare moment in a game, at most one per action (the rarest), skipping undone events. */
export function rareMoments(record: GameRecord): RareOutcome[] {
  const cached = memo.get(record);
  if (cached) return cached;
  const undone = undoneSeqs(record);
  const out: RareOutcome[] = [];
  let state = record.initial;
  for (const { seq, event } of record.events) {
    if (undone.has(seq)) continue;
    const next = applyEvent(state, event);
    const rare = rareOf(rollsIn(state, next, [event], seq), next, seq);
    if (rare) {
      const same = out.findIndex((o) => o.chain && o.chain === rare.chain && o.round === rare.round);
      if (same < 0) out.push(rare);
      else if (rare.p < out[same]!.p) out[same] = rare;
    }
    state = next;
  }
  memo.set(record, out);
  return out;
}
const memo = new WeakMap<GameRecord, RareOutcome[]>();

function titleOf(roll: TrayRoll, lucky: boolean, k: number, n: number): string {
  if (!lucky) return /hit/i.test(roll.step ?? "") && k === 0 ? "Not a single hit" : "Cursed dice";
  if (roll.defender) return k === n ? "They will not fall" : "Against all odds";
  return k === n ? "Every shot told" : "Unstoppable volley";
}

function noun(roll: TrayRoll): string {
  const step = (roll.step ?? "").toLowerCase();
  if (/save/.test(step)) return "saves";
  if (/hit/.test(step)) return "hits";
  if (/wound/.test(step)) return "wounds";
  return "passed";
}

/** "1,024" below ten thousand, then two significant figures ("37,000"). */
export function oneIn(p: number): string {
  const n = 1 / p;
  const v = n < 10_000 ? Math.round(n) : Number(n.toPrecision(2));
  return v.toLocaleString("en-US");
}

/** P(X >= k) for X ~ Binomial(n, p). */
export function tailAtLeast(n: number, k: number, p: number): number {
  let sum = 0;
  for (let i = k; i <= n; i++) sum += binom(n, i) * p ** i * (1 - p) ** (n - i);
  return Math.min(1, sum);
}

/** P(X <= k) for X ~ Binomial(n, p). */
export function tailAtMost(n: number, k: number, p: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += binom(n, i) * p ** i * (1 - p) ** (n - i);
  return Math.min(1, sum);
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
