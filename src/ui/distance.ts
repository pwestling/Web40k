import { systemOf, type GameState } from "../core";
import { inchesPerUnit } from "../core/content/runtime";

/** A distance in the game system's own unit: 6.2", or 2.1 DU for FSD (UX 178). Distances are kept in inches. */
export function distanceText(game: GameState, inches: number): string {
  const system = systemOf(game);
  const n = Number((inches / inchesPerUnit(system)).toFixed(1));
  const unit = typeof system.units === "object" ? system.units.name : system.units === "cm" ? "cm" : '"';
  return unit === '"' ? `${n.toFixed(1)}"` : `${n} ${unit}`;
}
