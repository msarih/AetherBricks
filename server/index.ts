/**
 * Serveur multijoueur autoritaire SarihBricks 3D (Jalon 2).
 *
 * - Sert le build de production (`dist/`) en HTTP, expose `/api/*` et le WebSocket `/ws`.
 * - Supporte les codes d'invitation (« Ouvrir aux amis » / « Fermer aux amis »), l'import CLI (`--import`)
 *   et le mot de passe administrateur.
 * - Valide et diffuse la casse/pose de blocs, l'inventaire, le temps, la météo et la simulation du monde
 *   (gravité sable/gravier, écoulement eau/lave, feu, cultures) à 20 ticks/seconde.
 * - Sauvegarde les chunks modifiés et un fichier par joueur dans `server-data/`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { encodeInviteCode, parseInviteCode } from '../src/net/InviteCode';
import {
  decodeChunkPacket,
  encodeChunkPacket,
  type ClientMessage,
  type RemotePlayerState,
  type SerializedSlot,
  type ServerMessage,
} from '../src/net/Protocol';
import { BLOCKS, BLOCK_REPLACEABLE, BLOCK_SOLID, isFluid } from '../src/world/Blocks';
import { Chunk } from '../src/world/Chunk';
import { CHUNK_AREA, CHUNK_HEIGHT, DAY_TICKS, GEN_VERSION, TICKS_PER_SECOND, chunkKey, type GameMode, type WorldType } from '../src/world/Constants';
import { blockDrops } from '../src/world/Drops';
import { B } from '../src/world/Ids';
import { getItem, maxStack } from '../src/world/Items';
import { addToSlots, loadSlots, makeStack, saveSlots, type Slot } from '../src/world/ItemStack';
import type { SavedChunk, WorldInfo } from '../src/world/Storage';
import { World } from '../src/world/World';
import { buildWorldArchive, parseWorldArchive } from '../src/world/WorldFile';
import { hashString } from '../src/world/gen/Noise';
import { WorldGen, computeHeightmap } from '../src/world/gen/WorldGen';

interface ServerConfig {
  password?: string;
  port?: number;
  worldType?: WorldType;
  seed?: string | number;
  gameMode?: GameMode;
  viewDistance?: number;
  allowCommands?: boolean;
}

interface WorldSaveMeta {
  name?: string;
  seed: number;
  worldType: WorldType;
  gameMode: GameMode;
  genVersion?: number;
  time: number;
  raining?: boolean;
  thundering?: boolean;
  weatherTimer?: number;
  spawn: { x: number; y: number; z: number };
}

interface PlayerSaveData {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  gameMode: GameMode;
  health: number;
  hunger: number;
  slots: Array<SerializedSlot | null>;
  selected: number;
}

interface ServerPlayer {
  id: number;
  name: string;
  isHost: boolean;
  ws: WebSocket;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  sneaking: boolean;
  onGround: boolean;
  swing: number;
  gameMode: GameMode;
  health: number;
  hunger: number;
  slots: Slot[];
  selected: number;
  lastMoveMs: number;
  lastChunkX: number;
  lastChunkZ: number;
  sentChunks: Set<number>;
}

interface RateLimitEntry {
  fails: number;
  windowStart: number;
  blockedUntil: number;
}

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_HTTP_UPLOAD_BYTES = 64 * 1024 * 1024;
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX_FAILS = 5;
const AUTH_BASE_LOCK_MS = 5_000;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const TIME_NAMES: Record<string, number> = {
  day: 1000,
  jour: 1000,
  noon: 6000,
  midi: 6000,
  night: 13000,
  nuit: 13000,
  midnight: 18000,
  minuit: 18000,
};

const GAMEMODE_ALIASES: Record<string, GameMode> = {
  '0': 'survival',
  s: 'survival',
  survival: 'survival',
  survie: 'survival',
  '1': 'creative',
  c: 'creative',
  creative: 'creative',
  creatif: 'creative',
  '2': 'adventure',
  a: 'adventure',
  adventure: 'adventure',
  aventure: 'adventure',
  '3': 'spectator',
  sp: 'spectator',
  spectator: 'spectator',
  spectateur: 'spectator',
};

function parseSeed(raw: string | number | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw | 0;
  const s = String(raw ?? '').trim();
  if (s === '') return (Math.random() * 0x100000000) >>> 0;
  if (/^-?\d{1,15}$/.test(s)) return Number(s) | 0;
  return hashString(s);
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function isTailscaleIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function listNetworkAddresses(): { lan: string[]; tailscale: string[] } {
  const lan: string[] = [];
  const tailscale: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (isTailscaleIp(info.address)) tailscale.push(info.address);
      else lan.push(info.address);
    }
  }
  return { lan, tailscale };
}

function normalizeIp(raw: string | undefined): string {
  if (!raw) return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  if (raw === '::1') return '127.0.0.1';
  return raw;
}

function normalizePlayerFile(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .slice(0, 32) || 'player';
}

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function writeBinaryAtomic(filePath: string, data: Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function findSpawnY(world: World, x: number, z: number): number {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  for (let y = CHUNK_HEIGHT - 2; y >= 1; y--) {
    if (world.getBlock(bx, y, bz) !== 0) return y + 1;
  }
  return 65;
}

function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Fichier trop volumineux.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function chunkCoordsFromKey(key: number): [number, number] {
  const cx = Math.floor(key / 0x10000) - 0x8000;
  const cz = (key % 0x10000) - 0x8000;
  return [cx, cz];
}

function start(): void {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const distDir = path.resolve(rootDir, 'dist');
  const dataDir = path.resolve(rootDir, typeof args['data-dir'] === 'string' ? args['data-dir'] : 'server-data');
  const configPath = path.resolve(
    rootDir,
    typeof args.config === 'string' ? args.config : path.join(dataDir, 'config.json'),
  );
  const fileConfig = readJsonFile<ServerConfig>(configPath) ?? {};

  let password = typeof args.password === 'string' ? args.password : fileConfig.password ?? '';
  let generatedPassword = false;
  if (!password || password.trim() === '') {
    password = crypto.randomBytes(9).toString('base64url');
    generatedPassword = true;
  }

  const port = Number(typeof args.port === 'string' ? args.port : fileConfig.port ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Port invalide : ${port}`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.error('Erreur : dist/index.html introuvable. Lancez d’abord `npm run build`.');
    process.exit(1);
  }

  const viewDistanceRaw = Number(typeof args['view-distance'] === 'string' ? args['view-distance'] : fileConfig.viewDistance ?? 6);
  const viewDistance = Math.max(2, Math.min(8, Number.isFinite(viewDistanceRaw) ? Math.floor(viewDistanceRaw) : 6));
  const allowCommands = args['no-cheats'] ? false : fileConfig.allowCommands ?? true;

  const worldDir = path.join(dataDir, 'worlds', 'default');
  const worldSavePath = path.join(worldDir, 'world.json');
  const chunksDir = path.join(worldDir, 'chunks');
  const playersDir = path.join(worldDir, 'players');

  // Import CLI : npm run serveur -- --import chemin/monde.aetherworld
  if (typeof args.import === 'string') {
    const importPath = path.resolve(rootDir, args.import);
    if (!fs.existsSync(importPath)) {
      console.error(`Fichier introuvable : ${importPath}`);
      process.exit(1);
    }
    const archive = parseWorldArchive(fs.readFileSync(importPath));
    fs.rmSync(worldDir, { recursive: true, force: true });
    fs.mkdirSync(chunksDir, { recursive: true });
    const st = (archive.info.state ?? {}) as Record<string, unknown>;
    const rawSpawn = Array.isArray(st.spawn) && st.spawn.length === 3 ? (st.spawn as number[]) : [8.5, 65, 8.5];
    const meta: WorldSaveMeta = {
      name: archive.info.name,
      seed: archive.info.seed,
      worldType: archive.info.worldType,
      gameMode: archive.info.gameMode,
      genVersion: archive.info.genVersion ?? GEN_VERSION,
      time: typeof st.time === 'number' ? st.time : 1000,
      raining: st.raining === true,
      thundering: st.thundering === true,
      weatherTimer: typeof st.weatherTimer === 'number' ? st.weatherTimer : 12000,
      spawn: { x: rawSpawn[0], y: rawSpawn[1], z: rawSpawn[2] },
    };
    writeJsonAtomic(worldSavePath, meta);
    for (const c of archive.chunks) {
      const [cx, cz] = chunkCoordsFromKey(c.key);
      const pkt = encodeChunkPacket(cx, cz, c.blocks, c.meta, c.biomes, c.tints);
      writeBinaryAtomic(path.join(chunksDir, `${cx}_${cz}.bin`), pkt);
    }
    console.log(`Monde importé depuis ${importPath} (${archive.chunks.length} chunk(s)).`);
  }

  // État actif du monde
  let worldName = 'Monde multijoueur';
  let worldType: WorldType = 'default';
  let gameMode: GameMode = 'survival';
  let genVersion = GEN_VERSION;
  let seed = 0;
  let worldTime = 1000;
  let raining = false;
  let thundering = false;
  let weatherTimer = 12000 + Math.floor(Math.random() * 168000);
  let spawn = { x: 8.5, y: 65, z: 8.5 };
  let world!: World;
  let gen!: WorldGen;

  // Code d'invitation et jeton hôte ("Ouvrir aux amis")
  let inviteSecretHex: string | null = null;
  let hostToken: string | null = null;
  let activeInviteCode: string | null = null;

  const players = new Map<number, ServerPlayer>();
  let nextPlayerId = 1;
  const authLimits = new Map<string, RateLimitEntry>();

  function sendJson(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcastJson(msg: ServerMessage, exceptId = -1): void {
    const raw = JSON.stringify(msg);
    for (const p of players.values()) {
      if (p.id !== exceptId && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(raw);
      }
    }
  }

  function broadcastBlockUpdate(x: number, y: number, z: number, id: number, meta: number): void {
    const cx = x >> 4;
    const cz = z >> 4;
    const maxR = viewDistance + 2;
    const raw = JSON.stringify({ type: 'blockUpdate', x, y, z, id, meta } satisfies ServerMessage);
    for (const p of players.values()) {
      if (p.ws.readyState !== WebSocket.OPEN) continue;
      const pcx = Math.floor(p.x) >> 4;
      const pcz = Math.floor(p.z) >> 4;
      if (Math.abs(cx - pcx) <= maxR && Math.abs(cz - pcz) <= maxR) {
        p.ws.send(raw);
      }
    }
  }

  function attachWorldHost(w: World): void {
    w.host = {
      dropItem: () => {},
      spawnFallingBlock: (x, y, z, id, meta) => {
        let ly = y;
        while (ly > 0) {
          const below = w.getBlock(x, ly - 1, z);
          if (BLOCK_SOLID[below] === 1) break;
          ly--;
        }
        w.setBlock(x, ly, z, id, meta, true);
        return true;
      },
      primeTnt: () => {},
      effect: () => {},
      blockEntityRemoved: () => {},
      blockChanged: (x, y, z, id, meta) => {
        broadcastBlockUpdate(x, y, z, id, meta);
      },
    };
  }

  function initWorldFromDisk(): void {
    const existingSave = readJsonFile<WorldSaveMeta>(worldSavePath);
    worldName = existingSave?.name ?? 'Monde multijoueur';
    worldType = existingSave?.worldType ?? fileConfig.worldType ?? 'default';
    if (!existingSave) {
      if (args.flat === true || args['world-type'] === 'flat') worldType = 'flat';
      else if (args['world-type'] === 'default') worldType = 'default';
    }
    gameMode = existingSave?.gameMode ?? fileConfig.gameMode ?? 'survival';
    if (!existingSave && typeof args.gamemode === 'string' && GAMEMODE_ALIASES[args.gamemode.toLowerCase()]) {
      gameMode = GAMEMODE_ALIASES[args.gamemode.toLowerCase()];
    }
    genVersion = existingSave?.genVersion ?? GEN_VERSION;
    seed = existingSave?.seed ?? parseSeed(typeof args.seed === 'string' ? args.seed : fileConfig.seed);
    worldTime = existingSave?.time ?? 1000;
    raining = existingSave?.raining === true;
    thundering = existingSave?.thundering === true && raining;
    weatherTimer = existingSave?.weatherTimer ?? (12000 + Math.floor(Math.random() * 168000));

    world = new World(seed, worldType, genVersion);
    world.raining = raining;
    attachWorldHost(world);
    gen = new WorldGen(seed, worldType, genVersion);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        getOrGenerateChunk(dx, dz);
      }
    }
    spawn = existingSave?.spawn ?? { x: 8.5, y: findSpawnY(world, 8.5, 8.5), z: 8.5 };
    saveWorldMeta();
  }

  function getOrGenerateChunk(cx: number, cz: number): Chunk {
    const existing = world.getChunk(cx, cz);
    if (existing) return existing;

    const chunkFile = path.join(chunksDir, `${cx}_${cz}.bin`);
    if (fs.existsSync(chunkFile)) {
      const pkt = decodeChunkPacket(fs.readFileSync(chunkFile));
      if (pkt) {
        const hm = new Uint8Array(CHUNK_AREA);
        computeHeightmap(pkt.blocks, hm);
        const chunk = new Chunk(cx, cz, pkt.blocks, pkt.meta, pkt.biomes, hm, pkt.tints);
        chunk.saveDirty = false;
        world.addChunk(chunk);
        return chunk;
      }
    }

    const g = gen.generateChunk(cx, cz);
    const chunk = new Chunk(cx, cz, g.blocks, g.meta, g.biomes, g.heightmap, g.tints);
    chunk.saveDirty = false;
    world.addChunk(chunk);
    return chunk;
  }

  function saveWorldMeta(): void {
    const meta: WorldSaveMeta = {
      name: worldName,
      seed,
      worldType,
      gameMode,
      genVersion,
      time: worldTime,
      raining,
      thundering,
      weatherTimer,
      spawn,
    };
    writeJsonAtomic(worldSavePath, meta);
  }

  function saveDirtyChunks(): void {
    for (const chunk of world.chunks.values()) {
      if (!chunk.saveDirty) continue;
      const pkt = encodeChunkPacket(chunk.cx, chunk.cz, chunk.blocks, chunk.meta, chunk.biomes, chunk.tints);
      writeBinaryAtomic(path.join(chunksDir, `${chunk.cx}_${chunk.cz}.bin`), pkt);
      chunk.saveDirty = false;
    }
  }

  function savePlayerData(p: ServerPlayer): void {
    const data: PlayerSaveData = {
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      pitch: p.pitch,
      gameMode: p.gameMode,
      health: p.health,
      hunger: p.hunger,
      slots: saveSlots(p.slots) as Array<SerializedSlot | null>,
      selected: p.selected,
    };
    writeJsonAtomic(path.join(playersDir, `${normalizePlayerFile(p.name)}.json`), data);
  }

  function saveAll(): void {
    saveWorldMeta();
    saveDirtyChunks();
    for (const p of players.values()) {
      savePlayerData(p);
    }
  }

  initWorldFromDisk();

  function sendChunkToPlayer(p: ServerPlayer, cx: number, cz: number): void {
    if (p.ws.readyState !== WebSocket.OPEN) return;
    const key = chunkKey(cx, cz);
    if (p.sentChunks.has(key)) return;
    p.sentChunks.add(key);
    const chunk = getOrGenerateChunk(cx, cz);
    const pkt = encodeChunkPacket(cx, cz, chunk.blocks, chunk.meta, chunk.biomes, chunk.tints);
    p.ws.send(pkt);
  }

  function streamChunksAround(p: ServerPlayer): void {
    const pcx = Math.floor(p.x) >> 4;
    const pcz = Math.floor(p.z) >> 4;
    const r = viewDistance + 1;
    const coords: Array<[number, number, number]> = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= (r + 0.5) * (r + 0.5)) {
          coords.push([pcx + dx, pcz + dz, d2]);
        }
      }
    }
    coords.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of coords) {
      const key = chunkKey(cx, cz);
      if (!p.sentChunks.has(key)) {
        sendChunkToPlayer(p, cx, cz);
      }
    }
  }

  function findPlayerByName(name: string): ServerPlayer | undefined {
    const low = name.toLowerCase();
    for (const p of players.values()) {
      if (p.name.toLowerCase() === low) return p;
    }
    return undefined;
  }

  function sendInventory(p: ServerPlayer): void {
    sendJson(p.ws, {
      type: 'inventory',
      slots: saveSlots(p.slots) as Array<SerializedSlot | null>,
      selected: p.selected,
    });
  }

  function checkRateLimit(ip: string): number {
    const entry = authLimits.get(ip);
    if (!entry) return 0;
    const now = Date.now();
    if (entry.blockedUntil > now) {
      return Math.ceil((entry.blockedUntil - now) / 1000);
    }
    if (now - entry.windowStart > AUTH_WINDOW_MS) {
      authLimits.delete(ip);
    }
    return 0;
  }

  function recordAuthFailure(ip: string): number {
    const now = Date.now();
    let entry = authLimits.get(ip);
    if (!entry || now - entry.windowStart > AUTH_WINDOW_MS) {
      entry = { fails: 0, windowStart: now, blockedUntil: 0 };
      authLimits.set(ip, entry);
    }
    entry.fails++;
    if (entry.fails > AUTH_MAX_FAILS) {
      const lockMs = AUTH_BASE_LOCK_MS * Math.pow(2, Math.min(6, entry.fails - AUTH_MAX_FAILS - 1));
      entry.blockedUntil = now + lockMs;
      return Math.ceil(lockMs / 1000);
    }
    return 0;
  }

  function clearAuthFailure(ip: string): void {
    authLimits.delete(ip);
  }

  function closeHostedWorld(): Uint8Array {
    saveAll();
    inviteSecretHex = null;
    hostToken = null;
    activeInviteCode = null;

    // Collecter tous les chunks sauvegardés sur disque + en mémoire
    const chunkMap = new Map<number, SavedChunk>();
    if (fs.existsSync(chunksDir)) {
      for (const file of fs.readdirSync(chunksDir)) {
        if (!file.endsWith('.bin')) continue;
        const pkt = decodeChunkPacket(fs.readFileSync(path.join(chunksDir, file)));
        if (pkt) {
          chunkMap.set(chunkKey(pkt.cx, pkt.cz), {
            key: chunkKey(pkt.cx, pkt.cz),
            blocks: pkt.blocks,
            meta: pkt.meta,
            biomes: pkt.biomes,
            tints: pkt.tints,
            blockEntities: [],
            entities: [],
          });
        }
      }
    }
    for (const c of world.chunks.values()) {
      if (c.modified || chunkMap.has(c.key)) {
        chunkMap.set(c.key, {
          key: c.key,
          blocks: c.blocks,
          meta: c.meta,
          biomes: c.biomes,
          tints: c.tints,
          blockEntities: [],
          entities: [],
        });
      }
    }

    const hostPlayer = Array.from(players.values()).find((p) => p.isHost);
    const info: WorldInfo = {
      id: 'hosted',
      name: worldName,
      seed,
      worldType,
      gameMode: hostPlayer?.gameMode ?? gameMode,
      genVersion,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      state: {
        time: worldTime,
        raining,
        thundering,
        weatherTimer,
        spawn: [spawn.x, spawn.y, spawn.z],
        ...(hostPlayer
          ? {
              player: {
                x: hostPlayer.x,
                y: hostPlayer.y,
                z: hostPlayer.z,
                yaw: hostPlayer.yaw,
                pitch: hostPlayer.pitch,
                gameMode: hostPlayer.gameMode,
                health: hostPlayer.health,
                hunger: hostPlayer.hunger,
                inventory: {
                  slots: saveSlots(hostPlayer.slots),
                  selected: hostPlayer.selected,
                },
              },
            }
          : {}),
      },
    };

    const archiveBytes = buildWorldArchive(info, Array.from(chunkMap.values()));

    // Déconnecter les amis avec un message clair
    for (const p of Array.from(players.values())) {
      if (!p.isHost) {
        sendJson(p.ws, { type: 'worldClosed', reason: 'L’hôte a fermé la partie aux amis.' });
        p.ws.close(1000, 'L’hôte a fermé la partie aux amis.');
      } else {
        p.ws.close(1000, 'Fermeture aux amis.');
      }
    }
    players.clear();

    return archiveBytes;
  }

  function handleCommand(sender: ServerPlayer, raw: string): void {
    const parts = raw.slice(1).trim().split(/\s+/);
    const cmd = (parts[0] ?? '').toLowerCase();

    if (cmd === 'help' || cmd === '?') {
      const list = sender.isHost
        ? '/help, /tp <x y z | joueur>, /time <set|add|query>, /gamemode <mode> [joueur]'
        : '/help (les autres commandes sont réservées à l’hôte)';
      sendJson(sender.ws, { type: 'chat', text: `Commandes : ${list}` });
      return;
    }

    if (!allowCommands) {
      sendJson(sender.ws, { type: 'chat', text: 'Les commandes sont désactivées sur ce serveur.' });
      return;
    }

    if (!sender.isHost) {
      sendJson(sender.ws, { type: 'chat', text: 'Commande réservée à l’hôte.' });
      return;
    }

    if (cmd === 'time') {
      const sub = (parts[1] ?? '').toLowerCase();
      if (sub === 'query') {
        sendJson(sender.ws, { type: 'chat', text: `Heure actuelle : ${worldTime}` });
        return;
      }
      if (sub === 'set' && parts[2] !== undefined) {
        const named = TIME_NAMES[parts[2].toLowerCase()];
        const val = named !== undefined ? named : Number(parts[2]);
        if (!Number.isFinite(val)) {
          sendJson(sender.ws, { type: 'chat', text: 'Usage : /time set <valeur|day|noon|night|midnight>' });
          return;
        }
        worldTime = ((Math.floor(val) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
        broadcastJson({ type: 'time', time: worldTime });
        broadcastJson({ type: 'chat', text: `Heure fixée à ${worldTime}` });
        return;
      }
      if (sub === 'add' && parts[2] !== undefined) {
        const val = Number(parts[2]);
        if (!Number.isFinite(val)) {
          sendJson(sender.ws, { type: 'chat', text: 'Usage : /time add <ticks>' });
          return;
        }
        worldTime = ((worldTime + Math.floor(val)) % DAY_TICKS + DAY_TICKS) % DAY_TICKS;
        broadcastJson({ type: 'time', time: worldTime });
        broadcastJson({ type: 'chat', text: `Heure avancée à ${worldTime}` });
        return;
      }
      sendJson(sender.ws, { type: 'chat', text: 'Usage : /time <set|add|query> ...' });
      return;
    }

    if (cmd === 'gamemode' || cmd === 'gm') {
      const modeArg = (parts[1] ?? '').toLowerCase();
      const targetMode = GAMEMODE_ALIASES[modeArg];
      if (!targetMode) {
        sendJson(sender.ws, { type: 'chat', text: 'Usage : /gamemode <survival|creative|adventure|spectator> [joueur]' });
        return;
      }
      const target = parts[2] ? findPlayerByName(parts[2]) : sender;
      if (!target) {
        sendJson(sender.ws, { type: 'chat', text: `Joueur introuvable : ${parts[2]}` });
        return;
      }
      target.gameMode = targetMode;
      sendJson(target.ws, { type: 'gamemode', gameMode: targetMode });
      sendJson(sender.ws, { type: 'chat', text: `Mode de jeu de ${target.name} passé en ${targetMode}` });
      return;
    }

    if (cmd === 'tp') {
      if (parts.length === 2) {
        const dest = findPlayerByName(parts[1]);
        if (!dest) {
          sendJson(sender.ws, { type: 'chat', text: `Joueur introuvable : ${parts[1]}` });
          return;
        }
        sender.x = dest.x;
        sender.y = dest.y;
        sender.z = dest.z;
        sender.lastMoveMs = Date.now();
        sendJson(sender.ws, { type: 'teleport', x: sender.x, y: sender.y, z: sender.z });
        streamChunksAround(sender);
        sendJson(sender.ws, { type: 'chat', text: `Téléporté vers ${dest.name}` });
        return;
      }
      if (parts.length === 4) {
        const tx = Number(parts[1]);
        const ty = Number(parts[2]);
        const tz = Number(parts[3]);
        if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz) || ty < -10 || ty > 256) {
          sendJson(sender.ws, { type: 'chat', text: 'Coordonnées invalides.' });
          return;
        }
        sender.x = tx;
        sender.y = ty;
        sender.z = tz;
        sender.lastMoveMs = Date.now();
        sendJson(sender.ws, { type: 'teleport', x: tx, y: ty, z: tz });
        streamChunksAround(sender);
        sendJson(sender.ws, { type: 'chat', text: `Téléporté en ${tx.toFixed(1)}, ${ty.toFixed(1)}, ${tz.toFixed(1)}` });
        return;
      }
      sendJson(sender.ws, { type: 'chat', text: 'Usage : /tp <x> <y> <z> ou /tp <joueur>' });
      return;
    }

    sendJson(sender.ws, { type: 'chat', text: `Commande inconnue : /${cmd}. Tapez /help.` });
  }

  function isAllowedOrigin(origin: string, req: http.IncomingMessage): boolean {
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return true;
    const hostHeader = req.headers.host;
    if (hostHeader && (origin === `http://${hostHeader}` || origin === `https://${hostHeader}`)) return true;
    const reqPort = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (reqPort !== String(port)) return false;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    const { lan, tailscale } = listNetworkAddresses();
    return lan.includes(u.hostname) || tailscale.includes(u.hostname);
  }

  function applyCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const originHeader = req.headers.origin;
    if (!originHeader) return true;
    if (!isAllowedOrigin(originHeader, req)) return false;
    res.setHeader('Access-Control-Allow-Origin', originHeader);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Host-Token, X-Server-Password');
    return true;
  }

  // Serveur HTTP (dist/ + /api/*)
  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const rawUrl = req.url ?? '/';
    const urlObj = new URL(rawUrl, `http://localhost:${port}`);
    const urlPath = urlObj.pathname;

    if (method === 'OPTIONS' && urlPath.startsWith('/api/')) {
      if (!applyCorsHeaders(req, res)) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'GET' && urlPath === '/api/ping') {
      applyCorsHeaders(req, res);
      const pwHeader = req.headers['x-server-password'];
      const hasValidPw = typeof pwHeader === 'string' && pwHeader.length > 0 && safeEqualString(pwHeader, password);
      const payload: Record<string, unknown> = { ok: true, hosting: inviteSecretHex !== null, port };
      if (hasValidPw) payload.name = worldName;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }

    if (method === 'POST' && urlPath === '/api/open-world') {
      if (!applyCorsHeaders(req, res)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Origine non autorisée.' }));
        return;
      }

      const clientIp = normalizeIp(req.socket.remoteAddress);
      const waitSec = checkRateLimit(clientIp);
      if (waitSec > 0) {
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: `Trop d’essais ratés. Veuillez patienter ${waitSec} s.` }));
        return;
      }

      const pwHeader = req.headers['x-server-password'];
      const suppliedPw = typeof pwHeader === 'string' ? pwHeader : '';
      if (!suppliedPw || !safeEqualString(suppliedPw, password)) {
        const lockSec = recordAuthFailure(clientIp);
        const status = lockSec > 0 ? 429 : 401;
        const error =
          lockSec > 0
            ? `Trop d’essais ratés. Veuillez patienter ${lockSec} s.`
            : suppliedPw
              ? 'Mot de passe du serveur incorrect.'
              : 'Mot de passe du serveur requis.';
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error }));
        return;
      }
      clearAuthFailure(clientIp);

      if (inviteSecretHex !== null) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Un monde est déjà ouvert aux amis : fermez-le d’abord.' }));
        return;
      }

      try {
        const body = await readRequestBody(req, MAX_HTTP_UPLOAD_BYTES);
        const archive = parseWorldArchive(body);

        // Sauvegarder tout monde déjà présent sur disque (ex. import CLI) avant de le remplacer
        if (fs.existsSync(worldDir)) {
          saveAll();
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const backupDir = path.join(dataDir, 'backups', `world-${stamp}`);
          fs.mkdirSync(path.dirname(backupDir), { recursive: true });
          fs.renameSync(worldDir, backupDir);
          console.log(`[Hôte] Ancien monde sauvegardé dans ${backupDir}`);
        }

        // Fermer d'éventuels joueurs précédents
        for (const p of Array.from(players.values())) {
          sendJson(p.ws, { type: 'worldClosed', reason: 'Un nouveau monde a été ouvert par l’hôte.' });
          p.ws.close(1000, 'Nouveau monde');
        }
        players.clear();

        fs.mkdirSync(chunksDir, { recursive: true });
        fs.mkdirSync(playersDir, { recursive: true });

        const st = (archive.info.state ?? {}) as Record<string, unknown>;
        const rawSpawn = Array.isArray(st.spawn) && st.spawn.length === 3 ? (st.spawn as number[]) : [8.5, 65, 8.5];

        worldName = archive.info.name;
        seed = archive.info.seed;
        worldType = archive.info.worldType;
        gameMode = archive.info.gameMode;
        genVersion = archive.info.genVersion ?? GEN_VERSION;
        worldTime = typeof st.time === 'number' ? st.time : 1000;
        raining = st.raining === true;
        thundering = st.thundering === true && raining;
        weatherTimer = typeof st.weatherTimer === 'number' ? st.weatherTimer : 12000;
        spawn = { x: rawSpawn[0], y: rawSpawn[1], z: rawSpawn[2] };

        world = new World(seed, worldType, genVersion);
        world.raining = raining;
        attachWorldHost(world);
        gen = new WorldGen(seed, worldType, genVersion);

        for (const c of archive.chunks) {
          const [cx, cz] = chunkCoordsFromKey(c.key);
          const hm = new Uint8Array(CHUNK_AREA);
          computeHeightmap(c.blocks, hm);
          const chunk = new Chunk(cx, cz, c.blocks, c.meta, c.biomes, hm, c.tints);
          chunk.modified = true;
          chunk.saveDirty = true;
          world.addChunk(chunk);
        }

        const hostName = (urlObj.searchParams.get('name') ?? 'Hote').trim().slice(0, 16) || 'Hote';
        const pState = st.player && typeof st.player === 'object' ? (st.player as Record<string, unknown>) : null;
        if (pState) {
          const invRaw = pState.inventory && typeof pState.inventory === 'object' ? (pState.inventory as Record<string, unknown>) : null;
          const pos = Array.isArray(pState.pos) && pState.pos.length === 3 ? (pState.pos as number[]) : null;
          const pSave: PlayerSaveData = {
            x: pos ? pos[0] : typeof pState.x === 'number' ? pState.x : spawn.x,
            y: pos ? pos[1] : typeof pState.y === 'number' ? pState.y : spawn.y,
            z: pos ? pos[2] : typeof pState.z === 'number' ? pState.z : spawn.z,
            yaw: typeof pState.yaw === 'number' ? pState.yaw : 0,
            pitch: typeof pState.pitch === 'number' ? pState.pitch : 0,
            gameMode:
              pState.gameMode === 'creative' || pState.gameMode === 'adventure' || pState.gameMode === 'spectator'
                ? pState.gameMode
                : gameMode,
            health: typeof pState.health === 'number' ? pState.health : 20,
            hunger: typeof pState.hunger === 'number' ? pState.hunger : 20,
            slots: invRaw && Array.isArray(invRaw.slots) ? (invRaw.slots as Array<SerializedSlot | null>) : [],
            selected: invRaw && typeof invRaw.selected === 'number' ? invRaw.selected : 0,
          };
          writeJsonAtomic(path.join(playersDir, `${normalizePlayerFile(hostName)}.json`), pSave);
        }

        saveAll();

        const secret = crypto.randomBytes(6); // 48 bits >= 40 bits
        inviteSecretHex = secret.toString('hex');
        hostToken = crypto.randomBytes(16).toString('hex');

        const { lan, tailscale } = listNetworkAddresses();
        const hostHeader = (req.headers.host ?? '').split(':')[0];
        const primaryIp = hostHeader === '127.0.0.1' ? '127.0.0.1' : lan[0] ?? '127.0.0.1';
        const inviteCode = encodeInviteCode(primaryIp, port, secret);
        const tailscaleCode = tailscale[0] ? encodeInviteCode(tailscale[0], port, secret) : null;
        activeInviteCode = inviteCode;

        console.log(`[Hôte] Monde « ${worldName} » ouvert aux amis par ${hostName} — Code : ${inviteCode}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, inviteCode, tailscaleCode, hostToken, port }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'Erreur d’ouverture du monde.' }));
      }
      return;
    }

    if (method === 'POST' && urlPath === '/api/close-world') {
      if (!applyCorsHeaders(req, res)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Origine non autorisée.' }));
        return;
      }
      const token = (req.headers['x-host-token'] as string | undefined) ?? urlObj.searchParams.get('token') ?? '';
      if (!hostToken || !safeEqualString(token, hostToken)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Action réservée à l’hôte.' }));
        return;
      }
      const archiveBytes = closeHostedWorld();
      console.log(`[Hôte] Monde « ${worldName} » fermé aux amis.`);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(archiveBytes.length),
      });
      res.end(Buffer.from(archiveBytes));
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    let relPath = decodeURIComponent(urlPath);
    if (relPath === '/' || relPath === '') relPath = '/index.html';
    const filePath = path.resolve(distDir, `.${relPath}`);
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    let target = filePath;
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      target = path.join(distDir, 'index.html');
    }
    const ext = path.extname(target).toLowerCase();
    const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on('upgrade', (req, socket, head) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    if (urlPath !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const clientIp = normalizeIp(req.socket.remoteAddress);
    let player: ServerPlayer | null = null;
    const authTimer = setTimeout(() => {
      if (!player && ws.readyState === WebSocket.OPEN) {
        sendJson(ws, { type: 'error', code: 'bad_request', message: 'Délai de connexion dépassé.' });
        ws.close(1008, 'Timeout');
      }
    }, 5000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (!player) {
        if (msg.type !== 'join') return;
        clearTimeout(authTimer);

        const waitSec = checkRateLimit(clientIp);
        if (waitSec > 0) {
          sendJson(ws, {
            type: 'error',
            code: 'rate_limited',
            message: `Trop d’essais ratés. Veuillez patienter ${waitSec} s.`,
          });
          ws.close(1008, 'Rate limited');
          return;
        }

        let isHost = false;
        let authOk = false;

        if (typeof msg.hostToken === 'string' && msg.hostToken.length > 0) {
          if (hostToken && safeEqualString(msg.hostToken, hostToken)) {
            authOk = true;
            isHost = true;
          }
        } else if (typeof msg.code === 'string' && msg.code.trim().length > 0) {
          const parsed = parseInviteCode(msg.code);
          if (parsed && inviteSecretHex && safeEqualString(parsed.secretHex, inviteSecretHex)) {
            authOk = true;
            isHost = false;
          } else {
            const lockSec = recordAuthFailure(clientIp);
            const message =
              lockSec > 0
                ? `Trop d’essais ratés. Veuillez patienter ${lockSec} s.`
                : 'Code d’invitation invalide ou expiré.';
            sendJson(ws, { type: 'error', code: lockSec > 0 ? 'rate_limited' : 'bad_code', message });
            ws.close(1008, 'Bad code');
            return;
          }
        } else if (typeof msg.password === 'string' && msg.password.length > 0) {
          if (safeEqualString(msg.password, password)) {
            authOk = true;
            isHost = true;
          } else {
            const lockSec = recordAuthFailure(clientIp);
            const message =
              lockSec > 0
                ? `Trop d’essais ratés. Veuillez patienter ${waitSec || lockSec} s.`
                : 'Mot de passe incorrect.';
            sendJson(ws, { type: 'error', code: lockSec > 0 ? 'rate_limited' : 'bad_password', message });
            ws.close(1008, 'Bad password');
            return;
          }
        }

        if (!authOk) {
          const lockSec = recordAuthFailure(clientIp);
          sendJson(ws, {
            type: 'error',
            code: lockSec > 0 ? 'rate_limited' : 'bad_password',
            message: lockSec > 0 ? `Trop d’essais ratés. Veuillez patienter ${lockSec} s.` : 'Mot de passe ou code requis.',
          });
          ws.close(1008, 'Auth failed');
          return;
        }

        clearAuthFailure(clientIp);

        const cleanName = typeof msg.name === 'string' ? msg.name.trim() : '';
        if (cleanName.length < 1 || cleanName.length > 16 || /[\x00-\x1f<>]/.test(cleanName)) {
          sendJson(ws, { type: 'error', code: 'bad_name', message: 'Pseudo invalide (1 à 16 caractères).' });
          ws.close(1008, 'Bad name');
          return;
        }
        if (findPlayerByName(cleanName)) {
          sendJson(ws, { type: 'error', code: 'name_taken', message: 'Ce pseudo est déjà utilisé sur ce serveur.' });
          ws.close(1008, 'Name taken');
          return;
        }

        const savedPlayer = readJsonFile<PlayerSaveData>(path.join(playersDir, `${normalizePlayerFile(cleanName)}.json`));
        const id = nextPlayerId++;
        player = {
          id,
          name: cleanName,
          isHost,
          ws,
          x: savedPlayer?.x ?? spawn.x,
          y: savedPlayer?.y ?? spawn.y,
          z: savedPlayer?.z ?? spawn.z,
          yaw: savedPlayer?.yaw ?? 0,
          pitch: savedPlayer?.pitch ?? 0,
          sneaking: false,
          onGround: true,
          swing: 0,
          gameMode: savedPlayer?.gameMode ?? gameMode,
          health: savedPlayer?.health ?? 20,
          hunger: savedPlayer?.hunger ?? 20,
          slots: savedPlayer ? loadSlots(savedPlayer.slots, 36) : new Array<Slot>(36).fill(null),
          selected: savedPlayer && Number.isInteger(savedPlayer.selected) ? Math.max(0, Math.min(8, savedPlayer.selected)) : 0,
          lastMoveMs: Date.now(),
          lastChunkX: Math.floor(savedPlayer?.x ?? spawn.x) >> 4,
          lastChunkZ: Math.floor(savedPlayer?.z ?? spawn.z) >> 4,
          sentChunks: new Set<number>(),
        };
        players.set(id, player);

        sendJson(ws, {
          type: 'welcome',
          id,
          name: cleanName,
          isHost,
          seed,
          worldType,
          gameMode: player.gameMode,
          time: worldTime,
          raining,
          thundering,
          spawn,
          viewDistance,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          pitch: player.pitch,
          health: player.health,
          hunger: player.hunger,
          inventory: {
            slots: saveSlots(player.slots) as Array<SerializedSlot | null>,
            selected: player.selected,
          },
          ...(isHost && activeInviteCode ? { inviteCode: activeInviteCode } : {}),
        });

        streamChunksAround(player);
        broadcastJson({ type: 'chat', text: `${cleanName} a rejoint la partie` });
        console.log(`[+] ${cleanName}${isHost ? ' (hôte)' : ''} a rejoint (${players.size} joueur(s))`);
        return;
      }

      // Messages authentifiés
      if (msg.type === 'move') {
        const { x, y, z, yaw, pitch, sneaking, onGround, swing } = msg;
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(z) ||
          !Number.isFinite(yaw) ||
          !Number.isFinite(pitch) ||
          y < -16 ||
          y > 256
        ) {
          return;
        }
        const now = Date.now();
        const dt = Math.max(0.05, Math.min(1, (now - player.lastMoveMs) / 1000));
        const maxSpeed = player.gameMode === 'creative' || player.gameMode === 'spectator' ? 40 : 20;
        const maxDist = maxSpeed * dt + 3.0;
        const dist = Math.hypot(x - player.x, y - player.y, z - player.z);
        if (dist > maxDist) {
          sendJson(ws, { type: 'teleport', x: player.x, y: player.y, z: player.z });
          return;
        }

        player.x = x;
        player.y = y;
        player.z = z;
        player.yaw = yaw;
        player.pitch = pitch;
        player.sneaking = Boolean(sneaking);
        player.onGround = Boolean(onGround);
        player.swing = Number.isFinite(swing) ? Math.max(0, Math.min(1, swing)) : 0;
        player.lastMoveMs = now;

        const cx = Math.floor(x) >> 4;
        const cz = Math.floor(z) >> 4;
        if (cx !== player.lastChunkX || cz !== player.lastChunkZ) {
          player.lastChunkX = cx;
          player.lastChunkZ = cz;
          streamChunksAround(player);
        }
        return;
      }

      if (msg.type === 'breakBlock') {
        const { x, y, z } = msg;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return;
        if (y < 0 || y >= CHUNK_HEIGHT) return;
        if (player.gameMode === 'adventure' || player.gameMode === 'spectator') return;
        if (!world.isLoaded(x, z)) return;
        const dist = Math.hypot(x + 0.5 - player.x, y + 0.5 - (player.y + 1.62), z + 0.5 - player.z);
        if (dist > 7.0) return;

        const v = world.getBlockAndMeta(x, y, z);
        const id = v & 255;
        const meta = v >> 8;
        if (id === B.AIR || isFluid(id)) return;
        const def = BLOCKS[id];
        if (!def || (def.hardness < 0 && player.gameMode !== 'creative')) return;

        if (player.gameMode === 'survival') {
          const held = player.slots[player.selected]?.id ?? 0;
          const drops = blockDrops(id, meta, held, world.rng, 0, false);
          for (const d of drops) {
            const max = maxStack(d.id);
            let rem = d.count;
            while (rem > 0) {
              const n = Math.min(max, rem);
              rem -= n;
              addToSlots(player.slots, makeStack(d.id, n), 0, 36);
            }
          }
          sendInventory(player);
        }

        world.setBlock(x, y, z, B.AIR, 0, true);
        return;
      }

      if (msg.type === 'placeBlock') {
        const { x, y, z, id, meta, slot } = msg;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return;
        if (!Number.isInteger(id) || !Number.isInteger(meta) || id <= 0 || id >= 256 || meta < 0 || meta > 255) return;
        if (y < 0 || y >= CHUNK_HEIGHT) return;
        if (player.gameMode === 'adventure' || player.gameMode === 'spectator') return;
        if (!world.isLoaded(x, z)) return;
        const dist = Math.hypot(x + 0.5 - player.x, y + 0.5 - (player.y + 1.62), z + 0.5 - player.z);
        if (dist > 7.0) return;

        const existing = world.getBlock(x, y, z);
        if (BLOCK_REPLACEABLE[existing] !== 1) return;

        if (BLOCK_SOLID[id] === 1) {
          for (const other of players.values()) {
            const hw = 0.3;
            if (
              other.x + hw > x &&
              other.x - hw < x + 1 &&
              other.y + 1.8 > y &&
              other.y < y + 1 &&
              other.z + hw > z &&
              other.z - hw < z + 1
            ) {
              return;
            }
          }
        }

        if (player.gameMode === 'survival') {
          const idx = Number.isInteger(slot) && slot >= 0 && slot < 36 ? slot : player.selected;
          const s = player.slots[idx];
          if (!s || s.count <= 0 || getItem(s.id).places !== id) {
            sendInventory(player);
            sendJson(ws, { type: 'blockUpdate', x, y, z, id: existing, meta: world.getMeta(x, y, z) });
            return;
          }
          s.count -= 1;
          if (s.count <= 0) player.slots[idx] = null;
          sendInventory(player);
        }

        world.setBlock(x, y, z, id, meta, true);
        return;
      }

      if (msg.type === 'selectSlot') {
        if (Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < 9) {
          player.selected = msg.slot;
        }
        return;
      }

      if (msg.type === 'invSync' && Array.isArray(msg.slots)) {
        if (player.gameMode === 'creative') {
          player.slots = loadSlots(msg.slots, 36);
        } else if (player.gameMode === 'survival') {
          // Autoriser la réorganisation/fabrication locale tout en bornant les quantités
          const next = loadSlots(msg.slots, 36);
          for (let i = 0; i < 36; i++) {
            const s = next[i];
            if (s && s.count > 64) s.count = 64;
          }
          player.slots = next;
        }
        if (Number.isInteger(msg.selected) && msg.selected >= 0 && msg.selected < 9) {
          player.selected = msg.selected;
        }
        return;
      }

      if (msg.type === 'closeWorld') {
        if (!player.isHost) {
          sendJson(ws, { type: 'error', code: 'not_host', message: 'Seul l’hôte peut fermer le monde.' });
          return;
        }
        closeHostedWorld();
        return;
      }

      if (msg.type === 'needChunks' && Array.isArray(msg.keys)) {
        const pcx = Math.floor(player.x) >> 4;
        const pcz = Math.floor(player.z) >> 4;
        const maxR = viewDistance + 2;
        for (const pair of msg.keys) {
          if (!Array.isArray(pair) || pair.length !== 2) continue;
          const cx = Number(pair[0]);
          const cz = Number(pair[1]);
          if (!Number.isInteger(cx) || !Number.isInteger(cz)) continue;
          if (Math.abs(cx - pcx) <= maxR && Math.abs(cz - pcz) <= maxR) {
            sendChunkToPlayer(player, cx, cz);
          }
        }
        return;
      }

      if (msg.type === 'chat' && typeof msg.text === 'string') {
        const text = msg.text.trim().slice(0, 256);
        if (!text) return;
        if (text.startsWith('/')) {
          handleCommand(player, text);
        } else {
          broadcastJson({ type: 'chat', text: `<${player.name}> ${text}`, sender: player.name });
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!player) return;
      savePlayerData(player);
      players.delete(player.id);
      broadcastJson({ type: 'playerLeave', id: player.id, name: player.name });
      broadcastJson({ type: 'chat', text: `${player.name} a quitté la partie` });
      console.log(`[-] ${player.name} a quitté (${players.size} joueur(s))`);
    });
  });

  // Boucle 20 TPS
  let tickCount = 0;
  const tickTimer = setInterval(() => {
    tickCount++;
    worldTime = (worldTime + 1) % DAY_TICKS;

    // Météo
    if (--weatherTimer <= 0) {
      const prevR = raining;
      const prevT = thundering;
      if (raining) {
        raining = false;
        thundering = false;
        weatherTimer = 12000 + Math.floor(Math.random() * 168000);
      } else {
        raining = true;
        thundering = Math.random() < 0.3;
        weatherTimer = 12000 + Math.floor(Math.random() * 12000);
      }
      world.raining = raining;
      if (prevR !== raining || prevT !== thundering) {
        broadcastJson({ type: 'weather', raining, thundering });
      }
    }

    if (players.size > 0) {
      const firstPlayer = players.values().next().value;
      if (firstPlayer) {
        world.tick(firstPlayer.x, firstPlayer.z);
      }
      const list: RemotePlayerState[] = [];
      for (const p of players.values()) {
        list.push({
          id: p.id,
          name: p.name,
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw,
          pitch: p.pitch,
          sneaking: p.sneaking,
          swing: p.swing,
          gameMode: p.gameMode,
        });
      }
      broadcastJson({ type: 'players', list });
      if (tickCount % TICKS_PER_SECOND === 0) {
        broadcastJson({ type: 'time', time: worldTime });
      }
    }

    if (tickCount % (TICKS_PER_SECOND * 30) === 0) {
      saveAll();
    }
  }, 1000 / TICKS_PER_SECOND);

  function shutdown(): void {
    clearInterval(tickTimer);
    saveAll();
    for (const p of players.values()) {
      p.ws.close(1001, 'Serveur arrêté');
    }
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(port, '0.0.0.0', () => {
    const { lan, tailscale } = listNetworkAddresses();
    console.log('');
    console.log('=== Serveur SarihBricks 3D (Jalon 2) ===');
    console.log(`Monde : ${worldName} (${worldType === 'flat' ? 'Plat' : 'Normal'}) | Graine : ${seed} | Mode : ${gameMode}`);
    console.log(`Port  : ${port}${generatedPassword ? ` | Mot de passe admin généré : ${password}` : ' | Mot de passe : requis'}`);
    console.log(`Local     : http://localhost:${port}`);
    for (const ip of lan) {
      console.log(`Wi-Fi LAN : http://${ip}:${port}`);
    }
    for (const ip of tailscale) {
      console.log(`Tailscale : http://${ip}:${port}`);
    }
    console.log('=======================================');
    console.log('');
  });
}

start();
