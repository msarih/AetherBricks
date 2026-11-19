/**
 * Explosions (TNT, creepers), sur le modèle de Minecraft :
 *  1. des rayons partent du centre vers la surface d'un cube 16³ et perdent leur force dans les blocs traversés ;
 *  2. les entités proches sont blessées et repoussées selon leur distance et leur exposition ;
 *  3. les blocs touchés sont détruits (butin avec une probabilité 1 / puissance, TNT amorcée en chaîne).
 */
import { Living, type Entity, type GameApi } from '../entity/Entity';
import { BLOCKS, BLOCK_OPAQUE } from '../world/Blocks';
import { CHUNK_HEIGHT } from '../world/Constants';
import { blockDrops } from '../world/Drops';
import { B, I } from '../world/Ids';
import { newRayHit, raycast } from '../world/Raycast';
import { posKey, posKeyX, posKeyY, posKeyZ, type World } from '../world/World';

const RAYS = 16;
const STEP = 0.3;
const hit = newRayHit();

/** Part de l'entité visible depuis le centre de l'explosion (0 = abritée, 1 = à découvert). */
function exposure(w: World, x: number, y: number, z: number, e: Entity): number {
  const hw = e.width / 2;
  let seen = 0;
  let total = 0;
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 2; j++) {
      for (let k = 0; k <= 1; k++) {
        const tx = e.x - hw + i * e.width;
        const ty = e.y + (j / 2) * e.height;
        const tz = e.z - hw + k * e.width;
        const dx = tx - x;
        const dy = ty - y;
        const dz = tz - z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        total++;
        if (d < 0.01 || !raycast(w, x, y, z, dx / d, dy / d, dz / d, d, hit, true) || hit.dist >= d - 0.05) seen++;
      }
    }
  }
  return seen / total;
}

export function explode(game: GameApi, x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null, griefing = true): void {
  const w = game.world;
  const rng = game.rng;

  // --- 1. blocs atteints ---
  const affected = new Set<number>();
  for (let i = 0; i < RAYS; i++) {
    for (let j = 0; j < RAYS; j++) {
      for (let k = 0; k < RAYS; k++) {
        if (i !== 0 && i !== RAYS - 1 && j !== 0 && j !== RAYS - 1 && k !== 0 && k !== RAYS - 1) continue;
        let dx = (i / (RAYS - 1)) * 2 - 1;
        let dy = (j / (RAYS - 1)) * 2 - 1;
        let dz = (k / (RAYS - 1)) * 2 - 1;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx /= len;
        dy /= len;
        dz /= len;
        let strength = power * (0.7 + rng() * 0.6);
        let px = x;
        let py = y;
        let pz = z;
        while (strength > 0) {
          const bx = Math.floor(px);
          const by = Math.floor(py);
          const bz = Math.floor(pz);
          if (by < 0 || by >= CHUNK_HEIGHT) break;
          const id = w.getBlock(bx, by, bz);
          if (id !== B.AIR) strength -= (BLOCKS[id].blastResistance / 5 + 0.3) * STEP;
          if (strength > 0 && id !== B.AIR) affected.add(posKey(bx, by, bz));
          px += dx * STEP;
          py += dy * STEP;
          pz += dz * STEP;
          strength -= STEP * 0.75;
        }
      }
    }
  }

  // --- 2. entités (avant la destruction des blocs : les murs protègent) ---
  const radius = power * 2;
  const victims = game.entitiesInBox(x - radius - 1, y - radius - 1, z - radius - 1, x + radius + 1, y + radius + 1, z + radius + 1, null);
  for (const e of victims) {
    if (e.dead) continue;
    let dx = e.x - x;
    let dy = e.y + e.height * 0.5 - y;
    let dz = e.z - z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist / radius > 1) continue;
    if (dist > 0.001) {
      dx /= dist;
      dy /= dist;
      dz /= dist;
    } else {
      dx = 0;
      dy = 1;
      dz = 0;
    }
    const impact = (1 - dist / radius) * exposure(w, x, y, z, e);
    if (impact <= 0) continue;
    if (e instanceof Living) {
      if (e !== source) e.hurt(game, Math.floor(((impact * impact + impact) / 2) * 7 * radius + 1), 'explosion', source);
    } else if (e.kind === 'item') {
      e.dead = true;
      continue;
    }
    e.vx += dx * impact;
    e.vy += dy * impact;
    e.vz += dz * impact;
  }

  // --- 3. effets ---
  game.sound('explode', x, y, z, 4, 0.7 + rng() * 0.3);
  game.particles('explosion', x, y, z, power >= 2 ? 6 : 2, power * 0.6);
  game.particles('large_smoke', x, y, z, 12, power * 0.8);

  // --- 4. destruction ---
  if (griefing) {
    let smoke = 0;
    for (const key of affected) {
      const bx = posKeyX(key);
      const by = posKeyY(key);
      const bz = posKeyZ(key);
      const v = w.getBlockAndMeta(bx, by, bz);
      const id = v & 255;
      if (id === B.AIR) continue;
      if (id === B.TNT) {
        w.setBlock(bx, by, bz, B.AIR, 0);
        w.host.primeTnt(bx, by, bz, 10 + Math.floor(rng() * 20));
        continue;
      }
      if (BLOCKS[id].hasItem || BLOCKS[id].hardness >= 0) {
        if (rng() < 1 / power) {
          for (const d of blockDrops(id, v >> 8, I.DIAMOND_PICKAXE, rng)) game.dropItem(bx + 0.5, by + 0.5, bz + 0.5, d.id, d.count);
        }
      }
      w.setBlock(bx, by, bz, B.AIR, 0);
      if (smoke++ % 6 === 0) game.particles('smoke', bx + 0.5, by + 0.5, bz + 0.5, 2, 0.4);
    }

    if (fire) {
      for (const key of affected) {
        const bx = posKeyX(key);
        const by = posKeyY(key);
        const bz = posKeyZ(key);
        if (w.getBlock(bx, by, bz) === B.AIR && BLOCK_OPAQUE[w.getBlock(bx, by - 1, bz)] === 1 && rng() < 1 / 3) {
          w.setBlock(bx, by, bz, B.FIRE, 0);
        }
      }
    }
  }
}
