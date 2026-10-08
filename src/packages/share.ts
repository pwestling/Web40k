import { useEffect } from "react";
import { create } from "zustand";
import { fromBase64, toBase64 } from "../assets/base64";
import type { SideMessage } from "../net/transport";
import { useStore } from "../store";
import { MAX_PEER_BYTES, useLibrary } from "./library";

/** Base64 characters per message, as for figures. */
const PART_CHARS = 48 * 1024;
/** A transfer that stalls this long (the sender left) can be asked for again. */
const STALL_MS = 15000;

type Transfer =
  | { state: "asking"; at: number }
  | { state: "receiving"; got: number; parts: number; from: string; at: number }
  | { state: "checked" }
  | { state: "failed"; error: string };

interface Transfers {
  byHash: Record<string, Transfer>;
  /** What each other peer says it is still getting, for "getting rules…" in the people list. */
  peerMissing: Record<string, string[]>;
  /** Hashes whose package arrives already trusted ("Trust packages Player 1 sends"). */
  trustOnArrival: Record<string, boolean>;
}

export const useTransfers = create<Transfers>(() => ({ byHash: {}, trustOnArrival: {}, peerMissing: {} }));

const incoming = new Map<string, string[]>();

function setTransfer(hash: string, t: Transfer) {
  useTransfers.setState((s) => ({ byHash: { ...s.byHash, [hash]: t } }));
}

/**
 * Ask the room for a rules package by hash. Whoever has it sends it; the
 * bytes are checked against the hash before they are kept. Nothing runs.
 */
export function requestPackage(hash: string, opts: { trust?: boolean } = {}): void {
  const session = useStore.getState().session;
  if (!session || useLibrary.getState().packages[hash]) return;
  if (opts.trust !== undefined)
    useTransfers.setState((s) => ({ trustOnArrival: { ...s.trustOnArrival, [hash]: !!opts.trust } }));
  const now = Date.now();
  const t = useTransfers.getState().byHash[hash];
  if (t && (t.state === "asking" || t.state === "receiving") && now - t.at < STALL_MS) return;
  incoming.delete(hash);
  setTransfer(hash, { state: "asking", at: now });
  session.sendSide({ t: "package/want", hash });
}

/** Percent received, for "Receiving… 60%". */
export function transferPercent(t: Transfer | undefined): number {
  if (!t) return 0;
  if (t.state === "checked") return 100;
  if (t.state !== "receiving") return 0;
  return Math.floor((t.got / t.parts) * 100);
}

/** Answer other peers' requests for packages this device holds, and take in the ones we asked for. */
export function usePackageSharing() {
  const session = useStore((s) => s.session);
  const wanted = useStore((s) => s.game.packages?.packages);
  const library = useLibrary((s) => s.packages);
  const loaded = useLibrary((s) => s.loaded);
  // What this peer is still getting: told to everyone when it changes, and to each peer that arrives.
  const missing = loaded ? (wanted ?? []).filter((p) => !library[p.hash]).map((p) => p.hash) : [];
  const key = missing.join();
  useEffect(() => {
    if (!session) return;
    const status = () => (key ? key.split(",") : []);
    session.listenSide(
      (message, from) => void receive(message, from),
      (peer) => session.sendSide({ t: "package/status", missing: status() }, peer),
      "packages",
    );
    session.sendSide({ t: "package/status", missing: status() });
    return () => session.listenSide(null, null, "packages");
  }, [session, key]);
}

async function receive(message: SideMessage, from: string) {
  const session = useStore.getState().session;
  if (!session) return;
  if (message.t === "package/want") {
    const pkg = useLibrary.getState().packages[message.hash];
    // Bigger packages load from a file; the asker's screen already says so.
    if (!pkg || pkg.bytes > MAX_PEER_BYTES) return;
    const text = toBase64(new TextEncoder().encode(pkg.source));
    const parts = Math.max(1, Math.ceil(text.length / PART_CHARS));
    for (let part = 0; part < parts; part++)
      session.sendSide(
        {
          t: "package/part",
          hash: pkg.hash,
          part,
          parts,
          data: text.slice(part * PART_CHARS, (part + 1) * PART_CHARS),
        },
        from,
      );
    return;
  }
  if (message.t === "package/status") {
    if (!Array.isArray(message.missing)) return;
    const missing = message.missing.filter((h) => typeof h === "string");
    useTransfers.setState((s) => ({ peerMissing: { ...s.peerMissing, [from]: missing } }));
    return;
  }
  if (message.t !== "package/part") return;
  const { hash, part, parts, data } = message;
  const t = useTransfers.getState().byHash[hash];
  // Only packages we asked for, from the first peer that answers.
  if (!t || (t.state !== "asking" && t.state !== "receiving")) return;
  if (!Number.isInteger(parts) || parts < 1 || parts * PART_CHARS > (MAX_PEER_BYTES * 4) / 3 + PART_CHARS)
    return;
  if (t.state === "receiving" && (t.from !== from || t.parts !== parts)) return;
  if (!Number.isInteger(part) || part < 0 || part >= parts) return;
  let got = incoming.get(hash);
  if (!got) incoming.set(hash, (got = new Array<string>(parts)));
  if (got[part] !== undefined) return;
  got[part] = data;
  const count = got.filter((x) => x !== undefined).length;
  setTransfer(hash, { state: "receiving", got: count, parts, from, at: Date.now() });
  if (count < parts) return;
  incoming.delete(hash);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(got.join(""));
  } catch {
    setTransfer(hash, { state: "failed", error: "That didn't match what the game expects." });
    return;
  }
  const added = await useLibrary.getState().add(bytes, { expect: hash });
  if (!added.ok) {
    setTransfer(hash, { state: "failed", error: added.error });
    return;
  }
  if (useTransfers.getState().trustOnArrival[hash]) useLibrary.getState().trust(hash, true);
  setTransfer(hash, { state: "checked" });
}
