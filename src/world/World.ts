/**
 * Le monde chargé sur le thread principal : accès aux blocs, lumière, boîtes de collision,
 * ticks planifiés et ticks aléatoires. Aucune dépendance au rendu.
 */
import { B } from './Ids';
import { BLOCK_OPAQUE, BLOCK_RANDOM_TICKS, BLOCK_SHAPE, BLOCK_SOLID, SHAPE } from './Blocks';
import { collisionBoxes, selectionBoxes, type NeighborFn } from './BlockModels';
import { blockDrops } from './Drops';
import { CHUNK_HEIGHT, chunkKey, type WorldType } from './Constants';
import { createGameRules, type GameRules } from './GameRules';
import { mulberry32 } from './gen/Noise';
import type { Chunk } from './Chunk';
import { neighborChanged, randomTick, scheduledTick } from './Behavior';
import { hasRedstoneNearby, isRedstoneBlock, tickRedstone, updateRedstoneAround } from './Redstone';

/** Donnée attachée à un bloc (coffre, fourneau, générateur de monstres). */
export interface BlockEntity {
  type: string;
  x: number;
  y: number;
  z: number;
}

export type WorldEffect =
  /** Bloc cassé : particules et son (a = id, b = méta). */
  | 'break'
  /** Lave éteinte / eau évaporée : sifflement et fumée. */
  | 'fizz'
  /** Bloc posé par le monde (a = id). */
  | 'place'
  /** Pousse d'une plante à la poudre d'os. */
  | 'grow';

/** Ce que le monde demande au jeu (entités, effets). */
export interface WorldHost {
  /** Lâche un objet au centre du bloc donné. */
  dropItem(x: number, y: number, z: number, id: number, count: number): void;
  /** Transforme le bloc en entité « bloc qui tombe ». Retourne false si le jeu ne s'en charge pas. */
  spawnFallingBlock(x: number, y: number, z: number, id: number, meta: number): boolean;
  /** Amorce une TNT (le bloc a déjà été retiré). */
  primeTnt(x: number, y: number, z: number, fuse: number): void;
  effect(kind: WorldEffect, x: number, y: number, z: number, a?: number, b?: number): void;
  /** Une entité de bloc vient d'être retirée (son bloc a disparu) : lâcher son contenu. */
  blockEntityRemoved(be: BlockEntity): void;
  /** Pousse les entités dans la boîte donnée (piston). */
  pushEntities?(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dx: number, dy: number, dz: number): void;
  /** Indique si au moins une entité vivante (optionnellement d'un type donné) croise la boîte. */
  hasEntityInBox?(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind?: string): boolean;
  /** Prépare une entité de bloc (ex. tirage du butin d'un coffre avant lecture par un comparateur). */
  prepareBlockEntity?(be: BlockEntity): void;
  /** Déclenche un distributeur ou un dropper. */
  dispense?(x: number, y: number, z: number, dropper: boolean): void;
  /** Joue une note depuis un bloc musical. */
  playNote?(x: number, y: number, z: number, instrument: string, note: number, pitch: number): void;
  /** Aspire un objet posé sur un entonnoir ; retourne true si au moins un exemplaire a été pris. */
  pullItemForHopper?(x: number, y: number, z: number, accept: (stack: { id: number; count: number; damage: number; enchants?: Record<string, number>; potion?: string }) => boolean): boolean;
}

const NO_HOST: WorldHost = {
  dropItem: () => {},
  spawnFallingBlock: () => false,
  primeTnt: () => {},
  effect: () => {},
  blockEntityRemoved: () => {},
};

const POS_BIAS = 1 << 20;
const POS_SPAN = 1 << 21;

/** Clé numérique unique d'une position de bloc. */
export function posKey(x: number, y: number, z: number): number {
  return ((x + POS_BIAS) * POS_SPAN + (z + POS_BIAS)) * 128 + y;
}
export function posKeyX(k: number): number {
  return Math.floor(k / (POS_SPAN * 128)) - POS_BIAS;
}
export function posKeyY(k: number): number {
  return k % 128;
}
export function posKeyZ(k: number): number {
  return (Math.floor(k / 128) % POS_SPAN) - POS_BIAS;
}

/** Nombre maximal de ticks planifiés traités par tick de jeu (le reste est reporté). */
const MAX_SCHEDULED_PER_TICK = 3000;
/** Rayon (en chunks) des ticks aléatoires autour du joueur. */
const RANDOM_TICK_RADIUS = 5;

function hasBlockEntity(id: number): boolean {
  return (
    id === B.CHEST ||
    id === B.FURNACE ||
    id === B.FURNACE_LIT ||
    id === B.BREWING_STAND ||
    id === B.SPAWNER ||
    id === B.SIGN ||
    id === B.WALL_SIGN ||
    id === B.HOPPER ||
    id === B.DISPENSER ||
    id === B.DROPPER ||
    id === B.DAYLIGHT_DETECTOR
  );
}

export class World {
  readonly chunks = new Map<number, Chunk>();
  /** Chunks dont le maillage est à refaire (consommé par le gestionnaire de chunks). */
  readonly dirty = new Set<Chunk>();
  readonly blockEntities = new Map<number, BlockEntity>();
  host: WorldHost = NO_HOST;
  readonly seed: number;
  readonly worldType: WorldType;
  /** Version du générateur de ce monde (voir GEN_VERSION). */
  readonly genVersion: number;
  readonly rng: () => number;

  /** Âge du monde en ticks. */
  age = 0;
  /** Assombrissement du ciel (0 = plein jour, 11 = nuit noire) : sert aux règles de lumière. */
  skyDarken = 0;
  raining = false;
  /** Règles du monde (/gamerule). */
  readonly rules: GameRules = createGameRules();

  private lastChunk: Chunk | null = null;
  private lastKey = -1;

  private buckets = new Map<number, number[]>();
  private pending = new Set<number>();
  private overflow: number[] = [];

  // position courante de la fonction de voisinage partagée
  private nbX = 0;
  private nbY = 0;
  private nbZ = 0;
  private readonly nb: NeighborFn = (dx, dy, dz) => this.getBlockAndMeta(this.nbX + dx, this.nbY + dy, this.nbZ + dz);
  private readonly tmp: number[] = [];

  constructor(seed = (Math.random() * 0xffffffff) >>> 0, worldType: WorldType = 'default', genVersion = 1) {
    this.seed = seed >>> 0;
    this.worldType = worldType;
    this.genVersion = genVersion;
    this.rng = mulberry32(this.seed);
  }

  // ------------------------------------------------------------------ chunks

  getChunk(cx: number, cz: number): Chunk | undefined {
    const key = chunkKey(cx, cz);
    if (key === this.lastKey) return this.lastChunk ?? undefined;
    const c = this.chunks.get(key);
    if (c) {
      this.lastKey = key;
      this.lastChunk = c;
    }
    return c;
  }

  chunkAt(x: number, z: number): Chunk | undefined {
    return this.getChunk(x >> 4, z >> 4);
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunk.key, chunk);
  }

  removeChunk(chunk: Chunk): void {
    this.chunks.delete(chunk.key);
    this.dirty.delete(chunk);
    if (this.lastChunk === chunk) {
      this.lastChunk = null;
      this.lastKey = -1;
    }
  }

  isLoaded(x: number, z: number): boolean {
    return this.getChunk(x >> 4, z >> 4) !== undefined;
  }

  /** Les chunks contenant le carré de rayon r autour de (x, z) sont-ils tous chargés ? */
  isAreaLoaded(x: number, z: number, r: number): boolean {
    const cx0 = (x - r) >> 4;
    const cx1 = (x + r) >> 4;
    const cz0 = (z - r) >> 4;
    const cz1 = (z + r) >> 4;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) if (!this.getChunk(cx, cz)) return false;
    }
    return true;
  }

  clear(): void {
    this.chunks.clear();
    this.dirty.clear();
    this.blockEntities.clear();
    this.buckets.clear();
    this.pending.clear();
    this.overflow.length = 0;
    this.lastChunk = null;
    this.lastKey = -1;
  }

  // ------------------------------------------------------------------ blocs

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y >= CHUNK_HEIGHT) return B.AIR;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return B.AIR;
    return c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.meta[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }

  /** id | (méta << 8). */
  getBlockAndMeta(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y >= CHUNK_HEIGHT) return B.AIR;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return B.AIR;
    const i = (y << 8) | ((z & 15) << 4) | (x & 15);
    return c.blocks[i] | (c.meta[i] << 8);
  }

  /**
   * Écrit un bloc. Prévient les voisins (chute du sable, écoulement de l'eau, plantes sans support…)
   * sauf si `notify` vaut false. Retourne false si la position n'est pas modifiable.
   */
  setBlock(x: number, y: number, z: number, id: number, meta = 0, notify = true): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const c = this.getChunk(cx, cz);
    if (!c) return false;
    const lx = x & 15;
    const lz = z & 15;
    const i = (y << 8) | (lz << 4) | lx;
    const old = c.blocks[i];
    if (old === id && c.meta[i] === meta) return true;
    c.set(lx, y, lz, id, meta);
    this.markDirty(c, lx, lz);

    if (old !== id && hasBlockEntity(old) && !(hasBlockEntity(id) && (old === B.FURNACE || old === B.FURNACE_LIT) && (id === B.FURNACE || id === B.FURNACE_LIT))) {
      const k = posKey(x, y, z);
      const be = this.blockEntities.get(k);
      if (be) {
        this.blockEntities.delete(k);
        this.host.blockEntityRemoved(be);
      }
    }

    if (notify) {
      neighborChanged(this, x, y, z);
      this.notifyNeighbors(x, y, z);
      if (isRedstoneBlock(old) || isRedstoneBlock(id) || hasRedstoneNearby(this, x, y, z)) {
        updateRedstoneAround(this, x, y, z);
      }
    }
    return true;
  }

  /** Change seulement la méta (sans prévenir les voisins par défaut). */
  setMeta(x: number, y: number, z: number, meta: number, notify = false): void {
    const id = this.getBlock(x, y, z);
    if (id === B.AIR) return;
    this.setBlock(x, y, z, id, meta, notify);
  }

  /**
   * Change la méta sans remailler ni prévenir personne : pour les compteurs internes
   * qui ne changent pas l'apparence (âge du feu, croissance de la canne à sucre…).
   */
  setMetaSilent(x: number, y: number, z: number, meta: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    c.meta[(y << 8) | ((z & 15) << 4) | (x & 15)] = meta;
    c.modified = true;
    c.saveDirty = true;
  }

  notifyNeighbors(x: number, y: number, z: number): void {
    neighborChanged(this, x - 1, y, z);
    neighborChanged(this, x + 1, y, z);
    neighborChanged(this, x, y - 1, z);
    neighborChanged(this, x, y + 1, z);
    neighborChanged(this, x, y, z - 1);
    neighborChanged(this, x, y, z + 1);
  }

  /** Marque le chunk (et ses voisins si le bloc touche une bordure) comme à remailler en priorité. */
  private markDirty(c: Chunk, lx: number, lz: number): void {
    c.urgent = true;
    this.dirty.add(c);
    const dx = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const dz = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (dx !== 0) this.touch(c.cx + dx, c.cz);
    if (dz !== 0) this.touch(c.cx, c.cz + dz);
    if (dx !== 0 && dz !== 0) this.touch(c.cx + dx, c.cz + dz);
  }

  private touch(cx: number, cz: number): void {
    const n = this.chunks.get(chunkKey(cx, cz));
    if (!n) return;
    n.meshDirty = true;
    n.urgent = true;
    n.version++;
    this.dirty.add(n);
  }

  /**
   * Casse un bloc comme le ferait le monde (support disparu, eau, explosion) :
   * effet, objets lâchés à la main nue si `drop`, puis air.
   */
  breakBlock(x: number, y: number, z: number, drop: boolean): void {
    const v = this.getBlockAndMeta(x, y, z);
    const id = v & 255;
    if (id === B.AIR) return;
    const meta = v >> 8;
    if (BLOCK_SHAPE[id] !== SHAPE.FLUID) this.host.effect('break', x, y, z, id, meta);
    if (drop) {
      const drops = blockDrops(id, meta, 0, this.rng);
      for (const d of drops) this.host.dropItem(x, y, z, d.id, d.count);
    }
    this.setBlock(x, y, z, B.AIR, 0);
  }

  // ------------------------------------------------------------------ requêtes

  isSolid(x: number, y: number, z: number): boolean {
    return BLOCK_SOLID[this.getBlock(x, y, z)] === 1;
  }

  isOpaque(x: number, y: number, z: number): boolean {
    return BLOCK_OPAQUE[this.getBlock(x, y, z)] === 1;
  }

  /** y du plus haut bloc non vide + 1 (0 si la colonne n'est pas chargée). */
  heightAt(x: number, z: number): number {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.heightmap[((z & 15) << 4) | (x & 15)] : 0;
  }

  /** y de la première cellule libre au-dessus du plus haut bloc qui arrête la pluie (solide ou fluide). */
  rainHeight(x: number, z: number): number {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    const col = ((z & 15) << 4) | (x & 15);
    let y = c.heightmap[col] - 1;
    while (y >= 0) {
      const id = c.blocks[(y << 8) | col];
      if (BLOCK_SOLID[id] || BLOCK_SHAPE[id] === SHAPE.FLUID) break;
      y--;
    }
    return y + 1;
  }

  canSeeSky(x: number, y: number, z: number): boolean {
    return y >= this.rainHeight(x, z);
  }

  biomeAt(x: number, z: number): number {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.biomes[((z & 15) << 4) | (x & 15)] : 0;
  }

  // ------------------------------------------------------------------ lumière

  /** (ciel << 4) | blocs. Plein ciel hors du monde chargé. */
  getRawLight(x: number, y: number, z: number): number {
    if (y >= CHUNK_HEIGHT) return 0xf0;
    if (y < 0) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0xf0;
    return c.light[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }

  getSkyLight(x: number, y: number, z: number): number {
    return this.getRawLight(x, y, z) >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    return this.getRawLight(x, y, z) & 15;
  }

  /** Lumière effective (0..15) : blocs ou ciel assombri par l'heure. */
  getLight(x: number, y: number, z: number): number {
    const l = this.getRawLight(x, y, z);
    const sky = (l >> 4) - this.skyDarken;
    const blk = l & 15;
    return sky > blk ? sky : blk;
  }

  // ------------------------------------------------------------------ boîtes

  /** Fonction de voisinage centrée sur (x, y, z) : instance partagée, à utiliser immédiatement. */
  neighborFn(x: number, y: number, z: number): NeighborFn {
    this.nbX = x;
    this.nbY = y;
    this.nbZ = z;
    return this.nb;
  }

  /**
   * Ajoute à `out` les boîtes de collision (absolues, en blocs : x0, y0, z0, x1, y1, z1)
   * de tous les blocs susceptibles de toucher la région donnée.
   */
  collectCollisions(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: number[]): void {
    const bx0 = Math.floor(x0);
    const bx1 = Math.floor(x1);
    const by0 = Math.max(0, Math.floor(y0) - 1); // les barrières dépassent d'un demi-bloc
    const by1 = Math.min(CHUNK_HEIGHT - 1, Math.floor(y1));
    const bz0 = Math.floor(z0);
    const bz1 = Math.floor(z1);
    const tmp = this.tmp;
    for (let x = bx0; x <= bx1; x++) {
      for (let z = bz0; z <= bz1; z++) {
        const c = this.getChunk(x >> 4, z >> 4);
        if (!c) {
          // chunk non chargé : mur plein, pour ne pas tomber dans le vide
          out.push(x, by0, z, x + 1, by1 + 1, z + 1);
          continue;
        }
        const col = ((z & 15) << 4) | (x & 15);
        for (let y = by0; y <= by1; y++) {
          const i = (y << 8) | col;
          const id = c.blocks[i];
          if (!BLOCK_SOLID[id]) continue;
          if (BLOCK_SHAPE[id] === SHAPE.CUBE) {
            out.push(x, y, z, x + 1, y + 1, z + 1);
            continue;
          }
          tmp.length = 0;
          collisionBoxes(id, c.meta[i], this.neighborFn(x, y, z), tmp);
          for (let k = 0; k < tmp.length; k += 6) {
            out.push(x + tmp[k] / 16, y + tmp[k + 1] / 16, z + tmp[k + 2] / 16, x + tmp[k + 3] / 16, y + tmp[k + 4] / 16, z + tmp[k + 5] / 16);
          }
        }
      }
    }
    // plancher sous le monde
    if (y0 < 0) out.push(bx0, -64, bz0, bx1 + 1, 0, bz1 + 1);
  }

  /** Boîtes de sélection du bloc (seizièmes, relatives au bloc). */
  selectionBoxesAt(x: number, y: number, z: number, out: number[]): void {
    const v = this.getBlockAndMeta(x, y, z);
    selectionBoxes(v & 255, v >> 8, this.neighborFn(x, y, z), out);
  }

  /** Boîtes de collision du bloc (seizièmes, relatives au bloc). */
  collisionBoxesAt(x: number, y: number, z: number, out: number[]): void {
    const v = this.getBlockAndMeta(x, y, z);
    collisionBoxes(v & 255, v >> 8, this.neighborFn(x, y, z), out);
  }

  // ------------------------------------------------------------------ entités de blocs

  getBlockEntity(x: number, y: number, z: number): BlockEntity | undefined {
    return this.blockEntities.get(posKey(x, y, z));
  }

  /**
   * Attache une entité de bloc. `generated` : elle vient du générateur (coffre d'un donjon…) ;
   * le chunk reste « non modifié » puisqu'il la retrouvera à l'identique en étant régénéré.
   */
  setBlockEntity(be: BlockEntity, generated = false): void {
    this.blockEntities.set(posKey(be.x, be.y, be.z), be);
    if (generated) return;
    const c = this.chunkAt(be.x, be.z);
    if (c) {
      c.modified = true;
      c.saveDirty = true;
    }
  }

  /** Signale qu'une entité de bloc a changé (pour la sauvegarde). */
  markBlockEntityDirty(be: BlockEntity): void {
    const c = this.chunkAt(be.x, be.z);
    if (c) {
      c.modified = true;
      c.saveDirty = true;
    }
  }

  // ------------------------------------------------------------------ ticks

  /** Planifie un tick du bloc dans `delay` ticks (ignoré si un tick est déjà planifié pour lui). */
  scheduleTick(x: number, y: number, z: number, delay: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const k = posKey(x, y, z);
    if (this.pending.has(k)) return;
    this.pending.add(k);
    const at = this.age + Math.max(1, delay);
    let bucket = this.buckets.get(at);
    if (!bucket) this.buckets.set(at, (bucket = []));
    bucket.push(k);
  }

  /** Avance le monde d'un tick : ticks planifiés puis ticks aléatoires autour de (px, pz). */
  tick(px: number, pz: number): void {
    this.age++;
    tickRedstone(this);

    // --- ticks planifiés ---
    let due = this.overflow;
    this.overflow = [];
    const bucket = this.buckets.get(this.age);
    if (bucket) {
      this.buckets.delete(this.age);
      due = due.length ? due.concat(bucket) : bucket;
    }
    const n = Math.min(due.length, MAX_SCHEDULED_PER_TICK);
    for (let i = 0; i < n; i++) {
      const k = due[i];
      this.pending.delete(k);
      const x = posKeyX(k);
      const y = posKeyY(k);
      const z = posKeyZ(k);
      const c = this.getChunk(x >> 4, z >> 4);
      if (!c) continue;
      if (!this.isAreaLoaded(x, z, 1)) {
        // bordure du monde chargé : on réessaiera plus tard
        this.scheduleTick(x, y, z, 20);
        continue;
      }
      const idx = (y << 8) | ((z & 15) << 4) | (x & 15);
      scheduledTick(this, x, y, z, c.blocks[idx], c.meta[idx]);
    }
    for (let i = n; i < due.length; i++) this.overflow.push(due[i]);

    // --- ticks aléatoires ---
    const pcx = Math.floor(px) >> 4;
    const pcz = Math.floor(pz) >> 4;
    const rng = this.rng;
    for (let dz = -RANDOM_TICK_RADIUS; dz <= RANDOM_TICK_RADIUS; dz++) {
      for (let dx = -RANDOM_TICK_RADIUS; dx <= RANDOM_TICK_RADIUS; dx++) {
        const c = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
        if (!c || !c.meshed) continue;
        const sections = Math.min(8, (c.top + 15) >> 4);
        const span = sections * 16;
        for (let s = sections * 3; s > 0; s--) {
          const r = (rng() * 0x1000000) | 0;
          const lx = r & 15;
          const lz = (r >> 4) & 15;
          const y = ((r >> 8) & 0xffff) % span;
          const idx = (y << 8) | (lz << 4) | lx;
          const id = c.blocks[idx];
          if (!BLOCK_RANDOM_TICKS[id]) continue;
          randomTick(this, c.cx * 16 + lx, y, c.cz * 16 + lz, id, c.meta[idx]);
        }
      }
    }
  }
}
