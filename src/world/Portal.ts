/**
 * Portails du Nether : détection du cadre d'obsidienne, allumage au briquet,
 * vérification de support et création / recherche du portail de destination.
 */
import { B } from './Ids';
import { CHUNK_HEIGHT, type Dimension } from './Constants';
import type { World } from './World';

const MIN_W = 2;
const MIN_H = 3;
const MAX_SIZE = 21;

interface PortalRect {
  axis: 0 | 1; // 0 = étendu selon X, 1 = étendu selon Z
  ox: number;
  oy: number;
  oz: number;
  w: number;
  h: number;
}

function findFrameAt(w: World, x: number, y: number, z: number, axis: 0 | 1): PortalRect | null {
  const dx = axis === 0 ? 1 : 0;
  const dz = axis === 1 ? 1 : 0;
  // Descend jusqu'au sol d'obsidienne
  let by = y;
  while (by > 1 && w.getBlock(x, by - 1, z) === B.AIR) by--;
  if (w.getBlock(x, by - 1, z) !== B.OBSIDIAN) return null;

  // Cherche le bord gauche (négatif)
  let lx = x;
  let lz = z;
  for (let i = 0; i <= MAX_SIZE; i++) {
    const nx = lx - dx;
    const nz = lz - dz;
    if (w.getBlock(nx, by, nz) !== B.AIR) break;
    lx = nx;
    lz = nz;
  }
  if (w.getBlock(lx - dx, by, lz - dz) !== B.OBSIDIAN) return null;

  // Largeur intérieure
  let width = 0;
  while (width <= MAX_SIZE && w.getBlock(lx + dx * width, by, lz + dz * width) === B.AIR) width++;
  if (width < MIN_W || width > MAX_SIZE) return null;
  if (w.getBlock(lx + dx * width, by, lz + dz * width) !== B.OBSIDIAN) return null;

  // Hauteur intérieure
  let height = 0;
  while (height <= MAX_SIZE && by + height < CHUNK_HEIGHT - 1 && w.getBlock(lx, by + height, lz) === B.AIR) {
    height++;
  }
  if (height < MIN_H || height > MAX_SIZE) return null;

  // Vérifie que tout le rectangle est vide et entièrement encadré d'obsidienne
  for (let u = -1; u <= width; u++) {
    const cx = lx + dx * u;
    const cz = lz + dz * u;
    for (let v = -1; v <= height; v++) {
      const cy = by + v;
      const border = u === -1 || u === width || v === -1 || v === height;
      const corner = (u === -1 || u === width) && (v === -1 || v === height);
      if (corner) continue;
      const id = w.getBlock(cx, cy, cz);
      if (border) {
        if (id !== B.OBSIDIAN) return null;
      } else {
        if (id !== B.AIR) return null;
      }
    }
  }
  return { axis, ox: lx, oy: by, oz: lz, w: width, h: height };
}

/** Tente d'allumer un portail du Nether si (x, y, z) est dans un cadre d'obsidienne valide. */
export function tryIgnitePortal(w: World, x: number, y: number, z: number): boolean {
  if (w.getBlock(x, y, z) !== B.AIR) return false;
  const rect = findFrameAt(w, x, y, z, 0) ?? findFrameAt(w, x, y, z, 1);
  if (!rect) return false;
  const dx = rect.axis === 0 ? 1 : 0;
  const dz = rect.axis === 1 ? 1 : 0;
  for (let u = 0; u < rect.w; u++) {
    for (let v = 0; v < rect.h; v++) {
      w.setBlock(rect.ox + dx * u, rect.oy + v, rect.oz + dz * u, B.NETHER_PORTAL, rect.axis, false);
    }
  }
  w.host.effect('place', x, y, z, B.NETHER_PORTAL);
  return true;
}

/** Vérifie si un bloc de portail du Nether est toujours soutenu par un cadre complet. */
export function portalCanStay(w: World, x: number, y: number, z: number, meta: number): boolean {
  const dx = meta & 1 ? 0 : 1;
  const dz = meta & 1 ? 1 : 0;
  const ok = (id: number): boolean => id === B.NETHER_PORTAL || id === B.OBSIDIAN;
  return (
    ok(w.getBlock(x, y - 1, z)) &&
    ok(w.getBlock(x, y + 1, z)) &&
    ok(w.getBlock(x - dx, y, z - dz)) &&
    ok(w.getBlock(x + dx, y, z + dz))
  );
}

/** Construit un portail 4×5 en (px, py, pz) orienté selon X et retourne son point d'apparition. */
export function buildPortalAt(w: World, px: number, py: number, pz: number): { x: number; y: number; z: number } {
  const y = Math.max(4, Math.min(CHUNK_HEIGHT - 8, py));
  // Dégage la zone et pose une plateforme d'obsidienne
  for (let dx = -1; dx <= 2; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      w.setBlock(px + dx, y - 1, pz + dz, B.OBSIDIAN, 0, false);
      for (let dy = 0; dy <= 3; dy++) {
        w.setBlock(px + dx, y + dy, pz + dz, B.AIR, 0, false);
      }
    }
  }
  // Cadre 4×5 (x = px-1..px+2, y = y-1..y+3)
  for (let u = -1; u <= 2; u++) {
    for (let v = -1; v <= 3; v++) {
      const border = u === -1 || u === 2 || v === -1 || v === 3;
      if (border) w.setBlock(px + u, y + v, pz, B.OBSIDIAN, 0, false);
      else w.setBlock(px + u, y + v, pz, B.NETHER_PORTAL, 0, false);
    }
  }
  return { x: px + 1, y, z: pz + 0.5 };
}

/** Cherche un portail existant dans un rayon de 64 blocs autour de (tx, tz), ou en construit un. */
export function findOrCreatePortal(
  w: World,
  tx: number,
  tz: number,
  dimension: Dimension,
): { x: number; y: number; z: number } {
  const ix = Math.floor(tx);
  const iz = Math.floor(tz);
  let bestDist = Infinity;
  let best: { x: number; y: number; z: number } | null = null;
  const r = 64;
  for (let x = ix - r; x <= ix + r; x++) {
    for (let z = iz - r; z <= iz + r; z++) {
      if (!w.chunkAt(x, z)) continue;
      for (let y = 2; y < CHUNK_HEIGHT - 2; y++) {
        if (w.getBlock(x, y, z) !== B.NETHER_PORTAL) continue;
        // Descend au bas du portail
        let by = y;
        while (by > 2 && w.getBlock(x, by - 1, z) === B.NETHER_PORTAL) by--;
        const d = (x - tx) * (x - tx) + (z - tz) * (z - tz);
        if (d < bestDist) {
          bestDist = d;
          best = { x: x + 0.5, y: by, z: z + 0.5 };
        }
        break;
      }
    }
  }
  if (best) return best;

  let py = dimension === 'nether' ? 64 : Math.max(63, w.heightAt(ix, iz));
  if (dimension === 'nether') {
    // Cherche un espace ouvert au-dessus de la mer de lave
    for (let y = 40; y <= 96; y++) {
      if (w.getBlock(ix, y, iz) === B.AIR && w.getBlock(ix, y + 3, iz) === B.AIR) {
        py = y;
        break;
      }
    }
  }
  return buildPortalAt(w, ix, py, iz);
}
