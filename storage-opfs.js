// storage-opfs.js
const DB_NAME = 'chunk-meta';
const STORE_NAME = 'chunks';

async function openMetaDB() {
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

async function putMeta(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteMeta(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllMeta(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function createOPFSStorage(maxSeconds, chunkSeconds) {
  const dir = await navigator.storage.getDirectory(); // OPFS root[web:58]
  const db = await openMetaDB();

  let startTime = null;

  async function writeFile(name, blob) {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function readFile(name) {
    const handle = await dir.getFileHandle(name);
    const file = await handle.getFile();
    return file;
  }

  async function deleteFile(name) {
    try {
      await dir.removeEntry(name);
    } catch (e) {
      // ignore missing
    }
  }

  async function loadMeta() {
    const records = await getAllMeta(db);
    records.sort((a, b) => a.tStart - b.tStart);
    return records;
  }

  let metaCache = await loadMeta();

  async function trimOld(nowSeconds) {
    const cutoff = nowSeconds - maxSeconds;
    const toDelete = metaCache.filter(rec => rec.tStart < cutoff);
    for (const rec of toDelete) {
      await deleteFile(rec.filename);
      await deleteMeta(db, rec.id);
    }
    metaCache = metaCache.filter(rec => rec.tStart >= cutoff);
  }

  return {
    type: 'opfs',
    maxSeconds,

    async init() {
      // nothing more for now
    },

    async addChunk(blob) {
      const now = performance.now();
      if (startTime === null) startTime = now;
      const tStart = (now - startTime) / 1000;

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
      return file; // Blob/File usable by <video>[web:51]
    }
  };
}
