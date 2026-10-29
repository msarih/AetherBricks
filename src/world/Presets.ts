export interface BrickEntry {
  x: number;
  y: number;
  z: number;
  type: number;
  rot?: number; // 0, 1, 2, 3 (multiples de 90°)
  open?: boolean; // Pour les portes ouvrables
}

/**
 * Génère un petit muret de démonstration en briques blanches avec une porte en chêne et deux fenêtres
 * sur le terrain de campagne plat au lancement.
 */
export function getStarterScene(): BrickEntry[] {
  const bricks: BrickEntry[] = [];
  const z = -6;

  // Muret de façade en briques blanches (-3..3) avec porte centrale et 2 fenêtres croisées
  for (let x = -3; x <= 3; x++) {
    for (let y = 0; y <= 2; y++) {
      // Emplacement de la porte centrale (x=0, y=0..1)
      if (x === 0 && (y === 0 || y === 1)) continue;
      // Emplacements des 2 fenêtres latérales (x=-2 et x=2, y=1)
      if ((x === -2 || x === 2) && y === 1) continue;

      bricks.push({ x, y, z, type: 1 });
    }
  }

  // Ajout des 2 fenêtres croisées (type 7)
  bricks.push({ x: -2, y: 1, z, type: 7, rot: 0 });
  bricks.push({ x: 2, y: 1, z, type: 7, rot: 0 });

  // Ajout de la porte de campagne ouvrable au centre (type 9)
  bricks.push({ x: 0, y: 0, z, type: 9, rot: 0, open: false });

  return bricks;
}

/**
 * Maisonnette / Pavillon de Campagne en Briques Blanches avec Porte en Chêne et Fenêtres
 */
export function getWhitePavilionPreset(): BrickEntry[] {
  const bricks: BrickEntry[] = [];

  // Dalle de base en pierre blanche (-4..4 en X, -10..-2 en Z)
  for (let x = -4; x <= 4; x++) {
    for (let z = -10; z <= -2; z++) {
      bricks.push({ x, y: 0, z, type: 2 });
    }
  }

  // Murs périmétriques en briques blanches (y = 1..4)
  for (let y = 1; y <= 4; y++) {
    for (let x = -4; x <= 4; x++) {
      for (let z = -10; z <= -2; z++) {
        const isFront = z === -2;
        const isBack = z === -10;
        const isLeft = x === -4;
        const isRight = x === 4;
        if (!isFront && !isBack && !isLeft && !isRight) continue;

        // Ouverture porte d'entrée (façade avant z = -2, x = 0, y = 1..2)
        if (isFront && x === 0 && (y === 1 || y === 2)) continue;

        // Fenêtres en façade avant (z = -2, x = -2 et x = 2, y = 2)
        if (isFront && (x === -2 || x === 2) && y === 2) {
          bricks.push({ x, y, z, type: 7, rot: 0 });
          continue;
        }

        // Grandes baies vitrées sur les murs latéraux (x = -4 et x = 4, z = -7..-5, y = 2..3)
        if ((isLeft || isRight) && z >= -7 && z <= -5 && (y === 2 || y === 3)) {
          bricks.push({ x, y, z, type: 8, rot: 1 });
          continue;
        }

        // Fenêtres mur du fond (z = -10, x = -2, 0, 2, y = 2)
        if (isBack && (x === -2 || x === 0 || x === 2) && y === 2) {
          bricks.push({ x, y, z, type: 7, rot: 0 });
          continue;
        }

        bricks.push({ x, y, z, type: 1 });
      }
    }
  }

  // Porte d'entrée en chêne sur la façade avant (z = -2, x = 0, y = 1)
  bricks.push({ x: 0, y: 1, z: -2, type: 9, rot: 0, open: false });

  // Toit architectural en pierre blanche avec puits de lumière central
  for (let x = -4; x <= 4; x++) {
    for (let z = -10; z <= -2; z++) {
      if (x === 0 && z === -6) {
        bricks.push({ x, y: 5, z, type: 5 }); // Lanterne blanche centrale
      } else if (Math.abs(x) <= 1 && z >= -7 && z <= -5) {
        bricks.push({ x, y: 5, z, type: 6 }); // Verrière de toit
      } else {
        bricks.push({ x, y: 5, z, type: 2 });
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
      bricks.push({ x: -4, y, z, type: 1 });
      bricks.push({ x: -3, y, z, type: 1 });
      bricks.push({ x: 3, y, z, type: 1 });
      bricks.push({ x: 4, y, z, type: 1 });
    }
  }

  for (let x = -4; x <= 4; x++) {
    for (let y = 6; y <= 8; y++) {
      for (let z = zBase - 1; z <= zBase + 1; z++) {
        bricks.push({ x, y, z, type: 1 });
      }
    }
  }

  return bricks;
}
