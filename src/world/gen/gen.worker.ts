/**
 * Worker de génération du terrain.
 *
 * Messages reçus : { type: 'init', seed, worldType } puis { type: 'gen', cx, cz }.
 * Message émis : { type: 'chunk', cx, cz, blocks, meta, biomes, heightmap, tints } (tampons transférés).
 */
import { WorldGen, type GenBlockEntity, type GenSpawn } from './WorldGen';
import { NetherGen } from './NetherGen';
import { EndGen } from './EndGen';
import type { Dimension, WorldType } from '../Constants';

export type GenRequest =
  | { type: 'init'; seed: number; worldType: WorldType; dimension?: Dimension; genVersion?: number }
  | { type: 'gen'; cx: number; cz: number; epoch?: number };

export interface GenResponse {
  type: 'chunk';
  cx: number;
  cz: number;
  epoch?: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
  heightmap: Uint8Array;
  tints: Uint8Array;
  /** Entités de bloc posées par le générateur (coffres à butin, générateurs de monstres). */
  blockEntities: GenBlockEntity[];
  /** Créatures à faire apparaître avec le chunk (villageois). */
  spawns: GenSpawn[];
}

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

let gen: WorldGen | NetherGen | EndGen | null = null;

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data as GenRequest;
  if (m.type === 'init') {
    const version = m.genVersion ?? 1;
    gen = m.dimension === 'nether' ? new NetherGen(m.seed, version) : m.dimension === 'end' ? new EndGen(m.seed) : new WorldGen(m.seed, m.worldType, version);
    return;
  }
  if (!gen) return;
  const c = gen.generateChunk(m.cx, m.cz);
  const out: GenResponse = {
    type: 'chunk',
    cx: m.cx,
    cz: m.cz,
    epoch: m.epoch,
    blocks: c.blocks,
    meta: c.meta,
    biomes: c.biomes,
    heightmap: c.heightmap,
    tints: c.tints,
    blockEntities: c.blockEntities,
    spawns: c.spawns,
  };
  ctx.postMessage(out, [c.blocks.buffer, c.meta.buffer, c.biomes.buffer, c.heightmap.buffer, c.tints.buffer]);
};
