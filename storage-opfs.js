// storage-opfs.js
// Uses the Origin Private File System + IndexedDB metadata
// to store video chunks on disk on newer browsers (iOS/Android).

const DB_NAME = 'vb-replay-meta';
const STORE_NAME = 'chunks';

function openMetaDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function putMeta(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteMeta(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getAllMeta(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function createOPFSStorage(maxSeconds, chunkSeconds) {
  const dir = await navigator.storage.getDirectory(); // OPFS root[web:58]
  const db = await openMetaDB();

  let startTime = null;
  let metaCache = [];

  function nowSeconds() {
    return performance.now() / 1000;
  }

  async function writeFile(filename, blob) {
    const handle = await dir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function readFile(filename) {
    const handle = await dir.getFileHandle(filename);
    const file = await handle.getFile();
    return file;
  }

  async function deleteFile(filename) {
    try {
      await dir.removeEntry(filename);
    } catch {
      // ignore
    }
  }

  async function loadMeta() {
    const records = await getAllMeta(db);
    records.sort((a, b) => a.tStart - b.tStart);
    metaCache = records;
  }

  async function trimOld(nowSec) {
    const cutoff = nowSec - maxSeconds;
    const toDelete = metaCache.filter(r => r.tStart < cutoff);
    for (const rec of toDelete) {
      await deleteFile(rec.filename);
      await deleteMeta(db, rec.id);
    }
    metaCache = metaCache.filter(r => r.tStart >= cutoff);
  }

  await loadMeta();

  return {
    type: 'opfs',
    maxSeconds,

    async init() {},

    async addChunk(blob) {
      const now = nowSeconds();
      if (startTime === null) startTime = now;
      const tStart = now - startTime;

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const filename = `chunk-${id}.webm`;

      await writeFile(filename, blob);
      const rec = { id, filename, tStart };
      metaCache.push(rec);
      await putMeta(db, rec);

      await trimOld(tStart);
    },

    async getChunkForTime(targetSeconds) {
      if (!metaCache.length) return null;
      metaCache.sort((a, b) => a.tStart - b.tStart);

      const oldest = metaCache[0];
      const newest = metaCache[metaCache.length - 1];
      if (targetSeconds < oldest.tStart || targetSeconds > newest.tStart) {
        return null;
      }

      let chosen = oldest;
      for (const rec of metaCache) {
        if (rec.tStart <= targetSeconds) chosen = rec;
        else break;
      }

      const file = await readFile(chosen.filename);
      return file; // Blob/File
    }
  };
}
