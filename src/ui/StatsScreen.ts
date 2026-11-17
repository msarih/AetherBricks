/**
 * Écran « Statistiques » (menu de pause), comme dans Minecraft 1.12 : quatre onglets —
 * général, blocs minés, objets fabriqués, créatures.
 */
import type { MobKind } from '../entity/MobModels';
import { MOB_NAMES, STAT } from '../game/Stats';
import { BLOCKS } from '../world/Blocks';
import { BLOCK_ID_LIMIT } from '../world/Ids';
import { itemLabel } from '../world/Items';
import { button, el } from './dom';
import type { Screen, UiContext } from './Screen';
import { sized } from './Screens';

type Tab = 'general' | 'blocks' | 'items' | 'mobs';

const TABS: Array<[Tab, string]> = [
  ['general', 'Général'],
  ['blocks', 'Blocs'],
  ['items', 'Objets'],
  ['mobs', 'Créatures'],
];

const FR = new Intl.NumberFormat('fr-FR');
const FR1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const FR2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Durée lisible à partir d'un nombre de ticks (20 par seconde). */
export function formatDuration(ticks: number): string {
  const s = Math.floor(ticks / 20);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Distance lisible à partir de centimètres. */
export function formatDistance(cm: number): string {
  const m = cm / 100;
  return m < 1000 ? `${FR1.format(m)} m` : `${FR2.format(m / 1000)} km`;
}

/** Dégâts en cœurs à partir de demi-cœurs. */
function formatHearts(points: number): string {
  return `${FR1.format(points / 2)} ♥`;
}

export class StatsScreen implements Screen {
  readonly el: HTMLDivElement;
  readonly pausing = true;
  private readonly list: HTMLDivElement;
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'general';

  constructor(private readonly ctx: UiContext, private readonly back: () => void) {
    const host = ctx.host;
    this.el = el('div', 'mc-screen mc-screen-dim mc-menu');
    this.el.dataset.mc = 'stats';
    el('div', 'mc-title', this.el, 'Statistiques');
    const tabs = el('div', 'mc-stats-tabs', this.el);
    for (const [id, label] of TABS) {
      const b = sized(button(host, label, () => this.show(id), `stats-tab-${id}`, tabs), 74);
      this.tabButtons.set(id, b);
    }
    this.list = el('div', 'mc-list mc-stats-list', this.el);
    this.list.dataset.mc = 'stats-list';
    sized(button(host, 'Terminé', () => this.back(), 'stats-done', this.el), 200);
    this.show('general');
  }

  key(e: KeyboardEvent): boolean {
    if (e.code !== 'Escape') return false;
    e.preventDefault();
    if (!e.repeat) this.back();
    return true;
  }

  private show(tab: Tab): void {
    this.tab = tab;
    for (const [id, b] of this.tabButtons) b.disabled = id === tab;
    this.list.textContent = '';
    this.list.scrollTop = 0;
    const stats = this.ctx.host.game?.stats ?? {};
    const get = (k: string): number => stats[k] ?? 0;
    switch (tab) {
      case 'general':
        this.row('Temps de jeu', formatDuration(get(STAT.PLAY_TIME)));
        this.row('Distance à pied', formatDistance(get(STAT.WALK)));
        this.row('Distance à la nage', formatDistance(get(STAT.SWIM)));
        this.row('Distance en vol', formatDistance(get(STAT.FLY)));
        this.row('Sauts', FR.format(get(STAT.JUMP)));
        this.row('Morts', FR.format(get(STAT.DEATHS)));
        this.row('Créatures vaincues', FR.format(get(STAT.MOB_KILLS)));
        this.row('Dégâts infligés', formatHearts(get(STAT.DAMAGE_DEALT)));
        this.row('Dégâts subis', formatHearts(get(STAT.DAMAGE_TAKEN)));
        this.row('Poissons pêchés', FR.format(get(STAT.FISH)));
        this.row('Animaux élevés', FR.format(get(STAT.BRED)));
        this.row('Nuits passées dans un lit', FR.format(get(STAT.SLEEP)));
        this.row('Échanges avec des villageois', FR.format(get(STAT.TRADES)));
        break;
      case 'blocks':
        this.counts(stats, 'mined:', (id) => (id < BLOCK_ID_LIMIT ? BLOCKS[id]?.label : undefined) ?? itemLabel(id), 'minés');
        break;
      case 'items':
        this.counts(stats, 'crafted:', (id) => itemLabel(id), 'fabriqués');
        break;
      case 'mobs':
        this.mobs(stats);
        break;
    }
  }

  /** Lignes « nom … nombre », triées du plus grand au plus petit. */
  private counts(stats: Readonly<Record<string, number>>, prefix: string, label: (id: number) => string, unit: string): void {
    const rows: Array<[number, number]> = [];
    for (const [k, v] of Object.entries(stats)) {
      if (!k.startsWith(prefix)) continue;
      const id = Number(k.slice(prefix.length));
      if (Number.isInteger(id) && v > 0) rows.push([id, v]);
    }
    rows.sort((a, b) => b[1] - a[1] || label(a[0]).localeCompare(label(b[0]), 'fr'));
    if (rows.length === 0) {
      el('div', 'mc-list-status', this.list, 'Rien pour l’instant');
      return;
    }
    for (const [id, n] of rows) this.row(label(id), `${FR.format(n)} ${unit}`, id);
  }

  private mobs(stats: Readonly<Record<string, number>>): void {
    const kinds = new Set<string>();
    for (const k of Object.keys(stats)) {
      if (k.startsWith('killed:')) kinds.add(k.slice(7));
      else if (k.startsWith('killed_by:')) kinds.add(k.slice(10));
    }
    const list = [...kinds].sort((a, b) => (MOB_NAMES[a as MobKind] ?? a).localeCompare(MOB_NAMES[b as MobKind] ?? b, 'fr'));
    if (list.length === 0) {
      el('div', 'mc-list-status', this.list, 'Rien pour l’instant');
      return;
    }
    for (const kind of list) {
      const killed = stats[`killed:${kind}`] ?? 0;
      const by = stats[`killed_by:${kind}`] ?? 0;
      const parts = [`${FR.format(killed)} vaincu${killed > 1 ? 's' : ''}`];
      if (by > 0) parts.push(`vous a vaincu ${FR.format(by)} fois`);
      this.row(MOB_NAMES[kind as MobKind] ?? kind, parts.join(' · '));
    }
  }

  private row(label: string, value: string, iconId = 0): void {
    const r = el('div', 'mc-stats-row', this.list);
    r.dataset.mc = 'stats-row';
    const name = el('span', 'mc-stats-name', r);
    if (iconId) {
      const url = this.ctx.host.iconUrl(iconId);
      if (url) {
        const icon = el('span', 'mc-stats-icon', name);
        icon.style.backgroundImage = `url("${url}")`;
      }
    }
    name.append(label);
    el('span', 'mc-stats-value', r, value);
  }
}
