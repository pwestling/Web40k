import type { BranchInfo } from "./branch";
import type { Effect } from "./content/schema";
import type { Secrets } from "./secrets";

/**
 * Core game-state types. Everything in `src/core` is pure TypeScript with no
 * DOM, three.js or networking imports, so it can be unit tested and run
 * identically on every peer.
 *
 * Units: positions are in inches (1 world unit = 1"), matching how 40k
 * measures everything. Base sizes stay in millimetres because that is how
 * bases are specified.
 */

import type { AttackState } from "./attack";
import type { Outcome, ProcedureRun } from "./content/runner";
import type { ScriptState } from "./script";
import type { ClockSettings } from "./clock";

export type PlayerId = string;
export type ModelId = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  /** Table side: 0 sits at the +y edge, 1 at the -y edge. */
  seat?: number;
  /** Says it has finished deploying (advisory: the battle can start without it). */
  ready?: boolean;
  /** Playing without some of the game's rules packages (hashes), by choice: their table may disagree. */
  rulesMismatch?: string[];
  /** The player's own dice (PX-5b); without it, dice in the player's colour. */
  dice?: DiceSet;
}

/** How a player's dice look in the tray: body and pip colours (CSS), and a finish. */
export interface DiceSet {
  body: string;
  pip: string;
  finish: "solid" | "translucent" | "marbled" | "metallic";
}

/**
 * Characteristics as printed: name to text, e.g. { M: '6"', T: "4", SV: "3+" }.
 * The game system decides what each name means; the engine just stores them.
 */
export type Characteristics = Record<string, string>;

/** A weapon profile. Multi-profile weapons are one entry per profile. */
export interface WeaponProfile {
  id: string;
  name: string;
  kind: "ranged" | "melee";
  chars: Characteristics;
  keywords: string[];
}

/** A named rule or ability with the player-supplied text. Never shipped in the repo. */
export interface Ability {
  name: string;
  text: string;
  /** Set once the player confirms the rule proposed from the text. */
  auto?: AbilityAuto;
  /** Heading the unit card lists it under, e.g. "Mount and crew", "Magic items", "Special rules". */
  group?: string;
}

/**
 * An ability the player chose to automate: effects proposed from its text on
 * their own device (src/systems/wh40k/recognize.ts) and confirmed by them.
 * The rule runs as the unit's own while the conditions here hold.
 */
/** One thing an automated ability does, as the recognizer read it. */
export type AutoPart =
  | {
      kind: "attack";
      /** Its own attacks, or attacks that target it. */
      side: "making" | "targeted";
      weapon?: "ranged" | "melee";
      /** Only against targets with these keywords (any of them). */
      against?: string[];
      when?: "charged" | "stationary";
      roll?: "hit" | "wound" | "save" | "damage";
      reroll?: "ones" | "failed";
      /** A roll modifier; on "damage" it changes the attack's Damage characteristic (never below 1). */
      by?: number;
      /** A weapon ability its attacks gain, e.g. "Lethal Hits". */
      grant?: string;
    }
  | { kind: "fnp"; x: number }
  | { kind: "gain"; resource: string; amount: number }
  | { kind: "heal"; amount: string };

/** An automated ability that ran at the start or end of a phase. */
export interface Triggered {
  unitId: string;
  ability: string;
  gained?: { resource: string; amount: number };
  /** Wounds regained, and the roll when it was a dice amount. */
  healed?: { wounds: number; roll?: number };
}

export interface AbilityAuto {
  /** What the rule does, as read from the text; the app words it in the reader's language. */
  parts: AutoPart[];
  /** The rule the parts compile to. */
  effects: Effect[];
  /** Only while this unit has a leader attached (the leader's "while leading" abilities). */
  whileLeading?: boolean;
  /** Given to other units within range instead of this one. */
  aura?: { range: number; side: "friendly" | "enemy"; keyword?: string };
  /** Used by the player from the unit card; then runs until the end of the phase. */
  oncePerBattle?: boolean;
  /** At the start of a phase of its owner's turn (or each turn with `anyTurn`). */
  trigger?: {
    phase: string;
    at: "start" | "end";
    anyTurn?: boolean;
    gain?: { resource: string; amount: number };
    /** Wounds one model regains: a number or dice text such as "D3". */
    heal?: string;
  };
}

/**
 * A faction or detachment stratagem from the player's roster (#49). Its
 * text is the player's; the cost, phase and side are read from it.
 */
export interface ArmyStratagem {
  /** Unique in the army: a slug of the name. */
  id: string;
  name: string;
  cp: number;
  /** Whose turn: the player's own, the opponent's, or either. */
  side: "active" | "inactive" | "either";
  /** Phases it can be used in (system phase ids); none for any phase. */
  phases?: string[];
  /** It picks one of the player's units. */
  targetsUnit?: boolean;
  /** The When, Target and Effect text, for the panel. */
  when?: string;
  target?: string;
  effect?: string;
  text: string;
  /** What it does to the target until the end of the phase, once the player confirms it (#38's recognizer). */
  auto?: AbilityAuto;
}

/** Army-wide rules from the player's roster (#49), shared with the table when they deploy. */
export interface Army {
  name?: string;
  faction?: string;
  detachment?: string;
  /** The detachment's rules and the army rules; confirmed ones apply to every unit of the army. */
  rules: Ability[];
  stratagems: ArmyStratagem[];
}

/**
 * What a unit is, as imported from the player's roster: weapon profiles,
 * abilities and keywords. Model characteristics live on each model because
 * units can mix profiles (a sergeant, a leader).
 */
export interface UnitSheet {
  weapons: Record<string, WeaponProfile>;
  abilities: Ability[];
  keywords: string[];
  points?: number;
  /** A wizard's level (rank-and-flank magic): added to its casting and dispel rolls. */
  wizard?: number;
  /** The spells the unit's wizard knows, as the player brings them (see Spell). */
  spells?: Spell[];
}

/** When a spell is cast and what it does, in rank-and-flank magic (src/systems/tow/magic.ts). */
export type SpellKind = "missile" | "vortex" | "assailment" | "enchantment" | "hex" | "conveyance";

/**
 * A spell as player data: a name, numbers and an effect kind, never rules
 * text. Players bring these in a spell list file or with their roster.
 */
export interface Spell {
  name: string;
  /** Casting value: 2D6 plus the wizard's level must reach it. */
  cv: number;
  /** Range in inches; 0 for the wizard's own unit only. */
  range: number;
  kind: SpellKind;
  /** Damage spells (missile, vortex, assailment): hits like "D6", "2D6" or "3"... */
  hits?: string;
  /** ...at this Strength and armour piercing. Without them the effect is played by hand. */
  strength?: number;
  ap?: number;
  /** Enchantments and hexes stay until dispelled, rather than until the start of the caster's next turn. */
  remains?: boolean;
  /** The lore it belongs to, to give wizards the right spells from a list. */
  lore?: string;
}

/**
 * Base footprint. Width runs along the model's facing-perpendicular axis
 * (its frontage); depth runs front to back.
 */
export type BaseShape =
  | { shape: "round"; diameterMm: number }
  | { shape: "oval"; widthMm: number; depthMm: number }
  | { shape: "rect"; widthMm: number; depthMm: number };

export interface Model {
  id: ModelId;
  owner: PlayerId;
  label: string;
  /** Centre of the base on the table, in inches. (0,0) is the table centre. */
  position: Vec2;
  /** Facing in radians; 0 faces +y (towards the far table edge). */
  facing: number;
  base: BaseShape;
  /** The unit this model belongs to, if any. */
  unitId?: UnitId;
  /** Profile name and characteristics, when imported from a roster. */
  profile?: { name: string; chars: Characteristics };
  /** Weapon ids (keys of the unit sheet's weapons) this model carries. */
  weapons?: string[];
  /** Wounds the model has lost. */
  woundsLost?: number;
  /** Destroyed models stay in state (for undo, replays and revival) but leave the table. */
  destroyed?: boolean;
  /** Where the model stood when the current phase began, for move distances. */
  phaseStart?: Vec2;
  /** Height of the base above the table, in inches (standing on a terrain floor). */
  z?: number;
  phaseStartZ?: number;
  /** Height of the miniature in inches, for line of sight. Defaults from the base size. */
  height?: number;
  /**
   * Line-of-sight shape from an imported miniature: 1-4 stacked bands, each a
   * cylinder of radius `r` from `z0` to `z1` (inches above the base). Without
   * it the model is one cylinder of its base size.
   */
  bands?: SightBand[];
  /** An uploaded 3D figure standing on the base (see src/assets). Display only; `bands` carries its shape for rules. */
  figure?: ModelFigure;
  /** The stand-in's shape when no figure is worn (a game's own figures, #42). Display only. */
  look?: StandInLook;
}

/**
 * A procedural stand-in figure (src/render/standIns.ts): a shape, and the
 * colour it's painted (the base keeps the player's colour).
 */
export interface StandInLook {
  shape: "trooper" | "brute" | "robed" | "beast" | "walker" | "drone" | "vehicle" | "mound";
  color?: string;
  /**
   * Add-ons that give a unit its own silhouette (Rift Lanterns playtest):
   * a shield, a lantern pole, a lamp held high, a cog backpack, thorns,
   * blades instead of a gun, empty hands, or a hunched stance.
   */
  gear?: StandInGear[];
}

export type StandInGear = "shield" | "pole" | "lamp" | "cog" | "thorns" | "blades" | "unarmed" | "hunched";

/**
 * Which uploaded figure a model wears. `asset` is the SHA-256 of the file;
 * peers fetch the processed meshes from whoever has them.
 */
export interface ModelFigure {
  asset: string;
  /** File name, for the card. */
  name: string;
  /** Extra turn in radians, for sculpts that don't face forward. */
  yaw: number;
  scale: number;
}

export interface SightBand {
  r: number;
  z0: number;
  z1: number;
}

export type UnitId = string;

/**
 * How a unit's models are arranged. Skirmish units (40k) place models freely
 * and check coherency; ranked units (The Old World, Conquest) are rigid
 * blocks laid out in ranks and files that move, wheel and pivot together.
 */
export type Formation = { kind: "skirmish" } | { kind: "ranked"; files: number; order?: BlockOrder };

/**
 * How a ranked block is drawn up (The Old World): close order is the default
 * fighting formation, a column marches, open order is looser, and a disrupted
 * block has lost its order (no rank bonus). Skirmishers use `kind: "skirmish"`.
 */
export type BlockOrder = "close" | "column" | "open" | "disrupted";

export interface Unit {
  id: UnitId;
  owner: PlayerId;
  name: string;
  modelIds: ModelId[];
  formation: Formation;
  /** Name of the army list it was deployed from, for the log. */
  army?: string;
  sheet?: UnitSheet;
  /** Per-turn and lasting flags such as moved, advanced, shot, battleShocked. */
  status?: Record<string, number | boolean>;
  /** Units attached to this one, as they were, so each can leave again (unit/detach). */
  joined?: Unit[];
  /** This unit's own name and sheet from before anything joined it. */
  base?: { name: string; sheet?: UnitSheet };
}

export interface DiceRoll {
  by: PlayerId;
  sides: number;
  results: number[];
  /** What the roll was for, e.g. "advance" or "charge". */
  label?: string;
  unitId?: UnitId;
  /** Each die succeeds on this score or more (e.g. 4 for "to hit 4+"). */
  need?: number;
  /** Named faces (a scatter or artillery die): each result is a 1-based index into these. */
  faces?: string[];
}

/**
 * A box in a terrain piece's local space: x/y are the centre on the
 * footprint (x = right, y = forward), z the bottom, and w/d/h the size in
 * inches. Terrain is made of these, so the same shapes are drawn on the
 * table and used for line of sight and floors. There is no physics.
 */
export interface TerrainSolid {
  /** wall and block stop line of sight; floor also gives models a level to stand on; foliage is only visual. */
  kind: "wall" | "floor" | "block" | "foliage";
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/**
 * Rules category of a terrain piece, one of the game system's terrain
 * categories (40k: exposed, light, dense, solid). The system decides what
 * each one does (cover, hidden, impassable).
 */
export type TerrainCategory = string;

/** A terrain piece: a rectangular footprint, rotated by `facing`, with solids on it. */
export interface TerrainPiece {
  id: string;
  /** Template name, e.g. "Ruin" or "Woods", for the editor. */
  name: string;
  category: TerrainCategory;
  position: Vec2;
  width: number;
  depth: number;
  facing: number;
  solids: TerrainSolid[];
  /** Stand-in height for "heights" line of sight; defaults to the top of its tallest solid. */
  losHeight?: number;
  /**
   * How this piece blocks sight, overriding the game's setting: "heights" makes
   * it a block of its stand-in height (hills and woods in some games) even in
   * a true line of sight game; "true" uses its shape in a "heights" game.
   */
  sight?: "true" | "heights";
  /**
   * For "footprint" line of sight: open terrain does nothing, obscuring terrain
   * gives cover when it lies between the two bases' centres, and blocking
   * terrain stops sight across its footprint. Defaults from the piece's height.
   */
  visibility?: "open" | "obscuring" | "blocking";
  /**
   * Optional low-poly line-of-sight mesh from an imported terrain model:
   * triangles as flat [x,y,z, x,y,z, x,y,z, ...] in local inches, z up.
   * When present it blocks sight instead of the solids; floors still come from the solids.
   */
  hull?: number[];
  /**
   * An uploaded 3D model drawn in place of the solids: the processed asset's
   * file hash (shared peer to peer like figures), its name, and the scale it
   * was sized to (solids, hull and footprint are already scaled by it).
   */
  mesh?: { asset: string; name: string; scale: number };
}

export interface Objective {
  id: string;
  position: Vec2;
  /** What players call it, e.g. "West lantern". */
  label?: string;
  /** How it's drawn: a flat marker (the default), or a lantern that glows in its holder's colour. */
  look?: "marker" | "lantern";
}

/** A deployment zone as a convex polygon owned by a seat. */
export interface Zone {
  seat: number;
  points: Vec2[];
}

export interface TurnState {
  /** Battle round; 0 is deployment, before the first turn. */
  round: number;
  /** Index into the turn order (seats). */
  activeSeat: number;
  /**
   * Index into the system's round schedule (see content/turn.ts). For games
   * where each player takes a turn of phases (40k), the same indices repeat
   * for each player's turn.
   */
  phase: number;
  /** Players who passed in a row during alternating activations. */
  passes?: number;
  /** Seat that takes the first turn each round. */
  firstSeat: number;
}

export interface Table {
  /** Width (x) in inches. */
  width: number;
  /** Depth (y) in inches. */
  depth: number;
}

/** A named table: a starter ("starter:close") or a library table ("table:<id>"). */
export interface TableSource {
  key: string;
  name: string;
  changed?: boolean;
}

export interface GameState {
  /** Sequence number of the last event folded into this state (0 = none). */
  seq: number;
  table: Table;
  players: Record<PlayerId, Player>;
  units: Record<UnitId, Unit>;
  models: Record<ModelId, Model>;
  terrain: TerrainPiece[];
  objectives: Objective[];
  zones: Zone[];
  /** Where this table's layout came from, if a starter or library table; `changed` once edited. */
  tableSource?: TableSource | null;
  turn: TurnState;
  /** The game system being played (a GameSystem id); 40k when missing. */
  system?: string;
  /** Dice pools whose faces matter, e.g. FSD's ready activation dice: player → resource → faces. */
  pools?: Record<PlayerId, Record<string, number[]>>;
  /** Per-player counters such as CP and VP. */
  resources: Record<PlayerId, Record<string, number>>;
  /** The attack being resolved, if any. */
  attack: AttackState | null;
  /** A system procedure being resolved (any game's attack), if any. */
  procedure?: ProcedureState | null;
  /** An action held while the other player decides whether to react. */
  pending?: PendingReaction | null;
  /**
   * A reaction's results, waiting for the action it answered: both land
   * together (FSD resolves the two at the same time).
   */
  deferred?: Outcome[] | null;
  /**
   * Pool dice placed on cards ahead of time (FSD pre-assigned ADs): by
   * player, then by "unitId/weaponId", the faces on that action's slots.
   */
  placed?: Record<PlayerId, Record<string, number[]>>;
  /** Automated abilities that went off as the turn marker last moved (for the log). */
  triggered?: Triggered[] | null;
  /** The roll-off for who goes first, when the turn marker last started a round with one (Conquest's Supremacy). */
  rolledOff?: { rolls: number[][]; seat: number } | null;
  /** Player actions taken (stratagems), for their once-per-phase limits. */
  used?: Record<PlayerId, PlayerActionUse[]>;
  /** Each player's army-wide rules from their roster (#49): detachment, its rules and stratagems. */
  armies?: Record<PlayerId, Army>;
  /** The last measurement a player shared, shown to everyone until cleared. */
  ruler?: Ruler | null;
  /** Blast, flame and line templates on the table, by id. */
  templates?: Record<string, Template>;
  /** The code this game runs: the latest game/packages event. */
  packages?: GamePackages;
  /** A change of rules packages waiting for every seated player to accept. */
  packageProposal?: PackageProposal;
  /** The code procedure running, if any (core/script.ts). */
  script?: ScriptState | null;
  /** Game modules' own state: module id → key → value. */
  modules?: Record<string, Record<string, unknown>>;
  /** Players' committed secrets (core/secrets.ts): commitments, and values once revealed. */
  secrets?: Secrets;
  /** This game branched from another one's history (core/branch.ts). */
  branch?: BranchInfo;
  /** The mission chosen at setup (SystemModule.missions; see src/sdk Mission). */
  mission?: { id: string; name: string };
  /** Victory points players confirmed, each from a suggestion at a scoring moment. */
  scores?: ScoreEntry[];
  /** The campaign book this game is played for (src/campaign), and which shelf army each player brought. */
  campaign?: CampaignRef;
  /** Table options the players agreed on. */
  settings: GameSettings;
}

/**
 * A campaign book, by the hash of its contents: each peer keeps its own copy
 * and is warned when it differs from this one.
 */
export interface CampaignRef {
  id: string;
  name: string;
  hash: string;
  /** A place on the campaign map this game is fought over; the winner takes it. */
  territory?: string;
  /** Each player's army as it sits on their shelf: units are `${prefix}-${index in its roster}`. */
  armies: Record<PlayerId, CampaignArmyLink>;
}

/** A player's shelf army in a campaign game, named here so every peer writes the same book. */
export interface CampaignArmyLink {
  armyId: string;
  prefix: string;
  name?: string;
  system?: string;
}

export interface GameSettings {
  /** How cover helps: a worse hit roll for the attacker, or a better save. */
  cover: "hit" | "save";
  /** Whether models from other units block line of sight. */
  modelsBlock: boolean;
  /**
   * How line of sight works. "true" traces the model and terrain shapes.
   * "heights" uses stand-in heights instead, as games such as Warhammer: The Old
   * World and Full Spectrum Dominance do: every terrain piece is a flat-topped
   * block of its stand-in height over its footprint, every model a cylinder of
   * its height, and a model sees another if the line between their tops clears
   * everything in between. "footprint" ignores height altogether, as Full
   * Spectrum Dominance does: lines run across the table from the centre of the
   * observer's base, and each piece is open, obscuring or blocking (see
   * TerrainPiece.visibility). Missing means "true".
   */
  los?: "true" | "heights" | "footprint";
  /**
   * Vision arc in degrees, centred on each model's facing (90 in Warhammer:
   * The Old World). Missing means models see all around.
   */
  visionArc?: number;
  /** Players per side (2 for a 2v2). Missing means one each. */
  teamSize?: number;
  /** Chess clocks and time limits (core/clock.ts); missing means untimed. */
  clock?: ClockSettings | null;
  /**
   * Table companion (#37): the players have real models on a real table. No
   * 3D board; range, sight and moves are theirs to judge, and positions here
   * mean nothing.
   */
  companion?: boolean;
}

/** Victory points a side scored at one scoring moment (or chose not to). */
export interface ScoreEntry {
  /** Which moment and rule: `${rule}:${round}:${seat}` (or `card:<secret key>`), so each is scored once. */
  key: string;
  seat: number;
  round: number;
  vp: number;
  why: string;
  /** Who confirmed it. */
  by: PlayerId;
  skipped?: boolean;
}

/** Strike Force sized board: 44" x 60". */
export const STRIKE_FORCE_TABLE: Table = { width: 60, depth: 44 };

export function createInitialState(table: Table = STRIKE_FORCE_TABLE): GameState {
  return {
    seq: 0,
    table,
    players: {},
    units: {},
    models: {},
    terrain: [],
    objectives: [],
    zones: [],
    turn: { round: 0, activeSeat: 0, phase: 0, firstSeat: 0 },
    resources: {},
    attack: null,
    settings: { cover: "hit", modelsBlock: true },
  };
}

/** A procedure in progress: the run (plain JSON) and the action that started it. */
export interface ProcedureState {
  run: ProcedureRun;
  title: string;
  unitId: UnitId;
  action: string;
  by: PlayerId;
  targetId?: UnitId;
  weapon?: string;
  /** Whether the run's outcomes have been applied to the table. */
  applied?: boolean;
}

/** What a reaction answers: the action declared, its unit and target. */
export interface ActionTrigger {
  unitId: UnitId;
  action: string;
  by: PlayerId;
  targetId?: UnitId;
  weapon?: string;
}

/**
 * An action waits while the player in `seat` decides whether to react (FSD:
 * a unit shot at, or seeing an enemy move). Once a unit reacts it is the
 * `reactor`; when its action is done, the held action goes on.
 */
export interface PlayerActionUse {
  action: string;
  round: number;
  phase: number;
  seat: number;
}

export interface PendingReaction {
  kind: "reaction";
  seat: number;
  trigger: ActionTrigger;
  reactor?: UnitId;
}

/**
 * A template laid on the table: a circle (blast) centred on `at`, a flame
 * teardrop with its point at `at` aimed at `to`, or a line from `at` to `to`
 * (a cannon's path). Sizes come from the game system.
 */
export interface Template {
  id: string;
  by: PlayerId;
  shape: "circle" | "flame" | "line";
  /** Diameter of a circle, length of a flame (a line's length is at to `to`). */
  size: number;
  /** Width of a flame's round end. */
  width?: number;
  at: Vec2;
  to?: Vec2;
  label?: string;
  /** Where it was before its last scatter, to draw the path. */
  from?: Vec2;
}

/** A rules package as a game names it: identity is the hash of its bytes. */
export interface PackageRef {
  id: string;
  name: string;
  version: string;
  author?: string;
  hash: string;
  bytes: number;
}

export interface GamePackages {
  /** App version + commit: covers the reducer and the built-in modules. */
  app: string;
  system: { id: string; builtIn: boolean };
  packages: PackageRef[];
  /** Seats that accepted, for a change made mid-game. */
  agreed?: PlayerId[];
}

export interface PackageProposal {
  by: PlayerId;
  packages: PackageRef[];
  accepted: PlayerId[];
  declined: PlayerId[];
}

/** A measurement between two points, either of which may be a model (measured from its base edge). */
export interface Ruler {
  by: PlayerId;
  from: Vec2;
  to: Vec2;
  fromModel?: ModelId;
  toModel?: ModelId;
}
