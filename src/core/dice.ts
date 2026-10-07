import type { Rng } from "./actions";

/** A dice expression such as "D6", "2D3+1" or "4", as printed on datasheets. */
export interface DiceExpr {
  count: number;
  sides: number;
  bonus: number;
}

const DICE_RE = /^\s*(?:(\d*)\s*[dD]\s*(\d+))?\s*(?:([+-]?)\s*(\d+))?\s*$/;

export function parseDice(text: string): DiceExpr {
  const m = DICE_RE.exec(text);
  if (!m || (m[2] === undefined && m[4] === undefined)) throw new Error(`Not a dice expression: "${text}"`);
  const [, count, sides, sign, flat] = m;
  // A bare number with no "+" in front ("4") is a flat value; "D6+1" adds a bonus.
  const bonus = flat === undefined ? 0 : Number(flat) * (sign === "-" ? -1 : 1);
  if (sides === undefined) return { count: 0, sides: 0, bonus };
  return { count: count ? Number(count) : 1, sides: Number(sides), bonus };
}

export function rollDice(expr: DiceExpr, rng: Rng): { rolls: number[]; total: number } {
  const rolls = Array.from({ length: expr.count }, () => 1 + Math.floor(rng() * expr.sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, expr.bonus) };
}

export function averageDice(expr: DiceExpr): number {
  return expr.count * ((expr.sides + 1) / 2) + expr.bonus;
}
