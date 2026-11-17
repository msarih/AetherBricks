/**
 * Ciel complet façon Minecraft : dôme dégradé, soleil, lune, étoiles, nuages « blocs », pluie et neige.
 *
 * Tout est écrit en couleurs « écran » (gestion des couleurs de Three.js désactivée) et sans aucune
 * lumière Three.js. Le ciel (dôme, étoiles, soleil, lune) est rendu en premier, sans test de profondeur,
 * dans la liste opaque ; les nuages et la pluie sont rendus avec les objets translucides.
 *
 * Repère : l'est est +x. Le soleil se lève à l'est, culmine à midi (+y), se couche à l'ouest (−x).
 * La course du soleil suit la formule de Minecraft : midi exact au tick 6000, minuit au tick 18000,
 * et le disque franchit l'horizon un peu après 12000 / un peu avant 0 (comme dans le jeu).
 */
import * as THREE from 'three';
import { worldUniforms } from './ChunkMaterials';

export interface SkyEnvironment {
  /** y du premier bloc libre au-dessus du plus haut bloc qui arrête la pluie dans la colonne (x, z) ; 0 si inconnu. */
  rainHeight(x: number, z: number): number;
  /** Vrai s'il neige dans cette colonne (biome froid) au lieu de pleuvoir. */
  isSnowy(x: number, z: number): boolean;
}

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

const DAY_TICKS = 24000;
const TAU = Math.PI * 2;

/** Couleurs « écran » (0..1). Jamais d'hexadécimal passé à THREE.Color : aucune conversion possible. */
interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}
function rgb(r: number, g: number, b: number): RGB {
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/** Zénith de jour (#78A7FF) et de nuit (#000008). */
const SKY_DAY = rgb(0x78, 0xa7, 0xff);
const SKY_NIGHT = rgb(0x00, 0x00, 0x08);
/** Horizon / brouillard de jour (#C0D8FF) et de nuit (#0A0C14). */
const FOG_DAY = rgb(0xc0, 0xd8, 0xff);
const FOG_NIGHT = rgb(0x0a, 0x0c, 0x14);
/** Gris de pluie (#6F7785) vers lequel tendent ciel et brouillard. */
const RAIN_GRAY = rgb(0x6f, 0x77, 0x85);
/** Lumière du ciel la nuit. */
const LIGHT_NIGHT: RGB = { r: 0.17, g: 0.19, b: 0.3 };
/** Teinte de l'éclair. */
const FLASH_TINT: RGB = { r: 0.86, g: 0.88, b: 1 };

/** Distance des astres (unités) et demi-tailles des quads, comme Minecraft. */
const CELESTIAL_DISTANCE = 100;
const SUN_HALF_SIZE = 30;
const MOON_HALF_SIZE = 20;
const STAR_COUNT = 1500;

/** Nuages. */
const CLOUD_Y = 132;
const CLOUD_THICKNESS = 4;
const CLOUD_CELL = 12;
const CLOUD_GRID = 128;
const CLOUD_GRID_MASK = CLOUD_GRID - 1;
const CLOUD_SPEED = 0.6;
const CLOUD_ALPHA = 0.8;
const CLOUD_COVERAGE = 0.42;
const CLOUD_MIN_RADIUS = 192;
const CLOUD_MAX_RADIUS = 768;
const CLOUD_SHADE_TOP = 1;
const CLOUD_SHADE_BOTTOM = 0.7;
const CLOUD_SHADE_X = 0.9;
const CLOUD_SHADE_Z = 0.8;

/** Pluie et neige. */
const RAIN_RADIUS = 10;
const RAIN_SIDE = RAIN_RADIUS * 2 + 1;
const RAIN_COLUMNS = RAIN_SIDE * RAIN_SIDE;
const PRECIP_TEX_W = 64;
const PRECIP_TEX_H = 256;

/** Durée d'un éclair (s). */
const FLASH_TIME = 0.3;

/** Ordres de rendu : le ciel d'abord (liste opaque), les nuages avant l'eau, la pluie en dernier. */
const ORDER_DOME = -1000;
const ORDER_STARS = -999;
const ORDER_SUN = -998;
const ORDER_MOON = -997;
const ORDER_CLOUD_DEPTH = -10;
const ORDER_CLOUD_COLOR = -9;
const ORDER_PRECIPITATION = 50;

// ---------------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage entier d'une colonne (x, z) → [0, 1). */
function hashColumn(x: number, z: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(salt, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Angle céleste de Minecraft pour un tick de la journée : 0 = midi, 0.25 = coucher, 0.5 = minuit, 0.75 = lever.
 * Le tick 6000 donne exactement 0 (midi), le tick 18000 exactement 0.5 (minuit).
 */
function celestialAngle(timeOfDay: number): number {
  let f = timeOfDay / DAY_TICKS - 0.25;
  f -= Math.floor(f);
  const eased = 0.5 - Math.cos(f * Math.PI) / 2;
  return f + (eased - f) / 3;
}

function pixelTexture(data: Uint8Array<ArrayBuffer>, width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function putPixel(data: Uint8Array, index: number, r: number, g: number, b: number, a: number): void {
  const o = index * 4;
  data[o] = Math.round(clamp01(r) * 255);
  data[o + 1] = Math.round(clamp01(g) * 255);
  data[o + 2] = Math.round(clamp01(b) * 255);
  data[o + 3] = Math.round(clamp01(a) * 255);
}

// ---------------------------------------------------------------------------------------------
// Textures procédurales (pixel-art)
// ---------------------------------------------------------------------------------------------

/** Soleil 32×32 : carré blanc-jaune à bord net (8×8 au centre) et halo carré, sur fond noir (mélange additif). */
function makeSunTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - 15.5);
      const dy = Math.abs(y - 15.5);
      const cheb = Math.max(dx, dy);
      let r: number;
      let g: number;
      let b: number;
      if (cheb < 3) {
        // Cœur blanc chaud.
        r = 1;
        g = 1;
        b = 0.84;
      } else if (cheb < 4) {
        // Liseré jaune (bord net).
        r = 1;
        g = 0.93;
        b = 0.5;
      } else {
        // Halo : carré adouci, qui s'annule exactement au bord de la texture.
        const d = cheb * 0.7 + Math.hypot(dx, dy) * 0.3;
        const k = Math.max(0, 1 - (d - 4) / 11.5);
        const i = k * k * k * 0.42;
        r = i;
        g = i * 0.8;
        b = i * 0.45;
      }
      putPixel(data, y * size + x, r, g, b, 1);
    }
  }
  return pixelTexture(data, size, size);
}

/** Cratères de la lune (8×8) : « o » = pixel sombre. */
const MOON_CRATERS = [
  '........',
  '.oo...o.',
  '.oo.....',
  '....o...',
  '...ooo..',
  '.o..oo..',
  '......o.',
  '..o.....',
];

/**
 * Lune : atlas 128×64 de 8 phases (4 colonnes × 2 lignes de 32×32), disque carré 8×8 avec cratères.
 * Phase 0 = pleine lune, 4 = nouvelle lune (ordre de Minecraft).
 */
function makeMoonTexture(): THREE.DataTexture {
  const cell = 32;
  const width = cell * 4;
  const height = cell * 2;
  const data = new Uint8Array(width * height * 4);
  for (let phase = 0; phase < 8; phase++) {
    const ox = (phase % 4) * cell;
    const oy = Math.floor(phase / 4) * cell;
    // Colonnes éclairées du disque (0..7).
    let litFrom = 0;
    let litTo = 8;
    if (phase >= 1 && phase <= 3) litTo = 8 - phase * 2;
    else if (phase === 4) litTo = 0;
    else if (phase >= 5) litFrom = 8 - (phase - 4) * 2;
    const litFraction = (litTo - litFrom) / 8;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const dx = Math.abs(x - 15.5);
        const dy = Math.abs(y - 15.5);
        const cheb = Math.max(dx, dy);
        let r: number;
        let g: number;
        let b: number;
        if (cheb < 4) {
          const mx = x - 12;
          const my = y - 12;
          if (mx >= litFrom && mx < litTo) {
            const crater = MOON_CRATERS[7 - my].charAt(mx) === 'o';
            const edge = cheb > 3;
            const v = crater ? 0.7 : edge ? 0.9 : 1;
            r = 0.84 * v;
            g = 0.88 * v;
            b = 0.96 * v;
          } else {
            // Face non éclairée : à peine visible.
            r = 0.05;
            g = 0.06;
            b = 0.1;
          }
        } else {
          // Faible halo bleuté.
          const k = Math.max(0, 1 - (cheb - 4) / 6);
          const i = k * k * 0.1 * (0.25 + 0.75 * litFraction);
          r = i * 0.75;
          g = i * 0.82;
          b = i;
        }
        putPixel(data, (oy + y) * width + ox + x, r, g, b, 1);
      }
    }
  }
  return pixelTexture(data, width, height);
}

/**
 * Atlas des précipitations (128×256) : moitié gauche = stries de pluie bleutées, moitié droite = flocons.
 * La ligne 0 est en bas (v = 0) ; la texture boucle verticalement.
 */
function makePrecipitationTexture(): THREE.DataTexture {
  const w = PRECIP_TEX_W;
  const h = PRECIP_TEX_H;
  const data = new Uint8Array(w * 2 * h * 4);
  const rand = mulberry32(0x5eed1e);
  const blend = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    const yy = ((y % h) + h) % h;
    const o = (yy * w * 2 + x) * 4;
    const a8 = Math.round(clamp01(a) * 255);
    if (a8 <= data[o + 3]) return;
    data[o] = Math.round(clamp01(r) * 255);
    data[o + 1] = Math.round(clamp01(g) * 255);
    data[o + 2] = Math.round(clamp01(b) * 255);
    data[o + 3] = a8;
  };
  // Pluie : stries verticales, tête (en bas) plus opaque, queue qui s'estompe.
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rand() * (w - 1));
    const y0 = Math.floor(rand() * h);
    const len = 14 + Math.floor(rand() * 34);
    const tone = rand();
    const strength = 0.4 + rand() * 0.3;
    const r = 0.26 + tone * 0.16;
    const g = 0.4 + tone * 0.16;
    const b = 0.86 + tone * 0.14;
    const wide = rand() < 0.25;
    for (let k = 0; k < len; k++) {
      const a = Math.pow(1 - k / len, 1.3) * strength;
      blend(x, y0 + k, r, g, b, a);
      if (wide) blend(x + 1, y0 + k, r, g, b, a * 0.55);
    }
  }
  // Neige : petits flocons blancs.
  for (let i = 0; i < 64; i++) {
    const x = 1 + Math.floor(rand() * (w - 3));
    const y = Math.floor(rand() * h);
    const a = 0.8 + rand() * 0.2;
    const v = 0.92 + rand() * 0.08;
    const shape = rand();
    const px = w + x;
    blend(px, y, v, v, v, a);
    if (shape > 0.35) {
      blend(px + 1, y, v, v, v, a);
      blend(px, y + 1, v, v, v, a);
      blend(px + 1, y + 1, v, v, v, a);
    }
    if (shape > 0.8) {
      blend(px - 1, y, v, v, v, a * 0.7);
      blend(px + 2, y + 1, v, v, v, a * 0.7);
      blend(px, y - 1, v, v, v, a * 0.7);
      blend(px + 1, y + 2, v, v, v, a * 0.7);
    }
  }
  const tex = pixelTexture(data, w * 2, h);
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Motif des nuages : bruit de valeur périodique (128×128, graine fixe) seuillé pour couvrir
 * CLOUD_COVERAGE des cellules. 1 = nuage.
 */
function makeCloudPattern(): Uint8Array {
  const n = CLOUD_GRID;
  const rand = mulberry32(0xc10d5);
  const field = new Float32Array(n * n);
  const octaves: Array<[number, number]> = [
    [16, 0.5],
    [32, 0.32],
    [64, 0.18],
  ];
  for (const [lattice, weight] of octaves) {
    const values = new Float32Array(lattice * lattice);
    for (let i = 0; i < values.length; i++) values[i] = rand();
    const scale = lattice / n;
    for (let z = 0; z < n; z++) {
      const fz = (z + 0.5) * scale;
      const z0 = Math.floor(fz);
      const tz = fz - z0;
      const sz = tz * tz * (3 - 2 * tz);
      const za = (z0 % lattice) * lattice;
      const zb = ((z0 + 1) % lattice) * lattice;
      for (let x = 0; x < n; x++) {
        const fx = (x + 0.5) * scale;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % lattice;
        const xb = (x0 + 1) % lattice;
        const top = lerp(values[za + xa], values[za + xb], sx);
        const bottom = lerp(values[zb + xa], values[zb + xb], sx);
        field[z * n + x] += lerp(top, bottom, sz) * weight;
      }
    }
  }
  const sorted = Float32Array.from(field).sort();
  const threshold = sorted[Math.floor(sorted.length * (1 - CLOUD_COVERAGE))];
  const pattern = new Uint8Array(n * n);
  for (let i = 0; i < pattern.length; i++) pattern[i] = field[i] > threshold ? 1 : 0;
  return pattern;
}

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------

/** Dôme : cube centré sur la caméra (la translation de la vue est ignorée). */
const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  p.z = 0.0;
  gl_Position = p;
}
`;

const DOME_FRAGMENT = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uFog;
uniform vec3 uVoid;
uniform vec3 uSunset;
uniform vec3 uSunsetHigh;
uniform float uSunsetAlpha;
uniform float uSunSide;
uniform float uBand;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Dégradé de Minecraft : un plan de ciel au-dessus de la tête, noyé dans le brouillard vers l'horizon.
  float f = clamp(uBand / max(h, 0.0001), 0.0, 1.0);
  f = f * f * (3.0 - 2.0 * f);
  vec3 col = mix(uSky, uFog, f);
  // Lueur du lever / coucher : seulement du côté du soleil, près de l'horizon.
  float az = max(d.x * uSunSide / max(length(d.xz), 0.0001), 0.0);
  float spread = 0.05 + 0.34 * az * az;
  float vert = exp(-max(h, 0.0) / spread);
  float glow = az * vert * uSunsetAlpha;
  vec3 glowColor = mix(uSunsetHigh, uSunset, vert * az);
  col = mix(col, glowColor, glow);
  // Le « vide » sous l'horizon : un peu plus sombre.
  float below = 1.0 - smoothstep(-0.45, -0.03, h);
  col = mix(col, uVoid, below);
  // Tramage léger contre les bandes de dégradé.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Étoiles : quads sur la sphère céleste, fondus près de l'horizon. */
const STAR_VERTEX = /* glsl */ `
attribute float bright;
uniform float uAlpha;
varying float vAlpha;
void main() {
  vec3 wd = mat3(modelMatrix) * position;
  float h = normalize(wd).y;
  vAlpha = uAlpha * bright * smoothstep(-0.06, 0.14, h);
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * wd, 1.0);
  p.z = 0.0;
  gl_Position = p;
}
`;

const STAR_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha);
}
`;

/** Soleil et lune : quad texturé additif. */
const CELESTIAL_VERTEX = /* glsl */ `
uniform vec4 uUvRect;
varying vec2 vUv;
void main() {
  vUv = uv * uUvRect.zw + uUvRect.xy;
  vec3 wd = mat3(modelMatrix) * position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * wd, 1.0);
  p.z = 0.0;
  gl_Position = p;
}
`;

const CELESTIAL_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(map, vUv).rgb, uOpacity);
}
`;

const CLOUD_VERTEX = /* glsl */ `
attribute float shade;
varying float vShade;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vShade = shade;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogFar;
uniform float uFar;
uniform float uOpacity;
varying float vShade;
varying vec3 vWorld;
void main() {
  float d = length(vWorld.xz - cameraPosition.xz);
  // Les nuages portent plus loin que le terrain, mais suivent un brouillard très court (sous l'eau…).
  float far = min(uFar, uFogFar * 4.0);
  float fade = 1.0 - smoothstep(far * 0.5, far, d);
  if (fade <= 0.004) discard;
  float fog = smoothstep(far * 0.2, far * 0.85, d) * 0.7;
  gl_FragColor = vec4(mix(uColor * vShade, uFogColor, fog), uOpacity * fade);
}
`;

const PRECIP_VERTEX = /* glsl */ `
attribute vec2 info;
varying vec2 vUv;
varying vec2 vInfo;
void main() {
  vUv = uv;
  vInfo = info;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PRECIP_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 uTint;
varying vec2 vUv;
varying vec2 vInfo;
void main() {
  // info.y : 0 = pluie (moitié gauche de l'atlas), 1 = neige (moitié droite).
  vec2 uv = vec2((fract(vUv.x) + step(0.5, vInfo.y)) * 0.5, vUv.y);
  vec4 t = texture2D(map, uv);
  float a = t.a * vInfo.x;
  if (a < 0.004) discard;
  gl_FragColor = vec4(t.rgb * uTint, a);
}
`;

// ---------------------------------------------------------------------------------------------
// Ciel
// ---------------------------------------------------------------------------------------------

export class Sky {
  /** Couleur du ciel au zénith (sert aussi de couleur d'effacement). */
  readonly skyColor = new THREE.Color(SKY_DAY.r, SKY_DAY.g, SKY_DAY.b);
  /** Couleur de l'horizon = couleur du brouillard du terrain. */
  readonly fogColor = new THREE.Color(FOG_DAY.r, FOG_DAY.g, FOG_DAY.b);
  /**
   * Multiplicateur de la lumière du ciel pour le terrain : blanc à midi, bleu sombre la nuit
   * (≈ 0.17, 0.19, 0.30), assombri par la pluie/l'orage, brièvement éclairci par un éclair.
   */
  readonly skyLight = new THREE.Color(1, 1, 1);
  /** 0 = nuit noire … 1 = plein jour (ne dépend que de l'heure ; sert à l'apparition des monstres, au sommeil…). */
  dayFactor = 1;
  /** Éclair en cours : 0..1 (flash blanc bref), sinon 0. */
  flash = 0;
  /**
   * Phase de la lune : 0 = pleine, 4 = nouvelle. Avance toute seule à chaque nouveau jour
   * (retour en arrière de l'heure) ; le moteur peut aussi l'imposer (numéro du jour modulo 8).
   */
  moonPhase = 0;

  private readonly scene: THREE.Scene;
  private readonly env: SkyEnvironment;
  private readonly root = new THREE.Object3D();
  /** Tourne autour de l'axe nord-sud (z) : porte le soleil, la lune et les étoiles. */
  private readonly celestial = new THREE.Object3D();

  private readonly dome: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly stars: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly sun: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly moon: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly sunTexture: THREE.DataTexture;
  private readonly moonTexture: THREE.DataTexture;

  // Nuages.
  private readonly cloudPattern: Uint8Array;
  private readonly cloudDepthMaterial: THREE.ShaderMaterial;
  private readonly cloudColorMaterial: THREE.ShaderMaterial;
  private readonly cloudDepth: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly cloudColor: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private cloudGeometry: THREE.BufferGeometry;
  private cloudPositions = new Float32Array(0);
  private cloudShades = new Float32Array(0);
  private cloudCapacity = 0;
  private cloudCursor = 0;
  private cloudCellX = Number.NaN;
  private cloudCellZ = Number.NaN;
  private cloudRadiusCells = 0;
  /** Dérive accumulée vers l'ouest (blocs), ramenée dans [0, période). */
  private cloudDrift = 0;
  private cloudsVisible = true;

  // Pluie et neige.
  private readonly precipTexture: THREE.DataTexture;
  private readonly precip: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly precipPositions = new Float32Array(RAIN_COLUMNS * 12);
  private readonly precipUvs = new Float32Array(RAIN_COLUMNS * 8);
  private readonly precipInfos = new Float32Array(RAIN_COLUMNS * 8);
  private readonly precipPositionAttr: THREE.BufferAttribute;
  private readonly precipUvAttr: THREE.BufferAttribute;
  private readonly precipInfoAttr: THREE.BufferAttribute;
  private readonly columnHeights = new Float32Array(RAIN_COLUMNS);
  private readonly columnSnowy = new Uint8Array(RAIN_COLUMNS);
  private columnCacheX = Number.NaN;
  private columnCacheZ = Number.NaN;
  private columnCacheAge = 0;
  private precipTime = 0;

  private flashTimer = 0;
  private lastTime = -1;
  private readonly look = new THREE.Vector3();

  constructor(scene: THREE.Scene, env: SkyEnvironment) {
    this.scene = scene;
    this.env = env;
    this.root.name = 'ciel';
    this.root.add(this.celestial);

    // --- Dôme ---
    this.dome = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          uSky: { value: new THREE.Color(SKY_DAY.r, SKY_DAY.g, SKY_DAY.b) },
          uFog: { value: new THREE.Color(FOG_DAY.r, FOG_DAY.g, FOG_DAY.b) },
          uVoid: { value: new THREE.Color(FOG_DAY.r * 0.7, FOG_DAY.g * 0.7, FOG_DAY.b * 0.8) },
          uSunset: { value: new THREE.Color(1, 0.48, 0.165) },
          uSunsetHigh: { value: new THREE.Color(1, 0.55, 0.6) },
          uSunsetAlpha: { value: 0 },
          uSunSide: { value: 1 },
          uBand: { value: 0.1 },
        },
        vertexShader: DOME_VERTEX,
        fragmentShader: DOME_FRAGMENT,
        side: THREE.BackSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.dome.renderOrder = ORDER_DOME;
    this.dome.frustumCulled = false;
    this.root.add(this.dome);

    // --- Étoiles ---
    this.stars = new THREE.Mesh(
      Sky.buildStarGeometry(),
      new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: STAR_VERTEX,
        fragmentShader: STAR_FRAGMENT,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.stars.renderOrder = ORDER_STARS;
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    this.celestial.add(this.stars);

    // --- Soleil et lune ---
    this.sunTexture = makeSunTexture();
    this.moonTexture = makeMoonTexture();
    this.sun = Sky.buildCelestialQuad(this.sunTexture, SUN_HALF_SIZE, CELESTIAL_DISTANCE);
    this.sun.renderOrder = ORDER_SUN;
    this.celestial.add(this.sun);
    this.moon = Sky.buildCelestialQuad(this.moonTexture, MOON_HALF_SIZE, -CELESTIAL_DISTANCE);
    this.moon.renderOrder = ORDER_MOON;
    (this.moon.material.uniforms.uUvRect.value as THREE.Vector4).set(0, 0, 0.25, 0.5);
    this.celestial.add(this.moon);

    // --- Nuages : une passe de profondeur seule, puis la couleur (une seule couche visible) ---
    this.cloudPattern = makeCloudPattern();
    const cloudUniforms = {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uFogColor: worldUniforms.uFogColor,
      uFogFar: worldUniforms.uFogFar,
      uFar: { value: CLOUD_MIN_RADIUS },
      uOpacity: { value: CLOUD_ALPHA },
    };
    this.cloudDepthMaterial = new THREE.ShaderMaterial({
      uniforms: cloudUniforms,
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      side: THREE.DoubleSide,
      transparent: true,
      colorWrite: false,
      depthWrite: true,
    });
    this.cloudColorMaterial = new THREE.ShaderMaterial({
      uniforms: cloudUniforms,
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    this.cloudGeometry = new THREE.BufferGeometry();
    this.cloudDepth = new THREE.Mesh(this.cloudGeometry, this.cloudDepthMaterial);
    this.cloudColor = new THREE.Mesh(this.cloudGeometry, this.cloudColorMaterial);
    this.cloudDepth.renderOrder = ORDER_CLOUD_DEPTH;
    this.cloudColor.renderOrder = ORDER_CLOUD_COLOR;
    this.cloudDepth.frustumCulled = false;
    this.cloudColor.frustumCulled = false;
    this.cloudDepth.visible = false;
    this.cloudColor.visible = false;
    this.root.add(this.cloudDepth, this.cloudColor);

    // --- Pluie et neige ---
    this.precipTexture = makePrecipitationTexture();
    const precipGeometry = new THREE.BufferGeometry();
    this.precipPositionAttr = new THREE.BufferAttribute(this.precipPositions, 3).setUsage(THREE.DynamicDrawUsage);
    this.precipUvAttr = new THREE.BufferAttribute(this.precipUvs, 2).setUsage(THREE.DynamicDrawUsage);
    this.precipInfoAttr = new THREE.BufferAttribute(this.precipInfos, 2).setUsage(THREE.DynamicDrawUsage);
    precipGeometry.setAttribute('position', this.precipPositionAttr);
    precipGeometry.setAttribute('uv', this.precipUvAttr);
    precipGeometry.setAttribute('info', this.precipInfoAttr);
    const precipIndex = new Uint16Array(RAIN_COLUMNS * 6);
    for (let q = 0; q < RAIN_COLUMNS; q++) {
      const v = q * 4;
      const o = q * 6;
      precipIndex[o] = v;
      precipIndex[o + 1] = v + 1;
      precipIndex[o + 2] = v + 2;
      precipIndex[o + 3] = v;
      precipIndex[o + 4] = v + 2;
      precipIndex[o + 5] = v + 3;
    }
    precipGeometry.setIndex(new THREE.BufferAttribute(precipIndex, 1));
    precipGeometry.setDrawRange(0, 0);
    this.precip = new THREE.Mesh(
      precipGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this.precipTexture },
          uTint: { value: new THREE.Color(1, 1, 1) },
        },
        vertexShader: PRECIP_VERTEX,
        fragmentShader: PRECIP_FRAGMENT,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.precip.renderOrder = ORDER_PRECIPITATION;
    this.precip.frustumCulled = false;
    this.precip.visible = false;
    this.root.add(this.precip);

    scene.add(this.root);
  }

  /** ~1500 petits quads répartis sur la sphère céleste (graine fixe), comme Minecraft. */
  private static buildStarGeometry(): THREE.BufferGeometry {
    const rand = mulberry32(10842);
    const positions = new Float32Array(STAR_COUNT * 12);
    const brights = new Float32Array(STAR_COUNT * 4);
    const indices = new Uint16Array(STAR_COUNT * 6);
    let count = 0;
    while (count < STAR_COUNT) {
      const x = rand() * 2 - 1;
      const y = rand() * 2 - 1;
      const z = rand() * 2 - 1;
      const half = 0.15 + rand() * 0.1;
      const spin = rand() * TAU;
      const bright = 0.55 + rand() * 0.45;
      const d2 = x * x + y * y + z * z;
      if (d2 >= 1 || d2 <= 0.01) continue;
      const inv = 1 / Math.sqrt(d2);
      const nx = x * inv;
      const ny = y * inv;
      const nz = z * inv;
      // Base tangente (u, v) autour de la direction de l'étoile.
      let ux = -nz;
      let uy = 0;
      let uz = nx;
      let ul = Math.hypot(ux, uz);
      if (ul < 1e-4) {
        ux = 1;
        uz = 0;
        ul = 1;
      }
      ux /= ul;
      uz /= ul;
      const vx = ny * uz - nz * uy;
      const vy = nz * ux - nx * uz;
      const vz = nx * uy - ny * ux;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      for (let k = 0; k < 4; k++) {
        const a = (k === 0 || k === 3 ? -1 : 1) * half;
        const b = (k < 2 ? -1 : 1) * half;
        const ra = a * cs - b * sn;
        const rb = a * sn + b * cs;
        const o = (count * 4 + k) * 3;
        positions[o] = nx * CELESTIAL_DISTANCE + ux * ra + vx * rb;
        positions[o + 1] = ny * CELESTIAL_DISTANCE + uy * ra + vy * rb;
        positions[o + 2] = nz * CELESTIAL_DISTANCE + uz * ra + vz * rb;
        brights[count * 4 + k] = bright;
      }
      const v = count * 4;
      const i = count * 6;
      indices[i] = v;
      indices[i + 1] = v + 1;
      indices[i + 2] = v + 2;
      indices[i + 3] = v;
      indices[i + 4] = v + 2;
      indices[i + 5] = v + 3;
      count++;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('bright', new THREE.BufferAttribute(brights, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
  }

  /** Quad carré horizontal à la hauteur `y` (repère céleste), bords alignés sur x et z. */
  private static buildCelestialQuad(
    texture: THREE.Texture,
    half: number,
    y: number,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([-half, y, -half, half, y, -half, half, y, half, -half, y, half]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: texture },
          uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
          uOpacity: { value: 1 },
        },
        vertexShader: CELESTIAL_VERTEX,
        fragmentShader: CELESTIAL_FRAGMENT,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * À appeler à chaque image.
   * @param dt secondes écoulées
   * @param camera caméra du joueur (position monde)
   * @param timeOfDay tick dans la journée, 0..24000 : 0 = lever du soleil, 6000 = midi, 12000 = coucher, 18000 = minuit
   * @param rain intensité de la pluie 0..1 (interpolée par le moteur)
   * @param thunder intensité de l'orage 0..1
   * @param viewDistance distance de vue en blocs (le brouillard du terrain finit là)
   */
  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    timeOfDay: number,
    rain: number,
    thunder: number,
    viewDistance: number,
    nether = false,
  ): void {
    if (nether) {
      this.dayFactor = 0.25;
      const nr = 0x33 / 255;
      const ng = 0x08 / 255;
      const nb = 0x08 / 255;
      this.skyColor.setRGB(nr, ng, nb);
      this.fogColor.setRGB(nr, ng, nb);
      this.skyLight.setRGB(0.28, 0.2, 0.2);
      const dome = this.dome.material.uniforms;
      (dome.uSky.value as THREE.Color).setRGB(nr, ng, nb);
      (dome.uFog.value as THREE.Color).setRGB(nr, ng, nb);
      (dome.uVoid.value as THREE.Color).setRGB(0.1, 0.02, 0.02);
      dome.uSunsetAlpha.value = 0;
      this.sun.visible = false;
      this.moon.visible = false;
      this.stars.visible = false;
      this.cloudDepth.visible = false;
      this.cloudColor.visible = false;
      this.precip.visible = false;
      this.root.position.copy(camera.position);
      return;
    }
    rain = clamp01(rain);
    // Comme Minecraft : l'orage n'a d'effet qu'à la mesure de la pluie.
    thunder = clamp01(thunder) * rain;
    if (!(dt > 0)) dt = 0;

    // --- Heure ---
    const time = timeOfDay - Math.floor(timeOfDay / DAY_TICKS) * DAY_TICKS;
    if (this.lastTime >= 0 && time < this.lastTime - 6000) this.moonPhase = (this.moonPhase + 1) & 7;
    this.lastTime = time;
    const angle = celestialAngle(time);
    const cosA = Math.cos(angle * TAU);
    const day = clamp01(cosA * 2 + 0.5);
    this.dayFactor = day;

    // --- Éclair ---
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const e = FLASH_TIME - this.flashTimer;
      if (this.flashTimer <= 0) this.flash = 0;
      else if (e < 0.1) this.flash = 1 - (e / 0.1) * 0.6;
      else if (e < 0.14) this.flash = 0.4 + ((e - 0.1) / 0.04) * 0.5;
      else this.flash = 0.9 * (1 - (e - 0.14) / 0.16);
    } else {
      this.flash = 0;
    }
    const flash = clamp01(this.flash);

    // --- Lueur du lever / coucher (formule de Minecraft, éteinte par la pluie) ---
    let sunsetAlpha = 0;
    let sunsetR = 1;
    let sunsetG = 0.48;
    let sunsetB = 0.165;
    if (cosA >= -0.4 && cosA <= 0.4) {
      const f = (cosA / 0.4) * 0.5 + 0.5;
      const a = 1 - (1 - Math.sin(f * Math.PI)) * 0.99;
      sunsetAlpha = a * a * (1 - rain * 0.9);
      sunsetR = f * 0.25 + 0.75;
      sunsetG = f * f * 0.62 + 0.3;
      sunsetB = 0.16 + f * f * 0.06;
    }
    const sunSide = Math.sin(angle * TAU) > 0 ? -1 : 1;

    // --- Couleurs du ciel et du brouillard ---
    let skyR = lerp(SKY_NIGHT.r, SKY_DAY.r, day);
    let skyG = lerp(SKY_NIGHT.g, SKY_DAY.g, day);
    let skyB = lerp(SKY_NIGHT.b, SKY_DAY.b, day);
    let fogR = lerp(FOG_NIGHT.r, FOG_DAY.r, day);
    let fogG = lerp(FOG_NIGHT.g, FOG_DAY.g, day);
    let fogB = lerp(FOG_NIGHT.b, FOG_DAY.b, day);

    // Pluie : vers le gris ; orage : plus sombre encore.
    const grayScale = day * 0.94 + 0.06;
    const wet = rain * 0.92;
    skyR = lerp(skyR, RAIN_GRAY.r * grayScale * 0.9, wet);
    skyG = lerp(skyG, RAIN_GRAY.g * grayScale * 0.9, wet);
    skyB = lerp(skyB, RAIN_GRAY.b * grayScale * 0.9, wet);
    fogR = lerp(fogR, RAIN_GRAY.r * grayScale, wet);
    fogG = lerp(fogG, RAIN_GRAY.g * grayScale, wet);
    fogB = lerp(fogB, RAIN_GRAY.b * grayScale, wet);
    const storm = 1 - thunder * 0.5;
    skyR *= storm;
    skyG *= storm;
    skyB *= storm;
    fogR *= storm;
    fogG *= storm;
    fogB *= storm;

    // Petite distance de vue : le brouillard tire vers la couleur du ciel (comme Minecraft).
    const chunks = Math.min(Math.max(viewDistance, 16) / 16, 32);
    const nearBlend = 1 - Math.pow(0.25 + (0.75 * chunks) / 32, 0.25);
    fogR += (skyR - fogR) * nearBlend;
    fogG += (skyG - fogG) * nearBlend;
    fogB += (skyB - fogB) * nearBlend;

    // Éclair : tout le ciel s'éclaircit.
    if (flash > 0) {
      const k = flash * 0.55;
      skyR = lerp(skyR, FLASH_TINT.r, k);
      skyG = lerp(skyG, FLASH_TINT.g, k);
      skyB = lerp(skyB, FLASH_TINT.b, k);
      fogR = lerp(fogR, FLASH_TINT.r, k);
      fogG = lerp(fogG, FLASH_TINT.g, k);
      fogB = lerp(fogB, FLASH_TINT.b, k);
    }

    this.skyColor.r = skyR;
    this.skyColor.g = skyG;
    this.skyColor.b = skyB;

    const dome = this.dome.material.uniforms;
    const uSky = dome.uSky.value as THREE.Color;
    const uFog = dome.uFog.value as THREE.Color;
    const uVoid = dome.uVoid.value as THREE.Color;
    const uSunset = dome.uSunset.value as THREE.Color;
    const uSunsetHigh = dome.uSunsetHigh.value as THREE.Color;
    uSky.r = skyR;
    uSky.g = skyG;
    uSky.b = skyB;
    uFog.r = fogR;
    uFog.g = fogG;
    uFog.b = fogB;
    uVoid.r = fogR * 0.66;
    uVoid.g = fogG * 0.68;
    uVoid.b = fogB * 0.76;
    uSunset.r = sunsetR;
    uSunset.g = sunsetG;
    uSunset.b = sunsetB;
    // Plus haut et plus loin du soleil, la lueur tire vers le rose.
    uSunsetHigh.r = sunsetR;
    uSunsetHigh.g = sunsetG * 0.72 + 0.14;
    uSunsetHigh.b = sunsetB + 0.36;
    dome.uSunsetAlpha.value = sunsetAlpha;
    dome.uSunSide.value = sunSide;
    dome.uBand.value = Math.min(0.3, Math.max(0.07, 16 / (0.8 * Math.max(viewDistance, 16))));

    // Brouillard du terrain : teinté par le couchant quand on regarde vers le soleil (comme Minecraft).
    camera.getWorldDirection(this.look);
    const facing = Math.max(0, this.look.x * sunSide) * sunsetAlpha;
    this.fogColor.r = lerp(fogR, sunsetR, facing);
    this.fogColor.g = lerp(fogG, sunsetG, facing);
    this.fogColor.b = lerp(fogB, sunsetB, facing);

    // --- Lumière du ciel pour le terrain ---
    const weatherLight = lerp(lerp(1, 0.65, rain), 0.45, thunder);
    const nightDim = 1 - rain * 0.15 - thunder * 0.1;
    const warm = sunsetAlpha * 0.55;
    let lightR = lerp(LIGHT_NIGHT.r * nightDim, weatherLight, day);
    let lightG = lerp(LIGHT_NIGHT.g * nightDim, weatherLight * lerp(1, 0.86, warm), day);
    let lightB = lerp(LIGHT_NIGHT.b * nightDim, weatherLight * lerp(1, 0.7, warm), day);
    if (flash > 0) {
      const k = flash * 0.7;
      lightR = lerp(lightR, 1, k);
      lightG = lerp(lightG, 1, k);
      lightB = lerp(lightB, 1, k);
    }
    this.skyLight.r = lightR;
    this.skyLight.g = lightG;
    this.skyLight.b = lightB;

    // --- Astres ---
    this.celestial.rotation.z = angle * TAU;
    const sunHeight = cosA;
    const clear = 1 - rain;
    const sunOpacity = clear * smoothstep(-0.34, -0.12, sunHeight);
    this.sun.visible = sunOpacity > 0.002;
    this.sun.material.uniforms.uOpacity.value = sunOpacity;
    const moonOpacity = clear * smoothstep(-0.26, -0.08, -sunHeight);
    this.moon.visible = moonOpacity > 0.002;
    this.moon.material.uniforms.uOpacity.value = moonOpacity;
    const phase = ((Math.floor(this.moonPhase) % 8) + 8) % 8;
    (this.moon.material.uniforms.uUvRect.value as THREE.Vector4).set((phase % 4) * 0.25, phase < 4 ? 0 : 0.5, 0.25, 0.5);

    const starLevel = 1 - clamp01(cosA * 2 + 0.25);
    const starAlpha = starLevel * starLevel * 0.62 * clear * (1 - flash);
    this.stars.visible = starAlpha > 0.002;
    this.stars.material.uniforms.uAlpha.value = starAlpha;

    // --- Nuages ---
    this.updateClouds(dt, camera, viewDistance, day, rain, thunder, sunsetAlpha, flash);

    // --- Pluie et neige ---
    this.updatePrecipitation(dt, camera, rain, lightR, lightG, lightB);
  }

  /** Déclenche un éclair (flash du ciel pendant ~0,3 s). */
  lightning(): void {
    this.flashTimer = FLASH_TIME;
    this.flash = 1;
  }

  /** Affiche ou masque les nuages. */
  setCloudsVisible(v: boolean): void {
    this.cloudsVisible = v;
    if (!v) {
      this.cloudDepth.visible = false;
      this.cloudColor.visible = false;
    }
  }

  /** Affiche ou masque tout le ciel (tête sous l'eau ou dans la lave : seul le brouillard reste). */
  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.sun.geometry.dispose();
    this.sun.material.dispose();
    this.moon.geometry.dispose();
    this.moon.material.dispose();
    this.sunTexture.dispose();
    this.moonTexture.dispose();
    this.cloudGeometry.dispose();
    this.cloudDepthMaterial.dispose();
    this.cloudColorMaterial.dispose();
    this.precip.geometry.dispose();
    this.precip.material.dispose();
    this.precipTexture.dispose();
  }

  // -------------------------------------------------------------------------------------------
  // Nuages
  // -------------------------------------------------------------------------------------------

  private updateClouds(
    dt: number,
    camera: THREE.PerspectiveCamera,
    viewDistance: number,
    day: number,
    rain: number,
    thunder: number,
    sunsetAlpha: number,
    flash: number,
  ): void {
    // La dérive continue même nuages masqués, pour rester cohérente à la réactivation.
    const period = CLOUD_GRID * CLOUD_CELL;
    this.cloudDrift += dt * CLOUD_SPEED;
    if (this.cloudDrift >= period) this.cloudDrift -= Math.floor(this.cloudDrift / period) * period;
    if (!this.cloudsVisible) return;

    const radius = Math.min(CLOUD_MAX_RADIUS, Math.max(viewDistance * 1.5, CLOUD_MIN_RADIUS));
    const radiusCells = Math.ceil(radius / CLOUD_CELL);
    // Le motif glisse vers l'ouest : la cellule i couvre x ∈ [i·12 − dérive, (i+1)·12 − dérive].
    const offset = -this.cloudDrift;
    const cellX = Math.floor((camera.position.x - offset) / CLOUD_CELL);
    const cellZ = Math.floor(camera.position.z / CLOUD_CELL);
    if (cellX !== this.cloudCellX || cellZ !== this.cloudCellZ || radiusCells !== this.cloudRadiusCells) {
      this.rebuildClouds(cellX, cellZ, radiusCells);
    }
    const visible = this.cloudCursor > 0;
    this.cloudDepth.visible = visible;
    this.cloudColor.visible = visible;
    const x = cellX * CLOUD_CELL + offset;
    const z = cellZ * CLOUD_CELL;
    this.cloudDepth.position.set(x, CLOUD_Y, z);
    this.cloudColor.position.set(x, CLOUD_Y, z);

    // Couleur (formule de Minecraft) : grise sous la pluie, sombre la nuit, rosée au couchant.
    let r = 1;
    let g = 1;
    let b = 1;
    const rainKeep = 1 - rain * 0.95;
    r = r * rainKeep + 0.6 * (1 - rainKeep);
    g = g * rainKeep + 0.6 * (1 - rainKeep);
    b = b * rainKeep + 0.6 * (1 - rainKeep);
    // Au couchant, les nuages restent éclairés par en dessous au lieu de s'éteindre avec le jour.
    const lit = lerp(day, 1, sunsetAlpha * 0.6);
    r *= lit * 0.9 + 0.1;
    g *= lit * 0.9 + 0.1;
    b *= lit * 0.85 + 0.15;
    const stormGray = (r * 0.3 + g * 0.59 + b * 0.11) * 0.2;
    const stormKeep = 1 - thunder * 0.95;
    r = r * stormKeep + stormGray * (1 - stormKeep);
    g = g * stormKeep + stormGray * (1 - stormKeep);
    b = b * stormKeep + stormGray * (1 - stormKeep);
    const pink = sunsetAlpha * 0.85;
    g *= lerp(1, 0.72, pink);
    b *= lerp(1, 0.68, pink);
    if (flash > 0) {
      const k = flash * 0.5;
      r = lerp(r, 1, k);
      g = lerp(g, 1, k);
      b = lerp(b, 1, k);
    }
    const uniforms = this.cloudColorMaterial.uniforms;
    const color = uniforms.uColor.value as THREE.Color;
    color.r = r;
    color.g = g;
    color.b = b;
    uniforms.uFar.value = radiusCells * CLOUD_CELL;
  }

  private cloudAt(x: number, z: number): number {
    return this.cloudPattern[((z & CLOUD_GRID_MASK) << 7) | (x & CLOUD_GRID_MASK)];
  }

  /** Reconstruit le maillage des nuages autour de la cellule (cellX, cellZ) : faces extérieures seulement. */
  private rebuildClouds(cellX: number, cellZ: number, radiusCells: number): void {
    this.cloudCellX = cellX;
    this.cloudCellZ = cellZ;
    this.cloudRadiusCells = radiusCells;
    const r2 = radiusCells * radiusCells;

    // Première passe : nombre de faces, pour dimensionner les tampons (réalloués seulement s'ils sont trop petits).
    let quads = 0;
    for (let j = -radiusCells; j <= radiusCells; j++) {
      for (let i = -radiusCells; i <= radiusCells; i++) {
        if (i * i + j * j > r2) continue;
        const x = cellX + i;
        const z = cellZ + j;
        if (!this.cloudAt(x, z)) continue;
        quads += 2;
        if (!this.cloudAt(x - 1, z)) quads++;
        if (!this.cloudAt(x + 1, z)) quads++;
        if (!this.cloudAt(x, z - 1)) quads++;
        if (!this.cloudAt(x, z + 1)) quads++;
      }
    }
    this.ensureCloudCapacity(quads);

    // Seconde passe : écriture. Aucune face entre deux cellules de nuage voisines.
    this.cloudCursor = 0;
    const s = CLOUD_CELL;
    const t = CLOUD_THICKNESS;
    for (let j = -radiusCells; j <= radiusCells; j++) {
      for (let i = -radiusCells; i <= radiusCells; i++) {
        if (i * i + j * j > r2) continue;
        const x = cellX + i;
        const z = cellZ + j;
        if (!this.cloudAt(x, z)) continue;
        const x0 = i * s;
        const x1 = x0 + s;
        const z0 = j * s;
        const z1 = z0 + s;
        // Dessus (+y) et dessous (−y).
        this.pushCloudQuad(x0, t, z0, x0, t, z1, x1, t, z1, x1, t, z0, CLOUD_SHADE_TOP);
        this.pushCloudQuad(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1, CLOUD_SHADE_BOTTOM);
        // Côtés.
        if (!this.cloudAt(x - 1, z)) this.pushCloudQuad(x0, 0, z0, x0, 0, z1, x0, t, z1, x0, t, z0, CLOUD_SHADE_X);
        if (!this.cloudAt(x + 1, z)) this.pushCloudQuad(x1, 0, z1, x1, 0, z0, x1, t, z0, x1, t, z1, CLOUD_SHADE_X);
        if (!this.cloudAt(x, z - 1)) this.pushCloudQuad(x1, 0, z0, x0, 0, z0, x0, t, z0, x1, t, z0, CLOUD_SHADE_Z);
        if (!this.cloudAt(x, z + 1)) this.pushCloudQuad(x0, 0, z1, x1, 0, z1, x1, t, z1, x0, t, z1, CLOUD_SHADE_Z);
      }
    }
    const geometry = this.cloudGeometry;
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('shade') as THREE.BufferAttribute).needsUpdate = true;
    geometry.setDrawRange(0, this.cloudCursor * 6);
  }

  private ensureCloudCapacity(quads: number): void {
    if (quads <= this.cloudCapacity) return;
    const capacity = Math.ceil(quads * 1.3) + 256;
    this.cloudCapacity = capacity;
    this.cloudPositions = new Float32Array(capacity * 12);
    this.cloudShades = new Float32Array(capacity * 4);
    const indices = new Uint32Array(capacity * 6);
    for (let q = 0; q < capacity; q++) {
      const v = q * 4;
      const o = q * 6;
      indices[o] = v;
      indices[o + 1] = v + 1;
      indices[o + 2] = v + 2;
      indices[o + 3] = v;
      indices[o + 4] = v + 2;
      indices[o + 5] = v + 3;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.cloudPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute('shade', new THREE.BufferAttribute(this.cloudShades, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.cloudGeometry.dispose();
    this.cloudGeometry = geometry;
    this.cloudDepth.geometry = geometry;
    this.cloudColor.geometry = geometry;
  }

  private pushCloudQuad(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    dx: number,
    dy: number,
    dz: number,
    shade: number,
  ): void {
    const q = this.cloudCursor++;
    const p = this.cloudPositions;
    let o = q * 12;
    p[o++] = ax;
    p[o++] = ay;
    p[o++] = az;
    p[o++] = bx;
    p[o++] = by;
    p[o++] = bz;
    p[o++] = cx;
    p[o++] = cy;
    p[o++] = cz;
    p[o++] = dx;
    p[o++] = dy;
    p[o] = dz;
    const s = this.cloudShades;
    const v = q * 4;
    s[v] = shade;
    s[v + 1] = shade;
    s[v + 2] = shade;
    s[v + 3] = shade;
  }

  // -------------------------------------------------------------------------------------------
  // Pluie et neige
  // -------------------------------------------------------------------------------------------

  private updatePrecipitation(
    dt: number,
    camera: THREE.PerspectiveCamera,
    rain: number,
    lightR: number,
    lightG: number,
    lightB: number,
  ): void {
    if (rain <= 0.002) {
      this.precip.visible = false;
      return;
    }
    this.precipTime += dt;
    const time = this.precipTime;
    const camX = Math.floor(camera.position.x);
    const camY = Math.floor(camera.position.y);
    const camZ = Math.floor(camera.position.z);

    // Hauteurs et biomes des colonnes : relus quand la caméra change de colonne, sinon 4 fois par seconde.
    this.columnCacheAge += dt;
    if (camX !== this.columnCacheX || camZ !== this.columnCacheZ || this.columnCacheAge >= 0.25) {
      this.columnCacheX = camX;
      this.columnCacheZ = camZ;
      this.columnCacheAge = 0;
      let c = 0;
      for (let dz = -RAIN_RADIUS; dz <= RAIN_RADIUS; dz++) {
        for (let dx = -RAIN_RADIUS; dx <= RAIN_RADIUS; dx++, c++) {
          this.columnHeights[c] = this.env.rainHeight(camX + dx, camZ + dz);
          this.columnSnowy[c] = this.env.isSnowy(camX + dx, camZ + dz) ? 1 : 0;
        }
      }
    }

    const positions = this.precipPositions;
    const uvs = this.precipUvs;
    const infos = this.precipInfos;
    const yMin = camY - RAIN_RADIUS;
    const yMax = camY + RAIN_RADIUS;
    const invR2 = 1 / (RAIN_RADIUS * RAIN_RADIUS);
    let quads = 0;
    let c = 0;
    for (let dz = -RAIN_RADIUS; dz <= RAIN_RADIUS; dz++) {
      for (let dx = -RAIN_RADIUS; dx <= RAIN_RADIUS; dx++, c++) {
        const d2 = dx * dx + dz * dz;
        // La colonne de la caméra n'a pas d'orientation définie (Minecraft ne la dessine pas non plus).
        if (d2 === 0) continue;
        const top = this.columnHeights[c];
        const y0 = top > yMin ? top : yMin;
        const y1 = top > yMax ? top : yMax;
        if (y1 <= y0) continue;
        const snowy = this.columnSnowy[c];
        const falloff = 1 - d2 * invR2;
        const alpha = (snowy ? falloff * 0.3 + 0.5 : falloff * 0.5 + 0.5) * rain;
        if (alpha <= 0.004) continue;

        // Quad face à la caméra autour de l'axe y (perpendiculaire à la direction caméra → colonne).
        const inv = 0.5 / Math.sqrt(d2);
        const rx = -dz * inv;
        const rz = dx * inv;
        const xa = dx + 0.5 - rx;
        const za = dz + 0.5 - rz;
        const xb = dx + 0.5 + rx;
        const zb = dz + 0.5 + rz;

        // Défilement : vitesse et phase propres à chaque colonne.
        const wx = camX + dx;
        const wz = camZ + dz;
        const h1 = hashColumn(wx, wz, 1);
        const h2 = hashColumn(wx, wz, 2);
        let u0 = 0;
        let scroll: number;
        if (snowy) {
          // Flocons : ~0,5 à 0,9 bloc/s, avec une lente dérive latérale.
          scroll = time * (0.13 + h1 * 0.09) + h2;
          u0 = h1 * 7 + time * 0.05 * (h2 - 0.5);
          u0 -= Math.floor(u0);
        } else {
          // Pluie : 7,5 à 10 blocs/s (un tour de texture = 4 blocs).
          scroll = time * (1.875 + h1 * 0.625) + h2;
        }
        scroll -= Math.floor(scroll);
        const base = y0 * 0.25;
        const v0 = base - Math.floor(base) + scroll;
        const v1 = v0 + (y1 - y0) * 0.25;

        let p = quads * 12;
        positions[p++] = xa;
        positions[p++] = y0;
        positions[p++] = za;
        positions[p++] = xb;
        positions[p++] = y0;
        positions[p++] = zb;
        positions[p++] = xb;
        positions[p++] = y1;
        positions[p++] = zb;
        positions[p++] = xa;
        positions[p++] = y1;
        positions[p] = za;
        let t = quads * 8;
        uvs[t] = u0;
        uvs[t + 1] = v0;
        uvs[t + 2] = u0 + 1;
        uvs[t + 3] = v0;
        uvs[t + 4] = u0 + 1;
        uvs[t + 5] = v1;
        uvs[t + 6] = u0;
        uvs[t + 7] = v1;
        t = quads * 8;
        infos[t] = alpha;
        infos[t + 1] = snowy;
        infos[t + 2] = alpha;
        infos[t + 3] = snowy;
        infos[t + 4] = alpha;
        infos[t + 5] = snowy;
        infos[t + 6] = alpha;
        infos[t + 7] = snowy;
        quads++;
      }
    }

    if (quads === 0) {
      this.precip.visible = false;
      return;
    }
    this.precip.visible = true;
    this.precip.position.set(camX, 0, camZ);
    this.precipPositionAttr.needsUpdate = true;
    this.precipUvAttr.needsUpdate = true;
    this.precipInfoAttr.needsUpdate = true;
    this.precip.geometry.setDrawRange(0, quads * 6);
    // Éclairée par le ciel, avec un plancher pour rester lisible la nuit.
    const tint = this.precip.material.uniforms.uTint.value as THREE.Color;
    tint.r = lightR * 0.88 + 0.12;
    tint.g = lightG * 0.88 + 0.12;
    tint.b = lightB * 0.88 + 0.12;
  }
}
