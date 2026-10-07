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

export interface Model {
  id: ModelId;
  owner: PlayerId;
  label: string;
  /** Centre of the base on the table, in inches. (0,0) is the table centre. */
  position: Vec2;
  /** Facing in radians. */
  facing: number;
  /** Round base diameter in millimetres (e.g. 32, 40). */
  baseMm: number;
}

export interface DiceRoll {
  by: PlayerId;
  sides: number;
  results: number[];
}

export type LogEntry =
  { kind: "roll"; seq: number; roll: DiceRoll } | { kind: "info"; seq: number; text: string };

export interface Table {
  /** Width (x) in inches. */
  width: number;
  /** Depth (y) in inches. */
  depth: number;
}

export interface GameState {
  /** Sequence number of the last applied event. */
  seq: number;
  table: Table;
  players: Record<PlayerId, Player>;
  models: Record<ModelId, Model>;
  log: LogEntry[];
}

/** Strike Force sized board: 44" x 60". */
export const STRIKE_FORCE_TABLE: Table = { width: 60, depth: 44 };

export function createInitialState(table: Table = STRIKE_FORCE_TABLE): GameState {
  return { seq: 0, table, players: {}, models: {}, log: [] };
}
