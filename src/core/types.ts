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
}

export type UnitId = string;

/**
 * How a unit's models are arranged. Skirmish units (40k) place models freely
 * and check coherency; ranked units (The Old World, Conquest) are rigid
 * blocks laid out in ranks and files that move, wheel and pivot together.
 */
export type Formation = { kind: "skirmish" } | { kind: "ranked"; files: number };

export interface Unit {
  id: UnitId;
  owner: PlayerId;
  name: string;
  modelIds: ModelId[];
  formation: Formation;
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

/** A rectangle footprint on the table, centred at `position`, rotated by `facing`. */
export interface TerrainPiece {
  id: string;
  kind: "ruin" | "crater" | "woods" | "container";
  position: Vec2;
  width: number;
  depth: number;
  facing: number;
  /** Walls standing on the footprint, as segments in local space, with a height. */
  walls: { from: Vec2; to: Vec2; height: number }[];
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
  /** Index into the system's phases. */
  phase: number;
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
  /** Per-player counters such as CP and VP. */
  resources: Record<PlayerId, Record<string, number>>;
  /** The attack being resolved, if any. */
  attack: AttackState | null;
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
  };
}
