/**
 * Inventaire du joueur et « menus » (inventaire, établi, coffre, fourneau, créatif).
 * Toute la logique des clics sur les cases est ici, sans aucune dépendance au DOM :
 * l'interface ne fait qu'afficher les cases et transmettre les clics.
 */
import { I } from '../world/Ids';
import { getItem, maxStack } from '../world/Items';
import { addToSlots, canMerge, loadSlots, maxDamage, saveSlots, type ItemStack, type Slot } from '../world/ItemStack';
import { fuelTicks, matchRecipe, smeltingResult } from '../world/Recipes';
import { FURNACE_COOK_TICKS, type ChestEntity, type FurnaceEntity } from './BlockEntities';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;

export class Inventory {
  /** 0..8 : barre d'objets ; 9..35 : sac. */
  slots: Slot[] = new Array<Slot>(INVENTORY_SIZE).fill(null);
  /** 0 casque, 1 plastron, 2 jambières, 3 bottes. */
  armor: Slot[] = new Array<Slot>(4).fill(null);
  /** Case sélectionnée de la barre d'objets. */
  selected = 0;
  /** Pile tenue par le curseur dans un menu. */
  cursor: Slot = null;
  /** Lâche une pile dans le monde (branché par le joueur). */
  drop: (stack: ItemStack) => void = () => {};

  get held(): Slot {
    return this.slots[this.selected];
  }

  get heldId(): number {
    const s = this.slots[this.selected];
    return s ? s.id : 0;
  }

  /** Range la pile (barre d'abord, puis sac). Retourne ce qui n'a pas pu l'être ; `stack.count` est mis à jour. */
  add(stack: ItemStack): number {
    return addToSlots(this.slots, stack, 0, INVENTORY_SIZE);
  }

  /** Donne des objets ; ce qui ne rentre pas est lâché au sol. */
  give(id: number, count: number, damage = 0): void {
    const max = maxStack(id);
    while (count > 0) {
      const n = Math.min(max, count);
      count -= n;
      const stack = { id, count: n, damage };
      if (this.add(stack) > 0) this.drop(stack);
    }
  }

  /** Retire `count` objets de la pile tenue. */
  consumeHeld(count = 1): void {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= count;
    if (s.count <= 0) this.slots[this.selected] = null;
  }

  /** Use l'objet tenu. Retourne true s'il vient de se briser. */
  damageHeld(amount = 1): boolean {
    const s = this.slots[this.selected];
    if (!s) return false;
    const max = maxDamage(s.id);
    if (max <= 0) return false;
    s.damage += amount;
    if (s.damage >= max) {
      this.slots[this.selected] = null;
      return true;
    }
    return false;
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Retire jusqu'à `count` objets du type donné. Retourne le nombre réellement retiré. */
  remove(id: number, count: number): number {
    let left = count;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const n = Math.min(s.count, left);
      s.count -= n;
      left -= n;
      if (s.count <= 0) this.slots[i] = null;
    }
    return count - left;
  }

  /** Première case contenant l'objet (-1 si absent). */
  find(id: number, from = 0, to = INVENTORY_SIZE): number {
    for (let i = from; i < to; i++) {
      const s = this.slots[i];
      if (s && s.id === id) return i;
    }
    return -1;
  }

  /** Points d'armure portés (0..20). */
  armorPoints(): number {
    let n = 0;
    for (const s of this.armor) if (s) n += getItem(s.id).armor;
    return n;
  }

  /** Use chaque pièce d'armure portée. Retourne true si une pièce s'est brisée. */
  damageArmor(amount: number): boolean {
    let broke = false;
    for (let i = 0; i < 4; i++) {
      const s = this.armor[i];
      if (!s) continue;
      const max = maxDamage(s.id);
      if (max <= 0) continue;
      s.damage += amount;
      if (s.damage >= max) {
        this.armor[i] = null;
        broke = true;
      }
    }
    return broke;
  }

  /** Toutes les piles (pour les lâcher à la mort), puis vide l'inventaire. */
  takeAll(): ItemStack[] {
    const out: ItemStack[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s) out.push(s);
      this.slots[i] = null;
    }
    for (let i = 0; i < 4; i++) {
      const s = this.armor[i];
      if (s) out.push(s);
      this.armor[i] = null;
    }
    if (this.cursor) out.push(this.cursor);
    this.cursor = null;
    return out;
  }

  clear(): void {
    this.slots.fill(null);
    this.armor.fill(null);
    this.cursor = null;
  }

  save(): Record<string, unknown> {
    return { slots: saveSlots(this.slots), armor: saveSlots(this.armor), selected: this.selected };
  }

  load(data: unknown): void {
    const d = (data ?? {}) as Record<string, unknown>;
    this.slots = loadSlots(d.slots, INVENTORY_SIZE);
    this.armor = loadSlots(d.armor, 4);
    this.selected = typeof d.selected === 'number' && d.selected >= 0 && d.selected < HOTBAR_SIZE ? d.selected | 0 : 0;
    this.cursor = null;
  }
}

// ============================================================================================ menus

export type SlotGroup = 'hotbar' | 'main' | 'armor' | 'craft' | 'result' | 'container' | 'input' | 'fuel' | 'output';
export type MenuType = 'inventory' | 'crafting' | 'chest' | 'furnace' | 'creative';

/** Une case d'un menu : vue sur un élément d'un tableau de piles. */
export class MenuSlot {
  constructor(
    /** Zone de l'écran à laquelle la case appartient. */
    readonly group: SlotGroup,
    /** Rang de la case dans sa zone (ligne par ligne). */
    readonly index: number,
    private readonly list: Slot[],
    private readonly at: number,
    /** On ne peut qu'y prendre (résultat de fabrication, sortie du fourneau). */
    readonly takeOnly = false,
    /** Objets acceptés (null = tous). */
    private readonly filter: ((s: ItemStack) => boolean) | null = null,
    /** Taille maximale de la pile dans cette case. */
    readonly limit = 64,
  ) {}

  get stack(): Slot {
    return this.list[this.at];
  }

  set stack(s: Slot) {
    this.list[this.at] = s && s.count > 0 ? s : null;
  }

  accepts(s: ItemStack): boolean {
    if (this.takeOnly) return false;
    return this.filter ? this.filter(s) : true;
  }

  /** Nombre d'exemplaires de `s` que la case peut encore recevoir. */
  room(s: ItemStack): number {
    if (!this.accepts(s)) return 0;
    const max = Math.min(maxStack(s.id), this.limit);
    const cur = this.stack;
    if (!cur) return max;
    return canMerge(cur, s) ? Math.max(0, max - cur.count) : 0;
  }
}

/** Les seaux pleins rendent un seau vide quand ils servent d'ingrédient. */
function craftingRemainder(id: number): number {
  return id === I.WATER_BUCKET || id === I.LAVA_BUCKET || id === I.MILK_BUCKET ? I.BUCKET : 0;
}

export abstract class Menu {
  abstract readonly type: MenuType;
  abstract readonly title: string;
  readonly slots: MenuSlot[] = [];
  /** Grille de fabrication éventuelle. */
  protected grid: Slot[] | null = null;
  protected gridW = 0;
  protected readonly result: Slot[] = [null];

  constructor(readonly inv: Inventory) {}

  // ------------------------------------------------------------------ construction

  protected addSlot(group: SlotGroup, index: number, list: Slot[], at: number, takeOnly = false, filter: ((s: ItemStack) => boolean) | null = null, limit = 64): void {
    this.slots.push(new MenuSlot(group, index, list, at, takeOnly, filter, limit));
  }

  /** Les 27 cases du sac puis les 9 de la barre. */
  protected addPlayerSlots(): void {
    for (let i = 0; i < 27; i++) this.addSlot('main', i, this.inv.slots, 9 + i);
    for (let i = 0; i < 9; i++) this.addSlot('hotbar', i, this.inv.slots, i);
  }

  protected addArmorSlots(): void {
    for (let i = 0; i < 4; i++) this.addSlot('armor', i, this.inv.armor, i, false, (s) => getItem(s.id).armorSlot === i, 1);
  }

  protected addCraftSlots(w: number): void {
    this.grid = new Array<Slot>(w * w).fill(null);
    this.gridW = w;
    for (let i = 0; i < w * w; i++) this.addSlot('craft', i, this.grid, i);
    this.addSlot('result', 0, this.result, 0, true);
  }

  /** Cases d'une zone, dans l'ordre. */
  group(...groups: SlotGroup[]): MenuSlot[] {
    const out: MenuSlot[] = [];
    for (const g of groups) for (const s of this.slots) if (s.group === g) out.push(s);
    return out;
  }

  /** Indice dans `slots` de la case (zone, rang), ou -1. */
  indexOf(group: SlotGroup, index: number): number {
    return this.slots.findIndex((s) => s.group === group && s.index === index);
  }

  // ------------------------------------------------------------------ fabrication

  private updateResult(): void {
    if (!this.grid) return;
    const ids = this.grid.map((s) => (s ? s.id : 0));
    const r = matchRecipe(ids, this.gridW);
    this.result[0] = r ? { id: r.id, count: r.count, damage: 0 } : null;
  }

  /** Consomme un exemplaire de chaque ingrédient. */
  private consumeIngredients(): void {
    if (!this.grid) return;
    for (let i = 0; i < this.grid.length; i++) {
      const s = this.grid[i];
      if (!s) continue;
      const rest = craftingRemainder(s.id);
      if (--s.count <= 0) this.grid[i] = rest ? { id: rest, count: 1, damage: 0 } : null;
      else if (rest) this.inv.give(rest, 1);
    }
    this.updateResult();
  }

  /** À appeler après toute modification des cases. */
  protected changed(): void {
    this.updateResult();
  }

  // ------------------------------------------------------------------ clics

  /**
   * Clic sur la case d'indice `i` (dans `slots`). `button` : 0 gauche, 1 droit.
   * Avec `shift`, la pile est déplacée d'un coup vers la zone opposée.
   */
  click(i: number, button: number, shift: boolean): void {
    const slot = this.slots[i];
    if (!slot) return;
    if (shift) {
      if (slot.group === 'result') this.quickCraft(slot);
      else if (slot.stack) this.quickMove(slot);
      this.changed();
      return;
    }
    const inv = this.inv;
    const cur = inv.cursor;
    const s = slot.stack;

    if (slot.takeOnly) {
      if (!s) return;
      if (!cur) {
        if (slot.group !== 'result' && button === 1 && s.count > 1) {
          const n = Math.ceil(s.count / 2);
          inv.cursor = { id: s.id, count: n, damage: s.damage };
          s.count -= n;
        } else {
          inv.cursor = { id: s.id, count: s.count, damage: s.damage };
          slot.stack = null;
          if (slot.group === 'result') this.consumeIngredients();
        }
      } else if (canMerge(cur, s) && cur.count + s.count <= maxStack(cur.id)) {
        cur.count += s.count;
        slot.stack = null;
        if (slot.group === 'result') this.consumeIngredients();
      }
      this.changed();
      return;
    }

    if (!cur) {
      if (!s) return;
      if (button === 1 && s.count > 1) {
        const n = Math.ceil(s.count / 2);
        inv.cursor = { id: s.id, count: n, damage: s.damage };
        s.count -= n;
      } else {
        inv.cursor = s;
        slot.stack = null;
      }
    } else if (!s) {
      if (!slot.accepts(cur)) return;
      const n = Math.min(button === 1 ? 1 : cur.count, slot.room(cur));
      if (n <= 0) return;
      slot.stack = { id: cur.id, count: n, damage: cur.damage };
      cur.count -= n;
      if (cur.count <= 0) inv.cursor = null;
    } else if (canMerge(s, cur)) {
      const n = Math.min(button === 1 ? 1 : cur.count, slot.room(cur));
      if (n <= 0) return;
      s.count += n;
      cur.count -= n;
      if (cur.count <= 0) inv.cursor = null;
    } else {
      // échange
      if (!slot.accepts(cur) || cur.count > slot.limit) return;
      slot.stack = cur;
      inv.cursor = s;
    }
    this.changed();
  }

  /** Clic hors de la fenêtre : lâche la pile du curseur (clic droit : un seul objet). */
  clickOutside(button: number): void {
    const cur = this.inv.cursor;
    if (!cur) return;
    if (button === 1 && cur.count > 1) {
      cur.count--;
      this.inv.drop({ id: cur.id, count: 1, damage: cur.damage });
    } else {
      this.inv.cursor = null;
      this.inv.drop(cur);
    }
  }

  /** Double clic : rassemble sur le curseur les objets identiques de toutes les cases. */
  doubleClick(_i: number): void {
    const cur = this.inv.cursor;
    if (!cur) return;
    const max = maxStack(cur.id);
    if (max <= 1) return;
    // d'abord les piles incomplètes, puis les pleines
    for (let pass = 0; pass < 2 && cur.count < max; pass++) {
      for (const slot of this.slots) {
        if (cur.count >= max) break;
        if (slot.takeOnly) continue;
        const s = slot.stack;
        if (!s || !canMerge(s, cur)) continue;
        if (pass === 0 && s.count >= max) continue;
        const n = Math.min(s.count, max - cur.count);
        cur.count += n;
        s.count -= n;
        if (s.count <= 0) slot.stack = null;
      }
    }
    this.changed();
  }

  /** Touche 1..9 au-dessus d'une case : échange avec la case `hotbar` (0..8) de la barre. */
  numberKey(i: number, hotbar: number): void {
    const slot = this.slots[i];
    if (!slot || hotbar < 0 || hotbar >= HOTBAR_SIZE) return;
    const inv = this.inv;
    const h = inv.slots[hotbar];
    const s = slot.stack;
    if (slot.takeOnly) {
      if (!s || h) return;
      inv.slots[hotbar] = { id: s.id, count: s.count, damage: s.damage };
      slot.stack = null;
      if (slot.group === 'result') this.consumeIngredients();
    } else {
      if (slot.group === 'hotbar' && slot.index === hotbar) return;
      if (h && (!slot.accepts(h) || h.count > slot.limit)) return;
      slot.stack = h;
      inv.slots[hotbar] = s;
    }
    this.changed();
  }

  /** Touche « lâcher » au-dessus d'une case : un objet, ou toute la pile avec `all`. */
  dropKey(i: number, all: boolean): void {
    const slot = this.slots[i];
    const s = slot?.stack;
    if (!slot || !s) return;
    if (slot.group === 'result') {
      this.inv.drop({ id: s.id, count: s.count, damage: s.damage });
      slot.stack = null;
      this.consumeIngredients();
    } else if (all || s.count <= 1) {
      slot.stack = null;
      this.inv.drop(s);
    } else {
      s.count--;
      this.inv.drop({ id: s.id, count: 1, damage: s.damage });
    }
    this.changed();
  }

  /**
   * Glisser avec le bouton enfoncé au-dessus de plusieurs cases : répartit la pile du curseur
   * (bouton gauche : à parts égales ; bouton droit : un objet par case).
   */
  drag(indices: readonly number[], button: number): void {
    const cur = this.inv.cursor;
    if (!cur) return;
    const targets: MenuSlot[] = [];
    for (const i of indices) {
      const slot = this.slots[i];
      if (slot && !targets.includes(slot) && slot.room(cur) > 0) targets.push(slot);
    }
    if (targets.length === 0) return;
    const each = button === 1 ? 1 : Math.max(1, Math.floor(cur.count / targets.length));
    for (const slot of targets) {
      if (cur.count <= 0) break;
      const n = Math.min(each, slot.room(cur), cur.count);
      if (n <= 0) continue;
      const s = slot.stack;
      if (s) s.count += n;
      else slot.stack = { id: cur.id, count: n, damage: cur.damage };
      cur.count -= n;
    }
    if (cur.count <= 0) this.inv.cursor = null;
    this.changed();
  }

  // ------------------------------------------------------------------ déplacements rapides

  /** Destination d'un maj-clic sur `slot` (propre à chaque menu). */
  protected abstract quickMove(slot: MenuSlot): void;

  /** Déplace la pile de `from` vers les cases cibles (fusion d'abord, puis cases vides). Retourne true si quelque chose a bougé. */
  protected transfer(from: MenuSlot, targets: MenuSlot[]): boolean {
    const s = from.stack;
    if (!s) return false;
    const before = s.count;
    this.pour(s, targets);
    if (s.count <= 0) from.stack = null;
    return s.count < before;
  }

  /** Verse `s` dans les cases cibles ; `s.count` est mis à jour. */
  protected pour(s: ItemStack, targets: MenuSlot[]): void {
    for (const t of targets) {
      if (s.count <= 0) return;
      const ts = t.stack;
      if (!ts || !canMerge(ts, s)) continue;
      const n = Math.min(t.room(s), s.count);
      if (n <= 0) continue;
      ts.count += n;
      s.count -= n;
    }
    for (const t of targets) {
      if (s.count <= 0) return;
      if (t.stack) continue;
      const n = Math.min(t.room(s), s.count);
      if (n <= 0) continue;
      t.stack = { id: s.id, count: n, damage: s.damage };
      s.count -= n;
    }
  }

  private capacity(s: ItemStack, targets: MenuSlot[]): number {
    let n = 0;
    for (const t of targets) n += t.room(s);
    return n;
  }

  /** Maj-clic sur le résultat : fabrique autant que possible, directement dans l'inventaire. */
  private quickCraft(slot: MenuSlot): void {
    const targets = this.group('hotbar', 'main').reverse();
    const first = slot.stack;
    if (!first) return;
    for (let guard = 0; guard < 64; guard++) {
      const s = slot.stack;
      if (!s || s.id !== first.id) break;
      if (this.capacity(s, targets) < s.count) break;
      this.pour({ id: s.id, count: s.count, damage: s.damage }, targets);
      slot.stack = null;
      this.consumeIngredients();
    }
  }

  // ------------------------------------------------------------------ fermeture

  /** Ferme le menu : la grille de fabrication et le curseur retournent dans l'inventaire (ou tombent au sol). */
  close(): void {
    const inv = this.inv;
    if (this.grid) {
      for (let i = 0; i < this.grid.length; i++) {
        const s = this.grid[i];
        if (!s) continue;
        this.grid[i] = null;
        if (inv.add(s) > 0) inv.drop(s);
      }
      this.result[0] = null;
    }
    const cur = inv.cursor;
    if (cur) {
      inv.cursor = null;
      if (inv.add(cur) > 0) inv.drop(cur);
    }
  }
}

/** Inventaire de survie : fabrication 2×2, armure, sac et barre. */
export class InventoryMenu extends Menu {
  readonly type: MenuType = 'inventory';
  readonly title = 'Inventaire';

  constructor(inv: Inventory) {
    super(inv);
    this.addCraftSlots(2);
    this.addArmorSlots();
    this.addPlayerSlots();
  }

  protected quickMove(slot: MenuSlot): void {
    const s = slot.stack;
    if (!s) return;
    if (slot.group === 'craft' || slot.group === 'armor') {
      this.transfer(slot, this.group('main', 'hotbar'));
      return;
    }
    const armorSlot = getItem(s.id).armorSlot;
    if (armorSlot >= 0 && this.transfer(slot, this.group('armor'))) return;
    this.transfer(slot, this.group(slot.group === 'main' ? 'hotbar' : 'main'));
  }
}

/** Établi : fabrication 3×3. */
export class CraftingMenu extends Menu {
  readonly type: MenuType = 'crafting';
  readonly title = 'Fabrication';

  constructor(inv: Inventory) {
    super(inv);
    this.addCraftSlots(3);
    this.addPlayerSlots();
  }

  protected quickMove(slot: MenuSlot): void {
    if (slot.group === 'craft') this.transfer(slot, this.group('main', 'hotbar'));
    else this.transfer(slot, this.group(slot.group === 'main' ? 'hotbar' : 'main'));
  }
}

/** Coffre : 27 cases. */
export class ChestMenu extends Menu {
  readonly type: MenuType = 'chest';
  readonly title = 'Coffre';

  constructor(
    inv: Inventory,
    readonly chest: ChestEntity,
    /** Signale que le contenu a changé (pour la sauvegarde). */
    private readonly onChange: () => void,
  ) {
    super(inv);
    for (let i = 0; i < chest.items.length; i++) this.addSlot('container', i, chest.items, i);
    this.addPlayerSlots();
  }

  protected changed(): void {
    this.onChange();
  }

  protected quickMove(slot: MenuSlot): void {
    if (slot.group === 'container') this.transfer(slot, this.group('hotbar', 'main').reverse());
    else this.transfer(slot, this.group('container'));
  }
}

/** Fourneau : à cuire, combustible, résultat. */
export class FurnaceMenu extends Menu {
  readonly type: MenuType = 'furnace';
  readonly title = 'Fourneau';

  constructor(
    inv: Inventory,
    readonly furnace: FurnaceEntity,
    private readonly onChange: () => void,
  ) {
    super(inv);
    this.addSlot('input', 0, furnace.items, 0);
    this.addSlot('fuel', 0, furnace.items, 1, false, (s) => fuelTicks(s.id) > 0 || s.id === I.BUCKET);
    this.addSlot('output', 0, furnace.items, 2, true);
    this.addPlayerSlots();
  }

  /** Flamme : part restante du combustible en cours (0..1). */
  get burnProgress(): number {
    const f = this.furnace;
    return f.burnTime > 0 && f.burnTotal > 0 ? f.burnTime / f.burnTotal : 0;
  }

  /** Flèche : avancement de la cuisson (0..1). */
  get cookProgress(): number {
    return Math.min(1, this.furnace.cookTime / FURNACE_COOK_TICKS);
  }

  protected changed(): void {
    this.onChange();
  }

  protected quickMove(slot: MenuSlot): void {
    const s = slot.stack;
    if (!s) return;
    if (slot.group === 'input' || slot.group === 'fuel' || slot.group === 'output') {
      this.transfer(slot, this.group('hotbar', 'main').reverse());
      return;
    }
    if (smeltingResult(s.id) && this.transfer(slot, this.group('input'))) return;
    if (fuelTicks(s.id) > 0 && this.transfer(slot, this.group('fuel'))) return;
    this.transfer(slot, this.group(slot.group === 'main' ? 'hotbar' : 'main'));
  }
}

/**
 * Inventaire créatif : la palette des objets n'est pas faite de cases ; l'interface
 * affiche CREATIVE_TABS et appelle paletteClick(). Les cases du joueur restent normales.
 */
export class CreativeMenu extends Menu {
  readonly type: MenuType = 'creative';
  readonly title = 'Inventaire créatif';

  constructor(inv: Inventory) {
    super(inv);
    this.addArmorSlots();
    this.addPlayerSlots();
  }

  /** Clic sur un objet de la palette. */
  paletteClick(itemId: number, button: number, shift: boolean): void {
    const inv = this.inv;
    const cur = inv.cursor;
    const max = maxStack(itemId);
    if (shift) {
      // une pile entière directement dans la barre (ou le sac)
      inv.add({ id: itemId, count: max, damage: 0 });
      return;
    }
    if (!cur) {
      inv.cursor = { id: itemId, count: button === 2 ? max : 1, damage: 0 };
    } else if (cur.id === itemId && cur.damage === 0 && max > 1) {
      if (button === 1) {
        if (--cur.count <= 0) inv.cursor = null;
      } else {
        cur.count = button === 2 ? max : Math.min(max, cur.count + 1);
      }
    } else {
      // un autre objet sur le curseur : la palette l'avale
      inv.cursor = null;
    }
  }

  /** Clic sur la corbeille : détruit la pile du curseur ; avec maj, vide tout l'inventaire. */
  trashClick(shift: boolean): void {
    if (shift) this.inv.clear();
    else this.inv.cursor = null;
  }

  clickOutside(button: number): void {
    super.clickOutside(button);
  }

  protected quickMove(slot: MenuSlot): void {
    const s = slot.stack;
    if (!s) return;
    if (slot.group === 'armor') {
      this.transfer(slot, this.group('hotbar', 'main'));
      return;
    }
    if (getItem(s.id).armorSlot >= 0 && this.transfer(slot, this.group('armor'))) return;
    // en créatif, maj-clic sur une case du joueur détruit la pile
    slot.stack = null;
  }

  close(): void {
    // en créatif, la pile du curseur disparaît simplement
    this.inv.cursor = null;
  }
}
