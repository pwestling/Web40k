/**
 * Core game-state types. Everything in `src/core` is pure TypeScript with no
 * DOM, three.js or networking imports, so it can be unit tested and run
 * identically on every peer.
 *
 * Units: positions are in inches (1 world unit = 1"), matching how 40k
 * measures everything. Base sizes stay in millimetres because that is how
 * bases are specified.
 */

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
}

export interface DiceRoll {
  by: PlayerId;
  sides: number;
  results: number[];
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
}

/** Strike Force sized board: 44" x 60". */
export const STRIKE_FORCE_TABLE: Table = { width: 60, depth: 44 };

export function createInitialState(table: Table = STRIKE_FORCE_TABLE): GameState {
  return { seq: 0, table, players: {}, units: {}, models: {} };
}
