export interface BrickEntry {
  x: number;
  y: number;
  z: number;
  type: number;
  rot?: number; // 0, 1, 2, 3 (multiples de 90°)
  open?: boolean; // Pour les portes ouvrables
}

/**
 * Génère une terrasse en carrés plats (Dalles de sol) avec un muret en briques blanches,
 * une porte en chêne et deux fenêtres croisées.
 */
export function getStarterScene(): BrickEntry[] {
  const bricks: BrickEntry[] = [];
  const zWall = -6;

  // Terrasse avant en carrés plats de Pierre Blanche (type 10) et Parquet Chêne (type 11)
  for (let x = -3; x <= 3; x++) {
    for (let z = -5; z <= -3; z++) {
      bricks.push({ x, y: 0, z, type: z === -5 ? 11 : 10 });
    }
  }

  // Muret de façade en briques blanches (-3..3) avec porte centrale et 2 fenêtres croisées
  for (let x = -3; x <= 3; x++) {
    for (let y = 0; y <= 2; y++) {
      if (x === 0 && (y === 0 || y === 1)) continue;
      if ((x === -2 || x === 2) && y === 1) continue;
      bricks.push({ x, y, z: zWall, type: 1 });
    }
  }

  // Auvent de plafond en carrés plats (Plafond Blanc Lisse mat type 13, sans lumière blanche éblouissante)
  for (let x = -3; x <= 3; x++) {
    bricks.push({ x, y: 2, z: -5, type: 13 });
  }

  // 2 fenêtres croisées (type 7) + 1 porte de campagne ouvrable (type 9)
  bricks.push({ x: -2, y: 1, z: zWall, type: 7, rot: 0 });
  bricks.push({ x: 2, y: 1, z: zWall, type: 7, rot: 0 });
  bricks.push({ x: 0, y: 0, z: zWall, type: 9, rot: 0, open: false });

  // Éléments de démonstration sur la terrasse : escalier (16), échelle (18), jardinières (26), lampadaires (27) et clôtures (24)
  bricks.push({ x: 0, y: 0, z: -2, type: 16, rot: 0 }); // Escalier d'accès central
  bricks.push({ x: -3, y: 0, z: -5, type: 18, rot: 0 }); // Échelle en chêne
  bricks.push({ x: -3, y: 1, z: -5, type: 18, rot: 0 });
  bricks.push({ x: -3, y: 2, z: -5, type: 18, rot: 0 });
  bricks.push({ x: -1, y: 0, z: -3, type: 26, rot: 0 }); // Jardinière fleurie gauche
  bricks.push({ x: 1, y: 0, z: -3, type: 26, rot: 0 }); // Jardinière fleurie droite
  bricks.push({ x: -3, y: 0, z: -3, type: 27, rot: 0 }); // Lampadaire gauche
  bricks.push({ x: 3, y: 0, z: -3, type: 27, rot: 0 }); // Lampadaire droit
  bricks.push({ x: -2, y: 0, z: -3, type: 24, rot: 0 }); // Clôture chêne
  bricks.push({ x: 2, y: 0, z: -3, type: 24, rot: 0 });

  return bricks;
}

/**
 * Maisonnette / Pavillon de Campagne en Briques Blanches avec Sol en Parquet/Pierre,
 * Plafond en Carrés Plats + LED, Porte en Chêne et Fenêtres
 */
export function getWhitePavilionPreset(): BrickEntry[] {
  const bricks: BrickEntry[] = [];

  // Sol intérieur en carrés plats (Parquet Chêne type 11 au centre, Pierre Blanche type 10 en bordure)
  for (let x = -3; x <= 3; x++) {
    for (let z = -9; z <= -3; z++) {
      const isEdge = Math.abs(x) === 3 || z === -9 || z === -3;
      bricks.push({ x, y: 0, z, type: isEdge ? 10 : 11 });
    }
  }

  // Terrasse d'entrée extérieure en carrés plats de Marbre Blanc (type 12)
  for (let x = -2; x <= 2; x++) {
    bricks.push({ x, y: 0, z: -1, type: 12 });
    bricks.push({ x, y: 0, z: 0, type: 10 });
  }

  // Murs périmétriques en briques blanches (y = 0..3)
  for (let y = 0; y <= 3; y++) {
    for (let x = -4; x <= 4; x++) {
      for (let z = -10; z <= -2; z++) {
        const isFront = z === -2;
        const isBack = z === -10;
        const isLeft = x === -4;
        const isRight = x === 4;
        if (!isFront && !isBack && !isLeft && !isRight) continue;

        // Ouverture porte d'entrée (façade avant z = -2, x = 0, y = 0..1)
        if (isFront && x === 0 && (y === 0 || y === 1)) continue;

        // Fenêtres en façade avant (z = -2, x = -2 et x = 2, y = 1)
        if (isFront && (x === -2 || x === 2) && y === 1) {
          bricks.push({ x, y, z, type: 7, rot: 0 });
          continue;
        }

        // Grandes baies vitrées sans bord sur les murs latéraux (x = -4 et x = 4, z = -7..-5, y = 1..2)
        if ((isLeft || isRight) && z >= -7 && z <= -5 && (y === 1 || y === 2)) {
          bricks.push({ x, y, z, type: 28, rot: 1 });
          continue;
        }

        // Fenêtres mur du fond (z = -10, x = -2, 0, 2, y = 1)
        if (isBack && (x === -2 || x === 0 || x === 2) && y === 1) {
          bricks.push({ x, y, z, type: 7, rot: 0 });
          continue;
        }

        bricks.push({ x, y, z, type: 1 });
      }
    }
  }

  // Porte d'entrée en chêne sur la façade avant (z = -2, x = 0, y = 0)
  bricks.push({ x: 0, y: 0, z: -2, type: 9, rot: 0, open: false });

  // Plafond architectural en carrés plats (y = 3 : Plafond Blanc Lisse type 13, Lambris Chêne type 15 & Caissons LED type 14)
  for (let x = -4; x <= 4; x++) {
    for (let z = -10; z <= -2; z++) {
      if (Math.abs(x) <= 1 && Math.abs(z + 6) <= 1) {
        bricks.push({ x, y: 3, z, type: 14 }); // Caisson lumineux central
      } else if (Math.abs(x) <= 2 && z >= -8 && z <= -4) {
        bricks.push({ x, y: 3, z, type: 15 }); // Plafond lambris chêne
      } else {
        bricks.push({ x, y: 3, z, type: 13 }); // Plafond blanc lisse
      }
    }
  }

  // Toiture en prismes triangulaires (type 19) et faîtage double pente (type 21) au-dessus du pavillon (y = 4)
  for (let z = -10; z <= -2; z++) {
    bricks.push({ x: -4, y: 4, z, type: 19, rot: 1 }); // Pente gauche
    bricks.push({ x: 4, y: 4, z, type: 19, rot: 3 }); // Pente droite
    bricks.push({ x: 0, y: 4, z, type: 21, rot: 0 }); // Faîtage central double pente
  }

  // Échelle extérieure en chêne sur le flanc droit (x = 5, z = -3, y = 0..3) pour grimper sur le toit
  for (let y = 0; y <= 3; y++) {
    bricks.push({ x: 5, y, z: -3, type: 18, rot: 1 });
  }

  // Escalier d'accueil (16), colonnes (22), jardinières (26) et lampadaires (27) devant la maisonnette
  bricks.push({ x: 0, y: 0, z: 1, type: 16, rot: 0 });
  bricks.push({ x: -2, y: 0, z: -1, type: 22, rot: 0 });
  bricks.push({ x: 2, y: 0, z: -1, type: 22, rot: 0 });
  bricks.push({ x: -1, y: 0, z: -1, type: 26, rot: 0 });
  bricks.push({ x: 1, y: 0, z: -1, type: 26, rot: 0 });
  bricks.push({ x: -3, y: 0, z: 0, type: 27, rot: 0 });
  bricks.push({ x: 3, y: 0, z: 0, type: 27, rot: 0 });

  // --- Mobilier Intérieur ---
  // Cheminée chaleureuse au fond
  bricks.push({ x: 0, y: 0, z: -9, type: 33, rot: 0 });
  // Tapis de salon moelleux
  bricks.push({ x: -1, y: 0, z: -6, type: 34, rot: 0 });
  // Table basse chêne & marbre
  bricks.push({ x: 0, y: 0, z: -6, type: 29, rot: 0 });
  // Fauteuils confortables (interactifs avec la touche E pour s'asseoir !)
  bricks.push({ x: 1, y: 0, z: -6, type: 30, rot: 3 });
  bricks.push({ x: -2, y: 0, z: -6, type: 30, rot: 1 });
  // Lit douillet moderne avec couette
  bricks.push({ x: 3, y: 0, z: -8, type: 31, rot: 0 });
  // Bibliothèque garnie de livres
  bricks.push({ x: 3, y: 0, z: -4, type: 32, rot: 3 });

  // --- Aménagement Extérieur & Nature ---
  // Cyprès méditerranéens en pot
  bricks.push({ x: -4, y: 0, z: 1, type: 38, rot: 0 });
  bricks.push({ x: 4, y: 0, z: 1, type: 38, rot: 0 });
  // Pas japonais dans l'herbe
  bricks.push({ x: 0, y: 0, z: 2, type: 36, rot: 0 });
  bricks.push({ x: 0, y: 0, z: 3, type: 36, rot: 0 });
  bricks.push({ x: 0, y: 0, z: 4, type: 36, rot: 0 });
  // Haies taillées
  bricks.push({ x: -5, y: 0, z: 0, type: 37, rot: 0 });
  bricks.push({ x: -6, y: 0, z: 0, type: 37, rot: 0 });
  // Bassin d'eau extérieure cristalline avec margelle
  bricks.push({ x: 6, y: 0, z: -6, type: 35, rot: 0 });
  bricks.push({ x: 6, y: 0, z: -7, type: 35, rot: 0 });
  bricks.push({ x: 7, y: 0, z: -6, type: 35, rot: 0 });
  bricks.push({ x: 7, y: 0, z: -7, type: 35, rot: 0 });

  return bricks;
}

/**
 * Arche Brutaliste Blanche
 */
export function getBrutalistArchPreset(): BrickEntry[] {
  const bricks: BrickEntry[] = [];
  const zBase = -8;

  // Allée en dalles plates de marbre blanc sous l'arche
  for (let x = -2; x <= 2; x++) {
    for (let z = -11; z <= -5; z++) {
      bricks.push({ x, y: 0, z, type: 12 });
    }
  }

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
