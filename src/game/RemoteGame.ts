/**
 * Session multijoueur côté client (Jalon 1) :
 * - réception des chunks RLE du serveur + maillage local (`mesh.worker.ts`) ;
 * - prédiction locale du déplacement du joueur (20 TPS) ;
 * - affichage des autres joueurs avec leur pseudo et interpolation fluide ;
 * - chat et commandes côté serveur (`/help`, `/tp`, `/time`, `/gamemode`).
 *
 * Dans ce jalon, la casse et la pose de blocs sont désactivées en multijoueur.
 */
import * as THREE from 'three';
import type { Sfx } from '../audio/Sfx';
import type { GameApi } from '../entity/Entity';
import type { EntityKind, EntityView } from '../entity/EntityView';
import type { MobKind } from '../entity/MobModels';
import { pointInFluid } from '../entity/Physics';
import { Input } from '../player/Input';
import { Player } from '../player/Player';
import { TouchLookController, isTouchActive } from '../player/Touch';
import type { Atlas } from '../render/Atlas';
import { OVERWORLD_AMBIENT, worldUniforms } from '../render/ChunkMaterials';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { EntityRenderer } from '../render/EntityRenderer';
import { HandRenderer, type HandState } from '../render/HandRenderer';
import { Sky, type SkyEnvironment } from '../render/Sky';
import type { UiApi, UiGame } from '../ui/UiApi';
import { BLOCKS, BLOCK_SHAPE } from '../world/Blocks';
import { ChunkManager } from '../world/ChunkManager';
import { CHUNK_HEIGHT, DAY_TICKS, TICKS_PER_SECOND, chunkKey, type GameMode } from '../world/Constants';
import { B } from '../world/Ids';
import { raycast, newRayHit } from '../world/Raycast';
import type { Settings } from '../world/Storage';
import { World } from '../world/World';
import { BIOMES } from '../world/gen/Biomes';
import type { MultiplayerClient, WelcomePacket } from '../net/Client';
import type { RemotePlayerState } from '../net/Protocol';
import { CreativeMenu, InventoryMenu, type Inventory, type Menu } from './Inventory';

const READY_RADIUS = 2;
const MAX_TICKS_PER_FRAME = 10;
const MOUSE_SPEED = 0.0026;
const THIRD_PERSON_DISTANCE = 4;
const DEG = Math.PI / 180;
const COMMANDS = ['help', 'tp', 'time', 'gamemode'];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

class RemotePlayerEntity implements EntityView {
  readonly id: number;
  readonly kind: EntityKind = 'player';
  mobKind: MobKind = 'player';

  px: number;
  py: number;
  pz: number;
  x: number;
  y: number;
  z: number;

  pYaw: number;
  yaw: number;
  pHeadYaw: number;
  headYaw: number;
  pHeadPitch: number;
  headPitch: number;

  pLimbSwing = 0;
  limbSwing = 0;
  pLimbAmount = 0;
  limbAmount = 0;

  hurtTime = 0;
  deathTime = 0;
  age = 0;
  swing = 0;
  skyLight = 15;
  blockLight = 0;

  itemId = 0;
  itemCount = 0;
  offhandId = 0;
  blockId = 0;
  blockMeta = 0;
  fuse = 0;
  woolColor = 0xffffff;
  sheared = false;
  tamed = false;
  angry = false;
  sitting = false;
  collarColor = 0;
  variant = 0;
  customName: string;
  leashed = false;
  pLeashX = 0;
  pLeashY = 0;
  pLeashZ = 0;
  leashX = 0;
  leashY = 0;
  leashZ = 0;
  riding = false;
  saddled = false;
  baby = false;
  mobScale = 1;
  sneaking = false;
  hidden = false;

  private tx: number;
  private ty: number;
  private tz: number;
  private tyaw: number;
  private tpitch: number;

  constructor(s: RemotePlayerState) {
    this.id = s.id;
    this.customName = s.name;
    this.px = this.x = this.tx = s.x;
    this.py = this.y = this.ty = s.y;
    this.pz = this.z = this.tz = s.z;
    this.pYaw = this.yaw = this.pHeadYaw = this.headYaw = this.tyaw = s.yaw;
    this.pHeadPitch = this.headPitch = this.tpitch = s.pitch;
    this.sneaking = s.sneaking;
    this.swing = s.swing;
  }

  applyServerState(s: RemotePlayerState): void {
    this.customName = s.name;
    this.tx = s.x;
    this.ty = s.y;
    this.tz = s.z;
    this.tyaw = s.yaw;
    this.tpitch = s.pitch;
    this.sneaking = s.sneaking;
    this.swing = s.swing;
  }

  tick(world: World): void {
    this.age++;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.pYaw = this.yaw;
    this.pHeadYaw = this.headYaw;
    this.pHeadPitch = this.headPitch;
    this.pLimbSwing = this.limbSwing;
    this.pLimbAmount = this.limbAmount;

    const dx = this.tx - this.x;
    const dz = this.tz - this.z;
    const horiz = Math.hypot(dx, dz);
    this.x = this.tx;
    this.y = this.ty;
    this.z = this.tz;
    this.yaw = this.tyaw;
    this.headYaw = this.tyaw;
    this.headPitch = this.tpitch;

    const targetAmt = Math.min(1, horiz * 4);
    this.limbAmount += (targetAmt - this.limbAmount) * 0.4;
    this.limbSwing += horiz * 2.5;

    const bx = Math.floor(this.x);
    const by = Math.max(0, Math.min(CHUNK_HEIGHT - 1, Math.floor(this.y + 0.5)));
    const bz = Math.floor(this.z);
    if (world.isLoaded(bx, bz)) {
      this.skyLight = world.getSkyLight(bx, by, bz);
      this.blockLight = world.getBlockLight(bx, by, bz);
    }
  }
}

export interface RemoteGameOptions {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  atlas: Atlas;
  ui: UiApi;
  sfx: Sfx;
  settings: Settings;
  client: MultiplayerClient;
  welcome: WelcomePacket;
  onDisconnected: (reason: string) => void;
}

export class RemoteGame implements UiGame {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly chunks: ChunkManager;
  readonly chunkRenderer: ChunkRenderer;
  readonly sky: Sky;
  readonly entityRenderer: EntityRenderer;
  readonly hand: HandRenderer;
  readonly player: Player;
  readonly input: Input;
  readonly touchLook: TouchLookController;
  readonly ui: UiApi;
  readonly settings: Settings;
  readonly client: MultiplayerClient;
  readonly info: { name: string; seed: number };

  time: number;
  difficulty = 1;
  viewMode = 0;
  ready = false;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly sfx: Sfx;
  private readonly onDisconnected: (reason: string) => void;
  private readonly remotePlayers = new Map<number, RemotePlayerEntity>();
  private readonly camHit = newRayHit();
  private readonly fogColor = new THREE.Color();
  private readonly handState: HandState = {
    bobPhase: 0,
    bobAmount: 0,
    skyLight: 15,
    blockLight: 0,
    useProgress: 0,
    useKind: 'none',
    fishing: false,
    yawDelta: 0,
    pitchDelta: 0,
    iconTile: -1,
    map: null,
    pitch: 0,
  };

  private menu: Menu | null = null;
  private hudVisible = true;
  private touchSneaking = false;
  private touchForward = 0;
  private touchStrafe = 0;
  private touchJumpDown = false;
  private padForward = 0;
  private padStrafe = 0;
  private padJumpDown = false;
  private padSneakDown = false;
  private padSprintDown = false;
  private jumpTapped = false;
  private fovScale = 1;
  private lastYaw = 0;
  private lastPitch = 0;
  private lastSentX = NaN;
  private lastSentY = NaN;
  private lastSentZ = NaN;
  private lastSentYaw = NaN;
  private lastSentPitch = NaN;
  private lastSentSneak = false;
  private requestedChunks = new Set<number>();

  private raf = 0;
  private lastTime = 0;
  private acc = 0;
  private alpha = 1;
  private clock = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private triangles = 0;
  private disposed = false;

  constructor(o: RemoteGameOptions) {
    this.renderer = o.renderer;
    this.ui = o.ui;
    this.sfx = o.sfx;
    this.settings = o.settings;
    this.client = o.client;
    this.onDisconnected = o.onDisconnected;
    this.time = o.welcome.time;
    this.info = { name: `Multijoueur (${o.welcome.name})`, seed: o.welcome.seed };

    this.camera = new THREE.PerspectiveCamera(
      o.settings.fov,
      (o.canvas.clientWidth || 16) / (o.canvas.clientHeight || 9),
      0.05,
      1200,
    );
    this.camera.rotation.order = 'YXZ';

    const world = new World(o.welcome.seed, o.welcome.worldType, 3);
    this.world = world;

    this.chunkRenderer = new ChunkRenderer(this.scene, o.atlas.texture);
    const viewDistance = Math.min(o.settings.renderDistance, o.welcome.viewDistance);
    this.chunks = new ChunkManager(world, this.chunkRenderer, {
      seed: o.welcome.seed,
      worldType: o.welcome.worldType,
      genVersion: 3,
      dimension: 'overworld',
      storage: null,
      worldId: 'remote',
      savedKeys: new Set(),
      viewDistance,
      remoteMode: true,
    });

    const skyEnv: SkyEnvironment = {
      rainHeight: (x, z) => world.rainHeight(x, z),
      isSnowy: (x, z) => BIOMES[world.biomeAt(x, z)]?.snowy === true,
    };
    this.sky = new Sky(this.scene, skyEnv);
    this.entityRenderer = new EntityRenderer(this.scene, o.atlas);
    this.hand = new HandRenderer(o.atlas);

    const player = new Player(o.welcome.gameMode);
    player.teleport(o.welcome.x, o.welcome.y, o.welcome.z);
    player.yaw = player.pYaw = player.headYaw = player.pHeadYaw = o.welcome.yaw;
    player.headPitch = player.pHeadPitch = o.welcome.pitch;
    player.sfx = (name, volume, pitch) => this.sfx.play(name, { volume, pitch });
    this.player = player;

    this.input = new Input(o.canvas);
    this.input.blocked = () => this.ui.modal;
    this.input.active = () => this.ready && !this.disposed;
    this.input.touchActive = () => isTouchActive(this.settings);
    this.input.onWheel = (dir) => {
      if (!this.ready || this.ui.modal) return;
      this.player.inventory.selected = (this.player.inventory.selected + dir + 9) % 9;
    };
    this.input.onLockLost = () => {
      if (this.ready && !this.ui.modal && !isTouchActive(this.settings)) this.pauseGame();
    };
    this.touchLook = new TouchLookController({
      canvas: o.canvas,
      input: this.input,
      isTouchActive: () => isTouchActive(this.settings),
      hasTargetEntity: () => false,
    });

    this.client.setHandlers({
      onChunk: (cx, cz, blocks, meta, biomes, tints) => {
        this.chunks.receiveRemoteChunk(cx, cz, blocks, meta, biomes, tints);
      },
      onPlayers: (list) => {
        const seen = new Set<number>();
        for (const s of list) {
          if (s.id === o.welcome.id) continue;
          seen.add(s.id);
          const existing = this.remotePlayers.get(s.id);
          if (existing) existing.applyServerState(s);
          else this.remotePlayers.set(s.id, new RemotePlayerEntity(s));
        }
        for (const id of this.remotePlayers.keys()) {
          if (!seen.has(id)) this.remotePlayers.delete(id);
        }
      },
      onPlayerLeave: (id) => {
        this.remotePlayers.delete(id);
      },
      onChat: (text) => {
        this.ui.addMessage(text);
      },
      onTime: (t) => {
        this.time = t;
      },
      onGameMode: (mode) => {
        this.player.gameMode = mode;
        this.ui.actionBar(`Mode de jeu : ${mode}`);
      },
      onTeleport: (x, y, z) => {
        this.player.teleport(x, y, z);
      },
      onDisconnect: (reason) => {
        if (this.disposed) return;
        this.onDisconnected(reason);
      },
    });

    this.applySettings();
    window.addEventListener('keydown', this.onKey, true);
  }

  /** Liste des entités visibles (joueur local + autres joueurs connectés). */
  get entities(): EntityView[] {
    return [this.player, ...this.remotePlayers.values()];
  }

  start(): void {
    (window as unknown as { __game?: unknown }).__game = this;
    this.ui.showLoading('Connexion au serveur', 'Réception du monde…', 0);
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    this.client.close();
    this.input.dispose();
    this.touchLook.dispose();
    this.chunks.dispose();
    this.chunkRenderer.dispose();
    this.sky.dispose();
    this.entityRenderer.dispose();
    this.hand.dispose();
    const g = window as unknown as { __game?: unknown };
    if (g.__game === this) g.__game = undefined;
  }

  save(): Promise<void> {
    return Promise.resolve();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  applySettings(): void {
    const s = this.settings;
    this.chunks.viewDistance = Math.min(s.renderDistance, 8);
    this.chunks.fancy = s.fancyGraphics;
    this.chunks.smoothLighting = s.smoothLighting;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
  }

  setTouchMove(forward: number, strafe: number): void {
    this.touchForward = forward;
    this.touchStrafe = strafe;
  }

  setTouchJump(down: boolean): void {
    if (down && !this.touchJumpDown) this.jumpTapped = true;
    this.touchJumpDown = down;
  }

  applyGamepadState(state: {
    forward: number;
    strafe: number;
    lookDX: number;
    lookDY: number;
    jumpDown: boolean;
    jumpPressed: boolean;
    sneakDown: boolean;
    sprintDown: boolean;
    wheelDelta: number;
  }): void {
    if (!this.ready || this.disposed) return;
    this.padForward = state.forward;
    this.padStrafe = state.strafe;
    if (state.jumpPressed) this.jumpTapped = true;
    this.padJumpDown = state.jumpDown;
    this.padSneakDown = state.sneakDown;
    this.padSprintDown = state.sprintDown;
    if (state.lookDX !== 0 || state.lookDY !== 0) {
      this.player.turn(-state.lookDX, -state.lookDY * (this.settings.invertY ? -1 : 1));
    }
    if (state.wheelDelta !== 0) {
      const n = 9;
      this.player.inventory.selected = (this.player.inventory.selected + state.wheelDelta + n) % n;
    }
  }

  // ------------------------------------------------------------------ UiGame

  get inventory(): Inventory {
    return this.player.inventory;
  }
  get gameMode(): GameMode {
    return this.player.gameMode;
  }
  get hardcore(): boolean {
    return false;
  }
  get health(): number {
    return this.player.health;
  }
  get maxHealth(): number {
    return this.player.maxHealth;
  }
  get hunger(): number {
    return this.player.hunger;
  }
  get armor(): number {
    return 0;
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
  get headInWater(): boolean {
    const p = this.player;
    return pointInFluid(this.world, B.WATER, p.x, p.y + p.eyeHeight, p.z);
  }
  get headInLava(): boolean {
    const p = this.player;
    return pointInFluid(this.world, B.LAVA, p.x, p.y + p.eyeHeight, p.z);
  }
  get onFire(): boolean {
    return this.player.fireTicks > 0;
  }
  get heartTint(): '' | 'poison' | 'wither' {
    return '';
  }
  get activeEffects(): ReadonlyArray<{ type: string; level: number; ticks: number }> {
    return [];
  }
  get boss(): { name: string; progress: number } | null {
    return null;
  }
  get fade(): number {
    return 0;
  }
  get guideGoal(): string {
    return '';
  }
  get stats(): Readonly<Record<string, number>> {
    return this.player.stats;
  }
  get sneaking(): boolean {
    return this.player.sneaking;
  }

  dynamicTile(): number {
    return -1;
  }
  setSignText(): void {}
  setMobName(): void {}

  debugLines(): { left: string[]; right: string[] } {
    const p = this.player;
    const cx = Math.floor(p.x) >> 4;
    const cz = Math.floor(p.z) >> 4;
    const s = this.chunks.stats;
    return {
      left: [
        `SarihBricks 3D (Multijoueur)`,
        `${this.fps} fps | ${this.triangles} triangles`,
        `XYZ : ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
        `Chunk : ${cx} ${cz} (chargés ${s.loaded}, maillés ${s.meshed})`,
        `Joueurs visibles : ${this.remotePlayers.size + 1}`,
      ],
      right: [`Mode : ${this.player.gameMode}`, `Temps : ${this.time}`, `Graine : ${this.info.seed}`],
    };
  }

  closeMenu(): void {
    this.menu?.close();
    this.menu = null;
    this.ui.closeScreen();
    if (!isTouchActive(this.settings)) this.input.lock();
  }

  resume(): void {
    this.ui.closeScreen();
    if (!isTouchActive(this.settings)) this.input.lock();
  }

  respawn(): void {}
  spectate(): void {}

  chat(text: string): void {
    const s = text.trim();
    if (s) this.client.sendChat(s);
  }

  complete(text: string): string[] {
    if (!text.startsWith('/')) return [];
    const prefix = text.slice(1).toLowerCase();
    if (prefix.includes(' ')) return [];
    return COMMANDS.filter((c) => c.startsWith(prefix)).map((c) => '/' + c);
  }

  openInventory(): void {
    if (!this.ready || this.ui.modal) return;
    this.input.unlock();
    const menu = this.player.creative ? new CreativeMenu(this.player.inventory) : new InventoryMenu(this.player.inventory);
    this.menu = menu;
    this.ui.openMenu(menu);
  }

  pauseGame(): void {
    if (!this.ready || this.ui.modal) return;
    this.input.unlock();
    this.ui.openPause();
  }

  cycleViewMode(): void {
    this.viewMode = (this.viewMode + 1) % 3;
  }

  tapJump(): void {
    this.jumpTapped = true;
  }

  toggleSneak(): void {
    this.touchSneaking = !this.touchSneaking;
  }

  // ------------------------------------------------------------------ boucle

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.clock += dt;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    const p = this.player;
    this.chunks.update(p.x, p.z);
    this.requestMissingChunks();

    if (!this.ready) {
      const prog = this.chunks.progress(p.x, p.z, READY_RADIUS);
      this.ui.showLoading('Connexion au serveur', 'Construction du terrain…', prog);
      if (this.chunks.isReady(p.x, p.z, READY_RADIUS)) {
        this.ready = true;
        this.ui.showGame();
        this.acc = 0;
      } else {
        this.ui.update(dt);
        return;
      }
    }

    // Rotation caméra
    if (!this.ui.modal && p.alive) {
      const s = MOUSE_SPEED * this.settings.sensitivity;
      p.turn(-this.input.mouseDX * s, -this.input.mouseDY * s * (this.settings.invertY ? -1 : 1));
    }
    this.input.mouseDX = 0;
    this.input.mouseDY = 0;

    // En multijoueur le monde ne s'arrête pas quand on ouvre un menu : les ticks continuent toujours
    this.acc += dt;
    const step = 1 / TICKS_PER_SECOND;
    let ran = 0;
    while (this.acc >= step && ran < MAX_TICKS_PER_FRAME) {
      this.tick();
      this.acc -= step;
      ran++;
    }
    if (ran === MAX_TICKS_PER_FRAME) this.acc = 0;
    this.alpha = this.acc / step;

    this.render(dt);
    this.ui.update(dt);
  };

  private requestMissingChunks(): void {
    const pcx = Math.floor(this.player.x) >> 4;
    const pcz = Math.floor(this.player.z) >> 4;
    const r = this.chunks.viewDistance + 1;
    const missing: Array<[number, number]> = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (!this.world.chunks.has(key) && !this.requestedChunks.has(key)) {
          this.requestedChunks.add(key);
          missing.push([cx, cz]);
        }
      }
    }
    if (missing.length > 0) this.client.sendNeedChunks(missing);
  }

  private tick(): void {
    const p = this.player;
    this.time = (this.time + 1) % DAY_TICKS;

    const modal = this.ui.modal;
    const inp = p.input;
    if (modal) {
      inp.forward = 0;
      inp.strafe = 0;
      inp.jump = false;
      inp.sneak = false;
      inp.sprint = false;
      this.jumpTapped = false;
    } else {
      const k = this.input;
      const kb = this.settings.keybinds;
      let fwd = (k.isDown(kb.forward) ? 1 : 0) - (k.isDown(kb.backward) ? 1 : 0);
      let str = (k.isDown(kb.right) ? 1 : 0) - (k.isDown(kb.left) ? 1 : 0);
      if (Math.abs(this.touchForward) > Math.abs(fwd)) fwd = this.touchForward;
      if (Math.abs(this.touchStrafe) > Math.abs(str)) str = this.touchStrafe;
      if (Math.abs(this.padForward) > Math.abs(fwd)) fwd = this.padForward;
      if (Math.abs(this.padStrafe) > Math.abs(str)) str = this.padStrafe;
      inp.forward = fwd;
      inp.strafe = str;
      inp.jump = k.isDown(kb.jump) || this.touchJumpDown || this.padJumpDown || this.jumpTapped;
      inp.sneak = k.isDown(kb.sneak) || this.touchSneaking || this.padSneakDown;
      inp.sprint = k.isDown(kb.sprint) || this.padSprintDown;
      this.jumpTapped = false;
    }

    const dummyApi: GameApi = {
      world: this.world,
      player: p,
      entities: [],
      rng: Math.random,
      dayTime: this.time,
      difficulty: this.difficulty,
      dimension: 'overworld',
      spawn: () => {},
      sound: (name, _x, _y, _z, volume, pitch) => {
        this.sfx.play(name, { volume, pitch });
      },
      blockSound: () => {},
      particles: () => {},
      blockParticles: () => {},
      itemParticles: () => {},
      dropItem: () => p,
      explode: () => {},
      entitiesInBox: () => [],
      message: (text) => this.ui.addMessage(text),
    };

    const cx = Math.floor(p.x) >> 4;
    const cz = Math.floor(p.z) >> 4;
    if (this.world.chunks.has(chunkKey(cx, cz))) {
      p.tick(dummyApi);
    }

    for (const rp of this.remotePlayers.values()) {
      rp.tick(this.world);
    }

    // Envoyer l'état au serveur si modifié
    if (
      p.x !== this.lastSentX ||
      p.y !== this.lastSentY ||
      p.z !== this.lastSentZ ||
      p.yaw !== this.lastSentYaw ||
      p.headPitch !== this.lastSentPitch ||
      p.sneaking !== this.lastSentSneak
    ) {
      this.lastSentX = p.x;
      this.lastSentY = p.y;
      this.lastSentZ = p.z;
      this.lastSentYaw = p.yaw;
      this.lastSentPitch = p.headPitch;
      this.lastSentSneak = p.sneaking;
      this.client.sendMove(p.x, p.y, p.z, p.yaw, p.headPitch, p.sneaking, p.onGround, p.swing);
    }
  }

  private render(dt: number): void {
    const p = this.player;
    const w = this.world;
    const alpha = this.alpha;
    const cam = this.camera;
    const settings = this.settings;

    const ex = lerp(p.px, p.x, alpha);
    const ey = lerp(p.py, p.y, alpha) + lerp(p.pEyeHeight, p.eyeHeight, alpha);
    const ez = lerp(p.pz, p.z, alpha);
    const yaw = p.yaw;
    const pitch = p.headPitch;
    const first = this.viewMode === 0;
    p.hidden = first;

    cam.position.set(ex, ey, ez);
    const walk = lerp(p.pWalk, p.walk, alpha);
    const bob = lerp(p.pBob, p.bob, alpha);
    const phase = walk * Math.PI;
    if (first) {
      let roll = 0;
      let tilt = 0;
      if (settings.viewBobbing && p.alive) {
        const amount = bob * 0.1;
        cam.rotation.set(pitch, yaw, 0);
        cam.translateX(Math.sin(phase) * amount * 0.5);
        cam.translateY(-Math.abs(Math.cos(phase) * amount));
        roll += Math.sin(phase) * amount * 3 * DEG;
        tilt = Math.abs(Math.cos(phase - 0.2) * amount) * 5 * DEG;
      }
      cam.rotation.set(pitch - tilt, yaw, roll);
    } else {
      const back = this.viewMode === 1 ? 1 : -1;
      const cp = Math.cos(pitch);
      const dx = Math.sin(yaw) * cp * back;
      const dy = -Math.sin(pitch) * back;
      const dz = Math.cos(yaw) * cp * back;
      let dist = THIRD_PERSON_DISTANCE;
      if (raycast(w, ex, ey, ez, dx, dy, dz, THIRD_PERSON_DISTANCE + 0.3, this.camHit, true)) {
        dist = Math.max(0.2, Math.min(dist, this.camHit.dist - 0.3));
      }
      cam.position.set(ex + dx * dist, ey + dy * dist, ez + dz * dist);
      if (back === 1) cam.rotation.set(pitch, yaw, 0);
      else cam.rotation.set(-pitch, yaw + Math.PI, 0);
    }

    let scale = 1;
    if (p.sprinting) scale *= 1.15;
    if (p.flying) scale *= 1.1;
    this.fovScale += (scale - this.fovScale) * Math.min(1, dt * 10);
    const fov = Math.max(20, Math.min(140, settings.fov * this.fovScale));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    const viewBlocks = this.chunks.viewDistance * 16;
    this.sky.update(dt, cam, this.time + alpha, 0, 0, viewBlocks, 'overworld');
    const u = worldUniforms;
    u.uSkyLight.value.copy(this.sky.skyLight);
    u.uAmbient.value = OVERWORLD_AMBIENT;
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

    this.entityRenderer.sync(this.entities, alpha, this.clock);

    const hs = this.handState;
    this.hand.setItem(p.heldItemId);
    this.hand.setOffhand(p.offhandItemId);
    hs.bobPhase = phase;
    hs.bobAmount = settings.viewBobbing ? bob : 0;
    hs.skyLight = p.skyLight;
    hs.blockLight = p.blockLight;
    hs.yawDelta = yaw - this.lastYaw;
    hs.pitchDelta = pitch - this.lastPitch;
    hs.pitch = pitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.hand.update(dt, hs);

    const r = this.renderer;
    r.setClearColor(submerged ? this.fogColor : this.sky.skyColor, 1);
    r.clear();
    r.render(this.scene, cam);
    this.triangles = r.info.render.triangles;
    if (first && this.hudVisible && p.alive && !p.spectator) this.hand.render(r);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.ready || this.ui.modal) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.pauseGame();
      return;
    }
    if (e.code === 'KeyE' && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      this.openInventory();
      return;
    }
    if ((e.code === 'KeyT' || e.code === 'Slash') && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      this.input.unlock();
      this.ui.openChat(e.code === 'Slash' ? '/' : '');
      return;
    }
    if (e.code === 'F1' && !e.repeat) {
      e.preventDefault();
      this.hudVisible = !this.hudVisible;
      this.ui.setHudVisible(this.hudVisible);
      return;
    }
    if (e.code === 'F3' && !e.repeat) {
      e.preventDefault();
      this.ui.toggleDebug();
      return;
    }
    if (e.code === 'F5' && !e.repeat) {
      e.preventDefault();
      this.cycleViewMode();
      return;
    }
    if (e.code === 'Space' && !e.repeat) {
      this.jumpTapped = true;
    }
    if (e.code.startsWith('Digit') && !e.repeat) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) this.player.inventory.selected = n - 1;
    }
  };
}
