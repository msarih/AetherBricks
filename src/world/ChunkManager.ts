/**
 * Chargement, maillage, sauvegarde et déchargement des chunks autour du joueur.
 *
 * - les données viennent de la sauvegarde (chunks modifiés) ou des workers de génération ;
 * - le maillage et la lumière sont calculés par des workers à partir d'une copie du voisinage 3×3 ;
 * - un chunk n'est maillé que lorsque ses 8 voisins ont leurs données.
 */
import { Chunk } from './Chunk';
import { CHUNK_AREA, CHUNK_HEIGHT, chunkKey, type WorldType } from './Constants';
import { computeHeightmap } from './gen/WorldGen';
import type { GenRequest, GenResponse } from './gen/gen.worker';
import type { MeshRequest, MeshResult, PassData } from './mesh/MeshTypes';
import type { SavedChunk, Storage } from './Storage';
import type { BlockEntity, World } from './World';

/** Destinataire des maillages (l'afficheur des chunks). */
export interface ChunkSink {
  setChunkMesh(cx: number, cz: number, opaque: PassData | null, translucent: PassData | null): void;
  removeChunk(cx: number, cz: number): void;
}

/** Ce que le jeu fait des entités quand un chunk arrive ou repart. */
export interface ChunkHooks {
  /** Chunk ajouté au monde. `saved` : entités sauvegardées, ou null si le chunk vient d'être généré. */
  chunkLoaded(chunk: Chunk, savedEntities: unknown[] | null): void;
  /** Entités du chunk à sauvegarder. Si `remove`, le chunk s'en va : les retirer du jeu. */
  chunkEntities(chunk: Chunk, remove: boolean): unknown[];
}

const NO_HOOKS: ChunkHooks = {
  chunkLoaded: () => {},
  chunkEntities: () => [],
};

interface WorkerSlot {
  worker: Worker;
  busy: number;
}

const IN_FLIGHT_PER_WORKER = 2;
const URGENT_IN_FLIGHT_PER_WORKER = 4;
const MAX_STORAGE_LOADS = 6;
/** Marge (en chunks) au-delà de la zone chargée avant déchargement. */
const UNLOAD_MARGIN = 2;
const SAVE_BATCH = 16;

export class ChunkManager {
  viewDistance: number;
  fancy = true;
  hooks: ChunkHooks = NO_HOOKS;

  /** Compteurs pour l'écran de débogage. */
  readonly stats = { loaded: 0, generating: 0, meshing: 0, meshed: 0, meshMs: 0, saving: 0 };

  private readonly world: World;
  private readonly sink: ChunkSink;
  private readonly storage: Storage | null;
  private readonly worldId: string;
  private readonly savedKeys: Set<number>;

  private readonly genWorkers: WorkerSlot[] = [];
  private readonly meshWorkers: WorkerSlot[] = [];
  /** Clés des chunks dont les données sont en route (génération ou lecture). */
  private readonly loading = new Set<number>();
  private storageLoads = 0;
  private readonly meshSent = new Map<number, { chunk: Chunk; at: number }>();
  private nextMeshId = 1;

  /** Décalages (dx, dz) triés par distance, pour le rayon de chargement courant. */
  private offsets: Int16Array = new Int16Array(0);
  private offsetsRadius = -1;
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private loadScanDone = false;
  private frame = 0;

  /** Chunks en attente d'écriture, puis en cours d'écriture : relus d'ici s'ils reviennent avant la fin. */
  private readonly saveQueue = new Map<number, SavedChunk>();
  private readonly saveWriting = new Map<number, SavedChunk>();
  private saveChain: Promise<void> = Promise.resolve();
  private disposed = false;
  /** Dernière erreur de sauvegarde (affichée par l'interface). */
  saveError: string | null = null;

  constructor(
    world: World,
    sink: ChunkSink,
    options: { seed: number; worldType: WorldType; storage: Storage | null; worldId: string; savedKeys: Set<number>; viewDistance: number },
  ) {
    this.world = world;
    this.sink = sink;
    this.storage = options.storage;
    this.worldId = options.worldId;
    this.savedKeys = options.savedKeys;
    this.viewDistance = options.viewDistance;

    const cores = navigator.hardwareConcurrency || 4;
    const genCount = cores >= 8 ? 3 : cores >= 4 ? 2 : 1;
    const meshCount = cores >= 4 ? 2 : 1;
    for (let i = 0; i < genCount; i++) {
      const worker = new Worker(new URL('./gen/gen.worker.ts', import.meta.url), { type: 'module' });
      const slot: WorkerSlot = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent) => {
        slot.busy--;
        this.onGenerated(e.data as GenResponse);
      };
      const init: GenRequest = { type: 'init', seed: options.seed, worldType: options.worldType };
      worker.postMessage(init);
      this.genWorkers.push(slot);
    }
    for (let i = 0; i < meshCount; i++) {
      const worker = new Worker(new URL('./mesh/mesh.worker.ts', import.meta.url), { type: 'module' });
      const slot: WorkerSlot = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent) => {
        slot.busy--;
        this.onMeshed(e.data as MeshResult);
      };
      this.meshWorkers.push(slot);
    }
  }

  // ------------------------------------------------------------------ boucle

  /** À appeler à chaque image avec la position du joueur. */
  update(px: number, pz: number): void {
    if (this.disposed) return;
    this.frame++;
    const cx = Math.floor(px) >> 4;
    const cz = Math.floor(pz) >> 4;
    const loadRadius = this.viewDistance + 1;
    if (loadRadius !== this.offsetsRadius) this.buildOffsets(loadRadius);
    if (cx !== this.centerX || cz !== this.centerZ) {
      this.centerX = cx;
      this.centerZ = cz;
      this.loadScanDone = false;
      this.unloadFar();
    } else if (this.frame % 120 === 0) {
      this.unloadFar();
    }

    this.requestLoads();
    this.requestMeshes();
    if (this.saveQueue.size >= SAVE_BATCH || (this.saveQueue.size > 0 && this.frame % 180 === 0)) this.flushSaves();

    this.stats.loaded = this.world.chunks.size;
    this.stats.generating = this.loading.size;
    this.stats.meshing = this.meshSent.size;
    this.stats.saving = this.saveQueue.size + this.saveWriting.size;
  }

  /** Tous les chunks dans le rayon donné (en chunks) autour de (px, pz) sont-ils maillés ? */
  isReady(px: number, pz: number, radius: number): boolean {
    const cx = Math.floor(px) >> 4;
    const cz = Math.floor(pz) >> 4;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const c = this.world.getChunk(cx + dx, cz + dz);
        if (!c || !c.meshed) return false;
      }
    }
    return true;
  }

  /** Part des chunks de la zone de rendu déjà maillés (0..1), pour l'écran de chargement. */
  progress(px: number, pz: number, radius: number): number {
    const cx = Math.floor(px) >> 4;
    const cz = Math.floor(pz) >> 4;
    let done = 0;
    let total = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        total++;
        const c = this.world.getChunk(cx + dx, cz + dz);
        if (c) done += c.meshed ? 1 : 0.5;
      }
    }
    return done / total;
  }

  /** Force le remaillage de tous les chunks (changement de réglage graphique). */
  remeshAll(): void {
    for (const c of this.world.chunks.values()) {
      c.meshDirty = true;
      c.version++;
    }
  }

  private buildOffsets(radius: number): void {
    const list: Array<[number, number, number]> = [];
    const r2 = (radius + 0.5) * (radius + 0.5);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = dx * dx + dz * dz;
        if (d <= r2) list.push([dx, dz, d]);
      }
    }
    list.sort((a, b) => a[2] - b[2]);
    this.offsets = new Int16Array(list.length * 2);
    for (let i = 0; i < list.length; i++) {
      this.offsets[i * 2] = list[i][0];
      this.offsets[i * 2 + 1] = list[i][1];
    }
    this.offsetsRadius = radius;
    this.loadScanDone = false;
  }

  // ------------------------------------------------------------------ chargement

  private freeWorker(pool: WorkerSlot[], limit: number): WorkerSlot | null {
    let best: WorkerSlot | null = null;
    for (const w of pool) {
      if (w.busy < limit && (!best || w.busy < best.busy)) best = w;
    }
    return best;
  }

  private requestLoads(): void {
    if (this.loadScanDone) return;
    const o = this.offsets;
    let pendingLeft = false;
    for (let i = 0; i < o.length; i += 2) {
      const cx = this.centerX + o[i];
      const cz = this.centerZ + o[i + 1];
      const key = chunkKey(cx, cz);
      if (this.world.chunks.has(key) || this.loading.has(key)) continue;
      const saved = this.saveQueue.get(key) ?? this.saveWriting.get(key);
      if (saved) {
        this.addSavedChunk(cx, cz, saved);
        continue;
      }
      if (this.storage && this.savedKeys.has(key)) {
        if (this.storageLoads >= MAX_STORAGE_LOADS) {
          pendingLeft = true;
          continue;
        }
        this.loadFromStorage(cx, cz, key);
        continue;
      }
      const slot = this.freeWorker(this.genWorkers, IN_FLIGHT_PER_WORKER);
      if (!slot) {
        pendingLeft = true;
        break;
      }
      this.generate(slot, cx, cz, key);
    }
    if (!pendingLeft) this.loadScanDone = true;
  }

  private generate(slot: WorkerSlot, cx: number, cz: number, key: number): void {
    this.loading.add(key);
    slot.busy++;
    const req: GenRequest = { type: 'gen', cx, cz };
    slot.worker.postMessage(req);
  }

  private loadFromStorage(cx: number, cz: number, key: number): void {
    this.loading.add(key);
    this.storageLoads++;
    this.storage!
      .loadChunk(this.worldId, key)
      .catch((err: unknown) => {
        console.warn(`Chunk ${cx},${cz} illisible, régénéré`, err);
        return undefined;
      })
      .then((saved) => {
        this.storageLoads--;
        this.loadScanDone = false;
        if (this.disposed || !this.loading.has(key)) return;
        if (saved) {
          this.loading.delete(key);
          this.addSavedChunk(cx, cz, saved);
          return;
        }
        // rien d'exploitable : on régénère
        this.savedKeys.delete(key);
        this.loading.delete(key);
      });
  }

  private addSavedChunk(cx: number, cz: number, saved: SavedChunk): void {
    const heightmap = new Uint8Array(CHUNK_AREA);
    const blocks = saved.blocks.slice();
    computeHeightmap(blocks, heightmap);
    const chunk = new Chunk(cx, cz, blocks, saved.meta.slice(), saved.biomes.slice(), heightmap, saved.tints.slice());
    chunk.modified = true;
    this.world.addChunk(chunk);
    for (const raw of saved.blockEntities) {
      const be = raw as BlockEntity;
      if (be && typeof be.type === 'string') this.world.setBlockEntity(structuredClone(be));
    }
    chunk.saveDirty = false;
    this.hooks.chunkLoaded(chunk, saved.entities);
    this.chunkArrived(chunk);
  }

  private onGenerated(m: GenResponse): void {
    if (this.disposed) return;
    this.loadScanDone = false;
    const key = chunkKey(m.cx, m.cz);
    if (!this.loading.delete(key)) return;
    if (this.world.chunks.has(key)) return;
    if (!this.inRange(m.cx, m.cz, this.viewDistance + 1 + UNLOAD_MARGIN)) return;
    const chunk = new Chunk(m.cx, m.cz, m.blocks, m.meta, m.biomes, m.heightmap, m.tints);
    this.world.addChunk(chunk);
    this.hooks.chunkLoaded(chunk, null);
    this.chunkArrived(chunk);
  }

  /** Un chunk vient d'arriver : ses voisins déjà maillés doivent tenir compte de ses blocs. */
  private chunkArrived(chunk: Chunk): void {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const n = this.world.getChunk(chunk.cx + dx, chunk.cz + dz);
        if (n && (n.meshed || n.meshPending)) {
          n.meshDirty = true;
          n.version++;
        }
      }
    }
  }

  private inRange(cx: number, cz: number, radius: number): boolean {
    const dx = cx - this.centerX;
    const dz = cz - this.centerZ;
    return dx * dx + dz * dz <= (radius + 0.5) * (radius + 0.5);
  }

  // ------------------------------------------------------------------ maillage

  private neighborsLoaded(c: Chunk): boolean {
    const w = this.world;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx !== 0 || dz !== 0) && !w.chunks.has(chunkKey(c.cx + dx, c.cz + dz))) return false;
      }
    }
    return true;
  }

  private requestMeshes(): void {
    // 1) modifications du joueur et du monde : priorité absolue
    const dirty = this.world.dirty;
    if (dirty.size > 0) {
      for (const c of dirty) {
        if (!c.meshDirty) {
          dirty.delete(c);
          c.urgent = false;
          continue;
        }
        if (c.meshPending) continue;
        if (!c.meshed && !this.inRange(c.cx, c.cz, this.viewDistance)) {
          // jamais maillé et hors de vue : suivra le circuit normal
          dirty.delete(c);
          c.urgent = false;
          continue;
        }
        if (!this.neighborsLoaded(c)) continue;
        const slot = this.freeWorker(this.meshWorkers, URGENT_IN_FLIGHT_PER_WORKER);
        if (!slot) break;
        this.sendMesh(slot, c);
        dirty.delete(c);
        c.urgent = false;
      }
    }

    // 2) le reste, du plus proche au plus lointain
    let slot = this.freeWorker(this.meshWorkers, IN_FLIGHT_PER_WORKER);
    if (!slot) return;
    const o = this.offsets;
    const w = this.world;
    for (let i = 0; i < o.length; i += 2) {
      const cx = this.centerX + o[i];
      const cz = this.centerZ + o[i + 1];
      const c = w.chunks.get(chunkKey(cx, cz));
      if (!c || !c.meshDirty || c.meshPending) continue;
      if (!this.inRange(cx, cz, this.viewDistance)) continue;
      if (!this.neighborsLoaded(c)) continue;
      this.sendMesh(slot, c);
      slot = this.freeWorker(this.meshWorkers, IN_FLIGHT_PER_WORKER);
      if (!slot) return;
    }
  }

  private sendMesh(slot: WorkerSlot, c: Chunk): void {
    const w = this.world;
    let top = 0;
    const chunks: Chunk[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = w.chunks.get(chunkKey(c.cx + dx, c.cz + dz))!;
        chunks.push(n);
        if (n.top > top) top = n.top;
      }
    }
    top = Math.min(CHUNK_HEIGHT, top + 2);
    const len = top << 8;
    const blocks: Uint8Array[] = [];
    const metas: Uint8Array[] = [];
    const transfer: ArrayBuffer[] = [];
    for (const n of chunks) {
      const b = n.blocks.slice(0, len);
      const m = n.meta.slice(0, len);
      blocks.push(b);
      metas.push(m);
      transfer.push(b.buffer, m.buffer);
    }
    const id = this.nextMeshId++;
    const req: MeshRequest = { id, cx: c.cx, cz: c.cz, blocks, metas, tints: c.tints, top, fancy: this.fancy };
    c.meshPending = true;
    c.meshDirty = false;
    c.meshedVersion = c.version;
    this.meshSent.set(id, { chunk: c, at: performance.now() });
    slot.busy++;
    slot.worker.postMessage(req, transfer);
  }

  private onMeshed(r: MeshResult): void {
    if (this.disposed) return;
    const sent = this.meshSent.get(r.id);
    this.meshSent.delete(r.id);
    if (!sent) return;
    const c = sent.chunk;
    this.stats.meshMs = this.stats.meshMs * 0.9 + (performance.now() - sent.at) * 0.1;
    c.meshPending = false;
    if (this.world.chunks.get(c.key) !== c) return; // déchargé entre-temps
    if (c.version !== c.meshedVersion) c.meshDirty = true;

    const old = c.light;
    const first = !c.meshed;
    c.light = r.light;
    c.meshed = true;
    this.stats.meshed++;
    this.sink.setChunkMesh(c.cx, c.cz, r.opaque, r.translucent);
    if (!first) this.propagateLightChange(c, old, r.light);
  }

  /** Si la lumière a changé sur une bordure, le chunk voisin doit être remaillé. */
  private propagateLightChange(c: Chunk, a: Uint8Array, b: Uint8Array): void {
    const top = Math.min(CHUNK_HEIGHT, c.top + 2);
    let west = false;
    let east = false;
    let north = false;
    let south = false;
    for (let y = 0; y < top && !(west && east && north && south); y++) {
      const base = y << 8;
      for (let i = 0; i < 16; i++) {
        const w = base | (i << 4);
        const e = w | 15;
        const n = base | i;
        const s = n | 0xf0;
        if (a[w] !== b[w]) west = true;
        if (a[e] !== b[e]) east = true;
        if (a[n] !== b[n]) north = true;
        if (a[s] !== b[s]) south = true;
      }
    }
    if (west) this.remeshNeighbor(c.cx - 1, c.cz);
    if (east) this.remeshNeighbor(c.cx + 1, c.cz);
    if (north) this.remeshNeighbor(c.cx, c.cz - 1);
    if (south) this.remeshNeighbor(c.cx, c.cz + 1);
    if (west && north) this.remeshNeighbor(c.cx - 1, c.cz - 1);
    if (east && north) this.remeshNeighbor(c.cx + 1, c.cz - 1);
    if (west && south) this.remeshNeighbor(c.cx - 1, c.cz + 1);
    if (east && south) this.remeshNeighbor(c.cx + 1, c.cz + 1);
  }

  private remeshNeighbor(cx: number, cz: number): void {
    const n = this.world.getChunk(cx, cz);
    if (!n || !n.meshed) return;
    n.meshDirty = true;
    n.version++;
    n.urgent = true;
    this.world.dirty.add(n);
  }

  // ------------------------------------------------------------------ déchargement et sauvegarde

  private unloadFar(): void {
    const limit = this.viewDistance + 1 + UNLOAD_MARGIN;
    for (const c of this.world.chunks.values()) {
      if (this.inRange(c.cx, c.cz, limit)) continue;
      this.unload(c);
    }
  }

  private unload(c: Chunk): void {
    const entities = this.hooks.chunkEntities(c, true);
    if (c.modified) this.saveQueue.set(c.key, this.snapshot(c, entities));
    this.dropBlockEntities(c);
    this.world.removeChunk(c);
    this.sink.removeChunk(c.cx, c.cz);
  }

  private blockEntitiesOf(c: Chunk): BlockEntity[] {
    const out: BlockEntity[] = [];
    if (this.world.blockEntities.size === 0) return out;
    for (const be of this.world.blockEntities.values()) {
      if (be.x >> 4 === c.cx && be.z >> 4 === c.cz) out.push(be);
    }
    return out;
  }

  private dropBlockEntities(c: Chunk): void {
    if (this.world.blockEntities.size === 0) return;
    for (const [k, be] of this.world.blockEntities) {
      if (be.x >> 4 === c.cx && be.z >> 4 === c.cz) this.world.blockEntities.delete(k);
    }
  }

  private snapshot(c: Chunk, entities: unknown[]): SavedChunk {
    c.saveDirty = false;
    return {
      key: c.key,
      blocks: c.blocks.slice(),
      meta: c.meta.slice(),
      biomes: c.biomes,
      tints: c.tints,
      blockEntities: structuredClone(this.blockEntitiesOf(c)),
      entities,
    };
  }

  /** Met en file tous les chunks chargés qui ont changé depuis leur dernière sauvegarde. */
  queueDirtyChunks(): void {
    for (const c of this.world.chunks.values()) {
      if (!c.modified) continue;
      const entities = this.hooks.chunkEntities(c, false);
      if (!c.saveDirty && entities.length === 0) continue;
      this.saveQueue.set(c.key, this.snapshot(c, entities));
    }
  }

  /** Écrit la file de sauvegarde. La promesse se résout quand tout est sur le disque. */
  flushSaves(): Promise<void> {
    if (!this.storage) {
      this.saveQueue.clear();
      return Promise.resolve();
    }
    if (this.saveQueue.size > 0) {
      const batch = [...this.saveQueue.values()];
      this.saveQueue.clear();
      for (const s of batch) this.saveWriting.set(s.key, s);
      const storage = this.storage;
      this.saveChain = this.saveChain.then(async () => {
        try {
          for (let i = 0; i < batch.length; i += SAVE_BATCH) {
            await storage.saveChunks(this.worldId, batch.slice(i, i + SAVE_BATCH));
          }
          for (const s of batch) this.savedKeys.add(s.key);
          this.saveError = null;
        } catch (err) {
          this.saveError = err instanceof Error ? err.message : String(err);
          console.error('Sauvegarde des chunks impossible', err);
        } finally {
          for (const s of batch) {
            if (this.saveWriting.get(s.key) === s) this.saveWriting.delete(s.key);
          }
        }
      });
    }
    return this.saveChain;
  }

  /** Sauvegarde complète (autosauvegarde, retour au menu). */
  saveAll(): Promise<void> {
    this.queueDirtyChunks();
    return this.flushSaves();
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.genWorkers) w.worker.terminate();
    for (const w of this.meshWorkers) w.worker.terminate();
    this.genWorkers.length = 0;
    this.meshWorkers.length = 0;
    this.loading.clear();
    this.meshSent.clear();
  }
}
