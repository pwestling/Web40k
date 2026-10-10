import { create } from "zustand";
import type { ArmyPack } from "../core/types";
import type { GameSystem } from "../core/content/schema";
import type { ImportedRoster } from "../systems/wh40k/roster";
import { applyPack, readFactionPack, type ReadPack } from "./faction";
import { t } from "../i18n";
import { MAX_PEER_BYTES, systemMatches, useLibrary, type StoredPackage } from "./library";

/**
 * Faction packs by URL (#76): the player pastes a link, the app fetches the
 * pack, shows what it adds and its hash, and asks before using it. Once they
 * say yes, the link is pinned to that hash: the same bytes load again without
 * asking, and different bytes at the link need their yes again. The project
 * hosts, lists and links no packs; the links are the player's.
 */

/** A link the player trusted, and the bytes it gave then. */
interface PackPin {
  url: string;
  hash: string;
  /** The pack's manifest id, name and version, and the systems it is for. */
  id: string;
  name: string;
  version: string;
  systems: string[];
  code: boolean;
  pinnedAt: number;
}

const KEY = "open-battle:faction-packs";

function stored(): Record<string, PackPin> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, PackPin>) : {};
  } catch {
    return {};
  }
}

/** This device's pinned pack links, by URL. */
export const usePins = create<{ pins: Record<string, PackPin> }>(() => ({ pins: stored() }));

function setPins(pins: Record<string, PackPin>): void {
  usePins.setState({ pins });
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(pins));
  } catch {
    // Private mode: pinned until the page closes.
  }
}

/** A pack fetched from a link, waiting for the player's answer. */
export interface PackOffer extends ReadPack {
  url: string;
  pkg: StoredPackage;
  /** "same": the link still gives the pinned bytes; "changed": it gives others now; "new": not pinned. */
  status: "new" | "same" | "changed";
  /** The hash pinned before, when the link changed. */
  was?: string;
  /** The player must say yes first: new bytes, or a changed link. */
  ask: boolean;
  /** The bytes weren't on this device before (Cancel takes them off again). */
  fresh: boolean;
}

/** A GitHub page link means its raw file. */
export function rawLink(url: string): string {
  return url
    .trim()
    .replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//, "https://raw.githubusercontent.com/$1/");
}

/** Fetch a pack from a link and read it, without running anything. */
export async function fetchPack(
  url: string,
  fetcher: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<PackOffer | { error: string }> {
  const link = rawLink(url);
  if (!/^https:\/\/[^\s/]+\//i.test(link)) return { error: t("Use an https:// link to the pack's file.") };
  let res: Response;
  try {
    res = await fetcher(link);
  } catch {
    return { error: t("Couldn't fetch that link (it may not allow other sites to read it).") };
  }
  if (!res.ok) return { error: t("That link answered {status}.", { status: res.status }) };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PEER_BYTES) return { error: t("That file is too big for a faction pack.") };
  const lib = useLibrary.getState();
  await lib.load();
  const before = { ...useLibrary.getState().packages };
  const added = await lib.add(bytes, { own: true });
  if (!added.ok) return { error: added.error };
  const fresh = !before[added.pkg.hash];
  const read = readFactionPack(added.pkg.source);
  if ("error" in read) {
    if (fresh) lib.remove(added.pkg.hash);
    return read;
  }
  const pin = usePins.getState().pins[link];
  const status = !pin ? "new" : pin.hash === added.pkg.hash ? "same" : "changed";
  return {
    ...read,
    url: link,
    pkg: added.pkg,
    status,
    ...(status === "changed" ? { was: pin!.hash } : {}),
    ask: status === "changed" || !added.pkg.trusted,
    fresh,
  };
}

/** The player said yes: the bytes are trusted and the link is pinned to them. */
export function acceptPack(offer: PackOffer): PackPin {
  useLibrary.getState().trust(offer.pkg.hash, true);
  const pin: PackPin = {
    url: offer.url,
    hash: offer.pkg.hash,
    id: offer.manifest.id,
    name: offer.manifest.name,
    version: offer.manifest.version,
    systems: offer.manifest.systems,
    code: offer.code,
    pinnedAt: Date.now(),
  };
  setPins({ ...usePins.getState().pins, [offer.url]: pin });
  return pin;
}

/** The player said no: bytes that only just came are taken off the device again; the old pin stays. */
export function declinePack(offer: PackOffer): void {
  if (offer.fresh && !offer.pkg.trusted) useLibrary.getState().remove(offer.pkg.hash);
}

/** Stop using a link (its bytes stay in the rules packages, where they can be removed). */
export function unpin(url: string): void {
  const { [url]: _gone, ...rest } = usePins.getState().pins;
  setPins(rest);
}

/** The army's ref for a pinned pack. */
export function packRef(pin: PackPin, bytes: number): ArmyPack {
  return {
    id: pin.id,
    name: pin.name,
    version: pin.version,
    hash: pin.hash,
    bytes,
    url: pin.url,
    ...(pin.code ? { code: true } : {}),
  };
}

/** The packs pinned for a game system whose bytes are here and trusted, read. */
export function pinnedFor(systemId: string): { pin: PackPin; pkg: StoredPackage; read: ReadPack }[] {
  const packages = useLibrary.getState().packages;
  return Object.values(usePins.getState().pins).flatMap((pin) => {
    const pkg = packages[pin.hash];
    if (!pkg?.trusted || !pin.systems.some((s) => systemMatches(s, systemId))) return [];
    const read = readFactionPack(pkg.source);
    return "error" in read ? [] : [{ pin, pkg, read }];
  });
}

/** An army with every pinned pack for its game put on it (a list just read, a shelf army, a sample). */
export function withPinnedPacks(
  roster: ImportedRoster,
  systemId: string,
  system: GameSystem,
): ImportedRoster {
  return pinnedFor(systemId).reduce(
    (r, { pin, pkg, read }) => applyPack(r, read.pack, packRef(pin, pkg.bytes), system).roster,
    roster,
  );
}
