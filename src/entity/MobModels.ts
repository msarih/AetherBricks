/**
 * Modèles en boîtes façon Minecraft et peaux pixel-art peintes procéduralement pour les créatures.
 * Données pures : ni DOM ni three.js, le moteur construit lui-même la géométrie à partir d'ici.
 *
 * Espace du modèle : unités en pixels (1 px = 1/16 de bloc), origine au centre des pieds, +y vers le haut,
 * la créature REGARDE vers +z ; +x est donc sa GAUCHE et −x sa droite.
 *
 * Dépliage d'une boîte de taille [w, h, d] d'origine (u, v) — disposition standard de Minecraft :
 *   dessus  (+y) : (u + d,         v)      w × d      dessous (−y) : (u + d + w,     v)      w × d
 *   côté −x      : (u,             v + d)  d × h      avant   (+z) : (u + d,         v + d)  w × h
 *   côté +x      : (u + d + w,     v + d)  d × h      arrière (−z) : (u + d + w + d, v + d)  w × h
 *
 * Orientation des texels dans chaque rectangle (la bande latérale s'enroule en continu autour de la boîte) :
 *   avant   : u croissant = de −x vers +x ; v croissant = vers le bas (−y)
 *   côté +x : u croissant = de +z (avant) vers −z (arrière) ; v vers le bas
 *   arrière : u croissant = de +x vers −x ; v vers le bas
 *   côté −x : u croissant = de −z (arrière) vers +z (avant) ; v vers le bas
 *   dessus  : u croissant = de −x vers +x ; v croissant = de −z (arrière) vers +z (avant)
 *   dessous : comme le dessus (vu « à travers » la boîte depuis le haut)
 * Autrement dit chaque face latérale se lit telle qu'un observateur placé devant elle la voit.
 *
 * `inflate` dilate la boîte de n pixels dans chaque direction sans changer son dépliage.
 * Les pixels d'alpha 0 doivent être écartés au rendu (alpha test) : les pattes du poulet en dépendent.
 */
import { mulberry32 } from '../world/gen/Noise';

export type MobKind =
  | 'pig'
  | 'cow'
  | 'sheep'
  | 'chicken'
  | 'wolf'
  | 'zombie'
  | 'skeleton'
  | 'creeper'
  | 'spider'
  | 'zombie_pigman'
  | 'ghast'
  | 'magma_cube'
  | 'villager'
  | 'player';

export interface ModelBox {
  /** Partie animée à laquelle appartient la boîte (toutes les boîtes d'une partie tournent autour du même pivot). */
  part: string;
  /** Pivot de la partie, en pixels, dans l'espace du modèle. */
  pivot: [number, number, number];
  /** Coin minimal de la boîte (pixels, espace du modèle) et taille [largeur x, hauteur y, profondeur z]. */
  from: [number, number, number];
  size: [number, number, number];
  /** Origine (u, v) du dépliage dans la texture (pixels, v vers le bas). */
  uv: [number, number];
  /** Gonflement en pixels (ex. laine du mouton), 0 par défaut. */
  inflate?: number;
}

export interface MobModel {
  kind: MobKind;
  texW: number;
  texH: number;
  /** Texture RGBA (texW × texH × 4), lignes du haut vers le bas. */
  texture: Uint8ClampedArray;
  boxes: ModelBox[];
  /** Boîte de collision (blocs) et hauteur des yeux. */
  width: number;
  height: number;
  eyeHeight: number;
}

// ---------------------------------------------------------------------------------------------
// Outils de peinture
// ---------------------------------------------------------------------------------------------

type Vec3 = [number, number, number];
type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';
type Palette = Record<string, number>;

/** Rectangle de texture ; `tone` est l'ombrage cuit de la face qu'il représente. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: number;
}

const FACES: Face[] = ['top', 'bottom', 'right', 'front', 'left', 'back'];
/** Les quatre faces latérales, dans l'ordre de la bande du dépliage. */
const AROUND: Face[] = ['right', 'front', 'left', 'back'];
/** Ombrage discret cuit dans la peau : le dessous et le dos sont un peu plus sombres. */
const TONE: Record<Face, number> = { top: 1.04, bottom: 0.82, right: 0.95, front: 1, left: 0.95, back: 0.92 };
/** Amplitude par défaut de la variation de teinte pixel par pixel. */
const GRAIN = 0.07;

/** Rectangle de texture d'une face de la boîte (voir l'en-tête pour l'orientation des texels). */
function faceRect(b: ModelBox, face: Face): Rect {
  const [w, h, d] = b.size;
  const [u, v] = b.uv;
  const tone = TONE[face];
  switch (face) {
    case 'top':
      return { x: u + d, y: v, w, h: d, tone };
    case 'bottom':
      return { x: u + d + w, y: v, w, h: d, tone };
    case 'right':
      return { x: u, y: v + d, w: d, h, tone };
    case 'front':
      return { x: u + d, y: v + d, w, h, tone };
    case 'left':
      return { x: u + d + w, y: v + d, w: d, h, tone };
    default:
      return { x: u + d + w + d, y: v + d, w, h, tone };
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Multiplie la luminosité d'une couleur 0xRRGGBB. */
function shade(rgb: number, f: number): number {
  return (clamp255(((rgb >> 16) & 255) * f) << 16) | (clamp255(((rgb >> 8) & 255) * f) << 8) | clamp255((rgb & 255) * f);
}

/** Mélange linéaire de deux couleurs (t = 0 → a, t = 1 → b). */
function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => clamp255(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Produit de deux couleurs canal par canal (teinture). */
function multiply(a: number, b: number): number {
  const ch = (s: number) => clamp255((((a >> s) & 255) * ((b >> s) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Miroir horizontal d'un motif (pour la face +x à partir de la face −x). */
function flip(rows: string[]): string[] {
  return rows.map((r) => r.split('').reverse().join(''));
}

function box(part: string, pivot: Vec3, from: Vec3, size: Vec3, uv: [number, number], inflate?: number): ModelBox {
  return inflate ? { part, pivot, from, size, uv, inflate } : { part, pivot, from, size, uv };
}

/** Feuille de peau : tampon RGBA transparent et pinceaux à grain déterministe. */
class Skin {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
  readonly rng: () => number;

  constructor(w: number, h: number, seed: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.rng = mulberry32(seed);
  }

  /** Pose un pixel (coordonnées absolues), avec une variation de teinte aléatoire d'amplitude `grain`. */
  px(x: number, y: number, rgb: number, grain = 0, alpha = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const c = grain > 0 ? shade(rgb, 1 + (this.rng() * 2 - 1) * grain) : rgb;
    const i = (y * this.w + x) * 4;
    this.data[i] = (c >> 16) & 255;
    this.data[i + 1] = (c >> 8) & 255;
    this.data[i + 2] = c & 255;
    this.data[i + 3] = alpha;
  }

  /** Remplit une zone d'un rectangle (coordonnées relatives à r, rognées à r). */
  fill(r: Rect, rgb: number, grain = GRAIN, x = 0, y = 0, w = r.w, h = r.h, alpha = 255): void {
    const c = shade(rgb, r.tone ?? 1);
    const x1 = Math.min(r.w, x + w);
    const y1 = Math.min(r.h, y + h);
    for (let j = Math.max(0, y); j < y1; j++) {
      for (let i = Math.max(0, x); i < x1; i++) this.px(r.x + i, r.y + j, c, grain, alpha);
    }
  }

  /** Dessine un motif ligne par ligne ; chaque caractère renvoie à la palette, '.' laisse le pixel intact. */
  stamp(r: Rect, rows: string[], pal: Palette, ox = 0, oy = 0, grain = GRAIN / 2): void {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[i]];
        if (c === undefined) continue;
        const x = ox + i;
        const y = oy + j;
        if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
        this.px(r.x + x, r.y + y, shade(c, r.tone ?? 1), grain);
      }
    }
  }

  /** Tache elliptique aux bords irréguliers, rognée au rectangle. */
  blob(r: Rect, cx: number, cy: number, rx: number, ry: number, rgb: number, grain = GRAIN): void {
    const c = shade(rgb, r.tone ?? 1);
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        const dx = (i + 0.5 - cx) / rx;
        const dy = (j + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 0.85 + this.rng() * 0.35) this.px(r.x + i, r.y + j, c, grain);
      }
    }
  }

  /** Peint les six faces d'une boîte d'une couleur de base (ombrage par face + grain). */
  box(b: ModelBox, rgb: number, grain = GRAIN): void {
    for (const f of FACES) this.fill(faceRect(b, f), rgb, grain);
  }

  /** Bande horizontale tout autour d'une boîte (mêmes lignes sur les quatre faces latérales). */
  band(b: ModelBox, y: number, h: number, rgb: number, grain = GRAIN): void {
    for (const f of AROUND) {
      const r = faceRect(b, f);
      this.fill(r, rgb, grain, 0, y, r.w, h);
    }
  }

  /** Mouchetis : chaque pixel tire sa couleur dans une liste pondérée [couleur, poids]. */
  mottle(r: Rect, colors: Array<[number, number]>, grain = 0.04): void {
    let total = 0;
    for (const c of colors) total += c[1];
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        let t = this.rng() * total;
        let pick = colors[0][0];
        for (const c of colors) {
          if (t < c[1]) {
            pick = c[0];
            break;
          }
          t -= c[1];
        }
        this.px(r.x + i, r.y + j, shade(pick, r.tone ?? 1), grain);
      }
    }
  }
}

function finish(kind: MobKind, s: Skin, boxes: ModelBox[], width: number, height: number, eyeHeight: number): MobModel {
  return { kind, texW: s.w, texH: s.h, texture: s.data, boxes, width, height, eyeHeight };
}

const BLACK = 0x0c0c0c;
const WHITE = 0xffffff;

// ---------------------------------------------------------------------------------------------
// Bipèdes : joueur, zombie, squelette (texture 64×32, disposition classique)
// ---------------------------------------------------------------------------------------------

interface Biped {
  head: ModelBox;
  body: ModelBox;
  armR: ModelBox;
  armL: ModelBox;
  legR: ModelBox;
  legL: ModelBox;
  all: ModelBox[];
}

/** Squelette commun des bipèdes ; `limb` = épaisseur des bras et des jambes (4 = Steve, 2 = squelette). */
function bipedBoxes(limb: number): Biped {
  const half = limb / 2;
  const head = box('head', [0, 24, 0], [-4, 24, -4], [8, 8, 8], [0, 0]);
  const body = box('body', [0, 12, 0], [-4, 12, -2], [8, 12, 4], [16, 16]);
  // Bras collés au torse, jambes centrées sur les hanches (∓2) ; droite et gauche partagent la même peau.
  const armR = box('armR', [-5, 22, 0], [-4 - limb, 12, -half], [limb, 12, limb], [40, 16]);
  const armL = box('armL', [5, 22, 0], [4, 12, -half], [limb, 12, limb], [40, 16]);
  const legR = box('legR', [-2, 12, 0], [-2 - half, 0, -half], [limb, 12, limb], [0, 16]);
  const legL = box('legL', [2, 12, 0], [2 - half, 0, -half], [limb, 12, limb], [0, 16]);
  return { head, body, armR, armL, legR, legL, all: [head, body, armR, armL, legR, legL] };
}

interface Outfit {
  skin: number;
  shirt: number;
  shirtDark: number;
  trousers: number;
  shoes: number;
}

/** Torse en chemise, manches courtes, pantalon et chaussures (joueur et zombie). */
function paintOutfit(s: Skin, m: Biped, o: Outfit, ragged: boolean): void {
  // Torse
  s.box(m.body, o.shirt);
  s.fill(faceRect(m.body, 'bottom'), o.trousers);
  s.band(m.body, 11, 1, o.shirtDark);
  const chest = faceRect(m.body, 'front');
  const pal: Palette = { S: o.skin, d: o.shirtDark, t: o.trousers };
  // Encolure : un peu de peau en haut de la poitrine.
  s.stamp(chest, ragged ? ['...SS...'] : ['..SSSS..', '...SS...'], pal);
  if (ragged) {
    // Chemise en lambeaux : accrocs sombres et ourlet déchiré laissant voir le pantalon.
    s.stamp(chest, ['.d......', '......d.', '........', '..d.....', '.....dd.', 't.dt..t.'], pal, 0, 6);
    s.stamp(faceRect(m.body, 'back'), ['....d...', '.d......', '......d.', '.t..dt.t'], pal, 0, 8);
  }
  // Bras : manche sur le tiers supérieur, peau ensuite.
  s.box(m.armR, o.skin);
  s.fill(faceRect(m.armR, 'top'), o.shirt);
  s.band(m.armR, 0, 4, o.shirt);
  s.band(m.armR, 3, 1, o.shirtDark);
  s.band(m.armR, 11, 1, shade(o.skin, 0.9));
  if (ragged) s.stamp(faceRect(m.armR, 'front'), ['S.S.'], pal, 0, 3);
  // Jambes : pantalon puis chaussures.
  s.box(m.legR, o.trousers);
  s.band(m.legR, 10, 2, o.shoes);
  s.fill(faceRect(m.legR, 'bottom'), shade(o.shoes, 0.85));
  if (ragged) s.stamp(faceRect(m.legR, 'front'), ['.d..', '....', '...d', '....', 'd...'], { d: shade(o.trousers, 0.75) }, 0, 2);
}

function buildPlayer(): MobModel {
  const m = bipedBoxes(4);
  const s = new Skin(64, 32, 0x57e7e);
  const skin = 0xb98a6b;
  const hair = 0x3b2815;
  const pal: Palette = { H: hair, S: skin, W: WHITE, E: 0x4b3f96, N: 0x8f5d49, M: 0x74463a, B: 0x4a2c17 };
  // Tête : cheveux bruns sur le dessus, l'arrière et le haut des côtés.
  s.box(m.head, skin);
  s.fill(faceRect(m.head, 'top'), hair);
  s.fill(faceRect(m.head, 'bottom'), shade(skin, 0.95));
  s.stamp(faceRect(m.head, 'front'), [
    'HHHHHHHH',
    'HHHHHHHH',
    'HSSSSSSH',
    'SSSSSSSS',
    'SWESSEWS',
    'SSSNNSSS',
    'SSBMMBSS',
    'SSBBBBSS',
  ], pal);
  // Côté droit : u va de l'arrière vers l'avant, les cheveux descendent sur la nuque.
  const side = [
    'HHHHHHHH',
    'HHHHHHHH',
    'HHHHHHHH',
    'HHHHHSSS',
    'HHHHSSSS',
    'HHHSSSSS',
    'HHSSSSSS',
    'HHSSSSSS',
  ];
  s.stamp(faceRect(m.head, 'right'), side, pal);
  s.stamp(faceRect(m.head, 'left'), flip(side), pal);
  s.stamp(faceRect(m.head, 'back'), [
    'HHHHHHHH',
    'HHHHHHHH',
    'HHHHHHHH',
    'HHHHHHHH',
    'HHHHHHHH',
    'HHHHHHHH',
    'HHHHHHHH',
    'HHSSSSHH',
  ], pal);
  paintOutfit(s, m, { skin, shirt: 0x12a7a7, shirtDark: 0x0c8585, trousers: 0x3c3ca2, shoes: 0x6c6c6c }, false);
  return finish('player', s, m.all, 0.6, 1.8, 1.62);
}

function buildZombie(): MobModel {
  const m = bipedBoxes(4);
  const s = new Skin(64, 32, 0x20b1e);
  const skin = 0x4f8a3c;
  const dark = 0x38682c;
  const pal: Palette = { Z: skin, z: dark, K: BLACK, m: 0x2a4f22 };
  s.box(m.head, skin);
  s.fill(faceRect(m.head, 'top'), dark);
  s.band(m.head, 0, 1, dark);
  s.stamp(faceRect(m.head, 'front'), [
    'zzzzzzzz',
    'zZZZZZZz',
    'ZZZZZZZZ',
    'ZZZZZZZZ',
    'ZKKZZKKZ',
    'ZZZzzZZZ',
    'ZZmmmmZZ',
    'ZZZZZZZZ',
  ], pal);
  // Quelques marbrures de chair plus sombre sur les côtés et l'arrière du crâne.
  const marks = ['........', '........', '.z......', '....zz..', '........', '..z.....', '.....z..', '........'];
  s.stamp(faceRect(m.head, 'right'), marks, pal);
  s.stamp(faceRect(m.head, 'left'), flip(marks), pal);
  s.stamp(faceRect(m.head, 'back'), marks, pal);
  paintOutfit(s, m, { skin, shirt: 0x10a3a6, shirtDark: 0x0b7d80, trousers: 0x4a3ca8, shoes: 0x5a5a62 }, true);
  return finish('zombie', s, m.all, 0.6, 1.8, 1.62);
}

function buildZombiePigman(): MobModel {
  const m = bipedBoxes(4);
  const s = new Skin(64, 32, 0x7193a);
  const pink = 0xe8a09c;
  const darkPink = 0xc87470;
  const rot = 0x568236;
  const rotDark = 0x385824;
  const bone = 0xd8d0c0;
  const loin = 0x6b472d;
  const loinDark = 0x482f1d;
  const pal: Palette = { P: pink, p: darkPink, G: rot, g: rotDark, B: bone, K: BLACK, W: WHITE, E: 0x241818 };
  s.box(m.head, pink);
  s.fill(faceRect(m.head, 'top'), rot);
  s.band(m.head, 0, 2, rot);
  s.stamp(faceRect(m.head, 'front'), [
    'GGGGGGPP',
    'GGGgPPPP',
    'GGGGPPPP',
    'GWEPKEWP',
    'PPppPPPP',
    'PPpKKpPP',
    'PPPppPPP',
    'PPgPPgPP',
  ], pal);
  const side = ['GGGGGGGG', '..GGg...', '...BB...', '........', '..G.....', '....gg..', '........', '........'];
  s.stamp(faceRect(m.head, 'right'), side, pal);
  s.stamp(faceRect(m.head, 'left'), flip(side), pal);
  s.stamp(faceRect(m.head, 'back'), side, pal);

  // Torse : chair rose, lambeaux verts de zombie et pagne brun
  s.box(m.body, pink);
  s.stamp(faceRect(m.body, 'front'), [
    '..GG..PP',
    '.gGGg.BB',
    '..GG..BB',
    '..g.....',
    '....PP..',
    '........',
  ], pal, 0, 0);
  s.band(m.body, 8, 4, loin);
  s.band(m.body, 8, 1, loinDark);
  // Bras & jambes
  s.box(m.armR, pink);
  s.fill(faceRect(m.armR, 'top'), rot);
  s.band(m.armR, 0, 4, rot);
  s.band(m.armR, 4, 1, rotDark);
  s.box(m.legR, pink);
  s.band(m.legR, 0, 3, loin);
  s.band(m.legR, 8, 4, rot);
  return finish('zombie_pigman', s, m.all, 0.6, 1.8, 1.62);
}

function buildGhast(): MobModel {
  const boxes: ModelBox[] = [];
  const body: ModelBox = {
    part: 'body',
    pivot: [0, 32, 0],
    from: [-32, 6, -32],
    size: [64, 58, 64],
    uv: [0, 0],
  };
  boxes.push(body);
  // 9 tentacules suspendus sous le corps
  const tentCoords: Array<[number, number, number]> = [
    [-20, -10, -18], [0, -12, -18], [20, -9, -18],
    [-20, -11, 0],   [0, -13, 0],   [20, -10, 0],
    [-20, -9, 18],   [0, -11, 18],  [20, -12, 18],
  ];
  for (let i = 0; i < tentCoords.length; i++) {
    const [tx, ty, tz] = tentCoords[i];
    boxes.push({
      part: `tent${i}`,
      pivot: [tx, 6, tz],
      from: [tx - 2, ty, tz - 2],
      size: [4, 6 - ty, 4],
      uv: [0, 124],
    });
  }

  const s = new Skin(256, 160, 0x94a57);
  const bodyColor = 0xf4f4f4;
  const shadeGray = 0xd2d2d2;
  const darkGray = 0x505050;
  const tear = 0x9aa2b0;
  const mouth = 0x3a1414;
  s.box(body, bodyColor, 0.02);
  s.fill(faceRect(body, 'bottom'), shadeGray, 0.02);
  // Visage (64x58) : grands yeux fermés/plissés et bouche ouverte
  const front = faceRect(body, 'front');
  s.fill(front, darkGray, 0.01, 12, 18, 12, 4);
  s.fill(front, darkGray, 0.01, 40, 18, 12, 4);
  s.fill(front, tear, 0.01, 14, 22, 4, 8);
  s.fill(front, tear, 0.01, 46, 22, 4, 8);
  s.fill(front, mouth, 0.01, 24, 34, 16, 12);
  s.fill(front, 0x8a1c1c, 0.01, 27, 37, 10, 6);
  for (let i = 1; i <= 9; i++) s.box(boxes[i], 0xe6e6e6, 0.02);
  return finish('ghast', s, boxes, 4.0, 4.0, 2.2);
}

function buildMagmaCube(): MobModel {
  const body: ModelBox = {
    part: 'body',
    pivot: [0, 8, 0],
    from: [-8, 0, -8],
    size: [16, 16, 16],
    uv: [0, 0],
  };
  const s = new Skin(64, 32, 0x4a19e);
  const base = 0x2e0908;
  const pal: Palette = {
    D: base,
    R: 0x6b1408,
    O: 0xc8400c,
    Y: 0xffb824,
    W: 0xfff08a,
  };
  s.box(body, base, 0.03);
  const cracks = [
    'DDDDDDDDDDDDDDDD',
    'DRRDDDDDDDDDRRDD',
    'DDDDDDDDDDDDDDDD',
    'DDORRRRRRRRRRODD',
    'DDDDDDDDDDDDDDDD',
    'DRRDDDDDDRRRDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDOORRRRRROODDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDRRRRDDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DORRRRRRRRRRRROD',
    'DDDDDDDDDDDDDDDD',
    'DDDRRDDDDDDRRDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDDDDDDDDDDDDD',
  ];
  for (const f of AROUND) s.stamp(faceRect(body, f), cracks, pal);
  // Yeux jaunes/orangés brillants sur la face avant
  s.stamp(faceRect(body, 'front'), [
    '................',
    '................',
    '................',
    '................',
    '..OYYO....OYYO..',
    '..OWYO....OYWO..',
    '..OYYO....OYYO..',
    '................',
  ], pal);
  return finish('magma_cube', s, [body], 0.52, 0.52, 0.3);
}

/** Couleur de la robe et du tablier par métier (fermier, bibliothécaire, prêtre, forgeron, boucher). */
const VILLAGER_ROBES: ReadonlyArray<{ robe: number; trim: number; apron: number }> = [
  { robe: 0x6b4a2c, trim: 0x4c3520, apron: 0 },
  { robe: 0xe4e2dc, trim: 0xb9b4a8, apron: 0 },
  { robe: 0x7a3f9e, trim: 0x54296f, apron: 0 },
  { robe: 0x5a4a3c, trim: 0x3a2f26, apron: 0x2b2b2e },
  { robe: 0x6b4a2c, trim: 0x4c3520, apron: 0xe8e6e0 },
];

/**
 * Villageois : grande tête au long nez, robe jusqu'aux pieds, bras croisés devant la poitrine.
 * `variant` = métier (0..4) : il change la couleur de la robe.
 */
function buildVillager(variant: number): MobModel {
  const head = box('head', [0, 24, 0], [-4, 24, -4], [8, 10, 8], [0, 0]);
  const nose = box('head', [0, 24, 0], [-1, 23, 4], [2, 4, 2], [24, 0]);
  const body = box('body', [0, 12, 0], [-4, 12, -3], [8, 12, 6], [16, 20]);
  const skirt = box('body', [0, 12, 0], [-4, 2, -3], [8, 10, 6], [0, 38], 0.45);
  const armR = box('arms', [0, 21, 0], [-8, 16, -2], [4, 8, 4], [44, 22]);
  const armL = box('arms', [0, 21, 0], [4, 16, -2], [4, 8, 4], [44, 22]);
  const armMid = box('arms', [0, 21, 0], [-4, 16, -2], [8, 4, 4], [40, 38]);
  const legR = box('legR', [-2, 12, 0], [-4, 0, -2], [4, 12, 4], [0, 22]);
  const legL = box('legL', [2, 12, 0], [0, 0, -2], [4, 12, 4], [0, 22]);
  const s = new Skin(64, 64, 0x51a6e + variant);
  const skin = 0xbd8b72;
  const skinDark = 0x9c6c56;
  const c = VILLAGER_ROBES[variant] ?? VILLAGER_ROBES[0];
  const pal: Palette = { S: skin, s: skinDark, B: 0x4a2f1f, W: WHITE, G: 0x2f7d3a, M: 0x7a4a3c };
  s.box(head, skin);
  s.stamp(faceRect(head, 'front'), [
    'SSSSSSSS',
    'SSSSSSSS',
    'SSSSSSSS',
    'BBBBBBBB',
    'SWGSSGWS',
    'SSSssSSS',
    'SSSssSSS',
    'SSSssSSS',
    'SSMMMMSS',
    'SSSSSSSS',
  ], pal);
  s.box(nose, skinDark);
  s.box(body, c.robe);
  s.band(body, 0, 1, c.trim);
  s.box(skirt, c.robe);
  s.band(skirt, 9, 1, c.trim);
  if (c.apron) {
    s.fill(faceRect(body, 'front'), c.apron, GRAIN, 1, 2, 6, 10);
    s.fill(faceRect(skirt, 'front'), c.apron, GRAIN, 1, 0, 6, 7);
  }
  s.box(armR, c.robe);
  s.box(armMid, c.robe);
  s.fill(faceRect(armMid, 'front'), skin, GRAIN, 2, 1, 4, 2);
  s.box(legR, c.trim);
  s.band(legR, 9, 3, 0x3a3a3e);
  return finish('villager', s, [head, nose, body, skirt, armR, armL, armMid, legR, legL], 0.6, 1.95, 1.62);
}

const villagerCache = new Map<number, MobModel>();

/** Modèle du villageois pour un métier donné (0..4). */
export function getVillagerModel(variant: number): MobModel {
  const v = variant >= 0 && variant < VILLAGER_ROBES.length ? Math.floor(variant) : 0;
  let model = villagerCache.get(v);
  if (!model) {
    model = buildVillager(v);
    villagerCache.set(v, model);
  }
  return model;
}

function buildSkeleton(): MobModel {
  const m = bipedBoxes(2);
  const s = new Skin(64, 32, 0x5ce1e);
  const bone = 0xc8c8c8;
  const pal: Palette = { B: bone, b: 0x9c9c9c, d: 0x3a3a3a, K: 0x141414, n: 0x787878, m: 0x4c4c4c };
  s.box(m.head, bone);
  s.stamp(faceRect(m.head, 'front'), [
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    'BbBBBBbB',
    'BKKBBKKB',
    'BBBnnBBB',
    'BmmmmmmB',
    'BBbBBbBB',
  ], pal);
  const temple = ['........', '........', '....bb..', '...bbbb.', '....bb..', '........', '.....bb.', '........'];
  s.stamp(faceRect(m.head, 'right'), temple, pal);
  s.stamp(faceRect(m.head, 'left'), flip(temple), pal);
  // Cage thoracique : côtes claires séparées par des vides sombres, colonne au centre, bassin en bas.
  s.box(m.body, bone);
  const ribs = [
    'BBBBBBBB',
    'dddBBddd',
    'BBBBBBBB',
    'dddBBddd',
    'BBBBBBBB',
    'dddBBddd',
    'BBBBBBBB',
    'dddBBddd',
    'dddBBddd',
    'dddBBddd',
    'dBBBBBBd',
    'BBBBBBBB',
  ];
  s.stamp(faceRect(m.body, 'front'), ribs, pal);
  s.stamp(faceRect(m.body, 'back'), ribs, pal);
  const flank = ['BBBB', 'dddd', 'BBBB', 'dddd', 'BBBB', 'dddd', 'BBBB', 'dddd', 'dddd', 'dddd', 'BBBB', 'BBBB'];
  s.stamp(faceRect(m.body, 'right'), flank, pal);
  s.stamp(faceRect(m.body, 'left'), flank, pal);
  // Os longs : articulation plus sombre au coude / genou, extrémité légèrement grisée.
  for (const limb of [m.armR, m.legR]) {
    s.box(limb, bone);
    s.band(limb, 5, 1, 0x8c8c8c);
    s.band(limb, 11, 1, 0xa8a8a8);
  }
  return finish('skeleton', s, m.all, 0.6, 1.9, 1.7);
}

// ---------------------------------------------------------------------------------------------
// Creeper (64×32)
// ---------------------------------------------------------------------------------------------

function buildCreeper(): MobModel {
  const head = box('head', [0, 18, 0], [-4, 18, -4], [8, 8, 8], [0, 0]);
  const body = box('body', [0, 6, 0], [-4, 6, -2], [8, 12, 4], [16, 16]);
  // Les quatre pattes partagent la même zone de peau.
  const leg0 = box('leg0', [-2, 6, 4], [-4, 0, 2], [4, 6, 4], [0, 16]);
  const leg1 = box('leg1', [2, 6, 4], [0, 0, 2], [4, 6, 4], [0, 16]);
  const leg2 = box('leg2', [-2, 6, -4], [-4, 0, -6], [4, 6, 4], [0, 16]);
  const leg3 = box('leg3', [2, 6, -4], [0, 0, -6], [4, 6, 4], [0, 16]);
  const s = new Skin(64, 32, 0xc4ee9e4);
  // Camouflage moucheté : verts moyens dominants, éclats clairs et taches sombres.
  const greens: Array<[number, number]> = [
    [0x56b547, 38],
    [0x6ccb58, 22],
    [0x3e9a3b, 18],
    [0xa9e39a, 8],
    [0x2c7a31, 8],
    [0xd6f2cd, 2],
  ];
  for (const b of [head, body, leg0]) {
    for (const f of FACES) s.mottle(faceRect(b, f), greens);
  }
  // Le visage emblématique : deux yeux carrés et la bouche renfrognée.
  s.stamp(faceRect(head, 'front'), [
    '........',
    '........',
    '.KK..KK.',
    '.KK..KK.',
    '...KK...',
    '..KKKK..',
    '..KKKK..',
    '..K..K..',
  ], { K: 0x0e0e0e }, 0, 0, 0);
  // Griffes sombres au bas des pattes.
  s.stamp(faceRect(leg0, 'front'), ['K.K.', 'KgKg'], { K: 0x1a2a1a, g: 0x2c7a31 }, 0, 4);
  s.fill(faceRect(leg0, 'bottom'), 0x2c5a2c);
  return finish('creeper', s, [head, body, leg0, leg1, leg2, leg3], 0.6, 1.7, 1.4);
}

// ---------------------------------------------------------------------------------------------
// Cochon (64×64)
// ---------------------------------------------------------------------------------------------

function buildPig(): MobModel {
  const headPivot: Vec3 = [0, 12, 6];
  const head = box('head', headPivot, [-4, 8, 6], [8, 8, 8], [0, 0]);
  const snout = box('head', headPivot, [-2, 9, 14], [4, 3, 1], [32, 0]);
  const body = box('body', [0, 10, 0], [-5, 6, -8], [10, 8, 16], [0, 16]);
  const leg0 = box('leg0', [-3, 6, 5], [-5, 0, 3], [4, 6, 4], [0, 40]);
  const leg1 = box('leg1', [3, 6, 5], [1, 0, 3], [4, 6, 4], [0, 40]);
  const leg2 = box('leg2', [-3, 6, -7], [-5, 0, -9], [4, 6, 4], [0, 40]);
  const leg3 = box('leg3', [3, 6, -7], [1, 0, -9], [4, 6, 4], [0, 40]);
  const s = new Skin(64, 64, 0x919);
  const pink = 0xf0a5a2;
  const dark = 0xd98a8a;
  const pal: Palette = { P: pink, p: dark, K: BLACK, W: WHITE, L: 0xf8bdb8, n: 0x8f4f52 };
  s.box(head, pink);
  s.stamp(faceRect(head, 'front'), [
    'PPPPPPPP',
    'PPPPPPPP',
    'PPPPPPPP',
    'KWPPPPWK',
    'PPPPPPPP',
    'PPppppPP',
    'PPppppPP',
    'PPPppPPP',
  ], pal);
  // Groin : plus clair, deux narines sombres.
  s.box(snout, 0xf2aeaa);
  s.stamp(faceRect(snout, 'front'), ['LLLL', 'nLLn', 'LLLL'], pal);
  // Corps rose avec quelques plaques plus soutenues.
  s.box(body, pink);
  const flankR = faceRect(body, 'right');
  const flankL = faceRect(body, 'left');
  const back = faceRect(body, 'top');
  s.blob(flankR, 4, 5, 3, 2, dark);
  s.blob(flankR, 11, 2.5, 2.5, 1.5, dark);
  s.blob(flankL, 6, 2.5, 3, 1.6, dark);
  s.blob(flankL, 12.5, 5.5, 2.5, 1.8, dark);
  s.blob(back, 3, 4, 2, 2.5, dark);
  s.blob(back, 7, 11, 2.2, 2, dark);
  // Pattes : sabot foncé sur la dernière rangée.
  s.box(leg0, pink);
  s.band(leg0, 5, 1, 0xb9706f);
  s.fill(faceRect(leg0, 'bottom'), 0xb9706f);
  return finish('pig', s, [head, snout, body, leg0, leg1, leg2, leg3], 0.9, 0.9, 0.6);
}

// ---------------------------------------------------------------------------------------------
// Vache (64×64)
// ---------------------------------------------------------------------------------------------

function buildCow(): MobModel {
  const headPivot: Vec3 = [0, 20, 8];
  const bodyPivot: Vec3 = [0, 17, 0];
  const head = box('head', headPivot, [-4, 16, 8], [8, 8, 6], [0, 0]);
  const hornR = box('head', headPivot, [-5, 22, 11], [1, 3, 1], [28, 0]);
  const hornL = box('head', headPivot, [4, 22, 11], [1, 3, 1], [32, 0]);
  const body = box('body', bodyPivot, [-6, 12, -10], [12, 10, 18], [0, 14]);
  const udder = box('body', bodyPivot, [-2, 11, -8], [4, 1, 6], [16, 42]);
  const leg0 = box('leg0', [-4, 12, 6], [-6, 0, 4], [4, 12, 4], [0, 42]);
  const leg1 = box('leg1', [4, 12, 6], [2, 0, 4], [4, 12, 4], [0, 42]);
  const leg2 = box('leg2', [-4, 12, -7], [-6, 0, -9], [4, 12, 4], [0, 42]);
  const leg3 = box('leg3', [4, 12, -7], [2, 0, -9], [4, 12, 4], [0, 42]);
  const s = new Skin(64, 64, 0xc0ffee);
  const brown = 0x47382a;
  const white = 0xeeeeea;
  const pal: Palette = { b: brown, w: white, K: BLACK, E: WHITE, m: 0xe7aaa4, n: 0x7c4a48, h: 0x2a2622 };
  // Tête brune, liste blanche sur le chanfrein, mufle rose.
  s.box(head, brown);
  s.stamp(faceRect(head, 'front'), [
    'bbbwwbbb',
    'bbbwwbbb',
    'bbbwwbbb',
    'KEbwwbEK',
    'bbbwwbbb',
    'bmmmmmmb',
    'bmnmmnmb',
    'bmmmmmmb',
  ], pal);
  s.stamp(faceRect(head, 'top'), ['...ww...', '...ww...', '...ww...'], pal, 0, 3);
  // Le mufle déborde d'un pixel sur les côtés (u : arrière → avant à droite, avant → arrière à gauche).
  s.stamp(faceRect(head, 'right'), ['m', 'm', 'm'], pal, 5, 5);
  s.stamp(faceRect(head, 'left'), ['m', 'm', 'm'], pal, 0, 5);
  // Cornes ivoire à pointe claire.
  for (const horn of [hornR, hornL]) {
    s.box(horn, 0xd6d0bf, 0.04);
    s.band(horn, 0, 1, 0xf4f1e6, 0.02);
    s.fill(faceRect(horn, 'top'), 0xf4f1e6, 0.02);
  }
  // Robe pie : grandes taches blanches sur fond brun.
  s.box(body, brown);
  const flankR = faceRect(body, 'right');
  const flankL = faceRect(body, 'left');
  const back = faceRect(body, 'top');
  s.blob(flankR, 5, 3.5, 4.2, 3.2, white);
  s.blob(flankR, 13.5, 7.5, 3.2, 2.6, white);
  s.blob(flankL, 11.5, 5, 4.8, 3.4, white);
  s.blob(flankL, 3, 2, 2.4, 1.8, white);
  s.blob(back, 2.5, 5, 3, 4.2, white);
  s.blob(back, 9.5, 12, 3, 3.6, white);
  s.blob(faceRect(body, 'back'), 6, 6, 3.6, 3.4, white);
  s.blob(faceRect(body, 'bottom'), 6, 9, 3.6, 7, white);
  // Pis rose.
  s.box(udder, 0xeaa6a6);
  s.stamp(faceRect(udder, 'bottom'), ['.n..', '..n.', '....', '.n..', '..n.'], { n: 0xc77f80 });
  // Pattes : balzane blanche au-dessus d'un sabot sombre.
  s.box(leg0, brown);
  s.band(leg0, 8, 2, white);
  s.band(leg0, 10, 2, pal.h);
  s.fill(faceRect(leg0, 'bottom'), pal.h);
  return finish('cow', s, [head, hornR, hornL, body, udder, leg0, leg1, leg2, leg3], 0.9, 1.4, 1.2);
}

// ---------------------------------------------------------------------------------------------
// Mouton (64×64) : corps tondu + couche de laine gonflée, teinte recalculée à la demande
// ---------------------------------------------------------------------------------------------

function buildSheep(woolColor: number, sheared: boolean): MobModel {
  const headPivot: Vec3 = [0, 18, 8];
  const bodyPivot: Vec3 = [0, 15, 0];
  const legs: Array<[string, Vec3, Vec3]> = [
    ['leg0', [-3, 12, 5], [-5, 0, 3]],
    ['leg1', [3, 12, 5], [1, 0, 3]],
    ['leg2', [-3, 12, -7], [-5, 0, -9]],
    ['leg3', [3, 12, -7], [1, 0, -9]],
  ];
  const head = box('head', headPivot, [-3, 16, 6], [6, 6, 8], [0, 0]);
  const body = box('body', bodyPivot, [-4, 12, -10], [8, 6, 16], [0, 14]);
  const legBoxes = legs.map(([part, pivot, from]) => box(part, pivot, from, [4, 12, 4], [48, 14]));
  // Couche de laine : mêmes parties, boîtes gonflées, zone de texture séparée.
  const woolHead = box('head', headPivot, [-3, 16, 6], [6, 6, 6], [28, 0], 0.6);
  const woolBody = box('body', bodyPivot, [-4, 12, -10], [8, 6, 16], [0, 36], 1.75);
  const woolLegs = legs.map(([part, pivot, from]) => box(part, pivot, [from[0], 6, from[2]], [4, 6, 4], [48, 36], 0.5));

  const s = new Skin(64, 64, 0x5eeb);
  const face = 0xdcb69a;
  const tintColor = woolColor & 0xffffff;
  // Toison rase laissée par la tonte : blanc cassé à peine teinté par la couleur de la laine.
  const stubble = mix(0xf0e6de, multiply(0xf0e6de, tintColor), 0.25);
  const pal: Palette = { s: face, K: BLACK, W: WHITE, p: 0xe79c9c, f: 0xc59b80 };

  // Tête : museau couleur chair sur les 2 px avant, toison rase derrière.
  s.box(head, stubble);
  s.stamp(faceRect(head, 'front'), ['ssssss', 'ssssss', 'KWssWK', 'ssssss', 'spppps', 'ssppss'], pal);
  const top = faceRect(head, 'top');
  const under = faceRect(head, 'bottom');
  const sideR = faceRect(head, 'right');
  const sideL = faceRect(head, 'left');
  s.fill(top, face, GRAIN, 0, 6, 6, 2);
  s.fill(under, face, GRAIN, 0, 6, 6, 2);
  s.fill(sideR, face, GRAIN, 6, 0, 2, 6);
  s.fill(sideL, face, GRAIN, 0, 0, 2, 6);
  // Corps tondu : peau claire rosée, touffes de la couleur de la laine.
  s.box(body, mix(0xecd9d0, stubble, 0.5));
  for (const f of ['right', 'left', 'top', 'back'] as Face[]) {
    const r = faceRect(body, f);
    for (let n = 0; n < 5; n++) s.blob(r, s.rng() * r.w, s.rng() * r.h, 1.6, 1.2, stubble);
  }
  // Pattes : haut laineux, bas couleur chair, sabot brun.
  s.box(legBoxes[0], stubble);
  s.band(legBoxes[0], 6, 5, face);
  s.band(legBoxes[0], 11, 1, 0x6b5648);
  s.fill(faceRect(legBoxes[0], 'bottom'), 0x6b5648);

  const boxes: ModelBox[] = [head, body, ...legBoxes];
  if (!sheared) {
    // Laine : boucles claires et creux plus sombres, le tout multiplié par la teinte demandée.
    for (const b of [woolHead, woolBody, woolLegs[0]]) {
      for (const f of FACES) {
        const r = faceRect(b, f);
        for (let j = 0; j < r.h; j++) {
          for (let i = 0; i < r.w; i++) {
            const roll = s.rng();
            const v = roll < 0.14 ? 0.76 : roll < 0.3 ? 0.98 : 0.86 + s.rng() * 0.08;
            s.px(r.x + i, r.y + j, shade(multiply(WHITE, tintColor), v * (r.tone ?? 1)));
          }
        }
      }
    }
    boxes.push(woolHead, woolBody, ...woolLegs);
  }
  return finish('sheep', s, boxes, 0.9, 1.3, 1.1);
}

// ---------------------------------------------------------------------------------------------
// Poulet (64×32)
// ---------------------------------------------------------------------------------------------

function buildChicken(): MobModel {
  const headPivot: Vec3 = [0, 9, 4];
  const head = box('head', headPivot, [-2, 9, 3], [4, 6, 3], [0, 0]);
  const beak = box('head', headPivot, [-2, 11, 6], [4, 2, 2], [14, 0]);
  const wattle = box('head', headPivot, [-1, 9, 5], [2, 2, 2], [14, 4]);
  const body = box('body', [0, 8, 0], [-3, 5, -4], [6, 6, 8], [0, 9]);
  const legR = box('legR', [-1.5, 5, 0.5], [-3, 0, -1], [3, 5, 3], [26, 0]);
  const legL = box('legL', [1.5, 5, 0.5], [0, 0, -1], [3, 5, 3], [26, 0]);
  const wingR = box('wingR', [-3, 11, 0], [-4, 7, -3], [1, 4, 6], [28, 9]);
  const wingL = box('wingL', [3, 11, 0], [3, 7, -3], [1, 4, 6], [28, 9]);
  const s = new Skin(64, 32, 0xc1c);
  const white = 0xf4f4f4;
  const grey = 0xd2d2d2;
  const pal: Palette = { W: white, g: grey, K: BLACK, Y: 0xe6b422, y: 0xc48f18, R: 0xd92a2a, r: 0xa81c1c };
  // Tête blanche ; les yeux noirs chevauchent l'arête entre la face et les côtés.
  s.box(head, white, 0.04);
  s.stamp(faceRect(head, 'front'), ['....', 'K..K'], pal);
  s.stamp(faceRect(head, 'right'), ['...', '..K'], pal);
  s.stamp(faceRect(head, 'left'), ['...', 'K..'], pal);
  // Bec jaune (dessous plus foncé) et barbillon rouge.
  s.box(beak, pal.Y, 0.04);
  s.band(beak, 1, 1, pal.y, 0.04);
  s.fill(faceRect(beak, 'bottom'), pal.y, 0.04);
  s.box(wattle, pal.R, 0.05);
  s.band(wattle, 1, 1, pal.r, 0.05);
  // Corps : plumage blanc, quelques plumes grisées vers la queue.
  s.box(body, white, 0.04);
  s.stamp(faceRect(body, 'right'), ['........', '........', 'g.......', '.g......', 'g.g.....', '.g.g....'], pal);
  s.stamp(faceRect(body, 'left'), flip(['........', '........', 'g.......', '.g......', 'g.g.....', '.g.g....']), pal);
  s.stamp(faceRect(body, 'back'), ['......', '.g..g.', '......', 'g.gg.g', '......', '.g..g.'], pal);
  s.stamp(faceRect(body, 'top'), ['g.gg.g', '.g..g.'], pal);
  // Ailes : rémiges soulignées de gris.
  s.box(wingR, 0xececec, 0.04);
  for (const f of ['right', 'left'] as Face[]) {
    s.stamp(faceRect(wingR, f), ['......', '......', 'g.g.g.', 'gggggg'], pal);
  }
  // Pattes : boîte 3×5×3 presque entièrement transparente — une tige fine et un pied large.
  for (const f of FACES) s.fill(faceRect(legR, f), pal.Y, 0, 0, 0, 3, 5, 0);
  for (const f of AROUND) {
    const r = faceRect(legR, f);
    s.fill(r, pal.Y, 0.04, 1, 0, 1, 4);
    s.fill(r, pal.y, 0.04, 0, 4, 3, 1);
  }
  s.fill(faceRect(legR, 'bottom'), pal.y, 0.04);
  return finish('chicken', s, [head, beak, wattle, body, legR, legL, wingR, wingL], 0.4, 0.7, 0.6);
}

// ---------------------------------------------------------------------------------------------
// Araignée (64×32, disposition classique : les boîtes s'emboîtent dans les coins vides des dépliages)
// ---------------------------------------------------------------------------------------------

function buildSpider(): MobModel {
  const bodyPivot: Vec3 = [0, 9, 0];
  const head = box('head', [0, 9, 3], [-4, 5, 3], [8, 8, 8], [32, 4]);
  const neck = box('body', bodyPivot, [-3, 6, -3], [6, 6, 6], [0, 0]);
  const abdomen = box('body', bodyPivot, [-5, 5, -15], [10, 8, 12], [0, 12]);
  // Quatre paires de pattes, de l'avant (leg0/leg1) vers l'arrière (leg6/leg7) ; pair = droite (−x).
  const legs: ModelBox[] = [];
  const legZ = [4, 1, -2, -5];
  for (let pair = 0; pair < 4; pair++) {
    const z = legZ[pair];
    legs.push(box(`leg${pair * 2}`, [-4, 9, z], [-20, 8, z - 1], [16, 2, 2], [18, 0]));
    legs.push(box(`leg${pair * 2 + 1}`, [4, 9, z], [4, 8, z - 1], [16, 2, 2], [18, 0]));
  }
  const s = new Skin(64, 32, 0x5b1de4);
  const dark = 0x3a332d;
  const pal: Palette = { d: dark, l: 0x574b40, k: 0x1f1b18, R: 0xd41414, r: 0x8e1010, h: 0xff6a5a };
  s.box(head, dark, 0.1);
  // Huit yeux rouges (deux grands, six petits) et crochets sombres.
  s.stamp(faceRect(head, 'front'), [
    '........',
    '..r..r..',
    '........',
    'rhR..hRr',
    '.RR..RR.',
    '........',
    '..k..k..',
    '..k..k..',
  ], pal, 0, 0, 0.02);
  s.stamp(faceRect(head, 'right'), ['.......r'], pal, 0, 2, 0.02);
  s.stamp(faceRect(head, 'left'), ['r.......'], pal, 0, 2, 0.02);
  s.box(neck, 0x2f2924, 0.1);
  // Abdomen : chevrons plus clairs sur le dos, flancs marbrés.
  s.box(abdomen, dark, 0.1);
  s.stamp(faceRect(abdomen, 'top'), [
    '..........',
    '....ll....',
    '...l..l...',
    '..l....l..',
    '....ll....',
    '...l..l...',
    '..l....l..',
    '....ll....',
    '...l..l...',
    '..l....l..',
    '..........',
    '..........',
  ], pal);
  const flank = ['............', '..l.....l...', '.....l......', '.l......l...', '....l.......', '.......l..l.'];
  s.stamp(faceRect(abdomen, 'right'), flank, pal, 0, 1);
  s.stamp(faceRect(abdomen, 'left'), flip(flank), pal, 0, 1);
  // Pattes : segments sombres, articulations plus claires.
  s.box(legs[0], 0x2c2622, 0.1);
  for (const f of ['top', 'bottom', 'front', 'back'] as Face[]) {
    const r = faceRect(legs[0], f);
    s.fill(r, pal.l, 0.08, 5, 0, 1, 2);
    s.fill(r, pal.l, 0.08, 10, 0, 1, 2);
  }
  return finish('spider', s, [head, neck, abdomen, ...legs], 1.4, 0.9, 0.65);
}

// ---------------------------------------------------------------------------------------------
// Accès publics (construction paresseuse + cache)
// ---------------------------------------------------------------------------------------------

/** Laine blanche par défaut du mouton. */
const DEFAULT_WOOL = 0xffffff;

const modelCache = new Map<MobKind, MobModel>();
const sheepCache = new Map<string, MobModel>();
const wolfCache = new Map<string, MobModel>();

// ---------------------------------------------------------------------------------------------
// Loup (64×64) : sauvage, en colère ou apprivoisé (collier coloré)
// ---------------------------------------------------------------------------------------------

function buildWolf(tamed: boolean, angry: boolean, collarColor: number): MobModel {
  const headPivot: Vec3 = [0, 10, 7];
  const bodyPivot: Vec3 = [0, 10, 0];
  const head = box('head', headPivot, [-3, 7, 5], [6, 6, 4], [0, 0]);
  const snout = box('head', headPivot, [-1.5, 7, 9], [3, 3, 4], [20, 0]);
  const earR = box('head', headPivot, [-3, 13, 6], [2, 2, 1], [34, 0]);
  const earL = box('head', headPivot, [1, 13, 6], [2, 2, 1], [34, 0]);
  const mane = box('body', bodyPivot, [-4, 6.5, 0], [8, 7, 6], [0, 10]);
  const body = box('body', bodyPivot, [-3, 7, -7], [6, 6, 9], [0, 23]);
  const tail = box('tail', [0, 11, -7], [-1, 5, -9], [2, 8, 2], [30, 23]);
  const leg0 = box('leg0', [-1.5, 8, 4], [-2.5, 0, 3], [2, 8, 2], [0, 38]);
  const leg1 = box('leg1', [1.5, 8, 4], [0.5, 0, 3], [2, 8, 2], [0, 38]);
  const leg2 = box('leg2', [-1.5, 8, -5], [-2.5, 0, -6], [2, 8, 2], [0, 38]);
  const leg3 = box('leg3', [1.5, 8, -5], [0.5, 0, -6], [2, 8, 2], [0, 38]);

  const s = new Skin(64, 64, 0x701f);
  const fur = angry ? 0xa3a3a3 : tamed ? 0xd2d2d2 : 0xc0c0c0;
  const dark = angry ? 0x6c6c6c : 0x868686;
  const light = 0xeaeaea;
  const pal: Palette = {
    F: fur,
    d: dark,
    L: light,
    W: WHITE,
    K: BLACK,
    R: 0xb81d1d,
    n: 0x222222,
  };
  s.box(head, fur);
  s.fill(faceRect(head, 'top'), dark);
  s.stamp(faceRect(head, 'front'), angry ? [
    'ddFFdd',
    'dFFFFd',
    'FWKKWF',
    'FRKKRF',
    'FFFFFF',
    'FLLLLF',
  ] : tamed ? [
    'FFFFFF',
    'FFFFFF',
    'FWKKWF',
    'FFFFFF',
    'FFFFFF',
    'FLLLLF',
  ] : [
    'ddFFdd',
    'FFFFFF',
    'FWKKWF',
    'FFFFFF',
    'FFFFFF',
    'FLLLLF',
  ], pal);

  s.box(snout, light);
  s.fill(faceRect(snout, 'top'), fur);
  s.stamp(faceRect(snout, 'front'), ['nnn', 'LnL', 'LLL'], pal);
  s.box(earR, fur);
  s.fill(faceRect(earR, 'front'), dark);
  s.box(mane, fur);
  s.fill(faceRect(mane, 'top'), dark);
  if (tamed) {
    // Collier coloré sur le haut du cou (devant de la crinière)
    s.band(mane, 0, 2, collarColor & 0xffffff);
  }
  s.box(body, fur);
  s.fill(faceRect(body, 'top'), dark);
  s.fill(faceRect(body, 'bottom'), light);
  s.box(tail, fur);
  s.band(tail, 6, 2, light);
  s.box(leg0, fur);
  s.band(leg0, 6, 2, light);
  s.fill(faceRect(leg0, 'bottom'), dark);

  return finish('wolf', s, [head, snout, earR, earL, mane, body, tail, leg0, leg1, leg2, leg3], 0.6, 0.85, 0.68);
}

/** Variante du loup (apprivoisé, en colère, couleur du collier). */
export function getWolfModel(tamed: boolean, angry: boolean, collarColor = 0xd8342a): MobModel {
  const key = `${tamed ? 1 : 0}:${angry ? 1 : 0}:${collarColor & 0xffffff}`;
  let model = wolfCache.get(key);
  if (!model) {
    model = buildWolf(tamed, angry, collarColor);
    wolfCache.set(key, model);
  }
  return model;
}

/** Modèle d'une créature, construit au premier appel puis mis en cache (ne pas modifier l'objet renvoyé). */
export function getMobModel(kind: MobKind): MobModel {
  let model = modelCache.get(kind);
  if (!model) {
    switch (kind) {
      case 'pig':
        model = buildPig();
        break;
      case 'cow':
        model = buildCow();
        break;
      case 'sheep':
        model = getSheepModel(DEFAULT_WOOL, false);
        break;
      case 'chicken':
        model = buildChicken();
        break;
      case 'wolf':
        model = getWolfModel(false, false);
        break;
      case 'zombie':
        model = buildZombie();
        break;
      case 'skeleton':
        model = buildSkeleton();
        break;
      case 'creeper':
        model = buildCreeper();
        break;
      case 'spider':
        model = buildSpider();
        break;
      case 'zombie_pigman':
        model = buildZombiePigman();
        break;
      case 'ghast':
        model = buildGhast();
        break;
      case 'magma_cube':
        model = buildMagmaCube();
        break;
      case 'villager':
        model = buildVillager(0);
        break;
      default:
        model = buildPlayer();
        break;
    }
    modelCache.set(kind, model);
  }
  return model;
}

/** Variante tondue du mouton (sans la couche de laine) et couleur de laine : texture recalculée. */
export function getSheepModel(woolColor: number /* 0xRRGGBB */, sheared: boolean): MobModel {
  const key = `${woolColor & 0xffffff}:${sheared ? 1 : 0}`;
  let model = sheepCache.get(key);
  if (!model) {
    model = buildSheep(woolColor, sheared);
    sheepCache.set(key, model);
  }
  return model;
}
