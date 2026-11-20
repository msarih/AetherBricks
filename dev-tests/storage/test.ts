// Tests de src/world/Storage.ts dans un vrai navigateur (IndexedDB et localStorage réels).
// Chaque fonction de window.storageTests rend { passed, failed, failures, logs }.
import { Storage, createWorldId, rleEncode, loadSettings, saveSettings, DEFAULT_SETTINGS } from '../../src/world/Storage';
import type { SavedChunk, WorldInfo } from '../../src/world/Storage';
import { chunkKey } from '../../src/world/Constants';
import { WorldGen } from '../../src/world/gen/WorldGen';

interface Report {
  passed: number;
  failed: number;
  failures: string[];
  logs: string[];
}

// Conservé en « aetherbricks » volontairement pour la compatibilité des sauvegardes existantes.
const DB = 'aetherbricks-voxel';
const PERSIST_ID = 'monde-persistant';
const gen = new WorldGen(1337, 'default');

function newReport(): Report & { ok(cond: unknown, label: string): void; log(line: string): void } {
  const r = {
    passed: 0,
    failed: 0,
    failures: [] as string[],
    logs: [] as string[],
    ok(cond: unknown, label: string): void {
      if (cond) r.passed++;
      else {
        r.failed++;
        r.failures.push(label);
      }
    },
    log(line: string): void {
      r.logs.push(line);
    },
  };
  return r;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function genChunk(cx: number, cz: number): SavedChunk {
  const c = gen.generateChunk(cx, cz);
  return {
    key: chunkKey(cx, cz),
    blocks: c.blocks,
    meta: c.meta,
    biomes: c.biomes,
    tints: c.tints,
    blockEntities: [{ type: 'chest', x: 3, y: 64, z: 5, items: [{ id: 5, count: 64 }, null] }],
    entities: [{ type: 'pig', pos: [cx * 16 + 1.5, 70.25, cz * 16 + 2.5], health: 10 }],
  };
}

function noiseChunk(cx: number, cz: number): SavedChunk {
  const fill = (n: number): Uint8Array => {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i += 65536) crypto.getRandomValues(a.subarray(i, Math.min(n, i + 65536)));
    return a;
  };
  return { key: chunkKey(cx, cz), blocks: fill(32768), meta: fill(32768), biomes: fill(256), tints: fill(2304), blockEntities: [], entities: [] };
}

function chunkEquals(a: SavedChunk | undefined, b: SavedChunk): boolean {
  return !!a && a.key === b.key && same(a.blocks, b.blocks) && same(a.meta, b.meta) && same(a.biomes, b.biomes) && same(a.tints, b.tints) &&
    JSON.stringify(a.blockEntities) === JSON.stringify(b.blockEntities) && JSON.stringify(a.entities) === JSON.stringify(b.entities);
}

function world(id: string, name: string, lastPlayed: number): WorldInfo {
  return { id, name, seed: 1337, worldType: 'default', gameMode: 'survival', createdAt: 1000, lastPlayed, state: { time: 6000, player: { pos: [0.5, 70, 0.5] } } };
}

function deleteDb(): Promise<string> {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(DB);
    r.onsuccess = () => resolve('ok');
    r.onerror = () => resolve('erreur');
    r.onblocked = () => resolve('bloquée');
  });
}

async function rejects(r: ReturnType<typeof newReport>, p: () => Promise<unknown>, label: string, pattern: RegExp): Promise<void> {
  try {
    await p();
    r.ok(false, `${label} (aurait dû rejeter)`);
  } catch (e) {
    r.ok(e instanceof Error && pattern.test(e.message), `${label} → ${e instanceof Error ? e.message : String(e)}`);
    r.log(`${label} → ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Phase 1 : base neuve, parcours complet, écriture du monde relu après rechargement. */
async function phase1(): Promise<Report> {
  const r = newReport();
  r.log(`suppression préalable de la base : ${await deleteDb()}`);
  const storage = await Storage.open();
  r.ok(storage.persistent === true, 'persistent === true dans Chrome');
  r.ok((await storage.listWorlds()).length === 0, 'liste vide au départ');

  const A = createWorldId();
  const B = createWorldId();
  await storage.putWorld(world(A, 'Alpha', 100));
  await storage.putWorld(world(B, 'Bêta', 300));
  await storage.putWorld({ ...world(PERSIST_ID, 'Persistant', 200), thumbnail: 'data:image/png;base64,AAAA' });
  const names = (await storage.listWorlds()).map((w) => w.name).join();
  r.ok(names === 'Bêta,Persistant,Alpha', `liste triée par lastPlayed décroissant (${names})`);
  r.ok(JSON.stringify(await storage.getWorld(A)) === JSON.stringify(world(A, 'Alpha', 100)), 'getWorld identique');
  r.ok((await storage.getWorld('inconnu')) === undefined, 'getWorld inconnu → undefined');

  const coords: [number, number][] = [[0, 0], [1, 0], [-1, -1], [-32768, 32767], [12, -7]];
  const chunksA = coords.map(([x, z]) => genChunk(x, z));
  chunksA.push(noiseChunk(100, 100));
  const chunksB = coords.slice(0, 3).map(([x, z], i) => ({ ...genChunk(x + 40, z + 40), key: chunksA[i].key }));
  await storage.saveChunks(A, chunksA);
  await storage.saveChunks(B, chunksB);
  const keysA = await storage.chunkKeys(A);
  r.ok(keysA.size === chunksA.length && chunksA.every((c) => keysA.has(c.key)), `chunkKeys(A) : ${keysA.size} clés`);
  r.ok((await storage.chunkKeys(B)).size === 3, 'chunkKeys(B) : 3 clés');
  for (const c of chunksA) r.ok(chunkEquals(await storage.loadChunk(A, c.key), c), `A chunk ${c.key} identique octet à octet`);
  for (const c of chunksB) r.ok(chunkEquals(await storage.loadChunk(B, c.key), c), `B chunk ${c.key} identique octet à octet`);
  r.ok((await storage.loadChunk(A, chunkKey(500, 500))) === undefined, 'chunk absent → undefined');

  const sizeA = await storage.worldSize(A);
  const sizeB = await storage.worldSize(B);
  r.ok(sizeA > 32768 * 2 && sizeA < 68096 * chunksA.length, `worldSize(A) = ${sizeA}`);
  r.ok(sizeB > 0 && sizeB < sizeA, `worldSize(B) = ${sizeB}`);
  r.log(`worldSize : A = ${sizeA} octets (6 chunks dont 1 de bruit), B = ${sizeB} octets (3 chunks)`);

  // Enregistrement réellement stocké : Uint8Array compressé, pas de base64.
  const raw = await new Promise<IDBDatabase>((res, rej) => {
    const q = indexedDB.open(DB);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  const tx = raw.transaction(['chunks'], 'readonly');
  const rec = await new Promise<Record<string, unknown>>((res, rej) => {
    const q = tx.objectStore('chunks').get([A, chunksA[0].key]);
    q.onsuccess = () => res(q.result as Record<string, unknown>);
    q.onerror = () => rej(q.error);
  });
  const stored = rec.blocks as Uint8Array;
  r.ok(stored instanceof Uint8Array && stored.length === rleEncode(chunksA[0].blocks).length, `blocs stockés : Uint8Array de ${stored.length} octets`);
  r.ok([...raw.objectStoreNames].join() === 'chunks,worlds' && raw.version === 1, `magasins ${[...raw.objectStoreNames].join()}, version ${raw.version}`);
  r.ok(JSON.stringify(tx.objectStore('chunks').keyPath) === '["worldId","key"]', 'clé composée [worldId, key]');
  raw.close();

  // Suppression d'un monde sans toucher à l'autre.
  await storage.deleteWorld(A);
  r.ok((await storage.getWorld(A)) === undefined && (await storage.chunkKeys(A)).size === 0 && (await storage.worldSize(A)) === 0, 'monde A supprimé avec ses chunks');
  r.ok((await storage.chunkKeys(B)).size === 3 && (await storage.worldSize(B)) === sizeB, 'monde B intact (clés, taille)');
  for (const c of chunksB) r.ok(chunkEquals(await storage.loadChunk(B, c.key), c), `B chunk ${c.key} intact après suppression de A`);

  // Erreurs explicites.
  await rejects(r, () => storage.putWorld({ ...world(createWorldId(), 'x', 1), state: { f: () => 1 } }), 'état non clonable', /Enregistrement du monde/);
  await rejects(r, () => storage.loadChunk(B, NaN), 'clé NaN', /clé de chunk invalide/);
  const good = noiseChunk(8, 8);
  await rejects(r, () => storage.saveChunks(B, [good, { ...noiseChunk(9, 9), entities: [() => 1] }]), 'lot avec entité non clonable', /Sauvegarde de 2 chunk/);
  r.ok(!(await storage.chunkKeys(B)).has(good.key), 'lot rejeté : rien écrit');

  // Volume : 400 chunks générés, par lots de 16.
  const many: SavedChunk[] = [];
  for (let cx = 0; cx < 20; cx++) for (let cz = 0; cz < 20; cz++) many.push({ ...genChunk(cx, cz), blockEntities: [], entities: [] });
  let t = performance.now();
  for (let i = 0; i < many.length; i += 16) await storage.saveChunks(PERSIST_ID, many.slice(i, i + 16));
  const tSave = performance.now() - t;
  t = performance.now();
  const keys = await storage.chunkKeys(PERSIST_ID);
  const tKeys = performance.now() - t;
  t = performance.now();
  const size = await storage.worldSize(PERSIST_ID);
  const tSize = performance.now() - t;
  t = performance.now();
  let allEqual = true;
  for (const c of many) if (!chunkEquals(await storage.loadChunk(PERSIST_ID, c.key), c)) allEqual = false;
  const tLoad = performance.now() - t;
  r.ok(keys.size === 400, 'chunkKeys : 400 clés');
  r.ok(allEqual, '400 chunks relus identiques octet à octet');
  r.ok(size > 0 && size < 400 * 68096 / 4, `worldSize de 400 chunks : ${size} octets`);
  r.log(`400 chunks : sauvegarde ${tSave.toFixed(0)} ms (25 lots de 16), chunkKeys ${tKeys.toFixed(1)} ms, worldSize ${tSize.toFixed(1)} ms, relecture ${(tLoad / 400).toFixed(2)} ms/chunk`);
  r.log(`400 chunks : ${size} octets stockés pour ${400 * 68096} octets bruts (${(100 * size / (400 * 68096)).toFixed(1)} %, ×${(400 * 68096 / size).toFixed(1)})`);
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    r.log(`navigator.storage.estimate : usage ${est.usage} octets`);
  }

  // Worker : même base, lecture et écriture.
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const reply = await new Promise<{ ok: boolean; persistent?: boolean; keys?: number; blocks?: Uint8Array | null; error?: string }>((res) => {
    worker.onmessage = (e) => res(e.data);
    worker.onerror = (e) => res({ ok: false, error: e.message });
    worker.postMessage({ worldId: PERSIST_ID, key: many[0].key, writeKey: chunkKey(1000, 1000) });
  });
  worker.terminate();
  r.ok(reply.ok && reply.persistent === true && reply.keys === 400 && !!reply.blocks && same(reply.blocks, many[0].blocks), `worker : lecture du même monde (${reply.ok ? 'ok' : reply.error})`);
  r.ok((await storage.chunkKeys(PERSIST_ID)).size === 401, 'chunk écrit par le worker visible depuis la page');
  r.ok(chunkEquals(await storage.loadChunk(PERSIST_ID, chunkKey(1000, 1000)), { ...many[0], key: chunkKey(1000, 1000) }), 'chunk écrit par le worker relu identique');

  // Réglages dans le vrai localStorage.
  localStorage.removeItem('aetherbricks.settings');
  r.ok(JSON.stringify(loadSettings()) === JSON.stringify(DEFAULT_SETTINGS), 'réglages : défauts');
  saveSettings({ ...DEFAULT_SETTINGS, renderDistance: 40, fov: 95, invertY: true, guiScale: 2 });
  const s = loadSettings();
  r.ok(s.renderDistance === 16 && s.fov === 95 && s.invertY === true && s.guiScale === 2, 'réglages : aller-retour borné');
  r.ok(JSON.parse(localStorage.getItem('aetherbricks.settings') ?? '{}').renderDistance === 16, 'réglages : clé aetherbricks.settings');
  localStorage.setItem('aetherbricks.settings', '{cassé');
  r.ok(JSON.stringify(loadSettings()) === JSON.stringify(DEFAULT_SETTINGS), 'réglages : JSON invalide → défauts');
  saveSettings({ ...DEFAULT_SETTINGS, fov: 95 });
  return r;
}

/** Phase 2 (après rechargement de la page) : tout est encore là, à l'octet près. */
async function phase2(): Promise<Report> {
  const r = newReport();
  const storage = await Storage.open();
  r.ok(storage.persistent === true, 'persistent === true après rechargement');
  const list = await storage.listWorlds();
  r.ok(list.length === 2 && list[0].name === 'Bêta' && list[1].name === 'Persistant', `mondes retrouvés (${list.map((w) => w.name).join()})`);
  const p = await storage.getWorld(PERSIST_ID);
  r.ok(p?.thumbnail === 'data:image/png;base64,AAAA' && (p?.state as { time: number } | null)?.time === 6000, 'état et miniature retrouvés');
  const keys = await storage.chunkKeys(PERSIST_ID);
  r.ok(keys.size === 401, `chunkKeys après rechargement : ${keys.size}`);
  let equal = 0;
  for (let cx = 0; cx < 20; cx += 3) {
    for (let cz = 0; cz < 20; cz += 3) {
      const ref = { ...genChunk(cx, cz), blockEntities: [], entities: [] };
      if (chunkEquals(await storage.loadChunk(PERSIST_ID, ref.key), ref)) equal++;
    }
  }
  r.ok(equal === 49, `49 chunks régénérés et comparés après rechargement : ${equal} identiques`);
  r.ok(loadSettings().fov === 95, 'réglages retrouvés après rechargement');
  return r;
}

/** Quota : à lancer après avoir réduit le quota de l'origine (CDP). */
async function quota(): Promise<Report> {
  const r = newReport();
  const storage = await Storage.open();
  const id = createWorldId();
  await storage.putWorld(world(id, 'Quota', 1));
  let error: unknown;
  let written = 0;
  try {
    for (let i = 0; i < 400; i++) {
      await storage.saveChunks(id, [noiseChunk(i, 0), noiseChunk(i, 1), noiseChunk(i, 2), noiseChunk(i, 3)]);
      written += 4;
    }
  } catch (e) {
    error = e;
  }
  r.ok(error instanceof Error, `quota : saveChunks rejette avec une Error après ${written} chunks de bruit`);
  r.ok(error instanceof Error && /Sauvegarde de 4 chunk\(s\) impossible : espace de stockage insuffisant \(quota dépassé\)/.test(error.message), `quota : message « ${error instanceof Error ? error.message : String(error)} »`);
  r.ok(error instanceof Error && (error.cause as { name?: string } | undefined)?.name === 'QuotaExceededError', 'quota : cause d\'origine = QuotaExceededError');
  r.log(`quota : ${written} chunks écrits avant le refus ; message « ${error instanceof Error ? error.message : String(error)} »`);
  // Le lot refusé n'a rien laissé derrière lui, et la base reste utilisable.
  const keys = await storage.chunkKeys(id);
  r.ok(keys.size === written, `quota : ${keys.size} clés pour ${written} chunks validés (lot refusé annulé en entier)`);
  await storage.deleteWorld(id);
  r.ok((await storage.chunkKeys(id)).size === 0 && (await storage.getWorld(id)) === undefined, 'quota : suppression possible après le refus');
  return r;
}

/** Mise à niveau par « une autre page », puis effacement de la base. */
async function versionChange(): Promise<Report> {
  const r = newReport();
  const storage = await Storage.open();
  r.ok((await storage.listWorlds()).length >= 1, 'avant mise à niveau : lecture normale');
  let blocked = false;
  const t = performance.now();
  const v2 = await new Promise<IDBDatabase>((res, rej) => {
    const q = indexedDB.open(DB, 2);
    q.onblocked = () => { blocked = true; };
    q.onupgradeneeded = () => {};
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  r.ok(v2.version === 2, `mise à niveau étrangère aboutie en ${(performance.now() - t).toFixed(0)} ms (onblocked : ${blocked})`);
  r.ok(!blocked, 'la connexion de Storage s\'est fermée sans bloquer la mise à niveau');
  await rejects(r, () => storage.listWorlds(), 'listWorlds après mise à niveau étrangère', /Lecture de la liste des mondes impossible/);
  const fallback = await Storage.open();
  r.ok(fallback.persistent === false, 'open() face à une version supérieure : repli mémoire sans rejet');
  await fallback.putWorld(world('m', 'Mémoire', 1));
  r.ok((await fallback.listWorlds()).length === 1, 'repli mémoire utilisable');
  v2.close();
  r.log(`suppression de la base : ${await deleteDb()}`);
  r.ok((await storage.listWorlds()).length === 0, 'après effacement de la base : reconnexion automatique, base vide');
  await storage.putWorld(world('z', 'Après', 1));
  r.ok((await storage.getWorld('z'))?.name === 'Après', 'écriture après reconnexion');
  r.log(`nettoyage final : ${await deleteDb()}`);
  return r;
}

const api = { phase1, phase2, quota, versionChange };
(window as unknown as { storageTests: typeof api }).storageTests = api;
const out = document.getElementById('out');
if (out) out.textContent = 'Prêt : window.storageTests.{phase1, phase2, quota, versionChange}()';
