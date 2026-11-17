/** Dimensions et constantes globales du monde voxel. */
export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 128;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_HEIGHT;
export const SEA_LEVEL = 62;

export const TICKS_PER_SECOND = 20;
export const TICK_SECONDS = 1 / TICKS_PER_SECOND;
/** Durée d'une journée complète en ticks (20 minutes réelles, comme Minecraft). */
export const DAY_TICKS = 24000;

/** Clé numérique unique d'un chunk (utilisable comme clé de Map). */
export function chunkKey(cx: number, cz: number): number {
  return (cx + 0x8000) * 0x10000 + (cz + 0x8000);
}

export function keyToChunkX(key: number): number {
  return Math.floor(key / 0x10000) - 0x8000;
}

export function keyToChunkZ(key: number): number {
  return (key % 0x10000) - 0x8000;
}

/** Index d'une cellule dans les tableaux d'un chunk (x, z dans 0..15 ; y dans 0..127). */
export function blockIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

/** Les 6 directions : 0=+y (haut), 1=-y (bas), 2=-z (nord), 3=+z (sud), 4=-x (ouest), 5=+x (est). */
export const FACE_UP = 0;
export const FACE_DOWN = 1;
export const FACE_NORTH = 2;
export const FACE_SOUTH = 3;
export const FACE_WEST = 4;
export const FACE_EAST = 5;

export const FACE_DX = [0, 0, 0, 0, -1, 1];
export const FACE_DY = [1, -1, 0, 0, 0, 0];
export const FACE_DZ = [0, 0, -1, 1, 0, 0];
export const FACE_OPPOSITE = [1, 0, 3, 2, 5, 4];

export type GameMode = 'survival' | 'creative';
export type WorldType = 'default' | 'flat';
export type Dimension = 'overworld' | 'nether';

/**
 * Version du générateur de monde. Elle est notée dans chaque monde à sa création : un monde
 * garde pour toujours le générateur avec lequel il est né, sinon ses chunks jamais modifiés
 * (qui ne sont pas sauvegardés mais régénérés) changeraient sous les pieds du joueur.
 *  1 : relief, grottes, minerais, arbres (mondes créés avant les lieux à découvrir) ;
 *  2 : + donjons, villages, temples, mines abandonnées, badlands, forteresses du Nether.
 */
export const GEN_VERSION = 2;
