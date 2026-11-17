/**
 * Couleurs des cartes, à la manière de Minecraft 1.12 : chaque bloc a une couleur de base,
 * déclinée en quatre nuances selon le relief (plus clair si la colonne est plus haute que
 * sa voisine du nord, plus sombre si elle est plus basse ; l'eau s'assombrit avec la profondeur).
 *
 * Un pixel de carte est un octet : 0 = inexploré, sinon base × 4 + nuance (nuance 0..3).
 * Module pur (pas de DOM ni de Three.js).
 */
import { BLOCKS, isLeaves, isTerracotta } from './Blocks';
import { B, COLOR_HEX } from './Ids';

/** Couleurs de base (index 0 réservé : rien). Valeurs de MapColor (Minecraft 1.12). */
const BASE: number[] = [
  0x000000, // 0  rien
  0x7fb238, // 1  herbe
  0xf7e9a3, // 2  sable
  0xc7c7c7, // 3  laine, toile
  0xff0000, // 4  lave, TNT
  0xa0a0ff, // 5  glace
  0xa7a7a7, // 6  fer
  0x007c00, // 7  feuillage
  0xffffff, // 8  neige
  0xa4a8b8, // 9  argile
  0x976d4d, // 10 terre
  0x707070, // 11 pierre
  0x4040ff, // 12 eau
  0x8f7748, // 13 bois
  0xfffcf5, // 14 quartz
  0xfaee4d, // 15 or
  0x5cdbd5, // 16 diamant
  0x4a80ff, // 17 lapis
  0x00d93a, // 18 émeraude
  0x700200, // 19 netherrack
  0x191919, // 20 obsidienne, noir
  0xd87f33, // 21 orange (citrouille)
];
const WOOL_BASE = BASE.length;
for (const c of COLOR_HEX) BASE.push(c);
/** Terre cuite brute puis les 16 colorées (MapColor de Minecraft 1.12), et le sable rouge. */
const TERRACOTTA_BASE = BASE.length;
BASE.push(
  0x985e43, 0xd1b1a1, 0x9f5224, 0x95576c, 0x706c8a, 0xba8524, 0x677535, 0xa04d4e, 0x392923,
  0x876b62, 0x575c5c, 0x7a4958, 0x4c3e5c, 0x4c3223, 0x4c522a, 0x8e3c2e, 0x251610,
);

const C = {
  GRASS: 1, SAND: 2, CLOTH: 3, LAVA: 4, ICE: 5, IRON: 6, PLANT: 7, SNOW: 8, CLAY: 9, DIRT: 10,
  STONE: 11, WATER: 12, WOOD: 13, QUARTZ: 14, GOLD: 15, DIAMOND: 16, LAPIS: 17, EMERALD: 18,
  NETHERRACK: 19, BLACK: 20, ORANGE: 21,
} as const;

/** Multiplicateurs des quatre nuances (Minecraft : 180, 220, 255, 135 sur 255). */
const SHADES = [180 / 255, 220 / 255, 1, 135 / 255];

/** Couleur de base du bloc vu d'en haut (0 = transparent : on regarde dessous). */
export function mapBaseColor(id: number): number {
  if (id === B.AIR || id === B.GLASS || id === B.GLASS_PANE) return 0;
  if (id >= B.WOOL_WHITE && id <= B.WOOL_BLACK) return WOOL_BASE + (id - B.WOOL_WHITE);
  if (isTerracotta(id)) return TERRACOTTA_BASE + (id - B.TERRACOTTA);
  if (id === B.RED_SAND) return TERRACOTTA_BASE + 2;
  if (isLeaves(id)) return C.PLANT;
  switch (id) {
    case B.GRASS:
      return C.GRASS;
    case B.WATER:
      return C.WATER;
    case B.LAVA:
    case B.TNT:
      return C.LAVA;
    case B.SAND:
    case B.SANDSTONE:
      return C.SAND;
    case B.DIRT:
    case B.FARMLAND:
    case B.GRASS_PATH:
      return C.DIRT;
    case B.GRAVEL:
    case B.STONE:
    case B.COBBLESTONE:
      return C.STONE;
    case B.CLAY:
      return C.CLAY;
    case B.SNOW_BLOCK:
    case B.SNOW_LAYER:
      return C.SNOW;
    case B.ICE:
      return C.ICE;
    case B.IRON_BLOCK:
    case B.IRON_BARS:
    case B.IRON_DOOR:
      return C.IRON;
    case B.GOLD_BLOCK:
      return C.GOLD;
    case B.DIAMOND_BLOCK:
      return C.DIAMOND;
    case B.LAPIS_BLOCK:
      return C.LAPIS;
    case B.EMERALD_BLOCK:
      return C.EMERALD;
    case B.QUARTZ_BLOCK:
      return C.QUARTZ;
    case B.NETHERRACK:
    case B.NETHER_QUARTZ_ORE:
      return C.NETHERRACK;
    case B.OBSIDIAN:
    case B.COAL_BLOCK:
      return C.BLACK;
    case B.PUMPKIN:
    case B.JACK_O_LANTERN:
      return C.ORANGE;
    case B.MELON:
    case B.CACTUS:
    case B.LILY_PAD:
    case B.VINE:
      return C.PLANT;
  }
  const def = BLOCKS[id];
  if (!def) return C.STONE;
  switch (def.sound) {
    case 'grass':
      return C.PLANT;
    case 'wood':
      return C.WOOD;
    case 'sand':
      return C.SAND;
    case 'gravel':
      return C.DIRT;
    case 'snow':
      return C.SNOW;
    case 'cloth':
      return C.CLOTH;
    case 'metal':
      return C.IRON;
    case 'glass':
      return 0;
    default:
      return C.STONE;
  }
}

/** Octet d'un pixel de carte. */
export function mapPixel(base: number, shade: number): number {
  return base === 0 ? 0 : base * 4 + (shade & 3);
}

/** Couleur 0xRRGGBB d'un pixel de carte (0 = inexploré). */
export function mapPixelRgb(px: number): number {
  const base = BASE[px >> 2] ?? 0;
  const f = SHADES[px & 3];
  const r = Math.round(((base >> 16) & 255) * f);
  const g = Math.round(((base >> 8) & 255) * f);
  const b = Math.round((base & 255) * f);
  return (r << 16) | (g << 8) | b;
}

/** Couleur du papier sous les pixels inexplorés. */
export const MAP_PAPER = 0xe7d9ae;
