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
import type { ProcedureRun } from "./content/runner";

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
}

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
}

export interface DiceRoll {
  by: PlayerId;
  sides: number;
  results: number[];
  /** What the roll was for, e.g. "advance" or "charge". */
  label?: string;
  unitId?: UnitId;
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
}

export interface Objective {
  id: string;
  position: Vec2;
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
  /** Player actions taken (stratagems), for their once-per-phase limits. */
  used?: Record<PlayerId, PlayerActionUse[]>;
  /** The last measurement a player shared, shown to everyone until cleared. */
  ruler?: Ruler | null;
  /** Table options the players agreed on. */
  settings: GameSettings;
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

/** A measurement between two points, either of which may be a model (measured from its base edge). */
export interface Ruler {
  by: PlayerId;
  from: Vec2;
  to: Vec2;
  fromModel?: ModelId;
  toModel?: ModelId;
}
