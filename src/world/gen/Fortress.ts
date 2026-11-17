/**
 * Forteresses du Nether (Minecraft 1.12) : un carrefour central d'où partent quatre ailes
 * de briques du Nether — ponts à ciel ouvert sur piliers au-dessus de la lave, couloirs
 * fermés à fenêtres grillagées — qui s'achèvent sur une plate-forme à blazes (une cage
 * entourée de barrières), une salle où poussent des verrues du Nether, ou un coffre.
 *
 * Le plan se déduit de la graine. Chaque chunk le rejoue et n'en garde que sa part.
 * Les squelettes wither et les blazes apparaissent sur les briques (voir entity/Spawner).
 *
 * Écarts avec Minecraft : plan plus simple (pas d'escaliers ni de niveaux multiples).
 *
 * Module pur.
 */
import { B } from '../Ids';
import { DIR_DX, DIR_DZ, Piece, type GenCanvas } from './GenCanvas';
import { registerStructure, type Structure } from './Structures';

type PartKind = 'cross' | 'bridge' | 'corridor' | 'blaze' | 'wart' | 'vault';

interface Part {
  kind: PartKind;
  /** Centre du sol à l'entrée, direction, longueur. */
  x: number;
  z: number;
  dir: number;
  len: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Hauteur du sol de la forteresse : au milieu de la grande caverne, bien au-dessus de la lave. */
export const FORTRESS_FLOOR_Y = 64;
const FLOOR_Y = FORTRESS_FLOOR_Y;
const BRICK = B.NETHER_BRICKS;
const FENCE = B.NETHER_BRICK_FENCE;

function partBounds(x: number, z: number, dir: number, len: number, half: number): { x0: number; z0: number; x1: number; z1: number } {
  const ex = x + DIR_DX[dir] * (len - 1);
  const ez = z + DIR_DZ[dir] * (len - 1);
  const lx = Math.abs(DIR_DX[(dir + 1) & 3]) * half;
  const lz = Math.abs(DIR_DZ[(dir + 1) & 3]) * half;
  return { x0: Math.min(x, ex) - lx, x1: Math.max(x, ex) + lx, z0: Math.min(z, ez) - lz, z1: Math.max(z, ez) + lz };
}

class Fortress implements Structure {
  readonly kind = 'fortress' as const;
  readonly surface = false;
  readonly y = FLOOR_Y;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  private readonly parts: Part[] = [];

  constructor(readonly x: number, readonly z: number, rng: () => number) {
    this.x0 = this.x1 = x;
    this.z0 = this.z1 = z;
    // carrefour central de 7 × 7
    this.add('cross', x, z - 3, 0, 7, 3);
    // ce qui attend au bout des quatre ailes : au moins une plate-forme à blazes et une salle des verrues
    const ends: PartKind[] = ['blaze', 'wart', 'blaze', 'vault'];
    for (let i = ends.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ends[i], ends[j]] = [ends[j], ends[i]];
    }
    for (let d = 0; d < 4; d++) this.wing(x + DIR_DX[d] * 4, z + DIR_DZ[d] * 4, d, 2 + Math.floor(rng() * 3), ends[d], rng, true);
  }

  private add(kind: PartKind, x: number, z: number, dir: number, len: number, half: number): void {
    const b = partBounds(x, z, dir, len, half);
    this.parts.push({ kind, x, z, dir, len, ...b });
    if (b.x0 < this.x0) this.x0 = b.x0;
    if (b.z0 < this.z0) this.z0 = b.z0;
    if (b.x1 > this.x1) this.x1 = b.x1;
    if (b.z1 > this.z1) this.z1 = b.z1;
  }

  /** Aile : une suite de ponts et de couloirs, parfois une aile de traverse, puis la pièce du bout. */
  private wing(x: number, z: number, dir: number, segments: number, end: PartKind, rng: () => number, main: boolean): void {
    const ax = DIR_DX[dir];
    const az = DIR_DZ[dir];
    for (let s = 0; s < segments; s++) {
      const len = 12 + Math.floor(rng() * 9);
      this.add(rng() < 0.55 ? 'bridge' : 'corridor', x, z, dir, len, 2);
      x += ax * len;
      z += az * len;
      if (main && s < segments - 1 && rng() < 0.45) {
        // carrefour, puis une aile de traverse plus courte
        this.add('cross', x, z, dir, 7, 3);
        const side = rng() < 0.5 ? 1 : 3;
        const sd = (dir + side) & 3;
        const cx = x + ax * 3;
        const cz = z + az * 3;
        this.wing(cx + DIR_DX[sd] * 4, cz + DIR_DZ[sd] * 4, sd, 1 + Math.floor(rng() * 2), rng() < 0.5 ? 'vault' : 'blaze', rng, false);
        x += ax * 7;
        z += az * 7;
      }
    }
    this.add(end, x, z, dir, end === 'vault' ? 5 : 9, end === 'vault' ? 2 : 4);
  }

  /** Le point est-il dans l'emprise d'une pièce de la forteresse ? (apparition de ses gardiens) */
  covers(x: number, z: number): boolean {
    for (const p of this.parts) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return true;
    return false;
  }

  build(c: GenCanvas): void {
    for (const part of this.parts) {
      if (!c.touches(part.x0, part.z0, part.x1, part.z1)) continue;
      // local : u de part et d'autre de l'axe, w le long de l'axe
      const p = new Piece(c, part.x, FLOOR_Y, part.z, part.dir);
      switch (part.kind) {
        case 'cross':
          this.cross(p, part.len);
          break;
        case 'bridge':
          this.bridge(p, part.len);
          break;
        case 'corridor':
          this.corridor(p, part.len);
          break;
        case 'blaze':
          this.blazeRoom(p);
          break;
        case 'wart':
          this.wartRoom(p);
          break;
        default:
          this.vault(p);
          break;
      }
    }
  }

  /** Carrefour : dalle de 7 × 7 à ciel ouvert, parapets aux quatre angles. */
  private cross(p: Piece, len: number): void {
    p.fill(-3, 1, 0, 3, 6, len - 1, B.AIR);
    p.fill(-3, 0, 0, 3, 0, len - 1, BRICK);
    for (const u of [-3, 3]) {
      for (const w of [0, len - 1]) {
        p.fill(u, 1, w, u, 2, w, BRICK);
        p.pillarDown(u, -1, w, BRICK, 40);
      }
    }
    p.fill(-3, -1, 0, 3, -1, len - 1, BRICK);
  }

  /** Pont : tablier de 5 de large, parapets, un pilier double tous les 8 blocs. */
  private bridge(p: Piece, len: number): void {
    p.fill(-2, 1, 0, 2, 6, len - 1, B.AIR);
    p.fill(-2, 0, 0, 2, 0, len - 1, BRICK);
    p.fill(-2, 1, 0, -2, 1, len - 1, BRICK);
    p.fill(2, 1, 0, 2, 1, len - 1, BRICK);
    for (let w = 2; w < len; w += 8) {
      for (const u of [-2, 2]) {
        p.set(u, 2, w, FENCE);
        p.pillarDown(u, -1, w, BRICK, 44);
      }
      p.fill(-1, -1, w, 1, -1, w, BRICK);
    }
  }

  /** Couloir fermé : 3 de large, 4 de haut, fenêtres à barreaux tous les 4 blocs. */
  private corridor(p: Piece, len: number): void {
    p.fill(-2, 0, 0, 2, 5, len - 1, BRICK);
    p.fill(-1, 1, 0, 1, 4, len - 1, B.AIR);
    for (let w = 2; w < len - 1; w += 4) {
      for (const u of [-2, 2]) p.fill(u, 2, w, u, 3, w, FENCE);
    }
    for (let w = 2; w < len; w += 8) {
      for (const u of [-2, 2]) p.pillarDown(u, -1, w, BRICK, 44);
    }
  }

  /** Plate-forme à blazes : dalle de 9 × 9, estrade de trois marches, cage entourée de barrières. */
  private blazeRoom(p: Piece): void {
    p.fill(-4, 1, 0, 4, 8, 8, B.AIR);
    p.fill(-4, -1, 0, 4, 0, 8, BRICK);
    for (const u of [-4, 4]) for (const w of [0, 8]) p.pillarDown(u, -2, w, BRICK, 44);
    // parapet, ouvert du côté de l'arrivée
    p.walls(-4, 1, 0, 4, 1, 8, BRICK);
    p.fill(-1, 1, 0, 1, 1, 0, B.AIR);
    // estrade : deux gradins puis la cage
    p.fill(-3, 1, 2, 3, 1, 7, BRICK);
    p.fill(-2, 2, 3, 2, 2, 7, BRICK);
    p.walls(-2, 3, 3, 2, 3, 7, FENCE);
    p.fill(-1, 3, 3, 1, 3, 3, B.AIR);
    p.spawner(0, 3, 5, 'blaze');
  }

  /** Salle des verrues : pièce fermée, deux plates-bandes de sable des âmes plantées de verrues. */
  private wartRoom(p: Piece): void {
    p.fill(-4, -1, 0, 4, 6, 8, BRICK);
    p.fill(-3, 1, 1, 3, 5, 7, B.AIR);
    p.fill(-1, 1, 0, 1, 3, 0, B.AIR);
    for (const u of [-4, 4]) for (const w of [0, 8]) p.pillarDown(u, -2, w, BRICK, 44);
    for (const w of [3, 5]) for (const u of [-4, 4]) p.fill(u, 2, w, u, 3, w, FENCE);
    for (const u of [-3, -2, 2, 3]) {
      for (let w = 2; w <= 7; w++) {
        p.set(u, 0, w, B.SOUL_SAND);
        // stade de croissance tiré de la position : le même d'un chunk à l'autre
        p.set(u, 1, w, B.NETHER_WART, (Math.imul(p.x(u, w), 73856093) ^ Math.imul(p.z(u, w), 19349663)) >>> 30);
      }
    }
    p.chest(0, 1, 7, 2, 'fortress');
  }

  /** Cul-de-sac : un coffre au bout d'un couloir court. */
  private vault(p: Piece): void {
    p.fill(-2, 0, 0, 2, 5, 4, BRICK);
    p.fill(-1, 1, 0, 1, 4, 3, B.AIR);
    for (const u of [-2, 2]) p.pillarDown(u, -1, 2, BRICK, 44);
    p.chest(0, 1, 3, 2, 'fortress');
  }
}

registerStructure('fortress', {
  spacing: 16,
  separation: 4,
  salt: 0x0f047e55,
  reach: 150,
  create(_t, x, z, rng) {
    return new Fortress(x, z, rng);
  },
});
