/**
 * Rules as data.
 *
 * The engine knows about tables, bases, inches, dice, events and expressions.
 * Everything game-specific is data, in two layers:
 *
 *  - A GameSystem describes how a game works: its characteristics, dice tests,
 *    turn structure, statuses, resources, actions, keyword rules and advisory
 *    checks. One system per game (40k, The Old World, Conquest, ...).
 *  - A ContentPack holds units, models and weapons for a system, imported at
 *    runtime (converted from BSData or written by hand). A Roster is one
 *    player's army, chosen from packs.
 *
 * Nothing here ships rules text, stats or points. Packs are plain JSON so they
 * can be saved, shared and sent to peers. Rule checks are advisory: they warn,
 * players decide.
 */

import type { BaseShape, Table } from "../types";

export type Id = string;
/** A plain tag such as "INFANTRY" or "FLY". Matching is case-insensitive. */
export type Keyword = string;
/** A dice expression as printed, e.g. "D6+1" or "2D3". Parsed with parseDice. */
export type DiceText = string;
/** A characteristic value: a number, a dice expression, or null for "-". */
export type Value = number | DiceText | null;

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

/**
 * A path into the evaluation context, e.g. "weapon.S", "target.T",
 * "param.x", "step.hit.successes", "self.wounds". Roles available depend on
 * where the expression runs; see EvalContext in expr.ts.
 */
export type Ref = string;

/** Small JSON expression language, evaluated by the engine. */
export type Expr =
  | number
  | boolean
  | { ref: Ref }
  | { dice: DiceText | Expr }
  | { op: "+" | "-" | "*" | "/" | "min" | "max" | "floor" | "ceil" | "half"; args: Expr[] }
  | { cmp: ">=" | ">" | "<=" | "<" | "==" | "!="; a: Expr; b: Expr }
  | { all: Expr[] }
  | { any: Expr[] }
  | { not: Expr }
  | { if: Expr; then: Expr; else: Expr }
  /** First matching case wins. */
  | { cases: { when: Expr; then: Expr }[]; else: Expr }
  /** Lookup in a GameSystem table, e.g. an attacker-vs-defender chart. */
  | { table: Id; row: Expr; col?: Expr }
  /** `keyword` may come from a rule parameter, e.g. { ref: "param.keyword" }. */
  | { hasKeyword: Ref; keyword: Keyword | { ref: Ref } }
  /** Text equality, e.g. { is: "event.step", value: "hit" }. */
  | { is: Ref; value: string }
  | { hasStatus: Ref; status: Id }
  | { hasFlag: Ref; flag: Id }
  /** Quantifiers over a collection such as "self.unit.models" or "enemy.units". */
  | { every: Ref; as: string; test: Expr }
  | { some: Ref; as: string; test: Expr }
  | { count: Ref; as?: string; where?: Expr }
  /** Engine-computed geometry. */
  | { query: GeoQuery };

export type GeoQuery =
  /** Inches between two things (models, units, terrain, points). */
  | {
      kind: "distance";
      from: Ref;
      to: Ref;
      /** Base edge to base edge (40k), or centre to centre. */
      measure?: "baseEdge" | "centre";
      axis?: "horizontal" | "vertical" | "3d";
    }
  /** Line of sight; "fully" means every part facing the observer is visible. */
  | { kind: "visible"; from: Ref; to: Ref; fully?: boolean }
  /** Whether `to` lies in one of `from`'s arcs (front, flank, rear...). */
  | { kind: "inArc"; from: Ref; to: Ref; arc: Id }
  /** Whether `subject` is within (or wholly within) a terrain piece or zone. */
  | { kind: "inArea"; subject: Ref; area: Ref; wholly?: boolean }
  /** Terrain categories crossed by the line between two things, e.g. "dense". */
  | { kind: "crosses"; from: Ref; to: Ref; terrainCategory: Id }
  /** Height of `from` above `to`, in inches. */
  | { kind: "elevation"; from: Ref; to: Ref };

// ---------------------------------------------------------------------------
// Effects: "when <event>, if <condition>, do <actions>"
// ---------------------------------------------------------------------------

/**
 * Events the engine emits. `event` is one of the engine's event names, and
 * `where` filters on the event's payload (available as "event.*").
 *
 * Engine events: "always" (continuous effects), "round.start", "round.end",
 * "turn.start", "turn.end", "segment.start", "segment.end" (payload: segment
 * id), "activation.start", "activation.end", "action.declared",
 * "action.resolved" (payload: action id), "step.before", "step.after"
 * (payload: procedure and step ids), "die.result" (one die in a test: value,
 * natural, critical, success), "move.end" (payload: move kind),
 * "unit.setup", "model.destroyed", "unit.destroyed", "status.applied",
 * "status.removed".
 */
export interface EventPattern {
  event: string;
  where?: Expr;
}

/** Who an effect applies to, relative to the unit or model that owns it. */
export type Scope =
  | { kind: "self" }
  | { kind: "unit" }
  /** The unit this model is attached to or leading. */
  | { kind: "attachedUnit" }
  | { kind: "aura"; range: Expr; filter?: Expr; includeSelf?: boolean }
  | { kind: "army"; filter?: Expr }
  | { kind: "player" }
  /** Whatever the triggering event names, e.g. the attack's target. */
  | { kind: "eventSubject"; ref: Ref };

export type Duration = "instant" | "phase" | "turn" | "round" | "battle" | { until: EventPattern };

export interface Effect {
  /** For logs and once-per limits. */
  id?: Id;
  when: EventPattern;
  if?: Expr;
  scope?: Scope;
  /** "You can..." effects ask the owning player first. */
  optional?: boolean;
  limit?: { count: number; per: "phase" | "turn" | "round" | "battle" };
  do: EffectAction[];
  /** Player picks one option ("select one of the following"). */
  choose?: { by: "owner" | "opponent"; options: { label: string; do: EffectAction[] }[] };
  duration?: Duration;
}

export type EffectAction =
  /** Change the current die result in a test (e.g. +1 to hit). Capped by the step. */
  | { do: "modifyRoll"; by: Expr }
  /** Change the target number of the current test instead of the roll. */
  | { do: "modifyTarget"; by: Expr }
  | { do: "reroll"; which: "ones" | "failed" | "any" | { values: number[] } }
  /** Lower the natural roll that counts as a critical (e.g. 5+). */
  | { do: "criticalOn"; value: Expr }
  /** Add extra successes to this step's output (e.g. sustained hits). */
  | { do: "addSuccesses"; count: Expr; tag?: string }
  /** This success skips straight past a later step (e.g. auto-wound). */
  | { do: "autoPass"; step: Id }
  /**
   * On "die.result": this success bypasses a later step (no saves allowed).
   * On "step.before": the step is skipped and all input passes (auto-hit).
   */
  | { do: "skipStep"; step: Id }
  | { do: "modifyCharacteristic"; target?: Ref; characteristic: Id; by: Expr }
  | { do: "setCharacteristic"; target?: Ref; characteristic: Id; to: Expr }
  | { do: "grantKeyword"; target?: Ref; keyword: Keyword }
  | { do: "grantRule"; target?: Ref; rule: RuleRef }
  | { do: "applyStatus"; target?: Ref; status: Id; duration?: Duration }
  | { do: "removeStatus"; target?: Ref; status: Id }
  /** Eligibility flags consulted by checks, e.g. "canChargeAfterFallBack". */
  | { do: "setFlag"; target?: Ref; flag: Id; value: boolean }
  | { do: "gainResource"; resource: Id; amount: Expr; player?: "owner" | "opponent" }
  | { do: "spendResource"; resource: Id; amount: Expr; player?: "owner" | "opponent" }
  /** Damage that bypasses the normal test chain (e.g. mortal wounds). */
  | { do: "inflictDamage"; target: Ref; amount: Expr; kind?: Id }
  /** Roll a die per wound lost and ignore it on `atLeast` or more (feel no pain). */
  | { do: "ignoreDamage"; atLeast: Expr }
  /** Roll and branch on the result: "on a 1, ...; on a 2-5, ...". */
  | { do: "roll"; dice: DiceText; outcomes: { min: number; max: number; do: EffectAction[] }[] }
  /** Run a system procedure or offer an action, e.g. "can make a Normal move". */
  | { do: "run"; action: Id; with?: Record<string, Expr>; optional?: boolean }
  /** Not automated yet. The reminder text is supplied by the player's pack, never the repo. */
  | { do: "manual"; reminder: string };

// ---------------------------------------------------------------------------
// Rules: named, parameterised bundles of effects
// ---------------------------------------------------------------------------

/**
 * A rule such as a weapon keyword ("sustained hits X"), a unit ability
 * ("deep strike"), or a faction rule. Systems define the core ones; packs add
 * their own. Content refers to them with a RuleRef.
 */
export interface RuleDef {
  id: Id;
  name: string;
  params?: { id: Id; type: "number" | "dice" | "keyword" | "text" }[];
  /** What it attaches to, for validation and UI grouping. */
  appliesTo?: ("weapon" | "model" | "unit" | "army")[];
  effects: Effect[];
  /** Player-supplied description shown in the UI. Never shipped in the repo. */
  text?: string;
}

export interface RuleRef {
  rule: Id;
  params?: Record<string, Value | Keyword>;
}

// ---------------------------------------------------------------------------
// Procedures: dice pipelines such as an attack sequence
// ---------------------------------------------------------------------------

/**
 * An ordered pipeline. Each step reads the previous step's output (a list of
 * dice with success/critical tags) and produces its own. Effects hook in via
 * "step.before" / "step.after" / "die.result" events.
 */
export interface Procedure {
  id: Id;
  name: string;
  /** Named inputs, e.g. attacker, weapon, target. */
  params?: Id[];
  steps: Step[];
}

export type Step =
  /** Produce a number of dice to test, e.g. the weapon's attacks. */
  | { kind: "pool"; id: Id; count: Expr }
  /** Roll one die per input success and compare with a target number. */
  | {
      kind: "test";
      id: Id;
      /** Which step's successes feed this one; defaults to the previous step. */
      from?: Id;
      die?: Id;
      /** Roll-high ("atLeast": 3+) or roll-under ("atMost": 3 or less). */
      compare: "atLeast" | "atMost";
      target: Expr;
      /** Null means the test cannot be passed (e.g. no save possible). */
      impossibleIf?: Expr;
      /** Natural results that always fail or always succeed. */
      alwaysFail?: number[];
      alwaysPass?: number[];
      /** Natural results that are critical (default none). */
      criticalOn?: Expr;
      /** Roll this many dice and total them as one test (2D6 leadership). */
      sumOf?: Expr;
      /** Cap on the summed roll modifier, e.g. 1 for "±1 at most". */
      modifierCap?: number;
      /** Who rolls. */
      roller: "attacker" | "defender" | "owner" | "active" | "opponent";
      /**
       * What goes on to the next step. Saves pass on their failures. Morale
       * tests that add wounds (Conquest resolve) pass on the input plus failures.
       */
      passOn?: "successes" | "failures" | "inputPlusFailures";
      /**
       * Targets above the die's maximum (The Old World's 7+): roll the max,
       * then a follow-up test for each success.
       */
      overflow?: { followUp: Expr };
    }
  /** The defending player sorts input successes onto models or groups. */
  | {
      kind: "allocate";
      id: Id;
      chooser: "attacker" | "defender";
      /** Models with equal values here form one allocation group. */
      groupBy?: Ref[];
      /** Expression giving sort priority; lower goes first. */
      order?: Expr;
      /** Formations: remove casualties from the rear rank, front stays full. */
      formation?: "rearRankFirst";
    }
  /** Turn input successes into lost wounds. */
  | { kind: "damage"; id: Id; amount: Expr; spillover: boolean }
  /** Compare two totals and branch, e.g. combat resolution. */
  | { kind: "compare"; id: Id; a: Expr; b: Expr; outcomes: { when: Expr; do: EffectAction[] }[] }
  /** Free-form actions, e.g. apply a status after a failed test. */
  | { kind: "do"; id: Id; do: EffectAction[] };

// ---------------------------------------------------------------------------
// Turn structure and actions
// ---------------------------------------------------------------------------

/**
 * How a battle round is sequenced. Segments nest, which covers:
 *  - 40k / The Old World: each player in turn runs a fixed list of phases;
 *  - Conquest: players secretly order a command stack, then alternate
 *    activating from it;
 *  - Full Spectrum Dominance: alternate spending activation dice on units,
 *    with reactions between.
 */
export interface TurnStructure {
  rounds: Expr;
  /** Who goes first each round. */
  initiative?: "fixed" | "rollOff" | { expr: Expr };
  round: Segment[];
}

export type Segment =
  /** A named window in which listed actions are available. */
  | { kind: "phase"; id: Id; name: string; actions?: Id[]; segments?: Segment[] }
  /** Each player takes a full turn of the nested segments (IGOUGO). */
  | { kind: "playerTurns"; segments: Segment[] }
  /**
   * Players alternate activations until both pass or run out. Each
   * activation runs `activation` for one chosen thing from `pool`.
   */
  | {
      kind: "alternate";
      id: Id;
      pool: ActivationPool;
      activation: Segment[];
      /** Actions allowed per activation (Conquest: two). */
      actionsPerActivation?: Expr;
    }
  /** Secret simultaneous planning, e.g. ordering a command stack. */
  | { kind: "plan"; id: Id; produces: Id; of: "units" | "cards" }
  /** A single step with automatic actions, e.g. gain command points. */
  | { kind: "step"; id: Id; do: EffectAction[] };

export type ActivationPool =
  /** Eligible units; `order` sorts them highest first (e.g. initiative). */
  | { kind: "units"; filter?: Expr; order?: Expr }
  /** A list produced by a "plan" segment, used in order. */
  | { kind: "planned"; plan: Id }
  /** Spend a resource to activate any eligible unit. */
  | { kind: "resource"; resource: Id; filter?: Expr };

/**
 * Something a player can choose to do: move, shoot, charge, a stratagem, a
 * mission action, a reaction. Costs, eligibility and timing are data.
 */
export interface ActionDef {
  id: Id;
  name: string;
  /** Unit actions are taken by a unit; player actions by the player (stratagems). */
  by: "unit" | "player";
  /** Which side may use it. */
  side?: "active" | "inactive" | "either";
  /** Out-of-sequence actions that respond to an event (overwatch, reactions). */
  reactTo?: EventPattern;
  /** Eligibility, evaluated against the acting unit or player. */
  if?: Expr;
  cost?: { resource: Id; amount: Expr }[];
  limit?: { count: number; per: "phase" | "turn" | "round" | "battle"; perUnit?: boolean };
  /** Who or what the action targets, chosen by the player. */
  target?: { filter: Expr; count?: number };
  /** A movement, measured by the engine and checked against `distance`. */
  move?: { kind: Id; distance: Expr };
  /** A dice procedure to run, e.g. the attack sequence per weapon. */
  procedure?: Id;
  do?: EffectAction[];
  /** Flags set on the acting unit afterwards, e.g. "advanced". */
  sets?: Id[];
}

// ---------------------------------------------------------------------------
// The game system
// ---------------------------------------------------------------------------

export interface CharacteristicDef {
  id: Id;
  name: string;
  of: "model" | "weapon" | "unit";
  /** "target" values are dice targets such as 3+; "distance" is inches. */
  type: "number" | "target" | "distance" | "dice";
  /** Display format, e.g. '{v}"' or "{v}+". */
  format?: string;
}

export interface DieDef {
  id: Id;
  /** Numbered faces 1..sides, or custom faces (symbols or values). */
  sides?: number;
  faces?: (number | string)[];
}

/**
 * How a unit's models are arranged; mirrors the core `Formation`. Skirmish
 * units move model by model and are kept together by coherency checks.
 * Ranked units move as one block of ranks and files with a facing.
 */
export type UnitShape =
  | { kind: "skirmish" }
  | {
      kind: "ranked";
      /** Files (models per rank) the player may choose, within these bounds. */
      minFiles?: Expr;
      maxFiles?: Expr;
      /** Moves the engine offers for ranked units. */
      manoeuvres?: ("wheel" | "reform" | "turn" | "march")[];
    };

/** An arc measured from a model or formation's facing, in degrees. */
export interface ArcDef {
  id: Id;
  name: string;
  /** Start and end angles, 0 = straight ahead, clockwise. */
  from: number;
  to: number;
  /** Whether lines are drawn from the base corners (rank-and-flank) or the centre. */
  origin: "centre" | "baseCorners";
}

export interface StatusDef {
  id: Id;
  name: string;
  on: "model" | "unit" | "player";
  /** Derived statuses are recomputed from the table, e.g. engaged. */
  derived?: Expr;
  /** Effects while the status holds, e.g. objective control becomes 0. */
  effects?: Effect[];
}

export interface ResourceDef {
  id: Id;
  name: string;
  on: "player" | "unit";
  initial: Expr;
  max?: Expr;
  /** Dice pools keep the rolled faces (dice-placement games). */
  kind?: "counter" | "dicePool";
}

/** An advisory rule check. Breaking it warns; it never blocks. */
export interface CheckDef {
  id: Id;
  name: string;
  when: EventPattern;
  if?: Expr;
  require: Expr;
  /** Shown when `require` is false. Written by the pack author. */
  message: string;
  severity?: "info" | "warning";
}

export interface TableDef {
  id: Id;
  /** Row and column headers; lookups pick the nearest header at or below the value. */
  rows: number[];
  cols?: number[];
  values: (number | null)[][];
}

export interface TerrainCategoryDef {
  id: Id;
  name: string;
  blocksMovement?: boolean;
  blocksSight?: boolean;
  effects?: Effect[];
}

export interface GameSystem {
  id: Id;
  name: string;
  version: string;
  units: "inch" | "cm";
  defaultTable?: Table;
  dice: DieDef[];
  /** Default die for tests that don't name one. */
  defaultDie: Id;
  characteristics: CharacteristicDef[];
  /** Kinds of weapon, e.g. "ranged" and "melee". */
  weaponKinds: Id[];
  unitShape: UnitShape;
  arcs?: ArcDef[];
  tables?: TableDef[];
  statuses?: StatusDef[];
  resources?: ResourceDef[];
  terrain?: TerrainCategoryDef[];
  rules: RuleDef[];
  procedures: Procedure[];
  actions: ActionDef[];
  turn: TurnStructure;
  checks?: CheckDef[];
  /** Effects that always apply, e.g. core rules not tied to a keyword. */
  coreEffects?: Effect[];
}

// ---------------------------------------------------------------------------
// Content packs and rosters
// ---------------------------------------------------------------------------

export interface ContentPack {
  id: Id;
  name: string;
  version: string;
  /** The GameSystem this pack is for. */
  system: Id;
  /** Where the data came from, e.g. a BSData catalogue and revision. */
  source?: string;
  units: Record<Id, UnitDef>;
  models: Record<Id, ModelDef>;
  weapons: Record<Id, WeaponDef>;
  /** Faction rules, abilities and stratagems not in the core system. */
  rules?: RuleDef[];
  actions?: ActionDef[];
}

export interface UnitDef {
  id: Id;
  name: string;
  keywords: Keyword[];
  /** Model types and how many of each the unit may contain. */
  models: { model: Id; min: number; max: number }[];
  rules: RuleRef[];
  shape?: UnitShape;
  /** Units this one may join, e.g. a leader attaching to a squad. */
  attachesTo?: { units: Id[]; as: Id }[];
}

export interface ModelDef {
  id: Id;
  name: string;
  keywords?: Keyword[];
  characteristics: Record<Id, Value>;
  /** Same shape as the core model's base: round, oval or rect, in millimetres. */
  base: BaseShape;
  /** Figures on a multi-figure stand (FSD infantry teams, Conquest stands). */
  figures?: number;
  /** Weapons carried by default; rosters may change them. */
  weapons: Id[];
  rules?: RuleRef[];
  /** Optional 3D asset supplied by the player. */
  mesh?: string;
}

export interface WeaponDef {
  id: Id;
  name: string;
  kind: Id;
  characteristics: Record<Id, Value>;
  rules: RuleRef[];
}

/** One player's army, resolved from list-building choices. */
export interface Roster {
  name: string;
  system: Id;
  packs: Id[];
  units: RosterUnit[];
}

export interface RosterUnit {
  id: Id;
  unit: Id;
  models: { model: Id; count: number; weapons?: Id[] }[];
  /** Extra rules from list building, e.g. enhancements. */
  rules?: RuleRef[];
  attachedTo?: Id;
}
