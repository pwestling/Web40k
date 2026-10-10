import { isAutomated } from "../core/content/player";
import { getSystem } from "../core/content/systems";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { systemModule } from "../systems";
import type { ImportedUnit } from "../systems/wh40k/roster";
import { readTtsUnit } from "./unit";

/**
 * A unit's datasheet from its TTS models (#74), for the whole-table import
 * (#73, table.ts): characteristics, weapons and abilities read from each
 * model's raw Description (BBCode and all; see describe.ts). Abilities the
 * system's reader understands come back with `auto` (#38); the rest stay
 * reminders the player can teach (#53). Models come back in the order given,
 * one per input model. Null when no description reads as a profile.
 */
export function unitFromTts(input: {
  system: string;
  name: string;
  models: { nickname: string; description: string }[];
}): Partial<Pick<ImportedUnit, "name" | "sheet" | "models" | "missing">> | null {
  const read = readTtsUnit(input.name, input.models);
  if (!read) return null;
  const { unit } = read;
  const recognize = systemModule(input.system).recognizeAbility;
  if (recognize) {
    const system = getSystem(input.system || DEFAULT_SYSTEM);
    unit.sheet.abilities = unit.sheet.abilities.map((a) => {
      if (a.auto || !a.text || isAutomated(system, a)) return a;
      const auto = recognize(a, system);
      return auto ? { ...a, auto } : a;
    });
  }
  return unit;
}
