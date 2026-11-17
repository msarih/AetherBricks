/**
 * Générateurs de monstres (Minecraft 1.12, « MobSpawnerBaseLogic ») : la cage des donjons.
 *
 * Tant qu'un joueur est à moins de 16 blocs, le générateur fait apparaître jusqu'à
 * 4 créatures toutes les 10 à 40 secondes, dans un rayon de 4 blocs, sans jamais dépasser
 * 6 créatures de son espèce autour de lui. Les monstres n'apparaissent que dans le noir
 * (lumière ≤ 7) : éclairer la salle suffit à l'éteindre, comme dans Minecraft.
 */
import { BLOCK_SHAPE, BLOCK_SOLID, SHAPE } from '../world/Blocks';
import { CHUNK_HEIGHT } from '../world/Constants';
import { B } from '../world/Ids';
import type { BlockEntity } from '../world/World';
import type { GameApi } from './Entity';
import { getMobModel, type MobKind } from './MobModels';
import { HOSTILE_KINDS, PASSIVE_KINDS, createMob } from './Mobs';
import { isBoxFree } from './Physics';

export const SPAWNER_PLAYER_RANGE = 16;
export const SPAWNER_COUNT = 4;
export const SPAWNER_RANGE = 4;
export const SPAWNER_MAX_NEARBY = 6;
export const SPAWNER_MIN_DELAY = 200;
export const SPAWNER_MAX_DELAY = 800;
const MAX_LIGHT = 7;

interface SpawnerState extends BlockEntity {
  mob?: unknown;
  delay?: unknown;
}

function spawnerKind(s: SpawnerState): MobKind | null {
  const k = s.mob as MobKind;
  return typeof k === 'string' && (HOSTILE_KINDS.includes(k) || PASSIVE_KINDS.includes(k)) ? k : null;
}

function open(id: number): boolean {
  return BLOCK_SOLID[id] !== 1 && BLOCK_SHAPE[id] !== SHAPE.FLUID && id !== B.FIRE;
}

/** Avance tous les générateurs de monstres chargés. */
export function tickSpawners(game: GameApi): void {
  const w = game.world;
  if (w.blockEntities.size === 0) return;
  const p = game.player;
  const rng = game.rng;
  for (const be of w.blockEntities.values()) {
    if (be.type !== 'spawner') continue;
    const s = be as SpawnerState;
    const dx = be.x + 0.5 - p.x;
    const dy = be.y + 0.5 - p.y;
    const dz = be.z + 0.5 - p.z;
    if (dx * dx + dy * dy + dz * dz > SPAWNER_PLAYER_RANGE * SPAWNER_PLAYER_RANGE) continue;
    if (w.getBlock(be.x, be.y, be.z) !== B.SPAWNER) continue;
    const kind = spawnerKind(s);
    if (!kind) continue;

    // la cage crépite tant qu'elle est active
    if (rng() < 0.3) {
      game.particles('flame', be.x + rng(), be.y + rng(), be.z + rng(), 1, 0);
      game.particles('smoke', be.x + rng(), be.y + rng(), be.z + rng(), 1, 0);
    }

    let delay = typeof s.delay === 'number' && Number.isFinite(s.delay) ? s.delay : 20;
    if (delay > 0) {
      s.delay = delay - 1;
      continue;
    }
    const hostile = HOSTILE_KINDS.includes(kind);
    if (hostile && game.difficulty <= 0) continue;

    // pas plus de 6 créatures de l'espèce autour de la cage
    let nearby = 0;
    for (const e of game.entitiesInBox(
      be.x - SPAWNER_RANGE, be.y - SPAWNER_RANGE, be.z - SPAWNER_RANGE,
      be.x + 1 + SPAWNER_RANGE, be.y + 1 + SPAWNER_RANGE, be.z + 1 + SPAWNER_RANGE,
    )) {
      if (e.kind === 'mob' && !e.dead && e.mobKind === kind) nearby++;
    }
    delay = SPAWNER_MIN_DELAY + Math.floor(rng() * (SPAWNER_MAX_DELAY - SPAWNER_MIN_DELAY));
    if (nearby >= SPAWNER_MAX_NEARBY) {
      s.delay = delay;
      continue;
    }

    const model = getMobModel(kind);
    const hw = model.width / 2;
    let spawned = 0;
    for (let i = 0; i < SPAWNER_COUNT && nearby + spawned < SPAWNER_MAX_NEARBY; i++) {
      const x = be.x + 0.5 + (rng() - rng()) * SPAWNER_RANGE;
      const y = be.y + Math.floor(rng() * 3) - 1;
      const z = be.z + 0.5 + (rng() - rng()) * SPAWNER_RANGE;
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      if (y < 1 || y + 2 >= CHUNK_HEIGHT || !w.isLoaded(bx, bz)) continue;
      if (!w.isSolid(bx, y - 1, bz) || !open(w.getBlock(bx, y, bz))) continue;
      if (hostile && w.getLight(bx, y, bz) > MAX_LIGHT) continue;
      if (!isBoxFree(w, x - hw, y, z - hw, x + hw, y + model.height, z + hw)) continue;
      const mob = createMob(kind, rng);
      if (!mob) break;
      mob.setPosition(x, y, z);
      mob.setRotation(rng() * Math.PI * 2);
      game.spawn(mob);
      game.particles('flame', x, y + model.height / 2, z, 8, 0.4);
      game.particles('smoke', x, y + model.height / 2, z, 8, 0.4);
      spawned++;
    }
    // rien n'a pu apparaître (salle éclairée, pas de place) : nouvel essai dans une seconde
    s.delay = spawned > 0 ? delay : 20;
  }
}
