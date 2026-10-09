import { analyst } from "../../bot/player";
import type { BotMove } from "../../soak/bot";
import { legal } from "../../soak/bot";
import { actionTargets } from "../../core/content/play";
import { decisionKind, TRUSTED, type DecisionKind } from "../trust";
import { lookAt } from "../analyse";
import type { Position } from "./build";

/**
 * The review benchmark (#63): positions with a play any player would agree
 * is better than another, judged as the review judges a decision. An item
 * passes when the review rates the better play above the worse one.
 */
export interface BenchItem {
  id: string;
  /** Why the better play is better, in a line. */
  why: string;
  build(): Promise<{ p: Position; better: BotMove; worse: BotMove }>;
}

export interface BenchSet {
  system: string;
  items: BenchItem[];
}

interface ItemResult {
  id: string;
  kind: DecisionKind;
  better: number | null;
  worse: number | null;
  /** What the review would say each gave up against the best it found. */
  lossBetter: number;
  lossWorse: number;
  pass: boolean;
  /** The best play the review found, looking at the worse one. */
  best?: string;
  error?: string;
}

interface JudgeOptions {
  seed?: number;
  tries?: number;
  passes?: number;
}

async function judgeItem(item: BenchItem, opts: JudgeOptions = {}): Promise<ItemResult> {
  const { p, better, worse } = await item.build();
  const kind = decisionKind(better);
  for (const [name, m] of [
    ["better", better],
    ["worse", worse],
  ] as const) {
    const i = m.intent;
    // The rules are advisory: a target the rules don't allow is taken, but it isn't a fair choice.
    const unfair =
      i.type === "action/take" &&
      i.targetId &&
      !actionTargets(p.state, i.unitId, i.action, i.weapon).some((t) => t.unitId === i.targetId && t.ok);
    if (unfair || !legal(p.record, p.state, m))
      return {
        id: item.id,
        kind,
        better: null,
        worse: null,
        lossBetter: 0,
        lossWorse: 0,
        pass: false,
        error: `${name} play ${unfair ? "not allowed by the rules" : "refused"}`,
      };
  }
  // A fresh eye for each, on the same seed: both meet the same dice, and are judged as the review
  // judges a decision (a closer look where it could make a mark).
  const eye = (seat: number) =>
    analyst(p.state, seat, {
      ...(opts.seed ? { seed: opts.seed } : {}),
      ...(opts.tries ? { tries: opts.tries } : {}),
      ...(opts.passes ? { planPasses: opts.passes } : {}),
    });
  const scale = Math.max(1, eye(0).armyVp, eye(1).armyVp);
  const look = (m: BotMove) => lookAt(eye(p.seat), p.record, p.state, m, new Set(), scale);
  const a = look(better);
  const b = look(worse);
  const loss = (x: ReturnType<typeof look>) => Math.max(0, (x.best?.score ?? x.base) - (x.played ?? x.base));
  const pass = a.played !== null && b.played !== null && a.played > b.played;
  return {
    id: item.id,
    kind,
    better: a.played,
    worse: b.played,
    lossBetter: loss(a),
    lossWorse: loss(b),
    pass,
    ...(b.best ? { best: brief(b.best.move) } : {}),
  };
}

function brief(m: BotMove): string {
  const i = m.intent as {
    type: string;
    unitId?: string;
    action?: string;
    targetId?: string;
    procedure?: string;
  };
  const what =
    i.type === "action/take"
      ? `${i.unitId}:${i.action}${i.targetId ? `>${i.targetId}` : ""}`
      : i.type === "script/start"
        ? `code:${i.procedure}`
        : i.type;
  return m.then ? `${what}+${m.then.intent.type}` : what;
}

/** One line per item, and the pass rate per kind. */
function report(system: string, results: ItemResult[]): string {
  const lines = results.map(
    (r) =>
      `${r.pass ? "PASS" : "FAIL"} ${system} ${r.kind.padEnd(6)} ${r.id.padEnd(28)} better ${r.better?.toFixed(2) ?? "-"} worse ${r.worse?.toFixed(2) ?? "-"} loss ${r.lossBetter.toFixed(2)}/${r.lossWorse.toFixed(2)} best ${r.best ?? "-"}${r.error ? ` (${r.error})` : ""}`,
  );
  const kinds = [...new Set(results.map((r) => r.kind))];
  for (const k of kinds) {
    const of = results.filter((r) => r.kind === k);
    lines.push(`${system} ${k}: ${of.filter((r) => r.pass).length}/${of.length}`);
  }
  lines.push(`${system} all: ${results.filter((r) => r.pass).length}/${results.length}`);
  return lines.join("\n");
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** How long a calibration test may take: the heavy run (REVIEW_BENCH=1) far longer. */
export const benchTimeout = env.REVIEW_BENCH ? 3_600_000 : 120_000;

/**
 * The calibration check (one test file per game): every item of a kind the
 * review trusts in this game (trust.ts) is ranked right on the review's own
 * dice; with REVIEW_BENCH=1, over six seeds, each trusted kind at 90% or more,
 * and the pass rates per kind printed for every kind.
 */
export async function calibrate(
  set: BenchSet,
): Promise<{ failed: string[]; rates: Record<string, number>; items: Record<string, number> }> {
  const heavy = !!env.REVIEW_BENCH;
  const seeds = heavy ? [1, 2, 3, 4, 5, 6] : [1];
  const results: ItemResult[] = [];
  for (const item of set.items) for (const seed of seeds) results.push(await judgeItem(item, { seed }));
  const rates: Record<string, number> = {};
  for (const r of results) rates[r.kind] = (rates[r.kind] ?? 0) + (r.pass ? 1 : 0);
  for (const k of Object.keys(rates)) rates[k] = rates[k]! / results.filter((r) => r.kind === k).length;
  const ok = new Set(TRUSTED[set.system] ?? []);
  const failed = heavy
    ? Object.entries(rates)
        .filter(([k, rate]) => ok.has(k as DecisionKind) && rate < 0.9)
        .map(([k, rate]) => `${k}: ${Math.round(rate * 100)}%`)
    : results.filter((r) => ok.has(r.kind) && !r.pass).map((r) => `${r.id}${r.error ? ` (${r.error})` : ""}`);
  if (heavy) console.log(report(set.system, results));
  const items: Record<string, number> = {};
  for (const r of results) items[r.kind] = (items[r.kind] ?? 0) + 1 / seeds.length;
  return { failed, rates, items };
}
