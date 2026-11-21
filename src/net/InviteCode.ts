/**
 * Encodage et décodage des codes d'invitation multijoueur.
 *
 * Format : `SB-XXXXX-XXXXX-XXXXX-XXXXX` (20 caractères en Base31 sans ambiguïté : pas de 0/O, 1/I/L).
 * Contient 12 octets (96 bits) :
 *   - 4 octets : adresse IPv4 du serveur
 *   - 2 octets : port TCP (big-endian)
 *   - 6 octets : secret aléatoire (48 bits >= 40 bits exigés)
 *
 * Module pur (aucune dépendance DOM ni Node), partagé entre serveur et client.
 */

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 caractères lisibles sans 0/O/1/I/L
const BASE = 31n;
const CODE_LEN = 20;
const PAYLOAD_BYTES = 12;

export interface ParsedInviteCode {
  ip: string;
  port: number;
  secretHex: string;
  normalized: string;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/** Encode une adresse IPv4, un port et 6 octets secrets en code `SB-XXXXX-XXXXX-XXXXX-XXXXX`. */
export function encodeInviteCode(ip: string, port: number, secret: Uint8Array): string {
  const parts = ip.trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`Adresse IPv4 invalide pour le code : ${ip}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Port invalide pour le code : ${port}`);
  }
  if (secret.length !== 6) {
    throw new Error('Le secret du code doit faire 6 octets (48 bits).');
  }

  const buf = new Uint8Array(PAYLOAD_BYTES);
  buf[0] = parts[0];
  buf[1] = parts[1];
  buf[2] = parts[2];
  buf[3] = parts[3];
  buf[4] = (port >> 8) & 0xff;
  buf[5] = port & 0xff;
  buf.set(secret, 6);

  let val = 0n;
  for (let i = 0; i < PAYLOAD_BYTES; i++) {
    val = (val << 8n) | BigInt(buf[i]);
  }

  const chars = new Array<string>(CODE_LEN);
  for (let i = CODE_LEN - 1; i >= 0; i--) {
    const rem = Number(val % BASE);
    chars[i] = ALPHABET[rem];
    val = val / BASE;
  }

  const raw = chars.join('');
  return `SB-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

/** Décode un code d'invitation (insensible à la casse, aux espaces et aux tirets). */
export function parseInviteCode(input: string): ParsedInviteCode | null {
  let clean = input.trim().toUpperCase().replace(/[\s\-_]+/g, '');
  if (clean.startsWith('SB')) clean = clean.slice(2);
  if (clean.length !== CODE_LEN) return null;

  let val = 0n;
  for (let i = 0; i < CODE_LEN; i++) {
    const idx = ALPHABET.indexOf(clean[i]);
    if (idx < 0) return null;
    val = val * BASE + BigInt(idx);
  }

  // Vérifier que la valeur tient bien sur 96 bits
  if (val >= 1n << 96n) return null;

  const buf = new Uint8Array(PAYLOAD_BYTES);
  for (let i = PAYLOAD_BYTES - 1; i >= 0; i--) {
    buf[i] = Number(val & 0xffn);
    val >>= 8n;
  }

  const ip = `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`;
  const port = (buf[4] << 8) | buf[5];
  if (port < 1 || port > 65535) return null;

  const secretHex = bytesToHex(buf.subarray(6, 12));
  const normalized = `SB-${clean.slice(0, 5)}-${clean.slice(5, 10)}-${clean.slice(10, 15)}-${clean.slice(15, 20)}`;
  return { ip, port, secretHex, normalized };
}
