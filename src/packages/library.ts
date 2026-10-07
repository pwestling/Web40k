import { create } from "zustand";
import { readManifest, sha256, type Manifest } from "./manifest";

/**
 * This device's rules packages, by the SHA-256 of their exact bytes. Several
 * versions of one package live side by side; each game uses exactly what its
 * log names. Trust is per hash: a package's code runs only after the player
 * says yes to those bytes once.
 */
export interface StoredPackage {
  hash: string;
  manifest: Manifest;
  /** The package file, as text (packages are one JavaScript file). */
  source: string;
  bytes: number;
  addedAt: number;
  trusted: boolean;
  /** Loaded from a file here (rather than received from a player). */
  own: boolean;
}

/** Biggest package sent over the peer connection; bigger ones load from a file. */
export const MAX_PEER_BYTES = 4 * 1024 * 1024;

const DB = "open-battle-packages";
const STORE = "packages";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "hash" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function all(): Promise<StoredPackage[]> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredPackage[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function write(op: (store: IDBObjectStore) => void): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Private mode or storage full: the package still works until the page closes.
  }
}

export type AddResult = { ok: true; pkg: StoredPackage } | { ok: false; error: string };

interface Library {
  loaded: boolean;
  packages: Record<string, StoredPackage>;
  load(): Promise<void>;
  /**
   * Add a package's bytes (from a file or a player). `expect` is the hash the
   * game names; bytes that don't match it are refused. Nothing runs.
   */
  add(bytes: ArrayBuffer | Uint8Array, opts?: { expect?: string; own?: boolean }): Promise<AddResult>;
  trust(hash: string, trusted: boolean): void;
  remove(hash: string): void;
}

export const useLibrary = create<Library>((set, get) => ({
  loaded: false,
  packages: {},

  async load() {
    if (get().loaded) return;
    const list = await all();
    set((s) => ({
      loaded: true,
      packages: { ...Object.fromEntries(list.map((p) => [p.hash, p])), ...s.packages },
    }));
  },

  async add(bytes, opts = {}) {
    const hash = await sha256(bytes);
    if (opts.expect && hash !== opts.expect)
      return { ok: false, error: "That didn't match what the game expects." };
    const known = get().packages[hash];
    if (known) {
      if (opts.own && !known.own) get().trust(hash, known.trusted);
      return { ok: true, pkg: known };
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, error: "That isn't a rules package (it isn't text)." };
    }
    const read = readManifest(source);
    if ("error" in read) return { ok: false, error: read.error };
    const pkg: StoredPackage = {
      hash,
      manifest: read.manifest,
      source,
      bytes: bytes.byteLength,
      addedAt: Date.now(),
      trusted: false,
      own: !!opts.own,
    };
    set((s) => ({ packages: { ...s.packages, [hash]: pkg } }));
    void write((store) => store.put(pkg));
    return { ok: true, pkg };
  },

  trust(hash, trusted) {
    const pkg = get().packages[hash];
    if (!pkg) return;
    const next = { ...pkg, trusted };
    set((s) => ({ packages: { ...s.packages, [hash]: next } }));
    void write((store) => store.put(next));
  },

  remove(hash) {
    set((s) => {
      const { [hash]: _gone, ...rest } = s.packages;
      return { packages: rest };
    });
    void write((store) => store.delete(hash));
  },
}));

/** Packages that fit a system (by manifest.systems), newest version first within each id. */
export function packagesFor(
  packages: Record<string, StoredPackage>,
  system: string | undefined,
): StoredPackage[] {
  return Object.values(packages)
    .filter(
      (p) =>
        !system ||
        p.manifest.systems.length === 0 ||
        p.manifest.systems.some((s) => systemMatches(s, system)),
    )
    .sort(
      (a, b) =>
        a.manifest.name.localeCompare(b.manifest.name) ||
        compareVersions(b.manifest.version, a.manifest.version),
    );
}

/** A manifest's system names ("tow", "wh40k") against a game's system id ("tow-hand", "wh40k-10e"). */
export function systemMatches(declared: string, system: string): boolean {
  return system === declared || system.startsWith(`${declared}-`) || declared.startsWith(`${system}-`);
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number(x) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
