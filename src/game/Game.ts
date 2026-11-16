/**
 * Le jeu assemblé : monde, chunks, rendu, joueur, créatures, interface et sauvegarde.
 *
 *   const game = new Game({ canvas, renderer, atlas, ui, sfx, settings, storage, info, savedKeys });
 *   game.start();
 *   …
 *   await game.save();
 *   game.dispose();
 *
 * La logique tourne à 20 ticks par seconde ; le rendu interpole entre deux ticks. Tant que le
 * terrain autour du joueur n'est pas chargé (arrivée dans le monde, téléportation, réapparition),
 * le monde est gelé.
 */
import * as THREE from 'three';
import type { Sfx, SfxName } from '../audio/Sfx';
import type { DamageCause, Entity, GameApi } from '../entity/Entity';
import type { MobKind } from '../entity/MobModels';
import { HOSTILE_KINDS, Monster, PASSIVE_KINDS, createMob, hatchEgg } from '../entity/Mobs';
import { FallingBlock, ItemEntity, Thrown, Tnt } from '../entity/Objects';
import { isBoxFree, pointInFluid } from '../entity/Physics';
import { createEntity } from '../entity/Registry';
import { Spawner } from '../entity/Spawner';
import { Input } from '../player/Input';
import { Player } from '../player/Player';
import type { Atlas } from '../render/Atlas';
import { worldUniforms } from '../render/ChunkMaterials';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { EntityRenderer } from '../render/EntityRenderer';
import { HandRenderer, type HandState } from '../render/HandRenderer';
import { Particles, type ParticleKind, type ParticleWorld } from '../render/Particles';
import { Selection } from '../render/Selection';
import { Sky, type SkyEnvironment } from '../render/Sky';
import type { UiApi, UiGame } from '../ui/UiApi';
import { BLOCKS, BLOCK_SHAPE, BLOCK_SOLID, FACING_DX, FACING_DZ, SHAPE, isLeaves, isLog } from '../world/Blocks';
import type { Chunk } from '../world/Chunk';
import { ChunkManager, type ChunkHooks } from '../world/ChunkManager';
import { CHUNK_HEIGHT, DAY_TICKS, TICKS_PER_SECOND, chunkKey, type GameMode } from '../world/Constants';
import { B } from '../world/Ids';
import { ITEMS, getItem, itemLabel } from '../world/Items';
import { makeStack } from '../world/ItemStack';
import { newRayHit, raycast } from '../world/Raycast';
import type { Settings, Storage, WorldInfo } from '../world/Storage';
import { World, type BlockEntity, type WorldEffect, type WorldHost } from '../world/World';
import { BIOMES } from '../world/gen/Biomes';
import { WorldGen } from '../world/gen/WorldGen';
import { blockEntityItems, tickBlockEntities } from './BlockEntities';
import { ADVANCEMENTS } from './Advancements';
import { explode as runExplosion } from './Explosion';
import { Interaction, particleTile, particleTint, type InteractionHost } from './Interaction';
import { CreativeMenu, HOTBAR_SIZE, InventoryMenu, type Inventory, type Menu } from './Inventory';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  atlas: Atlas;
  ui: UiApi;
  sfx: Sfx;
  settings: Settings;
  storage: Storage;
  info: WorldInfo;
  /** Clés des chunks déjà sauvegardés de ce monde. */
  savedKeys: Set<number>;
}

/** Rayon (en chunks) qui doit être maillé avant d'entrer dans le monde. */
const READY_RADIUS = 3;
/** Ticks rattrapés au plus par image (au-delà, le retard est abandonné). */
const MAX_TICKS_PER_FRAME = 10;
/** Secondes entre deux sauvegardes automatiques. */
const AUTOSAVE_SECONDS = 30;
/** Radians par pixel de souris, à sensibilité 1. */
const MOUSE_SPEED = 0.0026;
/** Recul de la caméra à la troisième personne, en blocs. */
const THIRD_PERSON_DISTANCE = 4;
/** Ticks de sommeil avant le matin. */
const SLEEP_TICKS = 100;
/** Portée d'un son de volume 1, en blocs. */
const SOUND_RANGE = 16;
/** Effets de casse joués au plus par tick (explosions). */
const MAX_BREAK_SOUNDS = 6;
const MAX_BREAK_PARTICLES = 24;
const DEG = Math.PI / 180;

const DIFFICULTY_LABELS = ['Paisible', 'Facile', 'Normale', 'Difficile'];
const DIFFICULTY_NAMES = ['peaceful', 'easy', 'normal', 'hard'];
const TIME_NAMES: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };
const COMMANDS = ['help', 'gamemode', 'time', 'weather', 'give', 'tp', 'kill', 'seed', 'difficulty', 'summon', 'clear', 'spawnpoint'];
const MOB_LABELS: Record<string, string> = {
  zombie: 'un zombie',
  skeleton: 'un squelette',
  spider: 'une araignée',
  creeper: 'un creeper',
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
}

function fmt(v: number): string {
  return v.toFixed(2);
}

function deathMessage(cause: DamageCause, by: Entity | null): string {
  const killer = by ? (MOB_LABELS[by.mobKind] ?? 'une créature') : '';
  switch (cause) {
    case 'fall':
      return 'Vous êtes tombé de trop haut';
    case 'drown':
      return 'Vous vous êtes noyé';
    case 'fire':
      return 'Vous avez péri dans les flammes';
    case 'lava':
      return 'Vous avez tenté de nager dans la lave';
    case 'starve':
      return 'Vous êtes mort de faim';
    case 'void':
      return 'Vous êtes tombé hors du monde';
    case 'cactus':
      return 'Vous avez été piqué à mort';
    case 'suffocate':
      return 'Vous avez suffoqué dans un mur';
    case 'explosion':
      return by ? `Vous avez été soufflé par ${killer}` : 'Vous avez explosé';
    case 'attack':
      return by ? `Vous avez été tué par ${killer}` : 'Vous avez été tué';
    case 'arrow':
      return by ? `Vous avez été abattu par ${killer}` : 'Vous avez été abattu par une flèche';
    default:
      return 'Vous êtes mort';
  }
}

export class Game implements InteractionHost, UiGame, ChunkHooks {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly chunkRenderer: ChunkRenderer;
  readonly chunks: ChunkManager;
  readonly selection: Selection;
  /** Particules (le nom `particles` est pris par la méthode du contrat des entités). */
  readonly fx: Particles;
  readonly sky: Sky;
  readonly entityRenderer: EntityRenderer;
  readonly hand: HandRenderer;
  readonly player: Player;
  readonly entities: Entity[] = [];
  readonly interaction: Interaction;
  readonly spawner = new Spawner();
  readonly input: Input;
  readonly ui: UiApi;
  readonly rng: () => number;
  readonly info: WorldInfo;

  private level = 2;
  /** Âge du monde en ticks (l'heure du jour en découle). */
  time = 1000;
  raining = false;
  thundering = false;
  rainLevel = 0;
  thunderLevel = 0;
  /** Point d'apparition du monde. */
  spawnPoint: { x: number; y: number; z: number };
  /** 0 première personne, 1 de dos, 2 de face. */
  viewMode = 0;
  /** Le joueur est entré dans le monde (terrain initial chargé). */
  ready = false;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly atlas: Atlas;
  private readonly sfx: Sfx;
  private readonly settings: Settings;
  private readonly storage: Storage;
  private readonly pending: Entity[] = [];
  /** Chunk où chaque entité sauvegardable a été vue pour la dernière fois. */
  private readonly homes = new Map<Entity, number>();
  private readonly camHit = newRayHit();
  private readonly lookDir = { x: 0, y: 0, z: -1 };
  private readonly fogColor = new THREE.Color();
  private readonly handState: HandState = {
    bobPhase: 0,
    bobAmount: 0,
    skyLight: 15,
    blockLight: 0,
    useProgress: 0,
    useKind: 'none',
    yawDelta: 0,
    pitchDelta: 0,
  };

  private menu: Menu | null = null;
  private weatherTimer = 0;
  private ticking = false;
  /** Ajouts d'entités qui ne marquent pas leur chunk (chargement, peuplement d'un chunk neuf). */
  private quiet = false;
  private needSettle = false;
  /** Nouveau monde : la première apparition cherche un sol dégagé (pas la cime d'un arbre). */
  private freshSpawn = false;
  /** Appui bref sur Espace entre deux ticks : le saut est quand même pris en compte. */
  private jumpTapped = false;
  /** Triangles du monde à la dernière image (le rendu de la main remet le compteur à zéro). */
  private triangles = 0;
  private deathShown = false;
  private hudVisible = true;
  private breakFx = 0;
  private rainVolume = 0;
  private fovScale = 1;
  private lastYaw = 0;
  private lastPitch = 0;

  private raf = 0;
  private lastTime = 0;
  private acc = 0;
  private alpha = 1;
  private clock = 0;
  private frozenFor = 0;
  private autosave = 0;
  private saving: Promise<void> | null = null;
  private fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private disposed = false;
  private itemNames: Map<string, number> | null = null;

  constructor(o: GameOptions) {
    this.renderer = o.renderer;
    this.atlas = o.atlas;
    this.ui = o.ui;
    this.sfx = o.sfx;
    this.settings = o.settings;
    this.storage = o.storage;
    this.info = o.info;
    const info = o.info;
    const canvas = o.canvas;

    this.camera = new THREE.PerspectiveCamera(o.settings.fov, (canvas.clientWidth || 16) / (canvas.clientHeight || 9), 0.05, 1200);
    this.camera.rotation.order = 'YXZ';

    const world = new World(info.seed);
    this.world = world;
    this.rng = world.rng;
    world.host = this.createWorldHost();

    this.chunkRenderer = new ChunkRenderer(this.scene, o.atlas.texture);
    this.chunks = new ChunkManager(world, this.chunkRenderer, {
      seed: info.seed,
      worldType: info.worldType,
      storage: o.storage,
      worldId: info.id,
      savedKeys: o.savedKeys,
      viewDistance: o.settings.renderDistance,
    });
    this.chunks.hooks = this;

    const particleWorld: ParticleWorld = {
      isSolid: (x, y, z) => BLOCK_SOLID[world.getBlock(x, y, z)] === 1,
      lightAt: (x, y, z) => world.getRawLight(x, y, z),
      isWater: (x, y, z) => world.getBlock(x, y, z) === B.WATER,
    };
    const skyEnv: SkyEnvironment = {
      rainHeight: (x, z) => world.rainHeight(x, z),
      isSnowy: (x, z) => BIOMES[world.biomeAt(x, z)]?.snowy === true,
    };
    this.selection = new Selection(this.scene, o.atlas.texture);
    this.fx = new Particles(this.scene, o.atlas, particleWorld);
    this.sky = new Sky(this.scene, skyEnv);
    this.entityRenderer = new EntityRenderer(this.scene, o.atlas);
    this.hand = new HandRenderer(o.atlas);

    // --- joueur ---
    const player = new Player(info.gameMode);
    this.player = player;
    this.entities.push(player);
    player.sfx = (name, volume, pitch) => this.sfx.play(name, { volume, pitch });
    player.inventory.drop = (stack) => {
      const e = new ItemEntity(stack);
      const v = this.lookDir;
      player.look(v);
      e.setPosition(player.x, player.y + player.eyeHeight - 0.3, player.z);
      e.vx = v.x * 0.3;
      e.vy = v.y * 0.3 + 0.1;
      e.vz = v.z * 0.3;
      e.pickupDelay = 40;
      this.spawn(e);
    };
    Thrown.onEggBreak = hatchEgg;

    // --- état sauvegardé ---
    const st = info.state;
    const savedSpawn = st?.spawn;
    if (Array.isArray(savedSpawn) && savedSpawn.length === 3 && savedSpawn.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      this.spawnPoint = { x: savedSpawn[0] as number, y: savedSpawn[1] as number, z: savedSpawn[2] as number };
    } else {
      this.spawnPoint = new WorldGen(info.seed, info.worldType).findSpawn();
    }
    const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    if (st) {
      this.time = Math.max(0, Math.floor(num(st.time, 1000)));
      this.raining = st.raining === true;
      this.thundering = st.thundering === true && this.raining;
      this.rainLevel = this.raining ? 1 : 0;
      this.thunderLevel = this.thundering ? 1 : 0;
      this.weatherTimer = Math.max(0, Math.floor(num(st.weatherTimer, 0)));
      this.level = Math.max(0, Math.min(3, Math.floor(num(st.difficulty, 2))));
    }
    if (this.weatherTimer <= 0) this.weatherTimer = 12000 + Math.floor(Math.random() * 168000);
    const savedPlayer = st?.player;
    if (savedPlayer && typeof savedPlayer === 'object') {
      player.loadState(savedPlayer as Record<string, unknown>);
    } else {
      player.setPosition(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);
      this.needSettle = true;
      this.freshSpawn = info.worldType !== 'flat';
    }
    this.lastYaw = player.yaw;
    this.lastPitch = player.headPitch;

    // --- entrées ---
    this.input = new Input(canvas);
    this.input.blocked = () => this.ui.modal;
    this.input.active = () => this.ready && !this.disposed;
    this.input.onKey = (code, repeat, key) => this.onKey(code, repeat, key);
    this.input.onWheel = (direction) => {
      if (this.ui.modal || !player.alive) return;
      const inv = player.inventory;
      inv.selected = (inv.selected + direction + HOTBAR_SIZE) % HOTBAR_SIZE;
    };
    this.input.onLockLost = () => {
      if (this.ready && !this.ui.modal) this.pause();
    };

    this.interaction = new Interaction(this);
    this.applySettings();
    (window as unknown as { __game?: Game }).__game = this;
  }

  // ------------------------------------------------------------------ cycle de vie

  start(): void {
    if (this.raf !== 0 || this.disposed) return;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.hand.setAspect(width / height);
  }

  /** Réglages modifiés dans les options. */
  applySettings(): void {
    const s = this.settings;
    this.chunks.viewDistance = s.renderDistance;
    if (this.chunks.fancy !== s.fancyGraphics) {
      this.chunks.fancy = s.fancyGraphics;
      this.chunks.remeshAll();
    }
    this.sky.setCloudsVisible(s.clouds);
    this.sfx.volume = s.soundVolume;
    this.sfx.musicVolume = s.musicVolume;
  }

  /** Sauvegarde le monde (état global, joueur, chunks modifiés). Les appels simultanés partagent la même écriture. */
  save(): Promise<void> {
    if (this.saving) return this.saving;
    const run = this.writeSave().finally(() => {
      this.saving = null;
    });
    this.saving = run;
    return run;
  }

  private async writeSave(): Promise<void> {
    const info = this.info;
    info.state = {
      player: this.player.saveState(),
      time: this.time,
      raining: this.raining,
      thundering: this.thundering,
      weatherTimer: this.weatherTimer,
      difficulty: this.difficulty,
      spawn: [this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z],
    };
    info.gameMode = this.player.gameMode;
    info.lastPlayed = Date.now();
    const thumbnail = this.ready && !this.disposed ? this.thumbnail() : '';
    if (thumbnail) info.thumbnail = thumbnail;
    this.autosave = 0;
    await this.storage.putWorld(info);
    await this.chunks.saveAll();
  }

  /** Miniature du monde : l'image courante, réduite. */
  private thumbnail(): string {
    try {
      this.render(this.alpha, 0);
      const src = this.renderer.domElement;
      if (src.width === 0 || src.height === 0) return '';
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 72;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      // recadrage en 16:9 au centre de l'image
      const sw = Math.min(src.width, (src.height * 16) / 9);
      const sh = (sw * 9) / 16;
      ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 128, 72);
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      return '';
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.unlock();
    this.input.dispose();
    this.chunks.dispose();
    this.chunkRenderer.dispose();
    this.selection.dispose();
    this.fx.dispose();
    this.sky.dispose();
    this.entityRenderer.dispose();
    this.hand.dispose();
    this.sfx.stopMusic();
    this.sfx.setRain(0);
    this.sfx.setUnderwater(false);
    if (Thrown.onEggBreak === hatchEgg) Thrown.onEggBreak = null;
    const w = window as unknown as { __game?: Game };
    if (w.__game === this) delete w.__game;
  }

  // ------------------------------------------------------------------ boucle

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.25, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.frame(dt);
  };

  /** Une image : chargement des chunks, ticks en retard, rendu. */
  frame(dt: number): void {
    const p = this.player;
    this.chunks.update(p.x, p.z);

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    if (!this.ready) {
      const radius = Math.min(this.chunks.viewDistance, READY_RADIUS);
      if (!this.chunks.isReady(p.x, p.z, radius)) {
        this.ui.showLoading('Chargement du monde', 'Génération du terrain…', this.chunks.progress(p.x, p.z, radius));
        this.ui.update(dt);
        return;
      }
      this.enterWorld();
    }

    const paused = this.ui.pausing;
    const loaded = this.areaLoaded();
    if (loaded && this.needSettle) {
      this.needSettle = false;
      this.settle();
    }
    if (!paused && loaded) {
      this.frozenFor = 0;
      this.acc += dt * TICKS_PER_SECOND;
      let n = 0;
      while (this.acc >= 1 && n < MAX_TICKS_PER_FRAME) {
        this.tick();
        this.acc -= 1;
        n++;
      }
      if (this.acc >= 1) this.acc = 0;
      this.alpha = this.acc;
    } else if (!paused) {
      this.frozenFor += dt;
      if (this.frozenFor > 0.5) this.ui.actionBar('Chargement du terrain…');
    }

    // --- regard ---
    const input = this.input;
    if (!this.ui.modal && p.alive) {
      const s = MOUSE_SPEED * this.settings.sensitivity;
      p.turn(-input.mouseDX * s, -input.mouseDY * s * (this.settings.invertY ? -1 : 1));
    }
    input.mouseDX = 0;
    input.mouseDY = 0;

    this.interaction.frame(this.alpha);
    this.render(this.alpha, paused ? 0 : dt);
    this.ui.update(dt);

    // --- ambiance sonore ---
    let rain = 0;
    if (this.rainLevel > 0) {
      const x = Math.floor(p.x);
      const z = Math.floor(p.z);
      const snowy = BIOMES[this.world.biomeAt(x, z)]?.snowy === true;
      const open = p.y + p.height >= this.world.rainHeight(x, z);
      rain = snowy ? 0 : this.rainLevel * (open ? 1 : 0.3);
    }
    this.rainVolume = approach(this.rainVolume, rain, dt * 2);
    this.sfx.setRain(this.rainVolume);
    this.sfx.setUnderwater(this.headInWater);

    if (!paused && loaded && !this.deathShown) {
      this.autosave += dt;
      if (this.autosave >= AUTOSAVE_SECONDS) void this.save().catch((err: unknown) => this.saveFailed(err));
    }
  }

  private saveFailed(err: unknown): void {
    this.autosave = 0;
    this.ui.addMessage(`Sauvegarde impossible : ${err instanceof Error ? err.message : String(err)}`);
  }

  /** Le terrain initial est prêt : le joueur entre dans le monde. */
  private enterWorld(): void {
    this.ready = true;
    this.ui.showGame();
    this.input.lock();
    this.sfx.startMusic();
    this.acc = 0;
    this.alpha = 1;
  }

  /** Le chunk du joueur est maillé et ses voisins sont chargés. */
  private areaLoaded(): boolean {
    const x = Math.floor(this.player.x);
    const z = Math.floor(this.player.z);
    const c = this.world.chunkAt(x, z);
    return !!c && c.meshed && this.world.isAreaLoaded(x, z, 1);
  }

  /** Remonte le joueur jusqu'à un endroit libre (point d'apparition dans un feuillage, lit recouvert…). */
  private settle(): void {
    const p = this.player;
    const w = this.world;
    const hw = p.width / 2;
    if (this.freshSpawn) {
      this.freshSpawn = false;
      const g = this.clearGround(Math.floor(p.x), Math.floor(p.z));
      if (g) {
        this.spawnPoint = g;
        p.teleport(g.x, g.y, g.z);
      }
    }
    let y = p.y;
    while (y < CHUNK_HEIGHT && !isBoxFree(w, p.x - hw, y, p.z - hw, p.x + hw, y + p.height, p.z + hw)) y = Math.floor(y) + 1;
    if (y !== p.y) p.teleport(p.x, y, p.z);
    p.vx = p.vy = p.vz = 0;
    p.fallDistance = 0;
  }

  /**
   * Colonne la plus proche de (x0, z0) dont le sol est un vrai sol (ni feuillage, ni tronc, ni fluide)
   * et où le joueur tient debout. Ne sort pas de la zone chargée autour du joueur.
   */
  private clearGround(x0: number, z0: number): { x: number; y: number; z: number } | null {
    const p = this.player;
    const w = this.world;
    const hw = p.width / 2;
    for (let r = 0; r <= 12; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = x0 + dx;
          const z = z0 + dz;
          if (!w.isLoaded(x, z)) continue;
          let y = w.heightAt(x, z) - 1;
          while (y > 0) {
            const id = w.getBlock(x, y, z);
            if (BLOCK_SHAPE[id] === SHAPE.FLUID || (BLOCK_SOLID[id] && !isLeaves(id) && !isLog(id))) break;
            y--;
          }
          const ground = w.getBlock(x, y, z);
          if (y <= 0 || !BLOCKS[ground]?.opaque || ground === B.CACTUS) continue;
          if (BLOCK_SHAPE[w.getBlock(x, y + 1, z)] === SHAPE.FLUID) continue;
          if (!isBoxFree(w, x + 0.5 - hw, y + 1, z + 0.5 - hw, x + 0.5 + hw, y + 1 + p.height, z + 0.5 + hw)) continue;
          return { x: x + 0.5, y: y + 1, z: z + 0.5 };
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ tick

  /** Un pas de logique (1/20 s). */
  tick(): void {
    const p = this.player;
    const w = this.world;
    const input = this.input;
    this.ticking = true;
    this.breakFx = 0;

    // --- commandes du joueur ---
    const free = !this.ui.modal && p.alive && !p.sleeping;
    const pi = p.input;
    const kb = this.settings.keybinds;
    if (free) {
      pi.forward = (input.isDown(kb.forward) || input.isDown('ArrowUp') ? 1 : 0) - (input.isDown(kb.backward) || input.isDown('ArrowDown') ? 1 : 0);
      pi.strafe = (input.isDown(kb.right) || input.isDown('ArrowRight') ? 1 : 0) - (input.isDown(kb.left) || input.isDown('ArrowLeft') ? 1 : 0);
      pi.jump = input.isDown(kb.jump) || this.jumpTapped;
      pi.sneak = input.isDown(kb.sneak) || input.isDown('ShiftRight');
      pi.sprint = input.isDown(kb.sprint);
    } else {
      pi.forward = 0;
      pi.strafe = 0;
      pi.jump = false;
      pi.sneak = false;
      pi.sprint = false;
    }
    this.jumpTapped = false;
    this.interaction.tick();

    // --- entités ---
    const list = this.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e !== p && !w.isLoaded(Math.floor(e.x), Math.floor(e.z))) {
        // sortie du monde chargé : l'entité est abandonnée
        e.dead = true;
        continue;
      }
      e.tick(this);
    }
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead && e !== p) {
        const home = this.homes.get(e);
        if (home !== undefined) {
          this.touch(home);
          this.homes.delete(e);
        }
        continue;
      }
      list[n++] = e;
      const home = this.homes.get(e);
      if (home !== undefined) {
        const key = chunkKey(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4);
        if (key !== home) {
          this.touch(home);
          this.touch(key);
          this.homes.set(e, key);
        }
      }
    }
    list.length = n;
    this.ticking = false;
    if (this.pending.length > 0) {
      for (const e of this.pending) this.add(e, true);
      this.pending.length = 0;
    }

    // --- monde ---
    w.tick(p.x, p.z);
    tickBlockEntities(w);
    this.spawner.tick(this);
    this.atlas.tick();
    this.time++;
    this.tickWeather();
    this.tickSleep();
    this.tickAdvancements();

    if (!p.alive && !this.deathShown) this.showDeath();
  }

  private tickAdvancements(): void {
    const p = this.player;
    if (p.creative) return;
    // Vérifie toutes les demi-secondes (ou pendant le sommeil)
    if (this.time % 10 !== 0 && !p.sleeping) return;
    let highestUnlocked = -1;
    for (let i = 0; i < ADVANCEMENTS.length; i++) {
      const adv = ADVANCEMENTS[i];
      if (p.advancements.has(adv.id)) {
        highestUnlocked = i;
        continue;
      }
      if (adv.check(p)) {
        p.advancements.add(adv.id);
        highestUnlocked = i;
        this.sfx.play('levelup', { volume: 0.55, pitch: 1.1 });
        this.ui.showAdvancement(adv.title, adv.detail, adv.icon);
        this.ui.addMessage(`[Progrès] ${adv.title} — ${adv.detail}`);
      }
    }
    // Toute étape antérieure à la dernière étape atteinte est validée d'office sans notification
    for (let i = 0; i < highestUnlocked; i++) {
      p.advancements.add(ADVANCEMENTS[i].id);
    }
  }

  private tickWeather(): void {
    if (--this.weatherTimer <= 0) {
      if (this.raining) {
        this.raining = false;
        this.thundering = false;
        this.weatherTimer = 12000 + Math.floor(this.rng() * 168000);
      } else {
        this.raining = true;
        this.thundering = this.rng() < 0.3;
        this.weatherTimer = 12000 + Math.floor(this.rng() * 12000);
      }
    }
    this.rainLevel = approach(this.rainLevel, this.raining ? 1 : 0, 0.01);
    this.thunderLevel = approach(this.thunderLevel, this.thundering ? 1 : 0, 0.01);
    if (this.thunderLevel > 0.5 && this.rng() < 0.0025) {
      this.sky.lightning();
      this.sfx.play('thunder', { volume: 0.7 + this.rng() * 0.3, pitch: 0.8 + this.rng() * 0.4 });
    }
    const w = this.world;
    const light = this.sky.dayFactor * (1 - (this.rainLevel * 5) / 16) * (1 - (this.thunderLevel * 5) / 16);
    w.skyDarken = Math.round((1 - light) * 11);
    w.raining = this.rainLevel > 0.2;
  }

  private tickSleep(): void {
    const p = this.player;
    if (!p.sleeping) return;
    const bed = p.bed;
    if (!bed || this.world.getBlock(bed.x, bed.y, bed.z) !== B.BED) {
      this.wake();
      return;
    }
    if (++p.sleepTicks >= SLEEP_TICKS) {
      // le matin
      this.time += (DAY_TICKS - this.dayTime) % DAY_TICKS;
      this.raining = false;
      this.thundering = false;
      this.weatherTimer = 12000 + Math.floor(this.rng() * 168000);
      this.wake();
    }
  }

  private wake(): void {
    const p = this.player;
    p.sleeping = false;
    p.sleepTicks = 0;
  }

  private showDeath(): void {
    const p = this.player;
    this.deathShown = true;
    if (this.menu) {
      this.menu.close();
      this.menu = null;
    }
    this.interaction.reset();
    this.ui.showDeath(deathMessage(p.deathCause, p.deathBy));
    this.input.unlock();
  }

  // ------------------------------------------------------------------ rendu

  private render(alpha: number, dt: number): void {
    const p = this.player;
    const w = this.world;
    const cam = this.camera;
    const settings = this.settings;
    this.clock += dt;

    // --- caméra ---
    const ex = lerp(p.px, p.x, alpha);
    const ez = lerp(p.pz, p.z, alpha);
    let ey = lerp(p.py, p.y, alpha) + lerp(p.pEyeHeight, p.eyeHeight, alpha);
    if (p.sleeping) ey = lerp(p.py, p.y, alpha) + 0.35;
    else if (!p.alive) ey = lerp(p.py, p.y, alpha) + Math.max(0.3, p.eyeHeight - p.deathTime * 0.06);
    const yaw = p.yaw;
    const pitch = p.headPitch;
    const first = this.viewMode === 0;
    p.hidden = first;

    cam.position.set(ex, ey, ez);
    let roll = 0;
    let tilt = 0;
    if (p.hurtTime > 0 && p.alive) {
      const f = Math.max(0, p.hurtTime - alpha) / 10;
      roll -= Math.sin(f * f * f * f * Math.PI) * 14 * DEG;
    }
    const walk = lerp(p.pWalk, p.walk, alpha);
    const bob = lerp(p.pBob, p.bob, alpha);
    const phase = walk * Math.PI;
    if (first) {
      cam.rotation.set(pitch, yaw, 0);
      if (settings.viewBobbing && p.alive && !p.sleeping) {
        const amount = bob * 0.1;
        cam.translateX(Math.sin(phase) * amount * 0.5);
        cam.translateY(-Math.abs(Math.cos(phase) * amount));
        roll += Math.sin(phase) * amount * 3 * DEG;
        tilt = Math.abs(Math.cos(phase - 0.2) * amount) * 5 * DEG;
      }
      cam.rotation.set(pitch - tilt, yaw, roll);
    } else {
      // troisième personne : recul borné par le premier obstacle
      const back = this.viewMode === 1 ? 1 : -1;
      const cp = Math.cos(pitch);
      const dx = Math.sin(yaw) * cp * back;
      const dy = -Math.sin(pitch) * back;
      const dz = Math.cos(yaw) * cp * back;
      let dist = THIRD_PERSON_DISTANCE;
      if (raycast(w, ex, ey, ez, dx, dy, dz, THIRD_PERSON_DISTANCE + 0.3, this.camHit, true)) dist = Math.max(0.2, Math.min(dist, this.camHit.dist - 0.3));
      cam.position.set(ex + dx * dist, ey + dy * dist, ez + dz * dist);
      if (back === 1) cam.rotation.set(pitch, yaw, roll);
      else cam.rotation.set(-pitch, yaw + Math.PI, roll);
    }

    // --- champ de vision ---
    let scale = 1;
    if (p.sprinting) scale *= 1.15;
    if (p.flying) scale *= 1.1;
    if (p.useKind === 'bow') scale *= 1 - Math.min(1, p.useTicks / 20) * 0.15;
    this.fovScale += (scale - this.fovScale) * Math.min(1, dt * 10);
    const fov = Math.max(20, Math.min(140, settings.fov * this.fovScale));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    // --- ciel et brouillard ---
    const viewBlocks = this.chunks.viewDistance * 16;
    this.sky.update(dt, cam, this.dayTime + (dt > 0 ? alpha : 0), this.rainLevel, this.thunderLevel, viewBlocks);
    const u = worldUniforms;
    u.uSkyLight.value.copy(this.sky.skyLight);
    const inWater = pointInFluid(w, B.WATER, cam.position.x, cam.position.y, cam.position.z);
    const inLava = !inWater && pointInFluid(w, B.LAVA, cam.position.x, cam.position.y, cam.position.z);
    if (inWater) {
      const light = 0.15 + 0.85 * this.sky.dayFactor * (p.skyLight / 15);
      this.fogColor.setRGB(0.04 * light, 0.2 * light, 0.55 * light);
      u.uFogNear.value = 0;
      u.uFogFar.value = 28;
    } else if (inLava) {
      this.fogColor.setRGB(0.6, 0.12, 0);
      u.uFogNear.value = 0;
      u.uFogFar.value = 2;
    } else {
      this.fogColor.copy(this.sky.fogColor);
      u.uFogFar.value = viewBlocks;
      u.uFogNear.value = viewBlocks * 0.6;
    }
    u.uFogColor.value.copy(this.fogColor);
    const submerged = inWater || inLava;
    this.sky.setVisible(!submerged);

    // --- entités, particules, main ---
    this.entityRenderer.sync(this.entities, alpha, this.clock);
    this.fx.update(dt, cam);

    const hand = this.hand;
    const hs = this.handState;
    hand.setItem(p.heldItemId);
    hs.bobPhase = phase;
    hs.bobAmount = settings.viewBobbing ? bob : 0;
    hs.skyLight = p.skyLight;
    hs.blockLight = p.blockLight;
    hs.useKind = p.useKind;
    hs.useProgress = p.useKind === 'eat' ? Math.min(1, p.useTicks / 32) : p.useKind === 'bow' ? Math.min(1, p.useTicks / 20) : 0;
    hs.yawDelta = yaw - this.lastYaw;
    hs.pitchDelta = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    hand.update(dt, hs);

    const r = this.renderer;
    r.setClearColor(submerged ? this.fogColor : this.sky.skyColor, 1);
    r.clear();
    r.render(this.scene, cam);
    this.triangles = r.info.render.triangles;
    if (first && this.hudVisible && p.alive && !p.sleeping) hand.render(r);
  }

  // ------------------------------------------------------------------ clavier

  private onKey(code: string, repeat: boolean, key = ''): boolean {
    if (!this.ready) return false;
    const p = this.player;
    const kb = this.settings.keybinds;
    if (code === 'Escape') {
      if (!repeat) this.pause();
      return true;
    }
    if (code === 'F1') {
      if (!repeat) {
        this.hudVisible = !this.hudVisible;
        this.ui.setHudVisible(this.hudVisible);
      }
      return true;
    }
    if (code === 'F3') {
      if (!repeat) this.ui.toggleDebug();
      return true;
    }
    if (code === kb.perspective) {
      if (!repeat) this.viewMode = (this.viewMode + 1) % 3;
      return true;
    }
    if (code === kb.chat || code === 'Enter') {
      if (!repeat) this.openChat('');
      return true;
    }
    if (key === '/' || code === kb.command) {
      if (!repeat) this.openChat('/');
      return true;
    }
    if (!p.alive) return false;
    if (code === kb.inventory) {
      if (!repeat && !p.sleeping) this.openMenu(p.creative ? new CreativeMenu(p.inventory) : new InventoryMenu(p.inventory));
      return true;
    }
    if (code === kb.drop) {
      if (!p.sleeping) this.interaction.dropHeld(this.input.isDown('ControlLeft') || this.input.isDown(kb.sprint));
      return true;
    }
    if (code === kb.jump) {
      if (!repeat) {
        if (p.sleeping) this.wake();
        else {
          this.jumpTapped = true;
          p.tapJump();
        }
      }
      return true;
    }
    if (code === kb.forward) {
      if (!repeat) p.tapForward();
      return true;
    }
    if (code.length === 6 && code.startsWith('Digit')) {
      const n = code.charCodeAt(5) - 49;
      if (n >= 0 && n < HOTBAR_SIZE) {
        p.inventory.selected = n;
        return true;
      }
    }
    return false;
  }

  private pause(): void {
    if (this.ui.modal) return;
    this.interaction.reset();
    this.ui.openPause();
    this.input.unlock();
    void this.save().catch((err: unknown) => this.saveFailed(err));
  }

  private openChat(initial: string): void {
    this.interaction.reset();
    this.ui.openChat(initial);
    this.input.unlock();
  }

  // ------------------------------------------------------------------ InteractionHost

  get headInWater(): boolean {
    const p = this.player;
    return pointInFluid(this.world, B.WATER, p.x, p.y + p.eyeHeight, p.z);
  }

  get headInLava(): boolean {
    const p = this.player;
    return pointInFluid(this.world, B.LAVA, p.x, p.y + p.eyeHeight, p.z);
  }

  blockHitParticles(x: number, y: number, z: number, face: number, id: number, meta: number): void {
    this.fx.blockHit(x, y, z, face, particleTile(id, meta), particleTint(this, x, z, id));
  }

  openMenu(menu: Menu): void {
    this.interaction.reset();
    this.menu = menu;
    this.ui.openMenu(menu);
    this.input.unlock();
  }

  trySleep(x: number, y: number, z: number, meta: number): void {
    const p = this.player;
    // (x, z) de la moitié « tête » du lit
    const d = meta & 3;
    const hx = meta & 4 ? x : x + FACING_DX[d];
    const hz = meta & 4 ? z : z + FACING_DZ[d];
    p.bed = { x: hx, y, z: hz };
    this.ui.addMessage('Point de réapparition défini');
    const t = this.dayTime;
    if (!(this.thunderLevel > 0.5 || (t >= 12541 && t <= 23458))) {
      this.ui.actionBar('Vous ne pouvez dormir que la nuit ou pendant un orage');
      return;
    }
    for (const e of this.entities) {
      if (e instanceof Monster && !e.dead && Math.abs(e.x - hx) < 8 && Math.abs(e.z - hz) < 8 && Math.abs(e.y - y) < 5) {
        this.ui.actionBar('Vous ne pouvez pas dormir : des monstres rôdent');
        return;
      }
    }
    p.stopUsing();
    p.sprinting = false;
    p.teleport(hx + 0.5, y + 0.5625, hz + 0.5);
    p.vx = p.vy = p.vz = 0;
    p.sleeping = true;
    p.sleepTicks = 0;
    this.ui.actionBar('Appuyez sur Espace pour vous lever');
  }

  // ------------------------------------------------------------------ GameApi

  get dayTime(): number {
    return this.time % DAY_TICKS;
  }

  spawn(e: Entity): void {
    if (this.ticking && !this.quiet) this.pending.push(e);
    else this.add(e, !this.quiet);
  }

  private add(e: Entity, touch: boolean): void {
    this.entities.push(e);
    if (e instanceof Thrown) return;
    const key = chunkKey(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4);
    this.homes.set(e, key);
    if (touch) this.touch(key);
  }

  /** Le contenu en entités du chunk a changé : il devra être sauvegardé. */
  private touch(key: number): void {
    const c = this.world.chunks.get(key);
    if (!c) return;
    c.modified = true;
    c.saveDirty = true;
  }

  sound(name: SfxName, x: number, y: number, z: number, volume = 1, pitch = 1): void {
    const o = this.spatial(x, y, z, volume);
    if (o) this.sfx.play(name, { volume: o.volume, pitch, pan: o.pan });
  }

  blockSound(kind: 'break' | 'place' | 'hit' | 'step', blockId: number, x: number, y: number, z: number): void {
    const def = BLOCKS[blockId];
    if (!def) return;
    const o = this.spatial(x, y, z, 1);
    if (!o) return;
    const opts = { volume: o.volume, pan: o.pan, pitch: 0.9 + Math.random() * 0.2 };
    if (kind === 'break') this.sfx.blockBreak(def.sound, opts);
    else if (kind === 'place') this.sfx.blockPlace(def.sound, opts);
    else if (kind === 'hit') this.sfx.blockHit(def.sound, opts);
    else this.sfx.step(def.sound, opts);
  }

  /** Volume et panoramique d'un son émis en (x, y, z), ou null s'il est hors de portée. */
  private spatial(x: number, y: number, z: number, volume: number): { volume: number; pan: number } | null {
    const p = this.player;
    const dx = x - p.x;
    const dy = y - (p.y + p.eyeHeight);
    const dz = z - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const range = SOUND_RANGE * Math.max(1, volume);
    if (d >= range) return null;
    let pan = 0;
    if (d > 0.75) pan = Math.max(-1, Math.min(1, (dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) / d)) * 0.8;
    return { volume: Math.min(1, volume) * (1 - d / range), pan };
  }

  particles(kind: ParticleKind, x: number, y: number, z: number, count = 1, spread = 0, vx = 0, vy = 0, vz = 0): void {
    this.fx.spawn(kind, x, y, z, count, spread, vx, vy, vz);
  }

  blockParticles(x: number, y: number, z: number, blockId: number, meta: number, count = 8): void {
    this.fx.tileBurst(x, y, z, particleTile(blockId, meta), particleTint(this, Math.floor(x), Math.floor(z), blockId), count, 2);
  }

  itemParticles(x: number, y: number, z: number, itemId: number, count = 5): void {
    const it = getItem(itemId);
    if (it.tile >= 0) {
      this.fx.tileBurst(x, y, z, it.tile, 0xffffff, count, 2);
      return;
    }
    const block = it.places >= 0 ? it.places : itemId;
    if (!BLOCKS[block]) return;
    this.fx.tileBurst(x, y, z, particleTile(block, 0), particleTint(this, Math.floor(x), Math.floor(z), block), count, 2);
  }

  dropItem(x: number, y: number, z: number, id: number, count: number, damage = 0): Entity {
    const e = new ItemEntity(makeStack(id, count, damage));
    e.setPosition(x, y, z);
    e.vx = (this.rng() - 0.5) * 0.1;
    e.vy = 0.2;
    e.vz = (this.rng() - 0.5) * 0.1;
    this.spawn(e);
    return e;
  }

  explode(x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null): void {
    runExplosion(this, x, y, z, power, fire, source);
  }

  entitiesInBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, except: Entity | null = null): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities) {
      if (e !== except && !e.dead && e.intersects(x0, y0, z0, x1, y1, z1)) out.push(e);
    }
    return out;
  }

  message(text: string): void {
    this.ui.addMessage(text);
  }

  // ------------------------------------------------------------------ monde → jeu

  private createWorldHost(): WorldHost {
    return {
      dropItem: (x, y, z, id, count) => {
        this.dropItem(x + 0.5, y + 0.3, z + 0.5, id, count);
      },
      spawnFallingBlock: (x, y, z, id, meta) => {
        const e = new FallingBlock(id, meta);
        e.setPosition(x + 0.5, y, z + 0.5);
        this.spawn(e);
        return true;
      },
      primeTnt: (x, y, z, fuse) => {
        const e = new Tnt(fuse);
        e.setPosition(x + 0.5, y, z + 0.5);
        const a = this.rng() * Math.PI * 2;
        e.vx = -Math.sin(a) * 0.02;
        e.vy = 0.2;
        e.vz = -Math.cos(a) * 0.02;
        this.spawn(e);
        this.sound('fuse', x + 0.5, y + 0.5, z + 0.5, 1, 1);
      },
      effect: (kind, x, y, z, a, b) => this.worldEffect(kind, x, y, z, a ?? 0, b ?? 0),
      blockEntityRemoved: (be: BlockEntity) => {
        for (const s of blockEntityItems(be)) this.dropItem(be.x + 0.5, be.y + 0.3, be.z + 0.5, s.id, s.count, s.damage);
      },
    };
  }

  private worldEffect(kind: WorldEffect, x: number, y: number, z: number, a: number, b: number): void {
    switch (kind) {
      case 'break': {
        const n = this.breakFx++;
        if (n < MAX_BREAK_PARTICLES) this.fx.blockBreak(x, y, z, particleTile(a, b), particleTint(this, x, z, a));
        if (n < MAX_BREAK_SOUNDS) this.blockSound('break', a, x + 0.5, y + 0.5, z + 0.5);
        break;
      }
      case 'fizz':
        this.sound('fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + (this.rng() - this.rng()) * 0.8);
        this.fx.spawn('large_smoke', x + 0.5, y + 1, z + 0.5, 8, 0.4);
        break;
      case 'place':
        this.blockSound('place', a, x + 0.5, y + 0.5, z + 0.5);
        break;
      case 'grow':
        this.fx.spawn('bonemeal', x + 0.5, y + 0.5, z + 0.5, 12, 0.5);
        break;
    }
  }

  // ------------------------------------------------------------------ ChunkHooks

  chunkLoaded(chunk: Chunk, saved: unknown[] | null): void {
    this.quiet = true;
    try {
      if (saved === null) {
        this.spawner.populateChunk(this, chunk);
      } else {
        for (const d of saved) {
          const e = createEntity(d);
          if (e) this.add(e, false);
        }
      }
    } finally {
      this.quiet = false;
    }
  }

  chunkEntities(chunk: Chunk, remove: boolean): unknown[] {
    const out: unknown[] = [];
    const list = this.entities;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === this.player || Math.floor(e.x) >> 4 !== chunk.cx || Math.floor(e.z) >> 4 !== chunk.cz) {
        list[n++] = e;
        continue;
      }
      if (!e.dead) {
        const d = e.save();
        if (d) out.push(d);
      }
      if (remove) this.homes.delete(e);
      else list[n++] = e;
    }
    list.length = n;
    return out;
  }

  // ------------------------------------------------------------------ UiGame

  get inventory(): Inventory {
    return this.player.inventory;
  }

  get gameMode(): GameMode {
    return this.player.gameMode;
  }

  get health(): number {
    return Math.max(0, Math.ceil(this.player.health));
  }

  get maxHealth(): number {
    return this.player.maxHealth;
  }

  get hunger(): number {
    return this.player.hunger;
  }

  get armor(): number {
    return this.player.inventory.armorPoints();
  }

  get air(): number {
    return this.player.air;
  }

  get xpLevel(): number {
    return this.player.xpLevel;
  }

  get xpProgress(): number {
    return this.player.xpProgress;
  }

  get hurtTime(): number {
    return this.player.hurtTime;
  }

  get onFire(): boolean {
    return this.player.fireTicks > 0 && !this.player.creative;
  }

  get fade(): number {
    const p = this.player;
    return p.sleeping ? Math.min(1, p.sleepTicks / SLEEP_TICKS) : 0;
  }

  get guideGoal(): string {
    const p = this.player;
    for (const adv of ADVANCEMENTS) {
      if (!p.advancements.has(adv.id)) return adv.goal;
    }
    return '';
  }

  debugLines(): { left: string[]; right: string[] } {
    const p = this.player;
    const w = this.world;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    const stats = this.chunks.stats;
    const a = ((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const facing = ['nord (vers −Z)', 'ouest (vers −X)', 'sud (vers +Z)', 'est (vers +X)'][Math.round(a / (Math.PI / 2)) % 4];
    const t = this.dayTime;
    const hours = Math.floor(t / 1000 + 6) % 24;
    const minutes = Math.floor(((t % 1000) / 1000) * 60);
    const sky = w.getSkyLight(bx, by, bz);
    const block = w.getBlockLight(bx, by, bz);
    const weather = this.thunderLevel > 0.5 ? 'orage' : this.rainLevel > 0.2 ? 'pluie' : 'dégagé';
    const left = [
      'AetherBricks 3D',
      `${this.fps} ips, ${this.chunkRenderer.count} chunks affichés, ${this.triangles} triangles`,
      `Chunks : ${stats.loaded} chargés, ${stats.generating} en génération, ${stats.meshing} en maillage`,
      `Entités : ${this.entities.length}`,
      '',
      `XYZ : ${fmt(p.x)} / ${fmt(p.y)} / ${fmt(p.z)}`,
      `Bloc : ${bx} ${by} ${bz}`,
      `Chunk : ${bx & 15} ${bz & 15} dans ${bx >> 4} ${bz >> 4}`,
      `Orientation : ${facing} (${(p.yaw / DEG).toFixed(1)} / ${(p.headPitch / DEG).toFixed(1)})`,
      `Biome : ${BIOMES[w.biomeAt(bx, bz)]?.label ?? '?'}`,
      `Lumière : ${Math.max(sky - w.skyDarken, block)} (ciel ${sky}, bloc ${block})`,
      `Jour ${Math.floor(this.time / DAY_TICKS)}, ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} (${weather})`,
    ];
    const right = [
      `Graine : ${this.info.seed}`,
      `Mode : ${p.gameMode === 'creative' ? 'créatif' : 'survie'}`,
      `Difficulté : ${DIFFICULTY_LABELS[this.difficulty] ?? this.difficulty}`,
      `Sauvegarde : ${this.storage.persistent ? 'sur disque' : 'en mémoire'}`,
    ];
    if (this.chunks.saveError) right.push(`Erreur de sauvegarde : ${this.chunks.saveError}`);
    const it = this.interaction;
    if (it.entity) {
      right.push('', `Entité visée : ${it.entity.kind === 'mob' ? it.entity.mobKind : it.entity.kind}`);
    } else if (it.hasBlock) {
      const h = it.hit;
      right.push('', `Bloc visé : ${h.x} ${h.y} ${h.z}`, `${BLOCKS[h.id]?.label ?? h.id} (méta ${h.meta})`);
    }
    return { left, right };
  }

  closeMenu(): void {
    const menu = this.menu;
    if (menu) {
      this.menu = null;
      menu.close();
      if (menu.type === 'chest') this.sfx.play('chest_close', { volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
    }
    this.input.lock();
  }

  resume(): void {
    this.input.lock();
  }

  respawn(): void {
    const p = this.player;
    let x = this.spawnPoint.x;
    let y = this.spawnPoint.y;
    let z = this.spawnPoint.z;
    const bed = p.bed;
    if (bed) {
      // lit dans un chunk déchargé : on lui fait confiance
      if (!this.world.isLoaded(bed.x, bed.z) || this.world.getBlock(bed.x, bed.y, bed.z) === B.BED) {
        x = bed.x + 0.5;
        y = bed.y + 0.5625;
        z = bed.z + 0.5;
      } else {
        p.bed = null;
        this.ui.addMessage('Votre lit a disparu ou est obstrué');
      }
    }
    p.respawn(x, y, z);
    this.deathShown = false;
    this.needSettle = true;
    this.interaction.reset();
    this.input.lock();
  }

  // ------------------------------------------------------------------ chat et commandes

  chat(text: string): void {
    if (!text.startsWith('/')) {
      this.ui.addMessage(`<Vous> ${text}`);
      return;
    }
    try {
      this.command(text.slice(1).trim());
    } catch (err) {
      this.ui.addMessage(`Commande impossible : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private items(): Map<string, number> {
    let map = this.itemNames;
    if (!map) {
      map = new Map<string, number>();
      for (const it of ITEMS) if (it) map.set(it.name, it.id);
      this.itemNames = map;
    }
    return map;
  }

  private command(line: string): void {
    const args = line.split(/\s+/).filter((s) => s !== '');
    const name = (args.shift() ?? '').toLowerCase();
    const p = this.player;
    const say = (text: string): void => this.ui.addMessage(text);
    switch (name) {
      case 'help':
      case '?':
        say('Commandes : /gamemode <survival|creative>, /time <set|add> <valeur>, /weather <clear|rain|thunder>,');
        say('/give <objet> [quantité], /tp <x> <y> <z>, /summon <créature> [nombre], /difficulty <0-3>,');
        say('/kill, /clear, /seed, /spawnpoint');
        return;
      case 'gamemode': {
        const m = (args[0] ?? '').toLowerCase();
        const mode: GameMode | null = ['creative', 'c', '1'].includes(m) ? 'creative' : ['survival', 's', '0'].includes(m) ? 'survival' : null;
        if (!mode) {
          say('Usage : /gamemode <survival|creative>');
          return;
        }
        p.gameMode = mode;
        if (mode === 'survival') p.flying = false;
        if (this.menu) {
          this.menu.close();
          this.menu = null;
        }
        say(`Mode de jeu : ${mode === 'creative' ? 'créatif' : 'survie'}`);
        return;
      }
      case 'time': {
        const op = (args[0] ?? '').toLowerCase();
        const raw = (args[1] ?? '').toLowerCase();
        const value = raw in TIME_NAMES ? TIME_NAMES[raw] : Number(raw);
        if ((op !== 'set' && op !== 'add') || raw === '' || !Number.isFinite(value)) {
          say('Usage : /time <set|add> <day|noon|night|midnight|ticks>');
          return;
        }
        if (op === 'set') this.time = this.time - this.dayTime + ((Math.floor(value) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
        else this.time = Math.max(0, this.time + Math.floor(value));
        say(`Heure : ${this.dayTime}`);
        return;
      }
      case 'weather': {
        const kind = (args[0] ?? '').toLowerCase();
        if (kind !== 'clear' && kind !== 'rain' && kind !== 'thunder') {
          say('Usage : /weather <clear|rain|thunder>');
          return;
        }
        this.raining = kind !== 'clear';
        this.thundering = kind === 'thunder';
        this.weatherTimer = kind === 'clear' ? 12000 + Math.floor(this.rng() * 168000) : 12000 + Math.floor(this.rng() * 12000);
        say(kind === 'clear' ? 'Le temps se dégage' : kind === 'rain' ? 'Il se met à pleuvoir' : "L'orage approche");
        return;
      }
      case 'give': {
        const key = (args[0] ?? '').toLowerCase();
        const id = this.items().get(key) ?? (/^\d+$/.test(key) && ITEMS[Number(key)] ? Number(key) : -1);
        const count = args[1] === undefined ? 1 : Math.floor(Number(args[1]));
        if (id <= 0 || !Number.isFinite(count) || count < 1) {
          say(key === '' ? 'Usage : /give <objet> [quantité]' : `Objet inconnu : ${key}`);
          return;
        }
        const n = Math.min(count, 2304);
        p.inventory.give(id, n);
        say(`Donné : ${n} × ${itemLabel(id)}`);
        return;
      }
      case 'tp': {
        if (args.length < 3) {
          say('Usage : /tp <x> <y> <z> (~ = position actuelle)');
          return;
        }
        const coord = (s: string, base: number): number => (s.startsWith('~') ? base + (s.length > 1 ? Number(s.slice(1)) : 0) : Number(s));
        const x = coord(args[0], p.x);
        const y = coord(args[1], p.y);
        const z = coord(args[2], p.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || Math.abs(x) > 1e6 || Math.abs(z) > 1e6) {
          say('Coordonnées invalides');
          return;
        }
        if (p.sleeping) this.wake();
        p.teleport(x, Math.max(-32, Math.min(CHUNK_HEIGHT + 64, y)), z);
        p.vx = p.vy = p.vz = 0;
        p.fallDistance = 0;
        say(`Téléporté en ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`);
        return;
      }
      case 'kill':
        if (!p.alive) return;
        p.invulnerable = 0;
        if (p.hurt(this, 10000, 'void')) p.deathCause = 'generic';
        return;
      case 'seed':
        say(`Graine : ${this.info.seed}`);
        return;
      case 'difficulty': {
        const key = (args[0] ?? '').toLowerCase();
        const d = DIFFICULTY_NAMES.includes(key) ? DIFFICULTY_NAMES.indexOf(key) : /^[0-3]$/.test(key) ? Number(key) : -1;
        if (d < 0) {
          say('Usage : /difficulty <peaceful|easy|normal|hard>');
          return;
        }
        this.difficulty = d;
        say(`Difficulté : ${DIFFICULTY_LABELS[d]}`);
        return;
      }
      case 'summon': {
        const kind = (args[0] ?? '').toLowerCase() as MobKind;
        const count = args[1] === undefined ? 1 : Math.max(1, Math.min(50, Math.floor(Number(args[1])) || 1));
        if (!PASSIVE_KINDS.includes(kind) && !HOSTILE_KINDS.includes(kind)) {
          say(`Usage : /summon <${[...PASSIVE_KINDS, ...HOSTILE_KINDS].join('|')}> [nombre]`);
          return;
        }
        const v = this.lookDir;
        p.look(v);
        const it = this.interaction;
        const x = it.hasBlock ? it.hit.x + 0.5 : p.x + v.x * 3;
        const y = it.hasBlock ? it.hit.y + 1 : p.y;
        const z = it.hasBlock ? it.hit.z + 0.5 : p.z + v.z * 3;
        let made = 0;
        for (let i = 0; i < count; i++) {
          const mob = createMob(kind, this.rng);
          if (!mob) break;
          mob.setPosition(x + (i === 0 ? 0 : (this.rng() - 0.5) * 2), y, z + (i === 0 ? 0 : (this.rng() - 0.5) * 2));
          mob.setRotation(this.rng() * Math.PI * 2);
          this.spawn(mob);
          made++;
        }
        say(`Apparition : ${made} × ${kind}`);
        return;
      }
      case 'clear':
        p.inventory.clear();
        say('Inventaire vidé');
        return;
      case 'spawnpoint':
        this.spawnPoint = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y), z: Math.floor(p.z) + 0.5 };
        say(`Point d'apparition du monde : ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`);
        return;
      default:
        say(`Commande inconnue : /${name} (essayez /help)`);
    }
  }

  /** 0 paisible … 3 difficile. En paisible, les monstres disparaissent. */
  get difficulty(): number {
    return this.level;
  }

  set difficulty(d: number) {
    this.level = Math.max(0, Math.min(3, Math.floor(d) || 0));
    if (this.level === 0) {
      for (const e of this.entities) if (e instanceof Monster) e.dead = true;
    }
  }

  complete(text: string): string[] {
    if (!text.startsWith('/')) return [];
    const parts = text.slice(1).split(' ');
    const last = parts[parts.length - 1].toLowerCase();
    const pick = (list: readonly string[]): string[] => list.filter((s) => s.startsWith(last));
    if (parts.length === 1) return pick(COMMANDS);
    const cmd = parts[0].toLowerCase();
    if (parts.length === 2) {
      switch (cmd) {
        case 'gamemode':
          return pick(['survival', 'creative']);
        case 'time':
          return pick(['set', 'add']);
        case 'weather':
          return pick(['clear', 'rain', 'thunder']);
        case 'difficulty':
          return pick(DIFFICULTY_NAMES);
        case 'summon':
          return pick([...PASSIVE_KINDS, ...HOSTILE_KINDS]);
        case 'give':
          return pick([...this.items().keys()]).sort();
        case 'tp':
          return pick(['~']);
        default:
          return [];
      }
    }
    if (parts.length === 3 && cmd === 'time' && parts[1].toLowerCase() === 'set') return pick(Object.keys(TIME_NAMES));
    if (cmd === 'tp' && parts.length <= 4) return pick(['~']);
    return [];
  }
}
