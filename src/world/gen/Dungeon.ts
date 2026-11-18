/**
 * Donjons (Minecraft 1.12, « WorldGenDungeons ») : petite salle souterraine en pierres
 * et pierres moussues, un générateur de monstres au centre et jusqu'à deux coffres.
 *
 * Comme dans Minecraft, une salle n'est gardée que si son sol et son plafond sont pleins
 * et si une à cinq ouvertures donnent sur une grotte : on y arrive donc toujours en explorant.
 * La salle tient entièrement dans un chunk, ce qui permet de lire les grottes déjà creusées.
 *
 * Module pur.
 */
import { B } from '../Ids';
import { DIR_DX, DIR_DZ, type GenCanvas } from './GenCanvas';
import { hash2, mulberry32 } from './Noise';

/** Tentatives par chunk (Minecraft : 8 ; ici 4, soit environ un donjon pour 30 chunks). */
const ATTEMPTS = 4;
/** Hauteur du sol de la salle la plus basse : au-dessus des lacs de lave. */
const MIN_Y = 13;
const MOBS = ['zombie', 'zombie', 'skeleton', 'spider'] as const;

function solid(id: number): boolean {
  return id !== B.AIR && id !== B.WATER && id !== B.LAVA && id !== -1;
}

/**
 * Tente de creuser un donjon dans le chunk en cours. `maxY` : hauteur maximale des pieds
 * (la salle doit rester sous la surface). Retourne true si un donjon a été posé.
 */
export function placeDungeon(c: GenCanvas, seed: number, cx: number, cz: number, maxY: number): boolean {
  if (maxY <= MIN_Y) return false;
  const rng = mulberry32(hash2(cx, cz, (seed ^ 0x0d0c9e07) >>> 0));
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const hx = 2 + Math.floor(rng() * 2);
    const hz = 2 + Math.floor(rng() * 2);
    const x = c.bx + hx + 1 + Math.floor(rng() * (14 - 2 * hx));
    const z = c.bz + hz + 1 + Math.floor(rng() * (14 - 2 * hz));
    const y = MIN_Y + Math.floor(rng() * (maxY - MIN_Y));
    if (tryDungeon(c, rng, x, y, z, hx, hz)) return true;
  }
  return false;
}

function tryDungeon(c: GenCanvas, rng: () => number, x: number, y: number, z: number, hx: number, hz: number): boolean {
  const x0 = x - hx - 1;
  const x1 = x + hx + 1;
  const z0 = z - hz - 1;
  const z1 = z + hz + 1;
  let openings = 0;
  for (let bx = x0; bx <= x1; bx++) {
    for (let bz = z0; bz <= z1; bz++) {
      if (!solid(c.get(bx, y - 1, bz)) || !solid(c.get(bx, y + 4, bz))) return false;
      const wall = bx === x0 || bx === x1 || bz === z0 || bz === z1;
      if (wall && c.get(bx, y, bz) === B.AIR && c.get(bx, y + 1, bz) === B.AIR) openings++;
    }
  }
  if (openings < 1 || openings > 5) return false;

  for (let bx = x0; bx <= x1; bx++) {
    for (let bz = z0; bz <= z1; bz++) {
      const wall = bx === x0 || bx === x1 || bz === z0 || bz === z1;
      for (let dy = 3; dy >= -1; dy--) {
        const by = y + dy;
        if (!wall && dy >= 0) {
          c.set(bx, by, bz, B.AIR);
        } else if (!solid(c.get(bx, by - 1, bz))) {
          // rien dessous : la paroi s'ouvre sur la grotte
          c.set(bx, by, bz, B.AIR);
        } else if (solid(c.get(bx, by, bz))) {
          c.set(bx, by, bz, dy === -1 && rng() < 0.75 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE);
        }
      }
    }
  }

  // jusqu'à deux coffres, chacun adossé à un seul mur
  for (let n = 0; n < 2; n++) {
    for (let t = 0; t < 3; t++) {
      const bx = x + Math.floor(rng() * (2 * hx + 1)) - hx;
      const bz = z + Math.floor(rng() * (2 * hz + 1)) - hz;
      if (c.get(bx, y, bz) !== B.AIR || (bx === x && bz === z)) continue;
      let walls = 0;
      let wallDir = 0;
      for (let d = 0; d < 4; d++) {
        if (solid(c.get(bx + DIR_DX[d], y, bz + DIR_DZ[d]))) {
          walls++;
          wallDir = d;
        }
      }
      if (walls !== 1) continue;
      c.chest(bx, y, bz, (wallDir + 2) & 3, 'dungeon');
      break;
    }
  }

  c.spawner(x, y, z, MOBS[Math.floor(rng() * MOBS.length)]);
  return true;
}
