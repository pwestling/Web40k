import type { BaseShape } from "./types";

/**
 * Importable game content.
 *
 * The engine ships no unit stats, points or rules text. Players import a
 * ContentPack for a GameSystem (converted from BSData or written by hand) and
 * the engine runs on that. Everything here is plain JSON so packs can be
 * saved, shared and sent to peers.
 *
 * Rules are encoded as data wherever possible: weapon and unit keywords carry
 * parameters, and abilities are lists of Effects (trigger + conditions +
 * action) the engine can apply automatically. Anything not yet expressible
 * falls back to a `manual` effect that is shown to players as a reminder.
 */

export type Keyword = string;
/** A number or a dice expression such as "D6+1"; see parseDice. */
export type Value = number | string;

export interface ContentPack {
  id: string;
  name: string;
  version: string;
  /** The GameSystem id this pack is for, e.g. "wh40k-11e". */
  system: string;
  /** Where the data came from, e.g. a BSData catalogue URL and revision. */
  source?: string;
  unitTypes: Record<string, UnitType>;
  weapons: Record<string, Weapon>;
  abilities: Record<string, Ability>;
}

/** A datasheet (40k), unit entry (The Old World) or regiment (Conquest). */
export interface UnitType {
  id: string;
  name: string;
  keywords: Keyword[];
  /** Most units have one profile; some mix model types (e.g. a leader or champion). */
  profiles: ModelProfile[];
  weaponIds: string[];
  abilityIds: string[];
  base: BaseShape;
  /** Overrides the system's default formation, e.g. ranked files for a regiment. */
  formation?: { kind: "skirmish" } | { kind: "ranked"; files: number };
}

export interface ModelProfile {
  name: string;
  /** Keyed by the GameSystem's characteristic keys, e.g. { M: 6, T: 4, Sv: 3 }. */
  characteristics: Record<string, Value>;
}

export interface Weapon {
  id: string;
  name: string;
  type: "ranged" | "melee";
  /** Inches; 0 for melee. */
  range: number;
  /** Keyed by the GameSystem's weapon characteristic keys, e.g. { A: "D6", S: 4, AP: -1 }. */
  characteristics: Record<string, Value>;
  keywords: Tag[];
}

/**
 * A keyword with optional parameters, e.g. { name: "sustainedHits", value: 1 }
 * or { name: "anti", keyword: "VEHICLE", value: 4 }. The GameSystem decides
 * which names it automates; others are shown to players by name.
 */
export interface Tag {
  name: string;
  value?: Value;
  keyword?: Keyword;
}

export interface Ability {
  id: string;
  name: string;
  /** Optional player-supplied description. Never shipped in the repo. */
  text?: string;
  effects: Effect[];
}

/** "When <trigger>, if <conditions>, do <action>." */
export interface Effect {
  when: Trigger;
  if?: Condition[];
  do: EffectAction;
}

/** Roll kinds and phases are strings defined by the GameSystem, e.g. "hit" or "shooting". */
export type Trigger =
  | { kind: "roll"; roll: string; side: "attacker" | "defender" | "self" }
  | { kind: "phaseStart"; phase: string }
  | { kind: "phaseEnd"; phase: string }
  | { kind: "always" };

export type Condition =
  | { kind: "targetHasKeyword"; keyword: Keyword }
  | { kind: "selfHasKeyword"; keyword: Keyword }
  | { kind: "weaponType"; type: Weapon["type"] }
  | { kind: "weaponHasKeyword"; name: string }
  | { kind: "phase"; phase: string }
  | { kind: "withinRange"; inches: number }
  | { kind: "withinHalfRange" }
  | { kind: "remainedStationary" }
  | { kind: "charged" }
  | { kind: "inArc"; arc: "front" | "flank" | "rear" }
  | { kind: "belowHalfStrength" }
  | { kind: "status"; status: string };

export type EffectAction =
  | { kind: "modifyRoll"; by: number }
  | { kind: "reroll"; which: "ones" | "failed" | "any" }
  | { kind: "criticalOn"; value: number }
  | { kind: "modifyCharacteristic"; characteristic: string; by: number }
  | { kind: "ignoreWounds"; threshold: number }
  | { kind: "grantKeyword"; tag: Tag }
  | { kind: "manual"; reminder: string };
