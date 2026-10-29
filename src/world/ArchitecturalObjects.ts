import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const BRICK_TYPE_WINDOW_CROSS = 7;
export const BRICK_TYPE_WINDOW_MODERN = 8;
export const BRICK_TYPE_DOOR_OAK = 9;

// Carrés plats pour Sols (posés au bas de la case : y - 0.42, épaisseur 0.16m)
export const SLAB_TYPE_FLOOR_STONE = 10;
export const SLAB_TYPE_FLOOR_OAK = 11;
export const SLAB_TYPE_FLOOR_MARBLE = 12;

// Carrés plats pour Plafonds (posés en haut de la case : y + 0.42, épaisseur 0.16m)
export const SLAB_TYPE_CEILING_WHITE = 13;
export const SLAB_TYPE_CEILING_LIGHT = 14;
export const SLAB_TYPE_CEILING_OAK = 15;

export const SLAB_THICKNESS = 0.16;
export const SLAB_OFFSET_Y = 0.5 - SLAB_THICKNESS / 2; // 0.42

export function isFloorSlab(type: number): boolean {
  return (
    type === SLAB_TYPE_FLOOR_STONE ||
    type === SLAB_TYPE_FLOOR_OAK ||
    type === SLAB_TYPE_FLOOR_MARBLE
  );
}

export function isCeilingSlab(type: number): boolean {
  return (
    type === SLAB_TYPE_CEILING_WHITE ||
    type === SLAB_TYPE_CEILING_LIGHT ||
    type === SLAB_TYPE_CEILING_OAK
  );
}

export function isFlatSlab(type: number): boolean {
  return isFloorSlab(type) || isCeilingSlab(type);
}

export function isArchitecturalObject(type: number): boolean {
  return (
    type === BRICK_TYPE_WINDOW_CROSS ||
    type === BRICK_TYPE_WINDOW_MODERN ||
    type === BRICK_TYPE_DOOR_OAK ||
    isFlatSlab(type)
  );
}

export function isTwoBlocksTall(type: number): boolean {
  return type === BRICK_TYPE_DOOR_OAK;
}

function createOakWoodTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Warm natural honey oak base
  ctx.fillStyle = '#9a6b3e';
  ctx.fillRect(0, 0, size, size);

  // Parquet plank lines (4 planks per meter)
  const planks = 4;
  const plankW = size / planks;
  for (let p = 0; p < planks; p++) {
    const shade = (p % 2 === 0 ? 1 : -1) * 8;
    ctx.fillStyle = `rgb(${154 + shade}, ${107 + shade}, ${62 + shade})`;
    ctx.fillRect(p * plankW, 0, plankW, size);
    ctx.strokeStyle = 'rgba(58, 35, 16, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(p * plankW + 1.5, 1.5, plankW - 3, size - 3);
  }

  // Wood fibers and annual rings
  for (let i = 0; i < 450; i++) {
    const x = Math.random() * size;
    const w = 2 + Math.random() * 6;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(72, 46, 22, 0.14)' : 'rgba(182, 134, 84, 0.12)';
    ctx.fillRect(x, 0, w, size);
  }

  // Fine grain streaks
  ctx.strokeStyle = 'rgba(58, 35, 16, 0.2)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 120; i++) {
    ctx.beginPath();
    let x = Math.random() * size;
    ctx.moveTo(x, 0);
    for (let y = 0; y <= size; y += 32) {
      x += (Math.random() - 0.5) * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function createStoneTileTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f5f3ec';
  ctx.fillRect(0, 0, size, size);

  // Subtle 2x2 architectural floor tiles per square meter
  ctx.strokeStyle = '#d6d2c6';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  // Travertine stone micro-speckles
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.2)' : 'rgba(195,190,178,0.15)';
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let sharedMaterials: {
  whiteFrame: THREE.MeshStandardMaterial;
  stoneSill: THREE.MeshStandardMaterial;
  stoneTile: THREE.MeshStandardMaterial;
  marbleTile: THREE.MeshPhysicalMaterial;
  ceilingWhite: THREE.MeshStandardMaterial;
  ceilingLight: THREE.MeshStandardMaterial;
  oakWood: THREE.MeshStandardMaterial;
  clearGlass: THREE.MeshPhysicalMaterial;
  brassMetal: THREE.MeshStandardMaterial;
} | null = null;

let sharedSlabGeo: THREE.BufferGeometry | null = null;

export function getSharedArchMaterials() {
  if (!sharedMaterials) {
    const oakTex = createOakWoodTexture();
    const stoneTileTex = createStoneTileTexture();
    sharedMaterials = {
      whiteFrame: new THREE.MeshStandardMaterial({
        color: 0xf8f6f0,
        roughness: 0.42,
        metalness: 0.04,
      }),
      stoneSill: new THREE.MeshStandardMaterial({
        color: 0xe7e3d8,
        roughness: 0.78,
        metalness: 0.02,
      }),
      stoneTile: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneTileTex,
        roughness: 0.62,
        metalness: 0.02,
      }),
      marbleTile: new THREE.MeshPhysicalMaterial({
        color: 0xfafcff,
        map: stoneTileTex,
        roughness: 0.14,
        metalness: 0.03,
        clearcoat: 0.8,
        clearcoatRoughness: 0.1,
      }),
      ceilingWhite: new THREE.MeshStandardMaterial({
        color: 0xfcfcfc,
        roughness: 0.5,
        metalness: 0.02,
      }),
      ceilingLight: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xfffbeb,
        emissiveIntensity: 1.5,
        roughness: 0.2,
      }),
      oakWood: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: oakTex,
        roughness: 0.52,
        metalness: 0.03,
      }),
      clearGlass: new THREE.MeshPhysicalMaterial({
        color: 0xe0f2fe,
        transparent: true,
        opacity: 0.36,
        roughness: 0.05,
        metalness: 0.05,
        transmission: 0.78,
        ior: 1.52,
        clearcoat: 1.0,
      }),
      brassMetal: new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.25,
        metalness: 0.88,
      }),
    };
  }
  return sharedMaterials;
}

/**
 * Construit un Carré Plat (Dalle de Sol ou Dalle de Plafond : 1.0m x 0.16m x 1.0m)
 */
export function createFlatSlabMesh(type: number): THREE.Mesh {
  if (!sharedSlabGeo) {
    sharedSlabGeo = new RoundedBoxGeometry(1, SLAB_THICKNESS, 1, 3, 0.018);
  }
  const mats = getSharedArchMaterials();
  let mat: THREE.Material = mats.stoneTile;

  switch (type) {
    case SLAB_TYPE_FLOOR_STONE:
      mat = mats.stoneTile;
      break;
    case SLAB_TYPE_FLOOR_OAK:
    case SLAB_TYPE_CEILING_OAK:
      mat = mats.oakWood;
      break;
    case SLAB_TYPE_FLOOR_MARBLE:
      mat = mats.marbleTile;
      break;
    case SLAB_TYPE_CEILING_WHITE:
      mat = mats.ceilingWhite;
      break;
    case SLAB_TYPE_CEILING_LIGHT:
      mat = mats.ceilingLight;
      break;
  }

  const mesh = new THREE.Mesh(sharedSlabGeo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Construit une Fenêtre Croisée de Campagne (1x1x1m)
 */
export function createCrossWindowGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const frameDepth = 0.28;
  const frameThick = 0.085;

  const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.0, frameThick, frameDepth), mats.whiteFrame);
  topBar.position.set(0, 0.5 - frameThick / 2, 0);

  const bottomBar = new THREE.Mesh(new THREE.BoxGeometry(1.0, frameThick, frameDepth), mats.whiteFrame);
  bottomBar.position.set(0, -0.5 + frameThick / 2, 0);

  const leftBar = new THREE.Mesh(
    new THREE.BoxGeometry(frameThick, 1.0 - frameThick * 2, frameDepth),
    mats.whiteFrame
  );
  leftBar.position.set(-0.5 + frameThick / 2, 0, 0);

  const rightBar = new THREE.Mesh(
    new THREE.BoxGeometry(frameThick, 1.0 - frameThick * 2, frameDepth),
    mats.whiteFrame
  );
  rightBar.position.set(0.5 - frameThick / 2, 0, 0);

  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.06, 0.42), mats.stoneSill);
  sill.position.set(0, -0.47, 0.03);

  const innerSize = 1.0 - frameThick * 2;
  const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.04, innerSize, 0.07), mats.oakWood);
  const mullionH = new THREE.Mesh(new THREE.BoxGeometry(innerSize, 0.04, 0.07), mats.oakWood);

  const glassPane = new THREE.Mesh(new THREE.BoxGeometry(innerSize, innerSize, 0.03), mats.clearGlass);

  group.add(topBar, bottomBar, leftBar, rightBar, sill, mullionV, mullionH, glassPane);
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = obj !== glassPane;
      obj.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Construit une Baie Vitrée Blanche Architecturale (1x1x1m)
 */
export function createModernWindowGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const frameDepth = 0.24;
  const frameThick = 0.065;

  const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.0, frameThick, frameDepth), mats.whiteFrame);
  topBar.position.set(0, 0.5 - frameThick / 2, 0);

  const bottomBar = new THREE.Mesh(new THREE.BoxGeometry(1.0, frameThick, frameDepth), mats.whiteFrame);
  bottomBar.position.set(0, -0.5 + frameThick / 2, 0);

  const leftBar = new THREE.Mesh(
    new THREE.BoxGeometry(frameThick, 1.0 - frameThick * 2, frameDepth),
    mats.whiteFrame
  );
  leftBar.position.set(-0.5 + frameThick / 2, 0, 0);

  const rightBar = new THREE.Mesh(
    new THREE.BoxGeometry(frameThick, 1.0 - frameThick * 2, frameDepth),
    mats.whiteFrame
  );
  rightBar.position.set(0.5 - frameThick / 2, 0, 0);

  const innerSize = 1.0 - frameThick * 2;
  const glassPane = new THREE.Mesh(new THREE.BoxGeometry(innerSize, innerSize, 0.035), mats.clearGlass);

  group.add(topBar, bottomBar, leftBar, rightBar, glassPane);
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = obj !== glassPane;
      obj.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Construit une Porte de Campagne Ouvrable de 2m de haut (1x2x1m)
 */
export function createOakDoorGroup(): { root: THREE.Group; doorPivot: THREE.Group } {
  const mats = getSharedArchMaterials();
  const root = new THREE.Group();

  const frameDepth = 0.3;
  const jambW = 0.085;
  const totalH = 2.0;

  const leftJamb = new THREE.Mesh(new THREE.BoxGeometry(jambW, totalH, frameDepth), mats.whiteFrame);
  leftJamb.position.set(-0.5 + jambW / 2, 0.5, 0);

  const rightJamb = new THREE.Mesh(new THREE.BoxGeometry(jambW, totalH, frameDepth), mats.whiteFrame);
  rightJamb.position.set(0.5 - jambW / 2, 0, 0);
  rightJamb.position.y = 0.5;

  const topLintel = new THREE.Mesh(new THREE.BoxGeometry(1.0, jambW, frameDepth + 0.03), mats.whiteFrame);
  topLintel.position.set(0, 1.5 - jambW / 2, 0);

  const threshold = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.04, 0.36), mats.stoneSill);
  threshold.position.set(0, -0.48, 0);

  root.add(leftJamb, rightJamb, topLintel, threshold);

  const doorPivot = new THREE.Group();
  const leafW = 1.0 - jambW * 2;
  const leafH = totalH - jambW - 0.04;
  const leafThick = 0.075;

  doorPivot.position.set(-leafW / 2, -0.46, 0);

  const leafGroup = new THREE.Group();
  leafGroup.position.set(leafW / 2, leafH / 2, 0);

  const lowerPanel = new THREE.Mesh(
    new THREE.BoxGeometry(leafW, leafH * 0.58, leafThick),
    mats.oakWood
  );
  lowerPanel.position.set(0, -leafH * 0.21, 0);

  const raisedPanel = new THREE.Mesh(
    new THREE.BoxGeometry(leafW * 0.72, leafH * 0.42, leafThick + 0.025),
    mats.oakWood
  );
  raisedPanel.position.set(0, -leafH * 0.21, 0);

  const stileW = 0.11;
  const upperH = leafH * 0.42;
  const upperY = leafH * 0.29;

  const stileLeft = new THREE.Mesh(new THREE.BoxGeometry(stileW, upperH, leafThick), mats.oakWood);
  stileLeft.position.set(-leafW / 2 + stileW / 2, upperY, 0);

  const stileRight = new THREE.Mesh(new THREE.BoxGeometry(stileW, upperH, leafThick), mats.oakWood);
  stileRight.position.set(leafW / 2 - stileW / 2, upperY, 0);

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(leafW, stileW, leafThick), mats.oakWood);
  topRail.position.set(0, leafH / 2 - stileW / 2, 0);

  const glassW = leafW - stileW * 2;
  const glassH = upperH - stileW;
  const doorGlass = new THREE.Mesh(
    new THREE.BoxGeometry(glassW, glassH, 0.025),
    mats.clearGlass
  );
  doorGlass.position.set(0, upperY - stileW * 0.3, 0);

  const doorCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.03, glassH, 0.045), mats.oakWood);
  doorCrossV.position.copy(doorGlass.position);
  const doorCrossH = new THREE.Mesh(new THREE.BoxGeometry(glassW, 0.03, 0.045), mats.oakWood);
  doorCrossH.position.copy(doorGlass.position);

  const handlePlate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, leafThick + 0.02), mats.brassMetal);
  handlePlate.position.set(leafW * 0.36, -0.04, 0);

  const handleBar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.024, leafThick + 0.09), mats.brassMetal);
  handleBar.position.set(leafW * 0.32, -0.04, 0);

  leafGroup.add(
    lowerPanel,
    raisedPanel,
    stileLeft,
    stileRight,
    topRail,
    doorGlass,
    doorCrossV,
    doorCrossH,
    handlePlate,
    handleBar
  );

  doorPivot.add(leafGroup);
  root.add(doorPivot);

  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = obj !== doorGlass;
      obj.receiveShadow = true;
    }
  });

  return { root, doorPivot };
}
