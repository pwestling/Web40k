import type { AbilityAuto, ArmyStratagem } from "../core/types";
import type { Effect } from "../core/content/schema";
import type { Teaching } from "../systems/wh40k/teach";

/**
 * A faction pack's data (#76): `export const faction = { ... }` in a package
 * whose manifest kind is "faction". It adds rules to a game system's armies
 * keyed by NAME (ability, detachment, enhancement and stratagem names), never
 * by rules text. The app reads it as data, without running the package; any
 * code the pack has runs in the sandbox like an extension's. See
 * docs/faction-packs.md.
 */
export interface FactionPack {
  /** The faction it is written for, as a list names it; shown to the player, never required to match. */
  faction?: string;
  /** Army-wide rules (the faction's own), matched against the army's rules by name. */
  rules?: PackRule[];
  /** Unit abilities (and enhancements) by name, on any unit of the army. */
  abilities?: PackRule[];
  /** Detachments by name: their rules, enhancements and stratagems apply when the army's detachment matches. */
  detachments?: PackDetachment[];
  /** Stratagems for any detachment of the faction. */
  stratagems?: PackStratagem[];
}

export interface PackDetachment {
  name: string;
  rules?: PackRule[];
  enhancements?: PackRule[];
  stratagems?: PackStratagem[];
}

/**
 * What a named rule does. The first of these it has is used:
 * - `auto`: the automated-ability data of #38 (`parts`, and `effects` compiled
 *   from them when left out; `aura`, `trigger`, `whileLeading`, `oncePerBattle`);
 * - `teach`: what "Teach it this rule" (#53) builds (when, who, what);
 * - `effects`: rules-schema effects, which may call the pack's code
 *   (`{ call }` in an expression, `{ do: "script" }`);
 * - `code`: the pack's code plays it (a hook or an action), named for the reader.
 */
export interface PackRule {
  name: string;
  /** The author's own one line, shown when the army has no text for it. Never copied rules text. */
  summary?: string;
  auto?: Omit<AbilityAuto, "effects" | "pack" | "taught"> & { effects?: Effect[] };
  teach?: Teaching;
  effects?: Effect[];
  code?: string;
}

/** A stratagem: what the play panel needs to offer it (#49), and what it does to its target. */
export interface PackStratagem extends Omit<PackRule, "code"> {
  cp: number;
  /** Whose turn: the player's own ("active"), the opponent's ("inactive"), or either. */
  side: ArmyStratagem["side"];
  /** System phase ids it can be used in; none for any phase. */
  phases?: string[];
  once?: ArmyStratagem["once"];
  /** One of the player's units (the default), maybe with keywords or an action it mustn't have taken; false for none. */
  target?: false | { keywords?: string; notYet?: ArmyStratagem["notYet"] };
}
