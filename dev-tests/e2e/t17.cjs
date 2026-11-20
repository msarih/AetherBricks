// Batterie « Multijoueur — Jalon 2 » :
// « Ouvrir aux amis » avec code, rejoindre par code seul, limitation d'essais,
// casse/pose partagées, inventaire survie autoritaire, commandes réservées à l'hôte,
// synchronisation du temps, persistance après redémarrage serveur, « Fermer aux amis »
// avec mise à jour du monde solo de l'hôte et invalidation du code.
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
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
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('HTTP timeout'));
    });
    if (body) req.write(body);
    req.end();
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
      if (page.__allow401 && /status of 401/.test(t)) return;
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
    if (await checkHttpOk(url)) return;
  }
  throw new Error('Serveur multijoueur non démarré :\n' + getLogs());
}

(async () => {
  const rootDir = path.resolve(__dirname, '../..');
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/`;
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarihbricks-j2-'));
  const password = 'secret-j2-e2e';

  let srv = startServer(rootDir, port, password, tmpDataDir);
  const browser = await launch();
  const errors = [];

  let inviteCode = '';
  // Position d'un bloc posé par A en solo (près du spawn 0.5, 4, 0.5)
  const blockAX = 2, blockAY = 4, blockAZ = 2;
  // Position d'un bloc posé par B en multijoueur
  const blockBX = 4, blockBY = 4, blockBZ = 2;

  try {
    await waitServerReady(url, srv.getLogs);

    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await openIsolatedPage(ctxA, url, errors);
    const pageB = await openIsolatedPage(ctxB, url, errors);

    await section('J2-sec. Sécurité HTTP : CORS, ping sans fuite, open-world authentifié et anti-bruteforce', async () => {
      const worldJsonPath = path.join(tmpDataDir, 'worlds', 'default', 'world.json');
      const worldBefore = fs.readFileSync(worldJsonPath, 'utf8');

      // 1. GET /api/ping ne révèle pas le nom du monde sans mot de passe, ni CORS pour origine tierce
      const pingAnon = await httpRequest(`${url}api/ping`, { headers: { Origin: 'http://exemple.test' } });
      const pingJson = JSON.parse(pingAnon.body);
      check('GET /api/ping sans mot de passe ne révèle pas le nom du monde', pingAnon.status === 200 && pingJson.ok === true && pingJson.name === undefined, pingAnon.body);
      check('GET /api/ping refuse CORS pour origine tierce', pingAnon.headers['access-control-allow-origin'] === undefined, String(pingAnon.headers['access-control-allow-origin']));

      // 2. POST /api/open-world depuis origine non autorisée -> 403 avant lecture du corps
      const badOriginRes = await httpRequest(`${url}api/open-world`, {
        method: 'POST',
        headers: { Origin: 'http://exemple.test', 'X-Server-Password': password },
        body: Buffer.from('corps-factice'),
      });
      check('POST /api/open-world avec Origin http://exemple.test -> 403', badOriginRes.status === 403 && badOriginRes.headers['access-control-allow-origin'] === undefined, `status=${badOriginRes.status}`);

      // 3. POST /api/open-world sans mot de passe -> 401 et monde intact
      const noPwRes = await httpRequest(`${url}api/open-world`, { method: 'POST', body: Buffer.from('corps-factice') });
      check('POST /api/open-world sans mot de passe -> 401', noPwRes.status === 401, `status=${noPwRes.status}`);
      check('monde sur disque intact après 401', fs.readFileSync(worldJsonPath, 'utf8') === worldBefore);

      // 4. Mauvais mot de passe -> 401
      const badPwRes = await httpRequest(`${url}api/open-world`, {
        method: 'POST',
        headers: { 'X-Server-Password': 'mauvais-mot-de-passe' },
        body: Buffer.from('corps-factice'),
      });
      check('POST /api/open-world avec mauvais mot de passe -> 401', badPwRes.status === 401, `status=${badPwRes.status}`);
    });

    await section('J2a. Monde solo de A, pose d’un bloc, « Ouvrir aux amis » (mot de passe + code)', async () => {
      await createWorld(pageA, { name: 'MondeA', seed: '1337', creative: false, flat: true });
      await ticks(pageA, 8);

      // A pose un bloc de pierre (id=4) en (2, 4, 2)
      await ev(pageA, (bx, by, bz) => {
        const g = window.__game;
        const p = g.player;
        p.gameMode = 'creative';
        p.inventory.slots[0] = { id: 4, count: 16, damage: 0 };
        p.inventory.selected = 0;
        p.teleport(bx + 0.5, by, bz + 2.5);
        const dx = (bx + 0.5) - p.x;
        const dy = (by - 0.05) - (p.y + p.eyeHeight);
        const dz = (bz + 0.5) - p.z;
        p.turn(Math.atan2(-dx, -dz) - p.yaw, Math.atan2(dy, Math.hypot(dx, dz)) - p.headPitch);
      }, blockAX, blockAY, blockAZ);
      await ticks(pageA, 3);
      await ev(pageA, () => { window.__game.input.presses[2]++; });
      await ticks(pageA, 4);
      const blockOnA = await ev(pageA, (x, y, z) => window.__game.world.getBlock(x, y, z), blockAX, blockAY, blockAZ);
      check('A pose un bloc dans son monde solo', blockOnA !== 0, `block=${blockOnA}`);

      // A ouvre la pause et clique sur « Ouvrir aux amis » -> demande le mot de passe la 1re fois
      await pageA.keyboard.press('Escape');
      await pageA.waitForSelector('[data-mc="open-friends"]', { timeout: 10000 });
      await shot(pageA, 't17_pause_ouvrir');
      await pageA.click('[data-mc="open-friends"]');
      await pageA.waitForSelector('[data-mc="open-friends-password"]', { timeout: 10000 });

      // Mauvais mot de passe dans l'interface -> message clair
      pageA.__allow401 = true;
      await pageA.type('[data-mc="open-friends-password"]', 'faux-mdp');
      await pageA.click('[data-mc="open-friends-confirm"]');
      await pageA.waitForFunction(
        () => (document.querySelector('[data-mc="pause-error"]')?.textContent ?? '').trim().length > 0,
        { timeout: 10000 },
      );
      pageA.__allow401 = false;
      const wrongPwUiErr = await pageA.evaluate(() => document.querySelector('[data-mc="pause-error"]')?.textContent ?? '');
      check('mauvais mot de passe dans « Ouvrir aux amis » affiche une erreur claire', wrongPwUiErr.toLowerCase().includes('incorrect'), wrongPwUiErr);

      // Bon mot de passe -> ouverture et mémorisation
      await pageA.evaluate((pw) => {
        const el = document.querySelector('[data-mc="open-friends-password"]');
        el.value = pw;
      }, password);
      await pageA.click('[data-mc="open-friends-confirm"]');
      await pageA.waitForSelector('[data-mc="invite-code"]', { timeout: 15000 });
      inviteCode = await pageA.evaluate(() => document.querySelector('[data-mc="invite-code"]')?.textContent?.trim() ?? '');
      await shot(pageA, 't17_code_affiche');
      check('code d’invitation généré et affiché (format SB-...)', /^SB-[2-9A-HJ-KM-NP-Z]{5}-[2-9A-HJ-KM-NP-Z]{5}-[2-9A-HJ-KM-NP-Z]{5}-[2-9A-HJ-KM-NP-Z]{5}$/.test(inviteCode), inviteCode);

      const memorized = await pageA.evaluate((p, pw) => {
        const raw = localStorage.getItem('sarihbricks.servers');
        if (!raw) return false;
        const list = JSON.parse(raw);
        return Array.isArray(list) && list.some((s) => s.address === `127.0.0.1:${p}` && s.password === pw);
      }, port, password);
      check('mot de passe mémorisé avec le serveur après ouverture', memorized);

      // Deuxième ouverture pendant qu'un monde est déjà ouvert -> 409 et premier monde intact
      const secondOpenRes = await httpRequest(`${url}api/open-world`, {
        method: 'POST',
        headers: { 'X-Server-Password': password },
        body: Buffer.from('autre-monde'),
      });
      const pingWhileHosting = await httpRequest(`${url}api/ping`, {
        headers: { 'X-Server-Password': password },
      });
      const pingWhileHostingJson = JSON.parse(pingWhileHosting.body);
      check('deuxième POST /api/open-world pendant hébergement -> 409', secondOpenRes.status === 409 && secondOpenRes.body.toLowerCase().includes('déjà ouvert'), `status=${secondOpenRes.status}, body=${secondOpenRes.body}`);
      check('premier monde toujours actif après refus 409', pingWhileHostingJson.hosting === true && pingWhileHostingJson.name === 'MondeA', pingWhileHosting.body);

      // A reprend le jeu
      await pageA.click('[data-mc="resume"]');
      await ticks(pageA, 4);
    });

    await section('J2b. Mauvais code, limitation d’essais et connexion par code seul', async () => {
      await pageB.click('[data-mc="multiplayer"]');
      await pageB.waitForSelector('[data-mc="mp-join"]', { timeout: 10000 });
      await shot(pageB, 't17_ecran_multijoueur_code');

      // 1. Mauvais code refusé + 5 essais ratés déclenchent l'attente
      const wrongCode = inviteCode.slice(0, -1) + (inviteCode.endsWith('2') ? '3' : '2');
      let rateLimited = false;
      for (let attempt = 1; attempt <= 7; attempt++) {
        await pageB.evaluate((c) => {
          const set = (id, v) => {
            const el = document.querySelector(`[data-mc="${id}"]`);
            el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          };
          set('mp-name', 'JoueurB');
          set('mp-code', c);
          set('mp-address', '');
          set('mp-password', '');
        }, wrongCode);
        await pageB.click('[data-mc="mp-join"]');
        await pageB.waitForFunction(
          () => (document.querySelector('[data-mc="mp-error"]')?.textContent ?? '').trim().length > 0,
          { timeout: 10000 },
        );
        const msg = await pageB.evaluate(() => document.querySelector('[data-mc="mp-error"]')?.textContent ?? '');
        if (attempt === 1) {
          check('mauvais code refusé avec message clair', msg.toLowerCase().includes('invalide') || msg.toLowerCase().includes('expiré'), msg);
        }
        if (msg.toLowerCase().includes('patienter')) {
          rateLimited = true;
          break;
        }
      }
      check('essais ratés limités par IP (attente imposée)', rateLimited);

      // Attendre que la première fenêtre de blocage (5s) passe, puis rejoindre avec le bon code (insensible à la casse/tirets)
      await sleep(5300);
      const codeLowerNoDash = inviteCode.toLowerCase().replace(/-/g, '');
      await pageB.evaluate((c) => {
        const set = (id, v) => {
          const el = document.querySelector(`[data-mc="${id}"]`);
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('mp-name', 'JoueurB');
        set('mp-code', c);
      }, codeLowerNoDash);
      await pageB.click('[data-mc="mp-join"]');
      await pageB.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
      await ticks(pageB, 8);
      await ticks(pageA, 8);

      const blockOnB = await ev(pageB, (x, y, z) => window.__game.world.getBlock(x, y, z), blockAX, blockAY, blockAZ);
      check('B rejoint avec le code seul et voit le bloc posé par A', blockOnB !== 0, `blockOnB=${blockOnB}`);
    });

    await section('J2c. Blocs partagés, inventaire survie, commandes hôte et temps', async () => {
      // Passer B en survie via A (hôte) pour tester l'inventaire survie autoritaire
      await pageA.keyboard.press('KeyT');
      await pageA.waitForSelector('[data-mc="chat"] input', { timeout: 5000 });
      await pageA.type('[data-mc="chat"] input', '/gamemode survival JoueurB');
      await pageA.keyboard.press('Enter');
      await ticks(pageB, 6);
      const modeB = await ev(pageB, () => window.__game.player.gameMode);
      check('A (hôte) peut passer B en survie avec /gamemode', modeB === 'survival', modeB);

      // B tente /gamemode creative -> refusé !
      await pageB.keyboard.press('KeyT');
      await pageB.waitForSelector('[data-mc="chat"] input', { timeout: 5000 });
      await pageB.type('[data-mc="chat"] input', '/gamemode creative');
      await pageB.keyboard.press('Enter');
      await ticks(pageB, 6);
      const modeBAfter = await ev(pageB, () => window.__game.player.gameMode);
      const deniedMsg = await pageB.evaluate(() =>
        Array.from(document.querySelectorAll('.mc-chat-line')).some((el) => (el.textContent ?? '').includes('hôte')),
      );
      check('B (ami) ne peut pas utiliser /gamemode', modeBAfter === 'survival' && deniedMsg, `mode=${modeBAfter}, denied=${deniedMsg}`);

      // B casse le bloc d'herbe en (4, 3, 2) en survie -> reçoit le drop dans son inventaire
      await ev(pageB, (bx, by, bz) => {
        const g = window.__game;
        const p = g.player;
        p.teleport(bx + 0.5, by, bz + 1.5);
        const dx = (bx + 0.5) - p.x;
        const dy = (by - 0.1) - (p.y + p.eyeHeight);
        const dz = (bz + 0.5) - p.z;
        p.turn(Math.atan2(-dx, -dz) - p.yaw, Math.atan2(dy, Math.hypot(dx, dz)) - p.headPitch);
      }, blockBX, blockBY, blockBZ);
      await ticks(pageB, 4);
      await ev(pageB, () => { window.__game.input.buttons[0] = true; });
      await sleep(1200);
      await ev(pageB, () => { window.__game.input.buttons[0] = false; });
      await ticks(pageB, 8);
      await ticks(pageA, 4);
      const brokenOnA = await ev(pageA, (x, y, z) => window.__game.world.getBlock(x, y, z), blockBX, blockBY - 1, blockBZ);
      const invCountAfterBreak = await ev(pageB, () => window.__game.player.inventory.slots[0]?.count ?? 0);
      check('B casse un bloc en survie : A le voit et B reçoit l’objet dans son inventaire', brokenOnA === 0 && invCountAfterBreak >= 1, `brokenOnA=${brokenOnA}, count=${invCountAfterBreak}`);

      // B pose un bloc en (4, 4, 3) depuis son inventaire survie (vise le dessus du sol en (4, 3, 3))
      await ev(pageB, (bx, by, bz) => {
        const g = window.__game;
        const p = g.player;
        p.teleport(bx + 0.5, by, bz + 2.5);
        const dx = (bx + 0.5) - p.x;
        const dy = (by - 0.05) - (p.y + p.eyeHeight);
        const dz = (bz + 1.5) - p.z;
        p.turn(Math.atan2(-dx, -dz) - p.yaw, Math.atan2(dy, Math.hypot(dx, dz)) - p.headPitch);
        p.inventory.selected = 0;
      }, blockBX, blockBY, blockBZ);
      await ticks(pageB, 3);
      await ev(pageB, () => { window.__game.input.presses[2]++; });
      await ticks(pageB, 8);
      await ticks(pageA, 8);
      const placedOnA = await ev(pageA, (x, y, z) => window.__game.world.getBlock(x, y, z), blockBX, blockBY, blockBZ + 1);
      const invCountAfterPlace = await ev(pageB, () => window.__game.player.inventory.slots[0]?.count ?? 0);
      check('B pose un bloc : A le voit et la pile de B diminue', placedOnA !== 0 && invCountAfterPlace === invCountAfterBreak - 1, `placedOnA=${placedOnA}, inv=${invCountAfterBreak}->${invCountAfterPlace}`);

      // Contre-test anti-triche : B essaie d'envoyer un placeBlock sans l'objet en main (slot vide 8)
      await ev(pageB, (bx, by, bz) => {
        window.__game.netPlaceBlock(bx + 1, by, bz, 0, 4, 0, 8);
      }, blockBX, blockBY, blockBZ);
      await ticks(pageB, 6);
      const cheatBlock = await ev(pageA, (x, y, z) => window.__game.world.getBlock(x, y, z), blockBX + 1, blockBY, blockBZ);
      check('pose sans l’objet en survie refusée par le serveur', cheatBlock === 0, `cheatBlock=${cheatBlock}`);

      // B casse un autre bloc en (5, 3, 2) pour garder un objet dans son inventaire lors du redémarrage serveur
      await ev(pageB, (bx, by, bz) => {
        const g = window.__game;
        const p = g.player;
        p.teleport(bx + 1.5, by, bz + 1.5);
        const dx = (bx + 1.5) - p.x;
        const dy = (by - 0.1) - (p.y + p.eyeHeight);
        const dz = (bz + 0.5) - p.z;
        p.turn(Math.atan2(-dx, -dz) - p.yaw, Math.atan2(dy, Math.hypot(dx, dz)) - p.headPitch);
      }, blockBX, blockBY, blockBZ);
      await ticks(pageB, 3);
      await ev(pageB, () => { window.__game.input.buttons[0] = true; });
      await sleep(1200);
      await ev(pageB, () => { window.__game.input.buttons[0] = false; });
      await ticks(pageB, 6);

      // Capture deux joueurs construisant ensemble
      await ev(pageA, (bx, by, bz) => {
        const g = window.__game;
        g.player.teleport(bx - 1.5, by, bz + 4.0);
        g.player.yaw = -0.35;
        g.player.headPitch = 0.1;
      }, blockBX, blockBY, blockBZ);
      await ticks(pageA, 6);
      await shot(pageA, 't17_deux_joueurs_construisent');

      // Temps synchronisé
      await pageA.keyboard.press('KeyT');
      await pageA.waitForSelector('[data-mc="chat"] input', { timeout: 5000 });
      await pageA.type('[data-mc="chat"] input', '/time set 15000');
      await pageA.keyboard.press('Enter');
      await ticks(pageA, 6);
      await ticks(pageB, 6);
      const timeA = await ev(pageA, () => window.__game.time);
      const timeB = await ev(pageB, () => window.__game.time);
      check('temps synchronisé entre A et B', Math.abs(timeA - timeB) < 40 && timeB >= 14950, `timeA=${timeA}, timeB=${timeB}`);
    });

    await section('J2d. Fermeture aux amis : retour menu B, invalidation code, monde solo A à jour', async () => {
      // A ouvre la pause et clique sur « Fermer aux amis »
      await pageA.keyboard.press('Escape');
      await pageA.waitForSelector('[data-mc="close-friends"]', { timeout: 10000 });
      await pageA.click('[data-mc="close-friends"]');
      await pageA.waitForSelector('[data-mc="open-friends"]', { timeout: 15000 });

      // B revient au menu avec un message
      await pageB.waitForSelector('[data-mc="title"]', { timeout: 15000 });
      const errB = await pageB.evaluate(() => document.querySelector('[data-mc="mp-error"]')?.textContent ?? '');
      check('à la fermeture, B revient au menu avec un message', errB.toLowerCase().includes('fermé'), errB);

      // Le code ne marche plus après fermeture
      await pageB.evaluate((c) => {
        const el = document.querySelector('[data-mc="mp-code"]');
        el.value = c;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, inviteCode);
      await pageB.click('[data-mc="mp-join"]');
      await pageB.waitForFunction(
        () => (document.querySelector('[data-mc="mp-error"]')?.textContent ?? '').trim().length > 0,
        { timeout: 10000 },
      );
      const closedErr = await pageB.evaluate(() => document.querySelector('[data-mc="mp-error"]')?.textContent ?? '');
      check('le code ne marche plus après fermeture', closedErr.toLowerCase().includes('invalide') || closedErr.toLowerCase().includes('expiré'), closedErr);

      // A recharge la page (sans « Sauvegarder et quitter ») et rouvre son monde solo -> doit déjà contenir le bloc de B via replaceWorldFromArchive !
      await pageA.goto(url, { waitUntil: 'networkidle0' });
      await pageA.waitForSelector('[data-mc="title"]', { timeout: 15000 });
      await pageA.click('[data-mc="play"]');
      await pageA.waitForSelector('[data-mc="world-play"]', { timeout: 10000 });
      await pageA.click('[data-mc="world-play"]');
      await pageA.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
      await ticks(pageA, 8);
      const soloBlockFromB = await ev(pageA, (x, y, z) => window.__game.world.getBlock(x, y, z), blockBX, blockBY, blockBZ + 1);
      await ev(pageA, (bx, by, bz) => {
        window.__game.player.teleport(bx + 0.5, by + 0.5, bz + 3.0);
        window.__game.player.yaw = 0;
        window.__game.player.headPitch = 0.2;
      }, blockBX, blockBY, blockBZ);
      await ticks(pageA, 4);
      await shot(pageA, 't17_solo_apres_fermeture');
      check('le monde solo de A contient le bloc posé par B après fermeture', soloBlockFromB !== 0, `soloBlock=${soloBlockFromB}`);
    });

    await section('J2e. Persistance après redémarrage du serveur (monde et inventaire de B)', async () => {
      // Redémarrer le serveur sur le même dataDir : vérifier que le bloc posé par B et l'inventaire de B sont retrouvés
      srv.proc.kill('SIGTERM');
      await sleep(700);
      srv = startServer(rootDir, port, password, tmpDataDir);
      await waitServerReady(url, srv.getLogs);

      await pageB.evaluate((addr, pw) => {
        const set = (id, v) => {
          const el = document.querySelector(`[data-mc="${id}"]`);
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set('mp-name', 'JoueurB');
        set('mp-code', '');
        set('mp-address', addr);
        set('mp-password', pw);
      }, `127.0.0.1:${port}`, password);
      await pageB.click('[data-mc="mp-join"]');
      await pageB.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
      await ticks(pageB, 8);

      const persistedBlock = await ev(pageB, (x, y, z) => window.__game.world.getBlock(x, y, z), blockBX, blockBY, blockBZ + 1);
      const persistedMode = await ev(pageB, () => window.__game.player.gameMode);
      const persistedInv = await ev(pageB, () => window.__game.player.inventory.slots.some((s) => s !== null));
      check('après redémarrage serveur, le monde et l’état/inventaire de B sont retrouvés', persistedBlock !== 0 && persistedMode === 'survival' && persistedInv, `block=${persistedBlock}, mode=${persistedMode}, hasInv=${persistedInv}`);

      // Limitation d'essais par IP sur POST /api/open-world
      let locked = false;
      for (let i = 1; i <= 7; i++) {
        const badPwRes = await httpRequest(`${url}api/open-world`, {
          method: 'POST',
          headers: { 'X-Server-Password': 'mauvais-mot-de-passe' },
          body: Buffer.from('corps-factice'),
        });
        if (badPwRes.status === 429 && badPwRes.body.toLowerCase().includes('patienter')) {
          locked = true;
          break;
        }
      }
      check('POST /api/open-world limite les essais ratés par IP (429 + attente)', locked);
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
    if (!srv.proc.killed) srv.proc.kill('SIGTERM');
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  }
})();
