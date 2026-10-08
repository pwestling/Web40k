import type { GameState } from "../core";
import { systemOf, type GameSystem } from "../core/content";
import { inchesPerUnit } from "../core/content/runtime";
import { formatNumber } from "../i18n";

/** The system's unit of length as written after a number: '"', "cm", or its own ("DU"). */
export function unitSymbol(system: GameSystem): string {
  return typeof system.units === "object" ? system.units.name : system.units === "cm" ? "cm" : '"';
}

/**
 * A distance in the system's own unit: 6.2", or 2.1 DU for FSD (UX 178). Distances are kept in inches.
 * Quarter steps (Shift+arrow nudges) read as ¼" exactly, not 0.3" (UX 180). Numbers in the player's language.
 */
export function lengthText(system: GameSystem, inches: number): string {
  const raw = inches / inchesPerUnit(system);
  const unit = unitSymbol(system);
  const quarter =
    Math.abs(raw * 4 - Math.round(raw * 4)) < 1e-6 && Math.abs(raw * 10 - Math.round(raw * 10)) > 1e-6;
  const digits = quarter ? 2 : 1;
  const num = formatNumber(Number(raw.toFixed(digits)), {
    minimumFractionDigits: unit === '"' ? digits : 0,
    maximumFractionDigits: digits,
  });
  return unit === '"' ? `${num}"` : `${num} ${unit}`;
}

/** {@link lengthText} in the game's system. */
export function distanceText(game: GameState, inches: number): string {
  return lengthText(systemOf(game), inches);
}

/** Inches, for games that only measure in them: 6.2". */
export function inchText(inches: number): string {
  return `${formatNumber(Number(inches.toFixed(1)), { maximumFractionDigits: 1 })}"`;
}
