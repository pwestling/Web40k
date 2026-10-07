import type { ComponentType } from "react";
import type { GameState, Layout, Table, Unit } from "../core";
import type { ImportedRoster } from "./wh40k/roster";

/**
 * What the app needs from each game system besides its rules data: a table
 * to start on, sample armies, and how the shared terrain templates map to the
 * system's terrain categories. Rules live in the module's `system` (data) and code hooks; see src/sdk.
 */
export interface SystemModule {
  /** Read an exported army list; 40k's BattleScribe reader when missing. */
  importRoster?(fileName: string, data: Uint8Array): Promise<ImportedRoster>;
  /** Sample army for a seat. */
  sample(seat: 0 | 1): ImportedRoster;
  layout(table: Table): Layout;
  /** Category for each terrain template name, when the system has its own categories. */
  templateCategory?: Record<string, string>;
  /**
   * The system has its own panels (40k: the attack editor and phase moves);
   * other systems use the generic actions and procedure panels.
   */
  dedicatedUi?: boolean;
  /** Rank width and rank bonus cap for a regiment (rank-and-flank systems); else the system's constants. */
  rankRules?(game: GameState, unit: Unit): { width: number; maxBonus: number };
  /** Templates players can lay on the table (blasts, flames, lines). */
  templates?: TemplateKind[];
  /** Dice with named faces (scatter, artillery), rolled from the dice tray. */
  specialDice?: SpecialDie[];
  /** How a template scatters: the direction die (a face named "hit" stays put) and the distance die. */
  scatter?: { direction: string; distance: string };
  /** Dice rolled for a flee or pursuit, e.g. "2D6". */
  fleeDice?: string;
  /** The charge roll: these dice, keeping the highest or adding them, plus the unit's Movement. */
  chargeRoll?: { count: number; sides: number; keep: "highest" | "sum" };
  /** A panel of the system's own, shown during play (Conquest's command stack). */
  panel?: ComponentType;
}

export interface TemplateKind {
  id: string;
  label: string;
  shape: "circle" | "flame" | "line";
  /** Diameter, or length for flames and lines. */
  size: number;
  /** A flame's width at its round end. */
  width?: number;
}

export interface SpecialDie {
  id: string;
  name: string;
  faces: string[];
}
