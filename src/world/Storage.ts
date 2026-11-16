/**
 * Persistance du moteur voxel.
 *
 * - Mondes et chunks : base IndexedDB `aetherbricks-voxel` (magasins `worlds` et `chunks`),
 *   avec repli automatique sur un stockage en mémoire quand IndexedDB est indisponible.
 * - Réglages du joueur : `localStorage`, clé `aetherbricks.settings`.
 *
 * Module sans dépendance à three.js ni au DOM (hors `indexedDB` et `localStorage`, tous
 * deux protégés) : il tourne aussi bien dans la page que dans un worker ou sous Node.
 *
 * Attention : la classe exportée s'appelle `Storage`, comme l'interface DOM globale
 * (type de `localStorage`). Il faut donc l'importer explicitement là où on s'en sert.
 */
import type { GameMode, WorldType } from './Constants';

// ---------------------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------------------

export interface WorldInfo {
  /** Identifiant unique (généré par createWorldId()). */
  id: string;
  name: string;
  seed: number;
  worldType: WorldType;
  gameMode: GameMode;
  /** Date.now() à la création. */
  createdAt: number;
  lastPlayed: number;
  /** État global sérialisable (heure, météo, joueur, inventaire…) : objet JSON libre géré par le jeu. */
  state: Record<string, unknown> | null;
  /** Miniature facultative (data URL) pour la liste des mondes. */
  thumbnail?: string;
}

export interface SavedChunk {
  /** chunkKey(cx, cz). */
  key: number;
  /** 32768 identifiants (non compressés côté appelant : Storage compresse et décompresse). */
  blocks: Uint8Array;
  /** 32768 métadonnées. */
  meta: Uint8Array;
  /** 256 biomes (un par colonne). */
  biomes: Uint8Array;
  /** 2304 octets de teintes (9 par colonne). */
  tints: Uint8Array;
  /** Entités de blocs (coffres, fourneaux…) : objets JSON libres. */
  blockEntities: unknown[];
  /** Entités : objets JSON libres. */
  entities: unknown[];
}

// ---------------------------------------------------------------------------------------
// Identifiants de monde
// ---------------------------------------------------------------------------------------

/** Identifiant unique d'un monde : horodatage en base 36 + 96 bits d'aléa (`w-…-…`). */
export function createWorldId(): string {
  const bytes = new Uint8Array(12);
  let filled = false;
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
      filled = true;
    }
  } catch {
    // Générateur cryptographique indisponible : repli ci-dessous.
  }
  if (!filled) {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let random = '';
  for (let i = 0; i < bytes.length; i++) random += bytes[i].toString(16).padStart(2, '0');
  return `w-${Date.now().toString(36)}-${random}`;
}

// ---------------------------------------------------------------------------------------
// Compression RLE
// ---------------------------------------------------------------------------------------
//
// Format : un octet d'en-tête, puis la charge utile.
//   en-tête 0 = brut  : les octets d'origine suivent tels quels ;
//   en-tête 1 = RLE   : suite de jetons
//     jeton t < 0x80  : littéral — les (t + 1) octets suivants sont copiés (1 à 128) ;
//     jeton t >= 0x80 : répétition — m = longueur - 3 ; les 6 bits de poids faible de t
//                       portent m & 63 ; si le bit 0x40 est levé, la suite de m (m >> 6)
//                       est codée en LEB128 (7 bits par octet, bit 0x80 = « encore ») ;
//                       vient enfin l'octet à répéter.
// Une suite de 32768 octets identiques tient donc en 5 octets. Le mode brut est choisi dès
// que le RLE n'est pas strictement plus petit : le pire cas vaut `longueur + 1` octets.

const RLE_RAW = 0;
const RLE_PACKED = 1;
/** En deçà de 3 octets identiques, une répétition ne fait rien gagner sur un littéral. */
const RLE_MIN_RUN = 3;
const RLE_MAX_LITERAL = 128;

function rleRaw(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 1);
  out[0] = RLE_RAW;
  out.set(data, 1);
  return out;
}

/**
 * Compresse `data`. Le résultat occupe un tampon à sa taille exacte (jamais une vue sur un
 * tampon plus grand : le clonage structuré d'IndexedDB copierait le tampon entier).
 */
export function rleEncode(data: Uint8Array): Uint8Array {
  const n = data.length;
  // Budget : le RLE n'est retenu que s'il tient dans n octets, en-tête compris.
  const out = new Uint8Array(n);
  let o = 0;
  if (n === 0) return rleRaw(data);
  out[o++] = RLE_PACKED;

  let literalStart = -1;
  let i = 0;
  while (i <= n) {
    // Mesure de la suite d'octets identiques qui commence en i (vide en fin de tableau).
    let j = i;
    if (i < n) {
      const value = data[i];
      j = i + 1;
      while (j < n && data[j] === value) j++;
    }
    const run = j - i;
    const flush = i === n || run >= RLE_MIN_RUN;

    if (flush && literalStart >= 0) {
      // Vide le littéral en attente, par tranches de 128 octets au plus.
      let p = literalStart;
      while (p < i) {
        const len = Math.min(RLE_MAX_LITERAL, i - p);
        if (o + 1 + len > n) return rleRaw(data);
        out[o++] = len - 1;
        out.set(data.subarray(p, p + len), o);
        o += len;
        p += len;
      }
      literalStart = -1;
    }
    if (i === n) break;

    if (run >= RLE_MIN_RUN) {
      const m = run - RLE_MIN_RUN;
      let rest = Math.floor(m / 64);
      // Place nécessaire : jeton + suite de la longueur en LEB128 + valeur.
      let need = 2;
      for (let r = rest; r > 0; r = Math.floor(r / 128)) need++;
      if (o + need > n) return rleRaw(data);
      out[o++] = 0x80 | (rest > 0 ? 0x40 : 0) | (m % 64);
      while (rest > 0) {
        const low = rest % 128;
        rest = Math.floor(rest / 128);
        out[o++] = rest > 0 ? low | 0x80 : low;
      }
      out[o++] = data[i];
    } else if (literalStart < 0) {
      literalStart = i;
    }
    i = j;
  }
  return out.slice(0, o);
}

/**
 * Décompresse un tampon produit par `rleEncode`. `length` est la taille d'origine ; une
 * `Error` est levée si le tampon est corrompu ou ne redonne pas exactement `length` octets.
 * Le tableau rendu est toujours une copie indépendante de `data`.
 */
export function rleDecode(data: Uint8Array, length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`Décompression RLE : longueur attendue invalide (${length})`);
  }
  const out = new Uint8Array(length);
  const n = data.length;
  if (n === 0) {
    if (length === 0) return out;
    throw new Error('Décompression RLE : tampon vide');
  }
  const mode = data[0];
  if (mode === RLE_RAW) {
    if (n - 1 !== length) {
      throw new Error(`Décompression RLE : ${n - 1} octets bruts au lieu de ${length}`);
    }
    out.set(data.subarray(1));
    return out;
  }
  if (mode !== RLE_PACKED) {
    throw new Error(`Décompression RLE : en-tête inconnu (${mode})`);
  }

  let i = 1;
  let o = 0;
  while (i < n) {
    const token = data[i++];
    if (token < 0x80) {
      const len = token + 1;
      if (i + len > n) throw new Error('Décompression RLE : littéral tronqué');
      if (o + len > length) throw new Error('Décompression RLE : données plus longues que prévu');
      out.set(data.subarray(i, i + len), o);
      i += len;
      o += len;
    } else {
      let m = token & 0x3f;
      if (token & 0x40) {
        let scale = 64;
        for (;;) {
          if (i >= n) throw new Error('Décompression RLE : longueur de répétition tronquée');
          const byte = data[i++];
          m += (byte & 0x7f) * scale;
          if (m > length) throw new Error('Décompression RLE : données plus longues que prévu');
          if ((byte & 0x80) === 0) break;
          scale *= 128;
        }
      }
      const len = m + RLE_MIN_RUN;
      if (i >= n) throw new Error('Décompression RLE : répétition tronquée');
      if (o + len > length) throw new Error('Décompression RLE : données plus longues que prévu');
      const value = data[i++];
      // `out` sort tout juste de l'allocateur : les zéros y sont déjà.
      if (value !== 0) out.fill(value, o, o + len);
      o += len;
    }
  }
  if (o !== length) {
    throw new Error(`Décompression RLE : ${o} octets obtenus au lieu de ${length}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Enregistrements et outils communs aux deux stockages
// ---------------------------------------------------------------------------------------

const DB_NAME = 'aetherbricks-voxel';
const DB_VERSION = 1;
const STORE_WORLDS = 'worlds';
const STORE_CHUNKS = 'chunks';
/** Index `[worldId, size]` du magasin `chunks` : somme des tailles sans lire les valeurs. */
const INDEX_SIZE = 'bySize';
/** Délai au-delà duquel une ouverture restée sans réponse (ou bloquée) est abandonnée. */
const OPEN_TIMEOUT_MS = 5000;

/** Forme stockée d'un chunk (clé composée `[worldId, key]`). */
interface ChunkRecord {
  worldId: string;
  key: number;
  /** Taille approximative de l'enregistrement, en octets. */
  size: number;
  /** Longueurs d'origine : blocs, méta, biomes, teintes. */
  lengths: [number, number, number, number];
  /** Tampons compressés par `rleEncode` (ou bruts, selon leur octet d'en-tête). */
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
  tints: Uint8Array;
  /** Vrai si les teintes ont été regroupées par composante avant compression. */
  tintPlanes: boolean;
  blockEntities: unknown[];
  entities: unknown[];
}

/** Fabrique une `Error` explicite : « action : détail », la cause d'origine reste attachée. */
function failure(action: string, cause: unknown): Error {
  let name = '';
  let message = '';
  if (typeof cause === 'string') {
    message = cause;
  } else if (cause !== null && typeof cause === 'object') {
    const c = cause as { name?: unknown; message?: unknown };
    if (typeof c.name === 'string') name = c.name;
    if (typeof c.message === 'string') message = c.message;
  }
  let detail: string;
  if (name === 'QuotaExceededError') {
    detail = 'espace de stockage insuffisant (quota dépassé)';
  } else if (message && name && name !== 'Error') {
    detail = `${message} (${name})`;
  } else {
    detail = message || name || 'transaction interrompue';
  }
  return new Error(`${action} : ${detail}`, { cause });
}

/** Copie profonde d'une valeur sérialisable (mêmes règles que le clonage d'IndexedDB). */
function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonSize(list: unknown[]): number {
  if (list.length === 0) return 0;
  try {
    return JSON.stringify(list).length;
  } catch {
    return 0;
  }
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asBytes(value: unknown, field: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`champ « ${field} » absent ou illisible`);
}

function checkWorldId(worldId: unknown): void {
  if (typeof worldId !== 'string' || worldId.length === 0) {
    throw new Error(`identifiant de monde invalide (${String(worldId)})`);
  }
}

function checkChunkKey(key: unknown): void {
  if (typeof key !== 'number' || !Number.isFinite(key)) {
    throw new Error(`clé de chunk invalide (${String(key)})`);
  }
}

/** Octets de teinte par colonne (herbe, feuillage, eau : 3 × RVB). */
const TINT_STRIDE = 9;

/**
 * Regroupe des n-uplets entrelacés par composante : `stride` plans d'un octet par colonne.
 * Les teintes de colonnes voisines étant souvent identiques, chaque plan devient une longue
 * suite — alors que les n-uplets entrelacés ne se compressent pas du tout en RLE.
 */
function toPlanes(data: Uint8Array, stride: number): Uint8Array {
  const out = new Uint8Array(data.length);
  const count = data.length / stride;
  let o = 0;
  for (let p = 0; p < stride; p++) {
    for (let i = 0, src = p; i < count; i++, src += stride) out[o++] = data[src];
  }
  return out;
}

/** Inverse de `toPlanes`. */
function fromPlanes(data: Uint8Array, stride: number): Uint8Array {
  const out = new Uint8Array(data.length);
  const count = data.length / stride;
  let i = 0;
  for (let p = 0; p < stride; p++) {
    for (let k = 0, dst = p; k < count; k++, dst += stride) out[dst] = data[i++];
  }
  return out;
}

/** Compresse un chunk en enregistrement ; les listes d'entités ne sont pas copiées ici. */
function packChunk(worldId: string, chunk: SavedChunk): ChunkRecord {
  checkChunkKey(chunk.key);
  const blocks = rleEncode(asBytes(chunk.blocks, 'blocks'));
  const meta = rleEncode(asBytes(chunk.meta, 'meta'));
  const biomes = rleEncode(asBytes(chunk.biomes, 'biomes'));
  const rawTints = asBytes(chunk.tints, 'tints');
  let tints = rleEncode(rawTints);
  let tintPlanes = false;
  if (rawTints.length > 0 && rawTints.length % TINT_STRIDE === 0) {
    // On garde le regroupement par composante seulement s'il est plus petit.
    const planar = rleEncode(toPlanes(rawTints, TINT_STRIDE));
    if (planar.length < tints.length) {
      tints = planar;
      tintPlanes = true;
    }
  }
  const blockEntities = asList(chunk.blockEntities);
  const entities = asList(chunk.entities);
  return {
    worldId,
    key: chunk.key,
    size:
      blocks.length + meta.length + biomes.length + tints.length +
      jsonSize(blockEntities) + jsonSize(entities),
    lengths: [chunk.blocks.length, chunk.meta.length, chunk.biomes.length, rawTints.length],
    blocks,
    meta,
    biomes,
    tints,
    tintPlanes,
    blockEntities,
    entities,
  };
}

/** Décompresse un enregistrement ; les listes d'entités sont rendues telles quelles. */
function unpackChunk(record: ChunkRecord): SavedChunk {
  const lengths = record.lengths;
  if (!Array.isArray(lengths) || lengths.length !== 4) {
    throw new Error('enregistrement de chunk corrompu (longueurs absentes)');
  }
  const tints = rleDecode(asBytes(record.tints, 'tints'), lengths[3]);
  return {
    key: record.key,
    blocks: rleDecode(asBytes(record.blocks, 'blocks'), lengths[0]),
    meta: rleDecode(asBytes(record.meta, 'meta'), lengths[1]),
    biomes: rleDecode(asBytes(record.biomes, 'biomes'), lengths[2]),
    tints: record.tintPlanes === true ? fromPlanes(tints, TINT_STRIDE) : tints,
    blockEntities: asList(record.blockEntities),
    entities: asList(record.entities),
  };
}

function byLastPlayedDesc(a: WorldInfo, b: WorldInfo): number {
  return (b.lastPlayed || 0) - (a.lastPlayed || 0);
}

/** Opérations communes au stockage IndexedDB et au repli en mémoire. */
interface Backend {
  listWorlds(): Promise<WorldInfo[]>;
  getWorld(id: string): Promise<WorldInfo | undefined>;
  putWorld(info: WorldInfo): Promise<void>;
  deleteWorld(id: string): Promise<void>;
  chunkKeys(worldId: string): Promise<Set<number>>;
  loadChunk(worldId: string, key: number): Promise<SavedChunk | undefined>;
  saveChunks(worldId: string, chunks: SavedChunk[]): Promise<void>;
  worldSize(worldId: string): Promise<number>;
}

// ---------------------------------------------------------------------------------------
// Stockage IndexedDB
// ---------------------------------------------------------------------------------------

/** Ouvre la base (et crée son schéma). Rejette si IndexedDB est absent, refusé ou muet. */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const action = 'Ouverture de la base impossible';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (cause: unknown): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      reject(failure(action, cause));
    };

    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        fail('IndexedDB est indisponible dans cet environnement');
        return;
      }
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      // Accès interdit (iframe isolée, navigation privée de certains navigateurs…).
      fail(error);
      return;
    }

    timer = setTimeout(() => fail('aucune réponse du navigateur (délai dépassé)'), OPEN_TIMEOUT_MS);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_WORLDS)) {
        db.createObjectStore(STORE_WORLDS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunks = db.createObjectStore(STORE_CHUNKS, { keyPath: ['worldId', 'key'] });
        chunks.createIndex(INDEX_SIZE, ['worldId', 'size']);
      }
    };
    // Une autre page garde une version antérieure ouverte : elle reçoit `versionchange` et
    // se ferme d'elle-même ; on patiente, le délai global tranche si elle ne le fait pas.
    request.onblocked = () => {};
    request.onerror = (event) => {
      event.preventDefault();
      fail(request.error);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        // Réponse arrivée après l'abandon : ne pas laisser traîner une connexion inutile.
        db.close();
        return;
      }
      if (!db.objectStoreNames.contains(STORE_WORLDS) || !db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.close();
        fail('schéma de la base inattendu (magasins absents)');
        return;
      }
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(db);
    };
  });
}

function worldRange(worldId: string): IDBKeyRange {
  return IDBKeyRange.bound([worldId, -Infinity], [worldId, Infinity]);
}

class IdbBackend implements Backend {
  private db: IDBDatabase | null = null;
  private reopening: Promise<IDBDatabase> | null = null;

  constructor(db: IDBDatabase) {
    this.attach(db);
  }

  private attach(db: IDBDatabase): void {
    this.db = db;
    // Une autre page met la base à niveau (ou la supprime) : on libère la connexion pour ne
    // pas la bloquer. La prochaine opération tentera de rouvrir la base.
    db.onversionchange = () => {
      db.close();
      if (this.db === db) this.db = null;
    };
    // Fermeture subie (données du site effacées, erreur disque…).
    db.onclose = () => {
      if (this.db === db) this.db = null;
    };
  }

  private connection(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (!this.reopening) {
      this.reopening = openDatabase()
        .then((db) => {
          this.attach(db);
          return db;
        })
        .finally(() => {
          this.reopening = null;
        });
    }
    return this.reopening;
  }

  /**
   * Exécute `work` dans une transaction. `work` lance ses requêtes et rend une fonction qui
   * lit leur résultat ; celle-ci n'est appelée qu'une fois la transaction validée. Tout
   * échec (requête, quota, abandon, connexion fermée) rejette avec une `Error` explicite.
   */
  private async transact<T>(
    stores: string[],
    mode: IDBTransactionMode,
    action: string,
    work: (tx: IDBTransaction) => () => T,
  ): Promise<T> {
    let db: IDBDatabase;
    try {
      db = await this.connection();
    } catch (error) {
      throw failure(`${action} (base fermée, par exemple par une mise à niveau dans une autre page)`, error);
    }
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        // Durabilité relâchée : les sauvegardes de chunks sont fréquentes et volumineuses.
        tx = mode === 'readwrite'
          ? db.transaction(stores, mode, { durability: 'relaxed' })
          : db.transaction(stores, mode);
      } catch (error) {
        reject(failure(action, error));
        return;
      }
      let settled = false;
      let read: (() => T) | undefined;
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        try {
          resolve((read as () => T)());
        } catch (error) {
          reject(failure(action, error));
        }
      };
      tx.onabort = () => {
        if (settled) return;
        settled = true;
        reject(failure(action, tx.error));
      };
      try {
        read = work(tx);
      } catch (error) {
        // Erreur synchrone (valeur non clonable, clé invalide…) : rien ne doit être écrit.
        settled = true;
        try {
          tx.abort();
        } catch {
          // Transaction déjà terminée.
        }
        reject(failure(action, error));
      }
    });
  }

  listWorlds(): Promise<WorldInfo[]> {
    return this.transact([STORE_WORLDS], 'readonly', 'Lecture de la liste des mondes impossible', (tx) => {
      const request = tx.objectStore(STORE_WORLDS).getAll();
      return () => (request.result as WorldInfo[]).sort(byLastPlayedDesc);
    });
  }

  getWorld(id: string): Promise<WorldInfo | undefined> {
    return this.transact([STORE_WORLDS], 'readonly', `Lecture du monde « ${id} » impossible`, (tx) => {
      const request = tx.objectStore(STORE_WORLDS).get(id);
      return () => request.result as WorldInfo | undefined;
    });
  }

  putWorld(info: WorldInfo): Promise<void> {
    return this.transact([STORE_WORLDS], 'readwrite', `Enregistrement du monde « ${info.id} » impossible`, (tx) => {
      tx.objectStore(STORE_WORLDS).put(info);
      return () => undefined;
    });
  }

  deleteWorld(id: string): Promise<void> {
    return this.transact(
      [STORE_WORLDS, STORE_CHUNKS],
      'readwrite',
      `Suppression du monde « ${id} » impossible`,
      (tx) => {
        tx.objectStore(STORE_WORLDS).delete(id);
        tx.objectStore(STORE_CHUNKS).delete(worldRange(id));
        return () => undefined;
      },
    );
  }

  chunkKeys(worldId: string): Promise<Set<number>> {
    return this.transact([STORE_CHUNKS], 'readonly', 'Lecture des clés de chunks impossible', (tx) => {
      const request = tx.objectStore(STORE_CHUNKS).getAllKeys(worldRange(worldId));
      return () => {
        const keys = new Set<number>();
        for (const pair of request.result as unknown as [string, number][]) keys.add(pair[1]);
        return keys;
      };
    });
  }

  loadChunk(worldId: string, key: number): Promise<SavedChunk | undefined> {
    return this.transact([STORE_CHUNKS], 'readonly', `Lecture du chunk ${key} impossible`, (tx) => {
      const request = tx.objectStore(STORE_CHUNKS).get([worldId, key]);
      return () => {
        const record = request.result as ChunkRecord | undefined;
        return record === undefined ? undefined : unpackChunk(record);
      };
    });
  }

  async saveChunks(worldId: string, chunks: SavedChunk[]): Promise<void> {
    const action = `Sauvegarde de ${chunks.length} chunk(s) impossible`;
    if (chunks.length === 0) return;
    // La compression se fait hors transaction : celle-ci reste aussi courte que possible.
    let records: ChunkRecord[];
    try {
      records = chunks.map((chunk) => packChunk(worldId, chunk));
    } catch (error) {
      throw failure(action, error);
    }
    await this.transact([STORE_CHUNKS], 'readwrite', action, (tx) => {
      const store = tx.objectStore(STORE_CHUNKS);
      for (const record of records) store.put(record);
      return () => undefined;
    });
  }

  worldSize(worldId: string): Promise<number> {
    return this.transact([STORE_CHUNKS], 'readonly', 'Calcul de la taille du monde impossible', (tx) => {
      // Curseur de clés sur l'index [worldId, size] : aucune valeur de chunk n'est lue.
      let total = 0;
      const request = tx.objectStore(STORE_CHUNKS).index(INDEX_SIZE).openKeyCursor(worldRange(worldId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const size = (cursor.key as unknown as [string, number])[1];
        if (typeof size === 'number') total += size;
        cursor.continue();
      };
      return () => total;
    });
  }
}

// ---------------------------------------------------------------------------------------
// Repli en mémoire
// ---------------------------------------------------------------------------------------

/**
 * Même comportement que la base, sans persistance. Les chunks y sont rangés compressés
 * (mêmes enregistrements qu'en base) et tout ce qui entre ou sort est copié.
 */
class MemoryBackend implements Backend {
  private readonly worlds = new Map<string, WorldInfo>();
  private readonly chunks = new Map<string, Map<number, ChunkRecord>>();

  async listWorlds(): Promise<WorldInfo[]> {
    const list: WorldInfo[] = [];
    for (const info of this.worlds.values()) list.push(cloneValue(info));
    return list.sort(byLastPlayedDesc);
  }

  async getWorld(id: string): Promise<WorldInfo | undefined> {
    const info = this.worlds.get(id);
    return info === undefined ? undefined : cloneValue(info);
  }

  async putWorld(info: WorldInfo): Promise<void> {
    let copy: WorldInfo;
    try {
      copy = cloneValue(info);
    } catch (error) {
      throw failure(`Enregistrement du monde « ${info.id} » impossible`, error);
    }
    this.worlds.set(copy.id, copy);
  }

  async deleteWorld(id: string): Promise<void> {
    this.worlds.delete(id);
    this.chunks.delete(id);
  }

  async chunkKeys(worldId: string): Promise<Set<number>> {
    return new Set(this.chunks.get(worldId)?.keys() ?? []);
  }

  async loadChunk(worldId: string, key: number): Promise<SavedChunk | undefined> {
    const record = this.chunks.get(worldId)?.get(key);
    if (record === undefined) return undefined;
    try {
      const chunk = unpackChunk(record);
      chunk.blockEntities = cloneValue(chunk.blockEntities);
      chunk.entities = cloneValue(chunk.entities);
      return chunk;
    } catch (error) {
      throw failure(`Lecture du chunk ${key} impossible`, error);
    }
  }

  async saveChunks(worldId: string, chunks: SavedChunk[]): Promise<void> {
    // Tout est préparé avant la moindre écriture : comme une transaction, c'est tout ou rien.
    let records: ChunkRecord[];
    try {
      records = chunks.map((chunk) => {
        const record = packChunk(worldId, chunk);
        record.blockEntities = cloneValue(record.blockEntities);
        record.entities = cloneValue(record.entities);
        return record;
      });
    } catch (error) {
      throw failure(`Sauvegarde de ${chunks.length} chunk(s) impossible`, error);
    }
    if (records.length === 0) return;
    let world = this.chunks.get(worldId);
    if (!world) {
      world = new Map<number, ChunkRecord>();
      this.chunks.set(worldId, world);
    }
    for (const record of records) world.set(record.key, record);
  }

  async worldSize(worldId: string): Promise<number> {
    let total = 0;
    const world = this.chunks.get(worldId);
    if (world) for (const record of world.values()) total += record.size;
    return total;
  }
}

/** Le repli est commun à toutes les instances, comme le serait la base. */
let sharedMemory: MemoryBackend | null = null;

// ---------------------------------------------------------------------------------------
// Façade
// ---------------------------------------------------------------------------------------

export class Storage {
  /** Faux quand on est sur le repli en mémoire : les mondes sont perdus au rechargement. */
  readonly persistent: boolean;
  private readonly backend: Backend;

  private constructor(backend: Backend, persistent: boolean) {
    this.backend = backend;
    this.persistent = persistent;
  }

  /**
   * Ouvre (ou crée) la base. Ne rejette jamais : si IndexedDB est indisponible, bascule sur
   * un stockage en mémoire et `persistent` vaut false.
   */
  static async open(): Promise<Storage> {
    try {
      return new Storage(new IdbBackend(await openDatabase()), true);
    } catch {
      if (!sharedMemory) sharedMemory = new MemoryBackend();
      return new Storage(sharedMemory, false);
    }
  }

  /** Mondes enregistrés, triés par `lastPlayed` décroissant. */
  listWorlds(): Promise<WorldInfo[]> {
    return this.backend.listWorlds();
  }

  async getWorld(id: string): Promise<WorldInfo | undefined> {
    this.guard('Lecture du monde impossible', () => checkWorldId(id));
    return this.backend.getWorld(id);
  }

  /** Crée le monde ou remplace celui qui porte le même identifiant. */
  async putWorld(info: WorldInfo): Promise<void> {
    this.guard('Enregistrement du monde impossible', () => {
      if (info === null || typeof info !== 'object') throw new Error('description du monde absente');
      checkWorldId(info.id);
    });
    return this.backend.putWorld(info);
  }

  /** Supprime le monde et tous ses chunks. */
  async deleteWorld(id: string): Promise<void> {
    this.guard('Suppression du monde impossible', () => checkWorldId(id));
    return this.backend.deleteWorld(id);
  }

  /**
   * Clés de tous les chunks sauvegardés du monde (pour savoir sans lecture si un chunk doit
   * être généré ou chargé).
   */
  async chunkKeys(worldId: string): Promise<Set<number>> {
    this.guard('Lecture des clés de chunks impossible', () => checkWorldId(worldId));
    return this.backend.chunkKeys(worldId);
  }

  /** Chunk décompressé, ou `undefined` s'il n'a jamais été sauvegardé. */
  async loadChunk(worldId: string, key: number): Promise<SavedChunk | undefined> {
    this.guard('Lecture du chunk impossible', () => {
      checkWorldId(worldId);
      checkChunkKey(key);
    });
    return this.backend.loadChunk(worldId, key);
  }

  /** Écrit plusieurs chunks dans une seule transaction (tout ou rien). */
  async saveChunks(worldId: string, chunks: SavedChunk[]): Promise<void> {
    this.guard('Sauvegarde des chunks impossible', () => {
      checkWorldId(worldId);
      if (!Array.isArray(chunks)) throw new Error('liste de chunks absente');
    });
    return this.backend.saveChunks(worldId, chunks);
  }

  /**
   * Taille approximative occupée par les chunks d'un monde, en octets (somme des tampons
   * compressés et du JSON des entités) — pour l'écran des mondes.
   */
  async worldSize(worldId: string): Promise<number> {
    this.guard('Calcul de la taille du monde impossible', () => checkWorldId(worldId));
    return this.backend.worldSize(worldId);
  }

  /** Vérifie les arguments ; une erreur devient un rejet au libellé explicite. */
  private guard(action: string, check: () => void): void {
    try {
      check();
    } catch (error) {
      throw failure(action, error);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Réglages du joueur
// ---------------------------------------------------------------------------------------

export type KeyboardLayout = 'azerty' | 'qwerty';

export interface Keybinds {
  forward: string;
  left: string;
  backward: string;
  right: string;
  jump: string;
  sneak: string;
  sprint: string;
  inventory: string;
  drop: string;
  chat: string;
  command: string;
  perspective: string;
}

export type KeybindAction = keyof Keybinds;

export const DEFAULT_KEYBINDS: Readonly<Keybinds> = Object.freeze({
  forward: 'KeyW',
  left: 'KeyA',
  backward: 'KeyS',
  right: 'KeyD',
  jump: 'Space',
  sneak: 'ShiftLeft',
  sprint: 'ControlLeft',
  inventory: 'KeyE',
  drop: 'KeyQ',
  chat: 'KeyT',
  command: 'Slash',
  perspective: 'F5',
});

/** Libellé lisible d'un code de touche physique (`event.code`) selon la disposition AZERTY ou QWERTY. */
export function formatKeyCode(code: string, layout: KeyboardLayout): string {
  if (layout === 'azerty') {
    switch (code) {
      case 'KeyQ': return 'A';
      case 'KeyW': return 'Z';
      case 'KeyA': return 'Q';
      case 'KeyZ': return 'W';
      case 'KeyM': return ',';
      case 'Semicolon': return 'M';
      case 'Comma': return ';';
      case 'Period': return ':';
      case 'Slash': return '/';
    }
  } else {
    if (code === 'Slash') return '/';
  }
  if (code.length === 4 && code.startsWith('Key')) return code.slice(3);
  if (code.length === 6 && code.startsWith('Digit')) return code.slice(5);
  switch (code) {
    case 'Space': return 'Espace';
    case 'ShiftLeft':
    case 'ShiftRight': return 'Maj';
    case 'ControlLeft':
    case 'ControlRight': return 'Ctrl';
    case 'AltLeft':
    case 'AltRight': return 'Alt';
    case 'Tab': return 'Tab';
    case 'Enter':
    case 'NumpadEnter': return 'Entrée';
    case 'Backspace': return 'Retour';
    case 'Escape': return 'Échap';
    case 'ArrowUp': return 'Flèche haut';
    case 'ArrowDown': return 'Flèche bas';
    case 'ArrowLeft': return 'Flèche gauche';
    case 'ArrowRight': return 'Flèche droite';
    default: return code;
  }
}

/** Réglages du joueur (localStorage, clé `aetherbricks.settings`), fusionnés avec les valeurs par défaut. */
export interface Settings {
  /** Distance de rendu en chunks, 2..16, défaut 8. */
  renderDistance: number;
  /** Champ de vision en degrés, 30..110, défaut 70. */
  fov: number;
  /** Sensibilité de la souris (multiplicateur), 0.1..2, défaut 1. */
  sensitivity: number;
  /** Volume des sons, 0..1, défaut 0.8. */
  soundVolume: number;
  /** Volume de la musique, 0..1, défaut 0.35. */
  musicVolume: number;
  /** Graphismes détaillés, défaut true. */
  fancyGraphics: boolean;
  /** Nuages, défaut true. */
  clouds: boolean;
  /** Balancement de la vue à la marche, défaut true. */
  viewBobbing: boolean;
  /** Éclairage adouci, défaut true. */
  smoothLighting: boolean;
  /** Inversion de l'axe vertical de la souris, défaut false. */
  invertY: boolean;
  /** Affichage du compteur d'images par seconde, défaut false. */
  showFps: boolean;
  /** Échelle de l'interface, 1..4 ; 0 (défaut) = automatique. */
  guiScale: number;
  /** Disposition des libellés du clavier : AZERTY (défaut) ou QWERTY. */
  keyboardLayout: KeyboardLayout;
  /** Raccourcis clavier (par code physique `event.code`). */
  keybinds: Keybinds;
}

const SETTINGS_KEY = 'aetherbricks.settings';

/** Valeurs par défaut (objet gelé : passer par `loadSettings()` ou une copie pour modifier). */
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  renderDistance: 8,
  fov: 70,
  sensitivity: 1,
  soundVolume: 0.8,
  musicVolume: 0.35,
  fancyGraphics: true,
  clouds: true,
  viewBobbing: true,
  smoothLighting: true,
  invertY: false,
  showFps: false,
  guiScale: 0,
  keyboardLayout: 'azerty',
  keybinds: { ...DEFAULT_KEYBINDS },
});

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeKeybinds(raw: unknown): Keybinds {
  const src: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Keybinds = { ...DEFAULT_KEYBINDS };
  for (const k of Object.keys(DEFAULT_KEYBINDS) as KeybindAction[]) {
    const v = src[k];
    if (typeof v === 'string' && v.length > 0 && v.length <= 24) out[k] = v;
  }
  return out;
}

/** Fusionne une valeur quelconque avec les défauts et borne chaque réglage. */
function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  // Échelle d'interface : 0 (ou moins) = automatique, sinon un entier de 1 à 4.
  const scale = Math.round(boundedNumber(r.guiScale, 0, 4, d.guiScale));
  const layout: KeyboardLayout = r.keyboardLayout === 'qwerty' ? 'qwerty' : 'azerty';
  return {
    renderDistance: Math.round(boundedNumber(r.renderDistance, 2, 16, d.renderDistance)),
    fov: boundedNumber(r.fov, 30, 110, d.fov),
    sensitivity: boundedNumber(r.sensitivity, 0.1, 2, d.sensitivity),
    soundVolume: boundedNumber(r.soundVolume, 0, 1, d.soundVolume),
    musicVolume: boundedNumber(r.musicVolume, 0, 1, d.musicVolume),
    fancyGraphics: flag(r.fancyGraphics, d.fancyGraphics),
    clouds: flag(r.clouds, d.clouds),
    viewBobbing: flag(r.viewBobbing, d.viewBobbing),
    smoothLighting: flag(r.smoothLighting, d.smoothLighting),
    invertY: flag(r.invertY, d.invertY),
    showFps: flag(r.showFps, d.showFps),
    guiScale: scale,
    keyboardLayout: layout,
    keybinds: sanitizeKeybinds(r.keybinds),
  };
}

/**
 * Lit les réglages. Ne lève jamais : JSON invalide, valeur d'un mauvais type ou
 * `localStorage` bloqué redonnent les valeurs par défaut ; chaque valeur est bornée.
 * L'objet rendu est neuf à chaque appel.
 */
export function loadSettings(): Settings {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return sanitizeSettings(JSON.parse(raw));
    }
  } catch {
    // Stockage bloqué ou contenu illisible : valeurs par défaut.
  }
  return sanitizeSettings(null);
}

/** Enregistre les réglages (bornés au passage). Ne lève jamais. */
export function saveSettings(s: Settings): void {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(s)));
  } catch {
    // Stockage bloqué ou plein : les réglages restent valables pour la session en cours.
  }
}
