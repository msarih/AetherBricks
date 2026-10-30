import * as THREE from 'three';

import { VoxelWorld } from './world/VoxelWorld';
import { CountrysideEnv } from './world/CountrysideEnv';
import { PlayerController, CameraViewMode } from './player/PlayerController';
import { SoundManager } from './audio/SoundManager';
import { AmbientParticleSystem } from './world/AmbientParticles';
import { isFlatSlab, isTwoBlocksTall, BRICK_TYPE_DIRT } from './world/ArchitecturalObjects';
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

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 3500);

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
const ambientParticles = new AmbientParticleSystem(scene, world);
const db = new DatabaseService();

const studioOverlay = document.getElementById('studio-overlay')!;
const crosshairEl = document.getElementById('crosshair')!;
const interactionHintEl = document.getElementById('interaction-hint')!;
const hudAccountWorldEl = document.getElementById('hud-account-world')!;
const statBricksEl = document.getElementById('stat-bricks')!;
const statPosEl = document.getElementById('stat-pos')!;
const statCompassEl = document.getElementById('stat-compass');
const statModeEl = document.getElementById('stat-mode')!;
const statViewEl = document.getElementById('stat-view')!;
const statTimeEl = document.getElementById('stat-time')!;
const activeBrickNameEl = document.getElementById('active-brick-name')!;
const activeBrickSubEl = document.getElementById('active-brick-sub')!;
const activeBrickPreviewEl = document.getElementById('active-brick-preview');
const categoryTabsEl = document.getElementById('category-tabs')!;
const hotbarEl = document.getElementById('hotbar')!;
const toastEl = document.getElementById('toast')!;

interactionHintEl.addEventListener('click', (e) => {
  e.stopPropagation();
  if (player.isSleeping) {
    player.toggleSleeping();
    sound.playSelect();
    showToast('Personnage réveillé');
    return;
  }
  if (player.isSitting) {
    player.toggleSitting();
    sound.playSelect();
    showToast('Personnage debout');
    return;
  }

  const aimDir = player.getAimDirection();
  const bed =
    (world.currentTarget?.removePos &&
      world.isBedAt(
        world.currentTarget.removePos.x,
        world.currentTarget.removePos.y,
        world.currentTarget.removePos.z
      )
      ? world.currentTarget.removePos
      : null) ?? world.getFacingBed(player.position, aimDir, 2.5);

  if (bed) {
    player.toggleSleeping(bed);
    sound.playSelect();
    showToast('Allongé dans le grand lit • Appuyez sur E ou Déplacement pour vous réveiller');
    return;
  }

  const chair =
    (world.currentTarget?.removePos &&
      world.isChairAt(
        world.currentTarget.removePos.x,
        world.currentTarget.removePos.y,
        world.currentTarget.removePos.z
      )
      ? world.currentTarget.removePos
      : null) ?? world.getFacingChair(player.position, aimDir, 2.2);

  if (chair) {
    player.toggleSitting(chair);
    sound.playSelect();
    showToast('Assis sur le fauteuil • Appuyez sur E ou Déplacement pour vous relever');
  }
});

// Boutons rapides d'ambiance et raccourcis
const btnDayNightAuto = document.getElementById('quick-btn-daynight');
const btnAmbienceAudio = document.getElementById('quick-btn-ambience-audio');
const btnTeleportHome = document.getElementById('quick-btn-teleport-home');

// Gestion du Cycle Jour/Nuit Automatique
let isDayNightAutoCycle = false;
let dayNightProgress = 0.28; // Départ en plein après-midi ensoleillé doux
const DAY_NIGHT_CYCLE_DURATION = 240; // 4 minutes pour une révolution céleste complète

function toggleDayNightAutoCycle(): void {
  isDayNightAutoCycle = !isDayNightAutoCycle;
  btnDayNightAuto?.classList.toggle('active', isDayNightAutoCycle);
  if (isDayNightAutoCycle) {
    showToast('⏳ Cycle Jour/Nuit dynamique automatique activé !');
  } else {
    showToast('⏳ Cycle automatique arrêté (Ambiance manuelle)');
  }
}

function toggleAmbienceAudio(): void {
  const enabled = sound.toggleAmbience();
  btnAmbienceAudio?.classList.toggle('active', enabled);
  showToast(enabled ? '🎶 Ambiance sonore vivante activée' : '🔇 Ambiance sonore coupée');
}

function teleportHome(): void {
  player.resetPosition({ x: 0, z: 6, y: 0.36 });
  sound.playTeleportHome();
  showToast('⌂ Retour au Foyer immédiat !');
}

// Navigation vs Creation Mode elements
const btnModeCreation = document.getElementById('btn-mode-creation')!;
const btnModeNavigation = document.getElementById('btn-mode-navigation')!;
const btnOpenStudio = document.getElementById('btn-open-studio')!;

// Collapsible Sidebar & Mini-HUD elements
const buildSidebarEl = document.getElementById('build-sidebar')!;
const btnToggleSidebarEl = document.getElementById('btn-toggle-sidebar')!;
const btnOpenSidebarEl = document.getElementById('btn-open-sidebar')!;
const btnQuickCatalogEl = document.getElementById('btn-quick-catalog');
const miniCurrentSwatchEl = document.getElementById('mini-current-swatch');
const miniCurrentNameEl = document.getElementById('mini-current-name');

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

// Gestion des 2 Modes : Mode Création vs Mode Navigation
export type AppUIMode = 'creation' | 'navigation';
let currentUIMode: AppUIMode = 'creation';

function closeStudioModal(requestPointerLock = true): void {
  studioOverlay.classList.add('hidden');
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  setUIMode('creation', false);
  player.clearKeys();
  if (requestPointerLock) {
    try {
      player.requestLock();
    } catch {
      // browser may block if not direct user gesture
    }
  }
}

function setUIMode(mode: AppUIMode, notify = true): void {
  currentUIMode = mode;
  player.clearKeys();
  if (mode === 'creation') {
    document.body.classList.remove('mode-navigation');
    btnModeCreation.classList.add('active');
    btnModeNavigation.classList.remove('active');
    studioOverlay.classList.add('hidden');
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    try {
      player.requestLock();
    } catch {}
    if (notify) showToast('🛠️ Mode Création : Visez et cliquez pour construire');
  } else {
    document.body.classList.add('mode-navigation');
    btnModeNavigation.classList.add('active');
    btnModeCreation.classList.remove('active');
    player.exitLock();
    if (notify) showToast('🧭 Mode Navigation : Curseur libre pour utiliser les menus');
  }
}

btnModeCreation.addEventListener('click', (e) => {
  e.stopPropagation();
  setUIMode('creation');
});

btnModeNavigation.addEventListener('click', (e) => {
  e.stopPropagation();
  setUIMode('navigation');
});

// Menu Studio / Base de données dédié
btnOpenStudio.addEventListener('click', (e) => {
  e.stopPropagation();
  setUIMode('navigation', false);
  renderDatabaseModalUI();
  studioOverlay.classList.remove('hidden');
});

// Barre latérale de construction pliable / dépliable
let isSidebarOpen = true;
function setSidebarOpen(open: boolean): void {
  isSidebarOpen = open;
  buildSidebarEl.classList.toggle('collapsed', !open);
  btnOpenSidebarEl.classList.toggle('hidden', open);
  sound.playSelect();
}

btnToggleSidebarEl.addEventListener('click', (e) => {
  e.stopPropagation();
  setSidebarOpen(false);
});

btnOpenSidebarEl.addEventListener('click', (e) => {
  e.stopPropagation();
  setSidebarOpen(true);
});

btnQuickCatalogEl?.addEventListener('click', (e) => {
  e.stopPropagation();
  setSidebarOpen(true);
});

const player = new PlayerController(
  camera,
  renderer.domElement,
  world,
  sound,
  (locked) => {
    if (locked) {
      currentUIMode = 'creation';
      document.body.classList.remove('mode-navigation');
      btnModeCreation.classList.add('active');
      btnModeNavigation.classList.remove('active');
      studioOverlay.classList.add('hidden');
    } else {
      currentUIMode = 'navigation';
      document.body.classList.add('mode-navigation');
      btnModeNavigation.classList.add('active');
      btnModeCreation.classList.remove('active');
      // En mode navigation, ne PAS ouvrir la modale studio automatiquement : l'utilisateur explore librement les menus !
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
  player.resetPosition(pos);
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
        closeStudioModal(true);
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

// --- Atelier Peinture & Motifs Muraux (Intégré dans Éléments de Construction) ---
let isPaintMode = false;
let selectedPaintColor = '#f8fafc';
let selectedPaintPattern = 'plain';

export const PATTERN_NAMES: Record<string, string> = {
  plain: 'Uni Lisse',
  stripes: 'Rayures Haussmann',
  floral: 'Damas Floral',
  bricks: 'Briques Peintes',
  tiles: 'Carrelage Métro',
  wood: 'Boiserie Moulurée',
  marble: 'Marbre Veiné',
  geometric: 'Art Déco',
};

export const COLOR_NAMES: Record<string, string> = {
  '#f8fafc': 'Blanc Albâtre',
  '#fef3c7': 'Ivoire Chaud',
  '#fed7aa': 'Abricot Doux',
  '#fca5a5': 'Corail Pastel',
  '#f472b6': 'Rose Poudré',
  '#c2410c': 'Terracotta',
  '#d97706': 'Ocre Doré',
  '#ca8a04': 'Moutarde Chaude',
  '#4d7c0f': 'Sauge Méditerranée',
  '#15803d': 'Vert Forêt',
  '#0284c7': 'Bleu Azur',
  '#1e3a8a': 'Bleu Nuit',
  '#7c3aed': 'Violet Royal',
  '#475569': 'Gris Ardoise',
  '#1e293b': 'Noir Anthracite',
};

function updatePaintPreviewUI(): void {
  const paintColorHexLabel = document.getElementById('paint-color-hex-label');
  const paintSamplePreview = document.getElementById('paint-sample-preview');
  const paintSamplePatternText = document.getElementById('paint-sample-pattern-text');
  const paintSampleColorText = document.getElementById('paint-sample-color-text');
  const btnSidebarTogglePaint = document.getElementById('btn-sidebar-toggle-paint');
  const sidebarPaintBadge = document.getElementById('sidebar-paint-badge');
  const sidebarPaintStatusDesc = document.getElementById('sidebar-paint-status-desc');

  if (paintColorHexLabel) {
    paintColorHexLabel.textContent = selectedPaintColor;
  }
  const colorName = COLOR_NAMES[selectedPaintColor.toLowerCase()] || selectedPaintColor;
  const patternName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;

  if (paintSamplePatternText) {
    paintSamplePatternText.textContent = `Motif : ${patternName}`;
  }
  if (paintSampleColorText) {
    paintSampleColorText.textContent = `Teinte : ${selectedPaintColor} (${colorName})`;
  }

  // Échantillon visuel dynamique
  if (paintSamplePreview) {
    paintSamplePreview.style.backgroundColor = selectedPaintColor;
    if (selectedPaintPattern === 'stripes') {
      paintSamplePreview.style.backgroundImage = 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(0,0,0,0.18) 4px, rgba(0,0,0,0.18) 8px)';
      paintSamplePreview.style.backgroundSize = 'auto';
    } else if (selectedPaintPattern === 'floral') {
      paintSamplePreview.style.backgroundImage = 'radial-gradient(circle, rgba(255,255,255,0.4) 20%, transparent 20%), radial-gradient(circle, rgba(0,0,0,0.15) 20%, transparent 20%)';
      paintSamplePreview.style.backgroundSize = '12px 12px';
    } else if (selectedPaintPattern === 'bricks') {
      paintSamplePreview.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.2) 1px, transparent 1px)';
      paintSamplePreview.style.backgroundSize = '14px 7px';
    } else if (selectedPaintPattern === 'tiles') {
      paintSamplePreview.style.backgroundImage = 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)';
      paintSamplePreview.style.backgroundSize = '10px 10px';
    } else if (selectedPaintPattern === 'wood') {
      paintSamplePreview.style.backgroundImage = 'linear-gradient(to right, rgba(0,0,0,0.15), rgba(255,255,255,0.1), rgba(0,0,0,0.15))';
      paintSamplePreview.style.backgroundSize = 'auto';
    } else if (selectedPaintPattern === 'marble') {
      paintSamplePreview.style.backgroundImage = 'linear-gradient(45deg, rgba(255,255,255,0.25) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.12) 75%)';
      paintSamplePreview.style.backgroundSize = 'auto';
    } else if (selectedPaintPattern === 'geometric') {
      paintSamplePreview.style.backgroundImage = 'linear-gradient(135deg, rgba(0,0,0,0.18) 25%, transparent 25%), linear-gradient(225deg, rgba(0,0,0,0.18) 25%, transparent 25%)';
      paintSamplePreview.style.backgroundSize = '12px 12px';
    } else {
      paintSamplePreview.style.backgroundImage = 'none';
    }
  }

  // État du bouton d'activation dans la barre latérale
  if (btnSidebarTogglePaint) {
    btnSidebarTogglePaint.classList.toggle('active', isPaintMode);
  }
  if (sidebarPaintBadge) {
    sidebarPaintBadge.className = `paint-badge ${isPaintMode ? 'on' : 'off'}`;
    sidebarPaintBadge.textContent = isPaintMode ? 'ACTIF 🟢' : 'DÉSACTIVÉ ⚪';
  }
  if (sidebarPaintStatusDesc) {
    sidebarPaintStatusDesc.textContent = isPaintMode
      ? 'Mode Peinture activé - Visez un mur & Clic Gauche'
      : 'Cliquez pour activer (Touche R)';
  }

  // Synchronisation de l'en-tête de la barre latérale si l'onglet Peinture est actif
  if (activeCategory === 'paint') {
    activeBrickNameEl.textContent = 'Atelier Peinture Murale';
    activeBrickSubEl.textContent = `${patternName} • ${selectedPaintColor}`;
    if (activeBrickPreviewEl) {
      activeBrickPreviewEl.style.backgroundColor = selectedPaintColor;
      activeBrickPreviewEl.style.backgroundImage = paintSamplePreview?.style.backgroundImage || 'none';
      activeBrickPreviewEl.style.backgroundSize = paintSamplePreview?.style.backgroundSize || 'auto';
    }
    if (miniCurrentSwatchEl) {
      miniCurrentSwatchEl.style.backgroundColor = selectedPaintColor;
      miniCurrentSwatchEl.style.backgroundImage = paintSamplePreview?.style.backgroundImage || 'none';
      miniCurrentSwatchEl.style.backgroundSize = paintSamplePreview?.style.backgroundSize || 'auto';
    }
    if (miniCurrentNameEl) {
      miniCurrentNameEl.textContent = `Peinture ${patternName}`;
    }
  }
}

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

  const sidebarElementsSection = document.getElementById('sidebar-elements-section');
  const sidebarPaintStudio = document.getElementById('sidebar-paint-studio');
  const sidebarPaintQuickLink = document.getElementById('sidebar-paint-quick-link');

  if (activeCategory === 'paint') {
    sidebarElementsSection?.classList.add('hidden');
    sidebarPaintStudio?.classList.remove('hidden');
    sidebarPaintQuickLink?.classList.add('hidden');
    updatePaintPreviewUI();
    return;
  }

  sidebarElementsSection?.classList.remove('hidden');
  sidebarPaintStudio?.classList.add('hidden');
  sidebarPaintQuickLink?.classList.remove('hidden');

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
  if (activeDef) {
    activeBrickNameEl.textContent = activeDef.name;
    activeBrickSubEl.textContent = activeDef.subtitle;
    if (activeBrickPreviewEl) {
      activeBrickPreviewEl.style.backgroundColor = '';
      activeBrickPreviewEl.style.backgroundImage = '';
      activeBrickPreviewEl.style.background = activeDef.previewCss;
    }
    if (miniCurrentSwatchEl) {
      miniCurrentSwatchEl.style.backgroundColor = '';
      miniCurrentSwatchEl.style.backgroundImage = '';
      miniCurrentSwatchEl.style.background = activeDef.previewCss;
    }
    if (miniCurrentNameEl) {
      miniCurrentNameEl.textContent = activeDef.name;
    }
    world.setGhostMode(selectedBrickId);
  }
}

function selectCategory(cat: ItemCategory, autoSelectFirst = true): void {
  activeCategory = cat;
  if (cat === 'paint') {
    isPaintMode = true;
    world.setPaintModeActive(true, selectedPaintColor);
  } else {
    isPaintMode = false;
    world.setPaintModeActive(false);
    const items = getItemsByCategory(cat);
    if (autoSelectFirst && items.length > 0 && !items.some((i) => i.id === selectedBrickId)) {
      selectedBrickId = items[0].id;
    }
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
let isHoldingPaint = false;
let removeHoldStartTime = 0;
let lastRemoveTime = 0;
let lastRemovedPos: THREE.Vector3 | null = null;
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
  if (isHoldingBuild || isHoldingRemove || isHoldingPaint) {
    isHoldingBuild = false;
    isHoldingRemove = false;
    isHoldingPaint = false;
    lastDragPlacePos = null;
    lastDragRemovePos = null;
    lastRemovedPos = null;
    world.endDragStroke();
  }
}

window.addEventListener('mouseup', () => {
  stopDragActions();
});

window.addEventListener('blur', () => {
  stopDragActions();
});

// --- Tools: Peinture, Pipette, Box Fill, Ruler, Photo Mode & 3D Export ---
let isBoxMode = false;
let boxCornerA: THREE.Vector3 | null = null;
let isRulerMode = false;
let isPhotoMode = false;

const toolStatusBarEl = document.getElementById('tool-status-bar')!;
const photoModeBarEl = document.getElementById('photo-mode-bar')!;
const toolPaintBtn = document.getElementById('tool-paint')!;
const paintColorPicker = document.getElementById('paint-color-picker') as HTMLInputElement;
const paintSwatchesEl = document.getElementById('paint-swatches')!;
const paintPatternsEl = document.getElementById('paint-patterns')!;
const btnSidebarTogglePaint = document.getElementById('btn-sidebar-toggle-paint');
const btnSidebarApplyPaint = document.getElementById('btn-sidebar-apply-paint');
const btnQuickOpenPaint = document.getElementById('btn-quick-open-paint');

const PAINT_SWATCH_COLORS = [
  '#f8fafc',
  '#fef3c7',
  '#fed7aa',
  '#fca5a5',
  '#f472b6',
  '#c2410c',
  '#d97706',
  '#ca8a04',
  '#4d7c0f',
  '#15803d',
  '#0284c7',
  '#1e3a8a',
  '#7c3aed',
  '#475569',
  '#1e293b',
];

function initPaintPalette(): void {
  if (paintSwatchesEl) {
    paintSwatchesEl.innerHTML = '';
    for (const col of PAINT_SWATCH_COLORS) {
      const sw = document.createElement('button');
      sw.className = `paint-swatch ${col.toLowerCase() === selectedPaintColor.toLowerCase() ? 'active' : ''}`;
      sw.style.backgroundColor = col;
      const cName = COLOR_NAMES[col.toLowerCase()] || col;
      sw.title = `${col} (${cName})`;
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedPaintColor = col;
        if (paintColorPicker) paintColorPicker.value = col;
        document.querySelectorAll('.paint-swatch').forEach((s) => s.classList.remove('active'));
        sw.classList.add('active');
        sound.playSelect();
        isPaintMode = true;
        world.setPaintModeActive(true, selectedPaintColor);
        updatePaintPreviewUI();
        const pName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;
        toolStatusBarEl.textContent = `🖌️ Mode Peinture : Visez et cliquez pour peindre (${pName} - ${selectedPaintColor})`;
        showToast(`Couleur choisie : ${cName} (${col})`);
      });
      paintSwatchesEl.appendChild(sw);
    }
  }

  const handleColorInput = (e: Event) => {
    selectedPaintColor = (e.target as HTMLInputElement).value;
    document.querySelectorAll('.paint-swatch').forEach((s) => s.classList.remove('active'));
    isPaintMode = true;
    world.setPaintModeActive(true, selectedPaintColor);
    updatePaintPreviewUI();
    const pName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;
    toolStatusBarEl.textContent = `🖌️ Mode Peinture : Visez et cliquez pour peindre (${pName} - ${selectedPaintColor})`;
  };
  paintColorPicker?.addEventListener('input', handleColorInput);
  paintColorPicker?.addEventListener('change', handleColorInput);

  paintPatternsEl?.querySelectorAll('.paint-pattern-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      paintPatternsEl.querySelectorAll('.paint-pattern-btn').forEach((b) => b.classList.remove('active'));
      (btn as HTMLElement).classList.add('active');
      selectedPaintPattern = (btn as HTMLElement).dataset.pattern || 'plain';
      sound.playSelect();
      isPaintMode = true;
      world.setPaintModeActive(true, selectedPaintColor);
      updatePaintPreviewUI();
      const pName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;
      toolStatusBarEl.textContent = `🖌️ Mode Peinture : Visez et cliquez pour peindre (${pName} - ${selectedPaintColor})`;
      showToast(`Motif choisi : ${pName}`);
    });
  });

  // Bouton Activer / Désactiver dans la barre latérale
  btnSidebarTogglePaint?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePaintMode();
  });

  // Bouton "Peindre le mur visé maintenant" (fonctionne immédiatement avec le mur visé par le joueur)
  btnSidebarApplyPaint?.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = world.currentTarget ?? world.lastValidTarget;
    if (target?.removePos) {
      const { x, y, z } = target.removePos;
      if (world.paintBrickAt(x, y, z, selectedPaintColor, selectedPaintPattern, target.normal)) {
        sound.playPaint();
        lastBuildSoundTime = performance.now();
        player.triggerActionAnimation();
        const pName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;
        showToast(`Mur peint avec succès (${pName} • ${selectedPaintColor}) !`);
        return;
      }
    }
    showToast("⚠️ Visez d'abord un mur avec votre regard, puis cliquez sur ce bouton");
  });

  // Raccourci basculant vers la catégorie peinture
  btnQuickOpenPaint?.addEventListener('click', (e) => {
    e.stopPropagation();
    selectCategory('paint');
    togglePaintMode(true);
  });

  updatePaintPreviewUI();
}

initPaintPalette();

function togglePaintMode(force?: boolean): void {
  isPaintMode = force !== undefined ? force : !isPaintMode;
  if (isPaintMode) {
    isBoxMode = false;
    isRulerMode = false;
    boxCornerA = null;
    document.getElementById('tool-box')?.classList.remove('active');
    document.getElementById('tool-ruler')?.classList.remove('active');
    setSidebarOpen(true);
    selectCategory('paint', false);
  } else {
    if (activeCategory === 'paint') {
      selectCategory('bricks', false);
    }
  }
  world.setPaintModeActive(isPaintMode, selectedPaintColor);
  toolPaintBtn?.classList.toggle('active', isPaintMode);
  toolStatusBarEl.classList.toggle('hidden', !isPaintMode && !isBoxMode && !isRulerMode);
  updatePaintPreviewUI();
  if (isPaintMode) {
    const pName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;
    toolStatusBarEl.textContent = `🖌️ Mode Peinture : Visez un mur et faites Clic Gauche pour peindre (${pName} - ${selectedPaintColor})`;
    showToast('🖌️ Atelier Peinture activé : Visez un mur et cliquez');
  } else {
    showToast('Atelier Peinture fermé');
  }
}

function pickTargetBrick(): void {
  const target = world.currentTarget;
  if (target?.hitBrickType) {
    selectBrick(target.hitBrickType);
    const def = world.catalog.get(target.hitBrickType);
    sound.playSelect();
    showToast(`🎨 Pipette : "${def?.name}" sélectionné !`);
  }
}

function toggleBoxMode(): void {
  isBoxMode = !isBoxMode;
  boxCornerA = null;
  if (isBoxMode && isPaintMode) togglePaintMode(false);
  toolStatusBarEl.classList.toggle('hidden', !isBoxMode && !isRulerMode && !isPaintMode);
  document.getElementById('tool-box')?.classList.toggle('active', isBoxMode);
  if (isBoxMode) {
    toolStatusBarEl.textContent = '📦 Mode Boîte : Cliquez pour définir le 1er coin (A)';
    showToast('📦 Mode Boîte activé : Cliquez pour poser 2 coins');
  } else {
    showToast('Mode Boîte désactivé');
  }
}

function toggleRulerMode(): void {
  isRulerMode = !isRulerMode;
  if (isRulerMode && isPaintMode) togglePaintMode(false);
  toolStatusBarEl.classList.toggle('hidden', !isBoxMode && !isRulerMode && !isPaintMode);
  document.getElementById('tool-ruler')?.classList.toggle('active', isRulerMode);
  if (isRulerMode) {
    showToast('📏 Mode Règle activé : Visez un bloc pour mesurer');
  } else {
    showToast('Mode Règle désactivé');
  }
}

function togglePhotoMode(): void {
  isPhotoMode = !isPhotoMode;
  document.body.classList.toggle('photo-mode', isPhotoMode);
  photoModeBarEl.classList.toggle('hidden', !isPhotoMode);
  document.getElementById('tool-photo')?.classList.toggle('active', isPhotoMode);
  if (isPhotoMode) {
    showToast('📸 Mode Photo Cinématique (Appuyez sur P pour quitter)');
  }
}

function exportWorldOBJ(): void {
  const safeName = (db.currentWorld?.name || 'monde').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  world.exportToOBJ(`aetherbricks-${safeName}`);
  showToast('💾 Fichier 3D (.OBJ) téléchargé avec succès !');
}

// Tool button listeners
toolPaintBtn?.addEventListener('click', () => togglePaintMode());
document.getElementById('tool-pipette')?.addEventListener('click', pickTargetBrick);
document.getElementById('tool-box')?.addEventListener('click', toggleBoxMode);
document.getElementById('tool-ruler')?.addEventListener('click', toggleRulerMode);
document.getElementById('tool-photo')?.addEventListener('click', togglePhotoMode);
document.getElementById('tool-obj')?.addEventListener('click', exportWorldOBJ);
document.getElementById('btn-export-obj')?.addEventListener('click', exportWorldOBJ);

// Screenshot capture in Photo Mode
document.getElementById('btn-take-screenshot')?.addEventListener('click', () => {
  photoModeBarEl.style.display = 'none';
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  photoModeBarEl.style.display = 'flex';
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `aetherbricks-photo-${Date.now()}.png`;
  a.click();
  showToast('📸 Photo HD capturée et téléchargée !');
});

document.getElementById('btn-exit-photo')?.addEventListener('click', togglePhotoMode);

// Quick Ambience & Weather buttons
for (let i = 0; i <= 3; i++) {
  document.getElementById(`quick-btn-time-${i}`)?.addEventListener('click', () => {
    applyLighting(i);
    for (let j = 0; j <= 3; j++) {
      document.getElementById(`quick-btn-time-${j}`)?.classList.toggle('active', j === i);
    }
  });
}

document.getElementById('quick-btn-rain')?.addEventListener('click', (e) => {
  const raining = countryside.toggleRain();
  (e.currentTarget as HTMLElement).classList.toggle('active', raining);
  showToast(raining ? '🌧️ Pluie douce activée' : '☀️ Pluie arrêtée');
});

btnDayNightAuto?.addEventListener('click', () => {
  toggleDayNightAutoCycle();
});

btnAmbienceAudio?.addEventListener('click', () => {
  toggleAmbienceAudio();
});

btnTeleportHome?.addEventListener('click', () => {
  teleportHome();
});

renderer.domElement.addEventListener('mousedown', (e) => {
  // En Mode Navigation :
  if (currentUIMode === 'navigation' && e.button === 0) {
    const mouse = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    const hit = world.raycastFromMouse(mouse, camera);

    // Si on clique sur un lit, s'allonger immédiatement !
    if (hit?.removePos && world.isBedAt(hit.removePos.x, hit.removePos.y, hit.removePos.z)) {
      if (player.position.distanceTo(hit.removePos) <= 3.5) {
        player.toggleSleeping(hit.removePos);
        sound.playSelect();
        showToast('Allongé dans le grand lit • Appuyez sur E ou Déplacement pour vous réveiller');
        return;
      }
    }

    // Si on clique sur un fauteuil, s'asseoir immédiatement !
    if (hit?.removePos && world.isChairAt(hit.removePos.x, hit.removePos.y, hit.removePos.z)) {
      if (player.position.distanceTo(hit.removePos) <= 3.5) {
        player.toggleSitting(hit.removePos);
        sound.playSelect();
        showToast('Assis sur le fauteuil • Appuyez sur E ou Déplacement pour vous relever');
        return;
      }
    }

    // Si le mode peinture est actif, permet de cliquer directement sur un mur de la scène pour le peindre immédiatement !
    if (isPaintMode) {
      if (hit?.removePos) {
        const { x, y, z } = hit.removePos;
        if (world.paintBrickAt(x, y, z, selectedPaintColor, selectedPaintPattern, hit.normal)) {
          sound.playPaint();
          player.triggerActionAnimation();
          const pName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;
          showToast(`Mur peint (${pName} • ${selectedPaintColor}) !`);
          return;
        }
      }
    }
    // Sinon, un clic sur le jeu repasse en Mode Création avec contrôle 3D immersif
    setUIMode('creation');
    return;
  }

  if (!player.isLocked) {
    player.requestLock();
    return;
  }

  const target = world.currentTarget;
  if (!target) return;

  // Middle click: Pipette / Pick block
  if (e.button === 1) {
    pickTargetBrick();
    return;
  }

  // If in Box Fill Mode
  if (isBoxMode) {
    if (!boxCornerA) {
      boxCornerA = target.placePos.clone();
      toolStatusBarEl.textContent = `📦 Coin A fixé en (${boxCornerA.x}, ${boxCornerA.y}, ${boxCornerA.z}). Cliquez pour le coin B (Gauche = Remplir, Droite = Vider)`;
      sound.playSelect();
      showToast(`Coin A (${boxCornerA.x}, ${boxCornerA.y}, ${boxCornerA.z}) fixé !`);
      return;
    } else {
      const cornerB = e.button === 0 ? target.placePos.clone() : (target.removePos ?? target.placePos).clone();
      if (e.button === 0) {
        const count = world.fillBox(boxCornerA, cornerB, selectedBrickId, canPlaceElementAt);
        sound.playPlace();
        player.triggerActionAnimation();
        showToast(`📦 Boîte remplie (${count} éléments) !`);
      } else {
        const count = world.clearBox(boxCornerA, cornerB);
        sound.playRemove();
        player.triggerActionAnimation();
        showToast(`📦 Boîte vidée (${count} éléments supprimés) !`);
      }
      boxCornerA = null;
      toolStatusBarEl.textContent = '📦 Mode Boîte : Cliquez pour définir le 1er coin (A)';
      return;
    }
  }

  // Mode Peinture : appliquer la fine couche de peinture au mur visé (JAMAIS de cubes !)
  if (isPaintMode) {
    if (e.button === 0) {
      if (target.removePos) {
        isHoldingPaint = true;
        lastDragPlacePos = target.removePos.clone();
        const { x, y, z } = target.removePos;
        if (world.paintBrickAt(x, y, z, selectedPaintColor, selectedPaintPattern, target.normal)) {
          sound.playPaint();
          lastBuildSoundTime = performance.now();
          player.triggerActionAnimation();
          const pName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;
          showToast(`Fine couche appliquée (${pName} • ${selectedPaintColor})`);
        }
      } else {
        showToast("⚠️ Visez un mur pour appliquer la peinture");
      }
    }
    return; // Dans le mode peinture, on ne pose JAMAIS de cubes !
  }

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
    removeHoldStartTime = performance.now();
    lastRemoveTime = performance.now();
    world.beginDragStroke();
    if (target.removePos) {
      lastDragRemovePos = target.removePos.clone();
      lastRemovedPos = target.removePos.clone();
      const { x, y, z } = target.removePos;
      if (world.removeBrick(x, y, z, true, true, target.removeType)) {
        if (target.removeType === BRICK_TYPE_DIRT) {
          sound.playDig();
        } else {
          sound.playRemove();
        }
        lastBuildSoundTime = performance.now();
        player.triggerActionAnimation();
      }
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

function performUndo(): void {
  stopDragActions();
  const count = world.undo();
  if (count > 0) {
    sound.playRemove();
    player.triggerActionAnimation();
    showToast(count > 1 ? `↩ Action annulée (${count} éléments)` : '↩ Action précédente annulée');
  } else {
    showToast('Aucune action à annuler');
  }
}

function performRedo(): void {
  stopDragActions();
  const count = world.redo();
  if (count > 0) {
    sound.playPlace();
    player.triggerActionAnimation();
    showToast(count > 1 ? `↪ Action rétablie (${count} éléments)` : '↪ Action rétablie');
  } else {
    showToast('Aucune action à rétablir');
  }
}

document.getElementById('btn-hud-undo')!.addEventListener('click', (e) => {
  e.stopPropagation();
  performUndo();
});

document.getElementById('btn-hud-redo')!.addEventListener('click', (e) => {
  e.stopPropagation();
  performRedo();
});

window.addEventListener('keydown', (e) => {
  // Fermer la modale studio avec la touche Échap
  if (e.code === 'Escape' && !studioOverlay.classList.contains('hidden')) {
    closeStudioModal(false);
    return;
  }

  // Ignore shortcuts when typing in an input field inside the modal
  if (document.activeElement instanceof HTMLInputElement) return;

  // Undo shortcuts: U, Backspace, or Ctrl/Cmd + Z
  if (
    e.code === 'KeyU' ||
    e.code === 'Backspace' ||
    ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.code === 'KeyZ') && !e.shiftKey)
  ) {
    e.preventDefault();
    performUndo();
    return;
  }

  // Redo shortcuts: Y, Ctrl/Cmd + Y, or Ctrl/Cmd + Shift + Z
  if (
    e.code === 'KeyY' ||
    ((e.metaKey || e.ctrlKey) &&
      (e.key.toLowerCase() === 'y' ||
        e.code === 'KeyY' ||
        ((e.key.toLowerCase() === 'z' || e.code === 'KeyZ') && e.shiftKey)))
  ) {
    e.preventDefault();
    performRedo();
    return;
  }

  // Bascule rapide entre Mode Création et Mode Navigation
  if (e.code === 'KeyN') {
    e.preventDefault();
    setUIMode(currentUIMode === 'creation' ? 'navigation' : 'creation');
    return;
  }

  if (e.code === 'Enter' && currentUIMode === 'navigation') {
    e.preventDefault();
    setUIMode('creation');
    return;
  }

  if (e.code === 'Tab') {
    e.preventDefault();
    if (!isSidebarOpen) {
      setSidebarOpen(true);
      showToast('📐 Éléments de Construction dépliés');
    } else {
      const curCatIdx = CATEGORY_DEFINITIONS.findIndex((c) => c.id === activeCategory);
      const nextCat = CATEGORY_DEFINITIONS[(curCatIdx + 1) % CATEGORY_DEFINITIONS.length];
      selectCategory(nextCat.id, true);
      showToast(`Catégorie : ${nextCat.icon} ${nextCat.label}`);
    }
    return;
  }

  if (e.code.startsWith('Digit')) {
    const slotNum = Number(e.code.replace('Digit', ''));
    const items = getItemsByCategory(activeCategory);
    if (slotNum >= 1 && slotNum <= items.length) {
      selectBrick(items[slotNum - 1].id);
    }
  }

  if (e.code === 'KeyO' && player.isLocked) {
    const step = world.rotatePlacement();
    sound.playSelect();
    showToast(`Orientation : ${step * 90}°`);
  }

  if (e.code === 'KeyE' && player.isLocked) {
    if (player.isSleeping) {
      player.toggleSleeping();
      sound.playSelect();
      showToast('Personnage réveillé');
      return;
    }
    if (player.isSitting) {
      player.toggleSitting();
      sound.playSelect();
      showToast('Personnage debout');
      return;
    }
    const target = world.currentTarget;
    if (target?.isDoorHit && target.removePos) {
      const newState = world.toggleDoorAt(
        target.removePos.x,
        target.removePos.y,
        target.removePos.z
      );
      if (newState !== null) {
        sound.playDoor(newState);
        player.triggerActionAnimation();
      }
      return;
    }

    const aimDir = player.getAimDirection();

    // Lit visé directement par le réticule OU lit face au joueur
    const bed =
      (target?.removePos && world.isBedAt(target.removePos.x, target.removePos.y, target.removePos.z)
        ? target.removePos
        : null) ?? world.getFacingBed(player.position, aimDir, 2.5);

    if (bed) {
      player.toggleSleeping(bed);
      sound.playSelect();
      showToast('Allongé dans le grand lit • Appuyez sur E ou Déplacement pour vous réveiller');
      return;
    }

    // Chaise visée directement par le réticule OU chaise face au joueur
    const chair =
      (target?.removePos && world.isChairAt(target.removePos.x, target.removePos.y, target.removePos.z)
        ? target.removePos
        : null) ?? world.getFacingChair(player.position, aimDir, 2.2);

    if (chair) {
      player.toggleSitting(chair);
      sound.playSelect();
      showToast('Assis sur le fauteuil • Appuyez sur E ou Déplacement pour vous relever');
      return;
    }
  }

  if (e.code === 'KeyC' && player.isLocked) {
    pickTargetBrick();
  }

  if (e.code === 'KeyR' && player.isLocked) {
    togglePaintMode();
  }

  if (e.code === 'KeyB' && player.isLocked) {
    toggleBoxMode();
  }

  if (e.code === 'KeyM' && player.isLocked) {
    toggleRulerMode();
  }

  if (e.code === 'KeyP' && player.isLocked) {
    togglePhotoMode();
  }

  if (e.code === 'KeyT' && player.isLocked) {
    applyLighting(currentLightingIdx + 1);
    sound.playSelect();
    showToast(`Lumière : ${LIGHTING_PRESETS[currentLightingIdx].name}`);
  }

  if (e.code === 'KeyL') {
    toggleDayNightAutoCycle();
  }

  if (e.code === 'KeyH') {
    teleportHome();
  }
});

// --- Studio Modal & Auth Controls ---
document.getElementById('btn-resume')?.addEventListener('click', () => {
  closeStudioModal(true);
});

document.getElementById('btn-close-studio')?.addEventListener('click', () => {
  closeStudioModal(false);
});

studioOverlay.addEventListener('click', (e) => {
  if (e.target === studioOverlay) {
    closeStudioModal(false);
  }
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
    // 1. Fermer immédiatement la modale Studio, retirer le focus des champs et verrouiller le curseur
    closeStudioModal(true);

    const tpl = (btn as HTMLElement).dataset.template;
    const customName = newWorldNameEl.value.trim();
    let bricks: BrickEntry[] = [];
    let defaultTitle = 'Prairie Vierge';
    let defaultSpawn = { x: 0, y: 0.36, z: 0 };

    if (tpl === 'starter') {
      bricks = getStarterScene();
      defaultTitle = 'Terrasse & Façade';
      defaultSpawn = { x: 0, y: 0.36, z: 4.0 };
    } else if (tpl === 'pavilion') {
      bricks = getWhitePavilionPreset();
      defaultTitle = 'Maisonnette Blanche';
      defaultSpawn = { x: 0, y: 0.36, z: 6.0 };
    } else if (tpl === 'arch') {
      bricks = getBrutalistArchPreset();
      defaultTitle = 'Arche Blanche';
      defaultSpawn = { x: 0, y: 0.36, z: 6.0 };
    }

    const worldTitle = customName || `${defaultTitle} #${db.worlds.length + 1}`;
    await triggerImmediateSave();
    const created = await db.createNewWorld(worldTitle, bricks, defaultSpawn);
    newWorldNameEl.value = '';
    loadWorldIntoScene(created.bricks, created.playerState);
    showToast(`Nouveau monde "${created.name}" créé et sauvegardé !`);
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
  countryside.update(now * 0.001, player.position);
  world.update(dt, camera, player.getEyePosition(), currentUIMode === 'creation');

  // --- 1. Cycle Jour/Nuit Dynamique & Continu ---
  let isNight = currentLightingIdx === 3;
  if (isDayNightAutoCycle) {
    dayNightProgress = (dayNightProgress + dt / DAY_NIGHT_CYCLE_DURATION) % 1.0;
    const sunElevation = Math.sin(dayNightProgress * Math.PI * 2) * 58;
    const sunAzimuth = (dayNightProgress * 360 + 90) % 360;
    isNight = sunElevation < 0;

    currentSunDir = countryside.updateSunAndEnvironment(
      Math.max(-10, sunElevation),
      sunAzimuth,
      isNight ? 1.4 : 1.8,
      isNight ? 0.4 : 2.2
    );

    if (sunElevation > 14) {
      const t = Math.min(1, (sunElevation - 14) / 36);
      hemiLight.color.lerpColors(new THREE.Color(0xfed7aa), new THREE.Color(0xcbd5e1), t);
      hemiLight.groundColor.lerpColors(new THREE.Color(0x3b5926), new THREE.Color(0x456b34), t);
      hemiLight.intensity = THREE.MathUtils.lerp(0.46, 0.54, t);
      sunLight.color.lerpColors(new THREE.Color(0xfdba74), new THREE.Color(0xfef3c7), t);
      sunLight.intensity = THREE.MathUtils.lerp(1.1, 1.25, t);
      if (scene.fog) (scene.fog as THREE.FogExp2).color.lerpColors(new THREE.Color(0xd6a87c), new THREE.Color(0x8fb3d4), t);
      statTimeEl.textContent = 'JOUR (AUTO)';
    } else if (sunElevation > -4) {
      const t = Math.max(0, (sunElevation + 4) / 18);
      hemiLight.color.lerpColors(new THREE.Color(0x38bdf8), new THREE.Color(0xfed7aa), t);
      hemiLight.groundColor.lerpColors(new THREE.Color(0x0f1f14), new THREE.Color(0x3b5926), t);
      hemiLight.intensity = THREE.MathUtils.lerp(0.26, 0.46, t);
      sunLight.color.lerpColors(new THREE.Color(0x93c5fd), new THREE.Color(0xfdba74), t);
      sunLight.intensity = THREE.MathUtils.lerp(0.5, 1.1, t);
      if (scene.fog) (scene.fog as THREE.FogExp2).color.lerpColors(new THREE.Color(0x0f172a), new THREE.Color(0xd6a87c), t);
      statTimeEl.textContent = sunElevation >= 0 ? 'CRÉPUSCULE' : 'AUBE';
    } else {
      hemiLight.color.setHex(0x38bdf8);
      hemiLight.groundColor.setHex(0x0f1f14);
      hemiLight.intensity = 0.22;
      sunLight.color.setHex(0x93c5fd);
      sunLight.intensity = 0.45;
      if (scene.fog) (scene.fog as THREE.FogExp2).color.setHex(0x0f172a);
      statTimeEl.textContent = 'NUIT ÉTOILÉE (AUTO)';
    }
  }

  // --- 2. Particules Ambiantes Vivantes ---
  ambientParticles.update(dt, now * 0.001, player.position, isNight);

  // --- 3. Ambiance Sonore Adaptative et Réactive ---
  const envCheck = world.checkNearbyEnvironment(player.position, 7);
  sound.updateAmbience(dt, isNight, countryside.isRaining, envCheck.nearFire, envCheck.nearWater);

  // --- 4. Boussole 3D & Distance au Foyer ---
  if (statCompassEl) {
    const yaw = player.getYaw();
    const headingDeg = Math.round(((-yaw * 180 / Math.PI) % 360 + 360) % 360);
    const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    const card = cardinals[Math.round(headingDeg / 45) % 8];
    const distHome = Math.round(Math.hypot(player.position.x, player.position.z));
    statCompassEl.textContent = `🧭 ${card} ${headingDeg}° • ⌂ ${distHome}m`;
  }

  // Règle / Mesure en direct
  if (isRulerMode && world.currentTarget) {
    const p = player.position;
    const t = world.currentTarget.placePos;
    const dx = Math.abs(t.x - Math.round(p.x));
    const dy = Math.abs(t.y - Math.round(p.y));
    const dz = Math.abs(t.z - Math.round(p.z));
    const dist = Math.hypot(dx, dy, dz).toFixed(1);
    toolStatusBarEl.textContent = `📏 Mesure : ΔX = ${dx}m • ΔY = ${dy}m • ΔZ = ${dz}m (Distance : ${dist}m)`;
  }

  // Mass painting / creation / removal while holding mouse button and moving the mouse
  if (player.isLocked && isHoldingPaint && isPaintMode && world.currentTarget?.removePos) {
    const curPos = world.currentTarget.removePos;
    if (!lastDragPlacePos || !lastDragPlacePos.equals(curPos)) {
      world.paintBrickAt(curPos.x, curPos.y, curPos.z, selectedPaintColor, selectedPaintPattern, world.currentTarget.normal);
      lastDragPlacePos = curPos.clone();
      player.triggerActionAnimation();
      if (now - lastBuildSoundTime > 65) {
        sound.playPaint();
        lastBuildSoundTime = now;
      }
    }
  } else if (player.isLocked && isHoldingBuild && !isPaintMode && world.currentTarget) {
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
    // Protection anti-destruction en profondeur :
    // Un clic normal (relâché avant 320ms) ne détruit qu'un SEUL bloc et ne détruit JAMAIS les blocs derrière !
    // Si la touche reste maintenue volontairement (> 320ms), destruction continue sécurisée avec cadence de 200ms
    if (now - removeHoldStartTime > 320 && now - lastRemoveTime > 200) {
      if (!lastRemovedPos || !curRemPos.equals(lastRemovedPos)) {
        if (world.removeBrick(curRemPos.x, curRemPos.y, curRemPos.z, true, true, world.currentTarget.removeType)) {
          lastRemovedPos = curRemPos.clone();
          lastRemoveTime = now;
          player.triggerActionAnimation();
          if (world.currentTarget?.removeType === BRICK_TYPE_DIRT) {
            sound.playDig();
          } else {
            sound.playRemove();
          }
          lastBuildSoundTime = now;
        }
      }
    }
  }

  sunLight.position.copy(player.position).addScaledVector(currentSunDir, 65);
  sunLight.target.position.copy(player.position);
  sunLight.target.updateMatrixWorld();

  crosshairEl.classList.toggle('active', world.currentTarget !== null);

  const playerAimDir = player.getAimDirection();
  const targetedBed =
    world.currentTarget?.removePos &&
    world.isBedAt(
      world.currentTarget.removePos.x,
      world.currentTarget.removePos.y,
      world.currentTarget.removePos.z
    )
      ? world.currentTarget.removePos
      : null;

  const nearbyBed =
    (targetedBed && player.position.distanceTo(targetedBed) <= 2.6
      ? targetedBed
      : null) ?? world.getFacingBed(player.position, playerAimDir, 2.5);

  const targetedChair =
    world.currentTarget?.removePos &&
    world.isChairAt(
      world.currentTarget.removePos.x,
      world.currentTarget.removePos.y,
      world.currentTarget.removePos.z
    )
      ? world.currentTarget.removePos
      : null;

  let validTargetedChair: THREE.Vector3 | null = null;
  if (targetedChair && player.position.distanceTo(targetedChair) <= 2.3) {
    const chairRot = world.getChairRotation(targetedChair.x, targetedChair.y, targetedChair.z);
    const chairYaw = chairRot * (Math.PI / 2);
    const chairFront = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), chairYaw);
    const chairToPlayer = new THREE.Vector3(player.position.x - targetedChair.x, 0, player.position.z - targetedChair.z).normalize();
    if (chairToPlayer.dot(chairFront) >= 0.05) {
      validTargetedChair = targetedChair;
    }
  }

  const nearbyChair = validTargetedChair ?? world.getFacingChair(player.position, playerAimDir, 2.2);

  if (player.isSleeping) {
    interactionHintEl.className = 'interaction-hint chair-hint';
    interactionHintEl.innerHTML = `<span class="hint-icon">☀️</span> <kbd>E</kbd> ou <kbd>Déplacement</kbd> <span>Se réveiller</span>`;
    interactionHintEl.classList.remove('hidden');
  } else if (player.isSitting) {
    interactionHintEl.className = 'interaction-hint chair-hint';
    interactionHintEl.innerHTML = `<span class="hint-icon">🧍</span> <kbd>E</kbd> ou <kbd>Déplacement</kbd> <span>Se relever</span>`;
    interactionHintEl.classList.remove('hidden');
  } else if (nearbyBed) {
    interactionHintEl.className = 'interaction-hint chair-hint';
    interactionHintEl.innerHTML = `<span class="hint-icon">🛏️</span> <kbd>E</kbd> <span>Dormir dans le lit</span>`;
    interactionHintEl.classList.remove('hidden');
  } else if (nearbyChair) {
    interactionHintEl.className = 'interaction-hint chair-hint';
    interactionHintEl.innerHTML = `<span class="hint-icon">🪑</span> <kbd>E</kbd> <span>S'asseoir sur le fauteuil</span>`;
    interactionHintEl.classList.remove('hidden');
  } else if (isPaintMode && world.currentTarget?.removePos) {
    interactionHintEl.className = 'interaction-hint';
    const patternName = PATTERN_NAMES[selectedPaintPattern] || selectedPaintPattern;
    interactionHintEl.innerHTML = `<kbd>Clic Gauche</kbd> Peindre ce mur (<strong>${patternName}</strong> <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${selectedPaintColor};border:1.5px solid rgba(255,255,255,0.7);vertical-align:middle;margin-left:4px;"></span>)`;
    interactionHintEl.classList.remove('hidden');
  } else if (world.currentTarget?.isDoorHit) {
    interactionHintEl.className = 'interaction-hint';
    interactionHintEl.innerHTML = `<kbd>E</kbd> ${
      world.currentTarget.doorIsOpen ? 'Fermer la porte' : 'Ouvrir la porte'
    }`;
    interactionHintEl.classList.remove('hidden');
  } else {
    interactionHintEl.className = 'interaction-hint hidden';
  }

  statBricksEl.textContent = String(world.getBrickCount());
  statPosEl.textContent = `${Math.round(player.position.x)}, ${Math.round(player.position.y)}, ${Math.round(player.position.z)}`;
  statModeEl.textContent = player.isSleeping
    ? 'ENDORMI 🌙'
    : player.isSitting
    ? 'ASSIS'
    : player.isInWater
    ? (player.isSprinting ? 'NAGE RAPIDE' : 'NAGE')
    : player.isFlying
    ? (player.isSprinting ? 'VOL TURBO (SHIFT)' : 'VOL LIBRE (F)')
    : (player.isSprinting ? 'COURSE RAPIDE (SHIFT)' : 'MARCHE');

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
