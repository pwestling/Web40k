/**
 * A small IndexedDB key-value store, for libraries kept on this device
 * (tables, #28). Every call fails quietly to nothing: in private mode or with
 * storage full, what's saved lasts until the page closes.
 */
export function idbStore<T>(db: string, store: string, keyPath = "id") {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(db, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(store, { keyPath });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    }));
  const run = async <R>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<R>) => {
    try {
      const d = await open();
      return await new Promise<R | undefined>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = op(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      return undefined;
    }
  };
  return {
    get: async (key: string) => (await run("readonly", (s) => s.get(key))) as T | undefined,
    all: async () => ((await run("readonly", (s) => s.getAll())) ?? []) as T[],
    put: (value: T) => run("readwrite", (s) => s.put(value)).then(() => undefined),
    remove: (key: string) => run("readwrite", (s) => s.delete(key)).then(() => undefined),
  };
}
