/**
 * Écrans simples : pause, options (et page « Contrôles »), chat, mort, chargement.
 * Chacun construit son DOM, traite ses touches et prévient le jeu ou l'application.
 */
import type { Settings } from '../world/Storage';
import { button, el, setButtonLabel, slider, u } from './dom';
import { attempt, errorText, type Screen, type UiContext } from './Screen';

/** Fixe la largeur d'un élément en pixels d'interface. */
export function sized<E extends HTMLElement>(e: E, w: number): E {
  e.style.width = u(w);
  return e;
}

// ---------------------------------------------------------------------------------------- pause

export class PauseScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = true;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly error: HTMLDivElement;
  private busy = false;

  constructor(private readonly ctx: UiContext) {
    const host = ctx.host;
    this.el = el('div', 'mc-screen mc-screen-dim mc-menu');
    this.el.dataset.mc = 'pause';
    el('div', 'mc-title', this.el, 'Menu du jeu');
    el('div', 'mc-gap', this.el);
    this.buttons.push(
      sized(button(host, 'Retour au jeu', () => this.resume(), 'resume', this.el), 204),
      sized(button(host, 'Options…', () => ctx.openOptions(() => ctx.openPause(), true), 'options', this.el), 204),
      sized(button(host, 'Sauvegarder et quitter', () => this.quit(), 'quit', this.el), 204),
    );
    this.error = el('div', 'mc-error', this.el);
  }

  key(e: KeyboardEvent): boolean {
    if (e.code !== 'Escape') return false;
    e.preventDefault();
    if (!e.repeat && !this.busy) this.resume();
    return true;
  }

  private resume(): void {
    this.ctx.closeScreen();
    this.ctx.host.game?.resume();
  }

  private quit(): void {
    const ctx = this.ctx;
    this.busy = true;
    this.error.textContent = '';
    for (const b of this.buttons) b.disabled = true;
    setButtonLabel(this.buttons[2], 'Sauvegarde du monde…');
    attempt(() => ctx.host.quitToTitle()).then(
      () => {
        // l'application affiche en principe le menu principal elle-même ; sinon on s'en charge
        if (ctx.isCurrent(this)) ctx.openTitle('main');
      },
      (err: unknown) => {
        const message = `Sauvegarde impossible : ${errorText(err)}`;
        if (!ctx.isCurrent(this)) {
          ctx.fail(message);
          return;
        }
        this.busy = false;
        for (const b of this.buttons) b.disabled = false;
        setButtonLabel(this.buttons[2], 'Sauvegarder et quitter');
        this.error.textContent = message;
      },
    );
  }
}

// ---------------------------------------------------------------------------------------- options

const DIFFICULTIES = ['Paisible', 'Facile', 'Normal', 'Difficile'];

const CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['Avancer, reculer, aller à gauche, à droite', 'Z Q S D'],
  ['Sauter (double appui : voler en créatif)', 'Espace'],
  ['S\'accroupir', 'Maj'],
  ['Courir', 'Ctrl'],
  ['Casser, attaquer', 'Clic gauche'],
  ['Poser, utiliser', 'Clic droit'],
  ['Choisir le bloc visé', 'Clic milieu'],
  ['Changer de case', 'Molette, 1 à 9'],
  ['Inventaire', 'E'],
  ['Lâcher l\'objet', 'A'],
  ['Chat', 'T'],
  ['Commande', '/'],
  ['Cacher l\'interface', 'F1'],
  ['Écran de débogage', 'F3'],
  ['Vue à la 3ᵉ personne', 'F5'],
  ['Pause', 'Échap'],
];

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

export class OptionsScreen implements Screen {
  readonly el: HTMLDivElement;
  /** Les réglages occupent tout l'écran : le HUD, qui se lirait au travers, est masqué. */
  readonly opaque = true;
  private page: 'main' | 'controls' = 'main';

  constructor(private readonly ctx: UiContext, private readonly back: () => void, readonly pausing: boolean) {
    const inGame = ctx.host.game !== null;
    this.el = el('div', `mc-screen mc-page ${inGame ? 'mc-screen-dim' : 'mc-screen-dirt'}`);
    this.el.dataset.mc = 'options';
    this.showMain();
  }

  key(e: KeyboardEvent): boolean {
    if (e.code !== 'Escape') return false;
    e.preventDefault();
    if (e.repeat) return true;
    if (this.page === 'controls') this.showMain();
    else this.back();
    return true;
  }

  private change(): void {
    this.ctx.host.settingsChanged();
  }

  private toggle(parent: HTMLElement, key: BoolKey, label: string, on = 'Oui', off = 'Non'): void {
    const s = this.ctx.host.settings;
    const text = (): string => `${label} : ${s[key] ? on : off}`;
    const b = button(
      this.ctx.host,
      text(),
      () => {
        s[key] = !s[key];
        setButtonLabel(b, text());
        this.change();
      },
      key,
      parent,
    );
  }

  private range(parent: HTMLElement, key: NumKey, min: number, max: number, step: number, format: (v: number) => string): void {
    const s = this.ctx.host.settings;
    slider(
      this.ctx.host,
      {
        min,
        max,
        step,
        value: s[key],
        format,
        id: key,
        onChange: (v) => {
          s[key] = v;
          this.change();
        },
      },
      parent,
    );
  }

  private showMain(): void {
    const { host } = this.ctx;
    const s = host.settings;
    this.page = 'main';
    this.el.textContent = '';
    el('div', 'mc-page-head', this.el, 'Options');
    const body = el('div', 'mc-page-body', this.el);
    const grid = el('div', 'mc-grid', body);
    const percent = (label: string) => (v: number): string => (v <= 0 ? `${label} : désactivé` : `${label} : ${Math.round(v * 100)} %`);

    this.range(grid, 'fov', 30, 110, 1, (v) => (v === 70 ? 'Champ de vision : normal' : v >= 110 ? 'Champ de vision : Quake Pro' : `Champ de vision : ${v}`));
    this.range(grid, 'renderDistance', 2, 16, 1, (v) => `Distance de rendu : ${v} chunks`);
    this.range(grid, 'sensitivity', 0.1, 2, 0.05, (v) => `Sensibilité : ${Math.round(v * 100)} %`);
    this.toggle(grid, 'invertY', 'Inverser la souris');
    this.range(grid, 'soundVolume', 0, 1, 0.05, percent('Sons'));
    this.range(grid, 'musicVolume', 0, 1, 0.05, percent('Musique'));
    this.toggle(grid, 'fancyGraphics', 'Graphismes', 'détaillés', 'rapides');
    this.toggle(grid, 'smoothLighting', 'Éclairage adouci');
    this.toggle(grid, 'clouds', 'Nuages');
    this.toggle(grid, 'viewBobbing', 'Balancement de la vue');
    this.toggle(grid, 'showFps', 'Afficher les FPS');

    const scaleText = (): string => `Taille de l'interface : ${s.guiScale > 0 ? s.guiScale : 'auto'}`;
    const scale = button(
      host,
      scaleText(),
      () => {
        s.guiScale = (Math.max(0, Math.round(s.guiScale)) + 1) % 5;
        setButtonLabel(scale, scaleText());
        this.change();
        this.ctx.refreshScale();
      },
      'guiScale',
      grid,
    );

    const game = host.game;
    if (game) {
      const diffText = (): string => `Difficulté : ${DIFFICULTIES[game.difficulty] ?? game.difficulty}`;
      const diff = button(
        host,
        diffText(),
        () => {
          game.difficulty = (Math.max(0, Math.round(game.difficulty)) + 1) % DIFFICULTIES.length;
          setButtonLabel(diff, diffText());
        },
        'difficulty',
        grid,
      );
    }
    button(host, 'Contrôles…', () => this.showControls(), 'controls', grid);

    const foot = el('div', 'mc-page-foot', this.el);
    sized(button(host, 'Terminé', () => this.back(), 'done', foot), 200);
  }

  private showControls(): void {
    const { host } = this.ctx;
    this.page = 'controls';
    this.el.textContent = '';
    el('div', 'mc-page-head', this.el, 'Contrôles');
    const body = el('div', 'mc-page-body mc-list', this.el);
    const list = el('div', 'mc-keys', body);
    for (const [action, key] of CONTROLS) {
      const row = el('div', 'mc-key-row', list);
      el('span', 'mc-key-action', row, action);
      el('span', 'mc-key', row, key);
    }
    el('div', 'mc-note', list, 'Les touches sont repérées par leur position : sur un clavier QWERTY, Z Q S D se lisent W A S D et « A » est la touche Q.');
    const foot = el('div', 'mc-page-foot', this.el);
    sized(button(host, 'Terminé', () => this.showMain(), 'done', foot), 200);
  }
}

// ---------------------------------------------------------------------------------------- chat

const CHAT_MAX = 256;
const HISTORY_MAX = 100;

export class ChatScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;
  private readonly input: HTMLInputElement;
  private readonly suggest: HTMLDivElement;
  private historyAt: number;
  private draft = '';
  private proposals: string[] = [];
  private proposalAt = -1;
  /** Texte saisi au moment de la première touche Tab. */
  private proposalBase = '';

  constructor(private readonly ctx: UiContext, initial: string) {
    // calque plein écran transparent : un clic à côté ne doit pas atteindre le canevas du jeu
    this.el = el('div', 'mc-screen mc-chatscreen');
    this.el.dataset.mc = 'chat';
    const dock = el('div', 'mc-chat-dock', this.el);
    this.suggest = el('div', 'mc-chat-suggest', dock);
    const bar = el('div', 'mc-chat-bar', dock);
    this.input = el('input', 'mc-chat-input', bar);
    this.input.type = 'text';
    this.input.maxLength = CHAT_MAX;
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.value = initial;
    this.historyAt = ctx.chatHistory.length;
    this.input.addEventListener('input', () => this.clearProposals());
    this.el.addEventListener('mousedown', (e) => {
      if (e.target !== this.input) e.preventDefault();
    });
    // la molette fait défiler le journal, qui est affiché par le HUD sous ce calque
    this.el.addEventListener(
      'wheel',
      (e) => {
        const log = ctx.root.querySelector('.mc-chatlog');
        if (log) log.scrollTop += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
    // le chat garde le focus tant qu'il est ouvert (clic ailleurs)
    this.input.addEventListener('blur', () => {
      setTimeout(() => {
        if (this.ctx.isCurrent(this)) this.input.focus();
      }, 0);
    });
  }

  opened(): void {
    this.input.focus();
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  key(e: KeyboardEvent): boolean {
    switch (e.code) {
      case 'Escape':
        e.preventDefault();
        if (!e.repeat) this.cancel();
        return true;
      case 'Enter':
      case 'NumpadEnter':
        if (e.isComposing) return false;
        e.preventDefault();
        if (!e.repeat) this.submit();
        return true;
      case 'ArrowUp':
        e.preventDefault();
        this.history(-1);
        return true;
      case 'ArrowDown':
        e.preventDefault();
        this.history(1);
        return true;
      case 'Tab':
        e.preventDefault();
        this.complete();
        return true;
      default:
        if (document.activeElement !== this.input) this.input.focus();
        return false;
    }
  }

  private cancel(): void {
    this.ctx.closeScreen();
    this.ctx.host.game?.resume();
  }

  private submit(): void {
    const ctx = this.ctx;
    const game = ctx.host.game;
    const text = this.input.value.trim();
    ctx.closeScreen();
    if (text) {
      const h = ctx.chatHistory;
      if (h[h.length - 1] !== text) h.push(text);
      if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
      game?.chat(text);
    }
    // une commande peut avoir ouvert un autre écran : dans ce cas la souris n'est pas rendue au jeu
    if (!ctx.hasScreen()) game?.resume();
  }

  private setText(text: string): void {
    this.input.value = text.slice(0, CHAT_MAX);
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  private history(step: number): void {
    const h = this.ctx.chatHistory;
    const next = Math.max(0, Math.min(h.length, this.historyAt + step));
    if (next === this.historyAt) return;
    if (this.historyAt === h.length) this.draft = this.input.value;
    this.historyAt = next;
    this.setText(next === h.length ? this.draft : h[next]);
    this.clearProposals();
  }

  private clearProposals(): void {
    if (!this.proposals.length) return;
    this.proposals = [];
    this.proposalAt = -1;
    this.suggest.textContent = '';
    this.suggest.style.display = '';
  }

  /** Remplace la saisie par une proposition : ligne entière, ou seulement le dernier mot. */
  private applyProposal(base: string, proposal: string): string {
    if (proposal.startsWith('/') || (base !== '' && proposal.toLowerCase().startsWith(base.toLowerCase()))) return proposal;
    const cut = base.lastIndexOf(' ') + 1;
    const head = base.slice(0, cut);
    if (cut === 0 && base.startsWith('/')) return `/${proposal}`;
    return head + proposal;
  }

  private complete(): void {
    const game = this.ctx.host.game;
    if (!game) return;
    if (this.proposals.length > 1) {
      // nouvelle touche Tab : proposition suivante
      this.proposalAt = (this.proposalAt + 1) % this.proposals.length;
      this.setText(this.applyProposal(this.proposalBase, this.proposals[this.proposalAt]));
      this.markProposal();
      return;
    }
    const base = this.input.value;
    let list: string[];
    try {
      list = game.complete(base);
    } catch (err) {
      this.ctx.fail(`Complétion impossible : ${errorText(err)}`);
      return;
    }
    if (list.length === 0) return;
    if (list.length === 1) {
      this.setText(this.applyProposal(base, list[0]));
      return;
    }
    this.proposals = list.slice(0, 40);
    this.proposalBase = base;
    this.proposalAt = -1;
    this.suggest.textContent = '';
    for (const p of this.proposals) el('span', 'mc-chat-proposal', this.suggest, p);
    this.suggest.style.display = 'flex';
  }

  private markProposal(): void {
    const items = this.suggest.children;
    for (let i = 0; i < items.length; i++) items[i].classList.toggle('mc-sel', i === this.proposalAt);
  }
}

// ---------------------------------------------------------------------------------------- mort

export class DeathScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly error: HTMLDivElement;
  private timer: ReturnType<typeof setTimeout> | null;

  constructor(private readonly ctx: UiContext, message: string) {
    const host = ctx.host;
    this.el = el('div', 'mc-screen mc-death mc-menu');
    this.el.dataset.mc = 'death';
    el('div', 'mc-title mc-title-big', this.el, 'Vous êtes mort !');
    el('div', 'mc-death-message', this.el, message);
    el('div', 'mc-gap', this.el);
    this.buttons.push(
      sized(button(host, 'Réapparaître', () => this.respawn(), 'respawn', this.el), 204),
      sized(button(host, 'Menu principal', () => this.quit(), 'title', this.el), 204),
    );
    this.error = el('div', 'mc-error', this.el);
    // comme dans le jeu d'origine : boutons inactifs pendant une seconde (évite le clic réflexe)
    for (const b of this.buttons) b.disabled = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const b of this.buttons) b.disabled = false;
    }, 1000);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
  }

  /** Aucune touche ne ferme l'écran de mort. */
  key(e: KeyboardEvent): boolean {
    if (e.code !== 'Escape') return false;
    e.preventDefault();
    return true;
  }

  private respawn(): void {
    this.ctx.closeScreen();
    this.ctx.host.game?.respawn();
  }

  private quit(): void {
    const ctx = this.ctx;
    this.error.textContent = '';
    for (const b of this.buttons) b.disabled = true;
    attempt(() => ctx.host.quitToTitle()).then(
      () => {
        if (ctx.isCurrent(this)) ctx.openTitle('main');
      },
      (err: unknown) => {
        const message = `Sauvegarde impossible : ${errorText(err)}`;
        if (!ctx.isCurrent(this)) {
          ctx.fail(message);
          return;
        }
        for (const b of this.buttons) b.disabled = false;
        this.error.textContent = message;
      },
    );
  }
}

// ---------------------------------------------------------------------------------------- chargement

export class LoadingScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;
  readonly opaque = true;
  private readonly title: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private shown = -1;

  constructor() {
    this.el = el('div', 'mc-screen mc-screen-dirt mc-menu mc-loading');
    this.el.dataset.mc = 'loading';
    this.title = el('div', 'mc-title', this.el);
    this.detail = el('div', 'mc-loading-detail', this.el);
    const bar = el('div', 'mc-progress', this.el);
    this.fill = el('div', 'mc-progress-fill', bar);
  }

  set(title: string, detail: string, progress: number): void {
    if (this.title.textContent !== title) this.title.textContent = title;
    if (this.detail.textContent !== detail) this.detail.textContent = detail;
    const p = Math.round(Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * 100);
    if (p !== this.shown) {
      this.shown = p;
      this.fill.style.width = `${p}%`;
    }
  }
}
