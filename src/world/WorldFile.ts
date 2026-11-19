/**
 * Export et import d'un monde dans un fichier (`.aetherworld`).
 *
 * Les mondes ne vivent que dans le navigateur (IndexedDB) : ce fichier sert de sauvegarde
 * externe et permet de passer un monde d'un navigateur ou d'un appareil à l'autre.
 *
 * Format binaire, petit-boutiste :
 *   - 8 octets de signature `AEBWORLD` ;
 *   - uint32 : version du format ;
 *   - uint32 + JSON UTF-8 : en-tête `{ info, chunkCount }` ;
 *   - par chunk : uint32 + JSON `{ key, blockEntities, entities, sizes: [blocs, méta, biomes, teintes] }`,
 *     suivi des quatre tampons compressés en RLE (longueurs données par `sizes`).
 *
 * Module pur (aucun accès au DOM) : la lecture valide tout ce qu'elle reçoit, un fichier
 * abîmé ou étranger donne une erreur au libellé clair et n'écrit rien de partiel.
 */
import { CHUNK_AREA, CHUNK_VOLUME, GEN_VERSION, type GameMode, type WorldType } from './Constants';
import { createWorldId, endStorageId, netherStorageId, rleDecode, rleEncode, type SavedChunk, type Storage, type WorldInfo } from './Storage';

export const WORLD_FILE_EXTENSION = '.aetherworld';
const SIGNATURE = 'AEBWORLD';
const FORMAT_VERSION = 2;
const TINT_BYTES = CHUNK_AREA * 9;
/** Chunks lus ou écrits par lot (une transaction par lot à l'import). */
const BATCH = 32;
/** Garde-fous contre un fichier forgé ou tronqué. */
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = 200000;
const MAX_NAME = 32;
/** Messages montrés au joueur (sans terme technique). */
const CUT = 'fichier incomplet (il a été coupé)';
const DAMAGED = 'fichier abîmé';

interface FileHeader {
  info: WorldInfo;
  chunkCount: number;
  netherChunkCount?: number;
  endChunkCount?: number;
}

interface ChunkHeader {
  key: number;
  blockEntities: unknown[];
  entities: unknown[];
  sizes: [number, number, number, number];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function jsonPart(value: unknown): Uint8Array[] {
  const bytes = encoder.encode(JSON.stringify(value));
  return [u32(bytes.length), bytes];
}

/**
 * Sérialise un monde entier. Le monde doit être enregistré (on exporte depuis la liste des
 * mondes, jamais pendant une partie). `onProgress` reçoit une fraction de 0 à 1.
 */
export async function exportWorld(storage: Storage, id: string, onProgress?: (done: number) => void): Promise<Blob> {
  const info = await storage.getWorld(id);
  if (!info) throw new Error('Monde introuvable');
  const keys = Array.from(await storage.chunkKeys(id)).sort((a, b) => a - b);
  const nId = netherStorageId(id);
  const nKeys = Array.from(await storage.chunkKeys(nId)).sort((a, b) => a - b);
  const eId = endStorageId(id);
  const eKeys = Array.from(await storage.chunkKeys(eId)).sort((a, b) => a - b);
  const total = Math.max(1, keys.length + nKeys.length + eKeys.length);
  const parts: Uint8Array[] = [encoder.encode(SIGNATURE), u32(FORMAT_VERSION)];
  const header: FileHeader = {
    info,
    chunkCount: keys.length,
    ...(nKeys.length > 0 ? { netherChunkCount: nKeys.length } : {}),
    ...(eKeys.length > 0 ? { endChunkCount: eKeys.length } : {}),
  };
  parts.push(...jsonPart(header));
  let done = 0;
  for (const [srcId, list] of [[id, keys], [nId, nKeys], [eId, eKeys]] as const) {
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = await Promise.all(list.slice(i, i + BATCH).map((key) => storage.loadChunk(srcId, key)));
      for (const chunk of batch) {
        if (!chunk) throw new Error('Un chunk du monde est illisible');
        const buffers = [rleEncode(chunk.blocks), rleEncode(chunk.meta), rleEncode(chunk.biomes), rleEncode(chunk.tints)];
        const head: ChunkHeader = {
          key: chunk.key,
          blockEntities: chunk.blockEntities,
          entities: chunk.entities,
          sizes: [buffers[0].length, buffers[1].length, buffers[2].length, buffers[3].length],
        };
        parts.push(...jsonPart(head), ...buffers);
        done++;
      }
      onProgress?.(Math.min(1, done / total));
    }
  }
  return new Blob(parts as BlobPart[], { type: 'application/octet-stream' });
}

/** Nom de fichier proposé au téléchargement : le nom du monde, sans caractère gênant. */
export function worldFileName(name: string): string {
  const base = name.normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  return `${base || 'monde'}${WORLD_FILE_EXTENSION}`;
}

class Reader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  take(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(CUT);
    }
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  u32(): number {
    if (this.offset + 4 > this.bytes.length) throw new Error(CUT);
    const n = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return n;
  }

  json(): unknown {
    const length = this.u32();
    if (length > MAX_JSON_BYTES) throw new Error(DAMAGED);
    try {
      return JSON.parse(decoder.decode(this.take(length)));
    } catch (error) {
      if (error instanceof Error && error.message === CUT) throw error;
      throw new Error(DAMAGED);
    }
  }

  get done(): boolean {
    return this.offset === this.bytes.length;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function readInfo(raw: unknown, now: number): WorldInfo {
  if (!isRecord(raw)) throw new Error(DAMAGED);
  const seed = raw.seed;
  if (typeof seed !== 'number' || !Number.isFinite(seed)) throw new Error(DAMAGED);
  const worldType: WorldType = raw.worldType === 'flat' ? 'flat' : 'default';
  const rawMode = raw.gameMode;
  const gameMode: GameMode =
    rawMode === 'creative' || rawMode === 'adventure' || rawMode === 'spectator' ? rawMode : 'survival';
  const name = (typeof raw.name === 'string' ? raw.name.trim() : '').slice(0, MAX_NAME) || 'Monde importé';
  const info: WorldInfo = {
    id: createWorldId(),
    name,
    seed: seed >>> 0,
    worldType,
    gameMode,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    lastPlayed: now,
    state: isRecord(raw.state) ? raw.state : null,
  };
  if (raw.hardcore === true) info.hardcore = true;
  if (typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('data:image/')) info.thumbnail = raw.thumbnail;
  // le monde importé garde son générateur d'origine (au plus celui que ce jeu connaît)
  if (typeof raw.genVersion === 'number' && Number.isInteger(raw.genVersion) && raw.genVersion >= 1) {
    info.genVersion = Math.min(raw.genVersion, GEN_VERSION);
  }
  return info;
}

function readChunk(r: Reader): SavedChunk {
  const head = r.json();
  if (!isRecord(head) || typeof head.key !== 'number' || !Number.isFinite(head.key)) throw new Error(DAMAGED);
  const sizes = head.sizes;
  if (!Array.isArray(sizes) || sizes.length !== 4 || sizes.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(DAMAGED);
  }
  const lengths = [CHUNK_VOLUME, CHUNK_VOLUME, CHUNK_AREA, TINT_BYTES];
  const buffers: Uint8Array[] = [];
  for (let i = 0; i < 4; i++) {
    let data: Uint8Array;
    try {
      data = rleDecode(r.take(sizes[i] as number), lengths[i]);
    } catch (error) {
      if (error instanceof Error && error.message === CUT) throw error;
      throw new Error(DAMAGED);
    }
    if (data.length !== lengths[i]) throw new Error(DAMAGED);
    buffers.push(data);
  }
  return {
    key: head.key,
    blocks: buffers[0],
    meta: buffers[1],
    biomes: buffers[2],
    tints: buffers[3],
    blockEntities: Array.isArray(head.blockEntities) ? head.blockEntities : [],
    entities: Array.isArray(head.entities) ? head.entities : [],
  };
}

/**
 * Lit un fichier de monde et l'ajoute comme NOUVEAU monde (nouvel identifiant : un monde
 * existant n'est jamais écrasé). Si un monde porte déjà ce nom, le nom reçoit un suffixe.
 * En cas d'échec en cours d'écriture, le monde partiel est supprimé.
 */
export async function importWorld(storage: Storage, data: ArrayBuffer, onProgress?: (done: number) => void): Promise<WorldInfo> {
  const r = new Reader(new Uint8Array(data));
  let signature = '';
  try {
    signature = new TextDecoder().decode(r.take(SIGNATURE.length));
  } catch {
    signature = '';
  }
  if (signature !== SIGNATURE) throw new Error('ce fichier n’est pas un monde AetherBricks');
  const version = r.u32();
  if (version !== 1 && version !== FORMAT_VERSION) throw new Error(`version de fichier non prise en charge (${version})`);
  const header = r.json();
  if (!isRecord(header)) throw new Error(DAMAGED);
  const count = header.chunkCount;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > MAX_CHUNKS) throw new Error(DAMAGED);
  const nCount = header.netherChunkCount === undefined ? 0 : header.netherChunkCount;
  if (typeof nCount !== 'number' || !Number.isInteger(nCount) || nCount < 0 || count + nCount > MAX_CHUNKS) throw new Error(DAMAGED);
  const eCount = header.endChunkCount === undefined ? 0 : header.endChunkCount;
  if (typeof eCount !== 'number' || !Number.isInteger(eCount) || eCount < 0 || count + nCount + eCount > MAX_CHUNKS) throw new Error(DAMAGED);
  const info = readInfo(header.info, Date.now());

  // lecture et validation complètes avant toute écriture
  const chunks: SavedChunk[] = [];
  for (let i = 0; i < count; i++) chunks.push(readChunk(r));
  const netherChunks: SavedChunk[] = [];
  for (let i = 0; i < nCount; i++) netherChunks.push(readChunk(r));
  const endChunks: SavedChunk[] = [];
  for (let i = 0; i < eCount; i++) endChunks.push(readChunk(r));
  if (!r.done) throw new Error(DAMAGED);

  const names = new Set((await storage.listWorlds()).map((w) => w.name));
  if (names.has(info.name)) {
    const base = info.name.slice(0, MAX_NAME - 4);
    let n = 2;
    while (names.has(`${base} (${n})`)) n++;
    info.name = `${base} (${n})`;
  }

  await storage.putWorld(info);
  const total = Math.max(1, chunks.length + netherChunks.length + endChunks.length);
  let written = 0;
  try {
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      await storage.saveChunks(info.id, slice);
      written += slice.length;
      onProgress?.(Math.min(1, written / total));
    }
    for (const [dimId, list] of [[netherStorageId(info.id), netherChunks], [endStorageId(info.id), endChunks]] as const) {
      for (let i = 0; i < list.length; i += BATCH) {
        const slice = list.slice(i, i + BATCH);
        await storage.saveChunks(dimId, slice);
        written += slice.length;
        onProgress?.(Math.min(1, written / total));
      }
    }
  } catch (error) {
    await storage.deleteWorld(info.id).catch(() => undefined);
    throw error;
  }
  return info;
}
