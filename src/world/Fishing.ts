/**
 * Pêche : ce que la ligne ramène quand un poisson mord, et les durées d'attente.
 * Valeurs proches de Minecraft (sans enchantements). Module pur.
 */
import { B, I } from './Ids';
import { getItem } from './Items';
import { makeStack, type ItemStack } from './ItemStack';

/** Attente avant une touche, en ticks (5 à 30 secondes). */
export const FISHING_WAIT_MIN = 100;
export const FISHING_WAIT_MAX = 600;
/** Durée d'une touche, en ticks : c'est la fenêtre pour remonter la ligne. */
export const FISHING_BITE_MIN = 20;
export const FISHING_BITE_MAX = 40;

/** Part des prises : poisson, puis objets sans valeur, le reste étant des trouvailles. */
export const FISHING_FISH_CHANCE = 0.85;
export const FISHING_JUNK_CHANCE = 0.1;

/** Objets sans valeur. */
export const FISHING_JUNK: readonly number[] = [I.BOWL, I.STICK, I.STRING, I.BONE, I.LEATHER, I.ROTTEN_FLESH, I.LEATHER_BOOTS, B.LILY_PAD];
/** Trouvailles (les outils remontent usés). */
export const FISHING_TREASURE: readonly number[] = [I.BOW, I.FISHING_ROD, I.BOOK];

/** Tire au sort une prise. `rng` rend un nombre dans [0, 1[. */
export function rollFishingCatch(rng: () => number): ItemStack {
  const roll = rng();
  if (roll < FISHING_FISH_CHANCE) return makeStack(I.RAW_FISH, 1);
  const list = roll < FISHING_FISH_CHANCE + FISHING_JUNK_CHANCE ? FISHING_JUNK : FISHING_TREASURE;
  const id = list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  const durability = getItem(id).durability;
  // un outil repêché a déjà servi : entre 10 % et 90 % d'usure
  const damage = durability > 0 ? Math.floor(durability * (0.1 + rng() * 0.8)) : 0;
  return makeStack(id, 1, damage);
}
