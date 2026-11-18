/**
 * Villages (Minecraft 1.12) : un puits au centre, quatre chemins, et le long des chemins
 * des maisons, une bibliothèque, une église, une forge, une boucherie, des champs et des
 * lampadaires. Les matériaux changent avec le biome (chêne en plaine, acacia en savane,
 * grès dans le désert).
 *
 * Le plan d'un village se déduit entièrement de la graine : chaque chunk le rejoue et n'en
 * garde que sa part. Chaque bâtiment se pose à la hauteur exacte du sol devant sa porte
 * (`TerrainInfo.terrainTop`), les chemins suivent le relief.
 *
 * Module pur.
 */
import { SEA_LEVEL } from '../Constants';
import { B } from '../Ids';
import { BIOME } from './Biomes';
import { DIR_DX, DIR_DZ, Piece, type GenCanvas } from './GenCanvas';
import { registerStructure, type Structure, type TerrainInfo } from './Structures';

type BuildingType = 'house' | 'hut' | 'large_house' | 'library' | 'church' | 'smithy' | 'butcher' | 'farm';

/** Largeur (le long du chemin) et profondeur de chaque bâtiment, et son poids au tirage. */
const TYPES: Record<BuildingType, { w: number; d: number; weight: number; max: number }> = {
  house: { w: 5, d: 5, weight: 6, max: 4 },
  hut: { w: 4, d: 5, weight: 5, max: 3 },
  large_house: { w: 9, d: 6, weight: 3, max: 2 },
  library: { w: 9, d: 6, weight: 2, max: 1 },
  church: { w: 5, d: 9, weight: 2, max: 1 },
  smithy: { w: 10, d: 7, weight: 2, max: 1 },
  butcher: { w: 9, d: 7, weight: 2, max: 1 },
  farm: { w: 7, d: 9, weight: 5, max: 3 },
};
const TYPE_LIST = Object.keys(TYPES) as BuildingType[];

/** Métier du villageois logé dans chaque bâtiment (voir entity/Villager). */
const PROFESSION: Record<BuildingType, string> = {
  house: 'farmer',
  hut: 'farmer',
  large_house: 'farmer',
  library: 'librarian',
  church: 'priest',
  smithy: 'smith',
  butcher: 'butcher',
  farm: 'farmer',
};

interface Materials {
  cobble: number;
  planks: number;
  log: number;
  stairs: number;
  cobbleStairs: number;
  slab: number;
  path: number;
}

const OAK: Materials = {
  cobble: B.COBBLESTONE, planks: B.OAK_PLANKS, log: B.OAK_LOG, stairs: B.OAK_STAIRS,
  cobbleStairs: B.COBBLESTONE_STAIRS, slab: B.COBBLESTONE_SLAB, path: B.GRASS_PATH,
};
const ACACIA: Materials = { ...OAK, planks: B.ACACIA_PLANKS, log: B.ACACIA_LOG, stairs: B.ACACIA_STAIRS };
const SANDSTONE: Materials = {
  cobble: B.SANDSTONE, planks: B.SANDSTONE, log: B.SANDSTONE, stairs: B.SANDSTONE_STAIRS,
  cobbleStairs: B.SANDSTONE_STAIRS, slab: B.SANDSTONE_SLAB, path: B.SANDSTONE,
};

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface Building extends Rect {
  type: BuildingType;
  /** Coin avant gauche (local 0, 0), hauteur du sol (bloc du plancher) et orientation. */
  ox: number;
  oy: number;
  oz: number;
  rot: number;
  /** Aléa propre au bâtiment (variantes, cultures). */
  seed: number;
}

interface Lamp {
  x: number;
  z: number;
}

/** Chemin tracé : direction, point de départ, premier bloc et longueur. */
interface Lane {
  dir: number;
  sx: number;
  sz: number;
  start: number;
  len: number;
}

function overlaps(a: Rect, b: Rect, margin: number): boolean {
  return a.x0 - margin <= b.x1 && a.x1 + margin >= b.x0 && a.z0 - margin <= b.z1 && a.z1 + margin >= b.z0;
}

/** Bloc de terrain le plus haut de la colonne dans le chunk en cours (arbres et plantes ignorés), ou -1. */
function groundY(c: GenCanvas, x: number, z: number): number {
  if (!c.inside(x, z)) return -1;
  for (let y = 126; y > 0; y--) {
    const id = c.get(x, y, z);
    if (id === B.AIR || isVegetation(id)) continue;
    return y;
  }
  return -1;
}

function isVegetation(id: number): boolean {
  return (
    (id >= B.OAK_LOG && id <= B.ACACIA_LOG) || (id >= B.OAK_LEAVES && id <= B.ACACIA_LEAVES) ||
    (id >= B.TALL_GRASS && id <= B.PUMPKIN) || id === B.SNOW_LAYER || id === B.VINE || id === B.LILY_PAD || id === B.MELON
  );
}

class Village implements Structure {
  readonly kind = 'village' as const;
  readonly surface = true;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  private readonly roads: Rect[] = [];
  private readonly buildings: Building[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly counts = new Map<BuildingType, number>();

  constructor(
    private readonly t: TerrainInfo,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    private readonly mat: Materials,
    rng: () => number,
  ) {
    this.x0 = x - 3;
    this.x1 = x + 2;
    this.z0 = z - 3;
    this.z1 = z + 2;
    // chemins d'abord (quatre grands, parfois une ruelle de traverse), bâtiments ensuite
    const lanes: Lane[] = [];
    for (let d = 0; d < 4; d++) {
      const main = this.layRoad(d, 22 + Math.floor(rng() * 16), x, z, d === 0 || d === 3 ? 3 : 4);
      if (!main) continue;
      lanes.push(main);
      if (main.len >= 20 && rng() < 0.7) {
        const k = main.start + 10 + Math.floor(rng() * (main.len - 16));
        const side = rng() < 0.5 ? 1 : 3;
        const alley = this.layRoad((d + side) & 3, 12 + Math.floor(rng() * 10), x + DIR_DX[d] * k, z + DIR_DZ[d] * k, 2);
        if (alley) lanes.push(alley);
      }
    }
    for (const lane of lanes) this.populate(lane, rng);
    for (const r of this.roads) this.grow(r);
    for (const b of this.buildings) this.grow(b);
    // marge : tabliers des portes, lampadaires
    this.x0 -= 3;
    this.z0 -= 3;
    this.x1 += 3;
    this.z1 += 3;
  }

  get size(): number {
    return this.buildings.length;
  }

  private grow(r: Rect): void {
    if (r.x0 < this.x0) this.x0 = r.x0;
    if (r.z0 < this.z0) this.z0 = r.z0;
    if (r.x1 > this.x1) this.x1 = r.x1;
    if (r.z1 > this.z1) this.z1 = r.z1;
  }

  /**
   * Trace un chemin de 3 de large partant de (sx, sz) vers `dir`, à partir de `start` blocs.
   * Il s'arrête avant l'eau ou une pente trop forte ; trop court, il est abandonné.
   */
  private layRoad(dir: number, length: number, sx: number, sz: number, start: number): Lane | null {
    const ax = DIR_DX[dir];
    const az = DIR_DZ[dir];
    let len = 0;
    let prev = this.t.terrainTop(sx + ax * start, sz + az * start);
    for (let k = start; k < start + length; k += 2) {
      const h = this.t.terrainTop(sx + ax * k, sz + az * k);
      if (h < SEA_LEVEL || Math.abs(h - prev) > 3 || Math.abs(h - this.y) > 9) break;
      prev = h;
      len = Math.min(length, k - start + 2);
    }
    if (len < 8) return null;
    const x0 = sx + ax * start;
    const z0 = sz + az * start;
    const x1 = sx + ax * (start + len - 1);
    const z1 = sz + az * (start + len - 1);
    const road: Rect = {
      x0: Math.min(x0, x1) - (az !== 0 ? 1 : 0),
      x1: Math.max(x0, x1) + (az !== 0 ? 1 : 0),
      z0: Math.min(z0, z1) - (ax !== 0 ? 1 : 0),
      z1: Math.max(z0, z1) + (ax !== 0 ? 1 : 0),
    };
    for (const r of this.roads) if (overlaps(road, r, 0)) return null;
    this.roads.push(road);
    return { dir, sx, sz, start, len };
  }

  /** Borde un chemin de bâtiments et de lampadaires, des deux côtés. */
  private populate(lane: Lane, rng: () => number): void {
    const { dir, sx, sz, start, len } = lane;
    const ax = DIR_DX[dir];
    const az = DIR_DZ[dir];
    for (const side of [1, 3]) {
      const normal = (dir + side) & 3;
      let k = start + 1 + Math.floor(rng() * 3);
      let lampDue = 6 + Math.floor(rng() * 6);
      while (k < start + len - 3) {
        const type = this.pick(rng);
        if (!type) return;
        const def = TYPES[type];
        const b = k + def.w <= start + len + 1 ? this.place(type, dir, normal, sx + ax * k, sz + az * k, rng) : null;
        if (!b) {
          k += 2 + Math.floor(rng() * 2);
          continue;
        }
        this.buildings.push(b);
        this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
        k += def.w + 1 + Math.floor(rng() * 3);
        lampDue -= def.w;
        if (lampDue <= 0) {
          // lampadaire au bord du chemin, juste après le bâtiment
          this.lamps.push({ x: sx + ax * (k - 1) + DIR_DX[normal] * 2, z: sz + az * (k - 1) + DIR_DZ[normal] * 2 });
          lampDue = 10 + Math.floor(rng() * 8);
        }
      }
    }
  }

  /** Type de bâtiment tiré au hasard parmi ceux dont le plafond n'est pas atteint ; null si le village est complet. */
  private pick(rng: () => number): BuildingType | null {
    let total = 0;
    for (const t of TYPE_LIST) if ((this.counts.get(t) ?? 0) < TYPES[t].max) total += TYPES[t].weight;
    if (total === 0) return null;
    let r = rng() * total;
    let last: BuildingType = 'house';
    for (const t of TYPE_LIST) {
      if ((this.counts.get(t) ?? 0) >= TYPES[t].max) continue;
      last = t;
      r -= TYPES[t].weight;
      if (r < 0) break;
    }
    return last;
  }

  /**
   * Bâtiment dont la façade longe le chemin : `normal` est la direction qui s'éloigne du
   * chemin (le fond du bâtiment), (ax, az) le point de l'axe du chemin où il commence.
   */
  private place(type: BuildingType, dir: number, normal: number, ax: number, az: number, rng: () => number): Building | null {
    const def = TYPES[type];
    const rot = normal;
    const ux = DIR_DX[(3 + rot) & 3];
    const uz = DIR_DZ[(3 + rot) & 3];
    const nx = DIR_DX[normal];
    const nz = DIR_DZ[normal];
    // le bâtiment occupe def.w cellules le long du chemin à partir de (ax, az) vers `dir`
    const along = ux === DIR_DX[dir] && uz === DIR_DZ[dir] ? 0 : def.w - 1;
    const ox = ax + DIR_DX[dir] * along + nx * 3;
    const oz = az + DIR_DZ[dir] * along + nz * 3;
    const ex = ox + ux * (def.w - 1) + nx * (def.d - 1);
    const ez = oz + uz * (def.w - 1) + nz * (def.d - 1);
    const rect: Rect = { x0: Math.min(ox, ex), x1: Math.max(ox, ex), z0: Math.min(oz, ez), z1: Math.max(oz, ez) };
    for (const o of this.buildings) if (overlaps(rect, o, 1)) return null;
    for (const r of this.roads) if (overlaps(rect, r, 1)) return null;
    if (overlaps(rect, { x0: this.x - 3, x1: this.x + 2, z0: this.z - 3, z1: this.z + 2 }, 1)) return null;

    // sol devant la porte : c'est le niveau du plancher
    const du = doorU(type);
    const oy = this.t.terrainTop(ox + ux * du - nx, oz + uz * du - nz);
    if (oy < SEA_LEVEL + 1 || Math.abs(oy - this.y) > 8) return null;
    // pas de bâtiment à cheval sur une falaise ou sur l'eau
    for (const [cu, cw] of [[0, 0], [def.w - 1, 0], [0, def.d - 1], [def.w - 1, def.d - 1]]) {
      const h = this.t.terrainTop(ox + ux * cu + nx * cw, oz + uz * cu + nz * cw);
      if (h < SEA_LEVEL || Math.abs(h - oy) > 4) return null;
    }
    return { ...rect, type, ox, oy, oz, rot, seed: Math.floor(rng() * 0x7fffffff) };
  }

  /** Aucun arbre sur les chemins, dans les bâtiments ni juste autour. */
  covers(x: number, z: number): boolean {
    if (x >= this.x - 4 && x <= this.x + 3 && z >= this.z - 4 && z <= this.z + 3) return true;
    for (const r of this.roads) if (x >= r.x0 - 1 && x <= r.x1 + 1 && z >= r.z0 - 1 && z <= r.z1 + 1) return true;
    for (const b of this.buildings) if (x >= b.x0 - 2 && x <= b.x1 + 2 && z >= b.z0 - 2 && z <= b.z1 + 2) return true;
    return false;
  }

  build(c: GenCanvas): void {
    for (const r of this.roads) if (c.touches(r.x0, r.z0, r.x1, r.z1)) this.buildRoad(c, r);
    if (c.touches(this.x - 3, this.z - 3, this.x + 2, this.z + 2)) this.buildWell(c);
    for (const b of this.buildings) {
      if (!c.touches(b.x0 - 1, b.z0 - 1, b.x1 + 1, b.z1 + 1)) continue;
      const p = new Piece(c, b.ox, b.oy, b.oz, b.rot);
      const def = TYPES[b.type];
      this.prepare(p, def.w, def.d, b.type === 'farm' ? 4 : 11, doorU(b.type), b.type === 'farm');
      BUILDERS[b.type](p, this.mat, b.seed);
    }
    for (const l of this.lamps) this.buildLamp(c, l);
  }

  private pathCell(c: GenCanvas, x: number, z: number): void {
    const y = groundY(c, x, z);
    if (y < 1) return;
    const id = c.get(x, y, z);
    let path = this.mat.path;
    if (id === B.WATER || id === B.ICE) path = this.mat.planks;
    else if (id === B.LAVA) return;
    else if (path === B.GRASS_PATH && id !== B.GRASS && id !== B.DIRT) path = B.GRAVEL;
    // le gravier tombe : il lui faut un bloc plein dessous
    if (path === B.GRAVEL && c.get(x, y - 1, z) === B.AIR) path = this.mat.cobble;
    c.set(x, y, z, path);
    for (let dy = 1; dy <= 3; dy++) {
      const above = c.get(x, y + dy, z);
      if (above !== B.AIR && above !== -1) c.set(x, y + dy, z, B.AIR);
    }
  }

  private buildRoad(c: GenCanvas, r: Rect): void {
    const xa = Math.max(r.x0, c.bx);
    const xb = Math.min(r.x1, c.bx + 15);
    const za = Math.max(r.z0, c.bz);
    const zb = Math.min(r.z1, c.bz + 15);
    for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) this.pathCell(c, x, z);
  }

  private buildWell(c: GenCanvas): void {
    const m = this.mat;
    const p = new Piece(c, this.x - 3, this.y, this.z - 3, 0);
    // dalle de 6 × 6 au niveau du sol, dégagée au-dessus, fondée dessous
    for (let w = 0; w < 6; w++) {
      for (let u = 0; u < 6; u++) {
        p.fill(u, 1, w, u, 6, w, B.AIR);
        p.set(u, 0, w, m.cobble);
        p.pillarDown(u, -1, w, m.cobble);
      }
    }
    // margelle, puits de 2 × 2 rempli d'eau sur 4 blocs
    p.fill(1, -4, 1, 4, 1, 4, m.cobble);
    p.fill(2, -3, 2, 3, 0, 3, B.WATER);
    p.fill(2, 1, 2, 3, 1, 3, B.AIR);
    // quatre poteaux et un toit
    for (const [u, w] of [[1, 1], [1, 4], [4, 1], [4, 4]]) p.fill(u, 2, w, u, 3, w, B.OAK_FENCE);
    p.fill(1, 4, 1, 4, 4, 4, m.cobble);
  }

  private buildLamp(c: GenCanvas, l: Lamp): void {
    if (!c.touches(l.x - 1, l.z - 1, l.x + 1, l.z + 1)) return;
    const y = this.t.terrainTop(l.x, l.z);
    if (y < SEA_LEVEL) return;
    const p = new Piece(c, l.x, y, l.z, 0);
    p.fill(0, 1, 0, 0, 3, 0, B.OAK_FENCE);
    p.set(0, 4, 0, B.WOOL_BLACK);
    p.torch(0, 4, 1, 0);
    p.torch(-1, 4, 0, 1);
    p.torch(0, 4, -1, 2);
    p.torch(1, 4, 0, 3);
  }

  /**
   * Prépare le terrain d'un bâtiment : fondations sous l'emprise, air au-dessus, et tablier
   * de chemin devant la porte.
   */
  private prepare(p: Piece, w: number, d: number, height: number, door: number, field: boolean): void {
    const m = this.mat;
    for (let cw = 0; cw < d; cw++) {
      for (let cu = 0; cu < w; cu++) {
        p.fill(cu, 1, cw, cu, height, cw, B.AIR);
        p.pillarDown(cu, -1, cw, field ? B.DIRT : m.cobble);
        // sous le plancher : jamais de vide ni de sable qui s'écroulerait
        if (p.get(cu, -1, cw) === B.SAND || p.get(cu, -1, cw) === B.GRAVEL) p.set(cu, -1, cw, m.cobble);
      }
    }
    // tablier : la cellule devant la porte rejoint le chemin
    const x = p.x(door, -1);
    const z = p.z(door, -1);
    if (!p.c.inside(x, z)) return;
    const y = groundY(p.c, x, z);
    if (y < 1) return;
    if (y < p.oy) {
      // sol plus bas que le plancher : marche d'accès
      p.c.pillarDown(x, p.oy - 1, z, m.cobble);
      p.stairs(door, 0, -1, m.cobbleStairs, 0);
    } else {
      p.fill(door, 1, -1, door, 3, -1, B.AIR);
      p.set(door, 0, -1, m.path);
    }
  }
}

/** Position de la porte le long de la façade. */
function doorU(type: BuildingType): number {
  switch (type) {
    case 'house': return 2;
    case 'hut': return 1;
    case 'large_house': return 4;
    case 'library': return 4;
    case 'church': return 2;
    case 'smithy': return 7;
    case 'butcher': return 4;
    default: return 3;
  }
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Murs d'une pièce : poteaux aux angles, parois entre eux. */
function shell(p: Piece, w: number, d: number, v0: number, v1: number, wall: number, post: number): void {
  p.walls(0, v0, 0, w - 1, v1, d - 1, wall);
  for (const [u, cw] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]]) p.fill(u, v0, cw, u, v1, cw, post);
}

/**
 * Toit à deux pans, faîtage parallèle à la façade. `v` est le haut des murs : l'avant-toit
 * déborde d'un bloc devant et derrière à cette hauteur, puis chaque rang monte d'un bloc.
 */
function gableRoof(p: Piece, m: Materials, w: number, d: number, v: number): void {
  const half = Math.floor((d + 2) / 2);
  for (let i = 0; i < half; i++) {
    const front = i - 1;
    const back = d - i;
    for (let u = 0; u < w; u++) {
      p.stairs(u, v + i, front, m.stairs, 0);
      p.stairs(u, v + i, back, m.stairs, 2);
    }
    // pignons : planches sous les rangs suivants
    if (i > 0 && front + 1 <= back - 1) {
      p.fill(0, v + i, front + 1, 0, v + i, back - 1, m.planks);
      p.fill(w - 1, v + i, front + 1, w - 1, v + i, back - 1, m.planks);
    }
  }
  if ((d + 2) % 2 === 1) p.fill(0, v + half, half - 1, w - 1, v + half, half - 1, m.planks);
}

const BUILDERS: Record<BuildingType, (p: Piece, m: Materials, seed: number) => void> = {
  /** Petite maison à toit plat (« House4Garden »), parfois avec une terrasse clôturée. */
  house(p, m, seed) {
    const r = lcg(seed);
    p.fill(0, 0, 0, 4, 0, 4, m.cobble);
    shell(p, 5, 5, 1, 3, m.planks, m.cobble);
    p.fill(0, 4, 0, 4, 4, 4, m.planks);
    p.walls(0, 4, 0, 4, 4, 4, m.log, 0);
    p.door(2, 1, 0, B.OAK_DOOR, 0);
    p.set(0, 2, 2, B.GLASS_PANE);
    p.set(4, 2, 2, B.GLASS_PANE);
    p.set(2, 2, 4, B.GLASS_PANE);
    p.torch(2, 3, 1, 0);
    if (r() < 0.5) {
      p.walls(0, 5, 0, 4, 5, 4, B.OAK_FENCE);
      // échelle intérieure contre le mur du fond, trappe dans le toit
      for (let v = 1; v <= 4; v++) p.ladder(3, v, 3, 2);
    }
    p.spawn('villager', 2, 1, 2, { profession: PROFESSION.house });
  },

  /** Hutte de rondins (« WoodHut »). */
  hut(p, m) {
    p.fill(0, 0, 0, 3, 0, 4, m.cobble);
    shell(p, 4, 5, 1, 3, m.planks, m.log);
    p.fill(0, 4, 0, 3, 4, 4, m.log);
    p.fill(1, 4, 1, 2, 4, 3, m.planks);
    p.door(1, 1, 0, B.OAK_DOOR, 0);
    p.set(0, 2, 2, B.GLASS_PANE);
    p.set(3, 2, 2, B.GLASS_PANE);
    p.torch(2, 3, 3, 2);
    p.spawn('villager', 2, 1, 2, { profession: PROFESSION.hut });
  },

  /** Grande maison à toit à deux pans (« House3 »). */
  large_house(p, m) {
    largeShell(p, m);
    p.spawn('villager', 4, 1, 3, { profession: PROFESSION.large_house });
  },

  /** Bibliothèque (« House1 ») : rangées de bibliothèques, établi, sièges. */
  library(p, m) {
    largeShell(p, m);
    p.fill(1, 3, 4, 7, 3, 4, B.BOOKSHELF);
    p.fill(1, 1, 4, 3, 1, 4, B.BOOKSHELF);
    p.set(7, 1, 1, B.CRAFTING_TABLE);
    p.stairs(5, 1, 4, m.stairs, 0);
    p.stairs(6, 1, 4, m.stairs, 0);
    p.spawn('villager', 4, 1, 2, { profession: PROFESSION.library });
  },

  /** Église : nef basse, clocher au fond avec une échelle jusqu'au sommet. */
  church(p, m) {
    p.fill(0, 0, 0, 4, 0, 8, m.cobble);
    p.walls(0, 1, 0, 4, 4, 8, m.cobble);
    p.fill(0, 5, 0, 4, 5, 3, m.cobble);
    // clocher : étage à v = 5, toit crénelé à v = 10
    p.walls(0, 5, 4, 4, 9, 8, m.cobble);
    p.fill(1, 5, 5, 3, 5, 7, m.cobble);
    p.fill(0, 10, 4, 4, 10, 8, m.cobble);
    for (const [u, w] of [[0, 4], [4, 4], [0, 8], [4, 8], [2, 4], [2, 8], [0, 6], [4, 6]]) p.set(u, 11, w, m.cobble);
    p.door(2, 1, 0, B.OAK_DOOR, 0);
    for (const w of [2, 6]) {
      for (const v of [2, 3]) {
        p.set(0, v, w, B.GLASS_PANE);
        p.set(4, v, w, B.GLASS_PANE);
      }
    }
    p.set(0, 7, 6, B.GLASS_PANE);
    p.set(4, 7, 6, B.GLASS_PANE);
    p.set(2, 7, 8, B.GLASS_PANE);
    // autel de part et d'autre de l'échelle, qui traverse l'étage et le toit
    p.set(1, 1, 7, m.cobble);
    p.set(3, 1, 7, m.cobble);
    for (let v = 1; v <= 10; v++) p.ladder(2, v, 7, 2);
    p.torch(2, 3, 1, 0);
    p.torch(2, 8, 5, 0);
    p.spawn('villager', 2, 1, 3, { profession: PROFESSION.church });
  },

  /** Forge (« House2 ») : auvent de pierre avec fourneaux et bassin de lave, atelier avec un coffre. */
  smithy(p, m) {
    p.fill(0, 0, 0, 9, 0, 6, m.cobble);
    // atelier fermé (droite) : tout en pierre, la lave est à côté
    p.walls(4, 1, 0, 9, 3, 6, m.cobble);
    p.door(7, 1, 0, B.OAK_DOOR, 0);
    p.set(9, 2, 3, B.GLASS_PANE);
    p.set(6, 2, 6, B.GLASS_PANE);
    p.set(8, 2, 6, B.GLASS_PANE);
    p.chest(8, 1, 5, 2, 'blacksmith');
    p.torch(7, 3, 1, 0);
    // auvent (gauche) : piliers, bassin de lave bordé de pierre, deux fourneaux au fond.
    // La lave reste à 2 blocs au moins de tout ce qui brûle : le feu ne sort pas de la forge.
    for (const [u, w] of [[0, 0], [0, 6]]) p.fill(u, 1, w, u, 3, w, m.cobble);
    p.fill(1, 1, 2, 3, 1, 5, m.cobble);
    p.fill(2, 1, 3, 2, 1, 4, B.LAVA);
    p.facing(1, 1, 6, B.FURNACE, 2);
    p.facing(2, 1, 6, B.FURNACE, 2);
    // toit de dalles sur l'ensemble
    p.fill(0, 4, 0, 9, 4, 6, m.slab);
    p.spawn('villager', 6, 1, 3, { profession: PROFESSION.smithy });
  },

  /** Boucherie (« Hall ») : grande salle et enclos à l'arrière. */
  butcher(p, m) {
    p.fill(0, 0, 0, 8, 0, 3, m.cobble);
    shell(p, 9, 4, 1, 3, m.planks, m.log);
    p.fill(0, 1, 0, 8, 1, 0, m.cobble);
    p.fill(0, 4, 0, 8, 4, 3, m.planks);
    p.walls(0, 4, 0, 8, 4, 3, m.log);
    p.door(4, 1, 0, B.OAK_DOOR, 0);
    p.set(2, 2, 0, B.GLASS_PANE);
    p.set(6, 2, 0, B.GLASS_PANE);
    p.set(0, 2, 2, B.GLASS_PANE);
    p.set(8, 2, 2, B.GLASS_PANE);
    // comptoir : dalles doubles
    p.fill(6, 1, 1, 7, 1, 1, B.STONE_SLAB, 2);
    p.torch(4, 3, 1, 0);
    // porte du fond et enclos clôturé
    p.door(2, 1, 3, B.OAK_DOOR, 0);
    p.fill(0, 0, 4, 8, 0, 6, B.GRASS);
    p.walls(0, 1, 4, 8, 1, 6, B.OAK_FENCE);
    p.fill(1, 1, 4, 7, 1, 4, B.AIR);
    p.spawn('villager', 4, 1, 2, { profession: PROFESSION.butcher });
  },

  /** Champ (« Field2 ») : deux bandes de culture de part et d'autre d'une rigole. */
  farm(p, m, seed) {
    const r = lcg(seed);
    const crops = [B.WHEAT, B.WHEAT, B.CARROTS, B.POTATOES];
    p.walls(0, 0, 0, 6, 0, 8, m.log);
    p.fill(1, 0, 1, 5, 0, 7, B.FARMLAND, 7);
    p.fill(3, 0, 1, 3, 0, 7, B.WATER);
    for (const band of [1, 4]) {
      const crop = crops[Math.floor(r() * crops.length)];
      for (let w = 1; w <= 7; w++) {
        for (let u = band; u <= band + 1; u++) p.set(u, 1, w, crop, 2 + Math.floor(r() * 6));
      }
    }
    p.spawn('villager', 3, 1, -1, { profession: PROFESSION.farm });
  },
};

/** Coque commune de la grande maison et de la bibliothèque (9 × 6, toit à deux pans). */
function largeShell(p: Piece, m: Materials): void {
  p.fill(0, 0, 0, 8, 0, 5, m.cobble);
  shell(p, 9, 6, 1, 3, m.planks, m.log);
  p.walls(0, 1, 0, 8, 1, 5, m.cobble);
  for (const [u, w] of [[0, 0], [8, 0], [0, 5], [8, 5]]) p.fill(u, 1, w, u, 3, w, m.log);
  p.door(4, 1, 0, B.OAK_DOOR, 0);
  for (const u of [2, 6]) {
    p.set(u, 2, 0, B.GLASS_PANE);
    p.set(u, 2, 5, B.GLASS_PANE);
  }
  p.set(0, 2, 2, B.GLASS_PANE);
  p.set(0, 2, 3, B.GLASS_PANE);
  p.set(8, 2, 2, B.GLASS_PANE);
  p.set(8, 2, 3, B.GLASS_PANE);
  gableRoof(p, m, 9, 6, 3);
  p.torch(4, 3, 1, 0);
  p.torch(4, 3, 4, 2);
}

registerStructure('village', {
  spacing: 14,
  separation: 5,
  salt: 0x0a11a6e5,
  reach: 72,
  create(t, x, z, rng) {
    const biome = t.biomeAt(x, z);
    const mat = biome === BIOME.PLAINS ? OAK : biome === BIOME.SAVANNA ? ACACIA : biome === BIOME.DESERT ? SANDSTONE : null;
    if (!mat) return null;
    const y = t.terrainTop(x, z);
    if (y < SEA_LEVEL + 1 || y > 90) return null;
    // terrain à peu près plat et hors de l'eau autour du puits
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = t.terrainTop(Math.round(x + Math.cos(a) * 20), Math.round(z + Math.sin(a) * 20));
      if (h < SEA_LEVEL || Math.abs(h - y) > 7) return null;
    }
    const v = new Village(t, x, y, z, mat, rng);
    // trop peu de place pour bâtir : pas de village
    return v.size >= 4 ? v : null;
  },
});
