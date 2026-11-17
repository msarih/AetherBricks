/**
 * Outils d'écriture des constructions générées (donjons, villages, temples…).
 *
 * Une construction peut s'étendre sur plusieurs chunks alors que le générateur n'écrit
 * qu'un chunk à la fois. Chaque chunk rejoue donc la construction entière, en coordonnées
 * du monde, et `GenCanvas` ne garde que ce qui tombe dans le chunk en cours : les deux
 * côtés d'une frontière se raccordent sans rien se dire.
 *
 * Module pur : il tourne dans les workers.
 */
import { CHUNK_HEIGHT, CHUNK_SIZE } from '../Constants';
import { B } from '../Ids';

/** Entité de bloc posée par le générateur (coffre à butin, générateur de monstres). */
export interface GenBlockEntity {
  type: string;
  x: number;
  y: number;
  z: number;
  [key: string]: unknown;
}

/** Créature à faire apparaître avec le chunk (position des pieds, en blocs). */
export interface GenSpawn {
  kind: string;
  x: number;
  y: number;
  z: number;
  [key: string]: unknown;
}

/** Directions horizontales du jeu : 0 sud (+z), 1 ouest (-x), 2 nord (-z), 3 est (+x). */
export const DIR_DX = [0, -1, 0, 1] as const;
export const DIR_DZ = [1, 0, -1, 0] as const;

export class GenCanvas {
  /** Coin nord-ouest du chunk en cours, en blocs. */
  bx = 0;
  bz = 0;
  blocks: Uint8Array = new Uint8Array(0);
  meta: Uint8Array = new Uint8Array(0);
  blockEntities: GenBlockEntity[] = [];
  spawns: GenSpawn[] = [];

  begin(cx: number, cz: number, blocks: Uint8Array, meta: Uint8Array): void {
    this.bx = cx * CHUNK_SIZE;
    this.bz = cz * CHUNK_SIZE;
    this.blocks = blocks;
    this.meta = meta;
    this.blockEntities = [];
    this.spawns = [];
  }

  inside(x: number, z: number): boolean {
    return x >= this.bx && x < this.bx + CHUNK_SIZE && z >= this.bz && z < this.bz + CHUNK_SIZE;
  }

  /** Le rectangle [x0, x1] × [z0, z1] (bornes comprises) touche-t-il le chunk en cours ? */
  touches(x0: number, z0: number, x1: number, z1: number): boolean {
    return x1 >= this.bx && x0 < this.bx + CHUNK_SIZE && z1 >= this.bz && z0 < this.bz + CHUNK_SIZE;
  }

  /** Bloc en coordonnées du monde, ou -1 hors du chunk en cours. */
  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT || !this.inside(x, z)) return -1;
    return this.blocks[(y << 8) | ((z - this.bz) << 4) | (x - this.bx)];
  }

  set(x: number, y: number, z: number, id: number, meta = 0): void {
    if (y < 1 || y >= CHUNK_HEIGHT || !this.inside(x, z)) return;
    const i = (y << 8) | ((z - this.bz) << 4) | (x - this.bx);
    this.blocks[i] = id;
    this.meta[i] = meta;
  }

  /** Remplit la boîte (bornes comprises, dans n'importe quel ordre). */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = 0): void {
    const xa = Math.max(Math.min(x0, x1), this.bx);
    const xb = Math.min(Math.max(x0, x1), this.bx + CHUNK_SIZE - 1);
    const za = Math.max(Math.min(z0, z1), this.bz);
    const zb = Math.min(Math.max(z0, z1), this.bz + CHUNK_SIZE - 1);
    const ya = Math.max(Math.min(y0, y1), 1);
    const yb = Math.min(Math.max(y0, y1), CHUNK_HEIGHT - 1);
    for (let y = ya; y <= yb; y++) {
      for (let z = za; z <= zb; z++) {
        const row = (y << 8) | ((z - this.bz) << 4);
        for (let x = xa; x <= xb; x++) {
          this.blocks[row | (x - this.bx)] = id;
          this.meta[row | (x - this.bx)] = meta;
        }
      }
    }
  }

  /**
   * Fondations : descend sous (x, y, z) en posant `id` tant que la cellule est vide, liquide
   * ou végétale, pour qu'une construction ne flotte pas au-dessus d'un creux.
   */
  pillarDown(x: number, y: number, z: number, id: number, maxDepth = 24): void {
    if (!this.inside(x, z)) return;
    for (let yy = y, n = 0; yy >= 1 && n < maxDepth; yy--, n++) {
      const cur = this.get(x, yy, z);
      if (cur !== B.AIR && cur !== B.WATER && cur !== B.LAVA && !isSoft(cur)) return;
      this.set(x, yy, z, id);
    }
  }

  blockEntity(be: GenBlockEntity): void {
    if (this.inside(be.x, be.z)) this.blockEntities.push(be);
  }

  spawn(s: GenSpawn): void {
    if (this.inside(Math.floor(s.x), Math.floor(s.z))) this.spawns.push(s);
  }

  /** Coffre à butin tourné vers `facing`. */
  chest(x: number, y: number, z: number, facing: number, loot: string): void {
    if (!this.inside(x, z)) return;
    this.set(x, y, z, B.CHEST, facing & 3);
    this.blockEntities.push({ type: 'chest', x, y, z, loot });
  }

  /** Générateur de monstres de l'espèce donnée. */
  spawner(x: number, y: number, z: number, mob: string): void {
    if (!this.inside(x, z)) return;
    this.set(x, y, z, B.SPAWNER);
    this.blockEntities.push({ type: 'spawner', x, y, z, mob, delay: 20 });
  }
}

/** Végétation et autres blocs qu'une fondation peut écraser. */
function isSoft(id: number): boolean {
  return (
    (id >= B.OAK_LEAVES && id <= B.ACACIA_LEAVES) ||
    (id >= B.TALL_GRASS && id <= B.SUGAR_CANE) ||
    id === B.SNOW_LAYER || id === B.VINE || id === B.LILY_PAD || id === B.DEAD_BUSH
  );
}

/**
 * Morceau de construction orienté. Les coordonnées locales sont (u, v, w) : u vers la
 * droite, v vers le haut, w vers le fond ; `rot` quarts de tour les amènent dans le monde.
 * Les directions locales suivent la même convention que le jeu (0 = +w, 1 = -u, 2 = -w, 3 = +u).
 */
export class Piece {
  constructor(
    readonly c: GenCanvas,
    readonly ox: number,
    readonly oy: number,
    readonly oz: number,
    readonly rot: number,
  ) {}

  x(u: number, w: number): number {
    switch (this.rot & 3) {
      case 0: return this.ox + u;
      case 1: return this.ox - w;
      case 2: return this.ox - u;
      default: return this.ox + w;
    }
  }

  z(u: number, w: number): number {
    switch (this.rot & 3) {
      case 0: return this.oz + w;
      case 1: return this.oz + u;
      case 2: return this.oz - w;
      default: return this.oz - u;
    }
  }

  /** Direction du monde correspondant à une direction locale. */
  dir(f: number): number {
    return (f + this.rot) & 3;
  }

  get(u: number, v: number, w: number): number {
    return this.c.get(this.x(u, w), this.oy + v, this.z(u, w));
  }

  set(u: number, v: number, w: number, id: number, meta = 0): void {
    this.c.set(this.x(u, w), this.oy + v, this.z(u, w), id, meta);
  }

  fill(u0: number, v0: number, w0: number, u1: number, v1: number, w1: number, id: number, meta = 0): void {
    this.c.fill(this.x(u0, w0), this.oy + v0, this.z(u0, w0), this.x(u1, w1), this.oy + v1, this.z(u1, w1), id, meta);
  }

  /** Parois d'une boîte (sans le sol ni le plafond). */
  walls(u0: number, v0: number, w0: number, u1: number, v1: number, w1: number, id: number, meta = 0): void {
    this.fill(u0, v0, w0, u1, v1, w0, id, meta);
    this.fill(u0, v0, w1, u1, v1, w1, id, meta);
    this.fill(u0, v0, w0, u0, v1, w1, id, meta);
    this.fill(u1, v0, w0, u1, v1, w1, id, meta);
  }

  /** Le rectangle local touche-t-il le chunk en cours ? */
  touches(u0: number, w0: number, u1: number, w1: number): boolean {
    const xa = this.x(u0, w0);
    const xb = this.x(u1, w1);
    const za = this.z(u0, w0);
    const zb = this.z(u1, w1);
    return this.c.touches(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb));
  }

  /** Escalier qui monte vers la direction locale `toward` (à l'envers si `upsideDown`). */
  stairs(u: number, v: number, w: number, id: number, toward: number, upsideDown = false): void {
    this.set(u, v, w, id, this.dir(toward) | (upsideDown ? 4 : 0));
  }

  /** Porte (deux moitiés) qu'on franchit en regardant vers la direction locale `toward`. */
  door(u: number, v: number, w: number, id: number, toward: number, hingeRight = false): void {
    const m = this.dir(toward) | (hingeRight ? 16 : 0);
    this.set(u, v, w, id, m);
    this.set(u, v + 1, w, id, m | 8);
  }

  /** Torche posée au sol (`facing` < 0) ou accrochée à un mur, tournée vers `facing`. */
  torch(u: number, v: number, w: number, facing = -1): void {
    this.set(u, v, w, B.TORCH, facing < 0 ? 0 : this.dir(facing) + 1);
  }

  /** Échelle accrochée au mur situé derrière elle, tournée vers `facing`. */
  ladder(u: number, v: number, w: number, facing: number): void {
    this.set(u, v, w, B.LADDER, this.dir(facing));
  }

  /** Bloc à façade (fourneau, citrouille…) tourné vers `facing`. */
  facing(u: number, v: number, w: number, id: number, facing: number): void {
    this.set(u, v, w, id, this.dir(facing));
  }

  /** Lit : pied en (u, v, w), tête un bloc plus loin dans la direction `toward`. */
  bed(u: number, v: number, w: number, toward: number): void {
    const d = this.dir(toward);
    const x = this.x(u, w);
    const z = this.z(u, w);
    this.c.set(x, this.oy + v, z, B.BED, d);
    this.c.set(x + DIR_DX[d], this.oy + v, z + DIR_DZ[d], B.BED, d | 4);
  }

  chest(u: number, v: number, w: number, facing: number, loot: string): void {
    this.c.chest(this.x(u, w), this.oy + v, this.z(u, w), this.dir(facing), loot);
  }

  spawner(u: number, v: number, w: number, mob: string): void {
    this.c.spawner(this.x(u, w), this.oy + v, this.z(u, w), mob);
  }

  spawn(kind: string, u: number, v: number, w: number, extra: Record<string, unknown> = {}): void {
    this.c.spawn({ ...extra, kind, x: this.x(u, w) + 0.5, y: this.oy + v, z: this.z(u, w) + 0.5 });
  }

  /** Fondations sous la cellule locale (voir GenCanvas.pillarDown). */
  pillarDown(u: number, v: number, w: number, id: number, maxDepth = 24): void {
    this.c.pillarDown(this.x(u, w), this.oy + v, this.z(u, w), id, maxDepth);
  }
}
