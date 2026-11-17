// Batterie sur un monde normal (graine 1337, survie) puis un monde créatif, gestion des mondes, page legacy (LEGACY=1).
const { sleep, launch, openPage, click, createWorld, shot, ticks, state, URL, S } = require('./lib.cjs');
const { results, check, install, ev, chat, rclick, lclick, pos, section } = require('./h.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

// cherche près du joueur un carré 3×3 plat, à ciel ouvert, et s'y téléporte
const openSpot = (page) => ev(page, async () => {
  const B = await import('/src/world/Blocks.ts');
  const g = window.__game, w = g.world, p = g.player;
  const top = (x, z) => { for (let y = 120; y > 1; y--) if (w.getBlock(x, y, z) !== 0) return y; return 0; };
  const x0 = Math.floor(p.x), z0 = Math.floor(p.z);
  for (let r = 0; r < 70; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const x = x0 + dx, z = z0 + dz;
    if (!w.isLoaded(x - 1, z - 1) || !w.isLoaded(x + 1, z + 1)) continue;
    const y = top(x, z);
    let ok = true;
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) { const id = w.getBlock(x + a, y, z + b); ok = top(x + a, z + b) === y && B.BLOCKS[id].opaque && !B.isLeaves(id) && !B.isLog(id); }
    if (!ok) continue;
    p.teleport(x + 0.5, y + 1, z + 0.5);
    return { x, y: y + 1, z };
  }
  return null;
});
const dbg = (page) => ev(page, () => { const d = window.__game.debugLines(); return d.left.concat(d.right).join(' | '); });

(async () => {
  const errors = [];
  const browser = await launch();
  const page = await openPage(browser, errors);

  await section('options depuis le menu principal', async () => {
    await click(page, 'options');
    await page.waitForSelector('[data-mc="options"]', { timeout: 5000 });
    await sleep(300);
    await click(page, 'controls'); await sleep(300);
    const ctl = await page.evaluate(() => document.querySelector('#ui').innerText.includes('Sauter'));
    check('options : écran des contrôles', ctl);
    const azertyFwd = await page.evaluate(() => document.querySelector('[data-mc="bind-forward"]')?.textContent?.trim());
    await click(page, 'keyboardLayout'); await sleep(150);
    const qwertyFwd = await page.evaluate(() => document.querySelector('[data-mc="bind-forward"]')?.textContent?.trim());
    check('contrôles : bascule AZERTY / QWERTY (Z ↔ W)', azertyFwd === 'Z' && qwertyFwd === 'W', `${azertyFwd} → ${qwertyFwd}`);
    await click(page, 'keyboardLayout'); await sleep(150);
    // remappage d'une touche et détection de conflit
    await click(page, 'bind-inventory'); await sleep(100);
    await page.keyboard.press('Digit1'); await sleep(150);
    const conflictReserved = await page.evaluate(() => document.querySelector('[data-mc="bind-inventory"]')?.classList.contains('mc-conflict') ?? false);
    check('contrôles : touche réservée (1) signalée en rouge', conflictReserved);
    await click(page, 'bind-inventory'); await sleep(100);
    await page.keyboard.press('KeyW'); await sleep(150);
    const conflictDup = await page.evaluate(() => {
      const a = document.querySelector('[data-mc="bind-inventory"]')?.classList.contains('mc-conflict');
      const b = document.querySelector('[data-mc="bind-forward"]')?.classList.contains('mc-conflict');
      return !!(a && b);
    });
    check('contrôles : doublon de touche signalé en rouge sur les deux boutons', conflictDup);
    await click(page, 'bind-inventory'); await sleep(100);
    await page.keyboard.press('KeyI'); await sleep(150);
    const rebound = await page.evaluate(() => {
      const btn = document.querySelector('[data-mc="bind-inventory"]');
      return { text: btn?.textContent?.trim(), conflict: btn?.classList.contains('mc-conflict') };
    });
    check('contrôles : remappage d\'une touche (Inventaire → I)', rebound.text === 'I' && !rebound.conflict, JSON.stringify(rebound));
    await shot(page, '40-controles');
    await click(page, 'done'); await sleep(300);
    check('contrôles → retour aux options', await page.evaluate(() => document.querySelector('#ui').innerText.includes('Champ de vision')));
    await click(page, 'done'); await sleep(400);
    const marks = await page.evaluate(() => Array.from(document.querySelectorAll('#ui [data-mc]')).map((e) => e.dataset.mc));
    check('options → retour au menu principal', !marks.includes('controls') && marks.includes('play'), JSON.stringify(marks));
  });

  const t0 = Date.now();
  await createWorld(page, { name: 'Normal 1337', seed: '1337' });
  console.log('monde 1337 prêt en', Date.now() - t0, 'ms');
  await install(page);
  await ticks(page, 20);
  let s = await state(page);
  console.log('état initial', JSON.stringify(s));

  await section('remappage effectif en jeu et commande /', async () => {
    await page.keyboard.press('KeyE'); await sleep(200);
    check('en jeu : E n\'ouvre plus l\'inventaire après remappage sur I', (await page.$('[data-mc="menu-inventory"]')) === null && (await state(page)).modal === false);
    await page.keyboard.press('KeyI'); await sleep(200);
    check('en jeu : I ouvre l\'inventaire', (await page.$('[data-mc="menu-inventory"]')) !== null && (await state(page)).modal === true);
    await page.keyboard.press('KeyI'); await sleep(200);
    check('en jeu : I referme l\'inventaire', (await page.$('[data-mc="menu-inventory"]')) === null && (await state(page)).modal === false);
    // test du caractère '/' quelle que soit la touche physique (ex. Maj + ':' sur Mac AZERTY)
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Period', shiftKey: true, bubbles: true, cancelable: true }));
    });
    await sleep(200);
    const slashOpen = await page.evaluate(() => {
      const inp = document.querySelector('[data-mc="chat"] input');
      return inp ? inp.value : null;
    });
    check('en jeu : le caractère "/" ouvre la commande même sur une autre touche physique', slashOpen === '/', JSON.stringify(slashOpen));
    await page.keyboard.press('Escape'); await sleep(200);
    // remet les touches par défaut via le menu pause → options → contrôles → réinitialiser
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await click(page, 'options');
    await page.waitForSelector('[data-mc="options"]', { timeout: 5000 });
    await click(page, 'controls'); await sleep(200);
    await click(page, 'reset-keys'); await sleep(150);
    const resetVal = await page.evaluate(() => document.querySelector('[data-mc="bind-inventory"]')?.textContent?.trim());
    check('contrôles : réinitialisation des touches (Inventaire → E)', resetVal === 'E', resetVal);
    await click(page, 'done'); await sleep(200);
    await click(page, 'done'); await sleep(200);
    await click(page, 'resume'); await sleep(200);
  });

  await section('apparition', async () => {
    const g = await ev(page, async () => { const B = await import('/src/world/Blocks.ts'); const p = window.__game.player; const id = T.block(Math.floor(p.x), Math.floor(p.y - 0.01), Math.floor(p.z)); return { id, name: B.BLOCKS[id].name, leaves: B.isLeaves(id), log: B.isLog(id), ground: p.onGround, y: p.y }; });
    check('apparition sur un vrai sol (pas une cime d\'arbre)', g.ground && !g.leaves && !g.log, JSON.stringify(g));
    await page.keyboard.press('F3'); await sleep(800);
    const d = await dbg(page);
    console.log('  F3 :', d.slice(0, 420));
    const tri = /(\d+) triangles/.exec(d);
    check('F3 : compteur de triangles du monde', tri && Number(tri[1]) > 5000, tri ? tri[0] : 'absent');
    await page.keyboard.press('F3');
  });

  await section('verrou de pointeur et regard à la souris', async () => {
    await page.mouse.click(640, 300);
    await sleep(400);
    const locked = await page.evaluate(() => document.pointerLockElement === document.getElementById('game'));
    check('un clic sur le jeu capture la souris', locked);
    const y0 = await ev(page, () => window.__game.player.yaw);
    await page.mouse.move(740, 300, { steps: 5 });
    await sleep(200);
    const y1 = await ev(page, () => window.__game.player.yaw);
    check('la souris tourne la caméra', Math.abs(y1 - y0) > 0.05, `yaw ${y0.toFixed(3)} → ${y1.toFixed(3)}`);
  });

  await section('abattre un arbre à la main', async () => {
    // un tronc dont une case voisine, au niveau du pied, est libre
    const t = await ev(page, async () => { const B = await import('/src/world/Blocks.ts'); const g = window.__game, w = g.world, p = g.player; for (let r = 1; r < 48; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz; if (!w.isLoaded(x, z)) continue; for (let y = 60; y < 100; y++) { const id = w.getBlock(x, y, z); if (!B.isLog(id) || B.isLog(w.getBlock(x, y - 1, z))) continue; for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + ax, Z = z + az; if (B.BLOCKS[w.getBlock(X, y - 1, Z)].opaque && w.getBlock(X, y, Z) === 0 && w.getBlock(X, y + 1, Z) === 0) return { x, y, z, id, sx: X, sz: Z }; } } } return null; });
    check('un tronc accessible à proximité', !!t, JSON.stringify(t));
    if (!t) return;
    await ev(page, (t) => { window.__game.player.teleport(t.sx + 0.5, t.y, t.sz + 0.5); }, t);
    await ticks(page, 10);
    await ev(page, (t) => T.aim(t.x + 0.5, t.y + 0.5, t.z + 0.5), t);
    await ticks(page, 2);
    const h = await ev(page, () => T.hit());
    check('le tronc est visé', h && h.x === t.x && h.z === t.z && h.id === t.id, JSON.stringify(h));
    if (!h) return;
    await shot(page, '44-arbre');
    const t1 = Date.now();
    await ev(page, () => { window.__game.input.buttons[0] = true; });
    await sleep(1500);
    await shot(page, '45-minage-fissures');
    await page.waitForFunction((l) => T.block(l.x, l.y, l.z) === 0, { timeout: 20000 }, h);
    await ev(page, () => { window.__game.input.buttons[0] = false; });
    const ms = Date.now() - t1;
    check('tronc cassé à la main en ≈ 3 s', ms > 2400 && ms < 4500, `${ms} ms`);
    await page.waitForFunction(() => T.inv().includes('_log'), { timeout: 5000 }).catch(() => undefined);
    check('bûche ramassée', (await ev(page, () => T.inv())).includes('_log'), await ev(page, () => T.inv()));
  });

  let spot = null;
  await section('faim et nourriture', async () => {
    spot = await openSpot(page);
    check('un terrain plat et dégagé à proximité', !!spot, JSON.stringify(spot));
    await ticks(page, 10);
    await chat(page, '/give bread 3');
    await ev(page, () => { const p = window.__game.player; p.health = 20; p.hunger = 10; T.select('bread'); T.look(0, 0.6); window.__game.input.buttons[2] = true; });
    await ticks(page, 12);
    check('manger : animation en cours', await ev(page, () => window.__game.player.useKind === 'eat'));
    await shot(page, '46-manger');
    await page.waitForFunction(() => T.count('bread') === 2, { timeout: 5000 }).catch(() => undefined);
    await ev(page, () => { window.__game.input.buttons[2] = false; });
    const r = await ev(page, () => ({ hunger: window.__game.player.hunger, bread: T.count('bread') }));
    check('le pain rend 5 points de faim', r.hunger === 15 && r.bread === 2, JSON.stringify(r));
    // reproduction en monde normal malgré >= 60 animaux chargés au total (> ANIMAL_CAP global) : plafond local par rayon (32 blocs, max 24)
    if (spot) {
      await chat(page, '/give wheat 4');
      const breedNormal = await ev(page, async (s) => {
        const M = await import('/src/entity/Mobs.ts');
        const g = window.__game;
        const w = g.world;
        T.select('wheat');
        const isAnimal = (e) => e.kind === 'mob' && ['pig', 'cow', 'sheep', 'chicken'].includes(e.mobKind) && !e.dead;
        const farX = s.x + 40;
        const farZ = s.z;
        const farY = Math.max(2, w.heightAt(farX, farZ));
        const spawned = [];
        while (g.entities.filter(isAnimal).length < 62) {
          const m = M.createMob('pig', g.rng);
          m.setPosition(farX + 0.5, farY, farZ + 0.5);
          g.spawn(m);
          spawned.push(m);
        }
        const totalBefore = g.entities.filter(isAnimal).length;
        const c1 = M.createMob('cow', g.rng);
        const c2 = M.createMob('cow', g.rng);
        c1.setPosition(s.x + 0.5, s.y, s.z + 0.5);
        c2.setPosition(s.x + 1.0, s.y, s.z + 0.5);
        g.spawn(c1);
        g.spawn(c2);
        spawned.push(c1, c2);
        const fed1 = c1.interact(g, g.player);
        const fed2 = c2.interact(g, g.player);
        for (let i = 0; i < 40; i++) g.tick();
        const calves1 = g.entities.filter((e) => e.kind === 'mob' && e.mobKind === 'cow' && !e.dead && e.baby);
        // Contrôle inverse : avec 24 animaux dans le rayon de 32 blocs, aucun nouveau petit ne naît
        const inRadius = () => g.entities.filter((e) => isAnimal(e) && Math.hypot(e.x - (s.x + 0.5), e.z - (s.z + 0.5)) <= M.ANIMAL_RADIUS).length;
        while (inRadius() < M.ANIMAL_CAP) {
          const m = M.createMob('sheep', g.rng);
          m.setPosition(s.x + 0.5, s.y, s.z + 0.5);
          g.spawn(m);
          spawned.push(m);
        }
        const localAtCap = inRadius();
        const c3 = M.createMob('cow', g.rng);
        const c4 = M.createMob('cow', g.rng);
        c3.setPosition(s.x + 0.5, s.y, s.z + 0.5);
        c4.setPosition(s.x + 1.0, s.y, s.z + 0.5);
        g.spawn(c3);
        g.spawn(c4);
        spawned.push(c3, c4);
        const fed3 = c3.interact(g, g.player);
        const fed4 = c4.interact(g, g.player);
        for (let i = 0; i < 40; i++) g.tick();
        const calves2 = g.entities.filter((e) => e.kind === 'mob' && e.mobKind === 'cow' && !e.dead && e.baby);
        const bredBlocked = c3.breedCooldown > 0 && c4.breedCooldown > 0;
        for (const m of spawned) m.dead = true;
        for (const m of calves2) m.dead = true;
        g.tick();
        return { totalBefore, fed1, fed2, calves1: calves1.length, localAtCap, fed3, fed4, calves2: calves2.length, bredBlocked };
      }, spot);
      check('monde normal : deux vaches nourries donnent un veau malgré >= 60 animaux chargés au loin',
        breedNormal.totalBefore >= 62 && breedNormal.fed1 && breedNormal.fed2 && breedNormal.calves1 === 1,
        JSON.stringify(breedNormal));
      check('plafond local : avec 24 animaux dans le rayon (32 blocs), aucun petit ne naît',
        breedNormal.localAtCap >= 24 && breedNormal.fed3 && breedNormal.fed4 && breedNormal.bredBlocked && breedNormal.calves2 === 1,
        JSON.stringify(breedNormal));
    }
  });

  await section('chute', async () => {
    // paisible : un monstre qui frappe pendant la chute rend le joueur invulnérable 10 ticks et fausse la mesure
    await chat(page, '/difficulty peaceful');
    await ticks(page, 12);
    // on repart du terrain dégagé : les animaux du test précédent ont pu pousser le joueur sous un arbre,
    // et il retomberait alors sur le feuillage, de moins haut
    const fall = await ev(page, (s) => {
      const p = window.__game.player;
      const from = s ? { x: s.x + 0.5, y: s.y, z: s.z + 0.5 } : { x: p.x, y: p.y, z: p.z };
      const drift = Math.hypot(p.x - from.x, p.z - from.z);
      p.health = 20; p.invulnerable = 0;
      p.teleport(from.x, from.y + 12, from.z);
      return { drift: +drift.toFixed(2), ground: from.y };
    }, spot);
    await ticks(page, 3);
    check('le joueur tombe', await ev(page, () => !window.__game.player.onGround));
    await page.waitForFunction(() => window.__game.player.onGround, { timeout: 10000 });
    await ticks(page, 2);
    const h = (await state(page)).health;
    const landed = await ev(page, () => +window.__game.player.y.toFixed(2));
    check('dégâts de chute de 12 blocs (8 à 9 points)', h >= 11 && h <= 12 && Math.abs(landed - fall.ground) < 0.01,
      `santé ${h}, atterrissage en y=${landed} (sol ${fall.ground}), le joueur avait dérivé de ${fall.drift} bloc(s)`);
    await ev(page, () => { window.__game.player.health = 20; });
    await ticks(page, 12);
  });

  await section('arc et flèches', async () => {
    await chat(page, '/give bow'); await chat(page, '/give arrow 8');
    await ev(page, () => { T.select('bow'); T.look(0, 0.3); window.__game.input.buttons[2] = true; });
    await ticks(page, 25);
    await shot(page, '47-arc');
    await ev(page, () => { window.__game.input.buttons[2] = false; });
    await ticks(page, 3);
    const k = await ev(page, () => T.kinds());
    check('l\'arc tire une flèche', (k.arrow || 0) >= 1 && (await ev(page, () => T.count('arrow'))) === 7, JSON.stringify(k));
  });

  await section('torche et porte', async () => {
    if (!spot) return;
    try {
      await ev(page, (s) => { window.__game.difficulty = 0; window.__game.player.teleport(s.x + 0.5, s.y, s.z + 0.5); }, spot);
    await chat(page, '/time set midnight');
    await chat(page, '/give torch 8'); await chat(page, '/give oak_door 2');
    await ticks(page, 20);
    const before = await ev(page, (s) => window.__game.world.getBlockLight(s.x, s.y, s.z - 1), spot);
    await ev(page, (s) => { T.select('torch'); T.aim(s.x + 0.5, s.y, s.z - 0.5); }, spot);
    await ticks(page, 2); await rclick(page);
    check('torche posée', await ev(page, (s) => T.block(s.x, s.y, s.z - 1) === T.id('torch'), spot), JSON.stringify(await ev(page, () => T.hit())));
    await ticks(page, 10);
    const li = await ev(page, (s) => { const w = window.__game.world; return [w.getBlockLight(s.x, s.y, s.z - 1), w.getBlockLight(s.x, s.y, s.z + 1), w.getBlockLight(s.x + 5, s.y + 1, s.z - 1)]; }, spot);
    check('la torche éclaire : 14 sur place, 12 à deux blocs, 8 à six', before === 0 && li[0] === 14 && li[1] === 12 && li[2] === 8, `avant ${before}, après ${JSON.stringify(li)}`);
    await shot(page, '48-torche-nuit');
    // éclairage adouci : basculer smoothLighting remaille les chunks avec éclairage plat par face (sans dégradé ni AO aux coins)
    const countSmoothQuads = (s) => ev(page, (s) => {
      const g = window.__game;
      const cx = s.x >> 4, cz = s.z >> 4;
      const mesh = g.chunkRenderer.group.children.find((m) => m.renderOrder === 0 && m.position.x === cx * 16 && m.position.z === cz * 16);
      if (!mesh) return -1;
      const col = mesh.geometry.getAttribute('tint').array;
      const lit = mesh.geometry.getAttribute('light').array;
      let graded = 0;
      for (let o = 0; o < lit.length; o += 16) {
        const sameShade = col[o + 3] === col[o + 7] && col[o + 3] === col[o + 11] && col[o + 3] === col[o + 15];
        const sameBlockLight = lit[o + 1] === lit[o + 5] && lit[o + 1] === lit[o + 9] && lit[o + 1] === lit[o + 13];
        if (!sameShade || !sameBlockLight) graded++;
      }
      return graded;
    }, s);
    const gradedSmooth = await countSmoothQuads(spot);
    await ev(page, () => { const g = window.__game; g.settings.smoothLighting = false; g.applySettings(); });
    await page.waitForFunction((s) => {
      const c = window.__game.world.getChunk(s.x >> 4, s.z >> 4);
      return c && !c.meshDirty && !c.meshPending;
    }, { timeout: 10000 }, spot);
    const gradedFlat = await countSmoothQuads(spot);
    await ev(page, () => { const g = window.__game; g.settings.smoothLighting = true; g.applySettings(); });
    await page.waitForFunction((s) => {
      const c = window.__game.world.getChunk(s.x >> 4, s.z >> 4);
      return c && !c.meshDirty && !c.meshPending;
    }, { timeout: 10000 }, spot);
    check('éclairage adouci (smoothLighting) : actif lisse les coins, désactivé uniformise les faces', gradedSmooth > 0 && gradedFlat === 0, `lissé=${gradedSmooth} quads dégradés, plat=${gradedFlat}`);
    // porte
    await ev(page, (s) => { T.select('oak_door'); T.aim(s.x + 1.5, s.y, s.z + 0.5); }, spot);
    await ticks(page, 2); await rclick(page);
    const door = await ev(page, (s) => { const w = window.__game.world; return [T.block(s.x + 1, s.y, s.z) === T.id('oak_door'), T.block(s.x + 1, s.y + 1, s.z) === T.id('oak_door'), w.getBlockAndMeta(s.x + 1, s.y, s.z) >> 8]; }, spot);
    check('porte posée sur deux blocs', door[0] && door[1], JSON.stringify(door));
    await ev(page, (s) => T.aim(s.x + 1.5, s.y + 1, s.z + 0.5), spot);
    await ticks(page, 8); await rclick(page);
    const m1 = await ev(page, (s) => window.__game.world.getBlockAndMeta(s.x + 1, s.y, s.z) >> 8, spot);
    check('clic droit : la porte s\'ouvre', m1 !== door[2], `méta ${door[2]} → ${m1}`);
    await shot(page, '49-porte-ouverte');
    await page.keyboard.down('KeyD'); await ticks(page, 16); await page.keyboard.up('KeyD');
    const px = (await pos(page)).x;
      console.log('  x après avoir marché vers la porte ouverte :', px.toFixed(2), '(porte en x =', spot.x + 1, ')');
    } finally {
      await ev(page, () => {
        const g = window.__game;
        if (!g.settings.smoothLighting) { g.settings.smoothLighting = true; g.applySettings(); }
      }).catch(() => undefined);
    }
  });

  await section('noyade et vue sous l\'eau', async () => {
    try {
    const find = () => ev(page, () => { const g = window.__game, w = g.world, p = g.player; for (let r = 0; r < 150; r += 3) for (let a = 0; a < 40; a++) { const x = Math.floor(p.x + Math.cos(a / 40 * 6.283) * r), z = Math.floor(p.z + Math.sin(a / 40 * 6.283) * r); if (!w.isLoaded(x, z)) continue; let y = 70; while (y > 40 && w.getBlock(x, y, z) === 0) y--; if (w.getBlock(x, y, z) !== 18) continue; let d = 0; while (w.getBlock(x, y - d, z) === 18) d++; if (d >= 4) return { x, y, z, d }; } return null; });
    let w = await find();
    for (const [dx, dz] of [[220, 0], [0, 220], [-220, 0], [0, -220], [440, 440]]) {
      if (w) break;
      await chat(page, `/tp ${dx} 110 ${dz}`);
      await ev(page, () => { window.__game.player.health = 20; });
      await sleep(2500);
      await page.waitForFunction(() => window.__game.chunks.stats.generating === 0, { timeout: 60000 }).catch(() => undefined);
      w = await find();
    }
    check('de l\'eau profonde trouvée', !!w, JSON.stringify(w));
    if (!w) return;
    await chat(page, '/time set day');
    await ev(page, (w) => { const g = window.__game; g.player.health = 20; g.player.teleport(w.x + 0.5, w.y - 2.5, w.z + 0.5); T.look(0.5, 0.1); }, w);
    await ticks(page, 30);
    await shot(page, '50-sous-l-eau');
    const a = await ev(page, () => ({ air: window.__game.player.air, head: window.__game.headInWater, y: window.__game.player.y }));
    check('sous l\'eau : la réserve d\'air diminue', a.head === true && a.air < 300, JSON.stringify(a));
    await page.keyboard.down('Space'); await ticks(page, 60);
    const b = await ev(page, () => ({ air: window.__game.player.air, head: window.__game.headInWater, y: window.__game.player.y }));
    await shot(page, '51-surface');
    await page.keyboard.up('Space');
      check('Espace fait remonter à la surface, l\'air revient', b.head === false && b.y > a.y && b.air > a.air, JSON.stringify(b));
    } finally {
      await page.keyboard.up('Space').catch(() => undefined);
      await ev(page, () => { window.__game.player.health = 20; }).catch(() => undefined);
    }
  });

  await section('pluie, nuit, orage (captures)', async () => {
    try {
    await chat(page, '/gamemode creative');
    const sp = await ev(page, () => window.__game.spawnPoint);
    await chat(page, `/tp ${sp.x} 96 ${sp.z}`);
    await ev(page, () => { const p = window.__game.player; p.flying = true; T.look(0.8, -0.35); });
    await sleep(1500);
    await page.waitForFunction(() => window.__game.chunks.stats.generating === 0 && window.__game.chunks.stats.meshing === 0, { timeout: 60000 }).catch(() => undefined);
    await chat(page, '/time set day'); await ticks(page, 40);
    await shot(page, '52-paysage-jour');
    console.log('  F3 en vol :', (await dbg(page)).slice(0, 110));
    await chat(page, '/time set 12500'); await ticks(page, 20);
    await shot(page, '53-couchant');
    await chat(page, '/time set midnight'); await ticks(page, 20);
    await shot(page, '54-nuit');
    await chat(page, '/time set day'); await chat(page, '/weather thunder'); await ticks(page, 100);
    await shot(page, '55-orage');
      check('orage actif', await ev(page, () => window.__game.raining && window.__game.thundering));
    } finally {
      await chat(page, '/weather clear').catch(() => undefined);
      await ev(page, () => { window.__game.player.flying = false; }).catch(() => undefined);
    }
  });

  // repère pour la section « export et import » : un bloc posé à la main et l'état du joueur avant de quitter
  let marker = null;
  await section('quitter vers le titre, renommer', async () => {
    marker = await ev(page, async () => {
      const { B, I } = await import('/src/world/Ids.ts');
      const M = await import('/src/entity/Mobs.ts');
      const { makeStack } = await import('/src/world/ItemStack.ts');
      const g = window.__game, p = g.player;
      const m = { x: Math.floor(p.x) + 2, y: Math.min(120, Math.floor(p.y) + 3), z: Math.floor(p.z) };
      g.world.setBlock(m.x, m.y, m.z, B.DIAMOND_BLOCK);
      p.inventory.slots[8] = makeStack(I.DIAMOND_PICKAXE, 1, 2, { fortune: 2 });
      const wolf = M.createMob('wolf', g.rng);
      wolf.tamed = true;
      wolf.owner = 'player';
      wolf.sitting = true;
      wolf.maxHealth = 20;
      wolf.health = 20;
      wolf.setPosition(p.x + 1, p.y, p.z);
      g.spawn(wolf);
      return { ...m, id: B.DIAMOND_BLOCK, px: p.x, py: p.y, pz: p.z, inv: T.inv() };
    });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await sleep(200);
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await sleep(300);
    await click(page, 'play');
    await page.waitForSelector('[data-mc="world-rename"]', { timeout: 10000 });
    await sleep(400);
    await click(page, 'world-rename');
    await page.waitForSelector('[data-mc="confirm"]', { timeout: 5000 });
    await page.evaluate(() => { const i = document.querySelector('#ui input'); i.value = 'Monde renommé'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await click(page, 'confirm');
    await sleep(600);
    const names = await page.evaluate(() => Array.from(document.querySelectorAll('.mc-world-name')).map((e) => e.textContent));
    check('renommer un monde', names.includes('Monde renommé'), JSON.stringify(names));
    await shot(page, '56-liste');
    await click(page, 'back'); await sleep(300);
  });

  await section('export et import d\'un monde', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherworld-'));
    const names = () => page.evaluate(() => Array.from(document.querySelectorAll('.mc-world-name')).map((e) => e.textContent));
    const selected = () => page.evaluate(() => document.querySelector('.mc-world.mc-sel .mc-world-name')?.textContent || '');
    const error = () => page.evaluate(() => document.querySelector('#ui .mc-error')?.textContent || '');
    const upload = async (file) => { const input = await page.$('[data-mc="world-file"]'); await input.uploadFile(file); };
    const refused = async (file) => {
      await upload(file);
      await page.waitForFunction(() => (document.querySelector('#ui .mc-error')?.textContent || '') !== '', { timeout: 10000 });
      await sleep(300);
      return { error: await error(), names: await names() };
    };
    try {
      // vrai téléchargement : le navigateur écrit le fichier dans un dossier temporaire
      const client = await browser.target().createCDPSession();
      await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
      await click(page, 'play');
      await page.waitForSelector('[data-mc="world-export"]:not([disabled])', { timeout: 10000 });
      await sleep(300);
      await click(page, 'world-export');
      const file = path.join(dir, 'Monde-renomme.aetherworld');
      let size = -1;
      for (let i = 0; i < 100; i++) {
        await sleep(200);
        const now = fs.existsSync(file) ? fs.statSync(file).size : -1;
        if (now > 0 && now === size) break;
        size = now;
      }
      const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
      check('export : le navigateur télécharge un fichier .aetherworld', bytes.length > 1000 && bytes.subarray(0, 8).toString('latin1') === 'AEBWORLD',
        `${JSON.stringify(fs.readdirSync(dir))} ${bytes.length} octets, erreur « ${await error()} »`);
      await shot(page, '56b-export');

      // fichiers refusés : rien ne doit être créé
      const cut = path.join(dir, 'tronque.aetherworld');
      fs.writeFileSync(cut, bytes.subarray(0, Math.floor(bytes.length / 2)));
      const r1 = await refused(cut);
      check('import : un fichier tronqué est refusé, sans créer de monde', /fichier incomplet/.test(r1.error) && r1.names.length === 1, JSON.stringify(r1));
      const foreign = path.join(dir, 'autre.aetherworld');
      fs.writeFileSync(foreign, 'Ceci est un simple fichier texte, pas un monde.');
      const r2 = await refused(foreign);
      check('import : un fichier étranger est refusé, sans créer de monde', /pas un monde AetherBricks/.test(r2.error) && r2.names.length === 1, JSON.stringify(r2));
      const damaged = path.join(dir, 'abime.aetherworld');
      const copy = Buffer.from(bytes);
      for (let i = Math.floor(copy.length / 2); i < Math.floor(copy.length / 2) + 4096 && i < copy.length; i++) copy[i] = 0xff;
      fs.writeFileSync(damaged, copy);
      const r3 = await refused(damaged);
      check('import : un fichier abîmé est refusé, sans créer de monde', /fichier (abîmé|incomplet)/.test(r3.error) && r3.names.length === 1, JSON.stringify(r3));
      await shot(page, '56c-import-refuse');

      // import du vrai fichier : un nouveau monde, l'original reste
      await upload(file);
      await page.waitForFunction(() => document.querySelectorAll('.mc-world-name').length === 2, { timeout: 30000 });
      await sleep(300);
      const after = await names();
      check('import : le monde arrive comme nouveau monde, sélectionné, sans toucher à l\'original',
        after.slice().sort().join('|') === 'Monde renommé|Monde renommé (2)' && (await selected()) === 'Monde renommé (2)' && (await error()) === '',
        `${JSON.stringify(after)}, sélection « ${await selected()} », erreur « ${await error()} »`);
      await shot(page, '56d-import');

      // comparaison octet pour octet de ce qui est enregistré
      const fileVer = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
      check('export : format .aetherworld en version 2', fileVer === 2, `version=${fileVer}`);
      const cmp = await page.evaluate(async () => {
        const { Storage } = await import('/src/world/Storage.ts');
        const s = await Storage.open();
        const worlds = await s.listWorlds();
        const a = worlds.find((w) => w.name === 'Monde renommé'), b = worlds.find((w) => w.name === 'Monde renommé (2)');
        if (!a || !b) return { ok: false, why: 'mondes introuvables' };
        const ka = Array.from(await s.chunkKeys(a.id)).sort((x, y) => x - y), kb = Array.from(await s.chunkKeys(b.id)).sort((x, y) => x - y);
        if (ka.join() !== kb.join()) return { ok: false, why: `clés ${ka.length} / ${kb.length}` };
        const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
        let diff = 0;
        for (const k of ka) {
          const ca = await s.loadChunk(a.id, k), cb = await s.loadChunk(b.id, k);
          if (!ca || !cb || !same(ca.blocks, cb.blocks) || !same(ca.meta, cb.meta) || !same(ca.biomes, cb.biomes) || !same(ca.tints, cb.tints)
            || JSON.stringify(ca.blockEntities) !== JSON.stringify(cb.blockEntities) || JSON.stringify(ca.entities) !== JSON.stringify(cb.entities)) diff++;
        }
        const info = a.id !== b.id && a.seed === b.seed && a.worldType === b.worldType && a.gameMode === b.gameMode
          && a.createdAt === b.createdAt && JSON.stringify(a.state) === JSON.stringify(b.state) && a.thumbnail === b.thumbnail;
        return { ok: diff === 0 && info && ka.length > 0, chunks: ka.length, diff, info, persistent: s.persistent };
      });
      check('import : chunks, entités et état identiques à l\'original, octet pour octet', cmp.ok && cmp.persistent, JSON.stringify(cmp));

      // le monde importé se joue : on y retrouve ce qu'on avait laissé
      await click(page, 'world-play');
      await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
      await install(page);
      await ticks(page, 5);
      const got = await ev(page, (m) => { const p = window.__game.player; return { id: T.block(m.x, m.y, m.z), d: Math.hypot(p.x - m.px, p.y - m.py, p.z - m.pz), inv: T.inv(), ench: p.inventory.slots[8]?.enchants ?? null, seed: window.__game.world.seed, wolfOk: T.mobs('wolf').some((w) => w.tamed && w.owner === 'player' && w.sitting && w.health === 20) }; }, marker);
      check('import : le monde importé se joue (bloc posé, position, inventaire, enchantement et loup apprivoisé retrouvés)',
        got.id === marker.id && got.d < 1.5 && got.inv === marker.inv && got.ench?.fortune === 2 && got.seed === 1337 && got.wolfOk, `${JSON.stringify(got)} attendu ${JSON.stringify(marker)}`);
      await shot(page, '56e-monde-importe');

      // on retire le monde importé : l'original doit rester seul
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
      await sleep(200);
      await click(page, 'quit');
      await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
      await sleep(300);
      await click(page, 'play');
      await page.waitForSelector('[data-mc="world-delete"]:not([disabled])', { timeout: 10000 });
      await sleep(400);
      const sel = await selected();
      if (sel === 'Monde renommé (2)') {
        await click(page, 'world-delete');
        await page.waitForSelector('[data-mc="confirm"]', { timeout: 5000 });
        await sleep(200);
        await click(page, 'confirm');
        await sleep(800);
      }
      const left = await names();
      check('import : supprimer le monde importé laisse l\'original', sel === 'Monde renommé (2)' && left.join('|') === 'Monde renommé', `sélection « ${sel} », reste ${JSON.stringify(left)}`);

      // Compatibilité avec une archive .aetherworld v1 créée avant l'ajout du Nether
      const v1Path = path.resolve(__dirname, 'fixtures/overworld-v1.aetherworld');
      if (fs.existsSync(v1Path)) {
        await upload(v1Path);
        await page.waitForFunction(() => document.querySelectorAll('.mc-world-name').length >= 2, { timeout: 30000 });
        await sleep(300);
        await click(page, 'world-play');
        await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
        await install(page);
        await ticks(page, 10);
        const v1Res = await ev(page, async () => {
          const { B, I } = await import('/src/world/Ids.ts');
          const g = window.__game, p = g.player;
          return {
            dim: g.dimension,
            cobble: g.world.getBlock(25, 4, 25) === B.COBBLESTONE,
            posOk: Math.hypot(p.x - 23.5, p.z - 25.5) < 0.5,
            pickOk: p.inventory.slots[0]?.id === I.DIAMOND_PICKAXE && p.inventory.slots[0]?.enchants?.efficiency === 3,
          };
        });
        check('import : archive .aetherworld v1 antérieure au Nether se charge sans perte',
          v1Res.dim === 'overworld' && v1Res.cobble && v1Res.posOk && v1Res.pickOk,
          JSON.stringify(v1Res));
        await page.keyboard.press('Escape');
        await page.waitForSelector('[data-mc="quit"]', { timeout: 5000 });
        await click(page, 'quit');
        await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
        await click(page, 'play');
        await page.waitForSelector('[data-mc="world-delete"]:not([disabled])', { timeout: 10000 });
        await sleep(300);
        await click(page, 'world-delete');
        await page.waitForSelector('[data-mc="confirm"]', { timeout: 5000 });
        await click(page, 'confirm');
        await sleep(500);
      }

      await click(page, 'back'); await sleep(300);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await createWorld(page, { name: 'Créatif', seed: 'aether', creative: true });
  await install(page);
  await ticks(page, 20);
  await section('mode créatif', async () => {
    s = await state(page);
    check('monde créatif chargé', await ev(page, () => window.__game.player.gameMode === 'creative'), `pos ${s.pos}`);
    await shot(page, '57-creatif');
    await page.keyboard.press('KeyE');
    await page.waitForSelector('[data-mc="menu-creative"]', { timeout: 5000 });
    await sleep(400);
    await shot(page, '58-inventaire-creatif');
    const cell = await page.evaluate(() => { const e = document.querySelector('[data-mc="menu-creative"] [data-p]'); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(cell[0], cell[1]); await sleep(150);
    const cur = await ev(page, () => { const c = window.__game.player.inventory.cursor; return c ? c.count : 0; });
    check('palette créative : clic → objet sur le curseur', cur >= 1, `curseur ${cur}`);
    const hb = await page.evaluate(() => { const e = document.querySelector('[data-mc="menu-creative"] [data-group="hotbar"]'); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(hb[0], hb[1]); await sleep(150);
    check('objet déposé dans la barre', await ev(page, () => !!window.__game.player.inventory.slots[0]), await ev(page, () => T.inv()));
    await page.keyboard.press('Escape'); await sleep(300);

    // vol : double appui très bref sur Espace
    await page.keyboard.press('Space'); await sleep(100); await page.keyboard.press('Space');
    await ticks(page, 4);
    check('double appui bref sur Espace : vol', await ev(page, () => window.__game.player.flying === true));
    const a = await pos(page);
    await page.keyboard.down('Space'); await ticks(page, 20); await page.keyboard.up('Space');
    const b = await pos(page);
    check('Espace en vol : monte', b.y - a.y > 3, `Δy ${(b.y - a.y).toFixed(2)}`);
    await ticks(page, 20);
    const c = await pos(page);
    check('en vol, pas de chute', Math.abs(c.y - b.y) < 1.2, `Δy ${(c.y - b.y).toFixed(2)}`);
    await page.keyboard.down('ShiftLeft');
    await page.waitForFunction(() => window.__game.player.onGround, { timeout: 15000 });
    await page.keyboard.up('ShiftLeft');
    await ticks(page, 3);
    check('Maj en vol : descend, le vol s\'arrête au sol', await ev(page, () => window.__game.player.flying === false));
    // double appui « humain » (touche tenue 80 ms)
    await ticks(page, 10);
    await page.keyboard.down('Space'); await sleep(80); await page.keyboard.up('Space'); await sleep(120);
    await page.keyboard.down('Space'); await sleep(80); await page.keyboard.up('Space');
    await ticks(page, 4);
    check('double appui normal sur Espace : vol', await ev(page, () => window.__game.player.flying === true));
    await ev(page, () => { window.__game.player.flying = false; });
    await page.waitForFunction(() => window.__game.player.onGround, { timeout: 15000 });

    // casse instantanée au clic bref
    await ev(page, () => T.look(0, -Math.PI / 2)); await ticks(page, 8);
    const h1 = await ev(page, () => T.hit());
    await lclick(page);
    const g1 = await ev(page, (h) => T.block(h.x, h.y, h.z), h1);
    await ticks(page, 8);
    const h2 = await ev(page, () => T.hit());
    await lclick(page);
    const g2 = await ev(page, (h) => T.block(h.x, h.y, h.z), h2);
    check('créatif : un clic bref casse le bloc visé, sans butin', g1 === 0 && g2 === 0 && !((await ev(page, () => T.kinds())).item), `${JSON.stringify(h1)} → ${g1} ; ${JSON.stringify(h2)} → ${g2}`);
    // chute sans dégâts
    await ev(page, () => { const p = window.__game.player; p.teleport(p.x + 3, p.y + 20, p.z); });
    await ticks(page, 3);
    await page.waitForFunction(() => window.__game.player.onGround, { timeout: 15000 });
    await ticks(page, 2);
    check('créatif : pas de dégâts de chute', (await state(page)).health === 20);
  });

  await section('supprimer un monde', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await sleep(200);
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await sleep(300);
    await click(page, 'play');
    await page.waitForSelector('[data-mc="world-delete"]', { timeout: 10000 });
    await sleep(400);
    const before = await page.evaluate(() => Array.from(document.querySelectorAll('.mc-world-name')).map((e) => e.textContent));
    await click(page, 'world-delete');
    await page.waitForSelector('[data-mc="confirm"]', { timeout: 5000 });
    await sleep(200);
    await shot(page, '59-supprimer');
    await click(page, 'confirm');
    await sleep(800);
    const after = await page.evaluate(() => Array.from(document.querySelectorAll('.mc-world-name')).map((e) => e.textContent));
    check('supprimer un monde', before.length === 2 && after.length === 1, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  });

  if (process.env.LEGACY === '1') await section('ancienne version (legacy.html)', async () => {
    const errs = [];
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 1280, height: 720 });
    p2.on('pageerror', (e) => errs.push(e.message));
    await p2.goto(URL + 'legacy.html', { waitUntil: 'networkidle0' });
    await sleep(2500);
    await p2.screenshot({ path: S + '/shots/game/60-legacy.png' });
    const info = await p2.evaluate(() => ({ title: document.title, canvases: document.querySelectorAll('canvas').length }));
    check('legacy.html se charge sans erreur', errs.length === 0 && info.canvases >= 1, JSON.stringify(info) + ' ' + errs.join(' | '));
    await p2.close();
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const bad = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - bad.length}/${results.length} vérifications passées`);
  for (const r of bad) console.log('  ÉCHEC :', r.name, '—', r.detail);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
