/// <reference lib="webworker" />
import { parseModelFile } from "./parse";
import { processMesh, ready } from "./pipeline";
import type { AssetKind, ModelAsset } from "./types";

export interface ImportRequest {
  id: string;
  name: string;
  kind: AssetKind;
  bytes: ArrayBuffer;
}

export type ImportResponse = { ok: true; asset: ModelAsset } | { ok: false; error: string };

/** Parsing and simplifying a big sculpt takes seconds; it never runs on the render thread. */
self.onmessage = async (e: MessageEvent<ImportRequest>) => {
  const { id, name, kind, bytes } = e.data;
  try {
    await ready;
    const raw = await parseModelFile(name, bytes);
    const asset = processMesh(raw, { id, name, kind });
    const transfer = [...asset.lods, asset.proxy].flatMap((m) => [m.positions.buffer, m.indices.buffer]);
    // Levels can share a buffer when a mesh was already under budget.
    (self as DedicatedWorkerGlobalScope).postMessage(
      { ok: true, asset } satisfies ImportResponse,
      [...new Set(transfer)] as ArrayBuffer[],
    );
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies ImportResponse);
  }
};
