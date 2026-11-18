/**
 * Registre des blocs : apparence, physique, lumière, minage.
 * Module pur (pas de DOM ni de Three.js) : partagé avec les workers.
 */
import { B, BLOCK_ID_LIMIT, COLOR_LABELS_FR, COLOR_NAMES } from './Ids';
import { T, type TileName } from './Tiles';
import { FACE_DOWN, FACE_EAST, FACE_NORTH, FACE_SOUTH, FACE_UP, FACE_WEST } from './Constants';

/** Formes géométriques connues du mailleur. */
export const SHAPE = {
  NONE: 0, // air
  CUBE: 1, // cube plein
  CROSS: 2, // deux plans en croix (plantes)
  CROP: 3, // quatre plans en dièse (cultures)
  FLUID: 4, // eau / lave
  SLAB: 5,
  STAIRS: 6,
  FENCE: 7,
  FENCE_GATE: 8,
  DOOR: 9,
  TRAPDOOR: 10,
  LADDER: 11, // plan plaqué contre un mur
  TORCH: 12,
  PANE: 13, // vitre / barreaux
  BED: 14,
  CHEST: 15,
  CACTUS: 16,
  FARMLAND: 17,
  SNOW_LAYER: 18,
  LILY_PAD: 19,
  VINE: 20,
  FIRE: 21,
  REDSTONE_WIRE: 22,
  LEVER: 23,
  BUTTON: 24,
  PRESSURE_PLATE: 25,
  PISTON_HEAD: 26,
  PORTAL: 27,
  /** Panneau : rien dans le maillage des chunks, dessiné à part avec son texte (render/SignRenderer). */
  SIGN: 28,
  /** Rail : plan posé au sol, tourné selon la méta. */
  RAIL: 29,
  /** Cadre du portail de l'End : socle de 13/16, plus l'œil si la méta porte le bit 4. */
  END_FRAME: 30,
  /** Portail de l'End : nappe horizontale aux trois quarts de la cellule, sans collision. */
  END_PORTAL: 31,
  /** Œuf de dragon : empilement de boîtes arrondi. */
  DRAGON_EGG: 32,
  /** Chaudron : cuve creuse en fer pouvant contenir 0 à 3 niveaux d'eau. */
  CAULDRON: 33,
  /** Gâteau : posé sur un bloc, 7 parts (méta 0..6). */
  CAKE: 34,
  /** Alambic : socle et tige porte-fioles. */
  BREWING_STAND: 35,
  /** Répéteur de redstone : dalle 2/16 orientée avec torches et verrou éventuel. */
  REPEATER: 36,
  /** Comparateur de redstone : dalle 2/16 orientée avec trois torches. */
  COMPARATOR: 37,
  /** Entonnoir : cuve et cône de transfert. */
  HOPPER: 38,
  /** Capteur de lumière du jour : dalle 6/16. */
  DAYLIGHT_DETECTOR: 39,
} as const;

export const TINT = { NONE: 0, GRASS: 1, FOLIAGE: 2, FIXED: 3 } as const;

/** Orientation des textures selon la méta-donnée. */
export const ROT = { NONE: 0, AXIS: 1, FACING: 2 } as const;

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe' | 'shears';
export type SoundGroup = 'stone' | 'wood' | 'grass' | 'gravel' | 'sand' | 'cloth' | 'glass' | 'snow' | 'metal';

export interface BlockDef {
  id: number;
  /** Nom technique (anglais, snake_case). */
  name: string;
  /** Nom affiché (français). */
  label: string;
  shape: number;
  /** Tuiles par face : [haut, bas, nord, sud, ouest, est]. */
  tiles: number[];
  /** Tuile « avant » pour les blocs orientés (fourneau, citrouille…). */
  frontTile: number;
  /** Couche d'overlay teintée sur les côtés (frange d'herbe), 0 = aucune. */
  sideOverlay: number;
  rot: number;
  tint: number;
  tintColor: number;
  /** Collision avec les entités. */
  solid: boolean;
  /** Cube plein opaque : masque les faces voisines et arrête la lumière. */
  opaque: boolean;
  /** Atténuation de la lumière traversante (0..15). */
  lightOpacity: number;
  /** Lumière émise (0..15). */
  emit: number;
  /** Rendu dans la passe translucide (eau, glace). */
  translucent: boolean;
  /** Dureté Minecraft ; -1 = incassable. */
  hardness: number;
  /** Résistance aux explosions. */
  blastResistance: number;
  tool: ToolKind | null;
  /** Niveau d'outil minimal pour récolter (0 = main, 1 = bois, 2 = pierre, 3 = fer, 4 = diamant). */
  harvestTier: number;
  sound: SoundGroup;
  /** Peut être remplacé directement par une pose de bloc (herbe haute, eau…). */
  replaceable: boolean;
  /** Inflammabilité (0 = ne brûle pas). */
  flammable: number;
  climbable: boolean;
  /** Reçoit des « random ticks ». */
  randomTicks: boolean;
  /** Bloc soumis à la gravité (sable, gravier). */
  gravity: boolean;
  /** Doit reposer sur un bloc solide (plantes, torches…) : cassé si le support disparaît. */
  needsSupport: boolean;
  /** Tuile utilisée comme icône plate dans l'inventaire (sinon rendu 3D du bloc). */
  itemTile: number;
  /** Le bloc existe-t-il comme objet d'inventaire ? */
  hasItem: boolean;
  /** Taille maximale d'une pile. */
  stack: number;
  /** Catégorie de l'inventaire créatif. */
  category: 'construction' | 'nature' | 'decoration' | 'utilitaire' | 'aucune';
}

type TilesSpec =
  | TileName
  | { all?: TileName; top?: TileName; bottom?: TileName; side?: TileName; front?: TileName; end?: TileName; overlay?: TileName };

interface BlockOptions extends Partial<Omit<BlockDef, 'id' | 'name' | 'label' | 'tiles' | 'itemTile' | 'frontTile' | 'sideOverlay'>> {
  tiles: TilesSpec;
  itemTile?: TileName;
}

export const BLOCKS: BlockDef[] = [];

// Tables rapides indexées par identifiant de bloc (boucles chaudes : lumière, maillage, collisions)
export const BLOCK_SHAPE = new Uint8Array(BLOCK_ID_LIMIT);
export const BLOCK_OPAQUE = new Uint8Array(BLOCK_ID_LIMIT);
export const BLOCK_SOLID = new Uint8Array(BLOCK_ID_LIMIT);
export const BLOCK_LIGHT_OPACITY = new Uint8Array(BLOCK_ID_LIMIT);
export const BLOCK_EMIT = new Uint8Array(BLOCK_ID_LIMIT);
export const BLOCK_TRANSLUCENT = new Uint8Array(BLOCK_ID_LIMIT);
export const BLOCK_REPLACEABLE = new Uint8Array(BLOCK_ID_LIMIT);
/** Le bloc projette de l'occlusion ambiante (cubes opaques et feuillages). */
export const BLOCK_AO = new Uint8Array(BLOCK_ID_LIMIT);
/** Bloc non cubique opaque à la lumière : rendu avec la lumière de ses voisins (dalles, escaliers…). */
export const BLOCK_NEIGHBOR_LIGHT = new Uint8Array(BLOCK_ID_LIMIT);
export const BLOCK_RANDOM_TICKS = new Uint8Array(BLOCK_ID_LIMIT);
/** Tuile par face pour les blocs sans rotation : index = id * 6 + face. */
export const BLOCK_TILES = new Uint16Array(BLOCK_ID_LIMIT * 6);

function reg(id: number, name: string, label: string, o: BlockOptions): void {
  const spec = typeof o.tiles === 'string' ? { all: o.tiles } : o.tiles;
  const side = spec.side ?? spec.all ?? 'stone';
  const top = spec.top ?? spec.end ?? spec.all ?? side;
  const bottom = spec.bottom ?? spec.end ?? spec.all ?? top;
  const shape = o.shape ?? SHAPE.CUBE;
  const isCube = shape === SHAPE.CUBE;
  const opaque = o.opaque ?? isCube;
  const def: BlockDef = {
    id,
    name,
    label,
    shape,
    tiles: [T[top], T[bottom], T[side], T[side], T[side], T[side]],
    frontTile: spec.front ? T[spec.front] : T[side],
    sideOverlay: spec.overlay ? T[spec.overlay] : 0,
    rot: o.rot ?? ROT.NONE,
    tint: o.tint ?? TINT.NONE,
    tintColor: o.tintColor ?? 0xffffff,
    solid: o.solid ?? true,
    opaque,
    lightOpacity: o.lightOpacity ?? (opaque ? 15 : 0),
    emit: o.emit ?? 0,
    translucent: o.translucent ?? false,
    hardness: o.hardness ?? 1,
    blastResistance: o.blastResistance ?? (o.hardness ?? 1) * 3,
    tool: o.tool ?? null,
    harvestTier: o.harvestTier ?? 0,
    sound: o.sound ?? 'stone',
    replaceable: o.replaceable ?? false,
    flammable: o.flammable ?? 0,
    climbable: o.climbable ?? false,
    randomTicks: o.randomTicks ?? false,
    gravity: o.gravity ?? false,
    needsSupport: o.needsSupport ?? false,
    itemTile: o.itemTile ? T[o.itemTile] : -1,
    hasItem: o.hasItem ?? true,
    stack: o.stack ?? 64,
    category: o.category ?? 'construction',
  };
  BLOCKS[id] = def;
  BLOCK_SHAPE[id] = def.shape;
  BLOCK_OPAQUE[id] = def.opaque ? 1 : 0;
  BLOCK_SOLID[id] = def.solid ? 1 : 0;
  BLOCK_LIGHT_OPACITY[id] = def.lightOpacity;
  BLOCK_EMIT[id] = def.emit;
  BLOCK_TRANSLUCENT[id] = def.translucent ? 1 : 0;
  BLOCK_REPLACEABLE[id] = def.replaceable ? 1 : 0;
  BLOCK_RANDOM_TICKS[id] = def.randomTicks ? 1 : 0;
  for (let f = 0; f < 6; f++) BLOCK_TILES[id * 6 + f] = def.tiles[f];
}

// --- Air ---
reg(B.AIR, 'air', 'Air', {
  tiles: 'stone', shape: SHAPE.NONE, solid: false, opaque: false, hardness: 0, replaceable: true, hasItem: false, category: 'aucune',
});

/** Couleurs accordées au féminin (« terre cuite blanche »). */
const COLOR_LABELS_FEM = [
  'blanche', 'orange', 'magenta', 'bleu clair', 'jaune', 'vert clair', 'rose', 'grise',
  'gris clair', 'cyan', 'violette', 'bleue', 'marron', 'verte', 'rouge', 'noire',
];

// --- Terrain ---
const rock = { tool: 'pickaxe' as const, harvestTier: 1, sound: 'stone' as const };
reg(B.STONE, 'stone', 'Pierre', { tiles: 'stone', hardness: 1.5, blastResistance: 30, ...rock });
reg(B.GRASS, 'grass_block', "Bloc d'herbe", {
  tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side', overlay: 'grass_side_overlay' },
  tint: TINT.GRASS, hardness: 0.6, tool: 'shovel', sound: 'grass', randomTicks: true, category: 'nature',
});
reg(B.DIRT, 'dirt', 'Terre', { tiles: 'dirt', hardness: 0.5, tool: 'shovel', sound: 'gravel', category: 'nature' });
reg(B.COBBLESTONE, 'cobblestone', 'Pierres', { tiles: 'cobblestone', hardness: 2, blastResistance: 30, ...rock });
reg(B.BEDROCK, 'bedrock', 'Bedrock', { tiles: 'bedrock', hardness: -1, blastResistance: 1e7, category: 'nature' });
reg(B.SAND, 'sand', 'Sable', { tiles: 'sand', hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true, category: 'nature' });
reg(B.GRAVEL, 'gravel', 'Gravier', { tiles: 'gravel', hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true, category: 'nature' });
reg(B.CLAY, 'clay', "Bloc d'argile", { tiles: 'clay', hardness: 0.6, tool: 'shovel', sound: 'gravel', category: 'nature' });
reg(B.RED_SAND, 'red_sand', 'Sable rouge', { tiles: 'red_sand', hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true, category: 'nature' });
reg(B.TERRACOTTA, 'terracotta', 'Terre cuite', { tiles: 'terracotta', hardness: 1.25, blastResistance: 21, ...rock, category: 'nature' });
COLOR_NAMES.forEach((c, i) => {
  reg(B.TERRACOTTA_WHITE + i, `${c}_terracotta`, `Terre cuite ${COLOR_LABELS_FEM[i]}`, {
    tiles: `terracotta_${c}`, hardness: 1.25, blastResistance: 21, ...rock, category: 'decoration',
  });
});
reg(B.SANDSTONE, 'sandstone', 'Grès', {
  tiles: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, hardness: 0.8, ...rock,
});
reg(B.GRANITE, 'granite', 'Granite', { tiles: 'granite', hardness: 1.5, blastResistance: 30, ...rock });
reg(B.DIORITE, 'diorite', 'Diorite', { tiles: 'diorite', hardness: 1.5, blastResistance: 30, ...rock });
reg(B.ANDESITE, 'andesite', 'Andésite', { tiles: 'andesite', hardness: 1.5, blastResistance: 30, ...rock });
reg(B.MOSSY_COBBLESTONE, 'mossy_cobblestone', 'Pierres moussues', { tiles: 'mossy_cobblestone', hardness: 2, blastResistance: 30, ...rock });
reg(B.OBSIDIAN, 'obsidian', 'Obsidienne', { tiles: 'obsidian', hardness: 50, blastResistance: 6000, tool: 'pickaxe', harvestTier: 4 });
reg(B.SNOW_BLOCK, 'snow_block', 'Bloc de neige', { tiles: 'snow', hardness: 0.2, tool: 'shovel', harvestTier: 1, sound: 'snow', category: 'nature' });
reg(B.ICE, 'ice', 'Glace', {
  tiles: 'ice', hardness: 0.5, tool: 'pickaxe', sound: 'glass', opaque: false, lightOpacity: 2, translucent: true,
  randomTicks: true, category: 'nature',
});
reg(B.SNOW_LAYER, 'snow', 'Neige', {
  tiles: 'snow', shape: SHAPE.SNOW_LAYER, solid: false, hardness: 0.1, tool: 'shovel', harvestTier: 1, sound: 'snow',
  replaceable: true, needsSupport: true, randomTicks: true, category: 'nature',
});
reg(B.WATER, 'water', 'Eau', {
  tiles: 'water', shape: SHAPE.FLUID, solid: false, lightOpacity: 2, translucent: true, hardness: 100, blastResistance: 500,
  replaceable: true, hasItem: false, category: 'aucune',
});
reg(B.LAVA, 'lava', 'Lave', {
  tiles: 'lava', shape: SHAPE.FLUID, solid: false, lightOpacity: 0, emit: 15, hardness: 100, blastResistance: 500,
  replaceable: true, hasItem: false, randomTicks: true, category: 'aucune',
});

// --- Minerais ---
const oreBlock = (tier: number) => ({ hardness: 3, blastResistance: 15, tool: 'pickaxe' as const, harvestTier: tier, category: 'nature' as const });
reg(B.COAL_ORE, 'coal_ore', 'Minerai de charbon', { tiles: 'coal_ore', ...oreBlock(1) });
reg(B.IRON_ORE, 'iron_ore', 'Minerai de fer', { tiles: 'iron_ore', ...oreBlock(2) });
reg(B.GOLD_ORE, 'gold_ore', "Minerai d'or", { tiles: 'gold_ore', ...oreBlock(3) });
reg(B.DIAMOND_ORE, 'diamond_ore', 'Minerai de diamant', { tiles: 'diamond_ore', ...oreBlock(3) });
reg(B.REDSTONE_ORE, 'redstone_ore', 'Minerai de redstone', { tiles: 'redstone_ore', ...oreBlock(3) });
reg(B.LAPIS_ORE, 'lapis_ore', 'Minerai de lapis-lazuli', { tiles: 'lapis_ore', ...oreBlock(2) });
reg(B.EMERALD_ORE, 'emerald_ore', "Minerai d'émeraude", { tiles: 'emerald_ore', ...oreBlock(3) });

const metal = (tier: number, hardness = 5) => ({
  hardness, blastResistance: 30, tool: 'pickaxe' as const, harvestTier: tier, sound: 'metal' as const,
});
reg(B.COAL_BLOCK, 'coal_block', 'Bloc de charbon', { tiles: 'coal_block', ...metal(1), sound: 'stone', flammable: 5 });
reg(B.IRON_BLOCK, 'iron_block', 'Bloc de fer', { tiles: 'iron_block', ...metal(2) });
reg(B.GOLD_BLOCK, 'gold_block', "Bloc d'or", { tiles: 'gold_block', ...metal(3, 3) });
reg(B.DIAMOND_BLOCK, 'diamond_block', 'Bloc de diamant', { tiles: 'diamond_block', ...metal(3) });
reg(B.LAPIS_BLOCK, 'lapis_block', 'Bloc de lapis-lazuli', { tiles: 'lapis_block', ...metal(2, 3), sound: 'stone' });
reg(B.EMERALD_BLOCK, 'emerald_block', "Bloc d'émeraude", { tiles: 'emerald_block', ...metal(3) });
reg(B.REDSTONE_BLOCK, 'redstone_block', 'Bloc de redstone', { tiles: 'redstone_block', ...metal(1) });

// --- Bois ---
const WOOD_NAMES = ['oak', 'spruce', 'birch', 'jungle', 'acacia'] as const;
const WOOD_LABELS = ['chêne', 'sapin', 'bouleau', 'acajou', 'acacia'];
const WOOD_LABELS_DE = ['de chêne', 'de sapin', 'de bouleau', "d'acajou", "d'acacia"];
const wood = { tool: 'axe' as const, sound: 'wood' as const };
WOOD_NAMES.forEach((w, i) => {
  reg(B.OAK_LOG + i, `${w}_log`, `Bûche ${WOOD_LABELS_DE[i]}`, {
    tiles: { side: `${w}_log`, end: `${w}_log_top` }, rot: ROT.AXIS, hardness: 2, flammable: 5, ...wood, category: 'nature',
  });
  reg(B.OAK_PLANKS + i, `${w}_planks`, `Planches ${WOOD_LABELS_DE[i]}`, {
    tiles: `${w}_planks`, hardness: 2, blastResistance: 15, flammable: 20, ...wood,
  });
  reg(B.OAK_LEAVES + i, `${w}_leaves`, `Feuilles ${WOOD_LABELS_DE[i]}`, {
    tiles: `${w}_leaves`, opaque: false, lightOpacity: 1, hardness: 0.2, tool: 'shears', sound: 'grass', flammable: 60,
    tint: w === 'spruce' || w === 'birch' ? TINT.FIXED : TINT.FOLIAGE,
    tintColor: w === 'spruce' ? 0x619961 : w === 'birch' ? 0x80a755 : 0xffffff,
    randomTicks: true, category: 'nature',
  });
  reg(B.OAK_SAPLING + i, `${w}_sapling`, `Pousse ${WOOD_LABELS_DE[i]}`, {
    tiles: `${w}_sapling`, shape: SHAPE.CROSS, solid: false, hardness: 0, sound: 'grass', needsSupport: true,
    randomTicks: true, itemTile: `${w}_sapling`, category: 'nature',
  });
});

// --- Construction ---
reg(B.GLASS, 'glass', 'Verre', { tiles: 'glass', opaque: false, hardness: 0.3, sound: 'glass' });
reg(B.BRICKS, 'bricks', 'Briques', { tiles: 'bricks', hardness: 2, blastResistance: 30, ...rock });
reg(B.STONE_BRICKS, 'stone_bricks', 'Pierre taillée', { tiles: 'stone_bricks', hardness: 1.5, blastResistance: 30, ...rock });
reg(B.MOSSY_STONE_BRICKS, 'mossy_stone_bricks', 'Pierre taillée moussue', { tiles: 'mossy_stone_bricks', hardness: 1.5, blastResistance: 30, ...rock });
reg(B.CRACKED_STONE_BRICKS, 'cracked_stone_bricks', 'Pierre taillée craquelée', { tiles: 'cracked_stone_bricks', hardness: 1.5, blastResistance: 30, ...rock });
reg(B.SMOOTH_STONE, 'smooth_stone', 'Pierre lisse', { tiles: 'smooth_stone', hardness: 2, blastResistance: 30, ...rock });
reg(B.BOOKSHELF, 'bookshelf', 'Bibliothèque', {
  tiles: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, flammable: 20, ...wood, category: 'decoration',
});
reg(B.QUARTZ_BLOCK, 'quartz_block', 'Bloc de quartz', { tiles: 'quartz_block', hardness: 0.8, ...rock });
reg(B.GLOWSTONE, 'glowstone', 'Pierre lumineuse', { tiles: 'glowstone', hardness: 0.3, sound: 'glass', emit: 15, category: 'decoration' });
reg(B.TNT, 'tnt', 'TNT', {
  tiles: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, sound: 'grass', flammable: 100, category: 'utilitaire',
});
COLOR_NAMES.forEach((c, i) => {
  reg(B.WOOL_WHITE + i, `${c}_wool`, `Laine ${COLOR_LABELS_FR[i]}`, {
    tiles: `wool_${c}`, hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: 30, category: 'decoration',
  });
});

// --- Blocs utilitaires ---
reg(B.CRAFTING_TABLE, 'crafting_table', 'Établi', {
  tiles: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' },
  rot: ROT.FACING, hardness: 2.5, ...wood, category: 'utilitaire',
});
reg(B.FURNACE, 'furnace', 'Fourneau', {
  tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' },
  rot: ROT.FACING, hardness: 3.5, ...rock, category: 'utilitaire',
});
reg(B.FURNACE_LIT, 'lit_furnace', 'Fourneau allumé', {
  tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' },
  rot: ROT.FACING, hardness: 3.5, emit: 13, ...rock, hasItem: false, category: 'aucune',
});
reg(B.CHEST, 'chest', 'Coffre', {
  tiles: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' },
  shape: SHAPE.CHEST, rot: ROT.FACING, opaque: false, hardness: 2.5, ...wood, category: 'utilitaire',
});
reg(B.ENCHANTING_TABLE, 'enchanting_table', 'Table d\'enchantement', {
  tiles: { top: 'enchanting_table_top', bottom: 'enchanting_table_bottom', side: 'enchanting_table_side' },
  hardness: 5, ...rock, harvestTier: 1, category: 'utilitaire',
});
reg(B.ANVIL, 'anvil', 'Enclume', {
  tiles: { top: 'anvil_top', bottom: 'anvil_side', side: 'anvil_side' },
  hardness: 5, ...rock, harvestTier: 1, category: 'utilitaire',
});
reg(B.BED, 'bed', 'Lit', {
  tiles: { top: 'bed_head_top', bottom: 'oak_planks', side: 'bed_head_side' }, shape: SHAPE.BED, opaque: false,
  hardness: 0.2, sound: 'wood', itemTile: 'bed_item', stack: 1, category: 'utilitaire',
});
reg(B.OAK_DOOR, 'oak_door', 'Porte en bois', {
  tiles: { all: 'oak_door_bottom', top: 'oak_door_top' }, shape: SHAPE.DOOR, opaque: false, hardness: 3, ...wood,
  itemTile: 'door_item', category: 'decoration',
});
reg(B.TRAPDOOR, 'trapdoor', 'Trappe', {
  tiles: 'trapdoor', shape: SHAPE.TRAPDOOR, opaque: false, hardness: 3, ...wood, category: 'decoration',
});
reg(B.LADDER, 'ladder', 'Échelle', {
  tiles: 'ladder', shape: SHAPE.LADDER, solid: false, opaque: false, hardness: 0.4, ...wood, climbable: true,
  itemTile: 'ladder', category: 'decoration',
});
reg(B.TORCH, 'torch', 'Torche', {
  tiles: 'torch', shape: SHAPE.TORCH, solid: false, opaque: false, hardness: 0, sound: 'wood', emit: 14,
  itemTile: 'torch', category: 'utilitaire',
});
reg(B.OAK_FENCE, 'oak_fence', 'Barrière', {
  tiles: 'oak_planks', shape: SHAPE.FENCE, opaque: false, hardness: 2, flammable: 20, ...wood, category: 'decoration',
});
reg(B.FENCE_GATE, 'oak_fence_gate', 'Portillon', {
  tiles: 'oak_planks', shape: SHAPE.FENCE_GATE, opaque: false, hardness: 2, flammable: 20, ...wood, category: 'decoration',
});
reg(B.GLASS_PANE, 'glass_pane', 'Vitre', {
  tiles: { all: 'glass', top: 'glass_pane_top' }, shape: SHAPE.PANE, opaque: false, hardness: 0.3, sound: 'glass',
  itemTile: 'glass', category: 'decoration',
});
reg(B.IRON_BARS, 'iron_bars', 'Barreaux de fer', {
  tiles: 'iron_bars', shape: SHAPE.PANE, opaque: false, hardness: 5, tool: 'pickaxe', harvestTier: 1, sound: 'metal',
  itemTile: 'iron_bars', category: 'decoration',
});

// --- Dalles et escaliers ---
interface Mat { key: string; label: string; tiles: TilesSpec; wood: boolean; hardness: number }
const SLAB_MATS: Mat[] = [
  { key: 'stone', label: 'en pierre', tiles: { top: 'smooth_stone', bottom: 'smooth_stone', side: 'smooth_stone_slab_side' }, wood: false, hardness: 2 },
  { key: 'cobblestone', label: 'en pierres', tiles: 'cobblestone', wood: false, hardness: 2 },
  { key: 'oak', label: 'en chêne', tiles: 'oak_planks', wood: true, hardness: 2 },
  { key: 'spruce', label: 'en sapin', tiles: 'spruce_planks', wood: true, hardness: 2 },
  { key: 'birch', label: 'en bouleau', tiles: 'birch_planks', wood: true, hardness: 2 },
  { key: 'jungle', label: 'en acajou', tiles: 'jungle_planks', wood: true, hardness: 2 },
  { key: 'acacia', label: 'en acacia', tiles: 'acacia_planks', wood: true, hardness: 2 },
  { key: 'brick', label: 'en briques', tiles: 'bricks', wood: false, hardness: 2 },
  { key: 'stone_brick', label: 'en pierre taillée', tiles: 'stone_bricks', wood: false, hardness: 1.5 },
  { key: 'sandstone', label: 'en grès', tiles: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, wood: false, hardness: 0.8 },
  { key: 'quartz', label: 'en quartz', tiles: 'quartz_block', wood: false, hardness: 0.8 },
];
SLAB_MATS.forEach((m, i) => {
  reg(B.STONE_SLAB + i, `${m.key}_slab`, `Dalle ${m.label}`, {
    tiles: m.tiles, shape: SHAPE.SLAB, opaque: false, lightOpacity: 15, hardness: m.hardness, blastResistance: m.wood ? 15 : 30,
    tool: m.wood ? 'axe' : 'pickaxe', harvestTier: m.wood ? 0 : 1, sound: m.wood ? 'wood' : 'stone', flammable: m.wood ? 20 : 0,
  });
});
SLAB_MATS.filter((m) => m.key !== 'stone').forEach((m, i) => {
  reg(B.COBBLESTONE_STAIRS + i, `${m.key}_stairs`, `Escalier ${m.label}`, {
    tiles: m.tiles, shape: SHAPE.STAIRS, opaque: false, lightOpacity: 15, hardness: m.hardness, blastResistance: m.wood ? 15 : 30,
    tool: m.wood ? 'axe' : 'pickaxe', harvestTier: m.wood ? 0 : 1, sound: m.wood ? 'wood' : 'stone', flammable: m.wood ? 20 : 0,
  });
});

// --- Végétation ---
const plant = {
  shape: SHAPE.CROSS, solid: false, opaque: false, hardness: 0, sound: 'grass' as const, needsSupport: true, category: 'nature' as const,
};
reg(B.TALL_GRASS, 'tall_grass', 'Herbe haute', { tiles: 'tall_grass', ...plant, tint: TINT.GRASS, replaceable: true, flammable: 100, itemTile: 'tall_grass' });
reg(B.FERN, 'fern', 'Fougère', { tiles: 'fern', ...plant, tint: TINT.GRASS, replaceable: true, flammable: 100, itemTile: 'fern' });
reg(B.DEAD_BUSH, 'dead_bush', 'Arbuste mort', { tiles: 'dead_bush', ...plant, replaceable: true, flammable: 100, itemTile: 'dead_bush' });
const FLOWERS: Array<[number, TileName, string]> = [
  [B.DANDELION, 'dandelion', 'Pissenlit'],
  [B.POPPY, 'poppy', 'Coquelicot'],
  [B.BLUE_ORCHID, 'blue_orchid', 'Orchidée bleue'],
  [B.ALLIUM, 'allium', 'Allium'],
  [B.AZURE_BLUET, 'azure_bluet', 'Houstonie bleue'],
  [B.RED_TULIP, 'red_tulip', 'Tulipe rouge'],
  [B.ORANGE_TULIP, 'orange_tulip', 'Tulipe orange'],
  [B.WHITE_TULIP, 'white_tulip', 'Tulipe blanche'],
  [B.PINK_TULIP, 'pink_tulip', 'Tulipe rose'],
  [B.OXEYE_DAISY, 'oxeye_daisy', 'Marguerite'],
  [B.CORNFLOWER, 'cornflower', 'Bleuet'],
];
for (const [id, tile, label] of FLOWERS) reg(id, tile, label, { tiles: tile, ...plant, itemTile: tile });
reg(B.BROWN_MUSHROOM, 'brown_mushroom', 'Champignon brun', { tiles: 'brown_mushroom', ...plant, emit: 1, itemTile: 'brown_mushroom', randomTicks: true });
reg(B.RED_MUSHROOM, 'red_mushroom', 'Champignon rouge', { tiles: 'red_mushroom', ...plant, itemTile: 'red_mushroom', randomTicks: true });
reg(B.SUGAR_CANE, 'sugar_cane', 'Canne à sucre', { tiles: 'sugar_cane', ...plant, itemTile: 'sugar_cane_item', randomTicks: true });
reg(B.CACTUS, 'cactus', 'Cactus', {
  tiles: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, shape: SHAPE.CACTUS, opaque: false, hardness: 0.4,
  sound: 'cloth', needsSupport: true, randomTicks: true, category: 'nature',
});
reg(B.PUMPKIN, 'pumpkin', 'Citrouille', {
  tiles: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' }, rot: ROT.FACING,
  hardness: 1, ...wood, category: 'nature',
});
reg(B.JACK_O_LANTERN, 'jack_o_lantern', "Citrouille-lanterne", {
  tiles: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, rot: ROT.FACING,
  hardness: 1, emit: 15, ...wood, category: 'decoration',
});
reg(B.MELON, 'melon', 'Pastèque', { tiles: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, hardness: 1, ...wood, category: 'nature' });
const crop = {
  shape: SHAPE.CROP, solid: false, opaque: false, hardness: 0, sound: 'grass' as const, needsSupport: true, randomTicks: true,
  hasItem: false, category: 'aucune' as const,
};
reg(B.WHEAT, 'wheat_crop', 'Blé', { tiles: 'wheat_7', ...crop });
reg(B.FARMLAND, 'farmland', 'Terre labourée', {
  tiles: { top: 'farmland_dry', bottom: 'dirt', side: 'dirt' }, shape: SHAPE.FARMLAND, opaque: false, lightOpacity: 15, hardness: 0.6,
  tool: 'shovel', sound: 'gravel', randomTicks: true, hasItem: false, category: 'aucune',
});
reg(B.GRASS_PATH, 'grass_path', 'Chemin de terre', {
  tiles: { top: 'grass_path_top', bottom: 'dirt', side: 'grass_path_side' }, shape: SHAPE.FARMLAND, opaque: false, lightOpacity: 15,
  hardness: 0.65, tool: 'shovel', sound: 'grass', category: 'nature',
});
reg(B.LILY_PAD, 'lily_pad', 'Nénuphar', {
  tiles: 'lily_pad', shape: SHAPE.LILY_PAD, solid: true, opaque: false, hardness: 0, sound: 'grass', itemTile: 'lily_pad', category: 'nature',
});
reg(B.VINE, 'vine', 'Lianes', {
  tiles: 'vine', shape: SHAPE.VINE, solid: false, opaque: false, hardness: 0.2, tool: 'shears', sound: 'grass', climbable: true,
  tint: TINT.FOLIAGE, replaceable: true, flammable: 100, itemTile: 'vine', randomTicks: true, category: 'nature',
});
reg(B.COBWEB, 'cobweb', "Toile d'araignée", {
  tiles: 'cobweb', shape: SHAPE.CROSS, solid: false, opaque: false, lightOpacity: 1, hardness: 4, tool: 'sword', harvestTier: 1,
  sound: 'cloth', itemTile: 'cobweb', category: 'decoration',
});
reg(B.HAY_BALE, 'hay_block', 'Botte de paille', {
  tiles: { side: 'hay_side', end: 'hay_top' }, rot: ROT.AXIS, hardness: 0.5, tool: 'hoe', sound: 'grass', flammable: 60, category: 'decoration',
});
reg(B.FIRE, 'fire', 'Feu', {
  tiles: 'fire', shape: SHAPE.FIRE, solid: false, opaque: false, hardness: 0, emit: 15, sound: 'cloth', replaceable: true,
  randomTicks: true, hasItem: false, category: 'aucune',
});
reg(B.SPAWNER, 'spawner', 'Générateur de monstres', {
  tiles: 'spawner', opaque: false, hardness: 5, tool: 'pickaxe', harvestTier: 1, sound: 'metal', category: 'utilitaire',
});
reg(B.CARROTS, 'carrots_crop', 'Carottes', { tiles: 'carrots_3', ...crop });
reg(B.POTATOES, 'potatoes_crop', 'Pommes de terre', { tiles: 'potatoes_3', ...crop });
reg(B.SPONGE, 'sponge', 'Éponge', { tiles: 'sponge', hardness: 0.6, tool: 'hoe', sound: 'grass', category: 'decoration' });
reg(B.NETHERRACK, 'netherrack', 'Netherrack', { tiles: 'netherrack', hardness: 0.4, ...rock, category: 'nature' });
reg(B.IRON_DOOR, 'iron_door', 'Porte en fer', {
  tiles: { all: 'iron_door_bottom', top: 'iron_door_top' }, shape: SHAPE.DOOR, opaque: false, hardness: 5, tool: 'pickaxe',
  harvestTier: 1, sound: 'metal', itemTile: 'iron_door_item', category: 'decoration',
});
reg(B.REDSTONE_WIRE, 'redstone_wire', 'Poudre de redstone', {
  tiles: 'redstone_dust', shape: SHAPE.REDSTONE_WIRE, solid: false, opaque: false, hardness: 0,
  sound: 'stone', needsSupport: true, hasItem: false, category: 'aucune',
});
reg(B.REDSTONE_TORCH, 'redstone_torch', 'Torche de redstone', {
  tiles: 'redstone_torch_on', shape: SHAPE.TORCH, solid: false, opaque: false, hardness: 0, emit: 7,
  sound: 'wood', needsSupport: true, itemTile: 'redstone_torch_on', category: 'utilitaire',
});
reg(B.REDSTONE_TORCH_OFF, 'redstone_torch_off', 'Torche de redstone éteinte', {
  tiles: 'redstone_torch_off', shape: SHAPE.TORCH, solid: false, opaque: false, hardness: 0, emit: 0,
  sound: 'wood', needsSupport: true, hasItem: false, category: 'aucune',
});
reg(B.LEVER, 'lever', 'Levier', {
  tiles: 'cobblestone', shape: SHAPE.LEVER, solid: false, opaque: false, hardness: 0.5,
  sound: 'wood', needsSupport: true, category: 'utilitaire',
});
reg(B.STONE_BUTTON, 'stone_button', 'Bouton en pierre', {
  tiles: 'stone', shape: SHAPE.BUTTON, solid: false, opaque: false, hardness: 0.5,
  sound: 'stone', needsSupport: true, category: 'utilitaire',
});
reg(B.STONE_PRESSURE_PLATE, 'stone_pressure_plate', 'Plaque de pression en pierre', {
  tiles: 'stone', shape: SHAPE.PRESSURE_PLATE, solid: false, opaque: false, hardness: 0.5, tool: 'pickaxe',
  sound: 'stone', needsSupport: true, category: 'utilitaire',
});
reg(B.PISTON, 'piston', 'Piston', {
  tiles: { top: 'piston_top', bottom: 'piston_bottom', side: 'piston_side' },
  hardness: 1.5, tool: 'pickaxe', sound: 'stone', category: 'utilitaire',
});
reg(B.STICKY_PISTON, 'sticky_piston', 'Piston collant', {
  tiles: { top: 'piston_top_sticky', bottom: 'piston_bottom', side: 'piston_side' },
  hardness: 1.5, tool: 'pickaxe', sound: 'stone', category: 'utilitaire',
});
reg(B.PISTON_HEAD, 'piston_head', 'Tête de piston', {
  tiles: 'piston_top', shape: SHAPE.PISTON_HEAD, opaque: false, hardness: 1.5, tool: 'pickaxe',
  sound: 'stone', hasItem: false, category: 'aucune',
});
reg(B.REDSTONE_LAMP, 'redstone_lamp', 'Lampe à redstone', {
  tiles: 'redstone_lamp_off', hardness: 0.3, sound: 'glass', category: 'utilitaire',
});
reg(B.REDSTONE_LAMP_LIT, 'redstone_lamp_lit', 'Lampe à redstone allumée', {
  tiles: 'redstone_lamp_on', hardness: 0.3, emit: 15, sound: 'glass', hasItem: false, category: 'aucune',
});
reg(B.NETHER_PORTAL, 'nether_portal', 'Portail du Nether', {
  tiles: 'nether_portal', shape: SHAPE.PORTAL, solid: false, opaque: false, translucent: true,
  emit: 11, hardness: -1, sound: 'glass', hasItem: false, category: 'aucune',
});
reg(B.NETHER_QUARTZ_ORE, 'nether_quartz_ore', 'Minerai de quartz du Nether', {
  tiles: 'nether_quartz_ore', hardness: 3, tool: 'pickaxe', harvestTier: 1, sound: 'stone', category: 'nature',
});
reg(B.NETHER_BRICKS, 'nether_bricks', 'Briques du Nether', { tiles: 'nether_bricks', hardness: 2, blastResistance: 30, ...rock });
reg(B.NETHER_BRICK_FENCE, 'nether_brick_fence', 'Barrière en briques du Nether', {
  tiles: 'nether_bricks', shape: SHAPE.FENCE, opaque: false, hardness: 2, blastResistance: 30, ...rock, category: 'decoration',
});
reg(B.END_STONE, 'end_stone', "Pierre de l'End", { tiles: 'end_stone', hardness: 3, blastResistance: 45, ...rock, category: 'nature' });
reg(B.END_PORTAL_FRAME, 'end_portal_frame', "Cadre de portail de l'End", {
  tiles: { top: 'end_portal_frame_top', bottom: 'end_stone', side: 'end_portal_frame_side' }, shape: SHAPE.END_FRAME, opaque: false,
  lightOpacity: 0, emit: 1, hardness: -1, blastResistance: 1e7, sound: 'glass', category: 'decoration',
});
reg(B.END_PORTAL, 'end_portal', "Portail de l'End", {
  tiles: 'end_portal', shape: SHAPE.END_PORTAL, solid: false, opaque: false, emit: 15, hardness: -1, blastResistance: 1e7,
  sound: 'glass', hasItem: false, category: 'aucune',
});
reg(B.DRAGON_EGG, 'dragon_egg', 'Œuf de dragon', {
  tiles: 'dragon_egg', shape: SHAPE.DRAGON_EGG, opaque: false, lightOpacity: 0, emit: 1, hardness: 3, blastResistance: 45,
  ...rock, category: 'decoration',
});
reg(B.CAULDRON, 'cauldron', 'Chaudron', {
  tiles: { top: 'cauldron_top', bottom: 'cauldron_bottom', side: 'cauldron_side' },
  shape: SHAPE.CAULDRON, opaque: false, lightOpacity: 0, hardness: 2, ...rock, harvestTier: 1, sound: 'metal', category: 'utilitaire',
});
reg(B.CAKE, 'cake', 'Gâteau', {
  tiles: { top: 'cake_top', bottom: 'cake_bottom', side: 'cake_side' },
  shape: SHAPE.CAKE, opaque: false, lightOpacity: 0, hardness: 0.5, sound: 'cloth', needsSupport: true,
  stack: 1, itemTile: 'cake_item', category: 'utilitaire',
});
reg(B.BREWING_STAND, 'brewing_stand', 'Alambic', {
  tiles: { top: 'brewing_stand_rod', bottom: 'brewing_stand_base', side: 'brewing_stand_base' },
  shape: SHAPE.BREWING_STAND, opaque: false, lightOpacity: 0, emit: 1, hardness: 0.5, ...rock,
  itemTile: 'brewing_stand_item', category: 'utilitaire',
});
reg(B.SOUL_SAND, 'soul_sand', 'Sable des âmes', { tiles: 'soul_sand', hardness: 0.5, tool: 'shovel', sound: 'sand', category: 'nature' });
reg(B.NETHER_WART, 'nether_wart_crop', 'Verrues du Nether', { tiles: 'nether_wart_2', ...crop });
reg(B.RAIL, 'rail', 'Rails', {
  tiles: 'rail', shape: SHAPE.RAIL, solid: false, opaque: false, hardness: 0.7, tool: 'pickaxe', sound: 'metal',
  needsSupport: true, itemTile: 'rail', category: 'decoration',
});
reg(B.POWERED_RAIL, 'powered_rail', 'Rail propulseur', {
  tiles: 'rail_golden', shape: SHAPE.RAIL, solid: false, opaque: false, hardness: 0.7, tool: 'pickaxe', sound: 'metal',
  needsSupport: true, itemTile: 'rail_golden', category: 'utilitaire',
});
reg(B.DETECTOR_RAIL, 'detector_rail', 'Rail détecteur', {
  tiles: 'rail_detector', shape: SHAPE.RAIL, solid: false, opaque: false, hardness: 0.7, tool: 'pickaxe', sound: 'metal',
  needsSupport: true, itemTile: 'rail_detector', category: 'utilitaire',
});
// Panneaux : posés par l'objet « Panneau » (sur un bloc : sur poteau ; contre un mur : mural)
reg(B.SIGN, 'standing_sign', 'Panneau', {
  tiles: 'oak_planks', shape: SHAPE.SIGN, solid: false, opaque: false, hardness: 1, tool: 'axe',
  sound: 'wood', needsSupport: true, hasItem: false, category: 'aucune',
});
reg(B.WALL_SIGN, 'wall_sign', 'Panneau mural', {
  tiles: 'oak_planks', shape: SHAPE.SIGN, solid: false, opaque: false, hardness: 1, tool: 'axe',
  sound: 'wood', needsSupport: true, hasItem: false, category: 'aucune',
});
reg(B.REPEATER, 'repeater', 'Répéteur', {
  tiles: { top: 'repeater_off', bottom: 'smooth_stone', side: 'smooth_stone' }, shape: SHAPE.REPEATER,
  opaque: false, hardness: 0, sound: 'stone', needsSupport: true, itemTile: 'repeater_off', category: 'utilitaire',
});
reg(B.COMPARATOR, 'comparator', 'Comparateur', {
  tiles: { top: 'comparator_off', bottom: 'smooth_stone', side: 'smooth_stone' }, shape: SHAPE.COMPARATOR,
  opaque: false, hardness: 0, sound: 'stone', needsSupport: true, itemTile: 'comparator_off', category: 'utilitaire',
});
reg(B.HOPPER, 'hopper', 'Entonnoir', {
  tiles: { top: 'hopper_top', bottom: 'hopper_outside', side: 'hopper_outside' }, shape: SHAPE.HOPPER,
  opaque: false, hardness: 3, blastResistance: 24, tool: 'pickaxe', harvestTier: 1, sound: 'metal',
  itemTile: 'hopper_outside', category: 'utilitaire',
});
reg(B.DISPENSER, 'dispenser', 'Distributeur', {
  tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'dispenser_front' },
  hardness: 3.5, blastResistance: 17.5, tool: 'pickaxe', harvestTier: 1, category: 'utilitaire',
});
reg(B.DROPPER, 'dropper', 'Dropper', {
  tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'dropper_front' },
  hardness: 3.5, blastResistance: 17.5, tool: 'pickaxe', harvestTier: 1, category: 'utilitaire',
});
reg(B.DAYLIGHT_DETECTOR, 'daylight_detector', 'Capteur de lumière du jour', {
  tiles: { top: 'daylight_detector_top', bottom: 'oak_planks', side: 'daylight_detector_side' },
  shape: SHAPE.DAYLIGHT_DETECTOR, opaque: false, hardness: 0.2, tool: 'axe', sound: 'wood', category: 'utilitaire',
});
reg(B.NOTE_BLOCK, 'noteblock', 'Bloc musical', {
  tiles: 'noteblock', hardness: 0.8, tool: 'axe', sound: 'wood', flammable: 5, category: 'utilitaire',
});

// Identifiants non attribués : on les fait pointer vers un bloc de secours pour éviter tout crash
for (let id = 0; id < BLOCK_ID_LIMIT; id++) {
  if (!BLOCKS[id]) {
    reg(id, `unknown_${id}`, 'Bloc inconnu', { tiles: 'stone', hasItem: false, category: 'aucune' });
  }
}

for (let id = 0; id < BLOCK_ID_LIMIT; id++) {
  const d = BLOCKS[id];
  const isLeaves = id >= B.OAK_LEAVES && id <= B.ACACIA_LEAVES;
  BLOCK_AO[id] = d.opaque || isLeaves ? 1 : 0;
  BLOCK_NEIGHBOR_LIGHT[id] = !d.opaque && d.lightOpacity >= 15 ? 1 : 0;
}

void WOOD_LABELS;

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------
/** Direction horizontale (0 sud +z, 1 ouest -x, 2 nord -z, 3 est +x) → face du cube. */
export const FACING_TO_FACE = [FACE_SOUTH, FACE_WEST, FACE_NORTH, FACE_EAST] as const;
export const FACING_DX = [0, -1, 0, 1] as const;
export const FACING_DZ = [1, 0, -1, 0] as const;

/** Direction d'un piston (0 haut +y, 1 bas -y, 2 sud +z, 3 ouest -x, 4 nord -z, 5 est +x). */
export const PISTON_DX = [0, 0, 0, -1, 0, 1] as const;
export const PISTON_DY = [1, -1, 0, 0, 0, 0] as const;
export const PISTON_DZ = [0, 0, 1, 0, -1, 0] as const;
const PISTON_FACES = [FACE_UP, FACE_DOWN, FACE_SOUTH, FACE_WEST, FACE_NORTH, FACE_EAST] as const;
const PISTON_OPPOSITE_FACES = [FACE_DOWN, FACE_UP, FACE_NORTH, FACE_EAST, FACE_SOUTH, FACE_WEST] as const;

export function isLeaves(id: number): boolean {
  return id >= B.OAK_LEAVES && id <= B.ACACIA_LEAVES;
}
export function isLog(id: number): boolean {
  return id >= B.OAK_LOG && id <= B.ACACIA_LOG;
}
export function isSlab(id: number): boolean {
  return id >= B.STONE_SLAB && id <= B.QUARTZ_SLAB;
}
export function isStairs(id: number): boolean {
  return id >= B.COBBLESTONE_STAIRS && id <= B.QUARTZ_STAIRS;
}
export function isFluid(id: number): boolean {
  return id === B.WATER || id === B.LAVA;
}
export function isSapling(id: number): boolean {
  return id >= B.OAK_SAPLING && id <= B.ACACIA_SAPLING;
}
export function isTerracotta(id: number): boolean {
  return id >= B.TERRACOTTA && id <= B.TERRACOTTA_BLACK;
}
export function isWool(id: number): boolean {
  return id >= B.WOOL_WHITE && id <= B.WOOL_BLACK;
}
export function isDoor(id: number): boolean {
  return id === B.OAK_DOOR || id === B.IRON_DOOR;
}
export function isCrop(id: number): boolean {
  return id === B.WHEAT || id === B.CARROTS || id === B.POTATOES;
}
export function isFlower(id: number): boolean {
  return id >= B.DANDELION && id <= B.CORNFLOWER;
}

/**
 * Tuile d'une face en tenant compte de l'orientation (méta-donnée).
 * Retourne tuile | (rotation UV << 16) ; rotation = nombre de quarts de tour.
 */
export function faceTile(id: number, meta: number, face: number): number {
  const d = BLOCKS[id];
  if (id === B.PISTON || id === B.STICKY_PISTON) {
    const f = Math.min(5, meta & 7);
    if (face === PISTON_FACES[f]) {
      return meta & 8 ? T.piston_inner : id === B.STICKY_PISTON ? T.piston_top_sticky : T.piston_top;
    }
    if (face === PISTON_OPPOSITE_FACES[f]) return T.piston_bottom;
    return T.piston_side;
  }
  if (id === B.DISPENSER || id === B.DROPPER) {
    const f = Math.min(5, meta & 7);
    if (face === PISTON_FACES[f]) return d.frontTile;
    return face <= FACE_DOWN ? T.furnace_top : T.furnace_side;
  }
  if (d.rot === ROT.NONE) {
    if (id === B.FARMLAND && face === FACE_UP) return meta > 0 ? T.farmland_wet : T.farmland_dry;
    return d.tiles[face];
  }
  if (d.rot === ROT.AXIS) {
    const axis = meta & 3;
    const end = d.tiles[FACE_UP];
    const side = d.tiles[FACE_NORTH];
    if (axis === 0) return face <= FACE_DOWN ? end : side;
    if (axis === 1) {
      // axe X : les bouts sont à l'ouest / à l'est
      if (face === FACE_WEST || face === FACE_EAST) return end;
      return side | (1 << 16);
    }
    // axe Z
    if (face === FACE_NORTH || face === FACE_SOUTH) return end;
    return face <= FACE_DOWN ? side : side | (1 << 16);
  }
  // ROT.FACING
  if (face <= FACE_DOWN) return d.tiles[face];
  return face === FACING_TO_FACE[meta & 3] ? d.frontTile : d.tiles[face];
}

/** Tuile représentative d'un bloc (particules de casse, icônes de secours). */
export function particleTile(id: number, meta = 0): number {
  const d = BLOCKS[id];
  if (id === B.GRASS) return T.dirt;
  if (id === B.WHEAT) return T[`wheat_${Math.min(7, meta & 7)}` as TileName];
  return d.tiles[FACE_NORTH];
}

/** Couleur de l'herbe selon le climat (température et humidité dans [0, 1]). */
export function grassColor(temp: number, humid: number): number {
  return climateColor(temp, humid, 0x80b497, 0xbfb755, 0x47cd33);
}

/** Couleur du feuillage selon le climat. */
export function foliageColor(temp: number, humid: number): number {
  return climateColor(temp, humid, 0x60a17b, 0xaea42a, 0x1abf00);
}

function climateColor(temp: number, humid: number, cold: number, dry: number, wet: number): number {
  const t = temp < 0 ? 0 : temp > 1 ? 1 : temp;
  const h = (humid < 0 ? 0 : humid > 1 ? 1 : humid) * t;
  const wc = 1 - t;
  const wd = t - h;
  const r = ((cold >> 16) & 255) * wc + ((dry >> 16) & 255) * wd + ((wet >> 16) & 255) * h;
  const g = ((cold >> 8) & 255) * wc + ((dry >> 8) & 255) * wd + ((wet >> 8) & 255) * h;
  const b = (cold & 255) * wc + (dry & 255) * wd + (wet & 255) * h;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
