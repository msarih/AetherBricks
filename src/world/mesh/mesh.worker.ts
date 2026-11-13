/**
 * Worker de maillage : reçoit un MeshRequest, renvoie un MeshResult (tampons transférés).
 */
import { buildChunkMesh } from './ChunkMesher';
import { meshResultTransfers, type MeshRequest } from './MeshTypes';

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

ctx.onmessage = (e: MessageEvent) => {
  const result = buildChunkMesh(e.data as MeshRequest);
  ctx.postMessage(result, meshResultTransfers(result));
};
