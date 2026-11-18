/**
 * Textures procédurales des objets (sprites 16×16 façon Minecraft).
 * Chaque sprite est dessiné à la main en ASCII : '.' = transparent, les autres
 * caractères renvoient à une palette (k = contour, d = ombre, b = base, h = clair, w = reflet).
 * Lumière venant du haut-gauche. Module pur (pas de DOM).
 */
import { COLOR_HEX, COLOR_NAMES } from '../../world/Ids';
import { ARMOR_KINDS, ARMOR_MATERIALS, TOOL_KINDS, TOOL_MATERIALS, type TileName } from '../../world/Tiles';
import { luma, mix, shade, type Color, type Painter, type Px } from './PixelCanvas';

export const ITEM_PAINTERS: Partial<Record<TileName, Painter>> = {};
const def = (name: TileName, painter: Painter) => {
  ITEM_PAINTERS[name] = painter;
};

type Pal = Record<string, Color>;
type Rows = readonly string[];

/** Peintre qui pose simplement un sprite ASCII. */
const spr = (rows: Rows, pal: Pal): Painter => (p) => p.ascii(rows, pal);

/** Segment d'un pixel d'épaisseur (corde de l'arc, hampe de flèche). */
function line(p: Px, x0: number, y0: number, x1: number, y1: number, c: Color): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    p.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c);
  }
}

// ---------------------------------------------------------------------------
// Palettes partagées
// ---------------------------------------------------------------------------
/** Manche en bois : o = contour, L = clair, M = ombre. */
const HANDLE: Pal = { o: 0x2c2110, L: 0x94702f, M: 0x664a1e };

/** Matières des outils et armures : contour, ombre, base, clair. */
const MATERIALS: Record<string, Pal> = {
  wooden: { k: 0x3a2a12, d: 0x6b5024, b: 0x8a6a3a, h: 0xad8d55 },
  stone: { k: 0x363636, d: 0x686868, b: 0x8f8f8f, h: 0xb6b6b6 },
  iron: { k: 0x444448, d: 0x9c9ca0, b: 0xd6d6d8, h: 0xffffff },
  golden: { k: 0x5c4308, d: 0xc9921c, b: 0xf2d336, h: 0xfffa9c },
  diamond: { k: 0x0e4a42, d: 0x1fae96, b: 0x33ebcb, h: 0xb4fff2 },
  leather: { k: 0x3f2415, d: 0x7a4526, b: 0xa0623a, h: 0xc98652 },
};

const IRON_INGOT: Pal = { k: 0x3f3f42, s: 0x727276, d: 0x96969a, b: 0xbcbcc0, h: 0xe4e4e6, w: 0xffffff };
const GOLD_INGOT: Pal = { k: 0x5e3d08, s: 0xa86c10, d: 0xd0921a, b: 0xf0c42a, h: 0xfdf05a, w: 0xffffc8 };

// ---------------------------------------------------------------------------
// Matières premières
// ---------------------------------------------------------------------------
def(
  'stick',
  spr(
    [
      '................',
      '................',
      '............oo..',
      '...........oLMo.',
      '..........oLMo..',
      '.........oLMo...',
      '........oLMo....',
      '.......oLMo.....',
      '......oLMo......',
      '.....oLMo.......',
      '....oLMo........',
      '...oLMo.........',
      '..oLMo..........',
      '.oLMo...........',
      '.oMo............',
      '..o.............',
    ],
    HANDLE
  )
);

const COAL_ROWS: Rows = [
  '................',
  '................',
  '......kkkk......',
  '....kkhhbbkk....',
  '...khwhbbbbbk...',
  '..khhbbbdbbbbk..',
  '..khbbbbbbdbbk..',
  '.khbbbdbbbbbbdk.',
  '.kbbbbbbbhbbddk.',
  '.kbbdbbbbbbbddk.',
  '.kbbbbbhbbbdddk.',
  '..kbbbbbbbdddk..',
  '..kdbbdbddddk...',
  '...kkddddkkk....',
  '.....kkkk.......',
  '................',
];
const CHARCOAL_ROWS: Rows = [
  '................',
  '................',
  '.......kkkk.....',
  '.....kkhhbbkk...',
  '....khhbbdbbbk..',
  '...khwbbbbbbbdk.',
  '...khbbdbbhbbdk.',
  '..khbbbbbbdbbdk.',
  '..khbdbbbbbbddk.',
  '..kbbbbhdbbbddk.',
  '..kbbbbbbbbdddk.',
  '...kbdbbbbdddk..',
  '...kdbbbddddk...',
  '....kkddddkk....',
  '......kkkk......',
  '................',
];
def('coal', spr(COAL_ROWS, { k: 0x0e0e10, d: 0x1c1c1f, b: 0x303034, h: 0x505056, w: 0x7c7c84 }));
def('charcoal', spr(CHARCOAL_ROWS, { k: 0x17110b, d: 0x2b2118, b: 0x463729, h: 0x6a5642, w: 0x8f7a62 }));

/** Lingot / brique : trapèze en perspective (dessus clair, face avant, flanc droit sombre). */
const INGOT_ROWS: Rows = [
  '................',
  '................',
  '................',
  '................',
  '.....kkkkkkkkk..',
  '....khhhhhhhhdk.',
  '...khwwhhhhhddk.',
  '..khhhhhhhhdddk.',
  '.kbbbbbbbbbdddk.',
  '.kbbbbbbbbbddk..',
  '.kbbbbbbbbbdk...',
  '.ksssssssssk....',
  '..kkkkkkkkk.....',
  '................',
  '................',
  '................',
];
def('iron_ingot', spr(INGOT_ROWS, IRON_INGOT));
def('gold_ingot', spr(INGOT_ROWS, GOLD_INGOT));
def(
  'gold_nugget',
  spr(
    [
      '................',
      '................',
      '................',
      '.......kkkk.....',
      '.....kkwwhhk....',
      '....kwwhhhhbk...',
      '...kwhhhbbbbdk..',
      '...khhbbbbdddk..',
      '...kbbbbbddddk..',
      '....kbbbddddk...',
      '.....kssddsk....',
      '......kkkkk.....',
      '................',
      '................',
      '................',
      '................',
    ],
    GOLD_INGOT,
  ),
);
def(
  'magma_cream',
  spr(
    [
      '................',
      '................',
      '.....kkkkkk.....',
      '...kkoorrrrk....',
      '..koorrrrryyk...',
      '..korrrryyyyrk..',
      '.korrryywwyyrdk.',
      '.korryywywyrrdk.',
      '.kddrrryyrrrddk.',
      '.kddrrrrrrrrddk.',
      '..kddddrrrrddk..',
      '..kddddddrdddk..',
      '...kkddddddkk...',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x2e0804, d: 0x6b1808, r: 0xb8340c, o: 0xe66214, y: 0xf7b824, w: 0xfff08a },
  ),
);
def('brick', spr(INGOT_ROWS, { k: 0x40190f, s: 0x6e2f1f, d: 0x8c3f2b, b: 0xb0563a, h: 0xcb7250, w: 0xe09474 }));

def(
  'diamond',
  spr(
    [
      '................',
      '................',
      '....kkkkkkkk....',
      '...kwwhhhhbbk...',
      '..kwwhhhhbbbdk..',
      '.khhhhhbbbbbddk.',
      '.kbhhbbbbbbdddk.',
      '..kbhbbbbbdddk..',
      '...kbhbbbdddk...',
      '....kbbbdddk....',
      '.....kbbddk.....',
      '......kbdk......',
      '.......kk.......',
      '................',
      '................',
      '................',
    ],
    { k: 0x0f5a50, d: 0x1fbfa8, b: 0x4aedd9, h: 0xa5f8ec, w: 0xeafffc }
  )
);

def(
  'emerald',
  spr(
    [
      '................',
      '................',
      '.....kkkkkk.....',
      '....khhhhbbk....',
      '...khwwhhbbdk...',
      '...khwhhbbbdk...',
      '...khhhbbbbdk...',
      '...khhbbbbddk...',
      '...khbbbbdddk...',
      '...kbbbbbdddk...',
      '...kbbbbddddk...',
      '....kbbddddk....',
      '.....kkkkkk.....',
      '................',
      '................',
      '................',
    ],
    { k: 0x045c1c, d: 0x00a82c, b: 0x17dd62, h: 0x82f6ad, w: 0xe0ffee }
  )
);

def(
  'lapis',
  spr(
    [
      '................',
      '................',
      '.........kkk....',
      '.......kkhhbk...',
      '......khhhbbbk..',
      '.....khhbbbbbk..',
      '....khhbbbbwbdk.',
      '...khhbbbbbbbdk.',
      '..khbbbwbbbbddk.',
      '..kbbbbbbbbdddk.',
      '..kbbbbbbdbddk..',
      '..kdbbdbbdddk...',
      '...kdddddddk....',
      '....kkkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x101f58, d: 0x1c3f9a, b: 0x2f5fc8, h: 0x5c88e6, w: 0xa2bef8 }
  )
);

/** Tas de poudre pointu (redstone, poudre lumineuse). */
const PILE_PEAK: Rows = [
  '................',
  '................',
  '................',
  '................',
  '.......kk.......',
  '......khhk......',
  '.....khhbbkk....',
  '....khwhbbbbk...',
  '...khhbbbbbdbk..',
  '..khhbbwbbbbddk.',
  '..khbbbdbbbbddk.',
  '.khbbbbbbbdbdddk',
  '.kbbdbbbwbbddddk',
  '.kddbbdddbddddk.',
  '..kkkkkkkkkkkk..',
  '................',
];
/** Tas de poudre bas et large (poudre à canon, sucre). */
const PILE_FLAT: Rows = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......kkkk......',
  '....kkhhhbkk....',
  '...khwhhbbbbk...',
  '..khhhbbbbdbbk..',
  '.khhbbbdbbbbbdk.',
  '.khbbbbbbwbdbdk.',
  'khbbdbbbbbbbdddk',
  'kbbbbbbdbbdddddk',
  '.kddddddddddddk.',
  '..kkkkkkkkkkkk..',
  '................',
];
def('redstone', spr(PILE_PEAK, { k: 0x480400, d: 0x8f0800, b: 0xd01008, h: 0xff3a2a, w: 0xff9080 }));
def('gunpowder', spr(PILE_FLAT, { k: 0x242426, d: 0x464648, b: 0x6c6c70, h: 0x9a9a9e, w: 0xc2c2c6 }));
def('sugar', spr(PILE_FLAT, { k: 0x66707e, d: 0xb4c0d0, b: 0xe2e8f0, h: 0xffffff, w: 0xffffff }));

def('glowstone_dust', (p) => {
  p.ascii(PILE_PEAK, { k: 0x5a4008, d: 0xa87a10, b: 0xe0b020, h: 0xffe84a, w: 0xffffc8 });
  // étincelles autour du tas
  p.set(3, 4, 0xffe84a);
  p.set(12, 5, 0xffffc8);
  p.set(13, 8, 0xffe84a);
  p.set(2, 8, 0xffffc8);
});

def(
  'flint',
  spr(
    [
      '................',
      '................',
      '........kkk.....',
      '.......khhbk....',
      '......khwhbbk...',
      '.....khhbbbbdk..',
      '....khhbbbbbdk..',
      '....khbbbbbddk..',
      '...khbbbhbbddk..',
      '...kbbbbbbdddk..',
      '...kbbbbbddddk..',
      '...kbbbbddddk...',
      '....kbdddddk....',
      '.....kkdddk.....',
      '.......kkk......',
      '................',
    ],
    { k: 0x121214, d: 0x2a2a2e, b: 0x45454a, h: 0x707078, w: 0xa0a0a8 }
  )
);

def(
  'quartz',
  spr(
    [
      '................',
      '................',
      '.........kkk....',
      '........kwwhk...',
      '.......kwwhhbk..',
      '......kwwhhbbk..',
      '.....kwwhhhbbdk.',
      '....kwwwhhbbbdk.',
      '...kwwwhhhbbddk.',
      '..kwwhhhhbbbddk.',
      '..kwhhhhbbbdddk.',
      '..khhhbbbbdddk..',
      '...kbbbbddddk...',
      '....kkddddkk....',
      '......kkkk......',
      '................',
    ],
    { k: 0x705c5a, d: 0xc2aaa6, b: 0xe2d4ce, h: 0xf4ede8, w: 0xffffff }
  )
);

def(
  'clay_ball',
  spr(
    [
      '................',
      '................',
      '................',
      '.....kkkkkk.....',
      '....khhhhbbk....',
      '...khwwhbbbbk...',
      '..khwhhbbbbbdk..',
      '..khhhbbbbbbdk..',
      '..khhbbbbbbddk..',
      '..khbbbbbbbddk..',
      '..kbbbbbbbdddk..',
      '...kbbbbbdddk...',
      '....kddddddk....',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x474d5a, d: 0x7c8494, b: 0x9aa3b3, h: 0xb4bdcc, w: 0xd2d9e4 }
  )
);

def(
  'snowball',
  spr(
    [
      '................',
      '................',
      '.....kkkkkk.....',
      '...kkwwwwhhkk...',
      '..kwwwwwhhhhbk..',
      '..kwwwwhhhhbbk..',
      '.kwwwwhhhhbbbdk.',
      '.kwwwhhhhbbbbdk.',
      '.kwwhhhhbbbbbdk.',
      '.kwhhhhbbbbbddk.',
      '.khhhhbbbbbbddk.',
      '..khhbbbbbbddk..',
      '..khbbbbbbdddk..',
      '...kkbbbdddkk...',
      '.....kkkkkk.....',
      '................',
    ],
    { k: 0x5a7488, d: 0x9ab8cc, b: 0xc4dcea, h: 0xe8f4fa, w: 0xffffff }
  )
);

// ---------------------------------------------------------------------------
// Agriculture et nourriture
// ---------------------------------------------------------------------------
def(
  'wheat_seeds',
  spr(
    [
      '................',
      '................',
      '................',
      '.......kk.......',
      '......khbk......',
      '......kbdk..kk..',
      '..kk...kk..khbk.',
      '.khbk......kbdk.',
      '.kbdk..kk...kk..',
      '..kk..khbk......',
      '......kbdk......',
      '...kk..kk..kk...',
      '..khbk....khbk..',
      '..kbdk....kbdk..',
      '...kk......kk...',
      '................',
    ],
    { k: 0x1c3d08, d: 0x3b7a14, b: 0x62a824, h: 0xa2dc5c }
  )
);

def(
  'wheat',
  spr(
    [
      '................',
      '..........kkk...',
      '.........khdhk..',
      '....kkk.khdhdk..',
      '...khdhkkdhdkkk.',
      '...kdhdhkhdkhdhk',
      '....khdhdkkhdhdk',
      '.....khdhkhdhdk.',
      '......kdhdhdkk..',
      '......khdhdk....',
      '.....ksthdk.....',
      '....kstskk......',
      '...kstsk........',
      '..kstsk.........',
      '..kkkk..........',
      '................',
    ],
    { k: 0x4a3608, d: 0xb89224, h: 0xe8cc4c, s: 0x8a7420, t: 0xc0a640 }
  )
);

def(
  'bread',
  spr(
    [
      '................',
      '................',
      '..........kkkk..',
      '........kkhhhbk.',
      '.......khhhbbbdk',
      '......khhbdbbbdk',
      '.....khhbbbbbddk',
      '....khhbdbbbbdk.',
      '...khhbbbbbbdk..',
      '..khhbdbbbbdk...',
      '.khhbbbbbbdk....',
      '.khbbbbbbdk.....',
      '.kbbbbbddk......',
      '.kddddddk.......',
      '..kkkkkk........',
      '................',
    ],
    { k: 0x4a2e0c, d: 0x8a5a1c, b: 0xb8822e, h: 0xdcae52 }
  )
);

const APPLE_ROWS: Rows = [
  '................',
  '.........s......',
  '........s.GG....',
  '........sGLG....',
  '...kkkk.sGGkk...',
  '..khhbbksbbbbk..',
  '.khwhbbbbbbbbdk.',
  '.khwhbbbbbbbbdk.',
  '.khhbbbbbbbbbdk.',
  '.khbbbbbbbbbddk.',
  '.kbbbbbbbbbbddk.',
  '.kbbbbbbbbbdddk.',
  '..kbbbbbbbdddk..',
  '...kdddddddddk..',
  '....kkkkkkkkk...',
  '................',
];
const APPLE_EXTRA: Pal = { s: 0x5a3a1a, G: 0x3f9a2a, L: 0x86d850 };
def('apple', spr(APPLE_ROWS, { ...APPLE_EXTRA, k: 0x5a0808, d: 0xa01010, b: 0xdc1c1c, h: 0xff5a4a, w: 0xffb4a4 }));
def('golden_apple', spr(APPLE_ROWS, { ...APPLE_EXTRA, k: 0x6b4a08, d: 0xc08a18, b: 0xeacb30, h: 0xffef6a, w: 0xffffd8 }));

/** Côtelette : chair bordée de gras (f). */
const CHOP_ROWS: Rows = [
  '................',
  '................',
  '.........kkkk...',
  '.......kkffffk..',
  '......kfhhhhbfk.',
  '.....kfhhhbbbbfk',
  '....kfhhbbbbbbfk',
  '...kfhhbbbbbbdfk',
  '..kfhhbbbbbbddfk',
  '..kfhbbbbbbddfk.',
  '..kfbbbbbbddfk..',
  '..kfbbbdddffk...',
  '...kffdddfkk....',
  '....kkfffk......',
  '......kkk.......',
  '................',
];
def('raw_porkchop', spr(CHOP_ROWS, { k: 0x7a2e3a, f: 0xffdcdc, d: 0xc85a66, b: 0xf07a80, h: 0xff9ea0 }));
def('cooked_porkchop', spr(CHOP_ROWS, { k: 0x4a2a0c, f: 0xe8c890, d: 0x8f5a24, b: 0xb87a3c, h: 0xd9a060 }));

/** Pavé de bœuf : f = persillage (cru) ou marques de gril (cuit). */
const BEEF_ROWS: Rows = [
  '................',
  '................',
  '................',
  '....kkkkkkkk....',
  '..kkhhhhbbbbkk..',
  '.khhhbbfbbbbbbk.',
  '.khbbbbbfbbbbdk.',
  '.khbbfbbbbbfbdk.',
  '.kbbbbfbbbbbfdk.',
  '.kbbbbbbbfbbddk.',
  '.kbfbbbbbbbbddk.',
  '.kdbbbbbbbdddk..',
  '..kkdddddddkk...',
  '....kkkkkkk.....',
  '................',
  '................',
];
def('raw_beef', spr(BEEF_ROWS, { k: 0x5a0c10, f: 0xffc8bc, d: 0x9a1a1e, b: 0xd02a2a, h: 0xf05a4a }));
def('steak', spr(BEEF_ROWS, { k: 0x2e1408, f: 0x3e1c0e, d: 0x5e2e18, b: 0x86482a, h: 0xa8683a }));

/** Pilon de poulet : chair en haut à droite, os (w/s) en bas à gauche. */
const CHICKEN_ROWS: Rows = [
  '................',
  '................',
  '........kkkk....',
  '......kkhhhhkk..',
  '.....khhhhbbbbk.',
  '....khhhbbbbbbdk',
  '....khhbbbbbbbdk',
  '....khbbbbbbbddk',
  '....kbbbbbbbbddk',
  '.....kbbbbbdddk.',
  '....kwkkdddkk...',
  '...kwsk.kkk.....',
  '.kkwsk..........',
  'kwwwk...........',
  'kwsk............',
  '.kk.............',
];
const BONE_BITS: Pal = { w: 0xf4f4e6, s: 0xc8c8b4 };
def('raw_chicken', spr(CHICKEN_ROWS, { ...BONE_BITS, k: 0x7a4a44, d: 0xd08880, b: 0xf0b0a0, h: 0xffd9c8 }));
def('cooked_chicken', spr(CHICKEN_ROWS, { ...BONE_BITS, k: 0x4a280c, d: 0x8f5522, b: 0xc07f3e, h: 0xe0a868 }));

/** Gigot de mouton : chair bordée de gras, os en bas à droite. */
const MUTTON_ROWS: Rows = [
  '................',
  '................',
  '...kkkkkk.......',
  '..kffffffkk.....',
  '.kfhhhhbbbfk....',
  '.kfhhbbbbbbfk...',
  '.kfhbbbbbbbbfk..',
  '.kfbbbbbbbbbfk..',
  '..kfbbbbbbddfk..',
  '...kfbbbbdddfk..',
  '....kffdddffkk..',
  '.....kkfffkkwwk.',
  '.......kkkkwsk..',
  '...........kwwwk',
  '............kwsk',
  '.............kk.',
];
def('raw_mutton', spr(MUTTON_ROWS, { ...BONE_BITS, k: 0x5a1014, f: 0xffd2c4, d: 0xa02428, b: 0xd03a34, h: 0xf06a5a }));
def('cooked_mutton', spr(MUTTON_ROWS, { ...BONE_BITS, k: 0x3a1e0a, f: 0xd9b080, d: 0x6a3e1e, b: 0x8f5a30, h: 0xb07848 }));

def(
  'rotten_flesh',
  spr(
    [
      '................',
      '................',
      '.....kk...kk....',
      '....khhk.khbk...',
      '...khbbbkhbbbk..',
      '..khbgbbbbbgbk..',
      '..kbbbbbgbbbbdk.',
      '...kbbgbbbbbbdk.',
      '..kkbbbbbbgbdk..',
      '.khbbbgbbbbbdk..',
      '.kbbbbbbbgbbddk.',
      '.kbgbbbbbbbdddk.',
      '..kdbbkdbbddkk..',
      '...kkk.kdddk....',
      '........kkk.....',
      '................',
    ],
    { k: 0x3a1810, d: 0x6e2f22, b: 0x9a4a32, h: 0xc0694a, g: 0x6f7a2e }
  )
);

def(
  'melon_slice',
  spr(
    [
      '................',
      '................',
      '................',
      '.kkkkkkkkkkkkkk.',
      'kgRRRRRRRRRRRRgk',
      'kglrrrrsrrrrrlgk',
      'kglrrsrrrrsrrlgk',
      '.kglrrrrsrrrlgk.',
      '.kglrrsrrrrrlgk.',
      '..kglrrrrsrlgk..',
      '..kgglrrrrlggk..',
      '...kggllllggk...',
      '....kkggggkk....',
      '......kkkk......',
      '................',
      '................',
    ],
    { k: 0x1f4a12, g: 0x4a9a2a, l: 0xcfe8a0, r: 0xe03a34, R: 0xf5645a, s: 0x2a1410 }
  )
);

def(
  'carrot',
  spr(
    [
      '................',
      '..........G.gG..',
      '.........gGgGLg.',
      '........gGLGLGg.',
      '.......kkkGLGg..',
      '......khhbkGg...',
      '.....khhbbbkk...',
      '.....khbbdbbk...',
      '....khbbbbbdk...',
      '....khbdbbdk....',
      '...khbbbbdk.....',
      '...khbbbdk......',
      '..khbdbdk.......',
      '..kbbdkk........',
      '.kbdkk..........',
      '.kkk............',
    ],
    { k: 0x6a2e04, d: 0xc25a08, b: 0xf07f14, h: 0xffb14a, g: 0x1f5a12, G: 0x3f9a2a, L: 0x86d850 }
  )
);

const POTATO_ROWS: Rows = [
  '................',
  '................',
  '................',
  '........kkkk....',
  '......kkhhbbkk..',
  '.....khhhbbbbbk.',
  '....khhbbbdbbbdk',
  '...khhbbbbbbbbdk',
  '..khhbdbbbbbdbdk',
  '..khbbbbbbbbbddk',
  '..khbbbbdbbbddk.',
  '..kbbbbbbbbdddk.',
  '...kdbbbbdddkk..',
  '....kkddddkk....',
  '......kkkk......',
  '................',
];
def('potato', spr(POTATO_ROWS, { k: 0x5a3d14, d: 0xa07530, b: 0xc99a48, h: 0xe6c06a }));
def('baked_potato', (p) => {
  p.ascii(POTATO_ROWS, { k: 0x4a2a08, d: 0x8a5518, b: 0xb87a2e, h: 0xd69a44 });
  // entaille dorée de la pomme de terre cuite
  p.ascii(['....cc', '..cCCc', 'cCCc..', 'cc....'], { c: 0xf5d870, C: 0xfff4b0 }, 6, 6);
});

def(
  'cookie',
  spr(
    [
      '................',
      '................',
      '.....kkkkkk.....',
      '...kkhhhhbbkk...',
      '..khhhbcbbbbbk..',
      '..khbbbbbbcbbk..',
      '.khhbbbbbbbbbdk.',
      '.khbcbbbbbbbbdk.',
      '.khbbbbbcbbbbdk.',
      '.kbbbbbbbbbcbdk.',
      '.kbbbcbbbbbbddk.',
      '..kbbbbbbcbbdk..',
      '..kdbbbbbbdddk..',
      '...kkddddddkk...',
      '.....kkkkkk.....',
      '................',
    ],
    { k: 0x5a3410, d: 0xa86a28, b: 0xd08a3c, h: 0xe8ae60, c: 0x4a2a12 }
  )
);

def(
  'pumpkin_pie',
  spr(
    [
      '................',
      '................',
      '................',
      '....kkkkkkkk....',
      '..kkcccccccckk..',
      '.kccoooooooocck.',
      'kccohhoooooooCck',
      'kcohhooooooooock',
      'kccoooooooooocCk',
      'kCccooooooooccCk',
      'kdCccccccccccCdk',
      '.kdCCCCCCCCCCdk.',
      '..kkddddddddkk..',
      '....kkkkkkkk....',
      '................',
      '................',
    ],
    { k: 0x4a2c0a, d: 0x8f5e20, C: 0xc48a3c, c: 0xe8b86a, o: 0xe07a18, h: 0xf8a84a }
  )
);

/** Bol en bois : i/j = intérieur (vide ou ragoût). */
const BOWL_ROWS: Rows = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '...kkkkkkkkkk...',
  '.kkiiiiiiiiiikk.',
  'khiijiiiijiiiibk',
  'khbiiiijiiiiibdk',
  '.khbbbbbbbbbbdk.',
  '.khbbbbbbbbbddk.',
  '..khbbbbbbbddk..',
  '...kkbbbbddkk...',
  '.....kkkkkk.....',
  '................',
  '................',
];
const BOWL_WOOD: Pal = { k: 0x2e1c08, d: 0x5a3c16, b: 0x7c5626, h: 0xa07a3c };
def('bowl', spr(BOWL_ROWS, { ...BOWL_WOOD, i: 0x4a3212, j: 0x4a3212 }));
def('mushroom_stew', spr(BOWL_ROWS, { ...BOWL_WOOD, i: 0xb86a4c, j: 0xead8b8 }));

def(
  'egg',
  spr(
    [
      '................',
      '................',
      '......kkkk......',
      '.....khhbbk.....',
      '....khwhbbbk....',
      '....khwhbbbk....',
      '...khwhbbbbdk...',
      '...khhbbbbbdk...',
      '...khhbbbbbdk...',
      '...khbbbbbbdk...',
      '...khbbbbbddk...',
      '...kbbbbbbddk...',
      '....kbbbbddk....',
      '....kdbbdddk....',
      '.....kkkkkk.....',
      '................',
    ],
    { k: 0x6b5a3a, d: 0xc0a878, b: 0xe3d3a8, h: 0xf6eed4, w: 0xffffff }
  )
);

def(
  'spider_eye',
  spr(
    [
      '................',
      '................',
      '................',
      '.....kkkkkk.....',
      '...kkhhhhbbkk...',
      '..khhhbbbbbbbk..',
      '..khbbppppbbbdk.',
      '.khbbppwpppbbdk.',
      '.khbbpppppqbbdk.',
      '.kbbbpppppqbbdk.',
      '..kbbbqqqqbbdk..',
      '..kdbbbbbbbddk..',
      '...kkddddddkk...',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x3c0810, d: 0x7a1422, b: 0xb0283a, h: 0xe05a6a, p: 0x2a0612, q: 0x50101e, w: 0xffa0ac }
  )
);

def(
  'sugar_cane_item',
  spr(
    [
      '................',
      '......kkkk......',
      '.kkkk.klgk.kkkk.',
      '.klgk.klgk.klgk.',
      '.klgk.kddk.klgk.',
      '.kddk.klgk.klgk.',
      '.klgk.klgk.kddk.',
      '.klgk.klgk.klgk.',
      '.klgk.kddk.klgk.',
      '.kddk.klgk.klgk.',
      '.klgk.klgk.kddk.',
      '.klgk.klgk.klgk.',
      '.klgk.kddk.klgk.',
      '.klgk.klgk.klgk.',
      '.kkkk.kkkk.kkkk.',
      '................',
    ],
    { k: 0x24480f, d: 0x4a7f26, g: 0x6fae3c, l: 0xa8dc6c }
  )
);

// ---------------------------------------------------------------------------
// Dépouilles de créatures
// ---------------------------------------------------------------------------
def(
  'bone',
  spr(
    [
      '................',
      '..........kk.kk.',
      '.........kwwkwwk',
      '.........kwwwwdk',
      '..........kwwdk.',
      '.........kwwdk..',
      '........kwwdk...',
      '.......kwwdk....',
      '......kwwdk.....',
      '.....kwwdk......',
      '....kwwdk.......',
      '...kwwdk........',
      '.kkwwdk.........',
      'kwwwwdk.........',
      'kwdkwdk.........',
      '.kk.kk..........',
    ],
    { k: 0x5c5c4e, d: 0xc4c4b0, w: 0xf6f6ea }
  )
);

def(
  'bone_meal',
  spr(
    [
      '................',
      '................',
      '................',
      '................',
      '.......kk.......',
      '......kwhk......',
      '.....kwwhbk.....',
      '....kwwhhbbk....',
      '...kwwhhbbbdk...',
      '..kwwhhbbbbddk..',
      '..kwhhbbbbdddk..',
      '..khbbbbbddddk..',
      'kk.kkkkkkkkkk.kk',
      'khk.........khdk',
      '.k...........kk.',
      '................',
    ],
    { k: 0x5e5e52, d: 0xa8a898, b: 0xcfcfc0, h: 0xeaeae0, w: 0xffffff }
  )
);

def(
  'string',
  spr(
    [
      '................',
      '................',
      '...........kkk..',
      '..........kwwwk.',
      '.........kwdkwk.',
      '.........kwk.k..',
      '........kwdk....',
      '......kkwwk.....',
      '.....kwwdk......',
      '....kwdkk.......',
      '...kwdk.........',
      '..kwdk..........',
      '.kwwk.kk........',
      '.kwdkkwwk.......',
      '..kwwwddk.......',
      '...kkkkk........',
    ],
    { k: 0x5a5a5a, d: 0xc4c4c4, w: 0xf7f7f7 }
  )
);

def(
  'feather',
  spr(
    [
      '................',
      '...........kkk..',
      '.........kkwwwk.',
      '........kwwwwdk.',
      '.......kwwwdwdk.',
      '......kwwwdwwk..',
      '.....kwwwdwwdk..',
      '.....kwwdwwdk...',
      '....kwwdwwwdk...',
      '....kwdwwwdk....',
      '...kkdwwddk.....',
      '...kqkdddk......',
      '..kqkkkkk.......',
      '.kqk............',
      'kqk.............',
      '.k..............',
    ],
    { k: 0x5c5c5c, d: 0xc2c2c2, w: 0xf8f8f8, q: 0xd8cca0 }
  )
);

def(
  'leather',
  spr(
    [
      '................',
      '................',
      '..kk........kk..',
      '.khhk.kkkk.kbbk.',
      '.khhbkhhbbkbbdk.',
      '..khhhhbbbbbdk..',
      '...khhbbbbbbdk..',
      '...khbbbbbbbdk..',
      '...khbbbbbbbdk..',
      '...khbbbbbbddk..',
      '..khbbbbbbbbddk.',
      '.khbbkbbbbkbddk.',
      '.kbbk.kddk.kddk.',
      '..kk...kk...kk..',
      '................',
      '................',
    ],
    { k: 0x4a220e, d: 0x8a4420, b: 0xb8602f, h: 0xdc8852 }
  )
);

// ---------------------------------------------------------------------------
// Arc et flèche
// ---------------------------------------------------------------------------
def(
  'arrow',
  spr(
    [
      '................',
      '...........kkkk.',
      '..........khttk.',
      '.........okttdk.',
      '........oLkddk..',
      '.......oLo.kk...',
      '......oLo.......',
      '.....oLo........',
      '....oLo.........',
      '.kkoLo..........',
      'kwwLo...........',
      'kwLwkk..........',
      '.kwwwwk.........',
      '..kkwwk.........',
      '....kk..........',
      '................',
    ],
    { ...HANDLE, k: 0x3a3a3c, t: 0x8a8a90, d: 0x5e5e64, h: 0xc8c8cc, w: 0xf2f2f2 }
  )
);

/** Bois de l'arc (sans la corde) : arc bombé vers le haut-gauche. */
const BOW_ROWS: Rows = [
  '................',
  '........kkkkkk..',
  '......kkLLLLMMk.',
  '....kkLLMkkkkkk.',
  '...kLLMkk.......',
  '...kLMk.........',
  '..kLMk..........',
  '..kLMk..........',
  '.kLLk...........',
  '.kLMk...........',
  '.kLMk...........',
  '.kLMk...........',
  '.kMMk...........',
  '.kMMk...........',
  '..kk............',
  '................',
];
const BOW_PAL: Pal = { k: 0x2c2110, L: 0x94702f, M: 0x664a1e };
const BOW_STRING = 0xdcdcdc;

/** Arc ; pull = 0 (repos) ou distance de traction de la corde (avec flèche encochée). */
function bow(pull: number): Painter {
  return (p) => {
    p.ascii(BOW_ROWS, BOW_PAL);
    if (pull === 0) {
      line(p, 13, 3, 3, 13, BOW_STRING);
      return;
    }
    const a = 8 + pull; // sommet de la corde tendue
    line(p, 13, 3, a, a, BOW_STRING);
    line(p, 3, 13, a, a, BOW_STRING);
    // flèche encochée : hampe sur la diagonale, pointe vers le haut-gauche
    const tip = a - 9;
    line(p, tip + 1, tip + 1, a - 1, a - 1, 0x94702f);
    p.set(tip, tip, 0xe0e0e4);
    p.set(tip + 1, tip, 0xb0b0b6);
    p.set(tip, tip + 1, 0xb0b0b6);
    p.set(tip + 1, tip + 1, 0x7c7c84);
    // empennage
    p.set(a - 1, a - 2, 0xf2f2f2);
    p.set(a - 2, a - 1, 0xf2f2f2);
    p.set(a - 2, a - 3, 0xd0d0d0);
    p.set(a - 3, a - 2, 0xd0d0d0);
  };
}
def('bow', bow(0));
def('bow_pulling_0', bow(2));
def('bow_pulling_1', bow(4));
def('bow_pulling_2', bow(6));

// ---------------------------------------------------------------------------
// Pêche : canne (avec ou sans sa ligne) et poisson
// ---------------------------------------------------------------------------
const FISHING_ROD_ROWS: Rows = [
  '................',
  '.............oo.',
  '............oLo.',
  '...........oLMo.',
  '..........oLMo..',
  '.........oLMo...',
  '........oLMo....',
  '.......oLMo.....',
  '......oLMo......',
  '.....oLMo.......',
  '....oLMo........',
  '...oLMo.........',
  '..oLMo..........',
  '.oLMo...........',
  '.oMo............',
  '..o.............',
];

/** Canne à pêche ; `cast` = ligne lancée (la ficelle et le flotteur ne pendent plus au bout). */
function fishingRod(cast: boolean): Painter {
  return (p) => {
    p.ascii(FISHING_ROD_ROWS, HANDLE);
    if (cast) return;
    line(p, 14, 3, 14, 10, 0xdcdcdc);
    p.set(14, 11, 0xd62c2c);
    p.set(13, 11, 0x8f1818);
    p.set(14, 12, 0xf2f2f2);
    p.set(13, 12, 0xc4c4c4);
  };
}
def('fishing_rod', fishingRod(false));
def('fishing_rod_cast', fishingRod(true));

/** Poisson vu de profil, tête à gauche (e = œil). */
const FISH_ROWS: Rows = [
  '................',
  '................',
  '................',
  '................',
  '......kkkk....k.',
  '....kkhhhhkk.kbk',
  '..kkhhhhbbbbkbbk',
  '.khehhbbbbbbbbdk',
  '.khhhbbbbbbbbbdk',
  '..kkbbbbbdddkddk',
  '....kkddddkk.kdk',
  '......kkkk....k.',
  '................',
  '................',
  '................',
  '................',
];
def('raw_fish', spr(FISH_ROWS, { k: 0x2a3b46, h: 0xa6c6d4, b: 0x7198ab, d: 0x4d7083, e: 0x0e1216 }));
def('cooked_fish', spr(FISH_ROWS, { k: 0x4a3320, h: 0xecd9b8, b: 0xcdb188, d: 0xa38862, e: 0x2a1a0e }));

// ---------------------------------------------------------------------------
// Ustensiles
// ---------------------------------------------------------------------------
def(
  'flint_and_steel',
  spr(
    [
      '................',
      '..kkkkkk........',
      '.khhhhhbk.......',
      'khhbkkkbbk......',
      'khbk...kbk......',
      'khbk....k.......',
      'khbk............',
      'khbk......kkk...',
      'khbbk....kffgk..',
      '.kbbbkk.kfffggk.',
      '..kbbbdkkffgggk.',
      '...kkkkkkfggggk.',
      '.........kgggk..',
      '..........kkk...',
      '................',
      '................',
    ],
    { k: 0x2a2a2e, b: 0xa8a8ae, h: 0xe6e6ea, d: 0x76767c, f: 0x66666e, g: 0x3c3c42 }
  )
);

def(
  'shears',
  spr(
    [
      '................',
      '..kk........kk..',
      '..khk......khk..',
      '..khbk....khbk..',
      '...khbk..khbk...',
      '....khbkkhbk....',
      '.....khbhbk.....',
      '......kppk......',
      '.....kbkkbk.....',
      '...kkbk..kbkk...',
      '..krrk....krrk..',
      '.kr..rk..kr..rk.',
      '.kr..rk..kr..rk.',
      '..krrk....krrk..',
      '...kk......kk...',
      '................',
    ],
    { k: 0x38383c, b: 0xb4b4ba, h: 0xf0f0f4, p: 0x66666c, r: 0x8a8a90 }
  )
);

/** Seau : i/j = contenu visible dans l'ouverture. */
const BUCKET_ROWS: Rows = [
  '................',
  '................',
  '................',
  '...kkkkkkkkkk...',
  '.kkhhhhhhhhhhkk.',
  '.khjjiiiiiiiibk.',
  '.khbiiiiiiiibdk.',
  '.khhbbbbbbbbddk.',
  '..khhbbbbbbbdk..',
  '..khhbbbbbbbdk..',
  '..khhbbbbbbddk..',
  '...khbbbbbbdk...',
  '...khbbbbbddk...',
  '...kbbbbbdddk...',
  '....kkkkkkkk....',
  '................',
];
const BUCKET_METAL: Pal = { k: 0x3a3a3e, d: 0x7c7c82, b: 0xb0b0b6, h: 0xe2e2e6 };
def('bucket', spr(BUCKET_ROWS, { ...BUCKET_METAL, i: 0x4c4c52, j: 0x5e5e64 }));
def('water_bucket', spr(BUCKET_ROWS, { ...BUCKET_METAL, i: 0x2f5fd8, j: 0x7aa4f4 }));
def('lava_bucket', spr(BUCKET_ROWS, { ...BUCKET_METAL, i: 0xe8641a, j: 0xffd23c }));
def('milk_bucket', spr(BUCKET_ROWS, { ...BUCKET_METAL, i: 0xeef0f2, j: 0xffffff }));

def(
  'paper',
  spr(
    [
      '................',
      '................',
      '....kkkkkkkkk...',
      '....kwwwwwwwhk..',
      '...kwwwwwwwwhk..',
      '...kwwwwwwwwhk..',
      '...kwwwwwwwhdk..',
      '..kwwwwwwwwhdk..',
      '..kwwwwwwwwhk...',
      '..kwwwwwwwhdk...',
      '.kwwwwwwwwhdk...',
      '.kwwwwwwwwhk....',
      '.khhhhhhhhdk....',
      '.kkkkkkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x6e6e66, d: 0xb8b8ac, h: 0xdcdcd2, w: 0xfafaf4 }
  )
);

def(
  'book',
  spr(
    [
      '................',
      '................',
      '...kkkkkkkkkk...',
      '..kshhhhhhhhbk..',
      '..ksbbbbbbbbdkk.',
      '..ksbbbbbbbbdpk.',
      '..ksbbggggbbdpk.',
      '..ksbbbbbbbbdpk.',
      '..ksbbbbbbbbdpk.',
      '..ksbbbbbbbbdpk.',
      '..ksbbbbbbbbdpk.',
      '..ksbbbbbbbbdpk.',
      '..ksddddddddkpk.',
      '..kkppppppppppk.',
      '...kkkkkkkkkkk..',
      '................',
    ],
    { k: 0x2e1a0a, s: 0x4e2e12, d: 0x6a401c, b: 0x8a5a2a, h: 0xb07c42, g: 0xe8c84a, p: 0xeeeade }
  )
);

// ---------------------------------------------------------------------------
// Objets posables (portes, lit)
// ---------------------------------------------------------------------------
def(
  'door_item',
  spr(
    [
      '................',
      '...kkkkkkkkkk...',
      '...khhhhhhhbk...',
      '...kh..bh..bk...',
      '...kh..bh..bk...',
      '...khbbbbbbbk...',
      '...kh..bh..bk...',
      '...kh..bh..bk...',
      '...khbbbbbbbk...',
      '...khbbbbbybk...',
      '...khddbbddbk...',
      '...khddbbddbk...',
      '...khddbbddbk...',
      '...khbbbbbbdk...',
      '...kkkkkkkkkk...',
      '................',
    ],
    { k: 0x3a2a12, d: 0x7a5c30, b: 0xa07c46, h: 0xc29a5c, y: 0x2c2110 }
  )
);

def(
  'iron_door_item',
  spr(
    [
      '................',
      '...kkkkkkkkkk...',
      '...khhhhhhhbk...',
      '...kh..bh..bk...',
      '...kh..bh..bk...',
      '...khbbbbbbbk...',
      '...khdbbbbdbk...',
      '...khbbbbbbbk...',
      '...khbbbbbbbk...',
      '...khbbbbbybk...',
      '...khbbbbbbbk...',
      '...khbbbbbbbk...',
      '...khdbbbbdbk...',
      '...khbbbbbbdk...',
      '...kkkkkkkkkk...',
      '................',
    ],
    { k: 0x444448, d: 0x8c8c92, b: 0xc4c4c8, h: 0xf0f0f2, y: 0x5a5a60 }
  )
);

def(
  'bed_item',
  spr(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '.kkkkk..........',
      'kwwwwhkkkkkkkkk.',
      'kwwwhhkRRRRRRRRk',
      'khhhhkRrrrrrrrrk',
      'kkkkkkrrrrrrrrdk',
      'kppppppppppppppk',
      'kPPPPPPPPPPPPPPk',
      'kPPkkkkkkkkkkPPk',
      'kPk..........kPk',
      'kkk..........kkk',
      '................',
    ],
    { k: 0x2e1c10, w: 0xf6f6f6, h: 0xd0d0d4, R: 0xd84038, r: 0xa82420, d: 0x7c1814, p: 0xb8945f, P: 0x8a6a3a }
  )
);

// ---------------------------------------------------------------------------
// Colorants : un même tas de poudre teinté
// ---------------------------------------------------------------------------
const DYE_ROWS: Rows = [
  '................',
  '................',
  '................',
  '................',
  '......kkk.......',
  '.....khhbk......',
  '....khwhbbkk....',
  '...khwhbbbbbk...',
  '..khhhbbbbbbdk..',
  '..khhbbbbbbbddk.',
  '.khhbbbbdbbbddk.',
  '.khbbbbbbbbdddk.',
  '.kbbdbbbbbddddk.',
  '..kkddddddddkk..',
  '....kkkkkkkk....',
  '................',
];
COLOR_NAMES.forEach((name, i) => {
  // les teintes très sombres sont éclaircies pour garder un contour lisible
  const raw = COLOR_HEX[i];
  const c = luma(raw) < 40 ? mix(raw, 0xffffff, 0.14) : raw;
  def(
    `dye_${name}`,
    spr(DYE_ROWS, {
      k: shade(c, 0.4),
      d: shade(c, 0.72),
      b: c,
      h: mix(c, 0xffffff, 0.35),
      w: mix(c, 0xffffff, 0.72),
    })
  );
});

// ---------------------------------------------------------------------------
// Outils : manche en diagonale, tête en haut à droite
// ---------------------------------------------------------------------------
const TOOL_ROWS: Record<(typeof TOOL_KINDS)[number], Rows> = {
  pickaxe: [
    '................',
    '...kkkkkk.......',
    '..khhhhhhkk.....',
    '...kkkbbbbbk....',
    '......kkkoLbbk..',
    '........oLMkbbk.',
    '.......oLMo.kbk.',
    '......oLMo..kbk.',
    '.....oLMo...kdk.',
    '....oLMo....kdk.',
    '...oLMo......k..',
    '..oLMo..........',
    '.oLMo...........',
    'oLMo............',
    '.oo.............',
    '................',
  ],
  axe: [
    '................',
    '.......kkk..oo..',
    '......khhbkoLMo.',
    '.....khhbbbLMo..',
    '....khhbbbLMo...',
    '....khbbbLMbk...',
    '....kbbbLMbdk...',
    '....kddLMkkk....',
    '.....oLMo.......',
    '....oLMo........',
    '...oLMo.........',
    '..oLMo..........',
    '.oLMo...........',
    'oLMo............',
    '.oo.............',
    '................',
  ],
  shovel: [
    '................',
    '..........kkk...',
    '.........khhbk..',
    '........khhbbdk.',
    '........khbbbdk.',
    '........kbbbdk..',
    '.......oLkddk...',
    '......oLMokk....',
    '.....oLMo.......',
    '....oLMo........',
    '...oLMo.........',
    '..oLMo..........',
    '.oLMo...........',
    'oLMo............',
    '.oo.............',
    '................',
  ],
  sword: [
    '.............kkk',
    '............khbk',
    '...........khbdk',
    '..........khbdk.',
    '.........khbdk..',
    '........khbdk...',
    '.......khbdk....',
    '..kk..khbdk.....',
    '..kdkkhbdk......',
    '...kdkbdk.......',
    '....kddk........',
    '...oLkddk.......',
    '..oLMokdk.......',
    '.kkMo..kk.......',
    'kddk............',
    '.kk.............',
  ],
  hoe: [
    '................',
    '......kkkkkk....',
    '.....khhhhbbk...',
    '.....kbdkkoLdk..',
    '......kk.oLMkk..',
    '........oLMo....',
    '.......oLMo.....',
    '......oLMo......',
    '.....oLMo.......',
    '....oLMo........',
    '...oLMo.........',
    '..oLMo..........',
    '.oLMo...........',
    'oLMo............',
    '.oo.............',
    '................',
  ],
};
for (const m of TOOL_MATERIALS) {
  for (const kind of TOOL_KINDS) {
    def(`${m}_${kind}`, spr(TOOL_ROWS[kind], { ...HANDLE, ...MATERIALS[m] }));
  }
}

// ---------------------------------------------------------------------------
// Armures
// ---------------------------------------------------------------------------
const ARMOR_ROWS: Record<(typeof ARMOR_KINDS)[number], Rows> = {
  helmet: [
    '................',
    '................',
    '................',
    '....kkkkkkkk....',
    '...khhhhhbbbk...',
    '..khhbbbbbbbdk..',
    '..khbbbbbbbbdk..',
    '..khbbbbbbbbdk..',
    '..kbbkkkkkkbdk..',
    '..kbbk....kbdk..',
    '..kbdk....kbdk..',
    '..kddk....kddk..',
    '...kk......kk...',
    '................',
    '................',
    '................',
  ],
  chestplate: [
    '................',
    '.kkkk......kkkk.',
    'khhbbk....kbbbdk',
    'khbbbbkkkkbbbbdk',
    'khbbbbbbbbbbbbdk',
    'kbbkbbbbbbbbkbdk',
    '.kkkhbbbbbbdkkk.',
    '...khbbbbbbdk...',
    '...khbbbbbbdk...',
    '...khbbbbbbdk...',
    '...khbbbbbbdk...',
    '...kbbbbbbbdk...',
    '...kbbbbbbddk...',
    '...kddddddddk...',
    '....kkkkkkkk....',
    '................',
  ],
  leggings: [
    '................',
    '...kkkkkkkkkk...',
    '...khhhhbbbdk...',
    '...khbbbbbbdk...',
    '...khbbbbbbdk...',
    '...khbbkkbbdk...',
    '...khbk..kbdk...',
    '...khbk..kbdk...',
    '...khbk..kbdk...',
    '...kbbk..kbdk...',
    '...kbbk..kbdk...',
    '...kbbk..kbdk...',
    '...kbdk..kbdk...',
    '...kddk..kddk...',
    '...kkkk..kkkk...',
    '................',
  ],
  boots: [
    '................',
    '................',
    '................',
    '..kkkk....kkkk..',
    '..khbk....khdk..',
    '..khbk....khdk..',
    '..khbk....khdk..',
    '..khbk....khdk..',
    '.kkhbk....khdkk.',
    'khhbbk....kbbddk',
    'khbbbk....kbbbdk',
    'kddddk....kddddk',
    '.kkkkk....kkkkk.',
    '................',
    '................',
    '................',
  ],
};
for (const m of ARMOR_MATERIALS) {
  for (const kind of ARMOR_KINDS) {
    def(`${m}_${kind}`, spr(ARMOR_ROWS[kind], MATERIALS[m]));
  }
}

// ---------------------------------------------------------------------------
// Repères : boussole, horloge, cartes, panneau
// ---------------------------------------------------------------------------

/** Nombre d'images de la boussole et de l'horloge (voir DIAL_FRAMES dans world/Tiles). */
const DIAL_FRAMES_ITEMS = 32;

/** Distance du centre (7,5 ; 7,5) d'un sprite 16×16. */
function radius(x: number, y: number): number {
  return Math.hypot(x - 7.5, y - 7.5);
}

/**
 * Boîtier rond commun à la boussole et à l'horloge : contour, anneau éclairé en haut à gauche,
 * fond du cadran peint par `face` (rayon intérieur ≈ 5).
 */
function dialCase(p: Px, ring: Pal, face: (x: number, y: number) => Color): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = radius(x, y);
      if (r > 7.6) continue;
      if (r > 6.6) p.set(x, y, ring.k);
      else if (r > 5.2) {
        const light = (7.5 - x) + (7.5 - y);
        p.set(x, y, light > 3 ? ring.h : light < -3 ? ring.d : ring.b);
      } else p.set(x, y, face(x, y));
    }
  }
}

const COMPASS_RING: Pal = { k: 0x262626, d: 0x5e5e5e, b: 0x8c8c8c, h: 0xc4c4c4 };
const CLOCK_RING: Pal = { k: 0x4f3a06, d: 0x9c7412, b: 0xd9a921, h: 0xfbe17a };

/** Boussole : l'aiguille rouge montre la direction `frame` (0 = droit devant, sens horaire, 32 crans). */
function compass(frame: number): Painter {
  return (p) => {
    dialCase(p, COMPASS_RING, (x, y) => (x + y < 14 ? 0x434951 : 0x363b42));
    const a = (frame / DIAL_FRAMES_ITEMS) * Math.PI * 2;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    // queue grise puis pointe rouge, d'un pixel d'épaisseur, depuis le centre
    line(p, Math.round(7.5 - dx * 3.2), Math.round(7.5 - dy * 3.2), Math.round(7.5), Math.round(7.5), 0x9a9a9a);
    line(p, Math.round(7.5), Math.round(7.5), Math.round(7.5 + dx * 4.6), Math.round(7.5 + dy * 4.6), 0xd92b2b);
    p.set(Math.round(7.5 + dx * 4.6), Math.round(7.5 + dy * 4.6), 0xff5a4a);
    p.set(7, 7, 0x1c1c1c);
  };
}

/**
 * Horloge : le disque du cadran tourne avec l'heure. `frame` 0 = midi (soleil en haut),
 * 16 = minuit (lune en haut). Moitié jour bleu ciel, moitié nuit bleu nuit.
 */
function clock(frame: number): Painter {
  return (p) => {
    const rho = (frame / DIAL_FRAMES_ITEMS) * Math.PI * 2;
    const sx = Math.sin(rho);
    const sy = -Math.cos(rho);
    dialCase(p, CLOCK_RING, (x, y) => {
      const vx = x - 7.5;
      const vy = y - 7.5;
      const day = vx * sx + vy * sy >= 0;
      return day ? (vx * sx + vy * sy > 2 ? 0x8cc4f2 : 0x5a9fe0) : 0x1d2550;
    });
    const sunX = Math.round(7.5 + sx * 2.8);
    const sunY = Math.round(7.5 + sy * 2.8);
    const moonX = Math.round(7.5 - sx * 2.8);
    const moonY = Math.round(7.5 - sy * 2.8);
    for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
      if (radius(sunX + ox, sunY + oy) <= 5.2) p.set(sunX + ox, sunY + oy, 0xffd83a);
      if (radius(moonX + ox, moonY + oy) <= 5.2) p.set(moonX + ox, moonY + oy, 0xd8dce6);
    }
    // repère fixe en haut du cadran : l'heure se lit à cet endroit
    p.set(7, 2, 0x4f3a06);
    p.set(8, 2, 0x4f3a06);
  };
}

for (let f = 0; f < DIAL_FRAMES_ITEMS; f++) {
  const id = String(f).padStart(2, '0') as '00';
  def(`compass_${id}`, compass(f));
  def(`clock_${id}`, clock(f));
}

/** Feuille de papier d'une carte : bord brun, fond crème. */
function paper(p: Px): void {
  for (let y = 1; y < 15; y++) {
    for (let x = 1; x < 15; x++) {
      const border = x === 1 || x === 14 || y === 1 || y === 14;
      p.set(x, y, border ? 0x8a6d43 : (x + y) % 5 === 0 ? 0xe2d3a8 : 0xeee2bd);
    }
  }
}

def('map', (p) => {
  paper(p);
  // quelques traits pâles : la carte est encore vierge
  for (const y of [5, 8, 11]) for (let x = 4; x < 12; x++) if ((x + y) % 3 !== 0) p.set(x, y, 0xcfbd8c);
});

def('filled_map', (p) => {
  paper(p);
  // relief esquissé : eau, plaine, forêt et un chemin, avec le repère rouge du joueur
  for (let y = 3; y < 13; y++) {
    for (let x = 3; x < 13; x++) {
      const n = Math.sin(x * 1.3) + Math.cos(y * 1.1) + Math.sin((x + y) * 0.7);
      p.set(x, y, n > 1.2 ? 0x4f7a3a : n > 0 ? 0x86a85a : n > -1 ? 0xb8a36b : 0x5b7fc4);
    }
  }
  p.set(8, 7, 0xd92b2b);
  p.set(7, 8, 0xd92b2b);
  p.set(8, 8, 0xff5a4a);
});

/** Panneau : planche sur un poteau. */
def('sign', spr([
  '................',
  '.kkkkkkkkkkkkkk.',
  '.khhhhhhhhhhhbk.',
  '.khbbbbbbbbbbdk.',
  '.khbddbbbddbbdk.',
  '.khbbbbbbbbbbdk.',
  '.khbbddbbbbddbk.',
  '.khbbbbbbbbbbdk.',
  '.kbddddddddddddk',
  '.kkkkkkkkkkkkkk.',
  '.......kMk......',
  '.......kLk......',
  '.......kMk......',
  '.......kLk......',
  '.......kMk......',
  '.......kkk......',
].map((r) => r.slice(0, 16)), { k: 0x3d2c12, h: 0xc29a5b, b: 0xa77f43, d: 0x7d5c2c, L: 0x94702f, M: 0x664a1e }));

// --- Nether : brique, verrue, bâton de blaze ---
def(
  'nether_brick',
  spr(
    [
      '................',
      '................',
      '................',
      '................',
      '...kkkkkkkkkk...',
      '..kllllllllddk..',
      '..klmmmmmmmmdk..',
      '..kmmmmmmmmmdk..',
      '..kmmmmmmmmddk..',
      '..kddddddddddk..',
      '...kkkkkkkkkk...',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    { k: 0x14080a, l: 0x55292f, m: 0x3a1c21, d: 0x24100f },
  ),
);
def(
  'nether_wart',
  spr(
    [
      '................',
      '................',
      '......kk........',
      '.....krrk.kk....',
      '....krlrrkrrk...',
      '....krrrrrlrk...',
      '...kkrrdrrrrk...',
      '..krrkdddrrk....',
      '..krlrkddkk.....',
      '..krrrrkk.......',
      '...krrdk........',
      '....kkk.........',
      '................',
      '................',
      '................',
      '................',
    ],
    { k: 0x3a0608, r: 0xa81a20, l: 0xd84448, d: 0x6e0e12 },
  ),
);
def(
  'blaze_rod',
  spr(
    [
      '................',
      '...........kk...',
      '..........kyok..',
      '.........kyook..',
      '........kyook...',
      '.......kyook....',
      '......kyook.....',
      '.....kyook......',
      '....kyook.......',
      '...kyook........',
      '..kyook.........',
      '..kook..........',
      '...kk...........',
      '................',
      '................',
      '................',
    ],
    { k: 0x6a3a08, y: 0xffe04a, o: 0xf09a18 },
  ),
);

// --- Créatures : boule de slime, perle de l'Ender, selle, laisse, étiquette, potion jetable ---
def(
  'slime_ball',
  spr(
    [
      '................',
      '................',
      '................',
      '.....kkkkkk.....',
      '....khhhhbbk....',
      '...khwwhbbbbk...',
      '..khwwhbbbbbdk..',
      '..khhhbbbbbbdk..',
      '..khbbbbbbbddk..',
      '..kbbbbbbbbddk..',
      '..kbbbbbbbdddk..',
      '...kbbbbdddkk...',
      '....kkddddk.....',
      '......kkkk......',
      '................',
      '................',
    ],
    { k: 0x2c5a24, d: 0x4f8f42, b: 0x74bd62, h: 0x9fdc8c, w: 0xd8f6cc },
  ),
);
def(
  'ender_pearl',
  spr(
    [
      '................',
      '................',
      '.....kkkkkk.....',
      '...kkhhhhbbkk...',
      '..khhwwhbbbbdk..',
      '..khwwhbbbbbdk..',
      '.khhhhbbkkbbddk.',
      '.khhbbbkbbkbddk.',
      '.khbbbbkbbkdddk.',
      '.kbbbbbbkkddddk.',
      '.kbbbbbbbdddddk.',
      '..kbbbbbdddddk..',
      '..kkbbddddddkk..',
      '....kkkkkkkk....',
      '................',
      '................',
    ],
    { k: 0x062a26, d: 0x0c5a50, b: 0x16907e, h: 0x3cc4ac, w: 0xb8f4e4 },
  ),
);
def(
  'saddle',
  spr(
    [
      '................',
      '................',
      '................',
      '....kkkkkkkk....',
      '..kkhhhhhhbbkk..',
      '.khhhbbbbbbbbdk.',
      '.khbbbbbbbbbbdk.',
      '.kbbbbbbbbbbddk.',
      '.kkbbddddddbbkk.',
      '.ks.kkkkkkkk.sk.',
      '.ks..........sk.',
      '.ks..........sk.',
      'kggk........kggk',
      'kg.k........k.gk',
      '.kk..........kk.',
      '................',
    ],
    { k: 0x3a1c0c, d: 0x7a3c1a, b: 0xa85a2a, h: 0xd0864c, s: 0x5a3a22, g: 0xb8b8bc },
  ),
);
def(
  'lead',
  spr(
    [
      '................',
      '..........kkk...',
      '.........kbbbk..',
      '........kbk.kbk.',
      '........kbk.kbk.',
      '.........kbbbk..',
      '........kbdkk...',
      '.......kbdk.....',
      '......kbdk......',
      '.....kbdk.......',
      '....kbdk........',
      '..kkbdk.........',
      '.khbbk..........',
      '.kbbdk..........',
      '..kkk...........',
      '................',
    ],
    { k: 0x3a2a14, d: 0x7c5c30, b: 0xb08a4c, h: 0xd8b878 },
  ),
);
def(
  'name_tag',
  spr(
    [
      '................',
      '............kk..',
      '...........kssk.',
      '..........ks..k.',
      '.....kkkkkkk....',
      '....khhhhhsbk...',
      '...khhhhhhkbbk..',
      '..khhkkhhhhbbk..',
      '..khhhhkkhbbbk..',
      '..khkkhhhbbbdk..',
      '..khhhkkbbbbdk..',
      '...kbbbbbbbdk...',
      '....kbbbbddk....',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x4a3c20, d: 0xb89c64, b: 0xd8c08c, h: 0xf0e0b8, s: 0x8a8a8e },
  ),
);
def(
  'splash_potion',
  spr(
    [
      '................',
      '......kkkk......',
      '......kcck......',
      '.......kk.......',
      '......kggk......',
      '......kggk......',
      '.....kgwggk.....',
      '....kgwppppk....',
      '...kgwpppppdk...',
      '...kgppppppdk...',
      '...kpppppppdk...',
      '...kppppppddk...',
      '....kppppddk....',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x2a2a34, c: 0x8a6a3c, g: 0xc8dce4, w: 0xffffff, p: 0x8a3cc8, d: 0x5a2290 },
  ),
);

// --- L'End : poudre de blaze, œil de l'Ender ---
def(
  'blaze_powder',
  spr(
    [
      '................',
      '................',
      '................',
      '.........k......',
      '......k.kok.....',
      '.....kok.kyk....',
      '....kyyokkoyk...',
      '...kyoyyyoyyk...',
      '...koyyoyyyok...',
      '..kyyoyyyoyyyk..',
      '..koyyyoyyyoyk..',
      '...kkoyyyoykk...',
      '.....kkkkkk.....',
      '................',
      '................',
      '................',
    ],
    { k: 0x8a4a08, y: 0xffe04a, o: 0xf09a18 },
  ),
);
def(
  'ender_eye',
  spr(
    [
      '................',
      '................',
      '.....kkkkkk.....',
      '...kkhhhhbbkk...',
      '..khhwwhbbbbdk..',
      '..khwhbbppbbdk..',
      '.khhhbbpkkpbddk.',
      '.khhbbbpkkpbddk.',
      '.khbbbbpkkpdddk.',
      '.kbbbbbpkkpdddk.',
      '.kbbbbbbppddddk.',
      '..kbbbbbdddddk..',
      '..kkbbddddddkk..',
      '....kkkkkkkk....',
      '................',
      '................',
    ],
    { k: 0x0c3a1e, d: 0x2a7a3c, b: 0x4aa858, h: 0x86d88a, w: 0xe0ffd8, p: 0x1c5a46 },
  ),
);
def(
  'shield',
  spr(
    [
      '..kkkkkkkkkkkk..',
      '.kiiiiiiiiiiiik.',
      '.kiwwwppppwwwik.',
      '.kiwwppppppwwik.',
      '.kiwppddddppwik.',
      '.kipppddddpppik.',
      '.kipppbbbbpppik.',
      '.kipppbbbbpppik.',
      '.kipppddddpppik.',
      '..kippddddppik..',
      '..kippppppppik..',
      '...kippddppik...',
      '....kippppki....',
      '.....kippki.....',
      '......kiik......',
      '.......kk.......',
    ],
    { k: 0x2a1c0e, i: 0x9aa2aa, w: 0xd8dee4, p: 0xb08048, b: 0x8d6334, d: 0x684722 },
  ),
);
def(
  'glass_bottle',
  spr(
    [
      '................',
      '......kkkk......',
      '.....kcccck.....',
      '......kcck......',
      '......kcck......',
      '.....kcwwck.....',
      '....kccwwcck....',
      '...kccwwwwcck...',
      '...kccwwwwcck...',
      '...kccwwwwcck...',
      '...kccwwwwcck...',
      '...kccwwwwcck...',
      '....kcccccck....',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x4b6a7a, c: 0xbfe6f5, w: 0xeaf8ff },
  ),
);
def(
  'potion',
  spr(
    [
      '................',
      '......kkkk......',
      '.....kbbbbk.....',
      '......kcck......',
      '......kcck......',
      '.....kcwwck.....',
      '....kccwwcck....',
      '...kclllllcck...',
      '...kllwwwlllck..',
      '...kllllllllck..',
      '...kllllllllck..',
      '...klddddddlck..',
      '....kddddddk....',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x3b4d5e, b: 0x8b5a2b, c: 0xbfe6f5, w: 0xeaf8ff, l: 0x4f90f0, d: 0x2d62c4 },
  ),
);
def(
  'cake_item',
  spr(
    [
      '................',
      '................',
      '................',
      '.....kkkkkk.....',
      '...kkwwwwwwkk...',
      '..kwwrwwwwrwwk..',
      '.kwwwwwwwwwwwwk.',
      '.kwwwwwrwwwwwwk.',
      '.kwwcwwwwwcwwwk.',
      '.kccckccckcccck.',
      '.kcccccccccccck.',
      '.kccddddddddcck.',
      '..kkddddddddkk..',
      '....kkkkkkkk....',
      '................',
      '................',
    ],
    { k: 0x4a2810, w: 0xf7f2ea, r: 0xd92b2b, c: 0xc98340, d: 0x9c5e28 },
  ),
);
def(
  'golden_carrot',
  spr(
    [
      '................',
      '..........G.gG..',
      '.........gGgGLg.',
      '........gGLGLGg.',
      '.......kkkGLGg..',
      '......kwwykGg...',
      '.....kwwyyykk...',
      '.....kwyyoyyk...',
      '....kwyyyyoyk...',
      '....kwyoyoyk....',
      '...kwyyyyok.....',
      '...kwyyyok......',
      '..kwyoyok.......',
      '..kyyokk........',
      '.kyokk..........',
      '.kkk............',
    ],
    { k: 0x7a4a06, o: 0xc87e0c, y: 0xf7c224, w: 0xfff08a, g: 0x266a16, G: 0x46aa2c, L: 0x8ae056 },
  ),
);
def(
  'glistering_melon',
  spr(
    [
      '................',
      '................',
      '.........kkkk...',
      '.......kkrrrrk..',
      '......krrrwwrrk.',
      '.....krrwryyrrk.',
      '....krrryyrrrrk.',
      '...krrryrrwrrgk.',
      '..krrwrrrrrggyk.',
      '..krrrrrrggykk..',
      '..krrrrggyykk...',
      '...krrggyykk....',
      '....kggyyk......',
      '.....kkkk.......',
      '................',
      '................',
    ],
    { k: 0x3a4a08, r: 0xe03a34, w: 0xfff08a, y: 0xf7c224, g: 0x4a9a2a },
  ),
);
def(
  'ghast_tear',
  spr(
    [
      '................',
      '................',
      '.......kk.......',
      '......kwwk......',
      '.....kwwwwk.....',
      '.....kwbbwk.....',
      '....kwwbbwwk....',
      '....kwbbbbwk....',
      '...kwwbbbbwwk...',
      '...kwbbbbbbwk...',
      '...kwbbbbbbwk...',
      '....kwbbbbwk....',
      '....kddddddk....',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
    { k: 0x62788a, w: 0xffffff, b: 0xc8e8f8, d: 0x90b6cc },
  ),
);
def(
  'brewing_stand_item',
  spr(
    [
      '................',
      '.......yy.......',
      '......kyyk......',
      '.......yy.......',
      '....kk.yy.kk....',
      '...kcckyykcck...',
      '...kcckyykcck...',
      '....kk.yy.kk....',
      '.......yy.......',
      '.......yy.......',
      '......kyyk......',
      '.....kssssk.....',
      '....kssssssk....',
      '...kssssssssk...',
      '...kkkkkkkkkk...',
      '................',
    ],
    { k: 0x2a2a2e, y: 0xf2b422, c: 0xbfe6f5, s: 0x7a7c82 },
  ),
);
