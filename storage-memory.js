// storage-memory.js
export function createMemoryStorage(maxSeconds, chunkSeconds) {
  const maxChunks = Math.floor(maxSeconds / chunkSeconds);
  const chunks = []; // { tStart, blob }
  let startTime = null;

  return {
    type: 'memory',
    maxSeconds,
    async init() {},

    async addChunk(blob) {
      const now = performance.now();
      if (startTime === null) startTime = now;
      const tStart = (now - startTime) / 1000;
      chunks.push({ tStart, blob });

      while (chunks.length > maxChunks) {
        chunks.shift();
      }
    },

    // Get the chunk whose start time is just before targetSeconds
    async getChunkForTime(targetSeconds) {
      if (chunks.length === 0) return null;
      const last = chunks[chunks.length - 1];
      const oldest = chunks[0];

      if (targetSeconds < oldest.tStart || targetSeconds > last.tStart) {
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
