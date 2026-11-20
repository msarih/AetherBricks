/**
 * Serveur multijoueur autoritaire SarihBricks 3D (Jalon 1).
 *
 * - Sert le build de production (`dist/`) en HTTP et le WebSocket sur `/ws` sur le même port.
 * - Mot de passe toujours obligatoire (--password ou config.json).
 * - Simule le monde à 20 ticks par seconde en réutilisant `World` et `WorldGen`.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { encodeChunkPacket, type ClientMessage, type RemotePlayerState, type ServerMessage } from '../src/net/Protocol';
import { Chunk } from '../src/world/Chunk';
import { CHUNK_HEIGHT, DAY_TICKS, GEN_VERSION, TICKS_PER_SECOND, chunkKey, type GameMode, type WorldType } from '../src/world/Constants';
import { World } from '../src/world/World';
import { hashString } from '../src/world/gen/Noise';
import { WorldGen } from '../src/world/gen/WorldGen';

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
  seed: number;
  worldType: WorldType;
  gameMode: GameMode;
  time: number;
  spawn: { x: number; y: number; z: number };
}

interface ServerPlayer {
  id: number;
  name: string;
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
  lastMoveMs: number;
  lastChunkX: number;
  lastChunkZ: number;
  sentChunks: Set<number>;
}

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
  // 100.64.0.0/10 (100.64.0.0 - 100.127.255.255)
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

function findSpawnY(world: World, x: number, z: number): number {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  for (let y = CHUNK_HEIGHT - 2; y >= 1; y--) {
    if (world.getBlock(bx, y, bz) !== 0) return y + 1;
  }
  return 65;
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

  const password = typeof args.password === 'string' ? args.password : fileConfig.password ?? '';
  if (!password || password.trim() === '') {
    console.error('Erreur : un mot de passe est obligatoire pour démarrer le serveur.');
    console.error('Exemples :');
    console.error('  npm run serveur -- --password monsecret');
    console.error(`  ou créez ${path.relative(rootDir, configPath)} avec { "password": "monsecret" }`);
    process.exit(1);
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

  // Monde (chargement ou création)
  const worldSavePath = path.join(dataDir, 'worlds', 'default', 'world.json');
  const existingSave = readJsonFile<WorldSaveMeta>(worldSavePath);

  let worldType: WorldType = existingSave?.worldType ?? fileConfig.worldType ?? 'default';
  if (args.flat === true || args['world-type'] === 'flat') worldType = 'flat';
  else if (args['world-type'] === 'default') worldType = 'default';

  let gameMode: GameMode = existingSave?.gameMode ?? fileConfig.gameMode ?? 'survival';
  if (typeof args.gamemode === 'string' && GAMEMODE_ALIASES[args.gamemode.toLowerCase()]) {
    gameMode = GAMEMODE_ALIASES[args.gamemode.toLowerCase()];
  }

  const seed = existingSave?.seed ?? parseSeed(typeof args.seed === 'string' ? args.seed : fileConfig.seed);
  let worldTime = existingSave?.time ?? 1000;

  const world = new World();
  const gen = new WorldGen(seed, worldType, GEN_VERSION);

  function getOrGenerateChunk(cx: number, cz: number): Chunk {
    const existing = world.getChunk(cx, cz);
    if (existing) return existing;
    const g = gen.generateChunk(cx, cz);
    const chunk = new Chunk(cx, cz, g.blocks, g.meta, g.biomes, g.heightmap, g.tints);
    world.addChunk(chunk);
    return chunk;
  }

  // Générer le voisinage initial du spawn
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      getOrGenerateChunk(dx, dz);
    }
  }
  const spawn = existingSave?.spawn ?? { x: 8.5, y: findSpawnY(world, 8.5, 8.5), z: 8.5 };

  function saveWorldMeta(): void {
    const meta: WorldSaveMeta = { seed, worldType, gameMode, time: worldTime, spawn };
    writeJsonAtomic(worldSavePath, meta);
  }
  saveWorldMeta();

  // Joueurs connectés
  const players = new Map<number, ServerPlayer>();
  let nextPlayerId = 1;

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
    // Envoyer du centre vers l'extérieur
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

  function handleCommand(sender: ServerPlayer, raw: string): void {
    const parts = raw.slice(1).trim().split(/\s+/);
    const cmd = (parts[0] ?? '').toLowerCase();

    if (cmd === 'help' || cmd === '?') {
      sendJson(sender.ws, {
        type: 'chat',
        text: 'Commandes : /help, /tp <x y z | joueur>, /time <set|add|query>, /gamemode <mode> [joueur]',
      });
      return;
    }

    if (!allowCommands) {
      sendJson(sender.ws, { type: 'chat', text: 'Les commandes sont désactivées sur ce serveur.' });
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

  // Serveur HTTP pour dist/
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }
    const urlPath = (req.url ?? '/').split('?')[0];
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

  const wss = new WebSocketServer({ noServer: true });

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

  wss.on('connection', (ws) => {
    let player: ServerPlayer | null = null;
    const authTimer = setTimeout(() => {
      if (!player && ws.readyState === WebSocket.OPEN) {
        sendJson(ws, { type: 'error', code: 'bad_request', message: 'Délai de connexion dépassé.' });
        ws.close(1008, 'Timeout');
      }
    }, 5000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return; // Jalon 1 : client n'envoie pas de binaire
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
        if (typeof msg.password !== 'string' || msg.password !== password) {
          sendJson(ws, { type: 'error', code: 'bad_password', message: 'Mot de passe incorrect.' });
          ws.close(1008, 'Bad password');
          return;
        }
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

        const id = nextPlayerId++;
        player = {
          id,
          name: cleanName,
          ws,
          x: spawn.x,
          y: spawn.y,
          z: spawn.z,
          yaw: 0,
          pitch: 0,
          sneaking: false,
          onGround: true,
          swing: 0,
          gameMode,
          lastMoveMs: Date.now(),
          lastChunkX: Math.floor(spawn.x) >> 4,
          lastChunkZ: Math.floor(spawn.z) >> 4,
          sentChunks: new Set<number>(),
        };
        players.set(id, player);

        sendJson(ws, {
          type: 'welcome',
          id,
          name: cleanName,
          seed,
          worldType,
          gameMode,
          time: worldTime,
          spawn,
          viewDistance,
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: player.yaw,
          pitch: player.pitch,
        });

        streamChunksAround(player);
        broadcastJson({ type: 'chat', text: `${cleanName} a rejoint la partie` });
        console.log(`[+] ${cleanName} a rejoint (${players.size} joueur(s))`);
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
          // Correction autoritaire vers la dernière position valide
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

    if (players.size > 0) {
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
      saveWorldMeta();
    }
  }, 1000 / TICKS_PER_SECOND);

  function shutdown(): void {
    clearInterval(tickTimer);
    saveWorldMeta();
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
    console.log('=== Serveur SarihBricks 3D (Jalon 1) ===');
    console.log(`Monde : ${worldType === 'flat' ? 'Plat' : 'Normal'} | Graine : ${seed} | Mode : ${gameMode}`);
    console.log(`Mot de passe : requis | Port : ${port}`);
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
