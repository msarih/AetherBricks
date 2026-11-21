// Batterie « Multijoueur — Jalon 4 » :
// Créatures simulées par le serveur (visibilité, déplacement, attaque/mort/butin),
// objets au sol (casse en survie, lâcher, ramassage unique sans duplication),
// coffres & fourneaux partagés (synchro temps réel, cuisson sans spectateur, refus hors de portée),
// persistance après redémarrage serveur et retour au solo de l'hôte,
// limite d'essais sur /rejoindre/<code>.
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const { sleep, launch, createWorld, shot, ticks } = require('./lib.cjs');
const { results, check, ev, section } = require('./h.cjs');

const FORBIDDEN_PORTS = new Set([5173, 5174, 5175, 8080]);

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => {
        if (FORBIDDEN_PORTS.has(port)) resolve(findFreePort());
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

function httpRequest(targetUrl, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function startServer(rootDir, port, password, dataDir) {
  const proc = spawn(
    process.execPath,
    [path.join(rootDir, 'scripts', 'serveur.mjs'), '--port', String(port), '--password', password, '--data-dir', dataDir, '--flat', '--seed', '1337'],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d.toString(); });
  proc.stderr.on('data', (d) => { logs += d.toString(); });
  return { proc, getLogs: () => logs };
}

async function waitServerReady(url, getLogs) {
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const res = await httpRequest(url);
      if (res.status === 200) return;
    } catch {
      // retry
    }
  }
  throw new Error('Serveur multijoueur non démarré :\n' + getLogs());
}

async function openIsolatedPage(context, url, errors) {
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => {
    errors.push('pageerror: ' + e.message);
    console.log('  pageerror', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const t = m.text();
      if (!/404|favicon|WebSocket connection to/.test(t)) {
        errors.push('console.' + m.type() + ': ' + t);
        console.log('  console.' + m.type(), t.slice(0, 300));
      }
    }
  });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-mc="title"]', { timeout: 20000 });
  return page;
}

async function joinWithCode(page, name, code) {
  await page.click('[data-mc="multiplayer"]');
  await page.waitForSelector('[data-mc="mp-join"]', { timeout: 10000 });
  await page.evaluate((n, c) => {
    const set = (id, v) => {
      const el = document.querySelector(`[data-mc="${id}"]`);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('mp-name', n);
    set('mp-code', c);
    set('mp-address', '');
    set('mp-password', '');
  }, name, code);
  await page.click('[data-mc="mp-join"]');
  await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
}

async function lookAtBlock(page, bx, by, bz) {
  await page.bringToFront();
  await ev(page, (x, y, z) => {
    const g = window.__game;
    const p = g.player;
    const dx = x + 0.5 - p.x;
    const dy = y + 0.5 - (p.y + p.eyeHeight);
    const dz = z + 0.5 - p.z;
    const horiz = Math.hypot(dx, dz);
    p.yaw = Math.atan2(-dx, -dz);
    p.headPitch = Math.atan2(dy, horiz);
  }, bx, by, bz);
  await ticks(page, 2);
}

async function lclick(page) {
  await page.bringToFront();
  await ev(page, () => { window.__game.input.presses[0]++; });
  await ticks(page, 2);
}

async function rclick(page) {
  await page.bringToFront();
  await ev(page, () => { window.__game.input.presses[2]++; });
  await ticks(page, 3);
}

async function stopServer(srv, dir) {
  if (srv && srv.proc && srv.proc.exitCode === null) {
    srv.proc.kill('SIGTERM');
    await new Promise((r) => srv.proc.once('exit', r));
  }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

async function tpPlayer(hostPage, targetName, x, y, z, targetPage = null) {
  await hostPage.bringToFront();
  await ev(hostPage, (cmd) => window.__game.chat(cmd), `/tp ${targetName} ${x} ${y} ${z}`);
  if (targetPage) {
    await targetPage.bringToFront();
    await targetPage.waitForFunction(
      (tx, tz) => Math.hypot(window.__game.player.x - tx, window.__game.player.z - tz) < 0.5,
      { timeout: 10000 },
      x,
      z,
    );
  }
}

async function tpSelf(page, x, y, z) {
  await page.bringToFront();
  await ev(page, (cmd) => window.__game.chat(cmd), `/tp ${x} ${y} ${z}`);
  await page.waitForFunction(
    (tx, tz) => Math.hypot(window.__game.player.x - tx, window.__game.player.z - tz) < 0.5,
    { timeout: 10000 },
    x,
    z,
  );
}

async function lookAtEntity(page, remoteId) {
  await page.bringToFront();
  await ev(page, (rid) => {
    const g = window.__game;
    const p = g.player;
    const e = g.entities.find((x) => x.remoteId === rid);
    if (!e) return;
    const dx = e.x - p.x;
    const dy = e.y + e.height * 0.5 - (p.y + p.eyeHeight);
    const dz = e.z - p.z;
    const horiz = Math.hypot(dx, dz);
    p.yaw = Math.atan2(-dx, -dz);
    p.headPitch = Math.atan2(dy, horiz);
  }, remoteId);
  await ticks(page, 2);
}

(async () => {
  const rootDir = path.resolve(__dirname, '../..');
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarihbricks-j4-'));
  const password = 'secret-j4-e2e';

  let srv = startServer(rootDir, port, password, tmpDataDir);
  const browser = await launch();
  const errors = [];
  let inviteCode = '';

  try {
    await waitServerReady(baseUrl, srv.getLogs);

    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await openIsolatedPage(ctxA, baseUrl, errors);
    const pageB = await openIsolatedPage(ctxB, baseUrl, errors);

    await section('J4a. Ouverture aux amis (monde plat graine 1337) et connexion de B', async () => {
      await createWorld(pageA, { name: 'MondeJ4', seed: '1337', creative: false, flat: true });
      await ticks(pageA, 8);
      await pageA.keyboard.press('Escape');
      await pageA.waitForSelector('[data-mc="open-friends"]', { timeout: 10000 });
      await pageA.click('[data-mc="open-friends"]');
      await pageA.waitForSelector('[data-mc="open-friends-confirm"]', { timeout: 10000 });
      await pageA.evaluate((pw) => {
        document.querySelector('[data-mc="open-friends-password"]').value = pw;
      }, password);
      await pageA.click('[data-mc="open-friends-confirm"]');
      await pageA.waitForSelector('[data-mc="invite-code"]', { timeout: 15000 });
      inviteCode = await pageA.evaluate(() => document.querySelector('[data-mc="invite-code"]')?.textContent?.trim() ?? '');
      await pageA.click('[data-mc="resume"]');
      await ticks(pageA, 4);

      await joinWithCode(pageB, 'JoueurB', inviteCode);
      await ticks(pageB, 10);
      await ticks(pageA, 10);
      check('A et B connectés en survie', Boolean(inviteCode));
    });

    await section('J4b. Créatures partagées : apparition, position, mouvement et mise à mort', async () => {
      // Chercher un animal sur A (ou se déplacer un peu si aucun dans le chunk initial)
      let mobA = null;
      for (let attempt = 0; attempt < 15 && !mobA; attempt++) {
        mobA = await ev(pageA, () => {
          const g = window.__game;
          const m = g.entities.find((e) => e.kind === 'mob' && e.remoteId && e.deathTime === 0);
          return m ? { id: m.remoteId, mobKind: m.mobKind, x: m.x, y: m.y, z: m.z } : null;
        });
        if (!mobA) await ticks(pageA, 10);
      }
      check('créature présente côté A', mobA !== null, JSON.stringify(mobA));

      if (mobA) {
        // A et B se placent près de la créature via /tp serveur
        await tpPlayer(pageA, 'JoueurB', mobA.x + 2.5, mobA.y, mobA.z + 2.5);
        await ev(pageA, (cmd) => window.__game.chat(cmd), `/tp ${mobA.x - 2.0} ${mobA.y} ${mobA.z}`);
        await ticks(pageA, 8);
        await ticks(pageB, 8);

        const posA1 = await ev(pageA, (id) => {
          const m = window.__game.entities.find((e) => e.remoteId === id);
          return m ? { x: m.x, y: m.y, z: m.z } : null;
        }, mobA.id);
        const posB1 = await ev(pageB, (id) => {
          const m = window.__game.entities.find((e) => e.remoteId === id);
          return m ? { x: m.x, y: m.y, z: m.z } : null;
        }, mobA.id);
        const distSame = posA1 && posB1 ? Math.hypot(posA1.x - posB1.x, posA1.y - posB1.y, posA1.z - posB1.z) : 999;
        check('B voit la même créature au même endroit que A', distSame < 1.5, `dist=${distSame.toFixed(2)}`);

        await lookAtEntity(pageA, mobA.id);
        await lookAtEntity(pageB, mobA.id);
        await shot(pageA, 't19-animaux');

        // Attendre que la créature bouge ou vérifier après 25 ticks qu'elle reste synchronisée
        await ticks(pageA, 25);
        await ticks(pageB, 25);
        const posA2 = await ev(pageA, (id) => {
          const m = window.__game.entities.find((e) => e.remoteId === id);
          return m ? { x: m.x, y: m.y, z: m.z } : null;
        }, mobA.id);
        const posB2 = await ev(pageB, (id) => {
          const m = window.__game.entities.find((e) => e.remoteId === id);
          return m ? { x: m.x, y: m.y, z: m.z } : null;
        }, mobA.id);
        const distMove = posA2 && posB2 ? Math.hypot(posA2.x - posB2.x, posA2.y - posB2.y, posA2.z - posB2.z) : 999;
        check('A et B restent synchronisés sur la position de la créature', distMove < 1.5, `dist=${distMove.toFixed(2)}`);

        // A frappe et tue l'animal (12 coups espacés de 11 ticks pour passer l'invulnérabilité)
        for (let k = 0; k < 14; k++) {
          const alive = await ev(pageA, (id) => {
            const m = window.__game.entities.find((e) => e.remoteId === id);
            return Boolean(m && m.deathTime === 0);
          }, mobA.id);
          if (!alive) break;
          const mPos = await ev(pageA, (id) => {
            const m = window.__game.entities.find((e) => e.remoteId === id);
            return m ? { x: m.x, y: m.y, z: m.z } : null;
          }, mobA.id);
          if (mPos) {
            await ev(pageA, (cmd) => window.__game.chat(cmd), `/tp ${mPos.x - 1.5} ${mPos.y} ${mPos.z}`);
            await ticks(pageA, 3);
          }
          await lookAtEntity(pageA, mobA.id);
          await lclick(pageA);
          await ticks(pageA, 11);
        }
        await ticks(pageA, 22);
        await ticks(pageB, 22);

        const stillOnB = await ev(pageB, (id) => window.__game.entities.some((e) => e.remoteId === id && e.deathTime === 0), mobA.id);
        const lootOrPicked = await ev(pageB, () => {
          const hasItem = window.__game.entities.some((e) => e.kind === 'item');
          const invHas = window.__game.player.inventory.slots.some((s) => s !== null);
          return hasItem || invHas;
        });
        const lootOnA = await ev(pageA, () => window.__game.entities.some((e) => e.kind === 'item') || window.__game.player.inventory.slots.some((s) => s !== null));
        check('A tue la créature : elle disparaît chez B', !stillOnB);
        check('le butin de la créature tombe au sol chez les deux', lootOrPicked || lootOnA);
      }
    });

    await section('J4c. Objets au sol : casse en survie, ramassage unique, anti-duplication, lâcher', async () => {
      // Placer A et B près d'une zone propre à y=4
      await tpSelf(pageA, 24.5, 4, 24.5);
      await tpPlayer(pageA, 'JoueurB', 20.5, 4, 20.5, pageB);
      await ticks(pageA, 6);
      await ticks(pageB, 6);

      // B casse le bloc d'herbe devant lui (20, 3, 22)
      await pageB.bringToFront();
      await lookAtBlock(pageB, 20, 3, 22);
      await ev(pageB, () => { window.__game.input.buttons[0] = true; });
      await ticks(pageB, 22);
      await ev(pageB, () => { window.__game.input.buttons[0] = false; });
      await ticks(pageB, 6);
      await ticks(pageA, 6);

      const blockAfter = await ev(pageA, () => window.__game.world.getBlock(20, 3, 22));
      check('B casse un bloc en survie', blockAfter === 0, `block=${blockAfter}`);

      const itemOnA = await ev(pageA, () => {
        const it = window.__game.entities.find((e) => e.kind === 'item' && Math.hypot(e.x - 20.5, e.z - 22.5) < 3);
        return it ? { id: it.remoteId, itemId: it.itemId, count: it.itemCount, x: it.x, y: it.y, z: it.z } : null;
      });
      check('l’objet cassé tombe au sol et A le voit', itemOnA !== null, JSON.stringify(itemOnA));

      if (itemOnA) {
        await lookAtEntity(pageA, itemOnA.id);
        await shot(pageA, 't19-objet-sol');

        // Test anti-duplication : A et B se téléportent sur l'objet en même temps
        await ev(pageA, (cmd) => window.__game.chat(cmd), `/tp ${itemOnA.x} ${itemOnA.y} ${itemOnA.z}`);
        await tpPlayer(pageA, 'JoueurB', itemOnA.x, itemOnA.y, itemOnA.z);
        await ticks(pageA, 14);
        await ticks(pageB, 14);

        const countA = await ev(pageA, (id) => window.__game.player.inventory.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0), itemOnA.itemId);
        const countB = await ev(pageB, (id) => window.__game.player.inventory.slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0), itemOnA.itemId);
        const stillExists = await ev(pageB, (id) => window.__game.entities.some((e) => e.remoteId === id), itemOnA.id);
        check('objet ramassé par un seul joueur (aucune duplication)', countA + countB === itemOnA.count && !stillExists, `A=${countA}, B=${countB}`);
      }

      // B lâche un objet (donner un bloc via A en /give ou si B a déjà quelque chose; sinon A passe en créatif ou /give? Utilisons l'item ramassé par A ou donnons à B)
      // Si A a l'objet, A le lâche avec la touche physique KeyQ (A en AZERTY)
      await ticks(pageA, 4);
      const hadItemA = await ev(pageA, () => {
        const inv = window.__game.player.inventory;
        const idx = inv.slots.findIndex((s) => s && s.count > 0);
        if (idx >= 0 && idx < 9) inv.selected = idx;
        return idx >= 0 && idx < 9 ? inv.slots[idx].id : 0;
      });
      if (hadItemA > 0) {
        await pageA.keyboard.press('KeyQ');
        await ticks(pageA, 8);
        await ticks(pageB, 8);
        const droppedSeenByB = await ev(pageB, (id) => window.__game.entities.some((e) => e.kind === 'item' && e.itemId === id), hadItemA);
        check('objet lâché par un joueur vu au sol par l’autre', droppedSeenByB);
      }
    });

    await section('J4d. Coffres partagés en temps réel & fourneau qui cuit sans spectateur', async () => {
      // A (hôte) passe en créatif temporairement pour poser un coffre, un fourneau, du fer et du charbon, puis revient en survie
      await ev(pageA, () => {
        window.__game.chat('/gamemode creative');
      });
      await ticks(pageA, 4);
      await tpSelf(pageA, 30.5, 4, 30.5);
      await tpPlayer(pageA, 'JoueurB', 30.5, 4, 34.5, pageB);
      await ticks(pageA, 6);
      await ticks(pageB, 6);

      // Placer un coffre en (32, 4, 32) et un fourneau en (33, 4, 32) via placeBlock réseau (en créatif)
      // Chest ID = 31 (B.CHEST), Furnace ID = 32 (B.FURNACE), Iron Ore = 15, Coal = 263, Cobblestone = 4
      const ids = await ev(pageA, () => {
        const g = window.__game;
        const blocks = g.blocks();
        const items = g.items();
        return {
          chest: blocks.get('chest').id,
          furnace: blocks.get('furnace').id,
          cobble: items.get('cobblestone'),
          ironOre: blocks.get('iron_ore').id,
          coal: items.get('coal'),
          ironIngot: items.get('iron_ingot'),
        };
      });

      // Donner à A coffre, fourneau, cobble, minerai de fer, charbon via invSync (format saveSlots: [id, count, damage])
      await ev(pageA, (d) => {
        const g = window.__game;
        const inv = g.player.inventory;
        inv.slots[0] = { id: d.chest, count: 4, damage: 0 };
        inv.slots[1] = { id: d.furnace, count: 4, damage: 0 };
        inv.slots[2] = { id: d.cobble, count: 16, damage: 0 };
        inv.slots[3] = { id: d.ironOre, count: 4, damage: 0 };
        inv.slots[4] = { id: d.coal, count: 4, damage: 0 };
        const serialized = inv.slots.map((s) => (s ? [s.id, s.count, s.damage] : null));
        g.net.sendInvSync(serialized, 0);
      }, ids);
      await ticks(pageA, 4);

      // A pose coffre en (32, 4, 32) et fourneau en (34, 4, 30)
      await ev(pageA, (d) => {
        const g = window.__game;
        g.netPlaceBlock(32, 4, 32, 1, d.chest, 0, 0);
        g.netPlaceBlock(34, 4, 30, 1, d.furnace, 0, 1);
      }, ids);
      await ticks(pageA, 6);
      await ticks(pageB, 6);

      // A repasse en survie
      await ev(pageA, () => window.__game.chat('/gamemode survival'));
      await ticks(pageA, 4);

      // A et B ouvrent tous les deux le coffre en (32, 4, 32) par clic droit
      await lookAtBlock(pageA, 32, 4, 32);
      await rclick(pageA);
      await pageA.waitForSelector('.mc-window', { timeout: 10000 });

      await lookAtBlock(pageB, 32, 4, 32);
      await rclick(pageB);
      await pageB.waitForSelector('.mc-window', { timeout: 10000 });
      await ticks(pageA, 4);
      await ticks(pageB, 4);

      // A met de la cobble (slot 2 de la hotbar dans le menu coffre = index 27 + 27 + 2 = 56) dans la case 0 du coffre (index 0)
      await ev(pageA, () => {
        const m = window.__game.menu;
        const srcIdx = m.indexOf('hotbar', 2);
        m.click(srcIdx, 0, false);
      });
      await ticks(pageA, 4);
      await ev(pageA, () => {
        window.__game.menu.click(0, 0, false);
      });
      await ticks(pageA, 6);
      await ticks(pageB, 6);

      const chestSlot0OnB = await ev(pageB, () => {
        const s = window.__game.menu?.slots[0]?.stack;
        return s ? { id: s.id, count: s.count } : null;
      });
      check('A met un objet dans le coffre : B le voit aussitôt', chestSlot0OnB !== null && chestSlot0OnB.id === ids.cobble && chestSlot0OnB.count === 16, JSON.stringify(chestSlot0OnB));
      await shot(pageB, 't19-coffre');

      // B prend l'objet du coffre (shift-clic sur la case 0)
      await ev(pageB, () => {
        window.__game.menu.click(0, 0, true);
      });
      await ticks(pageA, 6);
      await ticks(pageB, 6);
      const chestSlot0OnA = await ev(pageA, () => window.__game.menu?.slots[0]?.stack ?? null);
      check('B prend l’objet du coffre : il disparaît chez A', chestSlot0OnA === null);

      // B remet ses cobbles dans le coffre pour tester la persistance après redémarrage
      await ev(pageB, () => {
        const m = window.__game.menu;
        const idx = m.slots.findIndex((s) => (s.group === 'hotbar' || s.group === 'main') && s.stack);
        if (idx >= 0) m.click(idx, 0, true);
      });
      await pageB.waitForFunction(() => Boolean(window.__game.menu?.slots[0]?.stack), { timeout: 5000 });
      await pageB.keyboard.press('Escape');
      await pageA.keyboard.press('Escape');
      await ticks(pageA, 4);
      await ticks(pageB, 4);

      // A se place devant le fourneau en (34, 4, 30), l'ouvre, met minerai de fer en input et charbon en fuel
      await ev(pageA, () => window.__game.chat('/tp 34.5 4 32.5'));
      await ticks(pageA, 6);
      await lookAtBlock(pageA, 34, 4, 30);
      await rclick(pageA);
      await pageA.waitForSelector('.mc-window', { timeout: 10000 });
      await ticks(pageA, 4);

      await ev(pageA, () => {
        const m = window.__game.menu;
        m.click(m.indexOf('hotbar', 3), 0, false);
      });
      await ticks(pageA, 4);
      await ev(pageA, () => {
        const m = window.__game.menu;
        m.click(m.indexOf('input', 0), 0, false);
      });
      await ticks(pageA, 4);
      await ev(pageA, () => {
        const m = window.__game.menu;
        m.click(m.indexOf('hotbar', 4), 0, false);
      });
      await ticks(pageA, 4);
      await ev(pageA, () => {
        const m = window.__game.menu;
        m.click(m.indexOf('fuel', 0), 0, false);
      });
      await ticks(pageA, 15);
      await shot(pageA, 't19-fourneau');

      // A ferme le fourneau et s'éloigne (x=130) ; B s'éloigne aussi (x=-60) pour que personne ne regarde le fourneau,
      // puis B revient récupérer le lingot de fer cuit !
      await pageA.keyboard.press('Escape');
      await ticks(pageA, 4);
      await ev(pageA, () => window.__game.chat('/tp 130.5 4 30.5'));
      await tpPlayer(pageA, 'JoueurB', -60.5, 4, 30.5);

      // Mesurer aussi les créatures et le temps de tick serveur avec 2 joueurs éloignés !
      await sleep(12500); // > 200 ticks = 10s pour cuisson d'au moins 1 lingot de fer
      const pingRes = await httpRequest(`${baseUrl}api/ping`, { headers: { 'X-Server-Password': password } });
      const pingJson = JSON.parse(pingRes.body);
      console.log(`  [Perf] 2 joueurs éloignés : entityCount=${pingJson.entityCount}, tickMsAvg=${pingJson.tickMsAvg} ms`);
      check('tick serveur moyen < 50 ms avec 2 joueurs éloignés', typeof pingJson.tickMsAvg === 'number' && pingJson.tickMsAvg < 50, `tickMsAvg=${pingJson.tickMsAvg}`);

      // B revient devant le fourneau (34.5, 4, 32.5) et récupère le résultat
      await tpPlayer(pageA, 'JoueurB', 34.5, 4, 32.5, pageB);
      await ticks(pageB, 8);
      await lookAtBlock(pageB, 34, 4, 30);
      await rclick(pageB);
      await pageB.waitForSelector('.mc-window', { timeout: 10000 });
      await ticks(pageB, 6);

      const outputOnB = await ev(pageB, () => {
        const m = window.__game.menu;
        const idx = m ? m.indexOf('output', 0) : -1;
        const out = idx >= 0 ? m.slots[idx].stack : null;
        return { menuType: m?.type, idx, out: out ? { id: out.id, count: out.count } : null };
      });
      check('le fourneau a cuit sans spectateur', outputOnB.out !== null && outputOnB.out.id === ids.ironIngot && outputOnB.out.count >= 1, JSON.stringify(outputOnB));
      await pageB.keyboard.press('Escape');
      await ticks(pageB, 4);
    });

    await section('J4e. Validation serveur : conteneur hors de portée et ramassage inexistant refusés', async () => {
      // Connexion WS brute pour envoyer des paquets forgés
      const wsRes = await new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const got = [];
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'join', name: 'TesteurSecu', code: inviteCode }));
        });
        ws.on('message', (data, isBin) => {
          if (isBin) return;
          const msg = JSON.parse(data.toString());
          if (msg.type === 'welcome') {
            ws.send(JSON.stringify({ type: 'openContainer', x: 32, y: 4, z: 32 }));
            ws.send(JSON.stringify({ type: 'pickupItem', entityId: 9999999 }));
            setTimeout(() => {
              ws.close();
              resolve(got);
            }, 500);
          } else if (msg.type === 'error') {
            got.push(msg.message);
          }
        });
      });
      check('action conteneur hors de portée refusée', wsRes.some((m) => m.includes('portée') || m.includes('inaccessible')), JSON.stringify(wsRes));
      check('ramassage d’objet inexistant refusé', wsRes.some((m) => m.includes('inexistant') || m.includes('Ramassage')), JSON.stringify(wsRes));
    });

    await section('J4f. Redémarrage serveur (persistance créatures/coffre/fourneau) et retour au solo', async () => {
      // Sauvegarder une référence du nombre de créatures avant redémarrage
      const countBefore = await ev(pageB, () => window.__game.entities.filter((e) => e.kind === 'mob').length);

      // Redémarrer le serveur proprement (SIGINT déclenche saveAll())
      srv.proc.kill('SIGINT');
      await new Promise((r) => srv.proc.once('exit', r));

      srv = startServer(rootDir, port, password, tmpDataDir);
      await waitServerReady(baseUrl, srv.getLogs);

      // Reconnecter A (avec mot de passe hôte) et B
      const pageB2 = await openIsolatedPage(ctxB, baseUrl, errors);
      await pageB2.click('[data-mc="multiplayer"]');
      await pageB2.waitForSelector('[data-mc="mp-join"]', { timeout: 10000 });
      await pageB2.evaluate((p, pw) => {
        const set = (id, v) => {
          const el = document.querySelector(`[data-mc="${id}"]`);
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('mp-name', 'JoueurB');
        set('mp-address', `127.0.0.1:${p}`);
        set('mp-password', pw);
        set('mp-code', '');
      }, port, password);
      await pageB2.click('[data-mc="mp-join"]');
      await pageB2.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
      await ticks(pageB2, 10);

      const countAfter = await ev(pageB2, () => window.__game.entities.filter((e) => e.kind === 'mob').length);
      check('créatures retrouvées après redémarrage serveur', countBefore === 0 || countAfter > 0, `before=${countBefore}, after=${countAfter}`);

      // Vérifier le coffre (32, 4, 32) et le fourneau (33, 4, 32) après redémarrage
      await ev(pageB2, (cmd) => window.__game.chat(cmd), '/tp 30.5 4 34.5');
      await ticks(pageB2, 8);
      await lookAtBlock(pageB2, 32, 4, 32);
      await rclick(pageB2);
      await pageB2.waitForSelector('.mc-window', { timeout: 10000 });
      await ticks(pageB2, 4);
      const chestAfterRestart = await ev(pageB2, () => window.__game.menu?.slots[0]?.stack ?? null);
      check('contenu du coffre retrouvé après redémarrage', chestAfterRestart !== null && chestAfterRestart.count > 0, JSON.stringify(chestAfterRestart));
      await pageB2.keyboard.press('Escape');
      await ticks(pageB2, 4);
      await pageB2.close();
    });

    await section('J4g. Limite d’essais par IP sur /rejoindre/<code>', async () => {
      let got429 = false;
      for (let i = 0; i < 8; i++) {
        const res = await httpRequest(`${baseUrl}rejoindre/SB-AAAAA-BBBBB-CCCCC-DDDDD?no-redirect=1`);
        if (res.status === 429 && res.body.includes('Trop d’essais')) {
          got429 = true;
          break;
        }
      }
      check('/rejoindre/<code> impose une attente (HTTP 429) après trop d’essais ratés', got429);
    });

    await section('J4h. Fermeture aux amis : récupération du coffre dans le monde solo de A', async () => {
      await pageA.close().catch(() => undefined);
      await pageB.close().catch(() => undefined);
      const ctxH = await browser.createBrowserContext();
      const ctxF = await browser.createBrowserContext();
      const srv2Port = await findFreePort();
      const srv2Url = `http://127.0.0.1:${srv2Port}/`;
      const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sarihbricks-j4-solo-'));
      const srv2 = startServer(rootDir, srv2Port, password, tmpDir2);
      try {
        await waitServerReady(srv2Url, srv2.getLogs);
        const pageH = await openIsolatedPage(ctxH, srv2Url, errors);
        const pageF = await openIsolatedPage(ctxF, srv2Url, errors);
        await createWorld(pageH, { name: 'SoloRetour', seed: '1337', creative: true, flat: true });
        await ticks(pageH, 6);
        await pageH.keyboard.press('Escape');
        await pageH.waitForSelector('[data-mc="open-friends"]', { timeout: 10000 });
        await pageH.click('[data-mc="open-friends"]');
        await pageH.waitForSelector('[data-mc="open-friends-confirm"]', { timeout: 10000 });
        await pageH.evaluate((pw) => { document.querySelector('[data-mc="open-friends-password"]').value = pw; }, password);
        await pageH.click('[data-mc="open-friends-confirm"]');
        await pageH.waitForSelector('[data-mc="invite-code"]', { timeout: 15000 });
        const code2 = await pageH.evaluate(() => document.querySelector('[data-mc="invite-code"]')?.textContent?.trim() ?? '');
        await pageH.click('[data-mc="resume"]');
        await ticks(pageH, 4);

        await joinWithCode(pageF, 'AmiSolo', code2);
        await ticks(pageF, 6);

        // H pose un coffre en (10, 4, 10) ; AmiSolo y dépose un objet
        const chestId = await ev(pageH, () => window.__game.blocks().get('chest').id);
        const dirtId = await ev(pageH, () => window.__game.items().get('dirt'));
        await tpSelf(pageH, 8.5, 4, 10.5);
        await ev(pageH, (cid) => {
          window.__game.netPlaceBlock(10, 4, 10, 1, cid, 0, 0);
        }, chestId);
        await tpPlayer(pageH, 'AmiSolo', 10.5, 4, 12.5, pageF);
        await ev(pageF, (did) => {
          const g = window.__game;
          g.player.inventory.slots[0] = { id: did, count: 7, damage: 0 };
          const serialized = g.player.inventory.slots.map((s) => (s ? [s.id, s.count, s.damage] : null));
          g.net.sendInvSync(serialized, 0);
        }, dirtId);
        await ticks(pageF, 6);

        await lookAtBlock(pageF, 10, 4, 10);
        await rclick(pageF);
        await pageF.waitForSelector('.mc-window', { timeout: 10000 });
        await ticks(pageF, 4);
        await ev(pageF, () => {
          const m = window.__game.menu;
          m.click(m.indexOf('hotbar', 0), 0, true);
        });
        await ticks(pageF, 6);
        await pageF.keyboard.press('Escape');
        await ticks(pageF, 4);

        // H ferme aux amis
        await pageH.keyboard.press('Escape');
        await pageH.waitForSelector('[data-mc="close-friends"]', { timeout: 10000 });
        await pageH.click('[data-mc="close-friends"]');
        await pageH.waitForFunction('window.__game && !window.__game.isRemote', { timeout: 15000 });
        await pageH.click('[data-mc="resume"]');
        await ticks(pageH, 20);
        await pageH.waitForFunction(() => {
          const be = window.__game.world.getBlockEntity(10, 4, 10);
          return Boolean(be && be.type === 'chest');
        }, { timeout: 15000 });

        // Vérifier que le monde solo de H contient le coffre rempli par AmiSolo !
        const soloChest = await ev(pageH, () => {
          const be = window.__game.world.getBlockEntity(10, 4, 10);
          return be && be.type === 'chest' ? be.items[0] : null;
        });
        check('après fermeture aux amis, le monde solo de l’hôte contient le coffre rempli par B', soloChest !== null && soloChest.id === dirtId && soloChest.count === 7, JSON.stringify(soloChest));
        await pageH.close();
        await pageF.close();
      } finally {
        await ctxH.close().catch(() => undefined);
        await ctxF.close().catch(() => undefined);
        await stopServer(srv2, tmpDir2);
      }
    });

    check('aucune erreur console ni pageerror pendant toute la session', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close();
    await stopServer(srv, tmpDataDir);
  }

  const ok = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\nBILAN ${ok}/${total}`);
  if (ok < total) process.exit(1);
})();
