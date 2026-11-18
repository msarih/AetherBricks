/**
 * Écrans simples : pause, options (et page « Contrôles »), chat, mort, chargement.
 * Chacun construit son DOM, traite ses touches et prévient le jeu ou l'application.
 */
import { DEFAULT_KEYBINDS, formatKeyCode, type KeybindAction, type Settings } from '../world/Storage';
import { button, el, setButtonLabel, slider, u } from './dom';
import { attempt, errorText, type Screen, type UiContext } from './Screen';

/** Fixe la largeur d'un élément en pixels d'interface. */
export function sized<E extends HTMLElement>(e: E, w: number): E {
  e.style.width = u(w);
  return e;
}

// ------------------------------------------------------------------------------------- étiquette

/**
 * Saisie du nom donné à une créature avec une étiquette : une ligne, Entrée ou « Terminé »
 * pour valider, Échap pour abandonner (l'étiquette n'est alors pas consommée).
 * Le jeu continue pendant la saisie.
 */
export class NameScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;
  private readonly input: HTMLInputElement;

  constructor(private readonly ctx: UiContext, private readonly id: number, current: string, max: number) {
    const host = ctx.host;
    this.el = el('div', 'mc-screen mc-screen-dim mc-menu');
    this.el.dataset.mc = 'name';
    el('div', 'mc-title', this.el, 'Donner un nom');
    el('div', 'mc-gap', this.el);
    const board = el('div', 'mc-sign-board', this.el);
    this.input = el('input', 'mc-sign-line', board);
    this.input.type = 'text';
    this.input.maxLength = max;
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.value = current;
    this.input.dataset.mc = 'name-line';
    el('div', 'mc-gap', this.el);
    sized(button(host, 'Terminé', () => this.finish(true), 'name-done', this.el), 200);
    this.el.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) e.preventDefault();
    });
  }

  opened(): void {
    this.input.focus();
    this.input.select();
  }

  key(e: KeyboardEvent): boolean {
    switch (e.code) {
      case 'Escape':
        e.preventDefault();
        if (!e.repeat) this.finish(false);
        return true;
      case 'Enter':
      case 'NumpadEnter':
        if (e.isComposing) return false;
        e.preventDefault();
        if (!e.repeat) this.finish(true);
        return true;
      default:
        if (document.activeElement !== this.input) this.input.focus();
        return false;
    }
  }

  private finish(apply: boolean): void {
    const name = apply ? this.input.value.trim() : '';
    this.ctx.closeScreen();
    const game = this.ctx.host.game;
    if (name !== '') game?.setMobName(this.id, name);
    game?.resume();
  }
}

// ------------------------------------------------------------------------------------- panneau

/** Lignes d'un panneau (voir game/BlockEntities : SIGN_LINES, SIGN_LINE_MAX). */
const SIGN_LINES = 4;
const SIGN_LINE_MAX = 15;

/**
 * Saisie du texte d'un panneau qui vient d'être posé (Minecraft 1.12) : 4 lignes de 15 caractères,
 * Entrée ou flèche bas pour la ligne suivante, flèche haut pour la précédente, Échap ou « Terminé » pour finir.
 * Le jeu continue pendant la saisie.
 */
export class SignScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;
  private readonly inputs: HTMLInputElement[] = [];
  private done = false;

  constructor(
    private readonly ctx: UiContext,
    private readonly x: number,
    private readonly y: number,
    private readonly z: number,
    lines: readonly string[],
  ) {
    const host = ctx.host;
    this.el = el('div', 'mc-screen mc-screen-dim mc-menu');
    this.el.dataset.mc = 'sign';
    el('div', 'mc-title', this.el, 'Modifier le texte du panneau');
    el('div', 'mc-gap', this.el);
    const board = el('div', 'mc-sign-board', this.el);
    for (let i = 0; i < SIGN_LINES; i++) {
      const input = el('input', 'mc-sign-line', board);
      input.type = 'text';
      input.maxLength = SIGN_LINE_MAX;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.value = lines[i] ?? '';
      input.dataset.mc = `sign-line-${i}`;
      this.inputs.push(input);
    }
    el('div', 'mc-sign-post', this.el);
    el('div', 'mc-gap', this.el);
    sized(button(host, 'Terminé', () => this.finish(), 'sign-done', this.el), 200);
    // un clic à côté ne doit pas faire perdre la ligne en cours
    this.el.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) e.preventDefault();
    });
  }

  opened(): void {
    this.inputs[0].focus();
  }

  key(e: KeyboardEvent): boolean {
    const at = this.inputs.indexOf(document.activeElement as HTMLInputElement);
    switch (e.code) {
      case 'Escape':
        e.preventDefault();
        if (!e.repeat) this.finish();
        return true;
      case 'Enter':
      case 'NumpadEnter':
      case 'ArrowDown':
        if (e.isComposing) return false;
        e.preventDefault();
        this.focusLine(at < 0 ? 0 : (at + 1) % SIGN_LINES);
        return true;
      case 'ArrowUp':
        e.preventDefault();
        this.focusLine(at <= 0 ? SIGN_LINES - 1 : at - 1);
        return true;
      default:
        if (at < 0) this.inputs[0].focus();
        return false;
    }
  }

  private focusLine(i: number): void {
    const input = this.inputs[i];
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  /** Le texte est enregistré même si l'écran est fermé autrement (mort, retour au menu). */
  private save(): void {
    if (this.done) return;
    this.done = true;
    this.ctx.host.game?.setSignText(this.x, this.y, this.z, this.inputs.map((i) => i.value));
  }

  private finish(): void {
    this.save();
    this.ctx.closeScreen();
    this.ctx.host.game?.resume();
  }

  dispose(): void {
    this.save();
  }
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
      sized(button(host, 'Statistiques', () => ctx.openStats(() => ctx.openPause()), 'stats', this.el), 204),
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
    setButtonLabel(this.buttons[3], 'Sauvegarde du monde…');
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
        setButtonLabel(this.buttons[3], 'Sauvegarder et quitter');
        this.error.textContent = message;
      },
    );
  }
}

// ---------------------------------------------------------------------------------------- options

const DIFFICULTIES = ['Paisible', 'Facile', 'Normal', 'Difficile'];

const KEYBIND_ROWS: ReadonlyArray<readonly [KeybindAction, string]> = [
  ['forward', 'Avancer'],
  ['left', 'Aller à gauche'],
  ['backward', 'Reculer'],
  ['right', 'Aller à droite'],
  ['jump', 'Sauter (double appui : voler en créatif)'],
  ['sneak', 'S\'accroupir'],
  ['sprint', 'Courir'],
  ['inventory', 'Inventaire'],
  ['offhand', 'Échanger les mains'],
  ['drop', 'Lâcher l\'objet'],
  ['chat', 'Chat'],
  ['command', 'Commande'],
  ['perspective', 'Vue à la 3ᵉ personne'],
];

const FIXED_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['Casser, attaquer', 'Clic gauche'],
  ['Poser, utiliser', 'Clic droit'],
  ['Choisir le bloc visé', 'Clic milieu'],
  ['Changer de case', 'Molette, 1 à 9'],
  ['Cacher l\'interface / Débogage', 'F1 / F3'],
  ['Pause', 'Échap'],
];

const RESERVED_CODES = new Set<string>([
  'Escape',
  'F1',
  'F3',
  'Enter',
  'NumpadEnter',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
]);

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

export class OptionsScreen implements Screen {
  readonly el: HTMLDivElement;
  /** Les réglages occupent tout l'écran : le HUD, qui se lirait au travers, est masqué. */
  readonly opaque = true;
  private page: 'main' | 'controls' = 'main';
  private bindingAction: KeybindAction | null = null;
  private readonly keyBtns = new Map<KeybindAction, HTMLButtonElement>();
  private layoutBtn: HTMLButtonElement | null = null;

  constructor(private readonly ctx: UiContext, private readonly back: () => void, readonly pausing: boolean) {
    const inGame = ctx.host.game !== null;
    this.el = el('div', `mc-screen mc-page ${inGame ? 'mc-screen-dim' : 'mc-screen-dirt'}`);
    this.el.dataset.mc = 'options';
    this.showMain();
  }

  key(e: KeyboardEvent): boolean {
    if (this.bindingAction !== null) {
      e.preventDefault();
      if (e.repeat) return true;
      const action = this.bindingAction;
      this.bindingAction = null;
      if (e.code !== 'Escape') {
        this.ctx.host.settings.keybinds[action] = e.code;
        this.change();
      }
      this.refreshKeyLabels();
      return true;
    }
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
    const s = host.settings;
    this.page = 'controls';
    this.bindingAction = null;
    this.keyBtns.clear();
    this.el.textContent = '';
    el('div', 'mc-page-head', this.el, 'Contrôles');
    const body = el('div', 'mc-page-body mc-list', this.el);
    const list = el('div', 'mc-keys', body);

    const layoutRow = el('div', 'mc-key-row mc-key-row-head', list);
    el('span', 'mc-key-action', layoutRow, 'Disposition du clavier');
    const layoutBtn = sized(
      button(
        host,
        '',
        () => {
          this.bindingAction = null;
          s.keyboardLayout = s.keyboardLayout === 'azerty' ? 'qwerty' : 'azerty';
          this.change();
          this.refreshKeyLabels();
        },
        'keyboardLayout',
        layoutRow,
      ),
      96,
    );
    this.layoutBtn = layoutBtn;

    for (const [action, label] of KEYBIND_ROWS) {
      const row = el('div', 'mc-key-row', list);
      el('span', 'mc-key-action', row, label);
      const b = sized(
        button(
          host,
          '',
          () => {
            this.bindingAction = this.bindingAction === action ? null : action;
            this.refreshKeyLabels();
          },
          `bind-${action}`,
          row,
        ),
        96,
      );
      b.classList.add('mc-key-btn');
      this.keyBtns.set(action, b);
    }

    for (const [action, key] of FIXED_CONTROLS) {
      const row = el('div', 'mc-key-row', list);
      el('span', 'mc-key-action', row, action);
      el('span', 'mc-key', row, key);
    }

    el('div', 'mc-note', list, 'Cliquez sur une touche puis appuyez sur la nouvelle touche souhaitée (Échap pour annuler).');
    const foot = el('div', 'mc-page-foot', this.el);
    sized(
      button(
        host,
        'Réinitialiser',
        () => {
          this.bindingAction = null;
          s.keybinds = { ...DEFAULT_KEYBINDS };
          this.change();
          this.refreshKeyLabels();
        },
        'reset-keys',
        foot,
      ),
      130,
    );
    sized(button(host, 'Terminé', () => this.showMain(), 'done', foot), 130);
    this.refreshKeyLabels();
  }

  private refreshKeyLabels(): void {
    const s = this.ctx.host.settings;
    if (this.layoutBtn) {
      setButtonLabel(this.layoutBtn, s.keyboardLayout === 'azerty' ? 'AZERTY' : 'QWERTY');
    }
    const counts = new Map<string, number>();
    for (const [action] of KEYBIND_ROWS) {
      const code = s.keybinds[action];
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    for (const [action, btn] of this.keyBtns) {
      const active = this.bindingAction === action;
      const code = s.keybinds[action];
      const conflict = (counts.get(code) ?? 0) > 1 || RESERVED_CODES.has(code);
      const text = active ? `> ${formatKeyCode(code, s.keyboardLayout)} <` : formatKeyCode(code, s.keyboardLayout);
      setButtonLabel(btn, text);
      btn.classList.toggle('mc-binding', active);
      btn.classList.toggle('mc-conflict', conflict && !active);
    }
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

// ---------------------------------------------------------------------------------------- fin du jeu

/** Écran de fin : affiché une fois, au retour de l'End après la victoire sur le dragon. */
export class WinScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;

  constructor(private readonly ctx: UiContext) {
    this.el = el('div', 'mc-screen mc-win mc-menu');
    this.el.dataset.mc = 'win';
    el('div', 'mc-title mc-title-big', this.el, 'Fin');
    el('div', 'mc-win-text', this.el, 'Le dragon de l’Ender est vaincu. Vous avez traversé la surface, le Nether et l’End.');
    el('div', 'mc-win-text', this.el, 'Le monde reste ouvert : il y a encore tout à bâtir.');
    el('div', 'mc-gap', this.el);
    sized(button(ctx.host, 'Retourner dans le monde', () => this.close(), 'continue', this.el), 204);
  }

  dispose(): void {}

  key(e: KeyboardEvent): boolean {
    if (e.code !== 'Escape' && e.code !== 'Enter') return false;
    e.preventDefault();
    this.close();
    return true;
  }

  private close(): void {
    this.ctx.closeScreen();
    this.ctx.host.game?.resume();
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
