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
import { EFFECT_TYPES, Living, type DamageCause, type Entity, type GameApi } from '../entity/Entity';
import { findBedStandSpot, formatDeathMessage } from './SurvivalHelpers';
import type { MobKind } from '../entity/MobModels';
import { IronGolem } from '../entity/Creatures';
import { EndCrystal } from '../entity/EndMobs';
import { HOSTILE_KINDS, Mob, Monster, NAME_MAX, NPC_KINDS, PASSIVE_KINDS, Villager, createMob, hatchEgg } from '../entity/Mobs';
import { isProfession, type Offer } from '../entity/Trades';
import { Arrow, FallingBlock, ItemEntity, Thrown, ThrownPearl, ThrownPotion, Tnt } from '../entity/Objects';
import { isBoxFree, pointInFluid } from '../entity/Physics';
import { createEntity } from '../entity/Registry';
import { tickSpawners } from '../entity/BlockSpawner';
import { Spawner } from '../entity/Spawner';
import { Input } from '../player/Input';
import { Player, type UseKind } from '../player/Player';
import { TouchLookController, isTouchActive } from '../player/Touch';
import type { Atlas } from '../render/Atlas';
import { END_AMBIENT, NETHER_AMBIENT, OVERWORLD_AMBIENT, worldUniforms } from '../render/ChunkMaterials';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { EntityRenderer } from '../render/EntityRenderer';
import { HandRenderer, type HandState, type HeldMap } from '../render/HandRenderer';
import { Particles, type ParticleKind, type ParticleWorld } from '../render/Particles';
import { Selection } from '../render/Selection';
import { SignRenderer } from '../render/SignRenderer';
import { Sky, type SkyEnvironment } from '../render/Sky';
import type { TradeView, UiApi, UiGame, VoiceStatusView } from '../ui/UiApi';
import { VoiceVideoManager } from '../net/VoiceVideo';
import { BLOCKS, BLOCK_REPLACEABLE, BLOCK_SHAPE, BLOCK_SOLID, FACING_DX, FACING_DZ, PISTON_DX, PISTON_DY, PISTON_DZ, SHAPE, isLeaves, isLog } from '../world/Blocks';
import { blockDrops } from '../world/Drops';
import type { Chunk } from '../world/Chunk';
import { ChunkManager, type ChunkHooks } from '../world/ChunkManager';
import { CHUNK_HEIGHT, DAY_TICKS, TICKS_PER_SECOND, chunkKey, skyDayFactor, type Dimension, type GameMode } from '../world/Constants';
import { GAME_RULE_NAMES, loadGameRules, resolveGameRule, saveGameRules } from '../world/GameRules';
import { B, I, MUSIC_DISCS, musicDiscInfo } from '../world/Ids';
import { ITEMS, getItem, itemLabel } from '../world/Items';
import { cloneStack, cloneStackWithCount, loadSlots, makeStack, maxDamage, saveSlots, type ItemStack } from '../world/ItemStack';
import { applyBonemeal, fireCanStay } from '../world/Behavior';
import { updateRedstoneAround } from '../world/Redstone';
import { POTION_COMPLETIONS, POTION_GIVE_HELP, potionLabel, resolvePotionKind } from '../world/Potions';
import { dialTile } from '../world/Tiles';
import { buildEndPlatform } from '../world/EndPortal';
import { findOrCreatePortal } from '../world/Portal';
import { newRayHit, raycast } from '../world/Raycast';
import { dimensionStorageId, formatKeyCode, readDimension } from '../world/Storage';
import type { Settings, Storage, WorldInfo } from '../world/Storage';
import { World, posKey, posKeyX, posKeyY, posKeyZ, type BlockEntity, type WorldEffect, type WorldHost } from '../world/World';
import { BIOMES } from '../world/gen/Biomes';
import { EndGen } from '../world/gen/EndGen';
import { END_PLATFORM } from '../world/gen/EndLayout';
import { NetherGen } from '../world/gen/NetherGen';
import { Stronghold } from '../world/gen/Stronghold';
import type { GenSpawn } from '../world/gen/GenCanvas';
import { hash2, mulberry32 } from '../world/gen/Noise';
import { locateStructure, structuresNear, type Structure, type StructureKind, type TerrainInfo } from '../world/gen/Structures';
import { WorldGen } from '../world/gen/WorldGen';
import {
  blockEntityItems,
  cleanSignLines,
  getDispenser,
  getSign,
  insertOneIntoContainer,
  resolveLoot,
  tickBlockEntities,
  type BrewingStandEntity,
  type ChestEntity,
  type DispenserEntity,
  type FurnaceEntity,
  type HopperEntity,
} from './BlockEntities';
import { ADVANCEMENTS, advancementText, isAdvancementAvailable } from './Advancements';
import { Dial, bearing, clockTarget, dialNoise } from './Dials';
import { EndFight } from './EndFight';
import { explode as runExplosion } from './Explosion';
import { MapStore, type MapData } from './Maps';
import { STAT, type Stats } from './Stats';
import { Interaction, particleTile, particleTint, type InteractionHost } from './Interaction';
import {
  BrewingMenu,
  ChestMenu,
  CreativeMenu,
  DispenserMenu,
  FurnaceMenu,
  HOTBAR_SIZE,
  HopperMenu,
  InventoryMenu,
  type Inventory,
  type Menu,
} from './Inventory';
import type { MultiplayerClient, WelcomePacket } from '../net/Client';
import { MultiplayerClient as NetClient } from '../net/Client';
import type { ContainerKind, SerializedSlot, TradeOfferInfo } from '../net/Protocol';
import { RemoteEntity } from '../net/RemoteEntity';
import { RemotePlayerEntity } from '../net/RemotePlayer';
import { loadLastPseudo, loadRecentServers, saveRecentServer } from '../net/RecentServers';
import { exportWorld, replaceWorldFromArchive } from '../world/WorldFile';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  atlas: Atlas;
  ui: UiApi;
  sfx: Sfx;
  settings: Settings;
  storage: Storage | null;
  info: WorldInfo;
  /** Clés des chunks déjà sauvegardés de ce monde. */
  savedKeys: Set<number>;
  /** Session réseau (présente uniquement en multijoueur). */
  net?: MultiplayerClient;
  welcome?: WelcomePacket;
  onDisconnected?: (reason: string) => void;
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
/** Bout de la canne à pêche tenue en main, vu par la caméra de la main (à une distance de 1 devant l'œil). */
const ROD_TIP_X = 1.19;
const ROD_TIP_Y = 0.12;

const DIFFICULTY_LABELS = ['Paisible', 'Facile', 'Normale', 'Difficile'];
const DIFFICULTY_NAMES = ['peaceful', 'easy', 'normal', 'hard'];
const TIME_NAMES: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };
const COMMANDS = ['help', 'gamemode', 'time', 'weather', 'give', 'tp', 'kill', 'seed', 'difficulty', 'summon', 'clear', 'spawnpoint', 'locate', 'gamerule', 'setblock', 'fill'];
const FILL_MODES = ['replace', 'hollow', 'outline', 'destroy', 'keep'] as const;
const FILL_MAX_BLOCKS = 32768;

/** Lieux reconnus par /locate (noms français et anglais). */
const LOCATE_NAMES: Record<string, { kind: StructureKind; label: string }> = {
  village: { kind: 'village', label: 'Village' },
  temple: { kind: 'desert_temple', label: 'Temple du désert' },
  pyramide: { kind: 'desert_temple', label: 'Temple du désert' },
  desert: { kind: 'desert_temple', label: 'Temple du désert' },
  desert_temple: { kind: 'desert_temple', label: 'Temple du désert' },
  jungle: { kind: 'jungle_temple', label: 'Temple de la jungle' },
  jungle_temple: { kind: 'jungle_temple', label: 'Temple de la jungle' },
  mine: { kind: 'mineshaft', label: 'Mine abandonnée' },
  mineshaft: { kind: 'mineshaft', label: 'Mine abandonnée' },
  forteresse: { kind: 'fortress', label: 'Forteresse du Nether' },
  fortress: { kind: 'fortress', label: 'Forteresse du Nether' },
  fort: { kind: 'stronghold', label: 'Fort' },
  stronghold: { kind: 'stronghold', label: 'Fort' },
};

/** Dimension où se trouve chaque type de lieu, et version du générateur qui l'a introduit. */
function structureHome(kind: StructureKind): Dimension {
  return kind === 'fortress' ? 'nether' : 'overworld';
}
function structureSince(kind: StructureKind): number {
  return kind === 'stronghold' ? 3 : 2;
}
const MOB_LABELS: Record<string, string> = {
  zombie: 'un zombie',
  skeleton: 'un squelette',
  spider: 'une araignée',
  creeper: 'un creeper',
  zombie_pigman: 'un cochon-zombie',
  ghast: 'un ghast',
  magma_cube: 'un cube de magma',
  blaze: 'un blaze',
  wither_skeleton: 'un squelette wither',
  slime: 'un slime',
  enderman: 'un enderman',
  witch: 'une sorcière',
  silverfish: "un poisson d'argent",
  ender_dragon: "le dragon de l'Ender",
  iron_golem: 'un golem de fer',
  wolf: 'un loup',
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeCmdName(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
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
    case 'wither':
      return 'Vous avez été flétri';
    case 'magic':
      return by ? `Vous avez été tué par la magie d'${killer}` : 'Vous avez été tué par magie';
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
  private readonly signRenderer: SignRenderer;
  readonly hand: HandRenderer;
  readonly player: Player;
  readonly entities: Entity[] = [];
  readonly interaction: Interaction;
  readonly spawner = new Spawner();
  readonly input: Input;
  private readonly touchLook: TouchLookController;
  readonly ui: UiApi;
  readonly rng: () => number;
  readonly info: WorldInfo;

  private level = 2;
  /** Dimension courante ('overworld', 'nether' ou 'end'). */
  dimension: Dimension = 'overworld';
  /** Combat du dragon de l'Ender (état gardé d'une séance à l'autre). */
  readonly endFight = new EndFight();
  private portalTicks = 0;
  private portalCooldown = 0;
  private dimensionSwitching = false;
  /** Cartes du monde (numéro → pixels), sauvegardées avec l'état. */
  readonly maps = new MapStore();
  private readonly compassDial = new Dial();
  private readonly clockDial = new Dial();
  /** Hasard purement visuel (cadrans affolés dans le Nether), distinct de celui du jeu. */
  private readonly dialRng = dialNoise(0x5eed);
  private readonly heldMapState: HeldMap = { id: 0, colors: new Uint8Array(0), version: 0, markerX: 0, markerZ: 0, dirX: 0, dirZ: -1 };
  /** Âge du monde en ticks (l'heure du jour en découle sauf si doDaylightCycle vaut false). */
  time = 1000;
  /** Heure du jour figée (0..23999) quand doDaylightCycle vaut false, sinon -1. */
  private frozenDayTime = -1;
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

  /** Dernière note jouée par un bloc musical (utilisé aussi par les contrôles). */
  lastNote: { x: number; y: number; z: number; instrument: string; note: number; pitch: number; count: number } | null = null;
  private noteCount = 0;
  /** Jukebox en cours de lecture (coordonnées, disque et titre), ou null. */
  playingJukebox: { x: number; y: number; z: number; disc: number; key: string; title: string } | null = null;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly atlas: Atlas;
  private readonly sfx: Sfx;
  readonly settings: Settings;
  private readonly storage: Storage | null;
  net: MultiplayerClient | null = null;
  private remoteId = 0;
  private readonly remotePlayers = new Map<number, RemotePlayerEntity>();
  private readonly remoteEntities = new Map<number, RemoteEntity>();
  private remoteContainer: {
    x: number;
    y: number;
    z: number;
    kind: ContainerKind;
    be: ChestEntity | FurnaceEntity | BrewingStandEntity | HopperEntity | DispenserEntity;
    menu: Menu;
  } | null = null;
  private remoteTrade: { entityId: number; offers: TradeOfferInfo[] } | null = null;
  private readonly requestedChunks = new Set<number>();
  private lastSentX = Number.NaN;
  private lastSentY = Number.NaN;
  private lastSentZ = Number.NaN;
  private lastSentYaw = Number.NaN;
  private lastSentPitch = Number.NaN;
  private lastSentSneak = false;
  private lastSentSwing = 0;
  private lastSentSlot = -1;
  private lastSentUseKind: UseKind = 'none';
  private onDisconnected: ((reason: string) => void) | null = null;
  isHost = false;
  inviteCode: string | null = null;
  inviteUrl: string | null = null;
  tailscaleCode: string | null = null;
  tailscaleUrl: string | null = null;
  private hostToken: string | null = null;
  private hostServerUrl: string | null = null;
  private voice: VoiceVideoManager | null = null;
  private touchPttDown = false;
  private padPttDown = false;
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
    fishing: false,
    yawDelta: 0,
    pitchDelta: 0,
    iconTile: -1,
    map: null,
    pitch: 0,
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
  /** Accroupissement basculé par le bouton tactile. */
  private touchSneaking = false;
  private touchForward = 0;
  private touchStrafe = 0;
  private touchJumpDown = false;
  private padForward = 0;
  private padStrafe = 0;
  private padJumpDown = false;
  private padSneakDown = false;
  private padSprintDown = false;
  private padAttackDown = false;
  private padUseDown = false;
  private prevPadAttack = false;
  private prevPadUse = false;
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
  private blockNames: Map<string, { id: number; meta: number }> | null = null;
  private readonly pressedPlates = new Map<number, number>();
  /** Générateur gardé pour situer les lieux (/locate) : créé à la première demande. */
  private terrain: TerrainInfo | null = null;
  private terrainDimension: Dimension | null = null;

  constructor(o: GameOptions) {
    this.renderer = o.renderer;
    this.atlas = o.atlas;
    this.ui = o.ui;
    this.sfx = o.sfx;
    this.settings = o.settings;
    this.storage = o.storage;
    this.info = o.info;
    this.net = o.net ?? null;
    this.onDisconnected = o.onDisconnected ?? null;
    const info = o.info;
    const canvas = o.canvas;

    this.camera = new THREE.PerspectiveCamera(o.settings.fov, (canvas.clientWidth || 16) / (canvas.clientHeight || 9), 0.05, 1200);
    this.camera.rotation.order = 'YXZ';

    const genVersion = info.genVersion ?? 1;
    const world = new World(info.seed, info.worldType, genVersion);
    this.world = world;
    this.rng = world.rng;
    world.host = this.createWorldHost();

    const st0 = info.state as Record<string, unknown> | null;
    this.dimension = readDimension(st0?.dimension);

    this.chunkRenderer = new ChunkRenderer(this.scene, o.atlas.texture);
    this.chunks = new ChunkManager(world, this.chunkRenderer, {
      seed: info.seed,
      worldType: info.worldType,
      genVersion,
      dimension: this.dimension,
      storage: o.storage,
      worldId: info.id,
      savedKeys: o.savedKeys,
      viewDistance: o.welcome ? Math.min(o.settings.renderDistance, o.welcome.viewDistance) : o.settings.renderDistance,
      remoteMode: Boolean(o.net),
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
    this.signRenderer = new SignRenderer(this.scene, o.atlas);
    this.hand = new HandRenderer(o.atlas);

    // --- joueur ---
    const player = new Player(info.gameMode);
    this.player = player;
    this.entities.push(player);
    player.sfx = (name, volume, pitch) => this.sfx.play(name, { volume, pitch });
    player.inventory.drop = (stack) => {
      const e = new ItemEntity(cloneStack(stack)!);
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
      this.spawnPoint = new WorldGen(info.seed, info.worldType, genVersion).findSpawn();
    }
    const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    if (st) {
      this.time = Math.max(0, Math.floor(num(st.time, 1000)));
      loadGameRules(this.world.rules, st.gameRules);
      this.frozenDayTime =
        !this.world.rules.doDaylightCycle && typeof st.frozenDayTime === 'number' && Number.isFinite(st.frozenDayTime)
          ? ((Math.floor(st.frozenDayTime) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS
          : !this.world.rules.doDaylightCycle
            ? this.time % DAY_TICKS
            : -1;
      this.raining = st.raining === true;
      this.thundering = st.thundering === true && this.raining;
      this.rainLevel = this.raining ? 1 : 0;
      this.thunderLevel = this.thundering ? 1 : 0;
      this.weatherTimer = Math.max(0, Math.floor(num(st.weatherTimer, 0)));
      this.level = Math.max(0, Math.min(3, Math.floor(num(st.difficulty, 2))));
      this.maps.load(st.maps);
      this.endFight.load(st.end);
      if (Array.isArray(st.pressedPlates)) {
        for (const pk of st.pressedPlates) {
          if (typeof pk === 'number' && Number.isFinite(pk)) this.pressedPlates.set(pk, this.world.age + 10);
        }
      }
    }
    if (this.hardcore) this.level = 3;
    if (this.weatherTimer <= 0) this.weatherTimer = 12000 + Math.floor(Math.random() * 168000);
    const savedPlayer = st?.player;
    if (o.welcome && o.net) {
      this.remoteId = o.welcome.id;
      this.isHost = o.welcome.isHost;
      this.inviteCode = o.welcome.inviteCode ?? null;
      this.inviteUrl = o.welcome.inviteUrl ?? null;
      this.tailscaleCode = o.welcome.tailscaleCode ?? null;
      this.tailscaleUrl = o.welcome.tailscaleUrl ?? null;
      this.time = o.welcome.time;
      this.raining = o.welcome.raining;
      this.thundering = o.welcome.thundering;
      this.rainLevel = this.raining ? 1 : 0;
      this.thunderLevel = this.thundering ? 1 : 0;
      this.spawnPoint = o.welcome.spawn;
      player.teleport(o.welcome.x, o.welcome.y, o.welcome.z);
      player.yaw = player.pYaw = player.headYaw = player.pHeadYaw = o.welcome.yaw;
      player.headPitch = player.pHeadPitch = o.welcome.pitch;
      player.remoteClient = true;
      if (o.welcome.health !== undefined) player.health = o.welcome.health;
      if (o.welcome.hunger !== undefined) player.hunger = o.welcome.hunger;
      if (o.welcome.saturation !== undefined) player.saturation = o.welcome.saturation;
      if (o.welcome.air !== undefined) player.air = o.welcome.air;
      if (o.welcome.fireTicks !== undefined) player.fireTicks = o.welcome.fireTicks;
      if (o.welcome.xpLevel !== undefined) player.xpLevel = o.welcome.xpLevel;
      if (o.welcome.xpProgress !== undefined) player.xpProgress = o.welcome.xpProgress;
      if (o.welcome.effects) {
        player.clearEffects();
        for (const fx of o.welcome.effects) {
          if (EFFECT_TYPES.includes(fx.type)) player.addEffect(fx.type, fx.ticks, fx.level);
        }
      }
      if (o.welcome.inventory) {
        this.applyRemoteInventory(
          o.welcome.inventory.slots,
          o.welcome.inventory.selected,
          undefined,
          o.welcome.inventory.armor,
          o.welcome.inventory.offhand,
        );
      }
      this.needSettle = false;
      this.freshSpawn = false;
      this.attachNetHandlers(o.net);
    } else if (savedPlayer && typeof savedPlayer === 'object') {
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
    this.input.touchActive = () => isTouchActive(this.settings);
    this.input.onKey = (code, repeat, key) => this.onKey(code, repeat, key);
    this.input.onWheel = (direction) => {
      if (this.ui.modal || !player.alive) return;
      const inv = player.inventory;
      inv.selected = (inv.selected + direction + HOTBAR_SIZE) % HOTBAR_SIZE;
    };
    this.input.onLockLost = () => {
      if (this.ready && !this.ui.modal && !isTouchActive(this.settings)) this.pause();
    };

    this.interaction = new Interaction(this);
    this.touchLook = new TouchLookController({
      canvas,
      input: this.input,
      isTouchActive: () => isTouchActive(this.settings),
      hasTargetEntity: () => {
        const p = this.player;
        this.interaction.aimNow(p.x, p.y + p.eyeHeight, p.z);
        return this.interaction.entity !== null;
      },
    });
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
    if (this.chunks.fancy !== s.fancyGraphics || this.chunks.smoothLighting !== s.smoothLighting) {
      this.chunks.fancy = s.fancyGraphics;
      this.chunks.smoothLighting = s.smoothLighting;
      this.chunks.remeshAll();
    }
    this.sky.setCloudsVisible(s.clouds);
    this.sfx.volume = s.soundVolume;
    this.sfx.musicVolume = s.musicVolume;
    this.voice?.applySettings();
    this.ui.update(0);
  }

  get isRemote(): boolean {
    return this.net !== null;
  }

  /** Sauvegarde le monde (état global, joueur, chunks modifiés). Les appels simultanés partagent la même écriture. */
  async save(): Promise<void> {
    if (this.isHost) {
      await this.closeToFriends().catch(() => undefined);
    }
    if (this.isRemote) return;
    if (this.saving) return this.saving;
    const run = this.writeSave().finally(() => {
      this.saving = null;
    });
    this.saving = run;
    return run;
  }

  private async writeSave(): Promise<void> {
    if (!this.storage) return;
    const info = this.info;
    info.state = {
      player: this.player.saveState(),
      time: this.time,
      ...(this.frozenDayTime >= 0 ? { frozenDayTime: this.frozenDayTime } : {}),
      gameRules: saveGameRules(this.world.rules),
      raining: this.raining,
      thundering: this.thundering,
      weatherTimer: this.weatherTimer,
      difficulty: this.difficulty,
      spawn: [this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z],
      dimension: this.dimension,
      pressedPlates: Array.from(this.pressedPlates.keys()),
      maps: this.maps.save(),
      end: this.endFight.save(),
    };
    info.gameMode = this.player.gameMode;
    info.lastPlayed = Date.now();
    const thumbnail = this.ready && !this.disposed ? this.thumbnail() : '';
    if (thumbnail) info.thumbnail = thumbnail;
    this.autosave = 0;
    await this.storage.putWorld(info);
    this.keepPersistentEntities();
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
    this.voice?.dispose();
    this.voice = null;
    this.net?.close();
    this.input.unlock();
    this.touchLook.dispose();
    this.input.dispose();
    this.chunks.dispose();
    this.chunkRenderer.dispose();
    this.selection.dispose();
    this.fx.dispose();
    this.sky.dispose();
    this.entityRenderer.dispose();
    this.signRenderer.dispose();
    this.hand.dispose();
    this.playingJukebox = null;
    this.sfx.stopDisc();
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
    if (this.dimensionSwitching) return;
    const p = this.player;
    this.chunks.update(p.x, p.z);
    if (this.isRemote) this.requestMissingChunks();

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    if (!this.ready) {
      const radius = Math.min(this.chunks.viewDistance, this.isRemote ? 2 : READY_RADIUS);
      if (!this.chunks.isReady(p.x, p.z, radius)) {
        this.ui.showLoading(
          this.isRemote ? 'Connexion au serveur' : 'Chargement du monde',
          this.isRemote ? 'Construction du terrain…' : 'Génération du terrain…',
          this.chunks.progress(p.x, p.z, radius),
        );
        this.ui.update(dt);
        return;
      }
      this.enterWorld();
    }

    const paused = !this.isRemote && this.ui.pausing;
    const loaded = this.isRemote || this.areaLoaded();
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

    if (!this.isRemote && !paused && loaded && !this.deathShown) {
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
    if (p.spectator) return;
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
    this.syncPushToTalk();

    // --- commandes du joueur ---
    const free = !this.ui.modal && p.alive && !p.sleeping;
    const pi = p.input;
    const kb = this.settings.keybinds;
    if (free) {
      const kbFwd = (input.isDown(kb.forward) || input.isDown('ArrowUp') ? 1 : 0) - (input.isDown(kb.backward) || input.isDown('ArrowDown') ? 1 : 0);
      const kbStr = (input.isDown(kb.right) || input.isDown('ArrowRight') ? 1 : 0) - (input.isDown(kb.left) || input.isDown('ArrowLeft') ? 1 : 0);
      const aFwd = Math.abs(this.touchForward) >= Math.abs(this.padForward) ? this.touchForward : this.padForward;
      const aStr = Math.abs(this.touchStrafe) >= Math.abs(this.padStrafe) ? this.touchStrafe : this.padStrafe;
      pi.forward = Math.max(-1, Math.min(1, kbFwd !== 0 ? kbFwd : aFwd !== 0 ? aFwd : input.analogForward));
      pi.strafe = Math.max(-1, Math.min(1, kbStr !== 0 ? kbStr : aStr !== 0 ? aStr : input.analogStrafe));
      pi.jump = input.isDown(kb.jump) || this.jumpTapped || this.touchJumpDown || this.padJumpDown || input.virtualJump;
      if (p.flying && this.touchJumpDown && this.touchSneaking) this.touchSneaking = false;
      pi.sneak = input.isDown(kb.sneak) || input.isDown('ShiftRight') || this.touchSneaking || this.padSneakDown || input.virtualSneak;
      pi.sprint = input.isDown(kb.sprint) || this.padSprintDown || input.virtualSprint;
    } else {
      pi.forward = 0;
      pi.strafe = 0;
      pi.jump = false;
      pi.sneak = false;
      pi.sprint = false;
    }
    this.jumpTapped = false;
    this.interaction.tick();
    if (this.isRemote) {
      this.tickRemote();
      return;
    }

    // --- entités ---
    const list = this.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e !== p && !e.roaming && !w.isLoaded(Math.floor(e.x), Math.floor(e.z))) {
        // sortie du monde chargé : l'entité est abandonnée
        e.dead = true;
        continue;
      }
      e.tick(this);
      if (e instanceof Living && !e.dead) {
        const bx = Math.floor(e.x);
        const by = Math.floor(e.y + 0.05);
        const bz = Math.floor(e.z);
        const v = w.getBlockAndMeta(bx, by, bz);
        if ((v & 255) === B.STONE_PRESSURE_PLATE) {
          const pk = posKey(bx, by, bz);
          this.pressedPlates.set(pk, w.age + 10);
          if (((v >> 8) & 1) === 0) w.setMeta(bx, by, bz, 1, true);
        }
      }
    }
    if (this.pressedPlates.size > 0) {
      for (const [pk, until] of this.pressedPlates) {
        if (w.age >= until) {
          this.pressedPlates.delete(pk);
          const bx = posKeyX(pk);
          const by = posKeyY(pk);
          const bz = posKeyZ(pk);
          if (w.getBlock(bx, by, bz) === B.STONE_PRESSURE_PLATE && w.getMeta(bx, by, bz) !== 0) {
            w.setMeta(bx, by, bz, 0, true);
          }
        }
      }
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
    tickSpawners(this);
    if (this.world.rules.doMobSpawning) this.spawner.tick(this);
    this.atlas.tick();
    this.time++;
    p.addStat(STAT.PLAY_TIME);
    this.tickWeather();
    this.tickEnd();
    this.tickPortal();
    this.tickSleep();
    this.tickAdvancements();
    this.tickDials();
    this.tickHeldMap();

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
        const detail = this.advText(adv.detail);
        this.ui.showAdvancement(adv.title, detail, adv.icon);
        this.ui.addMessage(`[Progrès] ${adv.title} — ${detail}`);
      }
    }
    // Toute étape antérieure à la dernière étape atteinte est validée d'office sans notification
    for (let i = 0; i < highestUnlocked; i++) {
      p.advancements.add(ADVANCEMENTS[i].id);
    }
  }

  private tickWeather(): void {
    const w = this.world;
    if (this.dimension !== 'overworld') {
      // ni pluie ni jour dans le Nether et dans l'End : la lumière du ciel y vaut celle d'une nuit
      this.raining = false;
      this.thundering = false;
      this.rainLevel = 0;
      this.thunderLevel = 0;
      w.skyDarken = 11;
      w.raining = false;
      return;
    }
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
    const light = skyDayFactor(this.dayTime) * (1 - (this.rainLevel * 5) / 16) * (1 - (this.thunderLevel * 5) / 16);
    w.skyDarken = Math.round((1 - light) * 11);
    w.raining = this.rainLevel > 0.2;
  }

  private updateSkyDarken(): void {
    if (this.dimension !== 'overworld') {
      this.world.skyDarken = 11;
      return;
    }
    const light = skyDayFactor(this.dayTime) * (1 - (this.rainLevel * 5) / 16) * (1 - (this.thunderLevel * 5) / 16);
    this.world.skyDarken = Math.round((1 - light) * 11);
  }

  /** Boussole (vers le point d'apparition du monde) et horloge ; toutes deux s'affolent dans le Nether et dans l'End. */
  private tickDials(): void {
    const p = this.player;
    const nether = this.dimension !== 'overworld';
    const sp = this.spawnPoint;
    this.compassDial.update(nether ? this.dialRng() : bearing(p.x, p.z, p.yaw, sp.x + 0.5, sp.z + 0.5));
    this.clockDial.update(nether ? this.dialRng() : clockTarget(this.dayTime));
  }

  /** La carte tenue en main se dessine autour du joueur. */
  private tickHeldMap(): void {
    const map = this.heldMap();
    if (map) this.maps.update(this.world, map, this.player.x, this.player.z, this.dimension);
  }

  /** Carte remplie tenue en main (son numéro est dans le champ « usure » de la pile), ou null. */
  heldMap(): MapData | null {
    const s = this.player.inventory.held;
    return s && s.id === I.FILLED_MAP ? (this.maps.get(s.damage) ?? null) : null;
  }

  /** Tuile animée de l'objet (aiguille de la boussole, cadran de l'horloge), ou -1. */
  dynamicTile(itemId: number): number {
    if (itemId === I.COMPASS) return dialTile('compass', this.compassDial.frame);
    if (itemId === I.CLOCK) return dialTile('clock', this.clockDial.frame);
    return -1;
  }

  /** Clic droit avec une carte vierge : elle devient la carte de la zone où se tient le joueur. */
  createMap(): void {
    const p = this.player;
    const map = this.maps.create(p.x, p.z, this.dimension);
    const stack = makeStack(I.FILLED_MAP, 1, map.id);
    const inv = p.inventory;
    p.consumeHeld();
    if (!inv.held) inv.slots[inv.selected] = stack;
    else if (inv.add(stack) > 0) inv.drop(stack);
    // premier tracé immédiat de la zone visible
    for (let i = 0; i < 16; i++) this.maps.update(this.world, map, p.x, p.z, this.dimension);
  }

  /** Dans l'End : fait vivre le dragon, puis ouvre le portail de sortie à sa mort. */
  private tickEnd(): void {
    if (this.dimension !== 'end') return;
    if (this.endFight.tick(this)) {
      this.sfx.play('levelup', { volume: 0.8, pitch: 0.7 });
      this.ui.addMessage("Le dragon de l'Ender est vaincu ! Le portail de sortie s'est ouvert au centre de l'île.");
    }
  }

  private tickPortal(): void {
    if (this.dimensionSwitching) return;
    const p = this.player;
    const feet = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z));
    // portail de l'End : il emporte aussitôt, sans attente
    if (feet === B.END_PORTAL && p.alive) {
      if (this.dimension === 'end') void this.leaveEnd();
      else if (this.dimension === 'overworld') void this.enterEnd();
      return;
    }
    if (this.portalCooldown > 0) {
      this.portalCooldown--;
      this.portalTicks = 0;
      return;
    }
    if (feet !== B.NETHER_PORTAL || this.dimension === 'end') {
      this.portalTicks = 0;
      return;
    }
    this.portalTicks++;
    if (p.creative || this.portalTicks >= 80) {
      this.portalTicks = 0;
      const target: Dimension = this.dimension === 'overworld' ? 'nether' : 'overworld';
      void this.switchDimension(target, p.x, p.z);
    }
  }

  /** Change de dimension ('overworld' ↔ 'nether') avec facteur d'échelle 1:8 et lien de portail. */
  async switchDimension(target: Dimension, portalX: number, portalZ: number): Promise<void> {
    if (this.dimension === target || target === 'end') return;
    const tx = target === 'nether' ? Math.floor(portalX / 8) : Math.floor(portalX * 8);
    const tz = target === 'nether' ? Math.floor(portalZ / 8) : Math.floor(portalZ * 8);
    await this.travel(target, tx, tz, () => findOrCreatePortal(this.world, tx, tz, target));
  }

  /** Entre dans l'End : le joueur arrive sur la plate-forme d'obsidienne, face à l'île. */
  async enterEnd(): Promise<void> {
    if (this.dimension === 'end') return;
    await this.travel('end', END_PLATFORM.x, END_PLATFORM.z, () => {
      this.player.addStat(STAT.END_VISITS);
      const spot = buildEndPlatform(this.world);
      this.player.setRotation(Math.PI / 2);
      return spot;
    });
  }

  /** Quitte l'End par le portail de sortie : retour au point de réapparition, à la surface. */
  async leaveEnd(): Promise<void> {
    if (this.dimension !== 'end') return;
    const won = this.endFight.killed && !this.endFight.creditsSeen;
    const aim = this.respawnAim();
    await this.travel('overworld', Math.floor(aim.x), Math.floor(aim.z), () => this.respawnSpot());
    this.needSettle = true;
    if (won && !this.disposed) {
      this.endFight.creditsSeen = true;
      this.interaction.reset();
      this.ui.showWin();
      this.input.unlock();
    }
  }

  /**
   * Voyage vers une autre dimension : sauvegarde celle qu'on quitte, vide le monde chargé, attend
   * le terrain autour de (tx, tz) puis pose le joueur là où `arrive` le décide.
   */
  private async travel(target: Dimension, tx: number, tz: number, arrive: () => { x: number; y: number; z: number }): Promise<void> {
    if (this.dimensionSwitching || this.dimension === target) return;
    this.dimensionSwitching = true;
    try {
      if (this.dimension === 'end') this.endFight.leave();
      this.keepPersistentEntities();
      await this.chunks.saveAll();
      const keys = this.storage ? await this.storage.chunkKeys(dimensionStorageId(this.info.id, target)) : new Set<number>();
      const p = this.player;
      this.entities.length = 0;
      this.entities.push(p);
      this.homes.clear();
      this.pressedPlates.clear();

      this.dimension = target;
      this.chunks.setDimension(target, keys);

      p.teleport(tx + 0.5, 80, tz + 0.5);

      for (let i = 0; i < 240 && !this.disposed; i++) {
        this.chunks.update(tx, tz);
        if (this.chunks.isReady(tx, tz, 2)) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const dest = arrive();
      p.teleport(dest.x, dest.y, dest.z);
      p.fallDistance = 0;
      this.portalCooldown = 100;
      this.portalTicks = 0;
      await this.save();
    } finally {
      this.dimensionSwitching = false;
    }
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
      if (this.frozenDayTime >= 0) this.frozenDayTime = 0;
      p.addStat(STAT.SLEEP);
      this.raining = false;
      this.thundering = false;
      this.weatherTimer = 12000 + Math.floor(this.rng() * 168000);
      this.wake();
    }
  }

  private wake(): void {
    if (this.isRemote) {
      this.net?.sendWake();
      return;
    }
    const p = this.player;
    const bed = p.bed;
    p.sleeping = false;
    p.sleepTicks = 0;
    if (bed) {
      const spot = this.bedStandSpot(bed.x, bed.y, bed.z);
      if (spot) {
        p.teleport(spot.x, spot.y, spot.z);
        p.vx = p.vy = p.vz = 0;
        p.fallDistance = 0;
      }
    }
  }

  /** Case libre pour tenir debout à côté du lit (tête en hx, by, hz), ou null si toutes sont obstruées. */
  private bedStandSpot(hx: number, by: number, hz: number): { x: number; y: number; z: number } | null {
    return findBedStandSpot(this.world, hx, by, hz, this.player.width, this.player.height);
  }

  private showDeath(msg?: string): void {
    const p = this.player;
    this.deathShown = true;
    if (this.menu) {
      this.menu.close();
      this.menu = null;
    }
    this.interaction.reset();
    this.ui.showDeath(msg ?? formatDeathMessage(null, p.deathCause, p.deathBy));
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
    const skySubtick = dt > 0 && this.world.rules.doDaylightCycle ? alpha : 0;
    this.sky.update(dt, cam, this.dayTime + skySubtick, this.rainLevel, this.thunderLevel, viewBlocks, this.dimension);
    const u = worldUniforms;
    u.uSkyLight.value.copy(this.sky.skyLight);
    const baseAmbient = this.dimension === 'nether' ? NETHER_AMBIENT : this.dimension === 'end' ? END_AMBIENT : OVERWORLD_AMBIENT;
    u.uAmbient.value = Math.max(baseAmbient, this.player.hasEffect('night_vision') ? 0.85 : 0);
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
    // bout de la canne à pêche (départ de la ligne) : en bas à droite de l'écran, ou devant la main de l'avatar
    if (first) {
      // la main est dessinée avec un champ de vision fixe de 70° : on ramène le bout de la canne à celui de la caméra
      const k = Math.tan((cam.fov * DEG) / 2) / Math.tan(35 * DEG);
      this.entityRenderer.lineAnchor.set(ROD_TIP_X * k, ROD_TIP_Y * k, -1).multiplyScalar(0.8).applyMatrix4(cam.matrixWorld);
    } else {
      // Repli si l'avatar n'a pas encore de modèle d'objet tenu ; sinon sync() met à jour lineAnchor sur le bout réel de la canne
      const sy = Math.sin(yaw);
      const cy = Math.cos(yaw);
      this.entityRenderer.lineAnchor.set(ex - sy * 0.7 + cy * 0.35, lerp(p.py, p.y, alpha) + 1.35, ez - cy * 0.7 - sy * 0.35);
    }
    this.entityRenderer.sync(this.entities, alpha, this.clock);
    this.signRenderer.sync(this.world);
    this.fx.update(dt, cam);

    const hand = this.hand;
    const hs = this.handState;
    hand.setItem(p.heldItemId);
    hand.setOffhand(p.offhandItemId);
    hs.bobPhase = phase;
    hs.bobAmount = settings.viewBobbing ? bob : 0;
    hs.skyLight = p.skyLight;
    hs.blockLight = p.blockLight;
    hs.useKind = p.useKind;
    hs.fishing = this.interaction.fishing;
    hs.useProgress = p.useKind === 'eat' ? Math.min(1, p.useTicks / 32) : p.useKind === 'bow' ? Math.min(1, p.useTicks / 20) : p.useKind === 'block' ? Math.min(1, p.useTicks / 5) : 0;
    hs.yawDelta = yaw - this.lastYaw;
    hs.pitchDelta = pitch - this.lastPitch;
    hs.pitch = pitch;
    hs.iconTile = this.dynamicTile(p.heldItemId);
    const heldMap = this.heldMap();
    if (heldMap) {
      const hm = this.heldMapState;
      hm.id = heldMap.id;
      hm.colors = heldMap.colors;
      hm.version = heldMap.version;
      hm.markerX = lerp(p.px, p.x, alpha) - heldMap.x0;
      hm.markerZ = lerp(p.pz, p.z, alpha) - heldMap.z0;
      hm.dirX = -Math.sin(yaw);
      hm.dirZ = -Math.cos(yaw);
      hs.map = hm;
    } else hs.map = null;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    hand.update(dt, hs);

    const r = this.renderer;
    r.setClearColor(submerged ? this.fogColor : this.sky.skyColor, 1);
    r.clear();
    r.render(this.scene, cam);
    this.triangles = r.info.render.triangles;
    if (first && this.hudVisible && p.alive && !p.sleeping && !p.spectator) hand.render(r);
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
      if (!repeat && !p.sleeping && !p.spectator) this.openMenu(p.creative ? new CreativeMenu(p.inventory) : new InventoryMenu(p.inventory));
      return true;
    }
    if (code === kb.offhand) {
      if (!repeat && !p.sleeping) {
        if (p.useKind !== 'none') p.stopUsing();
        p.inventory.swapOffhand();
        p.itemId = p.inventory.heldId;
        p.offhandId = p.inventory.offhandId;
        if (this.isRemote) this.sendRemoteInvSync();
      }
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

  /** Un panneau vient d'être posé : saisie de son texte (le jeu continue pendant ce temps, comme dans Minecraft). */
  openSignEditor(x: number, y: number, z: number): void {
    const sign = getSign(this.world, x, y, z);
    this.interaction.reset();
    this.ui.openSignEditor(x, y, z, sign.lines);
    this.input.unlock();
  }

  /** Clic droit sur une créature avec une étiquette : saisie de son nom. */
  openNameTag(mob: Entity): void {
    this.interaction.reset();
    this.ui.openNameEditor(mob.id, mob.customName, NAME_MAX);
    this.input.unlock();
  }

  /** Le nom vient d'être validé : il est donné à la créature, et l'étiquette est consommée. */
  setMobName(id: number, name: string): void {
    const p = this.player;
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    const mob = this.entities.find((e) => e.id === id);
    if (this.isRemote) {
      if (clean !== '' && mob instanceof RemoteEntity && mob.kind === 'mob') {
        this.net?.sendNameEntity(mob.remoteId, clean);
      }
      return;
    }
    if (clean === '' || !(mob instanceof Mob) || mob.dead || !mob.alive) return;
    if (p.heldItemId !== I.NAME_TAG || mob.distanceSqTo(p) > 64) return;
    if (mob.customName === clean) return;
    mob.customName = clean;
    p.consumeHeld(1);
    this.sound('orb', mob.x, mob.y + mob.height, mob.z, 0.5, 1.4);
  }

  setSignText(x: number, y: number, z: number, lines: string[]): void {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (id !== B.SIGN && id !== B.WALL_SIGN) return;
    const sign = getSign(w, x, y, z);
    sign.lines = cleanSignLines(lines);
    w.markBlockEntityDirty(sign);
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

  /** Clic droit sur un villageois : écran d'échange. Les objets passent directement par l'inventaire du joueur. */
  openTrade(villager: Entity): void {
    if (!(villager instanceof Villager)) return;
    const v = villager;
    const p = this.player;
    const inv = p.inventory;
    const free = (): boolean => p.gameMode === 'creative';
    const can = (o: Offer): boolean => free() || (inv.count(o.buy) >= o.buyCount && (o.buy2 === 0 || inv.count(o.buy2) >= o.buy2Count));
    const view: TradeView = {
      title: v.title,
      offers: () => v.offers.map((o) => ({
        buy: o.buy, buyCount: o.buyCount, buy2: o.buy2, buy2Count: o.buy2Count, sell: o.sell, sellCount: o.sellCount,
        enchanted: o.enchants !== undefined, soldOut: o.uses >= o.maxUses, affordable: can(o),
      })),
      trade: (index) => {
        const o = v.offers[index];
        if (!o || !v.alive || v.customer !== p || o.uses >= o.maxUses || !can(o)) return false;
        if (!free()) {
          inv.remove(o.buy, o.buyCount);
          if (o.buy2 !== 0) inv.remove(o.buy2, o.buy2Count);
        }
        const stack = makeStack(o.sell, o.sellCount, 0, o.enchants);
        if (inv.add(stack) > 0) this.dropStack(p.x, p.y + 1, p.z, stack);
        v.completeTrade(this, index);
        this.sfx.play('pop', { volume: 0.5, pitch: 0.9 + Math.random() * 0.3 });
        p.addStat(STAT.TRADES);
        return true;
      },
      closed: () => {
        if (v.customer === p) v.customer = null;
      },
    };
    this.interaction.reset();
    this.ui.openTrade(view);
    this.input.unlock();
  }

  openMenu(menu: Menu): void {
    this.interaction.reset();
    this.menu = menu;
    this.ui.openMenu(menu);
    this.input.unlock();
  }

  trySleep(x: number, y: number, z: number, meta: number): void {
    // hors de la surface, un lit explose (Nether et End)
    if (this.dimension !== 'overworld') {
      this.world.setBlock(x, y, z, B.AIR, 0);
      runExplosion(this, x + 0.5, y + 0.5, z + 0.5, 5, true, null);
      return;
    }
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
    return this.frozenDayTime >= 0 ? this.frozenDayTime : this.time % DAY_TICKS;
  }

  spawn(e: Entity): void {
    if (this.ticking && !this.quiet) this.pending.push(e);
    else this.add(e, !this.quiet);
  }

  private add(e: Entity, touch: boolean): void {
    this.entities.push(e);
    if (e instanceof Thrown || e.roaming) return;
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

  dropStack(x: number, y: number, z: number, stack: ItemStack): Entity {
    const e = new ItemEntity(cloneStack(stack)!);
    e.setPosition(x, y, z);
    e.vx = (this.rng() - 0.5) * 0.1;
    e.vy = 0.2;
    e.vz = (this.rng() - 0.5) * 0.1;
    this.spawn(e);
    return e;
  }

  dropItem(x: number, y: number, z: number, id: number, count: number, damage = 0): Entity {
    return this.dropStack(x, y, z, makeStack(id, count, damage));
  }

  explode(x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null, griefing = true): void {
    runExplosion(this, x, y, z, power, fire, source, griefing);
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
        if (be.type === 'jukebox') this.stopJukebox(be.x, be.y, be.z);
        resolveLoot(be, this.world.seed);
        for (const s of blockEntityItems(be)) this.dropStack(be.x + 0.5, be.y + 0.3, be.z + 0.5, s);
      },
      pushEntities: (x0, y0, z0, x1, y1, z1, dx, dy, dz) => {
        for (const e of this.entitiesInBox(x0, y0, z0, x1, y1, z1, null)) {
          if (e instanceof Living && e.alive) {
            e.setPosition(e.x + dx, e.y + dy, e.z + dz);
          }
        }
      },
      hasEntityInBox: (x0, y0, z0, x1, y1, z1, kind) => {
        for (const e of this.entitiesInBox(x0, y0, z0, x1, y1, z1, null)) {
          if (!kind || e.kind === kind) return true;
        }
        return false;
      },
      prepareBlockEntity: (be: BlockEntity) => {
        if (resolveLoot(be, this.world.seed)) this.world.markBlockEntityDirty(be);
      },
      playNote: (x, y, z, instrument, note, pitch) => {
        this.lastNote = { x, y, z, instrument, note, pitch, count: ++this.noteCount };
        this.fx.spawn('note', x + 0.5, y + 1.2, z + 0.5, 1, 0.15);
        this.sound(`note_${instrument}` as SfxName, x + 0.5, y + 0.5, z + 0.5, 0.9, pitch);
      },
      pullItemForHopper: (x, y, z, accept) => {
        for (const e of this.entitiesInBox(x, y + 0.85, z, x + 1, y + 1.6, z + 1, null)) {
          if (e instanceof ItemEntity && !e.dead && e.stack.count > 0 && accept(e.stack)) {
            e.itemCount = e.stack.count;
            if (e.stack.count <= 0) e.dead = true;
            return true;
          }
        }
        return false;
      },
      dispense: (x, y, z, dropper) => this.dispenseAt(x, y, z, dropper),
    };
  }

  private dispenseAt(x: number, y: number, z: number, dropper: boolean): void {
    const w = this.world;
    const v = w.getBlockAndMeta(x, y, z);
    const id = v & 255;
    if ((dropper && id !== B.DROPPER) || (!dropper && id !== B.DISPENSER)) return;
    const f = Math.min(5, (v >> 8) & 7);
    const be = getDispenser(w, x, y, z, dropper ? 'dropper' : 'dispenser');
    const nonEmpty: number[] = [];
    for (let i = 0; i < be.items.length; i++) {
      const s = be.items[i];
      if (s && s.count > 0) nonEmpty.push(i);
    }
    if (nonEmpty.length === 0) {
      this.sound('click', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.7);
      return;
    }
    const idx = nonEmpty[Math.floor(this.rng() * nonEmpty.length)];
    const stack = be.items[idx]!;
    const dx = PISTON_DX[f];
    const dy = PISTON_DY[f];
    const dz = PISTON_DZ[f];
    const tx = x + dx;
    const ty = y + dy;
    const tz = z + dz;
    const ox = x + 0.5 + dx * 0.7;
    const oy = y + 0.35 + dy * 0.7;
    const oz = z + 0.5 + dz * 0.7;

    if (dropper) {
      if (insertOneIntoContainer(w, tx, ty, tz, stack, f)) {
        if (stack.count <= 0) be.items[idx] = null;
      } else {
        const drop = new ItemEntity(cloneStackWithCount(stack, 1));
        drop.setPosition(ox, oy, oz);
        drop.vx = dx * 0.14 + (this.rng() - 0.5) * 0.03;
        drop.vy = 0.14 + dy * 0.1;
        drop.vz = dz * 0.14 + (this.rng() - 0.5) * 0.03;
        drop.pickupDelay = 10;
        this.spawn(drop);
        if (--stack.count <= 0) be.items[idx] = null;
      }
    } else {
      const py = y + 0.5 + dy * 0.7;
      if (stack.id === I.ARROW) {
        const a = new Arrow();
        a.fromPlayer = true;
        a.shoot(ox, py, oz, dx, dy + 0.05, dz, 1.1, 6, this.rng);
        this.spawn(a);
        this.sound('bow', ox, py, oz, 0.7, 0.9 + this.rng() * 0.2);
        if (--stack.count <= 0) be.items[idx] = null;
      } else if (stack.id === I.EGG || stack.id === I.SNOWBALL || stack.id === I.ENDER_PEARL || stack.id === I.SPLASH_POTION) {
        const proj =
          stack.id === I.ENDER_PEARL
            ? new ThrownPearl()
            : stack.id === I.SPLASH_POTION
              ? new ThrownPotion(stack.potion ?? 'healing')
              : new Thrown(stack.id);
        proj.shoot(ox, py, oz, dx, dy + 0.05, dz, 1.1);
        this.spawn(proj);
        this.sound('bow', ox, py, oz, 0.6, 1.2);
        if (--stack.count <= 0) be.items[idx] = null;
      } else if (stack.id === B.TNT) {
        if (w.getBlock(tx, ty, tz) === B.AIR || BLOCK_REPLACEABLE[w.getBlock(tx, ty, tz)] === 1) {
          w.setBlock(tx, ty, tz, B.AIR, 0);
          w.host.primeTnt(tx, ty, tz, 80);
          if (--stack.count <= 0) be.items[idx] = null;
        }
      } else if (stack.id === I.WATER_BUCKET || stack.id === I.LAVA_BUCKET) {
        const tid = w.getBlock(tx, ty, tz);
        if (tid === B.AIR || BLOCK_REPLACEABLE[tid] === 1) {
          w.setBlock(tx, ty, tz, stack.id === I.WATER_BUCKET ? B.WATER : B.LAVA, 0);
          be.items[idx] = makeStack(I.BUCKET, 1);
          this.sound('bucket_empty', tx + 0.5, ty + 0.5, tz + 0.5, 0.7);
        }
      } else if (stack.id === I.BUCKET) {
        const tv = w.getBlockAndMeta(tx, ty, tz);
        const tid = tv & 255;
        if ((tid === B.WATER || tid === B.LAVA) && (tv >> 8) === 0 && stack.count === 1) {
          w.setBlock(tx, ty, tz, B.AIR, 0);
          be.items[idx] = makeStack(tid === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET, 1);
          this.sound('bucket_fill', tx + 0.5, ty + 0.5, tz + 0.5, 0.7);
        }
      } else if (stack.id === I.FLINT_AND_STEEL) {
        if (w.getBlock(tx, ty, tz) === B.AIR && fireCanStay(w, tx, ty, tz)) {
          w.setBlock(tx, ty, tz, B.FIRE, 0);
          stack.damage++;
          const lim = maxDamage(stack.id);
          if (lim > 0 && stack.damage >= lim) be.items[idx] = null;
          this.sound('ignite', tx + 0.5, ty + 0.5, tz + 0.5, 0.7);
        }
      } else if (stack.id === I.BONE_MEAL) {
        if (applyBonemeal(w, tx, ty, tz) && --stack.count <= 0) be.items[idx] = null;
      } else {
        const item = new ItemEntity(cloneStackWithCount(stack, 1));
        item.setPosition(ox, oy, oz);
        item.vx = dx * 0.25 + (this.rng() - 0.5) * 0.04;
        item.vy = 0.18 + dy * 0.2;
        item.vz = dz * 0.25 + (this.rng() - 0.5) * 0.04;
        item.pickupDelay = 10;
        this.spawn(item);
        if (--stack.count <= 0) be.items[idx] = null;
      }
    }

    this.sound('click', x + 0.5, y + 0.5, z + 0.5, 0.55, 1.0);
    this.fx.spawn('smoke', ox, y + 0.5 + dy * 0.5, oz, 4, 0.1);
    w.markBlockEntityDirty(be);
    updateRedstoneAround(w, x, y, z);
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

  chunkLoaded(chunk: Chunk, saved: unknown[] | null, spawns?: readonly GenSpawn[]): void {
    this.quiet = true;
    try {
      if (saved === null) {
        this.spawner.populateChunk(this, chunk);
        if (spawns) for (const s of spawns) this.spawnGenerated(s);
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

  /** Habitant posé par le générateur (villageois dans sa maison) : métier fixé, carrière tirée de sa position. */
  private spawnGenerated(s: GenSpawn): void {
    if (s.kind === 'iron_golem') {
      const golem = new IronGolem();
      golem.setPosition(s.x, s.y, s.z);
      golem.setRotation(0);
      golem.setHome(s.x, s.z);
      this.spawn(golem);
      return;
    }
    if (s.kind === 'end_crystal') {
      const crystal = new EndCrystal();
      crystal.setPosition(s.x, s.y, s.z);
      this.spawn(crystal);
      return;
    }
    if (s.kind !== 'villager') return;
    const rng = mulberry32(hash2(Math.floor(s.x), Math.floor(s.z), (this.world.seed ^ 0x51a6e7) >>> 0));
    const v = new Villager(rng, isProfession(s.profession) ? s.profession : undefined);
    v.setPosition(s.x, s.y, s.z);
    v.setRotation(rng() * Math.PI * 2);
    v.setHome(s.x, s.z);
    this.spawn(v);
  }

  /**
   * Avant une sauvegarde : le chunk d'une entité à conserver (villageois avec qui le joueur a
   * commercé) est marqué modifié, sinon il serait régénéré à neuf au prochain chargement.
   */
  private keepPersistentEntities(): void {
    for (const e of this.entities) {
      if (!e.persistent || e.dead) continue;
      const c = this.world.chunkAt(Math.floor(e.x), Math.floor(e.z));
      if (c) {
        c.modified = true;
        c.saveDirty = true;
      }
    }
  }

  chunkEntities(chunk: Chunk, remove: boolean): unknown[] {
    const out: unknown[] = [];
    const list = this.entities;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === this.player || e.roaming || Math.floor(e.x) >> 4 !== chunk.cx || Math.floor(e.z) >> 4 !== chunk.cz) {
        list[n++] = e;
        continue;
      }
      if (!e.dead) {
        const inVehicle = e instanceof Living && e.vehicle && (e.vehicle.kind === 'boat' || e.vehicle.kind === 'minecart');
        if (!inVehicle) {
          const d = e.save();
          if (d) out.push(d);
          if (e.persistent) {
            chunk.modified = true;
            chunk.saveDirty = true;
          }
        }
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

  get hardcore(): boolean {
    return this.info.hardcore === true;
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

  get heartTint(): '' | 'poison' | 'wither' {
    const p = this.player;
    return p.witherTicks > 0 ? 'wither' : p.poisonTicks > 0 ? 'poison' : '';
  }

  get activeEffects(): ReadonlyArray<{ type: string; level: number; ticks: number }> {
    const out: Array<{ type: string; level: number; ticks: number }> = [];
    for (const [type, fx] of this.player.effects) {
      if (fx.ticks > 0) out.push({ type, level: fx.level, ticks: fx.ticks });
    }
    return out;
  }

  get boss(): { name: string; progress: number } | null {
    if (this.dimension !== 'end') return null;
    const progress = this.endFight.progress;
    return progress === null ? null : { name: "Dragon de l'Ender", progress };
  }

  get fade(): number {
    const p = this.player;
    return p.sleeping ? Math.min(1, p.sleepTicks / SLEEP_TICKS) : 0;
  }

  get sneaking(): boolean {
    return this.player.sneaking || this.touchSneaking;
  }

  openInventory(): void {
    const p = this.player;
    if (!this.ready || this.ui.modal || !p.alive || p.sleeping || p.spectator) return;
    this.openMenu(p.creative ? new CreativeMenu(p.inventory) : new InventoryMenu(p.inventory));
  }

  pauseGame(): void {
    if (!this.ready || this.ui.modal) return;
    this.pause();
  }

  cycleViewMode(): void {
    if (!this.ready || this.ui.modal) return;
    this.viewMode = (this.viewMode + 1) % 3;
  }

  tapJump(): void {
    const p = this.player;
    if (!this.ready || this.ui.modal || !p.alive) return;
    if (p.sleeping) this.wake();
    else {
      this.jumpTapped = true;
      p.tapJump();
    }
  }

  toggleSneak(): void {
    if (!this.ready || this.ui.modal || !this.player.alive) return;
    this.touchSneaking = !this.touchSneaking;
  }

  setTouchMove(forward: number, strafe: number): void {
    this.touchForward = forward;
    this.touchStrafe = strafe;
  }

  setTouchJump(down: boolean): void {
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
    sprintPressed: boolean;
    attackDown: boolean;
    attackPressed: boolean;
    useDown: boolean;
    usePressed: boolean;
    dropPressed: boolean;
    inventoryPressed: boolean;
    pausePressed: boolean;
    pttDown?: boolean;
    wheelDelta: number;
  }): void {
    if (!this.ready || this.disposed) return;
    this.padForward = state.forward;
    this.padStrafe = state.strafe;
    this.padJumpDown = state.jumpDown;
    this.padSneakDown = state.sneakDown;
    this.padSprintDown = state.sprintDown;
    this.padPttDown = Boolean(state.pttDown);

    if (this.ui.modal) {
      if (this.prevPadAttack) this.input.buttons[0] = false;
      if (this.prevPadUse) this.input.buttons[2] = false;
      this.prevPadAttack = false;
      this.prevPadUse = false;
      return;
    }

    if (state.lookDX !== 0 || state.lookDY !== 0) {
      this.input.mouseDX += state.lookDX;
      this.input.mouseDY += state.lookDY;
    }
    if (state.jumpPressed) this.tapJump();
    if (state.attackPressed) this.input.presses[0]++;
    if (state.usePressed) this.input.presses[2]++;
    if (state.attackDown !== this.prevPadAttack) {
      this.input.buttons[0] = state.attackDown;
      this.prevPadAttack = state.attackDown;
    }
    if (state.useDown !== this.prevPadUse) {
      this.input.buttons[2] = state.useDown;
      this.prevPadUse = state.useDown;
    }
    if (state.dropPressed && !this.player.sleeping) {
      this.interaction.dropHeld(false);
    }
    if (state.inventoryPressed) {
      this.openInventory();
    }
    if (state.pausePressed) {
      this.pauseGame();
    }
    if (state.wheelDelta !== 0 && this.player.alive) {
      const inv = this.player.inventory;
      inv.selected = (inv.selected + state.wheelDelta + HOTBAR_SIZE) % HOTBAR_SIZE;
    }
    this.syncPushToTalk();
  }

  private syncPushToTalk(): void {
    if (!this.voice) return;
    const keyPtt = !this.ui.modal && this.input.isDown(this.settings.keybinds.pushToTalk);
    void this.voice.setPushToTalkActive(keyPtt || this.touchPttDown || this.padPttDown);
  }

  get voiceStatus(): VoiceStatusView | null {
    if (!this.voice) return null;
    return {
      secure: this.voice.isSecureContextAvailable(),
      micEnabled: this.voice.micEnabled,
      camEnabled: this.voice.camEnabled,
      pttMode: this.settings.pushToTalk,
      pttActive: this.voice.pttActive,
      selfSpeaking: this.voice.selfSpeaking,
      videosHidden: this.voice.videosHidden,
      error: this.voice.lastError,
      peers: this.voice.getPeerViews(),
    };
  }

  toggleMic(): Promise<boolean> {
    if (!this.voice) return Promise.resolve(false);
    return this.voice.toggleMic();
  }

  toggleCam(): Promise<boolean> {
    if (!this.voice) return Promise.resolve(false);
    return this.voice.toggleCam();
  }

  toggleVideosHidden(): boolean {
    if (!this.voice) return false;
    return this.voice.toggleVideosHidden();
  }

  setPeerMuted(id: number, muted: boolean): void {
    this.voice?.setPeerMuted(id, muted);
  }

  setPushToTalkActive(active: boolean): void {
    this.touchPttDown = active;
    this.syncPushToTalk();
  }

  get stats(): Stats {
    return this.player.stats;
  }

  get guideGoal(): string {
    const p = this.player;
    if (p.gameMode !== 'survival') return '';
    const ctx = {
      worldType: this.world.worldType,
      genVersion: this.world.genVersion,
      dimension: this.dimension,
      endVisited: (p.stats[STAT.END_VISITS] ?? 0) > 0,
    };
    for (const adv of ADVANCEMENTS) {
      if (!p.advancements.has(adv.id) && isAdvancementAvailable(adv, ctx)) return this.advText(adv.goal);
    }
    return '';
  }

  /** Texte d'un progrès avec la touche d'inventaire réellement configurée. */
  private advText(text: string): string {
    return advancementText(text, formatKeyCode(this.settings.keybinds.inventory, this.settings.keyboardLayout));
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
      this.isRemote ? 'SarihBricks 3D (Multijoueur)' : 'SarihBricks 3D',
      `${this.fps} ips, ${this.chunkRenderer.count} chunks affichés, ${this.triangles} triangles`,
      `Chunks : ${stats.loaded} chargés, ${stats.generating} en génération, ${stats.meshing} en maillage`,
      this.isRemote
        ? `Joueurs visibles : ${this.remotePlayers.size + 1} | Entités : ${this.remoteEntities.size}`
        : `Entités : ${this.entities.length}`,
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
      `Mode : ${this.hardcore ? 'Extrême' : p.gameMode === 'creative' ? 'créatif' : p.gameMode === 'adventure' ? 'aventure' : p.gameMode === 'spectator' ? 'spectateur' : 'survie'}`,
      `Difficulté : ${DIFFICULTY_LABELS[this.difficulty] ?? this.difficulty}`,
      `Sauvegarde : ${this.storage ? (this.storage.persistent ? 'sur disque' : 'en mémoire') : 'serveur'}`,
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
      if (this.net && !menu.remote) {
        this.sendRemoteInvSync();
      }
    }
    this.input.lock();
  }

  resume(): void {
    this.input.lock();
  }

  respawn(): void {
    if (this.isRemote) {
      this.net?.sendRespawn();
      return;
    }
    if (this.hardcore) {
      this.spectate();
      return;
    }
    const p = this.player;
    if (this.dimension !== 'overworld') {
      // mort dans le Nether ou dans l'End : on réapparaît à la surface, comme dans Minecraft
      const aim = this.respawnAim();
      void this.travel('overworld', Math.floor(aim.x), Math.floor(aim.z), () => {
        const spot = this.respawnSpot();
        this.revive(spot);
        return spot;
      });
      return;
    }
    this.revive(this.respawnSpot());
  }

  spectate(): void {
    const p = this.player;
    p.gameMode = 'spectator';
    const y = p.y < 0 ? Math.max(this.spawnPoint.y, 64) : p.y;
    p.respawn(p.x, y, p.z);
    p.flying = true;
    p.noClip = true;
    if (this.deathShown && this.ui.modal) this.ui.closeScreen();
    this.deathShown = false;
    this.needSettle = false;
    this.interaction.reset();
    this.input.lock();
  }

  /** Remet le joueur sur pied à l'endroit donné et lui rend la main. */
  private revive(spot: { x: number; y: number; z: number }): void {
    this.player.respawn(spot.x, spot.y, spot.z);
    if (this.deathShown && this.ui.modal) this.ui.closeScreen();
    this.deathShown = false;
    this.needSettle = true;
    this.interaction.reset();
    this.input.lock();
  }

  /** Point visé par une réapparition (lit ou point d'apparition du monde), avant toute vérification. */
  private respawnAim(): { x: number; z: number } {
    const bed = this.player.bed;
    return bed ? { x: bed.x, z: bed.z } : { x: this.spawnPoint.x, z: this.spawnPoint.z };
  }

  /** Endroit où le joueur réapparaît à la surface : près de son lit s'il existe encore, sinon au point d'apparition. */
  private respawnSpot(): { x: number; y: number; z: number } {
    const p = this.player;
    let x = this.spawnPoint.x;
    let y = this.spawnPoint.y;
    let z = this.spawnPoint.z;
    const bed = p.bed;
    if (bed) {
      // lit dans un chunk déchargé : on lui fait confiance
      if (!this.world.isLoaded(bed.x, bed.z) || this.world.getBlock(bed.x, bed.y, bed.z) === B.BED) {
        const spot = this.bedStandSpot(bed.x, bed.y, bed.z);
        if (spot) {
          x = spot.x;
          y = spot.y;
          z = spot.z;
        } else {
          x = bed.x + 0.5;
          y = bed.y + 0.5625;
          z = bed.z + 0.5;
        }
      } else {
        p.bed = null;
        this.ui.addMessage('Votre lit a disparu ou est obstrué');
      }
    }
    return { x, y, z };
  }

  // ------------------------------------------------------------------ chat et commandes

  chat(text: string): void {
    if (this.net) {
      const s = text.trim();
      if (s) this.net.sendChat(s);
      return;
    }
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
      map.set('note_block', B.NOTE_BLOCK);
      map.set('fence_gate', B.FENCE_GATE);
      for (const disc of MUSIC_DISCS) {
        map.set(`record_${disc.key}`, disc.id);
        map.set(`disc_${disc.key}`, disc.id);
      }
      for (const it of ITEMS) {
        if (!it) continue;
        const fr = normalizeCmdName(it.label);
        if (fr && !map.has(fr)) map.set(fr, it.id);
      }
      this.itemNames = map;
    }
    return map;
  }

  private blocks(): Map<string, { id: number; meta: number }> {
    let map = this.blockNames;
    if (!map) {
      map = new Map<string, { id: number; meta: number }>();
      for (const b of BLOCKS) {
        if (b) map.set(b.name, { id: b.id, meta: 0 });
      }
      map.set('grass', { id: B.GRASS, meta: 0 });
      map.set('note_block', { id: B.NOTE_BLOCK, meta: 0 });
      map.set('fence_gate', { id: B.FENCE_GATE, meta: 0 });
      for (const it of ITEMS) {
        if (!it || it.places < 0) continue;
        if (!map.has(it.name)) map.set(it.name, { id: it.places, meta: it.placeMeta });
      }
      for (const b of BLOCKS) {
        if (!b) continue;
        const fr = normalizeCmdName(b.label);
        if (fr && !map.has(fr)) map.set(fr, { id: b.id, meta: 0 });
      }
      for (const it of ITEMS) {
        if (!it || it.places < 0) continue;
        const fr = normalizeCmdName(it.label);
        if (fr && !map.has(fr)) map.set(fr, { id: it.places, meta: it.placeMeta });
      }
      this.blockNames = map;
    }
    return map;
  }

  private parseBlockCoord(raw: string, base: number): number {
    const v = raw.startsWith('~') ? base + (raw.length > 1 ? Number(raw.slice(1)) : 0) : Number(raw);
    return Number.isFinite(v) ? Math.floor(v) : Number.NaN;
  }

  private resolveBlock(rawName: string, rawMeta?: string): { id: number; meta: number } | null {
    const key = rawName.toLowerCase().replace(/^minecraft:/, '');
    const base = this.blocks().get(key) ?? (/^\d+$/.test(key) && BLOCKS[Number(key)] ? { id: Number(key), meta: 0 } : null);
    if (!base) return null;
    if (rawMeta === undefined) return base;
    const m = Number(rawMeta);
    if (!/^-?\d+$/.test(rawMeta) || !Number.isFinite(m) || m < 0 || m > 255) return null;
    return { id: base.id, meta: m & 255 };
  }

  private cmdSetBlock(args: string[], say: (text: string) => void): void {
    if (args.length < 4) {
      say('Usage : /setblock <x> <y> <z> <bloc> [méta]');
      return;
    }
    const p = this.player;
    const x = this.parseBlockCoord(args[0], Math.floor(p.x));
    const y = this.parseBlockCoord(args[1], Math.floor(p.y));
    const z = this.parseBlockCoord(args[2], Math.floor(p.z));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || Math.abs(x) > 1e6 || Math.abs(z) > 1e6) {
      say('Coordonnées invalides');
      return;
    }
    if (y < 0 || y >= CHUNK_HEIGHT) {
      say(`Hauteur hors limites (0..${CHUNK_HEIGHT - 1})`);
      return;
    }
    if (!this.world.isLoaded(x, z)) {
      say('Chunk non chargé à cette position');
      return;
    }
    const spec = this.resolveBlock(args[3], args[4]);
    if (!spec) {
      say(args[4] !== undefined && this.resolveBlock(args[3]) ? 'Méta invalide (0..255)' : `Bloc inconnu : ${args[3]}`);
      return;
    }
    this.world.setBlock(x, y, z, spec.id, spec.meta);
    say(`Bloc posé en ${x} ${y} ${z} : ${BLOCKS[spec.id]?.label ?? spec.id}`);
  }

  private cmdFill(args: string[], say: (text: string) => void): void {
    if (args.length < 7) {
      say('Usage : /fill <x1> <y1> <z1> <x2> <y2> <z2> <bloc> [replace|hollow|outline|destroy|keep]');
      return;
    }
    const p = this.player;
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    const x1 = this.parseBlockCoord(args[0], bx);
    const y1 = this.parseBlockCoord(args[1], by);
    const z1 = this.parseBlockCoord(args[2], bz);
    const x2 = this.parseBlockCoord(args[3], bx);
    const y2 = this.parseBlockCoord(args[4], by);
    const z2 = this.parseBlockCoord(args[5], bz);
    if (![x1, y1, z1, x2, y2, z2].every(Number.isFinite) || Math.abs(x1) > 1e6 || Math.abs(x2) > 1e6 || Math.abs(z1) > 1e6 || Math.abs(z2) > 1e6) {
      say('Coordonnées invalides');
      return;
    }
    if (y1 < 0 || y1 >= CHUNK_HEIGHT || y2 < 0 || y2 >= CHUNK_HEIGHT) {
      say(`Hauteur hors limites (0..${CHUNK_HEIGHT - 1})`);
      return;
    }
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);
    const volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    if (volume > FILL_MAX_BLOCKS) {
      say(`Zone trop grande (${volume} blocs, maximum ${FILL_MAX_BLOCKS})`);
      return;
    }
    let mode: (typeof FILL_MODES)[number] = 'replace';
    let metaArg: string | undefined;
    if (args[7] !== undefined) {
      const a7 = args[7].toLowerCase();
      if (FILL_MODES.includes(a7 as (typeof FILL_MODES)[number])) {
        mode = a7 as (typeof FILL_MODES)[number];
      } else if (/^\d+$/.test(a7)) {
        metaArg = a7;
        if (args[8] !== undefined) {
          const a8 = args[8].toLowerCase();
          if (!FILL_MODES.includes(a8 as (typeof FILL_MODES)[number])) {
            say(`Mode /fill inconnu : ${args[8]} (replace, hollow, outline, destroy, keep)`);
            return;
          }
          mode = a8 as (typeof FILL_MODES)[number];
        }
      } else {
        say(`Mode /fill inconnu : ${args[7]} (replace, hollow, outline, destroy, keep)`);
        return;
      }
    }
    const spec = this.resolveBlock(args[6], metaArg);
    if (!spec) {
      say(metaArg !== undefined && this.resolveBlock(args[6]) ? 'Méta invalide (0..255)' : `Bloc inconnu : ${args[6]}`);
      return;
    }
    const w = this.world;
    let changed = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!w.isLoaded(x, z)) continue;
          const shell = x === minX || x === maxX || y === minY || y === maxY || z === minZ || z === maxZ;
          const cur = w.getBlockAndMeta(x, y, z);
          const curId = cur & 255;
          const curMeta = cur >> 8;
          if (mode === 'keep' && curId !== B.AIR) continue;
          if (mode === 'outline' && !shell) continue;
          const nextId = mode === 'hollow' && !shell ? B.AIR : spec.id;
          const nextMeta = mode === 'hollow' && !shell ? 0 : spec.meta;
          if (mode === 'destroy' && curId !== B.AIR && (curId !== nextId || curMeta !== nextMeta)) {
            w.host.effect('break', x, y, z, curId, curMeta);
            for (const d of blockDrops(curId, curMeta, I.DIAMOND_PICKAXE, this.rng)) {
              this.dropItem(x + 0.5, y + 0.5, z + 0.5, d.id, d.count);
            }
          }
          if (curId !== nextId || curMeta !== nextMeta) {
            if (w.setBlock(x, y, z, nextId, nextMeta)) changed++;
          }
        }
      }
    }
    say(`${changed} bloc(s) rempli(s)`);
  }

  /**
   * Lieu du type donné le plus proche du joueur (village, temple…), ou null : monde plat,
   * monde créé avant les lieux à découvrir, ou lieu d'une autre dimension.
   */
  locate(kind: StructureKind): { x: number; y: number; z: number; distance: number } | null {
    const s = this.nearest(kind);
    if (!s) return null;
    const p = this.player;
    return { x: s.x, y: s.y, z: s.z, distance: Math.round(Math.hypot(s.x - p.x, s.z - p.z)) };
  }

  /** Ce monde contient-il ce type de lieu, et se trouve-t-il dans la dimension courante ? */
  private hasStructures(kind: StructureKind): boolean {
    return this.world.worldType !== 'flat' && this.world.genVersion >= structureSince(kind) && this.dimension === structureHome(kind);
  }

  private nearest(kind: StructureKind): Structure | null {
    if (!this.hasStructures(kind)) return null;
    const p = this.player;
    return locateStructure(this.terrainInfo(), kind, Math.floor(p.x), Math.floor(p.z));
  }

  /** Fort le plus proche : là où mène un œil de l'Ender lancé. Null si ce monde n'en a pas. */
  strongholdTarget(): { x: number; y: number; z: number } | null {
    const s = this.nearest('stronghold');
    return s ? { x: s.x + 0.5, y: s.y, z: s.z + 0.5 } : null;
  }

  /** Démarre la lecture d'un disque sur le jukebox (x, y, z). */
  playJukebox(x: number, y: number, z: number, discId: number): void {
    const info = musicDiscInfo(discId);
    if (!info) return;
    this.playingJukebox = { x, y, z, disc: discId, key: info.key, title: info.title };
    this.sfx.playDisc(info.key);
    this.ui.actionBar(`Lecture en cours : C418 - ${info.title}`);
  }

  /** Arrête le jukebox en (x, y, z) s'il est en train de jouer. */
  stopJukebox(x: number, y: number, z: number): void {
    if (this.playingJukebox && this.playingJukebox.x === x && this.playingJukebox.y === y && this.playingJukebox.z === z) {
      this.playingJukebox = null;
      this.sfx.stopDisc();
    }
  }

  /** Centre du portail du fort le plus proche (cellule du milieu de l'anneau de cadres), ou null. */
  strongholdPortal(): { x: number; y: number; z: number; dir: number } | null {
    const s = this.nearest('stronghold');
    return s instanceof Stronghold ? { x: s.portalX, y: s.portalY, z: s.portalZ, dir: s.portalDir } : null;
  }

  /** Générateur de la dimension courante, gardé pour situer les lieux sans régénérer de chunk. */
  private terrainInfo(): TerrainInfo {
    if (!this.terrain || this.terrainDimension !== this.dimension) {
      this.terrain = this.dimension === 'nether'
        ? new NetherGen(this.info.seed, this.world.genVersion)
        : this.dimension === 'end'
          ? new EndGen(this.info.seed)
          : new WorldGen(this.info.seed, this.info.worldType, this.world.genVersion);
      this.terrainDimension = this.dimension;
    }
    return this.terrain;
  }

  /** La colonne (x, z) est-elle dans un lieu généré du type donné ? */
  inStructure(kind: string, x: number, z: number): boolean {
    if (!this.hasStructures(kind as StructureKind)) return false;
    for (const s of structuresNear(this.terrainInfo(), [kind as StructureKind], x >> 4, z >> 4, 0)) {
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && (!s.covers || s.covers(x, z))) return true;
    }
    return false;
  }

  private command(line: string): void {
    const args = line.split(/\s+/).filter((s) => s !== '');
    const name = (args.shift() ?? '').toLowerCase();
    const p = this.player;
    const say = (text: string): void => this.ui.addMessage(text);
    switch (name) {
      case 'help':
      case '?':
        say('Commandes : /gamemode <survival|creative|adventure|spectator>, /time <set|add> <valeur>, /weather <clear|rain|thunder>,');
        say('/give <objet> [quantité], /give <potion|splash_potion> <sorte> [quantité] (/give potion ? pour la liste),');
        say('/tp <x> <y> <z>, /setblock <x> <y> <z> <bloc> [méta], /fill <x1> <y1> <z1> <x2> <y2> <z2> <bloc> [mode],');
        say('/summon <créature> [nombre], /difficulty <0-3>, /gamerule <règle> [true|false], /kill, /clear, /seed, /spawnpoint, /locate <village|temple|jungle|mine|forteresse|fort>');
        return;
      case 'gamemode': {
        if (this.hardcore) {
          say('Le mode de jeu ne peut pas être changé en mode Extrême');
          return;
        }
        const m = (args[0] ?? '').toLowerCase();
        const mode: GameMode | null =
          ['creative', 'creatif', 'créatif', 'c', '1'].includes(m) ? 'creative'
            : ['survival', 'survie', 's', '0'].includes(m) ? 'survival'
              : ['adventure', 'aventure', 'a', '2'].includes(m) ? 'adventure'
                : ['spectator', 'spectateur', 'sp', '3'].includes(m) ? 'spectator'
                  : null;
        if (!mode) {
          say('Usage : /gamemode <survival|creative|adventure|spectator>');
          return;
        }
        p.gameMode = mode;
        if (mode === 'spectator') {
          p.flying = true;
          p.noClip = true;
          p.leaveVehicle();
          p.stopUsing();
        } else {
          p.noClip = false;
          if (mode === 'survival' || mode === 'adventure') p.flying = false;
        }
        if (this.menu) {
          this.menu.close();
          this.menu = null;
        }
        const label = mode === 'creative' ? 'créatif' : mode === 'adventure' ? 'aventure' : mode === 'spectator' ? 'spectateur' : 'survie';
        say(`Mode de jeu : ${label}`);
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
        if (op === 'set') {
          const target = ((Math.floor(value) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
          this.time = this.time - (this.time % DAY_TICKS) + target;
          if (this.frozenDayTime >= 0) this.frozenDayTime = target;
        } else {
          const delta = Math.floor(value);
          this.time = Math.max(0, this.time + delta);
          if (this.frozenDayTime >= 0) this.frozenDayTime = ((this.frozenDayTime + delta) % DAY_TICKS + DAY_TICKS) % DAY_TICKS;
        }
        this.updateSkyDarken();
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
        if (id === I.POTION || id === I.SPLASH_POTION) {
          const arg1 = (args[1] ?? '').trim();
          if (arg1 === '?' || arg1.toLowerCase() === 'help' || arg1.toLowerCase() === 'aide' || arg1.toLowerCase() === 'liste') {
            say('Usage : /give <potion|splash_potion> <sorte> [quantité]');
            say(POTION_GIVE_HELP);
            return;
          }
          let potionKey = id === I.SPLASH_POTION ? 'healing' : 'water';
          let countRaw = args[1];
          if (arg1 !== '' && !/^\d+$/.test(arg1)) {
            const resolved = resolvePotionKind(arg1);
            if (!resolved) {
              say(`Sorte de potion inconnue : ${arg1}`);
              say(POTION_GIVE_HELP);
              return;
            }
            potionKey = resolved;
            countRaw = args[2];
          }
          const count = countRaw === undefined ? 1 : Math.floor(Number(countRaw));
          if (!Number.isFinite(count) || count < 1) {
            say('Usage : /give <potion|splash_potion> <sorte> [quantité]');
            say(POTION_GIVE_HELP);
            return;
          }
          const n = Math.min(count, 2304);
          p.inventory.give(id, n, 0, potionKey);
          say(`Donné : ${n} × ${potionLabel(potionKey, id === I.SPLASH_POTION)}`);
          if (arg1 === '') say(POTION_GIVE_HELP);
          return;
        }
        const count = args[1] === undefined ? 1 : Math.floor(Number(args[1]));
        if (id <= 0 || !Number.isFinite(count) || count < 1) {
          say(key === '' ? 'Usage : /give <objet> [quantité] | /give <potion|splash_potion> <sorte> [quantité]' : `Objet inconnu : ${key}`);
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
      case 'locate': {
        const key = (args[0] ?? '').toLowerCase();
        const place = LOCATE_NAMES[key];
        if (!place) {
          say('Usage : /locate <village|temple|jungle|mine|forteresse|fort>');
          return;
        }
        if (this.world.genVersion < structureSince(place.kind) || this.world.worldType === 'flat') {
          say(place.kind === 'stronghold' && this.world.worldType !== 'flat'
            ? 'Ce monde a été créé avant les forts : il n’en contient pas. En créatif, 12 cadres garnis d’yeux de l’Ender ouvrent un portail.'
            : 'Ce monde ne contient pas de lieux à découvrir (monde plat, ou créé avant leur arrivée).');
          return;
        }
        const found = this.locate(place.kind);
        if (!found) {
          const home = structureHome(place.kind);
          say(this.dimension !== home
            ? `${place.label} : à chercher ${home === 'nether' ? 'dans le Nether' : 'à la surface'}.`
            : `${place.label} : rien à proximité.`);
          return;
        }
        say(place.kind === 'stronghold'
          ? `${place.label} : x ${found.x}, z ${found.z}, sous terre vers y ${found.y} (à ${found.distance} blocs)`
          : `${place.label} : x ${found.x}, z ${found.z} (à ${found.distance} blocs)`);
        return;
      }
      case 'difficulty': {
        if (this.hardcore) {
          say('La difficulté est verrouillée en mode Extrême');
          return;
        }
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
        if (!PASSIVE_KINDS.includes(kind) && !HOSTILE_KINDS.includes(kind) && !NPC_KINDS.includes(kind)) {
          say(`Usage : /summon <${[...PASSIVE_KINDS, ...HOSTILE_KINDS, ...NPC_KINDS].join('|')}> [nombre]`);
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
      case 'gamerule': {
        if (args.length === 0) {
          say(`Règles : ${GAME_RULE_NAMES.map((r) => `${r}=${this.world.rules[r]}`).join(', ')}`);
          return;
        }
        const rule = resolveGameRule(args[0]);
        if (!rule) {
          say(`Règle inconnue : ${args[0]} (${GAME_RULE_NAMES.join(', ')})`);
          return;
        }
        if (args.length === 1) {
          say(`${rule} = ${this.world.rules[rule]}`);
          return;
        }
        const val = args[1].toLowerCase();
        if (val !== 'true' && val !== 'false') {
          say('Usage : /gamerule <règle> [true|false]');
          return;
        }
        const enabled = val === 'true';
        if (rule === 'doDaylightCycle') {
          if (!enabled && this.frozenDayTime < 0) {
            this.frozenDayTime = this.time % DAY_TICKS;
          } else if (enabled && this.frozenDayTime >= 0) {
            this.time += ((this.frozenDayTime - (this.time % DAY_TICKS)) + DAY_TICKS) % DAY_TICKS;
            this.frozenDayTime = -1;
          }
        }
        this.world.rules[rule] = enabled;
        say(`Règle ${rule} = ${this.world.rules[rule]}`);
        return;
      }
      case 'setblock':
        this.cmdSetBlock(args, say);
        return;
      case 'fill':
        this.cmdFill(args, say);
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
    if (this.hardcore) {
      this.level = 3;
      return;
    }
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
    if (this.isRemote) {
      if (parts.length === 1) return pick(['help', 'tp', 'time', 'gamemode']);
      return [];
    }
    if (parts.length === 1) return pick(COMMANDS);
    const cmd = parts[0].toLowerCase();
    if (parts.length === 2) {
      switch (cmd) {
        case 'gamemode':
          return pick(['survival', 'creative', 'adventure', 'spectator', 'survie', 'creatif', 'aventure', 'spectateur']);
        case 'time':
          return pick(['set', 'add']);
        case 'weather':
          return pick(['clear', 'rain', 'thunder']);
        case 'difficulty':
          return pick(DIFFICULTY_NAMES);
        case 'locate':
          return pick(Object.keys(LOCATE_NAMES));
        case 'summon':
          return pick([...PASSIVE_KINDS, ...HOSTILE_KINDS, ...NPC_KINDS]);
        case 'give':
          return pick([...this.items().keys()]).sort();
        case 'tp':
        case 'setblock':
        case 'fill':
          return pick(['~']);
        case 'gamerule':
          return pick(GAME_RULE_NAMES);
        default:
          return [];
      }
    }
    if (parts.length === 3 && cmd === 'gamerule') return pick(['true', 'false']);
    if (parts.length === 3 && cmd === 'time' && parts[1].toLowerCase() === 'set') return pick(Object.keys(TIME_NAMES));
    if (parts.length === 3 && cmd === 'give' && (parts[1].toLowerCase() === 'potion' || parts[1].toLowerCase() === 'splash_potion')) {
      return pick(POTION_COMPLETIONS);
    }
    if (cmd === 'tp' && parts.length <= 4) return pick(['~']);
    if (cmd === 'setblock') {
      if (parts.length <= 4) return pick(['~']);
      if (parts.length === 5) return pick([...this.blocks().keys()]).sort();
    }
    if (cmd === 'fill') {
      if (parts.length <= 7) return pick(['~']);
      if (parts.length === 8) return pick([...this.blocks().keys()]).sort();
      if (parts.length === 9) return pick(FILL_MODES);
    }
    return [];
  }

  // ------------------------------------------------------------------ multijoueur

  private attachNetHandlers(client: MultiplayerClient): void {
    this.voice?.dispose();
    this.voice = new VoiceVideoManager(this.remoteId, client, this.settings, () => {
      this.ui.update(0);
    });
    client.setHandlers({
      onChunk: (cx, cz, blocks, meta, biomes, tints) => {
        this.chunks.receiveRemoteChunk(cx, cz, blocks, meta, biomes, tints);
      },
      onPlayers: (list) => {
        const seen = new Set<number>();
        for (const s of list) {
          if (s.id === this.remoteId) continue;
          seen.add(s.id);
          const existing = this.remotePlayers.get(s.id);
          if (existing) {
            existing.applyServerState(s);
          } else {
            const rp = new RemotePlayerEntity(s);
            this.remotePlayers.set(s.id, rp);
            this.entities.push(rp);
          }
        }
        for (const [id, rp] of this.remotePlayers) {
          if (!seen.has(id)) {
            this.remotePlayers.delete(id);
            const idx = this.entities.indexOf(rp);
            if (idx >= 0) this.entities.splice(idx, 1);
          }
        }
        this.voice?.syncPeers(list);
      },
      onEntities: (list) => {
        const seen = new Set<number>();
        for (const s of list) {
          seen.add(s.id);
          const existing = this.remoteEntities.get(s.id);
          if (existing) {
            existing.applyServerState(s);
          } else {
            const re = new RemoteEntity(s);
            this.remoteEntities.set(s.id, re);
            this.entities.push(re);
          }
        }
        for (const [id, re] of this.remoteEntities) {
          if (!seen.has(id)) {
            this.remoteEntities.delete(id);
            const idx = this.entities.indexOf(re);
            if (idx >= 0) this.entities.splice(idx, 1);
          }
        }
      },
      onPlayerLeave: (id) => {
        const rp = this.remotePlayers.get(id);
        if (rp) {
          this.remotePlayers.delete(id);
          const idx = this.entities.indexOf(rp);
          if (idx >= 0) this.entities.splice(idx, 1);
        }
        this.voice?.removePeer(id);
      },
      onRtcSignal: (from, kind, payload) => {
        void this.voice?.handleSignal(from, kind, payload);
      },
      onRtcState: (id, mic, cam, speaking) => {
        this.voice?.handleRemoteState(id, mic, cam, speaking);
      },
      onChat: (text) => {
        this.ui.addMessage(text);
      },
      onTime: (t) => {
        this.time = t;
      },
      onWeather: (raining, thundering) => {
        this.raining = raining;
        this.thundering = thundering;
      },
      onGameMode: (mode) => {
        this.player.gameMode = mode;
        this.ui.actionBar(`Mode de jeu : ${mode}`);
      },
      onTeleport: (x, y, z) => {
        this.player.teleport(x, y, z);
      },
      onBlockUpdate: (x, y, z, id, meta) => {
        this.world.setBlock(x, y, z, id, meta, false);
        const c = this.world.chunkAt(x, z);
        if (c) c.saveDirty = false;
      },
      onInventory: (slots, selected, cursor, armor, offhand) => {
        this.applyRemoteInventory(slots, selected, cursor, armor, offhand);
      },
      onVitals: (health, hunger, xpLevel, xpProgress, _xpTotal, saturation, air, fireTicks, effects) => {
        this.player.health = health;
        this.player.hunger = hunger;
        if (saturation !== undefined) this.player.saturation = saturation;
        if (air !== undefined) this.player.air = air;
        if (fireTicks !== undefined) this.player.fireTicks = fireTicks;
        if (xpLevel !== undefined) this.player.xpLevel = xpLevel;
        if (xpProgress !== undefined) this.player.xpProgress = xpProgress;
        if (effects !== undefined) {
          this.player.clearEffects();
          for (const fx of effects) {
            if (EFFECT_TYPES.includes(fx.type)) this.player.addEffect(fx.type, fx.ticks, fx.level);
          }
        }
      },
      onPlayerHurt: (hurtTime, vx, vy, vz) => {
        this.player.hurtTime = hurtTime;
        this.player.vx = vx;
        this.player.vy = vy;
        this.player.vz = vz;
      },
      onDeath: (message) => {
        this.player.health = 0;
        this.player.sleeping = false;
        this.player.stopUsing();
        this.showDeath(message);
      },
      onRespawn: (x, y, z) => {
        this.revive({ x, y, z });
      },
      onSleep: (sleeping, x, y, z) => {
        this.player.sleeping = sleeping;
        this.player.sleepTicks = 0;
        if (x !== undefined && y !== undefined && z !== undefined) {
          this.player.teleport(x, y, z);
          this.player.vx = this.player.vy = this.player.vz = 0;
          this.player.fallDistance = 0;
        }
      },
      onActionBar: (text) => {
        this.ui.actionBar(text);
      },
      onContainerState: (msg) => {
        const loaded = loadSlots(msg.items, msg.items.length);
        const rc = this.remoteContainer;
        if (rc && rc.x === msg.x && rc.y === msg.y && rc.z === msg.z && rc.kind === msg.kind) {
          for (let i = 0; i < rc.be.items.length && i < loaded.length; i++) {
            rc.be.items[i] = loaded[i];
          }
          if (rc.be.type === 'furnace') {
            rc.be.burnTime = msg.burnTime ?? 0;
            rc.be.burnTotal = msg.burnTotal ?? 0;
            rc.be.cookTime = msg.cookTime ?? 0;
          } else if (rc.be.type === 'brewing') {
            rc.be.brewTime = msg.brewTime ?? 0;
            rc.be.fuel = msg.fuel ?? 0;
          }
          return;
        }
        let be: ChestEntity | FurnaceEntity | BrewingStandEntity | HopperEntity | DispenserEntity;
        let menu: Menu;
        const noop = (): void => {};
        if (msg.kind === 'chest') {
          be = { type: 'chest', x: msg.x, y: msg.y, z: msg.z, items: loaded };
          menu = new ChestMenu(this.player.inventory, be, noop);
          this.sfx.play('chest_open', { volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
        } else if (msg.kind === 'furnace') {
          be = {
            type: 'furnace',
            x: msg.x,
            y: msg.y,
            z: msg.z,
            items: loaded,
            burnTime: msg.burnTime ?? 0,
            burnTotal: msg.burnTotal ?? 0,
            cookTime: msg.cookTime ?? 0,
          };
          menu = new FurnaceMenu(this.player.inventory, be, noop);
        } else if (msg.kind === 'brewing') {
          be = {
            type: 'brewing',
            x: msg.x,
            y: msg.y,
            z: msg.z,
            items: loaded,
            brewTime: msg.brewTime ?? 0,
            fuel: msg.fuel ?? 0,
          };
          menu = new BrewingMenu(this.player.inventory, be, noop);
        } else if (msg.kind === 'hopper') {
          be = { type: 'hopper', x: msg.x, y: msg.y, z: msg.z, items: loaded, cooldown: 0 };
          menu = new HopperMenu(this.player.inventory, be, noop);
        } else {
          be = { type: msg.kind, x: msg.x, y: msg.y, z: msg.z, items: loaded };
          menu = new DispenserMenu(this.player.inventory, be, noop);
        }
        menu.remote = {
          send: (action) => this.net?.sendContainerAction(msg.x, msg.y, msg.z, action),
          close: () => {
            if (this.remoteContainer?.menu === menu) this.remoteContainer = null;
            this.net?.sendContainerClose(msg.x, msg.y, msg.z);
          },
        };
        this.remoteContainer = { x: msg.x, y: msg.y, z: msg.z, kind: msg.kind, be, menu };
        this.openMenu(menu);
      },
      onContainerClose: (x, y, z) => {
        const rc = this.remoteContainer;
        if (rc && rc.x === x && rc.y === y && rc.z === z) {
          this.remoteContainer = null;
          if (this.menu === rc.menu) {
            this.menu = null;
            this.ui.closeScreen();
            this.input.lock();
          }
        }
      },
      onTradeOpen: (entityId, title, offers) => {
        this.remoteTrade = { entityId, offers };
        const view: TradeView = {
          title,
          offers: () => this.remoteTrade?.offers ?? [],
          trade: (index) => {
            this.net?.sendTradeSelect(entityId, index);
            return true;
          },
          closed: () => {
            if (this.remoteTrade?.entityId === entityId) this.remoteTrade = null;
            this.net?.sendTradeClose(entityId);
          },
        };
        this.interaction.reset();
        this.ui.openTrade(view);
        this.input.unlock();
      },
      onTradeOffers: (entityId, offers) => {
        if (this.remoteTrade && this.remoteTrade.entityId === entityId) {
          this.remoteTrade.offers = offers;
        }
      },
      onSound: (name, x, y, z, volume, pitch) => {
        this.sound(name, x, y, z, volume, pitch);
      },
      onParticles: (kind, x, y, z, count, spread) => {
        this.particles(kind, x, y, z, count, spread);
      },
      onWorldClosed: (reason) => {
        if (this.disposed) return;
        this.onDisconnected?.(reason);
      },
      onDisconnect: (reason) => {
        if (this.disposed) return;
        this.onDisconnected?.(reason);
      },
    });
  }

  private requestMissingChunks(): void {
    if (!this.net) return;
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
    if (missing.length > 0) this.net.sendNeedChunks(missing);
  }

  netBreakBlock(x: number, y: number, z: number): void {
    this.net?.sendBreakBlock(x, y, z);
  }

  netPlaceBlock(x: number, y: number, z: number, face: number, id: number, meta: number, slot: number): void {
    this.net?.sendPlaceBlock(x, y, z, face, id, meta, slot);
  }

  netUseBlock(x: number, y: number, z: number): void {
    this.net?.sendUseBlock(x, y, z);
  }

  netDropItem(slot: number, all: boolean): void {
    this.net?.sendDropItem(slot, all);
  }

  netAttackEntity(entityId: number): void {
    this.net?.sendAttackEntity(entityId);
  }

  netAttackPlayer(playerId: number): void {
    this.net?.sendAttackPlayer(playerId);
  }

  netUseState(kind: UseKind): void {
    this.net?.sendUseState(kind);
  }

  netFinishEat(hand: 'main' | 'offhand'): void {
    this.net?.sendFinishEat(hand);
  }

  netShootBow(hand: 'main' | 'offhand', yaw: number, pitch: number): void {
    this.net?.sendShootBow(hand, yaw, pitch);
  }

  netThrowPotion(hand: 'main' | 'offhand', yaw: number, pitch: number): void {
    this.net?.sendThrowPotion(hand, yaw, pitch);
  }

  private sendRemoteInvSync(): void {
    if (!this.net) return;
    const inv = this.player.inventory;
    this.net.sendInvSync(
      saveSlots(inv.slots) as Array<SerializedSlot | null>,
      inv.selected,
      saveSlots(inv.armor) as Array<SerializedSlot | null>,
      saveSlots(inv.offhand)[0] as SerializedSlot | null,
    );
  }

  netInteractEntity(entityId: number): void {
    this.net?.sendInteractEntity(entityId);
  }

  netTieLeash(x: number, y: number, z: number): void {
    this.net?.sendTieLeash(x, y, z);
  }

  netOpenContainer(x: number, y: number, z: number): void {
    this.net?.sendOpenContainer(x, y, z);
  }

  private async findLocalServer(): Promise<string> {
    const candidates: string[] = [];
    if (typeof location !== 'undefined' && location.protocol.startsWith('http')) {
      const p = location.port || (location.protocol === 'https:' ? '443' : '80');
      if (p !== '5173' && p !== '5174' && p !== '5175') {
        candidates.push(location.origin);
      }
    }
    candidates.push('http://localhost:8080', 'http://127.0.0.1:8080');
    for (const s of loadRecentServers()) {
      const raw = s.address.trim();
      if (!raw) continue;
      const base = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`;
      if (!candidates.includes(base)) candidates.push(base);
    }

    for (const base of candidates) {
      try {
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 1200);
        const res = await fetch(`${base}/api/ping`, { signal: ctrl.signal });
        window.clearTimeout(timer);
        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean };
          if (data?.ok) return base;
        }
      } catch {
        // essayer suivant
      }
    }
    throw new Error(
      'Aucun serveur SarihBricks trouvé. Lancez « npm run serveur » dans un terminal ou ouvrez le jeu à l’adresse du serveur (http://localhost:8080).',
    );
  }

  async getSavedServerPassword(): Promise<string | null> {
    const serverUrl = await this.findLocalServer();
    const host = new URL(serverUrl).host.toLowerCase();
    const match = loadRecentServers().find((s) => s.address.toLowerCase() === host && s.password.length > 0);
    return match ? match.password : null;
  }

  async openToFriends(serverPassword?: string): Promise<{ inviteCode: string; inviteUrl?: string | null; tailscaleCode?: string | null; tailscaleUrl?: string | null }> {
    if (this.isRemote || !this.storage) {
      throw new Error('Impossible d’ouvrir ce monde aux amis.');
    }
    const serverUrl = await this.findLocalServer();
    const u = new URL(serverUrl);
    const saved = loadRecentServers().find((s) => s.address.toLowerCase() === u.host.toLowerCase())?.password ?? '';
    const password = serverPassword ?? saved;
    if (!password) {
      throw new Error('Mot de passe du serveur requis.');
    }

    await this.writeSave();
    const blob = await exportWorld(this.storage, this.info.id);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const hostName = (loadLastPseudo() || 'Hote').trim().slice(0, 16) || 'Hote';
    const res = await fetch(`${serverUrl}/api/open-world?name=${encodeURIComponent(hostName)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Server-Password': password,
      },
      body: bytes,
    });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      inviteCode?: string;
      inviteUrl?: string | null;
      tailscaleCode?: string | null;
      tailscaleUrl?: string | null;
      hostToken?: string;
    };
    if (!res.ok || !json.ok || !json.inviteCode || !json.hostToken) {
      throw new Error(json.error || 'Le serveur a refusé d’ouvrir le monde.');
    }

    const client = new NetClient();
    const welcome = await client.connect(`${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`, hostName, '', undefined, json.hostToken);

    saveRecentServer({ address: u.host, name: hostName, password });
    this.net = client;
    this.remoteId = welcome.id;
    this.isHost = true;
    this.inviteCode = json.inviteCode;
    this.inviteUrl = json.inviteUrl ?? null;
    this.tailscaleCode = json.tailscaleCode ?? null;
    this.tailscaleUrl = json.tailscaleUrl ?? null;
    this.hostToken = json.hostToken;
    this.hostServerUrl = serverUrl;
    this.requestedChunks.clear();
    this.chunks.setRemoteMode(true);
    this.attachNetHandlers(client);
    this.ui.addMessage(`Monde ouvert aux amis ! Code : ${json.inviteCode}`);
    return {
      inviteCode: json.inviteCode,
      inviteUrl: this.inviteUrl,
      tailscaleCode: this.tailscaleCode,
      tailscaleUrl: this.tailscaleUrl,
    };
  }

  async closeToFriends(): Promise<void> {
    if (!this.isHost || !this.hostServerUrl || !this.hostToken) return;
    const serverUrl = this.hostServerUrl;
    const token = this.hostToken;

    this.isHost = false;
    this.inviteCode = null;
    this.inviteUrl = null;
    this.tailscaleCode = null;
    this.tailscaleUrl = null;
    this.hostToken = null;
    this.hostServerUrl = null;
    this.voice?.dispose();
    this.voice = null;

    let archiveBuf: ArrayBuffer | null = null;
    try {
      const res = await fetch(`${serverUrl}/api/close-world`, {
        method: 'POST',
        headers: { 'X-Host-Token': token },
      });
      if (res.ok) {
        archiveBuf = await res.arrayBuffer();
      }
    } catch {
      // ignorer si déjà fermé
    }

    if (this.net) {
      this.net.close();
      this.net = null;
    }
    for (const rp of this.remotePlayers.values()) {
      const idx = this.entities.indexOf(rp);
      if (idx >= 0) this.entities.splice(idx, 1);
    }
    this.remotePlayers.clear();
    for (const re of this.remoteEntities.values()) {
      const idx = this.entities.indexOf(re);
      if (idx >= 0) this.entities.splice(idx, 1);
    }
    this.remoteEntities.clear();
    this.remoteContainer = null;
    this.remoteTrade = null;
    this.requestedChunks.clear();

    if (archiveBuf && this.storage) {
      await replaceWorldFromArchive(this.storage, this.info.id, archiveBuf);
      const keys = await this.storage.chunkKeys(this.info.id);
      this.entities.length = 0;
      this.entities.push(this.player);
      this.homes.clear();
      this.chunks.setRemoteMode(false, keys);
    } else {
      this.chunks.setRemoteMode(false);
    }
    this.ui.addMessage('Partie fermée aux amis. Le monde solo est à jour.');
  }

  private applyRemoteInventory(
    slots: Array<SerializedSlot | null>,
    selected: number,
    cursor?: SerializedSlot | null,
    armor?: Array<SerializedSlot | null>,
    offhand?: SerializedSlot | null,
  ): void {
    const inv = this.player.inventory;
    const loaded = loadSlots(slots, inv.slots.length);
    for (let i = 0; i < inv.slots.length; i++) {
      inv.slots[i] = loaded[i] ?? null;
    }
    if (armor) {
      const loadedArmor = loadSlots(armor, inv.armor.length);
      for (let i = 0; i < inv.armor.length; i++) {
        inv.armor[i] = loadedArmor[i] ?? null;
      }
    }
    if (offhand !== undefined) {
      inv.offhand[0] = offhand ? loadSlots([offhand], 1)[0] : null;
    }
    if (cursor !== undefined) {
      inv.cursor = cursor ? loadSlots([cursor], 1)[0] : null;
    }
    if (Number.isInteger(selected) && selected >= 0 && selected < HOTBAR_SIZE) {
      inv.selected = selected;
      this.lastSentSlot = selected;
    }
  }

  private tickRemote(): void {
    const p = this.player;
    this.time = (this.time + 1) % DAY_TICKS;
    this.rainLevel = approach(this.rainLevel, this.raining ? 1 : 0, 0.01);
    this.thunderLevel = approach(this.thunderLevel, this.thundering ? 1 : 0, 0.01);
    const light = skyDayFactor(this.dayTime) * (1 - (this.rainLevel * 5) / 16) * (1 - (this.thunderLevel * 5) / 16);
    this.world.skyDarken = Math.round((1 - light) * 11);
    this.world.raining = this.rainLevel > 0.2;

    if (p.sleeping) p.sleepTicks++;

    const cx = Math.floor(p.x) >> 4;
    const cz = Math.floor(p.z) >> 4;
    if (this.world.chunks.has(chunkKey(cx, cz))) {
      p.tick(this);
    }
    for (const rp of this.remotePlayers.values()) {
      rp.tick(this);
    }
    for (const re of this.remoteEntities.values()) {
      re.tick(this);
    }
    if (this.net && p.inventory.selected !== this.lastSentSlot) {
      this.lastSentSlot = p.inventory.selected;
      this.net.sendSelectSlot(p.inventory.selected);
    }
    if (this.net && p.useKind !== this.lastSentUseKind) {
      this.lastSentUseKind = p.useKind;
      this.net.sendUseState(p.useKind);
    }
    if (
      this.net &&
      (p.x !== this.lastSentX ||
        p.y !== this.lastSentY ||
        p.z !== this.lastSentZ ||
        p.yaw !== this.lastSentYaw ||
        p.headPitch !== this.lastSentPitch ||
        p.sneaking !== this.lastSentSneak ||
        p.swing !== this.lastSentSwing)
    ) {
      this.lastSentX = p.x;
      this.lastSentY = p.y;
      this.lastSentZ = p.z;
      this.lastSentYaw = p.yaw;
      this.lastSentPitch = p.headPitch;
      this.lastSentSneak = p.sneaking;
      this.lastSentSwing = p.swing;
      this.net.sendMove(p.x, p.y, p.z, p.yaw, p.headPitch, p.sneaking, p.onGround, p.swing, p.sprinting);
    }
  }
}
