/**
 * Textures procédurales en pixel art pour la série de tableaux (`entity/Hanging`).
 */
import * as THREE from 'three';
import { PAINTINGS } from '../entity/Hanging';

const cache = new Map<number, THREE.CanvasTexture>();

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawMotif(ctx: CanvasRenderingContext2D, key: string, pw: number, ph: number): void {
  // Fond neutre
  rect(ctx, 0, 0, pw, ph, '#2a221c');
  switch (key) {
    case 'kebab': {
      rect(ctx, 1, 1, 14, 14, '#7d6c5a');
      rect(ctx, 1, 10, 14, 5, '#594230');
      rect(ctx, 3, 11, 10, 2, '#d8d2c7');
      rect(ctx, 5, 4, 2, 7, '#a8432b');
      rect(ctx, 7, 5, 2, 6, '#e2a33e');
      rect(ctx, 9, 4, 2, 7, '#588c38');
      break;
    }
    case 'aztec': {
      rect(ctx, 1, 1, 14, 14, '#245863');
      rect(ctx, 2, 2, 12, 12, '#3d8794');
      rect(ctx, 4, 4, 8, 8, '#c89b3c');
      rect(ctx, 5, 5, 6, 6, '#7a3326');
      rect(ctx, 6, 6, 4, 4, '#e0b84e');
      rect(ctx, 7, 7, 2, 2, '#245863');
      break;
    }
    case 'bomb': {
      rect(ctx, 1, 1, 14, 9, '#7aaad4');
      rect(ctx, 1, 10, 14, 5, '#5b7242');
      rect(ctx, 2, 2, 3, 2, '#eef5fa');
      rect(ctx, 10, 3, 3, 2, '#eef5fa');
      rect(ctx, 5, 6, 6, 6, '#232428');
      rect(ctx, 6, 5, 4, 1, '#3d4048');
      rect(ctx, 9, 3, 2, 2, '#e27d28');
      rect(ctx, 10, 2, 2, 1, '#ffdf5e');
      break;
    }
    case 'plant': {
      rect(ctx, 1, 1, 14, 14, '#8aa1b0');
      rect(ctx, 2, 2, 12, 10, '#c8dae3');
      rect(ctx, 1, 11, 14, 4, '#6d4b2f');
      rect(ctx, 5, 9, 6, 4, '#a64d2e');
      rect(ctx, 7, 5, 2, 5, '#3b7d2b');
      rect(ctx, 5, 4, 2, 3, '#57a83e');
      rect(ctx, 9, 5, 2, 3, '#57a83e');
      rect(ctx, 7, 3, 2, 2, '#e24646');
      break;
    }
    case 'wasteland': {
      rect(ctx, 1, 1, 14, 8, '#a04a56');
      rect(ctx, 1, 5, 14, 4, '#d97b3e');
      rect(ctx, 10, 3, 3, 3, '#f7d560');
      rect(ctx, 1, 9, 14, 6, '#7c5338');
      rect(ctx, 3, 6, 2, 5, '#466c2b');
      rect(ctx, 2, 7, 1, 2, '#466c2b');
      rect(ctx, 5, 8, 1, 2, '#466c2b');
      break;
    }
    case 'courbet': {
      rect(ctx, 1, 1, 30, 7, '#6498c7');
      rect(ctx, 1, 8, 30, 7, '#587d3c');
      rect(ctx, 1, 11, 30, 4, '#3a5727');
      rect(ctx, 4, 4, 5, 2, '#eaf2f7');
      rect(ctx, 19, 3, 6, 2, '#eaf2f7');
      // Deux silhouettes face au paysage
      rect(ctx, 10, 6, 3, 6, '#382a24');
      rect(ctx, 10, 4, 3, 2, '#c89a78');
      rect(ctx, 15, 7, 3, 5, '#6a2e2e');
      rect(ctx, 15, 5, 3, 2, '#d5a888');
      break;
    }
    case 'sunset': {
      rect(ctx, 1, 1, 30, 4, '#422c5c');
      rect(ctx, 1, 5, 30, 4, '#b5444e');
      rect(ctx, 1, 9, 30, 3, '#e88b3a');
      rect(ctx, 13, 6, 6, 5, '#ffe066');
      rect(ctx, 1, 11, 30, 4, '#2f4566');
      rect(ctx, 13, 11, 6, 4, '#d67848');
      rect(ctx, 2, 9, 8, 3, '#2b2029');
      rect(ctx, 22, 8, 9, 4, '#2b2029');
      break;
    }
    case 'creebet': {
      rect(ctx, 1, 1, 30, 7, '#62a4cf');
      rect(ctx, 1, 8, 30, 4, '#2f6a99');
      rect(ctx, 1, 12, 30, 3, '#d7c88a');
      // Visage du Creeper à la fenêtre
      rect(ctx, 20, 4, 8, 8, '#419639');
      rect(ctx, 21, 6, 2, 2, '#131613');
      rect(ctx, 25, 6, 2, 2, '#131613');
      rect(ctx, 23, 8, 2, 2, '#131613');
      rect(ctx, 22, 9, 1, 2, '#131613');
      rect(ctx, 25, 9, 1, 2, '#131613');
      break;
    }
    case 'wanderer': {
      rect(ctx, 1, 1, 14, 15, '#9eb5c4');
      rect(ctx, 1, 16, 14, 15, '#c4d2d9');
      rect(ctx, 1, 18, 8, 13, '#4b453f');
      rect(ctx, 2, 22, 12, 9, '#6a5d4f');
      // Voyageur debout sur le rocher
      rect(ctx, 6, 14, 4, 7, '#242938');
      rect(ctx, 7, 11, 2, 3, '#463322');
      rect(ctx, 10, 12, 1, 10, '#6e4e2a');
      break;
    }
    case 'skull_and_roses':
    default: {
      rect(ctx, 1, 1, 30, 30, '#1e3236');
      rect(ctx, 3, 3, 26, 26, '#274347');
      // Crâne centré
      rect(ctx, 10, 6, 12, 11, '#dfd8c8');
      rect(ctx, 11, 17, 10, 4, '#c7bea9');
      rect(ctx, 12, 10, 3, 3, '#1a1e20');
      rect(ctx, 17, 10, 3, 3, '#1a1e20');
      rect(ctx, 15, 14, 2, 2, '#1a1e20');
      rect(ctx, 13, 18, 1, 2, '#1a1e20');
      rect(ctx, 16, 18, 1, 2, '#1a1e20');
      rect(ctx, 19, 18, 1, 2, '#1a1e20');
      // Roses rouges aux coins bas
      rect(ctx, 5, 22, 4, 4, '#b8252e');
      rect(ctx, 6, 23, 2, 2, '#e8434c');
      rect(ctx, 8, 25, 3, 3, '#3b7330');
      rect(ctx, 23, 22, 4, 4, '#b8252e');
      rect(ctx, 24, 23, 2, 2, '#e8434c');
      rect(ctx, 21, 25, 3, 3, '#3b7330');
      break;
    }
  }
  // Cadre en bois autour du tableau
  ctx.strokeStyle = '#6c4926';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, pw, ph);
  ctx.strokeStyle = '#4a3118';
  ctx.lineWidth = 1;
  ctx.strokeRect(1.5, 1.5, pw - 3, ph - 3);
}

/** Texture Three.js (pixel art net) mise en cache pour le tableau `motifIndex`. */
export function getPaintingTexture(motifIndex: number): THREE.CanvasTexture {
  const idx = motifIndex >= 0 && motifIndex < PAINTINGS.length ? Math.floor(motifIndex) : 0;
  let tex = cache.get(idx);
  if (tex) return tex;
  const motif = PAINTINGS[idx];
  const pw = motif.w * 16;
  const ph = motif.h * 16;
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d');
  if (ctx) drawMotif(ctx, motif.key, pw, ph);
  tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  cache.set(idx, tex);
  return tex;
}
