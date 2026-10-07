import { rollStage, startAttack, type AttackSpec, type AttackState } from "./attack";
import {
  applyAction,
  endReaction,
  procedureEnv,
  reactionOver,
  reactionSeat,
  startActionRun,
  unitActions,
  type ActionTaken,
} from "./content/play";
import { advance, respond, type ProcedureRun } from "./content/runner";
import { getSystem } from "./content/systems";
import { systemOf } from "./content/turn";
import { parseDice, rollDice } from "./dice";
import type {
  DiceRoll,
  GameSettings,
  GameState,
  Model,
  ModelFigure,
  ModelId,
  Objective,
  Player,
  PlayerId,
  Ruler,
  SightBand,
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
  | { type: "ruler/set"; ruler: Ruler | null }
  | { type: "unit/height"; id: UnitId; height: number | null }
  /**
   * Dress the models in a unit whose profile (or label) is in `keys` with an
   * uploaded figure, or back to stand-ins with null. `bands` is the figure's
   * shape from its feet up, before scaling; each model adds its own base.
   */
  | { type: "unit/figure"; id: UnitId; keys: string[]; figure: ModelFigure | null; bands?: SightBand[] }
  | { type: "settings/set"; settings: Partial<GameSettings> }
  | { type: "turn/next" }
  | { type: "turn/prev" }
  | { type: "turn/pass" }
  | { type: "turn/endActivation" }
  | { type: "turn/first"; seat: number }
  | { type: "game/system"; system: string }
  | { type: "resource/adjust"; player: PlayerId; resource: string; delta: number }
  /** Re-roll some dice in a player's pool (by index). */
  | { type: "pool/reroll"; player: PlayerId; resource: string; indices: number[] }
  /** Spend dice from a player's pool (by index). */
  | { type: "pool/spend"; player: PlayerId; resource: string; indices: number[] }
  | { type: "attack/declare"; spec: AttackSpec }
  | { type: "attack/roll" }
  | { type: "attack/clear" }
  /** Take one of the game system's actions with a unit (activate, move, fire, react...). */
  | {
      type: "action/take";
      unitId: UnitId;
      action: string;
      weapon?: string;
      targetId?: UnitId;
      with?: UnitId[];
    }
  /** Don't react, or finish reacting: the held action goes on. */
  | { type: "reaction/pass" }
  /** Roll the next step of the procedure in progress. */
  | { type: "procedure/roll" }
  /** Answer the procedure's open window with an option id or "pass". */
  | { type: "procedure/respond"; answer: string }
  | { type: "procedure/clear" }
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
  | { type: "ruler/set"; ruler: Ruler | null }
  | { type: "unit/height"; id: UnitId; height: number | null }
  /**
   * Dress the models in a unit whose profile (or label) is in `keys` with an
   * uploaded figure, or back to stand-ins with null. `bands` is the figure's
   * shape from its feet up, before scaling; each model adds its own base.
   */
  | { type: "unit/figure"; id: UnitId; keys: string[]; figure: ModelFigure | null; bands?: SightBand[] }
  | { type: "settings/set"; settings: Partial<GameSettings> }
  /** `seed` drives any dice rolled on the way, e.g. activation dice at the start of a round. */
  | { type: "turn/next"; seed?: number }
  | { type: "turn/prev" }
  | { type: "turn/pass"; seed?: number }
  | { type: "turn/endActivation" }
  | { type: "turn/first"; seat: number }
  /** Choose the game system before the battle starts. */
  | { type: "game/system"; system: string }
  | { type: "resource/adjust"; player: PlayerId; resource: string; delta: number }
  /** A player's dice pool after a re-roll or spending dice. */
  | { type: "pool/set"; player: PlayerId; resource: string; faces: number[] }
  /** The attack after this step: declared (attacks rolled) or one stage rolled. */
  | { type: "attack/declare"; attack: AttackState }
  | { type: "attack/roll"; attack: AttackState }
  | { type: "attack/clear" }
  /** A system action, paid for; any procedure it starts is already rolled up to its first pause. */
  | ({ type: "action/take" } & ActionTaken)
  /** The reaction is over; the held action goes on, with its procedure started. */
  | { type: "reaction/end"; run?: ProcedureRun }
  | { type: "procedure/set"; run: ProcedureRun }
  /** Close the procedure; `end` closes a finished reaction too. */
  | { type: "procedure/clear"; end?: { run?: ProcedureRun } }
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
    case "pool/reroll":
    case "pool/spend": {
      const faces = state?.pools?.[intent.player]?.[intent.resource];
      if (!state || !faces || !state.players[intent.player]) return null;
      const picked = new Set(intent.indices.filter((i) => i >= 0 && i < faces.length));
      const sides = systemOf(state).resources?.find((r) => r.id === intent.resource)?.sides ?? 6;
      const next =
        intent.type === "pool/spend"
          ? faces.filter((_, i) => !picked.has(i))
          : faces.map((f, i) => (picked.has(i) ? 1 + Math.floor(rng() * sides) : f));
      return { type: "pool/set", player: intent.player, resource: intent.resource, faces: next };
    }
    case "turn/next":
    case "turn/pass":
      return { ...intent, seed: Math.floor(rng() * 2 ** 31) };
    case "game/system":
      try {
        getSystem(intent.system);
      } catch {
        return null;
      }
      return intent;
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
    case "ruler/set":
      return { type: "ruler/set", ruler: intent.ruler && { ...intent.ruler, by: from } };
    case "action/take": {
      const unit = state?.units[intent.unitId];
      if (!state || !unit || unit.owner !== from) return null;
      const req = {
        ...(intent.weapon ? { weapon: intent.weapon } : {}),
        ...(intent.targetId ? { targetId: intent.targetId } : {}),
      };
      const option = unitActions(state, unit.id, req).find((o) => o.def.id === intent.action);
      if (!option?.ok) return null;
      const allowed = new Set(option.commands?.candidates ?? []);
      const commanded = (intent.with ?? [])
        .filter((id) => allowed.has(id))
        .slice(0, option.commands?.count ?? 0);
      const taken: ActionTaken = {
        unitId: unit.id,
        action: intent.action,
        by: from,
        ...req,
        payment: option.payment,
        ...(commanded.length ? { with: commanded } : {}),
      };
      // The other player may react before a fire or move action goes on.
      const paid = applyAction(state, taken);
      const hold = !option.def.reactTo && reactionSeat(paid, taken) !== null;
      const run = !hold && option.def.procedure ? startActionRun(paid, taken, rng) : null;
      return { type: "action/take", ...taken, ...(hold ? { hold } : {}), ...(run ? { run } : {}) };
    }
    case "reaction/pass": {
      const pending = state?.pending;
      if (!state || !pending || state.procedure) return null;
      const run = startActionRun(endReaction(state, null), pending.trigger, rng);
      return { type: "reaction/end", ...(run ? { run } : {}) };
    }
    case "procedure/roll": {
      const run = state?.procedure?.run;
      if (!state || !run || run.done || run.pending) return null;
      return { type: "procedure/set", run: advance(procedureEnv(state, rng), run) };
    }
    case "procedure/respond": {
      const run = state?.procedure?.run;
      if (!state || !run?.pending) return null;
      return { type: "procedure/set", run: respond(procedureEnv(state, rng), run, intent.answer) };
    }
    case "procedure/clear": {
      if (!state?.procedure) return null;
      const cleared: GameState = { ...state, procedure: null };
      if (!reactionOver(cleared)) return { type: "procedure/clear" };
      const run = state.pending
        ? startActionRun(endReaction(cleared, null), state.pending.trigger, rng)
        : null;
      return { type: "procedure/clear", end: run ? { run } : {} };
    }
    default:
      return intent;
  }
}

/** Roll a dice expression such as "2D6"; exported for UI previews and tests. */
export function rollText(text: string, rng: Rng): number {
  return rollDice(parseDice(text), rng).total;
}
