import { sha256Hex } from "./secrets";
import type { Rng } from "./actions";
import type { GameState, PlayerId } from "./types";

/**
 * Shared dice for ranked games (docs/compatibility.md): no one device decides
 * a roll. The host commits to a secret seed (its SHA-256) and the other
 * ranked player answers with a seed of their own, in the clear, after the
 * commitment is in the log. Each event's dice come from both seeds and the
 * event's number. The host reveals its seed when the battle round ends, and
 * the other player's app re-rolls every event of the round from the log and
 * checks it came out the same (src/ranked/dice.ts).
 *
 * The host can't pick its seed after seeing the other's, and the other can't
 * know the host's, so neither steers the dice. What is left: the host knows
 * the round's dice once both seeds are in, so a modified host could see a roll
 * coming. Dice that answer each roll with the other player's fresh seed would
 * close that, at a message per roll.
 */

const DOMAIN = "open-battle/shared-dice@1";

export interface SharedDice {
  /** The host who committed. */
  by: PlayerId;
  commit: string;
  /** Each other ranked player's seed, once sent. */
  seeds: Record<PlayerId, string>;
  /** The battle round the commitment was made in. */
  round: number;
  /** The event that made the commitment. */
  from: number;
}

export const isSeed = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);

/** The commitment to a secret seed. */
export const commitTo = (seed: string) => sha256Hex(`${DOMAIN}:commit:${seed}`);

/** Every ranked player has sent their seed: the dice can't be steered from here. */
export function seeded(state: GameState): boolean {
  const d = state.sharedDice;
  if (!d || !state.ranked) return false;
  return Object.keys(state.ranked.keys).every((p) => p === d.by || !!d.seeds[p]);
}

/** The dice for event `seq`, from the host's secret seed and everyone's answers. */
export function sharedRng(secret: string, seeds: Record<PlayerId, string>, seq: number): Rng {
  const mixed = Object.keys(seeds)
    .sort()
    .map((p) => `${p}=${seeds[p]}`)
    .join(",");
  const hex = sha256Hex(`${DOMAIN}:${secret}:${mixed}:${seq}`);
  const word = (i: number) => parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0;
  return sfc32(word(0), word(1), word(2), word(3));
}

function sfc32(a: number, b: number, c: number, d: number): Rng {
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}
