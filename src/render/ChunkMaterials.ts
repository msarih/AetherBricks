/**
 * Matériaux des chunks et des modèles de blocs isolés.
 *
 * Tout le rendu travaille en espace « écran » (pas de gestion des couleurs de Three.js) :
 * les couleurs écrites par les shaders sont affichées telles quelles, comme dans Minecraft.
 */
import * as THREE from 'three';
import type { PassData } from '../world/mesh/MeshTypes';

/** Uniformes partagés par tous les matériaux du monde (même objet, mis à jour une fois par image). */
export const worldUniforms = {
  /** Couleur de la lumière du ciel (blanc le jour, bleu sombre la nuit). */
  uSkyLight: { value: new THREE.Color(1, 1, 1) },
  uFogColor: { value: new THREE.Color(0.7, 0.8, 1) },
  uFogNear: { value: 80 },
  uFogFar: { value: 160 },
  /** Lumière minimale, même dans le noir complet (voir OVERWORLD_AMBIENT et NETHER_AMBIENT). */
  uAmbient: { value: 0.045 },
};

/** Dans l'Overworld, le noir complet est presque noir. */
export const OVERWORLD_AMBIENT = 0.045;
/** Le Nether n'est jamais tout à fait noir (Minecraft : luminosité minimale de 0,1) : on y devine les murs. */
export const NETHER_AMBIENT = 0.3;

/** Courbe de luminosité d'un niveau de lumière normalisé (0..1), proche de celle de Minecraft. */
export function lightCurve(l: number): number {
  return l / (4 - 3 * l);
}

const BLOCK_LIGHT_R = 1.0;
const BLOCK_LIGHT_G = 0.9;
const BLOCK_LIGHT_B = 0.76;

/**
 * Couleur d'éclairage d'un point (même formule que le shader des chunks).
 * sky et block : niveaux 0..15. skyLight : couleur courante de la lumière du ciel.
 */
export function lightColor(sky: number, block: number, skyLight: THREE.Color, out: THREE.Color): THREE.Color {
  const s = lightCurve(sky / 15);
  const b = lightCurve(block / 15);
  const a = worldUniforms.uAmbient.value;
  out.r = Math.max(s * skyLight.r, b * BLOCK_LIGHT_R) * (1 - a) + a;
  out.g = Math.max(s * skyLight.g, b * BLOCK_LIGHT_G) * (1 - a) + a;
  out.b = Math.max(s * skyLight.b, b * BLOCK_LIGHT_B) * (1 - a) + a;
  return out;
}

const VERTEX = /* glsl */ `
attribute vec4 uvl;
attribute vec4 tint;
attribute vec4 light;
varying vec2 vUv;
varying float vLayer;
varying float vOverlay;
varying vec4 vTint;
varying vec3 vLight;
varying float vFogDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogDepth = length(mv.xyz);
  vUv = uvl.xy;
  vLayer = uvl.z;
  vOverlay = uvl.w;
  vTint = tint;
  vLight = light.xyz;
}
`;

const FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray atlas;
uniform vec3 uSkyLight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAmbient;
uniform float uOpacity;
#ifdef MODEL
uniform vec2 uLight;
uniform vec3 uColor;
#endif
varying vec2 vUv;
varying float vLayer;
varying float vOverlay;
varying vec4 vTint;
varying vec3 vLight;
varying float vFogDepth;

float curve(float l) {
  return l / (4.0 - 3.0 * l);
}

void main() {
  vec3 uvw = vec3(vUv, vLayer);
  vec4 mip = texture(atlas, uvw);
  vec4 sharp = textureLod(atlas, uvw, 0.0);
  vec4 c = mix(mip, sharp, step(0.5, vLight.z));
  vec4 o = texture(atlas, vec3(vUv, max(vOverlay, 0.0)));
  float useOverlay = step(0.0, vOverlay);
  vec3 base = mix(c.rgb * vTint.rgb, mix(c.rgb, o.rgb * vTint.rgb, o.a), useOverlay);
#ifdef ALPHA_TEST
  if (c.a < 0.5) discard;
  float alpha = 1.0;
#else
  float alpha = c.a * uOpacity;
#endif
#ifdef MODEL
  vec2 lv = uLight;
#else
  vec2 lv = vLight.xy;
#endif
  vec3 skyL = curve(lv.x) * uSkyLight;
  vec3 blkL = curve(lv.y) * vec3(${BLOCK_LIGHT_R.toFixed(2)}, ${BLOCK_LIGHT_G.toFixed(2)}, ${BLOCK_LIGHT_B.toFixed(2)});
  vec3 l = max(skyL, blkL) * (1.0 - uAmbient) + uAmbient;
  vec3 col = base * l * vTint.a;
#ifdef MODEL
  col *= uColor;
#endif
  float fog = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFogColor, fog), alpha);
}
`;

export interface ChunkMaterials {
  opaque: THREE.ShaderMaterial;
  translucent: THREE.ShaderMaterial;
}

function baseUniforms(atlas: THREE.Texture): Record<string, THREE.IUniform> {
  return {
    atlas: { value: atlas },
    uSkyLight: worldUniforms.uSkyLight,
    uFogColor: worldUniforms.uFogColor,
    uFogNear: worldUniforms.uFogNear,
    uFogFar: worldUniforms.uFogFar,
    uAmbient: worldUniforms.uAmbient,
    uOpacity: { value: 1 },
  };
}

/** Matériaux des deux passes de rendu des chunks. */
export function createChunkMaterials(atlas: THREE.Texture): ChunkMaterials {
  const opaque = new THREE.ShaderMaterial({
    uniforms: baseUniforms(atlas),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { ALPHA_TEST: 1 },
    side: THREE.FrontSide,
  });
  const translucent = new THREE.ShaderMaterial({
    uniforms: baseUniforms(atlas),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
  });
  return { opaque, translucent };
}

export interface ModelMaterialOptions {
  /** Passe translucide (eau, glace) : mélange alpha au lieu du test alpha. */
  translucent?: boolean;
  /** Désactive le test de profondeur (objets tenus en main, icônes). */
  depthTest?: boolean;
}

/**
 * Matériau d'un modèle de bloc isolé (objet au sol, bloc tenu, bloc qui tombe, icône).
 * La lumière vient des uniformes `uLight` (ciel, bloc : 0..1) et la couleur est multipliée par `uColor`.
 * Chaque maillage doit avoir sa propre instance (les uniformes sont propres à l'instance).
 */
export function createModelMaterial(atlas: THREE.Texture, options: ModelMaterialOptions = {}): THREE.ShaderMaterial {
  const uniforms = baseUniforms(atlas);
  uniforms.uLight = { value: new THREE.Vector2(1, 0) };
  uniforms.uColor = { value: new THREE.Color(1, 1, 1) };
  const defines: Record<string, number> = { MODEL: 1 };
  if (!options.translucent) defines.ALPHA_TEST = 1;
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines,
    side: THREE.FrontSide,
    transparent: !!options.translucent,
    depthWrite: !options.translucent,
    depthTest: options.depthTest !== false,
  });
}

/** Construit la géométrie Three.js d'une passe produite par le mailleur. */
export function passGeometry(p: PassData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
  g.setAttribute('uvl', new THREE.BufferAttribute(p.uvs, 4));
  g.setAttribute('tint', new THREE.BufferAttribute(p.colors, 4, true));
  g.setAttribute('light', new THREE.BufferAttribute(p.lights, 4, true));
  g.setIndex(new THREE.BufferAttribute(p.indices, 1));
  return g;
}
