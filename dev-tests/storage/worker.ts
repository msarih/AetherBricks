// Vérifie que Storage fonctionne aussi dans un worker (même base que la page).
import { Storage } from '../../src/world/Storage';

self.onmessage = async (event: MessageEvent<{ worldId: string; key: number; writeKey: number }>) => {
  try {
    const storage = await Storage.open();
    const { worldId, key, writeKey } = event.data;
    const chunk = await storage.loadChunk(worldId, key);
    const keys = await storage.chunkKeys(worldId);
    // Écrit un chunk supplémentaire depuis le worker.
    if (chunk) await storage.saveChunks(worldId, [{ ...chunk, key: writeKey }]);
    (self as unknown as Worker).postMessage({
      ok: true,
      persistent: storage.persistent,
      keys: keys.size,
      blocks: chunk ? chunk.blocks : null,
    });
  } catch (error) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(error) });
  }
};
