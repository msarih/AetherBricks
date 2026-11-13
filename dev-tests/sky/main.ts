/**
 * Page de test du ciel (src/render/Sky.ts) : reproduit le réglage du moteur
 * (gestion des couleurs désactivée, autoClear false, effacement avec sky.skyColor)
 * sur un petit décor (sol en damier, piliers, toit, zone enneigée).
 *
 * Pilotage : `window.__sky.set({ time, rain, thunder, vd, cam: [x, y, z], yaw, pitch, speed, clouds, aide })`
 * ou paramètres d'URL (?time=6000&rain=1&yaw=90…). Clavier : flèches = regarder, T/G = heure ±500,
 * R = pluie, O = orage, L = éclair, N = nuages, Z/S = monter/descendre, espace = écoulement du temps.
 */
import * as THREE from 'three';
import { Sky } from '../../src/render/Sky';
import { worldUniforms } from '../../src/render/ChunkMaterials';

THREE.ColorManagement.enabled = false;

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000);
camera.rotation.order = 'YXZ';

interface State {
  time: number;
  rain: number;
  thunder: number;
  vd: number;
  cam: [number, number, number];
  /** Cap en degrés : 0 = vers −z (nord), 90 = vers +x (est), 270 = vers −x (ouest). */
  yaw: number;
  pitch: number;
  /** Ticks de jeu par seconde réelle (20 = vitesse de Minecraft). */
  speed: number;
  clouds: boolean;
  aide: boolean;
}

const state: State = {
  time: 6000,
  rain: 0,
  thunder: 0,
  vd: 192,
  cam: [0.5, 64.6, 0.5],
  yaw: 0,
  pitch: 10,
  speed: 0,
  clouds: true,
  aide: true,
};

const params = new URLSearchParams(location.search);
for (const key of ['time', 'rain', 'thunder', 'vd', 'yaw', 'pitch', 'speed'] as const) {
  const v = params.get(key);
  if (v !== null) state[key] = Number(v);
}
if (params.get('cam')) state.cam = params.get('cam')!.split(',').map(Number) as [number, number, number];
if (params.get('clouds') === '0') state.clouds = false;
if (params.get('aide') === '0') state.aide = false;

// --- Décor : même brouillard et même lumière du ciel que les chunks ---
function terrainMaterial(checker: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSkyLight: worldUniforms.uSkyLight,
      uFogColor: worldUniforms.uFogColor,
      uFogNear: worldUniforms.uFogNear,
      uFogFar: worldUniforms.uFogFar,
      uColor: { value: new THREE.Color(0.36, 0.62, 0.25) },
      uChecker: { value: checker ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * wp;
        vView = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSkyLight;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform vec3 uColor;
      uniform float uChecker;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec3 cell = floor(vWorld + vNormal * 0.01 - vec3(0.0, 0.001, 0.0));
        float c = mod(cell.x + cell.y + cell.z, 2.0);
        vec3 col = uColor * mix(1.0, mix(0.86, 1.0, c), uChecker);
        float face = abs(vNormal.y) > 0.5 ? (vNormal.y > 0.0 ? 1.0 : 0.5) : (abs(vNormal.x) > 0.5 ? 0.6 : 0.8);
        col *= face * (uSkyLight * 0.955 + 0.045);
        float fog = clamp((length(vView) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
      }
    `,
  });
}

const GROUND_Y = 63;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), terrainMaterial(true));
ground.rotation.x = -Math.PI / 2;
ground.position.y = GROUND_Y;
scene.add(ground);

interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  color: [number, number, number];
}
const boxes: Box[] = [
  // Toit sur quatre poteaux (la pluie doit s'arrêter dessus).
  { x0: 3, z0: -10, x1: 9, z1: -4, y0: 67, y1: 68, color: [0.55, 0.36, 0.2] },
  { x0: 3, z0: -10, x1: 4, z1: -9, y0: 63, y1: 67, color: [0.45, 0.3, 0.17] },
  { x0: 8, z0: -10, x1: 9, z1: -9, y0: 63, y1: 67, color: [0.45, 0.3, 0.17] },
  { x0: 3, z0: -5, x1: 4, z1: -4, y0: 63, y1: 67, color: [0.45, 0.3, 0.17] },
  { x0: 8, z0: -5, x1: 9, z1: -4, y0: 63, y1: 67, color: [0.45, 0.3, 0.17] },
  // Piliers et collines lointaines.
  { x0: -6, z0: -14, x1: -4, z1: -12, y0: 63, y1: 75, color: [0.5, 0.5, 0.52] },
  { x0: 30, z0: -40, x1: 50, z1: -20, y0: 63, y1: 72, color: [0.36, 0.62, 0.25] },
  { x0: -90, z0: -30, x1: -60, z1: 10, y0: 63, y1: 84, color: [0.4, 0.55, 0.3] },
  { x0: 70, z0: 20, x1: 110, z1: 60, y0: 63, y1: 90, color: [0.42, 0.58, 0.3] },
  { x0: -20, z0: -160, x1: 30, z1: -120, y0: 63, y1: 100, color: [0.5, 0.5, 0.52] },
  { x0: -10, z0: 60, x1: 10, z1: 80, y0: 63, y1: 78, color: [0.86, 0.82, 0.62] },
];
for (const b of boxes) {
  const m = terrainMaterial(true);
  (m.uniforms.uColor.value as THREE.Color).setRGB(b.color[0], b.color[1], b.color[2]);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), m);
  mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  scene.add(mesh);
}

const sky = new Sky(scene, {
  rainHeight(x: number, z: number): number {
    let top = GROUND_Y;
    for (const b of boxes) {
      if (x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1 && b.y1 > top) top = b.y1;
    }
    return top;
  },
  // Biome froid à l'ouest (x < −4).
  isSnowy(x: number, _z: number): boolean {
    return x < -4;
  },
});

const aide = document.getElementById('aide')!;
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyT') state.time = (state.time + 500) % 24000;
  if (e.code === 'KeyG') state.time = (state.time + 23500) % 24000;
  if (e.code === 'KeyR') state.rain = state.rain > 0.5 ? 0 : 1;
  if (e.code === 'KeyO') state.thunder = state.thunder > 0.5 ? 0 : 1;
  if (e.code === 'KeyL') sky.lightning();
  if (e.code === 'KeyN') state.clouds = !state.clouds;
  if (e.code === 'Space') state.speed = state.speed ? 0 : 400;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

let rainNow = state.rain;
let thunderNow = state.thunder;
let frames = 0;
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (keys.has('ArrowLeft')) state.yaw -= 90 * dt;
  if (keys.has('ArrowRight')) state.yaw += 90 * dt;
  if (keys.has('ArrowUp')) state.pitch = Math.min(89, state.pitch + 60 * dt);
  if (keys.has('ArrowDown')) state.pitch = Math.max(-89, state.pitch - 60 * dt);
  if (keys.has('KeyZ')) state.cam[1] += 30 * dt;
  if (keys.has('KeyS')) state.cam[1] -= 30 * dt;
  state.time = (state.time + state.speed * dt) % 24000;
  // Comme le moteur : pluie et orage interpolés en douceur.
  rainNow += (state.rain - rainNow) * Math.min(1, dt * 1.5);
  thunderNow += (state.thunder - thunderNow) * Math.min(1, dt * 1.5);

  camera.position.set(state.cam[0], state.cam[1], state.cam[2]);
  camera.rotation.set(THREE.MathUtils.degToRad(state.pitch), -THREE.MathUtils.degToRad(state.yaw), 0);
  camera.updateMatrixWorld();

  sky.setCloudsVisible(state.clouds);
  sky.update(dt, camera, state.time, rainNow, thunderNow, state.vd);

  // Ce que fait le moteur avec les valeurs calculées par le ciel.
  worldUniforms.uSkyLight.value.copy(sky.skyLight);
  worldUniforms.uFogColor.value.copy(sky.fogColor);
  worldUniforms.uFogNear.value = state.vd * 0.55;
  worldUniforms.uFogFar.value = state.vd;

  renderer.setClearColor(sky.skyColor, 1);
  renderer.clear();
  renderer.render(scene, camera);
  frames++;

  aide.style.display = state.aide ? 'block' : 'none';
  if (state.aide) {
    aide.textContent =
      `tick ${state.time.toFixed(0)}  pluie ${rainNow.toFixed(2)}  orage ${thunderNow.toFixed(2)}  jour ${sky.dayFactor.toFixed(2)}  flash ${sky.flash.toFixed(2)}\n` +
      `cap ${state.yaw.toFixed(0)}°  site ${state.pitch.toFixed(0)}°  y ${state.cam[1].toFixed(1)}  vue ${state.vd}  lune ${sky.moonPhase}  tris ${renderer.info.render.triangles}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const api = {
  state,
  sky,
  renderer,
  /** Applique un état ; la pluie et l'orage sont appliqués immédiatement (pas d'interpolation). */
  set(partial: Partial<State> & { moonPhase?: number }): void {
    const { moonPhase, ...rest } = partial;
    Object.assign(state, rest);
    rainNow = state.rain;
    thunderNow = state.thunder;
    if (moonPhase !== undefined) sky.moonPhase = moonPhase;
  },
  lightning(): void {
    sky.lightning();
  },
  frames(): number {
    return frames;
  },
};
(window as unknown as { __sky: typeof api }).__sky = api;
