import type { GameSystem } from "../core/content/schema";
import { readCharacteristics } from "../core/content/runtime";
import { t } from "../i18n";

/** Why a target can't be hit, or a range note, from the weapon's range and the step plans. */
export function rangeNote(
  system: GameSystem,
  weapon: { chars: Record<string, string> } | undefined,
  distance: number,
  impossible: boolean,
): string | null {
  const v = weapon ? readCharacteristics(system, "weapon", weapon.chars) : {};
  const range = typeof v.range === "number" ? v.range : null;
  const min = typeof v.minRange === "number" ? v.minRange : 0;
  if (min && distance < min) return t("inside minimum range");
  if (range && system.longRange === "double" && distance > range)
    return impossible ? t("out of range") : t("long range");
  if (range && distance > range) return t("out of range");
  if (range && system.longRange === "half" && distance > range / 2 && !impossible) return t("long range");
  return impossible ? t("can't hit") : null;
}
