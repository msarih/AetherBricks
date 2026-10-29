export interface BrickEntry {
  x: number;
  y: number;
  z: number;
  type: number;
}

/**
 * Génère un petit socle d'accueil minimaliste en briques blanches sur le terrain plat
 * afin de montrer immédiatement le rendu des ombres au lancement.
 */
export function getStarterScene(): BrickEntry[] {
  const bricks: BrickEntry[] = [];

  // Petit muret d'exemple en briques blanches (type 1) à quelques mètres devant le joueur
  for (let x = -2; x <= 2; x++) {
    bricks.push({ x, y: 0, z: -6, type: 1 });
    if (Math.abs(x) <= 1) {
      bricks.push({ x, y: 1, z: -6, type: 1 });
    }
  }
  bricks.push({ x: 0, y: 2, z: -6, type: 1 });

  return bricks;
}

/**
 * Pavillon Minimaliste Blanc (Colonnes, toit plat ajouré et éclairage intégré)
 */
export function getWhitePavilionPreset(): BrickEntry[] {
  const bricks: BrickEntry[] = [];

  // Dalle de base surélevée (-4..4 en X, -10..-2 en Z)
  for (let x = -4; x <= 4; x++) {
    for (let z = -10; z <= -2; z++) {
      bricks.push({ x, y: 0, z, type: 2 });
    }
  }

  // 4 Piliers en briques blanches aux coins
  const corners = [
    [-4, -10],
    [4, -10],
    [-4, -2],
    [4, -2],
  ];
  for (const [cx, cz] of corners) {
    for (let y = 1; y <= 4; y++) {
      bricks.push({ x: cx, y, z: cz, type: 1 });
    }
  }

  // Mur de fond en briques blanches avec ouverture centrale
  for (let x = -3; x <= 3; x++) {
    for (let y = 1; y <= 4; y++) {
      if (Math.abs(x) <= 1 && y <= 3) continue; // Porte
      bricks.push({ x, y, z: -10, type: 1 });
    }
  }

  // Toit architectural avec claire-voie
  for (let x = -4; x <= 4; x++) {
    for (let z = -10; z <= -2; z++) {
      const isBorder = Math.abs(x) === 4 || z === -10 || z === -2;
      if (isBorder) {
        bricks.push({ x, y: 5, z, type: 2 });
      } else if (x === 0 && z === -6) {
        bricks.push({ x, y: 5, z, type: 5 }); // Brique lumineuse centrale
      } else if (z % 2 === 0) {
        bricks.push({ x, y: 5, z, type: 1 });
      }
    }
  }

  return bricks;
}

/**
 * Arche Brutaliste Blanche
 */
export function getBrutalistArchPreset(): BrickEntry[] {
  const bricks: BrickEntry[] = [];
  const zBase = -8;

  for (let y = 0; y <= 7; y++) {
    for (let z = zBase - 1; z <= zBase + 1; z++) {
      // Piliers gauche et droit (épaisseur 2)
      bricks.push({ x: -4, y, z, type: 1 });
      bricks.push({ x: -3, y, z, type: 1 });
      bricks.push({ x: 3, y, z, type: 1 });
      bricks.push({ x: 4, y, z, type: 1 });
    }
  }

  // Linteau supérieur massif
  for (let x = -4; x <= 4; x++) {
    for (let y = 6; y <= 8; y++) {
      for (let z = zBase - 1; z <= zBase + 1; z++) {
        bricks.push({ x, y, z, type: 1 });
      }
    }
  }

  return bricks;
}
