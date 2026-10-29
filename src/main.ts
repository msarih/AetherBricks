import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { VoxelWorld } from './world/VoxelWorld';
import { CountrysideEnv } from './world/CountrysideEnv';
import { PlayerController, CameraViewMode } from './player/PlayerController';
import { SoundManager } from './audio/SoundManager';
import { isFlatSlab, isTwoBlocksTall } from './world/ArchitecturalObjects';
import { BrickDefinition, CATEGORY_DEFINITIONS, ItemCategory } from './world/Materials';
import {
  BrickEntry,
  getBrutalistArchPreset,
  getStarterScene,
  getWhitePavilionPreset,
} from './world/Presets';

interface LightingPreset {
  name: string;
  elevationDeg: number;
  azimuthDeg: number;
  turbidity: number;
  rayleigh: number;
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
}

const LIGHTING_PRESETS: LightingPreset[] = [
  {
    name: 'SOLEIL DE CAMPAGNE',
    elevationDeg: 34,
    azimuthDeg: 142,
    turbidity: 2.8,
    rayleigh: 1.5,
    fogColor: 0xdbeafe,
    fogDensity: 0.0055,
    hemiSky: 0xf0f9ff,
    hemiGround: 0x4d7c38,
    hemiIntensity: 0.78,
    sunColor: 0xfffbeb,
    sunIntensity: 2.8,
  },
  {
    name: 'ZÉNITH D’ÉTÉ',
    elevationDeg: 62,
    azimuthDeg: 170,
    turbidity: 2.2,
    rayleigh: 1.2,
    fogColor: 0xe0f2fe,
    fogDensity: 0.0045,
    hemiSky: 0xffffff,
    hemiGround: 0x558b3e,
    hemiIntensity: 0.9,
    sunColor: 0xffffff,
    sunIntensity: 3.1,
  },
  {
    name: 'GOLDEN HOUR',
    elevationDeg: 11,
    azimuthDeg: 215,
    turbidity: 6.5,
    rayleigh: 2.6,
    fogColor: 0xfed7aa,
    fogDensity: 0.0068,
    hemiSky: 0xffedd5,
    hemiGround: 0x3f6229,
    hemiIntensity: 0.65,
    sunColor: 0xfdba74,
    sunIntensity: 2.6,
  },
  {
    name: 'CLAIR DE LUNE',
    elevationDeg: 24,
    azimuthDeg: 40,
    turbidity: 1.5,
    rayleigh: 0.4,
    fogColor: 0x0f172a,
    fogDensity: 0.0085,
    hemiSky: 0x38bdf8,
    hemiGround: 0x0f1f14,
    hemiIntensity: 0.28,
    sunColor: 0x93c5fd,
    sunIntensity: 0.85,
  },
];

// --- Scene, Camera & High-Fidelity Renderer ---
const container = document.getElementById('canvas-container')!;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(LIGHTING_PRESETS[0].fogColor, LIGHTING_PRESETS[0].fogDensity);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 350);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;
container.appendChild(renderer.domElement);

// Post-processing pipeline (RenderPass + subtle UnrealBloomPass + OutputPass)
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.14,
  0.4,
  0.9
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
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 4096;
sunLight.shadow.mapSize.height = 4096;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 160;
const shadowExtent = 38;
sunLight.shadow.camera.left = -shadowExtent;
sunLight.shadow.camera.right = shadowExtent;
sunLight.shadow.camera.top = shadowExtent;
sunLight.shadow.camera.bottom = -shadowExtent;
sunLight.shadow.bias = -0.0003;
sunLight.shadow.normalBias = 0.022;
scene.add(sunLight);
scene.add(sunLight.target);

// --- Countryside Environment (3D Wind Grass, Wildflowers, Trees, Sky & PMREM Reflections) ---
const countryside = new CountrysideEnv(scene, renderer);
let currentSunDir = countryside.updateSunAndEnvironment(
  LIGHTING_PRESETS[0].elevationDeg,
  LIGHTING_PRESETS[0].azimuthDeg,
  LIGHTING_PRESETS[0].turbidity,
  LIGHTING_PRESETS[0].rayleigh
);

// --- Core Systems ---
const sound = new SoundManager();
const world = new VoxelWorld(scene, countryside);

const studioOverlay = document.getElementById('studio-overlay')!;
const crosshairEl = document.getElementById('crosshair')!;
const interactionHintEl = document.getElementById('interaction-hint')!;
const statBricksEl = document.getElementById('stat-bricks')!;
const statPosEl = document.getElementById('stat-pos')!;
const statModeEl = document.getElementById('stat-mode')!;
const statViewEl = document.getElementById('stat-view')!;
const statTimeEl = document.getElementById('stat-time')!;
const activeBrickNameEl = document.getElementById('active-brick-name')!;
const activeBrickSubEl = document.getElementById('active-brick-sub')!;
const categoryTabsEl = document.getElementById('category-tabs')!;
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

const player = new PlayerController(
  camera,
  renderer.domElement,
  world,
  sound,
  (locked) => {
    if (locked) {
      studioOverlay.classList.add('hidden');
    } else {
      studioOverlay.classList.remove('hidden');
    }
  },
  (viewMode) => {
    statViewEl.textContent = player.getViewModeLabel();
    showToast(`Vue : ${player.getViewModeLabel()}`);
    document.querySelectorAll('.view-btn').forEach((btn) => {
      const m = (btn as HTMLElement).dataset.view;
      btn.classList.toggle('active', m === viewMode);
    });
  }
);

// --- Categorized Inventory & Hotbar Selection ---
let activeCategory: ItemCategory = 'bricks';
let selectedBrickId = 1;

function getItemsByCategory(cat: ItemCategory): BrickDefinition[] {
  const list: BrickDefinition[] = [];
  for (const [, def] of world.catalog) {
    if (def.category === cat) {
      list.push(def);
    }
  }
  return list;
}

function renderInventoryUI(): void {
  // 1. Render Category Tabs
  categoryTabsEl.innerHTML = '';
  for (const catDef of CATEGORY_DEFINITIONS) {
    const btn = document.createElement('button');
    btn.className = `category-tab ${catDef.id === activeCategory ? 'active' : ''}`;
    btn.innerHTML = `<span>${catDef.icon}</span><span>${catDef.label}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCategory(catDef.id);
    });
    categoryTabsEl.appendChild(btn);
  }

  // 2. Render Hotbar Slots for Active Category
  hotbarEl.innerHTML = '';
  const items = getItemsByCategory(activeCategory);
  items.forEach((def, idx) => {
    const slot = document.createElement('div');
    slot.className = `hotbar-slot ${def.id === selectedBrickId ? 'active' : ''}`;
    slot.title = def.name;
    slot.innerHTML = `
      <span class="slot-key">${idx + 1}</span>
      <div class="slot-swatch" style="background: ${def.previewCss}"></div>
    `;
    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      selectBrick(def.id);
    });
    hotbarEl.appendChild(slot);
  });

  const activeDef = world.catalog.get(selectedBrickId)!;
  activeBrickNameEl.textContent = activeDef.name;
  activeBrickSubEl.textContent = activeDef.subtitle;
  world.setGhostMode(selectedBrickId);
}

function selectCategory(cat: ItemCategory, autoSelectFirst = true): void {
  activeCategory = cat;
  const items = getItemsByCategory(cat);
  if (autoSelectFirst && items.length > 0 && !items.some((i) => i.id === selectedBrickId)) {
    selectedBrickId = items[0].id;
  }
  sound.playSelect();
  renderInventoryUI();
}

function selectBrick(id: number): void {
  const def = world.catalog.get(id);
  if (!def) return;
  selectedBrickId = id;
  activeCategory = def.category;
  sound.playSelect();
  renderInventoryUI();
}

renderInventoryUI();

// --- Time of Day Control ---
let currentLightingIdx = 0;
function applyLighting(index: number): void {
  currentLightingIdx = (index + LIGHTING_PRESETS.length) % LIGHTING_PRESETS.length;
  const preset = LIGHTING_PRESETS[currentLightingIdx];

  currentSunDir = countryside.updateSunAndEnvironment(
    preset.elevationDeg,
    preset.azimuthDeg,
    preset.turbidity,
    preset.rayleigh
  );

  scene.fog = new THREE.FogExp2(preset.fogColor, preset.fogDensity);
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

  // Left click: Place brick / slab / window / door (unless Alt+Click)
  if (e.button === 0 && !e.altKey) {
    const { x, y, z } = target.placePos;
    const twoTall = isTwoBlocksTall(selectedBrickId);
    const flatSlab = isFlatSlab(selectedBrickId);
    if (
      !flatSlab &&
      (player.intersectsBrick(x, y, z) || (twoTall && player.intersectsBrick(x, y + 1, z)))
    ) {
      showToast('Espace occupé par le joueur');
      return;
    }
    if (world.setBrick(x, y, z, selectedBrickId, true, true, world.rotationStep, false)) {
      sound.playPlace();
      player.triggerActionAnimation();
    }
  }
  // Right click (or Alt+Left click): Remove element
  else if (e.button === 2 || (e.button === 0 && e.altKey)) {
    if (target.removePos) {
      const { x, y, z } = target.removePos;
      if (world.removeBrick(x, y, z, true, true)) {
        sound.playRemove();
        player.triggerActionAnimation();
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
    const items = getItemsByCategory(activeCategory);
    if (items.length === 0) return;
    const curIdx = Math.max(
      0,
      items.findIndex((i) => i.id === selectedBrickId)
    );
    if (e.deltaY > 0) {
      selectBrick(items[(curIdx + 1) % items.length].id);
    } else if (e.deltaY < 0) {
      selectBrick(items[(curIdx - 1 + items.length) % items.length].id);
    }
  },
  { passive: true }
);

window.addEventListener('keydown', (e) => {
  // Tab: Cycle Category (Briques & Murs -> Sols & Plafonds -> Portes & Fenêtres)
  if (e.code === 'Tab') {
    e.preventDefault();
    const curCatIdx = CATEGORY_DEFINITIONS.findIndex((c) => c.id === activeCategory);
    const nextCat = CATEGORY_DEFINITIONS[(curCatIdx + 1) % CATEGORY_DEFINITIONS.length];
    selectCategory(nextCat.id, true);
    showToast(`Catégorie : ${nextCat.icon} ${nextCat.label}`);
    return;
  }

  // Number keys 1..6 select slot inside the active category
  if (e.code.startsWith('Digit')) {
    const slotNum = Number(e.code.replace('Digit', ''));
    const items = getItemsByCategory(activeCategory);
    if (slotNum >= 1 && slotNum <= items.length) {
      selectBrick(items[slotNum - 1].id);
    }
  }

  // Rotate door / window / slab orientation (R)
  if (e.code === 'KeyR' && player.isLocked) {
    const step = world.rotatePlacement();
    sound.playSelect();
    showToast(`Orientation : ${step * 90}°`);
  }

  // Open / Close Door (E)
  if (e.code === 'KeyE' && player.isLocked) {
    const target = world.currentTarget;
    if (target?.removePos && target.isDoorHit) {
      const newState = world.toggleDoorAt(
        target.removePos.x,
        target.removePos.y,
        target.removePos.z
      );
      if (newState !== null) {
        sound.playDoor(newState);
        player.triggerActionAnimation();
      }
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
  showToast('Prairie plate vierge initialisée');
  player.requestLock();
});

document.getElementById('btn-starter')!.addEventListener('click', () => {
  world.loadPreset(getStarterScene(), true);
  player.resetPosition();
  showToast('Terrasse avec sol plat, plafond, porte et fenêtres chargée');
  player.requestLock();
});

document.getElementById('btn-pavilion')!.addEventListener('click', () => {
  world.loadPreset(getWhitePavilionPreset(), true);
  player.resetPosition();
  showToast('Maisonnette Blanche complète (sols, plafonds, porte & fenêtres)');
  player.requestLock();
});

document.getElementById('btn-arch')!.addEventListener('click', () => {
  world.loadPreset(getBrutalistArchPreset(), true);
  player.resetPosition();
  showToast('Arche Blanche avec allée en marbre générée');
  player.requestLock();
});

document.querySelectorAll('.time-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = Number((btn as HTMLElement).dataset.time);
    applyLighting(idx);
  });
});

document.querySelectorAll('.view-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = (btn as HTMLElement).dataset.view as CameraViewMode;
    player.cycleViewMode(mode);
    player.requestLock();
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
        showToast(`${entries.length} éléments importés`);
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

  player.update(dt);
  countryside.update(now * 0.001);
  world.update(dt, camera, player.getEyePosition(), player.getAimDirection());

  // Follow player with directional shadow frustum for ultra-sharp brick shadows everywhere
  sunLight.position.copy(player.position).addScaledVector(currentSunDir, 65);
  sunLight.target.position.copy(player.position);
  sunLight.target.updateMatrixWorld();

  // HUD Updates
  crosshairEl.classList.toggle('active', world.currentTarget !== null);
  if (world.currentTarget?.isDoorHit) {
    interactionHintEl.innerHTML = `<kbd>E</kbd> ${
      world.currentTarget.doorIsOpen ? 'Fermer la porte' : 'Ouvrir la porte'
    }`;
    interactionHintEl.classList.remove('hidden');
  } else {
    interactionHintEl.classList.add('hidden');
  }

  statBricksEl.textContent = String(world.getBrickCount());
  statPosEl.textContent = `${Math.round(player.position.x)}, ${Math.round(player.position.y)}, ${Math.round(player.position.z)}`;
  statModeEl.textContent = player.isFlying ? 'VOL LIBRE' : 'MARCHE';

  composer.render();
}

requestAnimationFrame(animate);
