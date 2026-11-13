/**
 * Écoulement de l'eau et de la lave (règles de Minecraft).
 *
 * Méta d'un fluide : 0 = source, 1..7 = niveau (7 = le plus fin), >= 8 = colonne qui tombe.
 */
import { B } from './Ids';
import { BLOCK_SHAPE, BLOCK_SOLID, FACING_DX, FACING_DZ, SHAPE } from './Blocks';
import type { World } from './World';

export const WATER_TICK_DELAY = 5;
export const LAVA_TICK_DELAY = 30;

export function fluidTickDelay(id: number): number {
  return id === B.LAVA ? LAVA_TICK_DELAY : WATER_TICK_DELAY;
}

/** Le bloc arrête-t-il un écoulement ? */
function blocksFlow(w: World, x: number, y: number, z: number): boolean {
  const id = w.getBlock(x, y, z);
  if (id === B.AIR) return false;
  const shape = BLOCK_SHAPE[id];
  if (shape === SHAPE.DOOR || shape === SHAPE.LADDER || shape === SHAPE.FENCE_GATE || id === B.SUGAR_CANE) return true;
  return BLOCK_SOLID[id] === 1;
}

function canFlowInto(w: World, x: number, y: number, z: number, fluid: number): boolean {
  const id = w.getBlock(x, y, z);
  if (id === fluid || id === B.LAVA) return false;
  return !blocksFlow(w, x, y, z);
}

function flowInto(w: World, x: number, y: number, z: number, fluid: number, level: number): void {
  if (!canFlowInto(w, x, y, z, fluid)) return;
  if (!w.isLoaded(x, z)) return;
  const id = w.getBlock(x, y, z);
  if (id !== B.AIR) {
    if (fluid === B.LAVA) w.host.effect('fizz', x, y, z);
    else if (BLOCK_SHAPE[id] !== SHAPE.FLUID) w.breakBlock(x, y, z, true);
  }
  w.setBlock(x, y, z, fluid, level);
}

/** Lave au contact de l'eau : obsidienne (source) ou pierres (coulée). Retourne true si la lave a durci. */
export function lavaMix(w: World, x: number, y: number, z: number, meta: number): boolean {
  const touching =
    w.getBlock(x, y + 1, z) === B.WATER ||
    w.getBlock(x - 1, y, z) === B.WATER ||
    w.getBlock(x + 1, y, z) === B.WATER ||
    w.getBlock(x, y, z - 1) === B.WATER ||
    w.getBlock(x, y, z + 1) === B.WATER;
  if (!touching) return false;
  if (meta === 0) w.setBlock(x, y, z, B.OBSIDIAN, 0);
  else if (meta <= 4) w.setBlock(x, y, z, B.COBBLESTONE, 0);
  else return false;
  w.host.effect('fizz', x, y, z);
  return true;
}

function isSource(w: World, x: number, y: number, z: number, fluid: number): boolean {
  const v = w.getBlockAndMeta(x, y, z);
  return (v & 255) === fluid && v >> 8 === 0;
}

/** Distance (1..4) jusqu'au premier trou atteignable depuis (x, y, z), 1000 s'il n'y en a pas. */
function flowCost(w: World, x: number, y: number, z: number, depth: number, from: number, fluid: number): number {
  let cost = 1000;
  for (let f = 0; f < 4; f++) {
    if (f === ((from + 2) & 3)) continue; // ne pas revenir sur ses pas
    const nx = x + FACING_DX[f];
    const nz = z + FACING_DZ[f];
    if (blocksFlow(w, nx, y, nz) || isSource(w, nx, y, nz, fluid)) continue;
    if (!blocksFlow(w, nx, y - 1, nz)) return depth;
    if (depth < 4) {
      const c = flowCost(w, nx, y, nz, depth + 1, f, fluid);
      if (c < cost) cost = c;
    }
  }
  return cost;
}

const costs = [0, 0, 0, 0];

/** Masque des directions d'étalement : celles qui mènent le plus vite à un trou. */
function flowDirections(w: World, x: number, y: number, z: number, fluid: number): number {
  let best = 1000;
  for (let f = 0; f < 4; f++) {
    const nx = x + FACING_DX[f];
    const nz = z + FACING_DZ[f];
    let c = 1000;
    if (!blocksFlow(w, nx, y, nz) && !isSource(w, nx, y, nz, fluid)) {
      c = blocksFlow(w, nx, y - 1, nz) ? flowCost(w, nx, y, nz, 1, f, fluid) : 0;
    }
    costs[f] = c;
    if (c < best) best = c;
  }
  let mask = 0;
  for (let f = 0; f < 4; f++) if (costs[f] === best) mask |= 1 << f;
  return mask;
}

/** Tick planifié d'un bloc de fluide. */
export function fluidTick(w: World, x: number, y: number, z: number, id: number, meta: number): void {
  const lava = id === B.LAVA;
  const step = lava ? 2 : 1;
  let delay = lava ? LAVA_TICK_DELAY : WATER_TICK_DELAY;
  let level = meta;

  if (level > 0) {
    // niveau attendu d'après les voisins
    let min = -1;
    let sources = 0;
    for (let f = 0; f < 4; f++) {
      const v = w.getBlockAndMeta(x + FACING_DX[f], y, z + FACING_DZ[f]);
      if ((v & 255) !== id) continue;
      let l = v >> 8;
      if (l === 0) sources++;
      if (l >= 8) l = 0;
      if (min < 0 || l < min) min = l;
    }
    let next = min + step;
    if (next >= 8 || min < 0) next = -1;
    const above = w.getBlockAndMeta(x, y + 1, z);
    if ((above & 255) === id) {
      const al = above >> 8;
      next = al >= 8 ? al : al + 8;
    }
    // deux sources voisines au-dessus d'un fond : source infinie
    if (sources >= 2 && !lava) {
      const below = w.getBlockAndMeta(x, y - 1, z);
      const bid = below & 255;
      if (BLOCK_SOLID[bid]) next = 0;
      else if (bid === id && below >> 8 === 0) next = 0;
    }
    if (lava && level < 8 && next < 8 && next > level && w.rng() < 0.75) delay *= 4;
    if (next !== level) {
      level = next;
      if (next < 0) {
        w.setBlock(x, y, z, B.AIR, 0);
        return;
      }
      w.setBlock(x, y, z, id, next, false);
      w.scheduleTick(x, y, z, delay);
      w.notifyNeighbors(x, y, z);
    }
  }

  if (canFlowInto(w, x, y - 1, z, id)) {
    if (lava && w.getBlock(x, y - 1, z) === B.WATER) {
      w.setBlock(x, y - 1, z, B.STONE, 0);
      w.host.effect('fizz', x, y - 1, z);
      return;
    }
    flowInto(w, x, y - 1, z, id, level >= 8 ? level : level + 8);
  } else if (level >= 0 && (level === 0 || blocksFlow(w, x, y - 1, z))) {
    let next = level + step;
    if (level >= 8) next = 1;
    if (next >= 8) return;
    const mask = flowDirections(w, x, y, z, id);
    for (let f = 0; f < 4; f++) {
      if (mask & (1 << f)) flowInto(w, x + FACING_DX[f], y, z + FACING_DZ[f], id, next);
    }
  }
}
