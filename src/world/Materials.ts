import * as THREE from 'three';

export type ItemCategory =
  | 'bricks'
  | 'slabs'
  | 'stairs_roofs'
  | 'openings'
  | 'decor'
  | 'furniture'
  | 'nature'
  | 'paint';

export const CATEGORY_DEFINITIONS: { id: ItemCategory; label: string; icon: string }[] = [
  { id: 'bricks', label: 'Briques & Murs', icon: '🧱' },
  { id: 'slabs', label: 'Sols & Plafonds', icon: '⬛' },
  { id: 'stairs_roofs', label: 'Escaliers & Toits', icon: '🪜' },
  { id: 'openings', label: 'Portes & Fenêtres', icon: '🚪' },
  { id: 'decor', label: 'Piliers & Clôtures', icon: '🏛️' },
  { id: 'furniture', label: 'Mobilier Intérieur', icon: '🛋️' },
  { id: 'nature', label: 'Nature & Eau', icon: '🌿' },
  { id: 'paint', label: 'Peinture & Motifs', icon: '🎨' },
];

export interface BrickDefinition {
  id: number;
  category: ItemCategory;
  name: string;
  subtitle: string;
  previewCss: string;
  material: THREE.Material;
  isLight?: boolean;
}

/**
 * Convertit une carte de hauteur ( niveaux de gris ) en véritable Normal Map Tangent-Space (RGB)
 * via un filtre de Sobel 3x3 pour un relief ultra-réaliste sous la lumière du soleil.
 */
function heightCanvasToNormalTexture(heightCanvas: HTMLCanvasElement, strength = 4.5): THREE.CanvasTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const ctx = heightCanvas.getContext('2d')!;
  const src = ctx.getImageData(0, 0, w, h).data;

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = w;
  normalCanvas.height = h;
  const nCtx = normalCanvas.getContext('2d')!;
  const dstImg = nCtx.createImageData(w, h);
  const dst = dstImg.data;

  const sample = (x: number, y: number): number => {
    const wx = (x + w) % w;
    const wy = (y + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = dY * strength;
      let nz = 1.0;

      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }

  nCtx.putImageData(dstImg, 0, 0);
  const normalTex = new THREE.CanvasTexture(normalCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.anisotropy = 16;
  return normalTex;
}

/**
 * Génère des textures PBR 1024x1024 ultra-réalistes pour des briques blanches maçonnées :
 * - Albedo : nuances naturelles de brique blanchie à la chaux, grain d'argile cuite et joints de mortier sable/chaux
 * - Normal Map (Sobel) : joints creusés en profondeur, arêtes irrégulières des briques, pores et micro-fissures
 * - Roughness Map : mortier mat rugueux et surface de brique satinée/minérale
 */
function createRealisticWhiteBrickPBR(): {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
} {
  const size = 1024;
  const albedoCanvas = document.createElement('canvas');
  const heightCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  albedoCanvas.width = heightCanvas.width = roughCanvas.width = size;
  albedoCanvas.height = heightCanvas.height = roughCanvas.height = size;

  const aCtx = albedoCanvas.getContext('2d')!;
  const hCtx = heightCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;

  // 1. Fond de mortier (joint creux couleur chaux/sable doux non-éblouissant)
  aCtx.fillStyle = '#b8b2a6';
  aCtx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#262626'; // Creux profond pour le mortier
  hCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#f2f2f2'; // Mortier très mat (rugosité élevée)
  rCtx.fillRect(0, 0, size, size);

  // Grain sableux dans le mortier
  for (let i = 0; i < 25000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const g = 195 + Math.floor(Math.random() * 40);
    aCtx.fillStyle = `rgb(${g}, ${g - 3}, ${g - 8})`;
    aCtx.fillRect(x, y, 2, 2);
    hCtx.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
    hCtx.fillRect(x, y, 2, 2);
  }

  // 2. Dessin des rangées de briques blanches réalistes (4 cours de briques par bloc)
  const rows = 4;
  const cols = 2;
  const rowH = size / rows;
  const colW = size / cols;
  const mortarGap = 18;

  const drawSingleBrick = (bx: number, by: number, bw: number, bh: number, seed: number) => {
    // Ombre d'occlusion ambiante au fond du joint autour de la brique
    aCtx.fillStyle = 'rgba(145, 140, 130, 0.38)';
    aCtx.fillRect(bx - 4, by - 4, bw + 8, bh + 8);

    // Rampe de hauteur biseautée sur les bords de la brique (pour un chanfrein réaliste dans la Normal Map)
    for (let b = 8; b >= 0; b--) {
      const level = Math.round(70 + ((8 - b) / 8) * 165);
      hCtx.fillStyle = `rgb(${level},${level},${level})`;
      hCtx.beginPath();
      hCtx.roundRect(bx + (8 - b), by + (8 - b), bw - (8 - b) * 2, bh - (8 - b) * 2, 10);
      hCtx.fill();
    }

    // Couleur de base de la brique blanche adoucie (blanc pierre/argile doux pour le confort des yeux)
    const baseWarmth = (seed % 7) - 3;
    const r = Math.min(235, 224 + baseWarmth);
    const g = Math.min(233, 221 + baseWarmth);
    const b = Math.min(228, 214 + baseWarmth);

    const grad = aCtx.createLinearGradient(bx, by, bx + bw, by + bh);
    grad.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
    grad.addColorStop(0.5, `rgb(${r - 5}, ${g - 5}, ${b - 6})`);
    grad.addColorStop(1, `rgb(${r - 11}, ${g - 11}, ${b - 12})`);

    aCtx.fillStyle = grad;
    aCtx.beginPath();
    aCtx.roundRect(bx, by, bw, bh, 8);
    aCtx.fill();

    // Fine lisière douce sur le bord de la brique
    aCtx.strokeStyle = 'rgba(238, 235, 228, 0.5)';
    aCtx.lineWidth = 2.5;
    aCtx.beginPath();
    aCtx.roundRect(bx + 2, by + 2, bw - 4, bh - 4, 7);
    aCtx.stroke();

    // Rugosité mate élevée de la brique (aucun reflet blanc éblouissant)
    const roughBase = 205 + (seed % 20);
    rCtx.fillStyle = `rgb(${roughBase}, ${roughBase}, ${roughBase})`;
    rCtx.beginPath();
    rCtx.roundRect(bx, by, bw, bh, 8);
    rCtx.fill();

    // Relief interne de la brique (bosselages d'argile moulée, pores minéraux et traces de brosse à chaux)
    for (let p = 0; p < 900; p++) {
      const px = bx + 8 + Math.random() * (bw - 16);
      const py = by + 8 + Math.random() * (bh - 16);
      const radius = 1 + Math.random() * 4;
      const isPit = Math.random() > 0.45;

      // Micro-pores dans la carte de hauteur
      hCtx.fillStyle = isPit ? 'rgba(90, 90, 90, 0.22)' : 'rgba(255, 255, 255, 0.18)';
      hCtx.beginPath();
      hCtx.arc(px, py, radius, 0, Math.PI * 2);
      hCtx.fill();

      // Nuances minérales subtiles dans l'albédo
      aCtx.fillStyle = isPit ? 'rgba(215, 212, 204, 0.16)' : 'rgba(255, 255, 255, 0.22)';
      aCtx.beginPath();
      aCtx.arc(px, py, radius * 1.2, 0, Math.PI * 2);
      aCtx.fill();
    }

    // Fines stries horizontales de badigeon de chaux blanche
    for (let s = 0; s < 35; s++) {
      const sx = bx + 10 + Math.random() * (bw - 60);
      const sy = by + 6 + Math.random() * (bh - 12);
      const sw = 20 + Math.random() * 45;
      hCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      hCtx.fillRect(sx, sy, sw, 2);
    }
  };

  let seed = 1;
  for (let row = 0; row < rows; row++) {
    const y = row * rowH + mortarGap / 2;
    const bh = rowH - mortarGap;
    const bw = colW - mortarGap;
    const offset = (row % 2) * (colW / 2);

    for (let col = -1; col <= cols; col++) {
      const x = col * colW + offset + mortarGap / 2;
      drawSingleBrick(x, y, bw, bh, seed++);
    }
  }

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  const normal = heightCanvasToNormalTexture(heightCanvas, 5.2);
  const roughness = new THREE.CanvasTexture(roughCanvas);

  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;

  albedo.anisotropy = 16;
  roughness.anisotropy = 16;

  return { albedo, normal, roughness };
}

/**
 * Pierre de taille blanche (Calcaire naturel ciselé)
 */
function createCutLimestonePBR(baseColor: string): {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
} {
  const size = 512;
  const albedoCanvas = document.createElement('canvas');
  const heightCanvas = document.createElement('canvas');
  albedoCanvas.width = heightCanvas.width = size;
  albedoCanvas.height = heightCanvas.height = size;

  const aCtx = albedoCanvas.getContext('2d')!;
  const hCtx = heightCanvas.getContext('2d')!;

  aCtx.fillStyle = baseColor;
  aCtx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#dcdcdc';
  hCtx.fillRect(0, 0, size, size);

  // Joints de bloc de pierre de taille (2 grands blocs par face)
  hCtx.strokeStyle = '#303030';
  hCtx.lineWidth = 8;
  hCtx.strokeRect(4, 4, size - 8, size - 8);
  hCtx.beginPath();
  hCtx.moveTo(0, size / 2);
  hCtx.lineTo(size, size / 2);
  hCtx.moveTo(size / 2, 0);
  hCtx.lineTo(size / 2, size / 2);
  hCtx.stroke();

  aCtx.strokeStyle = '#d4d0c5';
  aCtx.lineWidth = 6;
  aCtx.strokeRect(3, 3, size - 6, size - 6);
  aCtx.beginPath();
  aCtx.moveTo(0, size / 2);
  aCtx.lineTo(size, size / 2);
  aCtx.moveTo(size / 2, 0);
  aCtx.lineTo(size / 2, size / 2);
  aCtx.stroke();

  // Grain de pierre calcaire poreuse
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 2.5;
    hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(80,80,80,0.15)';
    hCtx.fillRect(x, y, r, r);
    aCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(195,190,178,0.12)';
    aCtx.fillRect(x, y, r, r);
  }

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 16;
  const normal = heightCanvasToNormalTexture(heightCanvas, 3.8);

  return { albedo, normal };
}

function createMarbleTexture(): { albedo: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  const hCanvas = document.createElement('canvas');
  canvas.width = canvas.height = hCanvas.width = hCanvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const hCtx = hCanvas.getContext('2d')!;

  ctx.fillStyle = '#fbfcfe';
  ctx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#e8e8e8';
  hCtx.fillRect(0, 0, size, size);

  // Veines naturelles de marbre de Carrare
  for (let v = 0; v < 9; v++) {
    ctx.strokeStyle = v % 2 === 0 ? 'rgba(185, 195, 208, 0.36)' : 'rgba(215, 222, 230, 0.5)';
    ctx.lineWidth = 1.5 + Math.random() * 3.5;
    ctx.beginPath();
    let x = Math.random() * size;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < size) {
      y += 18;
      x += (Math.random() - 0.48) * 28;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  hCtx.strokeStyle = '#505050';
  hCtx.lineWidth = 6;
  hCtx.strokeRect(3, 3, size - 6, size - 6);

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 16;
  const normal = heightCanvasToNormalTexture(hCanvas, 2.2);
  return { albedo, normal };
}

/**
 * Texture PBR de Gazon de Campagne (Herbe dense, trèfle, mousse et micro-relief organique)
 */
export function createCountrysideGrassPBR(): {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
} {
  const size = 1024;
  const albedoCanvas = document.createElement('canvas');
  const heightCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  albedoCanvas.width = heightCanvas.width = roughCanvas.width = size;
  albedoCanvas.height = heightCanvas.height = roughCanvas.height = size;

  const aCtx = albedoCanvas.getContext('2d')!;
  const hCtx = heightCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;

  // Base prairie verte riche et naturelle
  aCtx.fillStyle = '#4a7c36';
  aCtx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#606060';
  hCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#d2d2d2';
  rCtx.fillRect(0, 0, size, size);

  // Nuages organiques d'herbe tendre, mousse et terre humide
  for (let i = 0; i < 450; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const rad = 25 + Math.random() * 80;
    const grad = aCtx.createRadialGradient(cx, cy, 2, cx, cy, rad);
    const palette = [
      'rgba(92, 142, 50, 0.25)',
      'rgba(62, 108, 40, 0.28)',
      'rgba(115, 158, 58, 0.20)',
      'rgba(52, 88, 34, 0.25)',
    ];
    grad.addColorStop(0, palette[i % palette.length]);
    grad.addColorStop(1, 'rgba(74, 124, 54, 0)');
    aCtx.fillStyle = grad;
    aCtx.beginPath();
    aCtx.arc(cx, cy, rad, 0, Math.PI * 2);
    aCtx.fill();
  }

  // 45 000 brins d'herbe dessinés individuellement pour une texture de pelouse ultra-fine
  const greens = ['#5e993e', '#4f8733', '#6da849', '#3f7027', '#7bb554', '#467a2d'];
  for (let i = 0; i < 45000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const angle = (Math.random() - 0.5) * 1.3 - Math.PI / 2;
    const len = 5 + Math.random() * 11;

    aCtx.strokeStyle = greens[i % greens.length];
    aCtx.lineWidth = 1.4;
    aCtx.beginPath();
    aCtx.moveTo(x, y);
    aCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    aCtx.stroke();

    // Relief des brins dans la carte de hauteur
    const hVal = 120 + Math.floor(Math.random() * 125);
    hCtx.strokeStyle = `rgb(${hVal},${hVal},${hVal})`;
    hCtx.lineWidth = 1.5;
    hCtx.beginPath();
    hCtx.moveTo(x, y);
    hCtx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    hCtx.stroke();
  }

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  const normal = heightCanvasToNormalTexture(heightCanvas, 3.4);
  const roughness = new THREE.CanvasTexture(roughCanvas);

  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;

  albedo.repeat.set(1182, 1182);
  normal.repeat.set(1182, 1182);
  roughness.repeat.set(1182, 1182);

  albedo.anisotropy = 16;
  normal.anisotropy = 16;
  roughness.anisotropy = 16;

  return { albedo, normal, roughness };
}

const paintedMaterialCache = new Map<string, THREE.MeshStandardMaterial>();

export function getOrCreatePaintedMaterial(
  colorHex = '#f8fafc',
  pattern = 'plain'
): THREE.MeshStandardMaterial {
  const normColor = colorHex.toLowerCase();
  const normPattern = pattern.toLowerCase();
  const cacheKey = `${normColor}:${normPattern}`;
  const existing = paintedMaterialCache.get(cacheKey);
  if (existing) return existing;

  // Si motif Uni : couleur directe pure et veloutée, sans texture de bruit ni fausse normale,
  // assurant un rendu parfaitement uniforme ("uni partout" sans lignes)
  if (normPattern === 'plain') {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(normColor),
      roughness: 0.78,
      metalness: 0.01,
    });
    paintedMaterialCache.set(cacheKey, mat);
    return mat;
  }

  const size = 512;
  const canvas = document.createElement('canvas');
  const hCanvas = document.createElement('canvas');
  canvas.width = hCanvas.width = size;
  canvas.height = hCanvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const hCtx = hCanvas.getContext('2d')!;

  const baseCol = new THREE.Color(normColor);
  const darkCol = baseCol.clone().offsetHSL(0, 0, -0.15);
  const lightCol = baseCol.clone().offsetHSL(0, 0, 0.12);

  ctx.fillStyle = normColor;
  ctx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);

  let roughness = 0.72;
  let normalStrength = 2.4;

  switch (normPattern) {
    case 'stripes': {
      // Rayures verticales élégantes bicolores style haussmannien
      const stripeW = 32;
      for (let x = 0; x < size; x += stripeW * 2) {
        ctx.fillStyle = '#' + darkCol.getHexString();
        ctx.fillRect(x, 0, stripeW, size);

        // Ligne de liseré fin
        ctx.fillStyle = '#' + lightCol.getHexString();
        ctx.fillRect(x + stripeW - 2, 0, 2, size);

        hCtx.fillStyle = '#606060';
        hCtx.fillRect(x, 0, stripeW, size);
        hCtx.fillStyle = '#b0b0b0';
        hCtx.fillRect(x + stripeW - 2, 0, 2, size);
      }
      roughness = 0.62;
      normalStrength = 1.8;
      break;
    }
    case 'floral': {
      // Motif damas baroque floral
      const step = 64;
      ctx.fillStyle = '#' + lightCol.getHexString();
      hCtx.fillStyle = '#b8b8b8';
      for (let y = 0; y < size; y += step) {
        for (let x = 0; x < size; x += step) {
          const cx = x + step / 2;
          const cy = y + step / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx, cy - 18, 6, 12, 0, 0, Math.PI * 2);
          ctx.ellipse(cx, cy + 18, 6, 12, 0, 0, Math.PI * 2);
          ctx.ellipse(cx - 18, cy, 12, 6, 0, 0, Math.PI * 2);
          ctx.ellipse(cx + 18, cy, 12, 6, 0, 0, Math.PI * 2);
          ctx.fill();

          hCtx.beginPath();
          hCtx.arc(cx, cy, 14, 0, Math.PI * 2);
          hCtx.fill();
          hCtx.beginPath();
          hCtx.ellipse(cx, cy - 18, 6, 12, 0, 0, Math.PI * 2);
          hCtx.ellipse(cx, cy + 18, 6, 12, 0, 0, Math.PI * 2);
          hCtx.ellipse(cx - 18, cy, 12, 6, 0, 0, Math.PI * 2);
          hCtx.ellipse(cx + 18, cy, 12, 6, 0, 0, Math.PI * 2);
          hCtx.fill();
        }
      }
      roughness = 0.55;
      normalStrength = 2.8;
      break;
    }
    case 'bricks': {
      // Briques apparentes peintes dans la teinte choisie
      const bw = 64;
      const bh = 28;
      let row = 0;
      for (let y = 0; y < size; y += bh) {
        const offset = (row % 2) * (bw / 2);
        for (let x = -bw; x < size + bw; x += bw) {
          const bx = x + offset;
          ctx.fillStyle = '#' + (row % 2 === 0 ? baseCol : darkCol).getHexString();
          ctx.fillRect(bx + 2, y + 2, bw - 4, bh - 4);

          hCtx.fillStyle = '#b0b0b0';
          hCtx.fillRect(bx + 2, y + 2, bw - 4, bh - 4);
          hCtx.strokeStyle = '#202020';
          hCtx.lineWidth = 3;
          hCtx.strokeRect(bx + 1, y + 1, bw - 2, bh - 2);
        }
        row++;
      }
      roughness = 0.82;
      normalStrength = 4.2;
      break;
    }
    case 'tiles': {
      // Carrelage / faïence métro quadrillée
      const tw = 48;
      const th = 24;
      let r = 0;
      for (let y = 0; y < size; y += th) {
        const off = (r % 2) * (tw / 2);
        for (let x = -tw; x < size + tw; x += tw) {
          const tx = x + off;
          ctx.fillStyle = '#' + baseCol.getHexString();
          ctx.fillRect(tx + 2, y + 2, tw - 4, th - 4);
          ctx.fillStyle = '#' + lightCol.getHexString();
          ctx.fillRect(tx + 2, y + 2, tw - 4, 3);

          hCtx.fillStyle = '#c0c0c0';
          hCtx.fillRect(tx + 2, y + 2, tw - 4, th - 4);
          hCtx.strokeStyle = '#202020';
          hCtx.lineWidth = 3;
          hCtx.strokeRect(tx + 1, y + 1, tw - 2, th - 2);
        }
        r++;
      }
      roughness = 0.32;
      normalStrength = 3.6;
      break;
    }
    case 'wood': {
      // Boiserie haussmannienne à moulures
      const panelMargin = 18;
      ctx.fillStyle = '#' + baseCol.getHexString();
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = '#' + darkCol.getHexString();
      ctx.lineWidth = 8;
      ctx.strokeRect(panelMargin, panelMargin, size - panelMargin * 2, size - panelMargin * 2);
      ctx.strokeStyle = '#' + lightCol.getHexString();
      ctx.lineWidth = 4;
      ctx.strokeRect(panelMargin + 6, panelMargin + 6, size - (panelMargin + 6) * 2, size - (panelMargin + 6) * 2);

      hCtx.strokeStyle = '#303030';
      hCtx.lineWidth = 8;
      hCtx.strokeRect(panelMargin, panelMargin, size - panelMargin * 2, size - panelMargin * 2);
      hCtx.strokeStyle = '#d0d0d0';
      hCtx.lineWidth = 4;
      hCtx.strokeRect(panelMargin + 6, panelMargin + 6, size - (panelMargin + 6) * 2, size - (panelMargin + 6) * 2);
      roughness = 0.52;
      normalStrength = 3.2;
      break;
    }
    case 'marble': {
      // Marbre veiné noble
      ctx.fillStyle = '#' + baseCol.getHexString();
      ctx.fillRect(0, 0, size, size);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#' + lightCol.getHexString();
      hCtx.lineWidth = 2.5;
      hCtx.strokeStyle = '#a0a0a0';

      for (let v = 0; v < 7; v++) {
        let vx = Math.random() * size;
        let vy = 0;
        ctx.beginPath();
        ctx.moveTo(vx, vy);
        hCtx.beginPath();
        hCtx.moveTo(vx, vy);
        while (vy < size) {
          vx += (Math.random() - 0.45) * 28;
          vy += 16 + Math.random() * 24;
          ctx.lineTo(vx, vy);
          hCtx.lineTo(vx, vy);
        }
        ctx.stroke();
        hCtx.stroke();
      }
      roughness = 0.26;
      normalStrength = 1.6;
      break;
    }
    case 'geometric': {
      // Motif losanges Art Déco
      const step = 48;
      ctx.fillStyle = '#' + darkCol.getHexString();
      hCtx.fillStyle = '#b0b0b0';
      for (let y = 0; y < size; y += step) {
        for (let x = 0; x < size; x += step) {
          ctx.beginPath();
          ctx.moveTo(x + step / 2, y);
          ctx.lineTo(x + step, y + step / 2);
          ctx.lineTo(x + step / 2, y + step);
          ctx.lineTo(x, y + step / 2);
          ctx.closePath();
          ctx.fill();

          hCtx.beginPath();
          hCtx.moveTo(x + step / 2, y);
          hCtx.lineTo(x + step, y + step / 2);
          hCtx.lineTo(x + step / 2, y + step);
          hCtx.lineTo(x, y + step / 2);
          hCtx.closePath();
          hCtx.fill();
        }
      }
      roughness = 0.48;
      normalStrength = 2.6;
      break;
    }
    case 'plain':
    default: {
      roughness = 0.72;
      normalStrength = 1.4;
      break;
    }
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = 8;

  const normal = heightCanvasToNormalTexture(hCanvas, normalStrength);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.anisotropy = 8;

  const mat = new THREE.MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness,
    metalness: 0.02,
  });

  paintedMaterialCache.set(cacheKey, mat);
  return mat;
}

const flatBoxGeo = new THREE.BoxGeometry(1, 1, 1);

export function applyPaintToVisual(root: THREE.Object3D, color: string, pattern = 'plain'): void {
  const mat = getOrCreatePaintedMaterial(color, pattern);
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && !child.userData.isProxy) {
      child.material = mat;
      // Remplace les géométries biseautées/arrondies résiduelles par un cube plat sans joints
      if (child.geometry) {
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
        const box = child.geometry.boundingBox;
        if (box) {
          const dx = box.max.x - box.min.x;
          const dy = box.max.y - box.min.y;
          const dz = box.max.z - box.min.z;
          if (Math.abs(dx - 1) < 0.08 && Math.abs(dy - 1) < 0.08 && Math.abs(dz - 1) < 0.08) {
            child.geometry = flatBoxGeo;
          }
        }
      }
    }
  });
}

export function createDirtPBR(): { albedo: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  const hCanvas = document.createElement('canvas');
  canvas.width = hCanvas.width = size;
  canvas.height = hCanvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const hCtx = hCanvas.getContext('2d')!;

  ctx.fillStyle = '#4e3629';
  ctx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 4;
    const tone = (Math.random() - 0.5) * 45;
    ctx.fillStyle = `rgb(${78 + tone}, ${54 + tone * 0.8}, ${41 + tone * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    hCtx.fillStyle = tone > 0 ? '#b0b0b0' : '#404040';
    hCtx.beginPath();
    hCtx.arc(x, y, r, 0, Math.PI * 2);
    hCtx.fill();
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const normal = heightCanvasToNormalTexture(hCanvas, 4.2);
  return { albedo, normal };
}

export function createStonePBR(): { albedo: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  const hCanvas = document.createElement('canvas');
  canvas.width = hCanvas.width = size;
  canvas.height = hCanvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const hCtx = hCanvas.getContext('2d')!;

  ctx.fillStyle = '#525b68';
  ctx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 50; i++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    ctx.strokeStyle = '#2b3038';
    ctx.lineWidth = 1.5;
    hCtx.strokeStyle = '#202020';
    hCtx.lineWidth = 2.0;
    ctx.beginPath();
    hCtx.beginPath();
    ctx.moveTo(x, y);
    hCtx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (Math.random() - 0.5) * 35;
      y += (Math.random() - 0.5) * 35;
      ctx.lineTo(x, y);
      hCtx.lineTo(x, y);
    }
    ctx.stroke();
    hCtx.stroke();
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const normal = heightCanvasToNormalTexture(hCanvas, 4.8);
  return { albedo, normal };
}

export function createGrassBlockMaterials(): THREE.Material[] {
  const dirt = createDirtPBR();
  const dirtMat = new THREE.MeshStandardMaterial({
    map: dirt.albedo,
    normalMap: dirt.normal,
    roughness: 0.95,
  });

  const grassTopCanvas = document.createElement('canvas');
  grassTopCanvas.width = grassTopCanvas.height = 256;
  const gCtx = grassTopCanvas.getContext('2d')!;
  gCtx.fillStyle = '#4a7c36';
  gCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1200; i++) {
    gCtx.fillStyle = Math.random() > 0.5 ? '#558d3f' : '#3e6b2c';
    gCtx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const grassTopTex = new THREE.CanvasTexture(grassTopCanvas);
  grassTopTex.colorSpace = THREE.SRGBColorSpace;
  const grassTopMat = new THREE.MeshStandardMaterial({
    map: grassTopTex,
    roughness: 0.9,
  });

  const sideCanvas = document.createElement('canvas');
  sideCanvas.width = sideCanvas.height = 256;
  const sCtx = sideCanvas.getContext('2d')!;
  sCtx.drawImage(dirt.albedo.image, 0, 0, 256, 256);
  sCtx.fillStyle = '#4a7c36';
  sCtx.fillRect(0, 0, 256, 52);
  for (let x = 0; x < 256; x += 12) {
    const hang = 12 + Math.random() * 32;
    sCtx.fillRect(x, 52, 12, hang);
  }
  const sideTex = new THREE.CanvasTexture(sideCanvas);
  sideTex.colorSpace = THREE.SRGBColorSpace;
  const sideMat = new THREE.MeshStandardMaterial({
    map: sideTex,
    roughness: 0.92,
  });

  return [sideMat, sideMat, grassTopMat, dirtMat, sideMat, sideMat];
}

export function createBrickCatalog(): Map<number, BrickDefinition> {
  const catalog = new Map<number, BrickDefinition>();

  // --- CATÉGORIE 1 : BRIQUES & MURS ('bricks') ---
  // 1. Brique Blanche Réaliste (Maçonnerie blanchie à la chaux + joints creux, ton doux non-éblouissant)
  const whiteBrickPBR = createRealisticWhiteBrickPBR();
  catalog.set(1, {
    id: 1,
    category: 'bricks',
    name: 'Brique Blanche Chaux',
    subtitle: 'Maçonnerie mate douce à joints creux',
    previewCss: 'linear-gradient(135deg, #e5e1d8 0%, #c8c2b4 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xe6e2d8,
      map: whiteBrickPBR.albedo,
      normalMap: whiteBrickPBR.normal,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughnessMap: whiteBrickPBR.roughness,
      roughness: 0.9,
      metalness: 0.0,
    }),
  });

  // 2. Pierre Blanche de Taille (Calcaire ciselé doux)
  const limestone = createCutLimestonePBR('#e2ded3');
  catalog.set(2, {
    id: 2,
    category: 'bricks',
    name: 'Pierre Blanche Taillée',
    subtitle: 'Bloc de calcaire naturel mat',
    previewCss: 'linear-gradient(135deg, #e2ded3 0%, #cbc5b7 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xe4e0d5,
      map: limestone.albedo,
      normalMap: limestone.normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.85,
      metalness: 0.0,
    }),
  });

  // 3. Marbre Blanc de Carrare
  const marble = createMarbleTexture();
  catalog.set(3, {
    id: 3,
    category: 'bricks',
    name: 'Marbre Blanc Satiné',
    subtitle: 'Pierre noble veinée douce',
    previewCss: 'linear-gradient(135deg, #eaedf0 0%, #cbd5e1 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xe2e6ec,
      map: marble.albedo,
      normalMap: marble.normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.45,
      metalness: 0.02,
    }),
  });

  // 4. Brique Blanche Rustique (Ton Craie & Pierre Chaude)
  catalog.set(4, {
    id: 4,
    category: 'bricks',
    name: 'Brique Blanche Craie',
    subtitle: 'Brique de campagne ton sable chaud',
    previewCss: 'linear-gradient(135deg, #dfd9c8 0%, #c7bea8 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xddd6c5,
      map: whiteBrickPBR.albedo,
      normalMap: whiteBrickPBR.normal,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: whiteBrickPBR.roughness,
      roughness: 0.92,
      metalness: 0.0,
    }),
  });

  // 5. Lanterne Blanche Architecturale
  catalog.set(5, {
    id: 5,
    category: 'bricks',
    name: 'Brique Ambrée Douce',
    subtitle: 'Lanterne chaude apaisante',
    previewCss: 'radial-gradient(circle, #fef3c7 0%, #f59e0b 100%)',
    isLight: true,
    material: new THREE.MeshStandardMaterial({
      color: 0xfde68a,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.55,
      roughness: 0.5,
    }),
  });

  // 6. Verre Blanc Cristallin
  catalog.set(6, {
    id: 6,
    category: 'bricks',
    name: 'Verre Cristallin',
    subtitle: 'Verre architectural translucide',
    previewCss: 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(186,230,253,0.6) 100%)',
    material: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.52,
      roughness: 0.08,
      metalness: 0.05,
      transmission: 0.6,
      ior: 1.5,
      clearcoat: 1.0,
    }),
  });

  // --- CATÉGORIE 2 : SOLS & PLAFONDS - CARRÉS PLATS ('slabs') ---
  // 10. Dalle Sol Pierre Blanche
  catalog.set(10, {
    id: 10,
    category: 'slabs',
    name: 'Sol Pierre Blanche',
    subtitle: 'Carré plat de sol en travertin blanc',
    previewCss: 'linear-gradient(180deg, transparent 58%, #f5f3ec 58%, #d6d2c6 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xf5f3ec }),
  });

  // 11. Dalle Sol Parquet Chêne
  catalog.set(11, {
    id: 11,
    category: 'slabs',
    name: 'Sol Parquet Chêne',
    subtitle: 'Carré plat de plancher en chêne',
    previewCss: 'linear-gradient(180deg, transparent 58%, #b68654 58%, #7c532d 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  // 12. Dalle Sol Marbre Blanc
  catalog.set(12, {
    id: 12,
    category: 'slabs',
    name: 'Sol Marbre Blanc',
    subtitle: 'Carré plat de carrelage en marbre poli',
    previewCss: 'linear-gradient(180deg, transparent 58%, #ffffff 58%, #cbd5e1 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  });

  // 13. Plafond Blanc Lisse
  catalog.set(13, {
    id: 13,
    category: 'slabs',
    name: 'Plafond Blanc Lisse',
    subtitle: 'Carré plat de plafond architectural blanc',
    previewCss: 'linear-gradient(180deg, #ffffff 0%, #cbd5e1 42%, transparent 42%)',
    material: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  });

  // 14. Plafond Caisson Lumineux
  catalog.set(14, {
    id: 14,
    category: 'slabs',
    name: 'Plafond Lumineux LED',
    subtitle: 'Carré plat de plafond éclairant',
    previewCss: 'linear-gradient(180deg, #fef08a 0%, #ffffff 42%, transparent 42%)',
    isLight: true,
    material: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  });

  // 15. Plafond Bois Chêne
  catalog.set(15, {
    id: 15,
    category: 'slabs',
    name: 'Plafond Lambris Chêne',
    subtitle: 'Carré plat de plafond en chêne chaud',
    previewCss: 'linear-gradient(180deg, #9a6b3e 0%, #7c532d 42%, transparent 42%)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  // --- CATÉGORIE 3 : PORTES & FENÊTRES ('openings') ---
  // 7. Fenêtre Croisée de Campagne (Chêne & Cadre Blanc)
  catalog.set(7, {
    id: 7,
    category: 'openings',
    name: 'Fenêtre Croisée',
    subtitle: 'Fenêtre chêne & rebord pierre [R: Pivoter]',
    previewCss:
      'linear-gradient(90deg, transparent 44%, #9a6b3e 44%, #9a6b3e 56%, transparent 56%), linear-gradient(0deg, transparent 44%, #9a6b3e 44%, #9a6b3e 56%, transparent 56%), linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  });

  // 8. Baie Vitrée Blanche Architecturale
  catalog.set(8, {
    id: 8,
    category: 'openings',
    name: 'Fenêtre Panoramique',
    subtitle: 'Châssis blanc épuré & double vitrage [R]',
    previewCss:
      'linear-gradient(135deg, #f8fafc 0%, #f8fafc 15%, #bae6fd 15%, #e0f2fe 85%, #f8fafc 85%)',
    material: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  });

  // 28. Baie Vitrée Sans Bord (Vitre continue bord à bord)
  catalog.set(28, {
    id: 28,
    category: 'openings',
    name: 'Baie Vitrée Sans Bord',
    subtitle: 'Vitre pure continue sans cadre [R: Pivoter]',
    previewCss:
      'linear-gradient(135deg, rgba(186, 230, 253, 0.55) 0%, rgba(224, 242, 254, 0.9) 50%, rgba(125, 211, 252, 0.65) 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xe0f2fe }),
  });

  // 9. Porte de Campagne en Chêne & Cadre Blanc (Hauteur 2 blocs, ouvrable avec E)
  catalog.set(9, {
    id: 9,
    category: 'openings',
    name: 'Porte de Campagne',
    subtitle: 'Porte 2m en chêne ouvrable [E: Ouvrir • R: Pivoter]',
    previewCss: 'linear-gradient(180deg, #bae6fd 0%, #bae6fd 38%, #9a6b3e 38%, #7c532d 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  // --- CATÉGORIE 4 : ESCALIERS, ÉCHELLES & CUBES TRIANGLES ('stairs_roofs') ---
  // 16. Escalier Pierre Blanche
  catalog.set(16, {
    id: 16,
    category: 'stairs_roofs',
    name: 'Escalier Pierre Blanche',
    subtitle: 'Escalier 3 marches à montée auto [R: Pivoter]',
    previewCss:
      'linear-gradient(135deg, transparent 35%, #e5e1d6 35%, #c8c3b6 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xe5e1d6 }),
  });

  // 17. Escalier Bois de Chêne
  catalog.set(17, {
    id: 17,
    category: 'stairs_roofs',
    name: 'Escalier Bois de Chêne',
    subtitle: 'Escalier chaleureux en chêne [R: Pivoter]',
    previewCss:
      'linear-gradient(135deg, transparent 35%, #b68654 35%, #7c532d 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  // 18. Échelle en Chêne (Grimpable !)
  catalog.set(18, {
    id: 18,
    category: 'stairs_roofs',
    name: 'Échelle en Chêne',
    subtitle: 'Avancez contre l’échelle pour grimper [R: Pivoter]',
    previewCss:
      'repeating-linear-gradient(0deg, #9a6b3e 0px, #9a6b3e 4px, transparent 4px, transparent 10px)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  // 19. Cube Triangle / Pente 45° Blanche
  catalog.set(19, {
    id: 19,
    category: 'stairs_roofs',
    name: 'Cube Triangle Blanc',
    subtitle: 'Prisme triangulaire 45° (Toit / Rampe) [R: Pivoter]',
    previewCss: 'linear-gradient(45deg, #e5e1d6 50%, transparent 50%)',
    material: new THREE.MeshStandardMaterial({ color: 0xe5e1d6 }),
  });

  // 20. Cube Triangle / Toit en Chêne 45°
  catalog.set(20, {
    id: 20,
    category: 'stairs_roofs',
    name: 'Cube Triangle Chêne',
    subtitle: 'Pente de toit 45° en bois de chêne [R: Pivoter]',
    previewCss: 'linear-gradient(45deg, #9a6b3e 50%, transparent 50%)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  // 21. Faîtage / Double Pente Triangulaire
  catalog.set(21, {
    id: 21,
    category: 'stairs_roofs',
    name: 'Faîtage Double Pente',
    subtitle: 'Sommet de toit triangulaire symétrique [R]',
    previewCss: 'conic-gradient(from 135deg at 50% 25%, #e5e1d6 0deg 90deg, transparent 90deg 360deg)',
    material: new THREE.MeshStandardMaterial({ color: 0xe5e1d6 }),
  });

  // --- CATÉGORIE 5 : PILIERS, CLÔTURES & DÉCORATION ('decor') ---
  // 22. Colonne / Pilier Rond Blanc
  catalog.set(22, {
    id: 22,
    category: 'decor',
    name: 'Colonne Pierre Blanche',
    subtitle: 'Pilier cylindrique avec base et chapiteau',
    previewCss: 'linear-gradient(90deg, transparent 22%, #e5e1d6 22%, #c8c3b6 78%, transparent 78%)',
    material: new THREE.MeshStandardMaterial({ color: 0xe5e1d6 }),
  });

  // 23. Garde-Corps / Balustrade Blanche
  catalog.set(23, {
    id: 23,
    category: 'decor',
    name: 'Garde-Corps Balustrade',
    subtitle: 'Rambarde en pierre blanche pour balcon/terrasse [R]',
    previewCss:
      'repeating-linear-gradient(90deg, #e5e1d6 0px, #e5e1d6 5px, transparent 5px, transparent 10px)',
    material: new THREE.MeshStandardMaterial({ color: 0xe5e1d6 }),
  });

  // 24. Clôture de Campagne en Chêne
  catalog.set(24, {
    id: 24,
    category: 'decor',
    name: 'Clôture en Chêne',
    subtitle: 'Barrière de jardin en bois massif [R: Pivoter]',
    previewCss:
      'repeating-linear-gradient(90deg, #9a6b3e 0px, #9a6b3e 6px, transparent 6px, transparent 12px)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  // 25. Bloc d'Arche / Arcade Blanche
  catalog.set(25, {
    id: 25,
    category: 'decor',
    name: 'Arche Voûtée Blanche',
    subtitle: 'Linteau arqué en pierre blanche [R: Pivoter]',
    previewCss: 'radial-gradient(circle at 50% 100%, transparent 42%, #e5e1d6 43%)',
    material: new THREE.MeshStandardMaterial({ color: 0xe5e1d6 }),
  });

  // 26. Jardinière Fleurie en Pierre Blanche
  catalog.set(26, {
    id: 26,
    category: 'decor',
    name: 'Jardinière Fleurie',
    subtitle: 'Bac en pierre blanche avec arbuste et fleurs',
    previewCss: 'linear-gradient(180deg, #3f742b 0%, #3f742b 48%, #e5e1d6 48%, #c8c3b6 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x3f742b }),
  });

  // 27. Lampadaire / Lanterne sur Pied
  catalog.set(27, {
    id: 27,
    category: 'decor',
    name: 'Lampadaire Lanterne',
    subtitle: 'Lanterne sur pied à lumière chaude apaisante',
    previewCss: 'radial-gradient(circle at 50% 35%, #fde68a 0%, #27303f 65%)',
    isLight: true,
    material: new THREE.MeshStandardMaterial({ color: 0xfde68a }),
  });

  // --- CATÉGORIE 6 : MOBILIER INTÉRIEUR ('furniture') ---
  // 29. Table Basse Chêne & Marbre
  catalog.set(29, {
    id: 29,
    category: 'furniture',
    name: 'Table Chêne & Marbre',
    subtitle: 'Plateau marbre sur 4 pieds en chêne massif [R]',
    previewCss: 'linear-gradient(180deg, #ffffff 0%, #ffffff 32%, #9a6b3e 32%, #7c532d 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  });

  // 30. Fauteuil / Canapé Moderne
  catalog.set(30, {
    id: 30,
    category: 'furniture',
    name: 'Fauteuil Confort',
    subtitle: 'Assise contemporaine en lin [E: S’asseoir • R]',
    previewCss: 'linear-gradient(135deg, #e8e2d5 0%, #d4cbba 65%, #9a6b3e 65%, #7c532d 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xe8e2d5 }),
  });

  // 31. Lit Douillet Moderne
  catalog.set(31, {
    id: 31,
    category: 'furniture',
    name: 'Lit Douillet Moderne',
    subtitle: 'Cadre bois, matelas blanc, oreiller et couette bleue [R]',
    previewCss: 'linear-gradient(180deg, #f5f5f5 0%, #f5f5f5 42%, #3b82f6 42%, #1d4ed8 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x3b82f6 }),
  });

  // 32. Bibliothèque Garnie
  catalog.set(32, {
    id: 32,
    category: 'furniture',
    name: 'Bibliothèque Garnie',
    subtitle: 'Meuble en chêne avec étagères de livres reliés [R]',
    previewCss:
      'repeating-linear-gradient(90deg, #991b1b 0px, #991b1b 5px, #1e3a8a 5px, #1e3a8a 10px, #065f46 10px, #065f46 15px, #9a6b3e 15px, #9a6b3e 18px)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  // 33. Cheminée de Campagne
  catalog.set(33, {
    id: 33,
    category: 'furniture',
    name: 'Cheminée Pierre & Feu',
    subtitle: 'Manteau calcaire et braises ardentes lumineuses [R]',
    previewCss: 'radial-gradient(circle at 50% 65%, #ff5500 0%, #1e293b 62%)',
    isLight: true,
    material: new THREE.MeshStandardMaterial({ color: 0xff5500 }),
  });

  // 34. Tapis de Sol Décoratif
  catalog.set(34, {
    id: 34,
    category: 'furniture',
    name: 'Tapis de Salon Déco',
    subtitle: 'Tapis doux ultra-fin posé au sol',
    previewCss: 'linear-gradient(180deg, transparent 75%, #d8cca8 75%, #b8a67c 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xd8cca8 }),
  });

  // --- CATÉGORIE 7 : NATURE, EAU & EXTÉRIEUR ('nature') ---
  // 35. Bloc d'Eau Ondoyante (Permet de nager)
  catalog.set(35, {
    id: 35,
    category: 'nature',
    name: 'Bassin d’Eau Cristalline',
    subtitle: 'Eau translucide ondoyante • Plongez pour nager !',
    previewCss: 'linear-gradient(135deg, rgba(56, 189, 248, 0.7) 0%, rgba(2, 132, 199, 0.85) 100%)',
    material: new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.6,
      roughness: 0.05,
    }),
  });

  // 36. Pas Japonais en Ardoise
  catalog.set(36, {
    id: 36,
    category: 'nature',
    name: 'Pas Japonais Ardoise',
    subtitle: 'Dalles de jardin plates pour allée paysagère [R]',
    previewCss: 'linear-gradient(180deg, transparent 65%, #475569 65%, #1e293b 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x475569 }),
  });

  // 37. Haie Végétale Dense
  catalog.set(37, {
    id: 37,
    category: 'nature',
    name: 'Haie Végétale Dense',
    subtitle: 'Buisson de feuillage taillé au carré',
    previewCss: 'radial-gradient(circle, #4d8c36 0%, #2f5d21 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x3f742b }),
  });

  // 38. Cyprès en Pot
  catalog.set(38, {
    id: 38,
    category: 'nature',
    name: 'Cyprès en Pot Terre Cuite',
    subtitle: 'Arbuste conique méditerranéen élégant',
    previewCss: 'linear-gradient(180deg, #1e3a1f 0%, #1e3a1f 65%, #b45309 65%, #78350f 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x1e3a1f }),
  });

  // 39. Bloc de Terre Riche (Minecraft)
  const dirtPBR = createDirtPBR();
  catalog.set(39, {
    id: 39,
    category: 'nature',
    name: 'Bloc de Terre Meuble',
    subtitle: 'Terre brune naturelle de sous-sol [Minecraft]',
    previewCss: 'linear-gradient(135deg, #5c4033 0%, #3e2723 100%)',
    material: new THREE.MeshStandardMaterial({
      map: dirtPBR.albedo,
      normalMap: dirtPBR.normal,
      roughness: 0.95,
      metalness: 0.0,
    }),
  });

  // 40. Bloc de Gazon Cubique (Minecraft)
  const grassBlockMats = createGrassBlockMaterials();
  catalog.set(40, {
    id: 40,
    category: 'nature',
    name: 'Bloc d\'Herbe & Gazon',
    subtitle: 'Cube de prairie herbeuse naturelle [Minecraft]',
    previewCss: 'linear-gradient(180deg, #4a7c36 40%, #5c4033 40%)',
    material: grassBlockMats as unknown as THREE.Material,
  });

  // 41. Bloc de Roche & Pierre Brute
  const stonePBR = createStonePBR();
  catalog.set(41, {
    id: 41,
    category: 'nature',
    name: 'Roche / Pierre Naturelle',
    subtitle: 'Roche brute de carrière et de sous-sol',
    previewCss: 'linear-gradient(135deg, #64748b 0%, #334155 100%)',
    material: new THREE.MeshStandardMaterial({
      map: stonePBR.albedo,
      normalMap: stonePBR.normal,
      roughness: 0.88,
      metalness: 0.02,
    }),
  });

  // 42. Bloc de Sable Doré
  catalog.set(42, {
    id: 42,
    category: 'nature',
    name: 'Sable Fin Doré',
    subtitle: 'Sable de plage ou de carrière paysagère',
    previewCss: 'linear-gradient(135deg, #fcd34d 0%, #d97706 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xe0b978,
      roughness: 0.92,
      metalness: 0.0,
    }),
  });

  // 43. Bloc de Gravier Concassé
  catalog.set(43, {
    id: 43,
    category: 'nature',
    name: 'Gravier Concassé',
    subtitle: 'Petits galets et cailloux de jardin',
    previewCss: 'linear-gradient(135deg, #94a3b8 0%, #475569 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0x78716c,
      roughness: 0.86,
      metalness: 0.0,
    }),
  });

  return catalog;
}
