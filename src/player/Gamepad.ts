/**
 * Manette de jeu (API Gamepad standard : Xbox / PlayStation, façon Minecraft édition console).
 *
 * En jeu :
 *  - Stick gauche : déplacement (avant/arrière, gauche/droite) ;
 *  - Stick droit : regard (avec `settings.gamepadSensitivity` et `settings.invertY`) ;
 *  - Gâchette droite (RT / R2, bouton 7) : casser / attaquer ;
 *  - Gâchette gauche (LT / L2, bouton 6) : poser / utiliser ;
 *  - A / Croix (0) : sauter (double appui : voler en créatif) ;
 *  - B / Rond (1) : s'accroupir / descendre en vol ;
 *  - X / Carré (2) : jeter l'objet tenu ;
 *  - Y / Triangle (3) : inventaire ;
 *  - Gâchettes hautes LB / RB (4 / 5) : objet précédent / suivant dans la barre ;
 *  - Start (9) : pause ;
 *  - Clic du stick gauche L3 (10) : sprint.
 *
 * Dans les menus et écrans d'inventaire :
 *  - Croix directionnelle (12..15) ou stick gauche : déplacer la sélection ;
 *  - A (0) : valider / cliquer sur la case ou le bouton sélectionné ;
 *  - B (1) : revenir / fermer l'écran.
 *
 * Branchement et débranchement à chaud signalés par un message à l'écran.
 */
import type { Settings } from '../world/Storage';

const DEADZONE = 0.18;
const TRIGGER_THRESHOLD = 0.35;
/** Vitesse de rotation du regard au stick droit (pixels équivalents par seconde à sensibilité 1). */
const STICK_LOOK_PIXELS_PER_SEC = 780;
/** Répétition de la navigation dans les menus (secondes). */
const NAV_INITIAL_DELAY = 0.28;
const NAV_REPEAT_INTERVAL = 0.12;

function applyDeadzone(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  if (a <= DEADZONE) return 0;
  return Math.sign(v) * Math.min(1, (a - DEADZONE) / (1 - DEADZONE));
}

function btnPressed(gp: Gamepad, index: number, threshold = 0.5): boolean {
  const b = gp.buttons[index];
  if (!b) return false;
  if (typeof b === 'number') return b >= threshold;
  return b.pressed || (typeof b.value === 'number' && b.value >= threshold);
}

export interface GamepadHost {
  readonly settings: Settings;
  /** Un écran modal (menu principal, pause, inventaire…) est-il ouvert ? */
  isModal(): boolean;
  /** Une partie est-elle active (prête et non en pause/modal) ? */
  isInGame(): boolean;
  /** Racine DOM de l'interface pour la navigation dans les menus. */
  readonly uiRoot: HTMLElement;
  /** Affiche une notification brève (branchement / débranchement). */
  notify(text: string): void;
  /** Alimente le déplacement et les actions en jeu. */
  setGamepadState(state: {
    forward: number;
    strafe: number;
    lookDX: number;
    lookDY: number;
    jumpDown: boolean;
    jumpPressed: boolean;
    sneakDown: boolean;
    sprintDown: boolean;
    sprintPressed: boolean;
    attackDown: boolean;
    attackPressed: boolean;
    useDown: boolean;
    usePressed: boolean;
    dropPressed: boolean;
    inventoryPressed: boolean;
    pausePressed: boolean;
    pttDown?: boolean;
    wheelDelta: number;
  }): void;
}

export class GamepadController {
  private readonly known = new Map<number, string>();
  private readonly prevButtons = new Array<boolean>(16).fill(false);
  private hadActivePad = false;
  private sprintToggled = false;
  private navDir: 'up' | 'down' | 'left' | 'right' | null = null;
  private navTimer = 0;
  private focusedEl: HTMLElement | null = null;
  private readonly off: Array<() => void> = [];

  constructor(private readonly host: GamepadHost) {
    if (typeof window !== 'undefined') {
      const onConn = (e: Event): void => {
        const ge = e as GamepadEvent;
        if (ge.gamepad) {
          this.known.set(ge.gamepad.index, ge.gamepad.id || 'Manette');
          this.host.notify('Manette connectée');
        }
      };
      const onDisc = (e: Event): void => {
        const ge = e as GamepadEvent;
        if (ge.gamepad) {
          this.known.delete(ge.gamepad.index);
          this.clearFocus();
          this.host.notify('Manette déconnectée');
        }
      };
      window.addEventListener('gamepadconnected', onConn);
      window.addEventListener('gamepaddisconnected', onDisc);
      this.off.push(() => {
        window.removeEventListener('gamepadconnected', onConn);
        window.removeEventListener('gamepaddisconnected', onDisc);
      });
    }
  }

  private readActiveGamepad(): Gamepad | null {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
      const list = navigator.getGamepads();
      if (!list) return null;
      let active: Gamepad | null = null;
      const seenIndices = new Set<number>();
      for (let i = 0; i < list.length; i++) {
        const gp = list[i];
        if (!gp || gp.connected === false) continue;
        seenIndices.add(gp.index ?? i);
        if (!this.known.has(gp.index ?? i)) {
          this.known.set(gp.index ?? i, gp.id || 'Manette');
          this.host.notify('Manette connectée');
        }
        if (!active) active = gp;
      }
      for (const idx of [...this.known.keys()]) {
        if (!seenIndices.has(idx)) {
          this.known.delete(idx);
          this.clearFocus();
          this.host.notify('Manette déconnectée');
        }
      }
      return active;
    } catch {
      return null;
    }
  }

  update(dt: number): void {
    const gp = this.readActiveGamepad();
    if (!gp) {
      if (this.hadActivePad) {
        this.hadActivePad = false;
        this.prevButtons.fill(false);
        this.sprintToggled = false;
        this.host.setGamepadState({
          forward: 0,
          strafe: 0,
          lookDX: 0,
          lookDY: 0,
          jumpDown: false,
          jumpPressed: false,
          sneakDown: false,
          sprintDown: false,
          sprintPressed: false,
          attackDown: false,
          attackPressed: false,
          useDown: false,
          usePressed: false,
          dropPressed: false,
          inventoryPressed: false,
          pausePressed: false,
          wheelDelta: 0,
        });
      }
      return;
    }
    this.hadActivePad = true;

    const nowButtons = new Array<boolean>(16);
    const justPressed = new Array<boolean>(16);
    for (let i = 0; i < 16; i++) {
      const thresh = i === 6 || i === 7 ? TRIGGER_THRESHOLD : 0.5;
      const down = btnPressed(gp, i, thresh);
      nowButtons[i] = down;
      justPressed[i] = down && !this.prevButtons[i];
      this.prevButtons[i] = down;
    }

    const lx = applyDeadzone(gp.axes?.[0] ?? 0);
    const ly = applyDeadzone(gp.axes?.[1] ?? 0);
    const rx = applyDeadzone(gp.axes?.[2] ?? 0);
    const ry = applyDeadzone(gp.axes?.[3] ?? 0);

    if (this.host.isModal()) {
      this.sprintToggled = false;
      this.updateModalNavigation(dt, lx, ly, nowButtons, justPressed);
      return;
    }

    this.clearFocus();

    if (ly >= 0) this.sprintToggled = false;
    else if (justPressed[10]) this.sprintToggled = !this.sprintToggled;

    const sens = this.host.settings.gamepadSensitivity ?? 1;
    const lookDX = rx * STICK_LOOK_PIXELS_PER_SEC * sens * dt;
    const lookDY = ry * STICK_LOOK_PIXELS_PER_SEC * sens * dt;

    let wheelDelta = 0;
    if (justPressed[4]) wheelDelta -= 1;
    if (justPressed[5]) wheelDelta += 1;

    this.host.setGamepadState({
      forward: -ly,
      strafe: lx,
      lookDX,
      lookDY,
      jumpDown: nowButtons[0],
      jumpPressed: justPressed[0],
      sneakDown: nowButtons[1],
      sprintDown: nowButtons[10] || this.sprintToggled,
      sprintPressed: justPressed[10],
      attackDown: nowButtons[7],
      attackPressed: justPressed[7],
      useDown: nowButtons[6],
      usePressed: justPressed[6],
      dropPressed: justPressed[2],
      inventoryPressed: justPressed[3],
      pausePressed: justPressed[9],
      pttDown: nowButtons[11],
      wheelDelta,
    });
  }

  private updateModalNavigation(
    dt: number,
    lx: number,
    ly: number,
    nowButtons: readonly boolean[],
    justPressed: readonly boolean[],
  ): void {
    // B (1) ou Start (9) : revenir / fermer l'écran
    if (justPressed[1] || justPressed[9]) {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
      return;
    }

    // Direction demandée (croix directionnelle ou stick gauche)
    let dir: 'up' | 'down' | 'left' | 'right' | null = null;
    if (nowButtons[12] || ly < -0.5) dir = 'up';
    else if (nowButtons[13] || ly > 0.5) dir = 'down';
    else if (nowButtons[14] || lx < -0.5) dir = 'left';
    else if (nowButtons[15] || lx > 0.5) dir = 'right';

    if (dir !== null) {
      if (dir !== this.navDir) {
        this.navDir = dir;
        this.navTimer = NAV_INITIAL_DELAY;
        this.moveFocus(dir);
      } else {
        this.navTimer -= dt;
        if (this.navTimer <= 0) {
          this.navTimer = NAV_REPEAT_INTERVAL;
          this.moveFocus(dir);
        }
      }
    } else {
      this.navDir = null;
      this.navTimer = 0;
    }

    // A (0) : valider l'élément sélectionné
    if (justPressed[0]) {
      this.activateFocused();
    }
  }

  private getNavigableElements(): HTMLElement[] {
    const screen = this.host.uiRoot.querySelector<HTMLElement>('.mc-screen');
    if (!screen) return [];
    const candidates = screen.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [data-i], [data-p], [data-r], [data-tab], [data-trash], [data-mc="recipe-book-toggle"], [data-mc="recipe-filter"], .mc-world, .mc-slider, input:not([type="file"]):not([hidden])',
    );
    const out: HTMLElement[] = [];
    for (const el of Array.from(candidates)) {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      out.push(el);
    }
    return out;
  }

  private ensureFocus(items: HTMLElement[]): HTMLElement | null {
    if (items.length === 0) {
      this.clearFocus();
      return null;
    }
    if (this.focusedEl && items.includes(this.focusedEl)) return this.focusedEl;
    const first =
      items.find((e) => e.classList.contains('mc-sel')) ??
      items.find((e) => e.dataset.group === 'hotbar' || e.dataset.group === 'main') ??
      items[0];
    this.setFocus(first);
    return first;
  }

  private setFocus(el: HTMLElement | null): void {
    if (this.focusedEl === el) return;
    this.focusedEl?.classList.remove('mc-pad-focus');
    this.focusedEl = el;
    if (el) {
      el.classList.add('mc-pad-focus');
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
    }
  }

  private clearFocus(): void {
    if (this.focusedEl) {
      this.focusedEl.classList.remove('mc-pad-focus');
      this.focusedEl = null;
    }
    this.navDir = null;
  }

  private moveFocus(dir: 'up' | 'down' | 'left' | 'right'): void {
    const items = this.getNavigableElements();
    const cur = this.ensureFocus(items);
    if (!cur || items.length <= 1) return;

    // Cas d'un curseur (slider) : gauche / droite ajuste la valeur
    if (cur.classList.contains('mc-slider') && (dir === 'left' || dir === 'right')) {
      const code = dir === 'left' ? 'ArrowLeft' : 'ArrowRight';
      cur.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }));
      return;
    }

    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    const cy = cr.top + cr.height / 2;
    const vx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
    const vy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const item of items) {
      if (item === cur) continue;
      const r = item.getBoundingClientRect();
      const ix = r.left + r.width / 2;
      const iy = r.top + r.height / 2;
      const dx = ix - cx;
      const dy = iy - cy;
      const along = dx * vx + dy * vy;
      if (along <= 2) continue;
      const perp = Math.abs(dx * vy - dy * vx);
      const score = along + perp * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    if (best) {
      this.setFocus(best);
      best.scrollIntoView?.({ block: 'nearest' });
    }
  }

  private activateFocused(): void {
    const items = this.getNavigableElements();
    const cur = this.ensureFocus(items);
    if (!cur) return;
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cur instanceof HTMLButtonElement) {
      cur.click();
      return;
    }
    if (cur instanceof HTMLInputElement) {
      cur.focus();
      return;
    }
    cur.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: cx, clientY: cy }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: cx, clientY: cy }));
  }

  dispose(): void {
    this.clearFocus();
    for (const f of this.off) f();
    this.off.length = 0;
  }
}
