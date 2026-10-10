import { create } from "zustand";
import type { Model, ModelFigure, UnitId } from "../core";
import { useStore } from "../store";
import { getCached, putCached } from "./cache";
import type { ImportRequest, ImportResponse } from "./worker";
import type { AssetKind, ModelAsset } from "./types";

/**
 * Models are dressed by profile name ("Line Trooper"), so one upload covers
 * every model of that kind. Falls back to the label for unprofiled models.
 */
export function bindingKey(model: Pick<Model, "profile" | "label">): string {
  return model.profile?.name ?? model.label;
}

/** Every profile key among `models`, in model order. */
export function unitKeys(models: Pick<Model, "profile" | "label">[]): string[] {
  return [...new Set(models.map(bindingKey))];
}

interface AssetStore {
  /** Processed assets loaded in this browser, by file hash. */
  assets: Record<string, ModelAsset>;
  /** Imports in progress or failed, by unit id. */
  status: Record<string, string>;
  /** Simplify a file (or fetch it from this browser's cache). Null if it failed; `status` says why. */
  importFile(
    file: File,
    statusKey: string,
    kind?: AssetKind,
    extra?: ImportExtra,
  ): Promise<ModelAsset | null>;
  /** Import a file and give it to the models in `keys` of a unit, for everyone in the game. */
  dressUnit(unitId: UnitId, keys: string[], file: File): Promise<void>;
  addAsset(asset: ModelAsset): void;
}

/** What a source beyond the file itself says: an OBJ's diffuse image, its size in inches (TTS). */
export interface ImportExtra {
  texture?: Blob;
  unitScale?: number;
}

let worker: Worker | null = null;
const waiting = new Map<number, (r: ImportResponse) => void>();
let nextJob = 0;

/** Imports run one at a time on a single worker; each can hold a few hundred MB. */
let queue = Promise.resolve();

function runImport(request: ImportRequest): Promise<ImportResponse> {
  const job = queue.then(
    () =>
      new Promise<ImportResponse>((resolve) => {
        worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
        const n = nextJob++;
        waiting.set(n, resolve);
        worker.onmessage = (e: MessageEvent<ImportResponse>) => {
          waiting.get(n)?.(e.data);
          waiting.delete(n);
        };
        worker.onerror = (e) => {
          waiting.get(n)?.({ ok: false, error: e.message || "The import worker crashed." });
          waiting.delete(n);
          worker?.terminate();
          worker = null;
        };
        worker.postMessage(request, request.texture ? [request.bytes, request.texture] : [request.bytes]);
      }),
  );
  queue = job.then(() => undefined);
  return job;
}

async function hash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const useAssets = create<AssetStore>((set, get) => ({
  assets: {},
  status: {},

  async importFile(file, statusKey, kind = "miniature", extra) {
    const setStatus = (text: string | null) =>
      set((s) => {
        const status = { ...s.status };
        if (text === null) delete status[statusKey];
        else status[statusKey] = text;
        return { status };
      });
    setStatus(`Reading ${file.name}…`);
    const bytes = await file.arrayBuffer();
    const texture = await extra?.texture?.arrayBuffer();
    // The image and size change the model, so they're part of its id.
    const id =
      texture || extra?.unitScale
        ? await hash(
            await new Blob([
              bytes,
              texture ?? new ArrayBuffer(0),
              `|${extra?.unitScale ?? ""}`,
            ]).arrayBuffer(),
          )
        : await hash(bytes);
    let asset = get().assets[id] ?? (await getCached(id));
    if (!asset) {
      setStatus(`Simplifying ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);
      const result = await runImport({
        id,
        name: file.name,
        kind,
        bytes,
        ...(texture ? { texture } : {}),
        ...(extra?.unitScale ? { unitScale: extra.unitScale } : {}),
      });
      if (!result.ok) {
        setStatus(`Couldn't import ${file.name}: ${result.error}`);
        return null;
      }
      asset = result.asset;
      void putCached(asset);
    }
    get().addAsset(asset);
    setStatus(null);
    return asset;
  },

  async dressUnit(unitId, keys, file) {
    const asset = await get().importFile(file, unitId);
    if (!asset) return;
    const { game, dispatch } = useStore.getState();
    const unit = game.units[unitId];
    if (!unit) return;
    const figure: ModelFigure = { asset: asset.id, name: asset.name, yaw: 0, scale: 1 };
    dispatch({ type: "unit/figure", id: unitId, keys, figure, bands: asset.figure?.bands }, unit.owner);
  },

  addAsset(asset) {
    set((s) => ({ assets: { ...s.assets, [asset.id]: asset } }));
  },
}));

/** Change how a unit's figure sits (turn, size) or take it off (null), for everyone. */
export function restyleUnit(unitId: UnitId, keys: string[], patch: Partial<ModelFigure> | null) {
  const { game, dispatch } = useStore.getState();
  const unit = game.units[unitId];
  const current = unit?.modelIds
    .map((id) => game.models[id])
    .find((m) => m && keys.includes(bindingKey(m)))?.figure;
  if (!unit || !current) return;
  const figure = patch === null ? null : { ...current, ...patch };
  const bands = useAssets.getState().assets[current.asset]?.figure?.bands;
  dispatch({ type: "unit/figure", id: unitId, keys, figure, bands }, unit.owner);
}
