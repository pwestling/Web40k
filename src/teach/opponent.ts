import { sidePlayers, type GameRecord, type GameState } from "../core";
import { currentSlot } from "../core/content/turn";
import { freeMoves, legal, waitingOn, type BotContext, type BotMove } from "../soak/bot";

/**
 * The learner's opponent in a lesson: the soak bot (soak/bot.ts) in its tidy
 * mode, playing one seat. It answers whatever the game waits on from its
 * side and plays its own turns; anything owed by the learner it leaves to
 * them. Every move is checked with the host's resolver first.
 */
export function opponentMove(
  record: GameRecord,
  state: GameState,
  ctx: BotContext,
  seat: number,
): BotMove | null {
  if (state.turn.round === 0) return null;
  const mine = new Set(sidePlayers(state, seat).map((p) => p.id));
  const waiting = waitingOn(record, state, ctx);
  if (waiting) {
    // The likeliest answer first: if that's the learner's to give, it's theirs.
    const first = waiting.moves.find((m) => legal(record, state, m));
    return first && mine.has(first.as) ? first : null;
  }
  if (state.turn.activeSeat !== seat) return null;
  for (const m of freeMoves(state, ctx)) if (mine.has(m.as) && legal(record, state, m)) return m;
  return null;
}

/** After a move: how long the game has sat in one phase or activation, so the bot moves it on in time. */
export function noteProgress(ctx: BotContext & { mark?: string }, state: GameState): void {
  const m = `${state.turn.round}:${state.turn.activeSeat}:${currentSlot(state)?.id}:${state.turn.phase}:${Object.values(
    state.units,
  )
    .filter((u) => u.status?.acting)
    .map((u) => u.id)
    .join()}`;
  ctx.idle = m === ctx.mark ? ctx.idle + 1 : 0;
  ctx.mark = m;
}
