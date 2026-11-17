/**
 * Apparition des créatures : animaux à la génération d'un chunk, monstres dans le noir autour du joueur.
 */
import { BLOCK_OPAQUE, BLOCK_SHAPE, BLOCK_SOLID, SHAPE } from '../world/Blocks';
import type { Chunk } from '../world/Chunk';
import { CHUNK_HEIGHT } from '../world/Constants';
import { B } from '../world/Ids';
import type { World } from '../world/World';
import { BIOME, isWaterBiome } from '../world/gen/Biomes';
import { FORTRESS_FLOOR_Y } from '../world/gen/Fortress';
import { hash2, mulberry32 } from '../world/gen/Noise';
import type { GameApi } from './Entity';
import { getMobModel } from './MobModels';
import type { MobKind } from './MobModels';
import { ANIMAL_CAP, ANIMAL_RADIUS, HOSTILE_KINDS, MagmaCube, PASSIVE_KINDS, createMob } from './Mobs';
import { isBoxFree } from './Physics';

export { ANIMAL_CAP, ANIMAL_RADIUS };

/** Plafond de monstres chargés selon la difficulté (0 paisible … 3 difficile). */
export const MONSTER_CAPS: readonly number[] = [0, 20, 40, 60];

/** Un chunk neuf sur 8 tente un groupe d'animaux (un peu moins aboutissent : biome, place sur l'herbe). */
const ANIMAL_CHUNK_CHANCE = 1 / 8;
/** En monde plat (100 % plaine dégagée), tirage 4 fois plus rare pour éviter la surpopulation autour du joueur. */
const FLAT_ANIMAL_CHUNK_CHANCE = 1 / 32;
/** Ticks entre deux cycles d'apparition des monstres. */
const SPAWN_INTERVAL = 20;
/** Groupes tentés par cycle. */
const PACKS_PER_CYCLE = 4;
/** Distances d'apparition autour du joueur. */
const MIN_DISTANCE = 24;
const MAX_DISTANCE = 64;
/** Lumière totale maximale pour qu'un monstre apparaisse. */
const MAX_LIGHT = 7;

const TAU = Math.PI * 2;

/** Espèces de monstres de la surface, pondérées. */
const MONSTER_TABLE: readonly MobKind[] = ['zombie', 'zombie', 'zombie', 'skeleton', 'skeleton', 'skeleton', 'creeper', 'creeper', 'spider', 'spider'];

/** Espèces du Nether, pondérées (cochon-zombie majoritaire, cube de magma moins fréquent, ghast rare). */
const NETHER_TABLE: readonly MobKind[] = [
  'zombie_pigman', 'zombie_pigman', 'zombie_pigman', 'zombie_pigman',
  'zombie_pigman', 'zombie_pigman', 'zombie_pigman', 'zombie_pigman',
  'zombie_pigman', 'zombie_pigman', 'zombie_pigman', 'zombie_pigman',
  'magma_cube', 'magma_cube', 'magma_cube',
  'ghast',
];

/** Gardiens d'une forteresse du Nether, pondérés (Minecraft : wither 8, blaze 10 ; ici le blaze vient surtout des cages). */
const FORTRESS_TABLE: readonly MobKind[] = [
  'wither_skeleton', 'wither_skeleton', 'wither_skeleton', 'wither_skeleton', 'wither_skeleton',
  'blaze', 'blaze', 'zombie_pigman', 'zombie_pigman', 'magma_cube',
];

/** Nombre maximal de gardiens (squelettes wither et blazes) chargés à la fois, en plus du plafond ordinaire. */
const FORTRESS_GUARD_CAP = 8;

/** Gardien qui apparaît sur ce sol du Nether : seulement sur les briques d'une forteresse (null ailleurs). */
export function fortressGuard(below: number, rng: () => number): MobKind | null {
  return below === B.NETHER_BRICKS ? FORTRESS_TABLE[Math.floor(rng() * FORTRESS_TABLE.length)] : null;
}

const FARM: readonly MobKind[] = ['cow', 'sheep', 'pig', 'chicken'];
const FOREST: readonly MobKind[] = ['cow', 'sheep', 'pig', 'chicken', 'wolf'];
const COLD: readonly MobKind[] = ['sheep', 'sheep', 'cow', 'pig', 'chicken', 'wolf'];
const JUNGLE: readonly MobKind[] = ['chicken', 'chicken', 'pig', 'cow'];
const SWAMP: readonly MobKind[] = ['pig', 'pig', 'cow', 'chicken'];
const HILLS: readonly MobKind[] = ['sheep', 'sheep', 'cow'];

/** Animaux pouvant naître dans un biome ; null = aucun (océans, rivières, plages, désert). */
function animalsOf(biome: number): readonly MobKind[] | null {
  if (isWaterBiome(biome)) return null;
  switch (biome) {
    case BIOME.DESERT:
    case BIOME.BADLANDS:
    case BIOME.BEACH:
    case BIOME.SNOWY_BEACH:
    case BIOME.STONY_SHORE:
      return null;
    case BIOME.FOREST:
    case BIOME.BIRCH_FOREST:
    case BIOME.DARK_FOREST:
      return FOREST;
    case BIOME.TAIGA:
    case BIOME.SNOWY_TAIGA:
    case BIOME.SNOWY_PLAINS:
      return COLD;
    case BIOME.JUNGLE:
      return JUNGLE;
    case BIOME.SWAMP:
      return SWAMP;
    case BIOME.MOUNTAINS:
    case BIOME.SNOWY_MOUNTAINS:
      return HILLS;
    default:
      return FARM;
  }
}

function isFluidId(id: number): boolean {
  return BLOCK_SHAPE[id] === SHAPE.FLUID;
}

/** Cellule traversable et respirable : ni solide, ni fluide, ni feu. */
function isOpenCell(id: number): boolean {
  return BLOCK_SOLID[id] !== 1 && !isFluidId(id) && id !== B.FIRE;
}

export class Spawner {
  private timer = 0;
  private readonly hostile = new Set<MobKind>(HOSTILE_KINDS);
  private readonly passive = new Set<MobKind>(PASSIVE_KINDS);

  /**
   * Animaux d'un chunk qui vient d'être généré pour la première fois (jamais rechargé).
   * Déterministe : le tirage dépend de la graine du monde et des coordonnées du chunk.
   */
  populateChunk(game: GameApi, chunk: Chunk): void {
    if (game.dimension === 'nether') return;
    const seed = (Math.imul(game.world.seed, 0x9e3779b1) ^ 0x4d0b5a11) >>> 0;
    const rng = mulberry32(hash2(chunk.cx, chunk.cz, seed));
    const chance = game.world.worldType === 'flat' ? FLAT_ANIMAL_CHUNK_CHANCE : ANIMAL_CHUNK_CHANCE;
    if (rng() >= chance) return;

    // centre du groupe, à l'écart des bords : tout le groupe reste dans le chunk
    const cx = 3 + Math.floor(rng() * 10);
    const cz = 3 + Math.floor(rng() * 10);
    const kinds = animalsOf(chunk.biomes[(cz << 4) | cx]);
    if (!kinds) return;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const count = 2 + Math.floor(rng() * 3);
    const model = getMobModel(kind);
    const hw = model.width / 2;
    const bx = chunk.cx * 16;
    const bz = chunk.cz * 16;
    const used = new Set<number>();
    const spots: number[] = [];

    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const lx = cx + Math.floor(rng() * 7) - 3;
        const lz = cz + Math.floor(rng() * 7) - 3;
        const col = (lz << 4) | lx;
        if (used.has(col)) continue;
        const y = this.grassSurface(chunk, col);
        if (y < 0) continue;
        const x = bx + lx + 0.5;
        const z = bz + lz + 0.5;
        if (!isBoxFree(game.world, x - hw, y, z - hw, x + hw, y + model.height, z + hw)) continue;
        used.add(col);
        spots.push(x, y, z);
        break;
      }
    }
    // pas d'animal isolé : il faut de la place pour deux au moins
    if (spots.length < 6) return;
    for (let i = 0; i < spots.length; i += 3) {
      const mob = createMob(kind, rng);
      if (!mob) return;
      mob.setPosition(spots[i], spots[i + 1], spots[i + 2]);
      mob.setRotation(rng() * TAU);
      game.spawn(mob);
    }
  }

  /**
   * y des pieds d'un animal posé sur l'herbe de la colonne, ou -1 : il faut un bloc d'herbe à ciel ouvert
   * (rien de solide ni de fluide au-dessus) surmonté de deux cellules libres.
   */
  private grassSurface(chunk: Chunk, col: number): number {
    const blocks = chunk.blocks;
    let y = chunk.heightmap[col] - 1;
    // la carte des hauteurs compte aussi les plantes et la neige : descendre jusqu'au sol
    while (y >= 0 && isOpenCell(blocks[(y << 8) | col])) y--;
    if (y < 1 || y + 2 >= CHUNK_HEIGHT) return -1;
    if (blocks[(y << 8) | col] !== B.GRASS) return -1;
    return y + 1;
  }

  /** À chaque tick : apparition des monstres dans le noir (surface) ou des créatures du Nether, plafonds de population. */
  tick(game: GameApi): void {
    if (++this.timer < SPAWN_INTERVAL) return;
    this.timer = 0;
    const difficulty = Math.max(0, Math.min(3, Math.floor(game.difficulty)));
    const cap = MONSTER_CAPS[difficulty];
    if (cap <= 0) return;
    const count = this.countMonsters(game);
    if (game.dimension === 'nether') {
      // même au plafond, les gardiens des forteresses gardent leur propre quota
      this.tickNether(game, count, cap);
      return;
    }
    if (count >= cap) return;
    this.tickOverworld(game, count, cap);
  }

  private tickOverworld(game: GameApi, count: number, cap: number): void {

    const w = game.world;
    const p = game.player;
    const rng = game.rng;
    for (let pack = 0; pack < PACKS_PER_CYCLE && count < cap; pack++) {
      const a = rng() * TAU;
      const dist = MIN_DISTANCE + rng() * (MAX_DISTANCE - MIN_DISTANCE);
      const x = Math.floor(p.x + Math.cos(a) * dist);
      const z = Math.floor(p.z + Math.sin(a) * dist);
      const top = w.heightAt(x, z);
      if (top <= 0) continue;
      // une fois sur deux à la surface, sinon à une hauteur au hasard dans la colonne (grottes) ;
      // puis descente jusqu'à un sol
      const from = rng() < 0.5 ? top : 1 + Math.floor(rng() * Math.min(CHUNK_HEIGHT - 3, top + 1));
      const y = this.findFloor(w, x, Math.min(from, CHUNK_HEIGHT - 3), z, 12);
      if (y < 0) continue;

      const kind = MONSTER_TABLE[Math.floor(rng() * MONSTER_TABLE.length)];
      const size = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < size && count < cap; i++) {
        let sx = x;
        let sy = y;
        let sz = z;
        if (i > 0) {
          sx += Math.floor(rng() * 7) - 3;
          sz += Math.floor(rng() * 7) - 3;
          sy = this.findFloor(w, sx, y + 2, sz, 4);
          if (sy < 0) continue;
        }
        if (!this.canSpawnMonster(game, kind, sx, sy, sz)) continue;
        const mob = createMob(kind, rng);
        if (!mob) break;
        mob.setPosition(sx + 0.5, sy, sz + 0.5);
        mob.setRotation(rng() * TAU);
        game.spawn(mob);
        count++;
      }
    }
  }

  private tickNether(game: GameApi, count: number, cap: number): void {
    const w = game.world;
    const p = game.player;
    const rng = game.rng;
    let guards = 0;
    for (const e of game.entities) if (e.kind === 'mob' && !e.dead && (e.mobKind === 'wither_skeleton' || e.mobKind === 'blaze')) guards++;
    for (let pack = 0; pack < PACKS_PER_CYCLE; pack++) {
      const a = rng() * TAU;
      const dist = MIN_DISTANCE + rng() * (MAX_DISTANCE - MIN_DISTANCE);
      const x = Math.floor(p.x + Math.cos(a) * dist);
      const z = Math.floor(p.z + Math.sin(a) * dist);

      // Forteresse : une colonne qui croise ses briques est d'abord offerte à ses gardiens
      // (surtout des squelettes wither), dans la limite de leur quota. Comme dans Minecraft, il faut
      // être dans la forteresse : des briques posées ailleurs par le joueur n'attirent personne.
      if (guards < FORTRESS_GUARD_CAP) {
        const fy = this.findFloor(w, x, FORTRESS_FLOOR_Y + 8, z, 10);
        const inside = fy >= 0 && game.inStructure?.('fortress', x, z) === true;
        const guardKind = inside ? fortressGuard(w.getBlock(x, fy - 1, z), rng) : null;
        if (guardKind && this.canSpawnNetherGround(game, guardKind, x, fy, z)) {
          const guard = createMob(guardKind, rng);
          if (guard) {
            guard.setPosition(x + 0.5, guardKind === 'blaze' ? fy + 0.6 : fy, z + 0.5);
            guard.setRotation(rng() * TAU);
            game.spawn(guard);
            guards++;
            continue;
          }
        }
      }
      if (count >= cap) continue;
      const kind = NETHER_TABLE[Math.floor(rng() * NETHER_TABLE.length)];

      if (kind === 'ghast') {
        const y = 20 + Math.floor(rng() * 88);
        if (!this.canSpawnGhast(game, x, y, z)) continue;
        const ghast = createMob('ghast', rng);
        if (!ghast) continue;
        ghast.setPosition(x + 0.5, y, z + 0.5);
        ghast.setRotation(rng() * TAU);
        game.spawn(ghast);
        count++;
        continue;
      }

      const startY = 8 + Math.floor(rng() * 112);
      const y = this.findFloor(w, x, startY, z, 24);
      if (y < 0 || w.getBlock(x, y - 1, z) === B.BEDROCK) continue;
      // la faune ordinaire n'apparaît pas sur les briques d'une forteresse : elles sont à ses gardiens
      if (w.getBlock(x, y - 1, z) === B.NETHER_BRICKS) continue;
      const size = kind === 'zombie_pigman' ? 1 + Math.floor(rng() * 3) : 1;
      for (let i = 0; i < size && count < cap; i++) {
        let sx = x;
        let sy = y;
        let sz = z;
        if (i > 0) {
          sx += Math.floor(rng() * 7) - 3;
          sz += Math.floor(rng() * 7) - 3;
          sy = this.findFloor(w, sx, y + 3, sz, 6);
          if (sy < 0 || w.getBlock(sx, sy - 1, sz) === B.BEDROCK) continue;
        }
        if (!this.canSpawnNetherGround(game, kind, sx, sy, sz)) continue;
        const mob = createMob(kind, rng);
        if (!mob) break;
        if (mob instanceof MagmaCube) {
          const r = rng();
          mob.setSize(r < 0.35 ? 4 : r < 0.75 ? 2 : 1);
        }
        mob.setPosition(sx + 0.5, sy, sz + 0.5);
        mob.setRotation(rng() * TAU);
        game.spawn(mob);
        count++;
      }
    }
  }

  private canSpawnNetherGround(game: GameApi, kind: MobKind, x: number, y: number, z: number): boolean {
    const w = game.world;
    const chunk = w.chunkAt(x, z);
    if (!chunk || !chunk.meshed) return false;
    if (y < 1 || y + 2 >= CHUNK_HEIGHT) return false;
    const below = w.getBlock(x, y - 1, z);
    if (BLOCK_OPAQUE[below] !== 1 || BLOCK_SHAPE[below] !== SHAPE.CUBE || below === B.BEDROCK) return false;
    if (!isOpenCell(w.getBlock(x, y, z)) || !isOpenCell(w.getBlock(x, y + 1, z))) return false;
    const p = game.player;
    const dx = x + 0.5 - p.x;
    const dy = y - p.y;
    const dz = z + 0.5 - p.z;
    if (dx * dx + dy * dy + dz * dz < MIN_DISTANCE * MIN_DISTANCE) return false;

    const m = getMobModel(kind);
    const hw = m.width / 2;
    const x0 = x + 0.5 - hw;
    const z0 = z + 0.5 - hw;
    const x1 = x + 0.5 + hw;
    const z1 = z + 0.5 + hw;
    for (let bz = Math.floor(z0); bz <= Math.floor(z1); bz++) {
      for (let bx = Math.floor(x0); bx <= Math.floor(x1); bx++) {
        if (!w.isLoaded(bx, bz)) return false;
        if (isFluidId(w.getBlock(bx, y, bz)) || isFluidId(w.getBlock(bx, y + 1, bz))) return false;
      }
    }
    return isBoxFree(w, x0, y, z0, x1, y + m.height, z1);
  }

  private canSpawnGhast(game: GameApi, x: number, y: number, z: number): boolean {
    const w = game.world;
    const chunk = w.chunkAt(x, z);
    if (!chunk || !chunk.meshed) return false;
    if (y < 10 || y + 5 >= CHUNK_HEIGHT) return false;
    const p = game.player;
    const dx = x + 0.5 - p.x;
    const dy = y - p.y;
    const dz = z + 0.5 - p.z;
    if (dx * dx + dy * dy + dz * dz < MIN_DISTANCE * MIN_DISTANCE) return false;

    // Espace dégagé 5x5x5 autour du ghast
    for (let bz = z - 2; bz <= z + 2; bz++) {
      for (let bx = x - 2; bx <= x + 2; bx++) {
        if (!w.isLoaded(bx, bz)) return false;
        for (let by = y; by <= y + 4; by++) {
          const id = w.getBlock(bx, by, bz);
          if (!isOpenCell(id) || isFluidId(id)) return false;
        }
      }
    }
    return isBoxFree(w, x - 1.5, y, z - 1.5, x + 2.5, y + 4, z + 2.5);
  }

  /** Nombre de monstres vivants chargés. */
  countMonsters(game: GameApi): number {
    let n = 0;
    for (const e of game.entities) if (e.kind === 'mob' && !e.dead && this.hostile.has(e.mobKind)) n++;
    return n;
  }

  /** Nombre d'animaux vivants chargés. */
  countAnimals(game: GameApi): number {
    let n = 0;
    for (const e of game.entities) if (e.kind === 'mob' && !e.dead && this.passive.has(e.mobKind)) n++;
    return n;
  }

  /**
   * Première cellule, en descendant d'au plus `depth` depuis y, posée sur un bloc opaque plein
   * et surmontée d'une seconde cellule libre. Retourne son y, ou -1.
   */
  private findFloor(w: World, x: number, y: number, z: number, depth: number): number {
    for (let i = 0; i <= depth && y >= 1; i++, y--) {
      const below = w.getBlock(x, y - 1, z);
      if (BLOCK_OPAQUE[below] !== 1 || BLOCK_SHAPE[below] !== SHAPE.CUBE) continue;
      if (isOpenCell(w.getBlock(x, y, z)) && isOpenCell(w.getBlock(x, y + 1, z))) return y;
    }
    return -1;
  }

  /** Un monstre de ce type peut-il apparaître, pieds en (x + 0.5, y, z + 0.5) ? */
  private canSpawnMonster(game: GameApi, kind: MobKind, x: number, y: number, z: number): boolean {
    const w = game.world;
    // lumière valide seulement une fois le chunk maillé
    const chunk = w.chunkAt(x, z);
    if (!chunk || !chunk.meshed) return false;
    if (y < 1 || y + 2 >= CHUNK_HEIGHT) return false;
    const below = w.getBlock(x, y - 1, z);
    if (BLOCK_OPAQUE[below] !== 1 || BLOCK_SHAPE[below] !== SHAPE.CUBE) return false;
    if (!isOpenCell(w.getBlock(x, y, z)) || !isOpenCell(w.getBlock(x, y + 1, z))) return false;
    if (w.getLight(x, y, z) > MAX_LIGHT) return false;

    const p = game.player;
    const dx = x + 0.5 - p.x;
    const dy = y - p.y;
    const dz = z + 0.5 - p.z;
    if (dx * dx + dy * dy + dz * dz < MIN_DISTANCE * MIN_DISTANCE) return false;

    const m = getMobModel(kind);
    const hw = m.width / 2;
    const x0 = x + 0.5 - hw;
    const z0 = z + 0.5 - hw;
    const x1 = x + 0.5 + hw;
    const z1 = z + 0.5 + hw;
    // une créature large déborde sur les colonnes voisines : elles doivent être chargées et sans fluide
    for (let bz = Math.floor(z0); bz <= Math.floor(z1); bz++) {
      for (let bx = Math.floor(x0); bx <= Math.floor(x1); bx++) {
        if (!w.isLoaded(bx, bz)) return false;
        if (isFluidId(w.getBlock(bx, y, bz)) || isFluidId(w.getBlock(bx, y + 1, bz))) return false;
      }
    }
    return isBoxFree(w, x0, y, z0, x1, y + m.height, z1);
  }
}
