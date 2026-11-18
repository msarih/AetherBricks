/**
 * Comportement des blocs : réaction au changement d'un voisin, ticks planifiés
 * (fluides, sable, feu, feuilles) et ticks aléatoires (pousse, propagation, fonte).
 */
import { B } from './Ids';
import {
  BLOCKS,
  BLOCK_LIGHT_OPACITY,
  BLOCK_OPAQUE,
  BLOCK_REPLACEABLE,
  BLOCK_SHAPE,
  BLOCK_SOLID,
  FACING_DX,
  FACING_DZ,
  SHAPE,
  isCrop,
  isDoor,
  isFlower,
  isLeaves,
  isLog,
  isSapling,
  isSlab,
  isStairs,
  PISTON_DX,
  PISTON_DY,
  PISTON_DZ,
  isTerracotta,
} from './Blocks';
import { fluidTick, fluidTickDelay, lavaMix } from './Fluids';
import { portalCanStay } from './Portal';
import { setDetectorRailActive, updatePoweredRail } from './Rails';
import {
  computeComparatorOutput,
  isRepeaterBackPowered,
  isRepeaterLocked,
  isTorchSupportPowered,
  updateRedstoneAround,
} from './Redstone';
import { growTree } from './Trees';
import type { World } from './World';

/** Feuilles posées par le joueur : ne se décomposent jamais. */
export const META_LEAVES_PERSISTENT = 1;
/** Distance maximale (en blocs de feuilles) entre une feuille et un tronc. */
const LEAF_DECAY_DISTANCE = 6;

// ---------------------------------------------------------------------------
// Supports
// ---------------------------------------------------------------------------

/** Le bloc offre-t-il une face supérieure pleine (pour poser une torche, une porte…) ? */
export function topSolid(w: World, x: number, y: number, z: number): boolean {
  const v = w.getBlockAndMeta(x, y, z);
  const id = v & 255;
  if (id === B.AIR) return false;
  const shape = BLOCK_SHAPE[id];
  if (shape === SHAPE.CUBE) return BLOCK_SOLID[id] === 1 && !isLeaves(id);
  const meta = v >> 8;
  if (isSlab(id)) return meta >= 1;
  if (isStairs(id)) return (meta & 4) !== 0;
  return shape === SHAPE.FENCE || id === B.FARMLAND || id === B.GRASS_PATH;
}

/** Le bloc offre-t-il des faces latérales pleines (torche murale, échelle) ? */
export function sideSolid(w: World, x: number, y: number, z: number): boolean {
  const id = w.getBlock(x, y, z);
  return BLOCK_SHAPE[id] === SHAPE.CUBE && BLOCK_SOLID[id] === 1 && !isLeaves(id) && id !== B.CACTUS;
}

function isSoil(id: number): boolean {
  return id === B.GRASS || id === B.DIRT || id === B.FARMLAND;
}

function waterBeside(w: World, x: number, y: number, z: number): boolean {
  return (
    w.getBlock(x - 1, y, z) === B.WATER ||
    w.getBlock(x + 1, y, z) === B.WATER ||
    w.getBlock(x, y, z - 1) === B.WATER ||
    w.getBlock(x, y, z + 1) === B.WATER
  );
}

function flammability(w: World, x: number, y: number, z: number): number {
  return BLOCKS[w.getBlock(x, y, z)]?.flammable ?? 0;
}

function hasFlammableNeighbor(w: World, x: number, y: number, z: number): boolean {
  return (
    flammability(w, x + 1, y, z) > 0 ||
    flammability(w, x - 1, y, z) > 0 ||
    flammability(w, x, y - 1, z) > 0 ||
    flammability(w, x, y + 1, z) > 0 ||
    flammability(w, x, y, z - 1) > 0 ||
    flammability(w, x, y, z + 1) > 0
  );
}

/** Un feu peut-il exister ici ? */
export function fireCanStay(w: World, x: number, y: number, z: number): boolean {
  return topSolid(w, x, y - 1, z) || hasFlammableNeighbor(w, x, y, z);
}

/**
 * Le bloc (id, méta) peut-il rester (ou être posé) en (x, y, z) compte tenu de son support ?
 * Ne traite pas les blocs en deux parties (portes, lits).
 */
export function canStay(w: World, x: number, y: number, z: number, id: number, meta: number): boolean {
  const below = w.getBlock(x, y - 1, z);
  switch (id) {
    case B.TALL_GRASS:
    case B.FERN:
      return isSoil(below);
    case B.DEAD_BUSH:
      return below === B.SAND || below === B.RED_SAND || isTerracotta(below) || isSoil(below) || below === B.CLAY || below === B.GRAVEL;
    case B.BROWN_MUSHROOM:
    case B.RED_MUSHROOM:
      return BLOCK_OPAQUE[below] === 1;
    case B.SUGAR_CANE:
      if (below === B.SUGAR_CANE) return true;
      return (below === B.GRASS || below === B.DIRT || below === B.SAND || below === B.RED_SAND) && waterBeside(w, x, y - 1, z);
    case B.CACTUS:
      if (below !== B.CACTUS && below !== B.SAND && below !== B.RED_SAND) return false;
      return !w.isSolid(x - 1, y, z) && !w.isSolid(x + 1, y, z) && !w.isSolid(x, y, z - 1) && !w.isSolid(x, y, z + 1);
    case B.WHEAT:
    case B.CARROTS:
    case B.POTATOES:
      return below === B.FARMLAND;
    case B.NETHER_WART:
      return below === B.SOUL_SAND;
    case B.TORCH:
    case B.REDSTONE_TORCH:
    case B.REDSTONE_TORCH_OFF: {
      const side = meta & 7;
      if (side === 0) return topSolid(w, x, y - 1, z);
      const f = (side - 1) & 3;
      return sideSolid(w, x - FACING_DX[f], y, z - FACING_DZ[f]);
    }
    case B.REDSTONE_WIRE:
    case B.STONE_PRESSURE_PLATE:
    case B.RAIL:
    case B.POWERED_RAIL:
    case B.DETECTOR_RAIL:
    case B.SIGN:
    case B.CAKE:
    case B.REPEATER:
    case B.COMPARATOR:
      return topSolid(w, x, y - 1, z);
    case B.WALL_SIGN: {
      // méta = direction vers laquelle le panneau est tourné ; il tient au bloc derrière lui
      const f = meta & 3;
      return sideSolid(w, x - FACING_DX[f], y, z - FACING_DZ[f]);
    }
    case B.LEVER:
    case B.STONE_BUTTON: {
      const side = meta & 7;
      if (side === 0) return topSolid(w, x, y - 1, z);
      const f = (side - 1) & 3;
      return sideSolid(w, x - FACING_DX[f], y, z - FACING_DZ[f]);
    }
    case B.LADDER: {
      const f = meta & 3;
      return sideSolid(w, x - FACING_DX[f], y, z - FACING_DZ[f]);
    }
    case B.LILY_PAD:
      return below === B.WATER || below === B.ICE;
    case B.SNOW_LAYER:
      return BLOCK_OPAQUE[below] === 1 || isLeaves(below);
    case B.FIRE:
      return fireCanStay(w, x, y, z);
    case B.CARPET:
      return below !== B.AIR;
    default:
      if (isSapling(id) || isFlower(id)) return isSoil(below);
      return true;
  }
}

// ---------------------------------------------------------------------------
// Changement d'un voisin
// ---------------------------------------------------------------------------

function vineSupported(w: World, x: number, y: number, z: number, f: number): boolean {
  const id = w.getBlock(x + FACING_DX[f], y, z + FACING_DZ[f]);
  if (BLOCK_SHAPE[id] === SHAPE.CUBE && BLOCK_SOLID[id] === 1) return true;
  const above = w.getBlockAndMeta(x, y + 1, z);
  return (above & 255) === B.VINE && ((above >> 8) & (1 << f)) !== 0;
}

/**
 * Le bloc en (x, y, z) vient d'être posé ou l'un de ses voisins a changé :
 * il vérifie son support et planifie ses réactions.
 */
export function neighborChanged(w: World, x: number, y: number, z: number): void {
  const v = w.getBlockAndMeta(x, y, z);
  const id = v & 255;
  if (id === B.AIR) return;
  const meta = v >> 8;
  const shape = BLOCK_SHAPE[id];

  if (shape === SHAPE.FLUID) {
    if (id === B.LAVA && lavaMix(w, x, y, z, meta)) return;
    w.scheduleTick(x, y, z, fluidTickDelay(id));
    return;
  }
  if (shape === SHAPE.CUBE) {
    if (BLOCKS[id].gravity) w.scheduleTick(x, y, z, 2);
    else if (isLeaves(id)) {
      if (!(meta & META_LEAVES_PERSISTENT)) w.scheduleTick(x, y, z, 8 + Math.floor(w.rng() * 50));
    }
    return;
  }

  if (isDoor(id)) {
    if (meta & 8) {
      const lower = w.getBlockAndMeta(x, y - 1, z);
      if ((lower & 255) !== id || (lower >> 8) & 8) w.setBlock(x, y, z, B.AIR, 0);
    } else {
      const upper = w.getBlockAndMeta(x, y + 1, z);
      if ((upper & 255) !== id || !((upper >> 8) & 8)) w.breakBlock(x, y, z, true);
      else if (!topSolid(w, x, y - 1, z)) w.breakBlock(x, y, z, true);
    }
    return;
  }

  switch (id) {
    case B.BED: {
      const d = meta & 3;
      if (meta & 4) {
        const foot = w.getBlockAndMeta(x - FACING_DX[d], y, z - FACING_DZ[d]);
        if ((foot & 255) !== B.BED || (foot >> 8) & 4) w.breakBlock(x, y, z, true);
      } else {
        const head = w.getBlockAndMeta(x + FACING_DX[d], y, z + FACING_DZ[d]);
        if ((head & 255) !== B.BED || !((head >> 8) & 4)) w.setBlock(x, y, z, B.AIR, 0);
      }
      return;
    }
    case B.FARMLAND: {
      const above = w.getBlock(x, y + 1, z);
      if (BLOCK_SOLID[above] === 1 && BLOCK_SHAPE[above] === SHAPE.CUBE) w.setBlock(x, y, z, B.DIRT, 0);
      return;
    }
    case B.VINE: {
      let m = meta & 15;
      for (let f = 0; f < 4; f++) {
        if (m & (1 << f) && !vineSupported(w, x, y, z, f)) m &= ~(1 << f);
      }
      if (m === 0) w.setBlock(x, y, z, B.AIR, 0);
      else if (m !== meta) w.setBlock(x, y, z, B.VINE, m);
      return;
    }
    case B.FIRE:
      if (!fireCanStay(w, x, y, z)) w.setBlock(x, y, z, B.AIR, 0);
      else w.scheduleTick(x, y, z, 30 + Math.floor(w.rng() * 10));
      return;
    case B.SNOW_LAYER:
      if (!canStay(w, x, y, z, id, meta)) w.setBlock(x, y, z, B.AIR, 0);
      return;
    case B.NETHER_PORTAL:
      if (!portalCanStay(w, x, y, z, meta)) w.setBlock(x, y, z, B.AIR, 0);
      return;
    case B.PISTON_HEAD: {
      const f = Math.min(5, meta & 7);
      const bx = x - PISTON_DX[f];
      const by = y - PISTON_DY[f];
      const bz = z - PISTON_DZ[f];
      const bv = w.getBlockAndMeta(bx, by, bz);
      const bid = bv & 255;
      if ((bid !== B.PISTON && bid !== B.STICKY_PISTON) || ((bv >> 8) & 8) === 0 || ((bv >> 8) & 7) !== f) {
        w.setBlock(x, y, z, B.AIR, 0);
      }
      return;
    }
    case B.PISTON:
    case B.STICKY_PISTON: {
      if (meta & 8) {
        const f = Math.min(5, meta & 7);
        if (w.getBlock(x + PISTON_DX[f], y + PISTON_DY[f], z + PISTON_DZ[f]) !== B.PISTON_HEAD) {
          w.setMeta(x, y, z, f, false);
        }
      }
      return;
    }
    case B.POWERED_RAIL:
      if (!canStay(w, x, y, z, id, meta)) w.breakBlock(x, y, z, true);
      else updatePoweredRail(w, x, y, z);
      return;
    default:
      if (!canStay(w, x, y, z, id, meta)) w.breakBlock(x, y, z, true);
  }
}

// ---------------------------------------------------------------------------
// Ticks planifiés
// ---------------------------------------------------------------------------

function canFallThrough(id: number): boolean {
  if (id === B.AIR || id === B.FIRE) return true;
  if (BLOCK_SHAPE[id] === SHAPE.FLUID) return true;
  return BLOCK_REPLACEABLE[id] === 1 && BLOCK_SOLID[id] === 0;
}

function gravityTick(w: World, x: number, y: number, z: number, id: number, meta: number): void {
  if (y <= 0 || !canFallThrough(w.getBlock(x, y - 1, z))) return;
  if (w.host.spawnFallingBlock(x, y, z, id, meta)) {
    w.setBlock(x, y, z, B.AIR, 0);
    return;
  }
  // chute instantanée
  let ny = y - 1;
  while (ny > 0 && canFallThrough(w.getBlock(x, ny - 1, z))) ny--;
  w.setBlock(x, y, z, B.AIR, 0);
  w.setBlock(x, ny, z, id, meta);
}

const leafQueue: number[] = [];
const leafSeen = new Set<number>();

/** Cherche un tronc relié par des feuilles à moins de LEAF_DECAY_DISTANCE blocs. */
function leafConnected(w: World, x: number, y: number, z: number): boolean {
  leafQueue.length = 0;
  leafSeen.clear();
  leafQueue.push(x, y, z, 0);
  leafSeen.add((x & 31) | ((y & 255) << 5) | ((z & 31) << 13));
  for (let i = 0; i < leafQueue.length; i += 4) {
    const cx = leafQueue[i];
    const cy = leafQueue[i + 1];
    const cz = leafQueue[i + 2];
    const d = leafQueue[i + 3];
    for (let f = 0; f < 6; f++) {
      const nx = cx + (f === 0 ? 1 : f === 1 ? -1 : 0);
      const ny = cy + (f === 2 ? 1 : f === 3 ? -1 : 0);
      const nz = cz + (f === 4 ? 1 : f === 5 ? -1 : 0);
      const id = w.getBlock(nx, ny, nz);
      if (isLog(id)) return true;
      if (d + 1 >= LEAF_DECAY_DISTANCE || !isLeaves(id)) continue;
      const k = (nx & 31) | ((ny & 255) << 5) | ((nz & 31) << 13);
      if (leafSeen.has(k)) continue;
      leafSeen.add(k);
      leafQueue.push(nx, ny, nz, d + 1);
    }
  }
  return false;
}

function rainedOn(w: World, x: number, y: number, z: number): boolean {
  return w.raining && w.canSeeSky(x, y, z);
}

function tryBurn(w: World, x: number, y: number, z: number, chance: number, age: number): void {
  const id = w.getBlock(x, y, z);
  const f = BLOCKS[id]?.flammable ?? 0;
  if (f === 0 || w.rng() * chance >= f) return;
  if (id === B.TNT) {
    w.setBlock(x, y, z, B.AIR, 0);
    w.host.primeTnt(x, y, z, 80);
    return;
  }
  if (w.rng() * (age + 10) < 5 && !rainedOn(w, x, y, z)) {
    w.setBlock(x, y, z, B.FIRE, Math.min(15, age + Math.floor(w.rng() * 5) / 4) | 0);
  } else {
    w.setBlock(x, y, z, B.AIR, 0);
  }
}

/** Attrait du feu pour une cellule vide : le plus inflammable de ses voisins. */
function fireEncouragement(w: World, x: number, y: number, z: number): number {
  if (w.getBlock(x, y, z) !== B.AIR) return 0;
  let best = 0;
  for (let f = 0; f < 6; f++) {
    const fl = flammability(w, x + (f === 0 ? 1 : f === 1 ? -1 : 0), y + (f === 2 ? 1 : f === 3 ? -1 : 0), z + (f === 4 ? 1 : f === 5 ? -1 : 0));
    if (fl === 0) continue;
    const enc = fl >= 100 ? 60 : fl >= 30 ? 30 : 5;
    if (enc > best) best = enc;
  }
  return best;
}

function fireTick(w: World, x: number, y: number, z: number, meta: number): void {
  if (!fireCanStay(w, x, y, z)) {
    w.setBlock(x, y, z, B.AIR, 0);
    return;
  }
  const below = w.getBlock(x, y - 1, z);
  // feu éternel : sur la netherrack, et sur le bedrock des piliers de l'End
  const eternal = below === B.NETHERRACK || below === B.BEDROCK;
  if (!eternal && rainedOn(w, x, y, z)) {
    w.setBlock(x, y, z, B.AIR, 0);
    w.host.effect('fizz', x, y, z);
    return;
  }
  let age = meta & 15;
  if (age < 15) {
    age = Math.min(15, age + (w.rng() < 0.34 ? 1 : 0));
    w.setMetaSilent(x, y, z, age);
  }
  w.scheduleTick(x, y, z, 30 + Math.floor(w.rng() * 10));

  if (!eternal) {
    if (!hasFlammableNeighbor(w, x, y, z)) {
      if (!topSolid(w, x, y - 1, z) || age > 3) {
        w.setBlock(x, y, z, B.AIR, 0);
        return;
      }
    } else if (flammability(w, x, y - 1, z) === 0 && age === 15 && w.rng() < 0.25) {
      w.setBlock(x, y, z, B.AIR, 0);
      return;
    }
  }

  tryBurn(w, x + 1, y, z, 300, age);
  tryBurn(w, x - 1, y, z, 300, age);
  tryBurn(w, x, y - 1, z, 250, age);
  tryBurn(w, x, y + 1, z, 250, age);
  tryBurn(w, x, y, z - 1, 300, age);
  tryBurn(w, x, y, z + 1, 300, age);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 4; dy++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const enc = fireEncouragement(w, x + dx, y + dy, z + dz);
        if (enc === 0) continue;
        const base = dy > 1 ? 100 + (dy - 1) * 100 : 100;
        const odds = (enc + 40) / (age + 30);
        if (w.rng() * base > odds || rainedOn(w, x + dx, y + dy, z + dz)) continue;
        w.setBlock(x + dx, y + dy, z + dz, B.FIRE, Math.min(15, age + Math.floor(w.rng() * 5) / 4) | 0);
      }
    }
  }
}

export function scheduledTick(w: World, x: number, y: number, z: number, id: number, meta: number): void {
  if (id === B.AIR) return;
  if (id === B.DETECTOR_RAIL && (meta & 8)) {
    if (w.host.hasEntityInBox?.(x + 0.125, y, z + 0.125, x + 0.875, y + 1.0, z + 0.875, 'minecart')) {
      w.scheduleTick(x, y, z, 20);
    } else {
      setDetectorRailActive(w, x, y, z, false);
    }
    return;
  }
  if (id === B.POWERED_RAIL) {
    updatePoweredRail(w, x, y, z);
    return;
  }
  if (id === B.REPEATER) {
    const facing = meta & 3;
    const locked = isRepeaterLocked(w, x, y, z, facing);
    const delay = ((meta >> 2) & 3) + 1;
    if (locked) {
      if (!(meta & 32)) w.setMeta(x, y, z, meta | 32, false);
      return;
    }
    const base = meta & ~32;
    const isOn = (base & 16) !== 0;
    const backOn = isRepeaterBackPowered(w, x, y, z, facing);
    if (!isOn) {
      w.setMeta(x, y, z, base | 16, false);
      w.notifyNeighbors(x, y, z);
      updateRedstoneAround(w, x, y, z);
      if (!backOn) w.scheduleTick(x, y, z, delay);
    } else if (!backOn) {
      w.setMeta(x, y, z, base & ~16, false);
      w.notifyNeighbors(x, y, z);
      updateRedstoneAround(w, x, y, z);
    } else if (base !== meta) {
      w.setMeta(x, y, z, base, false);
    }
    return;
  }
  if (id === B.COMPARATOR) {
    const next = computeComparatorOutput(w, x, y, z, meta & 3, (meta & 4) !== 0);
    if (next !== ((meta >> 4) & 15)) {
      w.setMeta(x, y, z, (meta & 15) | (next << 4), false);
      w.notifyNeighbors(x, y, z);
      updateRedstoneAround(w, x, y, z);
    }
    return;
  }
  if (id === B.DISPENSER || id === B.DROPPER) {
    w.host.dispense?.(x, y, z, id === B.DROPPER);
    return;
  }
  if (BLOCK_SHAPE[id] === SHAPE.FLUID) {
    fluidTick(w, x, y, z, id, meta);
    return;
  }
  if (id === B.FIRE) {
    fireTick(w, x, y, z, meta);
    return;
  }
  if (id === B.REDSTONE_TORCH || id === B.REDSTONE_TORCH_OFF) {
    const shouldBeOff = isTorchSupportPowered(w, x, y, z, meta);
    const isOff = id === B.REDSTONE_TORCH_OFF;
    if (shouldBeOff !== isOff) {
      w.setBlock(x, y, z, shouldBeOff ? B.REDSTONE_TORCH_OFF : B.REDSTONE_TORCH, meta & 7, false);
      updateRedstoneAround(w, x, y, z);
    }
    return;
  }
  if (id === B.STONE_BUTTON) {
    if (meta & 8) w.setMeta(x, y, z, meta & ~8, true);
    return;
  }
  if (isLeaves(id)) {
    if (!(meta & META_LEAVES_PERSISTENT) && w.isAreaLoaded(x, z, LEAF_DECAY_DISTANCE) && !leafConnected(w, x, y, z)) {
      w.breakBlock(x, y, z, true);
    }
    return;
  }
  if (BLOCKS[id].gravity) gravityTick(w, x, y, z, id, meta);
}

// ---------------------------------------------------------------------------
// Ticks aléatoires
// ---------------------------------------------------------------------------

function columnHeight(w: World, x: number, y: number, z: number, id: number): number {
  let h = 1;
  while (w.getBlock(x, y - h, z) === id) h++;
  return h;
}

function waterNearFarmland(w: World, x: number, y: number, z: number): boolean {
  for (let dy = 0; dy <= 1; dy++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (w.getBlock(x + dx, y + dy, z + dz) === B.WATER) return true;
      }
    }
  }
  return false;
}

export function randomTick(w: World, x: number, y: number, z: number, id: number, meta: number): void {
  const rng = w.rng;
  switch (id) {
    case B.CAULDRON:
      if (meta < 3 && rainedOn(w, x, y + 1, z) && rng() < 0.05) w.setMeta(x, y, z, meta + 1);
      return;
    case B.GRASS: {
      const above = w.getBlock(x, y + 1, z);
      if (BLOCK_LIGHT_OPACITY[above] > 2 && w.getLight(x, y + 1, z) < 4) {
        w.setBlock(x, y, z, B.DIRT, 0, false);
        return;
      }
      if (w.getLight(x, y + 1, z) < 9) return;
      for (let i = 0; i < 4; i++) {
        const tx = x + Math.floor(rng() * 3) - 1;
        const ty = y + Math.floor(rng() * 5) - 3;
        const tz = z + Math.floor(rng() * 3) - 1;
        if (w.getBlock(tx, ty, tz) !== B.DIRT) continue;
        if (BLOCK_LIGHT_OPACITY[w.getBlock(tx, ty + 1, tz)] > 2 || w.getLight(tx, ty + 1, tz) < 4) continue;
        w.setBlock(tx, ty, tz, B.GRASS, 0, false);
      }
      return;
    }
    case B.ICE:
      if (w.getBlockLight(x, y, z) > 11 || w.getBlockLight(x, y + 1, z) > 11) w.setBlock(x, y, z, B.WATER, 0);
      return;
    case B.SNOW_LAYER:
      if (w.getBlockLight(x, y, z) > 11) w.setBlock(x, y, z, B.AIR, 0);
      return;
    case B.LAVA: {
      // la lave met le feu aux alentours
      const n = Math.floor(rng() * 3);
      let fx = x;
      let fy = y;
      let fz = z;
      for (let i = 0; i < n; i++) {
        fx += Math.floor(rng() * 3) - 1;
        fy += 1;
        fz += Math.floor(rng() * 3) - 1;
        const at = w.getBlock(fx, fy, fz);
        if (at === B.AIR) {
          if (hasFlammableNeighbor(w, fx, fy, fz)) {
            w.setBlock(fx, fy, fz, B.FIRE, 0);
            return;
          }
        } else if (BLOCK_SOLID[at]) return;
      }
      return;
    }
    case B.BROWN_MUSHROOM:
    case B.RED_MUSHROOM: {
      if (rng() >= 0.04) return;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -4; dz <= 4; dz++) {
          for (let dx = -4; dx <= 4; dx++) {
            if (w.getBlock(x + dx, y + dy, z + dz) === id && ++count >= 5) return;
          }
        }
      }
      const tx = x + Math.floor(rng() * 3) - 1;
      const ty = y + Math.floor(rng() * 2) - Math.floor(rng() * 2);
      const tz = z + Math.floor(rng() * 3) - 1;
      if (w.getBlock(tx, ty, tz) === B.AIR && w.getLight(tx, ty, tz) < 13 && canStay(w, tx, ty, tz, id, 0)) {
        w.setBlock(tx, ty, tz, id, 0);
      }
      return;
    }
    case B.SUGAR_CANE:
    case B.CACTUS: {
      if (w.getBlock(x, y + 1, z) !== B.AIR) return;
      if (columnHeight(w, x, y, z, id) >= 3) return;
      if (meta >= 15) {
        w.setMetaSilent(x, y, z, 0);
        if (canStay(w, x, y + 1, z, id, 0)) w.setBlock(x, y + 1, z, id, 0);
      } else {
        w.setMetaSilent(x, y, z, meta + 1);
      }
      return;
    }
    case B.WHEAT:
    case B.CARROTS:
    case B.POTATOES: {
      const stage = meta & 7;
      if (stage >= 7 || w.getLight(x, y + 1, z) < 9) return;
      const wet = w.getMeta(x, y - 1, z) > 0;
      if (rng() < (wet ? 0.5 : 0.17)) w.setBlock(x, y, z, id, stage + 1, false);
      return;
    }
    case B.NETHER_WART:
      // pousse dans le noir comme en pleine lumière, sans eau : un stade sur dix ticks aléatoires
      if ((meta & 3) < 3 && rng() < 0.1) w.setBlock(x, y, z, id, (meta & 3) + 1, false);
      return;
    case B.FARMLAND: {
      if (waterNearFarmland(w, x, y, z) || rainedOn(w, x, y + 1, z)) {
        if (meta !== 7) w.setBlock(x, y, z, id, 7, false);
      } else if (meta > 0) {
        w.setBlock(x, y, z, id, meta - 1, false);
      } else if (!isCrop(w.getBlock(x, y + 1, z))) {
        w.setBlock(x, y, z, B.DIRT, 0);
      }
      return;
    }
    case B.VINE:
      if (rng() < 0.12 && y > 1 && w.getBlock(x, y - 1, z) === B.AIR) w.setBlock(x, y - 1, z, B.VINE, meta & 15);
      return;
    case B.FIRE:
      // relance un feu dont le tick planifié a été perdu (rechargement du monde)
      w.scheduleTick(x, y, z, 30);
      return;
    default:
      if (isSapling(id)) {
        if (w.getLight(x, y + 1, z) < 9 || rng() >= 1 / 7) return;
        if (!(meta & 8)) w.setMetaSilent(x, y, z, meta | 8);
        else growTree(w, x, y, z, id, rng);
      }
  }
}

// ---------------------------------------------------------------------------
// Poudre d'os
// ---------------------------------------------------------------------------

const BONEMEAL_FLOWERS = [B.DANDELION, B.POPPY];

/** Applique de la poudre d'os au bloc. Retourne true si elle a été consommée. */
export function applyBonemeal(w: World, x: number, y: number, z: number): boolean {
  const v = w.getBlockAndMeta(x, y, z);
  const id = v & 255;
  const meta = v >> 8;
  const rng = w.rng;
  if (isSapling(id)) {
    if (rng() < 0.45) growTree(w, x, y, z, id, rng);
    w.host.effect('grow', x, y, z);
    return true;
  }
  if (isCrop(id)) {
    const stage = meta & 7;
    if (stage >= 7) return false;
    w.setBlock(x, y, z, id, Math.min(7, stage + 2 + Math.floor(rng() * 4)), false);
    w.host.effect('grow', x, y, z);
    return true;
  }
  if (id === B.GRASS) {
    for (let i = 0; i < 24; i++) {
      const tx = x + Math.floor(rng() * 7) - 3;
      const tz = z + Math.floor(rng() * 7) - 3;
      for (let ty = y + 2; ty >= y - 1; ty--) {
        if (w.getBlock(tx, ty, tz) !== B.AIR || w.getBlock(tx, ty - 1, tz) !== B.GRASS) continue;
        const r = rng();
        const plant = r < 0.1 ? BONEMEAL_FLOWERS[Math.floor(rng() * BONEMEAL_FLOWERS.length)] : r < 0.18 ? B.FERN : B.TALL_GRASS;
        w.setBlock(tx, ty, tz, plant, 0);
        break;
      }
    }
    w.host.effect('grow', x, y + 1, z);
    return true;
  }
  return false;
}
