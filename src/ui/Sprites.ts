/**
 * Pixel art de l'interface, entièrement généré par code (petits canvas → data URL).
 * Aucune image externe : cœurs, gigots, armure, bulles, barre d'expérience, barre d'objets,
 * viseur, flèches, flamme du fourneau, fonds de fenêtre, boutons, onglets et logo.
 * `installSprites(root)` publie chaque image dans une variable CSS `--spr-…` lue par ui.css.
 */
import { getMobModel } from '../entity/MobModels';

type Palette = Record<string, string>;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Dessine des lignes de caractères : chaque caractère est un pixel de la palette (« . » = transparent). */
function art(rows: readonly string[], pal: Palette): string {
  const [c, ctx] = makeCanvas(rows[0].length, rows.length);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const color = pal[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c.toDataURL();
}

/** Générateur pseudo-aléatoire déterministe (textures identiques d'un chargement à l'autre). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------ icônes 9×9

const HEART = [
  '..##.##..',
  '.#rr#rr#.',
  '#rwrrrrd#',
  '#rrrrrrd#',
  '#rrrrrdd#',
  '.#rrrdd#.',
  '..#rdd#..',
  '...#d#...',
  '....#....',
];

const FOOD = [
  '.####....',
  '#mmmm#...',
  '#mhmmm#..',
  '#mmmmmm#.',
  '#mmmmmm#.',
  '.#mmmmd#.',
  '..#mdd#b#',
  '...###bb#',
  '......##.',
];

const ARMOR = [
  '.........',
  '.##...##.',
  '#wa###aa#',
  '#waaaaad#',
  '.#aaaad#.',
  '.#aaaad#.',
  '.#aaaad#.',
  '..#add#..',
  '...###...',
];

const BUBBLE = [
  '...###...',
  '.##bbb##.',
  '.#bwbbb#.',
  '#bwbbbbb#',
  '#bbbbbbb#',
  '#bbbbbbb#',
  '.#bbbbb#.',
  '.##bbb##.',
  '...###...',
];

const BUBBLE_POP = [
  '.#..#..#.',
  '..#...#..',
  '#.......#',
  '.........',
  '##.....##',
  '.........',
  '#.......#',
  '..#...#..',
  '.#..#..#.',
];

/**
 * Icône à trois états (0 vide, 1 moitié, 2 pleine) : les pixels de remplissage au-delà de la
 * moitié prennent la couleur du fond. `fromRight` : la moitié restante est celle de droite.
 */
function tri(rows: readonly string[], pal: Palette, empty: string, state: number, fromRight = false): string {
  const w = rows[0].length;
  const mid = Math.floor(w / 2);
  const out = rows.map((row) => {
    let s = '';
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.' || ch === '#') {
        s += ch;
        continue;
      }
      const filled = state === 2 || (state === 1 && (fromRight ? x > mid : x <= mid));
      s += filled ? ch : '_';
    }
    return s;
  });
  return art(out, { ...pal, _: empty });
}

// ------------------------------------------------------------------------------------ barres

function xpBar(fill: boolean): string {
  const [c, ctx] = makeCanvas(182, 5);
  if (!fill) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 182, 5);
    ctx.fillStyle = '#1b2a10';
    ctx.fillRect(1, 1, 180, 3);
    ctx.fillStyle = '#2c3f1c';
    ctx.fillRect(1, 1, 180, 1);
    ctx.fillStyle = '#0b1206';
    for (let x = 10; x < 181; x += 10) ctx.fillRect(x, 1, 1, 3);
  } else {
    ctx.fillStyle = '#17300a';
    ctx.fillRect(0, 0, 182, 5);
    ctx.fillStyle = '#b6f76a';
    ctx.fillRect(1, 1, 180, 1);
    ctx.fillStyle = '#80ff20';
    ctx.fillRect(1, 2, 180, 1);
    ctx.fillStyle = '#4f9f12';
    ctx.fillRect(1, 3, 180, 1);
    ctx.fillStyle = '#2f6a08';
    for (let x = 10; x < 181; x += 10) ctx.fillRect(x, 1, 1, 3);
  }
  return c.toDataURL();
}

function hotbar(): string {
  const [c, ctx] = makeCanvas(182, 22);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 182, 22);
  for (let i = 0; i < 9; i++) {
    const x = 1 + i * 20;
    // cadre gris biseauté de la case
    ctx.fillStyle = '#6f6f6f';
    ctx.fillRect(x, 1, 20, 20);
    ctx.fillStyle = '#a7a7a7';
    ctx.fillRect(x, 1, 20, 1);
    ctx.fillRect(x, 1, 1, 20);
    ctx.fillStyle = '#4b4b4b';
    ctx.fillRect(x, 20, 20, 1);
    ctx.fillRect(x + 19, 1, 1, 20);
    // fond translucide
    ctx.clearRect(x + 1, 2, 18, 18);
    ctx.fillStyle = 'rgba(22, 22, 22, 0.62)';
    ctx.fillRect(x + 1, 2, 18, 18);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x + 1, 2, 18, 1);
    ctx.fillRect(x + 1, 2, 1, 18);
  }
  return c.toDataURL();
}

function hotbarSelection(): string {
  const [c, ctx] = makeCanvas(24, 24);
  const rings = ['#000000', '#f4f4f4', '#c9c9c9', 'rgba(0, 0, 0, 0.45)'];
  for (let r = 0; r < rings.length; r++) {
    ctx.clearRect(r, r, 24 - 2 * r, 24 - 2 * r);
    ctx.fillStyle = rings[r];
    ctx.fillRect(r, r, 24 - 2 * r, 24 - 2 * r);
  }
  ctx.clearRect(4, 4, 16, 16);
  return c.toDataURL();
}

function crosshair(): string {
  const [c, ctx] = makeCanvas(9, 9);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 4, 9, 1);
  ctx.fillRect(4, 0, 1, 9);
  return c.toDataURL();
}

// ------------------------------------------------------------------------------------ flèches, flamme

function arrow(w: number, h: number, color: string): string {
  const [c, ctx] = makeCanvas(w, h);
  const cy = Math.floor(h / 2);
  const head = cy + 1; // largeur de la pointe
  ctx.fillStyle = color;
  ctx.fillRect(0, cy - 2, w - head, 5);
  for (let k = 0; k < head; k++) {
    const half = cy - k;
    ctx.fillRect(w - head + k, cy - half, 1, half * 2 + 1);
  }
  return c.toDataURL();
}

const FLAME = [
  '......#.......',
  '......##......',
  '.....###......',
  '....####..#...',
  '...#####.##...',
  '..######.###..',
  '..##########..',
  '.############.',
  '.############.',
  '.############.',
  '.############.',
  '..##########..',
  '..##########..',
  '...########...',
];

function flame(lit: boolean): string {
  const h = FLAME.length;
  const w = FLAME[0].length;
  const at = (x: number, y: number): boolean => y >= 0 && y < h && x >= 0 && x < w && FLAME[y][x] === '#';
  // profondeur de chaque pixel dans la flamme (0 = bord)
  const depth = (x: number, y: number): number => {
    let d = 0;
    while (d < 4 && at(x - d - 1, y) && at(x + d + 1, y) && at(x, y + d + 1) && at(x, y - d - 1)) d++;
    return d;
  };
  const [c, ctx] = makeCanvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      const d = depth(x, y);
      if (lit) ctx.fillStyle = d === 0 ? '#d9480f' : d === 1 ? '#ff8a1c' : d === 2 ? '#ffd23e' : '#fff5b8';
      else ctx.fillStyle = d === 0 ? '#6c6c6c' : '#7d7d7d';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c.toDataURL();
}

// ------------------------------------------------------------------------------------ fenêtres, cases

const PANEL = [
  '..########..',
  '.#WWWWWWWW#.',
  '#WWWWWWWWCD#',
  '#WWCCCCCCDD#',
  '#WWCCCCCCDD#',
  '#WWCCCCCCDD#',
  '#WWCCCCCCDD#',
  '#WWCCCCCCDD#',
  '#WWCCCCCCDD#',
  '#WCDDDDDDDD#',
  '.#DDDDDDDD#.',
  '..########..',
];

const PANEL_PAL: Palette = { '#': '#000000', W: '#ffffff', C: '#c6c6c6', D: '#555555' };

function slot(): string {
  const [c, ctx] = makeCanvas(18, 18);
  ctx.fillStyle = '#8b8b8b';
  ctx.fillRect(0, 0, 18, 18);
  ctx.fillStyle = '#373737';
  ctx.fillRect(0, 0, 17, 1);
  ctx.fillRect(0, 0, 1, 17);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1, 17, 17, 1);
  ctx.fillRect(17, 1, 1, 17);
  return c.toDataURL();
}

/** Tuile de bruit pour les boutons (grain de pierre). */
function noise(r: number, g: number, b: number, amp: number, seed: number): string {
  const size = 16;
  const [c, ctx] = makeCanvas(size, size);
  const rand = rng(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = (rand() - 0.5) * 2 * amp + (rand() < 0.08 ? -amp : 0);
      const q = (v: number): number => Math.max(0, Math.min(255, Math.round(v + k)));
      ctx.fillStyle = `rgb(${q(r)}, ${q(g)}, ${q(b)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c.toDataURL();
}

/**
 * Onglet de l'inventaire créatif (28×32). `top` : au-dessus de la fenêtre, sinon en dessous.
 * `selected` : dessiné devant la fenêtre, avec raccord sur son bord ; `edge` : onglet aligné
 * sur le bord gauche (−1) ou droit (+1) de la fenêtre.
 */
function tab(top: boolean, selected: boolean, edge: number): string {
  const W = 28;
  const H = 32;
  const C = selected ? '#c6c6c6' : '#a9a9a9';
  const Wh = selected ? '#ffffff' : '#dedede';
  const D = selected ? '#555555' : '#4a4a4a';
  const K = '#000000';
  const px: string[][] = [];
  for (let y = 0; y < H; y++) {
    px.push(new Array<string>(W).fill(C));
  }
  // On dessine l'onglet du haut ; celui du bas est retourné ensuite (avec ses propres ombres).
  for (let y = 0; y < H; y++) {
    px[y][0] = K;
    px[y][W - 1] = K;
    px[y][1] = Wh;
    px[y][2] = Wh;
    px[y][W - 3] = D;
    px[y][W - 2] = D;
  }
  if (top) {
    for (let x = 0; x < W; x++) {
      px[0][x] = K;
      px[1][x] = Wh;
      px[2][x] = x >= W - 3 ? px[2][x] : Wh;
    }
    const tl = ['..##', '.#WW', '#WWW', '#WWC'];
    const tr = ['##..', 'WW#.', 'WCD#', 'CDD#'];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        px[y][x] = pick(tl[y][x]);
        px[y][W - 4 + x] = pick(tr[y][x]);
      }
    }
    if (selected) {
      // raccord sur le bord supérieur de la fenêtre (lignes 28..31 = lignes 0..3 de la fenêtre)
      for (let x = 3; x < W - 3; x++) for (let y = 28; y < H; y++) px[y][x] = C;
      if (edge >= 0) {
        px[29][0] = Wh;
        px[30][0] = Wh;
        for (let x = 0; x < 3; x++) px[31][x] = C;
      }
      if (edge <= 0) {
        px[29][W - 1] = Wh;
        px[30][W - 1] = Wh;
        // coin rentrant : l'ombre de l'onglet s'arrête sur le reflet du bord de la fenêtre
        px[29][W - 3] = C;
        px[29][W - 2] = Wh;
        px[30][W - 3] = C;
        px[30][W - 2] = C;
        for (let x = W - 3; x < W; x++) px[31][x] = C;
      }
    }
  } else {
    for (let x = 0; x < W; x++) {
      px[H - 1][x] = K;
      px[H - 2][x] = D;
      px[H - 3][x] = x < 3 ? px[H - 3][x] : D;
    }
    const bl = ['#WWC', '#WCD', '.#DD', '..##'];
    const br = ['CDD#', 'DDD#', 'DD#.', '##..'];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        px[H - 4 + y][x] = pick(bl[y][x]);
        px[H - 4 + y][W - 4 + x] = pick(br[y][x]);
      }
    }
    if (selected) {
      // raccord sur le bord inférieur de la fenêtre (lignes 0..3 = quatre dernières lignes de la fenêtre)
      for (let x = 3; x < W - 3; x++) for (let y = 0; y < 4; y++) px[y][x] = C;
      if (edge >= 0) {
        px[0][0] = C;
        px[1][0] = D;
        px[2][0] = D;
      }
      if (edge <= 0) {
        px[0][W - 1] = C;
        px[0][W - 2] = C;
        px[0][W - 3] = C;
        px[1][W - 1] = D;
        px[2][W - 1] = D;
      }
      if (edge >= 0) for (let x = 1; x < 3; x++) px[0][x] = C;
    }
  }
  function pick(ch: string): string {
    return ch === '#' ? K : ch === 'W' ? Wh : ch === 'D' ? D : ch === 'C' ? C : '';
  }
  const [c, ctx] = makeCanvas(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!px[y][x]) continue;
      ctx.fillStyle = px[y][x];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c.toDataURL();
}

const MAGNIFIER = [
  '................',
  '....#####.......',
  '...#bbbbb#......',
  '..#bwwbbbb#.....',
  '.#bwbbbbbbb#....',
  '.#bwbbbbbbb#....',
  '.#bbbbbbbbb#....',
  '.#bbbbbbbbb#....',
  '.#bbbbbbbbb#....',
  '..#bbbbbbb#.....',
  '...#bbbbb###....',
  '....#####.#h#...',
  '...........#h#..',
  '............#h#.',
  '.............##.',
  '................',
];

const TRASH = [
  '................',
  '......####......',
  '..############..',
  '..#gggggggggg#..',
  '..############..',
  '...#gggggggg#...',
  '...#g#gg#gg#g...',
  '...#g#gg#gg#g...',
  '...#g#gg#gg#g...',
  '...#g#gg#gg#g...',
  '...#g#gg#gg#g...',
  '...#g#gg#gg#g...',
  '...#gggggggg#...',
  '....########....',
  '................',
  '................',
];

// ------------------------------------------------------------------------------------ logo

const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
};

export const LOGO_TEXT = 'AETHERBRICKS';
const LOGO_CELL = 4;
/** Taille du logo en pixels d'image (1 pixel d'image = 1 pixel d'interface). */
export const LOGO_WIDTH = (LOGO_TEXT.length * 6 - 1) * LOGO_CELL + 2;
export const LOGO_HEIGHT = 7 * LOGO_CELL + 3;

/** Logo en lettres de blocs : chaque point de la police est un petit bloc de pierre biseauté. */
function logo(): string {
  const [c, ctx] = makeCanvas(LOGO_WIDTH, LOGO_HEIGHT);
  const rand = rng(0xae7e3);
  const cell = LOGO_CELL;
  const filled = (col: number, row: number): boolean => {
    if (row < 0 || row >= 7 || col < 0) return false;
    const letter = FONT[LOGO_TEXT[Math.floor(col / 6)]];
    const cx = col % 6;
    return !!letter && cx < 5 && letter[row][cx] === '#';
  };
  const cols = LOGO_TEXT.length * 6 - 1;
  // ombre portée noire, puis contour sombre
  ctx.fillStyle = '#000000';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < cols; col++) {
      if (filled(col, row)) ctx.fillRect(col * cell, row * cell, cell + 2, cell + 3);
    }
  }
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < cols; col++) {
      if (!filled(col, row)) continue;
      const x0 = col * cell + 1;
      const y0 = row * cell + 1;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const top = y === 0 && !filled(col, row - 1);
          const left = x === 0 && !filled(col - 1, row);
          const bottom = y === cell - 1 && !filled(col, row + 1);
          const right = x === cell - 1 && !filled(col + 1, row);
          let v = 138 + Math.round((rand() - 0.5) * 26);
          if (rand() < 0.06) v -= 30;
          if (top || left) v = 196 + Math.round(rand() * 14);
          if (bottom || right) v = 84 + Math.round(rand() * 10);
          ctx.fillStyle = `rgb(${v}, ${v}, ${v})`;
          ctx.fillRect(x0 + x - 1, y0 + y - 1, 1, 1);
        }
      }
    }
  }
  return c.toDataURL();
}

// ------------------------------------------------------------------------------------ joueur

/**
 * Silhouette du joueur vue de face (16×32), composée à partir de la peau du modèle « player ».
 * Chaîne vide si le modèle n'a pas la forme attendue.
 */
function playerFront(): string {
  try {
    const model = getMobModel('player');
    const [c, ctx] = makeCanvas(16, 32);
    const tex = model.texture;
    const blit = (part: string, dx: number, dy: number, mirror: boolean): boolean => {
      const b = model.boxes.find((o) => o.part === part);
      if (!b) return false;
      const [w, h, d] = b.size;
      const sx = b.uv[0] + d;
      const sy = b.uv[1] + d;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const tx = sx + (mirror ? w - 1 - x : x);
          const o = ((sy + y) * model.texW + tx) * 4;
          if (tex[o + 3] === 0) continue;
          ctx.fillStyle = `rgb(${tex[o]}, ${tex[o + 1]}, ${tex[o + 2]})`;
          ctx.fillRect(dx + x, dy + y, 1, 1);
        }
      }
      return true;
    };
    const ok =
      blit('head', 4, 0, false) &&
      blit('body', 4, 8, false) &&
      blit('armR', 0, 8, false) &&
      blit('armL', 12, 8, true) &&
      blit('legR', 4, 20, false) &&
      blit('legL', 8, 20, true);
    return ok ? c.toDataURL() : '';
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------------------------ publication

let cache: Record<string, string> | null = null;

function build(): Record<string, string> {
  const s: Record<string, string> = {};
  const heartPal: Palette = { '#': '#000000', r: '#ff1313', w: '#ffc8c8', d: '#bb0b0b' };
  const heartBlink: Palette = { ...heartPal, '#': '#ffffff' };
  const foodPal: Palette = { '#': '#000000', m: '#b3703a', h: '#dba066', d: '#8a4d24', b: '#ece4cf' };
  const armorPal: Palette = { '#': '#1e1e1e', a: '#c9c9c9', w: '#ffffff', d: '#9a9a9a' };
  for (let st = 0; st < 3; st++) {
    s[`heart-${st}`] = tri(HEART, heartPal, '#3a3a3a', st);
    s[`heart-b${st}`] = tri(HEART, heartBlink, '#5a5a5a', st);
    s[`food-${st}`] = tri(FOOD, foodPal, '#3a3a3a', st, true);
    s[`armor-${st}`] = tri(ARMOR, armorPal, '#454545', st);
  }
  s['bubble'] = art(BUBBLE, { '#': '#16308f', b: 'rgba(84, 134, 255, 0.72)', w: '#e8f0ff' });
  s['bubble-pop'] = art(BUBBLE_POP, { '#': '#3c63d8' });
  s['xp-bg'] = xpBar(false);
  s['xp-fill'] = xpBar(true);
  s['hotbar'] = hotbar();
  s['hotbar-sel'] = hotbarSelection();
  s['crosshair'] = crosshair();
  s['arrow'] = arrow(22, 15, '#8b8b8b');
  s['arrow-small'] = arrow(16, 13, '#8b8b8b');
  s['arrow-big'] = arrow(24, 17, '#8b8b8b');
  s['arrow-big-on'] = arrow(24, 17, '#ffffff');
  s['flame'] = flame(false);
  s['flame-on'] = flame(true);
  s['panel'] = art(PANEL, PANEL_PAL);
  s['slot'] = slot();
  s['btn'] = noise(111, 111, 111, 9, 11);
  s['btn-hover'] = noise(122, 133, 190, 9, 12);
  s['btn-off'] = noise(44, 44, 44, 5, 13);
  for (const top of [true, false]) {
    const k = top ? 'top' : 'bot';
    s[`tab-${k}`] = tab(top, false, 0);
    s[`tab-${k}-sel`] = tab(top, true, 0);
    s[`tab-${k}-sel-l`] = tab(top, true, -1);
    s[`tab-${k}-sel-r`] = tab(top, true, 1);
  }
  s['magnifier'] = art(MAGNIFIER, { '#': '#2b2b2b', b: 'rgba(170, 215, 255, 0.85)', w: '#ffffff', h: '#8a5a2b' });
  s['trash'] = art(TRASH, { '#': '#3a3a3a', g: '#9c9c9c' });
  s['logo'] = logo();
  s['player'] = playerFront();
  return s;
}

/** Data URL d'une image de l'interface (chaîne vide si inconnue). */
export function sprite(name: string): string {
  if (!cache) cache = build();
  return cache[name] ?? '';
}

/** Publie toutes les images dans des variables CSS `--spr-<nom>` de l'élément racine. */
export function installSprites(root: HTMLElement): void {
  if (!cache) cache = build();
  for (const name of Object.keys(cache)) {
    const url = cache[name];
    root.style.setProperty(`--spr-${name}`, url ? `url("${url}")` : 'none');
  }
}
