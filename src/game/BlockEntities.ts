/**
 * Entités de bloc : contenu des coffres et état des fourneaux.
 * Ce sont des objets JSON purs (sauvegardés tels quels avec leur chunk).
 * Elles sont créées paresseusement, à la première ouverture du bloc.
 */
import { B, I } from '../world/Ids';
import { maxStack } from '../world/Items';
import { makeStack, sanitizeEnchants, type ItemStack, type Slot } from '../world/ItemStack';
import { generateLoot, isLootTable } from '../world/Loot';
import { brewResult, canBrewBottles } from '../world/Potions';
import { fuelTicks, smeltingResult } from '../world/Recipes';
import type { BlockEntity, World } from '../world/World';

export const CHEST_SIZE = 27;
export const FURNACE_COOK_TICKS = 200;

export interface ChestEntity extends BlockEntity {
  type: 'chest';
  items: Slot[];
  /** Coffre généré jamais ouvert : nom de sa table de butin (voir world/Loot). */
  loot?: string;
}

/** Générateur de monstres : espèce produite et ticks avant la prochaine vague. */
export interface SpawnerEntity extends BlockEntity {
  type: 'spawner';
  mob: string;
  delay: number;
}

/**
 * Tire le butin d'un coffre généré s'il ne l'a pas encore été (première ouverture, ou coffre
 * cassé sans avoir été ouvert). Retourne true si le contenu vient d'être créé.
 */
export function resolveLoot(be: BlockEntity, seed: number): boolean {
  const chest = be as BlockEntity & { loot?: unknown; items?: unknown };
  if (be.type !== 'chest' || chest.loot === undefined) return false;
  const table = chest.loot;
  delete chest.loot;
  if (!isLootTable(table)) return false;
  chest.items = generateLoot(table, seed, be.x, be.y, be.z, CHEST_SIZE);
  return true;
}

export const BREW_TICKS = 400;
export const BREW_FUEL_MAX = 20;

export interface BrewingStandEntity extends BlockEntity {
  type: 'brewing';
  /** 0..2 = fioles/potions, 3 = ingrédient, 4 = carburant (poudre de blaze). */
  items: Slot[];
  brewTime: number;
  fuel: number;
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
      const potion = typeof s.potion === 'string' && s.potion.length > 0 && s.potion.length <= 40 ? s.potion : undefined;
      out[i] = makeStack(s.id, s.count, typeof s.damage === 'number' ? s.damage : 0, sanitizeEnchants(s.enchants), potion);
    }
  }
  return out;
}

/** Coffre en (x, y, z) : l'entité existante ou une nouvelle, vide. */
export function getChest(w: World, x: number, y: number, z: number): ChestEntity {
  const be = w.getBlockEntity(x, y, z) as (BlockEntity & { items?: unknown }) | undefined;
  if (be && be.type === 'chest') {
    const chest = be as ChestEntity;
    if (resolveLoot(chest, w.seed)) w.markBlockEntityDirty(chest);
    if (!Array.isArray(chest.items) || chest.items.length !== CHEST_SIZE) chest.items = fixSlots(be.items, CHEST_SIZE);
    return chest;
  }
  const chest: ChestEntity = { type: 'chest', x, y, z, items: new Array<Slot>(CHEST_SIZE).fill(null) };
  w.setBlockEntity(chest);
  return chest;
}

/** Panneau : 4 lignes de texte. */
export interface SignEntity extends BlockEntity {
  type: 'sign';
  lines: string[];
}

/** Lignes d'un panneau (Minecraft : 4 lignes de 15 caractères au plus, sans caractère de contrôle). */
export const SIGN_LINES = 4;
export const SIGN_LINE_MAX = 15;

export function cleanSignLines(raw: unknown): string[] {
  const out: string[] = [];
  for (let i = 0; i < SIGN_LINES; i++) {
    const v = Array.isArray(raw) ? raw[i] : '';
    // eslint-disable-next-line no-control-regex
    out.push(typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u001f\u007f]/g, '')).slice(0, SIGN_LINE_MAX).join('') : '');
  }
  return out;
}

/** Panneau en (x, y, z) : l'entité existante (lignes vérifiées) ou une nouvelle, vide. */
export function getSign(w: World, x: number, y: number, z: number): SignEntity {
  const be = w.getBlockEntity(x, y, z) as (BlockEntity & { lines?: unknown }) | undefined;
  if (be && be.type === 'sign') {
    const sign = be as SignEntity;
    sign.lines = cleanSignLines(be.lines);
    return sign;
  }
  const sign: SignEntity = { type: 'sign', x, y, z, lines: cleanSignLines(null) };
  w.setBlockEntity(sign);
  return sign;
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

/** Alambic en (x, y, z) : l'entité existante ou une nouvelle, vide. */
export function getBrewingStand(w: World, x: number, y: number, z: number): BrewingStandEntity {
  const be = w.getBlockEntity(x, y, z) as (BlockEntity & { items?: unknown; brewTime?: unknown; fuel?: unknown }) | undefined;
  if (be && be.type === 'brewing') {
    const b = be as BrewingStandEntity;
    if (!Array.isArray(b.items) || b.items.length !== 5) b.items = fixSlots(be.items, 5);
    b.brewTime = typeof b.brewTime === 'number' && Number.isFinite(b.brewTime) ? Math.max(0, b.brewTime) : 0;
    b.fuel = typeof b.fuel === 'number' && Number.isFinite(b.fuel) ? Math.max(0, b.fuel) : 0;
    return b;
  }
  const b: BrewingStandEntity = {
    type: 'brewing',
    x,
    y,
    z,
    items: new Array<Slot>(5).fill(null),
    brewTime: 0,
    fuel: 0,
  };
  w.setBlockEntity(b);
  return b;
}

function tickBrewingStand(w: World, b: BrewingStandEntity): void {
  let dirty = false;
  if (b.fuel <= 0 && b.items[4]?.id === I.BLAZE_POWDER) {
    b.fuel = BREW_FUEL_MAX;
    if (--b.items[4]!.count <= 0) b.items[4] = null;
    dirty = true;
  }
  const ing = b.items[3];
  const ready = b.fuel > 0 && !!ing && canBrewBottles(b.items, ing.id);
  if (ready && ing) {
    b.brewTime++;
    dirty = true;
    if (b.brewTime >= BREW_TICKS) {
      b.brewTime = 0;
      b.fuel--;
      for (let i = 0; i < 3; i++) {
        const res = brewResult(b.items[i], ing.id);
        if (res) b.items[i] = res;
      }
      if (--ing.count <= 0) b.items[3] = null;
    }
  } else if (b.brewTime > 0) {
    b.brewTime = 0;
    dirty = true;
  }
  if (dirty) w.markBlockEntityDirty(b);
}

/** Avance toutes les entités de bloc actives du monde. */
export function tickBlockEntities(w: World): void {
  for (const be of w.blockEntities.values()) {
    if (be.type === 'furnace') {
      const f = be as FurnaceEntity;
      if (f.burnTime > 0 || (f.items && f.items[0] && f.items[1])) tickFurnace(w, f);
      else if (f.cookTime > 0) f.cookTime = 0;
    } else if (be.type === 'brewing') {
      const b = be as BrewingStandEntity;
      if (b.brewTime > 0 || (b.items && (b.items[3] || b.items[4]))) tickBrewingStand(w, b);
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
