/**
 * Page de test des particules (hors jeu) : faux monde plat, un mur, un bassin, une zone sombre.
 *
 * Aucune boucle d'animation par défaut : les captures pilotent la simulation par `window.__p`
 * (`step(n, dt)`), ce qui les rend reproductibles. `?anim=1` lance une démonstration en continu.
 */
import * as THREE from 'three';
import { Atlas } from '../../src/render/Atlas';
import { worldUniforms } from '../../src/render/ChunkMaterials';
import { Particles, type ParticleKind, type ParticleWorld } from '../../src/render/Particles';
import { T } from '../../src/world/Tiles';

// même réglage que le moteur : couleurs « écran », aucune gestion des couleurs
THREE.ColorManagement.enabled = false;

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0.55, 0.72, 1);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 400);

// ---------------------------------------------------------------------------------------------
// Faux monde
// ---------------------------------------------------------------------------------------------

const GROUND = 64;
/** Zone sombre (grotte) : ciel faible, une « torche » y donne de la lumière de bloc. */
const DARK_X = 8;
const TORCH = [11, 65, 0];

function inWall(x: number, y: number, z: number): boolean {
  return x >= 3 && x <= 4 && y >= GROUND && y < GROUND + 3 && z >= -3 && z <= 3;
}
function inCeiling(x: number, y: number, z: number): boolean {
  return x >= -2 && x <= 0 && y === GROUND + 3 && z >= -6 && z <= -4;
}
function inPool(x: number, y: number, z: number): boolean {
  return x >= -8 && x <= -5 && y >= GROUND && y <= GROUND + 1 && z >= -2 && z <= 1;
}

const world: ParticleWorld = {
  isSolid: (x, y, z) => y < GROUND || inWall(x, y, z) || inCeiling(x, y, z),
  isWater: inPool,
  lightAt: (x, y, z) => {
    if (world.isSolid(x, y, z)) return 0;
    const sky = x >= DARK_X ? 2 : 15;
    const d = Math.abs(x - TORCH[0]) + Math.abs(y - TORCH[1]) + Math.abs(z - TORCH[2]);
    const block = Math.max(0, 14 - d);
    return (sky << 4) | block;
  },
};

// décor : couleurs unies (MeshBasicMaterial, affichées telles quelles) + damier d'un bloc au sol
function checker(a: string, b: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 2, 2);
  g.fillStyle = b;
  g.fillRect(0, 0, 1, 1);
  g.fillRect(1, 1, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  scene.add(m);
  return m;
}

{
  const tex = checker('#5d9b47', '#55903f');
  tex.repeat.set(32, 32);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), new THREE.MeshBasicMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND, 0);
  scene.add(ground);
  // sol de la zone sombre
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(24, 64), new THREE.MeshBasicMaterial({ color: 0x23252b }));
  dark.rotation.x = -Math.PI / 2;
  dark.position.set(DARK_X + 12, GROUND + 0.002, 0);
  scene.add(dark);
  box(3, GROUND, -3, 5, GROUND + 3, 4, new THREE.MeshBasicMaterial({ color: 0x7d7d7d }));
  box(-2, GROUND + 3, -6, 1, GROUND + 4, -3, new THREE.MeshBasicMaterial({ color: 0x8a6a45 }));
  const water = box(-8, GROUND, -2, -4, GROUND + 1.9, 2, new THREE.MeshBasicMaterial({ color: 0x2f5fd0, transparent: true, opacity: 0.45, depthWrite: false }));
  water.renderOrder = 0;
  box(TORCH[0] + 0.45, TORCH[1], TORCH[2] + 0.45, TORCH[0] + 0.55, TORCH[1] + 0.6, TORCH[2] + 0.55, new THREE.MeshBasicMaterial({ color: 0x8a6a45 }));
}

const atlas = new Atlas();
const particles = new Particles(scene, atlas, world);

// ---------------------------------------------------------------------------------------------
// Pilotage
// ---------------------------------------------------------------------------------------------

function setCamera(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void {
  camera.position.set(px, py, pz);
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld();
}
setCamera(0, 66.5, 9, 0, 65, 0);

function render(): void {
  renderer.render(scene, camera);
}

/** Avance la simulation de n images de dt secondes, puis dessine. */
function step(n = 1, dt = 1 / 60): void {
  for (let i = 0; i < n; i++) particles.update(dt, camera);
  render();
}

/** Affiche la feuille de sprites agrandie (couches de la texture privée du système). */
function showSprites(on: boolean): void {
  const cv = document.getElementById('feuille') as HTMLCanvasElement;
  cv.style.display = on ? 'block' : 'none';
  if (!on) return;
  const tex = (particles as unknown as { sprites: THREE.DataArrayTexture }).sprites;
  const { data, width, height, depth } = tex.image as { data: Uint8Array; width: number; height: number; depth: number };
  const cols = 8;
  const rows = Math.ceil(depth / cols);
  const pad = 2;
  cv.width = cols * (width + pad) + pad;
  cv.height = rows * (height + pad) + pad;
  cv.style.width = `${cv.width * 8}px`;
  cv.style.height = `${cv.height * 8}px`;
  const g = cv.getContext('2d')!;
  for (let l = 0; l < depth; l++) {
    const img = g.createImageData(width, height);
    img.data.set(data.subarray(l * width * height * 4, (l + 1) * width * height * 4));
    g.putImageData(img, pad + (l % cols) * (width + pad), pad + Math.floor(l / cols) * (height + pad));
  }
}

function alive(): number {
  const life = (particles as unknown as { life: Float32Array }).life;
  let n = 0;
  for (let i = 0; i < life.length; i++) if (life[i] > 0) n++;
  return n;
}

const api = { THREE, T, particles, atlas, world, worldUniforms, scene, camera, renderer, setCamera, render, step, showSprites, alive };
(window as unknown as { __p: typeof api }).__p = api;
render();

// --- démonstration en continu : ?anim=1 ---
if (new URLSearchParams(location.search).get('anim') === '1') {
  const kinds: ParticleKind[] = [
    'smoke', 'large_smoke', 'flame', 'lava', 'splash', 'bubble', 'explosion', 'crit', 'heart',
    'note', 'snow', 'slime', 'portal', 'rain', 'drip_water', 'drip_lava', 'egg', 'bonemeal',
  ];
  const aide = document.getElementById('aide')!;
  aide.textContent = kinds.map((k, i) => `${i - 8} : ${k}`).join('\n');
  let last = performance.now();
  let acc = 0;
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    if (acc > 0.25) {
      acc = 0;
      // les bulles n'existent que dans l'eau : elles partent du fond du bassin
      kinds.forEach((k, i) => {
        if (k === 'bubble') particles.spawn(k, -6, 64.3, 0, 3, 0.4);
        else particles.spawn(k, (i - 8) * 0.9 + 0.5, 65.2, 2, 3, 0.15);
      });
      particles.blockBreak(Math.floor(Math.random() * 6) - 3, 64, -2, T.stone, 0xffffff);
    }
    particles.update(dt, camera);
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
