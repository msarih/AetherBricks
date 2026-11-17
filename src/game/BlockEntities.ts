/**
 * Entités de bloc : contenu des coffres et état des fourneaux.
 * Ce sont des objets JSON purs (sauvegardés tels quels avec leur chunk).
 * Elles sont créées paresseusement, à la première ouverture du bloc.
 */
import { B, I } from '../world/Ids';
import { maxStack } from '../world/Items';
import { makeStack, sanitizeEnchants, type ItemStack, type Slot } from '../world/ItemStack';
import { fuelTicks, smeltingResult } from '../world/Recipes';
import type { BlockEntity, World } from '../world/World';

export const CHEST_SIZE = 27;
export const FURNACE_COOK_TICKS = 200;

export interface ChestEntity extends BlockEntity {
  type: 'chest';
  items: Slot[];
}

export interface FurnaceEntity extends BlockEntity {
  type: 'furnace';
  /** 0 = à cuire, 1 = combustible, 2 = résultat. */
  items: Slot[];
  /** Ticks de combustion restants et durée totale du combustible en cours. */
  burnTime: number;
  burnTotal: number;
  cookTime: number;
}

function fixSlots(v: unknown, size: number): Slot[] {
  const out: Slot[] = new Array<Slot>(size).fill(null);
  if (!Array.isArray(v)) return out;
  for (let i = 0; i < size && i < v.length; i++) {
    const s = v[i] as Partial<ItemStack> | null;
    if (s && typeof s.id === 'number' && typeof s.count === 'number' && s.count > 0) {
      out[i] = makeStack(s.id, s.count, typeof s.damage === 'number' ? s.damage : 0, sanitizeEnchants(s.enchants));
    }
  }
  return out;
}

/** Coffre en (x, y, z) : l'entité existante ou une nouvelle, vide. */
export function getChest(w: World, x: number, y: number, z: number): ChestEntity {
  const be = w.getBlockEntity(x, y, z) as (BlockEntity & { items?: unknown }) | undefined;
  if (be && be.type === 'chest') {
    const chest = be as ChestEntity;
    if (!Array.isArray(chest.items) || chest.items.length !== CHEST_SIZE) chest.items = fixSlots(be.items, CHEST_SIZE);
    return chest;
  }
  const chest: ChestEntity = { type: 'chest', x, y, z, items: new Array<Slot>(CHEST_SIZE).fill(null) };
  w.setBlockEntity(chest);
  return chest;
}

export function getFurnace(w: World, x: number, y: number, z: number): FurnaceEntity {
  const be = w.getBlockEntity(x, y, z) as (BlockEntity & Partial<FurnaceEntity>) | undefined;
  if (be && be.type === 'furnace') {
    const f = be as FurnaceEntity;
    if (!Array.isArray(f.items) || f.items.length !== 3) f.items = fixSlots(be.items, 3);
    f.burnTime = typeof f.burnTime === 'number' ? f.burnTime : 0;
    f.burnTotal = typeof f.burnTotal === 'number' ? f.burnTotal : 0;
    f.cookTime = typeof f.cookTime === 'number' ? f.cookTime : 0;
    return f;
  }
  const f: FurnaceEntity = { type: 'furnace', x, y, z, items: [null, null, null], burnTime: 0, burnTotal: 0, cookTime: 0 };
  w.setBlockEntity(f);
  return f;
}

function canSmelt(f: FurnaceEntity): boolean {
  const input = f.items[0];
  if (!input) return false;
  const result = smeltingResult(input.id);
  if (!result) return false;
  const out = f.items[2];
  if (!out) return true;
  return out.id === result.id && out.damage === 0 && out.count + result.count <= maxStack(out.id);
}

/** Un tick de fourneau : allumage, cuisson, bascule du bloc allumé / éteint. */
export function tickFurnace(w: World, f: FurnaceEntity): void {
  const wasLit = f.burnTime > 0;
  let dirty = false;
  if (f.burnTime > 0) f.burnTime--;

  const ready = canSmelt(f);
  if (f.burnTime === 0 && ready) {
    const fuel = f.items[1];
    const ticks = fuel ? fuelTicks(fuel.id) : 0;
    if (fuel && ticks > 0) {
      f.burnTime = f.burnTotal = ticks;
      if (fuel.id === I.LAVA_BUCKET) f.items[1] = { id: I.BUCKET, count: 1, damage: 0 };
      else if (--fuel.count <= 0) f.items[1] = null;
      dirty = true;
    }
  }

  if (f.burnTime > 0 && ready) {
    f.cookTime++;
    if (f.cookTime >= FURNACE_COOK_TICKS) {
      f.cookTime = 0;
      const input = f.items[0]!;
      const result = smeltingResult(input.id)!;
      const out = f.items[2];
      if (out) out.count += result.count;
      else f.items[2] = { id: result.id, count: result.count, damage: 0 };
      if (--input.count <= 0) f.items[0] = null;
      dirty = true;
    }
  } else if (f.cookTime > 0) {
    f.cookTime = ready ? Math.max(0, f.cookTime - 2) : 0;
  }

  const lit = f.burnTime > 0;
  if (lit !== wasLit) {
    const id = w.getBlock(f.x, f.y, f.z);
    if (id === B.FURNACE || id === B.FURNACE_LIT) {
      w.setBlock(f.x, f.y, f.z, lit ? B.FURNACE_LIT : B.FURNACE, w.getMeta(f.x, f.y, f.z), false);
    }
    dirty = true;
  }
  if (dirty || lit) w.markBlockEntityDirty(f);
}

/** Avance toutes les entités de bloc actives du monde. */
export function tickBlockEntities(w: World): void {
  for (const be of w.blockEntities.values()) {
    if (be.type === 'furnace') {
      const f = be as FurnaceEntity;
      if (f.burnTime > 0 || (f.items && f.items[0] && f.items[1])) tickFurnace(w, f);
      else if (f.cookTime > 0) f.cookTime = 0;
    }
  }
}

/** Piles contenues dans une entité de bloc (pour les lâcher quand le bloc est cassé). */
export function blockEntityItems(be: BlockEntity): ItemStack[] {
  const items = (be as BlockEntity & { items?: unknown }).items;
  const out: ItemStack[] = [];
  if (!Array.isArray(items)) return out;
  for (const s of items as Slot[]) {
    if (s && typeof s.id === 'number' && s.count > 0) out.push(s);
  }
  return out;
}
