import { t } from "../i18n";
import { applyEvent, sides, undoneSeqs, type GameRecord, type GameState } from "../core";
import { currentSlot, systemOf } from "../core/content/turn";
import type { Mission, ScoreQuestion, ScoringMoment } from "../sdk";

/**
 * Scoring moments and the scores waiting on a player. The app works out each
 * suggestion from the table as it stood at the moment (the end of a phase, of
 * a round, of the battle); a player of that side confirms it with
 * `score/confirm`, which logs it once under its key.
 */

export interface Moment {
  kind: "phaseEnd" | "roundEnd" | "gameEnd";
  /** The phase that ended (phaseEnd). */
  phase?: string;
  /** The side whose turn it was (phaseEnd). */
  seat?: number;
  round: number;
  /** The table as it stood. */
  state: GameState;
  /** The event that ended it. */
  seq: number;
}

export interface Pending {
  key: string;
  seat: number;
  round: number;
  rule: string;
  vp: number;
  why: string;
  /** At a real table: the question to ask instead of a number (UX 278). */
  ask?: ScoreQuestion;
  /** Whether `vp` is a real suggestion; at a real table the app has none to make. */
  guessed: boolean;
}

/** Every scoring moment so far: each move to the next phase ends one, and maybe a round or the battle. */
export function moments(record: GameRecord): Moment[] {
  const undone = undoneSeqs(record);
  const out: Moment[] = [];
  let state = record.initial;
  for (const logged of record.events) {
    if (undone.has(logged.seq)) continue;
    const before = state;
    state = { ...applyEvent(state, logged.event), seq: logged.seq };
    // The turn moves on with ▶, and also when both sides pass or the last activation ends (UX 324-325).
    if (logged.event.type === "turn/prev" || before.turn.round === 0) continue;
    if (state.turn.round <= before.turn.round && state.turn.phase === before.turn.phase) continue;
    const slot = currentSlot(before);
    if (slot?.id)
      out.push({
        kind: "phaseEnd",
        phase: slot.id,
        seat: before.turn.activeSeat,
        round: before.turn.round,
        state: before,
        seq: logged.seq,
      });
    if (state.turn.round > before.turn.round) {
      out.push({ kind: "roundEnd", round: before.turn.round, state: before, seq: logged.seq });
      const rounds = systemOf(state).turn.rounds;
      if (typeof rounds === "number" && state.turn.round > rounds)
        out.push({ kind: "gameEnd", round: before.turn.round, state: before, seq: logged.seq });
    }
  }
  return out;
}

/** Whether a scoring rule's moment is this one. */
export const momentMatches = (at: ScoringMoment, m: Moment) =>
  "phaseEnd" in at
    ? m.kind === "phaseEnd" && m.phase === at.phaseEnd && m.round >= (at.fromRound ?? 1)
    : "roundEnd" in at
      ? m.kind === "roundEnd"
      : m.kind === "gameEnd";

/** Scores the mission suggests that nobody has confirmed or passed on yet, oldest first. */
export function pendingScores(record: GameRecord, game: GameState, mission: Mission | undefined): Pending[] {
  if (!mission) return [];
  const done = new Set((game.scores ?? []).map((s) => s.key));
  const out: Pending[] = [];
  const all = moments(record);
  // Cards turned up after the battle ended weren't played: they score nothing.
  const end = all.find((m) => m.kind === "gameEnd")?.seq ?? Infinity;
  const late = new Set(
    record.events.flatMap(({ seq, event }) =>
      seq > end && event.type === "secret/reveal" && event.key.startsWith("mission:")
        ? [`${event.key}:${String(event.value)}`]
        : [],
    ),
  );
  for (const m of all)
    for (const rule of mission.scoring) {
      if (!momentMatches(rule.at, m)) continue;
      for (const seat of m.kind === "phaseEnd" ? [m.seat!] : sides(m.state)) {
        const key = `${rule.id}:${m.round}:${seat}`;
        if (done.has(key)) continue;
        // At a real table (#37) the positions here mean nothing: each moment is the players' to count.
        // A rule that measures nothing (it counts what was wiped out) is worked out there too.
        const companion = !!game.settings.companion && rule.measures !== false;
        const s = companion
          ? { vp: 0, why: rule.ask?.question ?? t("count it on your table") }
          : rule.suggest(m.state, seat);
        if (!s) continue;
        out.push({
          key,
          seat,
          round: m.round,
          rule: rule.name,
          ...s,
          guessed: !companion,
          ...(companion && rule.ask ? { ask: rule.ask } : {}),
        });
      }
    }
  // Secret mission cards revealed and not yet scored: scored as the table stands now.
  for (const [player, mine] of Object.entries(game.secrets ?? {})) {
    const seat = game.players[player]?.seat;
    if (seat === undefined) continue;
    for (const [secretKey, e] of Object.entries(mine)) {
      if (!secretKey.startsWith("mission:") || !e.revealed) continue;
      const key = `card:${player}:${secretKey}`;
      if (done.has(key)) continue;
      const card = mission.deck?.find((c) => c.id === e.revealed!.value);
      if (!card || late.has(`${secretKey}:${card.id}`)) continue;
      const companion = !!game.settings.companion;
      const s = companion ? { vp: 0, why: card.ask?.question ?? card.text } : card.suggest(game, seat);
      out.push({
        key,
        seat,
        round: game.turn.round,
        rule: card.name,
        ...s,
        guessed: !companion,
        ...(companion && card.ask ? { ask: card.ask } : {}),
      });
    }
  }
  return out;
}

/** VP by round and side from the confirmed scores, for the result screen. */
export function vpByRound(game: GameState): {
  rounds: number[];
  bySeat: Record<number, Record<number, number>>;
} {
  const bySeat: Record<number, Record<number, number>> = {};
  const rounds = new Set<number>();
  for (const s of game.scores ?? []) {
    if (!s.vp) continue;
    rounds.add(s.round);
    bySeat[s.seat] ??= {};
    bySeat[s.seat]![s.round] = (bySeat[s.seat]![s.round] ?? 0) + s.vp;
  }
  return { rounds: [...rounds].sort((a, b) => a - b), bySeat };
}
