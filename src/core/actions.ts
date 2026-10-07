import type { DiceRoll, Model, ModelId, Player, PlayerId, Vec2 } from "./types";

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
  | { type: "dice/roll"; count: number; sides: number };

/** Events are fully resolved and deterministic. */
export type GameEvent =
  | { type: "player/join"; player: Player }
  | { type: "model/add"; model: Model }
  | { type: "model/move"; id: ModelId; to: Vec2; facing?: number }
  | { type: "model/remove"; id: ModelId }
  | { type: "dice/roll"; roll: DiceRoll };

export type Rng = () => number;

export const MAX_DICE_PER_ROLL = 100;

/** Resolve an intent from `from` into an event, or null if it is rejected. */
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
