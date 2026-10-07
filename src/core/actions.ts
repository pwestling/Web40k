import { rollStage, startAttack, type AttackSpec, type AttackState } from "./attack";
import { parseDice, rollDice } from "./dice";
import type {
  DiceRoll,
  GameSettings,
  GameState,
  Model,
  ModelId,
  Objective,
  Player,
  PlayerId,
  TerrainPiece,
  Unit,
  UnitId,
  Vec2,
  Zone,
} from "./types";

/** The table layout: terrain, objectives and deployment zones. */
export interface Layout {
  terrain: TerrainPiece[];
  objectives: Objective[];
  zones: Zone[];
}

/**
 * An Intent is what a player asks for. Only the host turns intents into
 * Events, which is where anything random (dice) gets resolved, so every peer
 * applies exactly the same events in the same order.
 */
export type Intent =
  | { type: "player/join"; player: Player }
  /** Join a leader (or any unit) to another unit, which then moves, fights and takes damage as one. */
  | { type: "unit/attach"; id: UnitId; to: UnitId }
  | { type: "player/claim"; player: PlayerId }
  | { type: "model/add"; model: Model }
  | { type: "model/move"; id: ModelId; to: Vec2; facing?: number }
  | { type: "model/remove"; id: ModelId }
  | { type: "model/wounds"; id: ModelId; woundsLost: number; destroyed: boolean }
  | { type: "unit/add"; unit: Unit; models: Model[] }
  | { type: "unit/remove"; id: UnitId }
  | { type: "unit/status"; id: UnitId; key: string; value: number | boolean | null }
  | UnitMove
  | ModelsMove
  | { type: "dice/roll"; count: number; sides: number; label?: string; unitId?: UnitId }
  | { type: "layout/set"; layout: Layout }
  | { type: "terrain/add"; piece: TerrainPiece }
  | { type: "terrain/update"; piece: TerrainPiece }
  | { type: "terrain/remove"; id: string }
  | { type: "objective/move"; id: string; to: Vec2 }
  | { type: "unit/height"; id: UnitId; height: number | null }
  | { type: "settings/set"; settings: Partial<GameSettings> }
  | { type: "turn/next" }
  | { type: "turn/prev" }
  | { type: "turn/first"; seat: number }
  | { type: "resource/adjust"; player: PlayerId; resource: string; delta: number }
  | { type: "attack/declare"; spec: AttackSpec }
  | { type: "attack/roll" }
  | { type: "attack/clear" }
  | { type: "undo"; seq: number };

/** Events are fully resolved and deterministic. */
export type GameEvent =
  | { type: "player/join"; player: Player }
  /** Join a leader (or any unit) to another unit, which then moves, fights and takes damage as one. */
  | { type: "unit/attach"; id: UnitId; to: UnitId }
  /** A reconnecting peer takes over an earlier player's seat, units and counters. */
  | { type: "player/claim"; player: PlayerId; by: PlayerId }
  | { type: "model/add"; model: Model }
  | { type: "model/move"; id: ModelId; to: Vec2; facing?: number }
  | { type: "model/remove"; id: ModelId }
  | { type: "model/wounds"; id: ModelId; woundsLost: number; destroyed: boolean }
  | { type: "unit/add"; unit: Unit; models: Model[] }
  | { type: "unit/remove"; id: UnitId }
  | { type: "unit/status"; id: UnitId; key: string; value: number | boolean | null }
  | UnitMove
  | ModelsMove
  | { type: "dice/roll"; roll: DiceRoll }
  | { type: "layout/set"; layout: Layout }
  | { type: "terrain/add"; piece: TerrainPiece }
  | { type: "terrain/update"; piece: TerrainPiece }
  | { type: "terrain/remove"; id: string }
  | { type: "objective/move"; id: string; to: Vec2 }
  | { type: "unit/height"; id: UnitId; height: number | null }
  | { type: "settings/set"; settings: Partial<GameSettings> }
  | { type: "turn/next" }
  | { type: "turn/prev" }
  | { type: "turn/first"; seat: number }
  | { type: "resource/adjust"; player: PlayerId; resource: string; delta: number }
  /** The attack after this step: declared (attacks rolled) or one stage rolled. */
  | { type: "attack/declare"; attack: AttackState }
  | { type: "attack/roll"; attack: AttackState }
  | { type: "attack/clear" }
  /** Takes back an earlier event. It stays in the log, marked as undone. */
  | { type: "undo"; seq: number };

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

/** Several models placed at once, e.g. a squad dragged together. */
export interface ModelsMove {
  type: "models/move";
  /** `z` is the height of the base; omitted means unchanged. */
  moves: { id: ModelId; to: Vec2; z?: number }[];
}

export type Rng = () => number;

export const MAX_DICE_PER_ROLL = 100;

/**
 * Resolve an intent from `from` into an event, or null if it is rejected.
 * Only malformed or impersonating intents are rejected. Rules are advisory:
 * a move that breaks a game rule is still applied, and the UI warns instead.
 */
export function resolveIntent(
  intent: Intent,
  from: PlayerId,
  rng: Rng = Math.random,
  state?: GameState,
): GameEvent | null {
  switch (intent.type) {
    case "dice/roll": {
      const count = Math.floor(intent.count);
      const sides = Math.floor(intent.sides);
      if (count < 1 || count > MAX_DICE_PER_ROLL || sides < 2) return null;
      const results = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
      const roll: DiceRoll = { by: from, sides, results };
      if (intent.label) roll.label = intent.label;
      if (intent.unitId) roll.unitId = intent.unitId;
      return { type: "dice/roll", roll };
    }
    case "player/join":
      return intent.player.id === from ? intent : null;
    case "player/claim":
      return state?.players[intent.player] && intent.player !== from
        ? { type: "player/claim", player: intent.player, by: from }
        : null;
    case "attack/declare": {
      try {
        parseDice(intent.spec.attacks);
        parseDice(intent.spec.damage);
      } catch {
        return null;
      }
      const attack = startAttack(intent.spec, rng, state);
      if (attack.attackCount > 500) return null;
      return { type: "attack/declare", attack };
    }
    case "attack/roll": {
      const attack = state?.attack;
      if (!state || !attack || attack.stage === "done") return null;
      return { type: "attack/roll", attack: rollStage(state, attack, rng) };
    }
    default:
      return intent;
  }
}

/** Roll a dice expression such as "2D6"; exported for UI previews and tests. */
export function rollText(text: string, rng: Rng): number {
  return rollDice(parseDice(text), rng).total;
}
