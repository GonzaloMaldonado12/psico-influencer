// IndexedDB mínima: todo (videos incluidos) se guarda en el propio dispositivo.
const DB_NAME = 'psicoinfluencer';
const DB_VERSION = 2; // v2: «chunks» guarda la grabación en curso (a prueba de cierres inesperados)
const STORES = ['projects', 'scripts', 'media', 'ideas', 'kv', 'chunks'];

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of STORES) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' });
        }
      };
      req.onsuccess = () => {
        const d = req.result;
        // Si otra pestaña abre una versión nueva, se cierra esta conexión para no bloquearla.
        d.onversionchange = () => {
          d.close();
          dbPromise = null;
        };
        resolve(d);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña. Cierra las otras ventanas de la app.'));
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    let result;
    const req = fn(tx.objectStore(store));
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Operación cancelada (¿sin espacio?)'));
  });
}

/** Rango de claves que empiezan con `prefix` (claves de texto). */
const prefixRange = (prefix) => IDBKeyRange.bound(prefix, `${prefix}￿`);

export const db = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
  put: (store, value) => run(store, 'readwrite', (s) => s.put(value)).then(() => value),
  del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()),
  /** Valores cuyas claves empiezan con `prefix`, en orden. */
  byPrefix: (store, prefix) => run(store, 'readonly', (s) => s.getAll(prefixRange(prefix))),
  delPrefix: (store, prefix) => run(store, 'readwrite', (s) => s.delete(prefixRange(prefix))),
  keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
  async getKV(key, fallback) {
    const r = await db.get('kv', key);
    return r ? r.value : fallback;
  },
  async setKV(key, value) {
    await db.put('kv', { key, value });
    return value;
  },
  stores: STORES,
};
