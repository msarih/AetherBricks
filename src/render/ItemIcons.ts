/**
 * Icônes d'inventaire : blocs en vue isométrique (rendu 3D hors écran, une seule fois par objet),
 * objets et blocs « plats » tels que leur tuile 16×16.
 */
import * as THREE from 'three';
import type { Atlas } from './Atlas';
import { ItemModel, itemTint } from './EntityRenderer';
import { getItem } from '../world/Items';
import { TILE_SIZE } from '../world/Tiles';

/** Taille en pixels des icônes de blocs 3D. */
const ICON_SIZE = 64;
/** Demi-largeur de la vue orthographique : le cube isométrique (≈ 1,41 × 1,57) tient avec une petite marge. */
const VIEW_HALF = 0.82;

export class ItemIcons {
  private readonly cache = new Map<number, string>();
  private readonly tileCache = new Map<number, string>();
  private readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly pixels = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);
  private readonly clearColor = new THREE.Color();
  private readonly viewport = new THREE.Vector4();
  private readonly scissor = new THREE.Vector4();

  /**
   * Utilise le renderer principal pour dessiner les blocs 3D hors écran
   * (WebGLRenderTarget + readRenderTargetPixels), une seule fois par objet.
   */
  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly atlas: Atlas) {
    this.target = new THREE.WebGLRenderTarget(ICON_SIZE, ICON_SIZE, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.camera = new THREE.OrthographicCamera(-VIEW_HALF, VIEW_HALF, VIEW_HALF, -VIEW_HALF, 0.1, 20);
    // Vue isométrique de Minecraft : 30° d'élévation, 45° d'azimut.
    // On regarde depuis le sud-est : dessus clair, face sud (la façade des blocs orientés) à gauche, face est à droite.
    const elevation = Math.PI / 6;
    const d = 8;
    this.camera.position.set(
      d * Math.cos(elevation) * Math.SQRT1_2,
      d * Math.sin(elevation),
      d * Math.cos(elevation) * Math.SQRT1_2,
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  /**
   * Data URL (PNG), mise en cache. Blocs « cubiques » : vue isométrique ; objets et blocs « plats »
   * (ItemDef.tile ≥ 0) : tuile 16×16 telle quelle. Chaîne vide pour l'identifiant 0.
   */
  get(itemId: number): string {
    if (itemId === 0) return '';
    let url = this.cache.get(itemId);
    if (url === undefined) {
      const def = getItem(itemId);
      url = def.tile >= 0 ? this.flatIcon(def.tile, itemTint(itemId)) : this.blockIcon(itemId);
      this.cache.set(itemId, url);
    }
    return url;
  }

  /** Data URL (PNG) d'une tuile 16×16 de l'atlas, mise en cache (images de la boussole, de l'horloge). */
  tile(tile: number): string {
    let url = this.tileCache.get(tile);
    if (url === undefined) {
      url = this.flatIcon(tile, 0xffffff);
      this.tileCache.set(tile, url);
    }
    return url;
  }

  /** Pose l'icône en image de fond de l'élément, pixels nets. */
  apply(el: HTMLElement, itemId: number): void {
    const url = this.get(itemId);
    const style = el.style;
    style.backgroundImage = url ? `url(${url})` : '';
    style.backgroundSize = '100% 100%';
    style.backgroundRepeat = 'no-repeat';
    style.backgroundPosition = 'center';
    style.imageRendering = 'pixelated';
  }

  /** Libère la cible de rendu (les icônes déjà produites restent valides). */
  dispose(): void {
    this.target.dispose();
  }

  /** Tuile 16×16 telle quelle (teintée pour l'herbe haute, les lianes…), sans passer par le GPU. */
  private flatIcon(tile: number, tint: number): string {
    const src = this.atlas.tilePixels(tile);
    const out = new Uint8ClampedArray(src.length);
    const r = ((tint >> 16) & 255) / 255;
    const g = ((tint >> 8) & 255) / 255;
    const b = (tint & 255) / 255;
    for (let i = 0; i < src.length; i += 4) {
      out[i] = src[i] * r;
      out[i + 1] = src[i + 1] * g;
      out[i + 2] = src[i + 2] * b;
      out[i + 3] = src[i + 3];
    }
    return this.toDataUrl(out, TILE_SIZE);
  }

  /** Rendu isométrique du bloc dans la cible hors écran, puis lecture des pixels. */
  private blockIcon(itemId: number): string {
    const renderer = this.renderer;
    const model = ItemModel.forItem(this.atlas, itemId);
    // Pleine lumière, ni brouillard ni couleur du ciel : l'icône ne dépend pas de l'heure
    model.detachFromWorld(true);
    model.setLight(15, 0);
    const group = model.instance();
    this.scene.add(group);

    // État du renderer à restituer
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevAlpha = renderer.getClearAlpha();
    const prevScissorTest = renderer.getScissorTest();
    renderer.getClearColor(this.clearColor);
    renderer.getViewport(this.viewport);
    renderer.getScissor(this.scissor);

    renderer.setRenderTarget(this.target);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, ICON_SIZE, ICON_SIZE, this.pixels);

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(this.clearColor, prevAlpha);
    renderer.setViewport(this.viewport);
    renderer.setScissor(this.scissor);
    renderer.setScissorTest(prevScissorTest);

    this.scene.remove(group);
    model.dispose();

    // Les lignes lues vont de bas en haut ; les pixels semi-transparents sont prémultipliés
    const n = ICON_SIZE;
    const src = this.pixels;
    const out = new Uint8ClampedArray(n * n * 4);
    for (let y = 0; y < n; y++) {
      let s = (n - 1 - y) * n * 4;
      let o = y * n * 4;
      for (let x = 0; x < n; x++, s += 4, o += 4) {
        const a = src[s + 3];
        if (a === 0) continue;
        const k = a < 255 ? 255 / a : 1;
        out[o] = src[s] * k;
        out[o + 1] = src[s + 1] * k;
        out[o + 2] = src[s + 2] * k;
        out[o + 3] = a;
      }
    }
    return this.toDataUrl(out, n);
  }

  private toDataUrl(pixels: Uint8ClampedArray, size: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const image = ctx.createImageData(size, size);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }
}
