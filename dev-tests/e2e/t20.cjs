// Batterie « Multijoueur — Jalon 5 » :
// Combat PvP/PvE, portée & recharge 1.12, /pvp on|off, arc & flèches, bouclier,
// zombie ciblant B (pas l'hôte), chute, faim & repas, potion jetable,
// mort & écran de mort & chat & butin au sol, réapparition (spawn & lit),
// /gamerule keepInventory, nuit passée au lit (1/2 vs 2/2),
// triche refusée par WebSocket brut, persistance redémarrage, déconnexion mort.
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const { sleep, launch, shot, ticks } = require('./lib.cjs');
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

function httpRequest(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
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

async function stopServer(srv, tmpDir, removeDir = true) {
  if (srv && srv.proc && srv.proc.exitCode === null) {
    srv.proc.kill('SIGINT');
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        try { srv.proc.kill('SIGKILL'); } catch {}
        resolve();
      }, 4000);
      srv.proc.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
  if (removeDir && tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
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
  await page.bringToFront();
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-mc="title"]', { timeout: 20000 });
  return page;
}

async function joinWithPassword(page, name, address, password) {
  await page.click('[data-mc="multiplayer"]');
  await page.waitForSelector('[data-mc="mp-join"]', { timeout: 10000 });
  await page.evaluate((n, addr, pw) => {
    const set = (id, v) => {
      const el = document.querySelector(`[data-mc="${id}"]`);
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('mp-name', n);
    set('mp-address', addr);
    set('mp-password', pw);
    set('mp-code', '');
  }, name, address, password);
  await page.click('[data-mc="mp-join"]');
  await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
}

async function chatCmd(page, cmd) {
  await ev(page, (c) => { window.__game.chat(c); }, cmd);
  await sleep(250);
}

async function aimAt(page, tx, ty, tz, focus = true) {
  if (focus) await page.bringToFront();
  await ev(page, (x, y, z) => {
    const p = window.__game.player;
    const dx = x - p.x;
    const dy = y - (p.y + p.eyeHeight);
    const dz = z - p.z;
    const horiz = Math.hypot(dx, dz);
    p.yaw = Math.atan2(-dx, -dz);
    p.headPitch = Math.atan2(dy, horiz);
  }, tx, ty, tz);
  await sleep(100);
}

async function aimAtPlayer(page, targetName, focus = true) {
  if (focus) await page.bringToFront();
  await ev(page, (name) => {
    const g = window.__game;
    const p = g.player;
    const t = g.entities.find((e) => e.kind === 'player' && e.customName === name && !e.hidden);
    if (!t) return false;
    const dx = t.x - p.x;
    const dy = (t.y + t.height * 0.6) - (p.y + p.eyeHeight);
    const dz = t.z - p.z;
    const horiz = Math.hypot(dx, dz);
    p.yaw = Math.atan2(-dx, -dz);
    p.headPitch = Math.atan2(dy, horiz);
    return true;
  }, targetName);
  await sleep(100);
}

async function lclick(page, focus = true) {
  if (focus) await page.bringToFront();
  await ev(page, () => { window.__game.input.presses[0]++; });
  await sleep(120);
}

async function rclick(page, focus = true) {
  if (focus) await page.bringToFront();
  await ev(page, () => { window.__game.input.presses[2]++; });
  await ticks(page, 3);
}

async function holdRclick(page, nTicks) {
  await page.bringToFront();
  await ev(page, () => {
    window.__game.input.presses[2]++;
    window.__game.input.buttons[2] = true;
  });
  await ticks(page, nTicks);
  await ev(page, () => {
    window.__game.input.buttons[2] = false;
  });
  await ticks(page, 3);
}

async function selectSlot(page, idx) {
  await ev(page, (i) => {
    window.__game.player.inventory.selected = i;
    window.__game.net.sendSelectSlot(i);
  }, idx);
  await sleep(100);
}

async function getHealth(page) {
  return ev(page, () => window.__game.player.health);
}

async function getHunger(page) {
  return ev(page, () => window.__game.player.hunger);
}

async function getPos(page) {
  return ev(page, () => ({ x: window.__game.player.x, y: window.__game.player.y, z: window.__game.player.z }));
}

async function getChatText(page) {
  return ev(page, () => Array.from(document.querySelectorAll('.mc-chat-line')).map((e) => e.textContent).join('\n'));
}

(async () => {
  const rootDir = path.resolve(__dirname, '../..');
  const port = await findFreePort();
  const password = 'j5secret';
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-j5-'));
  const serverUrl = `http://127.0.0.1:${port}`;
  const address = `127.0.0.1:${port}`;

  let srv = startServer(rootDir, port, password, tmpDataDir);
  await waitServerReady(serverUrl, srv.getLogs);

  const browser = await launch();
  const errors = [];

  try {
    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await openIsolatedPage(ctxA, serverUrl, errors);
    const pageB = await openIsolatedPage(ctxB, serverUrl, errors);

    await section('1. Connexion A (hôte) et B', async () => {
      await joinWithPassword(pageA, 'JoueurA', address, password);
      await joinWithPassword(pageB, 'JoueurB', address, password);
      await ticks(pageA, 15);
      await ticks(pageB, 15);
      const seesB = await ev(pageA, () => window.__game.entities.some((e) => e.kind === 'player' && e.customName === 'JoueurB'));
      check('A et B se voient dans le monde', seesB);
    });

    await section('2. Combat PvP, recul, recharge 1.12 et /pvp off', async () => {
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/clear JoueurB');
      await chatCmd(pageA, '/tp JoueurA 10 4 10');
      await chatCmd(pageA, '/tp JoueurB 10 4 11.0');
      await chatCmd(pageA, '/give JoueurA diamond_axe 1');
      await selectSlot(pageA, 0);
      await ticks(pageA, 22); // pleine recharge

      const beforePos = await getPos(pageB);
      const h0 = await getHealth(pageB);
      await aimAtPlayer(pageA, 'JoueurB');
      await lclick(pageA);
      await sleep(250);
      const h1 = await getHealth(pageB);
      const afterPos = await getPos(pageB);
      const hurtB = await ev(pageB, () => window.__game.player.hurtTime > 0 || window.__game.player.vx !== 0 || window.__game.player.vz !== 0);
      const dmg1 = h0 - h1;
      check('A frappe B : vie de B baisse selon l’arme', dmg1 >= 5 && dmg1 <= 10, `h0=${h0}, h1=${h1}, dmg=${dmg1}`);
      check('B subit le recul / hurtTime', hurtB || Math.hypot(afterPos.x - beforePos.x, afterPos.z - beforePos.z) > 0.05);

      // Deuxième coup rapproché (~11 ticks < 20 ticks de recharge de la hache) :
      await sleep(250);
      await ev(pageA, () => { window.__game.chat('/tp JoueurB 10 4 11.5'); });
      await sleep(100);
      await aimAtPlayer(pageA, 'JoueurB');
      await lclick(pageA);
      await sleep(250);
      const h2 = await getHealth(pageB);
      const dmg2 = h1 - h2;
      await shot(pageA, 't20-combat-pvp');
      check('deux coups trop rapprochés font moins de dégâts (recharge)', dmg2 > 0 && dmg2 < dmg1, `dmg1=${dmg1}, dmg2=${dmg2}`);

      // /pvp off
      await chatCmd(pageA, '/pvp off');
      await ticks(pageA, 22);
      await chatCmd(pageA, '/tp JoueurB 10 4 12');
      await aimAtPlayer(pageA, 'JoueurB');
      await lclick(pageA);
      await sleep(250);
      const h3 = await getHealth(pageB);
      check('avec /pvp off, le coup ne fait aucun dégât', h3 >= h2, `h2=${h2}, h3=${h3}`);
      await chatCmd(pageA, '/pvp on');
    });

    await section('3. Arc, flèches et bouclier', async () => {
      await chatCmd(pageA, '/clear JoueurB');
      await chatCmd(pageA, '/tp JoueurA 14 4 10');
      await chatCmd(pageA, '/tp JoueurB 14 4 12.5');
      await chatCmd(pageA, '/give JoueurB bow 1');
      await chatCmd(pageA, '/give JoueurB arrow 10');
      await chatCmd(pageA, '/give JoueurB shield 1');
      await ticks(pageB, 6);
      await selectSlot(pageB, 0); // bow en slot 0

      // B tire une flèche sur A
      const ha0 = await getHealth(pageA);
      await aimAtPlayer(pageB, 'JoueurA');
      await holdRclick(pageB, 22);
      await sleep(700);
      const ha1 = await getHealth(pageA);
      check('B tire une flèche sur A : A perd de la vie', ha1 < ha0, `ha0=${ha0}, ha1=${ha1}`);

      // B tire une flèche dans le sol à 4 blocs pour qu'elle reste plantée et visible chez les deux
      await aimAt(pageB, 18, 3, 12);
      await holdRclick(pageB, 18);
      await sleep(500);
      const stuckA = await ev(pageA, () => window.__game.entities.some((e) => e.kind === 'arrow'));
      const stuckB = await ev(pageB, () => window.__game.entities.some((e) => e.kind === 'arrow'));
      check('flèche plantée visible chez A et B', stuckA && stuckB, `stuckA=${stuckA}, stuckB=${stuckB}`);

      // B lève un bouclier (slot 2) face à A : A vise sans voler le focus de B !
      await chatCmd(pageA, '/tp JoueurA 14 4 10');
      await chatCmd(pageA, '/tp JoueurB 14 4 12');
      await aimAtPlayer(pageA, 'JoueurB', false);
      await selectSlot(pageB, 2); // shield en slot 2
      await pageB.bringToFront();
      await aimAtPlayer(pageB, 'JoueurA');
      await ev(pageB, () => {
        window.__game.input.presses[2]++;
        window.__game.input.buttons[2] = true;
      });
      await ticks(pageB, 12); // >= 5 ticks pour lever le bouclier
      const hb0 = await getHealth(pageB);
      await sleep(1100); // laisse le serveur recharger l'arme de A
      await lclick(pageA, false); // focus=false pour ne pas déclencher blur sur B !
      await sleep(250);
      const hb1 = await getHealth(pageB);
      await ev(pageB, () => { window.__game.input.buttons[2] = false; });
      await ticks(pageB, 2);
      check('B lève un bouclier face à A : coup bloqué', hb1 >= hb0, `hb0=${hb0}, hb1=${hb1}`);
    });

    await section('4. Zombie cible B (pas l’hôte)', async () => {
      await chatCmd(pageA, '/tp JoueurA 50 4 50');
      await chatCmd(pageA, '/tp JoueurB 20 4 20');
      await chatCmd(pageA, '/time set midnight');
      const hb0 = await getHealth(pageB);
      await chatCmd(pageA, '/summon zombie 20 4 22');
      await pageB.bringToFront();
      for (let i = 0; i < 8; i++) {
        await ticks(pageB, 15);
        if ((await getHealth(pageB)) < hb0) break;
      }
      const hb1 = await getHealth(pageB);
      await shot(pageB, 't20-zombie-b');
      check('zombie placé près de B attaque B et baisse sa vie', hb1 < hb0, `hb0=${hb0}, hb1=${hb1}`);
      await chatCmd(pageA, '/time set day');
      await chatCmd(pageA, '/difficulty 0');
      await chatCmd(pageA, '/difficulty 2');
      await sleep(300);
    });

    await section('5. Chute de 10 blocs', async () => {
      // Soigner ou réapparaître B s'il est mort, attendre la fin de l'invulnérabilité (60 ticks), puis tp à +10 blocs
      if ((await getHealth(pageB)) <= 0) {
        await pageB.click('[data-mc="respawn"]');
        await ticks(pageB, 65);
      } else {
        await sleep(3200);
      }
      await chatCmd(pageA, '/tp JoueurB 25 4 25');
      await sleep(250);
      const hBefore = await getHealth(pageB);
      const posBeforeFall = await getPos(pageB);
      await chatCmd(pageA, '/tp JoueurB 25 14 25');
      await pageB.bringToFront();
      await ticks(pageB, 45);
      const hAfter = await getHealth(pageB);
      const posAfterFall = await getPos(pageB);
      const fallDmg = hBefore - hAfter;
      check('chute de 10 blocs fait perdre 7 points (±1)', fallDmg >= 6 && fallDmg <= 8, `before=${hBefore}, after=${hAfter}, dmg=${fallDmg}, pos0=${JSON.stringify(posBeforeFall)}, pos1=${JSON.stringify(posAfterFall)}`);
    });

    await section('6. Faim, repas et potion jetable', async () => {
      if ((await getHealth(pageB)) <= 0) {
        await pageB.click('[data-mc="respawn"]');
        await ticks(pageB, 10);
      }
      await chatCmd(pageA, '/clear JoueurB');
      await chatCmd(pageA, '/give JoueurB steak 5');
      await chatCmd(pageA, '/tp JoueurB 25 4 25');
      await ticks(pageB, 4);

      // Courir + sauter en sprintant jusqu'à ce que la faim baisse
      await pageB.bringToFront();
      await pageB.keyboard.down('KeyW');
      await pageB.keyboard.down('ControlLeft');
      await pageB.keyboard.down('Space');
      for (let i = 0; i < 65; i++) {
        await ev(pageB, () => { window.__game.player.sprinting = true; });
        await ticks(pageB, 20);
        if ((await getHunger(pageB)) < 20) break;
      }
      await pageB.keyboard.up('Space');
      await pageB.keyboard.up('ControlLeft');
      await pageB.keyboard.up('KeyW');
      const hunLow = await getHunger(pageB);
      check('faim baisse quand on court', hunLow < 20, `hunger=${hunLow}`);

      // Manger le steak (slot 0)
      await selectSlot(pageB, 0);
      const beefBefore = await ev(pageB, () => window.__game.player.inventory.slots[0]?.count ?? 0);
      await holdRclick(pageB, 38);
      await ticks(pageB, 8);
      const hunAfter = await getHunger(pageB);
      const beefAfter = await ev(pageB, () => window.__game.player.inventory.slots[0]?.count ?? 0);
      check('manger fait remonter la faim', hunAfter > hunLow, `before=${hunLow}, after=${hunAfter}, beef=${beefBefore}->${beefAfter}`);

      // Potion jetable de rapidité lancée par A sur B
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/tp JoueurA 25 4 23');
      await chatCmd(pageA, '/tp JoueurB 25 4 25');
      await chatCmd(pageA, '/give JoueurA splash_potion speed 1');
      await ticks(pageA, 6);
      await selectSlot(pageA, 0);
      await aimAtPlayer(pageA, 'JoueurB');
      await rclick(pageA);
      await sleep(1000);
      const hasSpeed = await ev(pageB, () => window.__game.player.hasEffect('speed'));
      const potAfter = await ev(pageA, () => window.__game.player.inventory.slots[0]?.count ?? 0);
      check('potion jetable lancée par A applique l’effet à B', hasSpeed, `potAfter=${potAfter}`);
    });

    await section('7. Mort, écran de mort, chat, butin au sol et réapparition', async () => {
      if ((await getHealth(pageB)) <= 0) {
        await pageB.click('[data-mc="respawn"]');
        await ticks(pageB, 10);
      }
      await chatCmd(pageA, '/gamerule keepInventory false');
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/clear JoueurB');
      await chatCmd(pageA, '/give JoueurA diamond_sword 1');
      await chatCmd(pageA, '/give JoueurB diamond 3');
      await chatCmd(pageA, '/tp JoueurA 30 4 29.0');
      await chatCmd(pageA, '/setblock 29 4 32 stone');
      await chatCmd(pageA, '/setblock 31 4 32 stone');
      await chatCmd(pageA, '/setblock 30 4 33 stone');
      await chatCmd(pageA, '/tp JoueurB 30 4 32');
      await ticks(pageA, 4);
      await selectSlot(pageA, 0);

      for (let i = 0; i < 6; i++) {
        if ((await getHealth(pageB)) <= 0) break;
        await chatCmd(pageA, '/tp JoueurB 30 4 32');
        await ticks(pageA, 4);
        await aimAtPlayer(pageA, 'JoueurB');
        await lclick(pageA);
        await sleep(150);
        if ((await getHealth(pageB)) <= 0) break;
        await sleep(600);
      }
      // Objets tombés au sol vus par A (diamants de B à moins de 3 blocs de sa mort, ou ramassés par A)
      await ticks(pageA, 2);
      const diamondId = 261;
      const dropInfo = await ev(pageA, (did, dx, dy, dz) => {
        const items = window.__game.entities
          .filter((e) => e.kind === 'item')
          .map((e) => ({ id: e.itemId, d: Math.hypot(e.x - dx, e.y - dy, e.z - dz) }));
        const itemOk = items.some((it) => it.id === did && it.d < 3);
        const pickedDiamond = window.__game.player.inventory.slots.some(
          (s) => s && s.id === did && s.count === 3,
        );
        return { ok: itemOk || pickedDiamond, items, pickedDiamond };
      }, diamondId, 30, 4, 32);
      await pageB.bringToFront();
      await ticks(pageB, 4);
      const deadB = await getHealth(pageB);
      const deathBtn = await pageB.$('[data-mc="respawn"]');
      await shot(pageB, 't20-mort-ecran');
      check('B meurt et voit l’écran de mort', deadB <= 0 && deathBtn !== null, `health=${deadB}`);

      const chatA = await getChatText(pageA);
      const chatB = await getChatText(pageB);
      await pageA.bringToFront();
      await shot(pageA, 't20-mort-chat');
      check('message de mort affiché chez A et chez B', /JoueurB.*tué.*JoueurA/.test(chatA) && /JoueurB.*tué.*JoueurA/.test(chatB), chatA.slice(-150));

      await shot(pageA, 't20-butin-sol');
      check('keepInventory false : diamants tombent à moins de 3 blocs de la mort et A les voit', dropInfo.ok, JSON.stringify(dropInfo));

      // B réapparaît au point d'apparition
      await pageB.bringToFront();
      await pageB.waitForSelector('[data-mc="respawn"]:not([disabled])', { timeout: 5000 });
      await pageB.click('[data-mc="respawn"]');
      await ticks(pageB, 10);
      const respH = await getHealth(pageB);
      const respHun = await getHunger(pageB);
      check('B réapparaît avec vie et faim pleines', respH === 20 && respHun === 20, `h=${respH}, hun=${respHun}`);

      // Réapparition au lit
      await chatCmd(pageA, '/clear JoueurB');
      await chatCmd(pageA, '/give JoueurB bed 1');
      await chatCmd(pageA, '/tp JoueurB 60 4 60');
      await selectSlot(pageB, 0);
      await aimAt(pageB, 60, 3, 62);
      await rclick(pageB);
      await sleep(250);
      await aimAt(pageB, 60, 3.7, 62);
      await rclick(pageB); // clique sur le lit -> définit le point de réapparition
      await sleep(250);
      await chatCmd(pageA, '/kill JoueurB');
      await sleep(300);
      await pageB.bringToFront();
      await pageB.click('[data-mc="respawn"]');
      await ticks(pageB, 10);
      const bedRespPos = await getPos(pageB);
      check('B réapparaît à son lit', Math.hypot(bedRespPos.x - 60.5, bedRespPos.z - 62.5) < 4, JSON.stringify(bedRespPos));

      // keepInventory true
      await chatCmd(pageA, '/gamerule keepInventory true');
      await chatCmd(pageA, '/clear JoueurB');
      await chatCmd(pageA, '/give JoueurB gold_ingot 5');
      await sleep(200);
      await chatCmd(pageA, '/kill JoueurB');
      await sleep(300);
      await pageB.bringToFront();
      await pageB.click('[data-mc="respawn"]');
      await ticks(pageB, 8);
      const keptGold = await ev(pageB, () => window.__game.player.inventory.slots[0]?.count ?? 0);
      check('keepInventory true : B garde son inventaire à la mort', keptGold === 5, `keptGold=${keptGold}`);
      await chatCmd(pageA, '/gamerule keepInventory false');
    });

    await section('8. Passer la nuit au lit (1/2 vs 2/2)', async () => {
      await chatCmd(pageA, '/gamerule doMobSpawning false');
      await chatCmd(pageA, '/difficulty 0');
      await chatCmd(pageA, '/difficulty 2');
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/clear JoueurB');
      await chatCmd(pageA, '/give JoueurA bed 1');
      await chatCmd(pageA, '/give JoueurB bed 1');
      await chatCmd(pageA, '/tp JoueurA 70 4 70');
      await chatCmd(pageA, '/tp JoueurB 74 4 70');
      await ticks(pageA, 6);
      await ticks(pageB, 6);
      await selectSlot(pageA, 0);
      await aimAt(pageA, 70, 3, 72);
      await rclick(pageA);
      await ticks(pageA, 4);
      await selectSlot(pageB, 0);
      await aimAt(pageB, 74, 3, 72);
      await rclick(pageB);
      await ticks(pageB, 4);
      await chatCmd(pageA, '/time set night');
      await ticks(pageA, 4);
      await ticks(pageB, 4);

      // Seul B dort
      await aimAt(pageB, 74, 3.7, 72);
      await rclick(pageB);
      await sleep(5600);
      const tOne = await ev(pageA, () => window.__game.dayTime);
      check('nuit ne passe pas quand 1/2 joueur dort', tOne >= 12000, `dayTime=${tOne}`);

      // A dort aussi -> 2/2 -> matin
      await aimAt(pageA, 70, 3.7, 72);
      await rclick(pageA);
      await sleep(6000);
      const tTwo = await ev(pageA, () => window.__game.dayTime);
      check('nuit passe quand 2/2 joueurs dorment', tTwo < 2000, `dayTime=${tTwo}`);
    });

    await section('9. Triche refusée par WebSocket brut', async () => {
      await chatCmd(pageA, '/tp JoueurB 80 4 80');
      await ticks(pageA, 4);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      let tricheHealth = 20;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WS timeout')), 10000);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name: 'Tricheur', password })));
        ws.on('message', (data, isBin) => {
          if (isBin) return;
          const m = JSON.parse(data.toString());
          if (m.type === 'welcome') { clearTimeout(timer); resolve(); }
          else if (m.type === 'error') { clearTimeout(timer); reject(new Error(m.message)); }
          else if (m.type === 'vitals') tricheHealth = m.health;
        });
        ws.on('error', (e) => { clearTimeout(timer); reject(e); });
      });

      const bId = await ev(pageA, () => {
        const rp = window.__game.entities.find((e) => e.kind === 'player' && e.customName === 'JoueurB');
        return rp ? rp.remoteId : 0;
      });
      // Coup à 20 blocs
      await chatCmd(pageA, '/tp Tricheur 100 4 80');
      await sleep(100);
      const hb0 = await getHealth(pageB);
      ws.send(JSON.stringify({ type: 'attackPlayer', playerId: bId }));
      await sleep(250);
      const hb1 = await getHealth(pageB);
      check('triche : coup à 20 blocs refusé', hb1 === hb0, `hb0=${hb0}, hb1=${hb1}`);

      // 20 coups en 1 seconde à 2 blocs
      await chatCmd(pageA, '/tp Tricheur 82 4 80');
      await sleep(100);
      for (let i = 0; i < 20; i++) {
        ws.send(JSON.stringify({ type: 'attackPlayer', playerId: bId }));
        await sleep(30);
      }
      await sleep(250);
      const hb2 = await getHealth(pageB);
      const burstDmg = hb1 - hb2;
      check('triche : 20 coups/s plafonnés (au moins 1 coup passe, pas plus qu’un coup chargé)', burstDmg > 0 && burstDmg <= 2, `dmg=${burstDmg}`);

      // Faux paquet vitals / heal après que A a blessé Tricheur
      await chatCmd(pageA, '/give JoueurA diamond_sword 1');
      await selectSlot(pageA, 0);
      await chatCmd(pageA, '/tp Tricheur 80 4 80');
      await chatCmd(pageA, '/tp JoueurA 80 4 81.5');
      await ticks(pageA, 8);
      await aimAtPlayer(pageA, 'Tricheur');
      await lclick(pageA);
      await sleep(400);
      const hLow = tricheHealth;
      ws.send(JSON.stringify({ type: 'vitals', health: 20, hunger: 20 }));
      ws.send(JSON.stringify({ type: 'heal', amount: 20 }));
      await sleep(200);
      check('triche : message client prétendant remettre sa vie au max refusé', hLow < 20 && tricheHealth < 20, `hLow=${hLow}, tricheHealth=${tricheHealth}`);
      ws.close();
      await sleep(200);
    });

    await section('10. Persistance redémarrage et déconnexion mort', async () => {
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/tp JoueurA 90 4 90');
      await chatCmd(pageA, '/tp JoueurB 90 4 92');
      await sleep(600);
      await aimAtPlayer(pageA, 'JoueurB');
      await lclick(pageA);
      await sleep(250);
      const hBeforeRestart = await getHealth(pageB);
      const hunBeforeRestart = await getHunger(pageB);

      await pageA.close();
      await pageB.close();
      await stopServer(srv, tmpDataDir, false);
      srv = startServer(rootDir, port, password, tmpDataDir);
      await waitServerReady(serverUrl, srv.getLogs);

      const pageA2 = await openIsolatedPage(ctxA, serverUrl, errors);
      const pageB2 = await openIsolatedPage(ctxB, serverUrl, errors);
      await joinWithPassword(pageA2, 'JoueurA', address, password);
      await joinWithPassword(pageB2, 'JoueurB', address, password);
      await ticks(pageB2, 8);
      const hAfterRestart = await getHealth(pageB2);
      const hunAfterRestart = await getHunger(pageB2);
      check('vie et faim retrouvées après redémarrage du serveur', hAfterRestart === hBeforeRestart && hunAfterRestart === hunBeforeRestart, `before=(${hBeforeRestart},${hunBeforeRestart}), after=(${hAfterRestart},${hunAfterRestart})`);

      // B se déconnecte mort, puis se reconnecte : vivant, sans objets en double
      await chatCmd(pageA2, '/clear JoueurB');
      await chatCmd(pageA2, '/give JoueurB emerald 4');
      await sleep(200);
      await chatCmd(pageA2, '/kill JoueurB');
      await sleep(250);
      await pageB2.close();
      await sleep(250);

      const pageB3 = await openIsolatedPage(ctxB, serverUrl, errors);
      await joinWithPassword(pageB3, 'JoueurB', address, password);
      await ticks(pageB3, 8);
      const hReconn = await getHealth(pageB3);
      const slot0 = await ev(pageB3, () => window.__game.player.inventory.slots[0]);
      check('B déconnecté mort revient vivant sans objets en double', hReconn === 20 && slot0 === null, `h=${hReconn}, slot0=${JSON.stringify(slot0)}`);

      await pageA2.close();
      await pageB3.close();
    });

    await ctxA.close();
    await ctxB.close();

    check('aucune erreur console ni pageerror pendant toute la session', errors.length === 0, errors.join(' | '));
    const EXPECTED_CHECKS = 27;
    check('nombre de contrôles exécutés = N attendu', results.length === EXPECTED_CHECKS, `actual=${results.length}, expected=${EXPECTED_CHECKS}`);
  } finally {
    await browser.close();
    await stopServer(srv, tmpDataDir);
  }

  const ok = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\nBILAN ${ok}/${total}`);
  if (ok < total) process.exit(1);
})();
