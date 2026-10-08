import { unitGap, type GameState, type TrayRoll, type Unit } from "../core";
import { systemModule } from "../systems";
import { aliveModels } from "../systems/wh40k/rules";
import { moveBudget } from "./regiment";
import { opposed } from "../core/teams";
import { t } from "../i18n";

/**
 * A decisive roll: a charge, a summed test (leadership, break) or the save
 * of a unit's last model or a character, with 1-3 dice and a real doubt
 * (15-85%). The tray stretches its last die and ends on a banner. The chance
 * only picks the rolls; it is never shown.
 */
export interface Stakes {
  /** Went the roller's way. */
  good: boolean;
  big: string;
  small: string;
}

const DOUBT = [0.15, 0.85] as const;
const doubtful = (p: number) => p >= DOUBT[0] && p <= DOUBT[1];

export function stakesOf(roll: TrayRoll, before: GameState, after: GameState): Stakes | null {
  const n = roll.dice.length;
  if (n < 1 || n > 3) return null;
  const values = roll.dice.map((d) => d.value);
  const total = values.reduce((a, b) => a + b, 0);

  if (roll.label && /charge/i.test(roll.label) && roll.unitId) {
    const unit = before.units[roll.unitId];
    const target = unit && chargeTarget(before, unit);
    if (!unit || !target) return null;
    const gap = unitGap(before, unit, target);
    const ranked = systemModule(before.system).chargeRoll;
    let reach: number, chance: number, need: number;
    if (ranked) {
      // Rank and flank: the highest die (or the total) plus the unit's move.
      const move = moveBudget(before, unit).move ?? 0;
      const die = ranked.keep === "highest" ? Math.max(...values) : total;
      need = gap - move;
      reach = die + move;
      chance = ranked.keep === "highest" ? atLeastMax(n, roll.sides, need) : atLeastSum(n, roll.sides, need);
    } else {
      // 40k: end within engagement range (1") of the target.
      need = gap - 1;
      reach = total;
      chance = atLeastSum(n, roll.sides, need);
    }
    if (!doubtful(chance)) return null;
    const made = ranked ? reach >= gap - 0.05 : total >= need - 0.05;
    return {
      good: made,
      big: made ? t("Charge!") : t("Short"),
      small: t("{reach}, needed {need} to reach {unit}", {
        reach: fmt(ranked ? reach : total),
        need: fmt(ranked ? gap : need),
        unit: target.name,
      }),
    };
  }

  if (roll.sum && roll.passed !== undefined && roll.need != null) {
    const chance =
      roll.compare === "atMost"
        ? 1 - atLeastSum(n, roll.sides, roll.need + 1)
        : atLeastSum(n, roll.sides, roll.need);
    if (!doubtful(chance)) return null;
    const sign = roll.compare === "atMost" ? t("{n} or less", { n: roll.need }) : `${roll.need}+`;
    return {
      good: roll.passed,
      big: roll.passed ? t("Passed") : t("Failed"),
      small: t("{test}: {total}, needed {need}", {
        test: roll.title.replace(/\s+\S+$/, ""),
        total,
        need: sign,
      }),
    };
  }

  if (roll.defender && roll.step && /save/i.test(roll.step) && roll.need != null && roll.targetId) {
    const unit = before.units[roll.targetId];
    if (!unit) return null;
    const last = aliveModels(before, unit).length <= 1;
    const character = unit.sheet?.keywords?.some((k) => /character/i.test(k)) ?? false;
    if (!last && !character) return null;
    const p = Math.max(0, Math.min(1, (roll.sides + 1 - roll.need) / roll.sides));
    if (!doubtful(p ** n)) return null;
    const saved = roll.dice.every((d) => d.ok);
    const gone = aliveModels(after, after.units[roll.targetId]).length === 0;
    return {
      good: saved,
      big: saved ? t("Saved") : gone ? t("Slain") : t("Wounded"),
      small: t("{unit}, saving on {need}+: rolled {dice}", {
        unit: unit.name,
        need: roll.need,
        dice: values.join(", "),
      }),
    };
  }
  return null;
}

/** The charge declared this round, or the nearest enemy. */
function chargeTarget(state: GameState, unit: Unit): Unit | undefined {
  const declared = state.modules?.[state.system ?? ""]?.[`charge:${unit.id}`] as
    { target?: string; round?: number } | undefined;
  if (declared?.round === state.turn.round && declared.target && state.units[declared.target])
    return state.units[declared.target];
  let best: Unit | undefined;
  let gap = Infinity;
  for (const u of Object.values(state.units)) {
    if (!opposed(state, u.owner, unit.owner) || !aliveModels(state, u).length) continue;
    const d = unitGap(state, unit, u);
    if (d < gap) [best, gap] = [u, d];
  }
  return best;
}

/** P(sum of n dice of `sides` faces >= need). */
export function atLeastSum(n: number, sides: number, need: number): number {
  let dist = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(dist.length + sides).fill(0);
    dist.forEach((p, s) => {
      for (let f = 1; f <= sides; f++) next[s + f]! += p / sides;
    });
    dist = next;
  }
  return dist.reduce((a, p, s) => (s >= need ? a + p : a), 0);
}

/** P(highest of n dice >= need). */
export function atLeastMax(n: number, sides: number, need: number): number {
  const k = Math.ceil(need);
  if (k <= 1) return 1;
  if (k > sides) return 0;
  return 1 - ((k - 1) / sides) ** n;
}

const fmt = (n: number) => `${Number(n.toFixed(1))}"`;
