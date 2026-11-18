/**
 * Générateur de l'End (Minecraft 1.12, île centrale) : une île de pierre de l'End qui
 * flotte dans le vide, dix piliers d'obsidienne coiffés d'un cristal, et au centre la
 * fontaine de bedrock qui deviendra le portail de sortie à la mort du dragon.
 *
 * Écarts avec Minecraft : pas d'îles extérieures ni de cités de l'End ; le pourtour de
 * l'île est aplani à la hauteur de la plate-forme d'arrivée, pour qu'on la quitte à pied.
 *
 * Module pur.
 */
import { CHUNK_AREA, CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME } from '../Constants';
import { B } from '../Ids';
import {
  END_CENTER_Y, END_PLATFORM, END_RIM_Y, EXIT_FLOOR_Y, EXIT_PILLAR_TOP, EXIT_POOL_R2, EXIT_POOL_Y, EXIT_RIM_R2, endPillars,
} from './EndLayout';
import type { GenBlockEntity, GenSpawn } from './GenCanvas';
import { Simplex, smoothstep } from './Noise';
import type { TerrainInfo } from './Structures';
import { computeHeightmap, type GeneratedChunk } from './WorldGen';

/** Largeur du pourtour plat, et distance sur laquelle le sol monte ensuite vers le centre. */
const RIM_WIDTH = 10;
const SLOPE_WIDTH = 46;
/** Rayon moyen de l'île, et rayon garanti du côté de la plate-forme d'arrivée. */
const BASE_RADIUS = 92;
const PLATFORM_RADIUS = END_PLATFORM.x + 6;

export class EndGen implements TerrainInfo {
  readonly seed: number;
  private readonly shape: Simplex;
  private readonly detail: Simplex;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.shape = new Simplex(this.seed ^ 0x0e9d0001);
    this.detail = new Simplex(this.seed ^ 0x0e9d0002);
  }

  biomeAt(): number {
    return 0;
  }

  /** Rayon de l'île dans la direction de (x, z). */
  private radius(x: number, z: number, d: number): number {
    if (d < 1) return BASE_RADIUS;
    const ux = x / d;
    const uz = z / d;
    const base = BASE_RADIUS + this.shape.noise2(ux * 1.6, uz * 1.6) * 9;
    // l'île s'avance toujours jusque sous la plate-forme d'arrivée (direction +x)
    const toward = smoothstep(0.86, 0.985, ux);
    return base + (PLATFORM_RADIUS - base) * toward;
  }

  /** Hauteur du plus haut bloc de l'île dans la colonne, ou -1 dans le vide. */
  terrainTop(x: number, z: number): number {
    const d = Math.sqrt(x * x + z * z);
    const r = this.radius(x, z, d);
    if (d > r) return -1;
    const rise = smoothstep(0, 1, (r - RIM_WIDTH - d) / SLOPE_WIDTH);
    // ni bosse sur le pourtour (plat), ni au centre (fontaine)
    const bumps = this.detail.noise2(x * 0.045, z * 0.045) * 2.2 * rise * smoothstep(8, 20, d);
    return Math.round(END_RIM_Y + (END_CENTER_Y - END_RIM_Y) * rise + bumps);
  }

  /** Hauteur du dessous de l'île (premier bloc plein), pour une colonne de l'île. */
  private underside(x: number, z: number, top: number): number {
    const d = Math.sqrt(x * x + z * z);
    const r = this.radius(x, z, d);
    const t = Math.min(1, d / r);
    const depth = 4 + 30 * Math.sqrt(1 - t * t) + this.detail.noise2(x * 0.07 + 40, z * 0.07 - 40) * 3;
    return Math.max(2, Math.round(top - depth));
  }

  generateChunk(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(CHUNK_AREA);
    const heightmap = new Uint8Array(CHUNK_AREA);
    const tints = new Uint8Array(CHUNK_AREA * 9).fill(0x80);
    const blockEntities: GenBlockEntity[] = [];
    const spawns: GenSpawn[] = [];
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const set = (x: number, y: number, z: number, id: number, m = 0): void => {
      if (y < 1 || y >= CHUNK_HEIGHT || x < x0 || x >= x0 + CHUNK_SIZE || z < z0 || z >= z0 + CHUNK_SIZE) return;
      const i = (y << 8) | ((z - z0) << 4) | (x - x0);
      blocks[i] = id;
      meta[i] = m;
    };

    // --- île ---
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = x0 + lx;
        const z = z0 + lz;
        const top = this.terrainTop(x, z);
        if (top < 0) continue;
        const bottom = this.underside(x, z, top);
        const col = (lz << 4) | lx;
        for (let y = bottom; y <= top; y++) blocks[(y << 8) | col] = B.END_STONE;
      }
    }

    // --- piliers d'obsidienne et cristaux ---
    for (const p of endPillars(this.seed)) {
      const r = p.radius;
      if (p.x + r + 2 < x0 || p.x - r - 2 >= x0 + CHUNK_SIZE || p.z + r + 2 < z0 || p.z - r - 2 >= z0 + CHUNK_SIZE) continue;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r + 1) continue;
          const x = p.x + dx;
          const z = p.z + dz;
          const top = this.terrainTop(x, z);
          const from = top < 0 ? END_RIM_Y - 6 : Math.max(2, top - 5);
          for (let y = from; y < p.height; y++) set(x, y, z, B.OBSIDIAN);
        }
      }
      set(p.x, p.height, p.z, B.BEDROCK);
      set(p.x, p.height + 1, p.z, B.FIRE);
      if (p.caged) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
            if (edge) for (let dy = 0; dy <= 2; dy++) set(p.x + dx, p.height + dy, p.z + dz, B.IRON_BARS);
            set(p.x + dx, p.height + 3, p.z + dz, B.IRON_BARS);
          }
        }
      }
      if (p.x >= x0 && p.x < x0 + CHUNK_SIZE && p.z >= z0 && p.z < z0 + CHUNK_SIZE) {
        spawns.push({ kind: 'end_crystal', x: p.x + 0.5, y: p.height + 1, z: p.z + 0.5 });
      }
    }

    // --- fontaine de sortie (fermée tant que le dragon vit) ---
    if (x0 <= 4 && x0 + CHUNK_SIZE > -4 && z0 <= 4 && z0 + CHUNK_SIZE > -4) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = dx * dx + dz * dz;
          if (d > EXIT_RIM_R2) continue;
          set(dx, EXIT_FLOOR_Y, dz, B.BEDROCK);
          set(dx, EXIT_POOL_Y, dz, d > EXIT_POOL_R2 ? B.BEDROCK : B.AIR);
          for (let y = EXIT_POOL_Y + 1; y <= EXIT_PILLAR_TOP + 2; y++) set(dx, y, dz, B.AIR);
        }
      }
      for (let y = EXIT_POOL_Y; y <= EXIT_PILLAR_TOP; y++) set(0, y, 0, B.BEDROCK);
      // torches accrochées à la colonne (méta : 1 sud, 2 ouest, 3 nord, 4 est)
      const ty = EXIT_PILLAR_TOP - 1;
      set(0, ty, 1, B.TORCH, 1);
      set(-1, ty, 0, B.TORCH, 2);
      set(0, ty, -1, B.TORCH, 3);
      set(1, ty, 0, B.TORCH, 4);
    }

    computeHeightmap(blocks, heightmap);
    return { cx, cz, blocks, meta, biomes, heightmap, tints, blockEntities, spawns };
  }
}
