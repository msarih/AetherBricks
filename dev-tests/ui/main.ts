/**
 * Page de test de l'interface (src/ui) : HUD et écrans, avec un faux jeu et une fausse application
 * mais le vrai inventaire, les vrais menus de cases et les vraies icônes.
 *
 * Paramètres d'URL :
 *   ?screen=hud|inventory|crafting|furnace|chest|creative|pause|options|controls|chat|death|
 *           title|worlds|create|loading        écran ouvert au démarrage (défaut : hud)
 *   mode=survival|creative   mode de jeu (creative est forcé pour screen=creative)
 *   health, hunger, armor, air, level, xp (0..1), hurt (ticks), fade (0..1)
 *   water=1, lava=1, fire=1  voiles plein écran
 *   debug=1                  écran F3 ; fps=1 compteur d'images ; hud=0 HUD caché (F1)
 *   scale=0..4               settings.guiScale
 *   from=title               screen=options : options ouvertes depuis le menu principal
 *   text=…                   screen=chat : texte initial
 *   persistent=0             mondes non enregistrés (avertissement)
 *   worlds=0                 aucun monde
 *   fail=list,create,play,delete,rename,quit   opérations de l'application qui échouent
 *   bg=white|black           fond uni à la place du faux paysage
 *
 * `window.__t` expose l'interface, la fausse application, le faux jeu et le journal des appels.
 * Clavier (comme le jeu, tant qu'aucun écran n'est ouvert) : E inventaire, T chat, / commande,
 * Échap pause, F1 HUD, F3 débogage.
 */
import * as THREE from 'three';
import { Atlas } from '../../src/render/Atlas';
import { ItemIcons } from '../../src/render/ItemIcons';
import type { ChestEntity, FurnaceEntity } from '../../src/game/BlockEntities';
import {
  ChestMenu,
  CraftingMenu,
  CreativeMenu,
  FurnaceMenu,
  Inventory,
  InventoryMenu,
  type Menu,
} from '../../src/game/Inventory';
import type { GameMode } from '../../src/world/Constants';
import { B, I } from '../../src/world/Ids';
import type { Slot } from '../../src/world/ItemStack';
import { DEFAULT_SETTINGS, type Settings, type WorldInfo } from '../../src/world/Storage';
import { T, TILE_SIZE } from '../../src/world/Tiles';
import { GameUi } from '../../src/ui/Ui';
import type { NewWorldOptions, UiGame, UiHost } from '../../src/ui/UiApi';

THREE.ColorManagement.enabled = false;

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => {
  const v = params.get(key);
  return v === null || v === '' ? fallback : Number(v);
};
const flag = (key: string): boolean => params.get(key) === '1';
const screen = params.get('screen') ?? 'hud';
const failing = new Set((params.get('fail') ?? '').split(',').filter(Boolean));

// ------------------------------------------------------------------ rendu : atlas et icônes

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
renderer.setPixelRatio(1);
const atlas = new Atlas();
const icons = new ItemIcons(renderer, atlas);

const tileCache = new Map<number, string>();
function tileUrl(tile: number): string {
  let url = tileCache.get(tile);
  if (url === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(TILE_SIZE, TILE_SIZE);
    image.data.set(atlas.tilePixels(tile));
    ctx.putImageData(image, 0, 0);
    url = canvas.toDataURL('image/png');
    tileCache.set(tile, url);
  }
  return url;
}

// ------------------------------------------------------------------ faux paysage derrière l'interface

const world = document.getElementById('world') as HTMLCanvasElement;
function paintWorld(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  world.width = w;
  world.height = h;
  const ctx = world.getContext('2d')!;
  const bg = params.get('bg');
  if (bg === 'white' || bg === 'black') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const horizon = Math.round(h * 0.56);
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#78a7ff');
  sky.addColorStop(1, '#c0d8ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);
  const ground = ctx.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, '#6c9a4c');
  ground.addColorStop(1, '#4f7d33');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, h - horizon);
  // quelques « blocs » pour que le viseur et les voiles aient quelque chose à recouvrir
  const size = Math.round(h / 9);
  const blocks: Array<[number, number, string]> = [
    [0.18, 0, '#7d7d7d'], [0.18, 1, '#7d7d7d'], [0.62, 0, '#8a6a43'], [0.62, 1, '#8a6a43'],
    [0.62, 2, '#3f7a2d'], [0.8, 0, '#b9b08a'],
  ];
  for (const [fx, row, color] of blocks) {
    const x = Math.round(w * fx);
    const y = horizon - size * (row + 1) + Math.round(size * 0.4);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, y + size - 4, size, 4);
    ctx.fillRect(x + size - 4, y, 4, size);
  }
}
paintWorld();
window.addEventListener('resize', paintWorld);

// ------------------------------------------------------------------ inventaire

const inv = new Inventory();
const dropped: Slot[] = [];
inv.drop = (stack) => {
  dropped.push({ ...stack });
};

function fillInventory(): void {
  const s = inv.slots;
  // barre d'objets
  s[0] = { id: I.DIAMOND_PICKAXE, count: 1, damage: 400 };
  s[1] = { id: I.IRON_SWORD, count: 1, damage: 0 };
  s[2] = { id: B.OAK_PLANKS, count: 64, damage: 0 };
  s[3] = { id: B.COBBLESTONE, count: 37, damage: 0 };
  s[4] = { id: B.TORCH, count: 16, damage: 0 };
  s[5] = { id: I.BREAD, count: 5, damage: 0 };
  s[6] = { id: I.BOW, count: 1, damage: 120 };
  s[7] = { id: I.ARROW, count: 24, damage: 0 };
  s[8] = { id: I.WATER_BUCKET, count: 1, damage: 0 };
  // sac
  s[9] = { id: I.COAL, count: 12, damage: 0 };
  s[10] = { id: I.IRON_INGOT, count: 9, damage: 0 };
  s[11] = { id: I.DIAMOND, count: 3, damage: 0 };
  s[12] = { id: I.STICK, count: 32, damage: 0 };
  s[13] = { id: B.OAK_LOG, count: 20, damage: 0 };
  s[14] = { id: B.GLASS, count: 8, damage: 0 };
  s[15] = { id: I.APPLE, count: 2, damage: 0 };
  s[16] = { id: B.OAK_PLANKS, count: 10, damage: 0 };
  s[18] = { id: I.IRON_PICKAXE, count: 1, damage: 230 };
  s[19] = { id: B.SAND, count: 64, damage: 0 };
  s[20] = { id: B.IRON_ORE, count: 6, damage: 0 };
  s[22] = { id: B.CRAFTING_TABLE, count: 1, damage: 0 };
  s[23] = { id: B.TNT, count: 4, damage: 0 };
  s[27] = { id: I.IRON_HELMET, count: 1, damage: 30 };
  s[28] = { id: B.WOOL_ORANGE, count: 17, damage: 0 };
  s[35] = { id: I.GOLD_INGOT, count: 5, damage: 0 };
  if (params.get('armor') !== '0') {
    inv.armor[1] = { id: I.IRON_CHESTPLATE, count: 1, damage: 40 };
    inv.armor[3] = { id: I.IRON_BOOTS, count: 1, damage: 0 };
  }
}
fillInventory();

const chest: ChestEntity = { type: 'chest', x: 0, y: 64, z: 0, items: new Array<Slot>(27).fill(null) };
chest.items[0] = { id: B.GOLD_BLOCK, count: 3, damage: 0 };
chest.items[1] = { id: I.COOKED_PORKCHOP, count: 7, damage: 0 };
chest.items[5] = { id: B.OAK_PLANKS, count: 30, damage: 0 };
chest.items[13] = { id: I.GOLDEN_APPLE, count: 1, damage: 0 };
chest.items[26] = { id: I.SHEARS, count: 1, damage: 100 };

const furnace: FurnaceEntity = {
  type: 'furnace',
  x: 1,
  y: 64,
  z: 0,
  items: [
    { id: B.IRON_ORE, count: 5, damage: 0 },
    { id: I.COAL, count: 3, damage: 0 },
    { id: I.IRON_INGOT, count: 2, damage: 0 },
  ],
  burnTime: 900,
  burnTotal: 1600,
  cookTime: 130,
};

// ------------------------------------------------------------------ faux jeu, fausse application

const calls: string[] = [];
const log = (entry: string): void => {
  calls.push(entry);
};

const COMMANDS = ['/gamemode', '/give', '/help', '/seed', '/time', '/tp'];

let currentMenu: Menu | null = null;
let changes = 0;

const game = {
  inventory: inv,
  gameMode: (params.get('mode') === 'creative' || screen === 'creative' ? 'creative' : 'survival') as GameMode,
  health: num('health', 17),
  maxHealth: 20,
  hunger: num('hunger', 15),
  armor: params.has('armor') ? num('armor', 0) : 8,
  air: num('air', 300),
  xpLevel: num('level', 7),
  xpProgress: num('xp', 0.62),
  hurtTime: num('hurt', 0),
  headInWater: flag('water'),
  headInLava: flag('lava'),
  onFire: flag('fire'),
  fade: num('fade', 0),
  difficulty: 2,
  debugLines(): { left: string[]; right: string[] } {
    return {
      left: [
        'SarihBricks 0.1 (page de test)',
        `${fps} fps, 12 mises à jour de chunks`,
        'C : 96/441, E : 14, P : 37',
        '',
        'XYZ : 12.500 / 64.000 / -8.250',
        'Bloc : 12 64 -9   Chunk : 12 0 7 dans 0 -1',
        'Direction : nord (vers Z négatif)   (178.2 / 12.4)',
        'Lumière : 15 (15 ciel, 0 bloc)',
        'Biome : plaines',
        'Jour 3, 10:42',
      ],
      right: ['Mémoire : 212 / 4096 Mo', 'WebGL 2 (ANGLE Metal)', '', 'Bloc visé : 12 63 -11', 'pierre (id 1)'],
    };
  },
  closeMenu(): void {
    log('closeMenu');
    currentMenu?.close();
    currentMenu = null;
  },
  resume(): void {
    log('resume');
  },
  respawn(): void {
    log('respawn');
    game.health = 20;
    game.hunger = 20;
  },
  chat(text: string): void {
    log(`chat:${text}`);
    ui.addMessage(text.startsWith('/') ? `Commande exécutée : ${text}` : `<Steve> ${text}`);
  },
  complete(text: string): string[] {
    log(`complete:${text}`);
    if (!text.startsWith('/')) return [];
    if (text.startsWith('/gamemode ')) {
      const arg = text.slice('/gamemode '.length);
      return ['survival', 'creative'].filter((m) => m.startsWith(arg));
    }
    return COMMANDS.filter((c) => c.startsWith(text));
  },
};

const now = Date.now();
const worlds: WorldInfo[] =
  params.get('worlds') === '0'
    ? []
    : [
        { id: 'w1', name: 'Mon premier monde', seed: 123456789, worldType: 'default', gameMode: 'survival', createdAt: now - 9e8, lastPlayed: now - 36e5, state: null },
        { id: 'w2', name: 'Chantier créatif', seed: -42, worldType: 'flat', gameMode: 'creative', createdAt: now - 4e8, lastPlayed: now - 2 * 864e5, state: null },
        { id: 'w3', name: 'Un monde au nom vraiment très long pour vérifier la coupe du texte', seed: 7, worldType: 'default', gameMode: 'survival', createdAt: now - 2e8, lastPlayed: now - 30 * 864e5, state: null },
      ];

const settings: Settings = { ...DEFAULT_SETTINGS, guiScale: num('scale', 0), showFps: flag('fps') };
let settingsChanges = 0;
let clicks = 0;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function step(name: string): Promise<void> {
  log(name);
  await wait(40);
  if (failing.has(name.split(':')[0])) throw new Error(`Échec simulé (${name.split(':')[0]}) : la base de données est indisponible`);
}

const host = {
  settings,
  game: null as UiGame | null,
  persistent: params.get('persistent') !== '0',
  iconUrl: (itemId: number): string => icons.get(itemId),
  tileUrl,
  click(): void {
    clicks++;
  },
  async listWorlds(): Promise<WorldInfo[]> {
    await step('list');
    return worlds.map((w) => ({ ...w })).sort((a, b) => b.lastPlayed - a.lastPlayed);
  },
  async createWorld(options: NewWorldOptions): Promise<void> {
    await step(`create:${JSON.stringify(options)}`);
    const id = `w${Date.now()}`;
    worlds.push({
      id,
      name: options.name,
      seed: Number(options.seed) || 99,
      worldType: options.worldType,
      gameMode: options.gameMode,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      state: null,
    });
    await startGame(options.gameMode);
  },
  async playWorld(id: string): Promise<void> {
    await step(`play:${id}`);
    const w = worlds.find((x) => x.id === id);
    if (!w) throw new Error('Monde introuvable');
    await startGame(w.gameMode);
  },
  async deleteWorld(id: string): Promise<void> {
    await step(`delete:${id}`);
    const i = worlds.findIndex((x) => x.id === id);
    if (i >= 0) worlds.splice(i, 1);
  },
  async renameWorld(id: string, name: string): Promise<void> {
    await step(`rename:${id}:${name}`);
    const w = worlds.find((x) => x.id === id);
    if (w) w.name = name;
  },
  async quitToTitle(): Promise<void> {
    await step('quit');
    host.game = null;
    ui.showTitle();
  },
  settingsChanged(): void {
    settingsChanges++;
  },
};

async function startGame(mode: GameMode): Promise<void> {
  ui.showLoading('Chargement du monde', 'Génération du terrain…', 0.3);
  await wait(60);
  ui.showLoading('Chargement du monde', 'Construction des chunks…', 0.8);
  await wait(60);
  game.gameMode = mode;
  host.game = game;
  ui.showGame();
}

const root = document.getElementById('ui') as HTMLElement;
const ui = new GameUi(root, host satisfies UiHost);

// ------------------------------------------------------------------ écran demandé

function openMenu(kind: string): Menu {
  const onChange = (): void => {
    changes++;
  };
  let menu: Menu;
  if (kind === 'crafting') menu = new CraftingMenu(inv);
  else if (kind === 'furnace') menu = new FurnaceMenu(inv, furnace, onChange);
  else if (kind === 'chest') menu = new ChestMenu(inv, chest, onChange);
  else if (kind === 'creative') menu = new CreativeMenu(inv);
  else menu = new InventoryMenu(inv);
  currentMenu = menu;
  ui.openMenu(menu);
  return menu;
}

const clickOn = (id: string): void => {
  const e = root.querySelector<HTMLElement>(`[data-mc="${id}"]`);
  if (!e) throw new Error(`repère data-mc="${id}" introuvable`);
  e.click();
};

async function start(): Promise<void> {
  const inGame = !['title', 'worlds', 'create', 'loading'].includes(screen) && params.get('from') !== 'title';
  if (inGame) {
    host.game = game;
    ui.showGame();
    ui.addMessage('Steve a rejoint la partie');
    ui.addMessage('<Alex> Salut ! Tu viens miner du fer avec moi ?');
  }
  if (flag('debug')) ui.toggleDebug();
  if (params.get('hud') === '0') ui.setHudVisible(false);
  if (params.has('bar')) ui.actionBar(params.get('bar') ?? '');

  switch (screen) {
    case 'hud':
      break;
    case 'inventory':
    case 'crafting':
    case 'furnace':
    case 'chest':
    case 'creative':
      openMenu(screen);
      break;
    case 'pause':
      ui.openPause();
      break;
    case 'options':
    case 'controls':
      if (inGame) ui.openPause();
      else ui.showTitle();
      clickOn('options');
      if (screen === 'controls') clickOn('controls');
      break;
    case 'chat':
      ui.openChat(params.get('text') ?? '');
      break;
    case 'death':
      game.health = 0;
      ui.showDeath('Steve a été tué par un zombie');
      break;
    case 'title':
      ui.showTitle();
      break;
    case 'worlds':
    case 'create':
      ui.showTitle();
      clickOn('play');
      if (screen === 'create') {
        await wait(120);
        clickOn('world-create');
      }
      break;
    case 'loading':
      ui.showLoading('Génération du monde', 'Construction du terrain…', num('progress', 0.42));
      break;
    default:
      throw new Error(`écran inconnu : ${screen}`);
  }
}

// Le jeu écoute en capture sur window et ne traite ses touches que si aucun écran n'est ouvert
window.addEventListener(
  'keydown',
  (e) => {
    if (ui.modal || !host.game) return;
    let used = true;
    if (e.code === 'KeyE') openMenu(game.gameMode === 'creative' ? 'creative' : 'inventory');
    else if (e.code === 'KeyT') ui.openChat();
    else if (e.code === 'Slash' || e.key === '/') ui.openChat('/');
    else if (e.code === 'Escape') ui.openPause();
    else if (e.code === 'F3') ui.toggleDebug();
    else if (e.code === 'F1') {
      hudVisible = !hudVisible;
      ui.setHudVisible(hudVisible);
    } else if (/^Digit[1-9]$/.test(e.code)) inv.selected = Number(e.code.slice(5)) - 1;
    else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);
let hudVisible = params.get('hud') !== '0';

// ------------------------------------------------------------------ boucle

let fps = 60;
let last = performance.now();
let frames = 0;
let fpsTimer = 0;
function frame(t: number): void {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(frames / fpsTimer);
    frames = 0;
    fpsTimer = 0;
  }
  ui.update(dt);
  requestAnimationFrame(frame);
}

const testApi = {
  ui,
  host,
  game,
  inv,
  chest,
  furnace,
  worlds,
  calls,
  dropped,
  settings,
  openMenu,
  menu: (): Menu | null => currentMenu,
  counters: (): { clicks: number; settingsChanges: number; changes: number } => ({ clicks, settingsChanges, changes }),
  /** État lisible de l'inventaire : « id×n » par case. */
  snapshot(): { slots: string[]; armor: string[]; cursor: string; menu: string[] } {
    const show = (s: Slot): string => (s ? `${s.id}x${s.count}` : '-');
    return {
      slots: inv.slots.map(show),
      armor: inv.armor.map(show),
      cursor: show(inv.cursor),
      menu: currentMenu ? currentMenu.slots.map((m) => show(m.stack)) : [],
    };
  },
};
(window as unknown as { __t: typeof testApi; __ready: boolean }).__t = testApi;

start()
  .then(() => {
    requestAnimationFrame(frame);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        (window as unknown as { __ready: boolean }).__ready = true;
      });
    });
  })
  .catch((err: unknown) => {
    console.error(err);
    document.title = `ERREUR : ${String(err)}`;
  });
