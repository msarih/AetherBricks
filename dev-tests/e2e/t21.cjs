// Batterie « Multijoueur — Jalon 6 » :
// Redstone (levier/lampe, plaque/porte, piston+joueur, horloge à 30 blocs),
// bloc musical (son diffusé), wagonnet (siège unique + mouvement) & bateau (douceur),
// casse d'un véhicule (butin au sol), portail du Nether (x/8, z/8, isolation, retrouvé),
// portail de l'End & combat du dragon partagé (vie identique, portail de sortie),
// persistance au redémarrage, triche refusée par WebSocket brut.
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
const B_IRON_DOOR = 147;
const B_LEVER = 152;
const B_PISTON = 155;
const B_REDSTONE_LAMP_LIT = 159;
const B_NETHER_PORTAL = 161;
const B_END_PORTAL = 191;
const B_STONE = 1;

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
  await sleep(220);
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
  await sleep(80);
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

async function getBlock(page, x, y, z) {
  return ev(page, (bx, by, bz) => {
    const v = window.__game.world.getBlockAndMeta(bx, by, bz);
    return { id: v & 255, meta: v >> 8 };
  }, x, y, z);
}

async function getPos(page) {
  return ev(page, () => {
    const p = window.__game.player;
    return { x: p.x, y: p.y, z: p.z, dim: window.__game.dimension };
  });
}

(async () => {
  const rootDir = path.resolve(__dirname, '../..');
  const port = await findFreePort();
  const password = 'j6-secret-password';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarih-j6-'));
  const serverUrl = `http://127.0.0.1:${port}`;
  let srv = startServer(rootDir, port, password, tmpDir);

  let browser;
  const errors = [];

  try {
    await waitServerReady(serverUrl, srv.getLogs);
    browser = await launch();
    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();

    const pageA = await openIsolatedPage(ctxA, serverUrl, errors);
    const pageB = await openIsolatedPage(ctxB, serverUrl, errors);

    await section('1. Connexion A (hôte) et B', async () => {
      await joinWithPassword(pageA, 'JoueurA', `127.0.0.1:${port}`, password);
      await joinWithPassword(pageB, 'JoueurB', `127.0.0.1:${port}`, password);
      await chatCmd(pageA, '/tp JoueurA 10 4 10');
      await chatCmd(pageA, '/tp JoueurB 10 4 13');
      await ticks(pageA, 8);
      const seenB = await ev(pageA, () => window.__game.entities.some((e) => e.kind === 'player' && e.customName === 'JoueurB'));
      check('A et B se voient dans le monde', seenB);
    });

    await section('2. Redstone : levier/lampe, plaque/porte, piston+joueur et horloge', async () => {
      // Levier (20,4,10) -> fil (21,4,10) -> lampe (22,4,10)
      await chatCmd(pageA, '/setblock 20 4 10 lever');
      await chatCmd(pageA, '/setblock 21 4 10 redstone_wire');
      await chatCmd(pageA, '/setblock 22 4 10 redstone_lamp');
      await chatCmd(pageA, '/tp JoueurA 20.5 4 12.2');
      await chatCmd(pageA, '/tp JoueurB 22.5 4 12.2');
      await ticks(pageA, 4);
      await aimAt(pageA, 20.5, 4.15, 10.5);
      await ticks(pageA, 2);
      await rclick(pageA);
      await pageB.bringToFront();
      let lampB = await getBlock(pageB, 22, 4, 10);
      for (let i = 0; i < 10 && lampB.id !== B_REDSTONE_LAMP_LIT; i++) {
        await ticks(pageB, 3);
        lampB = await getBlock(pageB, 22, 4, 10);
      }
      const lampA = await getBlock(pageA, 22, 4, 10);
      await shot(pageB, 't21-redstone-lampe');
      check('A tire un levier : la lampe s’allume chez A et chez B', lampA.id === B_REDSTONE_LAMP_LIT && lampB.id === B_REDSTONE_LAMP_LIT, `A=${lampA.id}, B=${lampB.id}`);

      // Plaque de pression (26,4,10) -> fil (27,4,10) -> porte en fer (28,4,10)
      await chatCmd(pageA, '/setblock 26 4 10 stone_pressure_plate');
      await chatCmd(pageA, '/setblock 27 4 10 redstone_wire');
      await chatCmd(pageA, '/setblock 28 4 10 iron_door');
      await chatCmd(pageA, '/tp JoueurB 26.5 4 10.5');
      await pageB.bringToFront();
      await ticks(pageB, 6);
      await pageA.bringToFront();
      await ticks(pageA, 6);
      const doorA = await getBlock(pageA, 28, 4, 10);
      check('plaque de pression foulée par B ouvre la porte vue par A', doorA.id === B_IRON_DOOR && (doorA.meta & 4) !== 0, JSON.stringify(doorA));
      await chatCmd(pageA, '/tp JoueurB 32 4 15');
      await ticks(pageA, 12);

      // Piston orienté vers le haut (meta 0 = +Y) en (34,4,10), bloc de pierre en (34,5,10), B debout en (34.5, 6, 10.5)
      await chatCmd(pageA, '/setblock 34 4 10 piston 0');
      await chatCmd(pageA, '/setblock 34 5 10 stone');
      await chatCmd(pageA, '/setblock 33 4 10 lever');
      await chatCmd(pageA, '/tp JoueurB 34.5 6 10.5');
      await chatCmd(pageA, '/tp JoueurA 33.5 4 12.2');
      await pageB.bringToFront();
      await ticks(pageB, 4);
      const bBefore = await getPos(pageB);
      await aimAt(pageA, 33.5, 4.15, 10.5);
      await ticks(pageA, 2);
      await rclick(pageA);
      await ticks(pageA, 4);
      const bSeenByA = await ev(pageA, () => {
        const rp = window.__game.entities.find((e) => e.kind === 'player' && e.customName === 'JoueurB');
        return rp ? { x: rp.x, y: rp.y, z: rp.z } : null;
      });
      await pageB.bringToFront();
      await ticks(pageB, 4);
      const bAfter = await getPos(pageB);
      const pushedStone = await getBlock(pageA, 34, 6, 10);
      check('piston poussé déplace le bloc et B debout dessus', pushedStone.id === B_STONE && bSeenByA !== null && bSeenByA.y >= bBefore.y + 0.8 && bAfter.y >= bBefore.y + 0.8, `stone=${pushedStone.id}, y0=${bBefore.y}, ySeenA=${bSeenByA?.y}, y1=${bAfter.y}`);

      // Horloge de redstone à 30 blocs (en 60..62, 4, 10..11) : comparateur en mode soustraction
      await chatCmd(pageA, '/setblock 60 4 10 lever 8');
      await chatCmd(pageA, '/setblock 61 4 10 comparator 7');
      await chatCmd(pageA, '/setblock 62 4 10 redstone_wire');
      await chatCmd(pageA, '/setblock 62 4 11 redstone_wire');
      await chatCmd(pageA, '/setblock 61 4 11 redstone_wire');
      await chatCmd(pageA, '/tp JoueurA 30 4 10');
      await chatCmd(pageA, '/tp JoueurB 30 4 12');
      const states = new Set();
      for (let i = 0; i < 20; i++) {
        await ticks(pageA, 1);
        const s = await getBlock(pageA, 62, 4, 10);
        states.add(s.meta);
      }
      check('horloge de redstone bat pendant que A et B sont à 30 blocs', states.size >= 2, `states=${Array.from(states)}`);
    });

    await section('3. Bloc musical : son diffusé à tous', async () => {
      await chatCmd(pageA, '/setblock 24 4 20 note_block');
      await chatCmd(pageA, '/tp JoueurA 28 4 20');
      await chatCmd(pageA, '/tp JoueurB 24.5 4 22.2');
      await ticks(pageA, 4);
      const c0 = await ev(pageA, () => window.__game.lastNote?.count ?? 0);
      await aimAt(pageB, 24.5, 4.5, 20.5);
      await rclick(pageB);
      await ticks(pageA, 6);
      const noteA = await ev(pageA, () => window.__game.lastNote);
      check('B joue sur un bloc musical : A reçoit le son au bon endroit', noteA !== null && noteA.count > c0 && noteA.x === 24 && noteA.z === 20, JSON.stringify(noteA));
    });

    await section('4. Wagonnet et bateau : siège unique, douceur et casse', async () => {
      // Ligne de rails en z=30 : rail normal en x=10, puis rails propulseurs E-O en x=11..20
      await chatCmd(pageA, '/setblock 10 4 30 rail 1');
      for (let x = 11; x <= 20; x++) {
        await chatCmd(pageA, `/setblock ${x} 3 30 redstone_block`);
        await chatCmd(pageA, `/setblock ${x} 4 30 powered_rail 9`);
      }
      await chatCmd(pageA, '/setblock 9 4 30 stone');
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/give JoueurA minecart 1');
      await chatCmd(pageA, '/give JoueurA boat 1');
      await chatCmd(pageA, '/tp JoueurA 10.5 4 32');
      await chatCmd(pageA, '/tp JoueurB 14.5 4 32.5');
      await ticks(pageA, 4);
      await ev(pageA, () => { window.__game.player.inventory.selected = 0; });
      await aimAt(pageA, 10.5, 4.1, 30.5);
      await ticks(pageA, 2);
      await rclick(pageA);
      await ticks(pageA, 4);

      // A monte dans le wagonnet et avance vers +X sur les rails propulseurs
      await aimAt(pageA, 10.5, 4.4, 30.5);
      await ticks(pageA, 2);
      await rclick(pageA);
      await ticks(pageA, 4);
      await ev(pageA, () => { window.__game.player.yaw = -Math.PI / 2; });
      await pageA.keyboard.down('KeyW');
      await ticks(pageA, 10);
      await pageA.keyboard.up('KeyW');
      await ticks(pageA, 10);
      await pageB.bringToFront();
      await ticks(pageB, 6);
      const ridingInfo = await ev(pageB, () => {
        const rp = window.__game.entities.find((e) => e.kind === 'player' && e.customName === 'JoueurA');
        const cart = window.__game.entities.find((e) => e.kind === 'minecart');
        return { riding: rp?.riding ?? false, ax: rp?.x ?? 0, cx: cart?.x ?? 0 };
      });
      await shot(pageB, 't21-wagonnet');
      check('A monte dans le wagonnet : B le voit assis et avancer sur les rails', ridingInfo.riding === true && ridingInfo.ax > 11.5 && ridingInfo.cx > 11.5, JSON.stringify(ridingInfo));

      // B essaie de monter dans le même wagonnet -> refusé
      const cartPos = await ev(pageB, () => {
        const c = window.__game.entities.find((e) => e.kind === 'minecart');
        return c ? { x: c.x, y: c.y, z: c.z } : null;
      });
      if (cartPos) {
        await chatCmd(pageA, `/tp JoueurB ${cartPos.x} 4 ${cartPos.z + 1.5}`);
        await ticks(pageB, 3);
        await aimAt(pageB, cartPos.x, cartPos.y + 0.35, cartPos.z);
        await rclick(pageB);
        await ticks(pageB, 4);
      }
      const bRiding = await ev(pageB, () => window.__game.player.riding);
      check('deux joueurs ne peuvent pas monter dans le même wagonnet', bRiding === false, `bRiding=${bRiding}`);

      // A descend et casse le wagonnet -> objet au sol vu par les deux
      await pageA.bringToFront();
      await pageA.keyboard.down('ShiftLeft');
      await ticks(pageA, 3);
      await pageA.keyboard.up('ShiftLeft');
      await ticks(pageA, 4);
      const cartNow = await ev(pageA, () => {
        const c = window.__game.entities.find((e) => e.kind === 'minecart');
        return c ? { x: c.x, y: c.y, z: c.z } : null;
      });
      if (cartNow) {
        await chatCmd(pageA, `/tp JoueurA ${cartNow.x} 4 ${cartNow.z + 2.5}`);
        await ticks(pageA, 3);
        await aimAt(pageA, cartNow.x, cartNow.y + 0.35, cartNow.z);
        await ticks(pageA, 2);
        for (let i = 0; i < 6; i++) {
          await lclick(pageA);
          await sleep(100);
        }
      }
      await pageB.bringToFront();
      await ticks(pageB, 6);
      const cartDropB = await ev(pageB, () => window.__game.entities.some((e) => e.kind === 'item' && e.itemId === 406));
      check('casser le wagonnet fait tomber l’objet au sol chez B', cartDropB);

      // Reposer un wagonnet sur les rails pour la persistance au redémarrage
      await chatCmd(pageA, '/give JoueurA minecart 1');
      await chatCmd(pageA, '/tp JoueurA 12.5 4 32');
      await ticks(pageA, 4);
      await ev(pageA, () => { window.__game.player.inventory.selected = 0; });
      await aimAt(pageA, 12.5, 4.1, 30.5);
      await rclick(pageA);
      await ticks(pageA, 4);

      // Bassin d'eau en z=40..44, x=10..26 pour tester le bateau
      await chatCmd(pageA, '/fill 10 3 40 26 3 44 water');
      await chatCmd(pageA, '/tp JoueurA 12.5 4 45.2');
      await chatCmd(pageA, '/tp JoueurB 18.5 4 45.5');
      await ticks(pageA, 4);
      await ev(pageA, () => { window.__game.player.inventory.selected = 1; });
      await aimAt(pageA, 12.5, 3.8, 43.5);
      await ticks(pageA, 2);
      await rclick(pageA);
      await ticks(pageA, 4);
      await aimAt(pageA, 12.5, 4.0, 43.5);
      await ticks(pageA, 2);
      await rclick(pageA); // A monte dans le bateau
      await ticks(pageA, 5);
      await ev(pageA, () => {
        if (window.__game.player.vehicle) window.__game.player.vehicle.yaw = -Math.PI / 2;
      });
      await pageA.keyboard.down('KeyW');
      const boatSamples = [];
      for (let i = 0; i < 12; i++) {
        await pageA.bringToFront();
        await ticks(pageA, 1);
        await pageB.bringToFront();
        await ticks(pageB, 1);
        const bp = await ev(pageB, () => {
          const b = window.__game.entities.find((e) => e.kind === 'boat');
          return b ? { x: b.x, z: b.z } : null;
        });
        if (bp) boatSamples.push(bp);
      }
      await pageA.bringToFront();
      await pageA.keyboard.up('KeyW');
      await pageA.keyboard.down('ShiftLeft');
      await ticks(pageA, 3);
      await pageA.keyboard.up('ShiftLeft');
      let maxJump = 0;
      for (let i = 1; i < boatSamples.length; i++) {
        const d = Math.hypot(boatSamples[i].x - boatSamples[i - 1].x, boatSamples[i].z - boatSamples[i - 1].z);
        if (d > maxJump) maxJump = d;
      }
      const boatMoved = boatSamples.length >= 2 && Math.hypot(boatSamples[boatSamples.length - 1].x - boatSamples[0].x, boatSamples[boatSamples.length - 1].z - boatSamples[0].z) > 1.5;
      check('A pagaie en bateau : B le voit bouger en douceur (sauts <= 2 blocs)', boatMoved && maxJump <= 2.0, `moved=${boatMoved}, maxJump=${maxJump.toFixed(2)}`);
    });

    await section('5. Nether : portail x/8 z/8, isolation et retrouvaille', async () => {
      // Téléporter d'abord pour charger le chunk (5, 5), puis construire le cadre d'obsidienne 4x5 en x=80..83, y=3..7, z=80
      await chatCmd(pageA, '/tp JoueurA 81.5 4 81.4');
      await chatCmd(pageA, '/tp JoueurB 81.5 4 84.0');
      await ticks(pageA, 6);
      await chatCmd(pageA, '/fill 80 3 80 83 7 80 obsidian');
      await chatCmd(pageA, '/fill 81 4 80 82 6 80 air');
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/give JoueurA flint_and_steel 1');
      await ticks(pageA, 4);
      await ev(pageA, () => { window.__game.player.inventory.selected = 0; });
      await aimAt(pageA, 81.5, 3.5, 80.5);
      await ticks(pageA, 2);
      await rclick(pageA);
      await ticks(pageA, 4);
      const portalBlock = await getBlock(pageA, 81, 4, 80);
      check('portail du Nether allumé au briquet', portalBlock.id === B_NETHER_PORTAL, `id=${portalBlock.id}`);

      // A passe en créatif pour traverser immédiatement le portail (ou attend 80 ticks)
      await chatCmd(pageA, '/gamemode creative JoueurA');
      await chatCmd(pageA, '/tp JoueurA 81.5 4 80.5');
      await pageA.waitForFunction("window.__game && window.__game.dimension === 'nether'", { timeout: 15000 });
      await ticks(pageA, 6);
      const posANether = await getPos(pageA);
      const bSeesA = await ev(pageB, () => window.__game.entities.some((e) => e.kind === 'player' && e.customName === 'JoueurA'));
      check('A traverse vers le Nether à ~x/8, z/8 et B à la Surface ne le voit plus', Math.abs(posANether.x - 10) <= 64 && Math.abs(posANether.z - 10) <= 64 && !bSeesA, JSON.stringify({ posANether, bSeesA }));

      // A casse un bloc dans le Nether et vérifie qu'un bloc correspondant à la Surface reste intact
      const owBlockBefore = await getBlock(pageB, Math.floor(posANether.x), 3, Math.floor(posANether.z));
      await aimAt(pageA, Math.floor(posANether.x) + 0.5, Math.floor(posANether.y) - 0.5, Math.floor(posANether.z) + 0.5);
      await lclick(pageA);
      await ticks(pageB, 4);
      const owBlockAfter = await getBlock(pageB, Math.floor(posANether.x), 3, Math.floor(posANether.z));
      check('bloc cassé dans le Nether ne modifie pas la Surface', owBlockBefore.id === owBlockAfter.id, `before=${owBlockBefore.id}, after=${owBlockAfter.id}`);

      // B traverse à son tour et retrouve A au même portail
      await chatCmd(pageA, '/gamemode creative JoueurB');
      await chatCmd(pageA, '/tp JoueurB 81.5 4 80.5');
      await pageB.waitForFunction("window.__game && window.__game.dimension === 'nether'", { timeout: 15000 });
      await ticks(pageB, 8);
      const posBNether = await getPos(pageB);
      const bothSeeNether = await ev(pageB, () => window.__game.entities.some((e) => e.kind === 'player' && e.customName === 'JoueurA'));
      await shot(pageB, 't21-nether');
      check('B traverse et arrive au même portail que A dans le Nether', Math.hypot(posBNether.x - posANether.x, posBNether.z - posANether.z) < 8 && bothSeeNether, JSON.stringify({ posANether, posBNether, bothSeeNether }));
    });

    await section('6. End et combat du dragon partagé', async () => {
      // Attendre la fin du délai de refroidissement du portail (100 ticks) puis retourner à la Surface
      const portalSpot = await ev(pageA, () => {
        const p = window.__game.player;
        const bx = Math.floor(p.x);
        const by = Math.floor(p.y);
        const bz = Math.floor(p.z);
        for (let dy = -2; dy <= 3; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            for (let dz = -4; dz <= 4; dz++) {
              if (window.__game.world.getBlock(bx + dx, by + dy, bz + dz) === 161) {
                return { x: bx + dx + 0.5, y: by + dy, z: bz + dz + 0.5 };
              }
            }
          }
        }
        return { x: p.x, y: p.y, z: p.z };
      });
      await pageA.bringToFront();
      await ticks(pageA, 105);
      await chatCmd(pageA, `/tp JoueurA ${portalSpot.x} ${portalSpot.y} ${portalSpot.z}`);
      await pageA.waitForFunction("window.__game && window.__game.dimension === 'overworld'", { timeout: 15000 });
      await chatCmd(pageA, '/tp JoueurA 122.5 4 123.5');
      await pageB.bringToFront();
      await ticks(pageB, 105);
      await chatCmd(pageA, `/tp JoueurB ${portalSpot.x} ${portalSpot.y} ${portalSpot.z}`);
      await pageB.waitForFunction("window.__game && window.__game.dimension === 'overworld'", { timeout: 15000 });
      await chatCmd(pageA, '/tp JoueurB 125 4 125');
      await pageA.bringToFront();
      await ticks(pageA, 8);

      // Construire un portail de l'End en (120, 4, 120) avec 11 cadres garnis + 1 cadre vide + œil posé par clic droit
      const ring = [
        [-1, -2], [0, -2], [1, -2],
        [-1, 2], [0, 2], [1, 2],
        [-2, -1], [-2, 0], [-2, 1],
        [2, -1], [2, 0], [2, 1],
      ];
      for (let i = 0; i < ring.length; i++) {
        const [dx, dz] = ring[i];
        await chatCmd(pageA, `/setblock ${120 + dx} 4 ${120 + dz} end_portal_frame ${i < 11 ? 4 : 0}`);
      }
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/give JoueurA ender_eye 1');
      await ticks(pageA, 4);
      await ev(pageA, () => {
        const inv = window.__game.player.inventory;
        const idx = inv.slots.findIndex((s) => s && s.id === 398); // ENDER_EYE
        if (idx >= 0 && idx < 9) inv.selected = idx;
      });
      await aimAt(pageA, 122.5, 4.3, 121.5);
      await ticks(pageA, 2);
      await rclick(pageA);
      await ticks(pageA, 4);
      const endPortalBlk = await getBlock(pageA, 120, 4, 120);
      check('portail de l’End ouvert avec le dernier œil', endPortalBlk.id === B_END_PORTAL, `id=${endPortalBlk.id}`);

      // A et B entrent dans l'End
      await chatCmd(pageA, '/tp JoueurA 120.5 4.2 120.5');
      await pageA.bringToFront();
      await pageA.waitForFunction("window.__game && window.__game.dimension === 'end'", { timeout: 15000 });
      await ticks(pageA, 10);
      await chatCmd(pageA, '/tp JoueurB 120.5 4.2 120.5');
      await pageB.bringToFront();
      await pageB.waitForFunction("window.__game && window.__game.dimension === 'end'", { timeout: 15000 });
      await ticks(pageB, 10);
      await pageA.bringToFront();

      // A et B frappent le dragon et voient la même vie
      await chatCmd(pageA, '/clear JoueurA');
      await chatCmd(pageA, '/give JoueurA diamond_sword 1');
      await ticks(pageA, 2);
      await ev(pageA, () => {
        const inv = window.__game.player.inventory;
        const idx = inv.slots.findIndex((s) => s && s.id === 343); // DIAMOND_SWORD
        if (idx >= 0 && idx < 9) inv.selected = idx;
      });
      for (let i = 0; i < 6; i++) {
        const dPos = await ev(pageA, () => {
          const d = window.__game.entities.find((e) => e.kind === 'mob' && e.mobKind === 'ender_dragon');
          return d ? { x: d.x, y: d.y, z: d.z, id: d.remoteId } : null;
        });
        if (dPos) {
          await chatCmd(pageA, `/tp JoueurA ${dPos.x.toFixed(1)} ${(dPos.y + 1).toFixed(1)} ${dPos.z.toFixed(1)}`);
          await ev(pageA, (id) => { window.__game.netAttackEntity(id); }, dPos.id);
          await sleep(600);
        }
      }
      await pageB.bringToFront();
      await ticks(pageB, 4);
      const bossA = await ev(pageA, () => window.__game.boss?.progress ?? null);
      const bossB = await ev(pageB, () => window.__game.boss?.progress ?? null);
      await shot(pageB, 't21-dragon');
      check('A et B frappent le dragon et voient la même vie partagée', bossA !== null && bossB !== null && bossA < 1 && Math.abs(bossA - bossB) < 0.02, `bossA=${bossA}, bossB=${bossB}`);

      // Achever le dragon et vérifier l'apparition du portail de sortie pour les deux (agonie = 200 ticks)
      await pageA.bringToFront();
      for (let i = 0; i < 60; i++) {
        const bossNow = await ev(pageA, () => window.__game.boss?.progress ?? null);
        if (bossNow === null || bossNow <= 0) break;
        const dPos = await ev(pageA, () => {
          const d = window.__game.entities.find((e) => e.kind === 'mob' && e.mobKind === 'ender_dragon');
          return d ? { x: d.x, y: d.y, z: d.z, id: d.remoteId } : null;
        });
        if (!dPos) break;
        await chatCmd(pageA, `/tp JoueurA ${dPos.x.toFixed(1)} ${(dPos.y + 1).toFixed(1)} ${dPos.z.toFixed(1)}`);
        await ev(pageA, (id) => { window.__game.netAttackEntity(id); }, dPos.id);
        await sleep(650);
      }
      await chatCmd(pageA, '/tp JoueurA 0.5 64 4');
      await chatCmd(pageA, '/tp JoueurB 0.5 64 -4');
      for (let i = 0; i < 30; i++) {
        const b0 = await getBlock(pageA, 1, 59, 0);
        if (b0.id === B_END_PORTAL) break;
        await sleep(450);
      }
      await pageB.bringToFront();
      await ticks(pageB, 6);
      const exitA = await getBlock(pageA, 1, 59, 0);
      const exitB = await getBlock(pageB, 1, 59, 0);
      check('à la mort du dragon, A et B voient le portail de sortie', exitA.id === B_END_PORTAL && exitB.id === B_END_PORTAL, `exitA=${exitA.id}, exitB=${exitB.id}`);
    });

    await section('7. Persistance au redémarrage du serveur', async () => {
      await pageA.close();
      await pageB.close();
      await stopServer(srv, tmpDir, false);
      srv = startServer(rootDir, port, password, tmpDir);
      await waitServerReady(serverUrl, srv.getLogs);

      const pageA2 = await openIsolatedPage(ctxA, serverUrl, errors);
      const pageB2 = await openIsolatedPage(ctxB, serverUrl, errors);
      await joinWithPassword(pageA2, 'JoueurA', `127.0.0.1:${port}`, password);
      await joinWithPassword(pageB2, 'JoueurB', `127.0.0.1:${port}`, password);
      await ticks(pageA2, 8);
      await ticks(pageB2, 8);

      const dimA = await ev(pageA2, () => window.__game.dimension);
      const dimB = await ev(pageB2, () => window.__game.dimension);
      check('dimension sauvegardée et retrouvée après redémarrage', dimA === 'end' && dimB === 'end', `dimA=${dimA}, dimB=${dimB}`);

      // Retour à la Surface pour vérifier le circuit de redstone et le wagonnet
      await chatCmd(pageA2, '/tp JoueurA 1.5 59.2 0.5');
      await pageA2.waitForFunction("window.__game && window.__game.dimension === 'overworld'", { timeout: 15000 });
      await chatCmd(pageA2, '/tp JoueurA 22.5 4 28');
      await ticks(pageA2, 10);
      const lampRestored = await getBlock(pageA2, 22, 4, 10);
      const cartRestored = await ev(pageA2, () => window.__game.entities.some((e) => e.kind === 'minecart'));
      check('circuit redstone et wagonnet retrouvés après redémarrage', lampRestored.id === B_REDSTONE_LAMP_LIT && cartRestored, `lamp=${lampRestored.id}, cart=${cartRestored}`);

      await section('8. Triche refusée par WebSocket brut', async () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        let tricheDim = 'overworld';
        let tricheMount = 0;
        let lastError = '';
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('WS timeout')), 10000);
          ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name: 'Tricheur', password })));
          ws.on('message', (data, isBin) => {
            if (isBin) return;
            const m = JSON.parse(data.toString());
            if (m.type === 'welcome') { tricheDim = m.dimension || 'overworld'; clearTimeout(timer); resolve(); }
            else if (m.type === 'dimension') tricheDim = m.dimension;
            else if (m.type === 'mount') tricheMount = m.vehicleId;
            else if (m.type === 'error') lastError = m.message;
          });
          ws.on('error', (e) => { clearTimeout(timer); reject(e); });
        });

        await chatCmd(pageA2, '/tp Tricheur 20 4 42'); // à ~32 blocs du levier (20,4,10) et ~12-20 blocs du wagonnet (12,4,30)
        await chatCmd(pageA2, '/tp Tricheur 20 4 50'); // à 40 blocs du levier et 20 blocs du wagonnet
        await ticks(pageA2, 4);

        const leverBefore = await getBlock(pageA2, 20, 4, 10);
        ws.send(JSON.stringify({ type: 'useBlock', x: 20, y: 4, z: 10 }));
        await sleep(200);
        const leverAfter = await getBlock(pageA2, 20, 4, 10);
        check('triche : actionner un levier à 40 blocs refusé', leverBefore.meta === leverAfter.meta, `before=${leverBefore.meta}, after=${leverAfter.meta}`);

        const cartId = await ev(pageA2, () => {
          const c = window.__game.entities.find((e) => e.kind === 'minecart');
          return c ? c.remoteId : 0;
        });
        ws.send(JSON.stringify({ type: 'interactEntity', entityId: cartId }));
        await sleep(200);
        check('triche : monter dans un wagonnet à 20 blocs refusé', tricheMount === 0, `mount=${tricheMount}`);

        ws.send(JSON.stringify({ type: 'enterPortal', kind: 'nether' }));
        await sleep(250);
        check('triche : changement de dimension sans portail refusé', tricheDim === 'overworld' && lastError.length > 0, `dim=${tricheDim}, err=${lastError}`);
        ws.close();
      });
    });

    check('aucune erreur console ni pageerror pendant toute la session', errors.length === 0, errors.join(' | '));
    const expectedChecks = 23;
    check('nombre de contrôles exécutés = N attendu', results.length === expectedChecks, `actual=${results.length}, expected=${expectedChecks}`);
  } finally {
    if (browser) await browser.close();
    await stopServer(srv, tmpDir, true);
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\nBILAN ${passed}/${total}`);
  if (passed !== total) process.exitCode = 1;
})();
