import type { BotMove } from "../soak/bot";

/**
 * What the review's judgement can be trusted with (#63). Each decision is
 * sorted into a kind; a kind is trusted in a game when the review benchmark
 * (src/review/bench) rates the better play above the worse one in nearly
 * every item of that kind. A decision of a kind that isn't trusted still
 * counts in a side's totals and the expected-result line, but the review
 * shows no costly or strong mark on it and no tip from it: a review that
 * calls a good move costly loses a player's trust.
 */

export type DecisionKind = "attack" | "charge" | "move" | "other";

const MOVING = /move|advance|fall.?back|stationary|march|reform|withdraw|pile|consolidat/i;

/** The kind of a decision, from the move played. */
export function decisionKind(m: BotMove | null): DecisionKind {
  if (!m) return "other";
  const i = m.intent;
  const charge =
    (i.type === "action/take" && /charge/i.test(i.action)) ||
    (i.type === "script/start" && /charge/i.test(i.procedure));
  if (charge) return "charge";
  if (i.type === "models/move" || i.type === "unit/move") return "move";
  if (m.then?.intent.type === "models/move" || m.then?.intent.type === "unit/move") return "move";
  if (i.type === "action/take") {
    if (i.targetId) return "attack";
    // Staying put, marching, reforming: choices about where the unit stands.
    return MOVING.test(i.action) ? "move" : "other";
  }
  if (i.type === "script/start" && i.args?.target) return "attack";
  return "other";
}

/**
 * The kinds the benchmark backs, per game: at least two items of the kind, and
 * 90% or more of them ranked right over six seeds of the review's dice (the
 * bench/*.bench.test.ts files check it; REVIEW_BENCH=1 for all six seeds).
 * Games and kinds not listed show no costly or strong marks.
 */
export const TRUSTED: Readonly<Record<string, readonly DecisionKind[]>> = {
  "forty-k-11": ["attack", "move", "charge"],
  "tow-hand": ["attack", "move", "charge"],
  "fsd-1.7": ["attack"],
  "conquest-hand": ["attack"],
};

/** Whether the review may call a decision of this kind costly or strong in this game. */
export function trusted(system: string | undefined, kind: DecisionKind): boolean {
  return !!system && (TRUSTED[system] ?? []).includes(kind);
}
