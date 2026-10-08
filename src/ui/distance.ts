import { systemOf, type GameState } from "../core";
import { inchesPerUnit } from "../core/content/runtime";

/** A distance in the game system's own unit: 6.2", or 2.1 DU for FSD (UX 178). Distances are kept in inches. */
export function distanceText(game: GameState, inches: number): string {
  const system = systemOf(game);
  const raw = inches / inchesPerUnit(system);
  const unit = typeof system.units === "object" ? system.units.name : system.units === "cm" ? "cm" : '"';
  // Quarter steps (Shift+arrow nudges) read as ¼" exactly, not 0.3" (UX 180).
  const quarter =
    Math.abs(raw * 4 - Math.round(raw * 4)) < 1e-6 && Math.abs(raw * 10 - Math.round(raw * 10)) > 1e-6;
  if (unit === '"') return quarter ? `${raw.toFixed(2)}"` : `${raw.toFixed(1)}"`;
  return `${quarter ? Number(raw.toFixed(2)) : Number(raw.toFixed(1))} ${unit}`;
}
