// storage-memory.js
// Simple in-RAM circular buffer, used when OPFS / disk storage is not available.

export function createMemoryStorage(maxSeconds, chunkSeconds) {
  const maxChunks = Math.floor(maxSeconds / chunkSeconds);
  const chunks = []; // { tStart, blob }
  let startTime = null;

  function nowSeconds() {
    return performance.now() / 1000;
  }

  return {
    type: 'memory',
    maxSeconds,

    async init() {},

    async addChunk(blob) {
      const now = nowSeconds();
      if (startTime === null) startTime = now;
      const tStart = now - startTime;
      chunks.push({ tStart, blob });

      while (chunks.length > maxChunks) {
        chunks.shift();
      }
    },

    async getChunkForTime(targetSeconds) {
      if (chunks.length === 0) return null;
      const oldest = chunks[0];
      const newest = chunks[chunks.length - 1];

      if (targetSeconds < oldest.tStart || targetSeconds > newest.tStart) {
        return null;
      }

      let chosen = oldest;
      for (const c of chunks) {
        if (c.tStart <= targetSeconds) chosen = c;
        else break;
      }
      return chosen.blob;
    }
  };
}

