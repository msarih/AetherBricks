/**
 * Butin des coffres générés avec le monde (donjons, temples, mines, forges, forteresses).
 *
 * Comme dans Minecraft, le contenu n'est tiré qu'à la première ouverture du coffre (ou
 * quand on le casse) : tant que personne n'y touche, le coffre ne porte que le nom de sa
 * table. Le tirage dépend de la graine du monde et de la position du coffre : il est donc
 * le même à chaque fois que le chunk est régénéré.
 *
 * Tables reprises de Minecraft 1.12, limitées aux objets qui existent dans ce jeu.
 * Module pur.
 */
import { B, I } from './Ids';
import { maxStack } from './Items';
import { makeStack, type Slot } from './ItemStack';
import { hash3, mulberry32 } from './gen/Noise';

export type LootTable = 'dungeon' | 'desert_temple' | 'jungle_temple' | 'mineshaft' | 'blacksmith' | 'fortress';

/** [objet, poids, quantité min, quantité max]. */
type Entry = readonly [id: number, weight: number, min: number, max: number];
interface Pool {
  rolls: readonly [min: number, max: number];
  entries: readonly Entry[];
}

const JUNK: readonly Entry[] = [
  [I.BONE, 10, 1, 8],
  [I.GUNPOWDER, 10, 1, 8],
  [I.ROTTEN_FLESH, 10, 1, 8],
  [I.STRING, 10, 1, 8],
];

const TABLES: Record<LootTable, readonly Pool[]> = {
  dungeon: [
    { rolls: [1, 3], entries: [[I.GOLDEN_APPLE, 15, 1, 1], [I.BOOK, 20, 1, 3], [I.DIAMOND, 4, 1, 1], [I.EMERALD, 8, 1, 2]] },
    {
      rolls: [1, 4],
      entries: [
        [I.IRON_INGOT, 10, 1, 4], [I.GOLD_INGOT, 5, 1, 4], [I.BREAD, 20, 1, 1], [I.WHEAT, 20, 1, 4], [I.BUCKET, 10, 1, 1],
        [I.REDSTONE, 15, 1, 4], [I.COAL, 15, 1, 4], [I.WHEAT_SEEDS, 20, 2, 4],
      ],
    },
    { rolls: [3, 3], entries: JUNK },
  ],
  desert_temple: [
    {
      rolls: [2, 4],
      entries: [
        [I.DIAMOND, 5, 1, 3], [I.IRON_INGOT, 15, 1, 5], [I.GOLD_INGOT, 15, 2, 7], [I.EMERALD, 15, 1, 3], [I.BONE, 25, 4, 6],
        [I.SPIDER_EYE, 25, 1, 3], [I.ROTTEN_FLESH, 25, 3, 7], [I.GOLDEN_APPLE, 20, 1, 1], [I.BOOK, 20, 1, 2],
      ],
    },
    { rolls: [4, 4], entries: [...JUNK, [B.SAND, 10, 1, 8]] },
  ],
  jungle_temple: [
    {
      rolls: [2, 6],
      entries: [
        [I.DIAMOND, 3, 1, 3], [I.IRON_INGOT, 10, 1, 5], [I.GOLD_INGOT, 15, 2, 7], [I.EMERALD, 2, 1, 3], [I.BONE, 20, 4, 6],
        [I.ROTTEN_FLESH, 16, 3, 7], [I.BOOK, 6, 1, 3],
      ],
    },
  ],
  mineshaft: [
    { rolls: [1, 1], entries: [[I.GOLDEN_APPLE, 20, 1, 1], [I.IRON_PICKAXE, 5, 1, 1], [I.BOOK, 10, 1, 1], [I.STICK, 5, 2, 4]] },
    {
      rolls: [2, 4],
      entries: [
        [I.IRON_INGOT, 10, 1, 5], [I.GOLD_INGOT, 5, 1, 3], [I.REDSTONE, 5, 4, 9], [I.LAPIS, 5, 4, 9], [I.DIAMOND, 3, 1, 2],
        [I.COAL, 10, 3, 8], [I.BREAD, 15, 1, 3], [I.WHEAT_SEEDS, 10, 2, 4],
      ],
    },
    { rolls: [3, 3], entries: [[B.TORCH, 15, 1, 16], [B.OAK_PLANKS, 10, 2, 8], [I.STRING, 5, 1, 4]] },
  ],
  blacksmith: [
    {
      rolls: [3, 8],
      entries: [
        [I.DIAMOND, 3, 1, 3], [I.IRON_INGOT, 10, 1, 5], [I.GOLD_INGOT, 5, 1, 3], [I.BREAD, 15, 1, 3], [I.APPLE, 15, 1, 3],
        [I.IRON_PICKAXE, 5, 1, 1], [I.IRON_SWORD, 5, 1, 1], [I.IRON_CHESTPLATE, 5, 1, 1], [I.IRON_HELMET, 5, 1, 1],
        [I.IRON_LEGGINGS, 5, 1, 1], [I.IRON_BOOTS, 5, 1, 1], [B.OBSIDIAN, 5, 3, 7], [B.OAK_SAPLING, 5, 3, 7],
      ],
    },
  ],
  fortress: [
    {
      rolls: [2, 4],
      entries: [
        [I.DIAMOND, 5, 1, 3], [I.IRON_INGOT, 5, 1, 5], [I.GOLD_INGOT, 15, 1, 3], [I.GOLDEN_SWORD, 5, 1, 1],
        [I.GOLDEN_CHESTPLATE, 5, 1, 1], [I.FLINT_AND_STEEL, 5, 1, 1], [B.OBSIDIAN, 2, 2, 4], [I.GOLD_NUGGET, 10, 2, 8],
        [I.NETHER_WART, 5, 3, 7],
      ],
    },
  ],
};

const SALT = 0x10075eed;

export function isLootTable(v: unknown): v is LootTable {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TABLES, v);
}

/**
 * Tire le contenu d'un coffre de `size` cases : chaque pile gagnée va dans une case libre
 * prise au hasard, comme dans Minecraft.
 */
export function generateLoot(table: LootTable, seed: number, x: number, y: number, z: number, size: number): Slot[] {
  const rng = mulberry32(hash3(x, y, z, (seed ^ SALT) >>> 0));
  const slots: Slot[] = new Array<Slot>(size).fill(null);
  const free: number[] = [];
  for (let i = 0; i < size; i++) free.push(i);
  for (const pool of TABLES[table]) {
    let total = 0;
    for (const e of pool.entries) total += e[1];
    const rolls = pool.rolls[0] + Math.floor(rng() * (pool.rolls[1] - pool.rolls[0] + 1));
    for (let r = 0; r < rolls && free.length > 0; r++) {
      let pick = rng() * total;
      let entry = pool.entries[0];
      for (const e of pool.entries) {
        entry = e;
        pick -= e[1];
        if (pick < 0) break;
      }
      const count = Math.min(maxStack(entry[0]), entry[2] + Math.floor(rng() * (entry[3] - entry[2] + 1)));
      const at = Math.floor(rng() * free.length);
      const slot = free[at];
      free[at] = free[free.length - 1];
      free.pop();
      slots[slot] = makeStack(entry[0], count);
    }
  }
  return slots;
}
