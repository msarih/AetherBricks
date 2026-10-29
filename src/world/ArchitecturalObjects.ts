import * as THREE from 'three';

export const BRICK_TYPE_WINDOW_CROSS = 7;
export const BRICK_TYPE_WINDOW_MODERN = 8;
export const BRICK_TYPE_DOOR_OAK = 9;

export function isArchitecturalObject(type: number): boolean {
  return (
    type === BRICK_TYPE_WINDOW_CROSS ||
    type === BRICK_TYPE_WINDOW_MODERN ||
    type === BRICK_TYPE_DOOR_OAK
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

  // Wood fibers and annual rings
  for (let i = 0; i < 450; i++) {
    const x = Math.random() * size;
    const w = 2 + Math.random() * 6;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(72, 46, 22, 0.16)' : 'rgba(182, 134, 84, 0.14)';
    ctx.fillRect(x, 0, w, size);
  }

  // Fine grain streaks
  ctx.strokeStyle = 'rgba(58, 35, 16, 0.22)';
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

let sharedMaterials: {
  whiteFrame: THREE.MeshStandardMaterial;
  stoneSill: THREE.MeshStandardMaterial;
  oakWood: THREE.MeshStandardMaterial;
  clearGlass: THREE.MeshPhysicalMaterial;
  brassMetal: THREE.MeshStandardMaterial;
} | null = null;

function getSharedArchMaterials() {
  if (!sharedMaterials) {
    const oakTex = createOakWoodTexture();
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
      oakWood: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: oakTex,
        roughness: 0.55,
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
 * Construit une Fenêtre Croisée de Campagne (1x1x1m) :
 * - Appui de fenêtre en pierre blanche (rebord extérieur)
 * - Cadre périphérique en chêne / blanc
 * - Croisillons traditionnels (petits bois) + vitrage cristallin
 */
export function createCrossWindowGroup(): THREE.Group {
  const mats = getSharedArchMaterials();
  const group = new THREE.Group();

  const frameDepth = 0.28;
  const frameThick = 0.085;

  // Cadre extérieur (Haut, Bas, Gauche, Droite)
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

  // Appui de fenêtre (rebord en pierre blanche dépassant légèrement)
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.06, 0.42), mats.stoneSill);
  sill.position.set(0, -0.47, 0.03);

  // Châssis intérieur en chêne + croisillons
  const innerSize = 1.0 - frameThick * 2;
  const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.04, innerSize, 0.07), mats.oakWood);
  const mullionH = new THREE.Mesh(new THREE.BoxGeometry(innerSize, 0.04, 0.07), mats.oakWood);

  // Vitre centrale
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
 * Construit une Baie Vitrée Blanche Architecturale (1x1x1m) :
 * - Cadre blanc épuré + grand vitrage panoramique clair
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
 * Construit une Porte de Campagne Ouvrable de 2m de haut (1x2x1m) :
 * - Chambranle (cadre dormant) en pierre/bois blanc sur 2 blocs de hauteur (y = -0.5 .. +1.5)
 * - Vantail en chêne massif monté sur charnière (`doorPivot`) avec panneaux moulurés,
 *   hublot vitré supérieur à croisillons, et poignée en laiton des deux côtés.
 */
export function createOakDoorGroup(): { root: THREE.Group; doorPivot: THREE.Group } {
  const mats = getSharedArchMaterials();
  const root = new THREE.Group();

  const frameDepth = 0.3;
  const jambW = 0.085;
  const totalH = 2.0; // 2 blocs de haut

  // Montant gauche (y centre = +0.5 car le bloc du bas va de -0.5 à +0.5 et celui du haut de +0.5 à +1.5)
  const leftJamb = new THREE.Mesh(new THREE.BoxGeometry(jambW, totalH, frameDepth), mats.whiteFrame);
  leftJamb.position.set(-0.5 + jambW / 2, 0.5, 0);

  // Montant droit
  const rightJamb = new THREE.Mesh(new THREE.BoxGeometry(jambW, totalH, frameDepth), mats.whiteFrame);
  rightJamb.position.set(0.5 - jambW / 2, 0.5, 0);

  // Linteau supérieur
  const topLintel = new THREE.Mesh(new THREE.BoxGeometry(1.0, jambW, frameDepth + 0.03), mats.whiteFrame);
  topLintel.position.set(0, 1.5 - jambW / 2, 0);

  // Seuil en pierre au sol
  const threshold = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.04, 0.36), mats.stoneSill);
  threshold.position.set(0, -0.48, 0);

  root.add(leftJamb, rightJamb, topLintel, threshold);

  // Pivot de charnière placé sur le bord intérieur gauche du cadre
  const doorPivot = new THREE.Group();
  const leafW = 1.0 - jambW * 2;
  const leafH = totalH - jambW - 0.04;
  const leafThick = 0.075;

  doorPivot.position.set(-leafW / 2, -0.46, 0);

  // Vantail principal en chêne (décalé de +leafW/2 par rapport à la charnière)
  const leafGroup = new THREE.Group();
  leafGroup.position.set(leafW / 2, leafH / 2, 0);

  // Montants du vantail (encadrement de la porte autour de la vitre supérieure et du panneau plein inférieur)
  const lowerPanel = new THREE.Mesh(
    new THREE.BoxGeometry(leafW, leafH * 0.58, leafThick),
    mats.oakWood
  );
  lowerPanel.position.set(0, -leafH * 0.21, 0);

  // Moulure décorative en relief sur la partie basse
  const raisedPanel = new THREE.Mesh(
    new THREE.BoxGeometry(leafW * 0.72, leafH * 0.42, leafThick + 0.025),
    mats.oakWood
  );
  raisedPanel.position.set(0, -leafH * 0.21, 0);

  // Montants latéraux et traverse haute de la partie vitrée supérieure
  const stileW = 0.11;
  const upperH = leafH * 0.42;
  const upperY = leafH * 0.29;

  const stileLeft = new THREE.Mesh(new THREE.BoxGeometry(stileW, upperH, leafThick), mats.oakWood);
  stileLeft.position.set(-leafW / 2 + stileW / 2, upperY, 0);

  const stileRight = new THREE.Mesh(new THREE.BoxGeometry(stileW, upperH, leafThick), mats.oakWood);
  stileRight.position.set(leafW / 2 - stileW / 2, upperY, 0);

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(leafW, stileW, leafThick), mats.oakWood);
  topRail.position.set(0, leafH / 2 - stileW / 2, 0);

  // Vitre supérieure + petits bois croisés de la porte
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

  // Poignée en laiton (double béquille avant/arrière)
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

