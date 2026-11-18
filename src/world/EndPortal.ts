/**
 * Portail de l'End : l'anneau de douze cadres qui s'ouvre quand chacun porte son œil, et la
 * plate-forme d'obsidienne où l'on arrive dans l'End.
 */
import { B } from './Ids';
import { END_PLATFORM } from './gen/EndLayout';
import type { World } from './World';

/** Bit de méta d'un cadre qui porte son œil. */
export const FRAME_EYE = 4;

/** Les douze cadres d'un anneau, relativement à la cellule centrale du portail. */
const RING: ReadonlyArray<readonly [number, number]> = [
  [-1, -2], [0, -2], [1, -2],
  [-1, 2], [0, 2], [1, 2],
  [-2, -1], [-2, 0], [-2, 1],
  [2, -1], [2, 0], [2, 1],
];

/** Un anneau complet de cadres garnis entoure-t-il la cellule centrale (cx, y, cz) ? */
function ringComplete(w: World, cx: number, y: number, cz: number): boolean {
  for (const [dx, dz] of RING) {
    const v = w.getBlockAndMeta(cx + dx, y, cz + dz);
    if ((v & 255) !== B.END_PORTAL_FRAME || ((v >> 8) & FRAME_EYE) === 0) return false;
  }
  return true;
}

/**
 * Un œil vient d'être posé sur le cadre (x, y, z) : si l'anneau dont il fait partie est complet,
 * les neuf cellules du centre deviennent le portail. Retourne true si le portail s'est ouvert.
 *
 * Écart avec Minecraft : l'orientation des cadres n'est pas vérifiée.
 */
export function tryOpenEndPortal(w: World, x: number, y: number, z: number): boolean {
  for (const [dx, dz] of RING) {
    const cx = x - dx;
    const cz = z - dz;
    if (!ringComplete(w, cx, y, cz)) continue;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) w.setBlock(cx + ox, y, cz + oz, B.END_PORTAL, 0, false);
    }
    return true;
  }
  return false;
}

/**
 * Plate-forme d'arrivée dans l'End : un carré d'obsidienne de 5 × 5 rebâti à chaque passage,
 * et trois blocs d'air au-dessus. Retourne la position des pieds du joueur.
 */
export function buildEndPlatform(w: World): { x: number; y: number; z: number } {
  const { x, y, z } = END_PLATFORM;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      w.setBlock(x + dx, y, z + dz, B.OBSIDIAN, 0, false);
      for (let dy = 1; dy <= 3; dy++) w.setBlock(x + dx, y + dy, z + dz, B.AIR, 0, false);
    }
  }
  return { x: x + 0.5, y: y + 1, z: z + 0.5 };
}
