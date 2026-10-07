import { useEffect } from "react";
import type { SideMessage } from "../net/transport";
import { useStore } from "../store";
import { getCached, putCached } from "./cache";
import { decodeAsset, encodeAsset, fromBase64, MAX_ASSET_BYTES, toBase64 } from "./codec";
import { useAssets } from "./store";

/** Base64 characters per message. Trystero splits big messages itself; this keeps each one modest. */
const PART_CHARS = 48 * 1024;
/** Ask again for a figure nobody has sent, this often. */
const RETRY_MS = 4000;

const asked = new Map<string, number>();
const incoming = new Map<string, { parts: string[]; got: number; from: string; at: number }>();
/** A transfer that stalls this long (the sender left) is dropped and asked for again. */
const STALL_MS = 15000;

/**
 * Figures travel peer to peer: game state names each model's figure by file
 * hash, and whoever is missing one asks the room for it. Anyone who has the
 * processed meshes (the uploader, or anyone who already got them) answers.
 * Only the simplified levels are sent, a few hundred KB per sculpt.
 */
export function useAssetSharing() {
  const session = useStore((s) => s.session);
  const models = useStore((s) => s.game.models);
  const assets = useAssets((s) => s.assets);

  useEffect(() => {
    if (!session) return;
    session.listenSide(
      (message, from) => void receive(message, from),
      () => asked.clear(),
    );
    return () => session.listenSide(null);
  }, [session]);

  useEffect(() => {
    const missing = [
      ...new Set(Object.values(models).flatMap((m) => (m.figure ? [m.figure.asset] : []))),
    ].filter((id) => !assets[id]);
    if (!missing.length) return;
    const fetchAll = () => missing.forEach((id) => void fetchAsset(id));
    fetchAll();
    const timer = setInterval(fetchAll, RETRY_MS);
    return () => clearInterval(timer);
  }, [models, assets]);
}

async function fetchAsset(id: string) {
  if (useAssets.getState().assets[id]) return;
  const pending = incoming.get(id);
  if (pending && Date.now() - pending.at < STALL_MS) return;
  incoming.delete(id);
  const cached = await getCached(id);
  if (cached) {
    useAssets.getState().addAsset(cached);
    return;
  }
  const last = asked.get(id) ?? 0;
  if (Date.now() - last < RETRY_MS - 100) return;
  asked.set(id, Date.now());
  useStore.getState().session?.sendSide({ t: "asset/want", id });
}

async function receive(message: SideMessage, from: string) {
  const session = useStore.getState().session;
  if (!session) return;
  if (message.t === "asset/want") {
    const asset = useAssets.getState().assets[message.id] ?? (await getCached(message.id));
    if (!asset) return;
    const text = toBase64(encodeAsset(asset));
    const parts = Math.ceil(text.length / PART_CHARS);
    for (let part = 0; part < parts; part++)
      session.sendSide(
        {
          t: "asset/part",
          id: asset.id,
          part,
          parts,
          data: text.slice(part * PART_CHARS, (part + 1) * PART_CHARS),
        },
        from,
      );
    return;
  }
  // Only take parts for figures we asked for, and from one sender at a time.
  const { id, part, parts, data } = message;
  if (!asked.has(id) || useAssets.getState().assets[id]) return;
  if (!Number.isInteger(parts) || parts < 1 || parts * PART_CHARS > (MAX_ASSET_BYTES * 4) / 3 + PART_CHARS)
    return;
  let entry = incoming.get(id);
  if (!entry) incoming.set(id, (entry = { parts: new Array<string>(parts), got: 0, from, at: 0 }));
  if (entry.from !== from || entry.parts.length !== parts || part < 0 || part >= parts || entry.parts[part])
    return;
  entry.parts[part] = data;
  entry.at = Date.now();
  if (++entry.got < parts) return;
  incoming.delete(id);
  try {
    const asset = decodeAsset(fromBase64(entry.parts.join("")));
    if (asset.id !== id) return;
    useAssets.getState().addAsset(asset);
    void putCached(asset);
  } catch {
    // A bad copy: forget it and ask again.
    asked.delete(id);
  }
}
