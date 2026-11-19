/**
 * HUD : barre d'objets, cœurs, faim, armure, air, expérience, viseur, nom de l'objet tenu,
 * journal du chat, message d'action, écran de débogage (F3), compteur d'images et voiles plein écran.
 * `update()` est appelée à chaque image : le DOM n'est modifié que lorsqu'une valeur change.
 */
import { HOTBAR_SIZE } from '../game/Inventory';
import { I } from '../world/Ids';
import { itemLabel } from '../world/Items';
import { potionLabel } from '../world/Potions';
import { T } from '../world/Tiles';
import { ItemView, el, u } from './dom';
import type { UiGame, UiHost } from './UiApi';

/** Durée d'affichage d'une ligne de chat avant son fondu (secondes). */
const CHAT_VISIBLE = 10;
const CHAT_FADE = 1;
/** Nombre de lignes conservées dans le journal. */
const CHAT_KEEP = 100;

interface ChatLine {
  el: HTMLDivElement;
  born: number;
  /** Dernière opacité appliquée (−1 = ligne masquée). */
  shown: number;
}

export class Hud {
  readonly el: HTMLDivElement;

  private readonly memo = new Map<string, unknown>();
  private readonly main: HTMLDivElement;
  private readonly water: HTMLDivElement;
  private readonly lava: HTMLDivElement;
  private readonly fire: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private readonly fade: HTMLDivElement;

  private readonly stats: HTMLDivElement;
  private readonly hearts: HTMLDivElement[] = [];
  private heartRow!: HTMLDivElement;
  private readonly foods: HTMLDivElement[] = [];
  private readonly armors: HTMLDivElement[] = [];
  private readonly bubbles: HTMLDivElement[] = [];
  private readonly armorRow: HTMLDivElement;
  private readonly airRow: HTMLDivElement;
  private readonly xpFill: HTMLDivElement;
  private readonly xpLevel: HTMLDivElement;
  private readonly items: ItemView[] = [];
  private readonly offhandBox: HTMLDivElement;
  private readonly offhandView: ItemView;
  private readonly selection: HTMLDivElement;
  private readonly heldName: HTMLDivElement;
  private readonly action: HTMLDivElement;
  private readonly chat: HTMLDivElement;
  private readonly debug: HTMLDivElement;
  private readonly debugLeft: HTMLDivElement;
  private readonly debugRight: HTMLDivElement;
  private readonly fps: HTMLDivElement;
  private readonly guide: HTMLDivElement;
  private readonly boss: HTMLDivElement;
  private readonly bossName: HTMLDivElement;
  private readonly bossFill: HTMLDivElement;
  private readonly effectsBox: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly toastIcon: ItemView;
  private readonly toastTitle: HTMLDivElement;
  private readonly toastDetail: HTMLDivElement;
  private readonly toastQueue: Array<{ title: string; detail: string; iconId: number }> = [];
  private toastTimer = 0;

  private readonly lines: ChatLine[] = [];
  private visible = true;
  private debugOn = false;
  private debugTimer = 0;
  private heldTimer = 0;
  private actionTimer = 0;
  private jitterTimer = 0;
  private readonly jitter = new Array<number>(10).fill(0);
  private fpsFrames = 0;
  private fpsTime = 0;
  private fireTimer = 0;

  constructor(private readonly host: UiHost, parent: HTMLElement) {
    this.el = el('div', 'mc-hud', parent);
    this.water = el('div', 'mc-ov mc-ov-water', this.el);
    this.lava = el('div', 'mc-ov mc-ov-lava', this.el);
    this.fire = el('div', 'mc-ov mc-ov-fire', this.el);
    this.hurt = el('div', 'mc-ov mc-ov-hurt', this.el);

    this.main = el('div', 'mc-hud-main', this.el);
    el('div', 'mc-crosshair', this.main);

    const bar = el('div', 'mc-hud-bar', this.main);
    this.heldName = el('div', 'mc-held-name', bar);
    this.action = el('div', 'mc-actionbar', bar);

    this.stats = el('div', 'mc-stats', bar);
    this.armorRow = el('div', 'mc-stat-row mc-row-armor', this.stats);
    this.airRow = el('div', 'mc-stat-row mc-row-air', this.stats);
    const heartRow = el('div', 'mc-stat-row mc-row-hearts', this.stats);
    this.heartRow = heartRow;
    const foodRow = el('div', 'mc-stat-row mc-row-food', this.stats);
    for (let i = 0; i < 10; i++) {
      const heart = el('div', 'mc-ico mc-heart', heartRow);
      heart.style.left = u(i * 8);
      this.hearts.push(heart);
      const armor = el('div', 'mc-ico mc-armor', this.armorRow);
      armor.style.left = u(i * 8);
      this.armors.push(armor);
      const food = el('div', 'mc-ico mc-food', foodRow);
      food.style.left = u(173 - i * 8);
      this.foods.push(food);
      const bubble = el('div', 'mc-ico mc-bubble', this.airRow);
      bubble.style.left = u(173 - i * 8);
      this.bubbles.push(bubble);
    }
    const xp = el('div', 'mc-xp', this.stats);
    this.xpFill = el('div', 'mc-xp-fill', xp);
    this.xpLevel = el('div', 'mc-xp-level', this.stats);

    const hotbar = el('div', 'mc-hotbar', bar);
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const view = new ItemView(host, hotbar);
      view.el.style.left = u(3 + i * 20);
      view.el.style.top = u(3);
      this.items.push(view);
    }
    this.selection = el('div', 'mc-hotbar-sel', hotbar);
    this.offhandBox = el('div', 'mc-offhand-hud', hotbar);
    this.offhandView = new ItemView(host, this.offhandBox);
    this.offhandView.el.style.left = u(2);
    this.offhandView.el.style.top = u(2);

    this.chat = el('div', 'mc-chatlog', this.main);
    this.debug = el('div', 'mc-debug', this.main);
    this.debugLeft = el('div', 'mc-debug-col mc-debug-left', this.debug);
    this.debugRight = el('div', 'mc-debug-col mc-debug-right', this.debug);
    this.fps = el('div', 'mc-fps', this.main);
    this.guide = el('div', 'mc-guide', this.main);
    this.guide.dataset.mc = 'guide';
    this.boss = el('div', 'mc-boss', this.main);
    this.boss.dataset.mc = 'boss';
    this.bossName = el('div', 'mc-boss-name', this.boss);
    this.bossFill = el('div', 'mc-boss-fill', el('div', 'mc-boss-bar', this.boss));
    this.effectsBox = el('div', 'mc-effects', this.main);
    this.effectsBox.dataset.mc = 'effects';

    this.toast = el('div', 'mc-toast', this.main);
    this.toast.dataset.mc = 'toast';
    const toastSlot = el('div', 'mc-toast-slot', this.toast);
    this.toastIcon = new ItemView(host, toastSlot);
    const toastText = el('div', 'mc-toast-text', this.toast);
    el('div', 'mc-toast-head', toastText, 'Progrès accompli !');
    this.toastTitle = el('div', 'mc-toast-title', toastText);
    this.toastDetail = el('div', 'mc-toast-detail', toastText);

    this.fade = el('div', 'mc-ov mc-ov-fade', this.el);
  }

  // ------------------------------------------------------------------ commandes

  addMessage(text: string): void {
    for (const part of text.split('\n')) {
      const line = el('div', 'mc-chat-line', this.chat, part);
      this.lines.push({ el: line, born: performance.now() / 1000, shown: 1 });
    }
    while (this.lines.length > CHAT_KEEP) this.lines.shift()?.el.remove();
    this.chat.scrollTop = this.chat.scrollHeight;
  }

  actionBar(text: string): void {
    this.action.textContent = text;
    this.actionTimer = text ? 3 : 0;
  }

  showAdvancement(title: string, detail: string, iconId: number): void {
    this.toastQueue.push({ title, detail, iconId });
  }

  toggleDebug(): void {
    this.debugOn = !this.debugOn;
    this.debug.style.display = this.debugOn ? 'flex' : '';
    this.debugTimer = 0;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.main.style.display = visible ? '' : 'none';
  }

  /** Le journal reste entièrement lisible (et défilable) tant que la saisie du chat est ouverte. */
  setChatOpen(open: boolean): void {
    if (!this.changed('chatOpen', open)) return;
    this.chat.classList.toggle('mc-open', open);
    this.chat.scrollTop = this.chat.scrollHeight;
  }

  // ------------------------------------------------------------------ rafraîchissement

  update(dt: number, inGame: boolean): void {
    const g = inGame ? this.host.game : null;
    if (this.changed('shown', g !== null)) this.el.style.display = g ? 'block' : '';
    if (!g) return;

    this.updateOverlays(g, dt);
    if (!this.visible) return;

    const survival = g.gameMode === 'survival' || g.gameMode === 'adventure';
    if (this.changed('survival', survival)) {
      this.stats.style.display = survival ? '' : 'none';
      this.heldName.classList.toggle('mc-low', !survival);
      this.action.classList.toggle('mc-low', !survival);
    }
    if (survival) this.updateStats(g, dt);
    this.updateHotbar(g, dt);
    this.updateChat();
    this.updateDebug(g, dt);
    this.updateGuideAndToast(g, dt);
    this.updateBoss(g);
    this.updateEffects(g);

    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
      this.opacity('action', this.action, this.actionTimer > 0.5 ? 1 : Math.max(0, this.actionTimer / 0.5));
    }
  }

  private changed(key: string, value: unknown): boolean {
    if (this.memo.get(key) === value) return false;
    this.memo.set(key, value);
    return true;
  }

  /** Opacité arrondie au dixième, appliquée seulement si elle change ; 0 masque l'élément. */
  private opacity(key: string, e: HTMLElement, value: number): void {
    const v = Math.round(Math.max(0, Math.min(1, value)) * 10) / 10;
    if (!this.changed(key, v)) return;
    e.style.opacity = String(v);
    e.style.visibility = v > 0 ? 'visible' : 'hidden';
  }

  private updateOverlays(g: UiGame, dt: number): void {
    if (g.gameMode === 'spectator') {
      this.opacity('water', this.water, 0);
      this.opacity('lava', this.lava, 0);
      this.opacity('hurt', this.hurt, 0);
      this.opacity('fire', this.fire, 0);
      this.opacity('fade', this.fade, 0);
      return;
    }
    this.opacity('water', this.water, g.headInWater && !g.headInLava ? 1 : 0);
    this.opacity('lava', this.lava, g.headInLava ? 1 : 0);
    this.opacity('hurt', this.hurt, g.hurtTime > 0 ? 0.3 + 0.7 * Math.min(1, g.hurtTime / 10) : 0);
    this.opacity('fade', this.fade, g.fade);
    const burning = g.onFire;
    this.opacity('fire', this.fire, burning ? 1 : 0);
    if (burning) {
      // la tuile de feu est animée : on relit son image quelques fois par seconde
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = 0.15;
        let url = '';
        try {
          url = this.host.tileUrl(T.fire);
        } catch {
          url = '';
        }
        if (this.changed('fireUrl', url)) this.fire.style.backgroundImage = url ? `url("${url}")` : '';
      }
    } else {
      this.fireTimer = 0;
    }
  }

  private updateStats(g: UiGame, dt: number): void {
    const health = Math.max(0, Math.ceil(g.health));
    const count = Math.max(1, Math.min(10, Math.ceil(g.maxHealth / 2)));
    const blink = g.hurtTime > 0 && Math.floor(g.hurtTime / 3) % 2 === 1;
    // À deux cœurs ou moins, les cœurs tremblent (nouveau tirage à chaque tick de 50 ms).
    const shaking = health <= 4;
    const tint = g.heartTint;
    if (this.changed('heartTint', tint)) this.heartRow.dataset.fx = tint;
    if (shaking) {
      this.jitterTimer -= dt;
      if (this.jitterTimer <= 0) {
        this.jitterTimer = 0.05;
        for (let i = 0; i < 10; i++) this.jitter[i] = Math.random() < 0.5 ? 0 : 1;
      }
    }
    for (let i = 0; i < 10; i++) {
      const heart = this.hearts[i];
      const state = i >= count ? 'x' : (blink ? 'b' : '') + (health >= i * 2 + 2 ? 2 : health === i * 2 + 1 ? 1 : 0);
      if (this.changed(`h${i}`, state)) heart.dataset.s = state;
      const dy = shaking ? this.jitter[i] : 0;
      if (this.changed(`hy${i}`, dy)) heart.style.top = u(dy);

      const hunger = Math.max(0, Math.ceil(g.hunger));
      const food = hunger >= i * 2 + 2 ? 2 : hunger === i * 2 + 1 ? 1 : 0;
      if (this.changed(`f${i}`, food)) this.foods[i].dataset.s = String(food);
    }

    const armor = Math.max(0, Math.floor(g.armor));
    if (this.changed('armorOn', armor > 0)) this.armorRow.style.display = armor > 0 ? 'block' : '';
    if (armor > 0) {
      for (let i = 0; i < 10; i++) {
        const state = armor >= i * 2 + 2 ? 2 : armor === i * 2 + 1 ? 1 : 0;
        if (this.changed(`a${i}`, state)) this.armors[i].dataset.s = String(state);
      }
    }

    const air = g.air;
    if (this.changed('airOn', air < 300)) this.airRow.style.display = air < 300 ? 'block' : '';
    if (air < 300) {
      const full = Math.ceil(((air - 2) * 10) / 300);
      const partial = Math.ceil((air * 10) / 300) - full;
      for (let i = 0; i < 10; i++) {
        const state = i < full ? 'full' : i < full + partial ? 'pop' : 'none';
        if (this.changed(`b${i}`, state)) this.bubbles[i].dataset.s = state;
      }
    }

    const fill = Math.round(Math.max(0, Math.min(1, g.xpProgress)) * 182);
    if (this.changed('xp', fill)) this.xpFill.style.width = u(fill);
    const level = Math.max(0, Math.floor(g.xpLevel));
    if (this.changed('level', level)) this.xpLevel.textContent = level > 0 ? String(level) : '';
  }

  private updateHotbar(g: UiGame, dt: number): void {
    const inv = g.inventory;
    for (let i = 0; i < HOTBAR_SIZE; i++) this.items[i].set(inv.slots[i]);
    const selected = inv.selected;
    if (this.changed('sel', selected)) this.selection.style.left = u(-1 + selected * 20);

    // Nom de l'objet tenu : apparaît au changement de case ou d'objet, puis s'efface.
    const off = inv.offhand[0];
    this.offhandView.set(off);
    if (this.changed('offhandOn', off !== null)) this.offhandBox.style.display = off !== null ? 'block' : '';
    const held = inv.slots[selected];
    const id = held ? held.id : 0;
    const heldKey = `${selected}:${id}:${held?.potion ?? ''}`;
    if (this.changed('held', heldKey)) {
      this.heldName.textContent = id ? (held?.potion ? potionLabel(held.potion, id === I.SPLASH_POTION) : itemLabel(id)) : '';
      this.heldTimer = id ? 2 : 0;
    }
    if (this.heldTimer > 0 || this.memo.get('heldOp') !== 0) {
      this.heldTimer = Math.max(0, this.heldTimer - dt);
      this.opacity('heldOp', this.heldName, this.heldTimer > 0.5 ? 1 : this.heldTimer / 0.5);
    }
  }

  private updateChat(): void {
    const now = performance.now() / 1000;
    // seules les dernières lignes peuvent encore être visibles : on s'arrête à la première éteinte
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      if (line.shown < 0) break;
      const age = now - line.born;
      const o = age < CHAT_VISIBLE ? 1 : Math.round(Math.max(0, 1 - (age - CHAT_VISIBLE) / CHAT_FADE) * 10) / 10;
      if (o === line.shown) continue;
      if (o <= 0) {
        line.shown = -1;
        line.el.classList.add('mc-gone');
      } else {
        line.shown = o;
        line.el.style.opacity = String(o);
      }
    }
  }

  private updateDebug(g: UiGame, dt: number): void {
    const showFps = this.host.settings.showFps && !this.debugOn;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      if (showFps) {
        const text = `${Math.round(this.fpsFrames / this.fpsTime)} FPS`;
        if (this.changed('fpsText', text)) this.fps.textContent = text;
      }
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (this.changed('fpsOn', showFps)) this.fps.style.display = showFps ? 'block' : '';

    if (!this.debugOn) return;
    this.debugTimer -= dt;
    if (this.debugTimer > 0) return;
    this.debugTimer = 0.1;
    const lines = g.debugLines();
    this.fillDebug(this.debugLeft, lines.left, 'dl');
    this.fillDebug(this.debugRight, lines.right, 'dr');
  }

  private fillDebug(col: HTMLDivElement, lines: readonly string[], key: string): void {
    while (col.childElementCount < lines.length) el('div', 'mc-debug-line', col);
    while (col.childElementCount > lines.length) {
      this.memo.delete(`${key}${col.childElementCount - 1}`);
      col.lastElementChild?.remove();
    }
    for (let i = 0; i < lines.length; i++) {
      if (!this.changed(`${key}${i}`, lines[i])) continue;
      const line = col.children[i] as HTMLElement;
      line.textContent = lines[i];
      line.classList.toggle('mc-empty', lines[i] === '');
    }
  }

  /** Barre de vie du boss, en haut au centre. */
  private updateBoss(g: UiGame): void {
    const b = g.boss;
    if (this.changed('bossShown', b !== null)) this.boss.style.display = b ? 'block' : 'none';
    if (!b) return;
    if (this.changed('bossName', b.name)) this.bossName.textContent = b.name;
    const pct = Math.round(Math.max(0, Math.min(1, b.progress)) * 1000) / 10;
    if (this.changed('bossPct', pct)) this.bossFill.style.width = `${pct}%`;
  }

  private static readonly EFFECT_LABELS: Record<string, string> = {
    speed: 'Rapidité',
    slow: 'Lenteur',
    strength: 'Force',
    regeneration: 'Régénération',
    fire_resistance: 'Résistance au feu',
    night_vision: 'Vision nocturne',
    poison: 'Poison',
    weakness: 'Faiblesse',
    wither: 'Flétrissement',
  };

  private updateEffects(g: UiGame): void {
    const list = g.activeEffects;
    const key = list.map((e) => `${e.type}:${e.level}:${Math.ceil(e.ticks / 20)}`).join('|');
    if (!this.changed('effectsKey', key)) return;
    this.effectsBox.textContent = '';
    for (const fx of list) {
      const sec = Math.max(0, Math.ceil(fx.ticks / 20));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const lvl = fx.level >= 2 ? ' II' : '';
      const label = Hud.EFFECT_LABELS[fx.type] ?? fx.type;
      const pill = el('div', 'mc-effect-pill', this.effectsBox);
      pill.textContent = `${label}${lvl} ${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }

  private updateGuideAndToast(g: UiGame, dt: number): void {
    const goal = !this.debugOn && g.gameMode === 'survival' ? g.guideGoal : '';
    if (this.changed('guideGoal', goal)) {
      this.guide.textContent = goal;
      this.guide.style.display = goal ? 'block' : 'none';
    }

    if (this.toastTimer <= 0 && this.toastQueue.length > 0) {
      const next = this.toastQueue.shift()!;
      this.toastTitle.textContent = next.title;
      this.toastDetail.textContent = next.detail;
      this.toastIcon.set(next.iconId ? { id: next.iconId, count: 1, damage: 0 } : null);
      this.toastTimer = 6;
      this.toast.classList.add('mc-shown');
    } else if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toast.classList.remove('mc-shown');
      }
    }
  }
}
