import * as THREE from 'three';

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
import { DatabaseService } from './db/DatabaseService';

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

/**
 * Ambiances lumineuses calibrées pour le confort visuel :
 * - Mode par défaut "DOUCEUR NATURELLE" : sans éblouissement blanc, contraste doux et reposant.
 */
const LIGHTING_PRESETS: LightingPreset[] = [
  {
    name: 'DOUCEUR NATURELLE',
    elevationDeg: 38,
    azimuthDeg: 142,
    turbidity: 1.5,
    rayleigh: 2.3,
    fogColor: 0x8fb3d4,
    fogDensity: 0.0028,
    hemiSky: 0xcbd5e1,
    hemiGround: 0x456b34,
    hemiIntensity: 0.52,
    sunColor: 0xfef3c7,
    sunIntensity: 1.12,
  },
  {
    name: 'APRÈS-MIDI DOUX',
    elevationDeg: 52,
    azimuthDeg: 168,
    turbidity: 1.7,
    rayleigh: 2.0,
    fogColor: 0x9abadd,
    fogDensity: 0.0025,
    hemiSky: 0xdbeafe,
    hemiGround: 0x4d7c38,
    hemiIntensity: 0.58,
    sunColor: 0xfffbeb,
    sunIntensity: 1.32,
  },
  {
    name: 'COUCHER DORÉ',
    elevationDeg: 12,
    azimuthDeg: 215,
    turbidity: 4.5,
    rayleigh: 2.5,
    fogColor: 0xd6a87c,
    fogDensity: 0.0042,
    hemiSky: 0xfed7aa,
    hemiGround: 0x3b5926,
    hemiIntensity: 0.48,
    sunColor: 0xfdba74,
    sunIntensity: 1.25,
  },
  {
    name: 'NUIT DOUCE',
    elevationDeg: 24,
    azimuthDeg: 40,
    turbidity: 1.4,
    rayleigh: 0.4,
    fogColor: 0x0f172a,
    fogDensity: 0.0065,
    hemiSky: 0x38bdf8,
    hemiGround: 0x0f1f14,
    hemiIntensity: 0.25,
    sunColor: 0x93c5fd,
    sunIntensity: 0.65,
  },
];

// --- Scene, Camera & Comfortable Renderer (Zero Glare / No Bloom) ---
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
renderer.toneMappingExposure = 0.72; // Exposition douce et reposante pour les yeux
container.appendChild(renderer.domElement);

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

// --- Countryside Environment ---
const countryside = new CountrysideEnv(scene, renderer);
let currentSunDir = countryside.updateSunAndEnvironment(
  LIGHTING_PRESETS[0].elevationDeg,
  LIGHTING_PRESETS[0].azimuthDeg,
  LIGHTING_PRESETS[0].turbidity,
  LIGHTING_PRESETS[0].rayleigh
);

// --- Core Systems & Database ---
const sound = new SoundManager();
const world = new VoxelWorld(scene, countryside);
const db = new DatabaseService();

const studioOverlay = document.getElementById('studio-overlay')!;
const crosshairEl = document.getElementById('crosshair')!;
const interactionHintEl = document.getElementById('interaction-hint')!;
const hudAccountWorldEl = document.getElementById('hud-account-world')!;
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

// Studio Modal DOM elements
const accountDisplayNameEl = document.getElementById('account-display-name')!;
const accountBadgeEl = document.getElementById('account-badge')!;
const authUsernameEl = document.getElementById('auth-username') as HTMLInputElement;
const authPasswordEl = document.getElementById('auth-password') as HTMLInputElement;
const authFeedbackEl = document.getElementById('auth-feedback')!;
const worldsListEl = document.getElementById('worlds-list')!;
const newWorldNameEl = document.getElementById('new-world-name') as HTMLInputElement;

let toastTimeout: number | undefined;
function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2200);
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
      renderDatabaseModalUI();
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
    triggerAutoSave();
  }
);

// --- Real-Time Auto-Save into Database ---
let autoSaveTimer: number | undefined;
function triggerAutoSave(): void {
  if (!db.currentWorld) return;
  if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(async () => {
    await db.saveWorld(world.serialize(), {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      viewMode: player.viewMode,
      lightingIdx: currentLightingIdx,
    });
    updateHudAccountHeader();
  }, 250);
}

world.onWorldChanged = () => {
  triggerAutoSave();
};

function updateHudAccountHeader(): void {
  const userLabel = db.currentUser
    ? `${db.currentUser.username}${db.currentUser.isGuest ? ' (Invité)' : ''}`
    : 'Invité';
  const worldLabel = db.currentWorld ? db.currentWorld.name : 'Monde';
  hudAccountWorldEl.textContent = `👤 ${userLabel} • 🌍 ${worldLabel} • 💾 Sauvegardé BDD`;
}

function loadWorldIntoScene(bricks: BrickEntry[], pos?: { x: number; y: number; z: number }): void {
  const prevCallback = world.onWorldChanged;
  world.onWorldChanged = undefined;
  world.loadPreset(bricks, false);
  if (pos && typeof pos.x === 'number') {
    player.position.set(pos.x, pos.y, pos.z);
    player.velocity.set(0, 0, 0);
  } else {
    player.resetPosition();
  }
  world.onWorldChanged = prevCallback;
  updateHudAccountHeader();
  renderDatabaseModalUI();
}

function renderDatabaseModalUI(): void {
  if (db.currentUser) {
    accountDisplayNameEl.textContent = db.currentUser.username;
    if (db.currentUser.isGuest) {
      accountBadgeEl.textContent = 'Compte Invité';
      accountBadgeEl.className = 'badge-guest';
    } else {
      accountBadgeEl.textContent = 'Compte Enregistré';
      accountBadgeEl.className = 'badge-member';
    }
  }

  worldsListEl.innerHTML = '';
  for (const w of db.worlds) {
    const isCurrent = db.currentWorld?.id === w.id;
    const dateStr = new Date(w.updatedAt).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const item = document.createElement('div');
    item.className = `world-item ${isCurrent ? 'active' : ''}`;
    item.innerHTML = `
      <div class="world-info">
        <span class="world-name">${isCurrent ? '🟢 ' : ''}${w.name}</span>
        <span class="world-meta">${w.bricks.length} éléments • Modifié à ${dateStr}</span>
      </div>
      <div class="world-actions">
        ${
          !isCurrent
            ? `<button class="btn-mini btn-load-world">Charger</button>`
            : `<span class="world-meta" style="padding: 4px 6px; color: #93c5fd;">Actif</span>`
        }
        ${
          db.worlds.length > 1
            ? `<button class="btn-mini btn-mini-danger btn-del-world" title="Supprimer">✕</button>`
            : ''
        }
      </div>
    `;

    const loadBtn = item.querySelector('.btn-load-world');
    if (loadBtn) {
      loadBtn.addEventListener('click', async () => {
        await triggerImmediateSave();
        const target = await db.switchWorld(w.id);
        if (target) {
          loadWorldIntoScene(target.bricks, target.playerState);
          showToast(`Monde "${target.name}" chargé`);
        }
      });
    }

    const delBtn = item.querySelector('.btn-del-world');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const nextWorld = await db.deleteWorld(w.id);
        loadWorldIntoScene(nextWorld.bricks, nextWorld.playerState);
        showToast(`Monde supprimé`);
      });
    }

    worldsListEl.appendChild(item);
  }
}

async function triggerImmediateSave(): Promise<void> {
  if (!db.currentWorld) return;
  await db.saveWorld(world.serialize(), {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    viewMode: player.viewMode,
    lightingIdx: currentLightingIdx,
  });
  updateHudAccountHeader();
  renderDatabaseModalUI();
}

// Initialize Database on startup
db.init().then(({ activeWorld }) => {
  loadWorldIntoScene(activeWorld.bricks, activeWorld.playerState);
});

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

// --- Mouse & Keyboard Construction Events (with Hold-and-Move Mass Creation) ---
window.addEventListener('contextmenu', (e) => e.preventDefault());

let isHoldingBuild = false;
let isHoldingRemove = false;
let lastDragPlacePos: THREE.Vector3 | null = null;
let lastDragRemovePos: THREE.Vector3 | null = null;
let lastBuildSoundTime = 0;

function canPlaceElementAt(x: number, y: number, z: number): boolean {
  const twoTall = isTwoBlocksTall(selectedBrickId);
  const flatSlab = isFlatSlab(selectedBrickId);
  if (!flatSlab && (player.intersectsBrick(x, y, z) || (twoTall && player.intersectsBrick(x, y + 1, z)))) {
    return false;
  }
  return true;
}

function stopDragActions(): void {
  if (isHoldingBuild) {
    isHoldingBuild = false;
    lastDragPlacePos = null;
    world.endDragStroke();
  }
  isHoldingRemove = false;
  lastDragRemovePos = null;
}

window.addEventListener('mouseup', () => {
  stopDragActions();
});

window.addEventListener('blur', () => {
  stopDragActions();
});

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!player.isLocked) {
    player.requestLock();
    return;
  }

  const target = world.currentTarget;
  if (!target) return;

  // Left click: Place element & begin hold-to-mass-build stroke
  if (e.button === 0 && !e.altKey) {
    const { x, y, z } = target.placePos;
    if (!canPlaceElementAt(x, y, z)) {
      showToast('Espace occupé par le joueur');
      return;
    }
    isHoldingBuild = true;
    world.beginDragStroke(y);
    lastDragPlacePos = target.placePos.clone();

    if (world.setBrick(x, y, z, selectedBrickId, true, true, world.rotationStep, false)) {
      sound.playPlace();
      lastBuildSoundTime = performance.now();
      player.triggerActionAnimation();
    }
  } else if (e.button === 2 || (e.button === 0 && e.altKey)) {
    isHoldingRemove = true;
    if (target.removePos) {
      lastDragRemovePos = target.removePos.clone();
      const { x, y, z } = target.removePos;
      if (world.removeBrick(x, y, z, true, true)) {
        sound.playRemove();
        lastBuildSoundTime = performance.now();
        player.triggerActionAnimation();
      }
    }
  } else if (e.button === 1) {
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
  // Ignore shortcuts when typing in an input field inside the modal
  if (document.activeElement instanceof HTMLInputElement) return;

  if (e.code === 'Tab') {
    e.preventDefault();
    const curCatIdx = CATEGORY_DEFINITIONS.findIndex((c) => c.id === activeCategory);
    const nextCat = CATEGORY_DEFINITIONS[(curCatIdx + 1) % CATEGORY_DEFINITIONS.length];
    selectCategory(nextCat.id, true);
    showToast(`Catégorie : ${nextCat.icon} ${nextCat.label}`);
    return;
  }

  if (e.code.startsWith('Digit')) {
    const slotNum = Number(e.code.replace('Digit', ''));
    const items = getItemsByCategory(activeCategory);
    if (slotNum >= 1 && slotNum <= items.length) {
      selectBrick(items[slotNum - 1].id);
    }
  }

  if (e.code === 'KeyR' && player.isLocked) {
    const step = world.rotatePlacement();
    sound.playSelect();
    showToast(`Orientation : ${step * 90}°`);
  }

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

  if (e.code === 'KeyT' && player.isLocked) {
    applyLighting(currentLightingIdx + 1);
    sound.playSelect();
    showToast(`Lumière : ${LIGHTING_PRESETS[currentLightingIdx].name}`);
  }

  if (e.code === 'KeyP' && player.isLocked && world.currentTarget?.hitBrickType) {
    selectBrick(world.currentTarget.hitBrickType);
  }
});

// --- Studio Modal & Auth Controls ---
document.getElementById('btn-resume')!.addEventListener('click', () => {
  player.requestLock();
});

document.getElementById('btn-save-now')!.addEventListener('click', async () => {
  await triggerImmediateSave();
  showToast('💾 Monde sauvegardé dans la base de données !');
});

document.getElementById('btn-register')!.addEventListener('click', async () => {
  const username = authUsernameEl.value.trim();
  const password = authPasswordEl.value;
  if (!username || !password) {
    authFeedbackEl.textContent = 'Veuillez renseigner un pseudo et un mot de passe.';
    return;
  }
  await triggerImmediateSave();
  const res = await db.registerAccount(username, password);
  if (!res.ok) {
    authFeedbackEl.textContent = res.error || 'Erreur';
  } else {
    authFeedbackEl.textContent = `✓ Compte "${username}" actif et synchronisé !`;
    authPasswordEl.value = '';
    updateHudAccountHeader();
    renderDatabaseModalUI();
    showToast(`Bienvenue ${username} ! Vos mondes sont liés à votre compte.`);
  }
});

document.getElementById('btn-login')!.addEventListener('click', async () => {
  const username = authUsernameEl.value.trim();
  const password = authPasswordEl.value;
  if (!username || !password) {
    authFeedbackEl.textContent = 'Entrez votre pseudo et mot de passe.';
    return;
  }
  await triggerImmediateSave();
  const res = await db.loginAccount(username, password);
  if (!res.ok) {
    authFeedbackEl.textContent = res.error || 'Identifiants incorrects.';
  } else {
    authFeedbackEl.textContent = `✓ Connecté en tant que "${username}" !`;
    authPasswordEl.value = '';
    if (db.currentWorld) {
      loadWorldIntoScene(db.currentWorld.bricks, db.currentWorld.playerState);
    }
    showToast(`Bon retour ${username} !`);
  }
});

document.getElementById('btn-guest')!.addEventListener('click', async () => {
  await triggerImmediateSave();
  await db.loginAsGuest();
  authFeedbackEl.textContent = '✓ Session Invité active (sauvegarde automatique).';
  updateHudAccountHeader();
  renderDatabaseModalUI();
  showToast('Mode Invité actif');
});

// Create New World buttons (never overwrites existing worlds!)
document.querySelectorAll('.new-world-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    await triggerImmediateSave();
    const tpl = (btn as HTMLElement).dataset.template;
    const customName = newWorldNameEl.value.trim();
    let bricks: BrickEntry[] = [];
    let defaultTitle = 'Prairie Vierge';

    if (tpl === 'starter') {
      bricks = getStarterScene();
      defaultTitle = 'Terrasse & Façade';
    } else if (tpl === 'pavilion') {
      bricks = getWhitePavilionPreset();
      defaultTitle = 'Maisonnette Blanche';
    } else if (tpl === 'arch') {
      bricks = getBrutalistArchPreset();
      defaultTitle = 'Arche Blanche';
    }

    const worldTitle = customName || `${defaultTitle} #${db.worlds.length + 1}`;
    const created = await db.createNewWorld(worldTitle, bricks);
    newWorldNameEl.value = '';
    loadWorldIntoScene(created.bricks, created.playerState);
    showToast(`Nouveau monde "${created.name}" créé et sauvegardé !`);
    player.requestLock();
  });
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
  const safeName = (db.currentWorld?.name || 'monde').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = `aetherbricks-${safeName}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Monde exporté en JSON');
});

const fileImportEl = document.getElementById('file-import') as HTMLInputElement;
document.getElementById('btn-import')!.addEventListener('click', () => {
  fileImportEl.click();
});

fileImportEl.addEventListener('change', () => {
  const file = fileImportEl.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const entries = JSON.parse(String(reader.result)) as BrickEntry[];
      if (Array.isArray(entries)) {
        await triggerImmediateSave();
        const importedName = file.name.replace(/\.json$/i, '') || 'Monde Importé';
        const created = await db.createNewWorld(importedName, entries);
        loadWorldIntoScene(created.bricks, created.playerState);
        showToast(`Monde "${created.name}" importé et sauvegardé en BDD`);
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
});

// Save before tab close
window.addEventListener('beforeunload', () => {
  triggerImmediateSave();
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

  // Mass creation / removal while holding mouse button and moving the mouse
  if (player.isLocked && isHoldingBuild && world.currentTarget) {
    const curPos = world.currentTarget.placePos;
    if (!lastDragPlacePos || !lastDragPlacePos.equals(curPos)) {
      const fromPos = lastDragPlacePos ?? curPos;
      const placed = world.placeLine(fromPos, curPos, selectedBrickId, canPlaceElementAt);
      lastDragPlacePos = curPos.clone();
      if (placed > 0) {
        player.triggerActionAnimation();
        if (now - lastBuildSoundTime > 55) {
          sound.playPlace();
          lastBuildSoundTime = now;
        }
      }
    }
  } else if (player.isLocked && isHoldingRemove && world.currentTarget?.removePos) {
    const curRemPos = world.currentTarget.removePos;
    const fromRemPos = lastDragRemovePos ?? curRemPos;
    const removed = world.removeLine(fromRemPos, curRemPos);
    lastDragRemovePos = curRemPos.clone();
    if (removed > 0) {
      player.triggerActionAnimation();
      if (now - lastBuildSoundTime > 55) {
        sound.playRemove();
        lastBuildSoundTime = now;
      }
    }
  }

  sunLight.position.copy(player.position).addScaledVector(currentSunDir, 65);
  sunLight.target.position.copy(player.position);
  sunLight.target.updateMatrixWorld();

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

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
