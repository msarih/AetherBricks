// Batterie « Multijoueur — Jalon 3 » :
// Lien d'invitation cliquable (page + intent:// + ouverture code rempli + expiration après fermeture),
// plafond de joueurs (--max-players 2 + place réservée à l'hôte), WebRTC audio/vidéo direct
// (micro coupé par défaut, activation, coupure, sourdine locale, caméra en vignette),
// refus de signalisation sans authentification, et message en contexte non sécurisé.
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const { WebSocket } = require('ws');
const { sleep, createWorld, shot, ticks } = require('./lib.cjs');
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

function httpGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const req = http.get(targetUrl, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
  });
}

async function waitServerReady(url, getLogs) {
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const res = await httpGet(url);
      if (res.status === 200) return;
    } catch {
      // retry
    }
  }
  throw new Error('Serveur multijoueur non démarré :\n' + getLogs());
}

function startServer(rootDir, port, password, dataDir, maxPlayers = 2) {
  const proc = spawn(
    process.execPath,
    [
      path.join(rootDir, 'scripts', 'serveur.mjs'),
      '--port',
      String(port),
      '--password',
      password,
      '--data-dir',
      dataDir,
      '--max-players',
      String(maxPlayers),
      '--flat',
      '--seed',
      '1337',
    ],
    { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d.toString(); });
  proc.stderr.on('data', (d) => { logs += d.toString(); });
  return { proc, getLogs: () => logs };
}

async function launchMediaBrowser() {
  return puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [
      '--use-angle=metal',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--window-size=1280,720',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });
}

async function openIsolatedPage(context, url, errors, { waitTitle = true } = {}) {
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
  if (waitTitle) {
    await page.waitForSelector('[data-mc="title"]', { timeout: 20000 });
  }
  return page;
}

(async () => {
  const rootDir = path.resolve(__dirname, '../..');
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sarihbricks-j3-'));
  const password = 'secret-j3-e2e';

  const srv = startServer(rootDir, port, password, tmpDataDir, 2);
  const browser = await launchMediaBrowser();
  const errors = [];

  let inviteCode = '';
  let inviteUrl = '';

  try {
    await waitServerReady(baseUrl, srv.getLogs);

    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const ctxC = await browser.createBrowserContext();

    const pageA = await openIsolatedPage(ctxA, baseUrl, errors);

    await section('J3a. Lien d’invitation cliquable dans la pause et page /rejoindre', async () => {
      await createWorld(pageA, { name: 'MondeJ3', seed: '1337', creative: true, flat: true });
      await ticks(pageA, 6);

      // Ouvrir aux amis
      await pageA.keyboard.press('Escape');
      await pageA.waitForSelector('[data-mc="open-friends"]', { timeout: 10000 });
      await pageA.click('[data-mc="open-friends"]');
      await pageA.waitForSelector('[data-mc="open-friends-password"]', { timeout: 10000 });
      await pageA.evaluate((pw) => {
        const el = document.querySelector('[data-mc="open-friends-password"]');
        el.value = pw;
      }, password);
      await pageA.click('[data-mc="open-friends-confirm"]');
      await pageA.waitForSelector('[data-mc="invite-url"]', { timeout: 15000 });

      inviteCode = await pageA.evaluate(() => document.querySelector('[data-mc="invite-code"]')?.textContent?.trim() ?? '');
      inviteUrl = await pageA.evaluate(() => document.querySelector('[data-mc="invite-url"]')?.textContent?.trim() ?? '');
      const hasCopyLink = await pageA.evaluate(() => Boolean(document.querySelector('[data-mc="copy-link"]')));
      await shot(pageA, 't18_pause_lien');

      check('lien d’invitation affiché dans la pause avec bouton Copier', hasCopyLink && inviteUrl.includes(`/rejoindre/${inviteCode}`), inviteUrl);

      // Vérifier le HTML de la page /rejoindre/<code> (intent:// Android)
      const landingRes = await httpGet(inviteUrl);
      const hasIntent =
        landingRes.status === 200 &&
        landingRes.body.includes(`intent://rejoindre/${inviteCode}`) &&
        landingRes.body.includes('package=com.sarih.sarihbricks');
      check('la page du lien contient intent:// vers com.sarih.sarihbricks', hasIntent, `status=${landingRes.status}`);

      // Capture de la page du lien (?no-redirect=1)
      const landingPage = await openIsolatedPage(ctxB, `${inviteUrl}?no-redirect=1`, errors, { waitTitle: false });
      await landingPage.waitForSelector('[data-mc="invite-landing"]', { timeout: 10000 });
      await shot(landingPage, 't18_page_lien');
      await landingPage.close();

      // Ouvrir le lien dans un navigateur sans app -> redirige vers Multijoueur code rempli
      const pageB = await openIsolatedPage(ctxB, inviteUrl, errors, { waitTitle: false });
      await pageB.waitForSelector('[data-mc="mp-code"]', { timeout: 15000 });
      const prefilled = await pageB.evaluate(() => document.querySelector('[data-mc="mp-code"]')?.value ?? '');
      await shot(pageB, 't18_multijoueur_code_rempli');
      check('le lien ouvre l’écran Multijoueur avec le code déjà rempli', prefilled === inviteCode, `prefilled=${prefilled}`);

      // B rejoint avec son pseudo sans retaper le code
      await pageB.evaluate(() => {
        const el = document.querySelector('[data-mc="mp-name"]');
        el.value = 'JoueurB';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await pageB.click('[data-mc="mp-join"]');
      await pageB.waitForFunction('window.__game && window.__game.ready === true', { timeout: 60000 });
      await ticks(pageB, 6);
      await pageA.click('[data-mc="resume"]');
      await ticks(pageA, 6);

      // Sauvegarder pageB sur ctxB pour les sections suivantes
      ctxB.__page = pageB;
    });

    const pageB = ctxB.__page;

    await section('J3b. Plafond de joueurs (--max-players 2) et place réservée à l’hôte', async () => {
      const pageC = await openIsolatedPage(ctxC, inviteUrl, errors, { waitTitle: false });
      await pageC.waitForSelector('[data-mc="mp-join"]', { timeout: 15000 });
      await pageC.evaluate(() => {
        const el = document.querySelector('[data-mc="mp-name"]');
        el.value = 'JoueurC';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await pageC.click('[data-mc="mp-join"]');
      await pageC.waitForFunction(
        () => (document.querySelector('[data-mc="mp-error"]')?.textContent ?? '').trim().length > 0,
        { timeout: 10000 },
      );
      const fullMsg = await pageC.evaluate(() => document.querySelector('[data-mc="mp-error"]')?.textContent?.trim() ?? '');
      await shot(pageC, 't18_serveur_complet');
      check('le 3e joueur reçoit « Serveur complet (2/2) »', fullMsg.includes('Serveur complet') && fullMsg.includes('2/2'), fullMsg);
      await pageC.close();
    });

    await section('J3c. Sécurité WebRTC : refus sans authentification', async () => {
      const res = await new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        let errMsg = '';
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'rtcSignal', to: 1, kind: 'offer', payload: { type: 'offer', sdp: 'fake' } }));
        });
        ws.on('message', (d) => {
          try {
            const m = JSON.parse(d.toString());
            if (m.type === 'error') errMsg = m.message;
          } catch {
            // ignore
          }
        });
        ws.on('close', (code) => resolve({ code, errMsg }));
      });
      check('signal WebRTC refusé avant authentification', res.code === 1008 && res.errMsg.includes('Authentification requise'), JSON.stringify(res));
    });

    await section('J3d. Audio et vidéo WebRTC directs (micro, sourdine, caméra en vignette)', async () => {
      // Micro coupé par défaut à l'arrivée
      const initState = await ev(pageA, () => ({
        micA: window.__game.voiceStatus?.micEnabled,
        camA: window.__game.voiceStatus?.camEnabled,
      }));
      const initB = await ev(pageB, () => ({
        micB: window.__game.voiceStatus?.micEnabled,
        camB: window.__game.voiceStatus?.camEnabled,
      }));
      check('micro et caméra coupés par défaut à l’arrivée', initState.micA === false && initState.camA === false && initB.micB === false && initB.camB === false);

      // A active son micro -> B reçoit la piste audio et connexion WebRTC établie
      const clickEl = (p, sel) => p.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) throw new Error('Élément introuvable : ' + s);
        el.click();
      }, sel);
      await clickEl(pageA, '[data-mc="rtc-mic"]');
      await pageB.waitForFunction(
        () => {
          const peers = window.__game?.voiceStatus?.peers ?? [];
          return peers.some((p) => p.hasRemoteAudio && p.connected && p.micOn);
        },
        { timeout: 15000 },
      );
      const bAfterMicOn = await ev(pageB, () => window.__game.voiceStatus?.peers ?? []);
      check('A active son micro : B reçoit la piste audio et la connexion WebRTC est établie', bAfterMicOn.some((p) => p.hasRemoteAudio && p.connected && p.micOn), JSON.stringify(bAfterMicOn));

      // A coupe son micro -> piste coupée chez B
      await clickEl(pageA, '[data-mc="rtc-mic"]');
      await pageB.waitForFunction(
        () => {
          const peers = window.__game?.voiceStatus?.peers ?? [];
          return peers.some((p) => !p.micOn);
        },
        { timeout: 10000 },
      );
      const aTrackEnabled = await ev(pageA, () => window.__game.voice?.localAudioTrack?.enabled ?? null);
      const bAfterMicOff = await ev(pageB, () => window.__game.voiceStatus?.peers ?? []);
      check('A coupe son micro : piste désactivée chez A et état coupé chez B', aTrackEnabled === false && bAfterMicOff.some((p) => !p.micOn));

      // A réactive son micro, B coupe le son de A -> volume à 0 chez B
      await clickEl(pageA, '[data-mc="rtc-mic"]');
      await pageB.waitForFunction(
        () => (window.__game?.voiceStatus?.peers ?? []).some((p) => p.micOn),
        { timeout: 10000 },
      );
      const muteSel = await pageB.evaluate(() => {
        const btn = document.querySelector('[data-mc^="rtc-mute-"]');
        return btn ? `[data-mc="${btn.getAttribute('data-mc')}"]` : null;
      });
      check('bouton sourdine présent chez B', Boolean(muteSel));
      await clickEl(pageB, muteSel);
      const mutedState = await ev(pageB, () => {
        const p = (window.__game.voiceStatus?.peers ?? [])[0];
        return p ? { mutedByMe: p.mutedByMe, volume: p.volume } : null;
      });
      check('B coupe le son de A : volume à zéro chez B', Boolean(mutedState && mutedState.mutedByMe && mutedState.volume === 0), JSON.stringify(mutedState));

      // A active sa caméra -> vignette vidéo visible chez B
      await clickEl(pageA, '[data-mc="rtc-cam"]');
      await pageB.waitForFunction(
        () => {
          const v = document.querySelector('[data-mc^="rtc-video-"]');
          return v && v.style.display !== 'none' && v.srcObject !== null && v.videoWidth > 0;
        },
        { timeout: 15000 },
      );
      await ticks(pageB, 4);
      await shot(pageB, 't18_audio_video');
      const hasVideo = await pageB.evaluate(() => {
        const v = document.querySelector('[data-mc^="rtc-video-"]');
        return Boolean(v && v.style.display !== 'none' && v.videoWidth > 0);
      });
      check('A active sa caméra : vignette vidéo affichée chez B', hasVideo);
    });

    await section('J3e. Contexte non sécurisé simulé : message clair et chat écrit actif', async () => {
      await pageB.evaluate(() => {
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
      });
      await ticks(pageB, 4);
      const insecureText = await pageB.evaluate(() => document.querySelector('[data-mc="rtc-insecure"]')?.textContent?.trim() ?? '');
      const micDisabled = await pageB.evaluate(() => Boolean(document.querySelector('[data-mc="rtc-mic"]')?.disabled));
      await shot(pageB, 't18_audio_indisponible');
      check(
        'contexte non sécurisé affiche le message d’indisponibilité et désactive les boutons',
        insecureText.includes('Audio et vidéo indisponibles ici') && micDisabled,
        insecureText,
      );

      // Le chat écrit continue de fonctionner
      await pageB.keyboard.press('KeyT');
      await pageB.waitForSelector('[data-mc="chat"] input', { timeout: 5000 });
      await pageB.type('[data-mc="chat"] input', 'Salut en chat ecrit');
      await pageB.keyboard.press('Enter');
      await ticks(pageA, 6);
      const chatOnA = await pageA.evaluate(() =>
        Array.from(document.querySelectorAll('.mc-chat-line')).some((el) => (el.textContent ?? '').includes('Salut en chat ecrit')),
      );
      check('la discussion écrite fonctionne en contexte non sécurisé', chatOnA);
    });

    await section('J3f. Fermeture aux amis : le lien d’invitation expire', async () => {
      await pageA.keyboard.press('Escape');
      await pageA.waitForSelector('[data-mc="close-friends"]', { timeout: 10000 });
      await pageA.click('[data-mc="close-friends"]');
      await pageA.waitForSelector('[data-mc="open-friends"]', { timeout: 15000 });

      const expiredPage = await openIsolatedPage(ctxC, inviteUrl, errors, { waitTitle: false });
      await expiredPage.waitForSelector('[data-mc="invite-expired"]', { timeout: 10000 });
      const expiredText = await expiredPage.evaluate(() => document.querySelector('[data-mc="invite-expired"]')?.textContent ?? '');
      check('un lien après fermeture affiche le message d’expiration', expiredText.includes('expiré') || expiredText.includes('fermée'), expiredText);
      await expiredPage.close();
    });

    check('aucune erreur console ni exception non gérée', errors.length === 0, errors.join(' | '));
  } finally {
    await browser.close().catch(() => {});
    srv.proc.kill('SIGTERM');
    await sleep(400);
    if (!srv.proc.killed) srv.proc.kill('SIGKILL');
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nBILAN t18: ${passed} réussis, ${failed} échoués`);
  if (failed > 0) process.exit(1);
})();
