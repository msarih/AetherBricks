/**
 * Biomes : identifiants, noms et paramètres de décoration.
 * Module pur : partagé avec les workers.
 */
import { B } from '../Ids';

export const BIOME = {
  OCEAN: 0,
  DEEP_OCEAN: 1,
  FROZEN_OCEAN: 2,
  RIVER: 3,
  FROZEN_RIVER: 4,
  BEACH: 5,
  SNOWY_BEACH: 6,
  STONY_SHORE: 7,
  PLAINS: 8,
  FOREST: 9,
  BIRCH_FOREST: 10,
  DARK_FOREST: 11,
  TAIGA: 12,
  SNOWY_PLAINS: 13,
  SNOWY_TAIGA: 14,
  DESERT: 15,
  SAVANNA: 16,
  JUNGLE: 17,
  SWAMP: 18,
  MOUNTAINS: 19,
  SNOWY_MOUNTAINS: 20,
} as const;

export const TREE = {
  NONE: 0,
  OAK: 1,
  BIRCH: 2,
  SPRUCE: 3,
  JUNGLE: 4,
  ACACIA: 5,
  LARGE_OAK: 6,
  SWAMP_OAK: 7,
  JUNGLE_BUSH: 8,
  CACTUS: 9,
  TALL_JUNGLE: 10,
} as const;

export interface BiomeDef {
  id: number;
  name: string;
  label: string;
  /** Probabilité d'arbre par cellule de 4×4 colonnes. */
  treeDensity: number;
  /** Types d'arbres possibles, avec leur poids. */
  trees: Array<[number, number]>;
  /** Probabilité d'herbe haute par colonne. */
  grassDensity: number;
  /** Part de fougères parmi les herbes. */
  fernRatio: number;
  /** Probabilité de fleur par colonne dans les « parterres ». */
  flowerDensity: number;
  flowers: number[];
  /** Neige au sol et glace sur l'eau. */
  snowy: boolean;
  /** Il n'y pleut jamais (désert, savane). */
  dry: boolean;
  /** Couleur de l'eau (teinte multiplicative). */
  waterColor: number;
  /** Couleur de carte (outil de mise au point). */
  mapColor: number;
}

const COMMON_FLOWERS = [B.DANDELION, B.POPPY];
const PLAINS_FLOWERS = [
  B.DANDELION, B.POPPY, B.AZURE_BLUET, B.OXEYE_DAISY, B.CORNFLOWER,
  B.RED_TULIP, B.ORANGE_TULIP, B.WHITE_TULIP, B.PINK_TULIP,
];

export const BIOMES: BiomeDef[] = [];

function biome(id: number, name: string, label: string, o: Partial<BiomeDef>): void {
  BIOMES[id] = {
    id,
    name,
    label,
    treeDensity: 0,
    trees: [],
    grassDensity: 0,
    fernRatio: 0,
    flowerDensity: 0,
    flowers: COMMON_FLOWERS,
    snowy: false,
    dry: false,
    waterColor: 0x3f76e4,
    mapColor: 0x808080,
    ...o,
  };
}

biome(BIOME.OCEAN, 'ocean', 'Océan', { mapColor: 0x2b4fa8 });
biome(BIOME.DEEP_OCEAN, 'deep_ocean', 'Océan profond', { mapColor: 0x1c3580 });
biome(BIOME.FROZEN_OCEAN, 'frozen_ocean', 'Océan gelé', { snowy: true, waterColor: 0x3938c9, mapColor: 0x9fb8e0 });
biome(BIOME.RIVER, 'river', 'Rivière', { mapColor: 0x3f76e4 });
biome(BIOME.FROZEN_RIVER, 'frozen_river', 'Rivière gelée', { snowy: true, waterColor: 0x3938c9, mapColor: 0xa8c8f0 });
biome(BIOME.BEACH, 'beach', 'Plage', { mapColor: 0xe6d9a0 });
biome(BIOME.SNOWY_BEACH, 'snowy_beach', 'Plage enneigée', { snowy: true, waterColor: 0x3d57d6, mapColor: 0xf0ecd8 });
biome(BIOME.STONY_SHORE, 'stony_shore', 'Côte rocheuse', { mapColor: 0x8c8c8c });
biome(BIOME.PLAINS, 'plains', 'Plaines', {
  treeDensity: 0.012, trees: [[TREE.OAK, 9], [TREE.LARGE_OAK, 1]], grassDensity: 0.32, flowerDensity: 0.3,
  flowers: PLAINS_FLOWERS, mapColor: 0x8db360,
});
biome(BIOME.FOREST, 'forest', 'Forêt', {
  treeDensity: 0.62, trees: [[TREE.OAK, 14], [TREE.BIRCH, 4], [TREE.LARGE_OAK, 1]], grassDensity: 0.1, flowerDensity: 0.12,
  flowers: [B.DANDELION, B.POPPY, B.ALLIUM, B.OXEYE_DAISY], mapColor: 0x2f7d32,
});
biome(BIOME.BIRCH_FOREST, 'birch_forest', 'Forêt de bouleaux', {
  treeDensity: 0.6, trees: [[TREE.BIRCH, 1]], grassDensity: 0.1, flowerDensity: 0.1, mapColor: 0x55a04f,
});
biome(BIOME.DARK_FOREST, 'dark_forest', 'Forêt sombre', {
  treeDensity: 0.85, trees: [[TREE.LARGE_OAK, 5], [TREE.OAK, 4]], grassDensity: 0.06, flowerDensity: 0.04, mapColor: 0x1f4f22,
});
biome(BIOME.TAIGA, 'taiga', 'Taïga', {
  treeDensity: 0.58, trees: [[TREE.SPRUCE, 1]], grassDensity: 0.14, fernRatio: 0.7, flowerDensity: 0.03, mapColor: 0x2d6b5a,
});
biome(BIOME.SNOWY_PLAINS, 'snowy_plains', 'Plaines enneigées', {
  treeDensity: 0.01, trees: [[TREE.SPRUCE, 1]], snowy: true, waterColor: 0x3d57d6, mapColor: 0xf4f7fa,
});
biome(BIOME.SNOWY_TAIGA, 'snowy_taiga', 'Taïga enneigée', {
  treeDensity: 0.5, trees: [[TREE.SPRUCE, 1]], grassDensity: 0.02, fernRatio: 0.7, snowy: true, waterColor: 0x3d57d6,
  mapColor: 0xc9d8d2,
});
biome(BIOME.DESERT, 'desert', 'Désert', {
  treeDensity: 0.035, trees: [[TREE.CACTUS, 1]], dry: true, waterColor: 0x32a598, mapColor: 0xe8d59a,
});
biome(BIOME.SAVANNA, 'savanna', 'Savane', {
  treeDensity: 0.05, trees: [[TREE.ACACIA, 6], [TREE.OAK, 1]], grassDensity: 0.55, flowerDensity: 0.03, dry: true,
  waterColor: 0x2c8b9c, mapColor: 0xbdb25f,
});
biome(BIOME.JUNGLE, 'jungle', 'Jungle', {
  treeDensity: 0.9, trees: [[TREE.JUNGLE, 6], [TREE.TALL_JUNGLE, 2], [TREE.JUNGLE_BUSH, 5], [TREE.OAK, 1]], grassDensity: 0.4,
  fernRatio: 0.35, flowerDensity: 0.05, waterColor: 0x14a2c5, mapColor: 0x3fa01f,
});
biome(BIOME.SWAMP, 'swamp', 'Marais', {
  treeDensity: 0.22, trees: [[TREE.SWAMP_OAK, 1]], grassDensity: 0.2, flowerDensity: 0.08, flowers: [B.BLUE_ORCHID],
  waterColor: 0x617b64, mapColor: 0x4c6a3b,
});
biome(BIOME.MOUNTAINS, 'mountains', 'Montagnes', {
  treeDensity: 0.07, trees: [[TREE.SPRUCE, 3], [TREE.OAK, 1]], grassDensity: 0.08, flowerDensity: 0.02, mapColor: 0x7c7c7c,
});
biome(BIOME.SNOWY_MOUNTAINS, 'snowy_mountains', 'Pics enneigés', {
  treeDensity: 0.03, trees: [[TREE.SPRUCE, 1]], snowy: true, waterColor: 0x3d57d6, mapColor: 0xd8dde4,
});

export function isOceanBiome(b: number): boolean {
  return b === BIOME.OCEAN || b === BIOME.DEEP_OCEAN || b === BIOME.FROZEN_OCEAN;
}

export function isWaterBiome(b: number): boolean {
  return b <= BIOME.FROZEN_RIVER;
}
