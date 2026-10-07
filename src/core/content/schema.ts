/**
 * Importable game content.
 *
 * The engine ships no unit stats, points or rules text. Players import a
 * ContentPack (converted from BSData or written by hand) and the engine runs
 * on that. Everything here is plain JSON so packs can be saved, shared and
 * sent to peers.
 *
 * Rules are encoded as data wherever possible: weapon keywords are typed, and
 * abilities are lists of Effects (trigger + conditions + action) the engine can
 * apply automatically. Anything not yet expressible falls back to a `manual`
 * effect that is shown to players as a reminder.
 */

export type Keyword = string;
export type DiceText = string; // e.g. "D6+1", parsed with parseDice

export interface ContentPack {
  id: string;
  name: string;
  version: string;
  /** Where the data came from, e.g. a BSData catalogue URL and revision. */
  source?: string;
  datasheets: Record<string, Datasheet>;
  weapons: Record<string, Weapon>;
  abilities: Record<string, Ability>;
}

export interface Datasheet {
  id: string;
  name: string;
  keywords: Keyword[];
  factionKeywords: Keyword[];
  /** Most units have one profile; some mix model types (e.g. a leader). */
  profiles: ModelProfile[];
  weaponIds: string[];
  abilityIds: string[];
  baseMm: number;
}

export interface ModelProfile {
  name: string;
  /** Characteristics. Movement is in inches. */
  movement: number;
  toughness: number;
  save: number;
  invulnerableSave?: number;
  wounds: number;
  leadership: number;
  objectiveControl: number;
}

export interface Weapon {
  id: string;
  name: string;
  type: "ranged" | "melee";
  /** Inches; 0 for melee. */
  range: number;
  attacks: DiceText;
  /** BS or WS, e.g. 3 for 3+. Omitted for weapons that auto-hit. */
  skill?: number;
  strength: number;
  ap: number;
  damage: DiceText;
  keywords: WeaponKeyword[];
}

export type WeaponKeyword =
  | { kind: "assault" }
  | { kind: "heavy" }
  | { kind: "pistol" }
  | { kind: "torrent" }
  | { kind: "blast" }
  | { kind: "lethalHits" }
  | { kind: "devastatingWounds" }
  | { kind: "twinLinked" }
  | { kind: "ignoresCover" }
  | { kind: "precision" }
  | { kind: "hazardous" }
  | { kind: "lance" }
  | { kind: "rapidFire"; x: DiceText }
  | { kind: "sustainedHits"; x: DiceText }
  | { kind: "melta"; x: DiceText }
  | { kind: "anti"; keyword: Keyword; threshold: number }
  /** Anything the engine does not model yet; shown to players by name. */
  | { kind: "other"; name: string };

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

export type Phase = "command" | "movement" | "shooting" | "charge" | "fight";
export type RollKind = "hit" | "wound" | "save" | "damage" | "advance" | "charge" | "battleShock";

export type Trigger =
  | { kind: "roll"; roll: RollKind; side: "attacker" | "defender" | "self" }
  | { kind: "phaseStart"; phase: Phase }
  | { kind: "phaseEnd"; phase: Phase }
  | { kind: "always" };

export type Condition =
  | { kind: "targetHasKeyword"; keyword: Keyword }
  | { kind: "selfHasKeyword"; keyword: Keyword }
  | { kind: "weaponType"; type: Weapon["type"] }
  | { kind: "weaponHasKeyword"; weaponKeyword: WeaponKeyword["kind"] }
  | { kind: "phase"; phase: Phase }
  | { kind: "withinRange"; inches: number }
  | { kind: "withinHalfRange" }
  | { kind: "remainedStationary" }
  | { kind: "charged" }
  | { kind: "belowHalfStrength" }
  | { kind: "battleShocked" };

export type EffectAction =
  | { kind: "modifyRoll"; by: number }
  | { kind: "reroll"; which: "ones" | "failed" | "any" }
  | { kind: "criticalOn"; value: number }
  | {
      kind: "modifyCharacteristic";
      characteristic: keyof ModelProfile | "ap" | "strength" | "attacks" | "damage";
      by: number;
    }
  | { kind: "feelNoPain"; threshold: number }
  | { kind: "grantWeaponKeyword"; keyword: WeaponKeyword }
  | { kind: "manual"; reminder: string };
