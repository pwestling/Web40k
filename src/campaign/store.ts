import { create } from "zustand";
import type { GameRecord } from "../core";
import { campaignHash, type CampaignBook } from "./book";

/** Campaign books on this device, and the replays of the games played for them. */

const DB = "open-battle-campaigns";
const BOOKS = "books";
const REPLAYS = "replays";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(BOOKS, { keyPath: "id" });
      req.result.createObjectStore(REPLAYS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function request<T>(store: string, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = op(db.transaction(store, "readonly").objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function write(store: string, op: (s: IDBObjectStore) => void): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      op(tx.objectStore(store));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Private mode or storage full: the book lasts until the page closes.
  }
}

interface Campaigns {
  loaded: boolean;
  books: Record<string, CampaignBook>;
  /** Each book's hash, worked out once per change. */
  hashes: Record<string, string>;
  /** Books changed by hand on this device since they last matched a game's copy. */
  edited: Record<string, boolean>;
  load(): Promise<void>;
  put(book: CampaignBook, opts?: { edited?: boolean }): void;
  remove(id: string): void;
}

export const useCampaigns = create<Campaigns>((set, get) => ({
  loaded: false,
  books: {},
  hashes: {},
  edited: {},
  async load() {
    if (get().loaded) return;
    const books = (await request(BOOKS, (s) => s.getAll() as IDBRequest<CampaignBook[]>)) ?? [];
    set((s) => {
      const all = { ...Object.fromEntries(books.map((b) => [b.id, b])), ...s.books };
      return {
        loaded: true,
        books: all,
        hashes: Object.fromEntries(Object.values(all).map((b) => [b.id, campaignHash(b)])),
      };
    });
  },
  put(book, opts = {}) {
    set((s) => ({
      books: { ...s.books, [book.id]: book },
      hashes: { ...s.hashes, [book.id]: campaignHash(book) },
      edited: { ...s.edited, [book.id]: !!opts.edited },
    }));
    void write(BOOKS, (s) => s.put(book));
  },
  remove(id) {
    set((s) => {
      const { [id]: _b, ...books } = s.books;
      const { [id]: _h, ...hashes } = s.hashes;
      return { books, hashes };
    });
    void write(BOOKS, (s) => s.delete(id));
  },
}));

/** Keep a campaign game's replay on this device, by the game's id. */
export function saveReplay(gameId: string, record: GameRecord): Promise<void> {
  return write(REPLAYS, (s) => s.put(record, gameId));
}

export function loadReplay(gameId: string): Promise<GameRecord | undefined> {
  return request(REPLAYS, (s) => s.get(gameId) as IDBRequest<GameRecord | undefined>);
}

export async function replayIds(): Promise<Set<string>> {
  return new Set(((await request(REPLAYS, (s) => s.getAllKeys())) ?? []).map(String));
}
