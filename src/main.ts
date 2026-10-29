import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { VoxelWorld } from './world/VoxelWorld';
import { PlayerController } from './player/PlayerController';
import { SoundManager } from './audio/SoundManager';
import {
  BrickEntry,
  getBrutalistArchPreset,
  getStarterScene,
  getWhitePavilionPreset,
} from './world/Presets';

interface LightingPreset {
  name: string;
  skyColor: number;
  fogColor: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunOffset: THREE.Vector3;
}

const LIGHTING_PRESETS: LightingPreset[] = [
  {
    name: 'MATIN PUR',
    skyColor: 0xdbeafe,
    fogColor: 0xdbeafe,
    hemiSky: 0xf8fafc,
    hemiGround: 0x94a3b8,
    hemiIntensity: 0.9,
    sunColor: 0xfffbeb,
    sunIntensity: 2.35,
    sunOffset: new THREE.Vector3(38, 52, 32),
  },
  {
    name: 'ZÉNITH',
    skyColor: 0xbae6fd,
    fogColor: 0xe0f2fe,
    hemiSky: 0xffffff,
    hemiGround: 0xcbd5e1,
    hemiIntensity: 1.05,
    sunColor: 0xffffff,
    sunIntensity: 2.65,
    sunOffset: new THREE.Vector3(14, 72, 16),
  },
  {
    name: 'GOLDEN HOUR',
    skyColor: 0xfed7aa,
    fogColor: 0xffedd5,
    hemiSky: 0xffedd5,
    hemiGround: 0x64748b,
    hemiIntensity: 0.75,
    sunColor: 0xfdba74,
    sunIntensity: 2.5,
    sunOffset: new THREE.Vector3(56, 22, 28),
  },
  {
    name: 'NUIT CLAIRE',
    skyColor: 0x0f172a,
    fogColor: 0x0f172a,
    hemiSky: 0x38bdf8,
    hemiGround: 0x020617,
    hemiIntensity: 0.38,
    sunColor: 0x93c5fd,
    sunIntensity: 0.95,
    sunOffset: new THREE.Vector3(-32, 46, -24),
  },
];

// --- Scene, Camera & High-Fidelity Renderer ---
const container = document.getElementById('canvas-container')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(LIGHTING_PRESETS[0].skyColor);
scene.fog = new THREE.FogExp2(LIGHTING_PRESETS[0].fogColor, 0.011);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 220);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
container.appendChild(renderer.domElement);

// Post-processing pipeline (RenderPass + subtle UnrealBloomPass + OutputPass)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.18, // subtle architectural glow
  0.45,
  0.88
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// --- Lighting ---
const hemiLight = new THREE.HemisphereLight(
  LIGHTING_PRESETS[0].hemiSky,
  LIGHTING_PRESETS[0].hemiGround,
  LIGHTING_PRESETS[0].hemiIntensity
);
hemiLight.position.set(0, 60, 0);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(
  LIGHTING_PRESETS[0].sunColor,
  LIGHTING_PRESETS[0].sunIntensity
);
sunLight.position.copy(LIGHTING_PRESETS[0].sunOffset);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 4096;
sunLight.shadow.mapSize.height = 4096;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 150;
const shadowExtent = 44;
sunLight.shadow.camera.left = -shadowExtent;
sunLight.shadow.camera.right = shadowExtent;
sunLight.shadow.camera.top = shadowExtent;
sunLight.shadow.camera.bottom = -shadowExtent;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.02;
scene.add(sunLight);
scene.add(sunLight.target);

// --- Core Systems ---
const sound = new SoundManager();
const world = new VoxelWorld(scene);

const studioOverlay = document.getElementById('studio-overlay')!;
const crosshairEl = document.getElementById('crosshair')!;
const statBricksEl = document.getElementById('stat-bricks')!;
const statPosEl = document.getElementById('stat-pos')!;
const statModeEl = document.getElementById('stat-mode')!;
const statTimeEl = document.getElementById('stat-time')!;
const activeBrickNameEl = document.getElementById('active-brick-name')!;
const activeBrickSubEl = document.getElementById('active-brick-sub')!;
const hotbarEl = document.getElementById('hotbar')!;
const toastEl = document.getElementById('toast')!;

let toastTimeout: number | undefined;
function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2000);
}

const player = new PlayerController(camera, renderer.domElement, world, sound, (locked) => {
  if (locked) {
    studioOverlay.classList.add('hidden');
  } else {
    studioOverlay.classList.remove('hidden');
  }
});

// --- Hotbar & Active Brick Selection ---
let selectedBrickId = 1;

function renderHotbar(): void {
  hotbarEl.innerHTML = '';
  for (const [id, def] of world.catalog) {
    const slot = document.createElement('div');
    slot.className = `hotbar-slot ${id === selectedBrickId ? 'active' : ''}`;
    slot.innerHTML = `
      <span class="slot-key">${id}</span>
      <div class="slot-swatch" style="background: ${def.previewCss}"></div>
    `;
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      selectBrick(id);
    });
    hotbarEl.appendChild(slot);
  }
  const activeDef = world.catalog.get(selectedBrickId)!;
  activeBrickNameEl.textContent = activeDef.name;
  activeBrickSubEl.textContent = activeDef.subtitle;
}

function selectBrick(id: number): void {
  if (!world.catalog.has(id)) return;
  selectedBrickId = id;
  sound.playSelect();
  renderHotbar();
}

renderHotbar();

// --- Time of Day Control ---
let currentLightingIdx = 0;
function applyLighting(index: number): void {
  currentLightingIdx = (index + LIGHTING_PRESETS.length) % LIGHTING_PRESETS.length;
  const preset = LIGHTING_PRESETS[currentLightingIdx];
  scene.background = new THREE.Color(preset.skyColor);
  scene.fog = new THREE.FogExp2(preset.fogColor, 0.011);
  hemiLight.color.setHex(preset.hemiSky);
  hemiLight.groundColor.setHex(preset.hemiGround);
  hemiLight.intensity = preset.hemiIntensity;
  sunLight.color.setHex(preset.sunColor);
  sunLight.intensity = preset.sunIntensity;
  statTimeEl.textContent = preset.name;

  document.querySelectorAll('.time-btn').forEach((btn) => {
    const idx = Number((btn as HTMLElement).dataset.time);
    btn.classList.toggle('active', idx === currentLightingIdx);
  });
}

// --- Mouse & Keyboard Construction Events ---
window.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!player.isLocked) {
    player.requestLock();
    return;
  }

  const target = world.currentTarget;
  if (!target) return;

  // Left click: Place brick (unless Shift+Click or Alt+Click)
  if (e.button === 0 && !e.altKey) {
    const { x, y, z } = target.placePos;
    if (player.intersectsBrick(x, y, z)) {
      showToast('Espace occupé par le joueur');
      return;
    }
    if (world.setBrick(x, y, z, selectedBrickId, true, true)) {
      sound.playPlace();
    }
  }
  // Right click (or Alt+Left click): Remove brick
  else if (e.button === 2 || (e.button === 0 && e.altKey)) {
    if (target.removePos) {
      const { x, y, z } = target.removePos;
      if (world.removeBrick(x, y, z, true, true)) {
        sound.playRemove();
      }
    }
  }
  // Middle click: Eyedropper
  else if (e.button === 1) {
    if (target.hitBrickType) {
      selectBrick(target.hitBrickType);
    }
  }
});

window.addEventListener(
  'wheel',
  (e) => {
    if (!player.isLocked) return;
    const total = world.catalog.size;
    if (e.deltaY > 0) {
      selectBrick((selectedBrickId % total) + 1);
    } else if (e.deltaY < 0) {
      selectBrick(((selectedBrickId - 2 + total) % total) + 1);
    }
  },
  { passive: true }
);

window.addEventListener('keydown', (e) => {
  // Number keys 1..6
  if (e.code.startsWith('Digit')) {
    const num = Number(e.code.replace('Digit', ''));
    if (num >= 1 && num <= 6) {
      selectBrick(num);
    }
  }

  // Undo / Redo
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) {
      if (world.redo()) {
        sound.playPlace();
        showToast('Action rétablie');
      }
    } else if (world.undo()) {
      sound.playRemove();
      showToast('Action annulée');
    }
  } else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyY') {
    e.preventDefault();
    if (world.redo()) {
      sound.playPlace();
      showToast('Action rétablie');
    }
  }

  // Time of day cycle (T)
  if (e.code === 'KeyT' && player.isLocked) {
    applyLighting(currentLightingIdx + 1);
    sound.playSelect();
    showToast(`Lumière : ${LIGHTING_PRESETS[currentLightingIdx].name}`);
  }

  // Eyedropper (P)
  if (e.code === 'KeyP' && player.isLocked && world.currentTarget?.hitBrickType) {
    selectBrick(world.currentTarget.hitBrickType);
  }
});

// --- Studio Modal Controls ---
document.getElementById('btn-resume')!.addEventListener('click', () => {
  player.requestLock();
});

document.getElementById('btn-flat-empty')!.addEventListener('click', () => {
  world.clearAll(true);
  player.resetPosition();
  showToast('Terrain plat vierge initialisé');
  player.requestLock();
});

document.getElementById('btn-starter')!.addEventListener('click', () => {
  world.loadPreset(getStarterScene(), true);
  player.resetPosition();
  showToast('Socle initial en briques blanches chargé');
  player.requestLock();
});

document.getElementById('btn-pavilion')!.addEventListener('click', () => {
  world.loadPreset(getWhitePavilionPreset(), true);
  player.resetPosition();
  showToast('Pavillon Minimaliste Blanc généré');
  player.requestLock();
});

document.getElementById('btn-arch')!.addEventListener('click', () => {
  world.loadPreset(getBrutalistArchPreset(), true);
  player.resetPosition();
  showToast('Arche Brutaliste Blanche générée');
  player.requestLock();
});

document.querySelectorAll('.time-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = Number((btn as HTMLElement).dataset.time);
    applyLighting(idx);
  });
});

document.getElementById('btn-export')!.addEventListener('click', () => {
  const data = JSON.stringify(world.serialize(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aetherbricks-construction-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Construction exportée en JSON');
});

const fileImportEl = document.getElementById('file-import') as HTMLInputElement;
document.getElementById('btn-import')!.addEventListener('click', () => {
  fileImportEl.click();
});

fileImportEl.addEventListener('change', () => {
  const file = fileImportEl.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const entries = JSON.parse(String(reader.result)) as BrickEntry[];
      if (Array.isArray(entries)) {
        world.loadPreset(entries, true);
        showToast(`${entries.length} briques blanches importées`);
        player.requestLock();
      }
    } catch {
      showToast('Fichier JSON invalide');
    }
  };
  reader.readAsText(file);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- Main Render Loop ---
let lastTime = performance.now();

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (player.isLocked) {
    player.update(dt);
  }
  world.update(dt, camera);

  // Follow player with directional shadow frustum for ultra-sharp brick shadows everywhere
  const preset = LIGHTING_PRESETS[currentLightingIdx];
  sunLight.position.copy(player.position).add(preset.sunOffset);
  sunLight.target.position.copy(player.position);
  sunLight.target.updateMatrixWorld();

  // HUD Updates
  crosshairEl.classList.toggle('active', world.currentTarget !== null);
  statBricksEl.textContent = String(world.getBrickCount());
  statPosEl.textContent = `${Math.round(player.position.x)}, ${Math.round(player.position.y)}, ${Math.round(player.position.z)}`;
  statModeEl.textContent = player.isFlying ? 'VOL LIBRE' : 'MARCHE';

  composer.render();
}

requestAnimationFrame(animate);
