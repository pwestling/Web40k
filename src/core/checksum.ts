import type { GameEvent } from "./actions";
import type { GameState } from "./types";

/**
 * A fingerprint of the game state, so peers can tell their tables apart.
 *
 * It hashes a canonical form: object keys sorted, undefined dropped, and
 * fractional numbers rounded to 1e-4, because Math.sin and friends may differ
 * in the last bit between browser engines. The rounding is only for the hash;
 * the state is untouched. cyrb53 is fast and good enough to spot a desync (it
 * is not meant to resist tampering).
 */
export function stateHash(state: GameState): number {
  return cyrb53(canonical(state));
}

/** How often the host sends a checksum: every this many events, and at each phase change. */
export const CHECK_EVERY = 10;

/** Whether the state after this event is a checkpoint every peer hashes. */
export function isCheckpoint(seq: number, event: GameEvent): boolean {
  return seq % CHECK_EVERY === 0 || event.type.startsWith("turn/");
}

export function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "number":
      // -0 and 0 hash alike.
      if (Object.is(value, -0)) return "0";
      return Number.isInteger(value) || !Number.isFinite(value)
        ? String(value)
        : String(Math.round(value * 1e4) / 1e4);
    case "string":
      return quote(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      // Plain string building: V8 joins these as ropes, faster than an array of parts (perf/notes.md).
      if (Array.isArray(value)) {
        let out = "[";
        for (let i = 0; i < value.length; i++) out += (i ? "," : "") + canonical(value[i]);
        return out + "]";
      }
      const o = value as Record<string, unknown>;
      let out = "{";
      let first = true;
      for (const k of Object.keys(o).sort()) {
        if (o[k] === undefined) continue;
        out += (first ? "" : ",") + quote(k) + ":" + canonical(o[k]);
        first = false;
      }
      return out + "}";
    }
    default:
      return "null";
  }
}

/** Strings JSON.stringify would only wrap in quotes (no escapes, no lone surrogates) skip it. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what JSON escapes
const PLAIN = /^[^"\\\u0000-\u001f\ud800-\udfff]*$/;
const quote = (s: string) => (PLAIN.test(s) ? `"${s}"` : JSON.stringify(s));

/** cyrb53 (public domain, bryc): a 53-bit string hash. */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
