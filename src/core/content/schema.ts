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
  /** Whether a characteristic or value is present (not "-" or missing), e.g. a damage chart. */
  | { has: Ref }
  /** Whether two refs name the same thing (by id), e.g. the event's target is this unit. */
  | { same: [Ref, Ref] }
  /** Quantifiers over a collection such as "self.unit.models" or "enemy.units". */
  | { every: Ref; as: string; test: Expr }
  | { some: Ref; as: string; test: Expr }
  | { count: Ref; as?: string; where?: Expr }
  /** Engine-computed geometry. */
  | { query: GeoQuery }
  /**
   * A pure function from the system's code module. Each arg is evaluated;
   * a bare `{ ref }` arg passes what it names (a unit, a model) as is.
   */
  | { call: Id; args?: Expr[] };

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
  /**
   * Whether `subject` is within (or wholly within) an area: "terrain.<category>",
   * "zone.own", "zone.enemy" or "zone.<seat>".
   */
  | { kind: "inArea"; subject: Ref; area: Ref; wholly?: boolean }
  /** Terrain categories crossed by the line between two things, e.g. "dense". */
  | { kind: "crosses"; from: Ref; to: Ref; terrainCategory: Id }
  /** Height of `from` above `to`, in the system's distance unit (like distance). */
  | { kind: "elevation"; from: Ref; to: Ref }
  /**
   * Whether `to` is in cover from `from`: some model of `to` that `from` can
   * see stands in or touches terrain whose category gives cover, or is seen
   * past an obscuring piece. Categories come from the system's `terrain`.
   */
  | { kind: "cover"; from: Ref; to: Ref };

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
  /**
   * Activate other units for free, e.g. FSD's Command value: the player picks
   * up to `count` friendly units matching `filter` (the candidate is "it").
   */
  | { do: "activate"; count: Expr; filter?: Expr }
  /**
   * Roll on a damage track for each input (FSD's damage chart, a vehicle
   * damage table). `chart` is text such as "1:red, 2-3:orange:ARM, 4:white:MOV,
   * 5-6:white:PIN": faces, then the box colour, then its effect. A red box
   * destroys the unit; an orange box destroys it when hit a second time; a
   * white box applies its effect. The effect becomes a unit status
   * "damage<effect>" (damageMOV), so statuses can change characteristics.
   * Every roll also applies `status` (pinned) when given.
   */
  | { do: "damageTrack"; target: Ref; chart: Ref; die?: number; status?: Id }
  /** Not automated yet. The reminder text is supplied by the player's pack, never the repo. */
  | { do: "manual"; reminder: string }
  /**
   * Start one of the system module's code procedures once this procedure is
   * done. A bare `{ ref }` arg passes the id of the unit or model it names.
   */
  | { do: "script"; procedure: Id; args?: Record<string, Expr> };

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
  params?: { id: Id; type: "number" | "dice" | "keyword" | "text"; default?: Value }[];
  /**
   * How imported content names this rule: a case-insensitive regular
   * expression tried against weapon keywords ("Sustained Hits 2") or, for
   * model and unit rules, ability names and text. Named groups fill params,
   * e.g. "^sustained hits\\s*(?<x>d?\\d+)?$". Lets the engine map BSData
   * keywords to rules without shipping any rules text.
   */
  match?: string;
  /** What it attaches to, for validation and UI grouping. */
  appliesTo?: ("weapon" | "model" | "unit" | "army")[];
  effects: Effect[];
  /** Player-supplied description shown in the UI. Never shipped in the repo. */
  text?: string;
}

export interface RuleRef {
  rule: Id;
  params?: Record<string, Value | Keyword>;
  /** The rule itself, for one made on the player's device (an automated ability). */
  def?: RuleDef;
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

export type Step = StepKind & {
  /** Run the step only when this holds, e.g. only if the target chose to stand and shoot. */
  if?: Expr;
};

export type StepKind =
  /**
   * Produce a number of dice to test, e.g. the weapon's attacks. With `each`,
   * `count` is summed over a collection (every model carrying the weapon),
   * with the item bound as `as` and filtered by `where` (in range). The items
   * kept are available to later steps as "step.<id>.members".
   */
  | { kind: "pool"; id: Id; count: Expr; each?: Ref; as?: string; where?: Expr }
  /** Roll one die per input success and compare with a target number. */
  | {
      kind: "test";
      id: Id;
      /** Which step's successes feed this one; defaults to the previous step. */
      from?: Id;
      /** A die id, or an expression for its size (FSD's d8 stepped up to d10). */
      die?: Id | Expr;
      /**
       * Dice rolled per input, keeping one (FSD saves roll d10(2), keep the
       * highest). The input die's own result is available as "input.value",
       * so opposed rolls can use it as the target.
       */
      dicePerInput?: Expr;
      keep?: "highest" | "lowest";
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
      /** The unit whose models take the hits; defaults to "target". */
      unit?: Ref;
      /** Models with equal values here form one allocation group. */
      groupBy?: Ref[];
      /** Expression giving sort priority; lower goes first. */
      order?: Expr;
      /** Formations: remove casualties from the rear rank, front stays full. */
      formation?: "rearRankFirst";
    }
  /** Turn input successes into lost wounds. */
  /** `minAmount`: no attack does less than this after modifiers (40k: 1). */
  | { kind: "damage"; id: Id; amount: Expr; spillover: boolean; minAmount?: number }
  /** Compare two totals and branch, e.g. combat resolution. */
  | { kind: "compare"; id: Id; a: Expr; b: Expr; outcomes: { when: Expr; do: EffectAction[] }[] }
  /**
   * Free-form actions, e.g. apply a status after a failed test. Runs only
   * when something reached it (a failed test passes its failures on), or
   * when no pool came before it.
   */
  | { kind: "do"; id: Id; do: EffectAction[] }
  /**
   * A pause in which another player may react before the procedure goes on,
   * e.g. The Old World's charge reactions or a dispel attempt. The procedure
   * waits for `side` to pick one of `options` (or one of the actions whose
   * `reactTo` names this window) or pass. The answer is available to later
   * steps as "reaction.<id>" (the option id, or "pass").
   */
  | {
      kind: "window";
      id: Id;
      side: "attacker" | "defender" | "active" | "opponent";
      options?: { id: Id; label: string }[];
      /** Answer used when nobody is asked (hotseat auto-play, previews). */
      default?: Id;
    };

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
  | {
      kind: "phase";
      id: Id;
      name: string;
      actions?: Id[];
      segments?: Segment[];
      /** Players may place pool dice on their cards' slots here (FSD pre-assigning and cleanup). */
      placeDice?: boolean;
    }
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
  /** Player actions (stratagems): the phases it can be used in; any phase if omitted. */
  phases?: Id[];
  /** A short summary in the system author's own words, shown on the button. */
  hint?: string;
  /** How the log says it, after the unit's name: "marches", "takes aim". */
  verb?: string;
  /**
   * Conditions that rule it out, each with the reason players see, checked
   * before `if` (whose failure only says "Not allowed now").
   */
  notWhen?: { if: Expr; why: string }[];
  /**
   * Taking it starts the unit's activation (FSD: spend a die to activate, or
   * to react), after which the unit may take this many of the current slot's
   * other actions. Units without an activation take actions freely (40k).
   */
  activates?: Expr;
  /**
   * Taken as part of another action, without using one of the activation's
   * actions (Conquest's Impact attacks come with the charge).
   */
  free?: boolean;
  /** Out-of-sequence actions that respond to an event (overwatch, reactions). */
  reactTo?: EventPattern;
  /** Eligibility, evaluated against the acting unit or player. */
  if?: Expr;
  /**
   * Resources spent. For dice pools, `slots` restricts which faces can pay,
   * one entry per die (FSD: a slot marked 4-6 takes one die showing 4 to 6).
   */
  cost?: {
    resource: Id;
    amount: Expr;
    slots?: { min: number; max: number }[];
    /** Slots read from content, e.g. "weapon.slots" holding "4-6" or "1-2 1-2". */
    slotsFrom?: Ref;
  }[];
  limit?: { count: number; per: "phase" | "turn" | "round" | "battle"; perUnit?: boolean };
  /** A player action with no fixed effect: the player names it and its cost (a faction stratagem). */
  custom?: boolean;
  /** A player action taken instead of an activation: only between activations, and the turn passes (FSD support cards). */
  endsTurn?: boolean;
  /** Who or what the action targets, chosen by the player. */
  target?: { filter: Expr; count?: number };
  /** A movement, measured by the engine and checked against `distance`. */
  move?: { kind: Id; distance: Expr };
  /** A dice procedure to run, e.g. the attack sequence per weapon. */
  procedure?: Id;
  do?: EffectAction[];
  /** Flags set on the acting unit afterwards, e.g. "advanced". */
  sets?: Id[];
  /**
   * Prepares the weapon's action (FSD prepared actions): the unit gets the
   * flag "prepared.<weapon>", a token that stays until it is used or cleared.
   */
  prepares?: boolean;
  /**
   * For actions taken with a weapon: which weapons it is for (FSD: Fire for
   * ordinary special actions, Prepare for those marked prepared). All if omitted.
   */
  forWeapons?: Expr;
}

// ---------------------------------------------------------------------------
// The game system
// ---------------------------------------------------------------------------

export interface CharacteristicDef {
  id: Id;
  name: string;
  of: "model" | "weapon" | "unit";
  /** "target" values are dice targets such as 3+; "distance" is in the system's unit; "text" is kept as written. */
  type: "number" | "target" | "distance" | "dice" | "text";
  /** A short column header when the id isn't one, e.g. "AD" for slots. */
  short?: string;
  /** Display format, e.g. '{v}"' or "{v}+". */
  format?: string;
  /** Other names imported data uses for it, e.g. ["SV", "Save"] or ["BS", "WS"]. */
  aliases?: string[];
  /** Value when missing or unreadable ("-"); null if omitted. */
  default?: Value;
  /**
   * A regular expression whose first group is the value, for characteristics
   * printed together: FSD's Save "d8(2)" gives the save die with "d(\\d+)"
   * and the number of dice with "\\((\\d+)\\)".
   */
  pattern?: string;
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
  /** What it means for the unit, shown on its card while it holds ("can't declare a charge"). */
  hint?: string;
}

export interface ResourceDef {
  id: Id;
  name: string;
  on: "player" | "unit";
  initial: Expr;
  max?: Expr;
  /** Dice pools keep the rolled faces (dice-placement games). */
  kind?: "counter" | "dicePool";
  /** A short label for costs, e.g. "CP". */
  short?: string;
  /** Faces of the dice in a pool (default 6). */
  sides?: number;
  /** A pool players may re-roll dice from once per reset, before marking themselves ready (FSD). */
  rerollOnce?: boolean;
  /** Back to `initial` (a pool emptied) at the start of each player turn or round. */
  reset?: "playerTurn" | "round";
  /**
   * Dice in the whole pool (FSD's AD Pool): dice still placed on cards count
   * against it, so a roll takes fewer when many are placed.
   */
  total?: number;
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
  /** Models in or touching it are in cover (see the "cover" query). */
  cover?: boolean;
  /** Only these unit keywords get its cover, e.g. ["INFANTRY"]. */
  coverFor?: Keyword[];
  /** How it blocks sight in "footprint" line of sight. */
  visibility?: "open" | "obscuring" | "blocking";
  effects?: Effect[];
}

export interface GameSystem {
  id: Id;
  name: string;
  version: string;
  /**
   * Any unit may start in reserves (not only those with a deep strike rule),
   * arriving at least `distance` (in the system's unit) from enemies.
   */
  reserves?: { distance: number };
  /** Distance unit. FSD uses a configurable "DU" worth some number of inches. */
  units: "inch" | "cm" | { name: string; inches: number };
  defaultTable?: Table;
  dice: DieDef[];
  /** Default die for tests that don't name one. */
  defaultDie: Id;
  /** Die sizes in order, for "step up / step down a die" rules. */
  dieLadder?: Id[];
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
  /** Named numbers such as engagement range, available as "const.<id>". */
  constants?: Record<Id, number>;
  /**
   * Unit flags cleared at the start of each player turn (for that player's
   * units), each round, or the end of each activation (for everyone), e.g.
   * "moved" or "activated". A trailing "*" clears every flag with that prefix.
   */
  resets?: { at: "phase" | "playerTurn" | "round" | "activation"; flags: Id[] }[];
  /**
   * When imported abilities the engine doesn't automate matter, read from
   * their text, so the right ones are put in front of players at the right
   * moment with a manual-apply button. Per phase, the first matching entry wins.
   */
  abilityTimings?: AbilityTiming[];
  /** Table settings this system plays with by default, e.g. { los: "footprint" }. */
  settings?: Record<string, unknown>;
}

export interface AbilityTiming {
  /** Case-insensitive regular expression tried against the ability's text. */
  match: string;
  /** A phase id, or "deployment" for before the first battle round. */
  phase?: Id;
  /** Whose turn, relative to the ability's owner. */
  side?: "active" | "inactive" | "either";
  /** Shown during an attack the unit makes ("attacker") or receives ("defender"). */
  attack?: "attacker" | "defender";
  /** Only for attacks of this weapon kind, e.g. "melee". */
  weaponKind?: Id;
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
