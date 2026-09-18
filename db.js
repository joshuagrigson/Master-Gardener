/* db.js — tiny promise wrapper over IndexedDB for Master Gardener.
   Stores: beds, photos (metadata), blobs (image data keyed by photo id),
   plantings, logs (check-ins), settings (key/value). */
window.DB = (() => {
  const NAME = 'master-gardener';
  const VERSION = 2;
  const STORES = ['beds', 'photos', 'blobs', 'plantings', 'logs', 'settings', 'shots'];
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) {
            db.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return opening;
  }

  function run(store, mode, work) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let out;
      try { out = work(os); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && typeof out === 'object' && 'result' in out ? out.result : out);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB tx failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB tx aborted'));
    }));
  }

  return {
    all: (store) => run(store, 'readonly', os => os.getAll()),
    get: (store, id) => run(store, 'readonly', os => os.get(id)),
    put: (store, obj) => run(store, 'readwrite', os => { os.put(obj); return obj; }),
    putMany: (store, objs) => run(store, 'readwrite', os => { objs.forEach(o => os.put(o)); return objs.length; }),
    del: (store, id) => run(store, 'readwrite', os => { os.delete(id); return id; }),
    clear: (store) => run(store, 'readwrite', os => { os.clear(); return true; }),
    setting: async (key, fallback) => { const r = await run('settings', 'readonly', os => os.get(key)); return r ? r.value : fallback; },
    setSetting: (key, value) => run('settings', 'readwrite', os => { os.put({ key, value }); return value; }),
    STORES,
  };
})();
