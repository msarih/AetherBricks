/**
 * Interface du jeu (DOM + CSS) : HUD et écrans, à la manière de Minecraft (édition Java).
 *
 *   const ui = new GameUi(document.getElementById('ui')!, host);
 *   // à chaque image : ui.update(dt)
 *
 * `root` est un élément plein écran posé au-dessus du canevas 3D. Il ne capte jamais la souris
 * (`pointer-events: none`) : seuls les écrans ouverts la captent. Toutes les dimensions sont en
 * « pixels d'interface », multipliés par l'échelle (variable CSS `--u`).
 *
 * Clavier : le jeu écoute `keydown` sur `window` en phase de capture et arrête la propagation de
 * ses propres touches tant qu'aucun écran n'est ouvert. L'interface écoute sur `document`, en
 * capture elle aussi : elle passe donc après le jeu et ne voit pas la touche qui vient d'ouvrir
 * un écran. Dès qu'un écran est ouvert (`modal`), c'est elle qui traite les touches.
 */
import type { Menu } from '../game/Inventory';
import { T } from '../world/Tiles';
import { Hud } from './Hud';
import type { Screen, TitlePage, UiContext } from './Screen';
import { ChatScreen, DeathScreen, LoadingScreen, OptionsScreen, PauseScreen } from './Screens';
import { SlotScreen } from './SlotScreen';
import { installSprites } from './Sprites';
import { TitleMenu } from './TitleMenu';
import type { UiApi, UiHost } from './UiApi';
import './ui.css';

/** Durée pendant laquelle une erreur signalée reste à afficher sur le prochain menu principal (ms). */
const ERROR_KEEP_MS = 3000;

export class GameUi implements UiApi {
  private readonly hud: Hud;
  private readonly ctx: UiContext;
  private readonly observer: ResizeObserver | null;
  private screen: Screen | null = null;
  /** Instant d'ouverture de l'écran courant : une touche plus ancienne ne le concerne pas. */
  private openedAt = 0;
  private scaleValue = 0;
  private guiScale = -1;
  private width = 0;
  private height = 0;
  private dirt = false;
  private lastError = '';
  private lastErrorAt = 0;
  private disposed = false;

  constructor(private readonly root: HTMLElement, private readonly host: UiHost) {
    root.classList.add('mc-ui');
    installSprites(root);
    this.hud = new Hud(host, root);

    const chatHistory: string[] = [];
    this.ctx = {
      host,
      root,
      chatHistory,
      scale: () => this.scaleValue,
      refreshScale: () => this.layout(),
      isCurrent: (s) => this.screen === s,
      hasScreen: () => this.screen !== null,
      closeScreen: () => this.closeScreen(),
      openPause: () => this.openPause(),
      openOptions: (back, pausing) => this.setScreen(new OptionsScreen(this.ctx, back, pausing)),
      openTitle: (page, error) => this.openTitle(page, error),
      fail: (message) => this.fail(message),
    };

    this.layout();
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.layout());
    this.observer?.observe(root);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKey, true);
    root.addEventListener('contextmenu', this.prevent);
    root.addEventListener('dragstart', this.prevent);
    root.addEventListener('selectstart', this.onSelectStart);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.setScreen(null);
    this.observer?.disconnect();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKey, true);
    this.root.removeEventListener('contextmenu', this.prevent);
    this.root.removeEventListener('dragstart', this.prevent);
    this.root.removeEventListener('selectstart', this.onSelectStart);
    this.hud.el.remove();
    this.root.classList.remove('mc-ui');
  }

  // ------------------------------------------------------------------ états

  get modal(): boolean {
    return this.screen !== null;
  }

  get pausing(): boolean {
    return this.screen !== null && this.screen.pausing;
  }

  // ------------------------------------------------------------------ écrans

  showTitle(): void {
    this.openTitle('main');
  }

  showLoading(title: string, detail: string, progress: number): void {
    let s = this.screen;
    if (!(s instanceof LoadingScreen)) {
      s = new LoadingScreen();
      this.setScreen(s);
    }
    (s as LoadingScreen).set(title, detail, progress);
  }

  showGame(): void {
    this.setScreen(null);
  }

  openMenu(menu: Menu): void {
    this.setScreen(new SlotScreen(this.ctx, menu));
  }

  openPause(): void {
    this.setScreen(new PauseScreen(this.ctx));
  }

  openChat(initial = ''): void {
    this.setScreen(new ChatScreen(this.ctx, initial));
  }

  showDeath(message: string): void {
    this.setScreen(new DeathScreen(this.ctx, message));
  }

  closeScreen(): void {
    this.setScreen(null);
  }

  // ------------------------------------------------------------------ HUD

  addMessage(text: string): void {
    this.hud.addMessage(text);
  }

  actionBar(text: string): void {
    this.hud.actionBar(text);
  }

  toggleDebug(): void {
    this.hud.toggleDebug();
  }

  setHudVisible(visible: boolean): void {
    this.hud.setVisible(visible);
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (this.host.settings.guiScale !== this.guiScale) this.layout();
    const s = this.screen;
    this.hud.update(dt, !(s && s.opaque));
    s?.update?.(dt);
  }

  // ------------------------------------------------------------------ interne

  private openTitle(page: TitlePage, error?: string): void {
    let message = error ?? '';
    if (message) {
      this.lastError = message;
      this.lastErrorAt = performance.now();
    } else if (this.lastError && performance.now() - this.lastErrorAt < ERROR_KEEP_MS) {
      // l'application rappelle showTitle() juste après un échec : le message ne doit pas disparaître
      message = this.lastError;
    }
    this.setScreen(new TitleMenu(this.ctx, page, message));
  }

  private fail(message: string): void {
    this.lastError = message;
    this.lastErrorAt = performance.now();
    this.hud.addMessage(message);
    console.error(`[interface] ${message}`);
  }

  private setScreen(next: Screen | null): void {
    const prev = this.screen;
    if (prev === next) return;
    this.screen = next;
    if (prev) {
      prev.dispose?.();
      prev.el.remove();
    }
    this.hud.setChatOpen(next instanceof ChatScreen);
    if (!next) return;
    if (!this.dirt) this.applyDirt();
    this.openedAt = performance.now();
    this.root.appendChild(next.el);
    next.opened?.();
  }

  /** Fond de terre des menus : tuile de l'atlas, publiée dans la variable CSS `--mc-dirt`. */
  private applyDirt(): void {
    let url = '';
    try {
      url = this.host.tileUrl(T.dirt);
    } catch {
      url = '';
    }
    if (!url) return;
    this.dirt = true;
    this.root.style.setProperty('--mc-dirt', `url("${url}")`);
  }

  /** Calcule l'échelle et publie `--u` (pixel d'interface) ainsi que le centre de l'écran. */
  private layout(): void {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    const wanted = this.host.settings.guiScale;
    const fit = Math.max(1, Math.min(4, Math.floor(Math.min(w / 320, h / 240))));
    // échelle choisie par le joueur, bornée à ce que l'écran peut afficher (320×240 au minimum)
    const scale = wanted >= 1 ? Math.max(1, Math.min(Math.round(wanted), fit)) : fit;
    this.guiScale = wanted;
    if (scale === this.scaleValue && w === this.width && h === this.height) return;
    this.scaleValue = scale;
    this.width = w;
    this.height = h;
    const style = this.root.style;
    style.setProperty('--u', `${scale}px`);
    style.setProperty('--cx', `${Math.floor(w / 2)}px`);
    style.setProperty('--cy', `${Math.floor(h / 2)}px`);
  }

  private readonly onResize = (): void => {
    this.layout();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const s = this.screen;
    if (!s || !s.key) return;
    // touche enfoncée avant l'ouverture de l'écran (celle qui l'a ouvert) : pas pour lui
    if (e.timeStamp < this.openedAt) return;
    if (s.key(e)) e.stopImmediatePropagation();
  };

  private readonly prevent = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onSelectStart = (e: Event): void => {
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
  };
}
