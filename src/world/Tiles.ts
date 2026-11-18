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
  'clay', 'red_sand', 'terracotta', 'sandstone_top', 'sandstone_side', 'sandstone_bottom', 'obsidian', 'glowstone', 'netherrack', 'sponge',
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
  'enchanting_table_top', 'enchanting_table_side', 'enchanting_table_bottom',
  'anvil_top', 'anvil_side', 'cauldron_top', 'cauldron_side', 'cauldron_bottom',
  'bed_head_top', 'bed_foot_top', 'bed_head_side', 'bed_foot_side', 'bed_head_end', 'bed_foot_end',
  'oak_door_top', 'oak_door_bottom', 'iron_door_top', 'iron_door_bottom', 'trapdoor', 'ladder', 'torch',
  'glass_pane_top', 'iron_bars', 'spawner', 'rail',
  'redstone_dust', 'redstone_torch_on', 'redstone_torch_off',
  'piston_top', 'piston_top_sticky', 'piston_side', 'piston_bottom', 'piston_inner',
  'redstone_lamp_off', 'redstone_lamp_on',
  'nether_portal', 'nether_quartz_ore', 'nether_bricks', 'soul_sand', 'nether_wart_0', 'nether_wart_1', 'nether_wart_2',
  // --- Végétation ---
  'tall_grass', 'fern', 'dead_bush', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
  'brown_mushroom', 'red_mushroom', 'sugar_cane', 'cactus_side', 'cactus_top', 'cactus_bottom',
  'pumpkin_side', 'pumpkin_top', 'pumpkin_face', 'jack_o_lantern', 'melon_side', 'melon_top',
  'wheat_0', 'wheat_1', 'wheat_2', 'wheat_3', 'wheat_4', 'wheat_5', 'wheat_6', 'wheat_7',
  'carrots_0', 'carrots_1', 'carrots_2', 'carrots_3', 'potatoes_0', 'potatoes_1', 'potatoes_2', 'potatoes_3',
  'farmland_dry', 'farmland_wet', 'grass_path_top', 'grass_path_side', 'lily_pad', 'vine', 'cobweb', 'hay_side', 'hay_top',
  // --- Fluides et feu (animés) ---
  'water', 'lava', 'fire',
  // --- Fissures de minage ---
  'destroy_0', 'destroy_1', 'destroy_2', 'destroy_3', 'destroy_4',
  'destroy_5', 'destroy_6', 'destroy_7', 'destroy_8', 'destroy_9',
  // --- Particules ---
  'particle_smoke', 'particle_flame', 'particle_bubble', 'particle_heart', 'particle_splash',
  'particle_crit', 'particle_lava', 'particle_snow', 'particle_rain', 'particle_explosion',
  // --- Objets ---
  'stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'gold_nugget', 'magma_cream', 'diamond', 'emerald', 'lapis', 'redstone', 'flint',
  'wheat_seeds', 'wheat', 'bread', 'apple', 'golden_apple', 'raw_porkchop', 'cooked_porkchop',
  'raw_beef', 'steak', 'raw_chicken', 'cooked_chicken', 'raw_mutton', 'cooked_mutton', 'rotten_flesh',
  'bone', 'bone_meal', 'string', 'feather', 'gunpowder', 'leather', 'egg', 'arrow', 'bow',
  'bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2',
  'flint_and_steel', 'shears', 'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket',
  'sugar', 'paper', 'book', 'clay_ball', 'brick', 'snowball', 'melon_slice', 'spider_eye',
  'carrot', 'potato', 'baked_potato', 'glowstone_dust', 'quartz', 'cookie', 'pumpkin_pie',
  'mushroom_stew', 'bowl', 'fishing_rod', 'fishing_rod_cast', 'raw_fish', 'cooked_fish',
  'door_item', 'iron_door_item', 'bed_item', 'sugar_cane_item',
  'map', 'filled_map', 'sign', 'nether_brick', 'nether_wart', 'blaze_rod',
  'slime_ball', 'ender_pearl', 'saddle', 'lead', 'name_tag', 'splash_potion',
  // --- L'End ---
  'end_stone', 'end_portal_frame_top', 'end_portal_frame_side', 'end_portal_eye', 'end_portal', 'dragon_egg',
  'blaze_powder', 'ender_eye', 'shield', 'glass_bottle', 'potion',
] as const;

/** Images animées de la boussole et de l'horloge (aiguille, cadran), 32 chacune. */
export const DIAL_FRAMES = 32;
const FRAME_IDS = [
  '00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15',
  '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31',
] as const;

type BaseTile = (typeof BASE_TILES)[number];
type WoolTile = `wool_${(typeof COLOR_NAMES)[number]}`;
type DyeTile = `dye_${(typeof COLOR_NAMES)[number]}`;
type TerracottaTile = `terracotta_${(typeof COLOR_NAMES)[number]}`;
type ToolTile = `${(typeof TOOL_MATERIALS)[number]}_${(typeof TOOL_KINDS)[number]}`;
type ArmorTile = `${(typeof ARMOR_MATERIALS)[number]}_${(typeof ARMOR_KINDS)[number]}`;
type DialTile = `${'compass' | 'clock'}_${(typeof FRAME_IDS)[number]}`;

export type TileName = BaseTile | WoolTile | DyeTile | TerracottaTile | ToolTile | ArmorTile | DialTile;

function buildTileNames(): TileName[] {
  const names: TileName[] = [...BASE_TILES];
  for (const c of COLOR_NAMES) names.push(`wool_${c}`);
  for (const c of COLOR_NAMES) names.push(`dye_${c}`);
  for (const m of TOOL_MATERIALS) for (const k of TOOL_KINDS) names.push(`${m}_${k}`);
  for (const m of ARMOR_MATERIALS) for (const k of ARMOR_KINDS) names.push(`${m}_${k}`);
  for (const f of FRAME_IDS) names.push(`compass_${f}`);
  for (const f of FRAME_IDS) names.push(`clock_${f}`);
  // ajoutées en fin de liste : les couches existantes gardent leur index
  for (const c of COLOR_NAMES) names.push(`terracotta_${c}`);
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

/** Tuile de l'image `frame` (0..31) de la boussole ou de l'horloge. */
export function dialTile(kind: 'compass' | 'clock', frame: number): number {
  const f = ((Math.floor(frame) % DIAL_FRAMES) + DIAL_FRAMES) % DIAL_FRAMES;
  return T[`${kind}_${FRAME_IDS[f]}`];
}
export { TOOL_MATERIALS, TOOL_KINDS, ARMOR_MATERIALS, ARMOR_KINDS };
