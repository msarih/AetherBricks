import { defineConfig, Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

interface StoredWorld {
  id: string;
  ownerId: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  bricks: unknown[];
  playerState?: {
    x: number;
    y: number;
    z: number;
    viewMode?: string;
    lightingIdx?: number;
  };
}

interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  isGuest: boolean;
  createdAt: number;
  activeWorldId?: string;
}

interface DatabaseSchema {
  users: StoredUser[];
  worlds: StoredWorld[];
}

function aetherBricksDatabasePlugin(): Plugin {
  const dataDir = path.resolve(process.cwd(), 'data');
  const dbFilePath = path.join(dataDir, 'database.json');

  function readDb(): DatabaseSchema {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      if (!fs.existsSync(dbFilePath)) {
        const initial: DatabaseSchema = { users: [], worlds: [] };
        fs.writeFileSync(dbFilePath, JSON.stringify(initial, null, 2), 'utf-8');
        return initial;
      }
      const raw = fs.readFileSync(dbFilePath, 'utf-8');
      return JSON.parse(raw) as DatabaseSchema;
    } catch {
      return { users: [], worlds: [] };
    }
  }

  function writeDb(db: DatabaseSchema): void {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(dbFilePath, JSON.stringify(db, null, 2), 'utf-8');
  }

  return {
    name: 'aetherbricks-sqlite-json-db',
    configureServer(server) {
      server.middlewares.use('/api/db', (req, res, next) => {
        if (!req.url) return next();

        res.setHeader('Content-Type', 'application/json');

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', () => {
          try {
            const db = readDb();
            const url = new URL(req.url!, 'http://localhost');

            // GET /api/db/state?userId=...
            if (req.method === 'GET' && url.pathname === '/state') {
              const userId = url.searchParams.get('userId');
              const user = db.users.find((u) => u.id === userId) || null;
              const worlds = userId
                ? db.worlds
                    .filter((w) => w.ownerId === userId)
                    .sort((a, b) => b.updatedAt - a.updatedAt)
                : [];
              res.end(JSON.stringify({ ok: true, user, worlds }));
              return;
            }

            const payload = body ? JSON.parse(body) : {};

            // POST /api/db/auth/register
            if (req.method === 'POST' && url.pathname === '/auth/register') {
              const { username, passwordHash, convertGuestId } = payload;
              const cleanName = String(username || '').trim();
              if (!cleanName || cleanName.length < 2) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Pseudo trop court (min 2 caractères).' }));
                return;
              }
              const existing = db.users.find(
                (u) => !u.isGuest && u.username.toLowerCase() === cleanName.toLowerCase()
              );
              if (existing) {
                res.statusCode = 409;
                res.end(JSON.stringify({ ok: false, error: 'Ce pseudo existe déjà. Connectez-vous !' }));
                return;
              }

              // If converting a guest account, upgrade it in place so all worlds are kept
              if (convertGuestId) {
                const guestUser = db.users.find((u) => u.id === convertGuestId && u.isGuest);
                if (guestUser) {
                  guestUser.username = cleanName;
                  guestUser.passwordHash = String(passwordHash || '');
                  guestUser.isGuest = false;
                  writeDb(db);
                  const worlds = db.worlds.filter((w) => w.ownerId === guestUser.id);
                  res.end(JSON.stringify({ ok: true, user: guestUser, worlds }));
                  return;
                }
              }

              const newUser: StoredUser = {
                id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                username: cleanName,
                passwordHash: String(passwordHash || ''),
                isGuest: false,
                createdAt: Date.now(),
              };
              db.users.push(newUser);
              writeDb(db);
              res.end(JSON.stringify({ ok: true, user: newUser, worlds: [] }));
              return;
            }

            // POST /api/db/auth/login
            if (req.method === 'POST' && url.pathname === '/auth/login') {
              const { username, passwordHash } = payload;
              const cleanName = String(username || '').trim().toLowerCase();
              const user = db.users.find(
                (u) => !u.isGuest && u.username.toLowerCase() === cleanName
              );
              if (!user || user.passwordHash !== String(passwordHash || '')) {
                res.statusCode = 401;
                res.end(JSON.stringify({ ok: false, error: 'Pseudo ou mot de passe incorrect.' }));
                return;
              }
              const worlds = db.worlds
                .filter((w) => w.ownerId === user.id)
                .sort((a, b) => b.updatedAt - a.updatedAt);
              res.end(JSON.stringify({ ok: true, user, worlds }));
              return;
            }

            // POST /api/db/auth/guest
            if (req.method === 'POST' && url.pathname === '/auth/guest') {
              const { guestId } = payload;
              let user = guestId ? db.users.find((u) => u.id === guestId) : undefined;
              if (!user) {
                user = {
                  id: guestId || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  username: 'Architecte Invité',
                  passwordHash: '',
                  isGuest: true,
                  createdAt: Date.now(),
                };
                db.users.push(user);
                writeDb(db);
              }
              const worlds = db.worlds
                .filter((w) => w.ownerId === user.id)
                .sort((a, b) => b.updatedAt - a.updatedAt);
              res.end(JSON.stringify({ ok: true, user, worlds }));
              return;
            }

            // POST /api/db/worlds/save
            if (req.method === 'POST' && url.pathname === '/worlds/save') {
              const { world, activeWorldId } = payload as {
                world: StoredWorld;
                activeWorldId?: string;
              };
              if (!world || !world.id || !world.ownerId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Données du monde invalides.' }));
                return;
              }
              const idx = db.worlds.findIndex((w) => w.id === world.id);
              world.updatedAt = Date.now();
              if (idx >= 0) {
                db.worlds[idx] = world;
              } else {
                world.createdAt = world.createdAt || Date.now();
                db.worlds.push(world);
              }

              const owner = db.users.find((u) => u.id === world.ownerId);
              if (owner && activeWorldId) {
                owner.activeWorldId = activeWorldId;
              }

              writeDb(db);
              res.end(JSON.stringify({ ok: true, world }));
              return;
            }

            // POST /api/db/worlds/delete
            if (req.method === 'POST' && url.pathname === '/worlds/delete') {
              const { worldId, ownerId } = payload;
              db.worlds = db.worlds.filter((w) => !(w.id === worldId && w.ownerId === ownerId));
              writeDb(db);
              const worlds = db.worlds
                .filter((w) => w.ownerId === ownerId)
                .sort((a, b) => b.updatedAt - a.updatedAt);
              res.end(JSON.stringify({ ok: true, worlds }));
              return;
            }

            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: 'Route API introuvable' }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [aetherBricksDatabasePlugin()],
});
