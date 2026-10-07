import type { Condition, Effect, Keyword, Weapon } from "./content";
import type { GameSystem } from "./system";

export type Arc = "front" | "flank" | "rear";

export interface RollContext {
  roll: string;
  side: "attacker" | "defender" | "self";
  phase?: string;
  weapon?: Weapon;
  selfKeywords: Keyword[];
  targetKeywords: Keyword[];
  distance?: number;
  /** Which arc of the target the attacker is in, for systems with facing. */
  arc?: Arc;
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
export function rollModifiers(system: GameSystem, effects: Effect[], ctx: RollContext): RollModifiers {
  const out: RollModifiers = { modifier: 0, reroll: null, criticalOn: system.die, reminders: [] };
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
  const cap = system.rollModifierCaps?.[ctx.roll];
  if (cap !== undefined) out.modifier = Math.max(-cap, Math.min(cap, out.modifier));
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
      return ctx.weapon?.keywords.some((k) => k.name === c.name) ?? false;
    case "phase":
      return ctx.phase === c.phase;
    case "withinRange":
      return ctx.distance !== undefined && ctx.distance <= c.inches;
    case "withinHalfRange":
      return ctx.distance !== undefined && !!ctx.weapon && ctx.distance <= ctx.weapon.range / 2;
    case "inArc":
      return ctx.arc === c.arc;
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
