/**
 * Lieux à découvrir : où ils se trouvent et de quoi ils sont faits.
 *
 * Placement à la Minecraft : le monde est découpé en grandes cases ; chaque case tire au
 * hasard (à partir de la graine) un emplacement candidat, gardé si le biome convient.
 * Tout est recalculable à partir de la graine seule : n'importe quel chunk peut savoir
 * quelles constructions le traversent sans connaître ses voisins, et le jeu peut indiquer
 * le lieu le plus proche.
 *
 * Module pur.
 */
import type { GenCanvas } from './GenCanvas';
import { hash2, mulberry32 } from './Noise';

/** Ce que le générateur de terrain met à la disposition des constructions. */
export interface TerrainInfo {
  readonly seed: number;
  /** Hauteur du plus haut bloc de terrain plein de la colonne (avant grottes, arbres et eau). */
  terrainTop(x: number, z: number): number;
  /** Biome de la colonne. */
  biomeAt(x: number, z: number): number;
}

/** Une construction placée dans le monde. */
export interface Structure {
  readonly kind: StructureKind;
  /** Point de repère (centre), en blocs. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Emprise au sol, bornes comprises. */
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** Construction de surface : aucun arbre ne pousse dans son emprise. */
  readonly surface: boolean;
  /** Emprise précise (chemins, bâtiments) quand le rectangle englobant est trop large. */
  covers?(x: number, z: number): boolean;
  /** Écrit dans le chunk en cours la part de la construction qui s'y trouve. */
  build(c: GenCanvas): void;
}

export type StructureKind = 'village' | 'desert_temple' | 'jungle_temple' | 'mineshaft' | 'fortress';

interface Placement {
  /** Côté d'une case, en chunks. */
  spacing: number;
  /** Bande sans construction au bord de la case, en chunks. */
  separation: number;
  salt: number;
  /** Rayon maximal de l'emprise autour du point de départ, en blocs. */
  reach: number;
  /** Construit la structure si l'emplacement convient, sinon null. */
  create(t: TerrainInfo, x: number, z: number, rng: () => number): Structure | null;
}

const PLACEMENTS: Partial<Record<StructureKind, Placement>> = {};

/** Déclare un type de lieu (appelé par chaque module de construction). */
export function registerStructure(kind: StructureKind, p: Placement): void {
  PLACEMENTS[kind] = p;
}

const cache = new Map<string, Structure | null>();
const CACHE_MAX = 512;

/** Lieu de la case (rx, rz) pour ce type, ou null. Résultat gardé en mémoire. */
export function structureInRegion(t: TerrainInfo, kind: StructureKind, rx: number, rz: number): Structure | null {
  const p = PLACEMENTS[kind];
  if (!p) return null;
  const key = `${t.seed}:${kind}:${rx}:${rz}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const rng = mulberry32(hash2(rx, rz, (t.seed ^ p.salt) >>> 0));
  const span = p.spacing - p.separation;
  const cx = rx * p.spacing + Math.floor(rng() * span);
  const cz = rz * p.spacing + Math.floor(rng() * span);
  const s = p.create(t, cx * 16 + 8, cz * 16 + 8, rng);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, s);
  return s;
}

/** Lieux de l'Overworld ou du Nether dont l'emprise (élargie de `margin` blocs) touche le chunk. */
export function structuresNear(t: TerrainInfo, kinds: readonly StructureKind[], cx: number, cz: number, margin: number): Structure[] {
  const out: Structure[] = [];
  const bx0 = cx * 16 - margin;
  const bz0 = cz * 16 - margin;
  const bx1 = cx * 16 + 15 + margin;
  const bz1 = cz * 16 + 15 + margin;
  for (const kind of kinds) {
    const p = PLACEMENTS[kind];
    if (!p) continue;
    const size = p.spacing * 16;
    const rx0 = Math.floor((bx0 - p.reach) / size);
    const rx1 = Math.floor((bx1 + p.reach) / size);
    const rz0 = Math.floor((bz0 - p.reach) / size);
    const rz1 = Math.floor((bz1 + p.reach) / size);
    for (let rz = rz0; rz <= rz1; rz++) {
      for (let rx = rx0; rx <= rx1; rx++) {
        const s = structureInRegion(t, kind, rx, rz);
        if (s && s.x1 >= bx0 && s.x0 <= bx1 && s.z1 >= bz0 && s.z0 <= bz1) out.push(s);
      }
    }
  }
  return out;
}

/** Lieu du type donné le plus proche de (x, z), dans un rayon de `maxRegions` cases. */
export function locateStructure(t: TerrainInfo, kind: StructureKind, x: number, z: number, maxRegions = 12): Structure | null {
  const p = PLACEMENTS[kind];
  if (!p) return null;
  const size = p.spacing * 16;
  const rx = Math.floor(x / size);
  const rz = Math.floor(z / size);
  let best: Structure | null = null;
  let bestD = Infinity;
  for (let r = 0; r <= maxRegions; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const s = structureInRegion(t, kind, rx + dx, rz + dz);
        if (!s) continue;
        const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    // un anneau plus loin ne peut plus contenir de lieu plus proche
    if (best && bestD <= (r * size) * (r * size)) break;
  }
  return best;
}
