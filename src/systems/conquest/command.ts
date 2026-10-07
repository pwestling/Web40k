import type { GameState, Unit } from "../../core/types";
import type { CodeProcedure, GameView, PureFn } from "../../sdk";

/**
 * The command stack: before the Action phase each player orders one card per
 * regiment, and regiments then activate in that order, the players taking
 * turns. Kept in the module's state as `stack:<player>` (unit ids, top card
 * first). Everyone's state holds both stacks; only the panel keeps the other
 * player's order out of sight, so this is an honour system, like the cards.
 */

export const stackKey = (player: string) => `stack:${player}`;

/** On the table: standing and not waiting in reserve (reinforce.ts). */
const alive = (state: GameState, u: Unit | undefined) =>
  !!u && !u.status?.reserves && u.modelIds.some((id) => state.models[id] && !state.models[id]!.destroyed);

/** A player's stack as set, or undefined if they haven't set one. */
export function stackOf(
  state: GameState,
  own: Record<string, unknown>,
  player: string,
): string[] | undefined {
  const s = own[stackKey(player)];
  return Array.isArray(s)
    ? s.filter((id): id is string => typeof id === "string" && !!state.units[id])
    : undefined;
}

/** The next card in a player's stack: the first regiment still standing that hasn't activated this round. */
export function nextCard(state: GameState, stack: string[] | undefined): Unit | undefined {
  return stack?.map((id) => state.units[id]).find((u) => alive(state, u) && !u!.status?.activated);
}

/** Cards a player has left this round. */
export function cardsLeft(state: GameState, stack: string[] | undefined): number {
  return (stack ?? []).filter((id) => alive(state, state.units[id]) && !state.units[id]!.status?.activated)
    .length;
}

/**
 * Whether this regiment may activate now: it is its owner's next card, or
 * the owner set no stack, or the stack has run out (a regiment raised since).
 */
const nextCardFn: PureFn = (view: GameView, unitId: unknown) => {
  const unit = view.state.units[String(unitId)];
  if (!unit) return false;
  const next = nextCard(view.state, stackOf(view.state, view.own, unit.owner));
  return !next || next.id === unit.id;
};

export const conquestFunctions: Record<string, PureFn> = { nextCard: nextCardFn };

/** Set a player's command stack: `{ player, order }`, top card first. */
const setStack: CodeProcedure = function* (ctx, args) {
  const player = String(args.player ?? "");
  const state = ctx.view.state;
  if (!state.players[player]) throw new Error(`No player "${player}"`);
  const order = (Array.isArray(args.order) ? args.order : []).filter(
    (id): id is string => typeof id === "string" && state.units[id]?.owner === player,
  );
  yield ctx.set(stackKey(player), order);
  yield ctx.note(`${state.players[player]!.name} set their command stack: ${order.length} cards`);
};

export const conquestProcedures: Record<string, CodeProcedure> = { setStack };
