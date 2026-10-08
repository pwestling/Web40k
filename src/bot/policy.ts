import type { GameRecord, GameState, PlayerId } from "../core";
import type { Mission } from "../sdk";
import { gameModule } from "../systems";
import type { BotMove } from "../soak/bot";

/** Who a computer opponent plays: its side, and the player it moves as. */
export interface Seat {
  seat: number;
  player: PlayerId;
}

/** A side's player: the move it makes now, or null when nothing is its to do. */
export interface Policy {
  name: string;
  move(record: GameRecord, state: GameState, me: Seat): BotMove | null;
  /** Called after every move logged, whoever made it (to keep track of what was done this phase). */
  saw?(state: GameState, move: BotMove): void;
}

/** The mission being played, if the game has one. */
export function missionOf(state: GameState): Mission | undefined {
  return gameModule(state.system)?.app?.missions?.find((m) => m.id === state.mission?.id);
}
