/**
 * Récolte des blocs : outil requis, vitesse de minage et objets lâchés.
 * Module pur (pas de DOM ni de Three.js) : partagé avec les workers.
 */
import { B, I } from './Ids';
import { BLOCKS, SHAPE, isDoor, isLeaves, isSlab, isWool } from './Blocks';
import { getItem } from './Items';

export interface Drop {
  id: number;
  count: number;
}

/** Entier aléatoire dans [min, max] (bornes incluses). */
function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Végétaux qu'une épée coupe plus vite (plantes en croix, cultures, lianes, cucurbitacées…). */
function isPlant(id: number): boolean {
  if (id === B.COBWEB) return false;
  const shape = BLOCKS[id].shape;
  return (
    shape === SHAPE.CROSS || shape === SHAPE.CROP || shape === SHAPE.VINE || shape === SHAPE.LILY_PAD || shape === SHAPE.CACTUS ||
    id === B.PUMPKIN || id === B.JACK_O_LANTERN || id === B.MELON
  );
}

/** L'outil tenu (id d'objet, 0 = main) permet-il de récolter ce bloc ? (niveau d'outil minimal) */
export function canHarvest(blockId: number, tool: number): boolean {
  const def = BLOCKS[blockId];
  if (!def) return false;
  if (def.harvestTier <= 0) return true;
  const held = getItem(tool);
  // La toile d'araignée se récolte à l'épée comme aux cisailles
  if (blockId === B.COBWEB && held.tool === 'shears') return true;
  return held.tool !== null && held.tool === def.tool && held.tier >= def.harvestTier;
}

/** Multiplicateur de vitesse de minage de l'outil tenu sur ce bloc (1 = main ou mauvais outil). */
export function miningSpeed(blockId: number, tool: number): number {
  const def = BLOCKS[blockId];
  if (!def) return 1;
  const held = getItem(tool);
  const kind = held.tool;
  if (kind === null) return 1;
  if (kind === 'shears') {
    if (isWool(blockId)) return 5;
    if (isLeaves(blockId) || blockId === B.COBWEB) return 15;
  } else if (kind === 'sword') {
    if (blockId === B.COBWEB) return 15;
    if (isLeaves(blockId) || isPlant(blockId)) return 1.5;
    return 1;
  }
  return kind === def.tool ? held.speed : 1;
}

/** Objets lâchés quand un joueur casse le bloc avec l'outil donné. rng() ∈ [0, 1). */
export function blockDrops(id: number, meta: number, tool: number, rng: () => number): Drop[] {
  const def = BLOCKS[id];
  if (!def || id === B.AIR) return [];
  if (!canHarvest(id, tool)) return [];
  const shears = getItem(tool).tool === 'shears';
  const one = (dropId: number, count = 1): Drop[] => [{ id: dropId, count }];

  // --- Feuillages : pousse du même bois, pomme pour le chêne ; le bloc lui-même aux cisailles ---
  if (isLeaves(id)) {
    if (shears) return one(id);
    const drops: Drop[] = [];
    const saplingChance = id === B.JUNGLE_LEAVES ? 0.025 : 0.05;
    if (rng() < saplingChance) drops.push({ id: B.OAK_SAPLING + (id - B.OAK_LEAVES), count: 1 });
    if (id === B.OAK_LEAVES && rng() < 0.005) drops.push({ id: I.APPLE, count: 1 });
    return drops;
  }

  // --- Dalles : une dalle double rend deux dalles ---
  if (isSlab(id)) return one(id, (meta & 3) === 2 ? 2 : 1);

  // --- Portes : seule la moitié basse rend l'objet ---
  if (isDoor(id)) return meta & 8 ? [] : one(id);

  switch (id) {
    // --- Terrain ---
    case B.STONE:
      return one(B.COBBLESTONE);
    case B.GRASS:
    case B.FARMLAND:
      return one(B.DIRT);
    case B.GRAVEL:
      return one(rng() < 0.1 ? I.FLINT : B.GRAVEL);
    case B.CLAY:
      return one(I.CLAY_BALL, 4);
    case B.SNOW_LAYER:
      return one(I.SNOWBALL, (meta & 7) + 1);
    case B.SNOW_BLOCK:
      return one(I.SNOWBALL, 4);

    // --- Minerais ---
    case B.COAL_ORE:
      return one(I.COAL);
    case B.DIAMOND_ORE:
      return one(I.DIAMOND);
    case B.EMERALD_ORE:
      return one(I.EMERALD);
    case B.REDSTONE_ORE:
      return one(I.REDSTONE, randInt(rng, 4, 5));
    case B.LAPIS_ORE:
      return one(I.LAPIS, randInt(rng, 4, 8));

    // --- Rien du tout ---
    case B.GLASS:
    case B.GLASS_PANE:
    case B.ICE:
    case B.SPAWNER:
    case B.FIRE:
    case B.WATER:
    case B.LAVA:
    case B.BEDROCK:
      return [];

    // --- Végétation ---
    case B.TALL_GRASS:
    case B.FERN:
      if (shears) return one(id);
      return rng() < 0.125 ? one(I.WHEAT_SEEDS) : [];
    case B.DEAD_BUSH: {
      if (shears) return one(id);
      const sticks = randInt(rng, 0, 2);
      return sticks > 0 ? one(I.STICK, sticks) : [];
    }
    case B.VINE:
      return shears ? one(id) : [];
    case B.COBWEB:
      return one(I.STRING);
    case B.MELON:
      return one(I.MELON_SLICE, randInt(rng, 3, 7));

    // --- Cultures : meta & 7 = stade de croissance, 7 = mûr ---
    case B.WHEAT: {
      if ((meta & 7) < 7) return one(I.WHEAT_SEEDS);
      const drops = one(I.WHEAT);
      const seeds = randInt(rng, 0, 3);
      if (seeds > 0) drops.push({ id: I.WHEAT_SEEDS, count: seeds });
      return drops;
    }
    case B.CARROTS:
      return one(I.CARROT, (meta & 7) < 7 ? 1 : randInt(rng, 1, 4));
    case B.POTATOES:
      return one(I.POTATO, (meta & 7) < 7 ? 1 : randInt(rng, 1, 4));

    // --- Blocs fabriqués ---
    case B.GLOWSTONE:
      return one(I.GLOWSTONE_DUST, randInt(rng, 2, 4));
    case B.BOOKSHELF:
      return one(I.BOOK, 3);
    case B.FURNACE_LIT:
      return one(B.FURNACE);
    case B.BED:
      // Seule la partie « tête » rend le lit
      return meta & 4 ? one(B.BED) : [];

    default:
      return def.hasItem ? one(id) : [];
  }
}
