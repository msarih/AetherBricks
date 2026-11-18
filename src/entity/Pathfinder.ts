/**
 * Recherche de chemin A* sur la grille de blocs pour les créatures ayant une cible.
 *
 * Garde-fous de performance :
 * - Calcul uniquement à la demande (poursuite d'une cible, animal attiré), jamais en errance.
 * - Nombre de nœuds explorés plafonné (`MAX_EXPANDED`), avec tableaux pré-alloués sans allocations.
 * - Renvoie le chemin vers le but ou, à défaut, vers le point exploré le plus proche du but.
 */
import { BLOCK_SHAPE, BLOCK_SOLID, SHAPE } from '../world/Blocks';
import { CHUNK_HEIGHT } from '../world/Constants';
import { B } from '../world/Ids';
import type { World } from '../world/World';

export interface PathPoint {
  x: number;
  y: number;
  z: number;
}

const MAX_EXPANDED = 128;
const MAX_POOL = MAX_EXPANDED * 5 + 8;

// Tableaux pré-alloués réutilisés d'un appel à l'autre (zéro allocation en tas pendant A*)
const nodeX = new Int32Array(MAX_POOL);
const nodeY = new Int32Array(MAX_POOL);
const nodeZ = new Int32Array(MAX_POOL);
const nodeG = new Float32Array(MAX_POOL);
const nodeF = new Float32Array(MAX_POOL);
const nodeH = new Float32Array(MAX_POOL);
const nodeParent = new Int32Array(MAX_POOL);
const openHeap = new Int32Array(MAX_POOL);
const visited = new Map<number, number>();

const DIRS_X = [1, -1, 0, 0];
const DIRS_Z = [0, 0, 1, -1];

/** Clé entière 30 bits pour les coordonnées relatives au départ (-512..511 en X/Z, 0..127 en Y). */
function packRel(dx: number, y: number, dz: number): number {
  return ((dx + 512) << 17) | ((dz + 512) << 7) | (y & 127);
}

/** Recherche en cours : les portes en bois fermées comptent comme franchissables (villageois). */
let throughDoors = false;

/** La cellule (x, y, z) est-elle libre de bloc solide ou dangereux ? */
function isPassable(w: World, x: number, y: number, z: number, avoidWater: boolean): boolean {
  if (y < 0 || y >= CHUNK_HEIGHT) return false;
  const v = w.getBlockAndMeta(x, y, z);
  const id = v & 255;
  if (id === B.AIR) return true;
  if (id === B.LAVA || id === B.FIRE || id === B.CACTUS) return false;
  if (id === B.WATER) return !avoidWater;
  const shape = BLOCK_SHAPE[id];
  if (shape === SHAPE.DOOR || shape === SHAPE.FENCE_GATE || shape === SHAPE.TRAPDOOR) {
    // une porte en bois fermée n'arrête pas celui qui sait l'ouvrir
    if (throughDoors && id === B.OAK_DOOR) return true;
    return (v & (4 << 8)) !== 0;
  }
  return BLOCK_SOLID[id] !== 1;
}

/** Peut-on poser le pied sur le bloc en (x, y, z) ? */
function isStandableFloor(w: World, x: number, y: number, z: number): boolean {
  if (y < 0 || y >= CHUNK_HEIGHT) return false;
  const v = w.getBlockAndMeta(x, y, z);
  const id = v & 255;
  if (id === B.AIR || id === B.CACTUS || id === B.LAVA || id === B.FIRE) return false;
  const shape = BLOCK_SHAPE[id];
  if (shape === SHAPE.FENCE) return false;
  if (shape === SHAPE.FENCE_GATE || shape === SHAPE.DOOR || shape === SHAPE.TRAPDOOR) {
    return (v & (4 << 8)) === 0;
  }
  return BLOCK_SOLID[id] === 1;
}

/** La créature de hauteur `cellsH` (1 ou 2) peut-elle occuper la colonne (x, z) avec les pieds en `y` ? */
function canOccupy(w: World, x: number, y: number, z: number, cellsH: number, avoidWater: boolean): boolean {
  if (!isPassable(w, x, y, z, avoidWater)) return false;
  if (cellsH >= 2 && !isPassable(w, x, y + 1, z, avoidWater)) return false;
  return true;
}

/**
 * Trouve l'ordonnée `y` valide en faisant un pas de `(x0, y0, z0)` vers `(nx, nz)`.
 * Retourne -1 si le pas est impossible.
 */
function stepY(w: World, x0: number, y0: number, z0: number, nx: number, nz: number, cellsH: number, avoidWater: boolean): number {
  if (!w.isLoaded(nx, nz)) return -1;
  // 1) Pas horizontal ou descente jusqu'à 3 blocs
  if (canOccupy(w, nx, y0, nz, cellsH, avoidWater)) {
    for (let drop = 0; drop <= 3; drop++) {
      const ty = y0 - drop;
      if (ty < 1) break;
      if (drop > 0 && !isPassable(w, nx, ty, nz, avoidWater)) return -1;
      if (isStandableFloor(w, nx, ty - 1, nz)) return ty;
    }
    return -1;
  }
  // 2) Montée d'un bloc (saut) : nécessite l'espace au-dessus de la tête au départ et à l'arrivée
  if (
    isStandableFloor(w, nx, y0, nz) &&
    isPassable(w, x0, y0 + cellsH, z0, avoidWater) &&
    canOccupy(w, nx, y0 + 1, nz, cellsH, avoidWater)
  ) {
    return y0 + 1;
  }
  return -1;
}

/**
 * Calcule un chemin de `(sx, sy, sz)` vers `(gx, gy, gz)`.
 * Retourne une liste de points (centres de blocs `x + 0.5, z + 0.5`) ou `null` si aucun pas n'est possible.
 */
export function findPath(
  w: World,
  sx: number,
  sy: number,
  sz: number,
  gx: number,
  gy: number,
  gz: number,
  height: number,
  avoidWater: boolean,
  doors = false,
): PathPoint[] | null {
  throughDoors = doors;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy + 0.01);
  const z0 = Math.floor(sz);
  const tx = Math.floor(gx);
  const ty = Math.floor(gy + 0.01);
  const tz = Math.floor(gz);
  if (x0 === tx && z0 === tz && Math.abs(y0 - ty) <= 1) return null;

  const cellsH = height > 1.1 ? 2 : 1;
  visited.clear();

  const h0 = Math.abs(tx - x0) + Math.abs(ty - y0) + Math.abs(tz - z0);
  nodeX[0] = x0;
  nodeY[0] = y0;
  nodeZ[0] = z0;
  nodeG[0] = 0;
  nodeH[0] = h0;
  nodeF[0] = h0;
  nodeParent[0] = -1;
  visited.set(packRel(0, y0, 0), 0);

  let heapSize = 1;
  openHeap[0] = 0;
  let poolSize = 1;
  let expanded = 0;
  let bestNode = 0;
  let bestH = h0;

  while (heapSize > 0 && expanded < MAX_EXPANDED) {
    // Extraction du minimum du tas binaire
    const cur = openHeap[0];
    const last = openHeap[--heapSize];
    if (heapSize > 0) {
      openHeap[0] = last;
      let i = 0;
      const lastF = nodeF[last];
      while (true) {
        const l = (i << 1) + 1;
        if (l >= heapSize) break;
        const r = l + 1;
        let smallest = l;
        if (r < heapSize && nodeF[openHeap[r]] < nodeF[openHeap[l]]) smallest = r;
        if (lastF <= nodeF[openHeap[smallest]]) break;
        openHeap[i] = openHeap[smallest];
        i = smallest;
      }
      openHeap[i] = last;
    }

    const cx = nodeX[cur];
    const cy = nodeY[cur];
    const cz = nodeZ[cur];
    const ch = nodeH[cur];
    if (ch < bestH) {
      bestH = ch;
      bestNode = cur;
    }
    // But atteint (ou case adjacente à portée immédiate)
    if (cx === tx && cz === tz && Math.abs(cy - ty) <= 1) {
      bestNode = cur;
      break;
    }
    expanded++;

    const cg = nodeG[cur];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS_X[d];
      const nz = cz + DIRS_Z[d];
      const ny = stepY(w, cx, cy, cz, nx, nz, cellsH, avoidWater);
      if (ny < 0) continue;

      const key = packRel(nx - x0, ny, nz - z0);
      const stepCost = ny > cy ? 1.3 : ny < cy ? 1.1 : 1.0;
      const ng = cg + stepCost;
      const prevIdx = visited.get(key);
      if (prevIdx !== undefined) {
        if (ng >= nodeG[prevIdx]) continue;
        nodeG[prevIdx] = ng;
        nodeF[prevIdx] = ng + nodeH[prevIdx] * 1.1;
        nodeParent[prevIdx] = cur;
        continue;
      }
      if (poolSize >= MAX_POOL) continue;

      const idx = poolSize++;
      const nh = Math.abs(tx - nx) + Math.abs(ty - ny) + Math.abs(tz - nz);
      const nf = ng + nh * 1.1;
      nodeX[idx] = nx;
      nodeY[idx] = ny;
      nodeZ[idx] = nz;
      nodeG[idx] = ng;
      nodeH[idx] = nh;
      nodeF[idx] = nf;
      nodeParent[idx] = cur;
      visited.set(key, idx);

      // Insertion dans le tas binaire
      let i = heapSize++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (nodeF[openHeap[p]] <= nf) break;
        openHeap[i] = openHeap[p];
        i = p;
      }
      openHeap[i] = idx;
    }
  }

  if (bestNode === 0) return null;
  const out: PathPoint[] = [];
  let u = bestNode;
  while (u > 0) {
    out.push({ x: nodeX[u] + 0.5, y: nodeY[u], z: nodeZ[u] + 0.5 });
    u = nodeParent[u];
  }
  out.reverse();
  return out;
}
