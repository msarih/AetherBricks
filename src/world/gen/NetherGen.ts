/**
 * Générateur du Nether : cavernes de netherrack, plafond et sol de bedrock,
 * mers de lave (y <= 31), grappes de pierre lumineuse au plafond et minerai de quartz.
 */
import { CHUNK_AREA, CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME } from '../Constants';
import { B } from '../Ids';
import { Simplex, mulberry32, rand2, rand3 } from './Noise';
import './Fortress';
import { GenCanvas } from './GenCanvas';
import { structuresNear, type TerrainInfo } from './Structures';
import type { GeneratedChunk } from './WorldGen';

const NETHER_LAVA_LEVEL = 31;

export class NetherGen implements TerrainInfo {
  private readonly noise: Simplex;
  private readonly detail: Simplex;
  readonly seed: number;

  /** Forteresses : générateur en version 2. */
  readonly features: boolean;
  private readonly canvas = new GenCanvas();

  constructor(seed: number, genVersion = 1) {
    this.seed = seed >>> 0;
    this.features = genVersion >= 2;
    this.noise = new Simplex(this.seed ^ 0x4e455448);
    this.detail = new Simplex(this.seed ^ 0x9e3779b9);
  }

  /** Le Nether n'a ni relief de surface ni biomes : les forteresses n'en ont pas besoin. */
  terrainTop(): number {
    return 0;
  }

  biomeAt(): number {
    return 0;
  }

  generateChunk(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(CHUNK_AREA); // 0
    const heightmap = new Uint8Array(CHUNK_AREA);
    const tints = new Uint8Array(CHUNK_AREA * 9);

    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;

    // Teinte neutre pour le Nether
    for (let i = 0; i < CHUNK_AREA; i++) {
      const o = i * 9;
      tints[o] = 0x7a; tints[o + 1] = 0x5c; tints[o + 2] = 0x58;
      tints[o + 3] = 0x7a; tints[o + 4] = 0x5c; tints[o + 5] = 0x58;
      tints[o + 6] = 0x90; tints[o + 7] = 0x35; tints[o + 8] = 0x20;
    }

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wz = z0 + lz;
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = x0 + lx;
        const col = (lz << 4) | lx;
        const floorBedrock = 1 + Math.floor(rand2(wx, wz, this.seed ^ 11) * 4);
        const ceilBedrock = 126 - Math.floor(rand2(wx, wz, this.seed ^ 23) * 4);
        let topY = 0;

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const idx = (y << 8) | col;
          if (y === 0 || y === CHUNK_HEIGHT - 1 || y < floorBedrock || y > ceilBedrock) {
            blocks[idx] = B.BEDROCK;
            topY = y;
            continue;
          }
          // Densité de caverne : solide près du sol (< 28) et du plafond (> 100), ouvert au milieu
          const n1 = this.noise.noise3(wx * 0.035, y * 0.055, wz * 0.035);
          const n2 = this.detail.noise3(wx * 0.09, y * 0.09, wz * 0.09) * 0.35;
          let bias = 0;
          if (y < 32) bias = (32 - y) * 0.045;
          else if (y > 96) bias = (y - 96) * 0.05;
          const solid = n1 + n2 + bias > 0.12;

          if (solid) {
            // Minerai de quartz du Nether dans la netherrack
            const q = rand3(wx >> 1, y >> 1, wz >> 1, this.seed ^ 0x515541);
            blocks[idx] = q < 0.035 ? B.NETHER_QUARTZ_ORE : B.NETHERRACK;
            topY = y;
          } else if (y <= NETHER_LAVA_LEVEL) {
            blocks[idx] = B.LAVA;
            topY = y;
          }
        }
        heightmap[col] = topY;
      }
    }

    // Grappes de pierre lumineuse (glowstone) accrochées sous le plafond de netherrack
    const rng = mulberry32((this.seed ^ Math.imul(cx, 3418731287) ^ Math.imul(cz, 1328979875)) >>> 0);
    for (let i = 0; i < 6; i++) {
      const lx = 2 + Math.floor(rng() * 12);
      const lz = 2 + Math.floor(rng() * 12);
      for (let y = 115; y >= 72; y--) {
        const idx = (y << 8) | (lz << 4) | lx;
        const above = ((y + 1) << 8) | (lz << 4) | lx;
        if (blocks[idx] === B.AIR && blocks[above] === B.NETHERRACK) {
          for (let g = 0; g < 10; g++) {
            const gx = lx + Math.floor(rng() * 3) - 1;
            const gy = y - Math.floor(rng() * 3);
            const gz = lz + Math.floor(rng() * 3) - 1;
            if (gx < 0 || gx >= 16 || gz < 0 || gz >= 16 || gy < 40) continue;
            const gi = (gy << 8) | (gz << 4) | gx;
            if (blocks[gi] === B.AIR) blocks[gi] = B.GLOWSTONE;
          }
          break;
        }
      }
    }

    // forteresses : la part de chacune qui traverse ce chunk
    if (this.features) {
      const c = this.canvas;
      c.begin(cx, cz, blocks, meta);
      for (const s of structuresNear(this, ['fortress'], cx, cz, 0)) s.build(c);
      return { cx, cz, blocks, meta, biomes, heightmap, tints, blockEntities: c.blockEntities, spawns: c.spawns };
    }
    return { cx, cz, blocks, meta, biomes, heightmap, tints, blockEntities: [], spawns: [] };
  }
}
