// Batterie « Plateforme » (points 49 à 51) :
// 49. Commandes tactiles (téléphone en paysage et en portrait, tablette, joystick, regard, appui long/court, barre, inventaire, boutons) ;
// 50. Installation PWA & mode hors ligne (manifeste, service worker, démarrage hors ligne, création et sauvegarde d'un monde) ;
// 51. Manette de jeu (API Gamepad : déplacement, regard, gâchettes, saut, accroupi, jeter, inventaire, pause, navigation menus, branchement/débranchement).
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { sleep, launch, openPage, click, createWorld, shot, ticks, URL } = require('./lib.cjs');
const { results, check, install, ev, chat, pos, section } = require('./h.cjs');

/** Trouve un port libre différent de 5173 et 5174. */
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
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

/** Geste tactile continu : touchStart -> touchMove (en plusieurs étapes) -> maintien -> touchEnd. */
async function touchDragHold(page, x0, y0, x1, y1, { steps = 5, holdTicks = 0, holdMs = 0 } = {}) {
  await page.touchscreen.touchStart(x0, y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.touchscreen.touchMove(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
    await sleep(15);
  }
  if (holdTicks > 0) await ticks(page, holdTicks);
  if (holdMs > 0) await sleep(holdMs);
  await page.touchscreen.touchEnd();
}

/** Appui long tactile immobile (sans glissé). */
async function touchLongPress(page, x, y, { holdMs = 300, holdTicks = 0 } = {}) {
  await page.touchscreen.touchStart(x, y);
  if (holdMs > 0) await sleep(holdMs);
  if (holdTicks > 0) await ticks(page, holdTicks);
  await page.touchscreen.touchEnd();
}

/** Centre d'un élément DOM identifié par sélecteur CSS. */
async function centerOf(page, selector) {
  const pt = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);
  if (!pt) throw new Error('Élément introuvable : ' + selector);
  return pt;
}

(async () => {
  const browser = await launch();
  const errors = [];
  const page = await openPage(browser, errors);

  // ========================================================================= 1. Tactile (téléphone paysage 844×390)
  await section('49a. Commandes tactiles sur téléphone en paysage (844 × 390)', async () => {
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await sleep(200);

    // Premier contact tactile ou pointer: coarse -> détection automatique
    const titlePlay = await centerOf(page, '[data-mc="play"]');
    await page.touchscreen.tap(titlePlay.x, titlePlay.y);
    await page.waitForSelector('[data-mc="world-create"]', { timeout: 10000 });
    await sleep(150);
    await click(page, 'world-create');
    await page.waitForSelector('[data-mc="seed"]', { timeout: 10000 });
    await page.evaluate(() => {
      const set = (id, v) => {
        const i = document.querySelector(`[data-mc="${id}"]`);
        i.value = v;
        i.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('name', 'MondeTactile');
      set('seed', '1337');
    });
    await click(page, 'type'); // monde plat
    await click(page, 'create');
    await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
    await install(page);
    await ev(page, () => {
      window.__game.difficulty = 0; // paisible pour éviter les slimes pendant les gestes
    });
    await ticks(page, 10);

    const autoTouch = await ev(page, () => ({
      touchActive: document.querySelector('.mc-hud')?.classList.contains('mc-touch-on') ?? false,
      controlsShown: getComputedStyle(document.querySelector('[data-mc="touch-controls"]')).display !== 'none',
      pointerLocked: document.pointerLockElement !== null,
      touchModeSetting: window.__game.settings.touchMode,
    }));
    check('tactile : détection automatique (pointer: coarse / touch) et absence de verrouillage du pointeur',
      autoTouch.touchActive && autoTouch.controlsShown && !autoTouch.pointerLocked && autoTouch.touchModeSetting === 'auto',
      JSON.stringify(autoTouch));

    await shot(page, 't15_telephone_paysage');

    // Joystick en bas à gauche -> fait avancer le joueur
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(0.5, 4, 0.5);
      T.look(0, 0); // regarde vers -Z
    });
    await ticks(page, 4);
    const pBeforeWalk = await pos(page);
    const stick = await centerOf(page, '[data-mc="touch-joystick"]');
    await touchDragHold(page, stick.x, stick.y, stick.x, stick.y - 45, { steps: 4, holdTicks: 18 });
    const pAfterWalk = await pos(page);
    check('tactile (paysage) : le joystick virtuel fait avancer le joueur',
      pAfterWalk.z < pBeforeWalk.z - 0.8,
      `z: ${pBeforeWalk.z.toFixed(2)} -> ${pAfterWalk.z.toFixed(2)}`);

    // Glisser le doigt sur l'écran -> fait tourner le regard
    const lookBefore = await ev(page, () => ({ yaw: window.__game.player.yaw, pitch: window.__game.player.headPitch }));
    await touchDragHold(page, 450, 180, 560, 140, { steps: 6, holdTicks: 2 });
    const lookAfter = await ev(page, () => ({ yaw: window.__game.player.yaw, pitch: window.__game.player.headPitch }));
    check('tactile (paysage) : glisser le doigt sur l’écran fait tourner le regard (lacet et tangage)',
      Math.abs(lookAfter.yaw - lookBefore.yaw) > 0.15 && Math.abs(lookAfter.pitch - lookBefore.pitch) > 0.05,
      `yaw ${lookBefore.yaw.toFixed(2)}->${lookAfter.yaw.toFixed(2)}, pitch ${lookBefore.pitch.toFixed(2)}->${lookAfter.pitch.toFixed(2)}`);

    // Bouton Saut et bouton Accroupi
    const jumpBtn = await centerOf(page, '[data-mc="touch-jump"]');
    await page.touchscreen.touchStart(jumpBtn.x, jumpBtn.y);
    await ticks(page, 4);
    const jumpingY = (await pos(page)).y;
    await page.touchscreen.touchEnd();
    await ticks(page, 12);
    check('tactile : le bouton de saut fait sauter le joueur', jumpingY > 4.2, `y max=${jumpingY.toFixed(2)}`);

    const sneakBtn = await centerOf(page, '[data-mc="touch-sneak"]');
    await page.touchscreen.tap(sneakBtn.x, sneakBtn.y);
    await ticks(page, 3);
    const sneakingOn = await ev(page, () => window.__game.player.sneaking);
    await page.touchscreen.tap(sneakBtn.x, sneakBtn.y);
    await ticks(page, 3);
    const sneakingOff = await ev(page, () => window.__game.player.sneaking);
    check('tactile : le bouton d’accroupissement active puis coupe l’accroupi',
      sneakingOn === true && sneakingOff === false,
      `on=${sneakingOn}, off=${sneakingOff}`);

    // Double appui sur saut en créatif -> active le vol
    await chat(page, '/gamemode creative');
    await ticks(page, 2);
    await page.touchscreen.tap(jumpBtn.x, jumpBtn.y);
    await sleep(60);
    await page.touchscreen.tap(jumpBtn.x, jumpBtn.y);
    await ticks(page, 3);
    const flyingCreative = await ev(page, () => window.__game.player.flying);
    await chat(page, '/gamemode survival');
    await ticks(page, 4);
    check('tactile : double appui sur le bouton de saut en créatif active le vol', flyingCreative === true);

    // Casser un bloc par appui long (avec progression de casse)
    await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      g.player.teleport(0.5, 4, 0.5);
      g.world.setBlock(0, 4, -2, B.DIRT, 0);
      T.aim(0.5, 4.5, -1.5);
    });
    await ticks(page, 3);
    await page.touchscreen.touchStart(422, 195);
    await sleep(260);
    await ticks(page, 6);
    const midBreak = await ev(page, () => window.__game.world.getBlock(0, 4, -2));
    await ticks(page, 25);
    await page.touchscreen.touchEnd();
    const afterBreak = await ev(page, () => window.__game.world.getBlock(0, 4, -2));
    check('tactile : un appui long casse progressivement le bloc visé (en survie)',
      midBreak !== 0 && afterBreak === 0,
      `en cours=${midBreak}, après=${afterBreak}`);

    // Toucher une case de la barre d'objets la sélectionne
    await chat(page, '/give cobblestone 16');
    await ev(page, () => {
      const inv = window.__game.player.inventory;
      inv.slots[3] = inv.slots[0];
      inv.slots[0] = null;
      inv.selected = 0;
    });
    await ticks(page, 2);
    const slot3 = await centerOf(page, '[data-mc="hotbar-slot-3"]');
    await page.touchscreen.tap(slot3.x, slot3.y);
    await ticks(page, 2);
    const selectedSlot = await ev(page, () => window.__game.player.inventory.selected);
    check('tactile : toucher une case de la barre d’objets la sélectionne', selectedSlot === 3, `selected=${selectedSlot}`);

    // Appui court -> pose un bloc
    await ev(page, () => {
      window.__game.world.setBlock(0, 4, -2, 0, 0);
      T.aim(0.5, 3.9, -1.5); // vise le sol en (0, 3, -2) pour poser en (0, 4, -2)
    });
    await ticks(page, 3);
    await page.touchscreen.tap(422, 195);
    await ticks(page, 4);
    const placedBlock = await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      return window.__game.world.getBlock(0, 4, -2) === B.COBBLESTONE;
    });
    check('tactile : un appui court pose le bloc tenu', placedBlock === true);

    // Appui court sur une créature -> attaque la créature
    const attackedMob = await ev(page, async () => {
      const M = await import('/src/entity/Mobs.ts');
      const g = window.__game;
      g.world.setBlock(0, 4, -2, 0, 0);
      const pig = M.createMob('pig', g.rng);
      pig.setPosition(0.5, 4, -1.5);
      pig.health = 10;
      g.spawn(pig);
      T.aim(0.5, 4.4, -1.5);
      return pig.id;
    });
    await ticks(page, 2);
    await page.touchscreen.tap(422, 195);
    await ticks(page, 3);
    const pigHealthAfter = await ev(page, (id) => {
      const e = window.__game.entities.find((x) => x.id === id);
      if (e) e.dead = true;
      return e ? e.health : -1;
    }, attackedMob);
    check('tactile : un appui court sur une créature l’attaque', pigHealthAfter >= 0 && pigHealthAfter < 10, `health=${pigHealthAfter}`);

    // Boutons de barre supérieure : Vue (1re / 3e personne), Discussion (/), Pause
    const viewBtn = await centerOf(page, '[data-mc="touch-view"]');
    await page.touchscreen.tap(viewBtn.x, viewBtn.y);
    await ticks(page, 2);
    const viewMode1 = await ev(page, () => window.__game.viewMode);
    await page.touchscreen.tap(viewBtn.x, viewBtn.y);
    await page.touchscreen.tap(viewBtn.x, viewBtn.y);
    await ticks(page, 2);
    const viewMode0 = await ev(page, () => window.__game.viewMode);
    check('tactile : le bouton de vue bascule entre 1re et 3e personne', viewMode1 === 1 && viewMode0 === 0, `${viewMode1} -> ${viewMode0}`);

    const chatBtn = await centerOf(page, '[data-mc="touch-chat"]');
    await page.touchscreen.tap(chatBtn.x, chatBtn.y);
    await page.waitForSelector('[data-mc="chat"]', { timeout: 5000 });
    const chatPrefill = await page.evaluate(() => document.querySelector('[data-mc="chat"] input')?.value ?? '');
    const chatClose = await centerOf(page, '[data-mc="chat-close"]');
    await page.touchscreen.tap(chatClose.x, chatClose.y);
    await ticks(page, 2);
    check('tactile : le bouton discussion ouvre la saisie pré-remplie avec « / » et se referme au doigt', chatPrefill === '/');

    const pauseBtn = await centerOf(page, '[data-mc="touch-pause"]');
    await page.touchscreen.tap(pauseBtn.x, pauseBtn.y);
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    const pausedOk = await ev(page, () => window.__game.ui.pausing === true);
    const resumeBtn = await centerOf(page, '[data-mc="resume"]');
    await page.touchscreen.tap(resumeBtn.x, resumeBtn.y);
    await ticks(page, 2);
    check('tactile : le bouton pause ouvre le menu de pause et reprend la partie au doigt', pausedOk === true);
  });

  // ========================================================================= 2. Tactile en portrait (390×844) & tablette (1024×768)
  await section('49b. Tactile en portrait (390 × 844) et inventaire au doigt sur tablette (1024 × 768)', async () => {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await sleep(250);
    await ticks(page, 4);

    const portraitLayout = await page.evaluate(() => {
      const ui = document.getElementById('ui');
      const stick = document.querySelector('[data-mc="touch-joystick"]')?.getBoundingClientRect();
      const hotbar = document.querySelector('[data-mc="hotbar"]')?.getBoundingClientRect();
      const jump = document.querySelector('[data-mc="touch-jump"]')?.getBoundingClientRect();
      const inBounds = (r) => r && r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
      return {
        portraitClass: ui?.classList.contains('mc-portrait') ?? false,
        stickOk: inBounds(stick),
        hotbarOk: inBounds(hotbar),
        jumpOk: inBounds(jump),
        noScroll: document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight,
      };
    });
    check('tactile (portrait 390 × 844) : interface lisible, sans débordement ni défilement',
      portraitLayout.portraitClass && portraitLayout.stickOk && portraitLayout.hotbarOk && portraitLayout.jumpOk && portraitLayout.noScroll,
      JSON.stringify(portraitLayout));

    await shot(page, 't15_telephone_portrait');

    // Déplacement et sélection de case en portrait
    const p0 = await pos(page);
    const stickP = await centerOf(page, '[data-mc="touch-joystick"]');
    await touchDragHold(page, stickP.x, stickP.y, stickP.x, stickP.y - 40, { steps: 4, holdTicks: 14 });
    const p1 = await pos(page);
    check('tactile (portrait 390 × 844) : le joystick déplace le joueur en portrait',
      Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.6,
      `dist=${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)}`);

    // Tablette 1024 × 768 : ouvrir l'inventaire au doigt et déplacer un objet d'une case à une autre
    await page.setViewport({ width: 1024, height: 768, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await sleep(250);
    await ticks(page, 4);

    const invBtn = await centerOf(page, '[data-mc="touch-inventory"]');
    await page.touchscreen.tap(invBtn.x, invBtn.y);
    await page.waitForSelector('[data-mc="menu-inventory"]', { timeout: 5000 });
    await sleep(200);

    // Toucher la case 3 de la barre d'objets (qui contient la cobblestone) pour prendre la pile, puis toucher la case 1 pour la poser
    const slotFrom = await centerOf(page, '[data-mc="menu-inventory"] [data-group="hotbar"][data-i]');
    const hotbarCoords = await page.evaluate(() => {
      const slots = Array.from(document.querySelectorAll('[data-mc="menu-inventory"] [data-group="hotbar"]'));
      return slots.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
    });
    await page.touchscreen.tap(hotbarCoords[3].x, hotbarCoords[3].y);
    await sleep(120);
    const cursorHeld = await ev(page, () => window.__game.player.inventory.cursor?.id ?? 0);
    await page.touchscreen.tap(hotbarCoords[1].x, hotbarCoords[1].y);
    await sleep(120);
    const movedSlot = await ev(page, () => ({
      cursor: window.__game.player.inventory.cursor,
      slot1: window.__game.player.inventory.slots[1]?.id ?? 0,
      slot3: window.__game.player.inventory.slots[3],
    }));
    check('tactile (tablette 1024 × 768) : l’inventaire s’ouvre au doigt et un objet s’y déplace d’une case à une autre',
      cursorHeld > 0 && movedSlot.cursor === null && movedSlot.slot1 === cursorHeld && movedSlot.slot3 === null,
      JSON.stringify({ cursorHeld, movedSlot, slotFrom: !!slotFrom }));

    await shot(page, 't15_tablette_inventaire');

    const closeSlot = await centerOf(page, '[data-mc="slot-close"]');
    await page.touchscreen.tap(closeSlot.x, closeSlot.y);
    await page.waitForFunction(() => window.__game.ui.modal === false, { timeout: 5000 });
    await ticks(page, 2);

    // Réglage pour forcer ou couper le mode tactile dans les options
    await ev(page, () => {
      window.__game.settings.touchMode = 'off';
      window.__game.applySettings();
    });
    await ticks(page, 3);
    const forcedOff = await page.evaluate(() => getComputedStyle(document.querySelector('[data-mc="touch-controls"]')).display === 'none');
    await ev(page, () => {
      window.__game.settings.touchMode = 'on';
      window.__game.applySettings();
    });
    await ticks(page, 3);
    const forcedOn = await page.evaluate(() => getComputedStyle(document.querySelector('[data-mc="touch-controls"]')).display !== 'none');
    await ev(page, () => {
      window.__game.settings.touchMode = 'auto';
      window.__game.applySettings();
    });
    check('tactile : le réglage touchMode permet de couper (« off ») ou forcer (« on ») l’interface tactile',
      forcedOff === true && forcedOn === true,
      `off=${forcedOff}, on=${forcedOn}`);
  });

  // ========================================================================= 3. Manette de jeu (API Gamepad)
  await section('51. Manette de jeu (API Gamepad : déplacement, regard, actions, menus, branchement/débranchement)', async () => {
    await ev(page, () => {
      window.__game.settings.touchMode = 'off';
      window.__game.applySettings();
    });
    await ticks(page, 3);

    // Injection d'une fausse manette via navigator.getGamepads
    await page.evaluate(() => {
      const buttons = Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 }));
      const axes = [0, 0, 0, 0];
      window.__fakePad = {
        id: 'Xbox Wireless Controller (Standard Gamepad)',
        index: 0,
        connected: true,
        mapping: 'standard',
        axes,
        buttons,
        timestamp: performance.now(),
      };
      window.__padEnabled = true;
      navigator.getGamepads = () => (window.__padEnabled ? [window.__fakePad, null, null, null] : [null, null, null, null]);
      window.__setPadBtn = (idx, down, val = down ? 1 : 0) => {
        window.__fakePad.buttons[idx] = { pressed: down, touched: down, value: val };
        window.__fakePad.timestamp = performance.now();
      };
      window.__setPadAxes = (lx, ly, rx = 0, ry = 0) => {
        window.__fakePad.axes[0] = lx;
        window.__fakePad.axes[1] = ly;
        window.__fakePad.axes[2] = rx;
        window.__fakePad.axes[3] = ry;
        window.__fakePad.timestamp = performance.now();
      };
    });
    await ticks(page, 4);

    const connectNotice = await page.evaluate(() => {
      const el = document.querySelector('[data-mc="platform-notice"]');
      return { text: el?.textContent ?? '', shown: el?.classList.contains('mc-shown') ?? false };
    });
    check('manette : détection du branchement à chaud avec message à l’écran',
      connectNotice.shown && connectNotice.text.includes('Manette connectée'),
      JSON.stringify(connectNotice));

    await shot(page, 't15_manette_connectee');

    // Zone morte : une petite inclinaison (0.10 < 0.18) ne déplace pas le joueur
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(0.5, 4, 0.5);
      T.look(0, 0);
      window.__setPadAxes(0, -0.1, 0.1, 0);
    });
    await ticks(page, 10);
    const afterDeadzone = await pos(page);
    check('manette : la zone morte des sticks filtre les micro-mouvements',
      Math.hypot(afterDeadzone.x - 0.5, afterDeadzone.z - 0.5) < 0.05,
      JSON.stringify(afterDeadzone));

    // Stick gauche -> fait avancer le joueur
    await ev(page, () => window.__setPadAxes(0, -1, 0, 0));
    await ticks(page, 16);
    await ev(page, () => window.__setPadAxes(0, 0, 0, 0));
    const afterPadWalk = await pos(page);
    check('manette : le stick gauche fait avancer le joueur',
      afterPadWalk.z < 0.5 - 0.8,
      `z=${afterPadWalk.z.toFixed(2)}`);

    // Stick droit -> fait tourner le regard
    const yaw0 = await ev(page, () => window.__game.player.yaw);
    await ev(page, () => window.__setPadAxes(0, 0, 0.85, 0));
    await ticks(page, 10);
    await ev(page, () => window.__setPadAxes(0, 0, 0, 0));
    const yaw1 = await ev(page, () => window.__game.player.yaw);
    check('manette : le stick droit fait tourner le regard', Math.abs(yaw1 - yaw0) > 0.2, `yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);

    // Bouton A (0) -> fait sauter le joueur
    await ev(page, () => window.__setPadBtn(0, true));
    await ticks(page, 4);
    const padJumpY = (await pos(page)).y;
    await ev(page, () => window.__setPadBtn(0, false));
    await ticks(page, 12);
    check('manette : le bouton A / Croix (0) fait sauter le joueur', padJumpY > 4.2, `y=${padJumpY.toFixed(2)}`);

    // Bouton B (1) -> s'accroupir ; L3 (10) -> sprint
    await ev(page, () => window.__setPadBtn(1, true));
    await ticks(page, 3);
    const padSneak = await ev(page, () => window.__game.player.sneaking);
    await ev(page, () => window.__setPadBtn(1, false));
    await ticks(page, 3);
    check('manette : le bouton B / Rond (1) fait s’accroupir le joueur', padSneak === true);

    // Gâchettes hautes LB (4) / RB (5) -> objet précédent / suivant
    await ev(page, () => { window.__game.player.inventory.selected = 1; });
    await ev(page, () => window.__setPadBtn(5, true));
    await ticks(page, 2);
    await ev(page, () => window.__setPadBtn(5, false));
    const selAfterRB = await ev(page, () => window.__game.player.inventory.selected);
    await ev(page, () => window.__setPadBtn(4, true));
    await ticks(page, 2);
    await ev(page, () => window.__setPadBtn(4, false));
    const selAfterLB = await ev(page, () => window.__game.player.inventory.selected);
    check('manette : les gâchettes hautes LB / RB changent la case sélectionnée',
      selAfterRB === 2 && selAfterLB === 1,
      `RB->${selAfterRB}, LB->${selAfterLB}`);

    // Gâchette droite RT (7) -> casse un bloc ; Gâchette gauche LT (6) -> pose un bloc
    await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      g.player.teleport(0.5, 4, 0.5);
      g.world.setBlock(0, 4, -2, B.DIRT, 0);
      T.aim(0.5, 4.5, -1.5);
      window.__setPadBtn(7, true, 1);
    });
    await ticks(page, 30);
    await ev(page, () => window.__setPadBtn(7, false, 0));
    const brokenByRT = await ev(page, () => window.__game.world.getBlock(0, 4, -2) === 0);
    check('manette : la gâchette droite (RT) casse le bloc visé', brokenByRT === true);

    await ev(page, () => {
      window.__game.player.inventory.selected = 1; // cobblestone
      T.aim(0.5, 3.9, -1.5);
      window.__setPadBtn(6, true, 1);
    });
    await ticks(page, 3);
    await ev(page, () => window.__setPadBtn(6, false, 0));
    const placedByLT = await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      return window.__game.world.getBlock(0, 4, -2) === B.COBBLESTONE;
    });
    check('manette : la gâchette gauche (LT) pose le bloc tenu', placedByLT === true);

    // Bouton X (2) -> jette un objet
    const countBeforeDrop = await ev(page, () => window.__game.player.inventory.slots[1]?.count ?? 0);
    await ev(page, () => window.__setPadBtn(2, true));
    await ticks(page, 2);
    await ev(page, () => window.__setPadBtn(2, false));
    const countAfterDrop = await ev(page, () => window.__game.player.inventory.slots[1]?.count ?? 0);
    check('manette : le bouton X / Carré (2) jette un objet de la main',
      countAfterDrop === countBeforeDrop - 1,
      `${countBeforeDrop} -> ${countAfterDrop}`);

    // Bouton Y (3) -> ouvre l'inventaire ; navigation D-pad + A pour prendre/poser ; B (1) pour refermer
    await ev(page, () => window.__setPadBtn(3, true));
    await ticks(page, 2);
    await ev(page, () => window.__setPadBtn(3, false));
    await page.waitForSelector('[data-mc="menu-inventory"]', { timeout: 5000 });
    const invOpenedByY = await ev(page, () => window.__game.ui.modal === true);

    // D-pad droite (15) déplace le focus sur la case suivante, A (0) clique dessus
    await ev(page, () => window.__setPadBtn(15, true));
    await ticks(page, 2);
    await ev(page, () => window.__setPadBtn(15, false));
    const hasPadFocus = await page.evaluate(() => document.querySelector('.mc-pad-focus') !== null);
    await ev(page, () => window.__setPadBtn(1, true));
    await ticks(page, 2);
    await ev(page, () => window.__setPadBtn(1, false));
    await ticks(page, 2);
    const invClosedByB = await ev(page, () => window.__game.ui.modal === false);
    check('manette : Y ouvre l’inventaire, la croix directionnelle déplace la sélection et B referme',
      invOpenedByY && hasPadFocus && invClosedByB,
      JSON.stringify({ invOpenedByY, hasPadFocus, invClosedByB }));

    // Bouton Start (9) -> met en pause ; B (1) -> reprend
    await ev(page, () => window.__setPadBtn(9, true));
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await ev(page, () => window.__setPadBtn(9, false));
    await sleep(60);
    const pausedByStart = await ev(page, () => window.__game.ui.pausing === true);
    await ev(page, () => window.__setPadBtn(1, true));
    await page.waitForFunction(() => window.__game.ui.pausing === false, { timeout: 5000 });
    await ev(page, () => window.__setPadBtn(1, false));
    await ticks(page, 2);
    const resumedByB = await ev(page, () => window.__game.ui.pausing === false);
    check('manette : Start met le jeu en pause et B reprend la partie', pausedByStart && resumedByB);

    // Débranchement à chaud sans erreur
    await ev(page, () => { window.__padEnabled = false; });
    await ticks(page, 4);
    const disconnectNotice = await page.evaluate(() => document.querySelector('[data-mc="platform-notice"]')?.textContent ?? '');
    check('manette : débranchement à chaud détecté sans erreur avec notification',
      disconnectNotice.includes('Manette déconnectée'),
      disconnectNotice);
  });

  // ========================================================================= 4. PWA & Hors ligne (sur build de production via vite preview)
  await section('50. Installation PWA, manifeste, service worker et jeu hors ligne', async () => {
    const rootDir = path.resolve(__dirname, '../..');
    if (!fs.existsSync(path.join(rootDir, 'dist', 'index.html'))) {
      execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
    }
    const previewPort = await findFreePort();
    const previewUrl = `http://127.0.0.1:${previewPort}/`;
    const previewProc = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], {
      cwd: rootDir,
      stdio: 'ignore',
    });

    try {
      let ready = false;
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        if (await checkHttpOk(previewUrl)) { ready = true; break; }
      }
      if (!ready) throw new Error('Impossible de démarrer vite preview sur ' + previewUrl);

      const pwaPage = await browser.newPage();
      await pwaPage.setViewport({ width: 1280, height: 720 });
      pwaPage.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('  pageerror', e.message); });
      pwaPage.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/404|favicon/.test(t)) { errors.push('console.' + m.type() + ': ' + t); console.log('  console.' + m.type(), t.slice(0, 300)); } } });
      await pwaPage.goto(previewUrl, { waitUntil: 'networkidle0' });
      await pwaPage.waitForSelector('[data-mc="title"]', { timeout: 20000 });

      // Vérifie le manifeste et la présence d'un service worker actif
      const pwaStatus = await pwaPage.evaluate(async () => {
        const link = document.querySelector('link[rel="manifest"]');
        const href = link ? link.getAttribute('href') : null;
        const res = href ? await fetch(href) : null;
        const manifest = res && res.ok ? await res.json() : null;
        const reg = await navigator.serviceWorker.getRegistration();
        // Attend que le service worker contrôle la page et ait pré-rempli son cache
        if (reg && reg.active && !navigator.serviceWorker.controller) {
          reg.active.postMessage({ type: 'SKIP_WAITING' });
        }
        return {
          href,
          manifest,
          swActive: !!(reg && reg.active),
          icon192Ok: (await fetch('/icon-192.png')).status === 200,
          icon512Ok: (await fetch('/icon-512.png')).status === 200,
        };
      });
      check('PWA : manifeste valide (nom « SarihBricks », icônes 192/512, display standalone)',
        pwaStatus.manifest?.name === 'SarihBricks'
        && (pwaStatus.manifest?.display === 'standalone' || pwaStatus.manifest?.display === 'fullscreen')
        && Array.isArray(pwaStatus.manifest?.icons)
        && pwaStatus.manifest.icons.length >= 2
        && pwaStatus.icon192Ok
        && pwaStatus.icon512Ok
        && pwaStatus.swActive,
        JSON.stringify(pwaStatus));

      // Laisse au service worker le temps de mettre en cache tous les modules (y compris les workers)
      await sleep(800);

      // Passage en mode hors ligne de Puppeteer puis rechargement complet de la page (sans cache HTTP pour solliciter le Service Worker)
      await pwaPage.setCacheEnabled(false);
      await pwaPage.setOfflineMode(true);
      await pwaPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await pwaPage.waitForSelector('[data-mc="title"]', { timeout: 20000 });

      const offlineTitle = await pwaPage.evaluate(async () => {
        let cachedRoot = false;
        try {
          const cache = await caches.open('sarihbricks-pwa-v1');
          const hit = (await cache.match('/')) || (await cache.match('/index.html'));
          cachedRoot = !!hit;
        } catch {
          cachedRoot = false;
        }
        return {
          titleShown: document.querySelector('[data-mc="title"]') !== null,
          online: navigator.onLine,
          swControlled: navigator.serviceWorker?.controller !== null,
          cachedRoot,
        };
      });
      check('hors ligne : après passage en mode hors ligne et rechargement, le menu principal s’affiche',
        offlineTitle.titleShown === true && offlineTitle.online === false && offlineTitle.swControlled === true && offlineTitle.cachedRoot === true,
        JSON.stringify(offlineTitle));

      // Création d'un monde hors ligne, jeu, sauvegarde et rechargement hors ligne
      await createWorld(pwaPage, { name: 'MondeHorsLigne', seed: '2026', flat: true });
      await ticks(pwaPage, 10);

      await shot(pwaPage, 't15_hors_ligne');

      const GOLD_BLOCK = 29;
      const placedOffline = await ev(pwaPage, async (blockId) => {
        const g = window.__game;
        g.world.setBlock(2, 4, 2, blockId, 0);
        await g.save();
        return g.world.getBlock(2, 4, 2) === blockId;
      }, GOLD_BLOCK);
      await pwaPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await pwaPage.waitForSelector('[data-mc="title"]', { timeout: 20000 });
      await click(pwaPage, 'play');
      await pwaPage.waitForSelector('[data-mc="world-play"]', { timeout: 10000 });
      await click(pwaPage, 'world-play');
      await pwaPage.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
      await ticks(pwaPage, 6);
      const reloadedOffline = await ev(pwaPage, (blockId) => ({
        name: window.__game.info.name,
        goldPresent: window.__game.world.getBlock(2, 4, 2) === blockId,
      }), GOLD_BLOCK);
      check('hors ligne : un monde se crée, se sauvegarde et se recharge intégralement sans réseau',
        placedOffline && reloadedOffline.name === 'MondeHorsLigne' && reloadedOffline.goldPresent,
        JSON.stringify(reloadedOffline));

      await pwaPage.setOfflineMode(false);
      await pwaPage.setCacheEnabled(true);
      await pwaPage.close();
    } finally {
      previewProc.kill();
    }
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));

  await browser.close();
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
})();
