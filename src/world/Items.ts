/**
 * Registre des objets d'inventaire : blocs posables, outils, armures, nourriture, matériaux.
 * Les valeurs (durabilité, dégâts, faim, armure) suivent Minecraft Java 1.12.
 * Module pur (pas de DOM ni de Three.js) : partagé avec les workers.
 */
import { B, BLOCK_ID_LIMIT, COLOR_NAMES, I, ITEM_ID_LIMIT } from './Ids';
import { BLOCKS, type ToolKind } from './Blocks';
import { ARMOR_KINDS, ARMOR_MATERIALS, T, TOOL_KINDS, TOOL_MATERIALS, type TileName } from './Tiles';

export type ItemCategory =
  | 'construction'
  | 'nature'
  | 'decoration'
  | 'utilitaire'
  | 'outils'
  | 'combat'
  | 'nourriture'
  | 'materiaux'
  | 'aucune';

export interface ItemDef {
  id: number;
  /** Nom technique (anglais, snake_case). */
  name: string;
  /** Nom affiché (français). */
  label: string;
  /** Tuile de l'icône plate (index dans T) ; -1 = icône 3D du bloc. */
  tile: number;
  stack: number;
  isBlock: boolean;
  tool: ToolKind | null;
  /** Niveau d'outil : 0 aucun, 1 bois ou or, 2 pierre, 3 fer, 4 diamant. */
  tier: number;
  /** Vitesse de minage sur les blocs de son type (bois 2, pierre 4, fer 6, diamant 8, or 12 ; cisailles 5…). 1 sinon. */
  speed: number;
  /** Nombre d'utilisations ; 0 = ne s'use pas. */
  durability: number;
  /** Dégâts d'attaque en demi-cœurs (main = 1). */
  attack: number;
  /** Points de faim rendus (0 = non comestible) et saturation. */
  food: number;
  saturation: number;
  /** -1 = pas une armure ; 0 casque, 1 plastron, 2 jambières, 3 bottes. */
  armorSlot: number;
  /** Points d'armure. */
  armor: number;
  /** Bloc posé par un clic droit (id de bloc), -1 sinon. Pour un bloc : son propre id. */
  places: number;
  category: ItemCategory;
}

type ItemOptions = Partial<Omit<ItemDef, 'id' | 'name' | 'label' | 'tile' | 'isBlock' | 'category'>>;

/** Objets indexés par identifiant (blocs 0..255, objets >= 256). */
export const ITEMS: Array<ItemDef | undefined> = new Array<ItemDef | undefined>(ITEM_ID_LIMIT).fill(undefined);

function reg(id: number, name: string, label: string, tile: number, category: ItemCategory, isBlock: boolean, o: ItemOptions = {}): void {
  ITEMS[id] = {
    id,
    name,
    label,
    tile,
    stack: o.stack ?? 64,
    isBlock,
    tool: o.tool ?? null,
    tier: o.tier ?? 0,
    speed: o.speed ?? 1,
    durability: o.durability ?? 0,
    attack: o.attack ?? 1,
    food: o.food ?? 0,
    saturation: o.saturation ?? 0,
    armorSlot: o.armorSlot ?? -1,
    armor: o.armor ?? 0,
    places: o.places ?? -1,
    category,
  };
}

// ---------------------------------------------------------------------------
// Blocs : chaque bloc doté d'un objet garde le même identifiant
// ---------------------------------------------------------------------------
for (let id = 0; id < BLOCK_ID_LIMIT; id++) {
  const b = BLOCKS[id];
  if (!b || !b.hasItem) continue;
  reg(id, b.name, b.label, b.itemTile, b.category, true, { stack: b.stack, places: id });
}

// ---------------------------------------------------------------------------
// Objets simples (le nom technique est aussi le nom de la tuile)
// ---------------------------------------------------------------------------
const food = (points: number, saturation: number): ItemOptions => ({ food: points, saturation });

const SIMPLE_ITEMS: Array<[id: number, name: TileName, label: string, category: ItemCategory, options?: ItemOptions]> = [
  // --- Matériaux ---
  [I.STICK, 'stick', 'Bâton', 'materiaux'],
  [I.COAL, 'coal', 'Charbon', 'materiaux'],
  [I.CHARCOAL, 'charcoal', 'Charbon de bois', 'materiaux'],
  [I.IRON_INGOT, 'iron_ingot', 'Lingot de fer', 'materiaux'],
  [I.GOLD_INGOT, 'gold_ingot', "Lingot d'or", 'materiaux'],
  [I.DIAMOND, 'diamond', 'Diamant', 'materiaux'],
  [I.EMERALD, 'emerald', 'Émeraude', 'materiaux'],
  [I.LAPIS, 'lapis', 'Lapis-lazuli', 'materiaux'],
  [I.REDSTONE, 'redstone', 'Poudre de redstone', 'materiaux'],
  [I.FLINT, 'flint', 'Silex', 'materiaux'],
  [I.WHEAT_SEEDS, 'wheat_seeds', 'Graines de blé', 'materiaux', { places: B.WHEAT }],
  [I.WHEAT, 'wheat', 'Blé', 'materiaux'],
  [I.BONE, 'bone', 'Os', 'materiaux'],
  [I.BONE_MEAL, 'bone_meal', "Poudre d'os", 'materiaux'],
  [I.STRING, 'string', 'Ficelle', 'materiaux'],
  [I.FEATHER, 'feather', 'Plume', 'materiaux'],
  [I.GUNPOWDER, 'gunpowder', 'Poudre à canon', 'materiaux'],
  [I.LEATHER, 'leather', 'Cuir', 'materiaux'],
  [I.EGG, 'egg', 'Œuf', 'materiaux', { stack: 16 }],
  [I.SUGAR, 'sugar', 'Sucre', 'materiaux'],
  [I.PAPER, 'paper', 'Papier', 'materiaux'],
  [I.BOOK, 'book', 'Livre', 'materiaux'],
  [I.CLAY_BALL, 'clay_ball', "Boule d'argile", 'materiaux'],
  [I.BRICK, 'brick', 'Brique', 'materiaux'],
  [I.SNOWBALL, 'snowball', 'Boule de neige', 'materiaux', { stack: 16 }],
  [I.GLOWSTONE_DUST, 'glowstone_dust', 'Poudre lumineuse', 'materiaux'],
  [I.QUARTZ, 'quartz', 'Quartz du Nether', 'materiaux'],
  [I.BOWL, 'bowl', 'Bol', 'materiaux'],

  // --- Nourriture ---
  [I.BREAD, 'bread', 'Pain', 'nourriture', food(5, 6)],
  [I.APPLE, 'apple', 'Pomme', 'nourriture', food(4, 2.4)],
  [I.GOLDEN_APPLE, 'golden_apple', 'Pomme dorée', 'nourriture', food(4, 9.6)],
  [I.RAW_PORKCHOP, 'raw_porkchop', 'Côtelette de porc crue', 'nourriture', food(3, 1.8)],
  [I.COOKED_PORKCHOP, 'cooked_porkchop', 'Côtelette de porc cuite', 'nourriture', food(8, 12.8)],
  [I.RAW_BEEF, 'raw_beef', 'Bœuf cru', 'nourriture', food(3, 1.8)],
  [I.STEAK, 'steak', 'Steak', 'nourriture', food(8, 12.8)],
  [I.RAW_CHICKEN, 'raw_chicken', 'Poulet cru', 'nourriture', food(2, 1.2)],
  [I.COOKED_CHICKEN, 'cooked_chicken', 'Poulet rôti', 'nourriture', food(6, 7.2)],
  [I.RAW_MUTTON, 'raw_mutton', 'Mouton cru', 'nourriture', food(2, 1.2)],
  [I.COOKED_MUTTON, 'cooked_mutton', 'Mouton cuit', 'nourriture', food(6, 9.6)],
  [I.ROTTEN_FLESH, 'rotten_flesh', 'Chair putréfiée', 'nourriture', food(4, 0.8)],
  [I.MELON_SLICE, 'melon_slice', 'Tranche de pastèque', 'nourriture', food(2, 1.2)],
  [I.SPIDER_EYE, 'spider_eye', "Œil d'araignée", 'nourriture', food(2, 3.2)],
  [I.CARROT, 'carrot', 'Carotte', 'nourriture', { ...food(3, 3.6), places: B.CARROTS }],
  [I.POTATO, 'potato', 'Pomme de terre', 'nourriture', { ...food(1, 0.6), places: B.POTATOES }],
  [I.BAKED_POTATO, 'baked_potato', 'Pomme de terre cuite', 'nourriture', food(5, 6)],
  [I.COOKIE, 'cookie', 'Cookie', 'nourriture', food(2, 0.4)],
  [I.PUMPKIN_PIE, 'pumpkin_pie', 'Tarte à la citrouille', 'nourriture', food(8, 4.8)],
  [I.RAW_FISH, 'raw_fish', 'Poisson cru', 'nourriture', food(2, 0.4)],
  [I.COOKED_FISH, 'cooked_fish', 'Poisson cuit', 'nourriture', food(5, 6)],
  [I.MUSHROOM_STEW, 'mushroom_stew', 'Soupe de champignons', 'nourriture', { ...food(6, 7.2), stack: 1 }],
  // Le lait se boit mais ne nourrit pas (food = 0)
  [I.MILK_BUCKET, 'milk_bucket', 'Seau de lait', 'nourriture', { stack: 1 }],

  // --- Outils divers ---
  [I.FLINT_AND_STEEL, 'flint_and_steel', 'Briquet', 'outils', { stack: 1, durability: 64 }],
  [I.SHEARS, 'shears', 'Cisailles', 'outils', { stack: 1, durability: 238, tool: 'shears', speed: 5 }],
  [I.FISHING_ROD, 'fishing_rod', 'Canne à pêche', 'outils', { stack: 1, durability: 64 }],
  [I.BUCKET, 'bucket', 'Seau', 'outils', { stack: 16 }],
  [I.WATER_BUCKET, 'water_bucket', "Seau d'eau", 'outils', { stack: 1 }],
  [I.LAVA_BUCKET, 'lava_bucket', 'Seau de lave', 'outils', { stack: 1 }],

  // --- Combat ---
  [I.BOW, 'bow', 'Arc', 'combat', { stack: 1, durability: 384 }],
  [I.ARROW, 'arrow', 'Flèche', 'combat'],
];
for (const [id, name, label, category, options] of SIMPLE_ITEMS) reg(id, name, label, T[name], category, false, options);

// ---------------------------------------------------------------------------
// Outils : 5 matériaux × 5 types (même ordre que Ids et Tiles)
// ---------------------------------------------------------------------------
const TOOL_MATERIAL_STATS = [
  { label: 'en bois', tier: 1, speed: 2, durability: 59 },
  { label: 'en pierre', tier: 2, speed: 4, durability: 131 },
  { label: 'en fer', tier: 3, speed: 6, durability: 250 },
  { label: 'en or', tier: 1, speed: 12, durability: 32 },
  { label: 'en diamant', tier: 4, speed: 8, durability: 1561 },
];
const TOOL_KIND_LABELS = ['Pioche', 'Hache', 'Pelle', 'Épée', 'Houe'];
/** Dégâts par type d'outil (lignes) et par matériau (colonnes : bois, pierre, fer, or, diamant). */
const TOOL_ATTACK = [
  [2, 3, 4, 2, 5], // pioche
  [3, 4, 5, 3, 6], // hache
  [1, 2, 3, 1, 4], // pelle
  [4, 5, 6, 4, 7], // épée
  [1, 1, 1, 1, 1], // houe
];
TOOL_MATERIALS.forEach((material, m) => {
  const stats = TOOL_MATERIAL_STATS[m];
  TOOL_KINDS.forEach((kind, k) => {
    const isSword = kind === 'sword';
    reg(
      I.WOODEN_PICKAXE + m * TOOL_KINDS.length + k,
      `${material}_${kind}`,
      `${TOOL_KIND_LABELS[k]} ${stats.label}`,
      T[`${material}_${kind}`],
      isSword ? 'combat' : 'outils',
      false,
      {
        stack: 1,
        tool: kind,
        tier: stats.tier,
        // Une épée ne mine vite que les toiles d'araignée et les plantes (voir Drops.miningSpeed)
        speed: isSword ? 1.5 : stats.speed,
        durability: stats.durability,
        attack: TOOL_ATTACK[k][m],
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Armures : 4 matériaux × 4 pièces (même ordre que Ids et Tiles)
// ---------------------------------------------------------------------------
const ARMOR_MATERIAL_STATS = [
  { label: 'en cuir', durability: 5, points: [1, 3, 2, 1] },
  { label: 'en fer', durability: 15, points: [2, 6, 5, 2] },
  { label: 'en or', durability: 7, points: [2, 5, 3, 1] },
  { label: 'en diamant', durability: 33, points: [3, 8, 6, 3] },
];
/** Durabilité de base par pièce (casque, plastron, jambières, bottes), multipliée par celle du matériau. */
const ARMOR_SLOT_DURABILITY = [11, 16, 15, 13];
const ARMOR_KIND_LABELS = ['Casque', 'Plastron', 'Jambières', 'Bottes'];
const LEATHER_KIND_LABELS = ['Casquette', 'Tunique', 'Pantalon', 'Bottes'];
ARMOR_MATERIALS.forEach((material, m) => {
  const stats = ARMOR_MATERIAL_STATS[m];
  ARMOR_KINDS.forEach((kind, k) => {
    const kindLabel = material === 'leather' ? LEATHER_KIND_LABELS[k] : ARMOR_KIND_LABELS[k];
    reg(
      I.LEATHER_HELMET + m * ARMOR_KINDS.length + k,
      `${material}_${kind}`,
      `${kindLabel} ${stats.label}`,
      T[`${material}_${kind}`],
      'combat',
      false,
      { stack: 1, durability: stats.durability * ARMOR_SLOT_DURABILITY[k], armorSlot: k, armor: stats.points[k] },
    );
  });
});

// ---------------------------------------------------------------------------
// Teintures : même ordre que les laines
// ---------------------------------------------------------------------------
const DYE_LABELS = [
  'Teinture blanche', 'Teinture orange', 'Teinture magenta', 'Teinture bleu clair', 'Teinture jaune', 'Teinture vert clair',
  'Teinture rose', 'Teinture grise', 'Teinture gris clair', 'Teinture cyan', 'Teinture violette', 'Teinture bleue',
  'Teinture marron', 'Teinture verte', 'Teinture rouge', 'Teinture noire',
];
COLOR_NAMES.forEach((color, i) => {
  reg(I.DYE_WHITE + i, `${color}_dye`, DYE_LABELS[i], T[`dye_${color}`], 'materiaux', false);
});

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------
/** Définition de secours pour les identifiants inconnus (et la main vide, id 0). */
const UNKNOWN_ITEM: ItemDef = Object.freeze({
  id: 0,
  name: 'unknown',
  label: 'Objet inconnu',
  tile: T.stone,
  stack: 64,
  isBlock: false,
  tool: null,
  tier: 0,
  speed: 1,
  durability: 0,
  attack: 1,
  food: 0,
  saturation: 0,
  armorSlot: -1,
  armor: 0,
  places: -1,
  category: 'aucune',
});

/** Ne lève jamais d'erreur : retourne une définition « Objet inconnu » pour un identifiant inconnu. */
export function getItem(id: number): ItemDef {
  return ITEMS[id] ?? UNKNOWN_ITEM;
}

export function itemLabel(id: number): string {
  return getItem(id).label;
}

export function maxStack(id: number): number {
  return getItem(id).stack;
}

/** L'objet s'use-t-il (outils, armures, arc, briquet…) ? */
export function isTool(id: number): boolean {
  return getItem(id).durability > 0;
}

/** Onglets de l'inventaire créatif, dans un ordre de présentation soigné. */
export const CREATIVE_TABS: Array<{ key: ItemCategory; label: string; icon: number /* item id */; items: number[] }> = [
  { key: 'construction', label: 'Construction', icon: B.BRICKS, items: [] },
  { key: 'nature', label: 'Nature', icon: B.GRASS, items: [] },
  { key: 'decoration', label: 'Décoration', icon: B.POPPY, items: [] },
  { key: 'utilitaire', label: 'Utilitaire', icon: B.CRAFTING_TABLE, items: [] },
  { key: 'outils', label: 'Outils', icon: I.IRON_PICKAXE, items: [] },
  { key: 'combat', label: 'Combat', icon: I.IRON_SWORD, items: [] },
  { key: 'nourriture', label: 'Nourriture', icon: I.APPLE, items: [] },
  { key: 'materiaux', label: 'Matériaux', icon: I.IRON_INGOT, items: [] },
];
// Dans chaque onglet : blocs puis objets, par identifiant croissant
for (const item of ITEMS) {
  if (!item) continue;
  const tab = CREATIVE_TABS.find((t) => t.key === item.category);
  if (tab) tab.items.push(item.id);
}
