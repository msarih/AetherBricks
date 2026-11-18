/**
 * Géométrie des blocs non cubiques : listes de boîtes en seizièmes de bloc (0..16).
 * Les mêmes boîtes servent au rendu, aux collisions et à la sélection.
 * Module pur : partagé avec les workers.
 *
 * Conventions de méta-données :
 *  - direction horizontale (« facing ») : 0 sud (+z), 1 ouest (-x), 2 nord (-z), 3 est (+x)
 *  - bûches / paille : meta & 3 = axe (0 Y, 1 X, 2 Z)
 *  - dalles : 0 basse, 1 haute, 2 double
 *  - escaliers : meta & 3 = direction de la partie haute, meta & 4 = à l'envers
 *  - portes : meta & 3 = direction, & 4 = ouverte, & 8 = moitié haute, & 16 = charnière à droite
 *  - trappes : meta & 3 = direction, & 4 = ouverte, & 8 = moitié haute
 *  - échelles : meta & 3 = direction (le support est derrière)
 *  - torches : 0 = posée au sol, 1..4 = murale (1 + direction)
 *  - portillons : meta & 3 = direction, & 4 = ouvert
 *  - lits : meta & 3 = direction de la tête, & 4 = partie « tête »
 *  - coffres, fourneaux, citrouilles : meta & 3 = direction de la façade
 *  - fluides : 0 = source, 1..7 = niveau d'écoulement, & 8 = chute
 *  - neige : meta & 7 = nombre de couches - 1
 *  - lianes : masque des 4 côtés (bit = direction)
 */
import { B } from './Ids';
import { BLOCK_OPAQUE, BLOCK_SHAPE, SHAPE, FACING_DX, FACING_DZ } from './Blocks';

/** Accès à un voisin relatif : retourne id | (meta << 8). */
export type NeighborFn = (dx: number, dy: number, dz: number) => number;

export const META_DOOR_OPEN = 4;
export const META_DOOR_UPPER = 8;
export const META_DOOR_HINGE_RIGHT = 16;

export function cw(facing: number): number {
  return (facing + 1) & 3;
}
export function ccw(facing: number): number {
  return (facing + 3) & 3;
}
export function opposite(facing: number): number {
  return (facing + 2) & 3;
}

/**
 * Boîte plaquée contre le bord opposé à la direction donnée (convention des portes
 * et trappes de Minecraft), d'épaisseur t.
 */
export function edgeBox(named: number, t: number, y0: number, y1: number, out: number[]): void {
  switch (named & 3) {
    case 0: // sud : bord nord
      out.push(0, y0, 0, 16, y1, t);
      break;
    case 1: // ouest : bord est
      out.push(16 - t, y0, 0, 16, y1, 16);
      break;
    case 2: // nord : bord sud
      out.push(0, y0, 16 - t, 16, y1, 16);
      break;
    default: // est : bord ouest
      out.push(0, y0, 0, t, y1, 16);
      break;
  }
}

/** Direction « nommée » de la boîte d'une porte selon son état. */
export function doorNamedFacing(meta: number): number {
  const facing = meta & 3;
  if (!(meta & META_DOOR_OPEN)) return facing;
  return meta & META_DOOR_HINGE_RIGHT ? ccw(facing) : cw(facing);
}

// ---------------------------------------------------------------------------
// Escaliers
// ---------------------------------------------------------------------------
export const STAIRS_STRAIGHT = 0;
export const STAIRS_INNER_LEFT = 1;
export const STAIRS_INNER_RIGHT = 2;
export const STAIRS_OUTER_LEFT = 3;
export const STAIRS_OUTER_RIGHT = 4;

function isStairsId(id: number): boolean {
  return BLOCK_SHAPE[id] === SHAPE.STAIRS;
}

function canTakeShape(meta: number, n: number): boolean {
  const nid = n & 255;
  if (!isStairsId(nid)) return true;
  const nmeta = n >> 8;
  return (nmeta & 3) !== (meta & 3) || (nmeta & 4) !== (meta & 4);
}

/** Forme d'un escalier selon ses voisins (angles intérieurs / extérieurs). */
export function stairsShape(meta: number, nb: NeighborFn): number {
  const facing = meta & 3;
  const dx = FACING_DX[facing];
  const dz = FACING_DZ[facing];
  const front = nb(dx, 0, dz);
  if (isStairsId(front & 255) && ((front >> 8) & 4) === (meta & 4)) {
    const nf = (front >> 8) & 3;
    if ((nf & 1) !== (facing & 1)) {
      const o = opposite(nf);
      if (canTakeShape(meta, nb(FACING_DX[o], 0, FACING_DZ[o]))) {
        return nf === ccw(facing) ? STAIRS_OUTER_LEFT : STAIRS_OUTER_RIGHT;
      }
    }
  }
  const back = nb(-dx, 0, -dz);
  if (isStairsId(back & 255) && ((back >> 8) & 4) === (meta & 4)) {
    const nf = (back >> 8) & 3;
    if ((nf & 1) !== (facing & 1)) {
      if (canTakeShape(meta, nb(FACING_DX[nf], 0, FACING_DZ[nf]))) {
        return nf === ccw(facing) ? STAIRS_INNER_LEFT : STAIRS_INNER_RIGHT;
      }
    }
  }
  return STAIRS_STRAIGHT;
}

/** Boîtes d'un escalier : une demi-dalle + les quarts de la partie haute. */
export function stairsBoxes(meta: number, nb: NeighborFn, out: number[]): void {
  const facing = meta & 3;
  const upside = (meta & 4) !== 0;
  const shape = stairsShape(meta, nb);
  if (upside) out.push(0, 8, 0, 16, 16, 16);
  else out.push(0, 0, 0, 16, 8, 16);
  const y0 = upside ? 0 : 8;
  const y1 = upside ? 8 : 16;
  const fx = FACING_DX[facing];
  const fz = FACING_DZ[facing];
  const left = ccw(facing);
  const lx = FACING_DX[left];
  const lz = FACING_DZ[left];
  for (let qz = 0; qz < 2; qz++) {
    for (let qx = 0; qx < 2; qx++) {
      const sx = qx * 2 - 1;
      const sz = qz * 2 - 1;
      const isFront = sx * fx + sz * fz > 0;
      const isLeft = sx * lx + sz * lz > 0;
      let on: boolean;
      switch (shape) {
        case STAIRS_OUTER_LEFT:
          on = isFront && isLeft;
          break;
        case STAIRS_OUTER_RIGHT:
          on = isFront && !isLeft;
          break;
        case STAIRS_INNER_LEFT:
          on = isFront || isLeft;
          break;
        case STAIRS_INNER_RIGHT:
          on = isFront || !isLeft;
          break;
        default:
          on = isFront;
      }
      if (on) out.push(qx * 8, y0, qz * 8, qx * 8 + 8, y1, qz * 8 + 8);
    }
  }
}

// ---------------------------------------------------------------------------
// Barrières, vitres
// ---------------------------------------------------------------------------
/** Masque des connexions horizontales (bit = direction) d'une barrière. */
export function fenceConnections(nb: NeighborFn): number {
  let mask = 0;
  for (let f = 0; f < 4; f++) {
    const n = nb(FACING_DX[f], 0, FACING_DZ[f]);
    const id = n & 255;
    if (BLOCK_SHAPE[id] === SHAPE.FENCE || BLOCK_OPAQUE[id]) mask |= 1 << f;
    else if (id === B.FENCE_GATE && (((n >> 8) & 1) !== (f & 1))) mask |= 1 << f;
  }
  return mask;
}

/** Masque des connexions d'une vitre ou de barreaux. */
export function paneConnections(nb: NeighborFn): number {
  let mask = 0;
  for (let f = 0; f < 4; f++) {
    const id = nb(FACING_DX[f], 0, FACING_DZ[f]) & 255;
    if (BLOCK_SHAPE[id] === SHAPE.PANE || BLOCK_OPAQUE[id] || id === B.GLASS || id === B.STAINED_GLASS) mask |= 1 << f;
  }
  return mask;
}

/** Bras d'épaisseur [a, b] partant du centre vers la direction f, entre y0 et y1. */
function arm(f: number, a: number, b: number, y0: number, y1: number, inner: number, out: number[]): void {
  switch (f) {
    case 0:
      out.push(a, y0, 16 - inner, b, y1, 16);
      break;
    case 1:
      out.push(0, y0, a, inner, y1, b);
      break;
    case 2:
      out.push(a, y0, 0, b, y1, inner);
      break;
    default:
      out.push(16 - inner, y0, a, 16, y1, b);
  }
}

export function fenceBoxes(mask: number, out: number[]): void {
  out.push(6, 0, 6, 10, 16, 10);
  for (let f = 0; f < 4; f++) {
    if (!(mask & (1 << f))) continue;
    arm(f, 7, 9, 12, 15, 6, out);
    arm(f, 7, 9, 6, 9, 6, out);
  }
}

export function paneBoxes(mask: number, out: number[]): void {
  out.push(7, 0, 7, 9, 16, 9);
  for (let f = 0; f < 4; f++) {
    if (mask & (1 << f)) arm(f, 7, 9, 0, 16, 7, out);
  }
}

export function fenceGateBoxes(meta: number, out: number[]): void {
  const facing = meta & 3;
  const open = (meta & 4) !== 0;
  const alongX = (facing & 1) === 0; // façade sud/nord : le portillon s'étend le long de X
  const add = (a0: number, y0: number, b0: number, a1: number, y1: number, b1: number) => {
    // a = le long du portillon, b = perpendiculaire
    if (alongX) out.push(a0, y0, b0, a1, y1, b1);
    else out.push(b0, y0, a0, b1, y1, a1);
  };
  // poteaux
  add(0, 5, 7, 2, 16, 9);
  add(14, 5, 7, 16, 16, 9);
  if (!open) {
    add(6, 6, 7, 10, 15, 9);
    add(2, 6, 7, 6, 9, 9);
    add(2, 12, 7, 6, 15, 9);
    add(10, 6, 7, 14, 9, 9);
    add(10, 12, 7, 14, 15, 9);
  } else {
    // battants rabattus dans la direction de la façade
    const sign = facing === 0 || facing === 3 ? 1 : -1;
    const b0 = sign > 0 ? 9 : 1;
    const b1 = sign > 0 ? 15 : 7;
    const e0 = sign > 0 ? 13 : 1;
    const e1 = sign > 0 ? 15 : 3;
    for (const a of [0, 14]) {
      add(a, 6, b0, a + 2, 9, b1);
      add(a, 12, b0, a + 2, 15, b1);
      add(a, 9, e0, a + 2, 12, e1);
    }
  }
}

// ---------------------------------------------------------------------------
// Boîtes de collision et de sélection
// ---------------------------------------------------------------------------
const FULL = [0, 0, 0, 16, 16, 16];

/**
 * Boîtes de collision d'un bloc (seizièmes ; peut dépasser 16 en hauteur pour les barrières).
 * Ne pousse rien pour les blocs traversables.
 */
export function collisionBoxes(id: number, meta: number, nb: NeighborFn, out: number[]): void {
  switch (BLOCK_SHAPE[id]) {
    case SHAPE.NONE:
    case SHAPE.CROSS:
    case SHAPE.CROP:
    case SHAPE.FLUID:
    case SHAPE.LADDER:
    case SHAPE.TORCH:
    case SHAPE.VINE:
    case SHAPE.FIRE:
    case SHAPE.SIGN:
    case SHAPE.CARPET:
      return;
    case SHAPE.BREWING_STAND:
      out.push(1, 0, 1, 15, 2, 15, 7, 0, 7, 9, 14, 9);
      return;
    case SHAPE.REPEATER:
    case SHAPE.COMPARATOR:
      out.push(0, 0, 0, 16, 2, 16);
      return;
    case SHAPE.HOPPER:
      out.push(0, 10, 0, 16, 16, 16, 4, 4, 4, 12, 10, 12, 6, 0, 6, 10, 4, 10);
      return;
    case SHAPE.DAYLIGHT_DETECTOR:
      out.push(0, 0, 0, 16, 6, 16);
      return;
    case SHAPE.CUBE:
      out.push(0, 0, 0, 16, 16, 16);
      return;
    case SHAPE.SLAB:
      if (meta === 2) out.push(0, 0, 0, 16, 16, 16);
      else if (meta === 1) out.push(0, 8, 0, 16, 16, 16);
      else out.push(0, 0, 0, 16, 8, 16);
      return;
    case SHAPE.STAIRS:
      stairsBoxes(meta, nb, out);
      return;
    case SHAPE.FENCE: {
      const mask = fenceConnections(nb);
      out.push(6, 0, 6, 10, 24, 10);
      for (let f = 0; f < 4; f++) if (mask & (1 << f)) arm(f, 6, 10, 0, 24, 6, out);
      return;
    }
    case SHAPE.FENCE_GATE:
      if (meta & 4) return;
      if ((meta & 1) === 0) out.push(0, 0, 6, 16, 24, 10);
      else out.push(6, 0, 0, 10, 24, 16);
      return;
    case SHAPE.DOOR:
      edgeBox(doorNamedFacing(meta), 3, 0, 16, out);
      return;
    case SHAPE.TRAPDOOR:
      if (meta & 4) edgeBox(meta & 3, 3, 0, 16, out);
      else if (meta & 8) out.push(0, 13, 0, 16, 16, 16);
      else out.push(0, 0, 0, 16, 3, 16);
      return;
    case SHAPE.PANE:
      paneBoxes(paneConnections(nb), out);
      return;
    case SHAPE.BED:
      out.push(0, 0, 0, 16, 9, 16);
      return;
    case SHAPE.CHEST:
      out.push(1, 0, 1, 15, 14, 15);
      return;
    case SHAPE.CACTUS:
      out.push(1, 0, 1, 15, 15, 15);
      return;
    case SHAPE.FARMLAND:
      out.push(0, 0, 0, 16, 15, 16);
      return;
    case SHAPE.SNOW_LAYER: {
      // une seule couche ne gêne pas la marche (comme dans Minecraft)
      const layers = (meta & 7) + 1;
      if (layers > 1) out.push(0, 0, 0, 16, (layers - 1) * 2, 16);
      return;
    }
    case SHAPE.LILY_PAD:
      out.push(1, 0, 1, 15, 1.5, 15);
      return;
    case SHAPE.PISTON_HEAD:
      pistonHeadBoxes(meta, out);
      return;
    case SHAPE.END_PORTAL:
      return;
    case SHAPE.END_FRAME:
      out.push(0, 0, 0, 16, 13, 16);
      if (meta & 4) out.push(4, 13, 4, 12, 16, 12);
      return;
    case SHAPE.DRAGON_EGG:
      out.push(1, 0, 1, 15, 16, 15);
      return;
    case SHAPE.CAULDRON:
      for (let i = 0; i < CAULDRON_BOXES.length; i++) out.push(CAULDRON_BOXES[i]);
      return;
    case SHAPE.CAKE: {
      const bites = Math.min(6, meta & 7);
      out.push(1 + bites * 2, 0, 1, 15, 8, 15);
      return;
    }
    case SHAPE.BREWING_STAND:
      out.push(1, 0, 1, 15, 2, 15, 7, 0, 7, 9, 14, 9);
      return;
    case SHAPE.REPEATER:
    case SHAPE.COMPARATOR:
      out.push(0, 0, 0, 16, 2, 16);
      return;
    case SHAPE.HOPPER:
      out.push(0, 10, 0, 16, 16, 16, 4, 4, 4, 12, 10, 12, 6, 0, 6, 10, 4, 10);
      return;
    case SHAPE.DAYLIGHT_DETECTOR:
      out.push(0, 0, 0, 16, 6, 16);
      return;
    default:
      out.push(0, 0, 0, 16, 16, 16);
  }
}

/** Boîtes de la cuve du chaudron : fond + quatre parois de 2/16 (seizièmes). */
export const CAULDRON_BOXES: readonly number[] = [
  0, 0, 0, 16, 4, 16,
  0, 4, 0, 2, 16, 16,
  14, 4, 0, 16, 16, 16,
  2, 4, 0, 14, 16, 2,
  2, 4, 14, 14, 16, 16,
];

/** Boîtes dessinées de l'œuf de dragon, de la base à la pointe (seizièmes). */
export const DRAGON_EGG_BOXES: readonly number[] = [
  3, 0, 3, 13, 1, 13,
  2, 1, 2, 14, 3, 14,
  1, 3, 1, 15, 8, 15,
  2, 8, 2, 14, 11, 14,
  3, 11, 3, 13, 13, 13,
  4, 13, 4, 12, 14, 12,
  5, 14, 5, 11, 15, 11,
  6, 15, 6, 10, 16, 10,
];

function pistonHeadBoxes(meta: number, out: number[]): void {
  const f = meta & 7;
  // Plateau (4/16 d'épaisseur) au bout + tige centrale (4x4)
  switch (f) {
    case 0: // +y
      out.push(0, 12, 0, 16, 16, 16, 6, 0, 6, 10, 12, 10);
      break;
    case 1: // -y
      out.push(0, 0, 0, 16, 4, 16, 6, 4, 6, 10, 16, 10);
      break;
    case 2: // +z
      out.push(0, 0, 12, 16, 16, 16, 6, 6, 0, 10, 10, 12);
      break;
    case 3: // -x
      out.push(0, 0, 0, 4, 16, 16, 4, 6, 6, 16, 10, 10);
      break;
    case 4: // -z
      out.push(0, 0, 0, 16, 16, 4, 6, 6, 4, 10, 10, 16);
      break;
    default: // +x
      out.push(12, 0, 0, 16, 16, 16, 0, 6, 6, 12, 10, 10);
      break;
  }
}

function wallAttachBox(f: number, w: number, h: number, d: number, y0: number, out: number[]): void {
  const x0 = 8 - w / 2;
  const x1 = 8 + w / 2;
  switch (f & 3) {
    case 0: // support au nord (z=0..d)
      out.push(x0, y0, 0, x1, y0 + h, d);
      break;
    case 1: // support à l'est (x=16-d..16)
      out.push(16 - d, y0, x0, 16, y0 + h, x1);
      break;
    case 2: // support au sud (z=16-d..16)
      out.push(x0, y0, 16 - d, x1, y0 + h, 16);
      break;
    default: // support à l'ouest (x=0..d)
      out.push(0, y0, x0, d, y0 + h, x1);
      break;
  }
}

/** Boîtes de sélection (contour affiché et lancer de rayon). */
export function selectionBoxes(id: number, meta: number, nb: NeighborFn, out: number[]): void {
  switch (BLOCK_SHAPE[id]) {
    case SHAPE.NONE:
    case SHAPE.FLUID:
    case SHAPE.END_PORTAL:
      return;
    case SHAPE.CROSS:
      if (id === B.TALL_GRASS || id === B.FERN || id === B.DEAD_BUSH) out.push(2, 0, 2, 14, 13, 14);
      else if (id === B.BROWN_MUSHROOM || id === B.RED_MUSHROOM) out.push(5, 0, 5, 11, 6, 11);
      else if (id === B.SUGAR_CANE) out.push(2, 0, 2, 14, 16, 14);
      else if (id === B.COBWEB) out.push(0, 0, 0, 16, 16, 16);
      else if (id >= B.OAK_SAPLING && id <= B.ACACIA_SAPLING) out.push(2, 0, 2, 14, 12, 14);
      else out.push(5, 0, 5, 11, 10, 11);
      return;
    case SHAPE.CROP:
      out.push(0, 0, 0, 16, 2 + (meta & 7) * 2, 16);
      return;
    case SHAPE.LADDER:
      edgeBox(meta & 3, 3, 0, 16, out);
      return;
    case SHAPE.TORCH: {
      if (meta === 0) {
        out.push(6, 0, 6, 10, 10, 10);
      } else {
        const f = (meta - 1) & 3;
        // torche murale : accrochée au bloc derrière elle
        const cx = 8 - FACING_DX[f] * 5;
        const cz = 8 - FACING_DZ[f] * 5;
        out.push(cx - 2.5, 3, cz - 2.5, cx + 2.5, 13, cz + 2.5);
      }
      return;
    }
    case SHAPE.VINE: {
      let any = false;
      for (let f = 0; f < 4; f++) {
        if (meta & (1 << f)) {
          edgeBox(opposite(f), 1, 0, 16, out);
          any = true;
        }
      }
      if (!any) out.push(0, 15, 0, 16, 16, 16);
      return;
    }
    case SHAPE.FIRE:
      out.push(0, 0, 0, 16, 16, 16);
      return;
    case SHAPE.FENCE: {
      const mask = fenceConnections(nb);
      out.push(6, 0, 6, 10, 16, 10);
      for (let f = 0; f < 4; f++) if (mask & (1 << f)) arm(f, 6, 10, 0, 16, 6, out);
      return;
    }
    case SHAPE.FENCE_GATE:
      if ((meta & 1) === 0) out.push(0, 0, 6, 16, 16, 10);
      else out.push(6, 0, 0, 10, 16, 16);
      return;
    case SHAPE.SNOW_LAYER:
      out.push(0, 0, 0, 16, ((meta & 7) + 1) * 2, 16);
      return;
    case SHAPE.REDSTONE_WIRE:
      out.push(0, 0, 0, 16, 1, 16);
      return;
    case SHAPE.RAIL:
      out.push(0, 0, 0, 16, 2, 16);
      return;
    case SHAPE.PRESSURE_PLATE:
      out.push(1, 0, 1, 15, meta & 1 ? 0.5 : 1, 15);
      return;
    case SHAPE.BUTTON: {
      const d = meta & 8 ? 1 : 2;
      const side = meta & 7;
      if (side === 0) out.push(5, 0, 6, 11, d, 10);
      else wallAttachBox((side - 1) & 3, 6, 4, d, 6, out);
      return;
    }
    case SHAPE.LEVER: {
      const side = meta & 7;
      if (side === 0) out.push(5, 0, 4, 11, 3, 12);
      else wallAttachBox((side - 1) & 3, 6, 8, 3, 4, out);
      return;
    }
    case SHAPE.PORTAL:
      if (meta & 1) out.push(6, 0, 0, 10, 16, 16);
      else out.push(0, 0, 6, 16, 16, 10);
      return;
    case SHAPE.SIGN:
      // panneau mural : planche de 2/16 contre le mur, entre 4,5 et 12,5 de haut ; sur poteau : boîte centrale
      if (id === B.WALL_SIGN) edgeBox(meta & 3, 2, 4.5, 12.5, out);
      else out.push(4, 0, 4, 12, 16, 12);
      return;
    case SHAPE.BREWING_STAND:
      out.push(1, 0, 1, 15, 2, 15, 7, 0, 7, 9, 14, 9);
      return;
    case SHAPE.REPEATER:
    case SHAPE.COMPARATOR:
      out.push(0, 0, 0, 16, 2, 16);
      return;
    case SHAPE.HOPPER:
      out.push(0, 10, 0, 16, 16, 16, 4, 4, 4, 12, 10, 12, 6, 0, 6, 10, 4, 10);
      return;
    case SHAPE.DAYLIGHT_DETECTOR:
      out.push(0, 0, 0, 16, 6, 16);
      return;
    case SHAPE.CUBE:
      out.push(0, 0, 0, 16, 16, 16);
      return;
    default:
      collisionBoxes(id, meta, nb, out);
      if (out.length === 0) out.push(...FULL);
  }
}

/** Hauteur de la surface d'un fluide (0..1) selon son niveau. */
export function fluidHeight(meta: number): number {
  if (meta & 8) return 1;
  const level = meta & 7;
  return (8 - level) / 9;
}
