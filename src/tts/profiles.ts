import { isAutomated } from "../core/content/player";
import { getSystem } from "../core/content/systems";
import { DEFAULT_SYSTEM } from "../core/content/turn";
import { systemModule } from "../systems";
import type { ImportedUnit } from "../systems/wh40k/roster";
import { readScriptedUnit } from "./scripted";
import { readTtsUnit } from "./unit";

/**
 * A unit's datasheet from its TTS models (#74), for the whole-table import
 * (#73, table.ts): characteristics, weapons and abilities read from each
 * model's raw Description (BBCode and all; see describe.ts). Abilities the
 * system's reader understands come back with `auto` (#38); the rest stay
 * reminders the player can teach (#53). Models come back in the order given,
 * one per input model. A model's `script` (its LuaScript) is read first: the
 * unit data Yellowscribe writes there is the list itself (#75, scripted.ts);
 * without it, the descriptions. Null when neither reads as a profile.
 */
export function unitFromTts(input: {
  system: string;
  name: string;
  models: { nickname: string; description: string; script?: string }[];
}): Partial<Pick<ImportedUnit, "name" | "sheet" | "models" | "missing">> | null {
  const unit = readScriptedUnit(input.models) ?? readTtsUnit(input.name, input.models)?.unit;
  if (!unit) return null;
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
