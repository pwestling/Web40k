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
  const out: string[] = [];
  write(value, out);
  return out.join("");
}

function write(v: unknown, out: string[]): void {
  if (v === null || v === undefined) {
    out.push("null");
    return;
  }
  switch (typeof v) {
    case "number":
      out.push(Number.isInteger(v) || !Number.isFinite(v) ? String(v) : String(Math.round(v * 1e4) / 1e4));
      // -0 and 0 hash alike.
      if (Object.is(v, -0)) out[out.length - 1] = "0";
      return;
    case "string":
      out.push(JSON.stringify(v));
      return;
    case "boolean":
      out.push(v ? "true" : "false");
      return;
    case "object":
      if (Array.isArray(v)) {
        out.push("[");
        v.forEach((x, i) => {
          if (i) out.push(",");
          write(x, out);
        });
        out.push("]");
        return;
      } else {
        const o = v as Record<string, unknown>;
        const keys = Object.keys(o)
          .filter((k) => o[k] !== undefined)
          .sort();
        out.push("{");
        keys.forEach((k, i) => {
          if (i) out.push(",");
          out.push(JSON.stringify(k), ":");
          write(o[k], out);
        });
        out.push("}");
        return;
      }
    default:
      out.push("null");
  }
}

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
