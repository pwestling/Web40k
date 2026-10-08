import { create } from "zustand";
import { deleteCached, getCached, listCached } from "../assets/cache";
import { bindingKey, useAssets } from "../assets/store";
import { assetBuffers, type AssetKind, type ModelAsset } from "../assets/types";
import { idbStore } from "../packages/idb";
import { useStore } from "../store";

/**
 * The figure library (roadmap #33): every figure and terrain model on this
 * device in one place. The processed meshes stay in the asset cache
 * (src/assets/cache.ts); the library keeps what a player adds to them: a
 * name, tags, a thumbnail, and the units each figure has dressed, which is
 * how an imported army's units find their figures again.
 */
export interface FigureEntry {
  /** The asset's id (SHA-256 of the uploaded file). */
  id: string;
  name: string;
  kind: AssetKind;
  tags: string[];
  /** Unit and model names this figure has dressed, for suggestions. */
  units: string[];
  /** Bytes the processed asset takes on this device. */
  bytes: number;
  triangles: number;
  /** Height in inches. */
  height: number;
  addedAt: number;
  /** A small picture (WebP data URL), made the first time the library shows it. */
  thumb?: string;
}

const db = idbStore<FigureEntry>("open-battle-figures", "figures");

/** A model file's name without its extension and download noise, for a first name. */
export function cleanName(file: string): string {
  return (
    file
      .replace(/\.(glb|gltf|stl|obj|ply|3mf)$/i, "")
      .replace(/[_.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || file
  );
}

export function entryFrom(asset: ModelAsset, at = Date.now()): FigureEntry {
  return {
    id: asset.id,
    name: cleanName(asset.name),
    kind: asset.kind,
    tags: [],
    units: [],
    bytes: assetBuffers(asset).reduce((n, b) => n + b.byteLength, 0),
    triangles: asset.stats.sourceTriangles,
    height: Math.round((asset.bounds.max[1] - asset.bounds.min[1]) * 10) / 10,
    addedAt: at,
  };
}

interface Library {
  loaded: boolean;
  entries: Record<string, FigureEntry>;
  /** Read the library, adding an entry for any cached model that has none. */
  load(): Promise<void>;
  /** Make sure a model is in the library (it was uploaded, or arrived from a peer or a file). */
  note(asset: ModelAsset): void;
  patch(id: string, patch: Partial<FigureEntry>): void;
  /** Delete models from this device: their entries and their processed meshes. */
  remove(ids: string[]): Promise<void>;
}

let loading: Promise<void> | null = null;

export const useFigures = create<Library>((set, get) => ({
  loaded: false,
  entries: {},
  load() {
    return (loading ??= (async () => {
      const [stored, cached] = await Promise.all([db.all(), listCached()]);
      const entries: Record<string, FigureEntry> = Object.fromEntries(stored.map((e) => [e.id, e]));
      const have = new Set(cached);
      // A model whose meshes were cleared out of storage has nothing left to show.
      for (const id of Object.keys(entries)) if (!have.has(id)) delete entries[id];
      for (const id of cached) {
        if (entries[id]) continue;
        const asset = useAssets.getState().assets[id] ?? (await getCached(id));
        if (!asset) continue;
        entries[id] = entryFrom(asset);
        void db.put(entries[id]);
      }
      set((s) => ({ loaded: true, entries: { ...entries, ...s.entries } }));
      learnFromGame();
    })());
  },
  note(asset) {
    if (get().entries[asset.id]) return;
    const entry = entryFrom(asset);
    set((s) => ({ entries: { ...s.entries, [asset.id]: entry } }));
    void db.get(asset.id).then((old) => {
      // Already in the library from an earlier visit: keep what the player gave it.
      if (old)
        set((s) => ({
          entries: { ...s.entries, [asset.id]: { ...old, ...s.entries[asset.id], ...pick(old) } },
        }));
      else void db.put(get().entries[asset.id] ?? entry);
    });
  },
  patch(id, patch) {
    const entry = get().entries[id];
    if (!entry) return;
    const next = { ...entry, ...patch };
    set((s) => ({ entries: { ...s.entries, [id]: next } }));
    void db.put(next);
  },
  async remove(ids) {
    set((s) => {
      const entries = { ...s.entries };
      for (const id of ids) delete entries[id];
      return { entries };
    });
    await Promise.all(ids.map((id) => db.remove(id)));
    await deleteCached(ids);
    useAssets.setState((s) => {
      const assets = { ...s.assets };
      for (const id of ids) delete assets[id];
      return { assets };
    });
  },
}));

/** What the player gave an entry, which a fresh one mustn't overwrite. */
const pick = (e: FigureEntry): Partial<FigureEntry> => ({
  name: e.name,
  tags: e.tags,
  units: e.units,
  addedAt: e.addedAt,
  ...(e.thumb ? { thumb: e.thumb } : {}),
});

/** Remember which units the figures on the table are dressing, for suggestions next time. */
export function learnFromGame(): void {
  const { game } = useStore.getState();
  const { entries, patch } = useFigures.getState();
  const learned = new Map<string, Set<string>>();
  for (const unit of Object.values(game.units))
    for (const id of unit.modelIds) {
      const m = game.models[id];
      const entry = m?.figure && entries[m.figure.asset];
      if (!entry) continue;
      const names = learned.get(entry.id) ?? new Set(entry.units);
      names.add(unit.name);
      names.add(bindingKey(m));
      learned.set(entry.id, names);
    }
  for (const [id, names] of learned)
    if (names.size !== entries[id]!.units.length) patch(id, { units: [...names].slice(0, 40) });
}

/** Keep the library in step with models arriving in this browser and figures going onto units. */
export function watchFigures(): void {
  useAssets.subscribe((s, prev) => {
    if (s.assets === prev.assets) return;
    for (const asset of Object.values(s.assets))
      if (!prev.assets[asset.id]) useFigures.getState().note(asset);
  });
  useStore.subscribe((s, prev) => {
    if (s.game.models !== prev.game.models && useFigures.getState().loaded) learnFromGame();
  });
}
