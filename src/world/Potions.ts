/**
 * Catalogue des potions, recettes de distillation et application des effets.
 * Module pur (ni DOM ni Three.js).
 */
import type { EffectType, Entity, Living } from '../entity/Entity';
import { I, POTION_KEYS, SPLASH_POTION_KEYS } from './Ids';
import { cloneStackWithCount, makeStack, type ItemStack, type Slot } from './ItemStack';

export { POTION_KEYS, SPLASH_POTION_KEYS };

export interface PotionDef {
  label: string;
  effect?: EffectType;
  level?: number;
  ticks?: number;
  instantHeal?: number;
  longVariant?: string;
  strongVariant?: string;
}

export const POTIONS: Record<string, PotionDef> = {
  water: { label: "Fiole d'eau" },
  awkward: { label: 'Potion étrange' },

  healing: { label: 'Potion de soin', instantHeal: 4, strongVariant: 'healing_2' },
  healing_2: { label: 'Potion de soin II', instantHeal: 8 },

  speed: { label: 'Potion de rapidité', effect: 'speed', level: 1, ticks: 3600, longVariant: 'speed_long', strongVariant: 'speed_2' },
  speed_long: { label: 'Potion de rapidité', effect: 'speed', level: 1, ticks: 9600 },
  speed_2: { label: 'Potion de rapidité II', effect: 'speed', level: 2, ticks: 1800 },

  night_vision: { label: 'Potion de vision nocturne', effect: 'night_vision', level: 1, ticks: 3600, longVariant: 'night_vision_long' },
  night_vision_long: { label: 'Potion de vision nocturne', effect: 'night_vision', level: 1, ticks: 9600 },

  strength: { label: 'Potion de force', effect: 'strength', level: 1, ticks: 3600, longVariant: 'strength_long', strongVariant: 'strength_2' },
  strength_long: { label: 'Potion de force', effect: 'strength', level: 1, ticks: 9600 },
  strength_2: { label: 'Potion de force II', effect: 'strength', level: 2, ticks: 1800 },

  fire_resistance: { label: 'Potion de résistance au feu', effect: 'fire_resistance', level: 1, ticks: 3600, longVariant: 'fire_resistance_long' },
  fire_resistance_long: { label: 'Potion de résistance au feu', effect: 'fire_resistance', level: 1, ticks: 9600 },

  poison: { label: 'Potion de poison', effect: 'poison', level: 1, ticks: 900, longVariant: 'poison_long', strongVariant: 'poison_2' },
  poison_long: { label: 'Potion de poison', effect: 'poison', level: 1, ticks: 1800 },
  poison_2: { label: 'Potion de poison II', effect: 'poison', level: 2, ticks: 420 },

  regeneration: { label: 'Potion de régénération', effect: 'regeneration', level: 1, ticks: 900, longVariant: 'regeneration_long', strongVariant: 'regeneration_2' },
  regeneration_long: { label: 'Potion de régénération', effect: 'regeneration', level: 1, ticks: 1800 },
  regeneration_2: { label: 'Potion de régénération II', effect: 'regeneration', level: 2, ticks: 440 },
};

const POTION_ALIASES: Record<string, string> = {
  eau: 'water',
  water: 'water',
  etrange: 'awkward',
  awkward: 'awkward',
  soin: 'healing',
  vie: 'healing',
  heal: 'healing',
  healing: 'healing',
  soin_2: 'healing_2',
  soin_ii: 'healing_2',
  healing_2: 'healing_2',
  healing_ii: 'healing_2',
  rapidite: 'speed',
  vitesse: 'speed',
  speed: 'speed',
  swiftness: 'speed',
  rapidite_longue: 'speed_long',
  rapidite_long: 'speed_long',
  vitesse_longue: 'speed_long',
  speed_long: 'speed_long',
  rapidite_2: 'speed_2',
  rapidite_ii: 'speed_2',
  vitesse_2: 'speed_2',
  speed_2: 'speed_2',
  speed_ii: 'speed_2',
  vision_nocturne: 'night_vision',
  nuit: 'night_vision',
  night_vision: 'night_vision',
  vision_nocturne_longue: 'night_vision_long',
  vision_nocturne_long: 'night_vision_long',
  night_vision_long: 'night_vision_long',
  force: 'strength',
  strength: 'strength',
  force_longue: 'strength_long',
  force_long: 'strength_long',
  strength_long: 'strength_long',
  force_2: 'strength_2',
  force_ii: 'strength_2',
  strength_2: 'strength_2',
  strength_ii: 'strength_2',
  resistance_au_feu: 'fire_resistance',
  feu: 'fire_resistance',
  anti_feu: 'fire_resistance',
  fire_resistance: 'fire_resistance',
  fire: 'fire_resistance',
  resistance_au_feu_longue: 'fire_resistance_long',
  resistance_au_feu_long: 'fire_resistance_long',
  feu_long: 'fire_resistance_long',
  fire_resistance_long: 'fire_resistance_long',
  poison: 'poison',
  poison_long: 'poison_long',
  poison_longue: 'poison_long',
  poison_2: 'poison_2',
  poison_ii: 'poison_2',
  regeneration: 'regeneration',
  regen: 'regeneration',
  regeneration_longue: 'regeneration_long',
  regeneration_long: 'regeneration_long',
  regen_long: 'regeneration_long',
  regeneration_2: 'regeneration_2',
  regeneration_ii: 'regeneration_2',
  regen_2: 'regeneration_2',
};

export const POTION_COMPLETIONS: readonly string[] = [
  'soin',
  'soin_2',
  'rapidite',
  'rapidite_longue',
  'rapidite_2',
  'vision_nocturne',
  'vision_nocturne_longue',
  'force',
  'force_longue',
  'force_2',
  'resistance_au_feu',
  'resistance_au_feu_longue',
  'poison',
  'poison_long',
  'poison_2',
  'regeneration',
  'regeneration_longue',
  'regeneration_2',
  'eau',
  'etrange',
  ...POTION_KEYS,
].filter((v, i, a) => a.indexOf(v) === i);

export const POTION_GIVE_HELP =
  'Sortes de potions : soin (healing), soin_2, rapidite (speed), rapidite_longue, rapidite_2, vision_nocturne (night_vision), vision_nocturne_longue, force (strength), force_longue, force_2, resistance_au_feu (fire_resistance), resistance_au_feu_longue, poison, poison_long, poison_2, regeneration, regeneration_longue, regeneration_2, eau (water), etrange (awkward)';

/** Résout un nom de sorte de potion (français ou anglais, avec ou sans accents) vers sa clé POTIONS. */
export function resolvePotionKind(raw: string): string | null {
  const norm = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[-\s]+/g, '_');
  if (!norm) return null;
  if (norm in POTION_ALIASES) return POTION_ALIASES[norm];
  if (norm in POTIONS) return norm;
  return null;
}

const AWKWARD_RECIPES: Record<number, string> = {
  [I.GLISTERING_MELON]: 'healing',
  [I.SUGAR]: 'speed',
  [I.GOLDEN_CARROT]: 'night_vision',
  [I.BLAZE_POWDER]: 'strength',
  [I.MAGMA_CREAM]: 'fire_resistance',
  [I.SPIDER_EYE]: 'poison',
  [I.GHAST_TEAR]: 'regeneration',
};

export function potionLabel(key: string | undefined, splash = false): string {
  const base = POTIONS[key ?? 'water']?.label ?? 'Potion';
  return splash ? base.replace('Potion', 'Potion jetable') : base;
}

/** Calcule le résultat d'une distillation pour une case de fiole/potion, ou null si inchangé. */
export function brewResult(stack: Slot, ingredientId: number): ItemStack | null {
  if (!stack || (stack.id !== I.POTION && stack.id !== I.SPLASH_POTION)) return null;
  const key = stack.potion ?? 'water';
  const def = POTIONS[key];
  if (!def) return null;

  if (ingredientId === I.GUNPOWDER && stack.id === I.POTION) {
    return makeStack(I.SPLASH_POTION, 1, 0, undefined, key);
  }
  if (key === 'water' && ingredientId === I.NETHER_WART) {
    return cloneStackWithCount({ ...stack, potion: 'awkward' }, 1);
  }
  if (key === 'awkward') {
    const out = AWKWARD_RECIPES[ingredientId];
    if (out) return cloneStackWithCount({ ...stack, potion: out }, 1);
  }
  if (ingredientId === I.REDSTONE && def.longVariant) {
    return cloneStackWithCount({ ...stack, potion: def.longVariant }, 1);
  }
  if (ingredientId === I.GLOWSTONE_DUST && def.strongVariant) {
    return cloneStackWithCount({ ...stack, potion: def.strongVariant }, 1);
  }
  return null;
}

export function canBrewBottles(bottles: readonly Slot[], ingredientId: number): boolean {
  if (ingredientId <= 0) return false;
  for (let i = 0; i < 3; i++) {
    if (brewResult(bottles[i], ingredientId) !== null) return true;
  }
  return false;
}

export function applyPotionVariant(target: Living, potionKey: string, strength = 1, _source: Entity | null = null): void {
  if (strength <= 0) return;
  const def = POTIONS[potionKey];
  if (!def) return;
  if (def.instantHeal) {
    const healAmt = Math.max(1, Math.round(def.instantHeal * strength));
    target.heal(healAmt);
    return;
  }
  if (def.effect && def.ticks) {
    target.addEffect(def.effect, Math.round(def.ticks * strength), def.level ?? 1);
  }
}
