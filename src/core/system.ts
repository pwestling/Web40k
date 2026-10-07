import type { Table } from "./types";

/**
 * Describes one game system (40k, The Old World, Conquest, ...). The engine
 * core is system-agnostic; a GameSystem supplies the vocabulary and rules
 * hooks, and a ContentPack supplies the units for that system.
 */
export interface GameSystem {
  id: string;
  name: string;
  /** Model characteristics in display order, e.g. M, T, Sv for 40k. */
  characteristics: CharacteristicDef[];
  weaponCharacteristics: CharacteristicDef[];
  /** Phases of a turn, in order. */
  phases: string[];
  /**
   * "playerTurn": one player does every phase, then the other (40k, The Old
   * World). "alternatingUnits": players alternate activating one unit at a
   * time (Conquest).
   */
  turnStructure: "playerTurn" | "alternatingUnits";
  /** Default arrangement for new units. */
  defaultFormation: "skirmish" | "ranked";
  defaultTable: Table;
  /** Largest total modifier allowed per roll kind, if the system caps it. */
  rollModifierCaps?: Record<string, number>;
}

export interface CharacteristicDef {
  key: string;
  label: string;
  /** How the value is written, e.g. `{v}"` for inches or `{v}+` for rolls. */
  format?: string;
}
