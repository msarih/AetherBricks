/**
 * Pousse des arbres à partir d'une pousse (mêmes formes que le générateur de monde).
 */
import { B } from './Ids';
import { BLOCK_REPLACEABLE, BLOCK_SOLID, FACING_DX, FACING_DZ, isLeaves, isSapling } from './Blocks';
import { CHUNK_HEIGHT } from './Constants';
import type { World } from './World';

type Rng = () => number;

function logReplaceable(id: number): boolean {
  return id === B.AIR || isLeaves(id) || id === B.VINE || isSapling(id) || (BLOCK_REPLACEABLE[id] === 1 && BLOCK_SOLID[id] === 0 && id !== B.WATER && id !== B.LAVA);
}

function log(w: World, x: number, y: number, z: number, id: number): void {
  if (logReplaceable(w.getBlock(x, y, z))) w.setBlock(x, y, z, id, 0, false);
}

function leaf(w: World, x: number, y: number, z: number, id: number): void {
  if (w.getBlock(x, y, z) === B.AIR) w.setBlock(x, y, z, id, 0, false);
}

/** La colonne du tronc est-elle libre sur `height` blocs (plus un de marge) ? */
function trunkFree(w: World, x: number, y: number, z: number, height: number): boolean {
  if (y + height + 2 >= CHUNK_HEIGHT) return false;
  for (let i = 1; i <= height; i++) {
    if (!logReplaceable(w.getBlock(x, y + i, z))) return false;
  }
  return true;
}

function roundTree(w: World, x: number, y0: number, z: number, rng: Rng, logId: number, leafId: number, hMin: number, hVar: number, vines: boolean): boolean {
  const H = hMin + Math.floor(rng() * hVar);
  if (!trunkFree(w, x, y0, z, H)) return false;
  for (let yy = H - 3; yy <= H; yy++) {
    const r = yy >= H - 1 ? 1 : 2;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (yy === H || rng() < 0.5)) continue;
        leaf(w, x + dx, y0 + yy, z + dz, leafId);
      }
    }
  }
  for (let i = 0; i < H; i++) log(w, x, y0 + i, z, logId);
  if (vines) {
    for (let i = 1; i < H - 1; i++) {
      for (let f = 0; f < 4; f++) {
        if (rng() >= 0.14) continue;
        // la liane se pose à l'opposé de la direction vers laquelle elle s'accroche
        const vx = x - FACING_DX[f];
        const vz = z - FACING_DZ[f];
        if (w.getBlock(vx, y0 + i, vz) === B.AIR) w.setBlock(vx, y0 + i, vz, B.VINE, 1 << f, false);
      }
    }
  }
  return true;
}

function spruce(w: World, x: number, y0: number, z: number, rng: Rng): boolean {
  const H = 6 + Math.floor(rng() * 4);
  const bare = 1 + Math.floor(rng() * 2);
  if (!trunkFree(w, x, y0, z, H)) return false;
  for (let yy = H; yy >= bare; yy--) {
    const i = H - yy;
    const r = i === 0 ? 0 : Math.min(3, 1 + ((i - 1) % 2) + (i > 4 ? 1 : 0));
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r >= 2 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
        leaf(w, x + dx, y0 + yy, z + dz, B.SPRUCE_LEAVES);
      }
    }
  }
  for (let i = 0; i < H; i++) log(w, x, y0 + i, z, B.SPRUCE_LOG);
  return true;
}

function acacia(w: World, x: number, y0: number, z: number, rng: Rng): boolean {
  const H = 5 + Math.floor(rng() * 3);
  if (!trunkFree(w, x, y0, z, H)) return false;
  const dir = Math.floor(rng() * 4);
  const leanAt = H - 3 - Math.floor(rng() * 2);
  let off = 0;
  let tx = x;
  let tz = z;
  for (let i = 0; i < H; i++) {
    if (i >= leanAt && off < 2) off++;
    tx = x + FACING_DX[dir] * off;
    tz = z + FACING_DZ[dir] * off;
    log(w, tx, y0 + i, tz, B.ACACIA_LOG);
  }
  const ty = y0 + H - 1;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      leaf(w, tx + dx, ty, tz + dz, B.ACACIA_LEAVES);
    }
  }
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx !== 0 && dz !== 0) continue;
      leaf(w, tx + dx, ty + 1, tz + dz, B.ACACIA_LEAVES);
    }
  }
  return true;
}

function largeOak(w: World, x: number, y0: number, z: number, rng: Rng): boolean {
  const H = 7 + Math.floor(rng() * 4);
  if (!trunkFree(w, x, y0, z, H + 2)) return false;
  const cy = y0 + H - 1;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const d = (dx * dx + dz * dz) / 10.6 + (dy * dy) / 5.6;
        if (d > 1 || (d > 0.78 && rng() < 0.35)) continue;
        leaf(w, x + dx, cy + dy, z + dz, B.OAK_LEAVES);
      }
    }
  }
  for (let i = 0; i < H; i++) log(w, x, y0 + i, z, B.OAK_LOG);
  return true;
}

/**
 * Fait pousser l'arbre de la pousse située en (x, y, z).
 * Retourne false (et laisse la pousse) si la place manque.
 */
export function growTree(w: World, x: number, y: number, z: number, saplingId: number, rng: Rng): boolean {
  if (!w.isAreaLoaded(x, z, 4)) return false;
  let ok: boolean;
  switch (saplingId) {
    case B.BIRCH_SAPLING:
      ok = roundTree(w, x, y, z, rng, B.BIRCH_LOG, B.BIRCH_LEAVES, 5, 3, false);
      break;
    case B.SPRUCE_SAPLING:
      ok = spruce(w, x, y, z, rng);
      break;
    case B.JUNGLE_SAPLING:
      ok = roundTree(w, x, y, z, rng, B.JUNGLE_LOG, B.JUNGLE_LEAVES, 6, 5, true);
      break;
    case B.ACACIA_SAPLING:
      ok = acacia(w, x, y, z, rng);
      break;
    default:
      ok = rng() < 0.1 ? largeOak(w, x, y, z, rng) : roundTree(w, x, y, z, rng, B.OAK_LOG, B.OAK_LEAVES, 4, 3, false);
  }
  if (ok) w.host.effect('grow', x, y, z);
  return ok;
}
