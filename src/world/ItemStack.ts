/**
 * Pile d'objets : contenu d'une case d'inventaire, d'un coffre ou d'un objet au sol.
 */
import { getItem, maxStack } from './Items';

export interface ItemStack {
  id: number;
  count: number;
  /** Usure de l'outil ou de l'armure (0 = neuf). */
  damage: number;
}

export type Slot = ItemStack | null;

export function makeStack(id: number, count = 1, damage = 0): ItemStack {
  return { id, count, damage };
}

export function cloneStack(s: Slot): Slot {
  return s ? { id: s.id, count: s.count, damage: s.damage } : null;
}

/** Deux piles peuvent-elles fusionner ? */
export function canMerge(a: Slot, b: Slot): boolean {
  if (!a || !b) return false;
  return a.id === b.id && a.damage === b.damage && maxStack(a.id) > 1;
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
    slots[i] = { id: stack.id, count: n, damage: stack.damage };
    stack.count -= n;
  }
  return stack.count;
}

/** Sérialisation compacte : [id, quantité, usure] ou null. */
export function saveSlots(slots: Slot[]): Array<[number, number, number] | null> {
  return slots.map((s) => (s ? [s.id, s.count, s.damage] : null));
}

export function loadSlots(data: unknown, size: number): Slot[] {
  const out: Slot[] = new Array<Slot>(size).fill(null);
  if (!Array.isArray(data)) return out;
  for (let i = 0; i < size && i < data.length; i++) {
    const v = data[i] as unknown;
    if (!Array.isArray(v) || typeof v[0] !== 'number' || typeof v[1] !== 'number') continue;
    if (v[1] <= 0) continue;
    out[i] = { id: v[0], count: v[1], damage: typeof v[2] === 'number' ? v[2] : 0 };
  }
  return out;
}
