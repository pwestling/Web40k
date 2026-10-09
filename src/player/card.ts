import { create } from "zustand";
import { identity, setIdentity, sign, verifySignature, type Identity } from "../mail/keys";
import { isPlayerKey, type PlayerKey } from "../core/ranked";

/**
 * A player card (#65): the name and colours a player goes by, tied to this
 * device's signing key (the play-by-mail identity, mail/keys.ts). The key is
 * what ranked results are signed with, so the card's rating follows it; the
 * identity file carries it to another device. Nothing here leaves the device
 * unless the player exports it or plays a ranked game.
 */

interface PlayerCard {
  name: string;
  /** The player's colours: their side's, then a second for trim. */
  colors: [string, string];
}

const KEY = "open-battle:player-card";
const DEFAULT_COLORS: [string, string] = ["#3b82f6", "#f5c542"];
const hex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

function loadCard(): PlayerCard {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<PlayerCard> | null;
    const name = (raw?.name ?? localStorage.getItem("open-battle:name") ?? "").slice(0, 32);
    const colors = raw?.colors;
    return {
      name,
      colors:
        Array.isArray(colors) && hex(colors[0]) && hex(colors[1]) ? [colors[0], colors[1]] : DEFAULT_COLORS,
    };
  } catch {
    return { name: "", colors: DEFAULT_COLORS };
  }
}

export const useCard = create<PlayerCard & { key: PlayerKey | null }>(() => ({ ...loadCard(), key: null }));

useCard.subscribe((s, prev) => {
  if (s.name === prev.name && s.colors === prev.colors) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ name: s.name, colors: s.colors }));
    if (s.name.trim()) localStorage.setItem("open-battle:name", s.name.trim());
  } catch {
    // A private window: the card lasts until the page closes.
  }
});

export const keyOf = (pub: JsonWebKey): PlayerKey => `${pub.x ?? ""}.${pub.y ?? ""}`;

/** A key back as the public key it names. */
const jwk = (key: PlayerKey): JsonWebKey => {
  const [x, y] = key.split(".");
  return { kty: "EC", crv: "P-256", x, y, ext: true };
};

/** This device's player key, made on first use. */
export async function myKey(): Promise<PlayerKey> {
  const key = keyOf((await identity()).publicKey);
  if (useCard.getState().key !== key) useCard.setState({ key });
  return key;
}

/** Eight characters to tell keys apart at a glance: "Ana · 3f9K-2bQx". */
export const keyTag = (key: PlayerKey): string => `${key.slice(0, 4)}-${key.slice(4, 8)}`;

export async function signAsMe(text: string): Promise<string> {
  return sign(text, await identity());
}

export function signedBy(text: string, sig: string, key: PlayerKey): Promise<boolean> {
  return verifySignature(text, sig, jwk(key));
}

const FILE = "open-battle/player@1";

/** The identity file: the card and the key that signs for it. Private: whoever has it plays as you. */
export async function cardFile(): Promise<unknown> {
  const { name, colors } = useCard.getState();
  return { format: FILE, card: { name, colors }, identity: await identity() };
}

/**
 * Take in an identity file from another device. Returns false when it isn't
 * one (or its keys don't sign for each other).
 */
export async function importCardFile(raw: unknown): Promise<boolean> {
  const f = raw as { format?: unknown; card?: Partial<PlayerCard>; identity?: Partial<Identity> } | null;
  if (!f || f.format !== FILE || !f.identity?.publicKey || !f.identity.privateKey) return false;
  const id = f.identity as Identity;
  if (!isPlayerKey(keyOf(id.publicKey))) return false;
  // The private key must sign for the public one, or ranked results would never check.
  try {
    const probe = `open-battle-card:${Date.now()}`;
    if (!(await verifySignature(probe, await sign(probe, id), id.publicKey))) return false;
  } catch {
    return false;
  }
  setIdentity(id);
  const name = typeof f.card?.name === "string" ? f.card.name.slice(0, 32) : useCard.getState().name;
  const c = f.card?.colors;
  useCard.setState({
    name,
    colors: Array.isArray(c) && hex(c[0]) && hex(c[1]) ? [c[0], c[1]] : useCard.getState().colors,
    key: keyOf(id.publicKey),
  });
  return true;
}
