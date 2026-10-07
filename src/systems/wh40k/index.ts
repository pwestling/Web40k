import { STRIKE_FORCE_TABLE, type GameSystem } from "../../core";

/**
 * Warhammer 40,000 (11th edition) mechanics. Only numbers and procedures live
 * here; unit data and rules text come from an imported ContentPack.
 */
export const wh40k: GameSystem = {
  id: "wh40k-11e",
  name: "Warhammer 40,000 (11th edition)",
  characteristics: [
    { key: "M", label: "Move", format: '{v}"' },
    { key: "T", label: "Toughness" },
    { key: "Sv", label: "Save", format: "{v}+" },
    { key: "W", label: "Wounds" },
    { key: "Ld", label: "Leadership", format: "{v}+" },
    { key: "OC", label: "Objective Control" },
    { key: "InvSv", label: "Invulnerable save", format: "{v}+" },
  ],
  weaponCharacteristics: [
    { key: "A", label: "Attacks" },
    { key: "BS", label: "Skill", format: "{v}+" },
    { key: "S", label: "Strength" },
    { key: "AP", label: "Armour Penetration" },
    { key: "D", label: "Damage" },
  ],
  phases: ["command", "movement", "shooting", "charge", "fight"],
  turnStructure: "playerTurn",
  defaultFormation: "skirmish",
  defaultTable: STRIKE_FORCE_TABLE,
  rollModifierCaps: { hit: 1, wound: 1 },
};

/** Wound roll needed for strength S against toughness T. */
export function woundTarget(strength: number, toughness: number): number {
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5;
}

/** Save needed after AP (stored negative, e.g. -2), using the invulnerable
 * save if it is better. Null means no save is possible. */
export function saveTarget(save: number, ap: number, invulnerable?: number): number | null {
  const best = Math.min(save - ap, invulnerable ?? Infinity);
  return best > 6 ? null : Math.max(2, best);
}

/** Coherency distances in inches. */
export const COHERENCY = { nearest: 2, unitSpan: 9, vertical: 5 } as const;
export const ENGAGEMENT_RANGE = { horizontal: 2, vertical: 5 } as const;
