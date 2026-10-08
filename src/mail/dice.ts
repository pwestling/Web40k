import type { Rng } from "../core";

/**
 * Dice for play by mail, which no one device decides.
 *
 * Each file a player sends commits to a fresh secret seed (its SHA-256) and
 * reveals the seed it committed to last time. The dice for a file's stretch
 * of play come from that revealed seed mixed with the opponent's latest
 * commitment. The sender picked their seed before the opponent's commitment
 * existed, and the opponent picked theirs without knowing the sender's seed,
 * so neither could steer the result; the receiver checks every roll by
 * replaying the file (verify.ts).
 *
 * The first file of each player has no earlier seed, so its dice come from
 * what is known (the game id, the other side's commitment): those files set
 * the game up, and their dice are fair to neither side in particular.
 */

const DOMAIN = "open-battle/mail-dice@1";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh secret seed: 32 random bytes, hex. */
export function newSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The commitment to a seed, sent ahead of the seed itself. */
export function commitTo(seed: string): Promise<string> {
  return sha256Hex(`${DOMAIN}:commit:${seed}`);
}

/** What a file's dice are drawn from. */
export interface DiceKey {
  game: string;
  /** The file's number in the game. */
  index: number;
  /** The sender's seed, committed in their previous file. */
  reveal: string | null;
  /** The opponent's latest commitment when this file's play began. */
  theirs: string | null;
}

/** The stretch of play's dice, as a sync Rng (sfc32 keyed by a SHA-256 of the key). */
export async function segmentRng(key: DiceKey): Promise<Rng> {
  const hex = await sha256Hex(`${DOMAIN}:${key.game}:${key.index}:${key.reveal ?? ""}:${key.theirs ?? ""}`);
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
  // Stir the key in before the first draw.
  for (let i = 0; i < 12; i++) next();
  return next;
}
