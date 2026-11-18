/**
 * Plan de l'End, partagé par le générateur (qui le bâtit) et par le jeu (qui s'en sert pour
 * le combat du dragon et le portail de sortie). Tout se déduit de la graine.
 *
 * Module pur.
 */
import { mulberry32 } from './Noise';

/** Hauteur du sol au centre de l'île (dessus de la pierre de l'End). */
export const END_CENTER_Y = 58;
/** Hauteur du sol sur le pourtour de l'île. */
export const END_RIM_Y = 48;

/** Plate-forme d'obsidienne où le joueur arrive (comme dans Minecraft : 100, 48, 0). */
export const END_PLATFORM = { x: 100, y: END_RIM_Y, z: 0 } as const;

/** Fontaine de sortie, au centre : socle, bassin, colonne et œuf. */
export const EXIT_FLOOR_Y = END_CENTER_Y;
export const EXIT_POOL_Y = END_CENTER_Y + 1;
export const EXIT_PILLAR_TOP = END_CENTER_Y + 4;
export const EXIT_EGG_Y = END_CENTER_Y + 5;
/** Carré de la distance au centre : bassin (portail) en deçà, margelle au-delà. */
export const EXIT_POOL_R2 = 6;
export const EXIT_RIM_R2 = 12;

/** Le point (dx, dz) autour du centre fait-il partie du bassin (hors colonne centrale) ? */
export function inExitPool(dx: number, dz: number): boolean {
  const d = dx * dx + dz * dz;
  return d > 0 && d <= EXIT_POOL_R2;
}

export interface EndPillar {
  x: number;
  z: number;
  /** Hauteur du socle de bedrock qui porte le cristal. */
  height: number;
  radius: number;
  /** Cristal enfermé dans une cage de barreaux de fer. */
  caged: boolean;
}

const PILLAR_COUNT = 10;
const PILLAR_RING = 42;

let cacheSeed = -1;
let cache: EndPillar[] = [];

/**
 * Les dix piliers d'obsidienne (Minecraft 1.12) : en cercle à 42 blocs du centre, de 76 à
 * 103 blocs de haut, de 2 à 5 blocs de rayon ; deux d'entre eux ont un cristal en cage.
 */
export function endPillars(seed: number): readonly EndPillar[] {
  if (seed === cacheSeed) return cache;
  const order = Array.from({ length: PILLAR_COUNT }, (_, i) => i);
  const rng = mulberry32((seed ^ 0x0e9d5eed) >>> 0);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out: EndPillar[] = [];
  for (let i = 0; i < PILLAR_COUNT; i++) {
    const a = 2 * (-Math.PI + (Math.PI / PILLAR_COUNT) * i);
    const k = order[i];
    out.push({
      x: Math.floor(PILLAR_RING * Math.cos(a)),
      z: Math.floor(PILLAR_RING * Math.sin(a)),
      height: 76 + k * 3,
      radius: 2 + Math.floor(k / 3),
      caged: k === 1 || k === 2,
    });
  }
  cacheSeed = seed;
  cache = out;
  return out;
}
