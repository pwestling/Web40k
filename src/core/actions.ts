import type { DiceRoll, Model, ModelId, Player, PlayerId, Unit, UnitId, Vec2 } from "./types";

/**
 * An Intent is what a player asks for. Only the host turns intents into
 * Events, which is where anything random (dice) gets resolved, so every peer
 * applies exactly the same events in the same order.
 */
export type Intent =
  | { type: "player/join"; player: Player }
  | { type: "model/add"; model: Model }
  | { type: "model/move"; id: ModelId; to: Vec2; facing?: number }
  | { type: "model/remove"; id: ModelId }
  | { type: "unit/add"; unit: Unit; models: Model[] }
  | UnitMove
  | { type: "dice/roll"; count: number; sides: number };

/** Events are fully resolved and deterministic. */
export type GameEvent =
  | { type: "player/join"; player: Player }
  | { type: "model/add"; model: Model }
  | { type: "model/move"; id: ModelId; to: Vec2; facing?: number }
  | { type: "model/remove"; id: ModelId }
  | { type: "unit/add"; unit: Unit; models: Model[] }
  | UnitMove
  | { type: "dice/roll"; roll: DiceRoll };

/** Move every model in a unit as one rigid block: rotate by `turn` radians
 * around `pivot`, then translate by `delta`. A ranked unit's wheel is a turn
 * around a front corner; a 40k "move the whole squad" is a pure translation. */
export interface UnitMove {
  type: "unit/move";
  id: UnitId;
  pivot: Vec2;
  turn: number;
  delta: Vec2;
}

export type Rng = () => number;

export const MAX_DICE_PER_ROLL = 100;

/**
 * Resolve an intent from `from` into an event, or null if it is rejected.
 * Only malformed or impersonating intents are rejected. Rules are advisory:
 * a move that breaks a game rule is still applied, and the UI warns instead.
 */
export function resolveIntent(intent: Intent, from: PlayerId, rng: Rng = Math.random): GameEvent | null {
  switch (intent.type) {
    case "dice/roll": {
      const count = Math.floor(intent.count);
      const sides = Math.floor(intent.sides);
      if (count < 1 || count > MAX_DICE_PER_ROLL || sides < 2) return null;
      const results = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
      return { type: "dice/roll", roll: { by: from, sides, results } };
    }
    case "player/join":
      return intent.player.id === from ? intent : null;
    default:
      return intent;
  }
}
