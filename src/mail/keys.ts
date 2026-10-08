/**
 * A device's signing key for play by mail (ECDSA P-256, WebCrypto). Each
 * file is signed; the first file from a player ties their public key to their
 * seat, and later files from that seat must carry the same key. It tells a
 * player the turn really came from their opponent's device, not someone else.
 */

const KEY = "open-battle:mail-identity";
const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

export interface Identity {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

let cached: Identity | null = null;

/** This device's identity, made on first use and kept in localStorage. */
export async function identity(): Promise<Identity> {
  if (cached) return cached;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return (cached = JSON.parse(saved) as Identity);
  } catch {
    // No storage (private window): a key for this session only.
  }
  const pair = (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  cached = {
    publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey),
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // As above.
  }
  return cached;
}

/** A short, stable name for a public key, to compare at a glance. */
export function keyId(key: JsonWebKey): string {
  return `${key.x ?? ""}${key.y ?? ""}`.slice(0, 16);
}

export async function sign(text: string, id: Identity): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", id.privateKey, ALG, false, ["sign"]);
  const sig = await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifySignature(text: string, sig: string, publicKey: JsonWebKey): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("jwk", publicKey, ALG, false, ["verify"]);
    const bytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify(SIGN, key, bytes, new TextEncoder().encode(text));
  } catch {
    return false;
  }
}
