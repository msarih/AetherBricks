/**
 * Textures procédurales des blocs (pixel art 16×16 dans l'esprit de Minecraft).
 * Chaque fonction peint une tuile ; aucune image externe n'est utilisée.
 */
import { COLOR_HEX, COLOR_NAMES } from '../../world/Ids';
import type { TileName } from '../../world/Tiles';
import { Px, TS, mix, shade, type Color, type Painter } from './PixelCanvas';

export const BLOCK_PAINTERS: Partial<Record<TileName, Painter>> = {};
const def = (name: TileName, painter: Painter) => {
  BLOCK_PAINTERS[name] = painter;
};

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------
const STONE = [0x686868, 0x737373, 0x7d7d7d, 0x7f7f7f, 0x888888, 0x8f8f8f];
const DIRT = [0x593d29, 0x6c4a33, 0x79553a, 0x866043, 0x8d6748, 0x966c4a, 0xa77a55];
const SAND = [0xcdc28b, 0xd5ca94, 0xdbd3a0, 0xdfd6a6, 0xe5ddb1];
const GRASS_GRAY = [0x7c7c7c, 0x8a8a8a, 0x979797, 0xa4a4a4, 0xb2b2b2];
const SNOW = [0xe4eded, 0xeef5f5, 0xf8fcfc, 0xffffff];

interface WoodPalette {
  planks: Color;
  bark: Color;
  barkDark: Color;
  barkLight: Color;
  heart: Color;
}
const WOODS: Record<string, WoodPalette> = {
  oak: { planks: 0xb8945f, bark: 0x6b5332, barkDark: 0x4f3d24, barkLight: 0x7d623c, heart: 0xb8945f },
  spruce: { planks: 0x7a5a34, bark: 0x3b2912, barkDark: 0x2a1c0b, barkLight: 0x4d371c, heart: 0x826039 },
  birch: { planks: 0xd7c185, bark: 0xd8d7d0, barkDark: 0x2c2a26, barkLight: 0xf1f0ea, heart: 0xc8b77a },
  jungle: { planks: 0xb1805c, bark: 0x58461c, barkDark: 0x3e3212, barkLight: 0x6c5a26, heart: 0xa67a52 },
  acacia: { planks: 0xba6337, bark: 0x6b655c, barkDark: 0x514c45, barkLight: 0x7f786e, heart: 0xb05d38 },
};

// ---------------------------------------------------------------------------
// Aides génériques
// ---------------------------------------------------------------------------
function stoneBase(p: Px): void {
  p.rough(STONE, 3, 6, 0.3);
}

function dirtBase(p: Px): void {
  p.rough(DIRT, 5, 5, 0.75);
}

/** Minerai : fond de pierre + amas colorés. */
function ore(dark: Color, mid: Color, light: Color): Painter {
  return (p) => {
    stoneBase(p);
    const spots: Array<[number, number]> = [
      [2, 2], [9, 1], [5, 6], [12, 6], [1, 10], [8, 11], [12, 13], [4, 13],
    ];
    for (const [sx, sy] of spots) {
      const x = sx + p.int(2);
      const y = sy + p.int(2);
      const shape = p.int(4);
      p.set(x, y, mid);
      p.set(x + 1, y, light);
      p.set(x, y + 1, dark);
      p.set(x + 1, y + 1, mid);
      if (shape === 0) p.set(x + 2, y, mid);
      if (shape === 1) p.set(x - 1, y + 1, mid);
      if (shape === 2) {
        p.set(x + 2, y + 1, dark);
        p.set(x + 1, y - 1, light);
      }
      // ombre portée sous l'amas
      p.mul(x, y + 2, 0.8);
      p.mul(x + 1, y + 2, 0.8);
      p.mul(x + 2, y + 1, 0.85);
    }
  };
}

/** Bloc de métal / gemme : surface lisse biseautée. */
function mineralBlock(base: Color, lightF = 1.22, darkF = 0.72, stripes = true): Painter {
  return (p) => {
    const f = p.field(3, 5);
    p.each((x, y) => {
      let c = shade(base, 0.94 + f(x, y) * 0.12);
      if (stripes && (y === 4 || y === 9 || y === 12)) c = shade(c, 0.93);
      return c;
    });
    for (let i = 0; i < TS; i++) {
      p.set(i, 0, shade(base, lightF));
      p.set(0, i, shade(base, lightF));
      p.set(i, 15, shade(base, darkF));
      p.set(15, i, shade(base, darkF));
    }
    for (let i = 1; i < 15; i++) {
      p.set(i, 1, shade(base, lightF * 0.94));
      p.set(1, i, shade(base, lightF * 0.94));
      p.set(i, 14, shade(base, darkF * 1.12));
      p.set(14, i, shade(base, darkF * 1.12));
    }
    p.set(0, 15, shade(base, 0.95));
    p.set(15, 0, shade(base, 0.95));
  };
}

function planks(base: Color): Painter {
  return (p) => {
    const streak = p.field(2, 16);
    const fine = p.field(8, 16);
    for (let y = 0; y < TS; y++) {
      const board = y >> 2;
      const row = y & 3;
      for (let x = 0; x < TS; x++) {
        let c: Color;
        if (row === 3) {
          c = shade(base, 0.66 + streak(x, y) * 0.08);
        } else {
          const v = 0.88 + streak(x + board * 5, y) * 0.2 + fine(x, y) * 0.06;
          c = shade(base, v);
          if (row === 0) c = shade(c, 1.05);
        }
        p.set(x, y, c);
      }
    }
    // joints verticaux entre deux planches, décalés d'une rangée à l'autre
    const joints = [3, 11, 6, 14];
    for (let board = 0; board < 4; board++) {
      const jx = (joints[board] + p.int(2)) % TS;
      for (let row = 0; row < 3; row++) p.set(jx, board * 4 + row, shade(base, 0.68));
    }
    // quelques nœuds / veines
    for (let i = 0; i < 5; i++) {
      const x = p.int(TS);
      const y = p.int(4) * 4 + p.int(3);
      p.mul(x, y, 0.9);
      p.mul((x + 1) % TS, y, 0.93);
    }
  };
}

function logSide(w: WoodPalette, birch = false): Painter {
  return (p) => {
    if (birch) {
      const f = p.field(4, 8);
      p.each((x, y) => shade(w.bark, 0.92 + f(x, y) * 0.12));
      // taches horizontales noires de l'écorce de bouleau
      for (let i = 0; i < 9; i++) {
        const y = p.int(TS);
        const x = p.int(TS);
        const len = 2 + p.int(4);
        for (let k = 0; k < len; k++) p.setWrap(x + k, y, k === 0 || k === len - 1 ? 0x55524b : w.barkDark);
        if (p.rnd() < 0.5) p.setWrap(x + 1, y + 1, 0x6b6861);
      }
      for (let i = 0; i < 10; i++) p.set(p.int(TS), p.int(TS), w.barkLight);
      return;
    }
    const colShade = new Float32Array(TS);
    for (let x = 0; x < TS; x++) colShade[x] = p.rnd();
    const f = p.field(8, 3);
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const v = colShade[x] * 0.6 + f(x, y) * 0.4;
        let c = v < 0.3 ? w.barkDark : v < 0.72 ? w.bark : w.barkLight;
        c = shade(c, 0.94 + p.rnd() * 0.12);
        p.set(x, y, c);
      }
    }
    // crevasses verticales interrompues
    for (let i = 0; i < 6; i++) {
      const x = p.int(TS);
      let y = p.int(TS);
      const len = 3 + p.int(7);
      for (let k = 0; k < len; k++) {
        p.setWrap(x, y, shade(w.barkDark, 0.85));
        y++;
      }
    }
  };
}

function logTop(w: WoodPalette): Painter {
  return (p) => {
    const light = shade(w.heart, 1.08);
    const mid = shade(w.heart, 0.9);
    const dark = shade(w.heart, 0.74);
    p.each((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 7) return shade(w.bark, 0.9 + p.rnd() * 0.2);
      const ring = Math.floor(d);
      let c = ring % 2 === 0 ? light : mid;
      if (ring === 6) c = dark;
      if (ring === 0) c = dark;
      return shade(c, 0.96 + p.rnd() * 0.08);
    });
  };
}

function leaves(palette: readonly Color[], holes: number, gx = 7, gy = 7): Painter {
  return (p) => {
    const f = p.field(gx, gy);
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const v = f(x, y) * 0.55 + p.rnd() * 0.45;
        if (v < holes) {
          p.clear(x, y);
        } else {
          const t = (v - holes) / (1 - holes);
          const idx = Math.min(palette.length - 1, Math.floor(t * palette.length));
          p.set(x, y, palette[idx]);
        }
      }
    }
  };
}

/** Motif de briques : hauteur de rangée, largeur de brique, décalage alterné. */
function brickPattern(
  p: Px,
  rowH: number,
  brickW: number,
  colors: readonly Color[],
  mortar: Color,
  bevel: boolean
): void {
  const rows = TS / rowH;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : brickW / 2;
    const bricksInRow = TS / brickW;
    const rowColors: Color[] = [];
    for (let b = 0; b <= bricksInRow; b++) rowColors.push(p.pick(colors));
    for (let dy = 0; dy < rowH; dy++) {
      const y = r * rowH + dy;
      for (let x = 0; x < TS; x++) {
        const bx = (x + offset) % brickW;
        const bi = Math.floor(((x + offset) % TS) / brickW);
        if (dy === rowH - 1 || bx === brickW - 1) {
          p.set(x, y, shade(mortar, 0.94 + p.rnd() * 0.12));
          continue;
        }
        let c = shade(rowColors[bi], 0.94 + p.rnd() * 0.12);
        if (bevel) {
          if (dy === 0 || bx === 0) c = shade(c, 1.12);
          if (dy === rowH - 2 || bx === brickW - 2) c = shade(c, 0.86);
        } else if (dy === 0) {
          c = shade(c, 1.08);
        }
        p.set(x, y, c);
      }
    }
  }
}

/** Petite fleur : tige + feuilles + tête dessinée en ASCII. */
function flower(rows: readonly string[], palette: Record<string, Color>): Painter {
  return (p) => {
    p.ascii(rows, { g: 0x3d7a22, G: 0x2a5a16, l: 0x5aa334, ...palette });
  };
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
def('stone', stoneBase);

def('granite', (p) => {
  p.rough([0x7d5346, 0x8c5e4f, 0x9a6857, 0xa5725f, 0xb07a66], 5, 5, 0.6);
  p.speckle(0xc9a092, 0.05);
  p.speckle(0x6b463b, 0.05);
});

def('diorite', (p) => {
  p.rough([0xa9a9aa, 0xbcbcbd, 0xcdcdce, 0xdadadb, 0xe6e6e7], 5, 5, 0.7);
  p.speckle(0x8d8d8f, 0.07);
  p.speckle(0x77777a, 0.025);
});

def('andesite', (p) => {
  p.rough([0x767676, 0x808080, 0x888888, 0x8d8d8d, 0x969696], 4, 4, 0.55);
  p.speckle(0xa6a6a6, 0.04);
  p.speckle(0x666666, 0.04);
});

function cobble(p: Px): void {
  // Diagramme de Voronoï torique : chaque cellule est un galet
  const n = 11;
  const sx: number[] = [];
  const sy: number[] = [];
  const tone: number[] = [];
  for (let i = 0; i < n; i++) {
    sx.push(p.rnd() * TS);
    sy.push(p.rnd() * TS);
    tone.push(0.82 + p.rnd() * 0.34);
  }
  const base = 0x848484;
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      for (let i = 0; i < n; i++) {
        let dx = Math.abs(x + 0.5 - sx[i]);
        let dy = Math.abs(y + 0.5 - sy[i]);
        if (dx > 8) dx = TS - dx;
        if (dy > 8) dy = TS - dy;
        const d = Math.sqrt(dx * dx + dy * dy * 1.25);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = i;
        } else if (d < d2) {
          d2 = d;
        }
      }
      if (d2 - d1 < 0.95) {
        p.set(x, y, shade(0x4f4f4f, 0.9 + p.rnd() * 0.25));
      } else {
        let ddx = x + 0.5 - sx[best];
        let ddy = y + 0.5 - sy[best];
        if (ddx > 8) ddx -= TS;
        if (ddx < -8) ddx += TS;
        if (ddy > 8) ddy -= TS;
        if (ddy < -8) ddy += TS;
        const lightDir = -(ddx + ddy * 1.4) * 0.035;
        p.set(x, y, shade(base, tone[best] + lightDir + (p.rnd() - 0.5) * 0.08));
      }
    }
  }
}
def('cobblestone', cobble);

function moss(p: Px, density: number): void {
  const f = p.field(4, 4);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      if (f(x, y) * 0.7 + p.rnd() * 0.3 > 1 - density) {
        p.set(x, y, p.pick([0x4f6b2c, 0x5d7d33, 0x6b8f3b, 0x455e27]));
      }
    }
  }
}

def('mossy_cobblestone', (p) => {
  cobble(p);
  moss(p, 0.42);
});

def('bedrock', (p) => {
  p.rough([0x151515, 0x2c2c2c, 0x444444, 0x565656, 0x6e6e6e, 0x8e8e8e], 5, 5, 0.5);
});

def('dirt', dirtBase);

def('grass_top', (p) => {
  p.rough(GRASS_GRAY, 6, 6, 0.8);
});

def('grass_side', dirtBase);

def('grass_side_overlay', (p) => {
  for (let x = 0; x < TS; x++) {
    const depth = 2 + p.int(3) + (p.rnd() < 0.2 ? 1 : 0);
    for (let y = 0; y < depth; y++) {
      const c = p.pick(GRASS_GRAY);
      p.set(x, y, y === depth - 1 ? shade(c, 0.85) : c);
    }
  }
});

def('grass_side_snowed', (p) => {
  dirtBase(p);
  for (let x = 0; x < TS; x++) {
    const depth = 3 + p.int(2);
    for (let y = 0; y < depth; y++) p.set(x, y, y === depth - 1 ? 0xd4e0e0 : p.pick(SNOW));
  }
});

def('snow', (p) => {
  p.rough(SNOW, 4, 4, 0.5);
});

def('ice', (p) => {
  const f = p.field(4, 4);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const c = mix(0x7dadff, 0xa9c8ff, f(x, y));
      p.set(x, y, c, 205);
    }
  }
  // reflets diagonaux
  for (let i = 0; i < 5; i++) {
    const x = p.int(TS);
    const y = p.int(TS);
    const len = 2 + p.int(4);
    for (let k = 0; k < len; k++) p.setWrap(x + k, y + k, 0xd6e6ff, 225);
  }
});

def('red_sand', (p) => {
  p.rough([0xa9551f, 0xb45d23, 0xbe6626, 0xc66d2b, 0xcf7732], 6, 6, 0.8);
  p.speckle(0x9a4a1a, 0.03);
});

/** Terre cuite : aplat mat, à peine marbré (teintes de Minecraft 1.12). */
const TERRACOTTA_HEX = [
  0xd1b1a1, 0xa05325, 0x95576c, 0x706c8a, 0xba8524, 0x677534, 0xa04d4e, 0x392a23,
  0x876a61, 0x565b5b, 0x764556, 0x4a3b5b, 0x4d3223, 0x4c532a, 0x8e3c2e, 0x251610,
];
function terracotta(base: Color): Painter {
  return (p) => {
    const f = p.field(4, 4);
    const g = p.field(9, 9);
    p.each((x, y) => shade(base, 0.95 + f(x, y) * 0.07 + g(x, y) * 0.04));
  };
}
def('terracotta', terracotta(0x985e43));
COLOR_NAMES.forEach((name, i) => def(`terracotta_${name}`, terracotta(TERRACOTTA_HEX[i])));

def('sand', (p) => {
  p.rough(SAND, 6, 6, 0.8);
  p.speckle(0xc4b77d, 0.03);
});

def('gravel', (p) => {
  p.rough([0x5d5958, 0x6f6a69, 0x827c7b, 0x8f8988, 0x9c9695, 0xaaa3a1], 6, 6, 0.6);
  p.speckle(0x7a6a62, 0.05);
  p.speckle(0x4c4847, 0.04);
});

def('clay', (p) => {
  p.rough([0x9199a8, 0x9aa3b2, 0xa0a8b8, 0xa6aebd, 0xacb4c2], 4, 4, 0.45);
});

def('sandstone_top', (p) => {
  p.rough([0xd9cf9c, 0xdfd6a6, 0xe3dbac], 4, 4, 0.5);
  p.frame(0, 0, 16, 16, 0xd0c58f);
});

def('sandstone_side', (p) => {
  const f = p.field(3, 8);
  p.each((x, y) => {
    let c = mix(0xd6cb96, 0xe2d9aa, f(x, y));
    if (y === 0) c = 0xe9e1b6;
    if (y === 3 || y === 15) c = 0xc2b57e;
    if (y === 8 || y === 12) c = shade(c, 0.93);
    return shade(c, 0.97 + p.rnd() * 0.06);
  });
});

def('sandstone_bottom', (p) => {
  p.rough([0xcfc48c, 0xd6cb96, 0xdcd2a0], 5, 5, 0.6);
});

def('obsidian', (p) => {
  p.rough([0x06030b, 0x0f0a18, 0x171026, 0x1f1733, 0x2c2042, 0x3b2d54], 5, 5, 0.5);
});

def('glowstone', (p) => {
  p.rough([0x70522a, 0x9a7435, 0xc79e49, 0xe9c868, 0xf9e79e, 0xfff6cf], 5, 5, 0.45);
});

def('netherrack', (p) => {
  p.rough([0x501b1b, 0x622525, 0x723232, 0x854242, 0x935050], 6, 6, 0.6);
});

def('sponge', (p) => {
  p.rough([0xb5b33a, 0xc4c247, 0xcfcd52, 0xdbd962], 5, 5, 0.5);
  for (let i = 0; i < 14; i++) {
    const x = p.int(TS);
    const y = p.int(TS);
    p.set(x, y, 0x8e8b2a);
    if (p.rnd() < 0.5) p.setWrap(x + 1, y, 0x9c9930);
  }
});

// ---------------------------------------------------------------------------
// Minerais et blocs de minerai
// ---------------------------------------------------------------------------
def('coal_ore', ore(0x1c1c1c, 0x2e2e2e, 0x474747));
def('iron_ore', ore(0xa8826a, 0xd8af93, 0xe9cdb6));
def('gold_ore', ore(0xd49b1c, 0xf8d23c, 0xfff7a0));
def('diamond_ore', ore(0x2ab8c2, 0x5decf5, 0xd9fdff));
def('redstone_ore', ore(0x8f0000, 0xe01414, 0xff5a5a));
def('lapis_ore', ore(0x102f8a, 0x1f4fc4, 0x5b86e8));
def('emerald_ore', ore(0x0a7a34, 0x17d45f, 0x8af5b4));

def('coal_block', (p) => {
  p.rough([0x0c0c0c, 0x141414, 0x1c1c1c, 0x262626, 0x303030], 5, 5, 0.5);
  p.frame(0, 0, 16, 16, 0x111111);
});
def('iron_block', mineralBlock(0xd8d8d8, 1.1, 0.78));
def('gold_block', mineralBlock(0xf6d33c, 1.15, 0.74));
def('diamond_block', mineralBlock(0x62e3dd, 1.2, 0.72));
def('emerald_block', mineralBlock(0x2cc75a, 1.25, 0.68));
def('redstone_block', mineralBlock(0xb01805, 1.3, 0.68, false));
def('lapis_block', (p) => {
  p.rough([0x173a9c, 0x1d47b3, 0x2251c4, 0x2a5dd6], 4, 4, 0.5);
  p.frame(0, 0, 16, 16, 0x143285);
});

// ---------------------------------------------------------------------------
// Bois
// ---------------------------------------------------------------------------
for (const name of ['oak', 'spruce', 'birch', 'jungle', 'acacia'] as const) {
  const w = WOODS[name];
  def(`${name}_log`, logSide(w, name === 'birch'));
  def(`${name}_log_top`, logTop(w));
  def(`${name}_planks`, planks(w.planks));
}

// Les feuillages sont en niveaux de gris : la teinte vient du biome (comme l'herbe)
def('oak_leaves', leaves([0x5e5e5e, 0x7a7a7a, 0x969696, 0xb4b4b4, 0xcfcfcf], 0.3));
def('birch_leaves', leaves([0x646464, 0x828282, 0xa0a0a0, 0xbcbcbc, 0xd4d4d4], 0.28, 8, 8));
def('jungle_leaves', leaves([0x585858, 0x767676, 0x959595, 0xb6b6b6, 0xd8d8d8], 0.22, 6, 6));
def('acacia_leaves', leaves([0x606060, 0x7c7c7c, 0x9a9a9a, 0xb5b5b5, 0xcccccc], 0.34, 8, 8));
def('spruce_leaves', (p) => {
  const f = p.field(8, 4);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const v = f(x, y) * 0.5 + p.rnd() * 0.5;
      if (v < 0.27) p.clear(x, y);
      else p.set(x, y, v < 0.45 ? 0x5c5c5c : v < 0.62 ? 0x7c7c7c : v < 0.8 ? 0x9c9c9c : 0xbcbcbc);
    }
  }
});

function sapling(leaf: Color, leafDark: Color, leafLight: Color, conifer: boolean): Painter {
  return (p) => {
    const trunk = 0x6b5332;
    const trunkDark = 0x4f3d24;
    for (let y = 9; y < 16; y++) {
      p.set(7, y, trunk);
      p.set(8, y, trunkDark);
    }
    if (conifer) {
      const widths = [1, 2, 3, 2, 4, 3, 5, 4, 6];
      for (let i = 0; i < widths.length; i++) {
        const y = 2 + i;
        const w = widths[i];
        for (let x = 8 - w; x < 8 + w; x++) {
          if (p.rnd() < 0.08) continue;
          p.set(x, y, p.pick([leaf, leaf, leafDark, leafLight]));
        }
      }
    } else {
      for (let y = 1; y < 11; y++) {
        for (let x = 2; x < 14; x++) {
          const dx = x - 7.5;
          const dy = (y - 5.5) * 1.15;
          if (dx * dx + dy * dy < 22 + p.rnd() * 8 && p.rnd() > 0.14) {
            p.set(x, y, p.pick([leaf, leaf, leafDark, leafLight]));
          }
        }
      }
    }
    p.set(7, 10, trunk);
    p.set(8, 10, trunkDark);
  };
}
def('oak_sapling', sapling(0x4d8f2a, 0x356b1c, 0x6bb23c, false));
def('birch_sapling', sapling(0x6f9f4a, 0x4f7a33, 0x8cbb62, false));
def('jungle_sapling', sapling(0x3f9c1e, 0x2a6e12, 0x5fc232, false));
def('acacia_sapling', sapling(0x7a9a2a, 0x5a771d, 0x9ab83d, false));
def('spruce_sapling', sapling(0x3f6b44, 0x2b4b30, 0x52825a, true));

// ---------------------------------------------------------------------------
// Blocs de construction
// ---------------------------------------------------------------------------
def('glass', (p) => {
  p.frame(0, 0, 16, 16, 0xd3eef4);
  for (let i = 1; i < 15; i++) {
    if (p.rnd() < 0.5) p.set(i, 0, 0xffffff);
    if (p.rnd() < 0.5) p.set(0, i, 0xffffff);
    if (p.rnd() < 0.35) p.set(i, 15, 0xa9d3de);
    if (p.rnd() < 0.35) p.set(15, i, 0xa9d3de);
  }
  // reflets en diagonale
  p.set(3, 4, 0xe9fbff);
  p.set(4, 3, 0xe9fbff);
  p.set(5, 2, 0xe9fbff);
  p.set(3, 6, 0xd3eef4);
  p.set(4, 5, 0xd3eef4);
  p.set(11, 12, 0xe9fbff);
  p.set(12, 11, 0xe9fbff);
  p.set(10, 13, 0xd3eef4);
});

def('bricks', (p) => {
  brickPattern(p, 4, 8, [0x96533f, 0xa25c46, 0x8a4a37, 0x9c5843], 0xb7ada2, false);
});

function stoneBricks(p: Px): void {
  brickPattern(p, 8, 16, [0x777777, 0x7d7d7d, 0x838383], 0x5b5b5b, true);
}
def('stone_bricks', stoneBricks);
def('mossy_stone_bricks', (p) => {
  stoneBricks(p);
  moss(p, 0.36);
});
def('cracked_stone_bricks', (p) => {
  stoneBricks(p);
  for (let i = 0; i < 4; i++) {
    let x = 2 + p.int(12);
    let y = (i % 2) * 8 + 1;
    for (let k = 0; k < 6; k++) {
      p.set(x, y, 0x4a4a4a);
      y++;
      x += p.int(3) - 1;
    }
  }
});

def('smooth_stone', (p) => {
  p.rough([0x9a9a9a, 0x9f9f9f, 0xa4a4a4], 3, 3, 0.4);
  p.frame(0, 0, 16, 16, 0x7f7f7f);
});

def('smooth_stone_slab_side', (p) => {
  p.rough([0x9a9a9a, 0x9f9f9f, 0xa4a4a4], 3, 3, 0.4);
  p.frame(0, 0, 16, 8, 0x7f7f7f);
  p.frame(0, 8, 16, 8, 0x7f7f7f);
});

def('bookshelf', (p) => {
  planks(WOODS.oak.planks)(p);
  const bookColors = [0xa02f2a, 0x2f6aa0, 0x3f8f3a, 0x8a5a2a, 0xc9a23a, 0x6a3f8f, 0x8f2f5a];
  for (const top of [2, 9]) {
    p.rect(0, top, 16, 5, 0x2f2416);
    let x = 1;
    while (x < 15) {
      const w = 1 + p.int(2);
      const h = 4 + p.int(2);
      const c = p.pick(bookColors);
      for (let dx = 0; dx < w && x + dx < 15; dx++) {
        for (let dy = 5 - h; dy < 5; dy++) {
          p.set(x + dx, top + dy, dx === 0 ? shade(c, 1.15) : shade(c, 0.9));
        }
        p.set(x + dx, top + (5 - h) + 1, 0xe8dfc0);
      }
      x += w + (p.rnd() < 0.2 ? 1 : 0);
    }
  }
});

def('quartz_block', (p) => {
  const f = p.field(3, 3);
  p.each((x, y) => mix(0xe6dfd6, 0xf2ede6, f(x, y)));
  for (let i = 0; i < TS; i++) {
    p.set(i, 0, 0xf8f5f0);
    p.set(0, i, 0xf8f5f0);
    p.set(i, 15, 0xd9d1c6);
    p.set(15, i, 0xd9d1c6);
  }
});

def('tnt_side', (p) => {
  const redC = 0xd5341c;
  p.each((x, y) => {
    const stick = x % 4;
    let c = stick === 3 ? shade(redC, 0.68) : stick === 0 ? shade(redC, 1.12) : redC;
    if (y === 0 || y === 15) c = shade(c, 0.8);
    return c;
  });
  p.rect(0, 5, 16, 6, 0xe8e8e8);
  for (let x = 0; x < TS; x++) {
    p.set(x, 5, 0xffffff);
    p.set(x, 10, 0xb8b8b8);
  }
  p.ascii(
    ['###.#..#.###', '.#..##.#..#.', '.#..#.##..#.', '.#..#..#..#.'],
    { '#': 0x1a1a1a },
    2,
    6
  );
});

def('tnt_top', (p) => {
  const redC = 0xc02e18;
  p.each((x, y) => {
    const gx = x % 4;
    const gy = y % 4;
    if (gx === 3 || gy === 3) return shade(redC, 0.62);
    if (gx === 0 && gy === 0) return shade(redC, 1.2);
    return redC;
  });
  p.rect(6, 6, 3, 3, 0x9a9a9a);
  p.set(7, 7, 0x2a2a2a);
  p.set(6, 6, 0xcfcfcf);
});

def('tnt_bottom', (p) => {
  const redC = 0xb02a16;
  p.each((x, y) => {
    const gx = x % 4;
    const gy = y % 4;
    if (gx === 3 || gy === 3) return shade(redC, 0.62);
    return redC;
  });
});

COLOR_NAMES.forEach((name, i) => {
  def(`wool_${name}`, (p) => {
    const base = COLOR_HEX[i];
    const f = p.field(5, 5);
    p.each((x, y) => {
      let c = shade(base, 0.9 + f(x, y) * 0.16);
      if ((x + y * 3) % 4 === 0) c = shade(c, 0.94);
      if (p.rnd() < 0.12) c = shade(c, 1.06);
      return c;
    });
  });
});

def('crafting_table_top', (p) => {
  planks(0xb8945f)(p);
  p.frame(0, 0, 16, 16, 0x5b4023);
  p.frame(1, 1, 14, 14, 0x8a6a3d);
  for (let i = 2; i < 14; i++) {
    p.set(i, 5, 0x77582f);
    p.set(i, 10, 0x77582f);
    p.set(5, i, 0x77582f);
    p.set(10, i, 0x77582f);
  }
});

function craftingSide(p: Px): void {
  planks(0xb8945f)(p);
  p.rect(0, 0, 16, 3, 0x6a4d2a);
  for (let x = 0; x < TS; x++) {
    p.set(x, 0, 0x8a6a3d);
    p.set(x, 3, 0x4a3319);
  }
  p.frame(0, 4, 16, 12, 0x6a4d2a);
}

def('crafting_table_side', (p) => {
  craftingSide(p);
  // marteau et scie
  p.ascii(
    ['.mmm....', '.mmm.ss.', '..b..ss.', '..b..ss.', '..b..sk.', '..b...k.'],
    { m: 0x9a9a9a, b: 0x4a3319, s: 0xb8b8b8, k: 0x4a3319 },
    3,
    7
  );
});

def('crafting_table_front', (p) => {
  craftingSide(p);
  // pinces et tiroir
  p.ascii(
    ['.s...s..', '..s.s...', '...s....', '..b.b...', '.b...b..', '.b...b..'],
    { s: 0xb0b0b0, b: 0x4a3319 },
    4,
    7
  );
});

function furnaceBody(p: Px): void {
  p.rough([0x6a6a6a, 0x737373, 0x7b7b7b, 0x838383], 4, 4, 0.5);
  p.frame(0, 0, 16, 16, 0x4c4c4c);
  for (let i = 1; i < 15; i++) {
    p.set(i, 1, 0x929292);
    p.set(1, i, 0x8a8a8a);
  }
}

def('furnace_top', (p) => {
  p.rough([0x626262, 0x6c6c6c, 0x747474], 4, 4, 0.5);
  p.frame(0, 0, 16, 16, 0x494949);
});
def('furnace_side', furnaceBody);

function furnaceFront(lit: boolean): Painter {
  return (p) => {
    furnaceBody(p);
    // bouche supérieure
    p.rect(3, 3, 10, 3, 0x2c2c2c);
    p.rect(4, 4, 8, 1, 0x161616);
    // foyer
    p.rect(3, 9, 10, 5, 0x1b1b1b);
    p.frame(2, 8, 12, 7, 0x4a4a4a);
    if (lit) {
      for (let x = 3; x < 13; x++) {
        const h = 1 + p.int(4);
        for (let k = 0; k < h; k++) {
          const y = 13 - k;
          p.set(x, y, k === 0 ? 0xfff2a0 : k === 1 ? 0xffc23c : k === 2 ? 0xf08a1c : 0xc8501a);
        }
      }
    } else {
      p.rect(4, 12, 8, 2, 0x2b2b2b);
      p.set(5, 12, 0x3a3a3a);
      p.set(9, 13, 0x3a3a3a);
    }
  };
}
def('furnace_front', furnaceFront(false));
def('furnace_front_on', furnaceFront(true));

function chestWood(p: Px): void {
  const base = 0xa66f2a;
  const f = p.field(2, 8);
  p.each((x, y) => shade(base, 0.9 + f(x, y) * 0.2));
  p.frame(1, 0, 14, 16, 0x3a2710);
  p.frame(2, 1, 12, 14, 0x7c521d);
}
def('chest_top', (p) => {
  chestWood(p);
  p.frame(1, 1, 14, 14, 0x3a2710);
  p.frame(2, 2, 12, 12, 0x7c521d);
});
def('chest_side', (p) => {
  chestWood(p);
  for (let x = 1; x < 15; x++) p.set(x, 5, 0x3a2710);
});
def('chest_front', (p) => {
  chestWood(p);
  for (let x = 1; x < 15; x++) p.set(x, 5, 0x3a2710);
  p.rect(7, 3, 2, 4, 0xc9c9c9);
  p.set(7, 3, 0xffffff);
  p.set(8, 6, 0x7a7a7a);
});

// Lit : couverture rouge, oreiller blanc, cadre en planches
const BED_RED = 0xa1281f;
const BED_WOOD = 0x9a7a48;
def('bed_head_top', (p) => {
  p.fill(BED_RED);
  p.rect(0, 0, 16, 9, 0xe8e8e8);
  p.rect(1, 1, 14, 7, 0xf8f8f8);
  for (let x = 0; x < TS; x++) p.set(x, 9, 0xcfcfcf);
  for (let i = 0; i < 12; i++) p.mul(p.int(TS), 10 + p.int(6), 0.92);
});
def('bed_foot_top', (p) => {
  p.fill(BED_RED);
  for (let i = 0; i < 24; i++) p.mul(p.int(TS), p.int(TS), 0.92);
  for (let x = 0; x < TS; x++) p.set(x, 15, shade(BED_RED, 0.8));
});
function bedSide(head: boolean): Painter {
  return (p) => {
    // seules les 9 rangées du bas de la tuile sont visibles (lit haut de 9 pixels)
    p.rect(0, 7, 16, 6, head ? 0xe4e4e4 : BED_RED);
    if (head) p.rect(8, 7, 8, 6, BED_RED);
    for (let x = 0; x < TS; x++) p.set(x, 7, head && x < 8 ? 0xffffff : shade(BED_RED, 1.15));
    p.rect(0, 13, 16, 3, BED_WOOD);
    for (let x = 0; x < TS; x++) p.set(x, 13, shade(BED_WOOD, 0.75));
    p.rect(head ? 0 : 13, 13, 3, 3, shade(BED_WOOD, 0.8));
  };
}
def('bed_head_side', bedSide(true));
def('bed_foot_side', bedSide(false));
def('bed_head_end', (p) => {
  p.rect(0, 7, 16, 6, 0xe4e4e4);
  p.rect(0, 13, 16, 3, BED_WOOD);
  p.rect(0, 13, 3, 3, shade(BED_WOOD, 0.8));
  p.rect(13, 13, 3, 3, shade(BED_WOOD, 0.8));
});
def('bed_foot_end', (p) => {
  p.rect(0, 7, 16, 6, BED_RED);
  for (let x = 0; x < TS; x++) p.set(x, 7, shade(BED_RED, 1.15));
  p.rect(0, 13, 16, 3, BED_WOOD);
  p.rect(0, 13, 3, 3, shade(BED_WOOD, 0.8));
  p.rect(13, 13, 3, 3, shade(BED_WOOD, 0.8));
});

function door(base: Color, top: boolean, iron: boolean): Painter {
  return (p) => {
    const f = p.field(2, 8);
    p.each((x, y) => shade(base, 0.92 + f(x, y) * 0.14));
    const dark = shade(base, 0.6);
    const light = shade(base, 1.18);
    for (let y = 0; y < TS; y++) {
      p.set(0, y, dark);
      p.set(15, y, dark);
      p.set(1, y, light);
    }
    if (top) {
      for (let x = 0; x < TS; x++) p.set(x, 0, dark);
      // carreaux de la partie haute
      const panes: Array<[number, number]> = iron ? [[3, 3], [9, 3]] : [[3, 3], [9, 3], [3, 9], [9, 9]];
      for (const [px, py] of panes) {
        p.frame(px - 1, py - 1, 6, iron ? 7 : 6, dark);
        for (let y = py; y < py + (iron ? 5 : 4); y++) for (let x = px; x < px + 4; x++) p.clear(x, y);
      }
      if (iron) for (let x = 2; x < 14; x++) p.set(x, 12, dark);
    } else {
      for (let x = 0; x < TS; x++) p.set(x, 15, dark);
      p.frame(3, 2, 10, 5, dark);
      p.frame(3, 9, 10, 5, dark);
      p.rect(4, 3, 8, 3, shade(base, 0.86));
      p.rect(4, 10, 8, 3, shade(base, 0.86));
    }
    // poignée
    if (top) {
      p.set(12, 14, iron ? 0x4a4a4a : 0x2e2416);
      p.set(13, 14, iron ? 0x6a6a6a : 0x4a3a22);
    }
  };
}
def('oak_door_top', door(0xa88450, true, false));
def('oak_door_bottom', door(0xa88450, false, false));
def('iron_door_top', door(0xc4c4c4, true, true));
def('iron_door_bottom', door(0xc4c4c4, false, true));

def('trapdoor', (p) => {
  planks(0xa07a44)(p);
  p.frame(0, 0, 16, 16, 0x5b4023);
  for (const [px, py] of [[3, 3], [9, 3], [3, 9], [9, 9]] as Array<[number, number]>) {
    p.frame(px - 1, py - 1, 6, 6, 0x5b4023);
    for (let y = py; y < py + 4; y++) for (let x = px; x < px + 4; x++) p.clear(x, y);
  }
});

def('nether_bricks', (p) => {
  const brick = 0x2f171b;
  const f = p.field(4, 4);
  p.each((x, y) => {
    const row = y >> 2;
    const off = row % 2 === 0 ? 0 : 4;
    if ((y & 3) === 3 || ((x + off) & 7) === 7) return 0x180a0c;
    return shade(brick, 0.9 + f(x, y) * 0.22);
  });
});
def('soul_sand', (p) => {
  p.rough([0x3f2f26, 0x48372c, 0x524034, 0x5a473a], 5, 5, 0.75);
  // visages devinés dans le sable : deux creux sombres et une bouche
  for (const [ox, oy] of [[2, 3], [9, 9]]) {
    p.set(ox, oy, 0x2a1d17);
    p.set(ox + 3, oy, 0x2a1d17);
    for (let x = ox; x <= ox + 3; x++) p.set(x, oy + 2, 0x2f211a);
  }
});
for (const [name, h] of [['nether_wart_0', 4], ['nether_wart_1', 8], ['nether_wart_2', 12]] as Array<[TileName, number]>) {
  def(name, (p) => {
    for (const cx of [3, 8, 12]) {
      const top = 16 - h + (cx === 8 ? 0 : 2);
      for (let y = top; y < 16; y++) {
        p.set(cx, y, y === top ? 0xc0282c : 0x8a1418);
        if (y > top + 1 && h > 4) p.set(cx + (y % 2 === 0 ? 1 : -1), y, 0x6e0e12);
      }
      if (h >= 12) {
        p.set(cx - 1, top, 0xd84448);
        p.set(cx + 1, top, 0xd84448);
        p.set(cx, top - 1, 0xd84448);
      }
    }
  });
}

def('rail', (p) => {
  // traverses de bois, puis les deux files de rail
  const wood = 0x7a5a34;
  for (const y of [1, 5, 9, 13]) {
    for (let x = 1; x < 15; x++) {
      p.set(x, y, shade(wood, 1.05));
      p.set(x, y + 1, shade(wood, 0.78));
    }
  }
  for (let y = 0; y < TS; y++) {
    for (const x of [3, 12]) {
      p.set(x, y, 0xb8b8b8);
      p.set(x + (x === 3 ? 1 : -1), y, 0x7c7c7c);
    }
  }
});

def('ladder', (p) => {
  const wood = 0x9a7a48;
  for (let y = 0; y < TS; y++) {
    for (const x of [2, 3, 12, 13]) p.set(x, y, shade(wood, x === 2 || x === 12 ? 1.05 : 0.8));
  }
  for (const y of [1, 5, 9, 13]) {
    for (let x = 1; x < 15; x++) {
      p.set(x, y, shade(wood, 1.08));
      p.set(x, y + 1, shade(wood, 0.7));
    }
  }
});

def('torch', (p) => {
  for (let y = 8; y < 16; y++) {
    p.set(7, y, 0x8a6a3a);
    p.set(8, y, 0x5e4622);
  }
  p.set(7, 6, 0xffe680);
  p.set(8, 6, 0xffd23c);
  p.set(7, 7, 0xffb21c);
  p.set(8, 7, 0xf08a1c);
});

def('glass_pane_top', (p) => {
  for (let y = 0; y < TS; y++) {
    p.set(7, y, 0xd3eef4);
    p.set(8, y, 0xa9d3de);
  }
});

def('iron_bars', (p) => {
  for (let y = 0; y < TS; y++) {
    for (const x of [1, 5, 9, 13]) {
      p.set(x, y, 0x8a8a8a);
      p.set(x + 1, y, 0x5a5a5a);
    }
  }
  for (let x = 0; x < TS; x++) {
    p.set(x, 0, 0x6e6e6e);
    p.set(x, 1, 0x4c4c4c);
    p.set(x, 14, 0x6e6e6e);
    p.set(x, 15, 0x4c4c4c);
  }
});

def('spawner', (p) => {
  p.fill(0x1a2530);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const bar = x % 4 === 0 || y % 4 === 0;
      if (!bar) p.clear(x, y);
      else p.set(x, y, (x + y) % 3 === 0 ? 0x2f4252 : 0x1a2530);
    }
  }
  p.frame(0, 0, 16, 16, 0x0f1820);
});

// ---------------------------------------------------------------------------
// Végétation
// ---------------------------------------------------------------------------
def('tall_grass', (p) => {
  for (let i = 0; i < 11; i++) {
    let x = 1 + p.int(14);
    const h = 5 + p.int(9);
    const c = p.pick([0x8a8a8a, 0xa2a2a2, 0xb8b8b8, 0x767676]);
    for (let k = 0; k < h; k++) {
      p.set(x, 15 - k, k > h - 3 ? shade(c, 1.15) : c);
      if (k > 2 && p.rnd() < 0.25) x += p.rnd() < 0.5 ? -1 : 1;
    }
  }
});

def('fern', (p) => {
  const c1 = 0x9a9a9a;
  const c2 = 0x7a7a7a;
  for (let y = 3; y < 16; y++) p.set(8, y, c2);
  for (let y = 3; y < 14; y += 2) {
    const w = Math.min(6, 1 + Math.floor((y - 2) * 0.6));
    for (let k = 1; k <= w; k++) {
      p.set(8 - k, y + Math.floor(k / 3), k % 2 ? c1 : c2);
      p.set(8 + k, y + Math.floor(k / 3), k % 2 ? c1 : c2);
    }
  }
  p.set(8, 2, c1);
});

def('dead_bush', (p) => {
  p.ascii(
    [
      '................',
      '................',
      '...b......b.....',
      '....b....b..b...',
      '..b..b...b.b....',
      '...b.b..bb......',
      '....bB..b...b...',
      '.b...Bb.B..b....',
      '..bb..BbB.b.....',
      '....b..BBb......',
      '.....b.BB.......',
      '......bBB.......',
      '.......BB.......',
      '.......BB.......',
      '.......BB.......',
      '.......B........',
    ],
    { b: 0x8a6a34, B: 0x6b4f24 }
  );
});

def(
  'dandelion',
  flower(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.......yy.......',
      '......yYYy......',
      '......yYOy......',
      '.......yy.......',
      '.......g........',
      '....l..g..l.....',
      '.....lgGgl......',
      '......gGg.......',
      '.......G........',
    ],
    { y: 0xffe94a, Y: 0xfff68a, O: 0xe8b81c }
  )
);

def(
  'poppy',
  flower(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '......rr.r......',
      '.....rRRrr......',
      '.....rRkRr......',
      '......rrr.......',
      '.......g........',
      '.......g........',
      '.......gl.......',
      '.....l.gl.......',
      '......lg........',
      '.......g........',
      '.......G........',
    ],
    { r: 0xd0211a, R: 0xed4b3c, k: 0x2a1410 }
  )
);

def(
  'blue_orchid',
  flower(
    [
      '................',
      '................',
      '................',
      '................',
      '.........bb.....',
      '.....bb.bBb.....',
      '....bBBb.b......',
      '.....bb.g.......',
      '......g.g.......',
      '.......g........',
      '.......g........',
      '.......g..l.....',
      '....l..g.l......',
      '.....l.gl.......',
      '......lg........',
      '.......G........',
    ],
    { b: 0x2fa8ef, B: 0x9be0ff }
  )
);

def(
  'allium',
  flower(
    [
      '................',
      '................',
      '......ppp.......',
      '.....pPpPp......',
      '.....PpPpp......',
      '.....pPpPp......',
      '......ppp.......',
      '.......g........',
      '.......g........',
      '.......g........',
      '.......g........',
      '.......g........',
      '.......gl.......',
      '......lg........',
      '.......g........',
      '.......G........',
    ],
    { p: 0xa565d8, P: 0xd3a6f4 }
  )
);

def(
  'azure_bluet',
  flower(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.....w....w.....',
      '....wyw..wyw....',
      '.....w.ww.w.....',
      '.....g.wyw.g....',
      '.....g..w..g....',
      '....lg..g.gl....',
      '.....lg.g.g.....',
      '......gGgg......',
      '.......Gg.......',
      '.......G........',
    ],
    { w: 0xf4f7f7, y: 0xf5d83c }
  )
);

function tulip(c: Color, light: Color): Painter {
  return flower(
    [
      '................',
      '................',
      '................',
      '................',
      '......c.c.......',
      '.....cCcCc......',
      '.....cCCCc......',
      '......ccc.......',
      '.......g........',
      '.......g........',
      '....l..g........',
      '....l..g..l.....',
      '.....l.g.l......',
      '.....lgGgl......',
      '......gGg.......',
      '.......G........',
    ],
    { c, C: light }
  );
}
def('red_tulip', tulip(0xc92a1c, 0xf05a44));
def('orange_tulip', tulip(0xe07a1c, 0xf7a548));
def('white_tulip', tulip(0xd8dede, 0xfafafa));
def('pink_tulip', tulip(0xe59ac4, 0xf7c9e2));

def(
  'oxeye_daisy',
  flower(
    [
      '................',
      '................',
      '................',
      '......w.w.......',
      '.....wwwww......',
      '....wwyYww......',
      '.....wYyww......',
      '.....wwwww......',
      '......w.w.......',
      '.......g........',
      '.......g........',
      '.......gl.......',
      '.....l.g........',
      '......lg........',
      '.......g........',
      '.......G........',
    ],
    { w: 0xf2f2f2, y: 0xf5d83c, Y: 0xe0a81c }
  )
);

def(
  'cornflower',
  flower(
    [
      '................',
      '................',
      '................',
      '....b..b..b.....',
      '.....bBbBb......',
      '....bBbBbBb.....',
      '.....bbBbb......',
      '......bgb.......',
      '.......g........',
      '.......g........',
      '.......g........',
      '.......gl.......',
      '.....l.g........',
      '......lg........',
      '.......g........',
      '.......G........',
    ],
    { b: 0x3f5fd8, B: 0x7f9bf4 }
  )
);

def('brown_mushroom', (p) => {
  p.ascii(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '......bbbb......',
      '.....bBBBBb.....',
      '....bBBbBBBb....',
      '....dddddddd....',
      '.......ss.......',
      '.......sS.......',
      '.......sS.......',
    ],
    { b: 0x9b7653, B: 0xb38a63, d: 0x6e5038, s: 0xd9cdb8, S: 0xb9ad98 }
  );
});

def('red_mushroom', (p) => {
  p.ascii(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '......rrrr......',
      '.....rRwRRr.....',
      '....rRRRRwRr....',
      '....rwRRRRRr....',
      '....dddddddd....',
      '.......ss.......',
      '.......sS.......',
      '.......sS.......',
      '.......sS.......',
    ],
    { r: 0xc4231c, R: 0xe33c30, w: 0xf4f4f4, d: 0x8a1712, s: 0xd9cdb8, S: 0xb9ad98 }
  );
});

def('sugar_cane', (p) => {
  const stalks = [2, 7, 12];
  for (const sx of stalks) {
    const x = sx + p.int(2);
    for (let y = 0; y < TS; y++) {
      const node = (y + sx) % 5 === 0;
      p.set(x, y, node ? 0x6fa84a : 0xa4d870);
      p.set(x + 1, y, node ? 0x5a8f3a : 0x82c05a);
    }
    // feuilles
    const ly = 2 + p.int(8);
    p.set(x - 1, ly, 0x82c05a);
    p.set(x - 2, ly - 1, 0x6fa84a);
    p.set(x + 2, ly + 3, 0x82c05a);
    p.set(x + 3, ly + 2, 0x6fa84a);
  }
});

def('cactus_side', (p) => {
  const base = 0x0f8a2a;
  p.each((x, y) => {
    const rib = x % 3;
    let c = rib === 0 ? shade(base, 0.72) : rib === 1 ? shade(base, 1.12) : base;
    c = shade(c, 0.95 + p.rnd() * 0.1);
    if (x === 0 || x === 15) return null;
    void y;
    return c;
  });
  for (let i = 0; i < 9; i++) {
    const x = 1 + p.int(14);
    const y = p.int(TS);
    p.set(x, y, 0xdfe8c8);
  }
});

def('cactus_top', (p) => {
  const base = 0x128f2e;
  p.each((x, y) => {
    if (x === 0 || x === 15 || y === 0 || y === 15) return null;
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6) return shade(base, 0.7);
    return shade(base, (Math.floor(d) % 2 === 0 ? 1.1 : 0.92) + p.rnd() * 0.06);
  });
  p.set(7, 7, 0xdfe8c8);
  p.set(8, 8, 0xdfe8c8);
});

def('cactus_bottom', (p) => {
  p.each((x, y) => {
    if (x === 0 || x === 15 || y === 0 || y === 15) return null;
    return shade(0xb9b06a, 0.9 + p.rnd() * 0.2);
  });
});

function pumpkinSide(p: Px): void {
  const base = 0xd9811c;
  p.each((x, y) => {
    const rib = x % 4;
    let c = rib === 3 ? shade(base, 0.72) : rib === 0 ? shade(base, 1.1) : base;
    if (y === 0) c = shade(c, 1.12);
    if (y === 15) c = shade(c, 0.78);
    return shade(c, 0.96 + p.rnd() * 0.08);
  });
}
def('pumpkin_side', pumpkinSide);
def('pumpkin_top', (p) => {
  const base = 0xd0791a;
  p.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const ang = Math.atan2(y - 7.5, x - 7.5);
    const rib = Math.abs(Math.sin(ang * 4)) < 0.25;
    let c = rib ? shade(base, 0.74) : base;
    if (d > 7) c = shade(c, 0.85);
    return shade(c, 0.96 + p.rnd() * 0.08);
  });
  p.rect(7, 6, 2, 3, 0x5a7a2a);
  p.set(7, 6, 0x7a9a3a);
});
function pumpkinFace(glow: boolean): Painter {
  return (p) => {
    pumpkinSide(p);
    const dark = glow ? 0xffd83c : 0x2a1a08;
    const inner = glow ? 0xfff6a0 : 0x1a1004;
    p.ascii(
      [
        '..##......##..',
        '.#oo#....#oo#.',
        '.####....####.',
        '..............',
        '......##......',
        '..............',
        '.#..#.##.#..#.',
        '.##########.#.',
        '..#oooooooo#..',
        '...##.##.##...',
      ],
      { '#': dark, o: inner },
      1,
      3
    );
  };
}
def('pumpkin_face', pumpkinFace(false));
def('jack_o_lantern', pumpkinFace(true));

def('melon_side', (p) => {
  const f = p.field(8, 2);
  p.each((x, y) => {
    const stripe = (x + Math.floor(f(x, y) * 2)) % 4;
    const c = stripe === 0 ? 0x5a8f1c : stripe === 2 ? 0x8fc43a : 0x74aa28;
    return shade(c, 0.94 + p.rnd() * 0.12);
  });
});
def('melon_top', (p) => {
  p.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    const c = Math.floor(d) % 3 === 0 ? 0x5a8f1c : 0x7db22c;
    return shade(c, 0.94 + p.rnd() * 0.12);
  });
  p.rect(7, 7, 2, 2, 0xb8a868);
});

for (let stage = 0; stage < 8; stage++) {
  def(`wheat_${stage}` as TileName, (p) => {
    const t = stage / 7;
    const h = 3 + Math.round(t * 11);
    const green = 0x3f9c1e;
    const gold = 0xd9b648;
    const stalk = mix(green, gold, Math.max(0, (t - 0.55) / 0.45));
    for (let x = 1; x < 15; x++) {
      if (p.rnd() < 0.22) continue;
      const hh = Math.max(2, h - p.int(3));
      for (let k = 0; k < hh; k++) {
        const y = 15 - k;
        let c = shade(stalk, 0.8 + p.rnd() * 0.35);
        if (stage >= 6 && k >= hh - 4) c = shade(stage === 7 ? 0xe2c04f : 0xb8b03c, 0.85 + p.rnd() * 0.3);
        p.set(x, y, c);
      }
      if (stage === 7 && p.rnd() < 0.5) p.set(x, 15 - hh, 0x8a6a1c);
    }
  });
}

function rootCrop(prefix: 'carrots' | 'potatoes', rootColor: Color): void {
  for (let stage = 0; stage < 4; stage++) {
    def(`${prefix}_${stage}` as TileName, (p) => {
      const h = 2 + stage * 2 + (stage === 3 ? 1 : 0);
      for (const cx of [3, 8, 12]) {
        for (let k = 0; k < h; k++) {
          const spread = Math.min(2, Math.floor(k / 2));
          for (let dx = -spread; dx <= spread; dx++) {
            if (p.rnd() < 0.3 && dx !== 0) continue;
            p.set(cx + dx, 14 - k, p.pick([0x3f9c1e, 0x2f7a16, 0x56b82c]));
          }
        }
        p.set(cx, 15, stage === 3 ? rootColor : 0x3f9c1e);
        if (stage === 3) p.set(cx + 1, 15, shade(rootColor, 0.8));
      }
    });
  }
}
rootCrop('carrots', 0xf08a1c);
rootCrop('potatoes', 0xc9a85a);

function farmland(wet: boolean): Painter {
  return (p) => {
    const pal = wet
      ? [0x2f1f12, 0x3a2717, 0x45301c, 0x503821]
      : [0x6c4a33, 0x79553a, 0x866043, 0x8d6748];
    p.rough(pal, 5, 5, 0.7);
    for (let y = 1; y < TS; y += 4) {
      for (let x = 0; x < TS; x++) {
        p.mul(x, y, 0.72);
        p.mul(x, y + 1, 1.1);
      }
    }
  };
}
const PATH = [0x8a7a44, 0x978649, 0xa29252, 0xad9d5c];
def('grass_path_top', (p) => {
  p.rough(PATH, 5, 5, 0.6);
});
def('grass_path_side', (p) => {
  dirtBase(p);
  for (let x = 0; x < TS; x++) {
    p.set(x, 0, p.pick(PATH));
    p.set(x, 1, shade(p.pick(PATH), 0.86));
  }
});
def('farmland_dry', farmland(false));
def('farmland_wet', farmland(true));

def('lily_pad', (p) => {
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 7.2) continue;
      // encoche caractéristique du nénuphar
      if (dy > 0 && Math.abs(dx) < dy * 0.35) continue;
      let c = d > 6 ? 0x1a6a26 : 0x208a30;
      if (Math.abs(dx) < 0.6 || Math.abs(dx - dy) < 0.7 || Math.abs(dx + dy) < 0.7) c = 0x3aa648;
      p.set(x, y, c);
    }
  }
});

def('vine', (p) => {
  const f = p.field(6, 4);
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const v = f(x, y) * 0.6 + p.rnd() * 0.4;
      if (v > 0.52) p.set(x, y, v > 0.75 ? 0xb0b0b0 : v > 0.62 ? 0x8e8e8e : 0x707070);
    }
  }
});

def('cobweb', (p) => {
  const c = 0xe9eef0;
  for (let i = 0; i < TS; i++) {
    p.set(i, i, c);
    p.set(15 - i, i, c);
    p.set(7, i, c, 200);
    p.set(i, 8, c, 200);
  }
  for (const r of [3, 6]) {
    for (let k = -r; k <= r; k++) {
      p.set(7 + k, 8 - (r - Math.abs(k)), c, 220);
      p.set(7 + k, 8 + (r - Math.abs(k)), c, 220);
    }
  }
});

def('hay_side', (p) => {
  const base = 0xc9a61c;
  p.each((x, y) => shade(x % 3 === 0 ? shade(base, 0.8) : base, 0.9 + p.rnd() * 0.25));
  for (const y of [3, 4, 11, 12]) {
    for (let x = 0; x < TS; x++) p.set(x, y, y === 3 || y === 11 ? 0xa8431c : 0x7f2f12);
  }
});
def('hay_top', (p) => {
  const base = 0xc9a61c;
  p.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    return shade(base, (Math.floor(d) % 2 === 0 ? 1.05 : 0.8) + p.rnd() * 0.12);
  });
});

def('enchanting_table_bottom', (p) => {
  p.each(() => shade(0x1b122b, 0.85 + p.rnd() * 0.3));
});
def('enchanting_table_top', (p) => {
  p.each((x, y) => {
    const border = x === 0 || x === 15 || y === 0 || y === 15;
    if (border) return (x <= 2 || x >= 13) && (y <= 2 || y >= 13) ? 0x5be3e8 : shade(0x1b122b, 0.9 + p.rnd() * 0.25);
    if (x >= 2 && x <= 13 && y >= 2 && y <= 13) return shade(0x9e1b24, 0.9 + p.rnd() * 0.2);
    return shade(0x1b122b, 0.9 + p.rnd() * 0.25);
  });
});
def('enchanting_table_side', (p) => {
  p.each((x, y) => {
    if (y <= 3) return shade(0x9e1b24, 0.85 + p.rnd() * 0.2);
    if (y === 4) return 0x5be3e8;
    return shade(0x1b122b, 0.85 + p.rnd() * 0.3);
  });
});

def('anvil_top', (p) => {
  p.each((x, y) => {
    if (x >= 2 && x <= 13 && y >= 4 && y <= 11) return shade(0x4b4e54, 0.92 + p.rnd() * 0.16);
    return shade(0x303236, 0.9 + p.rnd() * 0.15);
  });
});
def('anvil_side', (p) => {
  p.each((x, y) => {
    if (y <= 4) return shade(0x4b4e54, 0.92 + p.rnd() * 0.16);
    if (y >= 11) return shade(0x3a3c42, 0.9 + p.rnd() * 0.15);
    if (x >= 4 && x <= 11) return shade(0x2d2f34, 0.9 + p.rnd() * 0.15);
    return shade(0x404248, 0.9 + p.rnd() * 0.15);
  });
});

// ---------------------------------------------------------------------------
// Fluides et feu (images animées)
// ---------------------------------------------------------------------------
/** Peint une image de l'animation de l'eau (frame dans [0, total)). */
export function paintWaterFrame(p: Px, frame: number, total: number): void {
  const ph = (frame / total) * Math.PI * 2;
  const k = (Math.PI * 2) / TS;
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const v =
        Math.sin(x * k * 2 + y * k + ph) * 0.4 +
        Math.sin(y * k * 3 - x * k - ph * 2) * 0.3 +
        Math.sin((x + y) * k * 2 + ph * 3) * 0.3;
      const t = v * 0.5 + 0.5;
      let c: Color;
      if (t > 0.86) c = 0x7fa8f4;
      else if (t > 0.62) c = 0x4f80e4;
      else if (t > 0.3) c = 0x3a68d4;
      else c = 0x2f58c0;
      p.set(x, y, c, t > 0.86 ? 200 : 172);
    }
  }
}

/** Peint une image de l'animation de la lave. */
export function paintLavaFrame(p: Px, frame: number, total: number): void {
  const ph = (frame / total) * Math.PI * 2;
  const k = (Math.PI * 2) / TS;
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const v =
        Math.sin(x * k + Math.sin(y * k * 2 + ph) * 1.4) * 0.45 +
        Math.sin(y * k * 2 + Math.sin(x * k + ph) * 1.2 + ph) * 0.35 +
        Math.sin((x - y) * k * 3 - ph) * 0.2;
      const t = v * 0.5 + 0.5;
      let c: Color;
      if (t > 0.82) c = 0xfff08a;
      else if (t > 0.62) c = 0xfbb42c;
      else if (t > 0.4) c = 0xe8741c;
      else if (t > 0.2) c = 0xcf4a12;
      else c = 0xa8300c;
      p.set(x, y, c);
    }
  }
}

/** Peint une image de l'animation du feu. */
export function paintFireFrame(p: Px, frame: number): void {
  const rnd = (n: number) => {
    const s = Math.sin(n * 12.9898 + frame * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) p.clear(x, y);
  for (let x = 0; x < TS; x++) {
    const center = 1 - Math.abs(x - 7.5) / 9;
    const h = Math.floor(4 + center * 8 + rnd(x) * 5);
    for (let k = 0; k < h && k < TS; k++) {
      const t = k / h;
      let c: Color;
      if (t < 0.25) c = 0xfff6b0;
      else if (t < 0.5) c = 0xffd03c;
      else if (t < 0.78) c = 0xf58a1c;
      else c = 0xd84a12;
      if (rnd(x * 31 + k) < 0.12 && t > 0.4) continue;
      p.set(x, 15 - k, c);
    }
  }
}

def('water', (p) => paintWaterFrame(p, 0, 32));
def('lava', (p) => paintLavaFrame(p, 0, 32));
def('fire', (p) => paintFireFrame(p, 0));

// ---------------------------------------------------------------------------
// Fissures de minage (10 étapes)
// ---------------------------------------------------------------------------
{
  // On génère une fois le tracé complet des fissures, puis chaque étape en révèle une partie.
  const cracks: Array<[number, number]> = [];
  const gen = new Px(0xc4ac);
  const walkers: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2 + gen.rnd() * 0.6;
    walkers.push({ x: 7.5, y: 7.5, dx: Math.cos(ang), dy: Math.sin(ang) });
  }
  for (let step = 0; step < 14; step++) {
    for (const w of walkers) {
      w.x += w.dx + (gen.rnd() - 0.5) * 0.9;
      w.y += w.dy + (gen.rnd() - 0.5) * 0.9;
      const px = Math.round(w.x);
      const py = Math.round(w.y);
      if (px >= 0 && py >= 0 && px < TS && py < TS) cracks.push([px, py]);
      if (gen.rnd() < 0.12) {
        w.dx = Math.cos(Math.atan2(w.dy, w.dx) + (gen.rnd() - 0.5) * 1.6);
        w.dy = Math.sin(Math.atan2(w.dy, w.dx) + (gen.rnd() - 0.5) * 1.6);
      }
    }
  }
  for (let stage = 0; stage < 10; stage++) {
    def(`destroy_${stage}` as TileName, (p) => {
      const count = Math.floor(((stage + 1) / 10) * cracks.length);
      for (let i = 0; i < count; i++) {
        const [x, y] = cracks[i];
        p.set(x, y, 0x101010, 150 + stage * 8);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Particules
// ---------------------------------------------------------------------------
function blob(p: Px, r: number, colors: readonly Color[], a = 255): void {
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < r + (p.rnd() - 0.5) * 1.5) {
        const idx = Math.min(colors.length - 1, Math.floor((d / r) * colors.length));
        p.set(x, y, colors[Math.max(0, idx)], a);
      }
    }
  }
}
def('particle_smoke', (p) => blob(p, 6, [0xdadada, 0xbcbcbc, 0x9a9a9a, 0x7c7c7c], 220));
def('particle_explosion', (p) => blob(p, 7.5, [0xffffff, 0xf0f0f0, 0xd0d0d0, 0xb0b0b0], 235));
def('particle_flame', (p) => blob(p, 5, [0xfff6b0, 0xffd03c, 0xf58a1c]));
def('particle_lava', (p) => blob(p, 4, [0xfff08a, 0xfbb42c, 0xe8741c]));
def('particle_snow', (p) => blob(p, 3.5, [0xffffff, 0xf0f8ff]));
def('particle_bubble', (p) => {
  p.ascii(
    ['..bbbb..', '.b....b.', 'b.w....b', 'b.w....b', 'b......b', 'b......b', '.b....b.', '..bbbb..'],
    { b: 0x8fb8ff, w: 0xffffff },
    4,
    4
  );
});
def('particle_heart', (p) => {
  p.ascii(
    ['.rr..rr.', 'rRRrrRRr', 'rRRRRRRr', 'rRRRRRRr', '.rRRRRr.', '..rRRr..', '...rr...'],
    { r: 0xb81a1a, R: 0xf03a3a },
    4,
    4
  );
});
def('particle_splash', (p) => {
  p.ascii(['...b....', '..bBb...', '..bBb...', '.bBBBb..', '.bBwBb..', '..bbb...'], { b: 0x3a68d4, B: 0x6f9af0, w: 0xd8e6ff }, 4, 5);
});
def('particle_crit', (p) => {
  p.ascii(['...y....', '...y....', '.yyYyy..', '...y....', '...y....'], { y: 0xf5e6a0, Y: 0xffffff }, 5, 5);
});
def('particle_rain', (p) => {
  for (let i = 0; i < 9; i++) {
    const x = p.int(TS);
    const y = p.int(TS);
    const len = 3 + p.int(4);
    for (let k = 0; k < len; k++) p.setWrap(x, y + k, k === len - 1 ? 0x9fc0ff : 0x5f8fe8, 170);
  }
});

// ---------------------------------------------------------------------------
// Redstone
// ---------------------------------------------------------------------------
def('redstone_dust', (p) => {
  for (let i = 0; i < 16; i++) {
    p.set(7, i, 0xffffff);
    p.set(8, i, 0xe8e8e8);
    p.set(i, 7, 0xffffff);
    p.set(i, 8, 0xe8e8e8);
  }
  p.rect(6, 6, 4, 4, 0xffffff);
});

def('redstone_torch_on', (p) => {
  p.rect(7, 6, 2, 10, 0x7c552e);
  p.rect(7, 8, 2, 8, 0x93693a);
  p.rect(6, 4, 4, 4, 0xd81818);
  p.rect(7, 5, 2, 2, 0xff9a6a);
});

def('redstone_torch_off', (p) => {
  p.rect(7, 6, 2, 10, 0x7c552e);
  p.rect(7, 8, 2, 8, 0x93693a);
  p.rect(6, 4, 4, 4, 0x561010);
  p.rect(7, 5, 2, 2, 0x7a1a1a);
});

def('piston_top', (p) => {
  p.rough([0xa6834c, 0xb8945c, 0xc29e65], 4, 4, 0.4);
  p.frame(0, 0, 16, 16, 0x7c5e31);
  p.rect(0, 5, 16, 1, 0x7c5e31);
  p.rect(0, 10, 16, 1, 0x7c5e31);
});

def('piston_top_sticky', (p) => {
  p.rough([0xa6834c, 0xb8945c, 0xc29e65], 4, 4, 0.4);
  p.frame(0, 0, 16, 16, 0x7c5e31);
  p.rect(3, 3, 10, 10, 0x76b852);
  p.rect(5, 5, 6, 6, 0x8cd464);
});

def('piston_side', (p) => {
  p.rough([0x7a7a7a, 0x868686, 0x929292], 5, 5, 0.5);
  p.rect(0, 0, 16, 4, 0xb28b52);
  p.rect(0, 4, 16, 1, 0x4b4b4b);
  p.frame(0, 4, 16, 12, 0x5d5d5d);
});

def('piston_bottom', (p) => {
  p.rough([0x666666, 0x747474, 0x828282], 5, 5, 0.5);
  p.frame(0, 0, 16, 16, 0x484848);
  p.rect(5, 5, 6, 6, 0x555555);
});

def('piston_inner', (p) => {
  p.rough([0x5a5a5a, 0x6a6a6a, 0x777777], 5, 5, 0.5);
  p.rect(5, 5, 6, 6, 0x9c7b49);
});

def('redstone_lamp_off', (p) => {
  p.rough([0x583c24, 0x69482c, 0x785434], 4, 4, 0.45);
  p.frame(0, 0, 16, 16, 0x3b2615);
  p.frame(2, 2, 12, 12, 0x49311d);
});

def('redstone_lamp_on', (p) => {
  p.rough([0xd29c46, 0xe8b960, 0xf9db84, 0xfff0b2], 4, 4, 0.4);
  p.frame(0, 0, 16, 16, 0x8d5b20);
  p.frame(2, 2, 12, 12, 0xb87f32);
});

def('nether_portal', (p) => {
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const d = Math.sin(x * 0.7 + y * 0.5) + Math.cos(x * 0.4 - y * 0.8);
      p.set(x, y, d > 0.5 ? 0xa94bf7 : d > -0.3 ? 0x8224d6 : 0x5c13a3, 190);
    }
  }
});

def('nether_quartz_ore', (p) => {
  p.rough([0x501b1b, 0x622525, 0x723232, 0x854242, 0x935050], 6, 6, 0.6);
  const spots: Array<[number, number]> = [[2, 3], [9, 2], [5, 8], [11, 7], [3, 12], [10, 13]];
  for (const [x, y] of spots) {
    p.set(x, y, 0xe8e2d8);
    p.set(x + 1, y, 0xffffff);
    p.set(x, y + 1, 0xc9bfb2);
    p.set(x + 1, y + 1, 0xe8e2d8);
  }
});
