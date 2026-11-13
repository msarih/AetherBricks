/**
 * Système de particules façon Minecraft.
 *
 * - Simulation au pas de l'image (dt en secondes) ; les constantes viennent du jeu d'origine
 *   (exprimées par tick à 20 Hz) et sont converties en blocs/s et blocs/s².
 * - Rendu : deux maillages instanciés (un quad face caméra par particule, orienté dans le
 *   vertex shader) : une passe « découpe » (test alpha, écrit la profondeur) pour les éclats
 *   et les sprites nets, une passe « mélange » (alpha, sans écriture de profondeur) pour la
 *   fumée et les explosions.
 * - Budget : 4096 particules dans un anneau (les plus anciennes sont recyclées), aucun objet
 *   alloué par image, envoi au GPU limité aux instances vivantes.
 */
import * as THREE from 'three';
import type { Atlas } from './Atlas';
import { lightColor, worldUniforms } from './ChunkMaterials';
import { T, TILE_NAMES, TILE_SIZE } from '../world/Tiles';

export interface ParticleWorld {
  /** Vrai si le bloc (coordonnées entières) arrête les particules. */
  isSolid(x: number, y: number, z: number): boolean;
  /** Lumière en (x, y, z) entiers : (ciel << 4) | bloc, chacun 0..15. */
  lightAt(x: number, y: number, z: number): number;
  /** Vrai si le bloc contient de l'eau (les bulles n'existent que dans l'eau, les autres particules y ralentissent). */
  isWater(x: number, y: number, z: number): boolean;
}

export type ParticleKind =
  | 'smoke' // fumée grise qui monte (torche, fourneau, feu éteint)
  | 'large_smoke' // grosse fumée (explosion, lave/eau)
  | 'flame' // petite flamme (torche, fourneau)
  | 'lava' // goutte de lave qui saute
  | 'splash' // gouttes d'eau projetées
  | 'bubble' // bulle qui monte dans l'eau
  | 'explosion' // nuage blanc/gris qui grossit puis disparaît
  | 'crit' // étoile de coup critique
  | 'heart' // cœur (reproduction des animaux)
  | 'note' // note de musique colorée
  | 'snow' // poussière de neige (boule de neige)
  | 'slime' // éclat vert
  | 'portal' // particule violette qui converge vers le point d'émission (spawner)
  | 'rain' // éclat de goutte de pluie au sol
  | 'drip_water'
  | 'drip_lava'
  | 'egg' // éclats d'œuf (icône de l'objet)
  | 'bonemeal'; // étincelles vertes de poudre d'os

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

/** Nombre maximal de particules simultanées (puissance de deux : l'anneau se parcourt par masque). */
const MAX = 4096;
const MASK = MAX - 1;
/** Ticks de jeu par seconde : sert à convertir les constantes d'origine. */
const TICKS = 20;
/** Pas de simulation maximal (onglet en arrière-plan, à-coup) en secondes. */
const MAX_DT = 0.1;
/** Demi-largeur de collision d'une particule, en blocs. */
const RADIUS = 0.08;
const EPS = 2e-4;
/** Les éclats de bloc sont assombris comme dans le jeu d'origine (les éclats d'objet ne le sont pas). */
const BLOCK_FRAGMENT_SHADE = 0.6;
/** Durée de vie maximale d'un éclat, en secondes. */
const FRAGMENT_MAX_LIFE = 1.2;
/** Flottants par instance : (x, y, z, taille) (u0, v0, du, dv) (r, v, b, a) (ciel, bloc, émissif, couche). */
const STRIDE = 16;
/** Émissions différées (fumée de la lave, éclaboussure des gouttes) traitées après la boucle. */
const QUEUE = 64;

const K_TILE = 0;
const K_SMOKE = 1;
const K_LARGE_SMOKE = 2;
const K_FLAME = 3;
const K_LAVA = 4;
const K_SPLASH = 5;
const K_BUBBLE = 6;
const K_EXPLOSION = 7;
const K_CRIT = 8;
const K_HEART = 9;
const K_NOTE = 10;
const K_SNOW = 11;
const K_SLIME = 12;
const K_PORTAL = 13;
const K_RAIN = 14;
const K_DRIP_WATER = 15;
const K_DRIP_LAVA = 16;
const K_BONEMEAL = 17;
const KIND_COUNT = 18;

const KIND_ID: Record<ParticleKind, number> = {
  smoke: K_SMOKE,
  large_smoke: K_LARGE_SMOKE,
  flame: K_FLAME,
  lava: K_LAVA,
  splash: K_SPLASH,
  bubble: K_BUBBLE,
  explosion: K_EXPLOSION,
  crit: K_CRIT,
  heart: K_HEART,
  note: K_NOTE,
  snow: K_SNOW,
  slime: K_SLIME,
  portal: K_PORTAL,
  rain: K_RAIN,
  drip_water: K_DRIP_WATER,
  drip_lava: K_DRIP_LAVA,
  egg: K_TILE,
  bonemeal: K_BONEMEAL,
};

/** Gravité par type en blocs/tick² (valeurs du jeu d'origine ; négatif = monte). Convertie plus bas. */
//                         éclat  fumée   grosse  flamme lave  éclab. bulle   explo. crit  cœur note neige slime portail pluie goutte goutte poudre
const GRAVITY_TICK = [0.04, -0.004, -0.004, 0, 0.03, 0.04, -0.004, 0, 0.02, 0, 0, 0.04, 0.04, 0, 0.06, 0.06, 0.06, 0];
/** Frottement de l'air par tick. */
const DRAG = [0.98, 0.96, 0.96, 0.96, 0.999, 0.98, 0.85, 0.9, 0.7, 0.86, 0.66, 0.98, 0.98, 1, 0.98, 0.98, 0.98, 0.99];
/** 1 si le type bute contre les blocs solides. */
const COLLIDE = [1, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0];
/** 1 si le type ignore l'éclairage du monde (pleine luminosité). */
const EMISSIVE = [0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
/** 1 si le type est rendu en mélange alpha (sinon test alpha). */
const BLEND = [0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const GRAVITY = GRAVITY_TICK.map((g) => g * TICKS * TICKS);

const ENV_SOLID = 1;
const ENV_WATER = 2;

const DRIP_HANGING = 0;
const DRIP_FALLING = 1;
const DRIP_LANDED = 2;

// --- Couches de la texture des sprites (16×16 ; les petits sprites occupent le quart haut-gauche 8×8) ---
const SPRITE_SIZE = 16;
const SPR_PUFF = 0; // 8 étapes, de la plus petite (0) à la plus grosse (7)
const SPR_FLAME = 8;
const SPR_LAVA = 9;
const SPR_SPLASH = 10; // 3 variantes
const SPR_BUBBLE = 13;
const SPR_CRIT = 14;
const SPR_HEART = 15;
const SPR_NOTE = 16;
const SPR_SNOW = 17; // 2 variantes
const SPR_DRIP = 19; // suspendue, en chute, écrasée
const SPR_GLINT = 22;
const SPR_EXPLOSION = 23; // 8 images 16×16
const SPRITE_LAYERS = 31;
const EXPLOSION_FRAMES = 8;

/** Opacité de base de la fumée et des explosions. */
const SMOKE_ALPHA = 0.8;
const EXPLOSION_ALPHA = 0.92;

/** Tuiles d'objets (icônes) : leurs éclats gardent leur pleine luminosité. */
const ITEM_FIRST = T.stick;
const IS_ITEM_TILE = (() => {
  const out = new Uint8Array(TILE_NAMES.length);
  for (let i = ITEM_FIRST; i < TILE_NAMES.length; i++) out[i] = TILE_NAMES[i].startsWith('wool_') ? 0 : 1;
  return out;
})();

// Constantes d'éclairage déduites de la formule du terrain (ChunkMaterials) pour rester synchronisées.
const LIGHT = (() => {
  const black = new THREE.Color(0, 0, 0);
  const amb = lightColor(0, 0, black, new THREE.Color()).r;
  const full = lightColor(0, 15, black, new THREE.Color());
  const k = 1 - amb;
  return { amb, r: (full.r - amb) / k, g: (full.g - amb) / k, b: (full.b - amb) / k };
})();

// ---------------------------------------------------------------------------------------------
// Sprites pixel-art procéduraux
// ---------------------------------------------------------------------------------------------

/** Petit hachage déterministe → [0, 1). */
function hash3(x: number, y: number, s: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function setPixel(data: Uint8Array, layer: number, x: number, y: number, rgb: number, alpha = 255): void {
  const o = ((layer * SPRITE_SIZE + y) * SPRITE_SIZE + x) * 4;
  data[o] = (rgb >> 16) & 255;
  data[o + 1] = (rgb >> 8) & 255;
  data[o + 2] = rgb & 255;
  data[o + 3] = alpha;
}

/** Peint un sprite 8×8 décrit par des lignes de caractères (« . » = transparent). */
function paintRows(data: Uint8Array, layer: number, rows: readonly string[], palette: Record<string, number>): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c !== '.') setPixel(data, layer, x, y, palette[c]);
    }
  }
}

function gray(v: number): number {
  const c = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  return (c << 16) | (c << 8) | c;
}

/** Les 8 étapes de bouffée (fumée, portail) : disque déchiqueté blanc ombré, de plus en plus gros. */
function paintPuffs(data: Uint8Array): void {
  for (let k = 0; k < 8; k++) {
    const radius = 0.95 + k * 0.42;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const dx = x + 0.5 - 4;
        const dy = y + 0.5 - 4;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d + (hash3(x, y, k + 11) - 0.5) * 0.9 >= radius) continue;
        let v = 255;
        if (hash3(x, y, k + 41) > 0.62) v -= 38;
        if (d > radius - 1.1 && dy > -0.5) v -= 34; // dessous plus sombre
        setPixel(data, SPR_PUFF + k, x, y, gray(v));
      }
    }
  }
}

/** Les 8 images de l'explosion (16×16) : boule blanche qui grossit, se creuse et s'effiloche en gris. */
function paintExplosion(data: Uint8Array): void {
  const radius = [2.6, 4.2, 5.6, 6.6, 7.2, 7.6, 7.9, 8.0];
  const dissolve = [0, 0, 0, 0.06, 0.2, 0.4, 0.6, 0.78];
  const hollow = [0, 0, 0, 0, 0.12, 0.28, 0.42, 0.55];
  const bright = [255, 252, 244, 230, 212, 192, 172, 156];
  for (let f = 0; f < EXPLOSION_FRAMES; f++) {
    const r = radius[f];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x + 0.5 - 8;
        const dy = y + 0.5 - 8;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d + (hash3(x, y, 7) - 0.5) * 1.8 >= r) continue;
        if (d < r * hollow[f]) continue;
        if (hash3(x >> 1, y >> 1, 23) * 0.6 + hash3(x, y, 29) * 0.4 < dissolve[f]) continue;
        const v = bright[f] - (d / r) * 34 - hash3(x, y, 31) * 26;
        setPixel(data, SPR_EXPLOSION + f, x, y, gray(v));
      }
    }
  }
}

function paintSprites(): Uint8Array {
  const data = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE * 4 * SPRITE_LAYERS);
  paintPuffs(data);
  paintExplosion(data);

  paintRows(data, SPR_FLAME, [
    '........',
    '...oo...',
    '..oyyo..',
    '..oyyo..',
    '.oywwyo.',
    '.oywwyo.',
    '.ooyyoo.',
    '..oooo..',
  ], { o: 0xf07818, y: 0xffc83c, w: 0xfff4b4 });

  paintRows(data, SPR_LAVA, [
    '........',
    '..oyo...',
    '.oyyyoo.',
    '.yywyyo.',
    '.oyyyor.',
    '.ooyorr.',
    '..orrr..',
    '........',
  ], { r: 0xc83a0a, o: 0xf5701a, y: 0xffb030, w: 0xffe680 });

  const water = { a: 0x3f76e4, b: 0x86b0ff };
  paintRows(data, SPR_SPLASH, [
    '........',
    '..b.....',
    '..a...b.',
    '......a.',
    '....b...',
    '.b..a...',
    '.a......',
    '........',
  ], water);
  paintRows(data, SPR_SPLASH + 1, [
    '........',
    '....b...',
    '.b..a...',
    '.a....b.',
    '......a.',
    '...b....',
    '...a....',
    '........',
  ], water);
  paintRows(data, SPR_SPLASH + 2, [
    '........',
    '.b...b..',
    '.a...a..',
    '........',
    '...b....',
    '...a..b.',
    '......a.',
    '........',
  ], water);

  paintRows(data, SPR_BUBBLE, [
    '........',
    '..aaaa..',
    '.aw..ba.',
    '.aw...a.',
    '.a....a.',
    '.ab...a.',
    '..aaaa..',
    '........',
  ], { a: 0x6fa0ff, b: 0xa9c8ff, w: 0xe8f2ff });

  paintRows(data, SPR_CRIT, [
    '...w....',
    '...w....',
    '..wWw...',
    'wwWWWww.',
    '..wWw...',
    '...w....',
    '...w....',
    '........',
  ], { w: 0xdcdcdc, W: 0xffffff });

  paintRows(data, SPR_HEART, [
    '........',
    '.rr.rr..',
    'rpRrRRr.',
    'rRRRRRr.',
    '.rRRRr..',
    '..rRr...',
    '...r....',
    '........',
  ], { r: 0xb01818, R: 0xf03030, p: 0xff9a9a });

  paintRows(data, SPR_NOTE, [
    '....WW..',
    '....W.w.',
    '....W...',
    '....W...',
    '..WWW...',
    '.WWWw...',
    '.wWw....',
    '........',
  ], { w: 0xc8c8c8, W: 0xffffff });

  const snow = { w: 0xd4e2f0, W: 0xffffff };
  paintRows(data, SPR_SNOW, [
    '........',
    '........',
    '...Ww...',
    '..WWWw..',
    '..wWWW..',
    '...wW...',
    '........',
    '........',
  ], snow);
  paintRows(data, SPR_SNOW + 1, [
    '........',
    '........',
    '..wW....',
    '..WWWw..',
    '...WWw..',
    '...w....',
    '........',
    '........',
  ], snow);

  const drop = { w: 0xc4c4c4, W: 0xffffff };
  paintRows(data, SPR_DRIP + DRIP_HANGING, [
    '........',
    '........',
    '...Ww...',
    '...WW...',
    '...Ww...',
    '........',
    '........',
    '........',
  ], drop);
  paintRows(data, SPR_DRIP + DRIP_FALLING, [
    '........',
    '...W....',
    '...Ww...',
    '..WWWw..',
    '..WWWw..',
    '...ww...',
    '........',
    '........',
  ], drop);
  paintRows(data, SPR_DRIP + DRIP_LANDED, [
    '........',
    '........',
    '........',
    '........',
    '........',
    '..WWww..',
    '.WWWWww.',
    '........',
  ], drop);

  paintRows(data, SPR_GLINT, [
    '........',
    '...g....',
    '...G....',
    '.gGWGg..',
    '...G....',
    '...g....',
    '........',
    '........',
  ], { g: 0x2e9e2e, G: 0x5fe05f, W: 0xd8ffd0 });

  return data;
}

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------

const VERTEX = /* glsl */ `
attribute vec4 aPos;
attribute vec4 aUv;
attribute vec4 aColor;
attribute vec4 aMisc;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vMisc;
varying float vFogDepth;
void main() {
  // quad face caméra : le coin est ajouté dans l'espace de la vue
  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
  mv.xy += position.xy * aPos.w;
  gl_Position = projectionMatrix * mv;
  vFogDepth = length(mv.xyz);
  // v = 0 en haut de la tuile (flipY désactivé)
  vUv = aUv.xy + vec2(position.x + 0.5, 0.5 - position.y) * aUv.zw;
  vColor = aColor;
  vMisc = aMisc;
}
`;

const FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray atlas;
uniform sampler2DArray sprites;
uniform vec3 uSkyLight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vMisc;
varying float vFogDepth;

float curve(float l) {
  return l / (4.0 - 3.0 * l);
}

void main() {
  // couche >= 0 : tuile de l'atlas ; couche < 0 : sprite de particule (-1 - couche)
  vec4 c;
  if (vMisc.w > -0.5) {
    c = textureLod(atlas, vec3(vUv, floor(vMisc.w + 0.5)), 0.0);
  } else {
    c = textureLod(sprites, vec3(vUv, floor(-vMisc.w - 0.5)), 0.0);
  }
#ifdef ALPHA_TEST
  // vColor.a relève le seuil pour les tuiles entièrement translucides (eau, glace)
  if (c.a * vColor.a < 0.5) discard;
  float alpha = 1.0;
#else
  float alpha = c.a * vColor.a;
  if (alpha < 0.01) discard;
#endif
  vec3 skyL = curve(vMisc.x) * uSkyLight;
  vec3 blkL = curve(vMisc.y) * vec3(${LIGHT.r.toFixed(4)}, ${LIGHT.g.toFixed(4)}, ${LIGHT.b.toFixed(4)});
  vec3 l = max(skyL, blkL) * ${(1 - LIGHT.amb).toFixed(4)} + ${LIGHT.amb.toFixed(4)};
  l = mix(l, vec3(1.0), vMisc.z);
  vec3 col = c.rgb * vColor.rgb * l;
  float fog = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFogColor, fog), alpha);
}
`;

// ---------------------------------------------------------------------------------------------
// Lot d'instances (un maillage)
// ---------------------------------------------------------------------------------------------

class Batch {
  readonly array = new Float32Array(MAX * STRIDE);
  readonly buffer: THREE.InstancedInterleavedBuffer;
  readonly geometry = new THREE.InstancedBufferGeometry();
  readonly mesh: THREE.Mesh;
  /** Nombre d'instances écrites pour l'image courante. */
  count = 0;
  /** Plage d'envoi réutilisée d'une image à l'autre (three vide sa liste après chaque envoi). */
  private readonly range = { start: 0, count: 0 };

  constructor(readonly material: THREE.ShaderMaterial) {
    const g = this.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    this.buffer = new THREE.InstancedInterleavedBuffer(this.array, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    g.setAttribute('aUv', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    g.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    g.setAttribute('aMisc', new THREE.InterleavedBufferAttribute(this.buffer, 4, 12));
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** Publie les instances écrites : seule la partie utilisée du tampon est envoyée au GPU. */
  flush(): void {
    const n = this.count;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    const ranges = this.buffer.updateRanges;
    if (ranges.length === 0) ranges.push(this.range);
    this.range.start = 0;
    this.range.count = n * STRIDE;
    this.buffer.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Système de particules
// ---------------------------------------------------------------------------------------------

export class Particles {
  private readonly sprites: THREE.DataArrayTexture;
  private readonly cutout: Batch;
  private readonly blend: Batch;
  private readonly tileLayers: number;

  // --- État des particules (structure de tableaux) ; vivante si life > 0 ---
  private readonly px = new Float32Array(MAX);
  private readonly py = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  /** Vitesse en blocs/s (pour le portail : décalage de départ). */
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly vz = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly kind = new Uint8Array(MAX);
  /** Couche : tuile de l'atlas pour les éclats, sprite de base pour les autres types. */
  private readonly lay = new Int16Array(MAX);
  /** Origine du sous-rectangle de tuile (éclats). */
  private readonly tu = new Float32Array(MAX);
  private readonly tv = new Float32Array(MAX);
  private readonly cr = new Float32Array(MAX);
  private readonly cg = new Float32Array(MAX);
  private readonly cb = new Float32Array(MAX);
  /** Multiplicateur du seuil alpha (éclats de tuiles translucides). */
  private readonly ca = new Float32Array(MAX);
  /** Données propres au type : cible du portail (ax, ay, az) ; durée de suspension de la goutte (ay). */
  private readonly ax = new Float32Array(MAX);
  private readonly ay = new Float32Array(MAX);
  private readonly az = new Float32Array(MAX);
  /** État propre au type (phase de la goutte). */
  private readonly st = new Uint8Array(MAX);
  /** Cellule courante et ce qu'on y a relevé (lumière, eau, solide). */
  private readonly cx = new Int32Array(MAX);
  private readonly cy = new Int32Array(MAX);
  private readonly cz = new Int32Array(MAX);
  private readonly env = new Uint8Array(MAX);
  private readonly ls = new Uint8Array(MAX);
  private readonly lb = new Uint8Array(MAX);

  /** Prochain emplacement de l'anneau. */
  private cursor = 0;
  /** Borne haute des emplacements éventuellement vivants. */
  private high = 0;
  private frame = 0;

  private readonly dragF = new Float32Array(KIND_COUNT);
  // émissions différées
  private readonly qKind = new Uint8Array(QUEUE);
  private readonly qPos = new Float32Array(QUEUE * 3);
  private qCount = 0;
  // résultats intermédiaires (évite toute allocation)
  private mx = 0;
  private my = 0;
  private mz = 0;
  private pu = 0;
  private pv = 0;
  private pa = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly atlas: Atlas,
    private readonly world: ParticleWorld,
  ) {
    this.tileLayers = Math.floor(atlas.data.length / (TILE_SIZE * TILE_SIZE * 4));

    const tex = new THREE.DataArrayTexture(paintSprites(), SPRITE_SIZE, SPRITE_SIZE, SPRITE_LAYERS);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.sprites = tex;

    this.cutout = new Batch(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms(),
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        defines: { ALPHA_TEST: 1 },
        side: THREE.DoubleSide,
      }),
    );
    this.blend = new Batch(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms(),
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    // la fumée se dessine après les autres translucides (eau) : le maillage est à l'origine du monde
    this.blend.mesh.renderOrder = 1;
    scene.add(this.cutout.mesh, this.blend.mesh);
  }

  /** Uniformes : lumière du ciel et brouillard partagés PAR RÉFÉRENCE avec le terrain. */
  private uniforms(): Record<string, THREE.IUniform> {
    return {
      atlas: { value: this.atlas.texture },
      sprites: { value: this.sprites },
      uSkyLight: worldUniforms.uSkyLight,
      uFogColor: worldUniforms.uFogColor,
      uFogNear: worldUniforms.uFogNear,
      uFogFar: worldUniforms.uFogFar,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Émission
  // -------------------------------------------------------------------------------------------

  /** Éclats d'un bloc cassé : 4×4×4 = 64 fragments répartis dans le volume du bloc (x, y, z entiers), comme Minecraft. `tint` = 0xRRGGBB multiplié à la texture (0xffffff si aucune). */
  blockBreak(x: number, y: number, z: number, tile: number, tint: number): void {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          const fx = (i + 0.5) / 4;
          const fy = (j + 0.5) / 4;
          const fz = (k + 0.5) / 4;
          // vitesse : du centre du bloc vers l'extérieur, plus un petit saut
          this.motion(fx - 0.5, fy - 0.5, fz - 0.5);
          const p = this.fragment(x + fx, y + fy, z + fz, this.mx, this.my, this.mz, tile, tint, BLOCK_FRAGMENT_SHADE, 1);
          // le bloc vient d'être détruit (ou va l'être) : ses éclats ne sont jamais « dans un solide »
          this.env[p] &= ~ENV_SOLID;
        }
      }
    }
  }

  /** Un éclat sur la face frappée pendant le minage (face : 0 haut, 1 bas, 2 nord −z, 3 sud +z, 4 ouest −x, 5 est +x). */
  blockHit(x: number, y: number, z: number, face: number, tile: number, tint: number): void {
    const rnd = Math.random;
    let fx = x + 0.1 + rnd() * 0.8;
    let fy = y + 0.1 + rnd() * 0.8;
    let fz = z + 0.1 + rnd() * 0.8;
    switch (face) {
      case 0: fy = y + 1.1; break;
      case 1: fy = y - 0.1; break;
      case 2: fz = z - 0.1; break;
      case 3: fz = z + 1.1; break;
      case 4: fx = x - 0.1; break;
      default: fx = x + 1.1; break;
    }
    this.motion(0, 0, 0);
    this.fragment(fx, fy, fz, this.mx * 0.2, (this.my - 2) * 0.2 + 2, this.mz * 0.2, tile, tint, BLOCK_FRAGMENT_SHADE, 0.6);
  }

  /** Éclats de bloc/objet émis en un point (pas d'atterrissage, sprint, nourriture mangée, outil cassé) avec une vitesse initiale. */
  tileBurst(x: number, y: number, z: number, tile: number, tint: number, count: number, speed: number): void {
    const rnd = Math.random;
    const shade = IS_ITEM_TILE[tile] === 1 ? 1 : BLOCK_FRAGMENT_SHADE;
    for (let n = 0; n < count; n++) {
      // direction aléatoire, vitesse autour de `speed`, léger saut vers le haut
      const dx = rnd() * 2 - 1;
      const dy = rnd() * 2 - 1;
      const dz = rnd() * 2 - 1;
      const s = (speed * (0.5 + rnd())) / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
      this.fragment(
        x + (rnd() - 0.5) * 0.3, y + rnd() * 0.1, z + (rnd() - 0.5) * 0.3,
        dx * s, dy * s + speed * 0.8, dz * s,
        tile, tint, shade, 1,
      );
    }
  }

  /** Émet `count` particules d'un type autour de (x, y, z), dispersées de ±spread, vitesse initiale (vx, vy, vz) en blocs/s (défaut 0) ajoutée à la vitesse propre du type. */
  spawn(kind: ParticleKind, x: number, y: number, z: number, count = 1, spread = 0, vx = 0, vy = 0, vz = 0): void {
    const k = KIND_ID[kind];
    if (k === undefined) return;
    const rnd = Math.random;
    for (let n = 0; n < count; n++) {
      // le portail interprète la dispersion comme distance de départ autour du point visé
      if (spread > 0 && k !== K_PORTAL) {
        this.spawnOne(k, x + (rnd() * 2 - 1) * spread, y + (rnd() * 2 - 1) * spread, z + (rnd() * 2 - 1) * spread, vx, vy, vz, spread, kind === 'egg');
      } else {
        this.spawnOne(k, x, y, z, vx, vy, vz, spread, kind === 'egg');
      }
    }
  }

  /** Supprime toutes les particules (changement de monde). */
  clear(): void {
    this.life.fill(0);
    this.cursor = 0;
    this.high = 0;
    this.qCount = 0;
    this.cutout.count = 0;
    this.blend.count = 0;
    this.cutout.flush();
    this.blend.flush();
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.cutout.mesh, this.blend.mesh);
    this.cutout.dispose();
    this.blend.dispose();
    this.sprites.dispose();
  }

  /**
   * Vitesse de départ d'une particule du jeu d'origine : direction aléatoire biaisée par
   * (bx, by, bz) (en blocs/tick), norme 0,06 à 0,18 bloc/tick, plus un saut de 0,1 bloc/tick.
   * Résultat dans (mx, my, mz), en blocs/s.
   */
  private motion(bx: number, by: number, bz: number): void {
    const rnd = Math.random;
    const dx = bx + (rnd() * 2 - 1) * 0.4;
    const dy = by + (rnd() * 2 - 1) * 0.4;
    const dz = bz + (rnd() * 2 - 1) * 0.4;
    const f = (rnd() + rnd() + 1) * 0.15 * 0.4;
    const s = (f / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1)) * TICKS;
    this.mx = dx * s;
    this.my = dy * s + 0.1 * TICKS;
    this.mz = dz * s;
  }

  /**
   * Choisit un sous-carré de 4×4 pixels de la tuile (résultat dans pu, pv) en évitant les zones
   * transparentes (icônes d'objets, feuillage, fleurs). pa = multiplicateur du seuil alpha,
   * relevé quand la tuile n'a aucun pixel opaque (eau, glace).
   */
  private pickUv(tile: number): void {
    const data = this.atlas.data;
    const base = tile * TILE_SIZE * TILE_SIZE * 4 + 3;
    const span = TILE_SIZE - 3;
    let best = -1;
    for (let n = 0; n < 6; n++) {
      const ox = (Math.random() * span) | 0;
      const oy = (Math.random() * span) | 0;
      let opaque = 0;
      for (let yy = 0; yy < 4; yy++) {
        const row = base + ((oy + yy) * TILE_SIZE + ox) * 4;
        for (let xx = 0; xx < 4; xx++) if (data[row + xx * 4] >= 128) opaque++;
      }
      if (opaque > best) {
        best = opaque;
        this.pu = ox / TILE_SIZE;
        this.pv = oy / TILE_SIZE;
        if (opaque >= 12) break;
      }
    }
    this.pa = best > 0 ? 1 : 8;
  }

  /** Crée un éclat de tuile ; renvoie son emplacement. */
  private fragment(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    tile: number, tint: number, shade: number, scale: number,
  ): number {
    const rnd = Math.random;
    const t = tile >= 0 && tile < this.tileLayers ? tile | 0 : 0;
    const life = Math.min(FRAGMENT_MAX_LIFE, 0.2 / (rnd() * 0.9 + 0.1));
    const p = this.emit(K_TILE, x, y, z, vx, vy, vz, (0.5 + 0.5 * rnd()) * 0.2 * scale, life);
    this.pickUv(t);
    this.lay[p] = t;
    this.tu[p] = this.pu;
    this.tv[p] = this.pv;
    this.ca[p] = this.pa;
    const k = shade / 255;
    this.cr[p] = ((tint >> 16) & 255) * k;
    this.cg[p] = ((tint >> 8) & 255) * k;
    this.cb[p] = (tint & 255) * k;
    return p;
  }

  /** Crée une particule d'un type spécial (constantes du jeu d'origine, converties en secondes). */
  private spawnOne(k: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, spread: number, egg: boolean): void {
    const rnd = Math.random;
    /** Durée de vie type : 8 à 40 ticks, le plus souvent courte. */
    const span = 0.4 / (rnd() * 0.8 + 0.2);
    const unit = 0.5 + 0.5 * rnd();
    switch (k) {
      case K_TILE: {
        // seul 'egg' arrive ici : éclats de l'icône de l'œuf
        if (!egg) return;
        this.motion(0, 0, 0);
        this.fragment(x, y, z, this.mx + vx, this.my + vy, this.mz + vz, T.egg, 0xffffff, 1, 1);
        break;
      }
      case K_SMOKE:
      case K_LARGE_SMOKE: {
        const big = k === K_LARGE_SMOKE ? 2.5 : 1;
        this.motion(0, 0, 0);
        const p = this.emit(k, x, y, z, this.mx * 0.1 + vx, this.my * 0.1 + vy, this.mz * 0.1 + vz, unit * 0.3 * big, Math.min(4, span * big));
        this.cr[p] = this.cg[p] = this.cb[p] = 0.14 + rnd() * 0.26;
        break;
      }
      case K_FLAME: {
        this.motion(0, 0, 0);
        const p = this.emit(
          k, x + (rnd() - rnd()) * 0.05, y + (rnd() - rnd()) * 0.05, z + (rnd() - rnd()) * 0.05,
          this.mx * 0.01 + vx, this.my * 0.01 + vy, this.mz * 0.01 + vz, unit * 0.3, span + 0.2,
        );
        this.lay[p] = SPR_FLAME;
        break;
      }
      case K_LAVA: {
        this.motion(0, 0, 0);
        const size = Math.min(0.6, Math.max(0.1, unit * 0.2 * (rnd() * 2 + 0.2)));
        const p = this.emit(k, x, y, z, this.mx * 0.8 + vx, (rnd() * 0.4 + 0.05) * TICKS + vy, this.mz * 0.8 + vz, size, span * 2);
        this.lay[p] = SPR_LAVA;
        break;
      }
      case K_SPLASH:
      case K_RAIN: {
        this.motion(0, 0, 0);
        const p = this.emit(k, x, y, z, this.mx * 0.3 + vx, (rnd() * 0.2 + 0.1) * TICKS + vy, this.mz * 0.3 + vz, unit * (k === K_RAIN ? 0.26 : 0.32), span);
        this.lay[p] = SPR_SPLASH + ((rnd() * 3) | 0);
        break;
      }
      case K_BUBBLE: {
        // une bulle n'existe que dans l'eau
        if (!this.world.isWater(Math.floor(x), Math.floor(y), Math.floor(z))) return;
        const size = Math.max(0.08, unit * 0.2 * (rnd() * 0.6 + 0.2) * 1.6);
        const p = this.emit(k, x, y, z, vx * 0.2 + (rnd() * 2 - 1) * 0.4, vy * 0.2 + (rnd() * 2 - 1) * 0.4, vz * 0.2 + (rnd() * 2 - 1) * 0.4, size, span);
        this.lay[p] = SPR_BUBBLE;
        break;
      }
      case K_EXPLOSION: {
        const p = this.emit(k, x, y, z, vx + (rnd() * 2 - 1) * 0.3, vy + (rnd() * 2 - 1) * 0.3, vz + (rnd() * 2 - 1) * 0.3, 1.6 + rnd(), 0.32 + rnd() * 0.2);
        this.lay[p] = SPR_EXPLOSION;
        this.cr[p] = this.cg[p] = this.cb[p] = 0.8 + rnd() * 0.2;
        break;
      }
      case K_CRIT: {
        this.motion(0, 0, 0);
        const p = this.emit(
          k, x, y, z,
          this.mx * 0.1 + (rnd() * 2 - 1) * 6 + vx, this.my * 0.1 + (rnd() * 2 - 1) * 6 + vy, this.mz * 0.1 + (rnd() * 2 - 1) * 6 + vz,
          unit * 0.3, 0.3 / (rnd() * 0.8 + 0.6),
        );
        this.lay[p] = SPR_CRIT;
        const c = 0.8 + rnd() * 0.2;
        this.cr[p] = c;
        this.cg[p] = c * 0.95;
        this.cb[p] = c * 0.62;
        break;
      }
      case K_HEART:
      case K_NOTE: {
        this.motion(0, 0, 0);
        const note = k === K_NOTE;
        const p = this.emit(k, x, y, z, this.mx * 0.01 + vx, this.my * 0.01 + (note ? 4 : 2) + vy, this.mz * 0.01 + vz, unit * 0.5, note ? 0.3 : 0.8);
        this.lay[p] = note ? SPR_NOTE : SPR_HEART;
        if (note) {
          // couleur selon une « hauteur » aléatoire, comme le bloc musical
          const h = rnd() * Math.PI * 2;
          this.cr[p] = Math.max(0, Math.sin(h) * 0.65 + 0.35);
          this.cg[p] = Math.max(0, Math.sin(h + 2.0944) * 0.65 + 0.35);
          this.cb[p] = Math.max(0, Math.sin(h + 4.1888) * 0.65 + 0.35);
        }
        break;
      }
      case K_SNOW:
      case K_SLIME: {
        this.motion(0, 0, 0);
        const p = this.emit(k, x, y, z, this.mx + vx, this.my + vy, this.mz + vz, unit * 0.26, Math.min(FRAGMENT_MAX_LIFE, 0.2 / (rnd() * 0.9 + 0.1)));
        this.lay[p] = SPR_SNOW + ((rnd() * 2) | 0);
        const c = 0.88 + rnd() * 0.12;
        if (k === K_SLIME) {
          this.cr[p] = c * 0.45;
          this.cg[p] = c * 0.8;
          this.cb[p] = c * 0.33;
        } else {
          this.cr[p] = this.cg[p] = this.cb[p] = c;
        }
        break;
      }
      case K_PORTAL: {
        // part d'un point décalé (dispersion + vitesse donnée) et converge vers (x, y, z)
        const reach = spread > 0 ? spread : 1;
        const ox = (rnd() * 2 - 1) * reach + vx;
        const oy = (rnd() * 2 - 1) * reach + vy;
        const oz = (rnd() * 2 - 1) * reach + vz;
        const p = this.emit(k, x + ox, y + oy + 1, z + oz, ox, oy, oz, 0.12 + rnd() * 0.08, 2 + rnd() * 0.5);
        this.ax[p] = x;
        this.ay[p] = y;
        this.az[p] = z;
        this.lay[p] = SPR_PUFF + 2 + ((rnd() * 6) | 0);
        const c = rnd() * 0.6 + 0.4;
        this.cr[p] = c * 0.9;
        this.cg[p] = c * 0.3;
        this.cb[p] = c;
        break;
      }
      case K_DRIP_WATER:
      case K_DRIP_LAVA: {
        const p = this.emit(k, x, y, z, vx, vy, vz, 0.25, 6);
        this.lay[p] = SPR_DRIP;
        this.st[p] = DRIP_HANGING;
        this.ay[p] = 1.2 + rnd() * 0.8; // durée de suspension sous le bloc
        if (k === K_DRIP_WATER) {
          this.cr[p] = 0.25;
          this.cg[p] = 0.42;
          this.cb[p] = 1;
        } else {
          this.cr[p] = 1;
          this.cg[p] = 0.45;
          this.cb[p] = 0.1;
        }
        break;
      }
      case K_BONEMEAL: {
        this.motion(0, 0, 0);
        const p = this.emit(k, x, y, z, this.mx * 0.02 + vx, this.my * 0.02 + vy, this.mz * 0.02 + vz, 0.14 + rnd() * 0.16, Math.min(2.5, span * 2.5));
        this.lay[p] = SPR_GLINT;
        this.cr[p] = this.cg[p] = this.cb[p] = 0.8 + rnd() * 0.2;
        break;
      }
    }
  }

  /** Réserve un emplacement : le suivant de l'anneau, ou un libre tout proche avant de recycler la plus ancienne. */
  private alloc(): number {
    let i = this.cursor;
    if (this.life[i] > 0) {
      for (let n = 1; n <= 8; n++) {
        const j = (i + n) & MASK;
        if (this.life[j] <= 0) {
          i = j;
          break;
        }
      }
    }
    this.cursor = (i + 1) & MASK;
    if (i >= this.high) this.high = i + 1;
    return i;
  }

  /** Initialise une particule (couleur blanche, couche 0) et relève sa cellule ; renvoie son emplacement. */
  private emit(k: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number): number {
    const p = this.alloc();
    this.kind[p] = k;
    this.px[p] = x;
    this.py[p] = y;
    this.pz[p] = z;
    this.vx[p] = vx;
    this.vy[p] = vy;
    this.vz[p] = vz;
    this.age[p] = 0;
    this.life[p] = life;
    this.size[p] = size;
    this.lay[p] = 0;
    this.cr[p] = 1;
    this.cg[p] = 1;
    this.cb[p] = 1;
    this.ca[p] = 1;
    this.st[p] = 0;
    this.cx[p] = Math.floor(x);
    this.cy[p] = Math.floor(y);
    this.cz[p] = Math.floor(z);
    this.sense(p);
    // émise à fleur de sol mais comptée dans le bloc (pied du joueur, goutte de pluie) : la poser dessus
    if (COLLIDE[k] === 1 && (this.env[p] & ENV_SOLID) !== 0 && y - this.cy[p] > 0.8 && !this.world.isSolid(this.cx[p], this.cy[p] + 1, this.cz[p])) {
      this.cy[p] += 1;
      this.py[p] = this.cy[p] + RADIUS + EPS;
      this.sense(p);
    }
    return p;
  }

  /** Relève l'environnement de la cellule courante : solide, eau, lumière. */
  private sense(p: number): void {
    const w = this.world;
    const x = this.cx[p];
    const y = this.cy[p];
    const z = this.cz[p];
    this.env[p] = (w.isSolid(x, y, z) ? ENV_SOLID : 0) | (w.isWater(x, y, z) ? ENV_WATER : 0);
    if (EMISSIVE[this.kind[p]] === 1) return;
    const l = w.lightAt(x, y, z);
    let s = (l >> 4) & 15;
    let b = l & 15;
    if (s === 0 && b === 0) {
      // cellule pleine, ou lumière pas encore propagée après la casse d'un bloc : ce que
      // donnerait la propagation depuis les six voisins
      let n = w.lightAt(x, y + 1, z);
      s = (n >> 4) & 15;
      b = n & 15;
      n = w.lightAt(x, y - 1, z);
      if (((n >> 4) & 15) > s) s = (n >> 4) & 15;
      if ((n & 15) > b) b = n & 15;
      n = w.lightAt(x + 1, y, z);
      if (((n >> 4) & 15) > s) s = (n >> 4) & 15;
      if ((n & 15) > b) b = n & 15;
      n = w.lightAt(x - 1, y, z);
      if (((n >> 4) & 15) > s) s = (n >> 4) & 15;
      if ((n & 15) > b) b = n & 15;
      n = w.lightAt(x, y, z + 1);
      if (((n >> 4) & 15) > s) s = (n >> 4) & 15;
      if ((n & 15) > b) b = n & 15;
      n = w.lightAt(x, y, z - 1);
      if (((n >> 4) & 15) > s) s = (n >> 4) & 15;
      if ((n & 15) > b) b = n & 15;
      if (s > 0) s--;
      if (b > 0) b--;
    }
    this.ls[p] = s;
    this.lb[p] = b;
  }

  /** Programme une émission à traiter après la boucle de simulation (qui ne doit pas voir l'anneau bouger). */
  private defer(k: number, x: number, y: number, z: number): void {
    const q = this.qCount;
    if (q >= QUEUE) return;
    this.qKind[q] = k;
    this.qPos[q * 3] = x;
    this.qPos[q * 3 + 1] = y;
    this.qPos[q * 3 + 2] = z;
    this.qCount = q + 1;
  }

  // -------------------------------------------------------------------------------------------
  // Simulation + tampons
  // -------------------------------------------------------------------------------------------

  /**
   * Simulation + mise à jour des tampons ; à appeler une fois par image.
   * (L'orientation face caméra est faite dans le vertex shader : `camera` n'est pas lue.)
   */
  update(dt: number, _camera: THREE.Camera): void {
    const cut = this.cutout;
    const bl = this.blend;
    cut.count = 0;
    bl.count = 0;
    if (this.high === 0) {
      cut.flush();
      bl.flush();
      return;
    }
    if (!(dt > 0)) dt = 0;
    else if (dt > MAX_DT) dt = MAX_DT;
    const ticks = dt * TICKS;
    this.frame = (this.frame + 1) & 0xffff;
    const frame = this.frame;

    // facteurs par image (les constantes d'origine sont par tick)
    const dragF = this.dragF;
    for (let k = 0; k < KIND_COUNT; k++) dragF[k] = Math.pow(DRAG[k], ticks);
    const groundF = Math.pow(0.7, ticks);
    const waterF = Math.pow(0.8, ticks);
    const ceilF = Math.pow(1.1, ticks);
    const dieOnGround = 1 - Math.pow(0.5, ticks);

    const w = this.world;
    const px = this.px, py = this.py, pz = this.pz;
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const age = this.age, life = this.life, size = this.size, kind = this.kind, lay = this.lay;
    const cx = this.cx, cy = this.cy, cz = this.cz, env = this.env, st = this.st;
    const high = this.high;

    for (let i = 0; i < high; i++) {
      const lifeI = life[i];
      if (lifeI <= 0) continue;
      const a = age[i] + dt;
      if (a >= lifeI) {
        life[i] = 0;
        continue;
      }
      age[i] = a;
      const k = kind[i];
      const f = a / lifeI;
      let x: number;
      let y: number;
      let z: number;

      if (k === K_PORTAL) {
        // trajectoire fermée : du point de départ vers la cible
        const g = 1 + f - 2 * f * f;
        x = this.ax[i] + vx[i] * g;
        y = this.ay[i] + vy[i] * g + (1 - f);
        z = this.az[i] + vz[i] * g;
      } else {
        x = px[i];
        y = py[i];
        z = pz[i];
        let ux = vx[i];
        let uy = vy[i];
        let uz = vz[i];
        const e = env[i];
        const drip = k === K_DRIP_WATER || k === K_DRIP_LAVA;
        let dead = false;

        if (drip && st[i] !== DRIP_FALLING) {
          // suspendue sous le bloc (s'étire à peine), ou écrasée au sol
          ux = 0;
          uz = 0;
          uy = 0;
          if (st[i] === DRIP_HANGING) {
            y -= 0.03 * dt;
            if (a >= this.ay[i]) st[i] = DRIP_FALLING;
          }
        } else {
          uy -= GRAVITY[k] * dt;
          if ((e & ENV_WATER) !== 0 && k !== K_BUBBLE) {
            ux *= waterF;
            uy *= waterF;
            uz *= waterF;
          }
          let nx = x + ux * dt;
          let ny = y + uy * dt;
          let nz = z + uz * dt;
          let ground = false;
          let ceil = false;
          if (COLLIDE[k] === 1 && (e & ENV_SOLID) === 0) {
            // collision axe par axe ; la cellule courante est libre, on ne teste que les traversées
            const cxi = cx[i];
            const cyi = cy[i];
            const czi = cz[i];
            if (ux > 0) {
              const c = Math.floor(nx + RADIUS);
              if (c !== cxi && w.isSolid(c, cyi, czi)) {
                nx = c - RADIUS - EPS;
                ux = 0;
              }
            } else if (ux < 0) {
              const c = Math.floor(nx - RADIUS);
              if (c !== cxi && w.isSolid(c, cyi, czi)) {
                nx = c + 1 + RADIUS + EPS;
                ux = 0;
              }
            }
            const fx = Math.floor(nx);
            if (uy < 0) {
              const c = Math.floor(ny - RADIUS);
              if (c !== cyi && w.isSolid(fx, c, czi)) {
                ny = c + 1 + RADIUS + EPS;
                uy = 0;
                ground = true;
              }
            } else if (uy > 0) {
              const c = Math.floor(ny + RADIUS);
              if (c !== cyi && w.isSolid(fx, c, czi)) {
                ny = c - RADIUS - EPS;
                uy = 0;
                ceil = true;
              }
            }
            const fy = Math.floor(ny);
            if (uz > 0) {
              const c = Math.floor(nz + RADIUS);
              if (c !== czi && w.isSolid(fx, fy, c)) {
                nz = c - RADIUS - EPS;
                uz = 0;
              }
            } else if (uz < 0) {
              const c = Math.floor(nz - RADIUS);
              if (c !== czi && w.isSolid(fx, fy, c)) {
                nz = c + 1 + RADIUS + EPS;
                uz = 0;
              }
            }
          }
          x = nx;
          y = ny;
          z = nz;
          if (ground) {
            ux *= groundF;
            uz *= groundF;
          }
          const d = dragF[k];
          ux *= d;
          uy *= d;
          uz *= d;

          switch (k) {
            case K_SMOKE:
            case K_LARGE_SMOKE:
            case K_HEART:
            case K_NOTE:
              // bloquée sous un plafond : s'étale
              if (ceil) {
                ux *= ceilF;
                uz *= ceilF;
              }
              break;
            case K_SPLASH:
            case K_RAIN:
              if ((e & ENV_WATER) !== 0 || (ground && Math.random() < dieOnGround)) dead = true;
              break;
            case K_BUBBLE:
              if ((e & ENV_WATER) === 0) dead = true;
              break;
            case K_LAVA:
              // traînée de fumée, dense au début du saut
              if (Math.random() < (1 - f) * ticks * 0.6) this.defer(K_SMOKE, x, y, z);
              break;
            case K_DRIP_WATER:
              if ((e & ENV_WATER) !== 0) dead = true;
              else if (ground) {
                dead = true;
                this.defer(K_SPLASH, x, y, z);
              }
              break;
            case K_DRIP_LAVA:
              if ((e & ENV_WATER) !== 0) dead = true;
              else if (ground) {
                st[i] = DRIP_LANDED;
                life[i] = a + 0.6;
              }
              break;
          }
        }
        if (dead) {
          life[i] = 0;
          continue;
        }
        px[i] = x;
        py[i] = y;
        pz[i] = z;
        vx[i] = ux;
        vy[i] = uy;
        vz[i] = uz;
      }

      // --- cellule : relevée au changement, et de temps en temps (la lumière du monde évolue) ---
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      const fz = Math.floor(z);
      if (fx !== cx[i] || fy !== cy[i] || fz !== cz[i] || ((i + frame) & 7) === 0) {
        cx[i] = fx;
        cy[i] = fy;
        cz[i] = fz;
        this.sense(i);
      }

      // --- apparence ---
      let s = size[i];
      let layer = -1 - lay[i];
      let u0 = 0;
      let v0 = 0;
      let du = 0.5;
      let alpha = this.ca[i];
      let g = this.cg[i];
      let b = this.cb[i];
      switch (k) {
        case K_TILE:
          layer = lay[i];
          u0 = this.tu[i];
          v0 = this.tv[i];
          du = 4 / TILE_SIZE;
          break;
        case K_SMOKE:
        case K_LARGE_SMOKE: {
          // 8 étapes qui rétrécissent, apparition rapide, fondu final
          const step = 7 - Math.min(7, (f * 8) | 0);
          layer = -1 - (SPR_PUFF + step);
          s *= Math.min(1, f * 32);
          alpha = SMOKE_ALPHA * Math.min(1, (1 - f) * 4);
          break;
        }
        case K_FLAME:
          s *= 1 - f * f * 0.5;
          break;
        case K_LAVA:
          s *= 1 - f * f;
          break;
        case K_EXPLOSION:
          layer = -1 - (SPR_EXPLOSION + Math.min(EXPLOSION_FRAMES - 1, (f * EXPLOSION_FRAMES) | 0));
          du = 1;
          s *= 0.7 + 0.3 * f;
          alpha = EXPLOSION_ALPHA * Math.min(1, (1 - f) * 3);
          break;
        case K_CRIT:
          // pâlit vers l'orangé en s'éteignant
          s *= Math.min(1, f * 32);
          g *= 1 - 0.25 * f;
          b *= 1 - 0.6 * f;
          break;
        case K_HEART:
        case K_NOTE:
          s *= Math.min(1, f * 32);
          break;
        case K_PORTAL: {
          const q = 1 - f;
          s *= 1 - q * q;
          break;
        }
        case K_BONEMEAL:
          s *= Math.min(1, (1 - f) * 3.3);
          break;
        case K_DRIP_WATER:
        case K_DRIP_LAVA:
          layer = -1 - (SPR_DRIP + st[i]);
          break;
      }

      const batch = BLEND[k] === 1 ? bl : cut;
      const out = batch.array;
      const o = batch.count * STRIDE;
      batch.count++;
      out[o] = x;
      out[o + 1] = y;
      out[o + 2] = z;
      out[o + 3] = s;
      out[o + 4] = u0;
      out[o + 5] = v0;
      out[o + 6] = du;
      out[o + 7] = du;
      out[o + 8] = this.cr[i];
      out[o + 9] = g;
      out[o + 10] = b;
      out[o + 11] = alpha;
      out[o + 12] = this.ls[i] / 15;
      out[o + 13] = this.lb[i] / 15;
      out[o + 14] = EMISSIVE[k];
      out[o + 15] = layer;
    }

    // émissions différées (visibles à l'image suivante)
    const queued = this.qCount;
    this.qCount = 0;
    for (let q = 0; q < queued; q++) {
      this.spawnOne(this.qKind[q], this.qPos[q * 3], this.qPos[q * 3 + 1], this.qPos[q * 3 + 2], 0, 0, 0, 0, false);
    }

    // la borne haute redescend quand la fin de l'anneau s'est vidée
    let h = this.high;
    while (h > 0 && life[h - 1] <= 0) h--;
    this.high = h;

    cut.flush();
    bl.flush();
  }
}
