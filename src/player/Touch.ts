/**
 * Détection et commandes tactiles (téléphone et tablette, façon Minecraft Bedrock).
 *
 * - Détection automatique : `matchMedia('(pointer: coarse)')` ou premier événement `touchstart`,
 *   modulée par `settings.touchMode` ('auto' | 'on' | 'off').
 * - En jeu : le glissé sur l'écran tourne le regard ; un appui court pose un bloc / utilise /
 *   attaque la créature visée ; un appui long maintenu casse le bloc visé (même progression
 *   qu'à la souris).
 */
import type { Settings } from '../world/Storage';
import type { Input } from './Input';

/** Délai (ms) à partir duquel un doigt immobile déclenche le minage continu. */
const LONG_PRESS_MS = 220;
/** Seuil de déplacement (pixels CSS) au-delà duquel un contact devient un glissé de regard. */
const MOVE_THRESHOLD_PX = 10;
/** Facteur de sensibilité tactile par rapport aux pixels de souris. */
const TOUCH_LOOK_SCALE = 1.6;

let coarseDetected = false;
let listenerInstalled = false;
const listeners = new Set<() => void>();

function checkCoarseMedia(): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
    }
  } catch {
    // matchMedia indisponible
  }
  return false;
}

export function initTouchDetection(onChange?: () => void): void {
  if (onChange) listeners.add(onChange);
  if (checkCoarseMedia()) coarseDetected = true;
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;

  const markTouch = (): void => {
    if (!coarseDetected) {
      coarseDetected = true;
      for (const fn of listeners) fn();
    }
  };
  window.addEventListener('touchstart', markTouch, { passive: true, capture: true });
  try {
    const mq = window.matchMedia('(pointer: coarse)');
    mq.addEventListener?.('change', (e) => {
      if (e.matches) markTouch();
      else for (const fn of listeners) fn();
    });
  } catch {
    // ignore
  }
}

/** Indique si le mode tactile est actif compte tenu des réglages et du matériel détecté. */
export function isTouchActive(settings: Settings): boolean {
  if (settings.touchMode === 'on') return true;
  if (settings.touchMode === 'off') return false;
  return coarseDetected || checkCoarseMedia();
}

export interface LookTouchOptions {
  canvas: HTMLCanvasElement;
  input: Input;
  isTouchActive: () => boolean;
  /** Retourne vrai si la cible visée est une entité (un appui court attaque au lieu de poser). */
  hasTargetEntity: () => boolean;
  /** Oriente le regard vers le point (clientX, clientY) de l'écran avant un appui court ou long. */
  aimAtScreenPoint?: (clientX: number, clientY: number) => void;
}

interface ActiveLookTouch {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  mining: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Gère les gestes tactiles sur le canevas 3D (regard, appui long pour casser, appui court pour poser / attaquer).
 */
export class TouchLookController {
  private active: ActiveLookTouch | null = null;
  private readonly off: Array<() => void> = [];

  constructor(private readonly opts: LookTouchOptions) {
    const { canvas } = opts;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
      canvas.addEventListener(type, fn as EventListener, options);
      this.off.push(() => canvas.removeEventListener(type, fn as EventListener, options));
    };

    const onWin = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, options?: AddEventListenerOptions): void => {
      window.addEventListener(type, fn as EventListener, options);
      this.off.push(() => window.removeEventListener(type, fn as EventListener, options));
    };

    on('touchstart', (e: TouchEvent) => this.onTouchStart(e), { passive: false });
    onWin('touchmove', (e: TouchEvent) => this.onTouchMove(e), { passive: false });
    onWin('touchend', (e: TouchEvent) => this.onTouchEnd(e), { passive: false });
    onWin('touchcancel', (e: TouchEvent) => this.onTouchCancel(e), { passive: false });
  }

  private onTouchStart(e: TouchEvent): void {
    const { input, isTouchActive } = this.opts;
    if (!isTouchActive() || input.blocked() || !input.active()) return;
    e.preventDefault();
    if (this.active !== null || e.changedTouches.length === 0) return;
    const t = e.changedTouches[0];
    const state: ActiveLookTouch = {
      id: t.identifier,
      startX: t.clientX,
      startY: t.clientY,
      lastX: t.clientX,
      lastY: t.clientY,
      moved: false,
      mining: false,
      timer: setTimeout(() => {
        if (this.active !== state || state.moved) return;
        state.timer = null;
        if (input.blocked() || !input.active()) return;
        this.opts.aimAtScreenPoint?.(state.startX, state.startY);
        state.mining = true;
        input.buttons[0] = true;
        input.presses[0]++;
      }, LONG_PRESS_MS),
    };
    this.active = state;
  }

  private onTouchMove(e: TouchEvent): void {
    const { input } = this.opts;
    const state = this.active;
    if (!state) return;
    if (e.cancelable) e.preventDefault();
    let t: Touch | null = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === state.id) {
        t = e.changedTouches[i];
        break;
      }
    }
    if (!t && e.touches.length > 0) t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - state.lastX;
    const dy = t.clientY - state.lastY;
    state.lastX = t.clientX;
    state.lastY = t.clientY;
    if (!state.moved) {
      const totalDist = Math.hypot(t.clientX - state.startX, t.clientY - state.startY);
      if (totalDist > MOVE_THRESHOLD_PX) {
        state.moved = true;
        if (state.timer !== null) {
          clearTimeout(state.timer);
          state.timer = null;
        }
      }
    }
    if (state.moved && !input.blocked() && input.active()) {
      input.mouseDX += dx * TOUCH_LOOK_SCALE;
      input.mouseDY += dy * TOUCH_LOOK_SCALE;
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    const state = this.active;
    if (!state) return;
    let t: Touch | null = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === state.id) {
        t = e.changedTouches[i];
        break;
      }
    }
    if (!t && e.touches.length === 0 && e.changedTouches.length > 0) {
      t = e.changedTouches[0];
    }
    if (!t && e.touches.length > 0) return;
    if (e.cancelable) e.preventDefault();
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const { input } = this.opts;
    if (state.mining) {
      input.buttons[0] = false;
    } else if (!state.moved && !input.blocked() && input.active()) {
      if (t) this.opts.aimAtScreenPoint?.(t.clientX, t.clientY);
      if (this.opts.hasTargetEntity()) {
        input.presses[0]++;
      } else {
        input.presses[2]++;
      }
    }
    this.active = null;
  }

  private onTouchCancel(e: TouchEvent): void {
    const state = this.active;
    if (!state) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === state.id) {
        this.reset();
        break;
      }
    }
  }

  reset(): void {
    const state = this.active;
    if (!state) return;
    if (state.timer !== null) clearTimeout(state.timer);
    if (state.mining) this.opts.input.buttons[0] = false;
    this.active = null;
  }

  dispose(): void {
    this.reset();
    for (const f of this.off) f();
    this.off.length = 0;
  }
}
