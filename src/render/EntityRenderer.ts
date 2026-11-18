/**
 * Affichage des entités : créatures, joueur à la troisième personne, objets au sol,
 * blocs qui tombent, TNT amorcée, flèches et flotteur de pêche.
 *
 * Ce fichier exporte aussi les briques partagées avec `HandRenderer` et `ItemIcons` :
 * sprite extrudé (`buildSpriteGeometry`), modèle d'objet (`ItemModel`), géométries et
 * matériau des créatures (`getMobAssets`, `createMobMaterial`).
 *
 * Rappels du moteur : pas de gestion des couleurs (valeurs « écran »), aucune lumière three.js,
 * 1 unité = 1 bloc, +y vers le haut, lacet 0 = regard vers −z.
 */
import * as THREE from 'three';
import type { Atlas } from './Atlas';
import { createModelMaterial, lightColor, passGeometry, worldUniforms } from './ChunkMaterials';
import type { EntityView } from '../entity/EntityView';
import {
  DRAGON_NECK_SEGMENTS, DRAGON_TAIL_SEGMENTS, DRAGON_WING_SPAN, getHorseModel, getMobModel, getOcelotModel, getSheepModel, getVillagerModel,
  getWolfModel, type MobKind, type MobModel,
} from '../entity/MobModels';
import { BLOCKS, TINT } from '../world/Blocks';
import { B, BLOCK_ID_LIMIT, I } from '../world/Ids';
import { getItem } from '../world/Items';
import { buildBlockModel } from '../world/mesh/ChunkMesher';
import { T, TILE_SIZE } from '../world/Tiles';

const PX = 1 / 16;
const PI = Math.PI;
const HALF_PI = Math.PI / 2;

/** Teintes par défaut (identiques à celles de `buildBlockModel`). */
const DEFAULT_GRASS_TINT = 0x91bd59;
const DEFAULT_FOLIAGE_TINT = 0x77ab2f;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Ramène un angle dans [−π, π]. */
function wrapAngle(a: number): number {
  a = (a + PI) % (2 * PI);
  if (a < 0) a += 2 * PI;
  return a - PI;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/**
 * Pile de transformations façon OpenGL : chaque appel multiplie à droite, comme
 * `glTranslate` / `glRotate` / `glScale` (angles en degrés). Sert à porter fidèlement
 * les enchaînements de Minecraft (objet tenu, main à la première personne).
 */
export class MatrixChain {
  readonly matrix = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();

  identity(): this {
    this.matrix.identity();
    return this;
  }

  translate(x: number, y: number, z: number): this {
    this.matrix.multiply(this.tmp.makeTranslation(x, y, z));
    return this;
  }

  rotateX(degrees: number): this {
    this.matrix.multiply(this.tmp.makeRotationX((degrees * PI) / 180));
    return this;
  }

  rotateY(degrees: number): this {
    this.matrix.multiply(this.tmp.makeRotationY((degrees * PI) / 180));
    return this;
  }

  rotateZ(degrees: number): this {
    this.matrix.multiply(this.tmp.makeRotationZ((degrees * PI) / 180));
    return this;
  }

  scale(x: number, y = x, z = x): this {
    this.matrix.multiply(this.tmp.makeScale(x, y, z));
    return this;
  }
}

// ---------------------------------------------------------------------------------------------
// Sprite extrudé (objets plats tenus en main ou posés au sol)
// ---------------------------------------------------------------------------------------------

/**
 * Teinte à appliquer à la tuile plate d'un objet (herbe haute, fougère, lianes…) ; 0xffffff sinon.
 */
export function itemTint(itemId: number): number {
  if (itemId <= 0 || itemId >= BLOCK_ID_LIMIT) return 0xffffff;
  const d = BLOCKS[itemId];
  if (!d) return 0xffffff;
  if (d.tint === TINT.GRASS) return DEFAULT_GRASS_TINT;
  if (d.tint === TINT.FOLIAGE) return DEFAULT_FOLIAGE_TINT;
  if (d.tint === TINT.FIXED) return d.tintColor;
  return 0xffffff;
}

/**
 * Construit le sprite extrudé d'une tuile 16×16 : deux faces texturées (avant +z, arrière −z)
 * et un petit quad latéral pour chaque bord de pixel opaque.
 *
 * Le sprite est centré sur l'origine : x et y dans [−0,5 ; 0,5] (haut de la tuile en +y, gauche en −x),
 * épaisseur 1/16 selon z. La géométrie porte les attributs du matériau des modèles
 * (`createModelMaterial`) : `uvl` (couche = tuile, surcouche = −1), `tint` (teinte + ombrage),
 * `light` (drapeau « sans mipmap » = 255).
 */
export function buildSpriteGeometry(atlas: Atlas, tile: number, tint = 0xffffff): THREE.BufferGeometry {
  const px = atlas.tilePixels(tile);
  const n = TILE_SIZE;
  const s = 1 / n;
  const t = s / 2;
  const tr = (tint >> 16) & 255;
  const tg = (tint >> 8) & 255;
  const tb = tint & 255;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const lit: number[] = [];
  const idx: number[] = [];

  const vertex = (x: number, y: number, z: number, u: number, v: number, shade: number): void => {
    pos.push(x, y, z);
    uv.push(u, v, tile, -1);
    col.push(tr, tg, tb, shade);
    lit.push(255, 0, 255, 0);
  };
  const quad = (): void => {
    const b = pos.length / 3 - 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const opaque = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && px[(y * n + x) * 4 + 3] >= 128;

  // Face avant (+z) : la tuile telle quelle
  vertex(-0.5, -0.5, t, 0, 1, 255);
  vertex(0.5, -0.5, t, 1, 1, 255);
  vertex(0.5, 0.5, t, 1, 0, 255);
  vertex(-0.5, 0.5, t, 0, 0, 255);
  quad();
  // Face arrière (−z) : la même image vue de dos (donc en miroir à l'écran)
  vertex(0.5, -0.5, -t, 1, 1, 215);
  vertex(-0.5, -0.5, -t, 0, 1, 215);
  vertex(-0.5, 0.5, -t, 0, 0, 215);
  vertex(0.5, 0.5, -t, 1, 0, 215);
  quad();

  // Tranches : un quad par bord de pixel opaque donnant sur un pixel transparent
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!opaque(x, y)) continue;
      const x0 = x * s - 0.5;
      const x1 = x0 + s;
      const y1 = 0.5 - y * s;
      const y0 = y1 - s;
      const u = (x + 0.5) * s;
      const v = (y + 0.5) * s;
      if (!opaque(x - 1, y)) {
        vertex(x0, y0, -t, u, v, 170);
        vertex(x0, y0, t, u, v, 170);
        vertex(x0, y1, t, u, v, 170);
        vertex(x0, y1, -t, u, v, 170);
        quad();
      }
      if (!opaque(x + 1, y)) {
        vertex(x1, y0, t, u, v, 170);
        vertex(x1, y0, -t, u, v, 170);
        vertex(x1, y1, -t, u, v, 170);
        vertex(x1, y1, t, u, v, 170);
        quad();
      }
      if (!opaque(x, y - 1)) {
        vertex(x0, y1, t, u, v, 235);
        vertex(x1, y1, t, u, v, 235);
        vertex(x1, y1, -t, u, v, 235);
        vertex(x0, y1, -t, u, v, 235);
        quad();
      }
      if (!opaque(x, y + 1)) {
        vertex(x0, y0, -t, u, v, 140);
        vertex(x1, y0, -t, u, v, 140);
        vertex(x1, y0, t, u, v, 140);
        vertex(x0, y0, t, u, v, 140);
        quad();
      }
    }
  }

  return passGeometry({
    positions: new Float32Array(pos),
    uvs: new Float32Array(uv),
    colors: new Uint8Array(col),
    lights: new Uint8Array(lit),
    indices: new Uint32Array(idx),
  });
}

/** Sprites extrudés déjà construits, par atlas puis par (tuile, teinte). */
const spriteCache = new WeakMap<Atlas, Map<number, THREE.BufferGeometry>>();

/** Sprite extrudé d'une tuile, mis en cache (ne pas le libérer soi-même). */
export function getSpriteGeometry(atlas: Atlas, tile: number, tint = 0xffffff): THREE.BufferGeometry {
  let map = spriteCache.get(atlas);
  if (!map) {
    map = new Map();
    spriteCache.set(atlas, map);
  }
  const key = tile * 0x1000000 + tint;
  let g = map.get(key);
  if (!g) {
    g = buildSpriteGeometry(atlas, tile, tint);
    map.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Modèles de blocs isolés
// ---------------------------------------------------------------------------------------------

export interface BlockGeometries {
  opaque: THREE.BufferGeometry | null;
  translucent: THREE.BufferGeometry | null;
}

const blockGeometryCache = new Map<number, BlockGeometries>();

function centeredPass(p: ReturnType<typeof buildBlockModel>['opaque']): THREE.BufferGeometry | null {
  if (!p) return null;
  const positions = p.positions;
  for (let i = 0; i < positions.length; i++) positions[i] -= 0.5;
  return passGeometry(p);
}

/**
 * Géométries d'un bloc isolé (`buildBlockModel`), recentrées sur l'origine (cube [−0,5 ; 0,5]³), en cache.
 */
export function getBlockGeometries(blockId: number, meta: number): BlockGeometries {
  const key = (blockId & 0xffff) | ((meta & 0xff) << 16);
  let g = blockGeometryCache.get(key);
  if (!g) {
    const model = buildBlockModel(blockId, meta);
    g = { opaque: centeredPass(model.opaque), translucent: centeredPass(model.translucent) };
    blockGeometryCache.set(key, g);
  }
  return g;
}

/** L'objet s'affiche-t-il comme un bloc 3D (sinon : tuile plate / sprite extrudé) ? */
export function isBlockItem(itemId: number): boolean {
  return itemId > 0 && getItem(itemId).tile < 0;
}

/** L'objet se tient comme un outil (manche dans le poing) plutôt que présenté à plat. */
export function isHandheldItem(itemId: number): boolean {
  return getItem(itemId).tool !== null || itemId === I.STICK || itemId === I.BONE || itemId === I.BOW || itemId === I.FISHING_ROD;
}

/**
 * Modèle d'un objet ou d'un bloc isolé : géométries partagées (en cache) et matériaux propres à l'instance.
 * - bloc 3D : cube unité centré sur l'origine ;
 * - objet plat : sprite extrudé centré (1 × 1 × 1/16), face avant vers +z.
 */
export class ItemModel {
  /** true : bloc 3D ; false : sprite extrudé. */
  readonly isBlock: boolean;
  readonly materials: THREE.ShaderMaterial[] = [];
  private readonly entries: Array<{ geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial }> = [];

  private constructor(atlas: Atlas, isBlock: boolean, opaque: THREE.BufferGeometry | null, translucent: THREE.BufferGeometry | null) {
    this.isBlock = isBlock;
    if (opaque) {
      const material = createModelMaterial(atlas.texture);
      this.materials.push(material);
      this.entries.push({ geometry: opaque, material });
    }
    if (translucent) {
      const material = createModelMaterial(atlas.texture, { translucent: true });
      this.materials.push(material);
      this.entries.push({ geometry: translucent, material });
    }
  }

  /** Modèle d'un objet d'inventaire : mini-bloc si `getItem(id).tile < 0`, sprite extrudé sinon. */
  static forItem(atlas: Atlas, itemId: number): ItemModel {
    const def = getItem(itemId);
    if (def.tile < 0) return ItemModel.forBlock(atlas, def.places >= 0 ? def.places : itemId, 0);
    return ItemModel.forTile(atlas, def.tile, itemTint(itemId));
  }

  /** Modèle d'un bloc (bloc qui tombe, TNT…). */
  static forBlock(atlas: Atlas, blockId: number, meta: number): ItemModel {
    const g = getBlockGeometries(blockId, meta);
    return new ItemModel(atlas, true, g.opaque, g.translucent);
  }

  /** Sprite extrudé d'une tuile quelconque. */
  static forTile(atlas: Atlas, tile: number, tint = 0xffffff): ItemModel {
    return new ItemModel(atlas, false, getSpriteGeometry(atlas, tile, tint), null);
  }

  /** Nouveau groupe de maillages (géométries et matériaux partagés entre les instances du modèle). */
  instance(): THREE.Group {
    const group = new THREE.Group();
    for (const entry of this.entries) group.add(new THREE.Mesh(entry.geometry, entry.material));
    return group;
  }

  /** Niveaux de lumière 0..15 (la couleur du ciel vient de `worldUniforms.uSkyLight`). */
  setLight(sky: number, block: number): void {
    for (const m of this.materials) (m.uniforms.uLight.value as THREE.Vector2).set(sky / 15, block / 15);
  }

  setColor(r: number, g: number, b: number): void {
    for (const m of this.materials) (m.uniforms.uColor.value as THREE.Color).setRGB(r, g, b);
  }

  /**
   * Détache les matériaux des uniformes du monde : plus de brouillard et, si `whiteSky`,
   * lumière du ciel blanche (icônes d'inventaire).
   */
  detachFromWorld(whiteSky: boolean): void {
    for (const m of this.materials) {
      m.uniforms.uFogNear = { value: 1e6 };
      m.uniforms.uFogFar = { value: 2e6 };
      if (whiteSky) m.uniforms.uSkyLight = { value: new THREE.Color(1, 1, 1) };
    }
  }

  /** Libère les matériaux (les géométries restent en cache). */
  dispose(): void {
    for (const m of this.materials) m.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Créatures : géométrie des boîtes, textures, matériau
// ---------------------------------------------------------------------------------------------

export interface MobPart {
  name: string;
  /** Pivot en blocs, dans l'espace du modèle. */
  pivot: THREE.Vector3;
  /** Boîtes de la partie, en blocs, relatives au pivot. */
  geometry: THREE.BufferGeometry;
}

export interface MobAssets {
  model: MobModel;
  texture: THREE.DataTexture;
  parts: MobPart[];
}

const mobAssetsCache = new Map<MobModel, MobAssets>();

/** Ajoute une boîte dépliée façon Minecraft (voir l'en-tête de MobModels). */
function pushBox(
  pos: number[], uvs: number[], nrm: number[], idx: number[],
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  u: number, v: number, w: number, h: number, d: number, texW: number, texH: number,
): void {
  // Un quad : 4 sommets (bas-gauche, bas-droite, haut-droite, haut-gauche vus de l'extérieur) et son rectangle de texture
  const face = (
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    ua: number, va: number, ub: number, vb: number, uc: number, vc: number, ud: number, vd: number,
    nx: number, ny: number, nz: number,
  ): void => {
    const base = pos.length / 3;
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    uvs.push(ua / texW, va / texH, ub / texW, vb / texH, uc / texW, vc / texH, ud / texW, vd / texH);
    nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  let U0: number;
  let U1: number;
  let V0: number;
  let V1: number;
  // Avant (+z) : u de −x vers +x
  U0 = u + d; U1 = U0 + w; V0 = v + d; V1 = V0 + h;
  face(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, U0, V1, U1, V1, U1, V0, U0, V0, 0, 0, 1);
  // Côté +x : u de +z vers −z
  U0 = u + d + w; U1 = U0 + d;
  face(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, U0, V1, U1, V1, U1, V0, U0, V0, 1, 0, 0);
  // Arrière (−z) : u de +x vers −x
  U0 = u + d + w + d; U1 = U0 + w;
  face(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, U0, V1, U1, V1, U1, V0, U0, V0, 0, 0, -1);
  // Côté −x : u de −z vers +z
  U0 = u; U1 = U0 + d;
  face(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, U0, V1, U1, V1, U1, V0, U0, V0, -1, 0, 0);
  // Dessus (+y) : u de −x vers +x, v de −z vers +z
  U0 = u + d; U1 = U0 + w; V0 = v; V1 = V0 + d;
  face(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, U0, V1, U1, V1, U1, V0, U0, V0, 0, 1, 0);
  // Dessous (−y) : même lecture que le dessus (vu à travers la boîte)
  U0 = u + d + w; U1 = U0 + w;
  face(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, U0, V0, U1, V0, U1, V1, U0, V1, 0, -1, 0);
}

/**
 * Géométries (une par partie animée, relatives à son pivot) et texture d'un modèle de créature, en cache.
 * Les géométries portent `position`, `uv` et `normal` : à dessiner avec `createMobMaterial`.
 */
export function getMobAssets(model: MobModel): MobAssets {
  let assets = mobAssetsCache.get(model);
  if (assets) return assets;

  const texture = new THREE.DataTexture(new Uint8Array(model.texture), model.texW, model.texH, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;

  const order: string[] = [];
  const buffers = new Map<string, { pivot: [number, number, number]; pos: number[]; uv: number[]; nrm: number[]; idx: number[] }>();
  for (const box of model.boxes) {
    let b = buffers.get(box.part);
    if (!b) {
      b = { pivot: box.pivot, pos: [], uv: [], nrm: [], idx: [] };
      buffers.set(box.part, b);
      order.push(box.part);
    }
    const g = box.inflate ?? 0;
    const [px, py, pz] = b.pivot;
    pushBox(
      b.pos, b.uv, b.nrm, b.idx,
      (box.from[0] - g - px) * PX, (box.from[1] - g - py) * PX, (box.from[2] - g - pz) * PX,
      (box.from[0] + box.size[0] + g - px) * PX, (box.from[1] + box.size[1] + g - py) * PX, (box.from[2] + box.size[2] + g - pz) * PX,
      box.uv[0], box.uv[1], box.size[0], box.size[1], box.size[2], model.texW, model.texH,
    );
  }
  const parts: MobPart[] = [];
  for (const name of order) {
    const b = buffers.get(name)!;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.nrm), 3));
    geometry.setIndex(b.idx);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    parts.push({ name, pivot: new THREE.Vector3(b.pivot[0] * PX, b.pivot[1] * PX, b.pivot[2] * PX), geometry });
  }
  assets = { model, texture, parts };
  mobAssetsCache.set(model, assets);
  return assets;
}

const MOB_VERTEX = /* glsl */ `
uniform float uFlat;
varying vec2 vUv;
varying float vShade;
varying float vFogDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogDepth = length(mv.xyz);
  vUv = uv;
  // Deux lumières diffuses opposées, comme l'éclairage des entités de Minecraft
  vec3 n = normalize(mat3(modelMatrix) * normal + vec3(0.0, 1e-5, 0.0));
  float d = max(dot(n, vec3(0.1617, 0.8085, -0.5659)), 0.0) + max(dot(n, vec3(-0.1617, 0.8085, 0.5659)), 0.0);
  vShade = mix(min(1.0, 0.5 + 0.5 * d), 1.0, uFlat);
}
`;

const MOB_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform vec3 uColor;
uniform vec4 uOverlay;
uniform float uFlash;
uniform float uAlpha;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying float vShade;
varying float vFogDepth;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.5) discard;
  vec3 col = mix(c.rgb * vShade * uColor, uOverlay.rgb, uOverlay.a);
  col = mix(col, vec3(1.0), uFlash);
  float fog = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFogColor, fog), uAlpha);
}
`;

/**
 * Matériau d'une créature (une instance par entité). Uniformes propres :
 * `uColor` (éclairage × teinte), `uOverlay` (rgb + force : voile de couleur, ex. rouge de blessure),
 * `uFlash` (0..1, mélange vers le blanc), `uAlpha` (opacité, utile si le matériau est déclaré transparent),
 * `uFlat` (1 = pas d'ombrage par face). Le brouillard suit `worldUniforms`.
 */
export function createMobMaterial(texture: THREE.Texture, doubleSide = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOverlay: { value: new THREE.Vector4(1, 0, 0, 0) },
      uFlash: { value: 0 },
      uAlpha: { value: 1 },
      uFlat: { value: 0 },
      uFogColor: worldUniforms.uFogColor,
      uFogNear: worldUniforms.uFogNear,
      uFogFar: worldUniforms.uFogFar,
    },
    vertexShader: MOB_VERTEX,
    fragmentShader: MOB_FRAGMENT,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// ---------------------------------------------------------------------------------------------
// Ombre ronde sous les entités
// ---------------------------------------------------------------------------------------------

const SHADOW_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vFogDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogDepth = length(mv.xyz);
  vUv = uv;
}
`;

const SHADOW_FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying float vFogDepth;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float fog = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * uOpacity * (1.0 - fog);
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

let shadowGeometry: THREE.BufferGeometry | null = null;

function getShadowGeometry(): THREE.BufferGeometry {
  if (!shadowGeometry) {
    shadowGeometry = new THREE.PlaneGeometry(1, 1);
    shadowGeometry.rotateX(-HALF_PI);
  }
  return shadowGeometry;
}

/** Disque sombre semi-transparent posé au sol, à la position des pieds. */
class BlobShadow {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(diameter: number) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0.5 },
        uFogNear: worldUniforms.uFogNear,
        uFogFar: worldUniforms.uFogFar,
      },
      vertexShader: SHADOW_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(getShadowGeometry(), this.material);
    this.mesh.scale.set(diameter, 1, diameter);
    this.mesh.position.y = 0.015;
    this.mesh.renderOrder = 1;
  }

  /** L'ombre s'efface dans l'obscurité (`light` : couleur d'éclairage de l'entité). */
  setLight(light: THREE.Color): void {
    this.material.uniforms.uOpacity.value = 0.5 * clamp(Math.max(light.r, light.g, light.b), 0, 1);
  }

  dispose(): void {
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Flèche : texture pixel-art procédurale et géométrie (deux quads croisés + empennage)
// ---------------------------------------------------------------------------------------------

let arrowTexture: THREE.DataTexture | null = null;
let arrowGeometry: THREE.BufferGeometry | null = null;

/** Texture 16×16 : lignes 0..4 = profil de la flèche (empennage à gauche, pointe à droite), lignes 5..9 = empennage vu de face. */
function getArrowTexture(): THREE.DataTexture {
  if (arrowTexture) return arrowTexture;
  const data = new Uint8Array(16 * 16 * 4);
  const set = (x: number, y: number, color: number): void => {
    const o = (y * 16 + x) * 4;
    data[o] = (color >> 16) & 255;
    data[o + 1] = (color >> 8) & 255;
    data[o + 2] = color & 255;
    data[o + 3] = 255;
  };
  // Hampe
  for (let x = 1; x <= 12; x++) set(x, 2, x % 3 === 0 ? 0x6b4f2a : 0x896a3c);
  // Pointe en silex
  set(12, 1, 0x7d7d7d);
  set(12, 3, 0x5f5f5f);
  set(13, 1, 0xa8a8a8);
  set(13, 2, 0x8c8c8c);
  set(13, 3, 0x6e6e6e);
  set(14, 2, 0xc4c4c4);
  set(15, 2, 0xdcdcdc);
  // Empennage
  for (let x = 0; x <= 3; x++) {
    set(x, 1, x % 2 === 0 ? 0xe6e6e6 : 0xcfcfcf);
    set(x, 3, x % 2 === 0 ? 0xd4d4d4 : 0xbdbdbd);
  }
  for (let x = 0; x <= 2; x++) {
    set(x, 0, 0xf2f2f2);
    set(x, 4, 0xc2c2c2);
  }
  // Empennage vu de face : une croix claire autour de la hampe
  for (let i = 0; i < 5; i++) {
    set(i, 7, i === 0 || i === 4 ? 0xcfcfcf : 0xe6e6e6);
    set(2, 5 + i, i === 0 || i === 4 ? 0xcfcfcf : 0xe6e6e6);
  }
  set(2, 7, 0x896a3c);
  arrowTexture = new THREE.DataTexture(data, 16, 16, THREE.RGBAFormat, THREE.UnsignedByteType);
  arrowTexture.magFilter = THREE.NearestFilter;
  arrowTexture.minFilter = THREE.NearestFilter;
  arrowTexture.generateMipmaps = false;
  arrowTexture.colorSpace = THREE.NoColorSpace;
  arrowTexture.flipY = false;
  arrowTexture.needsUpdate = true;
  return arrowTexture;
}

/** Flèche le long de +z (pointe en +z), centrée, longue de 0,9 bloc. */
function getArrowGeometry(): THREE.BufferGeometry {
  if (arrowGeometry) return arrowGeometry;
  const k = 0.05625;
  const L = 8 * k;
  const H = 2.5 * k;
  const v5 = 5 / 16;
  const v10 = 10 / 16;
  const tz = -7 * k;
  const pos = [
    // Plan vertical
    0, -H, -L, 0, -H, L, 0, H, L, 0, H, -L,
    // Plan horizontal
    -H, 0, -L, -H, 0, L, H, 0, L, H, 0, -L,
    // Empennage (perpendiculaire à l'axe)
    -H, -H, tz, H, -H, tz, H, H, tz, -H, H, tz,
  ];
  const uv = [
    0, v5, 1, v5, 1, 0, 0, 0,
    0, v5, 1, v5, 1, 0, 0, 0,
    0, v10, v5, v10, v5, v5, 0, v5,
  ];
  const nrm: number[] = [];
  for (let i = 0; i < 12; i++) nrm.push(0, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  // Les deux plans forment un « X » vu dans l'axe
  g.rotateZ(PI / 4);
  arrowGeometry = g;
  return g;
}

// ---------------------------------------------------------------------------------------------
// Visuels par type d'entité
// ---------------------------------------------------------------------------------------------

const tmpLight = new THREE.Color();
const heldChain = new MatrixChain();

interface Visual {
  /** Signature : si elle change, le visuel est reconstruit. */
  readonly key: string;
  readonly root: THREE.Group;
  stamp: number;
  update(e: EntityView, alpha: number, time: number): void;
  dispose(): void;
}

function visualKey(e: EntityView): string {
  switch (e.kind) {
    case 'mob':
    case 'player':
      if (e.mobKind === 'sheep') return `m:sheep:${e.woolColor}:${e.sheared ? 1 : 0}`;
      if (e.mobKind === 'wolf') return `m:wolf:${e.tamed ? 1 : 0}:${e.angry ? 1 : 0}:${e.collarColor & 0xffffff}`;
      if (e.mobKind === 'villager') return `m:villager:${e.variant}`;
      if (e.mobKind === 'horse') return `m:horse:${e.variant}:${e.saddled ? 1 : 0}`;
      if (e.mobKind === 'ocelot') return `m:ocelot:${e.variant}`;
      return `m:${e.mobKind}`;
    case 'item':
      return `i:${e.itemId}:${itemCopies(e.itemCount)}`;
    case 'falling_block':
      return `b:${e.blockId}:${e.blockMeta}`;
    case 'tnt':
      return `t:${e.blockId}:${e.blockMeta}`;
    case 'arrow':
      return 'a';
    case 'bobber':
      return 'f';
    case 'fireball':
      return 'fb';
  }
}

function itemCopies(count: number): number {
  return count > 32 ? 4 : count > 16 ? 3 : count > 1 ? 2 : 1;
}

function placeRoot(root: THREE.Group, e: EntityView, alpha: number): void {
  root.position.set(lerp(e.px, e.x, alpha), lerp(e.py, e.y, alpha), lerp(e.pz, e.z, alpha));
}

/** Diamètre de l'ombre par type de créature (proche des tailles de Minecraft). */
const SHADOW_DIAMETER: Record<MobKind, number> = {
  pig: 1.3,
  cow: 1.3,
  sheep: 1.3,
  chicken: 0.6,
  wolf: 0.9,
  zombie: 0.95,
  skeleton: 0.95,
  creeper: 0.95,
  spider: 1.7,
  zombie_pigman: 0.95,
  ghast: 4.5,
  magma_cube: 0.8,
  villager: 0.95,
  blaze: 0.9,
  wither_skeleton: 1.1,
  slime: 0.6,
  enderman: 0.9,
  witch: 0.95,
  horse: 1.8,
  squid: 0.9,
  iron_golem: 1.7,
  ocelot: 0.75,
  silverfish: 0.5,
  ender_dragon: 0,
  end_crystal: 0,
  player: 0.95,
};

// Araignée : paires de pattes de l'avant vers l'arrière (valeurs de Minecraft, convention de son modèle)
const SPIDER_YAW = [-PI / 4, -PI / 8, PI / 8, PI / 4];
const SPIDER_ROLL = [PI / 4, (PI / 4) * 0.74, (PI / 4) * 0.74, PI / 4];
const SPIDER_PHASE = [(3 * PI) / 2, PI / 2, PI, 0];

/** Hauteur d'une plaque de nom, en blocs, et hauteur en pixels de son image. */
const NAME_HEIGHT = 0.28;
const NAME_PX = 40;

/** Plaque de nom (étiquette) : texte blanc sur fond sombre, toujours tournée vers la caméra. */
function makeNamePlate(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const font = "bold 26px Verdana, 'DejaVu Sans', sans-serif";
  const probe = canvas.getContext('2d');
  if (probe) probe.font = font;
  const width = Math.ceil((probe ? probe.measureText(text).width : text.length * 16) + 20);
  canvas.width = width;
  canvas.height = NAME_PX;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, width, NAME_PX);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, width / 2, NAME_PX / 2 + 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set((width / NAME_PX) * NAME_HEIGHT, NAME_HEIGHT, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Nombre de segments de la corde d'une laisse. */
const LEASH_SEGMENTS = 10;

/** Créature ou joueur : un sous-maillage par partie animée, placé à son pivot. */
class MobVisual implements Visual {
  readonly root = new THREE.Group();
  stamp = 0;
  private readonly body = new THREE.Group();
  private readonly parts = new Map<string, THREE.Mesh>();
  private readonly pivots = new Map<string, THREE.Vector3>();
  private readonly material: THREE.ShaderMaterial;
  private readonly shadow: BlobShadow;
  private readonly model: MobModel;
  private readonly kind: MobKind;
  private held: ItemModel | null = null;
  private heldId = 0;
  private heldGroup: THREE.Group | null = null;
  private flap = 0;
  private lastTime = -1;
  /** Enveloppe translucide du slime (partage ses uniformes avec le matériau principal). */
  private shell: THREE.ShaderMaterial | null = null;
  private namePlate: THREE.Sprite | null = null;
  private nameText = '';
  private leash: THREE.Line | null = null;
  /** Bloc porté par un enderman. */
  private carried: ItemModel | null = null;
  private carriedGroup: THREE.Group | null = null;
  private carriedKey = 0;

  constructor(readonly key: string, private readonly atlas: Atlas, e: EntityView) {
    this.kind = e.mobKind;
    this.model = e.mobKind === 'sheep'
      ? getSheepModel(e.woolColor, e.sheared)
      : e.mobKind === 'wolf'
        ? getWolfModel(e.tamed, e.angry, e.collarColor)
        : e.mobKind === 'villager'
          ? getVillagerModel(e.variant)
          : e.mobKind === 'horse'
            ? getHorseModel(e.variant, e.saddled)
            : e.mobKind === 'ocelot'
              ? getOcelotModel(e.variant)
              : getMobModel(e.mobKind);
    const assets = getMobAssets(this.model);
    this.material = createMobMaterial(assets.texture);
    this.body.rotation.order = 'YXZ';
    for (const part of assets.parts) {
      let material = this.material;
      if (part.name === 'shell') {
        // même éclairage et mêmes voiles que le reste du corps, mais en transparence
        const shell = createMobMaterial(assets.texture);
        shell.uniforms.uColor = this.material.uniforms.uColor;
        shell.uniforms.uOverlay = this.material.uniforms.uOverlay;
        shell.uniforms.uFlash = this.material.uniforms.uFlash;
        shell.uniforms.uAlpha.value = 0.55;
        shell.transparent = true;
        shell.depthWrite = false;
        this.shell = shell;
        material = shell;
      }
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.position.copy(part.pivot);
      // Même ordre que Minecraft : rotation x, puis y, puis z
      mesh.rotation.order = 'ZYX';
      this.parts.set(part.name, mesh);
      this.pivots.set(part.name, part.pivot);
      this.body.add(mesh);
    }
    this.shadow = new BlobShadow(SHADOW_DIAMETER[this.kind] ?? this.model.width * 1.5);
    // ni le dragon en vol ni le cristal au sommet de son pilier ne posent d'ombre à leurs pieds
    if (SHADOW_DIAMETER[this.kind] === 0) this.shadow.mesh.visible = false;
    this.root.add(this.body, this.shadow.mesh);
  }

  /** Oriente une partie avec des angles exprimés dans la convention du modèle de Minecraft (y vers le bas, regard vers −z). */
  private rot(name: string, x: number, y: number, z: number): void {
    const p = this.parts.get(name);
    if (p) p.rotation.set(x, -y, -z);
  }

  /** Replace une partie à son pivot, décalé de (dx, dy, dz) pixels. */
  private offset(name: string, dx: number, dy: number, dz: number): void {
    const p = this.parts.get(name);
    const pivot = this.pivots.get(name);
    if (p && pivot) p.position.set(pivot.x + dx * PX, pivot.y + dy * PX, pivot.z + dz * PX);
  }

  update(e: EntityView, alpha: number, time: number): void {
    placeRoot(this.root, e, alpha);
    const dt = this.lastTime < 0 ? 0 : clamp(time - this.lastTime, 0, 0.1);
    this.lastTime = time;

    // Éclairage, rouge de blessure
    lightColor(e.skyLight, e.blockLight, worldUniforms.uSkyLight.value, tmpLight);
    this.shadow.setLight(tmpLight);
    const color = this.material.uniforms.uColor.value as THREE.Color;
    color.copy(tmpLight);
    // Voile rouge de Minecraft : 40 % de rouge par-dessus la texture, tant que la créature est blessée ou meurt
    const overlay = this.material.uniforms.uOverlay.value as THREE.Vector4;
    const hurt = e.hurtTime > 0 || e.deathTime > 0;
    overlay.set(Math.max(tmpLight.r, tmpLight.g, tmpLight.b), 0, 0, hurt ? 0.4 : 0);

    // Lacet du corps, bascule de la mort
    const yaw = lerpAngle(e.pYaw, e.yaw, alpha);
    let tilt = 0;
    if (e.deathTime > 0 && this.kind !== 'ender_dragon') {
      const f = clamp(((e.deathTime - 1 + alpha) / 20) * 1.6, 0, 1);
      // L'araignée se retourne sur le dos, les autres tombent sur le flanc
      tilt = Math.sqrt(f) * (this.kind === 'spider' ? PI : HALF_PI);
    }
    this.body.rotation.set(0, yaw + PI, tilt);
    this.body.position.set(0, Math.sin(tilt) * this.model.width * 0.3, 0);

    // Tête
    const relYaw = clamp(wrapAngle(lerpAngle(e.pHeadYaw, e.headYaw, alpha) - yaw), -1.4, 1.4);
    const pitch = clamp(lerp(e.pHeadPitch, e.headPitch, alpha), -1.5, 1.5);
    // Angles de la tête dans la convention de Minecraft
    const headX = -pitch;
    const headY = -relYaw;
    this.rot('head', headX, headY, 0);

    const swing = lerp(e.pLimbSwing, e.limbSwing, alpha);
    const amount = clamp(lerp(e.pLimbAmount, e.limbAmount, alpha), 0, 1);
    const walk = Math.cos(swing * 0.6662) * 1.4 * amount;
    const age = e.age + alpha;

    let flash = 0;
    const baseScale = e.baby ? 0.5 : e.mobScale;
    this.body.scale.setScalar(baseScale);
    const headMesh = this.parts.get('head');
    if (headMesh) headMesh.scale.setScalar(e.baby ? 1.5 : 1);

    switch (this.kind) {
      case 'player':
      case 'zombie':
      case 'zombie_pigman':
      case 'skeleton':
      case 'wither_skeleton':
        this.animateBiped(e, walk, age, headX, headY);
        break;
      case 'pig':
      case 'cow':
      case 'sheep':
      case 'creeper':
        // Pattes en diagonale en phase
        this.rot('leg0', -walk, 0, 0);
        this.rot('leg1', walk, 0, 0);
        this.rot('leg2', walk, 0, 0);
        this.rot('leg3', -walk, 0, 0);
        if (this.kind === 'creeper' && e.fuse > 0) {
          // Gonflement et clignotement blanc avant l'explosion
          const f = clamp(e.fuse, 0, 1);
          const wobble = 1 + Math.sin(f * 100) * f * 0.01;
          const f4 = f * f * f * f;
          const sxz = (1 + f4 * 0.4) * wobble;
          const sy = (1 + f4 * 0.1) / wobble;
          this.body.scale.set(sxz * baseScale, sy * baseScale, sxz * baseScale);
          if (Math.floor(f * 10) % 2 === 1) flash = 0.3 + f * 0.35;
        }
        break;
      case 'chicken': {
        this.rot('legR', walk, 0, 0);
        this.rot('legL', -walk, 0, 0);
        // Les ailes battent quand le poulet est en l'air (sa hauteur change d'un tick à l'autre)
        const airborne = Math.abs(e.y - e.py) > 0.004;
        this.flap += ((airborne ? 1 : 0) - this.flap) * Math.min(1, dt * 12);
        const angle = (Math.sin(time * 22) + 1) * this.flap;
        this.rot('wingR', 0, 0, angle);
        this.rot('wingL', 0, 0, -angle);
        break;
      }
      case 'wolf':
        if (e.sitting) {
          this.offset('body', 0, -3, 0);
          this.rot('body', 0.45, 0, 0);
          this.offset('head', 0, -2, 0);
          this.rot('leg0', -0.2, 0, 0);
          this.rot('leg1', -0.2, 0, 0);
          this.rot('leg2', -1.25, 0, 0);
          this.rot('leg3', -1.25, 0, 0);
          this.offset('leg2', 0, -2, 2);
          this.offset('leg3', 0, -2, 2);
          this.offset('tail', 0, -4, 0);
          this.rot('tail', 0.4, 0, 0);
        } else {
          this.offset('body', 0, 0, 0);
          this.rot('body', 0, 0, 0);
          this.offset('head', 0, 0, 0);
          this.rot('leg0', -walk, 0, 0);
          this.rot('leg1', walk, 0, 0);
          this.rot('leg2', walk, 0, 0);
          this.rot('leg3', -walk, 0, 0);
          this.offset('leg2', 0, 0, 0);
          this.offset('leg3', 0, 0, 0);
          this.offset('tail', 0, 0, 0);
          this.rot('tail', e.tamed ? 1.1 : e.angry ? 0.9 : 0.45, 0, 0);
        }
        break;
      case 'spider':
        for (let pair = 0; pair < 4; pair++) {
          const fy = -Math.cos(swing * 0.6662 * 2 + SPIDER_PHASE[pair]) * 0.4 * amount;
          const fz = Math.abs(Math.sin(swing * 0.6662 + SPIDER_PHASE[pair]) * 0.4) * amount;
          this.rot(`leg${pair * 2}`, 0, SPIDER_YAW[pair] + fy, -SPIDER_ROLL[pair] + fz);
          this.rot(`leg${pair * 2 + 1}`, 0, -SPIDER_YAW[pair] - fy, SPIDER_ROLL[pair] - fz);
        }
        break;
      case 'blaze':
        // trois couronnes de bâtons qui tournent à des vitesses différentes, le tout qui ondule
        this.rot('ring0', 0, age * 0.16, 0);
        this.rot('ring1', 0, -age * 0.12, 0);
        this.rot('ring2', 0, age * 0.2, 0);
        this.body.position.y += Math.sin(age * 0.15) * 0.06;
        break;
      case 'villager':
      case 'witch':
        // bras croisés immobiles, jambes cachées sous la robe
        this.rot('arms', -0.75, 0, 0);
        this.rot('legR', walk * 0.5, 0, 0);
        this.rot('legL', -walk * 0.5, 0, 0);
        break;
      case 'enderman':
        this.animateBiped(e, walk * 0.6, age, headX, headY);
        if (e.blockId !== 0) {
          // il tient son bloc à bout de bras, devant lui
          this.rot('armR', -0.5, 0, 0.05);
          this.rot('armL', -0.5, 0, -0.05);
        }
        break;
      case 'iron_golem': {
        const sw = Math.sin(clamp(e.swing, 0, 1) * PI);
        const arm = sw > 0 ? -sw * 2 : walk * 0.35;
        this.rot('armR', sw > 0 ? arm : -arm, 0, 0);
        this.rot('armL', arm, 0, 0);
        this.rot('legR', walk * 0.5, 0, 0);
        this.rot('legL', -walk * 0.5, 0, 0);
        break;
      }
      case 'horse':
        this.rot('head', headX * 0.4, headY * 0.4, 0);
        this.rot('leg0', -walk * 0.7, 0, 0);
        this.rot('leg1', walk * 0.7, 0, 0);
        this.rot('leg2', walk * 0.7, 0, 0);
        this.rot('leg3', -walk * 0.7, 0, 0);
        this.rot('tail', 0.15 + amount * 0.5, Math.sin(age * 0.12) * 0.12, 0);
        break;
      case 'ocelot':
        if (e.sitting) {
          this.offset('body', 0, -1.5, 0);
          this.rot('body', 0.45, 0, 0);
          this.rot('leg0', -0.2, 0, 0);
          this.rot('leg1', -0.2, 0, 0);
          this.rot('leg2', -1.25, 0, 0);
          this.rot('leg3', -1.25, 0, 0);
          this.offset('leg2', 0, -3, 3);
          this.offset('leg3', 0, -3, 3);
          this.offset('tail', 0, -5, 1);
          this.rot('tail', 0.3, 0, 0);
        } else {
          this.offset('body', 0, 0, 0);
          this.rot('body', 0, 0, 0);
          this.rot('leg0', -walk, 0, 0);
          this.rot('leg1', walk, 0, 0);
          this.rot('leg2', walk, 0, 0);
          this.rot('leg3', -walk, 0, 0);
          this.offset('leg2', 0, 0, 0);
          this.offset('leg3', 0, 0, 0);
          this.offset('tail', 0, 0, 0);
          this.rot('tail', -0.25 + Math.sin(age * 0.1) * 0.1, 0, 0);
        }
        break;
      case 'silverfish':
        for (let i = 0; i < 5; i++) this.rot(`seg${i}`, 0, Math.sin(age * 0.9 + i * 0.5) * 0.12 * (1 + Math.abs(i - 2)), 0);
        break;
      case 'end_crystal': {
        // deux cages qui tournent en sens contraires autour du cœur, le tout flottant doucement
        const bob = Math.sin(age * 0.1) * 2;
        for (const name of ['frame0', 'frame1', 'core']) this.offset(name, 0, bob, 0);
        this.parts.get('frame0')?.rotation.set(age * 0.05, age * 0.07, 0.6);
        this.parts.get('frame1')?.rotation.set(-age * 0.07, age * 0.04, -0.6);
        this.parts.get('core')?.rotation.set(age * 0.09, age * 0.11, 0);
        break;
      }
      case 'ender_dragon': {
        // le corps entier pique ou se cabre ; la tête ne tourne pas à part
        this.body.rotation.set(-pitch, yaw + PI, 0);
        this.rot('head', 0, 0, 0);
        const wave = age * 0.15;
        const headLift = Math.sin(wave + DRAGON_NECK_SEGMENTS * 0.6) * 3;
        for (let i = 0; i < DRAGON_NECK_SEGMENTS; i++) this.offset(`neck${i}`, 0, Math.sin(wave + i * 0.6) * (i + 1) * 0.5, 0);
        this.offset('head', 0, headLift, 0);
        this.offset('jaw', 0, headLift, 0);
        this.rot('jaw', (Math.sin(age * 0.1) + 1) * 0.12, 0, 0);
        for (let i = 0; i < DRAGON_TAIL_SEGMENTS; i++) {
          this.offset(`tail${i}`, 0, Math.sin(wave - i * 0.5) * (i + 1) * 0.7, 0);
          this.parts.get(`tail${i}`)?.scale.setScalar(1 - i * 0.05);
        }
        // battement : l'aile monte et descend, le bout d'aile suit avec retard, accroché au bout du premier os
        const beat = (Math.sin(age * 0.25) * 0.55 + 0.1) * amount + (1 - amount) * 0.3;
        const tip = (Math.sin(age * 0.25 - 1) * 0.6 - 0.15) * amount - (1 - amount) * 0.9;
        const reach = DRAGON_WING_SPAN * (Math.cos(beat) - 1);
        const lift = DRAGON_WING_SPAN * Math.sin(beat);
        this.parts.get('wingL')?.rotation.set(0, 0, beat);
        this.parts.get('wingR')?.rotation.set(0, 0, -beat);
        this.offset('tipL', reach, lift, 0);
        this.offset('tipR', -reach, lift, 0);
        this.parts.get('tipL')?.rotation.set(0, 0, beat + tip);
        this.parts.get('tipR')?.rotation.set(0, 0, -beat - tip);
        // agonie : il blanchit en se désagrégeant
        if (e.deathTime > 0) flash = clamp(e.deathTime / 200, 0, 1) * 0.85;
        break;
      }
      case 'squid': {
        // les tentacules s'écartent et se referment en cadence
        const open = 0.35 + Math.sin(age * 0.22) * 0.3;
        for (let i = 0; i < 8; i++) {
          const p = this.parts.get(`tent${i}`);
          if (!p) continue;
          const a = (i * PI) / 4;
          p.rotation.set(-open * Math.sin(a), 0, open * Math.cos(a));
        }
        break;
      }
      case 'slime': {
        const jumpVy = clamp(e.y - e.py, -0.3, 0.5);
        const stretch = 1 + jumpVy * 0.5;
        const squash = 1 / Math.sqrt(stretch);
        this.body.scale.set(baseScale * squash, baseScale * stretch, baseScale * squash);
        break;
      }
      case 'ghast':
        for (let i = 0; i < 9; i++) {
          this.rot(`tent${i}`, Math.sin(age * 0.16 + i * 0.8) * 0.28, 0, 0);
        }
        break;
      case 'magma_cube': {
        const jumpVy = clamp(e.y - e.py, -0.3, 0.5);
        const stretch = 1 + jumpVy * 0.35;
        const squash = 1 / Math.sqrt(stretch);
        this.body.scale.set(baseScale * squash, baseScale * stretch, baseScale * squash);
        break;
      }
    }
    this.material.uniforms.uFlash.value = flash;

    this.syncHeld(e);
    if (this.held) this.held.setLight(e.skyLight, e.blockLight);
    if (this.kind === 'enderman') this.syncCarried(e);
    this.syncName(e, baseScale);
    this.syncLeash(e, alpha);
  }

  /** Bloc que l'enderman tient devant lui. */
  private syncCarried(e: EntityView): void {
    const key = e.blockId === 0 ? 0 : e.blockId * 16 + (e.blockMeta & 15) + 1;
    if (key !== this.carriedKey) {
      this.carriedKey = key;
      if (this.carriedGroup) this.carriedGroup.removeFromParent();
      if (this.carried) this.carried.dispose();
      this.carried = null;
      this.carriedGroup = null;
      if (key !== 0) {
        const model = ItemModel.forBlock(this.atlas, e.blockId, e.blockMeta);
        const group = model.instance();
        group.scale.setScalar(0.5);
        group.position.set(0, 24 * PX, 9 * PX);
        this.body.add(group);
        this.carried = model;
        this.carriedGroup = group;
      }
    }
    if (this.carried) this.carried.setLight(e.skyLight, e.blockLight);
  }

  /** Plaque de nom au-dessus de la tête. */
  private syncName(e: EntityView, scale: number): void {
    if (e.customName !== this.nameText) {
      this.nameText = e.customName;
      this.disposeName();
      if (e.customName !== '') {
        this.namePlate = makeNamePlate(e.customName);
        this.root.add(this.namePlate);
      }
    }
    if (this.namePlate) this.namePlate.position.set(0, this.model.height * scale + 0.45, 0);
  }

  private disposeName(): void {
    const n = this.namePlate;
    if (!n) return;
    n.removeFromParent();
    n.material.map?.dispose();
    n.material.dispose();
    this.namePlate = null;
  }

  /** Corde de la laisse : du poitrail jusqu'à la main ou au poteau, avec un léger ventre. */
  private syncLeash(e: EntityView, alpha: number): void {
    if (!e.leashed) {
      if (this.leash) this.leash.visible = false;
      return;
    }
    let line = this.leash;
    if (!line) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((LEASH_SEGMENTS + 1) * 3), 3));
      // corde brune d'une laisse, ou rayon rose du cristal qui soigne le dragon
      line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: this.kind === 'end_crystal' ? 0xf8a8ff : 0x5a4020 }));
      line.frustumCulled = false;
      this.root.add(line);
      this.leash = line;
    }
    line.visible = true;
    const r = this.root.position;
    const y0 = this.model.height * 0.6;
    const dx = lerp(e.pLeashX, e.leashX, alpha) - r.x;
    const dy = lerp(e.pLeashY, e.leashY, alpha) - r.y - y0;
    const dz = lerp(e.pLeashZ, e.leashZ, alpha) - r.z;
    const attr = line.geometry.attributes.position as THREE.BufferAttribute;
    const sag = this.kind === 'end_crystal' ? 0 : Math.min(0.6, Math.sqrt(dx * dx + dz * dz) * 0.08);
    for (let i = 0; i <= LEASH_SEGMENTS; i++) {
      const t = i / LEASH_SEGMENTS;
      attr.setXYZ(i, dx * t, y0 + dy * t - Math.sin(t * PI) * sag, dz * t);
    }
    attr.needsUpdate = true;
  }

  private animateBiped(e: EntityView, walk: number, age: number, headX: number, headY: number): void {
    const armSwing = walk / 1.4;
    let rax = -armSwing;
    let lax = armSwing;
    let ray = 0;
    let lay = 0;
    let raz = 0;
    let laz = 0;
    let bodyY = 0;
    const sw = clamp(e.swing, 0, 1);
    const f = Math.sin(sw * PI);
    const f1 = Math.sin((1 - (1 - sw) * (1 - sw)) * PI);

    if (this.kind === 'zombie' || this.kind === 'zombie_pigman') {
      // Bras tendus vers l'avant
      ray = -(0.1 - f * 0.6);
      lay = 0.1 - f * 0.6;
      rax = lax = -HALF_PI - (f * 1.2 - f1 * 0.4);
    } else if (this.kind === 'skeleton') {
      // Bras levés dans la direction du regard, tenant l'arc
      ray = -(0.1 - f * 0.6) + headY;
      lay = 0.1 - f * 0.6 + headY + 0.4;
      rax = lax = -HALF_PI + headX - (f * 1.2 - f1 * 0.4);
    } else {
      if (e.itemId !== 0) rax = rax * 0.5 - PI / 10;
      if (sw > 0) {
        // Coup porté par le bras droit
        bodyY = Math.sin(Math.sqrt(sw) * 2 * PI) * 0.2;
        ray += bodyY * 3;
        lay += bodyY;
        lax += bodyY;
        const g = 1 - (1 - sw) * (1 - sw) * (1 - sw) * (1 - sw);
        rax -= Math.sin(g * PI) * 1.2 + f * -(headX - 0.7) * 0.75;
        raz += f * -0.4;
      }
    }
    // Léger balancement des bras au repos
    const idleZ = Math.cos(age * 0.09) * 0.05 + 0.05;
    const idleX = Math.sin(age * 0.067) * 0.05;
    raz += idleZ;
    laz -= idleZ;
    rax += idleX;
    lax -= idleX;

    const sneaking = e.sneaking && this.kind === 'player';
    if (sneaking) {
      rax += 0.4;
      lax += 0.4;
    }
    this.rot('armR', rax, ray, raz);
    this.rot('armL', lax, lay, laz);
    if (e.riding) {
      // en selle : jambes repliées vers l'avant, de part et d'autre de la monture
      this.rot('legR', -1.4137, PI / 10, 0.0785);
      this.rot('legL', -1.4137, -PI / 10, -0.0785);
    } else {
      this.rot('legR', walk, 0, 0);
      this.rot('legL', -walk, 0, 0);
    }

    const body = this.parts.get('body');
    if (sneaking) {
      // Buste penché en avant, jambes reculées, tête et bras abaissés
      if (body) body.rotation.set(0.5, 0, 0);
      this.offset('body', 0, -1.73, -5.75);
      this.offset('head', 0, -4.2, 0);
      this.offset('armR', 0, -3.2, 0);
      this.offset('armL', 0, -3.2, 0);
      this.offset('legR', 0, 0, -4);
      this.offset('legL', 0, 0, -4);
    } else {
      // Torsion du buste pendant le coup : les épaules suivent
      if (body) body.rotation.set(0, -bodyY, 0);
      const s = Math.sin(bodyY) * 5;
      const c = (1 - Math.cos(bodyY)) * 5;
      this.offset('body', 0, 0, 0);
      this.offset('head', 0, 0, 0);
      this.offset('armR', c, 0, -s);
      this.offset('armL', -c, 0, s);
      this.offset('legR', 0, 0, 0);
      this.offset('legL', 0, 0, 0);
    }
  }

  /** Objet tenu dans la main droite (arc du squelette, outil ou bloc du joueur). */
  private syncHeld(e: EntityView): void {
    const id = e.itemId;
    if (id === this.heldId) return;
    this.heldId = id;
    if (this.heldGroup) this.heldGroup.removeFromParent();
    if (this.held) this.held.dispose();
    this.held = null;
    this.heldGroup = null;
    const arm = this.parts.get('armR');
    if (id === 0 || !arm) return;

    const model = ItemModel.forItem(this.atlas, id);
    const group = model.instance();
    // Enchaînement de Minecraft, exprimé dans le repère de son bras (y vers le bas, avant = −z),
    // précédé du passage de ce repère au nôtre (demi-tour autour de x).
    const m = heldChain.identity().scale(1, -1, -1);
    m.rotateX(-90).rotateY(180).translate(1 / 16, 0.125, -0.625);
    if (model.isBlock) {
      m.translate(0, 2.5 / 16, 0).rotateX(75).rotateY(45).scale(0.375);
    } else if (id === I.BOW) {
      m.translate(-1 / 16, -2 / 16, 2.5 / 16).rotateX(-80).rotateY(260).rotateZ(-40).scale(0.9);
    } else if (isHandheldItem(id)) {
      m.translate(0, 4 / 16, 0.5 / 16).rotateY(-90).rotateZ(55).scale(0.85);
    } else {
      m.translate(0, 3 / 16, 1 / 16).scale(0.55);
    }
    group.matrixAutoUpdate = false;
    group.matrix.copy(m.matrix);
    arm.add(group);
    this.held = model;
    this.heldGroup = group;
  }

  /** Calcule la position monde du bout de la canne à pêche tenue en main droite. Retourne false sinon. */
  getHeldTip(out: THREE.Vector3): boolean {
    if (!this.heldGroup || this.heldId !== I.FISHING_ROD) return false;
    this.root.updateMatrixWorld(true);
    // Bout de la canne dans le sprite 16×16 (pixel (14, 1) → centre (14.5, 1.5))
    out.set(14.5 / 16 - 0.5, 0.5 - 1.5 / 16, 0).applyMatrix4(this.heldGroup.matrixWorld);
    return true;
  }

  dispose(): void {
    this.material.dispose();
    if (this.shell) this.shell.dispose();
    this.shadow.dispose();
    if (this.held) this.held.dispose();
    if (this.carried) this.carried.dispose();
    this.disposeName();
    if (this.leash) {
      this.leash.geometry.dispose();
      (this.leash.material as THREE.Material).dispose();
    }
  }
}

/** Décalages pseudo-aléatoires stables des exemplaires d'une pile au sol. */
const COPY_OFFSETS = [
  [0, 0, 0],
  [0.55, 0.35, -0.5],
  [-0.5, 0.6, 0.45],
  [0.4, 0.9, 0.5],
];

/** Objet au sol : mini-bloc ou sprite extrudé qui tourne et flotte. */
class DropVisual implements Visual {
  readonly root = new THREE.Group();
  stamp = 0;
  private readonly spin = new THREE.Group();
  private readonly model: ItemModel;
  private readonly shadow = new BlobShadow(0.42);
  private readonly phase: number;

  constructor(readonly key: string, atlas: Atlas, e: EntityView) {
    this.model = ItemModel.forItem(atlas, e.itemId);
    const copies = itemCopies(e.itemCount);
    for (let i = 0; i < copies; i++) {
      const inst = this.model.instance();
      const o = COPY_OFFSETS[i];
      if (this.model.isBlock) inst.position.set(o[0], o[1], o[2]);
      else inst.position.set(o[0] * 0.12, o[1] * 0.12, (i - (copies - 1) / 2) * 0.094);
      this.spin.add(inst);
    }
    this.spin.scale.setScalar(this.model.isBlock ? 0.25 : 0.5);
    this.phase = ((e.id * 0.61803398875) % 1) * 2 * PI;
    this.root.add(this.spin, this.shadow.mesh);
  }

  update(e: EntityView, alpha: number): void {
    placeRoot(this.root, e, alpha);
    const t = e.age + alpha;
    const bob = Math.sin(t / 10 + this.phase) * 0.1 + 0.1;
    this.spin.rotation.y = t / 20 + this.phase;
    this.spin.position.y = (this.model.isBlock ? 0.17 : 0.3) + bob;
    this.model.setLight(e.skyLight, e.blockLight);
    lightColor(e.skyLight, e.blockLight, worldUniforms.uSkyLight.value, tmpLight);
    this.shadow.setLight(tmpLight);
  }

  dispose(): void {
    this.model.dispose();
    this.shadow.dispose();
  }
}

/** Bloc qui tombe ou TNT amorcée : modèle du bloc centré en x/z sur la position, base aux pieds. */
class BlockVisual implements Visual {
  readonly root = new THREE.Group();
  stamp = 0;
  private readonly model: ItemModel;
  private readonly holder: THREE.Group;
  private readonly shadow = new BlobShadow(1.0);
  private readonly overlay: THREE.MeshBasicMaterial | null = null;
  private readonly isTnt: boolean;

  constructor(readonly key: string, atlas: Atlas, e: EntityView) {
    this.isTnt = e.kind === 'tnt';
    const blockId = e.blockId !== 0 ? e.blockId : this.isTnt ? B.TNT : B.SAND;
    this.model = ItemModel.forBlock(atlas, blockId, e.blockMeta);
    this.holder = this.model.instance();
    this.holder.position.y = 0.5;
    if (this.isTnt) {
      // Surcouche blanche du clignotement
      this.overlay = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const g = getBlockGeometries(blockId, e.blockMeta);
      if (g.opaque) {
        const mesh = new THREE.Mesh(g.opaque, this.overlay);
        mesh.renderOrder = 2;
        this.holder.add(mesh);
      }
    }
    this.root.add(this.holder, this.shadow.mesh);
  }

  update(e: EntityView, alpha: number): void {
    placeRoot(this.root, e, alpha);
    this.model.setLight(e.skyLight, e.blockLight);
    lightColor(e.skyLight, e.blockLight, worldUniforms.uSkyLight.value, tmpLight);
    this.shadow.setLight(tmpLight);
    if (this.isTnt && this.overlay) {
      const remaining = e.fuse - alpha + 1;
      let scale = 1;
      if (remaining < 10) {
        let f = clamp(1 - remaining / 10, 0, 1);
        f *= f;
        f *= f;
        scale = 1 + f * 0.3;
      }
      this.holder.scale.setScalar(scale);
      const lit = Math.floor(Math.max(0, e.fuse) / 5) % 2 === 0;
      this.overlay.opacity = lit ? clamp((1 - remaining / 100) * 0.8, 0, 0.8) : 0;
      this.overlay.visible = lit;
    }
  }

  dispose(): void {
    this.model.dispose();
    this.shadow.dispose();
    if (this.overlay) this.overlay.dispose();
  }
}

/** Flèche : orientée par `yaw` (lacet) et `headPitch` (tangage) de la direction de vol. */
class ArrowVisual implements Visual {
  readonly root = new THREE.Group();
  stamp = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(readonly key: string) {
    this.material = createMobMaterial(getArrowTexture(), true);
    this.material.uniforms.uFlat.value = 1;
    const mesh = new THREE.Mesh(getArrowGeometry(), this.material);
    mesh.position.y = 0.1;
    mesh.rotation.order = 'YXZ';
    this.root.add(mesh);
  }

  update(e: EntityView, alpha: number): void {
    placeRoot(this.root, e, alpha);
    const mesh = this.root.children[0];
    mesh.rotation.set(-lerp(e.pHeadPitch, e.headPitch, alpha), lerpAngle(e.pYaw, e.yaw, alpha) + PI, 0);
    lightColor(e.skyLight, e.blockLight, worldUniforms.uSkyLight.value, this.material.uniforms.uColor.value as THREE.Color);
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** Boule de feu de ghast : cube incandescent en rotation. */
class FireballVisual implements Visual {
  readonly root = new THREE.Group();
  stamp = 0;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geometry: THREE.BoxGeometry;

  constructor(readonly key: string) {
    this.geometry = new THREE.BoxGeometry(0.75, 0.75, 0.75);
    this.material = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.position.y = 0.5;
    this.root.add(mesh);
  }

  update(e: EntityView, alpha: number, time: number): void {
    placeRoot(this.root, e, alpha);
    const mesh = this.root.children[0];
    mesh.rotation.set(time * 5, time * 7, 0);
    // petite boule de feu de blaze : même cube, réduit
    mesh.scale.setScalar(e.mobScale);
    mesh.position.y = 0.5 * e.mobScale;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Nombre de segments de la ligne de pêche. */
const LINE_SEGMENTS = 12;
const BOBBER_RED = 0xd62c2c;
const BOBBER_WHITE = 0xf2f2f2;

/**
 * Flotteur de canne à pêche : deux petits cubes (rouge dessus, blanc dessous) et la ligne
 * qui le relie au bout de la canne (`anchor`, en coordonnées du monde, tenu à jour par le jeu).
 */
class BobberVisual implements Visual {
  readonly root = new THREE.Group();
  stamp = 0;
  private readonly top = new THREE.MeshBasicMaterial({ color: BOBBER_RED });
  private readonly bottom = new THREE.MeshBasicMaterial({ color: BOBBER_WHITE });
  private readonly lineMaterial = new THREE.LineBasicMaterial({ color: 0x101010 });
  private readonly box = new THREE.BoxGeometry(0.14, 0.09, 0.14);
  private readonly lineGeometry = new THREE.BufferGeometry();
  private readonly points = new Float32Array((LINE_SEGMENTS + 1) * 3);

  constructor(readonly key: string, private readonly anchor: THREE.Vector3) {
    const top = new THREE.Mesh(this.box, this.top);
    top.position.y = 0.17;
    const bottom = new THREE.Mesh(this.box, this.bottom);
    bottom.position.y = 0.08;
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.points, 3));
    const line = new THREE.Line(this.lineGeometry, this.lineMaterial);
    // la ligne s'étend bien au-delà du flotteur : pas d'élimination d'après sa boîte
    line.frustumCulled = false;
    this.root.add(top, bottom, line);
  }

  update(e: EntityView, alpha: number): void {
    placeRoot(this.root, e, alpha);
    lightColor(e.skyLight, e.blockLight, worldUniforms.uSkyLight.value, tmpLight);
    this.top.color.setHex(BOBBER_RED).multiply(tmpLight);
    this.bottom.color.setHex(BOBBER_WHITE).multiply(tmpLight);
    // du haut du flotteur jusqu'au bout de la canne, avec un léger ventre (courbe de Minecraft)
    const r = this.root.position;
    const dx = this.anchor.x - r.x;
    const dy = this.anchor.y - r.y - 0.22;
    const dz = this.anchor.z - r.z;
    const pts = this.points;
    for (let i = 0; i <= LINE_SEGMENTS; i++) {
      const t = i / LINE_SEGMENTS;
      pts[i * 3] = dx * t;
      pts[i * 3 + 1] = 0.22 + dy * (t * t + t) * 0.5;
      pts[i * 3 + 2] = dz * t;
    }
    this.lineGeometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.top.dispose();
    this.bottom.dispose();
    this.lineMaterial.dispose();
    this.box.dispose();
    this.lineGeometry.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Afficheur
// ---------------------------------------------------------------------------------------------

export class EntityRenderer {
  private readonly root = new THREE.Group();
  private readonly visuals = new Map<number, Visual>();
  private frame = 0;
  /** Bout de la canne à pêche du joueur, en coordonnées du monde : extrémité de la ligne. À tenir à jour avant `sync`. */
  readonly lineAnchor = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, private readonly atlas: Atlas) {
    this.root.name = 'entities';
    scene.add(this.root);
  }

  /**
   * Synchronise les maillages avec la liste des entités vivantes : crée ceux qui manquent, met à jour
   * position/orientation/animation (interpolation précédent/courant avec alpha 0..1), éclairage,
   * et supprime ceux dont l'entité n'est plus dans la liste.
   * @param time temps en secondes (battement des ailes, lissages)
   */
  sync(entities: Iterable<EntityView>, alpha: number, time: number): void {
    const frame = ++this.frame;
    for (const e of entities) {
      const key = visualKey(e);
      let v = this.visuals.get(e.id);
      if (v && v.key !== key) {
        this.remove(e.id, v);
        v = undefined;
      }
      if (!v) {
        v = this.create(key, e);
        this.visuals.set(e.id, v);
        this.root.add(v.root);
      }
      v.stamp = frame;
      v.root.visible = !e.hidden;
      if (!e.hidden) {
        v.update(e, alpha, time);
        if (e.kind === 'player' && v instanceof MobVisual) v.getHeldTip(this.lineAnchor);
      }
    }
    for (const [id, v] of this.visuals) {
      if (v.stamp !== frame) this.remove(id, v);
    }
  }

  private create(key: string, e: EntityView): Visual {
    switch (e.kind) {
      case 'mob':
      case 'player':
        return new MobVisual(key, this.atlas, e);
      case 'item':
        return new DropVisual(key, this.atlas, e);
      case 'falling_block':
      case 'tnt':
        return new BlockVisual(key, this.atlas, e);
      case 'arrow':
        return new ArrowVisual(key);
      case 'bobber':
        return new BobberVisual(key, this.lineAnchor);
      case 'fireball':
        return new FireballVisual(key);
    }
  }

  private remove(id: number, v: Visual): void {
    this.root.remove(v.root);
    v.dispose();
    this.visuals.delete(id);
  }

  /** Supprime tout (changement de monde). */
  clear(): void {
    for (const [id, v] of this.visuals) this.remove(id, v);
  }

  /** Supprime tout et retire le groupe de la scène. Les géométries et textures partagées restent en cache. */
  dispose(): void {
    this.clear();
    this.scene.remove(this.root);
  }
}
