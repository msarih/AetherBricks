/**
 * Protocole réseau multijoueur (Jalon 1) : messages JSON et paquets binaires RLE.
 *
 * Module pur (aucune dépendance DOM ni Three.js) : partagé entre le serveur Node.js et le client.
 */
import { CHUNK_AREA, CHUNK_VOLUME, type GameMode, type WorldType } from '../world/Constants';
import { rleDecode, rleEncode } from '../world/Storage';

export const CHUNK_TINTS = CHUNK_AREA * 9;
export const BINARY_CHUNK_TAG = 0x01;

export interface SerializedSlot {
  id: number;
  count: number;
  damage: number;
  enchants?: Record<string, number>;
  potion?: string;
}

export interface RemotePlayerState {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  sneaking: boolean;
  swing: number;
  gameMode: GameMode;
}

export type ClientMessage =
  | { type: 'join'; name: string; password?: string; code?: string; hostToken?: string }
  | { type: 'move'; x: number; y: number; z: number; yaw: number; pitch: number; sneaking: boolean; onGround: boolean; swing: number }
  | { type: 'chat'; text: string }
  | { type: 'needChunks'; keys: Array<[number, number]> }
  | { type: 'breakBlock'; x: number; y: number; z: number }
  | { type: 'placeBlock'; x: number; y: number; z: number; face: number; id: number; meta: number; slot: number }
  | { type: 'selectSlot'; slot: number }
  | { type: 'invSync'; slots: Array<SerializedSlot | null>; selected: number }
  | { type: 'rtcSignal'; to: number; kind: 'offer' | 'answer' | 'ice'; payload: unknown }
  | { type: 'rtcState'; mic: boolean; cam: boolean; speaking: boolean }
  | { type: 'closeWorld' };

export type ErrorCode =
  | 'bad_password'
  | 'bad_code'
  | 'rate_limited'
  | 'name_taken'
  | 'bad_name'
  | 'server_full'
  | 'not_host'
  | 'bad_request';

export type ServerMessage =
  | {
      type: 'welcome';
      id: number;
      name: string;
      isHost: boolean;
      seed: number;
      worldType: WorldType;
      gameMode: GameMode;
      time: number;
      raining: boolean;
      thundering: boolean;
      spawn: { x: number; y: number; z: number };
      viewDistance: number;
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
      health?: number;
      hunger?: number;
      inventory?: { slots: Array<SerializedSlot | null>; selected: number };
      inviteCode?: string;
      inviteUrl?: string;
      tailscaleCode?: string | null;
      tailscaleUrl?: string | null;
    }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'players'; list: RemotePlayerState[] }
  | { type: 'playerLeave'; id: number; name: string }
  | { type: 'chat'; text: string; sender?: string }
  | { type: 'time'; time: number }
  | { type: 'weather'; raining: boolean; thundering: boolean }
  | { type: 'gamemode'; gameMode: GameMode }
  | { type: 'teleport'; x: number; y: number; z: number }
  | { type: 'blockUpdate'; x: number; y: number; z: number; id: number; meta: number }
  | { type: 'inventory'; slots: Array<SerializedSlot | null>; selected: number }
  | { type: 'vitals'; health: number; hunger: number }
  | { type: 'rtcSignal'; from: number; kind: 'offer' | 'answer' | 'ice'; payload: unknown }
  | { type: 'rtcState'; id: number; mic: boolean; cam: boolean; speaking: boolean }
  | { type: 'worldClosed'; reason: string };

/** Encode un chunk en paquet binaire RLE (tag + cx + cz + blocksRLE + metaRLE + biomes + tints). */
export function encodeChunkPacket(
  cx: number,
  cz: number,
  blocks: Uint8Array,
  meta: Uint8Array,
  biomes: Uint8Array,
  tints: Uint8Array,
): Uint8Array {
  const bEnc = rleEncode(blocks);
  const mEnc = rleEncode(meta);
  const total = 1 + 4 + 4 + 4 + bEnc.length + 4 + mEnc.length + CHUNK_AREA + CHUNK_TINTS;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let off = 0;
  out[off++] = BINARY_CHUNK_TAG;
  view.setInt32(off, cx, true);
  off += 4;
  view.setInt32(off, cz, true);
  off += 4;
  view.setUint32(off, bEnc.length, true);
  off += 4;
  out.set(bEnc, off);
  off += bEnc.length;
  view.setUint32(off, mEnc.length, true);
  off += 4;
  out.set(mEnc, off);
  off += mEnc.length;
  out.set(biomes.subarray(0, CHUNK_AREA), off);
  off += CHUNK_AREA;
  out.set(tints.subarray(0, CHUNK_TINTS), off);
  return out;
}

/** Décode un paquet binaire RLE de chunk. */
export function decodeChunkPacket(buf: ArrayBuffer | Uint8Array): {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
  tints: Uint8Array;
} | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 17 || bytes[0] !== BINARY_CHUNK_TAG) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 1;
  const cx = view.getInt32(off, true);
  off += 4;
  const cz = view.getInt32(off, true);
  off += 4;
  const bLen = view.getUint32(off, true);
  off += 4;
  if (off + bLen + 4 > bytes.length) return null;
  const blocks = rleDecode(bytes.subarray(off, off + bLen), CHUNK_VOLUME);
  off += bLen;
  const mLen = view.getUint32(off, true);
  off += 4;
  if (off + mLen + CHUNK_AREA + CHUNK_TINTS > bytes.length) return null;
  const meta = rleDecode(bytes.subarray(off, off + mLen), CHUNK_VOLUME);
  off += mLen;
  const biomes = bytes.slice(off, off + CHUNK_AREA);
  off += CHUNK_AREA;
  const tints = bytes.slice(off, off + CHUNK_TINTS);
  return { cx, cz, blocks, meta, biomes, tints };
}
