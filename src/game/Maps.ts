/**
 * Cartes (Minecraft 1.12, échelle 0) : une carte couvre 128 × 128 blocs, un pixel par bloc,
 * sur une grille alignée sur des multiples de 128. Elle se dessine au fur et à mesure,
 * seulement quand le joueur la tient en main, dans un rayon de 64 blocs autour de lui.
 *
 * Le numéro de la carte est rangé dans le champ « usure » de la pile (comme le « damage »
 * des cartes de Minecraft). Les pixels sont sauvegardés avec l'état du monde.
 */
import type { Dimension } from '../world/Constants';
import { B } from '../world/Ids';
import { mapBaseColor, mapPixel } from '../world/MapColors';
import { rleDecode, rleEncode } from '../world/Storage';
import type { World } from '../world/World';

export const MAP_SIZE = 128;
const MAP_PIXELS = MAP_SIZE * MAP_SIZE;
/** Rayon (en blocs) dans lequel la carte tenue se dessine. */
const MAP_RADIUS = 64;
/** Une colonne sur 16 est relue à chaque tick : la zone visible est entièrement redessinée en 16 ticks. */
const SWEEP = 16;

export interface MapData {
  id: number;
  /** Coin nord-ouest couvert par la carte (coordonnées du monde). */
  x0: number;
  z0: number;
  dim: Dimension;
  /** Un octet par pixel (voir world/MapColors) ; 0 = inexploré. Ligne z, colonne x. */
  colors: Uint8Array;
  /** Augmente à chaque pixel modifié (l'afficheur recopie alors la texture). */
  version: number;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export class MapStore {
  readonly maps = new Map<number, MapData>();
  private nextId = 0;
  private tick = 0;

  /** Nouvelle carte de la case de grille où se trouve (x, z). */
  create(x: number, z: number, dim: Dimension): MapData {
    const cx = Math.floor((x + 64) / MAP_SIZE) * MAP_SIZE;
    const cz = Math.floor((z + 64) / MAP_SIZE) * MAP_SIZE;
    const map: MapData = { id: this.nextId++, x0: cx - 64, z0: cz - 64, dim, colors: new Uint8Array(MAP_PIXELS), version: 0 };
    this.maps.set(map.id, map);
    return map;
  }

  get(id: number): MapData | undefined {
    return this.maps.get(id);
  }

  /**
   * Un pas de dessin de la carte tenue par le joueur en (px, pz). Les cartes du Nether
   * restent vierges (le plafond de roche masquerait tout).
   */
  update(w: World, map: MapData, px: number, pz: number, dim: Dimension): void {
    const phase = this.tick++ % SWEEP;
    if (map.dim !== dim || dim !== 'overworld') return;
    const cx = Math.floor(px) - map.x0;
    const cz = Math.floor(pz) - map.z0;
    let changed = false;
    for (let mx = Math.max(0, cx - MAP_RADIUS + 1); mx < Math.min(MAP_SIZE, cx + MAP_RADIUS); mx++) {
      if ((mx & 15) !== phase) continue;
      const x = map.x0 + mx;
      const dx = mx - cx;
      const half = Math.floor(Math.sqrt(MAP_RADIUS * MAP_RADIUS - dx * dx));
      const zStart = Math.max(0, cz - half);
      const zEnd = Math.min(MAP_SIZE - 1, cz + half);
      if (zStart > zEnd) continue;
      let prev = this.surface(w, x, map.z0 + zStart - 1).height;
      for (let mz = zStart; mz <= zEnd; mz++) {
        const z = map.z0 + mz;
        if (!w.isLoaded(x, z)) {
          prev = -1;
          continue;
        }
        const s = this.surface(w, x, z);
        const ref = prev < 0 ? s.height : prev;
        prev = s.height;
        let shade: number;
        if (s.base === 12) {
          // eau : plus sombre en profondeur, avec un léger damier comme dans Minecraft
          const d = s.depth * 0.1 + ((x + z) & 1) * 0.2;
          shade = d < 0.5 ? 2 : d > 0.9 ? 0 : 1;
        } else {
          const d = ((s.height - ref) * 4) / 5 + (((x + z) & 1) - 0.5) * 0.4;
          shade = d > 0.6 ? 2 : d < -0.6 ? 0 : 1;
        }
        const px8 = mapPixel(s.base, shade);
        const i = mz * MAP_SIZE + mx;
        if (map.colors[i] !== px8) {
          map.colors[i] = px8;
          changed = true;
        }
      }
    }
    if (changed) map.version++;
  }

  /** Couleur, hauteur et profondeur d'eau de la colonne (x, z) vue d'en haut. */
  private surface(w: World, x: number, z: number): { base: number; height: number; depth: number } {
    if (!w.isLoaded(x, z)) return { base: 0, height: -1, depth: 0 };
    let y = w.heightAt(x, z) - 1;
    let base = 0;
    while (y > 0) {
      base = mapBaseColor(w.getBlock(x, y, z));
      if (base !== 0) break;
      y--;
    }
    let depth = 0;
    if (w.getBlock(x, y, z) === B.WATER) {
      while (depth < 10 && w.getBlock(x, y - depth - 1, z) === B.WATER) depth++;
    }
    return { base, height: y, depth };
  }

  save(): unknown[] {
    const out: unknown[] = [];
    for (const m of this.maps.values()) {
      out.push({ id: m.id, x0: m.x0, z0: m.z0, dim: m.dim, data: toBase64(rleEncode(m.colors)) });
    }
    return out;
  }

  load(raw: unknown): void {
    this.maps.clear();
    this.nextId = 0;
    if (!Array.isArray(raw)) return;
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const d = r as Record<string, unknown>;
      if (typeof d.id !== 'number' || typeof d.x0 !== 'number' || typeof d.z0 !== 'number' || typeof d.data !== 'string') continue;
      let colors: Uint8Array;
      try {
        colors = rleDecode(fromBase64(d.data), MAP_PIXELS);
      } catch {
        continue;
      }
      if (colors.length !== MAP_PIXELS) continue;
      const id = Math.max(0, Math.floor(d.id));
      this.maps.set(id, { id, x0: d.x0, z0: d.z0, dim: d.dim === 'nether' ? 'nether' : 'overworld', colors, version: 1 });
      this.nextId = Math.max(this.nextId, id + 1);
    }
  }
}
