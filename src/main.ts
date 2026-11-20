/**
 * Point d'entrée : l'application autour du jeu (menu principal, mondes, réglages).
 */
import * as THREE from 'three';
import { Sfx } from './audio/Sfx';
import { Game } from './game/Game';
import { GamepadController } from './player/Gamepad';
import { initTouchDetection, isTouchActive } from './player/Touch';
import { Atlas } from './render/Atlas';
import { ItemIcons } from './render/ItemIcons';
import { GameUi } from './ui/Ui';
import type { NewWorldOptions, UiGame, UiHost } from './ui/UiApi';
import { Storage, createWorldId, dimensionStorageId, loadSettings, readDimension, saveSettings, type WorldInfo } from './world/Storage';
import { exportWorld, importWorld, worldFileName } from './world/WorldFile';
import { DYNAMIC_ICON_ITEMS } from './world/Items';
import { GEN_VERSION } from './world/Constants';
import { TILE_SIZE } from './world/Tiles';
import { hashString } from './world/gen/Noise';

THREE.ColorManagement.enabled = false;

/** Graine saisie par le joueur : un entier tel quel, tout autre texte haché, vide = aléatoire. */
function parseSeed(text: string): number {
  const s = text.trim();
  if (s === '') return (Math.random() * 0x100000000) >>> 0;
  if (/^-?\d{1,15}$/.test(s)) return Number(s) | 0;
  return hashString(s);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.autoClear = false;
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const atlas = new Atlas();
  const icons = new ItemIcons(renderer, atlas);
  const sfx = new Sfx();
  const settings = loadSettings();
  sfx.volume = settings.soundVolume;
  sfx.musicVolume = settings.musicVolume;
  const storage = await Storage.open();

  const tileCache = new Map<number, string>();
  function tileUrl(tile: number): string {
    let url = tileCache.get(tile);
    if (url === undefined) {
      const c = document.createElement('canvas');
      c.width = TILE_SIZE;
      c.height = TILE_SIZE;
      const ctx = c.getContext('2d')!;
      const image = ctx.createImageData(TILE_SIZE, TILE_SIZE);
      image.data.set(atlas.tilePixels(tile));
      ctx.putImageData(image, 0, 0);
      url = c.toDataURL('image/png');
      tileCache.set(tile, url);
    }
    return url;
  }

  let game: Game | null = null;

  /** Arrête la partie en cours sans la sauvegarder. */
  function closeGame(): void {
    if (!game) return;
    game.dispose();
    game = null;
    host.game = null;
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
  }

  async function launch(info: WorldInfo): Promise<void> {
    closeGame();
    ui.showLoading('Chargement du monde', 'Ouverture de la sauvegarde…', 0);
    const savedKeys = await storage.chunkKeys(dimensionStorageId(info.id, readDimension(info.state?.dimension)));
    const g = new Game({ canvas, renderer, atlas, ui, sfx, settings, storage, info, savedKeys });
    game = g;
    host.game = g;
    g.resize(window.innerWidth, window.innerHeight);
    g.start();
  }

  const host = {
    settings,
    game: null as UiGame | null,
    persistent: storage.persistent,
    get touchActive(): boolean {
      return isTouchActive(settings);
    },
    openChat(initial = ''): void {
      ui.openChat(initial);
    },
    setTouchMove(forward: number, strafe: number): void {
      game?.setTouchMove(forward, strafe);
    },
    setTouchJump(down: boolean): void {
      game?.setTouchJump(down);
    },
    iconUrl: (itemId: number): string => {
      // boussole et horloge : l'image suit la direction ou l'heure de la partie en cours
      const tile = host.game && DYNAMIC_ICON_ITEMS.has(itemId) ? host.game.dynamicTile(itemId) : -1;
      return tile >= 0 ? icons.tile(tile) : icons.get(itemId);
    },
    tileUrl,
    click(): void {
      sfx.resume();
      sfx.play('click', { volume: 0.5 });
    },
    listWorlds(): Promise<WorldInfo[]> {
      return storage.listWorlds();
    },
    async createWorld(options: NewWorldOptions): Promise<void> {
      const now = Date.now();
      const info: WorldInfo = {
        id: createWorldId(),
        name: options.name.trim() || 'Nouveau monde',
        seed: parseSeed(options.seed),
        worldType: options.worldType,
        gameMode: options.gameMode,
        ...(options.hardcore ? { hardcore: true } : {}),
        genVersion: GEN_VERSION,
        createdAt: now,
        lastPlayed: now,
        state: null,
      };
      await storage.putWorld(info);
      await launch(info);
    },
    async playWorld(id: string): Promise<void> {
      const info = await storage.getWorld(id);
      if (!info) throw new Error('Monde introuvable');
      await launch(info);
    },
    deleteWorld(id: string): Promise<void> {
      return storage.deleteWorld(id);
    },
    async renameWorld(id: string, name: string): Promise<void> {
      const info = await storage.getWorld(id);
      if (!info) throw new Error('Monde introuvable');
      info.name = name.trim() || info.name;
      await storage.putWorld(info);
    },
    async exportWorld(id: string): Promise<void> {
      const info = await storage.getWorld(id);
      if (!info) throw new Error('Monde introuvable');
      const blob = await exportWorld(storage, id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = worldFileName(info.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    async importWorld(file: File): Promise<string> {
      const info = await importWorld(storage, await file.arrayBuffer());
      return info.id;
    },
    async quitToTitle(): Promise<void> {
      if (game) await game.save();
      closeGame();
      ui.showTitle();
    },
    settingsChanged(): void {
      sfx.volume = settings.soundVolume;
      sfx.musicVolume = settings.musicVolume;
      game?.applySettings();
      saveSettings(settings);
    },
  };

  const uiRoot = document.getElementById('ui') as HTMLElement;
  const ui = new GameUi(uiRoot, host satisfies UiHost);
  initTouchDetection(() => {
    if (isTouchActive(settings)) game?.input.unlock();
  });
  const gamepad = new GamepadController({
    settings,
    isModal: () => ui.modal,
    isInGame: () => game !== null && game.ready && !ui.modal,
    uiRoot,
    notify: (text) => ui.notifyPlatform(text),
    setGamepadState: (state) => game?.applyGamepadState(state),
  });
  ui.showTitle();

  // Enregistrement du service worker (PWA hors ligne, désactivé dans l'application Android embarquée)
  const isNativeApp = Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  if ('serviceWorker' in navigator && isNativeApp) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => undefined);
  } else if ('serviceWorker' in navigator) {
    const genWorkerUrl = new URL('./world/gen/gen.worker.ts', import.meta.url).href;
    const meshWorkerUrl = new URL('./world/mesh/mesh.worker.ts', import.meta.url).href;
    const warmSwCache = (): void => {
      const ctrl = navigator.serviceWorker.controller;
      if (!ctrl) return;
      const resUrls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin));
      ctrl.postMessage({
        type: 'WARM_CACHE',
        urls: [location.href, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', genWorkerUrl, meshWorkerUrl, ...resUrls],
      });
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      warmSwCache();
    });
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (navigator.serviceWorker.controller) warmSwCache();
        else if (reg.active) {
          reg.active.postMessage({
            type: 'WARM_CACHE',
            urls: [location.href, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', genWorkerUrl, meshWorkerUrl],
          });
        }
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              ui.notifyPlatform('Nouvelle version disponible : rechargez la page');
            }
          });
        });
      })
      .catch(() => undefined);
  }

  // Bouton « Retour » d'Android : ouvre la pause en jeu ou revient en arrière dans un menu
  (window as unknown as { __sarihBack?: () => boolean }).__sarihBack = (): boolean => {
    const titleEl = document.querySelector<HTMLElement>('[data-mc="title"]');
    if (!game && titleEl && titleEl.dataset.page === 'main') return false;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  };

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    game?.resize(window.innerWidth, window.innerHeight);
  });
  // la page se ferme ou passe à l'arrière-plan : on sauvegarde ce qui peut l'être
  const saveNow = (): void => {
    if (game?.ready) void game.save().catch(() => undefined);
  };
  window.addEventListener('beforeunload', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Au menu principal, l'interface s'anime seule ; en jeu, c'est la partie qui la rafraîchit.
  let last = performance.now();
  const frame = (t: number): void => {
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    gamepad.update(dt);
    if (!game) ui.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;color:#fff;background:#300;font:14px monospace;white-space:pre-wrap;z-index:99';
  box.textContent = `SarihBricks n'a pas pu démarrer.\n\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  document.body.appendChild(box);
});
