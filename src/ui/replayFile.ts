import type { GameRecord } from "../core";
import { fromBase64, toBase64 } from "../assets/base64";
import { getCached, putCached } from "../assets/cache";
import { useAssets } from "../assets/store";
import { useLibrary } from "../packages/library";
import { gameId } from "../campaign/book";
import { carryNotes, cleanNotes, useNotes, type ReplayNote } from "../replay/notes";

/**
 * A replay file: the game record plus what it needs to look and play the
 * same on another device, the uploaded figures and terrain models (processed
 * assets, by file hash) and the rules packages (source, by hash). Readers
 * that don't know `attachments` still open the record.
 */
export interface ReplayFile extends GameRecord {
  attachments?: {
    /** Processed asset bytes (see assets/codec), base64, by asset id. */
    assets?: Record<string, string>;
    /** Package source text by SHA-256. */
    packages?: Record<string, string>;
  };
  /** Notes pinned to moments of the replay (src/replay/notes.ts). */
  annotations?: ReplayNote[];
}

const HASH = /^[0-9a-f]{64}$/;

/** Every uploaded asset (figures, terrain models) and rules package the record ever uses. */
export function replayRefs(record: GameRecord): { assets: string[]; packages: string[] } {
  const assets = new Set<string>();
  const packages = new Set<string>();
  const walk = (v: unknown, key?: string) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === "string" && HASH.test(x)) {
          if (k === "asset") assets.add(x);
          else if (k === "hash" && key === "packages") packages.add(x);
        } else walk(x, k);
      }
  };
  walk(record.initial);
  for (const { event } of record.events) walk(event);
  return { assets: [...assets], packages: [...packages] };
}

/** The record with every figure, terrain model and package this device has for it. */
export async function bundleReplay(record: GameRecord): Promise<ReplayFile> {
  const refs = replayRefs(record);
  // The codec (meshoptimizer) loads on demand: the front door doesn't need it.
  const { encodeAsset } = await import("../assets/codec");
  const assets: Record<string, string> = {};
  for (const id of refs.assets) {
    const asset = useAssets.getState().assets[id] ?? (await getCached(id));
    if (asset) assets[id] = toBase64(await encodeAsset(asset));
  }
  const packages: Record<string, string> = {};
  for (const hash of refs.packages) {
    const pkg = useLibrary.getState().packages[hash];
    if (pkg) packages[hash] = pkg.source;
  }
  // The notes on this game, when it's the one whose notes are open.
  const { game, notes } = useNotes.getState();
  const annotations = game && game === gameId(record) && notes.length ? { annotations: notes } : {};
  return { ...record, attachments: { assets, packages }, ...annotations };
}

/**
 * Read a replay file: keep what it carries on this device and return the
 * bare record. Packages are checked against their hash and stay untrusted
 * until the viewer says yes, as with packages from a player.
 */
export async function unbundleReplay(file: ReplayFile): Promise<GameRecord> {
  const { attachments, annotations, ...record } = file;
  carryNotes(record, cleanNotes(annotations));
  const { decodeAsset } = await import("../assets/codec");
  for (const [id, data] of Object.entries(attachments?.assets ?? {})) {
    if (!HASH.test(id) || useAssets.getState().assets[id]) continue;
    try {
      const asset = { ...(await decodeAsset(fromBase64(data))), id };
      useAssets.getState().addAsset(asset);
      void putCached(asset);
    } catch {
      // A damaged figure: the model shows its plain stand-in.
    }
  }
  await useLibrary.getState().load();
  for (const [hash, source] of Object.entries(attachments?.packages ?? {}))
    await useLibrary.getState().add(new TextEncoder().encode(source), { expect: hash });
  return record;
}
