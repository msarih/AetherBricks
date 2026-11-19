/**
 * Entités de bloc : contenu des coffres et état des fourneaux.
 * Ce sont des objets JSON purs (sauvegardés tels quels avec leur chunk).
 * Elles sont créées paresseusement, à la première ouverture du bloc.
 */
import { B, I } from '../world/Ids';
import { PISTON_DX, PISTON_DY, PISTON_DZ } from '../world/Blocks';
import { maxStack } from '../world/Items';
import { canMerge, cloneStackWithCount, makeStack, sanitizeEnchants, type ItemStack, type Slot } from '../world/ItemStack';
import { generateLoot, isLootTable } from '../world/Loot';
import { brewResult, canBrewBottles } from '../world/Potions';
import { fuelTicks, smeltingResult } from '../world/Recipes';
import { computeDaylightPower, updateRedstoneAround } from '../world/Redstone';
import type { BlockEntity, World } from '../world/World';

export const CHEST_SIZE = 27;
export const HOPPER_SIZE = 5;
export const DISPENSER_SIZE = 9;
export const HOPPER_COOLDOWN = 8;
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

export interface JukeboxEntity extends BlockEntity {
  type: 'jukebox';
  /** Identifiant de l'objet disque inséré (0 = vide). */
  disc: number;
}

export function getJukebox(w: World, x: number, y: number, z: number): JukeboxEntity {
  const be = w.getBlockEntity(x, y, z) as (BlockEntity & { disc?: unknown }) | undefined;
  if (be && be.type === 'jukebox') {
    const jb = be as JukeboxEntity;
    jb.disc = typeof jb.disc === 'number' && jb.disc > 0 ? Math.floor(jb.disc) : 0;
    return jb;
  }
  const jb: JukeboxEntity = { type: 'jukebox', x, y, z, disc: 0 };
  w.setBlockEntity(jb);
  return jb;
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

export interface HopperEntity extends BlockEntity {
  type: 'hopper';
  items: Slot[];
  cooldown: number;
}

export interface DispenserEntity extends BlockEntity {
  type: 'dispenser' | 'dropper';
  items: Slot[];
}

export interface DaylightEntity extends BlockEntity {
  type: 'daylight';
}

export function getHopper(w: World, x: number, y: number, z: number): HopperEntity {
  const be = w.getBlockEntity(x, y, z) as (BlockEntity & Partial<HopperEntity>) | undefined;
  if (be && be.type === 'hopper') {
    const h = be as HopperEntity;
    if (!Array.isArray(h.items) || h.items.length !== HOPPER_SIZE) h.items = fixSlots(be.items, HOPPER_SIZE);
    h.cooldown = typeof h.cooldown === 'number' && Number.isFinite(h.cooldown) ? Math.max(0, h.cooldown) : 0;
    return h;
  }
  const h: HopperEntity = { type: 'hopper', x, y, z, items: new Array<Slot>(HOPPER_SIZE).fill(null), cooldown: 0 };
  w.setBlockEntity(h);
  return h;
}

export function getDispenser(w: World, x: number, y: number, z: number, kind: 'dispenser' | 'dropper'): DispenserEntity {
  const be = w.getBlockEntity(x, y, z) as (BlockEntity & Partial<DispenserEntity>) | undefined;
  if (be && (be.type === 'dispenser' || be.type === 'dropper')) {
    const d = be as DispenserEntity;
    d.type = kind;
    if (!Array.isArray(d.items) || d.items.length !== DISPENSER_SIZE) d.items = fixSlots(be.items, DISPENSER_SIZE);
    return d;
  }
  const d: DispenserEntity = { type: kind, x, y, z, items: new Array<Slot>(DISPENSER_SIZE).fill(null) };
  w.setBlockEntity(d);
  return d;
}

export function getDaylight(w: World, x: number, y: number, z: number): DaylightEntity {
  const be = w.getBlockEntity(x, y, z);
  if (be && be.type === 'daylight') return be as DaylightEntity;
  const d: DaylightEntity = { type: 'daylight', x, y, z };
  w.setBlockEntity(d);
  return d;
}

function targetSlotsForInsert(dstId: number, dstLen: number, stack: ItemStack, fromDir: number): number[] {
  if (dstId === B.FURNACE || dstId === B.FURNACE_LIT) {
    if (fromDir === 1) return [0];
    if (fuelTicks(stack.id) > 0 || stack.id === I.BUCKET) return [1];
    return [];
  }
  if (dstId === B.BREWING_STAND) {
    if (fromDir === 1) return [3];
    return [0, 1, 2, 4];
  }
  const out: number[] = [];
  for (let i = 0; i < dstLen; i++) out.push(i);
  return out;
}

/** Tente d'insérer 1 exemplaire de `stack` dans le conteneur en (tx, ty, tz) ; décrémente `stack.count`. */
export function insertOneIntoContainer(w: World, tx: number, ty: number, tz: number, stack: ItemStack, fromDir: number): boolean {
  const dstId = w.getBlock(tx, ty, tz);
  let dstBe: BlockEntity | null = null;
  let dstSlots: Slot[] | null = null;
  if (dstId === B.CHEST) { const c = getChest(w, tx, ty, tz); dstBe = c; dstSlots = c.items; }
  else if (dstId === B.HOPPER) { const h = getHopper(w, tx, ty, tz); dstBe = h; dstSlots = h.items; }
  else if (dstId === B.DISPENSER) { const d = getDispenser(w, tx, ty, tz, 'dispenser'); dstBe = d; dstSlots = d.items; }
  else if (dstId === B.DROPPER) { const d = getDispenser(w, tx, ty, tz, 'dropper'); dstBe = d; dstSlots = d.items; }
  else if (dstId === B.FURNACE || dstId === B.FURNACE_LIT) { const f = getFurnace(w, tx, ty, tz); dstBe = f; dstSlots = f.items; }
  else if (dstId === B.BREWING_STAND) { const b = getBrewingStand(w, tx, ty, tz); dstBe = b; dstSlots = b.items; }
  if (!dstBe || !dstSlots) return false;

  const indices = targetSlotsForInsert(dstId, dstSlots.length, stack, fromDir);
  if (indices.length === 0) return false;
  const max = maxStack(stack.id);

  for (const idx of indices) {
    const s = dstSlots[idx];
    if (s && canMerge(s, stack) && s.count < max) {
      s.count++;
      stack.count--;
      w.markBlockEntityDirty(dstBe);
      updateRedstoneAround(w, tx, ty, tz);
      return true;
    }
  }
  for (const idx of indices) {
    if (!dstSlots[idx]) {
      dstSlots[idx] = cloneStackWithCount(stack, 1);
      stack.count--;
      w.markBlockEntityDirty(dstBe);
      updateRedstoneAround(w, tx, ty, tz);
      return true;
    }
  }
  return false;
}

function sourceContainer(w: World, sx: number, sy: number, sz: number): { be: BlockEntity; slots: Slot[]; indices: number[] } | null {
  const id = w.getBlock(sx, sy, sz);
  if (id === B.CHEST) { const c = getChest(w, sx, sy, sz); return { be: c, slots: c.items, indices: c.items.map((_, i) => i) }; }
  if (id === B.HOPPER) { const h = getHopper(w, sx, sy, sz); return { be: h, slots: h.items, indices: h.items.map((_, i) => i) }; }
  if (id === B.DISPENSER) { const d = getDispenser(w, sx, sy, sz, 'dispenser'); return { be: d, slots: d.items, indices: d.items.map((_, i) => i) }; }
  if (id === B.DROPPER) { const d = getDispenser(w, sx, sy, sz, 'dropper'); return { be: d, slots: d.items, indices: d.items.map((_, i) => i) }; }
  if (id === B.FURNACE || id === B.FURNACE_LIT) {
    const f = getFurnace(w, sx, sy, sz);
    const idx = [2];
    if (f.items[1]?.id === I.BUCKET) idx.push(1);
    return { be: f, slots: f.items, indices: idx };
  }
  if (id === B.BREWING_STAND) { const b = getBrewingStand(w, sx, sy, sz); return { be: b, slots: b.items, indices: [0, 1, 2] }; }
  return null;
}

function tickHopper(w: World, h: HopperEntity): void {
  if (h.cooldown > 0) h.cooldown--;
  if (h.cooldown > 0) return;
  const v = w.getBlockAndMeta(h.x, h.y, h.z);
  if ((v & 255) !== B.HOPPER) return;
  const meta = v >> 8;
  if (meta & 8) return; // verrouillé par signal de redstone

  let moved = false;
  const dir = Math.min(5, Math.max(1, meta & 7));
  const tx = h.x + PISTON_DX[dir];
  const ty = h.y + PISTON_DY[dir];
  const tz = h.z + PISTON_DZ[dir];

  // 1. Pousser 1 objet vers le conteneur visé
  for (let i = 0; i < h.items.length; i++) {
    const s = h.items[i];
    if (!s || s.count <= 0) continue;
    if (insertOneIntoContainer(w, tx, ty, tz, s, dir)) {
      if (s.count <= 0) h.items[i] = null;
      moved = true;
      break;
    }
  }

  // 2. Aspirer 1 objet depuis le conteneur au-dessus (ou objet au sol au-dessus)
  const src = sourceContainer(w, h.x, h.y + 1, h.z);
  if (src) {
    for (const i of src.indices) {
      const s = src.slots[i];
      if (!s || s.count <= 0) continue;
      if (insertOneIntoContainer(w, h.x, h.y, h.z, s, 1)) {
        if (s.count <= 0) src.slots[i] = null;
        w.markBlockEntityDirty(src.be);
        updateRedstoneAround(w, h.x, h.y + 1, h.z);
        moved = true;
        break;
      }
    }
  } else if (w.host.pullItemForHopper) {
    const picked = w.host.pullItemForHopper(h.x, h.y, h.z, (raw) => {
      const tmp = makeStack(raw.id, 1, raw.damage, sanitizeEnchants(raw.enchants), raw.potion);
      if (!insertOneIntoContainer(w, h.x, h.y, h.z, tmp, 1)) return false;
      raw.count--;
      return true;
    });
    if (picked) moved = true;
  }

  if (moved) {
    h.cooldown = HOPPER_COOLDOWN;
    w.markBlockEntityDirty(h);
    updateRedstoneAround(w, h.x, h.y, h.z);
  }
}

function tickDaylight(w: World, d: DaylightEntity): void {
  const v = w.getBlockAndMeta(d.x, d.y, d.z);
  if ((v & 255) !== B.DAYLIGHT_DETECTOR) return;
  const meta = v >> 8;
  const next = computeDaylightPower(w, d.x, d.y, d.z, (meta & 16) !== 0);
  if (next !== (meta & 15)) {
    w.setMeta(d.x, d.y, d.z, (meta & 16) | next, false);
    w.notifyNeighbors(d.x, d.y, d.z);
    updateRedstoneAround(w, d.x, d.y, d.z);
  }
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
    } else if (be.type === 'hopper') {
      tickHopper(w, be as HopperEntity);
    } else if (be.type === 'daylight') {
      tickDaylight(w, be as DaylightEntity);
    }
  }
}

/** Piles contenues dans une entité de bloc (pour les lâcher quand le bloc est cassé). */
export function blockEntityItems(be: BlockEntity): ItemStack[] {
  const out: ItemStack[] = [];
  if (be.type === 'jukebox') {
    const disc = (be as JukeboxEntity).disc;
    if (typeof disc === 'number' && disc > 0) out.push(makeStack(disc, 1));
    return out;
  }
  const items = (be as BlockEntity & { items?: unknown }).items;
  if (!Array.isArray(items)) return out;
  for (const s of items as Slot[]) {
    if (s && typeof s.id === 'number' && s.count > 0) out.push(s);
  }
  return out;
}
