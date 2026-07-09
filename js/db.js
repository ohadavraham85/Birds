/* db.js — IndexedDB storage layer. POC: everything lives client-side.
 *
 * Stores:
 *  - observations: full observation rows (גיליון "תצפיות")
 *  - species:      master species list (גיליון "רשימת מינים")
 *  - media:        original-quality image blobs, linked to observations
 *  - settings:     key/value app settings
 */

const DB_NAME = 'birds-db';
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('observations')) {
        const s = db.createObjectStore('observations', { keyPath: 'id' });
        s.createIndex('dateTime', 'dateTime');
      }
      if (!db.objectStoreNames.contains('species')) {
        db.createObjectStore('species', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('media')) {
        const m = db.createObjectStore('media', { keyPath: 'id' });
        m.createIndex('obsId', 'obsId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txStore(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(store, value) {
  const db = await openDb();
  return reqAsPromise(txStore(db, store, 'readwrite').put(value));
}

async function get(store, key) {
  const db = await openDb();
  return reqAsPromise(txStore(db, store, 'readonly').get(key));
}

async function getAll(store) {
  const db = await openDb();
  return reqAsPromise(txStore(db, store, 'readonly').getAll());
}

async function del(store, key) {
  const db = await openDb();
  return reqAsPromise(txStore(db, store, 'readwrite').delete(key));
}

async function clear(store) {
  const db = await openDb();
  return reqAsPromise(txStore(db, store, 'readwrite').clear());
}

/* ---------- observations ---------- */

export async function saveObservation(obs) {
  obs.updatedAt = new Date().toISOString();
  await put('observations', obs);
  return obs;
}

export async function getObservation(id) {
  return get('observations', id);
}

/** All non-deleted observations, newest first. */
export async function listObservations() {
  const all = await getAll('observations');
  return all
    .filter((o) => !o.deleted)
    .sort((a, b) => (a.dateTime < b.dateTime ? 1 : -1));
}

/** Everything, unsorted — used by backup/restore. */
export async function listObservationsRaw() {
  return getAll('observations');
}

export async function deleteObservation(id) {
  const media = await mediaForObservation(id);
  for (const m of media) await del('media', m.id);
  await del('observations', id);
}

export async function putObservationRaw(obs) {
  await put('observations', obs);
}

/* ---------- species ---------- */

export async function listSpecies() {
  const all = await getAll('species');
  return all.map((s) => s.name).sort((a, b) => a.localeCompare(b, 'he'));
}

export async function addSpecies(name) {
  name = String(name || '').trim();
  if (!name) return false;
  await put('species', { name });
  return true;
}

export async function removeSpecies(name) {
  await del('species', name);
}

export async function speciesExists(name) {
  return !!(await get('species', name));
}

async function replaceSpecies(names) {
  const db = await openDb();
  const store = txStore(db, 'species', 'readwrite');
  store.clear();
  for (const name of names) store.put({ name });
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve(true);
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

/**
 * Seed the master species list on first run, and replace it when the bundled
 * list version changes (so existing installs pick up an updated list).
 */
export async function seedSpeciesIfEmpty(names, version = 1) {
  const existing = await getAll('species');
  const storedVersion = await getSetting('speciesSeedVersion', 0);
  if (existing.length > 0 && storedVersion >= version) return false;
  await replaceSpecies(names);
  await setSetting('speciesSeedVersion', version);
  return true;
}

/* ---------- media (original-quality image blobs) ---------- */

export async function saveMedia(media) {
  await put('media', media);
  return media;
}

export async function getMedia(id) {
  return get('media', id);
}

export async function mediaForObservation(obsId) {
  const db = await openDb();
  const idx = txStore(db, 'media', 'readonly').index('obsId');
  return reqAsPromise(idx.getAll(obsId));
}

export async function deleteMedia(id) {
  return del('media', id);
}

/* ---------- settings ---------- */

export async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await put('settings', { key, value });
}

/* ---------- maintenance ---------- */

export async function clearAllData() {
  await clear('observations');
  await clear('media');
}
