/**
 * Catalogue des potions, recettes de distillation et application des effets.
 * Module pur (ni DOM ni Three.js).
 */
import type { EffectType, Entity, Living } from '../entity/Entity';
import { I } from './Ids';
import { cloneStackWithCount, makeStack, type ItemStack, type Slot } from './ItemStack';

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
