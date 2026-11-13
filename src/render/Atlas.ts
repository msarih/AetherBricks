/**
 * Atlas des tuiles : une texture-tableau (une couche 16×16 par tuile), animée pour l'eau, la lave et le feu.
 */
import * as THREE from 'three';
import { T, TILE_COUNT, TILE_SIZE } from '../world/Tiles';
import { FIRE_FRAMES, LAVA_FRAMES, WATER_FRAMES, paintAllTiles, paintAnimationFrames } from './tiles';

const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

export class Atlas {
  /** Pixels RGBA de toutes les tuiles (tuile i à l'offset i × 1024, lignes du haut vers le bas). */
  readonly data: Uint8Array;
  readonly texture: THREE.DataArrayTexture;
  private frames = paintAnimationFrames();
  private tickCount = 0;

  constructor() {
    this.data = paintAllTiles();
    const tex = new THREE.DataArrayTexture(this.data, TILE_SIZE, TILE_SIZE, TILE_COUNT);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  /** Pixels d'une tuile (vue sur les données de l'atlas). */
  tilePixels(tile: number): Uint8Array {
    return this.data.subarray(tile * TILE_BYTES, (tile + 1) * TILE_BYTES);
  }

  /** Avance les animations ; à appeler à chaque tick de jeu (20 Hz). */
  tick(): void {
    this.tickCount++;
    if (this.tickCount % 2 !== 0) return;
    const n = this.tickCount >> 1;
    this.setLayer(T.water, this.frames.water[n % WATER_FRAMES]);
    this.setLayer(T.fire, this.frames.fire[n % FIRE_FRAMES]);
    if (n % 2 === 0) this.setLayer(T.lava, this.frames.lava[(n >> 1) % LAVA_FRAMES]);
    this.texture.needsUpdate = true;
  }

  private setLayer(tile: number, pixels: Uint8ClampedArray): void {
    this.data.set(pixels, tile * TILE_BYTES);
    this.texture.addLayerUpdate(tile);
  }
}
