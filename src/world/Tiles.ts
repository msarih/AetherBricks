/**
 * Registre des tuiles de texture (16×16). L'index d'une tuile est sa couche dans la
 * texture-tableau du GPU. Module pur (pas de DOM) : partagé avec les workers.
 */
import { COLOR_NAMES } from './Ids';

const TOOL_MATERIALS = ['wooden', 'stone', 'iron', 'golden', 'diamond'] as const;
const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'] as const;
const ARMOR_MATERIALS = ['leather', 'iron', 'golden', 'diamond'] as const;
const ARMOR_KINDS = ['helmet', 'chestplate', 'leggings', 'boots'] as const;

const BASE_TILES = [
  // --- Terrain ---
  'stone', 'granite', 'diorite', 'andesite', 'cobblestone', 'mossy_cobblestone', 'bedrock', 'dirt',
  'grass_top', 'grass_side', 'grass_side_overlay', 'grass_side_snowed', 'snow', 'ice', 'sand', 'gravel',
  'clay', 'sandstone_top', 'sandstone_side', 'sandstone_bottom', 'obsidian', 'glowstone', 'netherrack', 'sponge',
  // --- Minerais ---
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore',
  'coal_block', 'iron_block', 'gold_block', 'diamond_block', 'lapis_block', 'emerald_block', 'redstone_block',
  // --- Bois ---
  'oak_log', 'oak_log_top', 'spruce_log', 'spruce_log_top', 'birch_log', 'birch_log_top',
  'jungle_log', 'jungle_log_top', 'acacia_log', 'acacia_log_top',
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks',
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves',
  'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling',
  // --- Construction ---
  'glass', 'bricks', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'smooth_stone',
  'smooth_stone_slab_side', 'bookshelf', 'quartz_block', 'tnt_side', 'tnt_top', 'tnt_bottom',
  'crafting_table_top', 'crafting_table_side', 'crafting_table_front',
  'furnace_top', 'furnace_side', 'furnace_front', 'furnace_front_on',
  'chest_top', 'chest_side', 'chest_front',
  'bed_head_top', 'bed_foot_top', 'bed_head_side', 'bed_foot_side', 'bed_head_end', 'bed_foot_end',
  'oak_door_top', 'oak_door_bottom', 'iron_door_top', 'iron_door_bottom', 'trapdoor', 'ladder', 'torch',
  'glass_pane_top', 'iron_bars', 'spawner',
  // --- Végétation ---
  'tall_grass', 'fern', 'dead_bush', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
  'brown_mushroom', 'red_mushroom', 'sugar_cane', 'cactus_side', 'cactus_top', 'cactus_bottom',
  'pumpkin_side', 'pumpkin_top', 'pumpkin_face', 'jack_o_lantern', 'melon_side', 'melon_top',
  'wheat_0', 'wheat_1', 'wheat_2', 'wheat_3', 'wheat_4', 'wheat_5', 'wheat_6', 'wheat_7',
  'carrots_0', 'carrots_1', 'carrots_2', 'carrots_3', 'potatoes_0', 'potatoes_1', 'potatoes_2', 'potatoes_3',
  'farmland_dry', 'farmland_wet', 'lily_pad', 'vine', 'cobweb', 'hay_side', 'hay_top',
  // --- Fluides et feu (animés) ---
  'water', 'lava', 'fire',
  // --- Fissures de minage ---
  'destroy_0', 'destroy_1', 'destroy_2', 'destroy_3', 'destroy_4',
  'destroy_5', 'destroy_6', 'destroy_7', 'destroy_8', 'destroy_9',
  // --- Particules ---
  'particle_smoke', 'particle_flame', 'particle_bubble', 'particle_heart', 'particle_splash',
  'particle_crit', 'particle_lava', 'particle_snow', 'particle_rain', 'particle_explosion',
  // --- Objets ---
  'stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'lapis', 'redstone', 'flint',
  'wheat_seeds', 'wheat', 'bread', 'apple', 'golden_apple', 'raw_porkchop', 'cooked_porkchop',
  'raw_beef', 'steak', 'raw_chicken', 'cooked_chicken', 'raw_mutton', 'cooked_mutton', 'rotten_flesh',
  'bone', 'bone_meal', 'string', 'feather', 'gunpowder', 'leather', 'egg', 'arrow', 'bow',
  'bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2',
  'flint_and_steel', 'shears', 'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket',
  'sugar', 'paper', 'book', 'clay_ball', 'brick', 'snowball', 'melon_slice', 'spider_eye',
  'carrot', 'potato', 'baked_potato', 'glowstone_dust', 'quartz', 'cookie', 'pumpkin_pie',
  'mushroom_stew', 'bowl', 'fishing_rod', 'fishing_rod_cast', 'raw_fish', 'cooked_fish',
  'door_item', 'iron_door_item', 'bed_item', 'sugar_cane_item',
] as const;

type BaseTile = (typeof BASE_TILES)[number];
type WoolTile = `wool_${(typeof COLOR_NAMES)[number]}`;
type DyeTile = `dye_${(typeof COLOR_NAMES)[number]}`;
type ToolTile = `${(typeof TOOL_MATERIALS)[number]}_${(typeof TOOL_KINDS)[number]}`;
type ArmorTile = `${(typeof ARMOR_MATERIALS)[number]}_${(typeof ARMOR_KINDS)[number]}`;

export type TileName = BaseTile | WoolTile | DyeTile | ToolTile | ArmorTile;

function buildTileNames(): TileName[] {
  const names: TileName[] = [...BASE_TILES];
  for (const c of COLOR_NAMES) names.push(`wool_${c}`);
  for (const c of COLOR_NAMES) names.push(`dye_${c}`);
  for (const m of TOOL_MATERIALS) for (const k of TOOL_KINDS) names.push(`${m}_${k}`);
  for (const m of ARMOR_MATERIALS) for (const k of ARMOR_KINDS) names.push(`${m}_${k}`);
  return names;
}

export const TILE_NAMES: readonly TileName[] = buildTileNames();
export const TILE_COUNT = TILE_NAMES.length;

/** Table nom → index de couche. */
export const T = (() => {
  const map = {} as Record<TileName, number>;
  TILE_NAMES.forEach((name, i) => {
    map[name] = i;
  });
  return map;
})();

export const TILE_SIZE = 16;
export { TOOL_MATERIALS, TOOL_KINDS, ARMOR_MATERIALS, ARMOR_KINDS };
