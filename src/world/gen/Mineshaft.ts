/**
 * Mines abandonnées (Minecraft 1.12) : un réseau de galeries de 3 × 3 creusé sous terre,
 * étayé de barrières et de planches, avec des rails par tronçons, des toiles d'araignée,
 * des torches, quelques coffres et des cages à araignées.
 *
 * Le réseau entier se déduit de la graine : une salle de départ, puis des galeries, des
 * carrefours et des descentes qui se ramifient. Chaque chunk rejoue le réseau et n'en
 * garde que sa part. Les détails tirés au hasard (toiles, rails manquants) dépendent de la
 * position du bloc, pour être les mêmes des deux côtés d'une frontière de chunk.
 *
 * Écarts avec Minecraft : les coffres sont posés au sol (pas de wagonnets) et les cages
 * produisent des araignées ordinaires (pas d'araignées des cavernes). Les rails sont un décor.
 *
 * Module pur.
 */
import { B } from '../Ids';
import { isOceanBiome } from './Biomes';
import { DIR_DX, DIR_DZ, type GenCanvas } from './GenCanvas';
import { hash3 } from './Noise';
import { registerStructure, type Structure, type TerrainInfo } from './Structures';

type PieceKind = 'room' | 'corridor' | 'cross' | 'stairs';

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

interface MinePiece extends Box {
  kind: PieceKind;
  /** Direction de la galerie (0 sud, 1 ouest, 2 nord, 3 est). */
  dir: number;
  /** Point de départ : centre du sol à l'entrée. */
  sx: number;
  sy: number;
  sz: number;
  len: number;
  /** Descente : pente de -1 ou +1 par bloc. */
  slope: number;
  /** Position le long de la galerie du coffre et de la cage (-1 = aucun), et côté du coffre. */
  chestAt: number;
  chestSide: number;
  spawnerAt: number;
}

const MAX_PIECES = 44;
const MAX_DEPTH = 8;
const MAX_SPAN = 76;
const MIN_Y = 13;
const MAX_Y = 46;
/** Épaisseur de roche exigée au-dessus d'une galerie. */
const MIN_COVER = 7;

function intersects(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;
}

class Mineshaft implements Structure {
  readonly kind = 'mineshaft' as const;
  readonly surface = false;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  private readonly pieces: MinePiece[] = [];
  private readonly seed: number;

  constructor(private readonly t: TerrainInfo, readonly x: number, readonly y: number, readonly z: number, rng: () => number) {
    this.seed = (t.seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0;
    this.x0 = this.x1 = x;
    this.z0 = this.z1 = z;
    // salle de départ : 9 × 9, quatre sorties
    this.add({
      kind: 'room', dir: 0, sx: x, sy: y, sz: z, len: 0, slope: 0, chestAt: -1, chestSide: 1, spawnerAt: -1,
      x0: x - 4, y0: y, z0: z - 4, x1: x + 4, y1: y + 3, z1: z + 4,
    });
    for (let d = 0; d < 4; d++) this.grow(x + DIR_DX[d] * 5, y, z + DIR_DZ[d] * 5, d, 1, rng);
  }

  get size(): number {
    return this.pieces.length;
  }

  private add(p: MinePiece): void {
    this.pieces.push(p);
    if (p.x0 < this.x0) this.x0 = p.x0;
    if (p.z0 < this.z0) this.z0 = p.z0;
    if (p.x1 > this.x1) this.x1 = p.x1;
    if (p.z1 > this.z1) this.z1 = p.z1;
  }

  /** La pièce tient-elle : assez profonde, assez couverte, dans le périmètre, sans couper une autre ? */
  private fits(b: Box): boolean {
    if (b.y0 < MIN_Y || b.y1 > MAX_Y) return false;
    if (Math.abs(b.x0 - this.x) > MAX_SPAN || Math.abs(b.x1 - this.x) > MAX_SPAN || Math.abs(b.z0 - this.z) > MAX_SPAN || Math.abs(b.z1 - this.z) > MAX_SPAN) return false;
    for (const p of this.pieces) if (intersects(b, p)) return false;
    for (const [px, pz] of [[b.x0, b.z0], [b.x1, b.z1], [(b.x0 + b.x1) >> 1, (b.z0 + b.z1) >> 1]]) {
      if (this.t.terrainTop(px, pz) - b.y1 < MIN_COVER) return false;
    }
    return true;
  }

  /** Prolonge le réseau à partir de (x, y, z), centre du sol de l'entrée d'une nouvelle pièce allant vers `dir`. */
  private grow(x: number, y: number, z: number, dir: number, depth: number, rng: () => number): void {
    if (depth > MAX_DEPTH || this.pieces.length >= MAX_PIECES) return;
    const ax = DIR_DX[dir];
    const az = DIR_DZ[dir];
    const lx = DIR_DX[(dir + 1) & 3];
    const lz = DIR_DZ[(dir + 1) & 3];
    const roll = rng();

    if (roll < 0.12 && depth > 1) {
      // carrefour de 5 × 5 : tout droit, à gauche, à droite
      const ex = x + ax * 4;
      const ez = z + az * 4;
      const b: Box = {
        x0: Math.min(x, ex) - Math.abs(lx) * 2, x1: Math.max(x, ex) + Math.abs(lx) * 2,
        z0: Math.min(z, ez) - Math.abs(lz) * 2, z1: Math.max(z, ez) + Math.abs(lz) * 2, y0: y, y1: y + 2,
      };
      if (!this.fits(b)) return;
      this.add({ ...b, kind: 'cross', dir, sx: x, sy: y, sz: z, len: 5, slope: 0, chestAt: -1, chestSide: 1, spawnerAt: -1 });
      const cx = x + ax * 2;
      const cz = z + az * 2;
      this.grow(x + ax * 5, y, z + az * 5, dir, depth + 1, rng);
      this.grow(cx + lx * 3, y, cz + lz * 3, (dir + 1) & 3, depth + 1, rng);
      this.grow(cx - lx * 3, y, cz - lz * 3, (dir + 3) & 3, depth + 1, rng);
      return;
    }

    if (roll < 0.26 && depth > 1) {
      // descente (ou montée) d'un bloc par pas
      const len = 5 + Math.floor(rng() * 4);
      const slope = rng() < 0.7 ? -1 : 1;
      const ey = y + slope * (len - 1);
      const ex = x + ax * (len - 1);
      const ez = z + az * (len - 1);
      const b: Box = {
        x0: Math.min(x, ex) - Math.abs(lx), x1: Math.max(x, ex) + Math.abs(lx),
        z0: Math.min(z, ez) - Math.abs(lz), z1: Math.max(z, ez) + Math.abs(lz),
        y0: Math.min(y, ey), y1: Math.max(y, ey) + 3,
      };
      if (!this.fits(b)) return;
      this.add({ ...b, kind: 'stairs', dir, sx: x, sy: y, sz: z, len, slope, chestAt: -1, chestSide: 1, spawnerAt: -1 });
      this.grow(x + ax * len, ey, z + az * len, dir, depth + 1, rng);
      return;
    }

    // galerie droite : 2 à 4 travées de 5 blocs
    const len = (2 + Math.floor(rng() * 3)) * 5;
    const ex = x + ax * (len - 1);
    const ez = z + az * (len - 1);
    const b: Box = {
      x0: Math.min(x, ex) - Math.abs(lx), x1: Math.max(x, ex) + Math.abs(lx),
      z0: Math.min(z, ez) - Math.abs(lz), z1: Math.max(z, ez) + Math.abs(lz), y0: y, y1: y + 2,
    };
    if (!this.fits(b)) return;
    const chestAt = rng() < 0.2 ? 1 + Math.floor(rng() * (len - 2)) : -1;
    const spawnerAt = depth >= 2 && rng() < 0.08 ? 3 + Math.floor(rng() * (len - 6)) : -1;
    this.add({ ...b, kind: 'corridor', dir, sx: x, sy: y, sz: z, len, slope: 0, chestAt, chestSide: rng() < 0.5 ? 1 : -1, spawnerAt });
    const nx = x + ax * len;
    const nz = z + az * len;
    const end = rng();
    if (end < 0.78) this.grow(nx, y, nz, dir, depth + 1, rng);
    // embranchements en bout de galerie
    const bx = x + ax * (len - 2);
    const bz = z + az * (len - 2);
    if (rng() < 0.3) this.grow(bx + lx * 2, y, bz + lz * 2, (dir + 1) & 3, depth + 1, rng);
    if (rng() < 0.3) this.grow(bx - lx * 2, y, bz - lz * 2, (dir + 3) & 3, depth + 1, rng);
  }

  build(c: GenCanvas): void {
    for (const p of this.pieces) {
      if (!c.touches(p.x0 - 1, p.z0 - 1, p.x1 + 1, p.z1 + 1)) continue;
      switch (p.kind) {
        case 'room':
          this.buildRoom(c, p);
          break;
        case 'cross':
          this.buildCross(c, p);
          break;
        case 'stairs':
          this.buildStairs(c, p);
          break;
        default:
          this.buildCorridor(c, p);
          break;
      }
    }
  }

  /** Tirage 0..1 attaché à une position et à un usage : identique d'un chunk à l'autre. */
  private chance(x: number, y: number, z: number, salt: number): number {
    return hash3(x, y, z, (this.seed + salt) >>> 0) / 4294967296;
  }

  /** Sol franchissable : là où la galerie passe au-dessus d'une grotte, un plancher. */
  private floor(c: GenCanvas, x: number, y: number, z: number): void {
    const id = c.get(x, y - 1, z);
    if (id === B.AIR || id === B.WATER || id === B.LAVA) c.set(x, y - 1, z, B.OAK_PLANKS);
  }

  private buildRoom(c: GenCanvas, p: MinePiece): void {
    c.fill(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, B.AIR);
    c.fill(p.x0, p.y0 - 1, p.z0, p.x1, p.y0 - 1, p.z1, B.DIRT);
  }

  private buildCross(c: GenCanvas, p: MinePiece): void {
    c.fill(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, B.AIR);
    for (let z = p.z0; z <= p.z1; z++) for (let x = p.x0; x <= p.x1; x++) this.floor(c, x, p.y0, z);
    // quatre piliers de planches aux angles du carrefour
    for (const x of [p.x0, p.x1]) for (const z of [p.z0, p.z1]) c.fill(x, p.y0, z, x, p.y1, z, B.OAK_PLANKS);
  }

  private buildStairs(c: GenCanvas, p: MinePiece): void {
    const ax = DIR_DX[p.dir];
    const az = DIR_DZ[p.dir];
    const lx = DIR_DX[(p.dir + 1) & 3];
    const lz = DIR_DZ[(p.dir + 1) & 3];
    for (let i = 0; i < p.len; i++) {
      const y = p.sy + p.slope * i;
      for (let s = -1; s <= 1; s++) {
        const x = p.sx + ax * i + lx * s;
        const z = p.sz + az * i + lz * s;
        c.fill(x, y, z, x, y + 3, z, B.AIR);
        this.floor(c, x, y, z);
      }
    }
  }

  private buildCorridor(c: GenCanvas, p: MinePiece): void {
    const ax = DIR_DX[p.dir];
    const az = DIR_DZ[p.dir];
    const lx = DIR_DX[(p.dir + 1) & 3];
    const lz = DIR_DZ[(p.dir + 1) & 3];
    const y = p.sy;
    c.fill(p.x0, y, p.z0, p.x1, y + 2, p.z1, B.AIR);
    const railMeta = ax !== 0 ? 1 : 0;
    for (let i = 0; i < p.len; i++) {
      const cx = p.sx + ax * i;
      const cz = p.sz + az * i;
      for (let s = -1; s <= 1; s++) this.floor(c, cx + lx * s, y, cz + lz * s);

      if (i % 5 === 2) {
        // étai : deux poteaux de barrière et une traverse de planches
        for (const s of [-1, 1]) c.fill(cx + lx * s, y, cz + lz * s, cx + lx * s, y + 1, cz + lz * s, B.OAK_FENCE);
        for (let s = -1; s <= 1; s++) c.set(cx + lx * s, y + 2, cz + lz * s, B.OAK_PLANKS);
        // de loin en loin, une torche accrochée à la traverse
        if (this.chance(cx, y, cz, 1) < 0.18 && i + 1 < p.len) {
          c.set(cx + ax, y + 2, cz + az, B.TORCH, p.dir + 1);
        }
      } else {
        // toiles d'araignée sous le plafond, rails par tronçons
        for (const s of [-1, 1]) {
          if (this.chance(cx + lx * s, y + 2, cz + lz * s, 2) < 0.05) c.set(cx + lx * s, y + 2, cz + lz * s, B.COBWEB);
        }
      }
      // rails : présents sur des tronçons de 8 blocs environ, avec des manques
      if (this.chance(cx >> 3, y, cz >> 3, 3) < 0.7 && this.chance(cx, y, cz, 4) < 0.85 && c.get(cx, y - 1, cz) !== B.AIR) {
        c.set(cx, y, cz, B.RAIL, railMeta);
      }

      if (i === p.chestAt) {
        const x = cx + lx * p.chestSide;
        const z = cz + lz * p.chestSide;
        if (c.get(x, y, z) === B.AIR && c.get(x, y - 1, z) !== B.AIR) {
          // tourné vers le milieu de la galerie
          c.chest(x, y, z, ((p.dir + 1) & 3) ^ (p.chestSide > 0 ? 2 : 0), 'mineshaft');
        }
      }
      if (i === p.spawnerAt) {
        c.spawner(cx, y, cz, 'spider');
        // nid : la galerie est prise dans les toiles autour de la cage
        for (let k = -2; k <= 2; k++) {
          for (let s = -1; s <= 1; s++) {
            for (let dy = 0; dy <= 2; dy++) {
              const x = cx + ax * k + lx * s;
              const z = cz + az * k + lz * s;
              if ((k !== 0 || s !== 0 || dy !== 0) && c.get(x, y + dy, z) === B.AIR && this.chance(x, y + dy, z, 5) < 0.4) c.set(x, y + dy, z, B.COBWEB);
            }
          }
        }
      }
    }
  }
}

registerStructure('mineshaft', {
  spacing: 16,
  separation: 5,
  salt: 0x0314e5af,
  reach: MAX_SPAN + 6,
  create(t, x, z, rng) {
    // une case sur deux environ porte une mine
    if (rng() < 0.45 || isOceanBiome(t.biomeAt(x, z))) return null;
    const top = t.terrainTop(x, z);
    const y = 18 + Math.floor(rng() * 16);
    if (top - (y + 3) < MIN_COVER + 4) return null;
    const m = new Mineshaft(t, x, y, z, rng);
    // une salle sans galeries n'est pas une mine
    return m.size >= 6 ? m : null;
  },
});
