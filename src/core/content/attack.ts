import type { Condition, Effect, RollKind, Weapon, Keyword } from "./schema";

/**
 * Generic attack-sequence mechanics. These encode how numbers interact, not
 * any rules text, so they live in the engine rather than in content.
 */

/** Wound roll needed for strength S against toughness T. */
export function woundTarget(strength: number, toughness: number): number {
  if (strength >= toughness * 2) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (strength * 2 <= toughness) return 6;
  return 5;
}

/** Save needed after AP, using the invulnerable save if it is better. Null means no save possible. */
export function saveTarget(save: number, ap: number, invulnerable?: number): number | null {
  const armour = save - ap; // AP is stored as a negative number, e.g. -2.
  const best = Math.min(armour, invulnerable ?? Infinity);
  return best > 6 ? null : Math.max(2, best);
}

/** Hit and wound rolls can be modified by at most ±1 in total. */
export const MAX_ROLL_MODIFIER = 1;

export interface RollContext {
  roll: RollKind;
  side: "attacker" | "defender" | "self";
  weapon?: Weapon;
  selfKeywords: Keyword[];
  targetKeywords: Keyword[];
  distance?: number;
  remainedStationary?: boolean;
  charged?: boolean;
}

export interface RollModifiers {
  modifier: number;
  reroll: "ones" | "failed" | "any" | null;
  criticalOn: number;
  reminders: string[];
}

/** Fold every applicable effect into the modifiers for one roll. */
export function rollModifiers(effects: Effect[], ctx: RollContext): RollModifiers {
  const out: RollModifiers = { modifier: 0, reroll: null, criticalOn: 6, reminders: [] };
  for (const effect of effects) {
    const { when } = effect;
    if (when.kind !== "roll" || when.roll !== ctx.roll || when.side !== ctx.side) continue;
    if (!(effect.if ?? []).every((c) => conditionHolds(c, ctx))) continue;
    const action = effect.do;
    switch (action.kind) {
      case "modifyRoll":
        out.modifier += action.by;
        break;
      case "reroll":
        out.reroll = strongerReroll(out.reroll, action.which);
        break;
      case "criticalOn":
        out.criticalOn = Math.min(out.criticalOn, action.value);
        break;
      case "manual":
        out.reminders.push(action.reminder);
        break;
    }
  }
  if (ctx.roll === "hit" || ctx.roll === "wound") {
    out.modifier = Math.max(-MAX_ROLL_MODIFIER, Math.min(MAX_ROLL_MODIFIER, out.modifier));
  }
  return out;
}

function conditionHolds(c: Condition, ctx: RollContext): boolean {
  switch (c.kind) {
    case "targetHasKeyword":
      return ctx.targetKeywords.includes(c.keyword);
    case "selfHasKeyword":
      return ctx.selfKeywords.includes(c.keyword);
    case "weaponType":
      return ctx.weapon?.type === c.type;
    case "weaponHasKeyword":
      return ctx.weapon?.keywords.some((k) => k.kind === c.weaponKeyword) ?? false;
    case "withinRange":
      return ctx.distance !== undefined && ctx.distance <= c.inches;
    case "withinHalfRange":
      return ctx.distance !== undefined && !!ctx.weapon && ctx.distance <= ctx.weapon.range / 2;
    case "remainedStationary":
      return ctx.remainedStationary ?? false;
    case "charged":
      return ctx.charged ?? false;
    default:
      // Conditions that need game state this context lacks are not met yet.
      return false;
  }
}

const REROLL_STRENGTH = { ones: 1, failed: 2, any: 3 } as const;

function strongerReroll(a: RollModifiers["reroll"], b: NonNullable<RollModifiers["reroll"]>) {
  return a && REROLL_STRENGTH[a] >= REROLL_STRENGTH[b] ? a : b;
}
