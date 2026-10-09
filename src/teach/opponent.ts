import { sidePlayers, type GameRecord, type GameState } from "../core";
import { currentSlot } from "../core/content/turn";
import { fightPick } from "../bot/fightPick";
import {
  freeMoves,
  legal,
  noteTaken,
  offTurnMoves,
  unitMoves,
  waitingOn,
  type BotContext,
  type BotMove,
} from "../soak/bot";

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
  /** Play on, but don't move the game on to the next phase or activation (a step where the learner acts too). */
  hold = false,
  /** The lesson's preferred answers to questions (Lesson.answers). */
  answers: string[] = [],
): BotMove | null {
  if (state.turn.round === 0) return null;
  const mine = new Set(sidePlayers(state, seat).map((p) => p.id));
  const waiting = waitingOn(record, state, ctx);
  const asked = state.script?.waiting;
  if (asked && mine.has(asked.player) && !asked.secret && asked.reveal === undefined) {
    const id = answers.find((x) => asked.options.some((o) => o.id === x));
    const move: BotMove = {
      intent: { type: "script/answer", answer: id ?? "" },
      as: asked.player,
      kind: "answer",
    };
    if (id && legal(record, state, move)) return move;
  }
  if (waiting) {
    // The likeliest answer first: if that's the learner's to give, it's theirs.
    const first = waiting.moves.find((m) => legal(record, state, m));
    return first && mine.has(first.as) ? first : null;
  }
  // Secret orders (Conquest's command stack) are locked in whoever's turn it is.
  for (const m of offTurnMoves(state, ctx, [...mine])) if (legal(record, state, m)) return m;
  // The Fight phase goes by the fight order: it takes its pick, even in the learner's turn (PX #57). It
  // doesn't wait on the learner's pick in its own turn, though: a newcomer may not know it's theirs.
  const pick = fightPick(state, mine);
  if (pick?.ours)
    for (const id of pick.units)
      for (const m of unitMoves(state, state.units[id]!, ctx))
        if (m.intent.type === "action/take" && m.intent.action === "fight" && legal(record, state, m))
          return m;
  if (state.turn.activeSeat !== seat) return null;
  for (const m of freeMoves(state, ctx))
    if (mine.has(m.as) && !(hold && moveOn(m)) && legal(record, state, m)) return m;
  return null;
}

function moveOn(m: BotMove): boolean {
  return m.intent.type === "turn/next" || m.intent.type === "turn/endActivation";
}

/** After a move: how long the game has sat in one phase or activation, so the bot moves it on in time. */
export function noteProgress(ctx: BotContext & { mark?: string }, state: GameState, move?: BotMove): void {
  if (move) noteTaken(ctx, state, move);
  const m = `${state.turn.round}:${state.turn.activeSeat}:${currentSlot(state)?.id}:${state.turn.phase}:${Object.values(
    state.units,
  )
    .filter((u) => u.status?.acting)
    .map((u) => u.id)
    .join()}`;
  ctx.idle = m === ctx.mark ? ctx.idle + 1 : 0;
  ctx.mark = m;
}
