/**
 * Temples (Minecraft 1.12) : la pyramide du désert et le temple de la jungle.
 *
 * Pyramide du désert : grande pyramide de grès flanquée de deux tours. Au centre du sol,
 * un bloc de terre cuite bleue ; dessous, un puits donne sur la salle du trésor : quatre
 * coffres autour d'une plaque de pression posée sur de la TNT. Marcher sur la plaque fait
 * tout sauter, comme dans Minecraft.
 *
 * Temple de la jungle : bâtisse de pierres moussues à deux niveaux. Un coffre attend au
 * sous-sol ; un second est caché derrière un bloc que retient un piston collant : il faut
 * abaisser le levier pour l'ouvrir. (Le piège à flèches de Minecraft demande des
 * distributeurs et des fils de détente, qui n'existent pas encore dans ce jeu.)
 *
 * Module pur.
 */
import { SEA_LEVEL } from '../Constants';
import { B } from '../Ids';
import { BIOME } from './Biomes';
import { Piece, type GenCanvas } from './GenCanvas';
import { registerStructure, type Structure, type TerrainInfo } from './Structures';

/** Emprise au sol d'une pièce de `w` × `d` posée en (ox, oz) et tournée de `rot` quarts de tour. */
function bounds(ox: number, oz: number, rot: number, w: number, d: number): { x0: number; z0: number; x1: number; z1: number } {
  const p = new Piece(null as unknown as GenCanvas, ox, 0, oz, rot);
  const xa = p.x(0, 0);
  const xb = p.x(w - 1, d - 1);
  const za = p.z(0, 0);
  const zb = p.z(w - 1, d - 1);
  return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb) };
}

// ------------------------------------------------------------------ pyramide du désert

const PYRAMID = 21;
const MID = 10;

class DesertTemple implements Structure {
  readonly kind = 'desert_temple' as const;
  readonly surface = true;
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;

  constructor(readonly x: number, readonly y: number, readonly z: number, private readonly ox: number, private readonly oz: number, private readonly rot: number) {
    // marge de 3 blocs : le passage dégagé devant l'entrée
    const b = bounds(ox, oz, rot, PYRAMID, PYRAMID);
    this.x0 = b.x0 - 3;
    this.z0 = b.z0 - 3;
    this.x1 = b.x1 + 3;
    this.z1 = b.z1 + 3;
  }

  build(c: GenCanvas): void {
    const p = new Piece(c, this.ox, this.y, this.oz, this.rot);
    const S = B.SANDSTONE;
    const O = B.TERRACOTTA_ORANGE;
    const N = PYRAMID - 1;

    // socle : une dalle au niveau du sol, fondée jusqu'au terrain
    for (let w = 0; w <= N; w++) {
      for (let u = 0; u <= N; u++) {
        p.set(u, 0, w, S);
        p.pillarDown(u, -1, w, S);
      }
    }
    // dégage ce qui dépasse autour des degrés (dunes), puis pyramide pleine et grande salle creusée dedans
    for (let v = 1; v <= 12; v++) {
      if (v >= 10) {
        p.fill(0, v, 0, N, v, N, B.AIR);
        continue;
      }
      p.fill(0, v, 0, N, v, v - 1, B.AIR);
      p.fill(0, v, N - v + 1, N, v, N, B.AIR);
      p.fill(0, v, 0, v - 1, v, N, B.AIR);
      p.fill(N - v + 1, v, 0, N, v, N, B.AIR);
    }
    for (let v = 1; v <= 9; v++) p.fill(v, v, v, N - v, v, N - v, S);
    p.fill(5, 1, 5, N - 5, 4, N - 5, B.AIR);

    // deux tours à l'avant, coiffées de créneaux
    for (const u0 of [0, N - 4]) {
      p.fill(u0, 1, 0, u0 + 4, 8, 4, S);
      p.fill(u0 + 1, 1, 1, u0 + 3, 7, 3, B.AIR);
      for (const [du, dw] of [[0, 0], [4, 0], [0, 4], [4, 4], [2, 0], [2, 4], [0, 2], [4, 2]]) p.set(u0 + du, 9, dw, S);
      // motif de terre cuite orange sur la façade
      p.set(u0 + 2, 6, 0, O);
      p.set(u0 + 1, 5, 0, O);
      p.set(u0 + 3, 5, 0, O);
      p.set(u0 + 2, 4, 0, O);
      p.set(u0 + 2, 3, 0, O);
    }

    // entrée : couloir depuis la façade jusqu'à la salle
    p.fill(MID - 1, 1, 0, MID + 1, 3, 5, B.AIR);
    p.fill(MID - 2, 1, 0, MID - 2, 4, 0, S);
    p.fill(MID + 2, 1, 0, MID + 2, 4, 0, S);
    p.fill(MID - 2, 4, 0, MID + 2, 4, 0, S);
    p.set(MID, 5, 0, O);
    // devant l'entrée : un passage dégagé dans le sable
    p.fill(MID - 1, 1, -3, MID + 1, 3, -1, B.AIR);

    // sol de la salle : croix orange autour du bloc bleu
    p.fill(MID - 1, 0, MID - 1, MID + 1, 0, MID + 1, O);
    for (const [du, dw] of [[0, -3], [0, 3], [-3, 0], [3, 0], [0, -2], [0, 2], [-2, 0], [2, 0]]) p.set(MID + du, 0, MID + dw, O);
    p.set(MID, 0, MID, B.TERRACOTTA_BLUE);

    // puits sous le bloc bleu, puis salle du trésor
    p.fill(MID - 2, -8, MID - 2, MID + 2, -1, MID + 2, S);
    p.fill(MID - 1, -8, MID - 1, MID + 1, -1, MID + 1, B.AIR);
    p.fill(MID - 3, -14, MID - 3, MID + 3, -8, MID + 3, S);
    p.fill(MID - 2, -11, MID - 2, MID + 2, -9, MID + 2, B.AIR);
    p.fill(MID - 1, -8, MID - 1, MID + 1, -8, MID + 1, B.AIR);
    // sol en dalles doubles : rien ne peut y apparaître dans le noir et déclencher le piège
    p.fill(MID - 2, -12, MID - 2, MID + 2, -12, MID + 2, B.SANDSTONE_SLAB, 2);
    // la plaque repose sur une TNT ; neuf autres dorment sous le sol
    p.fill(MID - 1, -13, MID - 1, MID + 1, -13, MID + 1, B.TNT);
    p.set(MID, -12, MID, B.TNT);
    p.set(MID, -11, MID, B.STONE_PRESSURE_PLATE);
    p.chest(MID, -11, MID - 2, 0, 'desert_temple');
    p.chest(MID, -11, MID + 2, 2, 'desert_temple');
    p.chest(MID - 2, -11, MID, 3, 'desert_temple');
    p.chest(MID + 2, -11, MID, 1, 'desert_temple');
  }
}

registerStructure('desert_temple', {
  spacing: 18,
  separation: 6,
  salt: 0x0de5e127,
  reach: 16,
  create(t: TerrainInfo, x: number, z: number, rng: () => number) {
    if (t.biomeAt(x, z) !== BIOME.DESERT) return null;
    const rot = Math.floor(rng() * 4);
    const y = t.terrainTop(x, z);
    if (y < SEA_LEVEL + 1 || y > 100) return null;
    // origine telle que le centre de la pyramide tombe en (x, z)
    const probe = new Piece(null as unknown as GenCanvas, 0, 0, 0, rot);
    const ox = x - probe.x(MID, MID);
    const oz = z - probe.z(MID, MID);
    return new DesertTemple(x, y, z, ox, oz, rot);
  },
});

// ------------------------------------------------------------------ temple de la jungle

const JW = 12;
const JD = 15;

class JungleTemple implements Structure {
  readonly kind = 'jungle_temple' as const;
  readonly surface = true;
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;

  constructor(
    readonly x: number, readonly y: number, readonly z: number,
    private readonly ox: number, private readonly oz: number, private readonly rot: number, private readonly seed: number,
  ) {
    // marge de 2 blocs : la jungle est dégagée autour des murs
    const b = bounds(ox, oz, rot, JW, JD);
    this.x0 = b.x0 - 2;
    this.z0 = b.z0 - 2;
    this.x1 = b.x1 + 2;
    this.z1 = b.z1 + 2;
  }

  build(c: GenCanvas): void {
    const p = new Piece(c, this.ox, this.y, this.oz, this.rot);
    // pierres et pierres moussues mêlées, tirées de la position : identiques d'un chunk à l'autre
    const stone = (u: number, v: number, w: number): number => {
      const h = Math.imul(u * 73856093 ^ v * 19349663 ^ w * 83492791 ^ this.seed, 0x9e3779b1) >>> 0;
      return h % 5 < 3 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE;
    };
    const fill = (u0: number, v0: number, w0: number, u1: number, v1: number, w1: number): void => {
      for (let v = v0; v <= v1; v++) for (let w = w0; w <= w1; w++) for (let u = u0; u <= u1; u++) p.set(u, v, w, stone(u, v, w));
    };
    const U = JW - 1;
    const W = JD - 1;

    // dégage la jungle autour et au-dessus
    p.fill(-2, 1, -2, U + 2, 13, W + 2, B.AIR);
    // sous-sol (v = -4..-1), rez-de-chaussée (v = 0..4), étage (v = 5..8), toit à degrés
    for (let w = 0; w <= W; w++) for (let u = 0; u <= U; u++) p.pillarDown(u, -6, w, B.COBBLESTONE);
    fill(0, -5, 0, U, 4, W);
    p.fill(1, -4, 1, U - 1, -2, W - 1, B.AIR);
    p.fill(1, 1, 1, U - 1, 3, W - 1, B.AIR);
    fill(1, 5, 1, U - 1, 8, W - 1);
    p.fill(2, 5, 2, U - 2, 7, W - 2, B.AIR);
    fill(2, 9, 2, U - 2, 9, W - 2);
    fill(3, 10, 3, U - 3, 10, W - 3);

    // entrée de plain-pied, au milieu de la façade
    p.fill(5, 1, 0, 6, 3, 0, B.AIR);
    fill(5, 0, -1, 6, 0, -1);
    // fenêtres de l'étage
    for (const w of [4, 7, 10]) {
      p.fill(1, 6, w, 1, 7, w, B.AIR);
      p.fill(U - 1, 6, w, U - 1, 7, w, B.AIR);
    }
    p.fill(5, 6, 1, 6, 7, 1, B.AIR);

    // escalier vers l'étage, à droite : quatre marches qui percent le plafond
    for (let i = 0; i < 4; i++) {
      if (i < 3) p.fill(U - 2, 2 + i, 9 - i, U - 2, 4, 9 - i, B.AIR);
      p.stairs(U - 2, 1 + i, 9 - i, B.COBBLESTONE_STAIRS, 2);
    }
    // escalier vers le sous-sol, à gauche : la trémie s'ouvre dans le sol du rez-de-chaussée
    for (let i = 0; i < 4; i++) {
      p.fill(1, -i, 6 + i, 1, 0, 6 + i, B.AIR);
      p.stairs(1, -1 - i, 6 + i, B.COBBLESTONE_STAIRS, 2);
    }
    p.fill(1, -4, 10, 1, -1, 10, B.AIR);

    // sous-sol : un premier coffre, bien en vue au fond
    p.chest(U - 2, -4, W - 1, 2, 'jungle_temple');

    // Coffre caché : une fausse cloison de deux blocs d'épaisseur occupe le fond gauche du sous-sol.
    // Le coffre y est muré derrière un bloc que retient un piston collant, alimenté par un levier
    // abaissé. Relever le levier fait reculer le piston : le bloc s'efface et découvre le coffre.
    fill(1, -4, W - 2, 6, -2, W - 1);
    p.chest(3, -4, W - 1, 2, 'jungle_temple');
    p.set(3, -4, W - 2, B.MOSSY_COBBLESTONE);
    p.set(4, -4, W - 2, B.PISTON_HEAD, pistonDir(p, 1) | 8);
    p.set(5, -4, W - 2, B.STICKY_PISTON, pistonDir(p, 1) | 8);
    p.set(5, -4, W - 3, B.LEVER, (p.dir(2) + 1) | 8);

    // lianes sur les murs du rez-de-chaussée
    for (let v = 1; v <= 4; v++) {
      for (let w = 1; w < W; w += 2) {
        const h = Math.imul((v * 31 + w * 17) ^ this.seed, 0x9e3779b1) >>> 0;
        if (h % 3 === 0) p.set(-1, v, w, B.VINE, 1 << p.dir(3));
        if (h % 5 === 0) p.set(U + 1, v, w, B.VINE, 1 << p.dir(1));
      }
    }
  }
}

/** Méta d'un piston pointant vers la direction locale `f` (2 sud, 3 ouest, 4 nord, 5 est). */
function pistonDir(p: Piece, f: number): number {
  return p.dir(f) + 2;
}

registerStructure('jungle_temple', {
  spacing: 16,
  separation: 5,
  salt: 0x0a7e3b1e,
  reach: 16,
  create(t: TerrainInfo, x: number, z: number, rng: () => number) {
    if (t.biomeAt(x, z) !== BIOME.JUNGLE) return null;
    const rot = Math.floor(rng() * 4);
    const y = t.terrainTop(x, z);
    if (y < SEA_LEVEL + 1 || y > 95) return null;
    const probe = new Piece(null as unknown as GenCanvas, 0, 0, 0, rot);
    const ox = x - probe.x(JW >> 1, JD >> 1);
    const oz = z - probe.z(JW >> 1, JD >> 1);
    return new JungleTemple(x, y, z, ox, oz, rot, Math.floor(rng() * 0x7fffffff));
  },
});

