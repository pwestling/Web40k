import { commitTo, isSeed } from "./sharedDice";
import { rollStage, startAttack, type AttackSpec, type AttackState } from "./attack";
import {
  canonResult,
  DECLINE_WHYS,
  isPlayerKey,
  MAX_FIXES,
  rankedOver,
  rankedReady,
  rankedResultOf,
  type DeclineWhy,
  type PlayerKey,
  type RankedResult,
} from "./ranked";
import type { BranchEvent } from "./branch";
import { isCommitment, revealMatches, secretOf } from "./secrets";
import { deckPrefix, inHand, type CardDeck } from "./cards";
import { opposed } from "./teams";
import {
  applyAction,
  cantPlace,
  endReaction,
  placedKey,
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
import { currentSlot, systemOf } from "./content/turn";
import { die, parseDice, rollDice } from "./dice";
import {
  codeActionWhy,
  startScript,
  stepScript,
  type CampaignAward,
  type LogNote,
  type ModuleSet,
  type ScriptStep,
} from "./script";
import type {
  AbilityAuto,
  Army,
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
  TableSource,
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
  /** The table's card decks (core/cards.ts): a TTS save's mission cards (#75). */
  decks?: CardDeck[];
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
  /** An attached unit (`unit`) leaves the unit it joined (`id`) and is a unit of its own again. */
  | { type: "unit/detach"; id: UnitId; unit: UnitId }
  | { type: "player/claim"; player: PlayerId }
  | { type: "model/add"; model: Model }
  | { type: "model/move"; id: ModelId; to: Vec2; facing?: number }
  | { type: "model/remove"; id: ModelId }
  | { type: "model/wounds"; id: ModelId; woundsLost: number; destroyed: boolean }
  | { type: "unit/add"; unit: Unit; models: Model[] }
  | { type: "unit/remove"; id: UnitId }
  | { type: "unit/status"; id: UnitId; key: string; value: number | boolean | null }
  /** Run an ability as the rule read from its text (#38), or stop (null). Owner only. */
  | { type: "unit/automate"; id: UnitId; ability: string; auto: AbilityAuto | null }
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
      /** A charge roll: the units it was declared against (UX 396). */
      targets?: UnitId[];
    }
  /** `source`: the starter or library table it came from, so every player's picker can name it. */
  | { type: "layout/set"; layout: Layout; source?: TableSource }
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
  /** `recorded`: the leader wrote this game in; `merged`: games from another table's copy were joined in. */
  | { type: "campaign/set"; ref: Omit<CampaignRef, "armies"> | null; recorded?: boolean; merged?: boolean }
  /** Which shelf army a player brought, for the campaign book, with its name. */
  | {
      type: "campaign/army";
      player: PlayerId;
      armyId: string;
      prefix: string;
      name?: string;
      system?: string;
    }
  /** Play this game ranked (#65) with this player key, or not (null). Before the result only. */
  | { type: "ranked/card"; key: PlayerKey | null }
  /** Shared dice (core/sharedDice.ts): the host's commitment to a secret seed. */
  | { type: "dice/commit"; hash: string }
  /** Shared dice: another ranked player's seed, sent once the host has committed. */
  | { type: "dice/seed"; seed: string }
  /** Shared dice: the host shows the seed it committed to, and commits to the next one (none once the battle is over). */
  | { type: "dice/reveal"; seed: string; next?: string }
  /** The result both players are asked to sign, once the battle is over (core/ranked.ts). */
  | { type: "ranked/result"; result: RankedResult }
  /** This player's signature on the result, or null: they don't agree with it. */
  | { type: "ranked/sign"; sig: string | null; why?: DeclineWhy; decline?: string }
  /** The score has been fixed on the table: write the result again (after a "the score is wrong"). */
  | { type: "ranked/fixed" }
  /** An event game (#67): the hash of the army this player deployed, to check against their registration. */
  | { type: "event/army"; hash: string }
  /** A peer whose table no longer matches the host's asks for the host's copy (logged, never silent). */
  | { type: "player/resync" }
  /** This player chose to play without these packages ("Join with mine anyway"). */
  | { type: "player/rules"; missing: string[] }
  /** The army-wide rules from the player's roster: detachment, its rules and stratagems (#49). */
  | { type: "player/army"; army: Army | null }
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
  /** A time call written into the log when it's first made (UX 218): "last-turn", "time-up", "round-3", "out-1". */
  | { type: "clock/call"; kind: string; text: string }
  /** Choose the mission: its deployment zones and objective markers replace the table's (terrain stays). */
  | {
      type: "mission/set";
      mission: { id: string; name: string } | null;
      zones: Zone[];
      objectives: Objective[];
    }
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
  /** `unit`: the unit whose go it was, when it only moved (a real table, where moves aren't on the board). */
  | { type: "turn/endActivation"; unit?: UnitId }
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
      /** A multiple attack's other targets, in order (ActionDef.repeat); missing ones are the first target. */
      more?: UnitId[];
      with?: UnitId[];
      /** Pool dice the player picked to pay with. */
      dice?: number[];
      /** Take it although a `notWhen` says no (ActionOption.overridable); logged for everyone. */
      force?: boolean;
    }
  /** A player is done re-rolling their pool for this round. */
  | { type: "pool/ready"; player: PlayerId; resource: string }
  /** Place a pool die on a weapon's AD slots ahead of time (FSD). */
  | { type: "dice/place"; unitId: UnitId; weapon: string; index: number }
  /** Discard the dice placed on a weapon's slots (FSD cleanup). */
  | { type: "dice/discard"; unitId: UnitId; weapon: string }
  /** Don't react, or finish reacting: the held action goes on. */
  | { type: "reaction/pass" }
  /** Roll the next step of the procedure in progress. */
  | { type: "procedure/roll" }
  /** Answer the procedure's open window with an option id or "pass". */
  | { type: "procedure/respond"; answer: string }
  | { type: "procedure/clear" }
  /** Use a player action (a stratagem). Custom ones carry a name and cost. */
  | {
      type: "player/action";
      action: string;
      targetId?: UnitId;
      label?: string;
      cost?: number;
      /** For a custom action paid from a dice pool: which dice (else the lowest). */
      dice?: number[];
    }
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
  /** A card drawn from a deck (core/cards.ts) goes to the discard pile, face up or not. */
  | { type: "deck/discard"; deck: string; key: string }
  /** The player's discards from a deck go back in it. */
  | { type: "deck/shuffle"; deck: string }
  /** Put a deck away: off the table for everyone. */
  | { type: "deck/remove"; id: string }
  /** Start a special move now (scouts): moves are measured from here, up to `inches`. */
  | { type: "unit/specialMove"; id: UnitId; inches: number; flag: string }
  | { type: "undo"; seq: number; also?: number[] }
  /**
   * Run a game module's code procedure (core/script.ts). A code action whose
   * `available` says no is refused unless `force` (the players agreed to
   * play it anyway, or a test sets the scene).
   */
  | { type: "script/start"; procedure: string; args?: Record<string, unknown>; force?: boolean }
  /** Answer the question the running code procedure is waiting on. */
  | { type: "script/answer"; answer: string };

/** Events are fully resolved and deterministic. */
export type GameEvent =
  | { type: "player/join"; player: Player }
  /** Join a leader (or any unit) to another unit, which then moves, fights and takes damage as one. */
  | { type: "unit/attach"; id: UnitId; to: UnitId }
  /** An attached unit (`unit`) leaves the unit it joined (`id`) and is a unit of its own again. */
  | { type: "unit/detach"; id: UnitId; unit: UnitId }
  /** A reconnecting peer takes over an earlier player's seat, units and counters. */
  | { type: "player/claim"; player: PlayerId; by: PlayerId }
  | { type: "model/add"; model: Model }
  | { type: "model/move"; id: ModelId; to: Vec2; facing?: number }
  | { type: "model/remove"; id: ModelId }
  | { type: "model/wounds"; id: ModelId; woundsLost: number; destroyed: boolean }
  | { type: "unit/add"; unit: Unit; models: Model[] }
  | { type: "unit/remove"; id: UnitId }
  | { type: "unit/status"; id: UnitId; key: string; value: number | boolean | null }
  /** Run an ability as the rule read from its text (#38), or stop (null). Owner only. */
  | { type: "unit/automate"; id: UnitId; ability: string; auto: AbilityAuto | null }
  | UnitMove
  | UnitForm
  | ModelsMove
  | { type: "dice/roll"; roll: DiceRoll }
  /** `source`: the starter or library table it came from, so every player's picker can name it. */
  | { type: "layout/set"; layout: Layout; source?: TableSource }
  | { type: "player/ready"; player: PlayerId; ready: boolean }
  | { type: "ranked/card"; player: PlayerId; key: PlayerKey | null }
  | { type: "dice/commit"; player: PlayerId; hash: string }
  | { type: "dice/seed"; player: PlayerId; seed: string }
  | { type: "dice/reveal"; player: PlayerId; seed: string; next?: string }
  | { type: "ranked/result"; result: RankedResult; by: PlayerId }
  | { type: "ranked/sign"; player: PlayerId; sig: string | null; why?: DeclineWhy; decline?: string }
  | { type: "ranked/fixed"; player: PlayerId }
  | { type: "event/army"; player: PlayerId; hash: string }
  | { type: "player/rename"; player: PlayerId; name: string }
  | { type: "player/dice"; player: PlayerId; dice: DiceSet | null }
  /** A side colour, e.g. from a saved army (#27). */
  | { type: "player/color"; player: PlayerId; color: string }
  /**
   * Play this game for a campaign book (null: for none). Its armies carry over when only the hash
   * changes; `recorded` says the change is the book taking in this game's result.
   */
  /** `recorded`: the leader wrote this game in; `merged`: games from another table's copy were joined in. */
  | { type: "campaign/set"; ref: Omit<CampaignRef, "armies"> | null; recorded?: boolean; merged?: boolean }
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
  | { type: "player/army"; player: PlayerId; army: Army | null }
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
  | { type: "clock/call"; kind: string; text: string }
  /** Choose the mission: its deployment zones and objective markers replace the table's (terrain stays). */
  | {
      type: "mission/set";
      mission: { id: string; name: string } | null;
      zones: Zone[];
      objectives: Objective[];
    }
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
  /** `unit`: the unit whose go it was, when it only moved (a real table, where moves aren't on the board). */
  | { type: "turn/endActivation"; unit?: UnitId }
  | { type: "turn/first"; seat: number }
  /** Choose the game system before the battle starts. */
  | { type: "game/system"; system: string }
  | BranchEvent
  | { type: "resource/adjust"; player: PlayerId; resource: string; delta: number }
  /** A player's dice pool after a re-roll or spending dice. */
  /** `use` records a once-per-round re-roll or "ready" (state.used). */
  | { type: "pool/set"; player: PlayerId; resource: string; faces: number[]; use?: string }
  | { type: "dice/place"; player: PlayerId; unitId: UnitId; weapon: string; index: number }
  | { type: "dice/discard"; player: PlayerId; unitId: UnitId; weapon: string }
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
  /** `next`: a multiple attack's next attack, started at its target (the rest still to come). */
  | {
      type: "procedure/clear";
      end?: { run?: ProcedureRun };
      script?: ScriptStep;
      next?: { run: ProcedureRun; targetId: UnitId; more: UnitId[] };
    }
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
  | { type: "deck/discard"; player: PlayerId; deck: string; key: string }
  | { type: "deck/shuffle"; player: PlayerId; deck: string }
  | { type: "deck/remove"; id: string }
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
  | LogNote
  | CampaignAward;

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
  how?: "forward" | "back" | "sideways" | "drag" | "wheel" | "charge" | "door" | "flee" | "pursue";
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
  /**
   * `z` is the height of the base; omitted means unchanged. `via` are the
   * corners this move went round on its way (core/path.ts), added to the
   * model's legs this phase; `path` instead replaces all its corners (a move
   * pulled back along its legs).
   */
  moves: { id: ModelId; to: Vec2; z?: number; via?: Vec2[]; path?: Vec2[] }[];
  /** Set when this pulls an over-long move back to its limit, for the log. */
  snap?: number;
  /** Setting the table up (a lesson placing its units), not a move: the log leaves it out. */
  setup?: boolean;
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
      // No unit acts after Battle over, forced or not (campaign afterGame hooks have no unit and still run).
      const rounds = systemOf(state).turn.rounds;
      if (typeof intent.args?.unit === "string" && typeof rounds === "number" && state.turn.round > rounds)
        return null;
      // A code action the module says isn't available now (not this unit's go) is refused, as the UI would.
      if (!intent.force && codeActionWhy(state, intent.procedure, intent.args ?? {}, from) !== undefined)
        return null;
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
      const results = Array.from({ length: count }, () => die(rng, sides));
      const roll: DiceRoll = { by: from, sides, results };
      if (intent.faces?.length === sides) roll.faces = intent.faces;
      if (intent.label) roll.label = intent.label;
      if (intent.unitId) roll.unitId = intent.unitId;
      if (intent.targets?.length) roll.targets = intent.targets.slice(0, 20);
      return { type: "dice/roll", roll };
    }
    case "player/join":
      return intent.player.id === from ? intent : null;
    case "unit/automate": {
      const unit = state?.units[intent.id];
      if (!unit || unit.owner !== from) return null;
      return unit.sheet?.abilities.some((a) => a.name === intent.ability) ? intent : null;
    }
    case "ranked/card": {
      // Seated players only, and not once a result is up for signing.
      if (typeof state?.players[from]?.seat !== "number" || state.ranked?.result) return null;
      if (intent.key !== null && !isPlayerKey(intent.key)) return null;
      return { type: "ranked/card", player: from, key: intent.key };
    }
    case "dice/commit": {
      // A ranked game's host (the session only takes this from itself). A new host, or one that
      // lost its seed, starts afresh: the stretch it never revealed can't be checked, and says so.
      if (!state?.ranked?.keys[from] || !isSeed(intent.hash)) return null;
      return { type: "dice/commit", player: from, hash: intent.hash };
    }
    case "dice/seed": {
      const d = state?.sharedDice;
      if (!d || d.by === from || !state.ranked?.keys[from] || d.seeds[from] || !isSeed(intent.seed))
        return null;
      return { type: "dice/seed", player: from, seed: intent.seed };
    }
    case "dice/reveal": {
      const d = state?.sharedDice;
      if (!d || d.by !== from || !isSeed(intent.seed) || commitTo(intent.seed) !== d.commit) return null;
      if (intent.next !== undefined && !isSeed(intent.next)) return null;
      return {
        type: "dice/reveal",
        player: from,
        seed: intent.seed,
        ...(intent.next ? { next: intent.next } : {}),
      };
    }
    case "ranked/result": {
      // Once, after the battle, from one of the two players, and only the result the table shows.
      if (!state || !rankedOver(state) || !rankedReady(state) || state.ranked?.result) return null;
      if (state.ranked?.fixing) return null;
      if (!state.ranked?.keys[from]) return null;
      // The writer names its build; the other player checks it is theirs too before signing.
      const want = rankedResultOf(state, intent.result?.replay, intent.result?.at, intent.result?.rules?.app);
      const text = canonResult(intent.result);
      if (!want || !text || text !== canonResult(want)) return null;
      return { type: "ranked/result", result: JSON.parse(text) as RankedResult, by: from };
    }
    case "ranked/sign": {
      const r = state?.ranked;
      if (!r?.result || !r.keys[from] || from in r.sigs) return null;
      if (
        intent.sig !== null &&
        !(typeof intent.sig === "string" && /^[A-Za-z0-9+/=]{40,200}$/.test(intent.sig))
      )
        return null;
      if (intent.sig !== null) return { type: "ranked/sign", player: from, sig: intent.sig };
      const why = DECLINE_WHYS.includes(intent.why!) ? intent.why! : "broke";
      // A wrong score is fixed and signed again, a few times at most; after that it's a plain decline.
      const fix = why === "score" && (r.fixes ?? 0) < MAX_FIXES;
      const decline =
        typeof intent.decline === "string" && /^[A-Za-z0-9+/=]{40,200}$/.test(intent.decline)
          ? intent.decline
          : undefined;
      return {
        type: "ranked/sign",
        player: from,
        sig: null,
        why: fix ? "score" : why === "score" ? "broke" : why,
        ...(decline && !fix ? { decline } : {}),
      };
    }
    case "event/army":
      return typeof state?.players[from]?.seat === "number" && /^[a-f0-9]{64}$/.test(intent.hash)
        ? { type: "event/army", player: from, hash: intent.hash }
        : null;
    case "ranked/fixed": {
      const r = state?.ranked;
      return r?.fixing && r.keys[from] ? { type: "ranked/fixed", player: from } : null;
    }
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
    case "clock/call":
      return state?.players[from] &&
        typeof intent.kind === "string" &&
        /^[a-z0-9-]{1,24}$/.test(intent.kind) &&
        typeof intent.text === "string" &&
        intent.text.length > 0 &&
        intent.text.length <= 200
        ? { type: "clock/call", kind: intent.kind, text: intent.text }
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
        ...(intent.merged ? { merged: true } : {}),
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
          : faces.map((f, i) => (picked.has(i) ? die(rng, sides) : f));
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
    case "dice/place":
      if (!state || cantPlace(state, from, intent.unitId, intent.weapon, intent.index)) return null;
      return { ...intent, player: from };
    case "dice/discard": {
      const key = placedKey(intent.unitId, intent.weapon);
      if (!state?.placed?.[from]?.[key]?.length || !currentSlot(state)?.placeDice) return null;
      return { ...intent, player: from };
    }
    case "turn/next":
    case "turn/pass": {
      // A finished game stays finished: a stale peer can't start round 6 (UX 70).
      const rounds = state ? systemOf(state).turn.rounds : undefined;
      if (state && typeof rounds === "number" && state.turn.round > rounds) return null;
      return { ...intent, seed: Math.floor(rng() * 2 ** 31) };
    }
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
    case "player/army":
      return state?.players[from] ? { type: "player/army", player: from, army: intent.army } : null;
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
      if (!option?.ok && !(intent.force && option?.overridable)) return null;
      const allowed = new Set(option.commands?.candidates ?? []);
      const commanded = (intent.with ?? [])
        .filter((id) => allowed.has(id))
        .slice(0, option.commands?.count ?? 0);
      // A multiple attack: one target per attack, the first again where none (or no enemy) is named.
      const enemy = (id: UnitId | undefined) =>
        id && state.units[id] && opposed(state, state.units[id].owner, unit.owner) ? id : undefined;
      const more =
        option.repeat && intent.targetId
          ? Array.from({ length: option.repeat - 1 }, (_, i) => enemy(intent.more?.[i]) ?? intent.targetId!)
          : [];
      const taken: ActionTaken = {
        unitId: unit.id,
        action: intent.action,
        by: from,
        ...req,
        ...(more.length ? { more } : {}),
        payment: option.payment,
        ...(commanded.length ? { with: commanded } : {}),
        ...(!option.ok && option.why ? { forced: option.why } : {}),
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
        const def = systemOf(state).resources?.find((r) => r.id === resource);
        if (def?.kind === "dicePool") {
          // FSD support cards: that many dice from the pool, the ones picked or the lowest.
          const faces = state.pools?.[from]?.[resource] ?? [];
          const picked = [...new Set(intent.dice ?? [])].filter((i) => i >= 0 && i < faces.length);
          const rest = faces
            .map((f, i) => ({ f, i }))
            .filter((d) => !picked.includes(d.i))
            .sort((a, b) => a.f - b.f)
            .map((d) => d.i);
          const indices = [...picked, ...rest].slice(0, cost);
          if (indices.length < cost) return null;
          payment = cost ? [{ resource, indices }] : [];
        } else {
          if ((state.resources[from]?.[resource] ?? 0) < cost) return null;
          payment = cost ? [{ resource, amount: cost }] : [];
        }
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
      // One of its abilities, or a core rule reminded for it (`ruleReminders`).
      const rule = state && systemOf(state).ruleReminders?.some((r) => r.name === intent.ability);
      if (!unit || !(rule || unit.sheet?.abilities.some((a) => a.name === intent.ability))) return null;
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
    case "deck/discard": {
      if (!state?.decks?.some((d) => d.id === intent.deck) || !intent.key.startsWith(deckPrefix(intent.deck)))
        return null;
      if (!inHand(state, from, intent.deck).some(([k]) => k === intent.key)) return null;
      return { ...intent, player: from };
    }
    case "deck/shuffle":
      if (!state?.decks?.some((d) => d.id === intent.deck) || !state.players[from]) return null;
      return { ...intent, player: from };
    case "deck/remove":
      return state?.players[from]?.seat !== undefined && state.decks?.some((d) => d.id === intent.id)
        ? intent
        : null;
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
      const run = startActionRun(endReaction({ ...state, deferred: null }, null), pending.trigger, rng);
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
      // A multiple attack goes on at its next target (skipping any it can't attack now).
      const proc = state.procedure;
      const more = proc.run.done ? (proc.more ?? []) : [];
      for (let i = 0; i < more.length; i++) {
        const trigger = { ...proc, targetId: more[i]!, more: more.slice(i + 1) };
        const run = startActionRun(cleared, trigger, rng);
        if (run)
          return {
            type: "procedure/clear",
            next: { run, targetId: more[i]!, more: trigger.more },
            ...script,
          };
      }
      if (!reactionOver(cleared)) return { type: "procedure/clear", ...script };
      const run = state.pending
        ? startActionRun(endReaction({ ...cleared, deferred: null }, null), state.pending.trigger, rng)
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
