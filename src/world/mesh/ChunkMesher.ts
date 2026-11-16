/**
 * Éclairage et maillage d'un chunk.
 *
 * Le calcul est sans état : à chaque demande, la lumière du voisinage 3×3 est
 * recalculée entièrement (ciel + blocs), puis le chunk central est maillé avec
 * occlusion ambiante et lumière lissée. Module pur : tourne dans un worker.
 */
import { B } from '../Ids';
import { T, type TileName } from '../Tiles';
import { FACE_DOWN, FACE_EAST, FACE_NORTH, FACE_SOUTH, FACE_UP, FACE_WEST } from '../Constants';
import {
  BLOCKS, BLOCK_AO, BLOCK_EMIT, BLOCK_LIGHT_OPACITY, BLOCK_NEIGHBOR_LIGHT, BLOCK_OPAQUE, BLOCK_SHAPE, BLOCK_SOLID,
  BLOCK_TILES, BLOCK_TRANSLUCENT, FACING_DX, FACING_DZ, FACING_TO_FACE, ROT, SHAPE, TINT, faceTile, isLeaves,
} from '../Blocks';
import {
  META_DOOR_HINGE_RIGHT, META_DOOR_UPPER, ccw, cw, doorNamedFacing, edgeBox, fenceBoxes, fenceConnections,
  fenceGateBoxes, fluidHeight, opposite, paneConnections, stairsBoxes, type NeighborFn,
} from '../BlockModels';
import type { MeshRequest, MeshResult, PassData } from './MeshTypes';

// ---------------------------------------------------------------------------
// Région de travail : 3×3 chunks + une bordure d'une cellule
// ---------------------------------------------------------------------------
const RW = 50;
const SZ = RW;
const SY = RW * RW;
const RH = 132;
const STRIDE = [1, SY, SZ]; // pas par axe : x, y, z

const rid = new Uint8Array(SY * RH);
const rmeta = new Uint8Array(SY * RH);
const rsky = new Uint8Array(SY * RH);
const rblk = new Uint8Array(SY * RH);
const colH = new Int16Array(SY);

/** Décalage d'index vers le voisin de chaque face. */
const NOFF = [SY, -SY, -SZ, SZ, -1, 1];

const buckets: Int32Array[] = [];
const counts = new Int32Array(16);
for (let l = 0; l < 16; l++) buckets.push(new Int32Array(4096));

function push(level: number, i: number): void {
  let b = buckets[level];
  const n = counts[level];
  if (n === b.length) {
    const g = new Int32Array(n * 2);
    g.set(b);
    buckets[level] = b = g;
  }
  b[n] = i;
  counts[level] = n + 1;
}

/** Propagation en largeur, par niveaux décroissants. */
function propagate(light: Uint8Array): void {
  for (let L = 15; L >= 2; L--) {
    const b = buckets[L];
    const n = counts[L];
    for (let q = 0; q < n; q++) {
      const i = b[q];
      if (light[i] !== L) continue;
      for (let f = 0; f < 6; f++) {
        const j = i + NOFF[f];
        const op = BLOCK_LIGHT_OPACITY[rid[j]];
        const nl = L - (op > 1 ? op : 1);
        if (nl > light[j]) {
          light[j] = nl;
          if (nl > 1) push(nl, j);
        }
      }
    }
    counts[L] = 0;
  }
  counts[1] = 0;
  counts[0] = 0;
}

const emitters: number[] = [];
const neighborLit: number[] = [];

function fillRegion(blocks: Array<Uint8Array | null>, metas: Array<Uint8Array | null>, top: number): void {
  const n = (top + 3) * SY;
  rid.fill(B.BEDROCK, 0, n);
  rmeta.fill(0, 0, n);
  rsky.fill(0, 0, n);
  rblk.fill(0, 0, n);
  emitters.length = 0;
  neighborLit.length = 0;
  for (let ry = 1; ry <= top + 1; ry++) {
    for (let rz = 1; rz <= 48; rz++) {
      const base = ry * SY + rz * SZ;
      rid.fill(0, base + 1, base + 49);
    }
  }
  for (let k = 0; k < 9; k++) {
    const bl = blocks[k];
    const me = metas[k];
    if (!bl || !me) continue;
    const ox = (k % 3) * 16 + 1;
    const oz = ((k / 3) | 0) * 16 + 1;
    const layers = Math.min(top, bl.length >> 8);
    for (let y = 0; y < layers; y++) {
      for (let z = 0; z < 16; z++) {
        let src = (y << 8) | (z << 4);
        let dst = (y + 1) * SY + (oz + z) * SZ + ox;
        for (let x = 0; x < 16; x++, src++, dst++) {
          const id = bl[src];
          if (id === 0) continue;
          rid[dst] = id;
          rmeta[dst] = me[src];
          if (BLOCK_EMIT[id]) emitters.push(dst);
          if (BLOCK_NEIGHBOR_LIGHT[id]) neighborLit.push(dst);
        }
      }
    }
  }
}

function computeLight(top: number): void {
  // --- Ciel : descente directe par colonne ---
  colH.fill(0);
  for (let rz = 1; rz <= 48; rz++) {
    for (let rx = 1; rx <= 48; rx++) {
      const c = rz * SZ + rx;
      let i = (top + 1) * SY + c;
      rsky[i] = 15;
      let ry = top;
      i -= SY;
      while (ry > 0 && BLOCK_LIGHT_OPACITY[rid[i]] === 0) {
        rsky[i] = 15;
        i -= SY;
        ry--;
      }
      colH[c] = ry;
      if (ry > 0) {
        const op = BLOCK_LIGHT_OPACITY[rid[i]];
        if (op < 15) {
          rsky[i] = 15 - op;
          push(15 - op, i);
        }
      }
    }
  }
  // Graines latérales : cellules à ciel ouvert bordant une colonne plus haute
  for (let rz = 1; rz <= 48; rz++) {
    for (let rx = 1; rx <= 48; rx++) {
      const c = rz * SZ + rx;
      let m = colH[c - 1];
      if (colH[c + 1] > m) m = colH[c + 1];
      if (colH[c - SZ] > m) m = colH[c - SZ];
      if (colH[c + SZ] > m) m = colH[c + SZ];
      if (m > top) m = top;
      for (let ry = colH[c] + 1; ry <= m; ry++) push(15, ry * SY + c);
    }
  }
  propagate(rsky);

  // --- Lumière des blocs ---
  for (let q = 0; q < emitters.length; q++) {
    const i = emitters[q];
    const e = BLOCK_EMIT[rid[i]];
    rblk[i] = e;
    push(e, i);
  }
  propagate(rblk);

  // --- Dalles, escaliers, terre labourée : éclairés par leurs voisins ---
  for (let q = 0; q < neighborLit.length; q++) {
    const i = neighborLit[q];
    let s = 0;
    let b = 0;
    for (let f = 0; f < 6; f++) {
      const j = i + NOFF[f];
      if (BLOCK_NEIGHBOR_LIGHT[rid[j]]) continue;
      if (rsky[j] > s) s = rsky[j];
      if (rblk[j] > b) b = rblk[j];
    }
    rsky[i] = s;
    rblk[i] = b;
  }
}

// ---------------------------------------------------------------------------
// Constructeur de passe (tableaux extensibles réutilisés)
// ---------------------------------------------------------------------------
class PassBuilder {
  pos = new Float32Array(3 * 16384);
  uv = new Float32Array(4 * 16384);
  col = new Uint8Array(4 * 16384);
  lit = new Uint8Array(4 * 16384);
  idx = new Uint32Array(6 * 16384);
  nv = 0;
  ni = 0;

  reset(): void {
    this.nv = 0;
    this.ni = 0;
  }

  ensure(v: number, n: number): void {
    if ((this.nv + v) * 4 > this.uv.length) {
      const cap = this.uv.length / 2; // double la capacité en sommets
      const pos = new Float32Array(cap * 3);
      pos.set(this.pos);
      this.pos = pos;
      const uv = new Float32Array(cap * 4);
      uv.set(this.uv);
      this.uv = uv;
      const col = new Uint8Array(cap * 4);
      col.set(this.col);
      this.col = col;
      const lit = new Uint8Array(cap * 4);
      lit.set(this.lit);
      this.lit = lit;
    }
    if (this.ni + n > this.idx.length) {
      const idx = new Uint32Array(this.idx.length * 2);
      idx.set(this.idx);
      this.idx = idx;
    }
  }

  finish(): PassData | null {
    if (this.nv === 0) return null;
    return {
      positions: this.pos.slice(0, this.nv * 3),
      uvs: this.uv.slice(0, this.nv * 4),
      colors: this.col.slice(0, this.nv * 4),
      lights: this.lit.slice(0, this.nv * 4),
      indices: this.idx.slice(0, this.ni),
    };
  }
}

const opaquePass = new PassBuilder();
const translucentPass = new PassBuilder();

// ---------------------------------------------------------------------------
// Tables géométriques
// ---------------------------------------------------------------------------
/** Coins de chaque face, sens anti-horaire vu de l'extérieur. */
const FC = [
  0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, // haut
  0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, // bas
  1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, // nord
  0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, // sud
  0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, // ouest
  1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, // est
];
const FACE_AXIS = [1, 1, 2, 2, 0, 0];
const FACE_SHADE = [1.0, 0.5, 0.8, 0.8, 0.6, 0.6];
const AO_FACTOR = [0.5, 0.67, 0.83, 1.0];
/** Direction horizontale correspondant à une face latérale. */
const FACE_TO_FACING = [0, 0, 2, 0, 1, 3];
/** La coordonnée u par défaut croît-elle avec la coordonnée du monde ? */
const FACE_U_PLUS = [true, true, false, true, true, false];

function faceU(f: number, x: number, y: number, z: number): number {
  switch (f) {
    case FACE_UP:
    case FACE_DOWN:
    case FACE_SOUTH:
      return x;
    case FACE_NORTH:
      return 1 - x;
    case FACE_WEST:
      return z;
    default:
      return 1 - z;
  }
}

function faceV(f: number, x: number, y: number, z: number): number {
  if (f === FACE_UP) return z;
  if (f === FACE_DOWN) return 1 - z;
  return 1 - y;
}

const FUV = new Float32Array(48);
const AO1 = new Int32Array(24);
const AO2 = new Int32Array(24);
const AOC = new Int32Array(24);
for (let f = 0; f < 6; f++) {
  const axis = FACE_AXIS[f];
  const t1 = (axis + 1) % 3;
  const t2 = (axis + 2) % 3;
  for (let k = 0; k < 4; k++) {
    const o = f * 12 + k * 3;
    FUV[f * 8 + k * 2] = faceU(f, FC[o], FC[o + 1], FC[o + 2]);
    FUV[f * 8 + k * 2 + 1] = faceV(f, FC[o], FC[o + 1], FC[o + 2]);
    const s1 = (FC[o + t1] ? 1 : -1) * STRIDE[t1];
    const s2 = (FC[o + t2] ? 1 : -1) * STRIDE[t2];
    AO1[f * 4 + k] = s1;
    AO2[f * 4 + k] = s2;
    AOC[f * 4 + k] = s1 + s2;
  }
}

// État du quad en cours de construction
const P = new Float32Array(12);
const UV = new Float32Array(8);
const SH = new Float32Array(4);
const LS = new Float32Array(4);
const LB = new Float32Array(4);
// Lumière lissée des 4 coins d'une face entière
const CS = new Float32Array(4);
const CB = new Float32Array(4);
const CA = new Float32Array(4);
const LX = new Float32Array(4);
const LY = new Float32Array(4);
const LZ = new Float32Array(4);

// État de la cellule en cours
let cI = 0;
let cX = 0;
let cY = 0;
let cZ = 0;
let qR = 255;
let qG = 255;
let qB = 255;
let fancy = true;
let smooth = true;
let tints: Uint8Array = new Uint8Array(256 * 9);
let baseX = 0;
let baseZ = 0;

const nb: NeighborFn = (dx, dy, dz) => {
  const j = cI + dx + dy * SY + dz * SZ;
  return rid[j] | (rmeta[j] << 8);
};

function setTint(kind: number): void {
  const o = (cZ * 16 + cX) * 9 + kind * 3;
  qR = tints[o];
  qG = tints[o + 1];
  qB = tints[o + 2];
}

function setColor(c: number): void {
  qR = (c >> 16) & 255;
  qG = (c >> 8) & 255;
  qB = c & 255;
}

function noTint(): void {
  qR = 255;
  qG = 255;
  qB = 255;
}

/** Écrit le quad courant dans une passe. */
function emit(p: PassBuilder, layer: number, overlay: number, flag: number, dbl: boolean): void {
  p.ensure(4, 12);
  const v0 = p.nv;
  const pos = p.pos;
  const uv = p.uv;
  const col = p.col;
  const lit = p.lit;
  let o3 = v0 * 3;
  let o4 = v0 * 4;
  for (let k = 0; k < 4; k++) {
    pos[o3] = P[k * 3];
    pos[o3 + 1] = P[k * 3 + 1];
    pos[o3 + 2] = P[k * 3 + 2];
    uv[o4] = UV[k * 2];
    uv[o4 + 1] = UV[k * 2 + 1];
    uv[o4 + 2] = layer;
    uv[o4 + 3] = overlay;
    col[o4] = qR;
    col[o4 + 1] = qG;
    col[o4 + 2] = qB;
    col[o4 + 3] = SH[k] * 255 + 0.5;
    lit[o4] = LS[k] * 17 + 0.5;
    lit[o4 + 1] = LB[k] * 17 + 0.5;
    lit[o4 + 2] = flag;
    lit[o4 + 3] = 0;
    o3 += 3;
    o4 += 4;
  }
  p.nv = v0 + 4;
  const b0 = SH[0] * ((LS[0] > LB[0] ? LS[0] : LB[0]) + 3);
  const b1 = SH[1] * ((LS[1] > LB[1] ? LS[1] : LB[1]) + 3);
  const b2 = SH[2] * ((LS[2] > LB[2] ? LS[2] : LB[2]) + 3);
  const b3 = SH[3] * ((LS[3] > LB[3] ? LS[3] : LB[3]) + 3);
  const idx = p.idx;
  let n = p.ni;
  if (b0 + b2 < b1 + b3) {
    idx[n++] = v0 + 1;
    idx[n++] = v0 + 2;
    idx[n++] = v0 + 3;
    idx[n++] = v0 + 1;
    idx[n++] = v0 + 3;
    idx[n++] = v0;
    if (dbl) {
      idx[n++] = v0 + 3;
      idx[n++] = v0 + 2;
      idx[n++] = v0 + 1;
      idx[n++] = v0;
      idx[n++] = v0 + 3;
      idx[n++] = v0 + 1;
    }
  } else {
    idx[n++] = v0;
    idx[n++] = v0 + 1;
    idx[n++] = v0 + 2;
    idx[n++] = v0;
    idx[n++] = v0 + 2;
    idx[n++] = v0 + 3;
    if (dbl) {
      idx[n++] = v0 + 2;
      idx[n++] = v0 + 1;
      idx[n++] = v0;
      idx[n++] = v0 + 3;
      idx[n++] = v0 + 2;
      idx[n++] = v0;
    }
  }
  p.ni = n;
}

/** Lumière lissée et occlusion ambiante des 4 coins de la face f de la cellule i. */
function cornerLight(i: number, f: number): void {
  const F = i + NOFF[f];
  const fs = rsky[F];
  const fb = rblk[F];
  if (!smooth) {
    CS[0] = CS[1] = CS[2] = CS[3] = fs;
    CB[0] = CB[1] = CB[2] = CB[3] = fb;
    CA[0] = CA[1] = CA[2] = CA[3] = 1;
    return;
  }
  for (let k = 0; k < 4; k++) {
    const a = F + AO1[f * 4 + k];
    const b = F + AO2[f * 4 + k];
    const c = F + AOC[f * 4 + k];
    const ia = rid[a];
    const ib = rid[b];
    const ic = rid[c];
    const s1 = BLOCK_AO[ia];
    const s2 = BLOCK_AO[ib];
    const ao = s1 & s2 ? 0 : 3 - s1 - s2 - BLOCK_AO[ic];
    const oa = BLOCK_OPAQUE[ia];
    const ob = BLOCK_OPAQUE[ib];
    const oc = BLOCK_OPAQUE[ic] | (oa & ob);
    CS[k] = (fs + (oa ? fs : rsky[a]) + (ob ? fs : rsky[b]) + (oc ? fs : rsky[c])) * 0.25;
    CB[k] = (fb + (oa ? fb : rblk[a]) + (ob ? fb : rblk[b]) + (oc ? fb : rblk[c])) * 0.25;
    CA[k] = AO_FACTOR[ao];
  }
}

function flatLight(shade: number): void {
  const s = rsky[cI];
  const b = rblk[cI];
  for (let k = 0; k < 4; k++) {
    SH[k] = shade;
    LS[k] = s;
    LB[k] = b;
  }
}

function fullLight(): void {
  for (let k = 0; k < 4; k++) {
    SH[k] = 1;
    LS[k] = 15;
    LB[k] = 15;
  }
}

/** Face entière d'un cube. */
function cubeFace(p: PassBuilder, f: number, tileRot: number, overlay: number, flag: number): void {
  cornerLight(cI, f);
  const fc = f * 12;
  const fu = f * 8;
  const rot = tileRot >> 16;
  const shade = FACE_SHADE[f];
  for (let k = 0; k < 4; k++) {
    P[k * 3] = cX + FC[fc + k * 3];
    P[k * 3 + 1] = cY + FC[fc + k * 3 + 1];
    P[k * 3 + 2] = cZ + FC[fc + k * 3 + 2];
    let u = FUV[fu + k * 2];
    let v = FUV[fu + k * 2 + 1];
    if (rot) {
      const t = u;
      u = v;
      v = 1 - t;
    }
    UV[k * 2] = u;
    UV[k * 2 + 1] = v;
    SH[k] = shade * CA[k];
    LS[k] = CS[k];
    LB[k] = CB[k];
  }
  emit(p, tileRot & 0xffff, overlay, flag, false);
}

/**
 * Face d'une boîte (coordonnées locales 0..1). Les faces plaquées contre un voisin
 * opaque sont supprimées ; les autres reçoivent la lumière lissée de la cellule voisine.
 */
function boxFace(
  p: PassBuilder, f: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  tile: number, rot: number, mirror: boolean, flag: number,
): void {
  const nOpaque = BLOCK_OPAQUE[rid[cI + NOFF[f]]];
  if (nOpaque) {
    let boundary: boolean;
    switch (f) {
      case FACE_UP: boundary = y1 >= 1; break;
      case FACE_DOWN: boundary = y0 <= 0; break;
      case FACE_NORTH: boundary = z0 <= 0; break;
      case FACE_SOUTH: boundary = z1 >= 1; break;
      case FACE_WEST: boundary = x0 <= 0; break;
      default: boundary = x1 >= 1;
    }
    if (boundary) return;
  }
  const fc = f * 12;
  for (let k = 0; k < 4; k++) {
    const lx = FC[fc + k * 3] ? x1 : x0;
    const ly = FC[fc + k * 3 + 1] ? y1 : y0;
    const lz = FC[fc + k * 3 + 2] ? z1 : z0;
    P[k * 3] = cX + lx;
    P[k * 3 + 1] = cY + ly;
    P[k * 3 + 2] = cZ + lz;
    let u = faceU(f, lx, ly, lz);
    let v = faceV(f, lx, ly, lz);
    if (mirror) u = 1 - u;
    for (let r = 0; r < rot; r++) {
      const t = u;
      u = v;
      v = 1 - t;
    }
    UV[k * 2] = u;
    UV[k * 2 + 1] = v;
    LX[k] = lx < 0 ? 0 : lx > 1 ? 1 : lx;
    LY[k] = ly < 0 ? 0 : ly > 1 ? 1 : ly;
    LZ[k] = lz < 0 ? 0 : lz > 1 ? 1 : lz;
  }
  const shade = FACE_SHADE[f];
  if (nOpaque) {
    flatLight(shade);
  } else {
    cornerLight(cI, f);
    const axis = FACE_AXIS[f];
    for (let k = 0; k < 4; k++) {
      let s = 0;
      let b = 0;
      let a = 0;
      for (let j = 0; j < 4; j++) {
        let w = 1;
        if (axis !== 0) w *= FC[fc + j * 3] ? LX[k] : 1 - LX[k];
        if (axis !== 1) w *= FC[fc + j * 3 + 1] ? LY[k] : 1 - LY[k];
        if (axis !== 2) w *= FC[fc + j * 3 + 2] ? LZ[k] : 1 - LZ[k];
        s += CS[j] * w;
        b += CB[j] * w;
        a += CA[j] * w;
      }
      SH[k] = shade * a;
      LS[k] = s;
      LB[k] = b;
    }
  }
  emit(p, tile, -1, flag, false);
}

/** Les 6 faces d'une boîte en seizièmes, avec les tuiles standard du bloc. */
function boxAll(p: PassBuilder, id: number, bx: number[], o: number, flag: number, skipFace: number): void {
  const x0 = bx[o] / 16;
  const y0 = bx[o + 1] / 16;
  const z0 = bx[o + 2] / 16;
  const x1 = bx[o + 3] / 16;
  const y1 = bx[o + 4] / 16;
  const z1 = bx[o + 5] / 16;
  for (let f = 0; f < 6; f++) {
    if (f === skipFace) continue;
    boxFace(p, f, x0, y0, z0, x1, y1, z1, BLOCK_TILES[id * 6 + f], 0, false, flag);
  }
}

function quad(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  ex: number, ey: number, ez: number, dx: number, dy: number, dz: number,
): void {
  P[0] = cX + ax; P[1] = cY + ay; P[2] = cZ + az;
  P[3] = cX + bx; P[4] = cY + by; P[5] = cZ + bz;
  P[6] = cX + ex; P[7] = cY + ey; P[8] = cZ + ez;
  P[9] = cX + dx; P[10] = cY + dy; P[11] = cZ + dz;
}

/** UV d'un quad « bas-gauche, bas-droite, haut-droite, haut-gauche ». */
function uvRect(u0: number, v0: number, u1: number, v1: number): void {
  UV[0] = u0; UV[1] = v1;
  UV[2] = u1; UV[3] = v1;
  UV[4] = u1; UV[5] = v0;
  UV[6] = u0; UV[7] = v0;
}

/** Plan parallèle à la face f, enfoncé de `depth` dans la cellule, avec la tuile entière. */
function planeQuad(f: number, depth: number): void {
  const fc = f * 12;
  const axis = FACE_AXIS[f];
  for (let k = 0; k < 4; k++) {
    let lx: number = FC[fc + k * 3];
    let ly: number = FC[fc + k * 3 + 1];
    let lz: number = FC[fc + k * 3 + 2];
    UV[k * 2] = faceU(f, lx, ly, lz);
    UV[k * 2 + 1] = faceV(f, lx, ly, lz);
    if (axis === 0) lx = lx ? 1 - depth : depth;
    else if (axis === 1) ly = ly ? 1 - depth : depth;
    else lz = lz ? 1 - depth : depth;
    P[k * 3] = cX + lx;
    P[k * 3 + 1] = cY + ly;
    P[k * 3 + 2] = cZ + lz;
  }
}

function hash2i(x: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------------------------------------------------------------------------
// Formes
// ---------------------------------------------------------------------------
const NOMIP = 255;
const tmpBoxes: number[] = [];

function meshCube(id: number, meta: number): void {
  const d = BLOCKS[id];
  const opaque = BLOCK_OPAQUE[id];
  const leaves = isLeaves(id);
  const p = BLOCK_TRANSLUCENT[id] ? translucentPass : opaquePass;
  const flag = !opaque && !leaves && !BLOCK_TRANSLUCENT[id] ? NOMIP : 0;
  const keepSame = leaves && fancy;
  const rotated = d.rot !== ROT.NONE;
  if (id === B.GRASS) {
    const above = rid[cI + SY];
    const snowy = above === B.SNOW_LAYER || above === B.SNOW_BLOCK;
    for (let f = 0; f < 6; f++) {
      if (BLOCK_OPAQUE[rid[cI + NOFF[f]]]) continue;
      if (f === FACE_UP) {
        setTint(0);
        cubeFace(p, f, d.tiles[f], -1, 0);
      } else if (f === FACE_DOWN) {
        noTint();
        cubeFace(p, f, d.tiles[f], -1, 0);
      } else if (snowy) {
        noTint();
        cubeFace(p, f, T.grass_side_snowed, -1, 0);
      } else {
        setTint(0);
        cubeFace(p, f, d.tiles[f], d.sideOverlay, 0);
      }
    }
    return;
  }
  if (d.tint === TINT.FOLIAGE) setTint(1);
  else if (d.tint === TINT.GRASS) setTint(0);
  else if (d.tint === TINT.FIXED) setColor(d.tintColor);
  else noTint();
  for (let f = 0; f < 6; f++) {
    const nid = rid[cI + NOFF[f]];
    if (BLOCK_OPAQUE[nid]) continue;
    if (nid === id && !opaque && !keepSame) continue;
    cubeFace(p, f, rotated ? faceTile(id, meta, f) : BLOCK_TILES[id * 6 + f], -1, flag);
  }
}

function fluidCorner(id: number, i: number): number {
  // i : cellule dont le coin (x min, z min) est le coin recherché
  let total = 0;
  let weight = 0;
  for (let k = 0; k < 4; k++) {
    const j = i - (k & 1) - (k >> 1) * SZ;
    const nid = rid[j];
    if (nid === id) {
      if (rid[j + SY] === id) return 1;
      const m = rmeta[j];
      const h = fluidHeight(m);
      if (m & 8 || (m & 7) === 0) {
        total += h * 10;
        weight += 10;
      } else {
        total += h;
        weight += 1;
      }
    } else if (!BLOCK_SOLID[nid]) {
      weight += 1;
    }
  }
  return weight > 0 ? total / weight : 0;
}

function meshFluid(id: number): void {
  const water = id === B.WATER;
  const p = water ? translucentPass : opaquePass;
  const tile = BLOCK_TILES[id * 6];
  if (water) setTint(2);
  else noTint();
  const aboveId = rid[cI + SY];
  let h00 = 1;
  let h10 = 1;
  let h01 = 1;
  let h11 = 1;
  if (aboveId !== id) {
    h00 = fluidCorner(id, cI);
    h10 = fluidCorner(id, cI + 1);
    h01 = fluidCorner(id, cI + SZ);
    h11 = fluidCorner(id, cI + SZ + 1);
    // dessus
    quad(0, h01, 1, 1, h11, 1, 1, h10, 0, 0, h00, 0);
    uvRect(0, 0, 1, 1);
    if (!water) fullLight();
    else if (BLOCK_OPAQUE[aboveId]) flatLight(1);
    else {
      cornerLight(cI, FACE_UP);
      for (let k = 0; k < 4; k++) {
        SH[k] = CA[k];
        LS[k] = CS[k];
        LB[k] = CB[k];
      }
    }
    emit(p, tile, -1, 0, water);
  }
  // dessous
  const belowId = rid[cI - SY];
  if (belowId !== id && !BLOCK_OPAQUE[belowId]) {
    boxFace(p, FACE_DOWN, 0, 0, 0, 1, 1, 1, tile, 0, false, 0);
  }
  // côtés
  for (let f = 2; f < 6; f++) {
    const nid = rid[cI + NOFF[f]];
    if (nid === id || BLOCK_OPAQUE[nid]) continue;
    let ha: number;
    let hb: number;
    switch (f) {
      case FACE_NORTH:
        ha = h00; hb = h10;
        quad(1, 0, 0, 0, 0, 0, 0, ha, 0, 1, hb, 0);
        break;
      case FACE_SOUTH:
        ha = h11; hb = h01;
        quad(0, 0, 1, 1, 0, 1, 1, ha, 1, 0, hb, 1);
        break;
      case FACE_WEST:
        ha = h01; hb = h00;
        quad(0, 0, 0, 0, 0, 1, 0, ha, 1, 0, hb, 0);
        break;
      default:
        ha = h10; hb = h11;
        quad(1, 0, 1, 1, 0, 0, 1, ha, 0, 1, hb, 1);
    }
    UV[0] = 0; UV[1] = 1;
    UV[2] = 1; UV[3] = 1;
    UV[4] = 1; UV[5] = 1 - ha;
    UV[6] = 0; UV[7] = 1 - hb;
    if (!water) fullLight();
    else {
      cornerLight(cI, f);
      const shade = FACE_SHADE[f];
      for (let k = 0; k < 4; k++) {
        SH[k] = shade * CA[k];
        LS[k] = CS[k];
        LB[k] = CB[k];
      }
    }
    emit(p, tile, -1, 0, water);
  }
}

function crossQuads(tile: number, ox: number, oy: number, oz: number): void {
  const a = 0.05;
  const b = 0.95;
  quad(a + ox, oy, a + oz, b + ox, oy, b + oz, b + ox, 1 + oy, b + oz, a + ox, 1 + oy, a + oz);
  uvRect(0, 0, 1, 1);
  emit(opaquePass, tile, -1, NOMIP, true);
  quad(a + ox, oy, b + oz, b + ox, oy, a + oz, b + ox, 1 + oy, a + oz, a + ox, 1 + oy, b + oz);
  uvRect(0, 0, 1, 1);
  emit(opaquePass, tile, -1, NOMIP, true);
}

function meshCross(id: number): void {
  const d = BLOCKS[id];
  if (d.tint === TINT.GRASS) setTint(0);
  else noTint();
  flatLight(1);
  let ox = 0;
  let oy = 0;
  let oz = 0;
  if (id === B.TALL_GRASS || id === B.FERN || (id >= B.DANDELION && id <= B.CORNFLOWER)) {
    const h = hash2i(baseX + cX, baseZ + cZ);
    ox = ((h & 15) / 15 - 0.5) * 0.5;
    oz = (((h >> 4) & 15) / 15 - 0.5) * 0.5;
    if (id === B.TALL_GRASS || id === B.FERN) oy = -(((h >> 8) & 15) / 15) * 0.2;
  }
  crossQuads(d.tiles[FACE_NORTH], ox, oy, oz);
}

const WHEAT_TILES: number[] = [];
const CARROT_TILES: number[] = [];
const POTATO_TILES: number[] = [];
const ROOT_STAGE = [0, 0, 1, 1, 2, 2, 2, 3];
for (let s = 0; s < 8; s++) {
  WHEAT_TILES.push(T[`wheat_${s}` as TileName]);
  CARROT_TILES.push(T[`carrots_${ROOT_STAGE[s]}` as TileName]);
  POTATO_TILES.push(T[`potatoes_${ROOT_STAGE[s]}` as TileName]);
}

function meshCrop(id: number, meta: number): void {
  const stage = meta & 7;
  const tile = id === B.WHEAT ? WHEAT_TILES[stage] : id === B.CARROTS ? CARROT_TILES[stage] : POTATO_TILES[stage];
  noTint();
  flatLight(1);
  const lo = -1 / 16;
  const hi = 15 / 16;
  for (const c of [4 / 16, 12 / 16]) {
    quad(c, lo, 0, c, lo, 1, c, hi, 1, c, hi, 0);
    uvRect(0, 0, 1, 1);
    emit(opaquePass, tile, -1, NOMIP, true);
    quad(0, lo, c, 1, lo, c, 1, hi, c, 0, hi, c);
    uvRect(0, 0, 1, 1);
    emit(opaquePass, tile, -1, NOMIP, true);
  }
}

function meshTorch(meta: number): void {
  const tile = T.torch;
  noTint();
  flatLight(1);
  let bx = 0.5;
  let bz = 0.5;
  let tx = 0.5;
  let tz = 0.5;
  let y0 = 0;
  let y1 = 1;
  if (meta > 0) {
    const f = (meta - 1) & 3;
    bx = 0.5 - FACING_DX[f] * 0.5;
    bz = 0.5 - FACING_DZ[f] * 0.5;
    tx = 0.5 - FACING_DX[f] * 0.1;
    tz = 0.5 - FACING_DZ[f] * 0.1;
    y0 = 0.2;
    y1 = 1.2;
  }
  const e = 1 / 16;
  quad(bx - e, y0, bz - 0.5, bx - e, y0, bz + 0.5, tx - e, y1, tz + 0.5, tx - e, y1, tz - 0.5);
  uvRect(0, 0, 1, 1);
  emit(opaquePass, tile, -1, NOMIP, false);
  quad(bx + e, y0, bz + 0.5, bx + e, y0, bz - 0.5, tx + e, y1, tz - 0.5, tx + e, y1, tz + 0.5);
  uvRect(0, 0, 1, 1);
  emit(opaquePass, tile, -1, NOMIP, false);
  quad(bx + 0.5, y0, bz - e, bx - 0.5, y0, bz - e, tx - 0.5, y1, tz - e, tx + 0.5, y1, tz - e);
  uvRect(0, 0, 1, 1);
  emit(opaquePass, tile, -1, NOMIP, false);
  quad(bx - 0.5, y0, bz + e, bx + 0.5, y0, bz + e, tx + 0.5, y1, tz + e, tx - 0.5, y1, tz + e);
  uvRect(0, 0, 1, 1);
  emit(opaquePass, tile, -1, NOMIP, false);
  // dessus de la flamme
  const t = 10 / 16;
  const cx = bx + (tx - bx) * t;
  const cz = bz + (tz - bz) * t;
  const cy = y0 + t;
  quad(cx - e, cy, cz + e, cx + e, cy, cz + e, cx + e, cy, cz - e, cx - e, cy, cz - e);
  uvRect(7 / 16, 6 / 16, 9 / 16, 8 / 16);
  emit(opaquePass, tile, -1, NOMIP, false);
}

function meshPane(id: number): void {
  let mask = paneConnections(nb);
  if (mask === 0) mask = 15;
  const main = BLOCK_TILES[id * 6 + FACE_NORTH];
  const edge = BLOCK_TILES[id * 6 + FACE_UP];
  const capUp = rid[cI + SY] !== id;
  const capDown = rid[cI - SY] !== id;
  const a = 7 / 16;
  const b = 9 / 16;
  noTint();
  // montant central
  for (let f = 0; f < 4; f++) {
    if (mask & (1 << f)) continue;
    const continues = (mask & (1 << cw(f))) !== 0 || (mask & (1 << ccw(f))) !== 0;
    boxFace(opaquePass, FACING_TO_FACE[f], a, 0, a, b, 1, b, continues ? main : edge, 0, false, NOMIP);
  }
  if (capUp) boxFace(opaquePass, FACE_UP, a, 0, a, b, 1, b, edge, 0, false, NOMIP);
  if (capDown) boxFace(opaquePass, FACE_DOWN, a, 0, a, b, 1, b, edge, 0, false, NOMIP);
  // bras
  for (let f = 0; f < 4; f++) {
    if (!(mask & (1 << f))) continue;
    let x0 = a;
    let x1 = b;
    let z0 = a;
    let z1 = b;
    if (f === 0) { z0 = b; z1 = 1; }
    else if (f === 1) { x0 = 0; x1 = a; }
    else if (f === 2) { z0 = 0; z1 = a; }
    else { x0 = b; x1 = 1; }
    const alongX = (f & 1) === 1;
    if (alongX) {
      boxFace(opaquePass, FACE_NORTH, x0, 0, z0, x1, 1, z1, main, 0, false, NOMIP);
      boxFace(opaquePass, FACE_SOUTH, x0, 0, z0, x1, 1, z1, main, 0, false, NOMIP);
    } else {
      boxFace(opaquePass, FACE_WEST, x0, 0, z0, x1, 1, z1, main, 0, false, NOMIP);
      boxFace(opaquePass, FACE_EAST, x0, 0, z0, x1, 1, z1, main, 0, false, NOMIP);
    }
    const rot = alongX ? 1 : 0;
    if (capUp) boxFace(opaquePass, FACE_UP, x0, 0, z0, x1, 1, z1, edge, rot, false, NOMIP);
    if (capDown) boxFace(opaquePass, FACE_DOWN, x0, 0, z0, x1, 1, z1, edge, rot, false, NOMIP);
  }
}

function meshDoor(id: number, meta: number): void {
  const d = BLOCKS[id];
  const named = doorNamedFacing(meta);
  const upper = (meta & META_DOOR_UPPER) !== 0;
  const tile = upper ? d.tiles[FACE_UP] : d.tiles[FACE_NORTH];
  // coin de la charnière : intersection du bord fermé et du bord ouvert
  const facing = meta & 3;
  const other = meta & META_DOOR_HINGE_RIGHT ? ccw(facing) : cw(facing);
  let hx = 0;
  let hz = 0;
  for (const n of [facing, other]) {
    if (n === 0) hz = 0;
    else if (n === 1) hx = 1;
    else if (n === 2) hz = 1;
    else hx = 0;
  }
  const alongX = (named & 1) === 0;
  const hingeAt0 = alongX ? hx === 0 : hz === 0;
  tmpBoxes.length = 0;
  edgeBox(named, 3, 0, 16, tmpBoxes);
  const x0 = tmpBoxes[0] / 16;
  const z0 = tmpBoxes[2] / 16;
  const x1 = tmpBoxes[3] / 16;
  const z1 = tmpBoxes[5] / 16;
  noTint();
  for (let f = 0; f < 6; f++) {
    if (f === FACE_UP && !upper) continue;
    if (f === FACE_DOWN && upper) continue;
    const wide = alongX ? f === FACE_NORTH || f === FACE_SOUTH : f === FACE_WEST || f === FACE_EAST;
    const mirror = wide && FACE_U_PLUS[f] !== hingeAt0;
    boxFace(opaquePass, f, x0, 0, z0, x1, 1, z1, tile, 0, mirror, NOMIP);
  }
}

function meshBed(id: number, meta: number): void {
  const d = meta & 3;
  const head = (meta & 4) !== 0;
  const h = 9 / 16;
  noTint();
  boxFace(opaquePass, FACE_UP, 0, 0, 0, 1, h, 1, head ? T.bed_head_top : T.bed_foot_top, (d + 2) & 3, false, NOMIP);
  boxFace(opaquePass, FACE_DOWN, 0, 0, 0, 1, h, 1, BLOCK_TILES[id * 6 + FACE_DOWN], 0, false, 0);
  const wantPlus = d === 1 || d === 2;
  for (let f = 2; f < 6; f++) {
    const fd = FACE_TO_FACING[f];
    if (fd === d) {
      if (head) boxFace(opaquePass, f, 0, 0, 0, 1, h, 1, T.bed_head_end, 0, false, NOMIP);
    } else if (fd === opposite(d)) {
      if (!head) boxFace(opaquePass, f, 0, 0, 0, 1, h, 1, T.bed_foot_end, 0, false, NOMIP);
    } else {
      const tile = head ? T.bed_head_side : T.bed_foot_side;
      boxFace(opaquePass, f, 0, 0, 0, 1, h, 1, tile, 0, FACE_U_PLUS[f] !== wantPlus, NOMIP);
    }
  }
}

function meshChest(id: number, meta: number): void {
  const d = BLOCKS[id];
  const front = FACING_TO_FACE[meta & 3];
  const a = 1 / 16;
  const b = 15 / 16;
  noTint();
  for (let f = 0; f < 6; f++) {
    boxFace(opaquePass, f, a, 0, a, b, 14 / 16, b, f === front ? d.frontTile : d.tiles[f], 0, false, 0);
  }
}

function meshCactus(id: number): void {
  const a = 1 / 16;
  const b = 15 / 16;
  noTint();
  if (rid[cI + SY] !== id) boxFace(opaquePass, FACE_UP, 0, 0, 0, 1, 1, 1, BLOCK_TILES[id * 6 + FACE_UP], 0, false, NOMIP);
  if (rid[cI - SY] !== id) boxFace(opaquePass, FACE_DOWN, 0, 0, 0, 1, 1, 1, BLOCK_TILES[id * 6 + FACE_DOWN], 0, false, NOMIP);
  const side = BLOCK_TILES[id * 6 + FACE_NORTH];
  boxFace(opaquePass, FACE_NORTH, 0, 0, a, 1, 1, b, side, 0, false, NOMIP);
  boxFace(opaquePass, FACE_SOUTH, 0, 0, a, 1, 1, b, side, 0, false, NOMIP);
  boxFace(opaquePass, FACE_WEST, a, 0, 0, b, 1, 1, side, 0, false, NOMIP);
  boxFace(opaquePass, FACE_EAST, a, 0, 0, b, 1, 1, side, 0, false, NOMIP);
}

/** Boîte simple dont les côtés disparaissent contre un voisin identique. */
function meshLowBox(id: number, meta: number, y0: number, y1: number, topTile: number): void {
  noTint();
  for (let f = 0; f < 6; f++) {
    if (f >= 2) {
      const n = cI + NOFF[f];
      if (rid[n] === id && rmeta[n] === meta) continue;
    }
    boxFace(opaquePass, f, 0, y0, 0, 1, y1, 1, f === FACE_UP ? topTile : BLOCK_TILES[id * 6 + f], 0, false, 0);
  }
}

function meshCell(id: number, meta: number): void {
  switch (BLOCK_SHAPE[id]) {
    case SHAPE.CUBE:
      meshCube(id, meta);
      return;
    case SHAPE.FLUID:
      meshFluid(id);
      return;
    case SHAPE.CROSS:
      meshCross(id);
      return;
    case SHAPE.CROP:
      meshCrop(id, meta);
      return;
    case SHAPE.SLAB: {
      const top = BLOCK_TILES[id * 6];
      if (meta === 2) meshLowBox(id, meta, 0, 1, top);
      else if (meta === 1) meshLowBox(id, meta, 0.5, 1, top);
      else meshLowBox(id, meta, 0, 0.5, top);
      return;
    }
    case SHAPE.STAIRS: {
      tmpBoxes.length = 0;
      stairsBoxes(meta, nb, tmpBoxes);
      noTint();
      const inner = meta & 4 ? FACE_UP : FACE_DOWN;
      for (let o = 0; o < tmpBoxes.length; o += 6) boxAll(opaquePass, id, tmpBoxes, o, 0, o === 0 ? -1 : inner);
      return;
    }
    case SHAPE.FENCE: {
      tmpBoxes.length = 0;
      fenceBoxes(fenceConnections(nb), tmpBoxes);
      noTint();
      for (let o = 0; o < tmpBoxes.length; o += 6) boxAll(opaquePass, id, tmpBoxes, o, 0, -1);
      return;
    }
    case SHAPE.FENCE_GATE: {
      tmpBoxes.length = 0;
      fenceGateBoxes(meta, tmpBoxes);
      noTint();
      for (let o = 0; o < tmpBoxes.length; o += 6) boxAll(opaquePass, id, tmpBoxes, o, 0, -1);
      return;
    }
    case SHAPE.DOOR:
      meshDoor(id, meta);
      return;
    case SHAPE.TRAPDOOR: {
      tmpBoxes.length = 0;
      if (meta & 4) edgeBox(meta & 3, 3, 0, 16, tmpBoxes);
      else if (meta & 8) tmpBoxes.push(0, 13, 0, 16, 16, 16);
      else tmpBoxes.push(0, 0, 0, 16, 3, 16);
      noTint();
      boxAll(opaquePass, id, tmpBoxes, 0, NOMIP, -1);
      return;
    }
    case SHAPE.LADDER:
      noTint();
      flatLight(1);
      planeQuad(FACING_TO_FACE[meta & 3], 15 / 16);
      emit(opaquePass, BLOCK_TILES[id * 6 + FACE_NORTH], -1, NOMIP, true);
      return;
    case SHAPE.TORCH:
      meshTorch(meta);
      return;
    case SHAPE.PANE:
      meshPane(id);
      return;
    case SHAPE.BED:
      meshBed(id, meta);
      return;
    case SHAPE.CHEST:
      meshChest(id, meta);
      return;
    case SHAPE.CACTUS:
      meshCactus(id);
      return;
    case SHAPE.FARMLAND:
      meshLowBox(id, meta, 0, 15 / 16, faceTile(id, meta, FACE_UP));
      return;
    case SHAPE.SNOW_LAYER:
      meshLowBox(id, meta & 7, 0, ((meta & 7) + 1) / 8, BLOCK_TILES[id * 6]);
      return;
    case SHAPE.LILY_PAD: {
      noTint();
      flatLight(1);
      const y = 1 / 64;
      quad(0, y, 1, 1, y, 1, 1, y, 0, 0, y, 0);
      uvRect(0, 0, 1, 1);
      const r = hash2i(baseX + cX, baseZ + cZ) & 3;
      for (let k = 0; k < 4; k++) {
        for (let q = 0; q < r; q++) {
          const t = UV[k * 2];
          UV[k * 2] = UV[k * 2 + 1];
          UV[k * 2 + 1] = 1 - t;
        }
      }
      emit(opaquePass, BLOCK_TILES[id * 6], -1, NOMIP, true);
      return;
    }
    case SHAPE.VINE: {
      setTint(1);
      flatLight(1);
      const tile = BLOCK_TILES[id * 6 + FACE_NORTH];
      let any = false;
      for (let f = 0; f < 4; f++) {
        if (!(meta & (1 << f))) continue;
        any = true;
        planeQuad(FACING_TO_FACE[opposite(f)], 15 / 16);
        emit(opaquePass, tile, -1, NOMIP, true);
      }
      if (!any) {
        planeQuad(FACE_DOWN, 15 / 16);
        emit(opaquePass, tile, -1, NOMIP, true);
      }
      return;
    }
    case SHAPE.FIRE: {
      noTint();
      fullLight();
      const tile = BLOCK_TILES[id * 6 + FACE_NORTH];
      for (let f = 2; f < 6; f++) {
        planeQuad(f, 1 / 16);
        emit(opaquePass, tile, -1, NOMIP, true);
      }
      crossQuads(tile, 0, 0, 0);
      return;
    }
    default:
      return;
  }
}

function meshCentral(top: number): void {
  for (let y = 0; y < top; y++) {
    for (let z = 0; z < 16; z++) {
      let i = (y + 1) * SY + (z + 17) * SZ + 17;
      for (let x = 0; x < 16; x++, i++) {
        const id = rid[i];
        if (id === 0) continue;
        if (
          BLOCK_OPAQUE[id] && BLOCK_OPAQUE[rid[i + SY]] && BLOCK_OPAQUE[rid[i - SY]] && BLOCK_OPAQUE[rid[i - 1]] &&
          BLOCK_OPAQUE[rid[i + 1]] && BLOCK_OPAQUE[rid[i - SZ]] && BLOCK_OPAQUE[rid[i + SZ]]
        ) continue;
        cI = i;
        cX = x;
        cY = y;
        cZ = z;
        meshCell(id, rmeta[i]);
      }
    }
  }
}

/** Calcule la lumière du voisinage puis le maillage du chunk central. */
export function buildChunkMesh(req: MeshRequest): MeshResult {
  const top = Math.max(1, Math.min(128, req.top));
  fillRegion(req.blocks, req.metas, top);
  computeLight(top);

  opaquePass.reset();
  translucentPass.reset();
  fancy = req.fancy;
  smooth = req.smoothLighting !== false;
  tints = req.tints;
  baseX = req.cx * 16;
  baseZ = req.cz * 16;
  meshCentral(top);

  const light = new Uint8Array(32768);
  light.fill(0xf0, top << 8);
  for (let y = 0; y < top; y++) {
    for (let z = 0; z < 16; z++) {
      let i = (y + 1) * SY + (z + 17) * SZ + 17;
      let o = (y << 8) | (z << 4);
      for (let x = 0; x < 16; x++, i++, o++) light[o] = (rsky[i] << 4) | rblk[i];
    }
  }
  return {
    id: req.id,
    cx: req.cx,
    cz: req.cz,
    light,
    opaque: opaquePass.finish(),
    translucent: translucentPass.finish(),
  };
}

// ---------------------------------------------------------------------------
// Modèle d'un bloc isolé (icônes d'inventaire, objets au sol, bloc tenu en main)
// ---------------------------------------------------------------------------
const DEFAULT_TINTS = new Uint8Array(256 * 9);
for (let c = 0; c < 256; c++) {
  DEFAULT_TINTS.set([0x91, 0xbd, 0x59, 0x77, 0xab, 0x2f, 0x3f, 0x76, 0xe4], c * 9);
}

/**
 * Maille un bloc seul, en pleine lumière, dans le cube [0, 1]³.
 * `lower` permet de placer un bloc sous le modèle (porte : moitié basse, etc.).
 */
export function buildBlockModel(id: number, meta: number): { opaque: PassData | null; translucent: PassData | null } {
  const top = 4;
  const empty: Array<Uint8Array | null> = [null, null, null, null, null, null, null, null, null];
  fillRegion(empty, empty, top);
  const n = (top + 2) * SY;
  rsky.fill(15, 0, n);
  rblk.fill(0, 0, n);
  const i = 2 * SY + (8 + 17) * SZ + 8 + 17;
  rid[i] = id;
  rmeta[i] = meta;
  opaquePass.reset();
  translucentPass.reset();
  fancy = true;
  smooth = true;
  tints = DEFAULT_TINTS;
  baseX = 0;
  baseZ = 0;
  cI = i;
  cX = 0;
  cY = 0;
  cZ = 0;
  meshCell(id, meta);
  return { opaque: opaquePass.finish(), translucent: translucentPass.finish() };
}
