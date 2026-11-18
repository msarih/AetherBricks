/**
 * Logique des rails : formes (0..9), raccordement automatique et alimentation des rails propulseurs.
 * Module pur (ni DOM ni Three.js).
 */
import { B } from './Ids';
import { isBlockPowered, updateRedstoneAround } from './Redstone';
import type { World } from './World';

export const RAIL_NS = 0;
export const RAIL_EW = 1;
export const RAIL_ASC_E = 2;
export const RAIL_ASC_W = 3;
export const RAIL_ASC_N = 4;
export const RAIL_ASC_S = 5;
export const RAIL_CURVE_SE = 6;
export const RAIL_CURVE_SW = 7;
export const RAIL_CURVE_NW = 8;
export const RAIL_CURVE_NE = 9;

export function isRail(id: number): boolean {
  return id === B.RAIL || id === B.POWERED_RAIL || id === B.DETECTOR_RAIL;
}

export function railShape(id: number, meta: number): number {
  return id === B.RAIL ? meta & 15 : meta & 7;
}

function hasRailAt(w: World, x: number, y: number, z: number): boolean {
  return isRail(w.getBlock(x, y, z));
}

function hasRailCol(w: World, x: number, y: number, z: number): boolean {
  return hasRailAt(w, x, y, z) || hasRailAt(w, x, y + 1, z) || hasRailAt(w, x, y - 1, z);
}

/** Calcule la forme (0..9) d'un rail en (x, y, z) selon ses voisins et un axe préféré (0=N-S, 1=E-W). */
function computeRailShape(w: World, x: number, y: number, z: number, id: number, preferredAxis: number): number {
  const n = hasRailCol(w, x, y, z - 1);
  const s = hasRailCol(w, x, y, z + 1);
  const west = hasRailCol(w, x - 1, y, z);
  const east = hasRailCol(w, x + 1, y, z);

  const canCurve = id === B.RAIL;
  let shape = -1;

  if (canCurve) {
    if (s && east && !n && !west) shape = RAIL_CURVE_SE;
    else if (s && west && !n && !east) shape = RAIL_CURVE_SW;
    else if (n && west && !s && !east) shape = RAIL_CURVE_NW;
    else if (n && east && !s && !west) shape = RAIL_CURVE_NE;
  }

  if (shape < 0) {
    const ns = n || s;
    const ew = west || east;
    if (ns && !ew) shape = RAIL_NS;
    else if (ew && !ns) shape = RAIL_EW;
    else if (canCurve && ns && ew) {
      if (s && east) shape = RAIL_CURVE_SE;
      else if (s && west) shape = RAIL_CURVE_SW;
      else if (n && west) shape = RAIL_CURVE_NW;
      else shape = RAIL_CURVE_NE;
    } else {
      shape = preferredAxis & 1;
    }
  }

  // Montée d'un bloc si un rail existe juste au-dessus dans l'axe retenu
  if (shape === RAIL_NS) {
    if (hasRailAt(w, x, y + 1, z - 1)) return RAIL_ASC_N;
    if (hasRailAt(w, x, y + 1, z + 1)) return RAIL_ASC_S;
  } else if (shape === RAIL_EW) {
    if (hasRailAt(w, x + 1, y + 1, z)) return RAIL_ASC_E;
    if (hasRailAt(w, x - 1, y + 1, z)) return RAIL_ASC_W;
  }
  return shape;
}

function railStep(shape: number): [number, number, number, number] {
  if (shape === RAIL_EW || shape === RAIL_ASC_E || shape === RAIL_ASC_W) return [1, 0, -1, 0];
  return [0, 1, 0, -1];
}

function walkPoweredChain(w: World, x: number, y: number, z: number, shape: number, visit: (cx: number, cy: number, cz: number, meta: number) => boolean): boolean {
  const [dx, dz] = railStep(shape);
  for (const sign of [1, -1]) {
    let cx = x;
    let cy = y;
    let cz = z;
    for (let dist = 1; dist <= 8; dist++) {
      cx += dx * sign;
      cz += dz * sign;
      let foundY = -1;
      let foundMeta = 0;
      for (const oy of [0, 1, -1]) {
        if (w.getBlock(cx, cy + oy, cz) === B.POWERED_RAIL) {
          const m = w.getMeta(cx, cy + oy, cz);
          const [ndx, ndz] = railStep(railShape(B.POWERED_RAIL, m));
          if (ndx === dx && ndz === dz) {
            foundY = cy + oy;
            foundMeta = m;
            break;
          }
        }
      }
      if (foundY < 0) break;
      cy = foundY;
      if (visit(cx, cy, cz, foundMeta)) return true;
    }
  }
  return false;
}

function isPoweredRailActive(w: World, x: number, y: number, z: number, shape: number): boolean {
  if (isBlockPowered(w, x, y, z)) return true;
  return walkPoweredChain(w, x, y, z, shape, (cx, cy, cz) => isBlockPowered(w, cx, cy, cz));
}

/** Met à jour la forme d'un rail voisin quand un nouveau rail vient d'être posé. */
function refreshNeighborRail(w: World, x: number, y: number, z: number): void {
  const v = w.getBlockAndMeta(x, y, z);
  const id = v & 255;
  if (!isRail(id)) return;
  const oldMeta = v >> 8;
  const oldShape = railShape(id, oldMeta);
  const pref = oldShape === RAIL_EW || oldShape === RAIL_ASC_E || oldShape === RAIL_ASC_W ? 1 : 0;
  const nextShape = computeRailShape(w, x, y, z, id, pref);
  const powerBit = id === B.POWERED_RAIL ? (isPoweredRailActive(w, x, y, z, nextShape) ? 8 : 0) : oldMeta & 8;
  const nextMeta = nextShape | powerBit;
  if (nextMeta !== oldMeta) w.setMeta(x, y, z, nextMeta, false);
}

/** Place et raccorde un rail en (x, y, z), puis ajuste les rails voisins. */
export function placeAndConnectRail(w: World, x: number, y: number, z: number, id: number, preferredAxis: number): void {
  const shape = computeRailShape(w, x, y, z, id, preferredAxis);
  const powerBit = id === B.POWERED_RAIL && isPoweredRailActive(w, x, y, z, shape) ? 8 : 0;
  w.setBlock(x, y, z, id, shape | powerBit);
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    for (const dy of [-1, 0, 1]) {
      refreshNeighborRail(w, x + dx, y + dy, z + dz);
    }
  }
  if (id === B.POWERED_RAIL) updatePoweredRailChain(w, x, y, z);
}

/** Met à jour l'alimentation d'un rail propulseur (et de sa file) lors d'un changement redstone. */
export function updatePoweredRail(w: World, x: number, y: number, z: number): void {
  const v = w.getBlockAndMeta(x, y, z);
  if ((v & 255) !== B.POWERED_RAIL) return;
  const oldMeta = v >> 8;
  const shape = railShape(B.POWERED_RAIL, oldMeta);
  const powered = isPoweredRailActive(w, x, y, z, shape);
  const nextMeta = shape | (powered ? 8 : 0);
  if (nextMeta !== oldMeta) {
    w.setMeta(x, y, z, nextMeta, false);
    updatePoweredRailChain(w, x, y, z);
  }
}

function updatePoweredRailChain(w: World, x: number, y: number, z: number): void {
  const shape = railShape(B.POWERED_RAIL, w.getMeta(x, y, z));
  walkPoweredChain(w, x, y, z, shape, (cx, cy, cz, oldMeta) => {
    const ns = railShape(B.POWERED_RAIL, oldMeta);
    const nextMeta = ns | (isPoweredRailActive(w, cx, cy, cz, ns) ? 8 : 0);
    if (nextMeta !== oldMeta) w.setMeta(cx, cy, cz, nextMeta, false);
    return false;
  });
}

/** Active ou désactive un rail détecteur et propage la redstone autour. */
export function setDetectorRailActive(w: World, x: number, y: number, z: number, active: boolean): void {
  const v = w.getBlockAndMeta(x, y, z);
  if ((v & 255) !== B.DETECTOR_RAIL) return;
  const oldMeta = v >> 8;
  const shape = railShape(B.DETECTOR_RAIL, oldMeta);
  const nextMeta = shape | (active ? 8 : 0);
  if (nextMeta !== oldMeta) {
    w.setMeta(x, y, z, nextMeta, false);
    updateRedstoneAround(w, x, y, z);
  }
}
