// Batterie « Multijoueur — Jalon 1 » (point 52) :
// Serveur Node autoritaire, mot de passe obligatoire, pseudo unique,
// visibilité mutuelle, déplacement synchronisé, discussion, /time set, déconnexion propre.
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { sleep, launch, shot, ticks } = require('./lib.cjs');
const { results, check, ev, section } = require('./h.cjs');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => {
        if (port === 5173 || port === 5174) resolve(findFreePort());
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

function checkHttpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
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
      if (!/404|favicon/.test(t)) {
        errors.push('console.' + m.type() + ': ' + t);
        console.log('  console.' + m.type(), t.slice(0, 300));
      }
    }
  });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-mc="title"]', { timeout: 20000 });
  return page;
}

async function fillMultiplayerForm(page, { name, address, password }) {
  await page.evaluate(
    (n, a, p) => {
      const set = (id, v) => {
        const el = document.querySelector(`[data-mc="${id}"]`);
        if (!el) throw new Error('champ introuvable : ' + id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('mp-name', n);
      set('mp-address', a);
      set('mp-password', p);
    },
    name,
    address,
    password,
  );
}

(async () => {
  const rootDir = path.resolve(__dirname, '../..');
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/`;
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarihbricks-mp-'));
  const password = 'secret-e2e';

  const serverProc = spawn(
    process.execPath,
    [path.join(rootDir, 'scripts', 'serveur.mjs'), '--port', String(port), '--password', password, '--data-dir', tmpDataDir, '--flat', '--seed', '1337'],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let serverLogs = '';
  serverProc.stdout.on('data', (d) => { serverLogs += d.toString(); });
  serverProc.stderr.on('data', (d) => { serverLogs += d.toString(); });

  const browser = await launch();
  const errors = [];

  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      if (await checkHttpOk(url)) {
        ready = true;
        break;
      }
    }
    if (!ready) throw new Error('Serveur multijoueur non démarré :\n' + serverLogs);

    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await openIsolatedPage(ctxA, url, errors);
    const pageB = await openIsolatedPage(ctxB, url, errors);

    await section('52a. Écran Multijoueur, mot de passe obligatoire et pseudo unique', async () => {
      await pageA.click('[data-mc="multiplayer"]');
      await pageA.waitForSelector('[data-mc="mp-join"]', { timeout: 10000 });

      // 1. Mauvais mot de passe refusé
      await fillMultiplayerForm(pageA, { name: 'JoueurA', address: `127.0.0.1:${port}`, password: 'mauvais-mot-de-passe' });
      await shot(pageA, 't16_ecran_multijoueur');
      await pageA.click('[data-mc="mp-join"]');
      await pageA.waitForFunction(
        () => (document.querySelector('[data-mc="mp-error"]')?.textContent ?? '').trim().length > 0,
        { timeout: 10000 },
      );
      const badPwMsg = await pageA.evaluate(() => document.querySelector('[data-mc="mp-error"]')?.textContent ?? '');
      check('mot de passe faux refusé avec message clair', badPwMsg.toLowerCase().includes('mot de passe'), badPwMsg);

      // 2. Connexion de JoueurA avec le bon mot de passe
      await fillMultiplayerForm(pageA, { name: 'JoueurA', address: `127.0.0.1:${port}`, password });
      await pageA.click('[data-mc="mp-join"]');
      await pageA.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
      check('JoueurA connecté au serveur et monde prêt', true);

      // 3. JoueurB tente de rejoindre avec le même pseudo « JoueurA » -> refusé
      await pageB.click('[data-mc="multiplayer"]');
      await pageB.waitForSelector('[data-mc="mp-join"]', { timeout: 10000 });
      await fillMultiplayerForm(pageB, { name: 'JoueurA', address: `127.0.0.1:${port}`, password });
      await pageB.click('[data-mc="mp-join"]');
      await pageB.waitForFunction(
        () => (document.querySelector('[data-mc="mp-error"]')?.textContent ?? '').trim().length > 0,
        { timeout: 10000 },
      );
      const dupNameMsg = await pageB.evaluate(() => document.querySelector('[data-mc="mp-error"]')?.textContent ?? '');
      check('pseudo déjà pris refusé avec message clair', dupNameMsg.toLowerCase().includes('pseudo'), dupNameMsg);

      // 4. Connexion de JoueurB avec le pseudo « JoueurB »
      await fillMultiplayerForm(pageB, { name: 'JoueurB', address: `127.0.0.1:${port}`, password });
      await pageB.click('[data-mc="mp-join"]');
      await pageB.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
      await ticks(pageA, 6);
      await ticks(pageB, 6);
      check('JoueurB connecté au serveur et monde prêt', true);
    });

    await section('52b. Visibilité mutuelle, déplacement synchronisé, discussion et /time set', async () => {
      // Orienter JoueurA légèrement en retrait pour bien voir JoueurB et son pseudo
      await ev(pageA, () => {
        const g = window.__game;
        const b = g.entities.find((e) => e.kind === 'player' && e.customName === 'JoueurB');
        if (b) {
          g.player.teleport(b.x, b.y, b.z + 3.2);
          g.player.turn(-g.player.yaw, -g.player.headPitch); // regarde vers -Z (vers JoueurB)
        }
      });
      await ticks(pageA, 8);
      await ticks(pageB, 8);

      const seenByA = await ev(pageA, () => {
        const b = window.__game.entities.find((e) => e.kind === 'player' && e.customName === 'JoueurB');
        return b ? { name: b.customName, x: b.x, y: b.y, z: b.z } : null;
      });
      const seenByB = await ev(pageB, () => {
        const a = window.__game.entities.find((e) => e.kind === 'player' && e.customName === 'JoueurA');
        return a ? { name: a.customName, x: a.x, y: a.y, z: a.z } : null;
      });
      check('chaque joueur voit l’autre dans entities avec son pseudo', seenByA !== null && seenByB !== null, JSON.stringify({ seenByA, seenByB }));
      await shot(pageA, 't16_deux_joueurs');

      // Déplacement de JoueurA vu par JoueurB
      const beforeMoveOnB = seenByB;
      await pageA.keyboard.down('KeyW');
      await ticks(pageA, 12);
      await pageA.keyboard.up('KeyW');
      await ticks(pageB, 8);
      const afterMoveOnB = await ev(pageB, () => {
        const a = window.__game.entities.find((e) => e.kind === 'player' && e.customName === 'JoueurA');
        return a ? { x: a.x, y: a.y, z: a.z } : null;
      });
      const movedDist = beforeMoveOnB && afterMoveOnB ? Math.hypot(afterMoveOnB.x - beforeMoveOnB.x, afterMoveOnB.z - beforeMoveOnB.z) : 0;
      check('un déplacement de JoueurA est vu par JoueurB', movedDist > 0.5, `dist=${movedDist.toFixed(2)}`);

      // Discussion entre JoueurA et JoueurB (via l'interface de chat)
      await pageA.keyboard.press('KeyT');
      await pageA.waitForSelector('[data-mc="chat"] input', { timeout: 5000 });
      await pageA.type('[data-mc="chat"] input', 'Salut JoueurB !');
      await pageA.keyboard.press('Enter');
      await pageB.waitForFunction(
        () => Array.from(document.querySelectorAll('.mc-chat-line')).some((el) => (el.textContent ?? '').includes('Salut JoueurB !')),
        { timeout: 10000 },
      );
      const chatOnB = await pageB.evaluate(() =>
        Array.from(document.querySelectorAll('.mc-chat-line')).map((el) => el.textContent ?? ''),
      );
      check('un message de JoueurA arrive dans le chat de JoueurB', chatOnB.some((l) => l.includes('Salut JoueurB !')));
      await shot(pageB, 't16_discussion');

      // Commande /time set du serveur reçue par les deux joueurs
      await pageA.keyboard.press('KeyT');
      await pageA.waitForSelector('[data-mc="chat"] input', { timeout: 5000 });
      await pageA.type('[data-mc="chat"] input', '/time set 14000');
      await pageA.keyboard.press('Enter');
      await ticks(pageA, 6);
      await ticks(pageB, 6);
      const timeA = await ev(pageA, () => window.__game.time);
      const timeB = await ev(pageB, () => window.__game.time);
      check(
        '/time set 14000 du serveur synchronisé chez les deux joueurs',
        timeA >= 13950 && timeA <= 14500 && timeB >= 13950 && timeB <= 14500,
        `timeA=${timeA}, timeB=${timeB}`,
      );
    });

    await section('52c. Déconnexion du serveur gérée proprement', async () => {
      serverProc.kill('SIGTERM');
      await pageA.waitForSelector('[data-mc="title"]', { timeout: 15000 });
      await pageB.waitForSelector('[data-mc="title"]', { timeout: 15000 });
      const errA = await pageA.evaluate(() => document.querySelector('[data-mc="mp-error"]')?.textContent ?? '');
      const errB = await pageB.evaluate(() => document.querySelector('[data-mc="mp-error"]')?.textContent ?? '');
      check('déconnexion propre vers le menu avec message (A et B)', errA.length > 0 && errB.length > 0, JSON.stringify({ errA, errB }));
    });

    console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
    check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
    const fails = results.filter((r) => !r.ok);
    console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
    for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));

    await ctxA.close();
    await ctxB.close();
    await browser.close();
    process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
  } finally {
    if (!serverProc.killed) serverProc.kill('SIGTERM');
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  }
})();
