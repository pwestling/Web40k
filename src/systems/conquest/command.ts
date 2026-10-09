import { isAlive } from "../../core/units";
import { secretsWithPrefix } from "../../core/secrets";
import type { GameState, Unit } from "../../core/types";
import type { CodeProcedure, GameView, PureFn } from "../../sdk";

/**
 * The command stack: before the Action phase each player orders one card per
 * regiment, and regiments then activate in that order, the players taking
 * turns. Each card is a secret (core/secrets.ts) keyed `stack:<round>:<n>`:
 * the table holds only commitments, the order stays on its owner's device,
 * and each card is revealed (and checked) when it's drawn. Nobody else, the
 * host and spectators included, can read the order before then.
 */

const pad = (n: number) => String(n).padStart(3, "0");
const stackPrefix = (round: number) => `stack:${pad(round)}:`;
export const cardKey = (round: number, i: number) => `${stackPrefix(round)}${pad(i)}`;

/** On the table, not waiting in reserve. */
const alive = (state: GameState, u: Unit | undefined) => !!u && !u.status?.reserves && isAlive(state, u);

/** One command card: its secret's key, the commitment, and the regiment once revealed. */
export interface Card {
  key: string;
  commitment: string;
  unitId?: string;
}

/** A player's stack this round, top card first, or undefined if they haven't locked one in. */
export function stackOf(state: GameState, player: string): Card[] | undefined {
  const cards = secretsWithPrefix(state, player, stackPrefix(state.turn.round)).map(([key, e]) => ({
    key,
    commitment: e.commitment,
    ...(e.revealed ? { unitId: String(e.revealed.value) } : {}),
  }));
  return cards.length ? cards : undefined;
}

/** Whether a card is still to play: face down, or drawn and its regiment not yet activated. */
const live = (state: GameState, c: Card) =>
  c.unitId === undefined ||
  (alive(state, state.units[c.unitId]) && !state.units[c.unitId]!.status?.activated);

/** The card on top: the first still to play (face down until its owner draws it). */
export function nextCard(state: GameState, stack: Card[] | undefined): Card | undefined {
  return stack?.find((c) => live(state, c));
}

/** Cards a player has left this round. */
export function cardsLeft(state: GameState, stack: Card[] | undefined): number {
  return (stack ?? []).filter((c) => live(state, c)).length;
}

/**
 * Whether this regiment may activate now: it is its owner's top card, drawn
 * (revealed), or the owner set no stack, or the stack has run out (a
 * regiment raised since).
 */
const nextCardFn: PureFn = (view: GameView, unitId: unknown) => {
  const unit = view.state.units[String(unitId)];
  if (!unit) return false;
  const next = nextCard(view.state, stackOf(view.state, unit.owner));
  return !next || next.unitId === unit.id;
};

/** How close an enemy must be for a regiment to count as engaged (the Clash action's reach). */
const ENGAGED_RANGE = 1;

/**
 * Whether the regiment is engaged: an enemy regiment on the table within
 * ENGAGED_RANGE. Engaged regiments take the combat actions (Clash, Inspire,
 * Combat Rally, Combat Reform, Withdraw); the others only when not engaged.
 */
const engagedFn: PureFn = (view: GameView, unitId: unknown) => {
  const unit = view.state.units[String(unitId)];
  if (!alive(view.state, unit)) return false;
  return Object.values(view.state.units).some(
    (u) =>
      u.owner !== unit!.owner &&
      alive(view.state, u) &&
      view.distance(unit!.id, u.id) <= ENGAGED_RANGE + 1e-4,
  );
};

/**
 * Whether a stand is its regiment's command stand, by name: a profile named
 * "... command" or a COMMAND keyword. It is removed last (system.ts casualties).
 */
const commandStandFn: PureFn = (view: GameView, stand: unknown) => {
  const id = (stand as { id?: unknown } | undefined)?.id;
  const model = view.state.models[String(id ?? stand)];
  if (!model) return false;
  const keywords = (stand as { keywords?: string[] } | undefined)?.keywords ?? [];
  return /\bcommand\b/i.test(model.profile?.name ?? "") || keywords.some((k) => /^command$/i.test(k));
};

/**
 * Front-rank stands of a regiment with a clear shot at the target: each
 * stand's own line of sight (a Volley counts only these). At a real table
 * the positions aren't the table's, so every front-rank stand counts.
 */
const clearShotsFn: PureFn = (view: GameView, unitId: unknown, targetId: unknown) => {
  const unit = view.state.units[String(unitId)];
  if (!alive(view.state, unit)) return 0;
  const stands = unit!.modelIds.filter((id) => view.state.models[id] && !view.state.models[id]!.destroyed);
  const files = unit!.formation.kind === "ranked" ? Math.max(1, unit!.formation.files) : stands.length;
  const front = stands.slice(0, files);
  if (view.atTable) return front.length;
  return front.filter((id) => view.visible(id, String(targetId))).length;
};

export const conquestFunctions: Record<string, PureFn> = {
  clearShots: clearShotsFn,
  nextCard: nextCardFn,
  engaged: engagedFn,
  commandStand: commandStandFn,
};

export const conquestProcedures: Record<string, CodeProcedure> = {};
