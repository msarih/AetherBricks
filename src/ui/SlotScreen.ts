/**
 * Écran d'un menu de cases : inventaire, établi, fourneau, coffre, inventaire créatif.
 * Fenêtre grise façon Minecraft (coordonnées en pixels d'interface, identiques à l'original),
 * pile du curseur qui suit la souris, infobulle, et tous les gestes : clic gauche / droit,
 * maj-clic, double clic, glisser sur plusieurs cases, touches 1 à 9, lâcher, clic hors fenêtre.
 */
import type { AnvilMenu, BrewingMenu, CreativeMenu, EnchantMenu, FurnaceMenu, Menu, SlotGroup } from '../game/Inventory';
import type { ItemStack, Slot } from '../world/ItemStack';
import { CREATIVE_TABS, ITEMS, itemLabel } from '../world/Items';
import { B, I } from '../world/Ids';
import { potionLabel } from '../world/Potions';
import { ingredientSampleId, type Recipe } from '../world/Recipes';
import { ItemView, el, place, stackSig, stackTooltip, u } from './dom';
import type { Screen, UiContext } from './Screen';

/** Délai maximal entre deux appuis pour un double clic (ms), comme dans le jeu d'origine. */
const DOUBLE_CLICK_MS = 250;
const PALETTE_COLS = 9;
const PALETTE_ROWS = 5;
const RECIPE_COLS = 4;
const RECIPE_ROWS = 4;

interface TabDef {
  label: string;
  /** Piles de l'onglet ; null = inventaire de survie ; 'search' = recherche. */
  items: ItemStack[] | null | 'search';
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
  /** Cellule du livre de recettes survolée ou −1. */
  private hoverRecipe = -1;
  private hoverText = '';
  private hoverEl: Element | null = null;

  // livre de recettes (inventaire et établi)
  private recipeBookOpen = false;
  private recipeOnlyCraftable = false;
  private recipePage = 0;
  private recipePanel: HTMLDivElement | null = null;
  private recipeToggleBtn: HTMLDivElement | null = null;
  private recipeFilterBtn: HTMLDivElement | null = null;
  private recipeSearch: HTMLInputElement | null = null;
  private recipePageLabel: HTMLDivElement | null = null;
  private recipePrevBtn: HTMLButtonElement | null = null;
  private recipeNextBtn: HTMLButtonElement | null = null;
  private readonly recipeCells: HTMLDivElement[] = [];
  private readonly recipeViews: ItemView[] = [];
  private shownRecipes: Array<{ recipe: Recipe; craftable: boolean }> = [];
  private recipeInvSig = '';
  /** Recette affichée en silhouette dans la grille quand elle n'est pas faisable. */
  private ghostRecipe: Recipe | null = null;
  private readonly craftGhosts: HTMLDivElement[] = [];

  private drag: { button: number; slots: number[] } | null = null;
  private shiftDrag: { button: number; last: number } | null = null;
  private lastSlot = -1;
  private lastTime = 0;
  private doubleClick = false;

  // fourneau & alambic
  private flameOn: HTMLDivElement | null = null;
  private arrowOn: HTMLDivElement | null = null;
  private brewFuelOn: HTMLDivElement | null = null;
  private brewBarOn: HTMLDivElement | null = null;
  private burn = -1;
  private cook = -1;

  // enchantement & enclume
  private enchantBtns: HTMLButtonElement[] = [];
  private anvilCostEl: HTMLDivElement | null = null;

  // créatif
  private tabs: TabDef[] = [];
  private tab = 0;
  private paletteItems: ItemStack[] = [];
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
  private allItems: ItemStack[] = [];

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
      case 'brewing':
        this.buildBrewing();
        break;
      case 'enchant':
        this.buildEnchant();
        break;
      case 'anvil':
        this.buildAnvil();
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
    this.slot('offhand', 0, 77, 62);
    this.label('Fabrication', 97, 8);
    this.grid('craft', 4, 2, 98, 18);
    place(el('div', 'mc-arrow mc-arrow-small', this.win), 135, 29);
    this.slot('result', 0, 154, 28);
    this.playerSlots(8, 84, 142);
    this.buildRecipeBook(104, 61, 4);
  }

  private buildCrafting(): void {
    this.size(176, 166);
    this.label(this.menu.title, 28, 6);
    this.grid('craft', 9, 3, 30, 17);
    place(el('div', 'mc-arrow', this.win), 90, 35);
    this.slot('result', 0, 124, 35, true);
    this.label('Inventaire', 8, 72);
    this.playerSlots(8, 84, 142);
    this.buildRecipeBook(6, 35, 9);
  }

  private buildRecipeBook(btnX: number, btnY: number, craftCount: number): void {
    const host = this.ctx.host;
    // Silhouettes dans les cases de la grille de fabrication
    for (let k = 0; k < craftCount; k++) {
      const i = this.menu.indexOf('craft', k);
      const slotEl = i >= 0 ? this.slotEls[i] : null;
      if (!slotEl) continue;
      const g = el('div', 'mc-slot-ghost mc-recipe-ghost', slotEl);
      g.style.display = 'none';
      this.craftGhosts.push(g);
    }

    // Bouton d'ouverture du livre de recettes
    const btn = el('div', 'mc-slot mc-recipe-btn', this.win);
    btn.dataset.mc = 'recipe-book-toggle';
    btn.dataset.tip = 'Livre de recettes (voir comment fabriquer les objets)';
    place(btn, btnX, btnY, 18, 18);
    const icon = el('div', 'mc-item', btn);
    const bookUrl = host.iconUrl(I.BOOK);
    if (bookUrl) icon.style.backgroundImage = `url("${bookUrl}")`;
    this.recipeToggleBtn = btn;

    // Panneau latéral du livre de recettes (à gauche de la fenêtre)
    const panel = el('div', 'mc-recipe-book', this.el);
    panel.dataset.mc = 'recipe-book';
    panel.style.display = 'none';
    el('div', 'mc-panel-bg', panel);
    this.recipePanel = panel;

    const title = el('div', 'mc-label', panel, 'Recettes');
    place(title, 8, 6);

    const filterBtn = el('div', 'mc-slot mc-recipe-filter', panel);
    filterBtn.dataset.mc = 'recipe-filter';
    filterBtn.dataset.tip = 'Afficher : toutes les recettes';
    place(filterBtn, 86, 4, 18, 18);
    const filterIcon = el('div', 'mc-item', filterBtn);
    const tableUrl = host.iconUrl(B.CRAFTING_TABLE);
    if (tableUrl) filterIcon.style.backgroundImage = `url("${tableUrl}")`;
    this.recipeFilterBtn = filterBtn;

    const search = el('input', 'mc-input mc-search mc-recipe-search', panel);
    search.type = 'text';
    search.placeholder = 'Rechercher…';
    search.spellcheck = false;
    search.autocomplete = 'off';
    search.maxLength = 40;
    search.dataset.mc = 'recipe-search';
    place(search, 8, 24, 96, 13);
    search.addEventListener('input', () => {
      this.recipePage = 0;
      this.fillRecipes();
    });
    this.recipeSearch = search;

    for (let k = 0; k < RECIPE_COLS * RECIPE_ROWS; k++) {
      const cell = el('div', 'mc-slot mc-recipe-cell', panel);
      cell.dataset.r = String(k);
      place(cell, 8 + (k % RECIPE_COLS) * 24, 41 + Math.floor(k / RECIPE_COLS) * 23, 22, 22);
      this.recipeCells.push(cell);
      this.recipeViews.push(new ItemView(host, cell));
    }

    const prev = el('button', 'mc-btn mc-recipe-nav', panel);
    prev.type = 'button';
    prev.dataset.mc = 'recipe-prev';
    el('span', 'mc-btn-label', prev, '<');
    place(prev, 8, 138, 22, 18);
    prev.addEventListener('click', (e) => {
      e.stopPropagation();
      if (prev.disabled) return;
      host.click();
      this.recipePage = Math.max(0, this.recipePage - 1);
      this.fillRecipes();
    });
    this.recipePrevBtn = prev;

    const pageLbl = el('div', 'mc-label mc-label-center mc-recipe-page', panel, '1 / 1');
    place(pageLbl, 32, 143, 48, 10);
    this.recipePageLabel = pageLbl;

    const next = el('button', 'mc-btn mc-recipe-nav', panel);
    next.type = 'button';
    next.dataset.mc = 'recipe-next';
    el('span', 'mc-btn-label', next, '>');
    place(next, 82, 138, 22, 18);
    next.addEventListener('click', (e) => {
      e.stopPropagation();
      if (next.disabled) return;
      host.click();
      this.recipePage++;
      this.fillRecipes();
    });
    this.recipeNextBtn = next;
  }

  private toggleRecipeBook(): void {
    this.recipeBookOpen = !this.recipeBookOpen;
    this.recipeToggleBtn?.classList.toggle('mc-sel', this.recipeBookOpen);
    if (this.recipePanel) {
      this.recipePanel.style.display = this.recipeBookOpen ? '' : 'none';
    }
    this.el.classList.toggle('mc-with-recipes', this.recipeBookOpen);
    if (this.recipeBookOpen) {
      this.fillRecipes();
    } else {
      this.clearGhostRecipe();
      if (this.recipeSearch && document.activeElement === this.recipeSearch) this.recipeSearch.blur();
    }
  }

  private toggleRecipeFilter(): void {
    this.recipeOnlyCraftable = !this.recipeOnlyCraftable;
    if (this.recipeFilterBtn) {
      this.recipeFilterBtn.classList.toggle('mc-sel', this.recipeOnlyCraftable);
      this.recipeFilterBtn.dataset.tip = this.recipeOnlyCraftable
        ? 'Afficher : recettes faisables uniquement'
        : 'Afficher : toutes les recettes';
    }
    this.recipePage = 0;
    this.fillRecipes();
  }

  private fillRecipes(): void {
    if (!this.recipeBookOpen) return;
    const all = this.menu.availableRecipes();
    const q = fold(this.recipeSearch ? this.recipeSearch.value.trim() : '');
    const list: Array<{ recipe: Recipe; craftable: boolean }> = [];
    for (const r of all) {
      if (q && !fold(itemLabel(r.result.id)).includes(q)) continue;
      const craftable = this.menu.canCraft(r);
      if (this.recipeOnlyCraftable && !craftable) continue;
      list.push({ recipe: r, craftable });
    }
    // Faisables d'abord, puis dans l'ordre du catalogue
    list.sort((a, b) => (a.craftable === b.craftable ? 0 : a.craftable ? -1 : 1));
    this.shownRecipes = list;

    const perPage = RECIPE_COLS * RECIPE_ROWS;
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    this.recipePage = Math.max(0, Math.min(totalPages - 1, this.recipePage));
    const base = this.recipePage * perPage;

    for (let k = 0; k < perPage; k++) {
      const entry = list[base + k];
      const cell = this.recipeCells[k];
      const view = this.recipeViews[k];
      if (!cell || !view) continue;
      if (entry) {
        cell.style.visibility = 'visible';
        cell.classList.toggle('mc-craftable', entry.craftable);
        cell.classList.toggle('mc-uncraftable', !entry.craftable);
        view.set({ id: entry.recipe.result.id, count: entry.recipe.result.count, damage: 0 });
      } else {
        cell.style.visibility = 'hidden';
        cell.classList.remove('mc-craftable', 'mc-uncraftable');
        view.set(null);
      }
    }

    if (this.recipePageLabel) this.recipePageLabel.textContent = `${this.recipePage + 1} / ${totalPages}`;
    if (this.recipePrevBtn) this.recipePrevBtn.disabled = this.recipePage <= 0;
    if (this.recipeNextBtn) this.recipeNextBtn.disabled = this.recipePage >= totalPages - 1;
    this.tooltipKey = '';
  }

  private showGhostRecipe(recipe: Recipe): void {
    this.ghostRecipe = recipe;
    const gridW = this.menu.type === 'crafting' ? 3 : 2;
    for (let k = 0; k < this.craftGhosts.length; k++) {
      this.craftGhosts[k].style.display = 'none';
      this.craftGhosts[k].style.backgroundImage = '';
    }
    for (let idx = 0; idx < recipe.cells.length; idx++) {
      const sample = ingredientSampleId(recipe.cells[idx]);
      if (!sample) continue;
      const gridIndex = recipe.shaped ? Math.floor(idx / recipe.w) * gridW + (idx % recipe.w) : idx;
      const g = this.craftGhosts[gridIndex];
      if (!g) continue;
      const url = this.ctx.host.iconUrl(sample);
      if (url) {
        g.style.backgroundImage = `url("${url}")`;
        g.style.display = 'block';
      }
    }
  }

  private clearGhostRecipe(): void {
    if (!this.ghostRecipe) return;
    this.ghostRecipe = null;
    for (const g of this.craftGhosts) {
      g.style.display = 'none';
      g.style.backgroundImage = '';
    }
  }

  private recipeTooltipLines(entry: { recipe: Recipe; craftable: boolean }): string[] {
    const r = entry.recipe;
    const title = r.result.count > 1 ? `${itemLabel(r.result.id)} ×${r.result.count}` : itemLabel(r.result.id);
    const lines = [title];
    // Regroupe les ingrédients nécessaires
    const needed = new Map<string, number>();
    for (const ing of r.cells) {
      const id = ingredientSampleId(ing);
      if (!id) continue;
      const name = typeof ing === 'number' ? itemLabel(id) : `${itemLabel(id)} (ou équivalent)`;
      needed.set(name, (needed.get(name) ?? 0) + 1);
    }
    for (const [name, count] of needed) {
      lines.push(`• ${count}× ${name}`);
    }
    lines.push(entry.craftable ? 'Clic : placer dans la grille (Maj+clic : max)' : 'Ingrédients manquants (clic : voir le modèle)');
    return lines;
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

  private buildBrewing(): void {
    this.size(176, 166);
    const title = this.label(this.menu.title, 0, 6);
    title.classList.add('mc-label-center');
    this.slot('fuel', 0, 17, 17);
    const fuelBar = el('div', 'mc-brew-fuel', this.win);
    place(fuelBar, 60, 44, 18, 4);
    this.brewFuelOn = el('div', 'mc-brew-fuel-on', fuelBar);
    this.slot('input', 0, 79, 17);
    const arrow = el('div', 'mc-brew-bar', this.win);
    place(arrow, 97, 16, 9, 28);
    this.brewBarOn = el('div', 'mc-brew-bar-on', arrow);
    this.slot('bottle', 0, 56, 51);
    this.slot('bottle', 1, 79, 58);
    this.slot('bottle', 2, 102, 51);
    this.label('Inventaire', 8, 72);
    this.playerSlots(8, 84, 142);
  }

  private buildEnchant(): void {
    const em = this.menu as EnchantMenu;
    this.size(176, 166);
    this.label(em.title, 8, 6);
    this.label(`Biblio. : ${em.bookshelves}`, 8, 22);
    this.slot('input', 0, 15, 47);
    this.slot('fuel', 0, 35, 47);
    this.label('Lapis', 35, 37);
    const list = el('div', 'mc-enchant-list', this.win);
    place(list, 60, 14, 108, 60);
    this.enchantBtns = [];
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mc-enchant-opt';
      b.dataset.mc = `enchant-${i}`;
      b.addEventListener('click', () => {
        if (em.enchant(i)) {
          this.ctx.host.click();
          this.refresh();
        }
      });
      list.appendChild(b);
      this.enchantBtns.push(b);
    }
    this.playerSlots(8, 84, 142);
  }

  private buildAnvil(): void {
    const am = this.menu as AnvilMenu;
    this.size(176, 166);
    this.label(am.title, 28, 6);
    this.slot('input', 0, 27, 47);
    this.label('+', 53, 50);
    this.slot('fuel', 0, 76, 47);
    place(el('div', 'mc-arrow', this.win), 99, 44);
    this.slot('result', 0, 134, 47);
    const costEl = el('div', 'mc-anvil-cost', this.win);
    costEl.dataset.mc = 'anvil-cost';
    place(costEl, 92, 70);
    this.anvilCostEl = costEl;
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

    const seen = new Set<string>();
    for (const t of CREATIVE_TABS) {
      for (const st of t.stacks) {
        const key = `${st.id}:${st.potion ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.allItems.push(st);
      }
    }

    // Rangée du haut : cinq catégories et la recherche (à droite) ; rangée du bas : les autres
    // catégories et l'inventaire de survie (à droite).
    const topCount = Math.min(5, CREATIVE_TABS.length);
    CREATIVE_TABS.forEach((t, k) => {
      const top = k < topCount;
      const col = top ? k : k - topCount;
      if (col > 4) return;
      this.tabs.push({ label: t.label, items: t.stacks, icon: t.icon, sprite: '', top, x: col * 29, edge: col === 0 ? -1 : 0, el: null });
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
      const labelOf = (s: ItemStack): string =>
        (s.id === I.POTION || s.id === I.SPLASH_POTION) && s.potion ? potionLabel(s.potion, s.id === I.SPLASH_POTION) : itemLabel(s.id);
      this.paletteItems = q ? this.allItems.filter((s) => fold(labelOf(s)).includes(q)) : this.allItems;
    } else {
      this.paletteItems = t.items;
    }
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll));
    const base = this.scroll * PALETTE_COLS;
    for (let k = 0; k < this.paletteViews.length; k++) {
      const st = this.paletteItems[base + k];
      const stack: Slot = st ? { id: st.id, count: 1, damage: 0, ...(st.potion ? { potion: st.potion } : {}) } : null;
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
    if (target.closest('input') || target.closest('button')) return;
    e.preventDefault();
    if (this.search && document.activeElement === this.search) this.search.blur();
    if (this.recipeSearch && document.activeElement === this.recipeSearch) this.recipeSearch.blur();
    const button = e.button === 0 ? 0 : e.button === 2 ? 1 : e.button === 1 ? 2 : -1;
    if (button < 0) return;
    this.track_(e);

    // un autre bouton pendant un glissé l'annule
    if (this.drag) {
      this.endDrag();
      return;
    }

    if (target.closest('[data-mc="recipe-book-toggle"]')) {
      if (button === 0) {
        this.ctx.host.click();
        this.toggleRecipeBook();
      }
      return;
    }
    if (target.closest('[data-mc="recipe-filter"]')) {
      if (button === 0) {
        this.ctx.host.click();
        this.toggleRecipeFilter();
      }
      return;
    }
    const recipeCell = target.closest<HTMLElement>('[data-r]');
    if (recipeCell) {
      if (button === 0) {
        const idx = this.recipePage * (RECIPE_COLS * RECIPE_ROWS) + Number(recipeCell.dataset.r);
        const entry = this.shownRecipes[idx];
        if (entry) {
          this.ctx.host.click();
          this.clearGhostRecipe();
          if (!this.menu.applyRecipe(entry.recipe, e.shiftKey)) {
            this.showGhostRecipe(entry.recipe);
          }
          this.fillRecipes();
        }
      }
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
      if (stack) creative.paletteClick(stack.id, button, e.shiftKey, stack.potion);
      else if (this.menu.inv.cursor && button !== 2) creative.trashClick(false);
      return;
    }

    const slotEl = target.closest<HTMLElement>('[data-i]');
    if (!slotEl) {
      // clic hors de la fenêtre : lâcher la pile du curseur
      if (button !== 2 && !target.closest('.mc-window') && !target.closest('.mc-recipe-book')) this.menu.clickOutside(button);
      return;
    }
    if (button === 2) return;
    this.clearGhostRecipe();
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
    if (!e.deltaY) return;
    if (this.recipeBookOpen && (e.target as Element).closest('.mc-recipe-book')) {
      const perPage = RECIPE_COLS * RECIPE_ROWS;
      const totalPages = Math.max(1, Math.ceil(this.shownRecipes.length / perPage));
      const next = Math.max(0, Math.min(totalPages - 1, this.recipePage + Math.sign(e.deltaY)));
      if (next !== this.recipePage) {
        this.recipePage = next;
        this.fillRecipes();
      }
      return;
    }
    if (this.menu.type !== 'creative') return;
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
    this.setHover(target.closest('[data-i], [data-p], [data-r], [data-tip]'));
    this.placeTooltip();
  }

  private setHover(target: Element | null): void {
    if (target === this.hoverEl) return;
    this.hoverEl?.classList.remove('mc-hover');
    this.hoverEl = target;
    this.hover = -1;
    this.hoverPalette = -1;
    this.hoverRecipe = -1;
    this.hoverText = '';
    if (target instanceof HTMLElement) {
      if (target.dataset.i !== undefined) this.hover = Number(target.dataset.i);
      else if (target.dataset.p !== undefined) this.hoverPalette = Number(target.dataset.p);
      else if (target.dataset.r !== undefined) this.hoverRecipe = Number(target.dataset.r);
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
    const typing =
      (this.search !== null && document.activeElement === this.search) ||
      (this.recipeSearch !== null && document.activeElement === this.recipeSearch);
    const kb = this.ctx.host.settings.keybinds;
    if (e.code === 'Escape' || (e.code === kb.inventory && !typing)) {
      e.preventDefault();
      if (!e.repeat) this.close();
      return true;
    }
    // saisie dans le champ de recherche : la touche va au champ, pas au jeu
    if (typing) return true;
    if (e.ctrlKey && e.code !== kb.drop) return false;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      if (this.hover >= 0 && !e.repeat) this.menu.numberKey(this.hover, Number(digit[1]) - 1);
      return true;
    }
    if (e.code === kb.drop) {
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
    } else if (menu.type === 'brewing') {
      const b = menu as BrewingMenu;
      const fuelW = Math.round(Math.max(0, Math.min(1, b.fuelProgress)) * 18);
      if (fuelW !== this.burn && this.brewFuelOn) {
        this.burn = fuelW;
        this.brewFuelOn.style.width = u(fuelW);
      }
      const brewH = Math.round(Math.max(0, Math.min(1, b.brewProgress)) * 28);
      if (brewH !== this.cook && this.brewBarOn) {
        this.cook = brewH;
        this.brewBarOn.style.height = u(brewH);
      }
    } else if (menu.type === 'enchant') {
      const em = menu as EnchantMenu;
      const lapis = em.tableSlots[1]?.count ?? 0;
      for (let i = 0; i < 3; i++) {
        const b = this.enchantBtns[i];
        if (!b) continue;
        const off = em.offers[i];
        if (!off) {
          b.textContent = '';
          b.disabled = true;
          continue;
        }
        const ok = em.creative || (em.playerLevel >= off.minLevel && lapis >= off.lapisCost);
        b.disabled = !ok;
        b.textContent = `${off.preview}  (Niv. ${off.minLevel}, ${off.lapisCost} lapis)`;
      }
    } else if (menu.type === 'anvil' && this.anvilCostEl) {
      const am = menu as AnvilMenu;
      if (am.cost > 0 && am.anvilSlots[2]) {
        this.anvilCostEl.textContent = am.creative ? 'Gratuit' : `Coût : ${am.cost} niv.`;
        this.anvilCostEl.classList.toggle('mc-anvil-cant', !am.canAfford);
      } else {
        this.anvilCostEl.textContent = '';
      }
    }

    // rafraîchit le livre de recettes si le contenu de l'inventaire ou de la grille change
    if (this.recipeBookOpen) {
      const sig = slots.map((s) => stackSig(s.stack)).join(',') + '|' + stackSig(cur);
      if (sig !== this.recipeInvSig) {
        this.recipeInvSig = sig;
        this.fillRecipes();
      }
    }

    // infobulle : nom de la pile survolée (curseur vide), recette, ou libellé d'un onglet
    let stack: ItemStack | null = null;
    let recipeEntry: { recipe: Recipe; craftable: boolean } | null = null;
    let key = '';
    if (this.hoverText) {
      key = `t:${this.hoverText}`;
    } else if (!cur) {
      if (this.hover >= 0) stack = slots[this.hover]?.stack ?? null;
      else if (this.hoverPalette >= 0) stack = this.paletteStacks[this.hoverPalette] ?? null;
      else if (this.hoverRecipe >= 0) {
        const idx = this.recipePage * (RECIPE_COLS * RECIPE_ROWS) + this.hoverRecipe;
        recipeEntry = this.shownRecipes[idx] ?? null;
      }
      if (stack) key = `s:${stackSig(stack)}`;
      else if (recipeEntry) key = `r:${recipeEntry.recipe.result.id}:${recipeEntry.craftable ? 1 : 0}`;
    }
    if (key !== this.tooltipKey) {
      this.tooltipKey = key;
      const tip = this.tooltip;
      tip.textContent = '';
      if (key) {
        const lines = stack ? stackTooltip(stack) : recipeEntry ? this.recipeTooltipLines(recipeEntry) : [this.hoverText];
        lines.forEach((line, k) => el('div', k === 0 ? 'mc-tooltip-name' : 'mc-tooltip-extra', tip, line));
        tip.style.display = 'block';
        this.placeTooltip();
      } else {
        tip.style.display = '';
      }
    }
  }
}
