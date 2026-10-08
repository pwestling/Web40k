import { rollStage, startAttack, type AttackSpec, type AttackState } from "./attack";
import type { BranchEvent } from "./branch";
import { isCommitment, revealMatches, secretOf } from "./secrets";
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
import { advance, respond, type Outcome, type ProcedureRun } from "./content/runner";
import { playerActions, poolUsed, type PlayerActionTaken } from "./content/player";
import { getSystem } from "./content/systems";
import { systemOf } from "./content/turn";
import { parseDice, rollDice } from "./dice";
import { startScript, stepScript, type LogNote, type ModuleSet, type ScriptStep } from "./script";
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
  Template,
  GamePackages,
  PackageRef,
  TerrainPiece,
  Unit,
  UnitId,
  Vec2,
  Zone,
  Formation,
  DiceSet,
  CampaignRef,
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
  | UnitForm
  | ModelsMove
  | {
      type: "dice/roll";
      count: number;
      sides: number;
      label?: string;
      unitId?: UnitId;
      /** Named faces for a special die; `sides` is then their number. */
      faces?: string[];
    }
  | { type: "layout/set"; layout: Layout }
  | { type: "player/ready"; player: PlayerId; ready: boolean }
  /** A player picks the name others see (invite joiners arrive as "Player N"). */
  | { type: "player/rename"; player: PlayerId; name: string }
  /** Pick your own dice (PX-5b); null goes back to dice in your colour. */
  | { type: "player/dice"; player: PlayerId; dice: DiceSet | null }
  /** A side colour, e.g. from a saved army (#27). */
  | { type: "player/color"; player: PlayerId; color: string }
  /**
   * Play this game for a campaign book (null: for none). Its armies carry over when only the hash
   * changes; `recorded` says the change is the book taking in this game's result.
   */
  | { type: "campaign/set"; ref: Omit<CampaignRef, "armies"> | null; recorded?: boolean }
  /** Which shelf army a player brought, for the campaign book, with its name. */
  | {
      type: "campaign/army";
      player: PlayerId;
      armyId: string;
      prefix: string;
      name?: string;
      system?: string;
    }
  /** A peer whose table no longer matches the host's asks for the host's copy (logged, never silent). */
  | { type: "player/resync" }
  /** This player chose to play without these packages ("Join with mine anyway"). */
  | { type: "player/rules"; missing: string[] }
  /** Name the code this game runs (the host, before the battle; or after everyone agreed). */
  | ({ type: "game/packages" } & GamePackages)
  /** Ask the seated players to change the game's packages mid-game. */
  | { type: "packages/propose"; packages: PackageRef[] }
  | { type: "packages/accept" }
  | { type: "packages/decline" }
  | { type: "packages/withdraw" }
  | { type: "template/set"; id: string; template: Omit<Template, "by"> | null }
  /**
   * Scatter a template: roll `scatter` (a face named "hit" leaves it where it
   * is, any other face sends it off in a random direction) and move it as
   * far as the `distance` die shows (a face that isn't a number, a misfire,
   * leaves it).
   */
  | { type: "template/scatter"; id: string; scatter: string[]; distance: string[]; label?: string }
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
  /** Stop or restart the chess clocks (#29): by hand, or by the host while a player is disconnected. */
  | { type: "clock/pause"; paused: boolean; reason?: "hand" | "disconnect" }
  /** Give a side's clock time (or take it away), in milliseconds. */
  | { type: "clock/adjust"; seat: number; ms: number }
  /** Choose the mission: its deployment zones and objective markers replace the table's (terrain stays). */
  | { type: "mission/set"; mission: { id: string; name: string }; zones: Zone[]; objectives: Objective[] }
  /** Confirm the victory points suggested at a scoring moment (vp 0 and skipped to pass on it). */
  | {
      type: "score/confirm";
      key: string;
      seat: number;
      round: number;
      vp: number;
      why: string;
      /** The VP the mission suggested, when the player changed it. */
      suggested?: number;
      skipped?: boolean;
    }
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
  /** The defender declares the order their models take wounds in. */
  | { type: "attack/allocate"; order: string[] }
  | { type: "attack/clear" }
  /** Take one of the game system's actions with a unit (activate, move, fire, react...). */
  | {
      type: "action/take";
      unitId: UnitId;
      action: string;
      weapon?: string;
      targetId?: UnitId;
      with?: UnitId[];
      /** Pool dice the player picked to pay with. */
      dice?: number[];
    }
  /** A player is done re-rolling their pool for this round. */
  | { type: "pool/ready"; player: PlayerId; resource: string }
  /** Don't react, or finish reacting: the held action goes on. */
  | { type: "reaction/pass" }
  /** Roll the next step of the procedure in progress. */
  | { type: "procedure/roll" }
  /** Answer the procedure's open window with an option id or "pass". */
  | { type: "procedure/respond"; answer: string }
  | { type: "procedure/clear" }
  /** Use a player action (a stratagem). Custom ones carry a name and cost. */
  | { type: "player/action"; action: string; targetId?: UnitId; label?: string; cost?: number }
  /** Mark an ability the players resolved by hand as used this phase. */
  | { type: "ability/apply"; unitId: UnitId; ability: string }
  /**
   * Put a unit into reserves off the table edge, or bring it back (deep strike).
   * Bringing it back may set its models down at once (`moves`, its own models only).
   */
  | { type: "unit/reserve"; id: UnitId; reserve: boolean; moves?: { id: ModelId; to: Vec2 }[] }
  /** Commit to secrets (core/secrets.ts): only their commitments go to the table; the values stay here. */
  | {
      type: "secret/commit";
      player: PlayerId;
      secrets: { key: string; commitment: string }[];
      label?: string;
    }
  /** Reveal a committed secret: every peer checks the value and salt against the commitment. */
  | { type: "secret/reveal"; player: PlayerId; key: string; value: unknown; salt: string; label?: string }
  /** Start a special move now (scouts): moves are measured from here, up to `inches`. */
  | { type: "unit/specialMove"; id: UnitId; inches: number; flag: string }
  | { type: "undo"; seq: number; also?: number[] }
  /** Run a game module's code procedure (core/script.ts). */
  | { type: "script/start"; procedure: string; args?: Record<string, unknown> }
  /** Answer the question the running code procedure is waiting on. */
  | { type: "script/answer"; answer: string };

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
  | UnitForm
  | ModelsMove
  | { type: "dice/roll"; roll: DiceRoll }
  | { type: "layout/set"; layout: Layout }
  | { type: "player/ready"; player: PlayerId; ready: boolean }
  | { type: "player/rename"; player: PlayerId; name: string }
  | { type: "player/dice"; player: PlayerId; dice: DiceSet | null }
  /** A side colour, e.g. from a saved army (#27). */
  | { type: "player/color"; player: PlayerId; color: string }
  /**
   * Play this game for a campaign book (null: for none). Its armies carry over when only the hash
   * changes; `recorded` says the change is the book taking in this game's result.
   */
  | { type: "campaign/set"; ref: Omit<CampaignRef, "armies"> | null; recorded?: boolean }
  /** Which shelf army a player brought, for the campaign book, with its name. */
  | {
      type: "campaign/army";
      player: PlayerId;
      armyId: string;
      prefix: string;
      name?: string;
      system?: string;
    }
  | { type: "player/resync"; player: PlayerId }
  | { type: "player/rules"; player: PlayerId; missing: string[] }
  | ({ type: "game/packages" } & GamePackages)
  | { type: "packages/propose"; by: PlayerId; packages: PackageRef[] }
  | { type: "packages/accept"; player: PlayerId }
  | { type: "packages/decline"; player: PlayerId }
  | { type: "packages/withdraw"; player: PlayerId }
  | { type: "template/set"; id: string; template: Template | null }
  | {
      type: "template/scatter";
      id: string;
      /** The faces rolled, the direction (as a model facing) and where the template landed. */
      scatter: string;
      distance: string;
      angle: number;
      to: Vec2;
      label?: string;
    }
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
  /** Stop or restart the chess clocks (#29): by hand, or by the host while a player is disconnected. */
  | { type: "clock/pause"; paused: boolean; reason?: "hand" | "disconnect" }
  /** Give a side's clock time (or take it away), in milliseconds. */
  | { type: "clock/adjust"; seat: number; ms: number }
  /** Choose the mission: its deployment zones and objective markers replace the table's (terrain stays). */
  | { type: "mission/set"; mission: { id: string; name: string }; zones: Zone[]; objectives: Objective[] }
  /** Confirm the victory points suggested at a scoring moment (vp 0 and skipped to pass on it). */
  | {
      type: "score/confirm";
      key: string;
      seat: number;
      round: number;
      vp: number;
      why: string;
      /** The VP the mission suggested, when the player changed it. */
      suggested?: number;
      skipped?: boolean;
      by: PlayerId;
    }
  /** `seed` drives any dice rolled on the way, e.g. activation dice at the start of a round. */
  | { type: "turn/next"; seed?: number }
  | { type: "turn/prev" }
  | { type: "turn/pass"; seed?: number }
  | { type: "turn/endActivation" }
  | { type: "turn/first"; seat: number }
  /** Choose the game system before the battle starts. */
  | { type: "game/system"; system: string }
  | BranchEvent
  | { type: "resource/adjust"; player: PlayerId; resource: string; delta: number }
  /** A player's dice pool after a re-roll or spending dice. */
  /** `use` records a once-per-round re-roll or "ready" (state.used). */
  | { type: "pool/set"; player: PlayerId; resource: string; faces: number[]; use?: string }
  /** The attack after this step: declared (attacks rolled) or one stage rolled. */
  | { type: "attack/declare"; attack: AttackState }
  | { type: "attack/roll"; attack: AttackState }
  | { type: "attack/allocate"; order: string[] }
  | { type: "attack/clear" }
  /** A system action, paid for; any procedure it starts is already rolled up to its first pause. */
  | ({ type: "action/take" } & ActionTaken)
  /** The reaction is over; the held action goes on, with its procedure started. */
  | { type: "reaction/end"; run?: ProcedureRun }
  | { type: "procedure/set"; run: ProcedureRun }
  /** Close the procedure; `end` closes a finished reaction too. */
  /** `script`: a code procedure the closed run asked for (`{ do: "script" }`), started on the state before the clear. */
  | { type: "procedure/clear"; end?: { run?: ProcedureRun }; script?: ScriptStep }
  | ({ type: "player/action" } & PlayerActionTaken)
  | { type: "ability/apply"; unitId: UnitId; ability: string }
  | { type: "unit/reserve"; id: UnitId; reserve: boolean; moves: { id: ModelId; to: Vec2 }[] }
  /** Commit to secrets (core/secrets.ts): only their commitments go to the table; the values stay here. */
  | {
      type: "secret/commit";
      player: PlayerId;
      secrets: { key: string; commitment: string }[];
      label?: string;
    }
  /** Reveal a committed secret: every peer checks the value and salt against the commitment. */
  | { type: "secret/reveal"; player: PlayerId; key: string; value: unknown; salt: string; label?: string }
  | { type: "unit/specialMove"; id: UnitId; inches: number; flag: string }
  /**
   * Takes back an earlier event (and `also` these, taken back with it: a
   * whole attack, say). They stay in the log, marked as undone.
   */
  | { type: "undo"; seq: number; also?: number[] }
  | ScriptStep
  | ModuleSet
  /** A data procedure's table changes, run from code (`ctx.run`). */
  | { type: "procedure/outcomes"; outcomes: Outcome[] }
  | LogNote;

/** Move every model in a unit as one rigid block: rotate by `turn` radians
 * around `pivot`, then translate by `delta`. A ranked unit's wheel is a turn
 * around a front corner; a 40k "move the whole squad" is a pure translation. */
export interface UnitMove {
  type: "unit/move";
  id: UnitId;
  pivot: Vec2;
  turn: number;
  delta: Vec2;
  /** What kind of block move this was, for the log and the move tally. */
  how?: "forward" | "drag" | "wheel" | "charge" | "door" | "flee" | "pursue";
  /** Inches of movement it used (a wheel: the outside corner's path). */
  distance?: number;
}

/**
 * Draw a unit up as a new block: a new frontage, facing or order (a reform,
 * a turn, a change of formation). `order` is the new slot order, front rank
 * first; `models` are the standing models' new places.
 */
export interface UnitForm {
  type: "unit/form";
  id: UnitId;
  formation: Formation;
  order?: ModelId[];
  models?: { id: ModelId; to: Vec2; facing: number }[];
  how?: "reform" | "redress" | "turn" | "order";
  distance?: number;
}

/** Several models placed at once, e.g. a squad dragged together. */
export interface ModelsMove {
  type: "models/move";
  /** `z` is the height of the base; omitted means unchanged. */
  moves: { id: ModelId; to: Vec2; z?: number }[];
  /** Set when this pulls an over-long move back to its limit, for the log. */
  snap?: number;
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
  /** The state as it stood after an earlier event; code procedures replay from it. */
  history?: (seq: number) => GameState,
): GameEvent | null {
  switch (intent.type) {
    case "script/start": {
      if (!state || state.script || !state.players[from]) return null;
      return startScript(state, intent.procedure, intent.args ?? {}, from, rng);
    }
    case "script/answer": {
      const script = state?.script;
      if (!state || !script?.waiting || !history) return null;
      if (script.waiting.player !== from) return null;
      // A secret's answer (a commitment, or a reveal) is checked by the procedure itself.
      const secret = script.waiting.secret !== undefined || script.waiting.reveal !== undefined;
      if (!secret && !script.waiting.options.some((o) => o.id === intent.answer)) return null;
      return stepScript(script, history(script.startSeq), rng, intent.answer);
    }
    case "dice/roll": {
      const count = Math.floor(intent.count);
      const sides = Math.floor(intent.sides);
      if (count < 1 || count > MAX_DICE_PER_ROLL || sides < 2) return null;
      const results = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
      const roll: DiceRoll = { by: from, sides, results };
      if (intent.faces?.length === sides) roll.faces = intent.faces;
      if (intent.label) roll.label = intent.label;
      if (intent.unitId) roll.unitId = intent.unitId;
      return { type: "dice/roll", roll };
    }
    case "player/join":
      return intent.player.id === from ? intent : null;
    case "player/rename": {
      const name = intent.name.trim().slice(0, 32);
      return state?.players[intent.player] && intent.player === from && name
        ? { type: "player/rename", player: intent.player, name }
        : null;
    }
    case "player/dice": {
      const dice = intent.dice && cleanDice(intent.dice);
      return state?.players[intent.player] && intent.player === from && dice !== undefined
        ? { type: "player/dice", player: intent.player, dice }
        : null;
    }
    case "player/color":
      return state?.players[intent.player] && intent.player === from && /^#[0-9a-f]{6}$/i.test(intent.color)
        ? { type: "player/color", player: intent.player, color: intent.color.toLowerCase() }
        : null;
    case "clock/pause":
      return state?.players[from] && typeof intent.paused === "boolean"
        ? {
            type: "clock/pause",
            paused: intent.paused,
            ...(intent.paused ? { reason: intent.reason === "disconnect" ? "disconnect" : "hand" } : {}),
          }
        : null;
    case "clock/adjust":
      return state?.players[from] &&
        Number.isInteger(intent.seat) &&
        Number.isFinite(intent.ms) &&
        Math.abs(intent.ms) <= 24 * 3_600_000
        ? { type: "clock/adjust", seat: intent.seat, ms: Math.round(intent.ms) }
        : null;
    case "campaign/set": {
      if (!state?.players[from]) return null;
      const r = intent.ref;
      if (r === null) return { type: "campaign/set", ref: null };
      const text = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
      if (!text(r.id, 64) || !text(r.name, 120) || !/^[0-9a-f]{64}$/.test(r.hash)) return null;
      if (r.territory !== undefined && !text(r.territory, 120)) return null;
      return {
        type: "campaign/set",
        ref: { id: r.id, name: r.name, hash: r.hash, ...(r.territory ? { territory: r.territory } : {}) },
        ...(intent.recorded ? { recorded: true } : {}),
      };
    }
    case "campaign/army":
      return state?.campaign &&
        state.players[intent.player] &&
        intent.player === from &&
        typeof intent.armyId === "string" &&
        intent.armyId.length <= 64 &&
        typeof intent.prefix === "string" &&
        intent.prefix.length <= 64
        ? {
            type: "campaign/army",
            player: intent.player,
            armyId: intent.armyId,
            prefix: intent.prefix,
            ...(typeof intent.name === "string" && intent.name ? { name: intent.name.slice(0, 120) } : {}),
            ...(typeof intent.system === "string" && intent.system
              ? { system: intent.system.slice(0, 64) }
              : {}),
          }
        : null;
    case "player/claim":
      return state?.players[intent.player] && intent.player !== from
        ? { type: "player/claim", player: intent.player, by: from }
        : null;
    case "pool/reroll":
    case "pool/spend": {
      const faces = state?.pools?.[intent.player]?.[intent.resource];
      if (!state || !faces || !state.players[intent.player]) return null;
      const picked = new Set(intent.indices.filter((i) => i >= 0 && i < faces.length));
      const def = systemOf(state).resources?.find((r) => r.id === intent.resource);
      const sides = def?.sides ?? 6;
      const once = intent.type === "pool/reroll" && def?.rerollOnce;
      if (once && poolUsed(state, intent.player, intent.resource)) return null;
      const next =
        intent.type === "pool/spend"
          ? faces.filter((_, i) => !picked.has(i))
          : faces.map((f, i) => (picked.has(i) ? 1 + Math.floor(rng() * sides) : f));
      return {
        type: "pool/set",
        player: intent.player,
        resource: intent.resource,
        faces: next,
        ...(once ? { use: `reroll:${intent.resource}` } : {}),
      };
    }
    case "pool/ready": {
      const faces = state?.pools?.[intent.player]?.[intent.resource];
      if (!state || !faces || state.players[intent.player]?.id !== from) return null;
      return {
        type: "pool/set",
        player: intent.player,
        resource: intent.resource,
        faces,
        use: `ready:${intent.resource}`,
      };
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
    case "attack/allocate": {
      const attack = state?.attack;
      const target = attack && state?.units[attack.spec.targetUnitId];
      // Only the defender declares, and only before damage is rolled.
      if (!attack?.run || !target || target.owner !== from) return null;
      if (attack.stage === "damage" || attack.stage === "done") return null;
      const own = new Set(target.modelIds);
      if (!intent.order.every((id) => own.has(id))) return null;
      return { type: "attack/allocate", order: intent.order };
    }
    case "ruler/set":
      return { type: "ruler/set", ruler: intent.ruler && { ...intent.ruler, by: from } };
    case "player/resync":
      return { type: "player/resync", player: from };
    case "player/rules":
      return state?.players[from] ? { type: "player/rules", player: from, missing: intent.missing } : null;
    case "packages/propose":
      return { type: "packages/propose", by: from, packages: intent.packages };
    case "packages/accept":
    case "packages/decline":
    case "packages/withdraw":
      return state?.packageProposal ? { type: intent.type, player: from } : null;
    case "template/set":
      return {
        type: "template/set",
        id: intent.id,
        template: intent.template && { ...intent.template, by: from },
      };
    case "template/scatter": {
      const t = state?.templates?.[intent.id];
      if (!t || !intent.scatter.length || !intent.distance.length) return null;
      const pick = (faces: string[]) => faces[Math.floor(rng() * faces.length)]!;
      const scatter = pick(intent.scatter);
      const distance = pick(intent.distance);
      const angle = rng() * Math.PI * 2;
      const inches = scatter.toLowerCase() === "hit" ? 0 : Number(distance) || 0;
      const to = { x: t.at.x + Math.sin(angle) * inches, y: t.at.y + Math.cos(angle) * inches };
      return {
        type: "template/scatter",
        id: intent.id,
        scatter,
        distance,
        angle,
        to,
        ...(intent.label ? { label: intent.label } : {}),
      };
    }
    case "action/take": {
      const unit = state?.units[intent.unitId];
      if (!state || !unit || unit.owner !== from) return null;
      const req = {
        ...(intent.weapon ? { weapon: intent.weapon } : {}),
        ...(intent.targetId ? { targetId: intent.targetId } : {}),
      };
      const option = unitActions(state, unit.id, {
        ...req,
        ...(intent.dice ? { dice: intent.dice } : {}),
      }).find((o) => o.def.id === intent.action);
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
    case "player/action": {
      if (!state) return null;
      const option = playerActions(state, from).find((o) => o.def.id === intent.action);
      if (!option) return null;
      if (!option.ok) return null;
      let payment = option.payment;
      if (option.def.custom) {
        // The player names the stratagem and its cost; the engine only checks they can pay.
        const cost = Math.max(0, Math.floor(intent.cost ?? 0));
        const resource = option.def.cost?.[0]?.resource;
        if (!intent.label?.trim() || !resource) return null;
        if ((state.resources[from]?.[resource] ?? 0) < cost) return null;
        payment = cost ? [{ resource, amount: cost }] : [];
      }
      if (intent.targetId && !option.targets?.includes(intent.targetId)) return null;
      if (option.targets && !intent.targetId) return null;
      return {
        type: "player/action",
        player: from,
        action: intent.action,
        payment,
        ...(intent.targetId ? { targetId: intent.targetId } : {}),
        ...(option.def.custom && intent.label ? { label: intent.label.trim().slice(0, 60) } : {}),
      };
    }
    case "ability/apply": {
      const unit = state?.units[intent.unitId];
      if (!unit || !unit.sheet?.abilities.some((a) => a.name === intent.ability)) return null;
      return intent;
    }
    case "mission/set":
      return state?.players[from]?.seat !== undefined ? intent : null;
    case "score/confirm": {
      // A side's own players confirm its score; anyone seated may in a hotseat game (from is the active player).
      if (!state || state.players[from]?.seat === undefined) return null;
      if (state.scores?.some((s) => s.key === intent.key)) return null;
      return { ...intent, vp: Math.round(intent.vp), by: from };
    }
    case "secret/commit": {
      if (!state?.players[intent.player] || intent.player !== from || !intent.secrets.length) return null;
      const keys = new Set<string>();
      for (const { key, commitment } of intent.secrets) {
        if (!key || keys.has(key) || !isCommitment(commitment) || secretOf(state, from, key)) return null;
        keys.add(key);
      }
      return intent;
    }
    case "secret/reveal":
      if (!state || intent.player !== from) return null;
      return revealMatches(secretOf(state, from, intent.key), intent.value, intent.salt) ? intent : null;
    case "unit/reserve": {
      const unit = state?.units[intent.id];
      if (!state || !unit || unit.owner !== from) return null;
      if (!intent.reserve) {
        const own = new Set(unit.modelIds);
        const moves = (intent.moves ?? []).filter(
          (m) => own.has(m.id) && Number.isFinite(m.to?.x) && Number.isFinite(m.to?.y),
        );
        return { type: "unit/reserve", id: intent.id, reserve: false, moves };
      }
      // Off the owner's own long edge (the one behind their deployment zone), shape kept and
      // side by side, so the models stay visible and draggable and arrive facing the right way.
      const seat = state.players[unit.owner]?.seat ?? 0;
      const zone = state.zones.find((z) => z.seat === seat);
      const zy = zone?.points.length ? zone.points.reduce((t, p) => t + p.y, 0) / zone.points.length : 0;
      const side = zy !== 0 ? Math.sign(zy) : seat === 0 ? 1 : -1;
      const ms = unit.modelIds.map((id) => state.models[id]).filter((m) => !!m);
      if (!ms.length) return { ...intent, moves: [] };
      const xs = ms.map((m) => m.position.x);
      const ys = ms.map((m) => m.position.y);
      // Further along the edge than the units already waiting there.
      const waiting = Object.values(state.units).filter(
        (u) => u.owner === unit.owner && u.status?.reserves && u.id !== unit.id,
      );
      let left = -state.table.width / 2 + 1;
      for (const u of waiting)
        for (const id of u.modelIds) {
          const m = state.models[id];
          if (m) left = Math.max(left, m.position.x + 2);
        }
      const dx = left - Math.min(...xs) + 1;
      // The unit's inner models 4" beyond the table edge: clear of it whatever the base size.
      const inner = side > 0 ? Math.min(...ys) : Math.max(...ys);
      const dy = side * (state.table.depth / 2 + 4) - inner;
      const moves = ms.map((m) => ({ id: m.id, to: { x: m.position.x + dx, y: m.position.y + dy } }));
      return { ...intent, moves };
    }
    case "unit/specialMove": {
      const unit = state?.units[intent.id];
      if (!unit || unit.owner !== from || !(intent.inches > 0)) return null;
      return intent;
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
      // A finished run that asked for a code procedure starts it now, against
      // this state, so a replay from this seq sees the same table.
      const wanted = state.procedure.run.done
        ? state.procedure.run.outcomes.find((o) => o.kind === "script")
        : undefined;
      const script =
        wanted?.kind === "script" && !state.script
          ? { script: startScript(state, wanted.procedure, wanted.args, state.procedure.by, rng) }
          : {};
      const cleared: GameState = { ...state, procedure: null };
      if (!reactionOver(cleared)) return { type: "procedure/clear", ...script };
      const run = state.pending
        ? startActionRun(endReaction(cleared, null), state.pending.trigger, rng)
        : null;
      return { type: "procedure/clear", end: run ? { run } : {}, ...script };
    }
    default:
      return intent;
  }
}

/** Roll a dice expression such as "2D6"; exported for UI previews and tests. */
export function rollText(text: string, rng: Rng): number {
  return rollDice(parseDice(text), rng).total;
}

const COLOR = /^#[0-9a-f]{6}$/i;
const FINISHES: DiceSet["finish"][] = ["solid", "translucent", "marbled", "metallic"];

/** A dice set from a peer, if it is one: two #rrggbb colours and a known finish (null stays null). */
function cleanDice(d: DiceSet): DiceSet | null | undefined {
  if (!d || typeof d !== "object") return undefined;
  if (!COLOR.test(String(d.body)) || !COLOR.test(String(d.pip)) || !FINISHES.includes(d.finish))
    return undefined;
  return { body: d.body, pip: d.pip, finish: d.finish };
}
