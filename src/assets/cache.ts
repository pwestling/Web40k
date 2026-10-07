import { PIPELINE_VERSION, type ModelAsset } from "./types";

const DB = "open-battle-assets";
const STORE = "assets";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const key = (id: string) => `${id}:v${PIPELINE_VERSION}`;

/** Processed assets by file hash, so a model is only simplified once per browser. */
export async function getCached(id: string): Promise<ModelAsset | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key(id));
      req.onsuccess = () => resolve(req.result as ModelAsset | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function putCached(asset: ModelAsset): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(asset, key(asset.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Private mode or storage full: the asset still works for this session.
  }
}
