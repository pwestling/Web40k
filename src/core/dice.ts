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

/** One die. Every roll in the engine goes through here, so players can roll their own dice instead (#37). */
export function die(rng: Rng, sides: number): number {
  const told = (rng as Partial<ToldRng>).die;
  return told ? told(sides) : 1 + Math.floor(rng() * sides);
}

/**
 * Dice rolled at the table (#37, table companion): a player rolls real dice
 * and types the faces in. `die` takes them in order; anything else random
 * (a seed, a scatter) still comes from `fallback`.
 */
export interface ToldRng extends Rng {
  die(sides: number): number;
  /** How many faces have been used. */
  used(): number;
}

/** Thrown when a roll wants more dice than were told: the player rolls these next. */
export class NeedDice extends Error {
  constructor(
    readonly sides: number,
    /** Faces already used before this one. */
    readonly after: number,
  ) {
    super(`Roll a D${sides}`);
  }
}

/** A face told that the die doesn't have, such as a 7 on a D6. */
export class BadFace extends Error {
  constructor(
    readonly sides: number,
    readonly face: number,
  ) {
    super(`A D${sides} can't show ${face}`);
  }
}

/**
 * An Rng that gives the told faces, in order. Past the end it throws NeedDice,
 * or, given `then`, asks that for the face instead (a dry run counting what's
 * still to roll).
 */
export function toldRng(faces: readonly number[], fallback: Rng, then?: (sides: number) => number): ToldRng {
  let i = 0;
  const rng = (() => fallback()) as ToldRng;
  rng.die = (sides) => {
    if (i >= faces.length) {
      if (!then) throw new NeedDice(sides, i);
      i++;
      return then(sides);
    }
    const f = faces[i]!;
    if (!Number.isInteger(f) || f < 1 || f > sides) throw new BadFace(sides, f);
    i++;
    return f;
  };
  rng.used = () => i;
  return rng;
}

export function rollDice(expr: DiceExpr, rng: Rng): { rolls: number[]; total: number } {
  const rolls = Array.from({ length: expr.count }, () => die(rng, expr.sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, expr.bonus) };
}

export function averageDice(expr: DiceExpr): number {
  return expr.count * ((expr.sides + 1) / 2) + expr.bonus;
}
