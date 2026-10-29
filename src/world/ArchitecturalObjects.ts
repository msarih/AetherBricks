import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const BRICK_TYPE_WINDOW_CROSS = 7;
export const BRICK_TYPE_WINDOW_MODERN = 8;
export const BRICK_TYPE_DOOR_OAK = 9;
export const BRICK_TYPE_WINDOW_FRAMELESS = 28;

// Catégorie Mobilier & Intérieur ('furniture')
export const OBJ_TYPE_TABLE = 29;
export const OBJ_TYPE_CHAIR = 30;
export const OBJ_TYPE_BED = 31;
export const OBJ_TYPE_BOOKSHELF = 32;
export const OBJ_TYPE_FIREPLACE = 33;
export const OBJ_TYPE_CARPET = 34;

// Catégorie Nature & Extérieur ('nature')
export const OBJ_TYPE_WATER = 35;
export const OBJ_TYPE_STEPPING_STONE = 36;
export const OBJ_TYPE_HEDGE = 37;
export const OBJ_TYPE_CYPRESS = 38;

// Carrés plats pour Sols (posés au bas de la case : y - 0.42, épaisseur 0.16m)
export const SLAB_TYPE_FLOOR_STONE = 10;
export const SLAB_TYPE_FLOOR_OAK = 11;
export const SLAB_TYPE_FLOOR_MARBLE = 12;

// Carrés plats pour Plafonds (posés en haut de la case : y + 0.42, épaisseur 0.16m)
export const SLAB_TYPE_CEILING_WHITE = 13;
export const SLAB_TYPE_CEILING_LIGHT = 14;
export const SLAB_TYPE_CEILING_OAK = 15;

// Catégorie Escaliers, Échelles & Cubes Triangles (Toitures / Pentes)
export const OBJ_TYPE_STAIRS_WHITE = 16;
export const OBJ_TYPE_STAIRS_OAK = 17;
export const OBJ_TYPE_LADDER_OAK = 18;
export const OBJ_TYPE_TRIANGLE_WHITE = 19;
export const OBJ_TYPE_TRIANGLE_OAK = 20;
export const OBJ_TYPE_GABLE_ROOF = 21;

// Catégorie Piliers, Clôtures & Décoration
export const OBJ_TYPE_PILLAR_WHITE = 22;
export const OBJ_TYPE_BALUSTRADE_WHITE = 23;
export const OBJ_TYPE_FENCE_OAK = 24;
export const OBJ_TYPE_ARCH_WHITE = 25;
export const OBJ_TYPE_PLANTER_BOX = 26;
export const OBJ_TYPE_LANTERN_POST = 27;

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

export function isStairOrSlope(type: number): boolean {
  return (
    type === OBJ_TYPE_STAIRS_WHITE ||
    type === OBJ_TYPE_STAIRS_OAK ||
    type === OBJ_TYPE_TRIANGLE_WHITE ||
    type === OBJ_TYPE_TRIANGLE_OAK
  );
}

export function isLadder(type: number): boolean {
  return type === OBJ_TYPE_LADDER_OAK;
}

export function isChair(type: number): boolean {
  return type === OBJ_TYPE_CHAIR;
}

export function isWater(type: number): boolean {
  return type === OBJ_TYPE_WATER;
}

export function isCarpet(type: number): boolean {
  return type === OBJ_TYPE_CARPET;
}

export function isArchitecturalObject(type: number): boolean {
  return type >= 7 && type <= 27;
}

export function isTwoBlocksTall(type: number): boolean {
  return type === BRICK_TYPE_DOOR_OAK;
}

function createOakWoodTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#9a6b3e';
  ctx.fillRect(0, 0, size, size);

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

  for (let i = 0; i < 450; i++) {
    const x = Math.random() * size;
    const w = 2 + Math.random() * 6;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(72, 46, 22, 0.14)' : 'rgba(182, 134, 84, 0.12)';
    ctx.fillRect(x, 0, w, size);
  }

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

  ctx.fillStyle = '#e5e1d6';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = '#c8c3b6';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(245,243,236,0.2)' : 'rgba(185,180,168,0.18)';
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
  marbleTile: THREE.MeshStandardMaterial;
  ceilingWhite: THREE.MeshStandardMaterial;
  ceilingLight: THREE.MeshStandardMaterial;
  oakWood: THREE.MeshStandardMaterial;
  clearGlass: THREE.MeshPhysicalMaterial;
  brassMetal: THREE.MeshStandardMaterial;
  darkIron: THREE.MeshStandardMaterial;
  bushGreen: THREE.MeshStandardMaterial;
  soilDark: THREE.MeshStandardMaterial;
  flowerPink: THREE.MeshStandardMaterial;
  fabricCushion: THREE.MeshStandardMaterial;
  fabricBlanket: THREE.MeshStandardMaterial;
  pillowWhite: THREE.MeshStandardMaterial;
  carpetFabric: THREE.MeshStandardMaterial;
  fireEmbers: THREE.MeshStandardMaterial;
  waterMat: THREE.MeshPhysicalMaterial;
  slatePaver: THREE.MeshStandardMaterial;
  terracottaPot: THREE.MeshStandardMaterial;
  cypressFoliage: THREE.MeshStandardMaterial;
  bookRed: THREE.MeshStandardMaterial;
  bookBlue: THREE.MeshStandardMaterial;
  bookGreen: THREE.MeshStandardMaterial;
} | null = null;

let sharedSlabGeo: THREE.BufferGeometry | null = null;
let sharedWedgeGeo: THREE.BufferGeometry | null = null;
let sharedGableGeo: THREE.BufferGeometry | null = null;

export function getSharedArchMaterials() {
  if (!sharedMaterials) {
    const oakTex = createOakWoodTexture();
    const stoneTileTex = createStoneTileTexture();
    sharedMaterials = {
      whiteFrame: new THREE.MeshStandardMaterial({
        color: 0xdedad0,
        roughness: 0.75,
        metalness: 0.02,
      }),
      stoneSill: new THREE.MeshStandardMaterial({
        color: 0xd2cdc0,
        roughness: 0.85,
        metalness: 0.01,
      }),
      stoneTile: new THREE.MeshStandardMaterial({
        color: 0xdfd9cd,
        map: stoneTileTex,
        roughness: 0.82,
        metalness: 0.01,
      }),
      marbleTile: new THREE.MeshStandardMaterial({
        color: 0xe2e6eb,
        map: stoneTileTex,
        roughness: 0.48,
        metalness: 0.02,
      }),
      ceilingWhite: new THREE.MeshStandardMaterial({
        color: 0xdedbd2,
        roughness: 0.8,
        metalness: 0.01,
      }),
      ceilingLight: new THREE.MeshStandardMaterial({
        color: 0xfde68a,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.5,
        roughness: 0.45,
      }),
      oakWood: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: oakTex,
        roughness: 0.58,
        metalness: 0.02,
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
      darkIron: new THREE.MeshStandardMaterial({
        color: 0x27303f,
        roughness: 0.45,
        metalness: 0.7,
      }),
      bushGreen: new THREE.MeshStandardMaterial({
        color: 0x3f742b,
        roughness: 0.85,
      }),
      soilDark: new THREE.MeshStandardMaterial({
        color: 0x4a3525,
        roughness: 0.95,
      }),
      flowerPink: new THREE.MeshStandardMaterial({
        color: 0xf472b6,
        roughness: 0.6,
      }),
      fabricCushion: new THREE.MeshStandardMaterial({
        color: 0xe8e2d5,
        roughness: 0.88,
        metalness: 0.0,
      }),
      fabricBlanket: new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        roughness: 0.85,
        metalness: 0.0,
      }),
      pillowWhite: new THREE.MeshStandardMaterial({
        color: 0xfafafa,
        roughness: 0.82,
        metalness: 0.0,
      }),
      carpetFabric: new THREE.MeshStandardMaterial({
        color: 0xd8cca8,
        roughness: 0.92,
        metalness: 0.0,
      }),
      fireEmbers: new THREE.MeshStandardMaterial({
        color: 0xff4500,
        emissive: 0xff3b00,
        emissiveIntensity: 0.95,
        roughness: 0.4,
      }),
      waterMat: new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.58,
        roughness: 0.04,
        metalness: 0.05,
        transmission: 0.82,
        ior: 1.333,
        clearcoat: 1.0,
      }),
      slatePaver: new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.85,
        metalness: 0.02,
      }),
      terracottaPot: new THREE.MeshStandardMaterial({
        color: 0xb45309,
        roughness: 0.88,
        metalness: 0.02,
      }),
      cypressFoliage: new THREE.MeshStandardMaterial({
        color: 0x1e3a1f,
        roughness: 0.85,
      }),
      bookRed: new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.7 }),
      bookBlue: new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.7 }),
      bookGreen: new THREE.MeshStandardMaterial({ color: 0x065f46, roughness: 0.7 }),
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
 * Escalier 3D à 3 marches (Pierre Blanche ou Chêne Massif)
 * Permet de monter de y = -0.5 à y = +0.5 sur 1 bloc
 */
export function createStairsGroup(isOak: boolean): THREE.Group {
  const mats = getSharedArchMaterials();
  const mat = isOak ? mats.oakWood : mats.stoneTile;
  const group = new THREE.Group();

  // 3 marches progressives (bas-avant -> haut-arrière)
  const step1 = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.333, 1.0, 2, 0.015), mat);
  step1.position.set(0, -0.5 + 0.333 / 2, 0);

  const step2 = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.333, 0.666, 2, 0.015), mat);
  step2.position.set(0, -0.5 + 0.333 + 0.333 / 2, -0.5 + 0.666 / 2);

  const step3 = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.334, 0.333, 2, 0.015), mat);
  step3.position.set(0, 0.5 - 0.334 / 2, -0.5 + 0.333 / 2);

  group.add(step1, step2, step3);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Échelle verticale en Chêne à 4 barreaux (plaquée sur le côté arrière de la case pour grimper)
 */
export function createLadderGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const railGeo = new RoundedBoxGeometry(0.07, 1.0, 0.07, 2, 0.01);
  const leftRail = new THREE.Mesh(railGeo, mats.oakWood);
  leftRail.position.set(-0.34, 0, -0.43);

  const rightRail = new THREE.Mesh(railGeo, mats.oakWood);
  rightRail.position.set(0.34, 0, -0.43);

  group.add(leftRail, rightRail);

  const rungGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.68, 8);
  rungGeo.rotateZ(Math.PI / 2);

  for (let i = 0; i < 4; i++) {
    const y = -0.36 + i * 0.24;
    const rung = new THREE.Mesh(rungGeo, mats.oakWood);
    rung.position.set(0, y, -0.43);
    group.add(rung);
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Cube sous forme Triangle / Prisme à 45° (Rampe ou Pente de Toit)
 */
export function createTriangleWedgeMesh(isOak: boolean): THREE.Mesh {
  if (!sharedWedgeGeo) {
    // Profil triangulaire rectangle dans le plan YZ (bas de -0.5 à +0.5 en Z, haut à z = -0.5, y = +0.5)
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(-0.5, 0.5);
    shape.closePath();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 1.0,
      bevelEnabled: false,
      steps: 1,
    };
    const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Centrer l'extrusion sur X (-0.5 .. +0.5) et orienter la pente de +Z (bas) vers -Z (haut)
    geo.translate(0, 0, -0.5);
    geo.rotateY(Math.PI / 2);
    geo.computeVertexNormals();
    sharedWedgeGeo = geo;
  }

  const mats = getSharedArchMaterials();
  const mesh = new THREE.Mesh(sharedWedgeGeo, isOak ? mats.oakWood : mats.stoneTile);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Toit Faîtage / Double Pente Triangulaire Symétrique (Pignon)
 */
export function createGableRoofMesh(): THREE.Mesh {
  if (!sharedGableGeo) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, -0.5);
    shape.lineTo(0.5, -0.5);
    shape.lineTo(0.0, 0.25);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false, steps: 1 });
    geo.translate(0, 0, -0.5);
    geo.computeVertexNormals();
    sharedGableGeo = geo;
  }

  const mats = getSharedArchMaterials();
  const mesh = new THREE.Mesh(sharedGableGeo, mats.stoneTile);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Colonne / Pilier Architectural Rond en Pierre Blanche avec Base et Chapiteau
 */
export function createPillarGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const plinthBottom = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.14, 0.84, 2, 0.02), mats.stoneSill);
  plinthBottom.position.y = -0.5 + 0.07;

  const plinthTop = new THREE.Mesh(new RoundedBoxGeometry(0.84, 0.14, 0.84, 2, 0.02), mats.stoneSill);
  plinthTop.position.y = 0.5 - 0.07;

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.34, 0.76, 16), mats.whiteFrame);

  group.add(plinthBottom, plinthTop, shaft);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Garde-Corps / Balustrade ajourée en Pierre Blanche
 */
export function createBalustradeGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const bottomRail = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.12, 0.22, 2, 0.015), mats.stoneSill);
  bottomRail.position.set(0, -0.5 + 0.06, 0);

  const topRail = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.12, 0.24, 2, 0.015), mats.whiteFrame);
  topRail.position.set(0, 0.32, 0);

  group.add(bottomRail, topRail);

  const balusterGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.68, 10);
  for (const bx of [-0.34, 0, 0.34]) {
    const b = new THREE.Mesh(balusterGeo, mats.whiteFrame);
    b.position.set(bx, -0.08, 0);
    group.add(b);
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Clôture de Campagne en Bois de Chêne
 */
export function createOakFenceGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const postGeo = new RoundedBoxGeometry(0.14, 0.92, 0.14, 2, 0.015);
  const leftPost = new THREE.Mesh(postGeo, mats.oakWood);
  leftPost.position.set(-0.38, -0.04, 0);

  const rightPost = new THREE.Mesh(postGeo, mats.oakWood);
  rightPost.position.set(0.38, -0.04, 0);

  const railGeo = new RoundedBoxGeometry(1.0, 0.1, 0.06, 2, 0.01);
  const upperRail = new THREE.Mesh(railGeo, mats.oakWood);
  upperRail.position.set(0, 0.22, 0);

  const lowerRail = new THREE.Mesh(railGeo, mats.oakWood);
  lowerRail.position.set(0, -0.14, 0);

  group.add(leftPost, rightPost, upperRail, lowerRail);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Bloc d'Arche / Arcade en Pierre Blanche
 */
export function createArchBlockGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  // Linteau supérieur + deux écoinçons latéraux formant une voûte
  const topBeam = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.28, 1.0, 2, 0.02), mats.stoneTile);
  topBeam.position.set(0, 0.5 - 0.14, 0);

  const leftSide = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.72, 1.0, 2, 0.02), mats.stoneTile);
  leftSide.position.set(-0.5 + 0.12, -0.14, 0);

  const rightSide = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.72, 1.0, 2, 0.02), mats.stoneTile);
  rightSide.position.set(0.5 - 0.12, -0.14, 0);

  const leftCorner = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.24, 0.98, 2, 0.02), mats.stoneSill);
  leftCorner.position.set(-0.22, 0.16, 0);

  const rightCorner = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.24, 0.98, 2, 0.02), mats.stoneSill);
  rightCorner.position.set(0.22, 0.16, 0);

  group.add(topBeam, leftSide, rightSide, leftCorner, rightCorner);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Jardinière en Pierre Blanche avec Arbuste et Fleurs
 */
export function createPlanterBoxGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const box = new THREE.Mesh(new RoundedBoxGeometry(0.92, 0.46, 0.92, 2, 0.02), mats.stoneTile);
  box.position.y = -0.5 + 0.23;

  const soil = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.8), mats.soilDark);
  soil.position.y = -0.06;

  const bushMain = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 1), mats.bushGreen);
  bushMain.position.set(0, 0.16, 0);
  bushMain.scale.set(1.15, 0.85, 1.15);

  group.add(box, soil, bushMain);

  const flowerGeo = new THREE.DodecahedronGeometry(0.06, 0);
  const flowerOffsets = [
    [-0.16, 0.36, 0.12],
    [0.18, 0.34, -0.14],
    [0.05, 0.41, 0.15],
    [-0.12, 0.33, -0.18],
  ];
  for (const [fx, fy, fz] of flowerOffsets) {
    const f = new THREE.Mesh(flowerGeo, mats.flowerPink);
    f.position.set(fx, fy, fz);
    group.add(f);
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Lampadaire / Lanterne sur Pied
 */
export function createLanternPostGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const base = new THREE.Mesh(CylinderOrBoxBase(), mats.darkIron);
  base.position.y = -0.5 + 0.06;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.62, 10), mats.darkIron);
  pole.position.y = -0.08;

  const lampCore = new THREE.Mesh(
    new RoundedBoxGeometry(0.26, 0.28, 0.26, 2, 0.02),
    mats.ceilingLight
  );
  lampCore.position.y = 0.32;

  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.12, 4), mats.darkIron);
  cap.rotation.y = Math.PI / 4;
  cap.position.y = 0.5;

  group.add(base, pole, lampCore, cap);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

function CylinderOrBoxBase(): THREE.BufferGeometry {
  return new RoundedBoxGeometry(0.32, 0.12, 0.32, 2, 0.02);
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
 * Construit une Baie Vitrée Sans Bord (Vitre continue 1x1x0.05m bord à bord)
 * Permet de créer de grands murs de verre panoramiques continus sans montant intermédiaire.
 */
export function createFramelessWindowGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  // Vitre pleine largeur/hauteur (1.0m x 1.0m) sans aucun cadre latéral
  const glassPane = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.0, 0.048),
    mats.clearGlass
  );
  glassPane.castShadow = false;
  glassPane.receiveShadow = true;

  // Très fin reflet de tranche en verre trempé poli (imperceptible de face, donne du volume de biais)
  const topEdge = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.008, 0.05),
    mats.clearGlass
  );
  topEdge.position.set(0, 0.5 - 0.004, 0);

  const bottomEdge = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.008, 0.05),
    mats.clearGlass
  );
  bottomEdge.position.set(0, -0.5 + 0.004, 0);

  group.add(glassPane, topEdge, bottomEdge);
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
  rightJamb.position.set(0.5 - jambW / 2, 0.5, 0);

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

/**
 * Table Basse / Table en Chêne & Marbre (1x1x1m)
 */
export function createTableGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  // Plateau supérieur en marbre doux ou bois
  const top = new THREE.Mesh(
    new RoundedBoxGeometry(0.96, 0.08, 0.96, 2, 0.015),
    mats.marbleTile
  );
  top.position.y = 0.22;

  // 4 pieds en chêne
  const legGeo = new RoundedBoxGeometry(0.08, 0.68, 0.08, 2, 0.01);
  const legOffset = 0.4;
  const positions = [
    [-legOffset, -0.16, -legOffset],
    [legOffset, -0.16, -legOffset],
    [-legOffset, -0.16, legOffset],
    [legOffset, -0.16, legOffset],
  ];

  positions.forEach(([lx, ly, lz]) => {
    const leg = new THREE.Mesh(legGeo, mats.oakWood);
    leg.position.set(lx, ly, lz);
    group.add(leg);
  });

  group.add(top);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Fauteuil / Canapé Moderne avec Coussin Moelleux (1x1x1m)
 * Possibilité de s'asseoir avec la touche E !
 */
export function createChairGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  // Assise coussinée confortable
  const seat = new THREE.Mesh(
    new RoundedBoxGeometry(0.78, 0.22, 0.74, 3, 0.03),
    mats.fabricCushion
  );
  seat.position.set(0, -0.12, 0.02);

  // Dossier à l'arrière (+Z)
  const backrest = new THREE.Mesh(
    new RoundedBoxGeometry(0.78, 0.58, 0.16, 3, 0.03),
    mats.fabricCushion
  );
  backrest.position.set(0, 0.2, 0.32);

  // 2 Accoudoirs latéraux
  const armGeo = new RoundedBoxGeometry(0.12, 0.36, 0.72, 2, 0.02);
  const armL = new THREE.Mesh(armGeo, mats.fabricCushion);
  armL.position.set(-0.42, 0.04, 0.04);
  const armR = new THREE.Mesh(armGeo, mats.fabricCushion);
  armR.position.set(0.42, 0.04, 0.04);

  // 4 Pieds fins en bois de chêne
  const legGeo = new THREE.CylinderGeometry(0.028, 0.022, 0.26, 8);
  const legPositions = [
    [-0.34, -0.36, -0.28],
    [0.34, -0.36, -0.28],
    [-0.34, -0.36, 0.28],
    [0.34, -0.36, 0.28],
  ];
  legPositions.forEach(([lx, ly, lz]) => {
    const leg = new THREE.Mesh(legGeo, mats.oakWood);
    leg.position.set(lx, ly, lz);
    group.add(leg);
  });

  group.add(seat, backrest, armL, armR);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Lit Douillet Moderne avec Cadre en Chêne, Matelas Blanc, Couette et Oreiller (1x1x1m)
 */
export function createBedGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  // Cadre et tête de lit en chêne
  const frame = new THREE.Mesh(
    new RoundedBoxGeometry(0.96, 0.24, 0.96, 2, 0.015),
    mats.oakWood
  );
  frame.position.set(0, -0.34, 0);

  const headboard = new THREE.Mesh(
    new RoundedBoxGeometry(0.96, 0.52, 0.12, 2, 0.02),
    mats.oakWood
  );
  headboard.position.set(0, 0.04, 0.44);

  // Matelas confortable
  const mattress = new THREE.Mesh(
    new RoundedBoxGeometry(0.88, 0.2, 0.86, 2, 0.02),
    mats.pillowWhite
  );
  mattress.position.set(0, -0.16, 0.02);

  // Oreiller douillet
  const pillow = new THREE.Mesh(
    new RoundedBoxGeometry(0.72, 0.1, 0.26, 3, 0.03),
    mats.pillowWhite
  );
  pillow.position.set(0, -0.02, 0.26);

  // Couette élégante repliée sur les deux tiers avant
  const blanket = new THREE.Mesh(
    new RoundedBoxGeometry(0.9, 0.14, 0.56, 3, 0.025),
    mats.fabricBlanket
  );
  blanket.position.set(0, -0.06, -0.14);

  group.add(frame, headboard, mattress, pillow, blanket);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Bibliothèque Garnie de Livres Colorés (1x1x1m)
 */
export function createBookshelfGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  // Structure extérieure en chêne
  const outer = new THREE.Mesh(
    new RoundedBoxGeometry(0.98, 0.98, 0.38, 2, 0.015),
    mats.oakWood
  );
  outer.position.set(0, 0, 0);

  // Étagère centrale
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(0.86, 0.05, 0.36),
    mats.oakWood
  );
  shelf.position.set(0, 0, 0);

  // Livres rangés sur 2 niveaux
  const bookMats = [mats.bookRed, mats.bookBlue, mats.bookGreen, mats.brassMetal];
  const createBookRow = (rowY: number) => {
    let startX = -0.38;
    for (let b = 0; b < 9; b++) {
      const bW = 0.06 + Math.random() * 0.035;
      const bH = 0.32 + (Math.random() - 0.5) * 0.08;
      const bMat = bookMats[b % bookMats.length];
      const book = new THREE.Mesh(new THREE.BoxGeometry(bW, bH, 0.26), bMat);
      book.position.set(startX + bW / 2, rowY + bH / 2, -0.02);
      group.add(book);
      startX += bW + 0.015;
    }
  };

  createBookRow(-0.46); // Étagère inférieure
  createBookRow(0.04);  // Étagère supérieure

  group.add(outer, shelf);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Cheminée de Campagne avec Manteau en Pierre et Foyer Lumineux Ambré (1x1x1m)
 */
export function createFireplaceGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  // Structure en brique calcaire
  const mantle = new THREE.Mesh(
    new RoundedBoxGeometry(0.98, 0.98, 0.5, 3, 0.02),
    mats.whiteFrame
  );
  mantle.position.set(0, 0, 0.05);

  // Foyer intérieur sombre
  const hearthHole = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.56, 0.42),
    mats.darkIron
  );
  hearthHole.position.set(0, -0.16, -0.06);

  // Bûches et braises ardentes
  const emberGeo = new RoundedBoxGeometry(0.48, 0.16, 0.28, 2, 0.03);
  const embers = new THREE.Mesh(emberGeo, mats.fireEmbers);
  embers.position.set(0, -0.34, -0.04);

  // Grille en fer forgé
  const grate = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.12, 0.03),
    mats.darkIron
  );
  grate.position.set(0, -0.34, 0.16);

  group.add(mantle, hearthHole, embers, grate);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Tapis de Sol Décoratif Ultra-Fin (1x1m, épaisseur 0.035m)
 */
export function createCarpetMesh(): THREE.Mesh {
  const mats = getSharedArchMaterials();
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(1.0, 0.035, 1.0, 2, 0.01),
    mats.carpetFabric
  );
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Bloc d'Eau Translucide Ondoyant (1x1x1m)
 * Non-bloquant pour le joueur : permet de nager / flotter !
 */
export function createWaterMesh(): THREE.Mesh {
  const mats = getSharedArchMaterials();
  const geo = new THREE.BoxGeometry(1.0, 0.92, 1.0);
  const mesh = new THREE.Mesh(geo, mats.waterMat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Pas Japonais / Pavés de Jardin en Ardoise Naturelle (1x1m)
 */
export function createSteppingStoneMesh(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const stone1 = new THREE.Mesh(
    new RoundedBoxGeometry(0.46, 0.06, 0.42, 2, 0.02),
    mats.slatePaver
  );
  stone1.position.set(-0.2, -0.46, -0.2);

  const stone2 = new THREE.Mesh(
    new RoundedBoxGeometry(0.48, 0.06, 0.44, 2, 0.02),
    mats.slatePaver
  );
  stone2.position.set(0.22, -0.46, 0.22);

  group.add(stone1, stone2);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/**
 * Haie Végétale Dense Taillée (1x1x1m)
 */
export function createHedgeMesh(): THREE.Mesh {
  const mats = getSharedArchMaterials();
  const geo = new RoundedBoxGeometry(1.0, 1.0, 1.0, 3, 0.05);
  const mesh = new THREE.Mesh(geo, mats.bushGreen);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Cyprès / Arbuste Décoratif en Pot Terracotta (1x1x1m)
 */
export function createCypressGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  // Pot en terre cuite
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.18, 0.32, 12),
    mats.terracottaPot
  );
  pot.position.y = -0.34;

  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.04, 12),
    mats.soilDark
  );
  soil.position.y = -0.17;

  // Feuillage conique en cyprès élancé
  const foliage = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.78, 10),
    mats.cypressFoliage
  );
  foliage.position.y = 0.24;

  group.add(pot, soil, foliage);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}
