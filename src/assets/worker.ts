/// <reference lib="webworker" />
import { parseModelFile } from "./parse";
import { processModel, ready } from "./pipeline";
import { assetBuffers, BUDGETS, type AssetKind, type ModelAsset } from "./types";

export interface ImportRequest {
  id: string;
  name: string;
  kind: AssetKind;
  bytes: ArrayBuffer;
  /** A diffuse image for an OBJ, which has none of its own. */
  texture?: ArrayBuffer;
  /** Inches per source unit, when the source says (a Tabletop Simulator object's scale). */
  unitScale?: number;
}

export type ImportResponse = { ok: true; asset: ModelAsset } | { ok: false; error: string };

/** Parsing and simplifying a big sculpt takes seconds; it never runs on the render thread. */
self.onmessage = async (e: MessageEvent<ImportRequest>) => {
  const { id, name, kind, bytes, texture, unitScale } = e.data;
  try {
    await ready;
    const raw = await parseModelFile(name, bytes, BUDGETS[kind].texture.side, texture);
    const asset = await processModel(raw, { id, name, kind, ...(unitScale ? { unitScale } : {}) });
    (self as DedicatedWorkerGlobalScope).postMessage(
      { ok: true, asset } satisfies ImportResponse,
      assetBuffers(asset),
    );
  } catch (err) {
    self.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies ImportResponse);
  }
};
