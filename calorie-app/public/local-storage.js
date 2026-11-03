// IndexedDB storage for the phone app. Same interface as memoryStorage() in local-api.js.
const STORES = { foods: 'id', log: 'id', weights: 'date', habits: 'k', kv: 'key' };

export function idbStorage(name = 'leanmode') {
  let dbp;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { for (const [s, k] of Object.entries(STORES)) r.result.createObjectStore(s, { keyPath: k }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
  const run = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let out; try { out = fn(tx); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  };
  return {
    async load() {
      const names = Object.keys(STORES);
      const reqs = {};
      await run(names, 'readonly', (tx) => { for (const s of names) reqs[s] = tx.objectStore(s).getAll(); });
      return Object.fromEntries(names.map((s) => [s, reqs[s].result]));
    },
    put: (store, obj) => run([store], 'readwrite', (tx) => { tx.objectStore(store).put(obj); }),
    putMany: (store, objs) => run([store], 'readwrite', (tx) => { const s = tx.objectStore(store); for (const o of objs) s.put(o); }),
    del: (store, key) => run([store], 'readwrite', (tx) => { tx.objectStore(store).delete(key); }),
    clear: (store) => run([store], 'readwrite', (tx) => { tx.objectStore(store).clear(); }),
  };
}
