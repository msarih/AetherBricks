/**
 * Briques DOM de l'interface : création d'éléments, unités « pixel d'interface », boutons et
 * curseurs façon Minecraft, affichage d'une pile d'objets.
 */
import type { ItemStack, Slot } from '../world/ItemStack';
import { maxDamage } from '../world/ItemStack';
import { enchantLines, hasEnchants } from '../world/Enchants';
import { itemLabel } from '../world/Items';
import type { UiHost } from './UiApi';

/** Crée un élément, avec classe(s), parent et texte facultatifs. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: Element | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Longueur CSS de `n` pixels d'interface (multipliés par l'échelle courante). */
export function u(n: number): string {
  return `calc(var(--u) * ${n})`;
}

/** Place un élément en absolu, en pixels d'interface. */
export function place(e: HTMLElement, x: number, y: number, w?: number, h?: number): void {
  e.style.left = u(x);
  e.style.top = u(y);
  if (w !== undefined) e.style.width = u(w);
  if (h !== undefined) e.style.height = u(h);
}

/** Bouton gris texturé ; joue le son de clic puis appelle `onClick`. `id` : repère `data-mc` (tests). */
export function button(host: UiHost, label: string, onClick: () => void, id = '', parent?: Element | null): HTMLButtonElement {
  const b = el('button', 'mc-btn', parent);
  b.type = 'button';
  if (id) b.dataset.mc = id;
  el('span', 'mc-btn-label', b, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    host.click();
    onClick();
  });
  return b;
}

export function setButtonLabel(b: HTMLElement, label: string): void {
  const span = b.querySelector('.mc-btn-label');
  if (span && span.textContent !== label) span.textContent = label;
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  /** Libellé complet pour une valeur (« Champ de vision : 70 »). */
  format: (value: number) => string;
  onChange: (value: number) => void;
  id?: string;
}

/** Curseur façon Minecraft : rail sombre, poignée en forme de bouton, libellé centré. */
export function slider(host: UiHost, opts: SliderOptions, parent?: Element | null): HTMLDivElement {
  const root = el('div', 'mc-slider', parent);
  root.tabIndex = 0;
  if (opts.id) root.dataset.mc = opts.id;
  const knob = el('div', 'mc-slider-knob', root);
  const label = el('span', 'mc-btn-label', root);
  let value = opts.value;
  const steps = Math.round((opts.max - opts.min) / opts.step);
  const render = (): void => {
    const f = (value - opts.min) / (opts.max - opts.min);
    knob.style.left = `calc((100% - var(--u) * 8) * ${Math.max(0, Math.min(1, f)).toFixed(4)})`;
    label.textContent = opts.format(value);
  };
  const setValue = (v: number): void => {
    const k = Math.max(0, Math.min(steps, Math.round((v - opts.min) / opts.step)));
    // évite 0,30000000000000004 : on repart du pas entier
    const next = Number((opts.min + k * opts.step).toFixed(6));
    if (next === value) return;
    value = next;
    render();
    opts.onChange(value);
  };
  const fromPointer = (e: PointerEvent): void => {
    const r = root.getBoundingClientRect();
    const kw = knob.getBoundingClientRect().width;
    const f = (e.clientX - r.left - kw / 2) / Math.max(1, r.width - kw);
    setValue(opts.min + f * (opts.max - opts.min));
  };
  let dragging = false;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    root.classList.add('mc-active');
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* capture indisponible : le glissé reste limité au curseur */
    }
    fromPointer(e);
  });
  root.addEventListener('pointermove', (e) => {
    if (dragging) fromPointer(e);
  });
  const end = (): void => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('mc-active');
    host.click();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft') setValue(value - opts.step);
    else if (e.code === 'ArrowRight') setValue(value + opts.step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  render();
  return root;
}

/** Signature d'une pile ('' = vide) : sert à ne toucher au DOM que si la case a changé. */
export function stackSig(s: Slot): string {
  if (!s) return '';
  if (!s.enchants) return `${s.id}:${s.count}:${s.damage}`;
  return `${s.id}:${s.count}:${s.damage}:${JSON.stringify(s.enchants)}`;
}

/** Lignes de l'infobulle d'une pile : nom, enchantements, puis durabilité si l'objet est usé. */
export function stackTooltip(s: ItemStack): string[] {
  const lines = [itemLabel(s.id), ...enchantLines(s.enchants)];
  const max = maxDamage(s.id);
  if (max > 0 && s.damage > 0) lines.push(`Durabilité : ${Math.max(0, max - s.damage)} / ${max}`);
  return lines;
}

/** Affichage d'une pile : icône 16×16, quantité, barre d'usure. Ne touche au DOM que si la pile change. */
export class ItemView {
  readonly el: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly bar: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private sig = '\0';
  private iconId = 0;

  constructor(private readonly host: UiHost, parent?: Element | null, cls = '') {
    this.el = el('div', cls ? `mc-item ${cls}` : 'mc-item', parent);
    this.bar = el('div', 'mc-item-bar', this.el);
    this.barFill = el('div', 'mc-item-bar-fill', this.bar);
    this.count = el('span', 'mc-item-count', this.el);
  }

  /** Met à jour l'affichage ; retourne true si quelque chose a changé. */
  set(stack: Slot): boolean {
    const sig = stackSig(stack);
    if (sig === this.sig) return false;
    this.sig = sig;
    const id = stack ? stack.id : 0;
    if (id !== this.iconId) {
      this.iconId = id;
      const url = id ? this.host.iconUrl(id) : '';
      this.el.style.backgroundImage = url ? `url("${url}")` : '';
    }
    this.count.textContent = stack && stack.count !== 1 ? String(stack.count) : '';
    this.el.classList.toggle('mc-enchanted', hasEnchants(stack));
    const max = stack ? maxDamage(stack.id) : 0;
    if (stack && max > 0 && stack.damage > 0) {
      const f = Math.max(0, Math.min(1, 1 - stack.damage / max));
      this.bar.style.display = 'block';
      this.barFill.style.width = `${Math.round(f * 13) / 13 * 100}%`;
      this.barFill.style.backgroundColor = `hsl(${Math.round(f * 120)}, 100%, 50%)`;
    } else {
      this.bar.style.display = '';
    }
    return true;
  }
}
