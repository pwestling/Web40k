import { stateAt, systemOf, type GameRecord } from "../core";
import { buildLog } from "../ui/gameLog";
import { readGame, type RoundSummary } from "../ui/highlights";
import { t } from "../i18n";

/**
 * A replay's chapters: deployment, then each side's turn in each round, read
 * from the log's turn headers (their round, and "Round 2 · Ana"). Each says how
 * much happened in it, what stood out, and, for the turn that ends a round,
 * that round's card (VP and losses).
 */
export interface Chapter {
  seq: number;
  /** "Deployment", "Round 2 · Ana" */
  title: string;
  round: number;
  /** Logged actions in the chapter. */
  actions: number;
  /** The highlights in it, in a few words each. */
  highlights: string[];
  /** The end-of-round card, on the chapter that ends the round. */
  roundCard?: RoundSummary;
  /** The seq it ends at (the next chapter's start, or the end of the log). */
  end: number;
}

export function chapters(record: GameRecord): Chapter[] {
  const log = buildLog(record);
  const { highlights, rounds } = readGame(record);
  const last = record.events.at(-1)?.seq ?? record.initial.seq;
  let limit = Infinity;
  try {
    const rounds = systemOf(stateAt(record)).turn.rounds;
    if (typeof rounds === "number") limit = rounds;
  } catch {
    // A system this device doesn't have: every round is a round.
  }
  const out: Chapter[] = [];
  let current: Chapter | null = null;
  const open = (seq: number, title: string, round: number) => {
    if (current) current.end = seq;
    current = { seq, title, round, actions: 0, highlights: [], end: last };
    out.push(current);
  };
  if (record.initial.turn.round === 0) open(record.initial.seq, t("Deployment"), 0);
  for (const item of log) {
    if (item.kind === "header") {
      if (item.rules) continue;
      const round = item.round ?? 0;
      const title = round && item.turn ? (round > limit ? t("After the battle") : item.turn) : item.text;
      if (title !== (current as Chapter | null)?.title) open(Number(item.key), title, round);
    } else if (item.kind === "line" && !item.undone && item.text) {
      if (!current) open(record.initial.seq, t("Setup"), 0);
      current!.actions++;
    }
  }
  for (const c of out) {
    c.highlights = highlights.filter((h) => h.seq > c.seq && h.seq <= c.end).map((h) => h.text);
    c.roundCard = rounds.find((r) => r.seq > c.seq && r.seq <= c.end);
  }
  return out;
}
