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

async function keys(): Promise<string[]> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function remove(names: string[]): Promise<void> {
  if (!names.length) return;
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const n of names) tx.objectStore(STORE).delete(n);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Nothing to remove.
  }
}

/** The ids of every processed asset kept on this device (for the figure library, #33). */
export async function listCached(): Promise<string[]> {
  const suffix = `:v${PIPELINE_VERSION}`;
  return (await keys()).filter((k) => k.endsWith(suffix)).map((k) => k.slice(0, -suffix.length));
}

/** Forget assets, at every pipeline version. */
export async function deleteCached(ids: string[]): Promise<void> {
  const gone = new Set(ids);
  await remove((await keys()).filter((k) => gone.has(k.split(":")[0]!)));
}

/** Assets processed by an older pipeline (rebuilt from their files if uploaded again): how many, and remove them. */
export async function staleCached(): Promise<string[]> {
  const suffix = `:v${PIPELINE_VERSION}`;
  return (await keys()).filter((k) => !k.endsWith(suffix));
}

export async function deleteStale(): Promise<void> {
  await remove(await staleCached());
}
