/**
 * Pile d'objets : contenu d'une case d'inventaire, d'un coffre ou d'un objet au sol.
 */
import { getItem, maxStack } from './Items';
import type { Enchants } from './Enchants';

export interface ItemStack {
  id: number;
  count: number;
  /** Usure de l'outil ou de l'armure (0 = neuf). */
  damage: number;
  enchants?: Enchants;
  /** Variante de potion (fiole d'eau, potion étrange, soin, etc.). */
  potion?: string;
}

export type Slot = ItemStack | null;

export function makeStack(id: number, count = 1, damage = 0, enchants?: Enchants, potion?: string): ItemStack {
  const s: ItemStack = { id, count, damage };
  if (enchants && Object.keys(enchants).length > 0) s.enchants = { ...enchants };
  if (potion) s.potion = potion;
  return s;
}

export function cloneStack(s: Slot): Slot {
  if (!s) return null;
  return makeStack(s.id, s.count, s.damage, s.enchants, s.potion);
}

/** Copie une pile en remplaçant sa quantité et en conservant usure, enchantements et potion. */
export function cloneStackWithCount(s: ItemStack, count: number): ItemStack {
  return makeStack(s.id, count, s.damage, s.enchants, s.potion);
}

/** Deux piles peuvent-elles fusionner ? */
export function canMerge(a: Slot, b: Slot): boolean {
  if (!a || !b) return false;
  if (a.enchants || b.enchants) return false;
  return a.id === b.id && a.damage === b.damage && (a.potion ?? '') === (b.potion ?? '') && maxStack(a.id) > 1;
}

/** Durabilité maximale (0 = objet qui ne s'use pas). */
export function maxDamage(id: number): number {
  return getItem(id).durability;
}

/**
 * Ajoute `stack` dans la liste de cases (fusion d'abord, puis cases vides).
 * Retourne la quantité qui n'a pas pu être rangée ; `stack.count` est mis à jour.
 */
export function addToSlots(slots: Slot[], stack: ItemStack, from = 0, to = slots.length): number {
  const max = maxStack(stack.id);
  if (max > 1) {
    for (let i = from; i < to && stack.count > 0; i++) {
      const s = slots[i];
      if (!s || !canMerge(s, stack) || s.count >= max) continue;
      const n = Math.min(max - s.count, stack.count);
      s.count += n;
      stack.count -= n;
    }
  }
  for (let i = from; i < to && stack.count > 0; i++) {
    if (slots[i]) continue;
    const n = Math.min(max, stack.count);
    slots[i] = cloneStackWithCount(stack, n);
    stack.count -= n;
  }
  return stack.count;
}

/** Sérialisation compacte : [id, quantité, usure, enchants?, potion?] ou null. */
export type SavedSlot =
  | [number, number, number]
  | [number, number, number, Enchants | null]
  | [number, number, number, Enchants | null, string]
  | null;

export function saveSlots(slots: Slot[]): SavedSlot[] {
  return slots.map((s) => {
    if (!s) return null;
    const ench = s.enchants && Object.keys(s.enchants).length > 0 ? { ...s.enchants } : null;
    if (s.potion) return [s.id, s.count, s.damage, ench, s.potion];
    return ench ? [s.id, s.count, s.damage, ench] : [s.id, s.count, s.damage];
  });
}

const VALID_ENCHANTS = new Set(['efficiency', 'unbreaking', 'sharpness', 'protection', 'fortune', 'silk_touch', 'power']);

/** Valide et copie un dictionnaire d'enchantements lu depuis une sauvegarde. */
export function sanitizeEnchants(raw: unknown): Enchants | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const e: Enchants = {};
  let any = false;
  for (const [k, lvl] of Object.entries(raw as Record<string, unknown>)) {
    if (VALID_ENCHANTS.has(k) && typeof lvl === 'number' && Number.isFinite(lvl) && lvl > 0) {
      e[k as keyof Enchants] = Math.floor(lvl);
      any = true;
    }
  }
  return any ? e : undefined;
}

export function loadSlots(data: unknown, size: number): Slot[] {
  const out: Slot[] = new Array<Slot>(size).fill(null);
  if (!Array.isArray(data)) return out;
  for (let i = 0; i < size && i < data.length; i++) {
    const v = data[i] as unknown;
    if (!Array.isArray(v) || typeof v[0] !== 'number' || typeof v[1] !== 'number') continue;
    if (v[1] <= 0) continue;
    const enchants = sanitizeEnchants(v[3]);
    const potion = typeof v[4] === 'string' && v[4].length > 0 && v[4].length <= 40 ? v[4] : undefined;
    out[i] = makeStack(v[0], v[1], typeof v[2] === 'number' ? v[2] : 0, enchants, potion);
  }
  return out;
}
