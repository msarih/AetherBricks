/**
 * Recettes d'artisanat (grille 2×2 de l'inventaire ou 3×3 de l'établi), cuisson au fourneau
 * et combustibles. Les recettes suivent Minecraft Java dans la limite des identifiants connus.
 * Module pur (pas de DOM ni de Three.js) : partagé avec les workers.
 */
import { B, COLOR_NAMES, I, ITEM_ID_LIMIT } from './Ids';

/** Un ingrédient : un id, ou une liste d'ids interchangeables (ex. toutes les planches). 0 = case vide. */
export type Ingredient = number | readonly number[];

export interface Recipe {
  shaped: boolean;
  /** Recette en forme : largeur, hauteur et cases (ligne par ligne). Sans forme : w = h = 0. */
  w: number;
  h: number;
  cells: Ingredient[];
  result: { id: number; count: number };
}

export const RECIPES: Recipe[] = [];

// ---------------------------------------------------------------------------
// Aides d'écriture
// ---------------------------------------------------------------------------
/**
 * Recette en forme décrite comme dans les JSON de Minecraft : des lignes de caractères
 * et une table caractère → ingrédient. L'espace désigne une case vide.
 */
function shaped(rows: readonly string[], key: Record<string, Ingredient>, id: number, count = 1): void {
  const h = rows.length;
  const w = rows[0].length;
  const cells: Ingredient[] = [];
  for (const row of rows) {
    if (row.length !== w) throw new Error(`Recette ${id} : lignes de largeurs différentes`);
    for (const ch of row) {
      if (ch === ' ') {
        cells.push(0);
        continue;
      }
      const ing = key[ch];
      if (ing === undefined) throw new Error(`Recette ${id} : symbole « ${ch} » absent de la table`);
      cells.push(ing);
    }
  }
  RECIPES.push({ shaped: true, w, h, cells, result: { id, count } });
}

/** Recette sans forme : les ingrédients peuvent être placés n'importe où. */
function shapeless(ingredients: readonly Ingredient[], id: number, count = 1): void {
  RECIPES.push({ shaped: false, w: 0, h: 0, cells: [...ingredients], result: { id, count } });
}

/** n identifiants consécutifs à partir de first. */
function range(first: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => first + i);
}

// ---------------------------------------------------------------------------
// Groupes d'ingrédients interchangeables
// ---------------------------------------------------------------------------
const WOOD_COUNT = 5;
const LOGS: readonly number[] = range(B.OAK_LOG, WOOD_COUNT);
const PLANKS: readonly number[] = range(B.OAK_PLANKS, WOOD_COUNT);
const SAPLINGS: readonly number[] = range(B.OAK_SAPLING, WOOD_COUNT);
const WOOD_SLABS: readonly number[] = range(B.OAK_SLAB, WOOD_COUNT);
const WOOD_STAIRS: readonly number[] = range(B.OAK_STAIRS, WOOD_COUNT);
const WOOLS: readonly number[] = range(B.WOOL_WHITE, COLOR_NAMES.length);
const COALS: readonly number[] = [I.COAL, I.CHARCOAL];

// ---------------------------------------------------------------------------
// Bases : bois, établi, fourneau, coffre, torches
// ---------------------------------------------------------------------------
for (let i = 0; i < WOOD_COUNT; i++) shaped(['#'], { '#': B.OAK_LOG + i }, B.OAK_PLANKS + i, 4);
shaped(['#', '#'], { '#': PLANKS }, I.STICK, 4);
shaped(['##', '##'], { '#': PLANKS }, B.CRAFTING_TABLE);
shaped(['###', '# #', '###'], { '#': B.COBBLESTONE }, B.FURNACE);
shaped(['###', '# #', '###'], { '#': PLANKS }, B.CHEST);
shaped(['# #', '# #', '###'], { '#': I.IRON_INGOT }, B.CAULDRON);
shaped(['# #', ' # '], { '#': B.GLASS }, I.GLASS_BOTTLE, 3);
shaped(['MMM', 'SES', 'WWW'], { M: I.MILK_BUCKET, S: I.SUGAR, E: I.EGG, W: I.WHEAT }, B.CAKE);
shaped([' B ', 'CCC'], { B: I.BLAZE_ROD, C: B.COBBLESTONE }, B.BREWING_STAND);
shaped(['GGG', 'GCG', 'GGG'], { G: I.GOLD_NUGGET, C: I.CARROT }, I.GOLDEN_CARROT);
shaped(['GGG', 'GMG', 'GGG'], { G: I.GOLD_NUGGET, M: I.MELON_SLICE }, I.GLISTERING_MELON);
shaped(['PFP', 'PPP', ' P '], { P: PLANKS, F: I.IRON_INGOT }, I.SHIELD);
shaped(['C', '|'], { C: COALS, '|': I.STICK }, B.TORCH, 4);

// ---------------------------------------------------------------------------
// Outils et épées : bois (toutes planches), pierre, fer, or, diamant
// ---------------------------------------------------------------------------
const TOOL_MATERIAL_INGREDIENTS: Ingredient[] = [PLANKS, B.COBBLESTONE, I.IRON_INGOT, I.GOLD_INGOT, I.DIAMOND];
/** Formes dans l'ordre des ids : pioche, hache, pelle, épée, houe. */
const TOOL_PATTERNS: string[][] = [
  ['XXX', ' | ', ' | '],
  ['XX', 'X|', ' |'],
  ['X', '|', '|'],
  ['X', 'X', '|'],
  ['XX', ' |', ' |'],
];
TOOL_MATERIAL_INGREDIENTS.forEach((material, m) => {
  TOOL_PATTERNS.forEach((pattern, k) => {
    shaped(pattern, { X: material, '|': I.STICK }, I.WOODEN_PICKAXE + m * TOOL_PATTERNS.length + k);
  });
});

// ---------------------------------------------------------------------------
// Armures : cuir, fer, or, diamant
// ---------------------------------------------------------------------------
const ARMOR_MATERIAL_INGREDIENTS: Ingredient[] = [I.LEATHER, I.IRON_INGOT, I.GOLD_INGOT, I.DIAMOND];
/** Formes dans l'ordre des ids : casque, plastron, jambières, bottes. */
const ARMOR_PATTERNS: string[][] = [
  ['XXX', 'X X'],
  ['X X', 'XXX', 'XXX'],
  ['XXX', 'X X', 'X X'],
  ['X X', 'X X'],
];
ARMOR_MATERIAL_INGREDIENTS.forEach((material, m) => {
  ARMOR_PATTERNS.forEach((pattern, k) => {
    shaped(pattern, { X: material }, I.LEATHER_HELMET + m * ARMOR_PATTERNS.length + k);
  });
});

// ---------------------------------------------------------------------------
// Équipement divers
// ---------------------------------------------------------------------------
shaped([' |S', '| S', ' |S'], { '|': I.STICK, S: I.STRING }, I.BOW);
shaped(['F', '|', 'P'], { F: I.FLINT, '|': I.STICK, P: I.FEATHER }, I.ARROW, 4);
shaped(['  |', ' |S', '| S'], { '|': I.STICK, S: I.STRING }, I.FISHING_ROD);
shaped([' # ', '#R#', ' # '], { '#': I.IRON_INGOT, R: I.REDSTONE }, I.COMPASS);
shaped([' # ', '#R#', ' # '], { '#': I.GOLD_INGOT, R: I.REDSTONE }, I.CLOCK);
shaped(['PPP', 'PCP', 'PPP'], { P: I.PAPER, C: I.COMPASS }, I.MAP);
shaped(['###', '###', ' | '], { '#': PLANKS, '|': I.STICK }, I.SIGN, 3);
shaped([' #', '# '], { '#': I.IRON_INGOT }, I.SHEARS);
shapeless([I.IRON_INGOT, I.FLINT], I.FLINT_AND_STEEL);
shaped(['# #', ' # '], { '#': I.IRON_INGOT }, I.BUCKET);
shaped(['# #', ' # '], { '#': PLANKS }, I.BOWL, 4);

// ---------------------------------------------------------------------------
// Mobilier, portes, clôtures, vitres
// ---------------------------------------------------------------------------
shaped(['WWW', 'PPP'], { W: WOOLS, P: PLANKS }, B.BED);
shaped(['##', '##', '##'], { '#': PLANKS }, B.OAK_DOOR, 3);
shaped(['##', '##', '##'], { '#': I.IRON_INGOT }, B.IRON_DOOR, 3);
shaped(['###', '###'], { '#': PLANKS }, B.TRAPDOOR, 2);
shaped(['| |', '|||', '| |'], { '|': I.STICK }, B.LADDER, 3);
shaped(['#|#', '#|#'], { '#': PLANKS, '|': I.STICK }, B.OAK_FENCE, 3);
shaped(['# #', '#|#', '# #'], { '#': I.IRON_INGOT, '|': I.STICK }, B.RAIL, 16);
shaped(['##', '##'], { '#': I.NETHER_BRICK }, B.NETHER_BRICKS);
shaped(['###', '###'], { '#': B.NETHER_BRICKS }, B.NETHER_BRICK_FENCE, 6);
shaped(['|#|', '|#|'], { '#': PLANKS, '|': I.STICK }, B.FENCE_GATE);
shaped(['###', '###'], { '#': B.GLASS }, B.GLASS_PANE, 16);
shaped(['###', '###'], { '#': I.IRON_INGOT }, B.IRON_BARS, 16);
shaped(['###', 'BBB', '###'], { '#': PLANKS, B: I.BOOK }, B.BOOKSHELF);
shaped([' B ', 'DOD', 'OOO'], { B: I.BOOK, D: I.DIAMOND, O: B.OBSIDIAN }, B.ENCHANTING_TABLE);
shaped(['BBB', ' I ', 'III'], { B: B.IRON_BLOCK, I: I.IRON_INGOT }, B.ANVIL);

// ---------------------------------------------------------------------------
// Dalles (6 pour 3 blocs) et escaliers (4 pour 6 blocs)
// ---------------------------------------------------------------------------
const SLAB_SOURCES: Array<[source: number, slab: number]> = [
  [B.STONE, B.STONE_SLAB],
  [B.SMOOTH_STONE, B.STONE_SLAB],
  [B.COBBLESTONE, B.COBBLESTONE_SLAB],
  [B.OAK_PLANKS, B.OAK_SLAB],
  [B.SPRUCE_PLANKS, B.SPRUCE_SLAB],
  [B.BIRCH_PLANKS, B.BIRCH_SLAB],
  [B.JUNGLE_PLANKS, B.JUNGLE_SLAB],
  [B.ACACIA_PLANKS, B.ACACIA_SLAB],
  [B.BRICKS, B.BRICK_SLAB],
  [B.STONE_BRICKS, B.STONE_BRICK_SLAB],
  [B.SANDSTONE, B.SANDSTONE_SLAB],
  [B.QUARTZ_BLOCK, B.QUARTZ_SLAB],
];
for (const [source, slab] of SLAB_SOURCES) shaped(['###'], { '#': source }, slab, 6);

const STAIRS_SOURCES: Array<[source: number, stairs: number]> = [
  [B.COBBLESTONE, B.COBBLESTONE_STAIRS],
  [B.OAK_PLANKS, B.OAK_STAIRS],
  [B.SPRUCE_PLANKS, B.SPRUCE_STAIRS],
  [B.BIRCH_PLANKS, B.BIRCH_STAIRS],
  [B.JUNGLE_PLANKS, B.JUNGLE_STAIRS],
  [B.ACACIA_PLANKS, B.ACACIA_STAIRS],
  [B.BRICKS, B.BRICK_STAIRS],
  [B.STONE_BRICKS, B.STONE_BRICK_STAIRS],
  [B.SANDSTONE, B.SANDSTONE_STAIRS],
  [B.QUARTZ_BLOCK, B.QUARTZ_STAIRS],
];
for (const [source, stairs] of STAIRS_SOURCES) shaped(['#  ', '## ', '###'], { '#': source }, stairs, 4);

// ---------------------------------------------------------------------------
// Blocs de construction et de décoration
// ---------------------------------------------------------------------------
shaped(['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND }, B.TNT);
shaped(['R', 'S'], { R: I.REDSTONE, S: I.STICK }, B.REDSTONE_TORCH);
shaped(['S', 'C'], { S: I.STICK, C: B.COBBLESTONE }, B.LEVER);
shapeless([B.STONE], B.STONE_BUTTON);
shaped(['SS'], { S: B.STONE }, B.STONE_PRESSURE_PLATE);
shaped(['PPP', 'CIC', 'CRC'], { P: B.OAK_PLANKS, C: B.COBBLESTONE, I: I.IRON_INGOT, R: I.REDSTONE }, B.PISTON);
shapeless([B.PISTON, B.VINE], B.STICKY_PISTON);
shaped(['S', 'P'], { S: I.SLIME_BALL, P: B.PISTON }, B.STICKY_PISTON);
shaped(['FF ', 'FS ', '  F'], { F: I.STRING, S: I.SLIME_BALL }, I.LEAD, 2);
shapeless([I.BLAZE_ROD], I.BLAZE_POWDER, 2);
shapeless([I.ENDER_PEARL, I.BLAZE_POWDER], I.ENDER_EYE);
shapeless([I.BLAZE_POWDER, I.SLIME_BALL], I.MAGMA_CREAM);
shaped([' R ', 'RGR', ' R '], { R: I.REDSTONE, G: B.GLOWSTONE }, B.REDSTONE_LAMP);
shaped(['##', '##'], { '#': B.SAND }, B.SANDSTONE);
shaped(['##', '##'], { '#': I.BRICK }, B.BRICKS);
shaped(['##', '##'], { '#': I.CLAY_BALL }, B.CLAY);
shaped(['##', '##'], { '#': I.SNOWBALL }, B.SNOW_BLOCK);
shaped(['###'], { '#': B.SNOW_BLOCK }, B.SNOW_LAYER, 6);
shaped(['##', '##'], { '#': B.STONE }, B.STONE_BRICKS, 4);
shapeless([B.STONE_BRICKS, B.VINE], B.MOSSY_STONE_BRICKS);
shapeless([B.COBBLESTONE, B.VINE], B.MOSSY_COBBLESTONE);
shaped(['##', '##'], { '#': I.QUARTZ }, B.QUARTZ_BLOCK);
shaped(['##', '##'], { '#': I.GLOWSTONE_DUST }, B.GLOWSTONE);
shaped(['##', '##'], { '#': I.STRING }, B.WOOL_WHITE);
shaped(['###', '###', '###'], { '#': I.WHEAT }, B.HAY_BALE);
shaped(['#'], { '#': B.HAY_BALE }, I.WHEAT, 9);
shaped(['###', '###', '###'], { '#': I.MELON_SLICE }, B.MELON);
shaped(['P', 'T'], { P: B.PUMPKIN, T: B.TORCH }, B.JACK_O_LANTERN);
shaped(['CQ', 'QC'], { C: B.COBBLESTONE, Q: I.QUARTZ }, B.DIORITE, 2);
shapeless([B.DIORITE, I.QUARTZ], B.GRANITE);
shapeless([B.DIORITE, B.COBBLESTONE], B.ANDESITE, 2);

// ---------------------------------------------------------------------------
// Blocs de minerai ↔ 9 unités
// ---------------------------------------------------------------------------
const MINERAL_BLOCKS: Array<[item: number, block: number]> = [
  [I.COAL, B.COAL_BLOCK],
  [I.IRON_INGOT, B.IRON_BLOCK],
  [I.GOLD_INGOT, B.GOLD_BLOCK],
  [I.DIAMOND, B.DIAMOND_BLOCK],
  [I.LAPIS, B.LAPIS_BLOCK],
  [I.EMERALD, B.EMERALD_BLOCK],
  [I.REDSTONE, B.REDSTONE_BLOCK],
];
for (const [item, block] of MINERAL_BLOCKS) {
  shaped(['###', '###', '###'], { '#': item }, block);
  shaped(['#'], { '#': block }, item, 9);
}
shaped(['###', '###', '###'], { '#': I.GOLD_NUGGET }, I.GOLD_INGOT);
shaped(['#'], { '#': I.GOLD_INGOT }, I.GOLD_NUGGET, 9);

// ---------------------------------------------------------------------------
// Teintures
// ---------------------------------------------------------------------------
shapeless([B.DANDELION], I.DYE_YELLOW);
shapeless([[B.POPPY, B.RED_TULIP]], I.DYE_RED);
shapeless([B.CORNFLOWER], I.DYE_BLUE);
shapeless([B.BLUE_ORCHID], I.DYE_LIGHT_BLUE);
shapeless([B.ALLIUM], I.DYE_MAGENTA);
shapeless([[B.AZURE_BLUET, B.OXEYE_DAISY, B.WHITE_TULIP]], I.DYE_LIGHT_GRAY);
shapeless([B.ORANGE_TULIP], I.DYE_ORANGE);
shapeless([B.PINK_TULIP], I.DYE_PINK);
shapeless([I.LAPIS], I.DYE_BLUE);
shapeless([I.BONE], I.BONE_MEAL, 3);
shapeless([I.BONE_MEAL], I.DYE_WHITE);
// Mélanges
shapeless([I.DYE_RED, I.DYE_YELLOW], I.DYE_ORANGE, 2);
shapeless([I.DYE_RED, I.DYE_WHITE], I.DYE_PINK, 2);
shapeless([I.DYE_BLUE, I.DYE_WHITE], I.DYE_LIGHT_BLUE, 2);
shapeless([I.DYE_GREEN, I.DYE_WHITE], I.DYE_LIME, 2);
shapeless([I.DYE_BLACK, I.DYE_WHITE], I.DYE_GRAY, 2);
shapeless([I.DYE_GRAY, I.DYE_WHITE], I.DYE_LIGHT_GRAY, 2);
shapeless([I.DYE_BLACK, I.DYE_WHITE, I.DYE_WHITE], I.DYE_LIGHT_GRAY, 3);
shapeless([I.DYE_BLUE, I.DYE_GREEN], I.DYE_CYAN, 2);
shapeless([I.DYE_RED, I.DYE_BLUE], I.DYE_PURPLE, 2);
shapeless([I.DYE_PURPLE, I.DYE_PINK], I.DYE_MAGENTA, 2);
shapeless([I.DYE_RED, I.DYE_BLUE, I.DYE_PINK], I.DYE_MAGENTA, 3);
shapeless([I.DYE_RED, I.DYE_BLUE, I.DYE_WHITE, I.DYE_WHITE], I.DYE_MAGENTA, 4);
// Terre cuite colorée : huit terres cuites autour d'une teinture
COLOR_NAMES.forEach((_, i) => {
  shaped(['###', '#D#', '###'], { '#': B.TERRACOTTA, D: I.DYE_WHITE + i }, B.TERRACOTTA_WHITE + i, 8);
});
// Laine teinte : une laine d'une autre couleur (la blanche en premier lieu) + une teinture
COLOR_NAMES.forEach((_, i) => {
  shapeless([WOOLS.filter((w) => w !== B.WOOL_WHITE + i), I.DYE_WHITE + i], B.WOOL_WHITE + i);
});

// ---------------------------------------------------------------------------
// Nourriture, papier, livres
// ---------------------------------------------------------------------------
shaped(['###'], { '#': I.WHEAT }, I.BREAD);
shapeless([B.SUGAR_CANE], I.SUGAR);
shaped(['###'], { '#': B.SUGAR_CANE }, I.PAPER, 3);
shapeless([I.PAPER, I.PAPER, I.PAPER, I.LEATHER], I.BOOK);
shapeless([B.PUMPKIN, I.SUGAR, I.EGG], I.PUMPKIN_PIE);
shapeless([B.RED_MUSHROOM, B.BROWN_MUSHROOM, I.BOWL], I.MUSHROOM_STEW);
shaped(['GGG', 'GAG', 'GGG'], { G: I.GOLD_INGOT, A: I.APPLE }, I.GOLDEN_APPLE);

// ---------------------------------------------------------------------------
// Recherche d'une recette
// ---------------------------------------------------------------------------
export function ingredientAccepts(ing: Ingredient, id: number): boolean {
  if (typeof ing === 'number') return ing === id;
  return id !== 0 && ing.includes(id);
}

/** Renvoie le premier identifiant d'objet représentatif d'un ingrédient (0 si vide). */
export function ingredientSampleId(ing: Ingredient): number {
  if (typeof ing === 'number') return ing;
  return ing[0] ?? 0;
}

/** Indique si la recette tient dans une grille de largeur et hauteur `gridW` (2 ou 3). */
export function recipeFitsGrid(recipe: Recipe, gridW: number): boolean {
  if (recipe.shaped) return recipe.w <= gridW && recipe.h <= gridW;
  return recipe.cells.length <= gridW * gridW;
}


/** Compare la zone utile de la grille au motif, à l'endroit ou en miroir horizontal. */
function matchesShaped(recipe: Recipe, cells: readonly number[], mirrored: boolean): boolean {
  const { w, h } = recipe;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ing = recipe.cells[y * w + (mirrored ? w - 1 - x : x)];
      if (!ingredientAccepts(ing, cells[y * w + x])) return false;
    }
  }
  return true;
}

/** Appariement de multi-ensembles avec retour arrière (les listes d'ingrédients peuvent se recouper). */
function matchesShapeless(ingredients: readonly Ingredient[], items: readonly number[]): boolean {
  if (ingredients.length !== items.length) return false;
  const used = new Array<boolean>(items.length).fill(false);
  const assign = (k: number): boolean => {
    if (k === ingredients.length) return true;
    for (let i = 0; i < items.length; i++) {
      if (used[i] || !ingredientAccepts(ingredients[k], items[i])) continue;
      used[i] = true;
      if (assign(k + 1)) return true;
      used[i] = false;
    }
    return false;
  };
  return assign(0);
}

/** grid : ids des objets (0 = vide), ligne par ligne ; gridW = 2 (inventaire) ou 3 (établi). */
export function matchRecipe(grid: readonly number[], gridW: number): { id: number; count: number } | null {
  if (gridW <= 0) return null;
  const gridH = Math.ceil(grid.length / gridW);
  const at = (x: number, y: number): number => {
    const id = grid[y * gridW + x];
    return id > 0 ? id : 0;
  };

  // Boîte englobante des cases occupées
  let x0 = gridW;
  let y0 = gridH;
  let x1 = -1;
  let y1 = -1;
  const items: number[] = [];
  for (let y = 0; y < gridH; y++) {
    for (let x = 0; x < gridW; x++) {
      const id = at(x, y);
      if (id === 0) continue;
      items.push(id);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (items.length === 0) return null;

  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const cells: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(at(x, y));

  for (const recipe of RECIPES) {
    const ok = recipe.shaped
      ? recipe.w === w && recipe.h === h && (matchesShaped(recipe, cells, false) || matchesShaped(recipe, cells, true))
      : matchesShapeless(recipe.cells, items);
    if (ok) return { id: recipe.result.id, count: recipe.result.count };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cuisson
// ---------------------------------------------------------------------------
const SMELTING = new Map<number, number>([
  [B.CLAY, B.TERRACOTTA],
  [B.NETHERRACK, I.NETHER_BRICK],
  [B.RED_SAND, B.GLASS],
  [B.IRON_ORE, I.IRON_INGOT],
  [B.GOLD_ORE, I.GOLD_INGOT],
  [B.COAL_ORE, I.COAL],
  [B.DIAMOND_ORE, I.DIAMOND],
  [B.REDSTONE_ORE, I.REDSTONE],
  [B.LAPIS_ORE, I.LAPIS],
  [B.EMERALD_ORE, I.EMERALD],
  [B.SAND, B.GLASS],
  [B.COBBLESTONE, B.STONE],
  [B.STONE, B.SMOOTH_STONE],
  [B.STONE_BRICKS, B.CRACKED_STONE_BRICKS],
  [B.CACTUS, I.DYE_GREEN],
  [I.RAW_PORKCHOP, I.COOKED_PORKCHOP],
  [I.RAW_BEEF, I.STEAK],
  [I.RAW_CHICKEN, I.COOKED_CHICKEN],
  [I.RAW_MUTTON, I.COOKED_MUTTON],
  [I.RAW_FISH, I.COOKED_FISH],
  [I.POTATO, I.BAKED_POTATO],
  [I.CLAY_BALL, I.BRICK],
]);
for (const log of LOGS) SMELTING.set(log, I.CHARCOAL);

export function smeltingResult(id: number): { id: number; count: number } | null {
  const out = SMELTING.get(id);
  return out === undefined ? null : { id: out, count: 1 };
}

// ---------------------------------------------------------------------------
// Combustibles
// ---------------------------------------------------------------------------
const FUEL = new Uint16Array(ITEM_ID_LIMIT);
function fuel(ticks: number, ...ids: Array<number | readonly number[]>): void {
  for (const entry of ids) {
    if (typeof entry === 'number') FUEL[entry] = ticks;
    else for (const id of entry) FUEL[id] = ticks;
  }
}
fuel(20000, I.LAVA_BUCKET);
fuel(16000, B.COAL_BLOCK);
fuel(1600, I.COAL, I.CHARCOAL);
fuel(
  300,
  LOGS, PLANKS, WOOD_SLABS, WOOD_STAIRS,
  B.OAK_FENCE, B.FENCE_GATE, B.TRAPDOOR, B.OAK_DOOR, B.CRAFTING_TABLE, B.CHEST, B.BOOKSHELF, B.LADDER, I.BOW, I.FISHING_ROD,
);
fuel(200, I.WOODEN_PICKAXE, I.WOODEN_AXE, I.WOODEN_SHOVEL, I.WOODEN_SWORD, I.WOODEN_HOE);
fuel(100, I.STICK, SAPLINGS, WOOLS);

/** Durée de combustion en ticks (0 = pas un combustible). */
export function fuelTicks(id: number): number {
  return FUEL[id] ?? 0;
}
