/**
 * Lancer de rayon dans la grille de blocs (parcours voxel par voxel), contre les boîtes
 * de sélection (visée du joueur) ou de collision (projectiles).
 */
import { BLOCK_SHAPE, SHAPE } from './Blocks';
import { FACE_DOWN, FACE_EAST, FACE_NORTH, FACE_SOUTH, FACE_UP, FACE_WEST } from './Constants';
import { B } from './Ids';
import type { World } from './World';

export interface RayHit {
  /** Bloc touché. */
  x: number;
  y: number;
  z: number;
  /** Face touchée (FACE_*). */
  face: number;
  /** Point d'impact. */
  hx: number;
  hy: number;
  hz: number;
  /** Distance depuis l'origine. */
  dist: number;
  id: number;
  meta: number;
}

export function newRayHit(): RayHit {
  return { x: 0, y: 0, z: 0, face: 0, hx: 0, hy: 0, hz: 0, dist: 0, id: 0, meta: 0 };
}

const boxes: number[] = [];
const FULL = [0, 0, 0, 16, 16, 16];

/** Résultat de la dernière intersection rayon / boîte. */
let boxT = 0;
let boxFace = 0;

/**
 * Intersection du rayon avec une boîte. Retourne true et renseigne boxT / boxFace.
 * Si l'origine est dans la boîte, l'impact est à t = 0.
 */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  let tNear = -Infinity;
  let tFar = Infinity;
  let face = -1;

  if (Math.abs(dx) < 1e-9) {
    if (ox < x0 || ox > x1) return false;
  } else {
    let a = (x0 - ox) / dx;
    let b = (x1 - ox) / dx;
    let f = FACE_WEST;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
      f = FACE_EAST;
    }
    if (a > tNear) {
      tNear = a;
      face = f;
    }
    if (b < tFar) tFar = b;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y1) return false;
  } else {
    let a = (y0 - oy) / dy;
    let b = (y1 - oy) / dy;
    let f = FACE_DOWN;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
      f = FACE_UP;
    }
    if (a > tNear) {
      tNear = a;
      face = f;
    }
    if (b < tFar) tFar = b;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < z0 || oz > z1) return false;
  } else {
    let a = (z0 - oz) / dz;
    let b = (z1 - oz) / dz;
    let f = FACE_NORTH;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
      f = FACE_SOUTH;
    }
    if (a > tNear) {
      tNear = a;
      face = f;
    }
    if (b < tFar) tFar = b;
  }
  if (tNear > tFar || tFar < 0) return false;
  if (tNear < 0) {
    // origine dans la boîte : face opposée à la direction dominante
    tNear = 0;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    if (ay >= ax && ay >= az) face = dy > 0 ? FACE_DOWN : FACE_UP;
    else if (ax >= az) face = dx > 0 ? FACE_WEST : FACE_EAST;
    else face = dz > 0 ? FACE_NORTH : FACE_SOUTH;
  }
  boxT = tNear;
  boxFace = face;
  return true;
}

/** Distance d'entrée du rayon dans la boîte, ou -1 s'il la manque (ou la touche au-delà de `max`). */
export function rayBoxDistance(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, max: number): number {
  if (!rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1)) return -1;
  return boxT <= max ? boxT : -1;
}

/**
 * Lance un rayon depuis (ox, oy, oz) dans la direction normalisée (dx, dy, dz).
 * `collision` : teste les boîtes de collision plutôt que de sélection (les plantes sont alors traversées).
 * `fluids` : les sources de fluide arrêtent le rayon (seau, nénuphar).
 */
export function raycast(w: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RayHit, collision = false, fluids = false): boolean {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const sz = dz > 0 ? 1 : -1;
  const tdx = Math.abs(dx) < 1e-9 ? Infinity : Math.abs(1 / dx);
  const tdy = Math.abs(dy) < 1e-9 ? Infinity : Math.abs(1 / dy);
  const tdz = Math.abs(dz) < 1e-9 ? Infinity : Math.abs(1 / dz);
  let tx = tdx === Infinity ? Infinity : (dx > 0 ? x + 1 - ox : ox - x) * tdx;
  let ty = tdy === Infinity ? Infinity : (dy > 0 ? y + 1 - oy : oy - y) * tdy;
  let tz = tdz === Infinity ? Infinity : (dz > 0 ? z + 1 - oz : oz - z) * tdz;
  let t = 0;

  for (let guard = 0; guard < 512 && t <= maxDist; guard++) {
    const v = w.getBlockAndMeta(x, y, z);
    const id = v & 255;
    if (id !== B.AIR) {
      const meta = v >> 8;
      let list: readonly number[] | null = null;
      if (BLOCK_SHAPE[id] === SHAPE.FLUID) {
        if (fluids && meta === 0) list = FULL;
      } else {
        boxes.length = 0;
        if (collision) w.collisionBoxesAt(x, y, z, boxes);
        else w.selectionBoxesAt(x, y, z, boxes);
        list = boxes;
      }
      if (list) {
        let best = Infinity;
        let bestFace = 0;
        for (let i = 0; i < list.length; i += 6) {
          const x0 = x + list[i] / 16;
          const y0 = y + list[i + 1] / 16;
          const z0 = z + list[i + 2] / 16;
          const x1 = x + list[i + 3] / 16;
          const y1 = y + list[i + 4] / 16;
          const z1 = z + list[i + 5] / 16;
          if (rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) && boxT < best) {
            best = boxT;
            bestFace = boxFace;
          }
        }
        if (best <= maxDist) {
          out.x = x;
          out.y = y;
          out.z = z;
          out.face = bestFace;
          out.dist = best;
          out.hx = ox + dx * best;
          out.hy = oy + dy * best;
          out.hz = oz + dz * best;
          out.id = id;
          out.meta = meta;
          return true;
        }
      }
    }
    if (tx <= ty && tx <= tz) {
      t = tx;
      tx += tdx;
      x += sx;
    } else if (ty <= tz) {
      t = ty;
      ty += tdy;
      y += sy;
    } else {
      t = tz;
      tz += tdz;
      z += sz;
    }
  }
  return false;
}
