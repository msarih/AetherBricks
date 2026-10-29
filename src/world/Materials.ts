import * as THREE from 'three';

export interface BrickDefinition {
  id: number;
  name: string;
  subtitle: string;
  previewCss: string;
  material: THREE.Material;
  isLight?: boolean;
}

function createProceduralBrickTextures(): {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
} {
  const size = 512;
  const albedoCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  const roughCanvas = document.createElement('canvas');
  albedoCanvas.width = bumpCanvas.width = roughCanvas.width = size;
  albedoCanvas.height = bumpCanvas.height = roughCanvas.height = size;

  const aCtx = albedoCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;
  const rCtx = roughCanvas.getContext('2d')!;

  // Base white fill
  aCtx.fillStyle = '#f8fafc';
  aCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#ffffff';
  bCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#b8b8b8';
  rCtx.fillRect(0, 0, size, size);

  // Subtle architectural white masonry courses (4 rows per cube)
  const rows = 4;
  const rowH = size / rows;
  const mortarThickness = 6;

  for (let row = 0; row < rows; row++) {
    const y = row * rowH;
    const cols = 2;
    const colW = size / cols;
    const offset = (row % 2) * (colW / 2);

    // Individual subtle brick tone variation (all pure white shades)
    for (let col = -1; col <= cols; col++) {
      const x = col * colW + offset;
      const shade = 247 + Math.floor(Math.random() * 8); // 247..254
      aCtx.fillStyle = `rgb(${shade}, ${shade}, ${Math.min(255, shade + 1)})`;
      aCtx.fillRect(x + mortarThickness / 2, y + mortarThickness / 2, colW - mortarThickness, rowH - mortarThickness);

      const roughVal = 155 + Math.floor(Math.random() * 25);
      rCtx.fillStyle = `rgb(${roughVal}, ${roughVal}, ${roughVal})`;
      rCtx.fillRect(x + mortarThickness / 2, y + mortarThickness / 2, colW - mortarThickness, rowH - mortarThickness);
    }

    // Horizontal mortar groove
    aCtx.fillStyle = '#e2e8f0';
    aCtx.fillRect(0, y - mortarThickness / 2, size, mortarThickness);
    bCtx.fillStyle = '#555555';
    bCtx.fillRect(0, y - mortarThickness / 2, size, mortarThickness);
    rCtx.fillStyle = '#e5e5e5';
    rCtx.fillRect(0, y - mortarThickness / 2, size, mortarThickness);

    // Vertical mortar grooves
    for (let col = 0; col <= cols; col++) {
      const x = (col * colW + offset) % size;
      aCtx.fillStyle = '#e2e8f0';
      aCtx.fillRect(x - mortarThickness / 2, y, mortarThickness, rowH);
      bCtx.fillStyle = '#555555';
      bCtx.fillRect(x - mortarThickness / 2, y, mortarThickness, rowH);
    }
  }

  // Subtle outer cube bevel border
  aCtx.strokeStyle = '#cbd5e1';
  aCtx.lineWidth = 8;
  aCtx.strokeRect(4, 4, size - 8, size - 8);

  bCtx.strokeStyle = '#333333';
  bCtx.lineWidth = 10;
  bCtx.strokeRect(5, 5, size - 10, size - 10);

  // Fine mineral micro-grain noise
  for (let i = 0; i < 8000; i++) {
    const nx = Math.random() * size;
    const ny = Math.random() * size;
    const alpha = Math.random() * 0.035;
    aCtx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(180,190,205,${alpha})`;
    aCtx.fillRect(nx, ny, 2, 2);

    const bAlpha = Math.random() * 0.08;
    bCtx.fillStyle = `rgba(120,120,120,${bAlpha})`;
    bCtx.fillRect(nx, ny, 2, 2);
  }

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  const roughness = new THREE.CanvasTexture(roughCanvas);

  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 8;
  bump.anisotropy = 8;
  roughness.anisotropy = 8;

  return { albedo, bump, roughness };
}

function createMonolithTextures(baseHex: string, borderHex: string): {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const size = 512;
  const albedoCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  albedoCanvas.width = bumpCanvas.width = size;
  albedoCanvas.height = bumpCanvas.height = size;

  const aCtx = albedoCanvas.getContext('2d')!;
  const bCtx = bumpCanvas.getContext('2d')!;

  aCtx.fillStyle = baseHex;
  aCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = '#ffffff';
  bCtx.fillRect(0, 0, size, size);

  // Crisp architectural panel seam around the cube face
  aCtx.strokeStyle = borderHex;
  aCtx.lineWidth = 10;
  aCtx.strokeRect(5, 5, size - 10, size - 10);

  // Inner subtle highlight frame
  aCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  aCtx.lineWidth = 4;
  aCtx.strokeRect(14, 14, size - 28, size - 28);

  bCtx.strokeStyle = '#404040';
  bCtx.lineWidth = 12;
  bCtx.strokeRect(6, 6, size - 12, size - 12);

  // Ultra fine concrete micro-texture
  for (let i = 0; i < 5000; i++) {
    const nx = Math.random() * size;
    const ny = Math.random() * size;
    aCtx.fillStyle = `rgba(200, 210, 220, ${Math.random() * 0.025})`;
    aCtx.fillRect(nx, ny, 2, 2);
    bCtx.fillStyle = `rgba(160, 160, 160, ${Math.random() * 0.05})`;
    bCtx.fillRect(nx, ny, 2, 2);
  }

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = 8;
  bump.anisotropy = 8;
  return { albedo, bump };
}

function createMarbleTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fcfdff';
  ctx.fillRect(0, 0, size, size);

  // Soft Carrara white/silver veins
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.42)';
  ctx.lineWidth = 3;
  for (let v = 0; v < 7; v++) {
    ctx.beginPath();
    let x = Math.random() * size;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < size) {
      y += 24;
      x += (Math.random() - 0.48) * 32;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, size - 8, size - 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createGroundTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Clean architectural slate-white ground tile so pure white bricks pop with contrast & shadows
  ctx.fillStyle = '#dce3ec';
  ctx.fillRect(0, 0, size, size);

  // Subtle 1m sub-grid lines
  ctx.strokeStyle = '#c8d2df';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);

  // Fine crosshairs at center of each meter
  ctx.strokeStyle = '#d1dae6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2 - 16, size / 2);
  ctx.lineTo(size / 2 + 16, size / 2);
  ctx.moveTo(size / 2, size / 2 - 16);
  ctx.lineTo(size / 2, size / 2 + 16);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(160, 160);
  tex.anisotropy = 16;
  return tex;
}

export function createBrickCatalog(): Map<number, BrickDefinition> {
  const catalog = new Map<number, BrickDefinition>();

  // 1. Brique Blanche Classique (Masonry White Brick)
  const masonry = createProceduralBrickTextures();
  catalog.set(1, {
    id: 1,
    name: 'Brique Blanche',
    subtitle: 'Maçonnerie blanche mate',
    previewCss: 'linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: masonry.albedo,
      bumpMap: masonry.bump,
      bumpScale: 0.035,
      roughnessMap: masonry.roughness,
      roughness: 0.65,
      metalness: 0.04,
    }),
  });

  // 2. Monolithe Blanc Pur (Smooth Architectural White Cube)
  const monolith = createMonolithTextures('#ffffff', '#dbe4f0');
  catalog.set(2, {
    id: 2,
    name: 'Cube Blanc Pur',
    subtitle: 'Béton architectural lisse',
    previewCss: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: monolith.albedo,
      bumpMap: monolith.bump,
      bumpScale: 0.02,
      roughness: 0.38,
      metalness: 0.05,
    }),
  });

  // 3. Marbre Blanc Poli (Polished Carrara White)
  const marbleTex = createMarbleTexture();
  catalog.set(3, {
    id: 3,
    name: 'Marbre Blanc',
    subtitle: 'Pierre blanche polie',
    previewCss: 'linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%)',
    material: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: marbleTex,
      roughness: 0.16,
      metalness: 0.02,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
    }),
  });

  // 4. Brique Blanc Chaud / Ivoire (Warm Alabaster White)
  const warmMonolith = createMonolithTextures('#fafaf5', '#e4e2d8');
  catalog.set(4, {
    id: 4,
    name: 'Blanc Albâtre',
    subtitle: 'Calcaire blanc chaud',
    previewCss: 'linear-gradient(135deg, #faf5 0%, #e7e5dc 100%)',
    material: new THREE.MeshStandardMaterial({
      color: 0xfcfaf2,
      map: warmMonolith.albedo,
      bumpMap: masonry.bump,
      bumpScale: 0.028,
      roughness: 0.72,
      metalness: 0.02,
    }),
  });

  // 5. Cube Lumineux Blanc (Pure White Architectural Light Block)
  catalog.set(5, {
    id: 5,
    name: 'Brique Lumineuse',
    subtitle: 'Éclairage blanc pur',
    previewCss: 'radial-gradient(circle, #ffffff 0%, #bae6fd 100%)',
    isLight: true,
    material: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xf0f9ff,
      emissiveIntensity: 1.35,
      roughness: 0.2,
    }),
  });

  // 6. Verre Blanc Dépoli (Frosted White Architectural Glass)
  catalog.set(6, {
    id: 6,
    name: 'Verre Blanc Dépoli',
    subtitle: 'Cube translucide givré',
    previewCss: 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(186,230,253,0.55) 100%)',
    material: new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.62,
      roughness: 0.15,
      metalness: 0.05,
      transmission: 0.45,
      ior: 1.45,
    }),
  });

  return catalog;
}
