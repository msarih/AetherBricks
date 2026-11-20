/**
 * Client WebSocket multijoueur : poignée de main, réception binaire des chunks et messages JSON.
 */
import { decodeChunkPacket, type ClientMessage, type RemotePlayerState, type ServerMessage } from './Protocol';
import type { GameMode } from '../world/Constants';

export type WelcomePacket = Extract<ServerMessage, { type: 'welcome' }>;

export interface ClientHandlers {
  onChunk(cx: number, cz: number, blocks: Uint8Array, meta: Uint8Array, biomes: Uint8Array, tints: Uint8Array): void;
  onPlayers(list: RemotePlayerState[]): void;
  onPlayerLeave(id: number, name: string): void;
  onChat(text: string): void;
  onTime(time: number): void;
  onGameMode(gameMode: GameMode): void;
  onTeleport(x: number, y: number, z: number): void;
  onDisconnect(reason: string): void;
}

/** Transforme une saisie libre (`192.168.1.12:8080`, `http://...`, `ws://...`) en URL WebSocket `/ws`. */
export function normalizeWsUrl(raw: string): string {
  let s = raw.trim();
  if (!s) throw new Error('Veuillez saisir l’adresse du serveur.');
  if (s.startsWith('http://')) s = 'ws://' + s.slice(7);
  else if (s.startsWith('https://')) s = 'wss://' + s.slice(8);
  else if (!s.startsWith('ws://') && !s.startsWith('wss://')) s = 'ws://' + s;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error('Adresse de serveur invalide.');
  }
  if (!u.port) u.port = '8080';
  if (!u.pathname || u.pathname === '/') u.pathname = '/ws';
  return u.toString();
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private handlers: ClientHandlers | null = null;
  private closedByClient = false;

  connect(address: string, name: string, password: string): Promise<WelcomePacket> {
    const wsUrl = normalizeWsUrl(address);
    const cleanName = name.trim();
    if (!cleanName) return Promise.reject(new Error('Veuillez saisir un pseudo.'));
    if (!password) return Promise.reject(new Error('Veuillez saisir le mot de passe du serveur.'));

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.closedByClient = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('Serveur injoignable (délai dépassé). Vérifiez l’adresse et le port.'));
      }, 6000);

      ws.onopen = () => {
        this.send({ type: 'join', name: cleanName, password });
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(new Error('Impossible de joindre le serveur. Vérifiez l’adresse et que le serveur est lancé.'));
      };

      ws.onclose = (ev) => {
        window.clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error(ev.reason || 'Connexion refusée ou fermée par le serveur.'));
          return;
        }
        if (!this.closedByClient) {
          this.handlers?.onDisconnect('Déconnecté du serveur.');
        }
      };

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          const pkt = decodeChunkPacket(ev.data);
          if (pkt) this.handlers?.onChunk(pkt.cx, pkt.cz, pkt.blocks, pkt.meta, pkt.biomes, pkt.tints);
          return;
        }
        if (typeof ev.data !== 'string') return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }
        if (!settled) {
          if (msg.type === 'welcome') {
            settled = true;
            window.clearTimeout(timer);
            resolve(msg);
            return;
          }
          if (msg.type === 'error') {
            settled = true;
            window.clearTimeout(timer);
            this.closedByClient = true;
            try {
              ws.close();
            } catch {
              // ignore
            }
            reject(new Error(msg.message));
            return;
          }
        }
        this.dispatch(msg);
      };
    });
  }

  setHandlers(handlers: ClientHandlers): void {
    this.handlers = handlers;
  }

  private dispatch(msg: ServerMessage): void {
    if (!this.handlers) return;
    switch (msg.type) {
      case 'players':
        this.handlers.onPlayers(msg.list);
        break;
      case 'playerLeave':
        this.handlers.onPlayerLeave(msg.id, msg.name);
        break;
      case 'chat':
        this.handlers.onChat(msg.text);
        break;
      case 'time':
        this.handlers.onTime(msg.time);
        break;
      case 'gamemode':
        this.handlers.onGameMode(msg.gameMode);
        break;
      case 'teleport':
        this.handlers.onTeleport(msg.x, msg.y, msg.z);
        break;
      case 'error':
        this.handlers.onChat(msg.message);
        break;
    }
  }

  sendMove(x: number, y: number, z: number, yaw: number, pitch: number, sneaking: boolean, onGround: boolean, swing: number): void {
    this.send({ type: 'move', x, y, z, yaw, pitch, sneaking, onGround, swing });
  }

  sendChat(text: string): void {
    this.send({ type: 'chat', text });
  }

  sendNeedChunks(keys: Array<[number, number]>): void {
    if (keys.length > 0) this.send({ type: 'needChunks', keys });
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closedByClient = true;
    this.handlers = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
