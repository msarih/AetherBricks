/**
 * Écran d'un menu de cases : inventaire, établi, fourneau, coffre, inventaire créatif.
 * Fenêtre grise façon Minecraft (coordonnées en pixels d'interface, identiques à l'original),
 * pile du curseur qui suit la souris, infobulle, et tous les gestes : clic gauche / droit,
 * maj-clic, double clic, glisser sur plusieurs cases, touches 1 à 9, lâcher, clic hors fenêtre.
 */
import type { CreativeMenu, FurnaceMenu, Menu, SlotGroup } from '../game/Inventory';
import type { ItemStack, Slot } from '../world/ItemStack';
import { CREATIVE_TABS, ITEMS, itemLabel } from '../world/Items';
import { B } from '../world/Ids';
import { ItemView, el, place, stackSig, stackTooltip, u } from './dom';
import type { Screen, UiContext } from './Screen';

/** Délai maximal entre deux appuis pour un double clic (ms), comme dans le jeu d'origine. */
const DOUBLE_CLICK_MS = 250;
const PALETTE_COLS = 9;
const PALETTE_ROWS = 5;

interface TabDef {
  label: string;
  /** Objets de l'onglet ; null = inventaire de survie ; 'search' = recherche. */
  items: number[] | null | 'search';
  icon: number;
  sprite: string;
  top: boolean;
  x: number;
  edge: number;
  el: HTMLDivElement | null;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export class SlotScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;

  private readonly win: HTMLDivElement;
  private readonly slotEls: Array<HTMLDivElement | null>;
  private readonly views: Array<ItemView | null>;
  private readonly cursor: ItemView;
  private readonly tooltip: HTMLDivElement;
  private tooltipKey = '';

  private mouseX = 0;
  private mouseY = 0;
  /** Case survolée (indice dans menu.slots) ou −1. */
  private hover = -1;
  /** Cellule de palette survolée (créatif) ou −1. */
  private hoverPalette = -1;
  private hoverText = '';
  private hoverEl: Element | null = null;

  private drag: { button: number; slots: number[] } | null = null;
  private shiftDrag: { button: number; last: number } | null = null;
  private lastSlot = -1;
  private lastTime = 0;
  private doubleClick = false;

  // fourneau
  private flameOn: HTMLDivElement | null = null;
  private arrowOn: HTMLDivElement | null = null;
  private burn = -1;
  private cook = -1;

  // créatif
  private tabs: TabDef[] = [];
  private tab = 0;
  private paletteItems: number[] = [];
  private readonly paletteViews: ItemView[] = [];
  private readonly paletteStacks: Slot[] = [];
  private scroll = 0;
  private paletteView: HTMLDivElement | null = null;
  private inventoryView: HTMLDivElement | null = null;
  private tabLabel: HTMLDivElement | null = null;
  private search: HTMLInputElement | null = null;
  private thumb: HTMLDivElement | null = null;
  private track: HTMLDivElement | null = null;
  private scrolling = false;
  private allItems: number[] = [];

  constructor(private readonly ctx: UiContext, private readonly menu: Menu) {
    this.el = el('div', 'mc-screen mc-screen-dim mc-slotscreen');
    this.el.dataset.mc = `menu-${menu.type}`;
    this.win = el('div', 'mc-window', this.el);
    el('div', 'mc-panel-bg', this.win);
    this.slotEls = new Array<HTMLDivElement | null>(menu.slots.length).fill(null);
    this.views = new Array<ItemView | null>(menu.slots.length).fill(null);

    switch (menu.type) {
      case 'crafting':
        this.buildCrafting();
        break;
      case 'furnace':
        this.buildFurnace();
        break;
      case 'chest':
        this.buildChest();
        break;
      case 'creative':
        this.buildCreative();
        break;
      default:
        this.buildInventory();
        break;
    }

    this.cursor = new ItemView(ctx.host, this.el, 'mc-cursor');
    this.tooltip = el('div', 'mc-tooltip', this.el);

    this.el.addEventListener('mousedown', this.onDown);
    this.el.addEventListener('mousemove', this.onMove);
    this.el.addEventListener('mouseleave', this.onLeave);
    this.el.addEventListener('wheel', this.onWheel, { passive: false });
    this.el.addEventListener('auxclick', (e) => e.preventDefault());
    window.addEventListener('mouseup', this.onUp, true);
    this.refresh();
  }

  dispose(): void {
    window.removeEventListener('mouseup', this.onUp, true);
  }

  // ------------------------------------------------------------------ construction des fenêtres

  private size(w: number, h: number): void {
    this.win.style.width = u(w);
    this.win.style.height = u(h);
  }

  private label(text: string, x: number, y: number, parent: HTMLElement = this.win): HTMLDivElement {
    const l = el('div', 'mc-label', parent, text);
    place(l, x, y);
    return l;
  }

  /** Case du menu : (x, y) est le coin de l'objet 16×16 ; `big` : grande case de résultat (26×26). */
  private slot(group: SlotGroup, index: number, x: number, y: number, big = false, parent: HTMLElement = this.win): HTMLDivElement | null {
    const i = this.menu.indexOf(group, index);
    if (i < 0) return null;
    const s = el('div', big ? 'mc-slot mc-slot-big' : 'mc-slot', parent);
    s.dataset.i = String(i);
    s.dataset.group = group;
    if (big) place(s, x - 5, y - 5);
    else place(s, x - 1, y - 1);
    this.views[i] = new ItemView(this.ctx.host, s);
    this.slotEls[i] = s;
    return s;
  }

  private grid(group: SlotGroup, count: number, cols: number, x: number, y: number, parent: HTMLElement = this.win): void {
    for (let k = 0; k < count; k++) this.slot(group, k, x + (k % cols) * 18, y + Math.floor(k / cols) * 18, false, parent);
  }

  private playerSlots(x: number, mainY: number, hotbarY: number, mainParent: HTMLElement = this.win): void {
    this.grid('main', 27, 9, x, mainY, mainParent);
    this.grid('hotbar', 9, 9, x, hotbarY);
  }

  private armorSlot(index: number, x: number, y: number, parent: HTMLElement = this.win): void {
    const s = this.slot('armor', index, x, y, false, parent);
    if (!s) return;
    // silhouette de la pièce attendue, visible tant que la case est vide
    const sample = ITEMS.find((d) => d !== undefined && d.armorSlot === index);
    if (sample) {
      const ghost = el('div', 'mc-slot-ghost', s);
      const url = this.ctx.host.iconUrl(sample.id);
      if (url) ghost.style.backgroundImage = `url("${url}")`;
    }
  }

  private playerBox(x: number, y: number, w: number, h: number, parent: HTMLElement = this.win): void {
    const box = el('div', 'mc-player-box', parent);
    place(box, x, y, w, h);
    el('div', 'mc-player', box);
  }

  private buildInventory(): void {
    this.size(176, 166);
    for (let i = 0; i < 4; i++) this.armorSlot(i, 8, 8 + i * 18);
    this.playerBox(26, 8, 49, 70);
    this.label('Fabrication', 97, 8);
    this.grid('craft', 4, 2, 98, 18);
    place(el('div', 'mc-arrow mc-arrow-small', this.win), 135, 29);
    this.slot('result', 0, 154, 28);
    this.playerSlots(8, 84, 142);
  }

  private buildCrafting(): void {
    this.size(176, 166);
    this.label(this.menu.title, 28, 6);
    this.grid('craft', 9, 3, 30, 17);
    place(el('div', 'mc-arrow', this.win), 90, 35);
    this.slot('result', 0, 124, 35, true);
    this.label('Inventaire', 8, 72);
    this.playerSlots(8, 84, 142);
  }

  private buildFurnace(): void {
    this.size(176, 166);
    const title = this.label(this.menu.title, 0, 6);
    title.classList.add('mc-label-center');
    this.slot('input', 0, 56, 17);
    this.slot('fuel', 0, 56, 53);
    const flame = el('div', 'mc-flame', this.win);
    place(flame, 56, 36);
    this.flameOn = el('div', 'mc-flame-on', flame);
    const arrow = el('div', 'mc-arrow mc-arrow-big', this.win);
    place(arrow, 79, 34);
    this.arrowOn = el('div', 'mc-arrow-on', arrow);
    this.slot('output', 0, 116, 35, true);
    this.label('Inventaire', 8, 72);
    this.playerSlots(8, 84, 142);
  }

  private buildChest(): void {
    this.size(176, 168);
    this.label(this.menu.title, 8, 6);
    this.grid('container', 27, 9, 8, 18);
    this.label('Inventaire', 8, 74);
    this.playerSlots(8, 85, 143);
  }

  private buildCreative(): void {
    const host = this.ctx.host;
    this.size(195, 136);
    this.el.classList.add('mc-creative');

    const seen = new Set<number>();
    for (const t of CREATIVE_TABS) {
      for (const id of t.items) {
        if (seen.has(id)) continue;
        seen.add(id);
        this.allItems.push(id);
      }
    }

    // Rangée du haut : cinq catégories et la recherche (à droite) ; rangée du bas : les autres
    // catégories et l'inventaire de survie (à droite).
    const topCount = Math.min(5, CREATIVE_TABS.length);
    CREATIVE_TABS.forEach((t, k) => {
      const top = k < topCount;
      const col = top ? k : k - topCount;
      if (col > 4) return;
      this.tabs.push({ label: t.label, items: t.items, icon: t.icon, sprite: '', top, x: col * 29, edge: col === 0 ? -1 : 0, el: null });
    });
    this.tabs.push({ label: 'Rechercher', items: 'search', icon: 0, sprite: 'magnifier', top: true, x: 167, edge: 1, el: null });
    this.tabs.push({ label: 'Inventaire de survie', items: null, icon: B.CHEST, sprite: '', top: false, x: 167, edge: 1, el: null });

    this.tabs.forEach((t, k) => {
      const e = el('div', `mc-tab ${t.top ? 'mc-tab-top' : 'mc-tab-bot'}`, this.win);
      if (t.edge < 0) e.classList.add('mc-edge-l');
      if (t.edge > 0) e.classList.add('mc-edge-r');
      e.dataset.tab = String(k);
      e.dataset.tip = t.label;
      e.style.left = u(t.x);
      const icon = el('div', 'mc-tab-icon', e);
      if (t.sprite) icon.style.backgroundImage = `var(--spr-${t.sprite})`;
      else {
        const url = host.iconUrl(t.icon);
        if (url) icon.style.backgroundImage = `url("${url}")`;
      }
      t.el = e;
    });

    this.tabLabel = this.label('', 8, 6);

    // Vue « palette » : grille 9×5, barre de défilement, champ de recherche.
    const pal = el('div', 'mc-view', this.win);
    this.paletteView = pal;
    for (let k = 0; k < PALETTE_COLS * PALETTE_ROWS; k++) {
      const cell = el('div', 'mc-slot', pal);
      cell.dataset.p = String(k);
      place(cell, 8 + (k % PALETTE_COLS) * 18, 17 + Math.floor(k / PALETTE_COLS) * 18);
      this.paletteViews.push(new ItemView(host, cell));
      this.paletteStacks.push(null);
    }
    this.track = el('div', 'mc-scroll-track', pal);
    place(this.track, 174, 17, 14, 90);
    this.thumb = el('div', 'mc-scroll-thumb', this.track);
    this.search = el('input', 'mc-input mc-search', pal);
    this.search.type = 'text';
    this.search.spellcheck = false;
    this.search.autocomplete = 'off';
    this.search.maxLength = 50;
    this.search.dataset.mc = 'search';
    place(this.search, 80, 4, 90, 12);
    this.search.addEventListener('input', () => {
      this.scroll = 0;
      this.fillPalette();
    });

    // Vue « inventaire de survie » : armure, sac, corbeille.
    const inv = el('div', 'mc-view', this.win);
    this.inventoryView = inv;
    this.armorSlot(0, 54, 6, inv);
    this.armorSlot(1, 54, 33, inv);
    this.armorSlot(2, 108, 6, inv);
    this.armorSlot(3, 108, 33, inv);
    this.playerBox(73, 6, 32, 43, inv);
    this.grid('main', 27, 9, 9, 54, inv);

    this.grid('hotbar', 9, 9, 9, 112);
    const trash = el('div', 'mc-slot mc-trash', this.win);
    trash.dataset.trash = '1';
    trash.dataset.tip = 'Détruire l\'objet (maj : vider l\'inventaire)';
    place(trash, 172, 111);
    el('div', 'mc-trash-icon', trash);

    this.selectTab(0);
  }

  // ------------------------------------------------------------------ créatif : onglets, palette

  private selectTab(k: number): void {
    const t = this.tabs[k];
    if (!t) return;
    this.tab = k;
    this.scroll = 0;
    this.tabs.forEach((o, j) => o.el?.classList.toggle('mc-sel', j === k));
    const inventory = t.items === null;
    if (this.paletteView) this.paletteView.style.display = inventory ? 'none' : '';
    if (this.inventoryView) this.inventoryView.style.display = inventory ? '' : 'none';
    if (this.tabLabel) this.tabLabel.textContent = inventory ? '' : t.label;
    if (this.search) {
      const searching = t.items === 'search';
      this.search.style.display = searching ? '' : 'none';
      if (searching) {
        this.search.value = '';
        // différé : le clic qui a choisi l'onglet ne doit pas reprendre le focus
        const field = this.search;
        setTimeout(() => field.focus(), 0);
      } else {
        this.search.blur();
      }
    }
    this.setHover(null);
    this.fillPalette();
  }

  private fillPalette(): void {
    const t = this.tabs[this.tab];
    if (!t || t.items === null) {
      this.paletteItems = [];
      return;
    }
    if (t.items === 'search') {
      const q = fold(this.search ? this.search.value.trim() : '');
      this.paletteItems = q ? this.allItems.filter((id) => fold(itemLabel(id)).includes(q)) : this.allItems;
    } else {
      this.paletteItems = t.items;
    }
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll));
    const base = this.scroll * PALETTE_COLS;
    for (let k = 0; k < this.paletteViews.length; k++) {
      const id = this.paletteItems[base + k] ?? 0;
      const stack: Slot = id ? { id, count: 1, damage: 0 } : null;
      this.paletteStacks[k] = stack;
      this.paletteViews[k].set(stack);
    }
    if (this.thumb && this.track) {
      const max = this.maxScroll();
      this.track.classList.toggle('mc-disabled', max === 0);
      this.thumb.style.top = `calc((100% - var(--u) * 17) * ${max ? (this.scroll / max).toFixed(4) : 0} + var(--u) * 1)`;
    }
    this.tooltipKey = '';
  }

  private maxScroll(): number {
    return Math.max(0, Math.ceil(this.paletteItems.length / PALETTE_COLS) - PALETTE_ROWS);
  }

  private scrollTo(row: number): void {
    const next = Math.max(0, Math.min(this.maxScroll(), row));
    if (next === this.scroll) return;
    this.scroll = next;
    this.fillPalette();
  }

  private scrollFromPointer(clientY: number): void {
    if (!this.track) return;
    const r = this.track.getBoundingClientRect();
    const s = this.ctx.scale();
    const f = (clientY - r.top - 8.5 * s) / Math.max(1, r.height - 17 * s);
    this.scrollTo(Math.round(Math.max(0, Math.min(1, f)) * this.maxScroll()));
  }

  // ------------------------------------------------------------------ souris

  private readonly onDown = (e: MouseEvent): void => {
    const target = e.target as Element;
    if (target.closest('input')) return;
    e.preventDefault();
    if (this.search && document.activeElement === this.search) this.search.blur();
    const button = e.button === 0 ? 0 : e.button === 2 ? 1 : e.button === 1 ? 2 : -1;
    if (button < 0) return;
    this.track_(e);

    // un autre bouton pendant un glissé l'annule
    if (this.drag) {
      this.endDrag();
      return;
    }

    const tabEl = target.closest<HTMLElement>('[data-tab]');
    if (tabEl) {
      if (button === 0) {
        this.ctx.host.click();
        this.selectTab(Number(tabEl.dataset.tab));
      }
      return;
    }
    if (target.closest('.mc-scroll-track')) {
      if (button === 0 && this.maxScroll() > 0) {
        this.scrolling = true;
        this.scrollFromPointer(e.clientY);
      }
      return;
    }
    if (target.closest('[data-trash]')) {
      if (button !== 2) (this.menu as CreativeMenu).trashClick(e.shiftKey);
      return;
    }
    const cell = target.closest<HTMLElement>('[data-p]');
    if (cell) {
      const stack = this.paletteStacks[Number(cell.dataset.p)];
      const creative = this.menu as CreativeMenu;
      if (stack) creative.paletteClick(stack.id, button, e.shiftKey);
      else if (this.menu.inv.cursor && button !== 2) creative.trashClick(false);
      return;
    }

    const slotEl = target.closest<HTMLElement>('[data-i]');
    if (!slotEl) {
      // clic hors de la fenêtre : lâcher la pile du curseur
      if (button !== 2 && !target.closest('.mc-window')) this.menu.clickOutside(button);
      return;
    }
    if (button === 2) return;
    const i = Number(slotEl.dataset.i);
    const now = performance.now();
    this.doubleClick = button === 0 && !e.shiftKey && this.lastSlot === i && now - this.lastTime < DOUBLE_CLICK_MS;
    this.lastSlot = button === 0 ? i : -1;
    this.lastTime = now;

    if (e.shiftKey) {
      this.menu.click(i, button, true);
      this.shiftDrag = { button, last: i };
      return;
    }
    if (!this.menu.inv.cursor) {
      // curseur vide : l'action a lieu dès l'appui
      this.menu.click(i, button, false);
      return;
    }
    // curseur chargé : début d'un glissé, résolu au relâchement (une seule case = simple clic)
    this.drag = { button, slots: [i] };
    slotEl.classList.add('mc-drag');
  };

  private readonly onUp = (e: MouseEvent): void => {
    const button = e.button === 0 ? 0 : e.button === 2 ? 1 : e.button === 1 ? 2 : -1;
    if (button === 0) this.scrolling = false;
    if (this.shiftDrag && this.shiftDrag.button === button) this.shiftDrag = null;
    const d = this.drag;
    if (d && d.button === button) {
      this.endDrag();
      if (this.doubleClick && d.slots.length === 1) {
        this.menu.doubleClick(d.slots[0]);
        this.lastTime = 0;
      } else if (d.slots.length === 1) {
        this.menu.click(d.slots[0], button, false);
      } else {
        this.menu.drag(d.slots, button);
      }
    } else if (!d && this.doubleClick && button === 0 && this.hover === this.lastSlot && this.hover >= 0) {
      // second appui fait avec le curseur vide (la pile vient d'être reprise) : on rassemble
      this.menu.doubleClick(this.hover);
      this.lastTime = 0;
    }
    if (button === 0) this.doubleClick = false;
  };

  private endDrag(): void {
    if (!this.drag) return;
    for (const i of this.drag.slots) this.slotEls[i]?.classList.remove('mc-drag');
    this.drag = null;
  }

  private readonly onMove = (e: MouseEvent): void => {
    this.track_(e);
    if (this.scrolling) {
      if (e.buttons & 1) this.scrollFromPointer(e.clientY);
      else this.scrolling = false;
    }
    const j = this.hover;
    if (j < 0) return;
    const d = this.drag;
    if (d && !d.slots.includes(j)) {
      const cur = this.menu.inv.cursor;
      const slot = this.menu.slots[j];
      if (cur && slot && slot.room(cur) > 0) {
        d.slots.push(j);
        this.slotEls[j]?.classList.add('mc-drag');
      }
    }
    const sd = this.shiftDrag;
    if (sd && sd.last !== j) {
      sd.last = j;
      this.menu.click(j, sd.button, true);
    }
  };

  private readonly onLeave = (): void => {
    this.setHover(null);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.menu.type !== 'creative' || !e.deltaY) return;
    this.scrollTo(this.scroll + Math.sign(e.deltaY));
  };

  /** Mémorise la position de la souris et l'élément survolé. */
  private track_(e: MouseEvent): void {
    const r = this.el.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    const s = this.ctx.scale();
    this.cursor.el.style.transform = `translate(${Math.round(this.mouseX - 8 * s)}px, ${Math.round(this.mouseY - 8 * s)}px)`;
    const target = e.target as Element;
    this.setHover(target.closest('[data-i], [data-p], [data-tip]'));
    this.placeTooltip();
  }

  private setHover(target: Element | null): void {
    if (target === this.hoverEl) return;
    this.hoverEl?.classList.remove('mc-hover');
    this.hoverEl = target;
    this.hover = -1;
    this.hoverPalette = -1;
    this.hoverText = '';
    if (target instanceof HTMLElement) {
      if (target.dataset.i !== undefined) this.hover = Number(target.dataset.i);
      else if (target.dataset.p !== undefined) this.hoverPalette = Number(target.dataset.p);
      else this.hoverText = target.dataset.tip ?? '';
      if (!this.hoverText) target.classList.add('mc-hover');
    }
  }

  private placeTooltip(): void {
    const tip = this.tooltip;
    if (!this.tooltipKey) return;
    const s = this.ctx.scale();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = this.mouseX + 12 * s;
    let y = this.mouseY - 12 * s;
    if (x + w > this.el.clientWidth - 2 * s) x = this.mouseX - 12 * s - w;
    y = Math.max(2 * s, Math.min(this.el.clientHeight - h - 2 * s, y));
    tip.style.transform = `translate(${Math.round(Math.max(0, x))}px, ${Math.round(y)}px)`;
  }

  // ------------------------------------------------------------------ clavier

  key(e: KeyboardEvent): boolean {
    const typing = this.search !== null && document.activeElement === this.search;
    if (e.code === 'Escape' || (e.code === 'KeyE' && !typing)) {
      e.preventDefault();
      if (!e.repeat) this.close();
      return true;
    }
    // saisie dans le champ de recherche : la touche va au champ, pas au jeu
    if (typing) return true;
    if (e.ctrlKey && e.code !== 'KeyQ') return false;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      if (this.hover >= 0 && !e.repeat) this.menu.numberKey(this.hover, Number(digit[1]) - 1);
      return true;
    }
    if (e.code === 'KeyQ') {
      e.preventDefault();
      if (this.hover >= 0) this.menu.dropKey(this.hover, e.ctrlKey);
      return true;
    }
    return false;
  }

  private close(): void {
    this.ctx.closeScreen();
    this.ctx.host.game?.closeMenu();
  }

  // ------------------------------------------------------------------ rafraîchissement

  update(): void {
    this.refresh();
  }

  private refresh(): void {
    const menu = this.menu;
    const slots = menu.slots;
    for (let i = 0; i < slots.length; i++) {
      const view = this.views[i];
      if (!view) continue;
      const stack = slots[i].stack;
      if (view.set(stack)) this.slotEls[i]?.classList.toggle('mc-filled', stack !== null);
    }
    const cur = menu.inv.cursor;
    if (this.cursor.set(cur)) this.cursor.el.style.display = cur ? 'block' : '';

    if (menu.type === 'furnace') {
      const f = menu as FurnaceMenu;
      const burn = Math.round(Math.max(0, Math.min(1, f.burnProgress)) * 14);
      if (burn !== this.burn && this.flameOn) {
        this.burn = burn;
        this.flameOn.style.height = u(burn);
      }
      const cook = Math.round(Math.max(0, Math.min(1, f.cookProgress)) * 24);
      if (cook !== this.cook && this.arrowOn) {
        this.cook = cook;
        this.arrowOn.style.width = u(cook);
      }
    }

    // infobulle : nom de la pile survolée (curseur vide), ou libellé d'un onglet
    let stack: ItemStack | null = null;
    let key = '';
    if (this.hoverText) {
      key = `t:${this.hoverText}`;
    } else if (!cur) {
      if (this.hover >= 0) stack = slots[this.hover]?.stack ?? null;
      else if (this.hoverPalette >= 0) stack = this.paletteStacks[this.hoverPalette] ?? null;
      if (stack) key = `s:${stackSig(stack)}`;
    }
    if (key !== this.tooltipKey) {
      this.tooltipKey = key;
      const tip = this.tooltip;
      tip.textContent = '';
      if (key) {
        const lines = stack ? stackTooltip(stack) : [this.hoverText];
        lines.forEach((line, k) => el('div', k === 0 ? 'mc-tooltip-name' : 'mc-tooltip-extra', tip, line));
        tip.style.display = 'block';
        this.placeTooltip();
      } else {
        tip.style.display = '';
      }
    }
  }
}
