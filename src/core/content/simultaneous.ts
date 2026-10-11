import type { GameState, PlayerId } from "../types";
import { advanceTurn, currentSlot } from "./turn";

/**
 * Simultaneous phases (#81, docs/simultaneous.md): a phase a system marks
 * `simultaneous` (40k's Command phase) where every seated player does their
 * own part at once, and which moves on when each of them has said they are
 * done (`turn/ready`). Who is ready lives in `state.turn.ready`, so it is in
 * the log like everything else: undo, replays and late joiners see the same.
 * ▶ (`turn/next`) still moves the phase on at once: rules are advisory.
 */

export interface SimultaneousPhase {
  /** The phase's id and name. */
  phase: string;
  name: string;
  /** Players who said they are done, in the order they did. */
  ready: PlayerId[];
  /** Seated players the phase still waits for. */
  waiting: PlayerId[];
  /** True outside player turns: nobody's turn, so every player counts as the active one. */
  shared: boolean;
}

/** Whether the game is in a simultaneous phase now. */
export function simultaneousNow(state: GameState): boolean {
  return !!currentSlot(state)?.simultaneous;
}

/** The simultaneous phase on now, with who is ready and who it waits for, or null. */
export function simultaneousPhase(state: GameState): SimultaneousPhase | null {
  const slot = currentSlot(state);
  if (!slot?.simultaneous) return null;
  const ready = state.turn.ready ?? [];
  return {
    phase: slot.id,
    name: slot.name,
    ready: [...ready],
    waiting: waitingFor(state),
    shared: !slot.playerTurn,
  };
}

/** Whether this player has said they are done with the simultaneous phase. */
export function isReady(state: GameState, player: PlayerId): boolean {
  return !!state.turn.ready?.includes(player);
}

/** Seated players who haven't said they are done yet (every seated player when no phase is simultaneous). */
export function waitingFor(state: GameState): PlayerId[] {
  const ready = state.turn.ready ?? [];
  return Object.values(state.players)
    .filter((p) => p.seat !== undefined && !ready.includes(p.id))
    .map((p) => p.id);
}

/**
 * Whether every player counts as the active one now: a simultaneous phase
 * outside player turns, which is nobody's turn. Inside player turns the
 * active side stays the active side, acting alongside the other.
 */
export function sharedPhase(state: GameState): boolean {
  const slot = currentSlot(state);
  return !!slot?.simultaneous && !slot.playerTurn;
}

/** The reducer's `turn/ready`: note the player, and move the phase on once every seated player is ready. */
export function markReady(state: GameState, player: PlayerId, ready: boolean, seed = 0): GameState {
  if (!simultaneousNow(state) || state.players[player]?.seat === undefined) return state;
  const was = state.turn.ready ?? [];
  const now = ready ? (was.includes(player) ? was : [...was, player]) : was.filter((p) => p !== player);
  const next: GameState = { ...state, turn: { ...state.turn, ready: now } };
  return waitingFor(next).length ? next : advanceTurn(next, 1, seed);
}
