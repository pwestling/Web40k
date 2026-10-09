import { stateAt, type GameRecord } from "../core/log";
import { canonResult, DECLINE_WHYS, rankedOver, type DeclineWhy, type RankedResult } from "../core/ranked";
import { signedBy } from "../player/card";

/**
 * Ranked results (#65) as they travel: the result and both players'
 * signatures. Every client checks both signatures itself, whoever passed the
 * result on, and only then counts it (ratings.ts).
 */
export interface SignedResult {
  result: RankedResult;
  /** By seat, as the result's players. */
  sigs: [string, string];
}

/**
 * A result one player signed and the other declined (PX ranked 1), with the
 * decliner's own signature on their refusal: it never counts on the ladder,
 * but it counts in the sign rate, and nobody can make one up for someone else.
 */
export interface DeclinedResult {
  result: RankedResult;
  /** By seat: the signer's signature, null for the decliner. */
  sigs: [string | null, string | null];
  declined: { seat: 0 | 1; why: Exclude<DeclineWhy, "score">; sig: string };
}

/** What a player signs: the result in its one spelling, marked so the signature means nothing else. */
export const signingText = (canon: string) => `open-battle-result:${canon}`;

/** What a player signs to decline a result, and why. */
export const declineText = (canon: string, why: DeclineWhy) => `open-battle-decline:${why}:${canon}`;

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The event that ended the battle (the first after which it is over), or the last there is. */
function battleEndSeq(record: GameRecord): number {
  const seqs = record.events.map((e) => e.seq);
  let lo = 0;
  let hi = seqs.length - 1;
  if (hi < 0 || !rankedOver(stateAt(record, seqs[hi]))) return seqs[hi] ?? 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rankedOver(stateAt(record, seqs[mid]))) hi = mid;
    else lo = mid + 1;
  }
  return seqs[lo]!;
}

/**
 * The replay a result names: the game's events up to the one that ended the
 * battle, ranked bookkeeping left out. Whatever is logged after (scoring
 * hooks, the result itself) can't change it, so both players hash the same game.
 */
export function replayHash(record: GameRecord, upto = battleEndSeq(record)): Promise<string> {
  const events = record.events.filter((e) => e.seq <= upto && !e.event.type.startsWith("ranked/"));
  return sha256(JSON.stringify(events));
}

/** A signed result checked: both signatures, by the two players it names. Null if it doesn't hold. */
export async function checkSigned(raw: unknown): Promise<SignedResult | null> {
  const r = raw as Partial<SignedResult> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.sigs) || r.sigs.length !== 2) return null;
  const canon = canonResult(r.result);
  if (!canon || !r.sigs.every((s) => typeof s === "string" && s.length <= 200)) return null;
  const result = JSON.parse(canon) as RankedResult;
  const text = signingText(canon);
  const ok = await Promise.all(result.players.map((p, i) => signedBy(text, r.sigs![i]!, p.key)));
  return ok.every(Boolean) ? { result, sigs: [r.sigs[0]!, r.sigs[1]!] } : null;
}

/** A declined result checked: the signer's signature on it, and the decliner's on their refusal. */
export async function checkDeclined(raw: unknown): Promise<DeclinedResult | null> {
  const r = raw as Partial<DeclinedResult> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.sigs) || r.sigs.length !== 2) return null;
  const d = r.declined;
  if (!d || (d.seat !== 0 && d.seat !== 1) || typeof d.sig !== "string" || d.sig.length > 200) return null;
  if (!DECLINE_WHYS.includes(d.why) || (d.why as DeclineWhy) === "score") return null;
  const canon = canonResult(r.result);
  const signer = r.sigs[1 - d.seat];
  if (!canon || typeof signer !== "string" || signer.length > 200 || r.sigs[d.seat] !== null) return null;
  const result = JSON.parse(canon) as RankedResult;
  const [signed, declined] = await Promise.all([
    signedBy(signingText(canon), signer, result.players[1 - d.seat]!.key),
    signedBy(declineText(canon, d.why), d.sig, result.players[d.seat]!.key),
  ]);
  if (!signed || !declined) return null;
  const sigs: [string | null, string | null] = d.seat === 0 ? [null, signer] : [signer, null];
  return { result, sigs, declined: { seat: d.seat, why: d.why, sig: d.sig } };
}
