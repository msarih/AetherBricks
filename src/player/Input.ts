/**
 * Entrées du joueur : clavier (par position physique des touches, donc ZQSD sur un clavier AZERTY),
 * souris, molette et capture du pointeur.
 * Les états maintenus (touches, boutons) sont lus par le jeu à chaque tick ; les appuis sont transmis
 * immédiatement par les rappels `onKey` et `onWheel`. Quand `blocked()` est vrai (un écran de l'interface
 * capte les entrées), rien n'est transmis au jeu.
 */
export class Input {
  /** Appui sur une touche (`event.code`, `event.key`). Retourner true si le jeu l'a consommée. */
  onKey: (code: string, repeat: boolean, key: string) => boolean = () => false;
  /** Cran de molette : +1 vers le bas, −1 vers le haut. */
  onWheel: (direction: number) => void = () => {};
  /** La capture du pointeur vient d'être perdue sans que le jeu l'ait demandé (touche Échap). */
  onLockLost: () => void = () => {};
  /** Un écran de l'interface capte le clavier et la souris. */
  blocked: () => boolean = () => false;
  /** Le jeu accepte-t-il de capturer la souris (partie en cours) ? */
  active: () => boolean = () => false;

  /** Déplacement de la souris accumulé depuis la dernière lecture (pixels). */
  mouseDX = 0;
  mouseDY = 0;
  /** Déplacement analogique (tactile / manette) : -1..1. */
  analogForward = 0;
  analogStrafe = 0;
  /** États virtuels maintenus (tactile / manette). */
  virtualJump = false;
  virtualSneak = false;
  virtualSprint = false;
  /** Le mode tactile est-il actif ? (empêche le verrouillage du pointeur). */
  touchActive: () => boolean = () => false;
  /** Boutons maintenus : 0 gauche, 1 milieu, 2 droit. */
  readonly buttons = [false, false, false];
  /** Nombre d'appuis depuis la dernière lecture (un clic bref entre deux ticks n'est pas perdu). */
  readonly presses = [0, 0, 0];

  private readonly keys = new Set<string>();
  private releasing = false;
  private wheelRest = 0;
  private readonly off: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | Document | HTMLElement, type: K | string, fn: (e: never) => void, options?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn as EventListener, options);
      this.off.push(() => target.removeEventListener(type, fn as EventListener, options));
    };

    // Phase de capture : le jeu voit la touche avant l'interface, et l'arrête s'il la consomme
    // (sinon la touche qui ouvre un écran le refermerait aussitôt).
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (this.blocked() || !this.active()) return;
      if (isTyping(e.target)) return;
      if (!e.repeat) this.keys.add(e.code);
      const used = this.onKey(e.code, e.repeat, e.key);
      if (used || GAME_KEYS.has(e.code) || e.key === '/') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true });
    on(window, 'keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    }, { capture: true });
    on(window, 'blur', () => this.clear());

    on(canvas, 'mousedown', (e: MouseEvent) => {
      if (this.blocked() || !this.active()) return;
      if (this.touchActive()) return;
      e.preventDefault();
      if (!this.locked) {
        this.lock();
        return;
      }
      if (e.button >= 0 && e.button < 3) {
        this.buttons[e.button] = true;
        this.presses[e.button]++;
      }
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button >= 0 && e.button < 3) this.buttons[e.button] = false;
    });
    on(document, 'mousemove', (e: MouseEvent) => {
      if (!this.locked || this.blocked()) return;
      // Certains navigateurs envoient un saut énorme juste après la capture : on l'ignore.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on(canvas, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      if (this.blocked() || !this.active()) return;
      this.wheelRest += e.deltaY;
      // Un cran de molette classique vaut ~100 ; les pavés tactiles envoient beaucoup de petits deltas.
      while (Math.abs(this.wheelRest) >= 50) {
        const dir = Math.sign(this.wheelRest);
        this.wheelRest -= dir * Math.min(Math.abs(this.wheelRest), 100);
        this.onWheel(dir);
      }
    }, { passive: false });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());

    on(document, 'pointerlockchange', () => {
      if (this.locked) return;
      const wanted = this.releasing;
      this.releasing = false;
      this.clear();
      if (!wanted) this.onLockLost();
    });
    on(document, 'pointerlockerror', () => {
      this.releasing = false;
    });
  }

  /** La souris est-elle capturée par le jeu ? */
  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Demande la capture de la souris (doit suivre un geste de l'utilisateur ; peut échouer en silence). */
  lock(): void {
    if (this.locked || this.touchActive()) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      // Refusé : un clic sur le jeu redemandera la capture.
    }
  }

  /** Relâche la souris à la demande du jeu (ouverture d'un écran) : `onLockLost` n'est pas appelé. */
  unlock(): void {
    this.clear();
    if (!this.locked) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Oublie toutes les touches et tous les boutons maintenus. */
  clear(): void {
    this.keys.clear();
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
    this.presses[0] = this.presses[1] = this.presses[2] = 0;
    this.mouseDX = this.mouseDY = 0;
    this.analogForward = this.analogStrafe = 0;
    this.virtualJump = this.virtualSneak = this.virtualSprint = false;
    this.wheelRest = 0;
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
    this.clear();
  }
}

/** Touches dont le comportement par défaut du navigateur gênerait le jeu (défilement, recherche, onglets). */
const GAME_KEYS = new Set([
  'Space',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'F1',
  'F3',
  'F5',
  'Slash',
  'Quote',
  'ControlLeft',
  'AltLeft',
]);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}
