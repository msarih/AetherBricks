/**
 * Menu principal : titre, liste des mondes (jouer, créer, renommer, supprimer), création d'un monde.
 * Toutes les opérations passent par UiHost ; une promesse rejetée est toujours affichée.
 */
import type { GameMode, WorldType } from '../world/Constants';
import type { WorldInfo } from '../world/Storage';
import { button, el, setButtonLabel, u } from './dom';
import { attempt, errorText, type Screen, type TitlePage, type UiContext } from './Screen';
import { sized } from './Screens';
import { LOGO_HEIGHT, LOGO_WIDTH } from './Sprites';

type Page = TitlePage | 'rename' | 'delete';

const MODE_LABEL: Record<GameMode, string> = { survival: 'Survie', creative: 'Créatif' };
const TYPE_LABEL: Record<WorldType, string> = { default: 'Normal', flat: 'Plat' };
const MODE_HINT: Record<GameMode, string> = {
  survival: 'Chercher des ressources, fabriquer, survivre à la faim et aux monstres',
  creative: 'Ressources illimitées, vol libre, destruction instantanée des blocs',
};
const DEFAULT_NAME = 'Nouveau monde';
const NAME_MAX = 32;

function dateText(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return 'jamais';
  try {
    return new Date(time).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return new Date(time).toISOString();
  }
}

export class TitleMenu implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = false;
  readonly opaque = true;

  private page: Page;
  private error: string;
  private worlds: WorldInfo[] | null = null;
  private selected = '';
  private busy = false;
  /** Incrémenté à chaque rechargement de la liste : une réponse en retard est ignorée. */
  private generation = 0;

  // éléments de la page courante
  private errorEl: HTMLDivElement | null = null;
  private listEl: HTMLDivElement | null = null;
  private worldButtons: HTMLButtonElement[] = [];
  private pageButtons: HTMLButtonElement[] = [];
  private nameInput: HTMLInputElement | null = null;
  private seedInput: HTMLInputElement | null = null;
  private focusFirst: HTMLElement | null = null;
  private newMode: GameMode = 'survival';
  private newType: WorldType = 'default';

  constructor(private readonly ctx: UiContext, page: TitlePage, error = '') {
    this.el = el('div', 'mc-screen mc-screen-dirt');
    this.el.dataset.mc = 'title';
    this.page = page;
    this.error = error;
    this.render();
  }

  opened(): void {
    this.focusFirst?.focus();
  }

  // ------------------------------------------------------------------ clavier

  key(e: KeyboardEvent): boolean {
    const typing = e.target instanceof HTMLInputElement;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat && !this.busy) this.goBack();
      return true;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (e.repeat || this.busy) return true;
      if (this.page === 'create') {
        e.preventDefault();
        this.create();
        return true;
      }
      if (this.page === 'rename') {
        e.preventDefault();
        this.rename();
        return true;
      }
      if (this.page === 'worlds' && !(e.target instanceof HTMLButtonElement) && this.current()) {
        e.preventDefault();
        this.play();
        return true;
      }
      return false;
    }
    if (this.page === 'worlds' && !typing && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      e.preventDefault();
      this.moveSelection(e.code === 'ArrowUp' ? -1 : 1);
      return true;
    }
    return false;
  }

  private goBack(): void {
    if (this.page === 'main') return;
    this.show(this.page === 'worlds' ? 'main' : 'worlds');
  }

  // ------------------------------------------------------------------ pages

  private show(page: Page, error = ''): void {
    this.page = page;
    this.error = error;
    this.render();
    this.focusFirst?.focus();
  }

  private render(): void {
    this.el.textContent = '';
    this.errorEl = null;
    this.listEl = null;
    this.worldButtons = [];
    this.pageButtons = [];
    this.nameInput = null;
    this.seedInput = null;
    this.focusFirst = null;
    this.busy = false;
    this.el.dataset.page = this.page;
    switch (this.page) {
      case 'worlds':
        this.renderWorlds();
        break;
      case 'create':
        this.renderCreate();
        break;
      case 'rename':
        this.renderRename();
        break;
      case 'delete':
        this.renderDelete();
        break;
      default:
        this.renderMain();
        break;
    }
  }

  private setError(message: string): void {
    this.error = message;
    if (this.errorEl) this.errorEl.textContent = message;
  }

  private warning(parent: HTMLElement): void {
    if (this.ctx.host.persistent) return;
    el('div', 'mc-warning', parent, 'Stockage indisponible : les mondes ne seront pas conservés après la fermeture de la page.');
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const b of this.pageButtons) b.disabled = busy;
    if (!busy) this.updateWorldButtons();
    else for (const b of this.worldButtons) b.disabled = true;
  }

  private renderMain(): void {
    const { host } = this.ctx;
    this.el.className = 'mc-screen mc-screen-dirt mc-menu mc-title-screen';
    const logoBox = el('div', 'mc-logo-box', this.el);
    const logo = el('div', 'mc-logo', logoBox);
    logo.style.width = u(LOGO_WIDTH);
    logo.style.height = u(LOGO_HEIGHT);
    logo.setAttribute('role', 'img');
    logo.setAttribute('aria-label', 'AetherBricks');
    el('div', 'mc-splash', logoBox, 'Fait de blocs !');
    el('div', 'mc-gap mc-gap-big', this.el);
    sized(button(host, 'Jouer', () => this.show('worlds'), 'play', this.el), 200);
    sized(button(host, 'Options…', () => this.ctx.openOptions(() => this.ctx.openTitle('main'), false), 'options', this.el), 200);
    const legacy = el('a', 'mc-btn mc-link', this.el);
    legacy.href = 'legacy.html';
    legacy.dataset.mc = 'legacy';
    legacy.style.width = u(200);
    legacy.addEventListener('click', () => host.click());
    el('span', 'mc-btn-label', legacy, 'Ancienne version (constructeur 3D)');
    this.warning(this.el);
    this.errorEl = el('div', 'mc-error', this.el, this.error);
    el('div', 'mc-footer', this.el, 'AetherBricks');
  }

  private renderWorlds(): void {
    const { host } = this.ctx;
    this.el.className = 'mc-screen mc-screen-dirt mc-page';
    const head = el('div', 'mc-page-head', this.el, 'Sélectionner un monde');
    this.warning(head);
    this.listEl = el('div', 'mc-page-body mc-list', this.el);
    this.listEl.dataset.mc = 'worlds';
    this.errorEl = el('div', 'mc-error', this.el, this.error);
    const foot = el('div', 'mc-page-foot mc-foot-rows', this.el);
    const row1 = el('div', 'mc-row', foot);
    const row2 = el('div', 'mc-row', foot);
    const play = sized(button(host, 'Jouer', () => this.play(), 'world-play', row1), 150);
    const create = sized(button(host, 'Créer un monde', () => this.show('create'), 'world-create', row1), 150);
    const rename = sized(button(host, 'Renommer', () => this.current() && this.show('rename'), 'world-rename', row2), 73);
    const remove = sized(button(host, 'Supprimer', () => this.current() && this.show('delete'), 'world-delete', row2), 73);
    const back = sized(button(host, 'Retour', () => this.show('main'), 'back', row2), 150);
    this.worldButtons = [play, rename, remove];
    this.pageButtons = [create, back];
    this.updateWorldButtons();
    this.fillList();
    this.loadWorlds();
  }

  private renderCreate(): void {
    const { host } = this.ctx;
    this.el.className = 'mc-screen mc-screen-dirt mc-page';
    el('div', 'mc-page-head', this.el, 'Créer un nouveau monde');
    const body = el('div', 'mc-page-body', this.el);
    const form = el('div', 'mc-form', body);
    el('label', 'mc-field-label', form, 'Nom du monde');
    this.nameInput = this.field(form, DEFAULT_NAME, 'name', NAME_MAX);
    el('label', 'mc-field-label', form, 'Graine pour la génération du monde');
    this.seedInput = this.field(form, '', 'seed', 64);
    el('div', 'mc-hint', form, 'Laisser vide pour une graine aléatoire');
    const row = el('div', 'mc-row', form);
    const hint = el('div', 'mc-hint mc-hint-center', form, MODE_HINT[this.newMode]);
    const mode = sized(
      button(
        host,
        `Mode de jeu : ${MODE_LABEL[this.newMode]}`,
        () => {
          this.newMode = this.newMode === 'survival' ? 'creative' : 'survival';
          setButtonLabel(mode, `Mode de jeu : ${MODE_LABEL[this.newMode]}`);
          hint.textContent = MODE_HINT[this.newMode];
        },
        'mode',
        row,
      ),
      150,
    );
    const type = sized(
      button(
        host,
        `Type de monde : ${TYPE_LABEL[this.newType]}`,
        () => {
          this.newType = this.newType === 'default' ? 'flat' : 'default';
          setButtonLabel(type, `Type de monde : ${TYPE_LABEL[this.newType]}`);
        },
        'type',
        row,
      ),
      150,
    );
    this.warning(form);
    this.errorEl = el('div', 'mc-error', this.el, this.error);
    const foot = el('div', 'mc-page-foot', this.el);
    const ok = sized(button(host, 'Créer un nouveau monde', () => this.create(), 'create', foot), 150);
    const cancel = sized(button(host, 'Annuler', () => this.show('worlds'), 'cancel', foot), 150);
    this.pageButtons = [mode, type, ok, cancel];
    this.focusFirst = this.nameInput;
    this.nameInput.select();
  }

  private renderRename(): void {
    const { host } = this.ctx;
    const world = this.current();
    if (!world) {
      this.page = 'worlds';
      this.renderWorlds();
      return;
    }
    this.el.className = 'mc-screen mc-screen-dirt mc-menu';
    el('div', 'mc-title', this.el, 'Renommer le monde');
    el('div', 'mc-gap', this.el);
    const form = el('div', 'mc-form', this.el);
    el('label', 'mc-field-label', form, 'Nom du monde');
    this.nameInput = this.field(form, world.name, 'name', NAME_MAX);
    this.errorEl = el('div', 'mc-error', this.el, this.error);
    const row = el('div', 'mc-row', this.el);
    const ok = sized(button(host, 'Renommer', () => this.rename(), 'confirm', row), 150);
    const cancel = sized(button(host, 'Annuler', () => this.show('worlds'), 'cancel', row), 150);
    this.pageButtons = [ok, cancel];
    this.focusFirst = this.nameInput;
    this.nameInput.select();
  }

  private renderDelete(): void {
    const { host } = this.ctx;
    const world = this.current();
    if (!world) {
      this.page = 'worlds';
      this.renderWorlds();
      return;
    }
    this.el.className = 'mc-screen mc-screen-dirt mc-menu';
    el('div', 'mc-title', this.el, 'Voulez-vous vraiment supprimer ce monde ?');
    el('div', 'mc-text', this.el, `« ${world.name} » sera perdu pour toujours ! (C'est très long !)`);
    el('div', 'mc-gap', this.el);
    this.errorEl = el('div', 'mc-error', this.el, this.error);
    const row = el('div', 'mc-row', this.el);
    const ok = sized(button(host, 'Supprimer', () => this.remove(), 'confirm', row), 150);
    const cancel = sized(button(host, 'Annuler', () => this.show('worlds'), 'cancel', row), 150);
    this.pageButtons = [ok, cancel];
  }

  private field(parent: HTMLElement, value: string, id: string, max: number): HTMLInputElement {
    const input = el('input', 'mc-input', parent);
    input.type = 'text';
    input.value = value;
    input.maxLength = max;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.dataset.mc = id;
    return input;
  }

  // ------------------------------------------------------------------ liste des mondes

  private current(): WorldInfo | null {
    return this.worlds?.find((w) => w.id === this.selected) ?? null;
  }

  private updateWorldButtons(): void {
    const on = !this.busy && this.current() !== null;
    for (const b of this.worldButtons) b.disabled = !on;
  }

  private loadWorlds(): void {
    const generation = ++this.generation;
    attempt(() => this.ctx.host.listWorlds()).then(
      (list) => {
        if (generation !== this.generation) return;
        this.worlds = [...list].sort((a, b) => b.lastPlayed - a.lastPlayed);
        if (!this.current()) this.selected = this.worlds[0]?.id ?? '';
        if (this.page === 'worlds') {
          this.fillList();
          this.updateWorldButtons();
        }
      },
      (err: unknown) => {
        if (generation !== this.generation) return;
        this.worlds = [];
        if (this.page === 'worlds') {
          this.fillList();
          this.updateWorldButtons();
          this.setError(`Lecture des mondes impossible : ${errorText(err)}`);
        }
      },
    );
  }

  private fillList(): void {
    const list = this.listEl;
    if (!list) return;
    list.textContent = '';
    if (this.worlds === null) {
      el('div', 'mc-list-status', list, 'Chargement des mondes…');
      return;
    }
    if (this.worlds.length === 0) {
      el('div', 'mc-list-status', list, 'Aucun monde pour l\'instant : créez-en un !');
      return;
    }
    for (const w of this.worlds) {
      const row = el('div', 'mc-world', list);
      row.dataset.id = w.id;
      row.classList.toggle('mc-sel', w.id === this.selected);
      const thumb = el('div', 'mc-world-thumb', row);
      if (w.thumbnail) thumb.style.backgroundImage = `url("${w.thumbnail.replace(/["\\\n]/g, '')}")`;
      else thumb.classList.add('mc-empty');
      const text = el('div', 'mc-world-text', row);
      el('div', 'mc-world-name', text, w.name || 'Monde sans nom');
      el('div', 'mc-world-line', text, `Dernière partie : ${dateText(w.lastPlayed)}`);
      el('div', 'mc-world-line', text, `Mode ${MODE_LABEL[w.gameMode] ?? w.gameMode}, monde ${(TYPE_LABEL[w.worldType] ?? w.worldType).toLowerCase()}`);
      row.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || this.busy) return;
        this.select(w.id);
      });
      row.addEventListener('dblclick', (e) => {
        if (e.button !== 0 || this.busy) return;
        this.select(w.id);
        this.ctx.host.click();
        this.play();
      });
    }
  }

  private select(id: string): void {
    this.selected = id;
    if (this.listEl) {
      for (const row of Array.from(this.listEl.children)) {
        if (row instanceof HTMLElement) row.classList.toggle('mc-sel', row.dataset.id === id);
      }
    }
    this.updateWorldButtons();
  }

  private moveSelection(step: number): void {
    const worlds = this.worlds;
    if (!worlds || worlds.length === 0 || this.busy) return;
    const at = worlds.findIndex((w) => w.id === this.selected);
    const next = Math.max(0, Math.min(worlds.length - 1, at + step));
    this.select(worlds[next].id);
    this.listEl?.children[next]?.scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------------ opérations

  /**
   * Lance une opération de l'hôte. En cas d'échec, l'erreur est affichée sur cet écran s'il est
   * encore visible, sinon sur un nouveau menu principal (page des mondes).
   */
  private run(what: string, fn: () => Promise<void>, done: () => void): void {
    const ctx = this.ctx;
    const page = this.page;
    this.setError('');
    this.setBusy(true);
    attempt(fn).then(
      () => {
        if (!ctx.isCurrent(this) || this.page !== page) return;
        this.setBusy(false);
        done();
      },
      (err: unknown) => {
        const message = `${what} : ${errorText(err)}`;
        if (ctx.isCurrent(this) && this.page === page) {
          this.setBusy(false);
          this.setError(message);
        } else {
          ctx.openTitle('worlds', message);
        }
      },
    );
  }

  private play(): void {
    const world = this.current();
    if (!world || this.busy) return;
    // en cas de succès, l'application affiche le chargement puis la partie
    this.run('Ouverture du monde impossible', () => this.ctx.host.playWorld(world.id), () => undefined);
  }

  private create(): void {
    if (this.busy || !this.nameInput || !this.seedInput) return;
    const name = this.nameInput.value.trim() || DEFAULT_NAME;
    const seed = this.seedInput.value.trim();
    const options = { name, seed, worldType: this.newType, gameMode: this.newMode };
    this.run('Création du monde impossible', () => this.ctx.host.createWorld(options), () => undefined);
  }

  private rename(): void {
    const world = this.current();
    if (!world || this.busy || !this.nameInput) return;
    const name = this.nameInput.value.trim();
    if (!name) {
      this.setError('Le nom ne peut pas être vide.');
      return;
    }
    if (name === world.name) {
      this.show('worlds');
      return;
    }
    this.run('Renommage impossible', () => this.ctx.host.renameWorld(world.id, name), () => this.show('worlds'));
  }

  private remove(): void {
    const world = this.current();
    if (!world || this.busy) return;
    this.run('Suppression impossible', () => this.ctx.host.deleteWorld(world.id), () => {
      this.selected = '';
      this.worlds = null;
      this.show('worlds');
    });
  }
}
