/**
 * Petit canevas de pixels 16×16 pour dessiner les textures de manière procédurale.
 * Module pur (pas de DOM) : les textures sont générées dans de simples tableaux d'octets,
 * ce qui les rend déterministes et testables hors navigateur.
 */
import { mulberry32 } from '../../world/gen/Noise';

export const TS = 16;

/** Couleur 0xRRGGBB. */
export type Color = number;

export function rgb(r: number, g: number, b: number): Color {
  const cr = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
  const cg = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
  const cb = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
  return (cr << 16) | (cg << 8) | cb;
}

export function red(c: Color): number {
  return (c >> 16) & 255;
}
export function green(c: Color): number {
  return (c >> 8) & 255;
}
export function blue(c: Color): number {
  return c & 255;
}

/** Mélange linéaire de deux couleurs. */
export function mix(a: Color, b: Color, t: number): Color {
  return rgb(
    red(a) + (red(b) - red(a)) * t,
    green(a) + (green(b) - green(a)) * t,
    blue(a) + (blue(b) - blue(a)) * t
  );
}

/** Multiplie la luminosité d'une couleur. */
export function shade(c: Color, f: number): Color {
  return rgb(red(c) * f, green(c) * f, blue(c) * f);
}

/** Multiplie deux couleurs composante par composante (teinte). */
export function tint(c: Color, t: Color): Color {
  return rgb((red(c) * red(t)) / 255, (green(c) * green(t)) / 255, (blue(c) * blue(t)) / 255);
}

/** Niveau de gris perçu (0..255). */
export function luma(c: Color): number {
  return 0.299 * red(c) + 0.587 * green(c) + 0.114 * blue(c);
}

export class Px {
  readonly d = new Uint8ClampedArray(TS * TS * 4);
  readonly rnd: () => number;

  constructor(seed: number) {
    this.rnd = mulberry32(seed);
  }

  /** Entier aléatoire dans [0, n). */
  int(n: number): number {
    return Math.floor(this.rnd() * n);
  }

  /** Choisit un élément au hasard. */
  pick<V>(arr: readonly V[]): V {
    return arr[this.int(arr.length)];
  }

  set(x: number, y: number, c: Color, a = 255): void {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    this.d[i] = (c >> 16) & 255;
    this.d[i + 1] = (c >> 8) & 255;
    this.d[i + 2] = c & 255;
    this.d[i + 3] = a;
  }

  /** Comme set, mais avec repli torique (utile pour les motifs qui doivent se répéter). */
  setWrap(x: number, y: number, c: Color, a = 255): void {
    this.set(((x % TS) + TS) % TS, ((y % TS) + TS) % TS, c, a);
  }

  get(x: number, y: number): Color {
    const i = ((y & 15) * TS + (x & 15)) * 4;
    return (this.d[i] << 16) | (this.d[i + 1] << 8) | this.d[i + 2];
  }

  alpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return 0;
    return this.d[(y * TS + x) * 4 + 3];
  }

  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    this.d[i] = this.d[i + 1] = this.d[i + 2] = this.d[i + 3] = 0;
  }

  fill(c: Color, a = 255): void {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) this.set(x, y, c, a);
  }

  rect(x0: number, y0: number, w: number, h: number, c: Color, a = 255): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
  }

  /** Contour rectangulaire d'un pixel d'épaisseur. */
  frame(x0: number, y0: number, w: number, h: number, c: Color, a = 255): void {
    for (let x = x0; x < x0 + w; x++) {
      this.set(x, y0, c, a);
      this.set(x, y0 + h - 1, c, a);
    }
    for (let y = y0; y < y0 + h; y++) {
      this.set(x0, y, c, a);
      this.set(x0 + w - 1, y, c, a);
    }
  }

  /** Applique une fonction à chaque pixel ; retourner null laisse le pixel inchangé. */
  each(fn: (x: number, y: number) => Color | null): void {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const c = fn(x, y);
        if (c !== null) this.set(x, y, c);
      }
    }
  }

  /** Multiplie la luminosité d'un pixel existant. */
  mul(x: number, y: number, f: number): void {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    this.d[i] = this.d[i] * f;
    this.d[i + 1] = this.d[i + 1] * f;
    this.d[i + 2] = this.d[i + 2] * f;
  }

  /** Mélange une couleur dans un pixel existant. */
  blend(x: number, y: number, c: Color, t: number): void {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    this.set(x, y, mix(this.get(x, y), c, t), Math.max(this.alpha(x, y), 1) === 1 ? 255 : this.alpha(x, y));
  }

  /** Copie les pixels d'un autre canevas. */
  copy(src: Px): void {
    this.d.set(src.d);
  }

  /**
   * Champ de bruit lissé et périodique sur 16 pixels (valeurs dans [0, 1]).
   * gx / gy = nombre de cellules de la grille sur chaque axe (plus petit = taches plus larges).
   */
  field(gx: number, gy: number): (x: number, y: number) => number {
    const grid = new Float32Array(gx * gy);
    for (let i = 0; i < grid.length; i++) grid[i] = this.rnd();
    return (x: number, y: number) => {
      const fx = (x / TS) * gx;
      const fy = (y / TS) * gy;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      let tx = fx - x0;
      let ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const xa = ((x0 % gx) + gx) % gx;
      const xb = (xa + 1) % gx;
      const ya = ((y0 % gy) + gy) % gy;
      const yb = (ya + 1) % gy;
      const a = grid[ya * gx + xa];
      const b = grid[ya * gx + xb];
      const c = grid[yb * gx + xa];
      const d = grid[yb * gx + xb];
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
  }

  /**
   * Remplit la tuile avec une matière « rocheuse » : taches lissées + grain par pixel,
   * quantifiées sur une palette ordonnée du plus sombre au plus clair.
   */
  rough(palette: readonly Color[], gx = 4, gy = 4, grain = 0.45): void {
    const f = this.field(gx, gy);
    const n = palette.length;
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const v = f(x, y) * (1 - grain) + this.rnd() * grain;
        const idx = Math.min(n - 1, Math.max(0, Math.floor(v * n)));
        this.set(x, y, palette[idx]);
      }
    }
  }

  /** Parsème des pixels d'une couleur donnée (densité 0..1). */
  speckle(c: Color, density: number, a = 255): void {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        if (this.rnd() < density) this.set(x, y, c, a);
      }
    }
  }

  /** Dessine un sprite à partir de lignes de caractères ('.' ou ' ' = transparent). */
  ascii(rows: readonly string[], palette: Record<string, Color>, ox = 0, oy = 0): void {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const c = palette[ch];
        if (c === undefined) continue;
        this.set(x + ox, y + oy, c);
      }
    }
  }

  /** Ajoute un contour sombre autour des pixels opaques (style des objets Minecraft). */
  outline(c: Color): void {
    const snapshot = new Uint8Array(TS * TS);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) snapshot[y * TS + x] = this.alpha(x, y) > 0 ? 1 : 0;
    const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < TS && y < TS && snapshot[y * TS + x] === 1;
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        if (opaque(x, y)) continue;
        if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) this.set(x, y, c);
      }
    }
  }
}

export type Painter = (p: Px) => void;
