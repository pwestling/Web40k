import { create } from "zustand";
import type { Model } from "../core";
import { getCached, putCached } from "./cache";
import type { ImportRequest, ImportResponse } from "./worker";
import type { AssetKind, ModelAsset } from "./types";

/** Which uploaded model stands in for a profile, and how it sits on the base. */
export interface Binding {
  asset: string;
  /** Extra turn in radians, for sculpts that don't face +z. */
  yaw: number;
  /** Multiplier on the auto-detected size. */
  scale: number;
}

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
  bindings: Record<string, Binding>;
  /** Imports in progress or failed, by binding key. */
  status: Record<string, string>;
  /** Import a file and dress every profile in `keys` with it. */
  importFor(keys: string[], file: File, kind?: AssetKind): Promise<void>;
  setBinding(key: string, patch: Partial<Binding> | null): void;
  /** Add an already-processed asset (benchmarks, and later assets from peers). */
  addAsset(asset: ModelAsset): void;
}

const BINDINGS_KEY = "open-battle:bindings";

function loadBindings(): Record<string, Binding> {
  try {
    return JSON.parse(localStorage.getItem(BINDINGS_KEY) ?? "{}") as Record<string, Binding>;
  } catch {
    return {};
  }
}

function saveBindings(bindings: Record<string, Binding>) {
  try {
    localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
  } catch {
    // Storage blocked: bindings last for this session only.
  }
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
        worker.postMessage(request, [request.bytes]);
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
  bindings: loadBindings(),
  status: {},

  async importFor(keys, file, kind = "miniature") {
    const setStatus = (text: string | null) =>
      set((s) => {
        const status = { ...s.status };
        for (const key of keys) {
          if (text === null) delete status[key];
          else status[key] = text;
        }
        return { status };
      });
    setStatus(`Reading ${file.name}…`);
    const bytes = await file.arrayBuffer();
    const id = await hash(bytes);
    let asset = get().assets[id] ?? (await getCached(id));
    if (!asset) {
      setStatus(`Simplifying ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`);
      const result = await runImport({ id, name: file.name, kind, bytes });
      if (!result.ok) {
        setStatus(`Couldn't import ${file.name}: ${result.error}`);
        return;
      }
      asset = result.asset;
      void putCached(asset);
    }
    get().addAsset(asset);
    setStatus(null);
    for (const key of keys)
      get().setBinding(key, { asset: asset.id, yaw: get().bindings[key]?.yaw ?? 0, scale: 1 });
  },

  setBinding(key, patch) {
    const bindings = { ...get().bindings };
    if (patch === null) delete bindings[key];
    else bindings[key] = { asset: "", yaw: 0, scale: 1, ...bindings[key], ...patch };
    saveBindings(bindings);
    set({ bindings });
  },

  addAsset(asset) {
    set((s) => ({ assets: { ...s.assets, [asset.id]: asset } }));
  },
}));

/** Load the assets this browser's saved bindings point at. */
export async function restoreBoundAssets() {
  const { bindings, assets, addAsset } = useAssets.getState();
  const ids = new Set(Object.values(bindings).map((b) => b.asset));
  for (const id of ids) {
    if (assets[id]) continue;
    const asset = await getCached(id);
    if (asset) addAsset(asset);
  }
}
