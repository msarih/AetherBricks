/**
 * Worker de génération du terrain.
 *
 * Messages reçus : { type: 'init', seed, worldType } puis { type: 'gen', cx, cz }.
 * Message émis : { type: 'chunk', cx, cz, blocks, meta, biomes, heightmap, tints } (tampons transférés).
 */
import { WorldGen } from './WorldGen';
import type { WorldType } from '../Constants';

export type GenRequest = { type: 'init'; seed: number; worldType: WorldType } | { type: 'gen'; cx: number; cz: number };

export interface GenResponse {
  type: 'chunk';
  cx: number;
  cz: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
  heightmap: Uint8Array;
  tints: Uint8Array;
}

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

let gen: WorldGen | null = null;

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data as GenRequest;
  if (m.type === 'init') {
    gen = new WorldGen(m.seed, m.worldType);
    return;
  }
  if (!gen) return;
  const c = gen.generateChunk(m.cx, m.cz);
  const out: GenResponse = {
    type: 'chunk',
    cx: m.cx,
    cz: m.cz,
    blocks: c.blocks,
    meta: c.meta,
    biomes: c.biomes,
    heightmap: c.heightmap,
    tints: c.tints,
  };
  ctx.postMessage(out, [c.blocks.buffer, c.meta.buffer, c.biomes.buffer, c.heightmap.buffer, c.tints.buffer]);
};
