/**
 * Logique redstone de base :
 *  - poudre (signal 0..15, décroissance de 1 par bloc, connexions en escalier)
 *  - sources : torche de redstone (inversée par son support), levier, bouton, plaque de pression, bloc de redstone
 *  - récepteurs : lampe à redstone, porte en fer, TNT, piston et piston collant (jusqu'à 12 blocs)
 *  - propagation bornée (MAX_REDSTONE_UPDATES) pour garantir un coût borné par tick.
 */
import { B } from './Ids';
import {
  BLOCK_OPAQUE,
  BLOCK_REPLACEABLE,
  FACING_DX,
  FACING_DZ,
  PISTON_DX,
  PISTON_DY,
  PISTON_DZ,
  isDoor,
} from './Blocks';
import { META_DOOR_OPEN, META_DOOR_UPPER } from './BlockModels';
import { posKey, posKeyX, posKeyY, posKeyZ, type World } from './World';

/** Nombre maximal de nœuds redstone traités par vague de propagation. */
export const MAX_REDSTONE_UPDATES = 512;
/** Nombre maximal de blocs poussés par un piston. */
const MAX_PISTON_PUSH = 12;

const DIRS_6 = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

const H_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

let propagating = false;

export function isRedstoneBlock(id: number): boolean {
  return (
    id === B.REDSTONE_WIRE ||
    id === B.REDSTONE_TORCH ||
    id === B.LEVER ||
    id === B.STONE_BUTTON ||
    id === B.STONE_PRESSURE_PLATE ||
    id === B.PISTON ||
    id === B.STICKY_PISTON ||
    id === B.PISTON_HEAD ||
    id === B.REDSTONE_LAMP ||
    id === B.REDSTONE_LAMP_LIT ||
    id === B.REDSTONE_BLOCK ||
    id === B.IRON_DOOR ||
    id === B.TNT
  );
}

/** Vérifie rapidement si (x, y, z) ou un voisin immédiat concerne la redstone. */
export function hasRedstoneNearby(w: World, x: number, y: number, z: number): boolean {
  if (isRedstoneBlock(w.getBlock(x, y, z))) return true;
  for (let i = 0; i < 6; i++) {
    const [dx, dy, dz] = DIRS_6[i];
    if (isRedstoneBlock(w.getBlock(x + dx, y + dy, z + dz))) return true;
  }
  return false;
}

/** Indique si le bloc solide (x, y, z) est fortement alimenté par un composant attaché. */
function isStronglyPoweredBlock(w: World, x: number, y: number, z: number): boolean {
  if (BLOCK_OPAQUE[w.getBlock(x, y, z)] !== 1) return false;
  // Torche au sol juste dessous (y - 1, meta = 0 = allumée au sol)
  const below = w.getBlockAndMeta(x, y - 1, z);
  if ((below & 255) === B.REDSTONE_TORCH && ((below >> 8) & 15) === 0) return true;
  // Plaque de pression juste dessus
  const above = w.getBlockAndMeta(x, y + 1, z);
  if ((above & 255) === B.STONE_PRESSURE_PLATE && ((above >> 8) & 1) !== 0) return true;
  // Levier ou bouton au-dessus (side === 0)
  if (((above & 255) === B.LEVER || (above & 255) === B.STONE_BUTTON) && ((above >> 8) & 7) === 0 && ((above >> 8) & 8) !== 0) {
    return true;
  }
  // Levier ou bouton mural attaché à l'une des 4 faces latérales
  for (let f = 0; f < 4; f++) {
    const nx = x + FACING_DX[f];
    const nz = z + FACING_DZ[f];
    const nv = w.getBlockAndMeta(nx, y, nz);
    const nid = nv & 255;
    if (nid !== B.LEVER && nid !== B.STONE_BUTTON) continue;
    const nm = nv >> 8;
    if ((nm & 8) !== 0 && (nm & 7) === f + 1) return true;
  }
  return false;
}

/** Puissance directe fournie par (nx, ny, nz) vers un voisin (exclut la poudre). */
function directSourcePower(w: World, nx: number, ny: number, nz: number, tx: number, ty: number, tz: number): number {
  const v = w.getBlockAndMeta(nx, ny, nz);
  const id = v & 255;
  const meta = v >> 8;
  switch (id) {
    case B.REDSTONE_BLOCK:
      return 15;
    case B.REDSTONE_TORCH: {
      if (meta & 8) return 0; // éteinte
      // Une torche n'alimente pas le bloc sur lequel elle est accrochée
      const side = meta & 7;
      const sx = side === 0 ? nx : nx - FACING_DX[(side - 1) & 3];
      const sy = side === 0 ? ny - 1 : ny;
      const sz = side === 0 ? nz : nz - FACING_DZ[(side - 1) & 3];
      if (tx === sx && ty === sy && tz === sz) return 0;
      return 15;
    }
    case B.LEVER:
    case B.STONE_BUTTON:
      return meta & 8 ? 15 : 0;
    case B.STONE_PRESSURE_PLATE:
      return meta & 1 ? 15 : 0;
    default:
      return 0;
  }
}

/** Puissance entrante sur une poudre de redstone en (x, y, z). */
function computeWirePower(w: World, x: number, y: number, z: number): number {
  let best = 0;
  for (let i = 0; i < 6; i++) {
    const [dx, dy, dz] = DIRS_6[i];
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    const p = directSourcePower(w, nx, ny, nz, x, y, z);
    if (p > best) best = p;
    if (best < 15 && isStronglyPoweredBlock(w, nx, ny, nz)) best = 15;
    if (best === 15) return 15;
  }
  // Poudres voisines horizontales et en escalier
  const openAboveSelf = BLOCK_OPAQUE[w.getBlock(x, y + 1, z)] === 0;
  for (let i = 0; i < 4; i++) {
    const [dx, dz] = H_DIRS[i];
    const nx = x + dx;
    const nz = z + dz;
    const nv = w.getBlockAndMeta(nx, y, nz);
    if ((nv & 255) === B.REDSTONE_WIRE) {
      const p = (nv >> 8) - 1;
      if (p > best) best = p;
    } else if (BLOCK_OPAQUE[nv & 255] === 0) {
      // Descente : poudre en (nx, y - 1, nz)
      const dv = w.getBlockAndMeta(nx, y - 1, nz);
      if ((dv & 255) === B.REDSTONE_WIRE) {
        const p = (dv >> 8) - 1;
        if (p > best) best = p;
      }
    }
    if (openAboveSelf && BLOCK_OPAQUE[w.getBlock(nx, y + 1, nz)] === 0) {
      // Montée : poudre en (nx, y + 1, nz) sur un bloc
      const uv = w.getBlockAndMeta(nx, y + 1, nz);
      if ((uv & 255) === B.REDSTONE_WIRE) {
        const p = (uv >> 8) - 1;
        if (p > best) best = p;
      }
    }
  }
  return best > 0 ? best : 0;
}

/** Indique si le bloc (x, y, z) reçoit un signal redstone (> 0). */
export function isBlockPowered(w: World, x: number, y: number, z: number): boolean {
  for (let i = 0; i < 6; i++) {
    const [dx, dy, dz] = DIRS_6[i];
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    if (directSourcePower(w, nx, ny, nz, x, y, z) > 0) return true;
    const nv = w.getBlockAndMeta(nx, ny, nz);
    if ((nv & 255) === B.REDSTONE_WIRE && (nv >> 8) > 0) return true;
    if (isStronglyPoweredBlock(w, nx, ny, nz)) return true;
  }
  return false;
}

/** Vérifie si le bloc support d'une torche de redstone reçoit un signal. */
export function isTorchSupportPowered(w: World, x: number, y: number, z: number, meta: number): boolean {
  const side = meta & 7;
  const sx = side === 0 ? x : x - FACING_DX[(side - 1) & 3];
  const sy = side === 0 ? y - 1 : y;
  const sz = side === 0 ? z : z - FACING_DZ[(side - 1) & 3];
  // Vérifie si (sx, sy, sz) reçoit un signal d'un de ses voisins (hors cette torche)
  for (let i = 0; i < 6; i++) {
    const [dx, dy, dz] = DIRS_6[i];
    const nx = sx + dx;
    const ny = sy + dy;
    const nz = sz + dz;
    if (nx === x && ny === y && nz === z) continue;
    if (directSourcePower(w, nx, ny, nz, sx, sy, sz) > 0) return true;
    const nv = w.getBlockAndMeta(nx, ny, nz);
    if ((nv & 255) === B.REDSTONE_WIRE && (nv >> 8) > 0) return true;
  }
  return false;
}

function isMovableBlock(id: number, meta: number): boolean {
  if (id === B.AIR || BLOCK_REPLACEABLE[id] === 1) return true;
  if (
    id === B.BEDROCK ||
    id === B.OBSIDIAN ||
    id === B.ENCHANTING_TABLE ||
    id === B.SPAWNER ||
    id === B.CHEST ||
    id === B.FURNACE ||
    id === B.FURNACE_LIT ||
    id === B.PISTON_HEAD ||
    id === B.BED ||
    isDoor(id)
  ) {
    return false;
  }
  if ((id === B.PISTON || id === B.STICKY_PISTON) && (meta & 8) !== 0) return false;
  return true;
}

function tryPistonMove(w: World, x: number, y: number, z: number, id: number, meta: number, powered: boolean): void {
  const f = Math.min(5, meta & 7);
  const dx = PISTON_DX[f];
  const dy = PISTON_DY[f];
  const dz = PISTON_DZ[f];
  const extended = (meta & 8) !== 0;
  const sticky = id === B.STICKY_PISTON;

  if (powered && !extended) {
    // Cherche la chaîne de blocs à pousser (max MAX_PISTON_PUSH)
    let len = 0;
    while (len <= MAX_PISTON_PUSH) {
      const bx = x + dx * (len + 1);
      const by = y + dy * (len + 1);
      const bz = z + dz * (len + 1);
      if (by < 1 || by >= 127) return;
      const bv = w.getBlockAndMeta(bx, by, bz);
      const bid = bv & 255;
      if (bid === B.AIR || BLOCK_REPLACEABLE[bid] === 1) break;
      if (len === MAX_PISTON_PUSH || !isMovableBlock(bid, bv >> 8)) return;
      len++;
    }
    // Décale les blocs de la fin vers le piston
    for (let i = len; i >= 1; i--) {
      const sx = x + dx * i;
      const sy = y + dy * i;
      const sz = z + dz * i;
      const sv = w.getBlockAndMeta(sx, sy, sz);
      w.setBlock(sx + dx, sy + dy, sz + dz, sv & 255, sv >> 8, false);
    }
    w.setBlock(x + dx, y + dy, z + dz, B.PISTON_HEAD, f | (sticky ? 8 : 0), false);
    w.setMeta(x, y, z, f | 8, false);
    w.host.effect('place', x + dx, y + dy, z + dz, B.PISTON_HEAD);
    for (let i = 1; i <= len + 1; i++) {
      w.notifyNeighbors(x + dx * i, y + dy * i, z + dz * i);
    }
  } else if (!powered && extended) {
    const hx = x + dx;
    const hy = y + dy;
    const hz = z + dz;
    if (w.getBlock(hx, hy, hz) === B.PISTON_HEAD) {
      w.setBlock(hx, hy, hz, B.AIR, 0, false);
    }
    w.setMeta(x, y, z, f, false);
    if (sticky) {
      const px = x + dx * 2;
      const py = y + dy * 2;
      const pz = z + dz * 2;
      const pv = w.getBlockAndMeta(px, py, pz);
      const pid = pv & 255;
      if (pid !== B.AIR && BLOCK_REPLACEABLE[pid] !== 1 && isMovableBlock(pid, pv >> 8)) {
        w.setBlock(hx, hy, hz, pid, pv >> 8, false);
        w.setBlock(px, py, pz, B.AIR, 0, false);
        w.notifyNeighbors(px, py, pz);
      }
    }
    w.notifyNeighbors(hx, hy, hz);
  }
}

function updateConsumer(w: World, x: number, y: number, z: number): void {
  const v = w.getBlockAndMeta(x, y, z);
  const id = v & 255;
  const meta = v >> 8;

  if (id === B.REDSTONE_TORCH) {
    const shouldBeOff = isTorchSupportPowered(w, x, y, z, meta);
    const isOff = (meta & 8) !== 0;
    if (shouldBeOff !== isOff) w.scheduleTick(x, y, z, 2);
    return;
  }
  if (id === B.REDSTONE_LAMP || id === B.REDSTONE_LAMP_LIT) {
    const lit = isBlockPowered(w, x, y, z);
    if (lit && id === B.REDSTONE_LAMP) w.setBlock(x, y, z, B.REDSTONE_LAMP_LIT, 0, false);
    else if (!lit && id === B.REDSTONE_LAMP_LIT) w.setBlock(x, y, z, B.REDSTONE_LAMP, 0, false);
    return;
  }
  if (id === B.IRON_DOOR) {
    const lowerY = meta & META_DOOR_UPPER ? y - 1 : y;
    const lv = w.getBlockAndMeta(x, lowerY, z);
    const uv = w.getBlockAndMeta(x, lowerY + 1, z);
    if ((lv & 255) !== B.IRON_DOOR || (uv & 255) !== B.IRON_DOOR) return;
    const powered = isBlockPowered(w, x, lowerY, z) || isBlockPowered(w, x, lowerY + 1, z);
    const open = ((lv >> 8) & META_DOOR_OPEN) !== 0;
    if (powered !== open) {
      w.setMeta(x, lowerY, z, powered ? (lv >> 8) | META_DOOR_OPEN : (lv >> 8) & ~META_DOOR_OPEN, false);
      w.setMeta(x, lowerY + 1, z, powered ? (uv >> 8) | META_DOOR_OPEN : (uv >> 8) & ~META_DOOR_OPEN, false);
    }
    return;
  }
  if (id === B.TNT) {
    if (isBlockPowered(w, x, y, z)) {
      w.setBlock(x, y, z, B.AIR, 0, false);
      w.host.primeTnt(x, y, z, 80);
    }
    return;
  }
  if (id === B.PISTON || id === B.STICKY_PISTON) {
    const powered = isBlockPowered(w, x, y, z);
    tryPistonMove(w, x, y, z, id, meta, powered);
    return;
  }
  if (BLOCK_OPAQUE[id] === 1) {
    for (let i = 0; i < 6; i++) {
      const [dx, dy, dz] = DIRS_6[i];
      const tx = x + dx;
      const ty = y + dy;
      const tz = z + dz;
      const tv = w.getBlockAndMeta(tx, ty, tz);
      if ((tv & 255) === B.REDSTONE_TORCH) {
        const tm = tv >> 8;
        if (isTorchSupportPowered(w, tx, ty, tz, tm) !== ((tm & 8) !== 0)) {
          w.scheduleTick(tx, ty, tz, 2);
        }
      }
    }
  }
}

const wireQueue: number[] = [];
const wireQueued = new Set<number>();
const touchedPositions = new Set<number>();

function enqueueWireAndNeighbors(w: World, x: number, y: number, z: number): void {
  const k = posKey(x, y, z);
  touchedPositions.add(k);
  if (w.getBlock(x, y, z) === B.REDSTONE_WIRE && !wireQueued.has(k) && wireQueued.size < MAX_REDSTONE_UPDATES) {
    wireQueued.add(k);
    wireQueue.push(k);
  }
}

function enqueueAround(w: World, x: number, y: number, z: number): void {
  enqueueWireAndNeighbors(w, x, y, z);
  for (let i = 0; i < 6; i++) {
    const [dx, dy, dz] = DIRS_6[i];
    enqueueWireAndNeighbors(w, x + dx, y + dy, z + dz);
  }
  for (let i = 0; i < 4; i++) {
    const [dx, dz] = H_DIRS[i];
    enqueueWireAndNeighbors(w, x + dx, y + 1, z + dz);
    enqueueWireAndNeighbors(w, x + dx, y - 1, z + dz);
  }
}

/**
 * Met à jour la propagation du signal redstone autour de (x, y, z),
 * bornée à MAX_REDSTONE_UPDATES nœuds.
 */
export function updateRedstoneAround(w: World, x: number, y: number, z: number): void {
  if (propagating) return;
  propagating = true;
  try {
    wireQueue.length = 0;
    wireQueued.clear();
    touchedPositions.clear();

    enqueueAround(w, x, y, z);
    // Si un bloc solide vient de changer d'état (levier/bouton/plaque dessus), inclure ses voisins
    for (let i = 0; i < 6; i++) {
      const [dx, dy, dz] = DIRS_6[i];
      if (BLOCK_OPAQUE[w.getBlock(x + dx, y + dy, z + dz)] === 1) {
        enqueueAround(w, x + dx, y + dy, z + dz);
      }
    }

    let steps = 0;
    for (let head = 0; head < wireQueue.length && steps < MAX_REDSTONE_UPDATES; head++) {
      const k = wireQueue[head];
      wireQueued.delete(k);
      const wx = posKeyX(k);
      const wy = posKeyY(k);
      const wz = posKeyZ(k);
      if (w.getBlock(wx, wy, wz) !== B.REDSTONE_WIRE) continue;
      steps++;
      const cur = w.getMeta(wx, wy, wz);
      const next = computeWirePower(w, wx, wy, wz);
      if (cur !== next) {
        w.setMeta(wx, wy, wz, next, false);
        enqueueAround(w, wx, wy, wz);
      }
    }

    // Met à jour tous les récepteurs touchés (lampes, torches, portes, pistons, TNT)
    const consumers = Array.from(touchedPositions);
    for (const k of consumers) {
      const cx = posKeyX(k);
      const cy = posKeyY(k);
      const cz = posKeyZ(k);
      updateConsumer(w, cx, cy, cz);
    }
  } finally {
    propagating = false;
  }
}
