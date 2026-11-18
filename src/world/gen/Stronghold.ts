/**
 * Forts souterrains (Minecraft 1.12, « stronghold ») : un dédale de briques de pierre enfoui
 * sous terre. Un escalier en colimaçon, des couloirs, des carrefours, une bibliothèque, une
 * prison, une fontaine, une réserve, et surtout la salle du portail de l'End : douze cadres
 * autour d'un bassin de lave, gardés par une cage à poissons d'argent.
 *
 * Le plan se déduit de la graine. Le chemin principal (escalier → deux carrefours → salle du
 * portail) est toujours construit ; les salles annexes s'y greffent là où la place est libre.
 * Chaque chunk rejoue le plan et n'en garde que sa part ; le choix de chaque brique (lisse,
 * moussue, fissurée) dépend de sa position, pour raccorder d'un chunk à l'autre.
 *
 * Écarts avec Minecraft : un seul niveau (hormis l'escalier d'entrée), pas de portes ni de
 * blocs infestés, et un fort par case de 768 blocs au lieu des anneaux autour de l'origine.
 *
 * Module pur.
 */
import { B } from '../Ids';
import { DIR_DX, DIR_DZ, Piece, type GenCanvas } from './GenCanvas';
import { hash3 } from './Noise';
import { registerStructure, type Structure, type TerrainInfo } from './Structures';

type RoomKind = 'start' | 'corridor' | 'crossing' | 'portal' | 'library' | 'prison' | 'fountain' | 'store';

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

interface Room extends Box {
  kind: RoomKind;
  /** Centre du sol à l'entrée, direction (0 sud, 1 ouest, 2 nord, 3 est) et longueur. */
  x: number;
  z: number;
  dir: number;
  len: number;
}

/** Demi-largeur, longueur et hauteur (au-dessus du sol) de l'enveloppe de chaque pièce. */
const SIZE: Record<RoomKind, { half: number; len: number; top: number }> = {
  start: { half: 2, len: 5, top: 13 },
  corridor: { half: 2, len: 0, top: 4 },
  crossing: { half: 3, len: 7, top: 6 },
  portal: { half: 5, len: 16, top: 7 },
  library: { half: 4, len: 11, top: 6 },
  prison: { half: 4, len: 9, top: 4 },
  fountain: { half: 4, len: 9, top: 6 },
  store: { half: 3, len: 7, top: 4 },
};

/** Nombre de marches de l'escalier en colimaçon (deux par bloc de hauteur). */
const SPIRAL_STEPS = 20;
/** Cellules du colimaçon, autour de la colonne centrale. */
const SPIRAL: ReadonlyArray<readonly [number, number]> = [[-1, 1], [0, 1], [1, 1], [1, 2], [1, 3], [0, 3], [-1, 3], [-1, 2]];

/** Probabilité qu'un cadre du portail porte déjà son œil (Minecraft : 10 %). */
const EYE_CHANCE = 0.1;

function intersects(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;
}

export class Stronghold implements Structure {
  readonly kind = 'stronghold' as const;
  readonly surface = false;
  /** Hauteur où l'on marche (le sol de briques est un bloc plus bas). */
  readonly y: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Centre du portail : la cellule du milieu de l'anneau de cadres. */
  portalX = 0;
  portalY = 0;
  portalZ = 0;
  /** Direction dans laquelle on entre dans la salle du portail (0 sud, 1 ouest, 2 nord, 3 est). */
  portalDir = 0;
  private readonly rooms: Room[] = [];
  private readonly seed: number;
  private readonly floor: number;

  constructor(t: TerrainInfo, readonly x: number, readonly z: number, rng: () => number) {
    this.seed = (t.seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ 0x57f0) >>> 0;
    this.x0 = this.x1 = x;
    this.z0 = this.z1 = z;
    // assez profond pour que tout le fort reste sous la roche, où que mènent ses couloirs
    let minTop = 255;
    for (let dz = -96; dz <= 96; dz += 32) {
      for (let dx = -96; dx <= 96; dx += 32) minTop = Math.min(minTop, t.terrainTop(x + dx, z + dz));
    }
    this.floor = Math.max(11, Math.min(34, minTop - 28));
    this.y = this.floor + 1;

    // --- chemin principal : escalier, couloir, carrefour, couloir, carrefour, couloir, salle du portail ---
    const d0 = Math.floor(rng() * 4);
    this.add('start', x - DIR_DX[d0] * 2, z - DIR_DZ[d0] * 2, d0, 0);
    let px = x + DIR_DX[d0] * 3;
    let pz = z + DIR_DZ[d0] * 3;
    let dir = d0;
    const crossings: Array<{ room: Room; taken: number }> = [];
    for (let leg = 0; leg < 3; leg++) {
      const len = 10 + Math.floor(rng() * 9);
      this.add('corridor', px, pz, dir, len);
      px += DIR_DX[dir] * len;
      pz += DIR_DZ[dir] * len;
      if (leg === 2) break;
      const room = this.add('crossing', px, pz, dir, 0);
      // sortie du chemin principal : tout droit, ou un quart de tour (jamais de demi-tour vers l'entrée)
      let turn = Math.floor(rng() * 3) - 1;
      if (((dir + turn + 4) & 3) === ((d0 + 2) & 3)) turn = 0;
      crossings.push({ room, taken: turn });
      const exit = this.exitOf(room, turn);
      px = exit.x;
      pz = exit.z;
      dir = exit.dir;
    }
    const portal = this.add('portal', px, pz, dir, 0);
    this.portalX = portal.x + DIR_DX[dir] * 10;
    this.portalZ = portal.z + DIR_DZ[dir] * 10;
    this.portalY = this.floor + 3;
    this.portalDir = dir;

    // --- salles annexes aux sorties restées libres des carrefours ---
    const extras: RoomKind[] = ['library', 'prison', 'fountain', 'store'];
    for (let i = extras.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [extras[i], extras[j]] = [extras[j], extras[i]];
    }
    let next = 0;
    for (const c of crossings) {
      for (const turn of [-1, 0, 1]) {
        if (turn === c.taken) continue;
        const exit = this.exitOf(c.room, turn);
        const len = 6 + Math.floor(rng() * 6);
        const kind = extras[next % extras.length];
        const corridor = this.boxOf('corridor', exit.x, exit.z, exit.dir, len);
        const rx = exit.x + DIR_DX[exit.dir] * len;
        const rz = exit.z + DIR_DZ[exit.dir] * len;
        const room = this.boxOf(kind, rx, rz, exit.dir, 0);
        if (!this.free(corridor) || !this.free(room)) {
          // sortie condamnée : le mur du carrefour reste plein de ce côté
          continue;
        }
        this.rooms.push(corridor, room);
        this.grow(corridor);
        this.grow(room);
        next++;
      }
    }
  }

  private boxOf(kind: RoomKind, x: number, z: number, dir: number, len: number): Room {
    const s = SIZE[kind];
    const l = kind === 'corridor' ? len : s.len;
    const ex = x + DIR_DX[dir] * (l - 1);
    const ez = z + DIR_DZ[dir] * (l - 1);
    const lx = Math.abs(DIR_DX[(dir + 1) & 3]) * s.half;
    const lz = Math.abs(DIR_DZ[(dir + 1) & 3]) * s.half;
    return {
      kind, x, z, dir, len: l,
      x0: Math.min(x, ex) - lx, x1: Math.max(x, ex) + lx,
      z0: Math.min(z, ez) - lz, z1: Math.max(z, ez) + lz,
      y0: this.floor - 1, y1: this.floor + s.top,
    };
  }

  private free(b: Box): boolean {
    for (const r of this.rooms) if (intersects(b, r)) return false;
    return true;
  }

  private grow(b: Box): void {
    if (b.x0 < this.x0) this.x0 = b.x0;
    if (b.z0 < this.z0) this.z0 = b.z0;
    if (b.x1 > this.x1) this.x1 = b.x1;
    if (b.z1 > this.z1) this.z1 = b.z1;
  }

  private add(kind: RoomKind, x: number, z: number, dir: number, len: number): Room {
    const r = this.boxOf(kind, x, z, dir, len);
    this.rooms.push(r);
    this.grow(r);
    return r;
  }

  /** Point d'entrée et direction de la pièce qui suit la sortie d'un carrefour (-1 gauche, 0 tout droit, 1 droite). */
  private exitOf(c: Room, turn: number): { x: number; z: number; dir: number } {
    if (turn === 0) return { x: c.x + DIR_DX[c.dir] * 7, z: c.z + DIR_DZ[c.dir] * 7, dir: c.dir };
    // directions du jeu : 0 sud, 1 ouest, 2 nord, 3 est ; +1 = un quart de tour vers la droite locale (−u)
    const dir = (c.dir + (turn < 0 ? 3 : 1)) & 3;
    const mx = c.x + DIR_DX[c.dir] * 3;
    const mz = c.z + DIR_DZ[c.dir] * 3;
    return { x: mx + DIR_DX[dir] * 4, z: mz + DIR_DZ[dir] * 4, dir };
  }

  /** Les sorties latérales d'un carrefour qui mènent quelque part : 1 = côté −u, 2 = côté +u, 4 = tout droit. */
  private openExits(c: Room): number {
    let mask = 0;
    for (const turn of [-1, 0, 1]) {
      const e = this.exitOf(c, turn);
      for (const r of this.rooms) {
        if (r !== c && r.x === e.x && r.z === e.z && r.dir === e.dir) {
          mask |= turn === 0 ? 4 : turn < 0 ? 2 : 1;
          break;
        }
      }
    }
    return mask;
  }

  covers(x: number, z: number): boolean {
    for (const r of this.rooms) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
    return false;
  }

  build(c: GenCanvas): void {
    for (const r of this.rooms) {
      if (!c.touches(r.x0, r.z0, r.x1, r.z1)) continue;
      const p = new Piece(c, r.x, this.floor, r.z, r.dir);
      const s = SIZE[r.kind];
      // enveloppe de briques, sol et plafond compris
      this.bricks(p, -s.half, -1, 0, s.half, s.top, r.len - 1);
      switch (r.kind) {
        case 'start':
          this.start(p);
          break;
        case 'corridor':
          this.corridor(p, r.len);
          break;
        case 'crossing':
          this.crossing(p, this.openExits(r));
          break;
        case 'portal':
          this.portal(p);
          break;
        case 'library':
          this.library(p);
          break;
        case 'prison':
          this.prison(p);
          break;
        case 'fountain':
          this.fountain(p);
          break;
        default:
          this.store(p);
          break;
      }
    }
  }

  /** Brique de pierre lisse, moussue ou fissurée selon la position (la même d'un chunk à l'autre). */
  private brickAt(x: number, y: number, z: number): number {
    const h = hash3(x, y, z, this.seed) % 100;
    return h < 62 ? B.STONE_BRICKS : h < 82 ? B.MOSSY_STONE_BRICKS : B.CRACKED_STONE_BRICKS;
  }

  private bricks(p: Piece, u0: number, v0: number, w0: number, u1: number, v1: number, w1: number): void {
    for (let v = v0; v <= v1; v++) {
      for (let w = w0; w <= w1; w++) {
        for (let u = u0; u <= u1; u++) {
          const x = p.x(u, w);
          const z = p.z(u, w);
          if (p.c.inside(x, z)) p.c.set(x, p.oy + v, z, this.brickAt(x, p.oy + v, z));
        }
      }
    }
  }

  /** Passage de 3 de large et 3 de haut dans le mur du fond de l'entrée (w = 0). */
  private doorway(p: Piece): void {
    p.fill(-1, 1, 0, 1, 3, 0, B.AIR);
  }

  /** Escalier en colimaçon : il monte de 10 blocs autour d'une colonne et s'arrête sous la roche. */
  private start(p: Piece): void {
    p.fill(-1, 1, 1, 1, 12, 3, B.AIR);
    // la sortie vers le fort est au fond (w = 4)
    p.fill(-1, 1, 4, 1, 3, 4, B.AIR);
    for (let v = 1; v <= 12; v++) p.set(0, v, 2, this.brickAt(p.x(0, 2), p.oy + v, p.z(0, 2)));
    for (let i = 0; i < SPIRAL_STEPS; i++) {
      const [u, w] = SPIRAL[i % SPIRAL.length];
      const v = 1 + (i >> 1);
      if (i & 1) p.set(u, v, w, B.STONE_BRICKS);
      else p.set(u, v, w, B.STONE_BRICK_SLAB, 0);
    }
    p.torch(-1, 3, 1, 0);
  }

  private corridor(p: Piece, len: number): void {
    p.fill(-1, 1, 0, 1, 3, len - 1, B.AIR);
    for (let w = 3; w < len - 1; w += 7) {
      if ((w / 7) & 1) p.torch(1, 2, w, 1);
      else p.torch(-1, 2, w, 3);
    }
  }

  /** Carrefour : salle carrée de 5 × 5, ouverte sur les sorties qui mènent quelque part. */
  private crossing(p: Piece, exits: number): void {
    p.fill(-2, 1, 1, 2, 5, 5, B.AIR);
    this.doorway(p);
    if (exits & 4) p.fill(-1, 1, 6, 1, 3, 6, B.AIR);
    if (exits & 1) p.fill(-3, 1, 2, -3, 3, 4, B.AIR);
    if (exits & 2) p.fill(3, 1, 2, 3, 3, 4, B.AIR);
    p.torch(-2, 4, 1, 0);
    p.torch(2, 4, 5, 2);
  }

  /**
   * Salle du portail : un perron de trois marches mène à l'estrade où douze cadres entourent
   * un bassin de lave. La cage à poissons d'argent est en haut des marches.
   */
  private portal(p: Piece): void {
    p.fill(-4, 1, 1, 4, 6, 14, B.AIR);
    this.doorway(p);
    // grille d'entrée : barreaux de part et d'autre du passage
    p.fill(-1, 3, 0, 1, 3, 0, B.IRON_BARS);
    // rigoles de lave le long des murs
    for (const u of [-4, 4]) p.fill(u, 0, 9, u, 0, 13, B.LAVA);
    // perron
    for (let s = 0; s < 3; s++) {
      const w = 4 + s;
      if (s > 0) this.bricks(p, -1, 1, w, 1, s, w);
      for (let u = -1; u <= 1; u++) p.stairs(u, 1 + s, w, B.STONE_BRICK_STAIRS, 0);
    }
    p.spawner(0, 3, 6, 'silverfish');
    // estrade
    this.bricks(p, -3, 1, 7, 3, 3, 14);
    p.fill(-1, 1, 9, 1, 1, 11, B.LAVA);
    p.fill(-1, 2, 9, 1, 3, 11, B.AIR);
    // anneau de cadres, chacun tourné vers le centre
    const ring: Array<[number, number, number]> = [];
    for (let i = -1; i <= 1; i++) {
      ring.push([i, 8, 0], [i, 12, 2], [-2, 10 + i, 3], [2, 10 + i, 1]);
    }
    for (const [u, w, facing] of ring) {
      const x = p.x(u, w);
      const z = p.z(u, w);
      const eye = hash3(x, 77, z, this.seed) % 1000 < EYE_CHANCE * 1000;
      p.set(u, 3, w, B.END_PORTAL_FRAME, p.dir(facing) | (eye ? 4 : 0));
    }
    p.torch(-4, 4, 3, 3);
    p.torch(4, 4, 3, 1);
    p.torch(-4, 5, 13, 3);
    p.torch(4, 5, 13, 1);
  }

  /** Bibliothèque : rayonnages le long des murs et en îlots, toiles d'araignée, un coffre. */
  private library(p: Piece): void {
    p.fill(-3, 1, 1, 3, 5, 9, B.AIR);
    this.doorway(p);
    for (let w = 1; w <= 9; w++) {
      if (w % 4 === 1) continue;
      for (const u of [-3, 3]) p.fill(u, 1, w, u, 3, w, B.BOOKSHELF);
    }
    for (const w of [3, 4, 6, 7]) {
      for (const u of [-1, 1]) p.fill(u, 1, w, u, 2, w, B.BOOKSHELF);
    }
    for (const [u, w] of [[-3, 1], [3, 9], [3, 5], [-1, 9]] as const) p.set(u, 5, w, B.COBWEB);
    p.torch(0, 3, 9, 2);
    p.chest(0, 1, 9, 2, 'stronghold_library');
  }

  /** Prison : un couloir et deux cellules fermées de barreaux, où l'on entre par un vide dans la grille. */
  private prison(p: Piece): void {
    p.fill(-3, 1, 1, 3, 3, 7, B.AIR);
    this.doorway(p);
    p.fill(1, 1, 1, 1, 3, 7, B.IRON_BARS);
    this.bricks(p, 1, 1, 4, 3, 3, 4);
    // une ouverture dans chaque grille
    p.fill(1, 1, 2, 1, 2, 2, B.AIR);
    p.fill(1, 1, 6, 1, 2, 6, B.AIR);
    p.torch(-3, 2, 4, 3);
  }

  /** Fontaine : une margelle de dalles autour d'une source. */
  private fountain(p: Piece): void {
    p.fill(-3, 1, 1, 3, 5, 7, B.AIR);
    this.doorway(p);
    for (let w = 3; w <= 5; w++) {
      for (let u = -1; u <= 1; u++) p.set(u, 1, w, B.STONE_BRICK_SLAB, 0);
    }
    p.set(0, 1, 4, B.WATER);
    for (const [u, w] of [[-3, 1], [3, 1], [-3, 7], [3, 7]] as const) p.fill(u, 1, w, u, 4, w, B.STONE_BRICKS);
    p.torch(-2, 3, 1, 3);
    p.torch(2, 3, 7, 1);
  }

  /** Réserve : une petite salle et son coffre. */
  private store(p: Piece): void {
    p.fill(-2, 1, 1, 2, 3, 5, B.AIR);
    this.doorway(p);
    p.chest(0, 1, 5, 2, 'stronghold_corridor');
    p.torch(-2, 2, 3, 3);
    p.torch(2, 2, 3, 1);
  }
}

/** Distance minimale d'un fort à l'origine du monde, en blocs. */
const MIN_DISTANCE = 320;

registerStructure('stronghold', {
  spacing: 48,
  separation: 12,
  salt: 0x57a09e0d,
  reach: 150,
  create(t, x, z, rng) {
    if (x * x + z * z < MIN_DISTANCE * MIN_DISTANCE) return null;
    return new Stronghold(t, x, z, rng);
  },
});
