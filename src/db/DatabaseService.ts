import { BrickEntry, getStarterScene } from '../world/Presets';

export interface PlayerSavedState {
  x: number;
  y: number;
  z: number;
  viewMode?: string;
  lightingIdx?: number;
}

export interface WorldRecord {
  id: string;
  ownerId: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  bricks: BrickEntry[];
  playerState?: PlayerSavedState;
}

export interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  isGuest: boolean;
  createdAt: number;
  activeWorldId?: string;
}

const SESSION_USER_KEY = 'aetherbricks_active_user_v1';
const LOCAL_DB_BACKUP_KEY = 'aetherbricks_local_db_backup_v1';
const LEGACY_KEYS = ['aetherbricks_world_v3', 'aetherbricks_world_v2', 'aetherbricks_world_v1'];
const MIGRATED_FLAG_KEY = 'aetherbricks_legacy_migrated_v1';

const IDB_NAME = 'AetherBricksDatabase';
const IDB_VERSION = 1;

function simpleHash(password: string): string {
  let h = 2166136261;
  for (let i = 0; i < password.length; i++) {
    h ^= password.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `h_${(h >>> 0).toString(16)}`;
}

export class DatabaseService {
  public currentUser: UserAccount | null = null;
  public worlds: WorldRecord[] = [];
  public currentWorld: WorldRecord | null = null;
  private idb: IDBDatabase | null = null;

  private async openIndexedDB(): Promise<IDBDatabase | null> {
    if (this.idb) return this.idb;
    if (!('indexedDB' in window)) return null;

    return new Promise((resolve) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('users')) {
          db.createObjectStore('users', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('worlds')) {
          db.createObjectStore('worlds', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        this.idb = req.result;
        resolve(this.idb);
      };
      req.onerror = () => resolve(null);
    });
  }

  private async saveToIndexedDB(user: UserAccount | null, worlds: WorldRecord[]): Promise<void> {
    const db = await this.openIndexedDB();
    if (db) {
      const tx = db.transaction(['users', 'worlds'], 'readwrite');
      if (user) {
        tx.objectStore('users').put(user);
      }
      const wStore = tx.objectStore('worlds');
      for (const w of worlds) {
        wStore.put(w);
      }
    }
    try {
      localStorage.setItem(
        LOCAL_DB_BACKUP_KEY,
        JSON.stringify({ user, worlds, savedAt: Date.now() })
      );
    } catch {
      // Ignore quota errors
    }
  }

  private async loadFromIndexedDB(userId: string): Promise<{
    user: UserAccount | null;
    worlds: WorldRecord[];
  }> {
    const db = await this.openIndexedDB();
    if (db) {
      const user = await new Promise<UserAccount | null>((resolve) => {
        const req = db.transaction('users', 'readonly').objectStore('users').get(userId);
        req.onsuccess = () => resolve((req.result as UserAccount) || null);
        req.onerror = () => resolve(null);
      });
      const allWorlds = await new Promise<WorldRecord[]>((resolve) => {
        const req = db.transaction('worlds', 'readonly').objectStore('worlds').getAll();
        req.onsuccess = () => resolve((req.result as WorldRecord[]) || []);
        req.onerror = () => resolve([]);
      });
      const worlds = allWorlds
        .filter((w) => w.ownerId === userId)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      if (user || worlds.length > 0) {
        return { user, worlds };
      }
    }

    try {
      const raw = localStorage.getItem(LOCAL_DB_BACKUP_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.user?.id === userId) {
          return { user: parsed.user, worlds: parsed.worlds || [] };
        }
      }
    } catch {
      // Ignore
    }
    return { user: null, worlds: [] };
  }

  /**
   * Initialise la session au démarrage :
   * - Reprend le compte connecté ou crée/reprend un Compte Invité persistant
   * - Migre automatiquement les anciennes créations stockées dans localStorage (v1/v2/v3)
   */
  public async init(): Promise<{ user: UserAccount; activeWorld: WorldRecord }> {
    let savedUserJson: UserAccount | null = null;
    try {
      const raw = localStorage.getItem(SESSION_USER_KEY);
      if (raw) savedUserJson = JSON.parse(raw) as UserAccount;
    } catch {
      savedUserJson = null;
    }

    if (savedUserJson?.id) {
      // Try server DB first
      try {
        const res = await fetch(`/api/db/state?userId=${encodeURIComponent(savedUserJson.id)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.user) {
            this.currentUser = data.user;
            this.worlds = data.worlds || [];
          }
        }
      } catch {
        // Offline or static fallback
      }

      if (!this.currentUser) {
        const localData = await this.loadFromIndexedDB(savedUserJson.id);
        this.currentUser = localData.user || savedUserJson;
        this.worlds = localData.worlds;
      }
    }

    if (!this.currentUser) {
      await this.loginAsGuest();
    }

    // Migrate any legacy creations from v1 / v2 / v3 so the user never loses past work
    await this.migrateLegacyLocalStorage();

    // Ensure at least one world exists
    if (this.worlds.length === 0) {
      const starterWorld = await this.createNewWorld('Mon Premier Monde', getStarterScene());
      this.currentWorld = starterWorld;
    } else {
      const preferred = this.worlds.find((w) => w.id === this.currentUser?.activeWorldId);
      this.currentWorld = preferred || this.worlds[0];
    }

    await this.saveToIndexedDB(this.currentUser, this.worlds);
    return { user: this.currentUser!, activeWorld: this.currentWorld! };
  }

  private async migrateLegacyLocalStorage(): Promise<void> {
    if (!this.currentUser) return;
    if (localStorage.getItem(MIGRATED_FLAG_KEY) === '1') return;

    let recoveredCount = 0;
    const seenCounts = new Set<string>();

    for (const key of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as BrickEntry[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const fingerprint = `${parsed.length}_${parsed[0].x}_${parsed[parsed.length - 1].z}`;
          if (seenCounts.has(fingerprint)) continue;
          seenCounts.add(fingerprint);
          recoveredCount++;
          await this.createNewWorld(
            recoveredCount === 1 ? 'Mon Monde Récupéré' : `Monde Récupéré #${recoveredCount}`,
            parsed
          );
        }
      } catch {
        // Ignore
      }
    }

    localStorage.setItem(MIGRATED_FLAG_KEY, '1');
  }

  public async loginAsGuest(): Promise<{ ok: boolean; user: UserAccount }> {
    let existingGuestId: string | undefined;
    try {
      const raw = localStorage.getItem(SESSION_USER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as UserAccount;
        if (parsed.isGuest) existingGuestId = parsed.id;
      }
    } catch {
      // Ignore
    }

    try {
      const res = await fetch('/api/db/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestId: existingGuestId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.user) {
          this.currentUser = data.user;
          this.worlds = data.worlds || [];
          localStorage.setItem(SESSION_USER_KEY, JSON.stringify(this.currentUser));
          await this.saveToIndexedDB(this.currentUser, this.worlds);
          return { ok: true, user: this.currentUser! };
        }
      }
    } catch {
      // Fallback to local guest
    }

    const fallbackGuest: UserAccount = {
      id: existingGuestId || `guest_${Date.now()}`,
      username: 'Architecte Invité',
      passwordHash: '',
      isGuest: true,
      createdAt: Date.now(),
    };
    this.currentUser = fallbackGuest;
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(this.currentUser));
    await this.saveToIndexedDB(this.currentUser, this.worlds);
    return { ok: true, user: fallbackGuest };
  }

  public async registerAccount(
    username: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> {
    const passwordHash = simpleHash(password);
    const convertGuestId = this.currentUser?.isGuest ? this.currentUser.id : undefined;

    try {
      const res = await fetch('/api/db/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passwordHash, convertGuestId }),
      });
      const data = await res.json();
      if (!data.ok) {
        return { ok: false, error: data.error || 'Erreur lors de la création du compte.' };
      }
      this.currentUser = data.user;
      this.worlds = data.worlds || [];
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(this.currentUser));

      if (this.worlds.length === 0 && this.currentWorld) {
        this.currentWorld.ownerId = this.currentUser!.id;
        await this.saveWorld(this.currentWorld.bricks, this.currentWorld.playerState);
      } else if (this.worlds.length > 0) {
        this.currentWorld = this.worlds[0];
      }

      await this.saveToIndexedDB(this.currentUser, this.worlds);
      return { ok: true };
    } catch {
      // Offline fallback account registration
      if (this.currentUser) {
        this.currentUser.username = username.trim();
        this.currentUser.passwordHash = passwordHash;
        this.currentUser.isGuest = false;
        localStorage.setItem(SESSION_USER_KEY, JSON.stringify(this.currentUser));
        await this.saveToIndexedDB(this.currentUser, this.worlds);
        return { ok: true };
      }
      return { ok: false, error: 'Impossible de contacter la base de données.' };
    }
  }

  public async loginAccount(
    username: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> {
    const passwordHash = simpleHash(password);
    try {
      const res = await fetch('/api/db/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passwordHash }),
      });
      const data = await res.json();
      if (!data.ok) {
        return { ok: false, error: data.error || 'Identifiants invalides.' };
      }
      this.currentUser = data.user;
      this.worlds = data.worlds || [];
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(this.currentUser));

      if (this.worlds.length === 0) {
        this.currentWorld = await this.createNewWorld('Mon Monde Principal', getStarterScene());
      } else {
        this.currentWorld =
          this.worlds.find((w) => w.id === this.currentUser?.activeWorldId) || this.worlds[0];
      }
      await this.saveToIndexedDB(this.currentUser, this.worlds);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Erreur de connexion à la base de données.' };
    }
  }

  public async createNewWorld(
    name: string,
    initialBricks: BrickEntry[],
    playerState?: PlayerSavedState
  ): Promise<WorldRecord> {
    const ownerId = this.currentUser?.id || 'guest_default';
    const newWorld: WorldRecord = {
      id: `world_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ownerId,
      name: name.trim() || `Monde #${this.worlds.length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      bricks: initialBricks,
      playerState: playerState || { x: 0, y: 0.36, z: 6.0 },
    };

    this.worlds.unshift(newWorld);
    this.currentWorld = newWorld;
    if (this.currentUser) {
      this.currentUser.activeWorldId = newWorld.id;
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(this.currentUser));
    }

    await this.persistWorldToServerAndIDB(newWorld);
    return newWorld;
  }

  public async saveWorld(bricks: BrickEntry[], playerState?: PlayerSavedState): Promise<void> {
    if (!this.currentWorld || !this.currentUser) return;
    this.currentWorld.bricks = bricks;
    this.currentWorld.updatedAt = Date.now();
    if (playerState) {
      this.currentWorld.playerState = playerState;
    }
    this.currentUser.activeWorldId = this.currentWorld.id;
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(this.currentUser));

    await this.persistWorldToServerAndIDB(this.currentWorld);
  }

  public async switchWorld(worldId: string): Promise<WorldRecord | null> {
    const target = this.worlds.find((w) => w.id === worldId);
    if (!target) return null;
    this.currentWorld = target;
    if (this.currentUser) {
      this.currentUser.activeWorldId = target.id;
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(this.currentUser));
    }
    await this.persistWorldToServerAndIDB(target);
    return target;
  }

  public async deleteWorld(worldId: string): Promise<WorldRecord> {
    if (!this.currentUser) throw new Error('Non connecté');
    try {
      await fetch('/api/db/worlds/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldId, ownerId: this.currentUser.id }),
      });
    } catch {
      // Ignore
    }
    this.worlds = this.worlds.filter((w) => w.id !== worldId);
    if (this.worlds.length === 0) {
      const fresh = await this.createNewWorld('Nouveau Monde', getStarterScene());
      return fresh;
    }
    if (this.currentWorld?.id === worldId) {
      this.currentWorld = this.worlds[0];
    }
    await this.saveToIndexedDB(this.currentUser, this.worlds);
    return this.currentWorld!;
  }

  private async persistWorldToServerAndIDB(world: WorldRecord): Promise<void> {
    try {
      await fetch('/api/db/worlds/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          world,
          activeWorldId: this.currentUser?.activeWorldId,
        }),
      });
    } catch {
      // Offline fallback
    }
    await this.saveToIndexedDB(this.currentUser, this.worlds);
  }
}

