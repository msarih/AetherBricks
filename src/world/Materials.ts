import * as THREE from 'three';

export interface BrickDefinition {
  id: number;
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

  // 1. Fond de mortier (joint creux couleur chaux/sable clair)
  aCtx.fillStyle = '#d8d4cb';
  aCtx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#262626'; // Creux profond pour le mortier
  hCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#ececec'; // Mortier très mat (rugosité élevée)
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

    // Couleur de base de la brique blanche (légère variation naturelle de blanc chaux / craie)
    const baseWarmth = (seed % 7) - 3;
    const r = Math.min(255, 248 + baseWarmth);
    const g = Math.min(255, 247 + baseWarmth);
    const b = Math.min(255, 243 + baseWarmth);

    const grad = aCtx.createLinearGradient(bx, by, bx + bw, by + bh);
    grad.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
    grad.addColorStop(0.5, `rgb(${r - 4}, ${g - 4}, ${b - 5})`);
    grad.addColorStop(1, `rgb(${r - 9}, ${g - 9}, ${b - 10})`);

    aCtx.fillStyle = grad;
    aCtx.beginPath();
    aCtx.roundRect(bx, by, bw, bh, 8);
    aCtx.fill();

    // Fine lisière claire d'usure sur le bord de la brique
    aCtx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    aCtx.lineWidth = 3;
    aCtx.beginPath();
    aCtx.roundRect(bx + 2, by + 2, bw - 4, bh - 4, 7);
    aCtx.stroke();

    // Rugosité de la brique (plus douce que le mortier, avec variations de badigeon de chaux)
    const roughBase = 150 + (seed % 20);
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

  albedo.repeat.set(65, 65);
  normal.repeat.set(65, 65);
  roughness.repeat.set(65, 65);

  albedo.anisotropy = 16;
  normal.anisotropy = 16;
  roughness.anisotropy = 16;

  return { albedo, normal, roughness };
}

export function createBrickCatalog(): Map<number, BrickDefinition> {
  const catalog = new Map<number, BrickDefinition>();

  // 1. Brique Blanche Réaliste (Maçonnerie blanchie à la chaux + joints creux)
  const whiteBrickPBR = createRealisticWhiteBrickPBR();
  catalog.set(1, {
    id: 1,
    name: 'Brique Blanche Chaux',
    subtitle: 'Maçonnerie réaliste à joints creux',
    previewCss: 'linear-gradient(135deg, #ffffff 0%, #dcd8ce 100%)',
    material: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: whiteBrickPBR.albedo,
      normalMap: whiteBrickPBR.normal,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughnessMap: whiteBrickPBR.roughness,
      roughness: 0.78,
      metalness: 0.01,
      clearcoat: 0.04,
      clearcoatRoughness: 0.8,
    }),
  });

  // 2. Pierre Blanche de Taille (Calcaire ciselé)
  const limestone = createCutLimestonePBR('#f7f5ee');
  catalog.set(2, {
    id: 2,
    name: 'Pierre Blanche Taillée',
    subtitle: 'Bloc de calcaire naturel',
    previewCss: 'linear-gradient(135deg, #faf8f2 0%, #e2dfd5 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: limestone.albedo,
      normalMap: limestone.normal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.68,
      metalness: 0.02,
    }),
  });

  // 3. Marbre Blanc de Carrare
  const marble = createMarbleTexture();
  catalog.set(3, {
    id: 3,
    name: 'Marbre Blanc Poli',
    subtitle: 'Pierre noble veinée à reflets',
    previewCss: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)',
    material: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: marble.albedo,
      normalMap: marble.normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.14,
      metalness: 0.02,
      clearcoat: 0.75,
      clearcoatRoughness: 0.1,
    }),
  });

  // 4. Brique Blanche Rustique (Ton Craie & Pierre Chaude)
  catalog.set(4, {
    id: 4,
    name: 'Brique Blanche Craie',
    subtitle: 'Brique de campagne ton chaud',
    previewCss: 'linear-gradient(135deg, #fdfbf7 0%, #e5dec9 100%)',
    material: new THREE.MeshPhysicalMaterial({
      color: 0xf7f3e8,
      map: whiteBrickPBR.albedo,
      normalMap: whiteBrickPBR.normal,
      normalScale: new THREE.Vector2(1.3, 1.3),
      roughnessMap: whiteBrickPBR.roughness,
      roughness: 0.86,
      metalness: 0.01,
    }),
  });

  // 5. Lanterne Blanche Architecturale
  catalog.set(5, {
    id: 5,
    name: 'Brique Lumineuse',
    subtitle: 'Lanterne blanche chaude',
    previewCss: 'radial-gradient(circle, #ffffff 0%, #fef08a 100%)',
    isLight: true,
    material: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfffbeb,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    }),
  });

  // 6. Verre Blanc Cristallin
  catalog.set(6, {
    id: 6,
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

  // 7. Fenêtre Croisée de Campagne (Chêne & Cadre Blanc)
  catalog.set(7, {
    id: 7,
    name: 'Fenêtre Croisée',
    subtitle: 'Fenêtre chêne & rebord pierre [R: Pivoter]',
    previewCss:
      'linear-gradient(90deg, transparent 44%, #9a6b3e 44%, #9a6b3e 56%, transparent 56%), linear-gradient(0deg, transparent 44%, #9a6b3e 44%, #9a6b3e 56%, transparent 56%), linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  });

  // 8. Baie Vitrée Blanche Architecturale
  catalog.set(8, {
    id: 8,
    name: 'Fenêtre Panoramique',
    subtitle: 'Châssis blanc épuré & double vitrage [R]',
    previewCss:
      'linear-gradient(135deg, #f8fafc 0%, #f8fafc 15%, #bae6fd 15%, #e0f2fe 85%, #f8fafc 85%)',
    material: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  });

  // 9. Porte de Campagne en Chêne & Cadre Blanc (Hauteur 2 blocs, ouvrable avec E)
  catalog.set(9, {
    id: 9,
    name: 'Porte de Campagne',
    subtitle: 'Porte 2m en chêne ouvrable [E: Ouvrir • R: Pivoter]',
    previewCss: 'linear-gradient(180deg, #bae6fd 0%, #bae6fd 38%, #9a6b3e 38%, #7c532d 100%)',
    material: new THREE.MeshStandardMaterial({ color: 0x9a6b3e }),
  });

  return catalog;
}
