// Batterie de comportements sur un monde plat en survie.
const { sleep, launch, openPage, click, createWorld, shot, ticks, state } = require('./lib.cjs');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
}

async function install(page) {
  await page.evaluate(async () => {
    const items = await import('/src/world/Items.ts');
    const g = window.__game;
    const names = new Map();
    for (const it of items.ITEMS) if (it) names.set(it.name, it.id);
    window.__msgs = window.__msgs || [];
    if (!g.ui.__wrapped) {
      const add = g.ui.addMessage.bind(g.ui);
      g.ui.addMessage = (t) => { window.__msgs.push(t); add(t); };
      g.ui.__wrapped = true;
    }
    window.T = {
      id: (n) => { const v = names.get(n); if (v === undefined) throw new Error('objet inconnu ' + n); return v; },
      count: (n) => { const id = T.id(n); return g.player.inventory.slots.reduce((s, x) => s + (x && x.id === id ? x.count : 0), 0); },
      look: (yaw, pitch) => { const p = g.player; p.turn(yaw - p.yaw, pitch - p.headPitch); },
      aim: (x, y, z) => { const p = g.player; const dx = x - p.x, dy = y - (p.y + p.eyeHeight), dz = z - p.z; T.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); },
      select: (n) => { const id = T.id(n); const inv = g.player.inventory; let i = inv.slots.findIndex((x, k) => k < 9 && x && x.id === id); if (i < 0) { const j = inv.slots.findIndex((x) => x && x.id === id); if (j < 0) throw new Error('pas dans l\'inventaire : ' + n); const tmp = inv.slots[0]; inv.slots[0] = inv.slots[j]; inv.slots[j] = tmp; i = 0; } inv.selected = i; },
      block: (x, y, z) => g.world.getBlock(x, y, z),
      hit: () => { const it = g.interaction; return it.hasBlock ? { x: it.hit.x, y: it.hit.y, z: it.hit.z, face: it.hit.face, id: it.hit.id } : null; },
      mobs: (kind) => g.entities.filter((e) => e.kind === 'mob' && e.mobKind === kind && !e.dead),
      kinds: () => g.entities.reduce((m, e) => { const k = e.kind === 'mob' ? e.mobKind : e.kind; m[k] = (m[k] || 0) + 1; return m; }, {}),
      inv: () => g.player.inventory.slots.map((x, i) => (x ? `${i}:${items.ITEMS[x.id].name}x${x.count}` : null)).filter(Boolean).join(' '),
    };
  });
}
const ev = (page, fn, ...a) => page.evaluate(fn, ...a);
const chat = (page, t) => ev(page, (t) => window.__game.chat(t), t);
const rclick = async (page) => { await ev(page, () => { window.__game.input.presses[2]++; }); await ticks(page, 3); };
const lclick = async (page) => { await ev(page, () => { window.__game.input.presses[0]++; }); await ticks(page, 2); };
const pos = (page) => ev(page, () => { const p = window.__game.player; return { x: p.x, y: p.y, z: p.z, g: p.onGround }; });
const section = async (name, fn) => {
  console.log('--- ' + name);
  try { await fn(); } catch (e) { check(name + ' (exception)', false, String(e && e.message || e).slice(0, 300)); }
};
/** Vise le dessus du bloc du sol (x, z) puis clique droit ; renvoie la cellule posée attendue. */
async function useOnGround(page, x, z) {
  await ev(page, (x, z) => T.aim(x + 0.5, 4, z + 0.5), x, z);
  await ticks(page, 2);
  const h = await ev(page, () => T.hit());
  await rclick(page);
  return h;
}

(async () => {
  const errors = [];
  const browser = await launch();
  const page = await openPage(browser, errors);
  const t0 = Date.now();
  await createWorld(page, { name: 'Plat survie', seed: '42', flat: true });
  console.log('monde plat prêt en', Date.now() - t0, 'ms');
  await install(page);
  await ticks(page, 20);
  let s = await state(page);
  console.log('état initial', JSON.stringify(s));
  check('apparition au sol du monde plat', s.onGround && Math.abs(s.pos[1] - 4) < 0.01, `pos ${s.pos}`);
  const initialGoal = await page.evaluate(() => { const e = document.querySelector('[data-mc="guide"]'); return e ? e.textContent : ''; });
  check('progression guidée : objectif initial affiché en survie', initialGoal.includes('bois'), initialGoal);
  await ev(page, () => { window.__game.difficulty = 0; }); // paisible le temps des tests de mouvement
  await shot(page, '10-plat');

  await section('déplacement', async () => {
    await ev(page, () => T.look(0, 0));
    let a = await pos(page);
    await page.keyboard.down('KeyW'); await ticks(page, 20); await page.keyboard.up('KeyW');
    let b = await pos(page);
    const walk = a.z - b.z;
    check('marche avant (W) vers -z', walk > 3 && walk < 5.2 && Math.abs(b.x - a.x) < 0.05, `Δz=${(-walk).toFixed(2)} en 20 ticks`);
    await ticks(page, 10);
    a = await pos(page);
    await page.keyboard.down('ControlLeft'); await page.keyboard.down('KeyW'); await ticks(page, 20); await page.keyboard.up('KeyW'); await page.keyboard.up('ControlLeft');
    b = await pos(page);
    const sprint = a.z - b.z;
    check('sprint (Ctrl+W) plus rapide que la marche', sprint > walk * 1.15, `sprint ${sprint.toFixed(2)} vs marche ${walk.toFixed(2)}`);
    await ticks(page, 10);
    a = await pos(page);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await ticks(page, 20); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
    b = await pos(page);
    check('accroupi (Maj+W) plus lent', a.z - b.z < walk * 0.5 && a.z - b.z > 0.3, `accroupi ${(a.z - b.z).toFixed(2)}`);
    await ticks(page, 10);
    a = await pos(page);
    await page.keyboard.down('KeyD'); await ticks(page, 10); await page.keyboard.up('KeyD');
    b = await pos(page);
    check('pas de côté (D) vers +x', b.x - a.x > 1, `Δx=${(b.x - a.x).toFixed(2)}`);
    await ticks(page, 10);
    await page.keyboard.down('Space');
    let maxY = 0;
    for (let i = 0; i < 12; i++) { await sleep(40); maxY = Math.max(maxY, (await pos(page)).y); }
    await page.keyboard.up('Space');
    check('saut (Espace)', maxY > 5.0 && maxY < 5.4, `y max ${maxY.toFixed(2)}`);
    await ticks(page, 20);
    b = await pos(page);
    check('retombe au sol', b.g && Math.abs(b.y - 4) < 0.01, `y=${b.y.toFixed(2)}`);
  });

  let holeAt = null;
  await section('casser un bloc', async () => {
    await ev(page, () => { const p = window.__game.player; p.teleport(Math.floor(p.x) + 0.5, p.y, Math.floor(p.z) + 0.5); T.look(0, -Math.PI / 2); });
    await ticks(page, 2);
    const h = await ev(page, () => T.hit());
    check('bloc visé sous les pieds', h && h.y === 3, JSON.stringify(h));
    const before = await ev(page, () => T.inv());
    await ev(page, () => { window.__game.input.buttons[0] = true; });
    const t = Date.now();
    await page.waitForFunction((h) => T.block(h.x, h.y, h.z) === 0, { timeout: 15000 }, h);
    await ev(page, () => { window.__game.input.buttons[0] = false; });
    check('bloc cassé en maintenant le clic gauche', true, `en ${Date.now() - t} ms, bloc ${h.id}`);
    holeAt = h;
    await ticks(page, 30);
    const after = await ev(page, () => T.inv());
    check('butin ramassé', after !== before && after.length > 0, `inventaire : ${after}`);
    const p = await pos(page);
    check('le joueur tombe dans le trou', Math.abs(p.y - 3) < 0.01, `y=${p.y.toFixed(2)}`);
    await shot(page, '11-trou');
  });

  await section('poser un bloc', async () => {
    await page.keyboard.down('Space'); await page.keyboard.down('KeyW'); await ticks(page, 12); await page.keyboard.up('Space'); await ticks(page, 10); await page.keyboard.up('KeyW');
    await ticks(page, 10);
    let p = await pos(page);
    check('sort du trou en sautant', Math.abs(p.y - 4) < 0.01, `y=${p.y.toFixed(2)}`);
    await chat(page, '/give cobblestone 64');
    await ev(page, () => T.select('cobblestone'));
    const bx = Math.floor(p.x), bz = Math.floor(p.z) - 3;
    const h = await useOnGround(page, bx, bz);
    const placed = await ev(page, (x, z) => T.block(x, 4, z), bx, bz);
    const cobble = await ev(page, () => T.id('cobblestone'));
    check('bloc posé au clic droit', placed === cobble, `visé ${JSON.stringify(h)}, bloc en (${bx},4,${bz}) = ${placed}`);
    check('la pile diminue', (await ev(page, () => T.count('cobblestone'))) === 63);
    // pose refusée là où se tient le joueur
    p = await pos(page);
    await ev(page, () => T.look(0, -1.5)); await ticks(page, 2); await rclick(page);
    check('pose refusée dans le joueur', (await ev(page, () => T.count('cobblestone'))) === 63);
    await shot(page, '12-pose');
  });

  await section('inventaire et fabrication (souris réelle)', async () => {
    await chat(page, '/give oak_log 4');
    await page.keyboard.press('KeyE');
    await page.waitForSelector('[data-mc="menu-inventory"]', { timeout: 5000 });
    check('E ouvre l\'inventaire', (await state(page)).modal === true);
    await sleep(300);
    await shot(page, '13-inventaire');
    const center = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
    const logSlot = await ev(page, () => { const g = window.__game; const id = T.id('oak_log'); const m = g.ui.menu || g.menu; const inv = g.player.inventory; return inv.slots.findIndex((x) => x && x.id === id); });
    const groups = await page.evaluate(() => Array.from(document.querySelectorAll('[data-mc="menu-inventory"] [data-i]')).map((e) => e.dataset.group + ':' + e.dataset.i).join(' '));
    console.log('  cases :', groups.slice(0, 400), '| bûches en case', logSlot);
    // la case DOM qui contient les bûches : on la cherche par groupe hotbar + rang
    const domIndex = await page.evaluate((logSlot) => {
      const els = Array.from(document.querySelectorAll('[data-mc="menu-inventory"] [data-group="hotbar"]'));
      return els[logSlot] ? els[logSlot].dataset.i : null;
    }, logSlot);
    const cl = async (sel) => { const c = await center(sel); if (!c) throw new Error('case introuvable ' + sel); await page.mouse.click(c[0], c[1]); await sleep(120); };
    await cl(`[data-mc="menu-inventory"] [data-i="${domIndex}"]`);
    const cursor = await ev(page, () => { const c = window.__game.player.inventory.cursor; return c ? c.count : 0; });
    check('clic : la pile passe sur le curseur', cursor === 4, `curseur ${cursor}`);
    const craft0 = await page.evaluate(() => document.querySelector('[data-mc="menu-inventory"] [data-group="craft"]').dataset.i);
    await cl(`[data-mc="menu-inventory"] [data-i="${craft0}"]`);
    const res = await page.evaluate(() => document.querySelector('[data-mc="menu-inventory"] [data-group="result"]').dataset.i);
    await sleep(200);
    await shot(page, '14-fabrication');
    await cl(`[data-mc="menu-inventory"] [data-i="${res}"]`);
    const cur2 = await ev(page, () => { const c = window.__game.player.inventory.cursor; return c ? `${c.id}x${c.count}` : 'vide'; });
    const planks = await ev(page, () => T.id('oak_planks'));
    check('fabrication : 1 bûche → 4 planches', cur2 === `${planks}x4`, `curseur ${cur2}`);
    // repose dans une case vide du sac
    const empty = await page.evaluate(() => { const g = window.__game; const els = Array.from(document.querySelectorAll('[data-mc="menu-inventory"] [data-group="main"]')); const k = g.player.inventory.slots.findIndex((x, i) => i >= 9 && !x); return els[k - 9] ? els[k - 9].dataset.i : els[0].dataset.i; });
    await cl(`[data-mc="menu-inventory"] [data-i="${empty}"]`);
    check('planches rangées dans le sac', (await ev(page, () => T.count('oak_planks'))) === 4, await ev(page, () => T.inv()));
    // test du livre de recettes : ouverture, clic sur l'établi (faisable avec 4 planches), maj-clic sur le résultat
    await cl('[data-mc="recipe-book-toggle"]');
    await sleep(150);
    const rbVisible = await page.evaluate(() => { const e = document.querySelector('[data-mc="recipe-book"]'); return !!e && e.style.display !== 'none'; });
    check('livre de recettes : s\'ouvre au clic', rbVisible);
    await shot(page, '14b-livre-recettes');
    // cherche la cellule du livre de recettes qui fabrique l'établi (crafting_table) ou les bâtons
    await cl('[data-mc="recipe-filter"]');
    await sleep(150);
    const craftableCount = await page.evaluate(() => document.querySelectorAll('[data-mc="recipe-book"] .mc-craftable').length);
    check('livre de recettes : affiche les recettes faisables en avant', craftableCount >= 3, `${craftableCount} recettes faisables`);
    // remet les 3 bûches de la grille dans l'inventaire en fermant puis rouvrant
    await page.keyboard.press('Escape');
    await sleep(300);
    s = await state(page);
    check('Échap ferme l\'inventaire', s.modal === false && (await page.$('[data-mc="menu-inventory"]')) === null);
    check('les bûches restées dans la grille reviennent', (await ev(page, () => T.count('oak_log'))) === 3, await ev(page, () => T.inv()));
    // rouvre l'inventaire et fabrique un établi en 1 clic via le livre de recettes, puis le retire pour laisser l'état propre
    await page.keyboard.press('KeyE');
    await page.waitForSelector('[data-mc="menu-inventory"]', { timeout: 5000 });
    await cl('[data-mc="recipe-book-toggle"]');
    await sleep(150);
    const tableCell = await page.evaluate(() => {
      const tableId = T.id('crafting_table');
      const cells = Array.from(document.querySelectorAll('[data-mc="recipe-book"] [data-r]'));
      for (const c of cells) {
        if (c.style.visibility !== 'hidden' && c.classList.contains('mc-craftable')) {
          return c.dataset.r;
        }
      }
      return null;
    });
    await cl(`[data-mc="recipe-book"] [data-r="${tableCell}"]`);
    const resStack = await ev(page, () => { const g = window.__game; const m = g.menu; const r = m.slots.find((s) => s.group === 'result'); return r && r.stack ? r.stack.id : 0; });
    check('livre de recettes : un clic remplit la grille et produit un résultat', resStack > 0, `résultat id=${resStack}`);
    await page.keyboard.press('Escape');
    await sleep(300);
    await ticks(page, 12);
    const advInfo = await page.evaluate(() => ({
      advs: Array.from(window.__game.player.advancements),
      toastShown: document.querySelector('[data-mc="toast"]')?.classList.contains('mc-shown') ?? false,
      goal: document.querySelector('[data-mc="guide"]')?.textContent ?? '',
      msgs: window.__msgs.filter((m) => m.startsWith('[Progrès]')),
    }));
    const keyText = await ev(page, async () => {
      const A = await import('/src/game/Advancements.ts');
      const g = window.__game;
      const saved = new Set(g.player.advancements);
      const kb = g.settings.keybinds.inventory;
      g.player.advancements.clear();
      g.player.advancements.add('wood');
      const base = g.guideGoal;
      g.settings.keybinds.inventory = 'KeyI';
      const remapped = g.guideGoal;
      g.settings.keybinds.inventory = kb;
      g.player.advancements.clear();
      for (const id of saved) g.player.advancements.add(id);
      const raw = A.ADVANCEMENTS.filter((a) => /\bE\b/.test(a.goal + ' ' + a.detail)).map((a) => a.id);
      return { base, remapped, raw, count: A.ADVANCEMENTS.length };
    });
    check('progrès : les textes d\'aide citent la touche d\'inventaire configurée',
      keyText.base.includes('appuyez sur E ') && keyText.remapped.includes('appuyez sur I ') && keyText.raw.length === 0 && keyText.count === 14,
      JSON.stringify(keyText));
    check('progression guidée : progrès débloqués (bois, planches, pierre) et notification affichée',
      advInfo.advs.includes('wood') && advInfo.advs.includes('planks') && advInfo.advs.includes('cobblestone') && advInfo.toastShown,
      JSON.stringify(advInfo));
    check('progression guidée : une étape avancée valide aussi les étapes précédentes sans notification',
      advInfo.advs.includes('crafting_table') && advInfo.advs.includes('wooden_pickaxe') && advInfo.goal.includes('fourneau') && !advInfo.msgs.some((m) => m.includes('Première pioche')),
      JSON.stringify(advInfo));
    await shot(page, '14c-progres-toast');
  });

  await section('chat et commandes', async () => {
    await page.keyboard.press('KeyT');
    await page.waitForSelector('[data-mc="chat"]', { timeout: 5000 });
    await sleep(200);
    await page.keyboard.type('/time set night');
    await sleep(100);
    await shot(page, '15-chat');
    await page.keyboard.press('Enter');
    await sleep(300);
    s = await state(page);
    check('chat : /time set night', s.time % 24000 >= 13000 && s.time % 24000 < 14000 && s.modal === false, `time ${s.time}`);
    await chat(page, '/weather rain');
    check('/weather rain', await ev(page, () => window.__game.raining === true));
    await ticks(page, 60);
    await shot(page, '16-nuit-pluie');
    await chat(page, '/weather clear');
    await chat(page, '/gamemode creative');
    check('/gamemode creative', await ev(page, () => window.__game.player.gameMode === 'creative'));
    await chat(page, '/gamemode survival');
    check('/gamemode survival', await ev(page, () => window.__game.player.gameMode === 'survival'));
    await chat(page, '/tp 8.5 4 8.5');
    const p = await pos(page);
    check('/tp', Math.abs(p.x - 8.5) < 0.01 && Math.abs(p.z - 8.5) < 0.01, JSON.stringify(p));
    await chat(page, '/nimporte');
    console.log('  messages :', JSON.stringify(await ev(page, () => window.__msgs.slice(-6))));
  });

  await section('créatures et combat', async () => {
    await ev(page, () => { window.__game.difficulty = 2; window.__game.spawner.timer = 0; });
    await chat(page, '/time set night');
    await ev(page, () => T.aim(8.5, 4, 3.5)); await ticks(page, 2);
    await chat(page, '/summon zombie');
    await ticks(page, 2);
    let z = await ev(page, () => { const l = T.mobs('zombie'); window.__z = l[l.length - 1]; return l.map((e) => ({ x: e.x, y: e.y, z: e.z, h: e.health })); });
    check('/summon zombie', z.length === 1, JSON.stringify(z));
    await shot(page, '17-zombie');
    const h0 = (await state(page)).health;
    await page.waitForFunction((h0) => window.__game.player.health < h0, { timeout: 30000 }, h0);
    s = await state(page);
    check('le zombie rejoint et frappe le joueur', s.health < h0, `santé ${h0} → ${s.health}`);
    await chat(page, '/give diamond_sword');
    await ev(page, () => T.select('diamond_sword'));
    let hits = 0;
    for (; hits < 30; hits++) {
      const alive = await ev(page, () => { const m = window.__z; if (!m || m.dead || m.health <= 0) return false; T.aim(m.x, m.y + m.height * 0.6, m.z); return true; });
      if (!alive) break;
      await ticks(page, 2);
      await lclick(page);
      await ticks(page, 10);
    }
    z = await ev(page, () => { const m = window.__z; return !m || m.dead || m.health <= 0; });
    check('le zombie meurt sous les coups d\'épée', z === true && hits < 30, `${hits} coups`);
    // test de recherche de chemin : zombie en vue du joueur, puis enfermé dans un enclos en U (ouvert seulement à l'arrière)
    await ev(page, async () => {
      const M = await import('/src/entity/Mobs.ts');
      const g = window.__game;
      const p = g.player;
      p.teleport(8.5, 4, 10.5);
      p.health = 20;
      const zom = M.createMob('zombie', g.rng);
      zom.setPosition(8.5, 4, 3.5);
      window.__zWall = zom;
      g.spawn(zom);
    });
    // 12 ticks à découvert : le zombie voit le joueur et le prend pour cible normalement
    await ticks(page, 12);
    const hasTarget = await ev(page, () => window.__zWall && window.__zWall.target === window.__game.player);
    check('le zombie acquiert le joueur en ligne de vue', hasTarget === true);
    // pose de l'enclos en U (mur frontal z=6 et murs latéraux x=6 et x=10 de z=1 à z=6, 2 blocs de haut)
    await ev(page, () => {
      const w = window.__game.world;
      const cobble = T.id('cobblestone');
      for (let x = 6; x <= 10; x++) { w.setBlock(x, 4, 6, cobble, 0); w.setBlock(x, 5, 6, cobble, 0); }
      for (let z = 1; z <= 6; z++) {
        w.setBlock(6, 4, z, cobble, 0); w.setBlock(6, 5, z, cobble, 0);
        w.setBlock(10, 4, z, cobble, 0); w.setBlock(10, 5, z, cobble, 0);
      }
    });
    const hBeforeWall = (await state(page)).health;
    await page.waitForFunction((h0) => window.__game.player.health < h0, { timeout: 20000 }, hBeforeWall);
    s = await state(page);
    check('recherche de chemin : un zombie dans un enclos en U recule, contourne et rejoint le joueur', s.health < hBeforeWall, `santé ${hBeforeWall} → ${s.health}`);
    await ev(page, () => {
      const w = window.__game.world;
      for (let x = 6; x <= 10; x++) { w.setBlock(x, 4, 6, 0, 0); w.setBlock(x, 5, 6, 0, 0); }
      for (let z = 1; z <= 6; z++) {
        w.setBlock(6, 4, z, 0, 0); w.setBlock(6, 5, z, 0, 0);
        w.setBlock(10, 4, z, 0, 0); w.setBlock(10, 5, z, 0, 0);
      }
      if (window.__zWall) window.__zWall.dead = true;
    });
    await ticks(page, 40);
    console.log('  entités après combat :', JSON.stringify(await ev(page, () => T.kinds())), '| inventaire :', await ev(page, () => T.inv()));
    await ev(page, () => { window.__game.difficulty = 0; });
    const kBefore = await ev(page, () => T.kinds());
    await chat(page, '/summon cow');
    await chat(page, '/summon pig');
    await chat(page, '/summon sheep');
    await chat(page, '/summon chicken');
    await chat(page, '/time set day');
    await ticks(page, 40);
    const k = await ev(page, () => T.kinds());
    const passiveTotal = (k.cow || 0) + (k.pig || 0) + (k.sheep || 0) + (k.chicken || 0);
    check('animaux apparus',
      k.cow >= 2 && k.pig >= 2 && k.sheep >= 2 && k.chicken >= 2 &&
      k.cow > (kBefore.cow || 0) && k.pig > (kBefore.pig || 0) && k.sheep > (kBefore.sheep || 0) && k.chicken > (kBefore.chicken || 0),
      JSON.stringify(k));
    check('population passive modérée en monde plat (<= 60)', passiveTotal >= 15 && passiveTotal <= 60, `total=${passiveTotal}`);
    // Spawner.populateChunk dépend de la graine du monde
    const seedRes = await ev(page, async () => {
      const { Spawner } = await import('/src/entity/Spawner.ts');
      const g = window.__game;
      const chunks = Array.from(g.world.chunks.values()).slice(0, 64);
      const runWithSeed = (seed) => {
        const spawned = [];
        const fakeWorld = Object.create(g.world, {
          seed: { value: seed },
          worldType: { value: 'default' },
        });
        const fakeGame = Object.create(g, {
          world: { value: fakeWorld },
          spawn: { value: (mob) => spawned.push(`${mob.mobKind}:${mob.x.toFixed(1)},${mob.z.toFixed(1)}`) },
        });
        const spawner = new Spawner();
        for (const ch of chunks) spawner.populateChunk(fakeGame, ch);
        return spawned.join('|');
      };
      const s1a = runWithSeed(1111);
      const s1b = runWithSeed(1111);
      const s2 = runWithSeed(2222);
      return { sameSeed: s1a === s1b && s1a.length > 0, diffSeed: s1a !== s2 && s2.length > 0, len1: s1a.length, len2: s2.length };
    });
    check('populateChunk déterministe et dépendant de la graine du monde', seedRes.sameSeed && seedRes.diffSeed, JSON.stringify(seedRes));
    // reproduction et éclosion d'œuf donnent un petit (baby === true, taille moitié)
    const babyRes = await ev(page, async () => {
      const M = await import('/src/entity/Mobs.ts');
      const g = window.__game;
      const c1 = M.createMob('cow', g.rng);
      const c2 = M.createMob('cow', g.rng);
      c1.setPosition(8.5, 4, 3.5);
      c2.setPosition(9.0, 4, 3.5);
      c1.loveTicks = 600;
      c2.loveTicks = 600;
      g.spawn(c1);
      g.spawn(c2);
      for (let i = 0; i < 40; i++) g.tick();
      const calves = g.entities.filter((e) => e.kind === 'mob' && e.mobKind === 'cow' && !e.dead && e.baby);
      const calf = calves[0];
      const calfHeightBefore = calf ? calf.height : 0;
      // Croissance : un petit à 2 ticks de l'âge adulte redevient adulte après 2 ticks
      let grownOk = false;
      if (calf) {
        calf.setBaby(2);
        g.tick();
        const stillBabyAfter1 = calf.baby === true;
        g.tick();
        grownOk = stillBabyAfter1 && calf.baby === false && Math.abs(calf.height - c1.height) < 0.01;
        // Remet en petit pour la capture d'écran
        calf.setBaby(24000);
      }
      // Test déterministe d'éclosion d'œuf (premier tirage < 0.125 = éclosion, second >= 1/32 = 1 poussin)
      let rngCall = 0;
      const fakeGame = Object.create(g, {
        rng: { value: () => (rngCall++ === 0 ? 0.05 : 0.5) },
      });
      M.hatchEgg(fakeGame, 10.5, 4, 3.5);
      g.tick();
      const chicks = g.entities.filter((e) => e.kind === 'mob' && e.mobKind === 'chicken' && !e.dead && e.baby);
      return {
        calfCount: calves.length,
        calfHeight: calfHeightBefore,
        adultHeight: c1.height,
        grownOk,
        chickCount: chicks.length,
        chickHeight: chicks[0] ? chicks[0].height : 0,
      };
    });
    check('reproduction et œufs donnent un petit (taille réduite de moitié)',
      babyRes.calfCount === 1 && Math.abs(babyRes.calfHeight - babyRes.adultHeight * 0.5) < 0.01 && babyRes.chickCount >= 1 && Math.abs(babyRes.chickHeight - 0.35) < 0.01,
      JSON.stringify(babyRes));
    check('un petit à 2 ticks de croissance devient adulte et retrouve sa taille normale', babyRes.grownOk === true, JSON.stringify(babyRes));
    // un petit rejoint l'adulte de son espèce et reste près de lui ; l'adulte est figé pour que le rapprochement
    // ne puisse venir que du petit ; un témoin au suivi désactivé est relevé à titre de comparaison (non vérifié)
    const followRes = await ev(page, async () => {
      const M = await import('/src/entity/Mobs.ts');
      const g = window.__game;
      for (const e of g.entities) if (e.kind === 'mob' && Math.hypot(e.x + 20.5, e.z + 20.5) < 16) e.dead = true;
      g.tick();
      const adult = M.createMob('cow', g.rng);
      adult.setPosition(-20.5, 4, -20.5);
      adult.behave = () => {};
      const calf = M.createMob('cow', g.rng);
      calf.setBaby(24000);
      calf.setPosition(-13.5, 4, -20.5);
      const witness = M.createMob('cow', g.rng);
      witness.setBaby(24000);
      witness.setPosition(-27.5, 4, -20.5);
      witness.followParent = () => false;
      g.spawn(adult); g.spawn(calf); g.spawn(witness);
      const d0 = Math.hypot(calf.x - adult.x, calf.z - adult.z);
      let closest = d0;
      for (let i = 0; i < 160; i++) { g.tick(); closest = Math.min(closest, Math.hypot(calf.x - adult.x, calf.z - adult.z)); }
      const res = { d0, closest, end: Math.hypot(calf.x - adult.x, calf.z - adult.z), witnessEnd: Math.hypot(witness.x - adult.x, witness.z - adult.z), calfBaby: calf.baby };
      adult.dead = calf.dead = witness.dead = true;
      g.tick();
      return res;
    });
    check('un petit rejoint l\'adulte de son espèce et reste près de lui (adulte immobile)', followRes.d0 >= 6.9 && followRes.closest < 3.5 && followRes.end < 4 && followRes.calfBaby, JSON.stringify(followRes));
    await ev(page, () => { const g = window.__game; const p = g.player; p.teleport(p.x, p.y, p.z + 4); T.aim(8.5, 4.6, 3.5); });
    await ticks(page, 10);
    await shot(page, '18-animaux');
  });

  await section('mort et réapparition', async () => {
    await chat(page, '/tp 20.5 4 20.5');
    const before = await ev(page, () => T.inv());
    await chat(page, '/kill');
    await page.waitForSelector('[data-mc="death"]', { timeout: 10000 });
    await sleep(600);
    await shot(page, '19-mort');
    check('bouton Réapparaître inactif la première seconde', await page.evaluate(() => document.querySelector('[data-mc="respawn"]').disabled === true));
    await sleep(700);
    check('écran de mort', true);
    await click(page, 'respawn');
    await sleep(500);
    await ticks(page, 20);
    s = await state(page);
    const sp = await ev(page, () => window.__game.spawnPoint);
    check('réapparition au point d\'apparition, santé pleine', s.health === 20 && Math.hypot(s.pos[0] - sp.x, s.pos[2] - sp.z) < 1.5 && (await page.$('[data-mc="death"]')) === null, `pos ${s.pos}, santé ${s.health}`);
    const after = await ev(page, () => T.inv());
    console.log('  inventaire avant la mort :', before, '| après :', after, '| entités :', JSON.stringify(s.kinds));
    check('en survie, l\'inventaire tombe au sol à la mort', after === '' && (s.kinds.item || 0) > 0, `objets au sol ${s.kinds.item || 0}`);
  });

  await section('pause', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await sleep(300);
    await shot(page, '20-pause');
    const a = (await state(page)).time;
    await sleep(1000);
    const b = (await state(page)).time;
    check('la pause gèle le temps', a === b, `${a} → ${b}`);
    await click(page, 'resume');
    await sleep(300);
    await ticks(page, 10);
    check('reprise', (await state(page)).pausing === false);
  });

  await section('TNT et briquet', async () => {
    await chat(page, '/tp 30.5 4 30.5');
    await ticks(page, 5);
    await chat(page, '/give tnt 4');
    await chat(page, '/give flint_and_steel');
    await ev(page, () => T.select('tnt'));
    await useOnGround(page, 30, 27);
    const tnt = await ev(page, () => T.id('tnt'));
    check('TNT posée', (await ev(page, () => T.block(30, 4, 27))) === tnt);
    await ev(page, () => { T.select('flint_and_steel'); T.aim(30.5, 4.5, 28); });
    await ticks(page, 2);
    await rclick(page);
    let k = await ev(page, () => T.kinds());
    check('le briquet amorce la TNT', (k.tnt || 0) === 1 && (await ev(page, () => T.block(30, 4, 27))) === 0, JSON.stringify(k));
    await ev(page, () => T.look(0, 0));
    await page.keyboard.down('KeyS'); await ticks(page, 40); await page.keyboard.up('KeyS');
    await shot(page, '21-tnt');
    await page.waitForFunction(() => !window.__game.entities.some((e) => e.kind === 'tnt'), { timeout: 15000 });
    await ticks(page, 5);
    await shot(page, '22-explosion');
    const crater = await ev(page, () => { let n = 0; for (let x = 27; x <= 33; x++) for (let z = 24; z <= 30; z++) for (let y = 1; y <= 3; y++) if (T.block(x, y, z) === 0) n++; return n; });
    s = await state(page);
    check('l\'explosion creuse un cratère', crater >= 8, `${crater} blocs détruits, santé ${s.health}, objets ${s.kinds.item || 0}`);
    await ticks(page, 60);
  });

  await section('établi, coffre, fourneau', async () => {
    await chat(page, '/tp 40.5 4 40.5');
    await ticks(page, 5);
    for (const n of ['crafting_table', 'chest', 'furnace']) await chat(page, `/give ${n}`);
    const spots = [['crafting_table', 39, 'menu-crafting'], ['chest', 40, 'menu-chest'], ['furnace', 41, 'menu-furnace']];
    for (const [name, x, menu] of spots) {
      await ev(page, (name) => T.select(name), name);
      await useOnGround(page, x, 38);
      const id = await ev(page, (name) => T.id(name), name);
      const got = await ev(page, (x) => T.block(x, 4, 38), x);
      check(`${name} posé`, got === id, `bloc ${got}`);
    }
    await ev(page, () => { window.__game.player.inventory.selected = 8; });
    for (const [name, x, menu] of spots) {
      await ev(page, (x) => T.aim(x + 0.5, 4.5, 39), x);
      await ticks(page, 2);
      await rclick(page);
      const open = await page.$(`[data-mc="${menu}"]`);
      check(`clic droit sur ${name} ouvre ${menu}`, open !== null);
      await sleep(250);
      await shot(page, `23-${menu}`);
      if (menu === 'menu-chest') {
        // range les pavés dans le coffre par maj+clic
        const sel = await page.evaluate(() => { const g = window.__game; const id = T.id('oak_planks'); return null; });
      }
      await page.keyboard.press('Escape');
      await sleep(250);
    }
    // fourneau : cuisson réelle
    await chat(page, '/give iron_ore 2');
    await chat(page, '/give coal 1');
    await ev(page, () => T.aim(41.5, 4.5, 39)); await ticks(page, 2); await rclick(page);
    await page.waitForSelector('[data-mc="menu-furnace"]', { timeout: 5000 });
    const dom = (group) => page.evaluate((group) => { const e = document.querySelector(`[data-mc="menu-furnace"] [data-group="${group}"]`); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, group);
    const slotOf = (name) => page.evaluate((name) => { const g = window.__game; const id = T.id(name); const k = g.player.inventory.slots.findIndex((x) => x && x.id === id); const els = Array.from(document.querySelectorAll(`[data-mc="menu-furnace"] [data-group="${k < 9 ? 'hotbar' : 'main'}"]`)); const e = els[k < 9 ? k : k - 9]; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, name);
    let c = await slotOf('iron_ore'); await page.mouse.click(c[0], c[1]); await sleep(100);
    c = await dom('input'); await page.mouse.click(c[0], c[1]); await sleep(100);
    c = await slotOf('coal'); await page.mouse.click(c[0], c[1]); await sleep(100);
    c = await dom('fuel'); await page.mouse.click(c[0], c[1]); await sleep(100);
    await sleep(1500);
    await shot(page, '24-fourneau-cuisson');
    await page.keyboard.press('Escape'); await sleep(200);
    await ticks(page, 230);
    await ev(page, () => T.aim(41.5, 4.5, 39)); await ticks(page, 2); await rclick(page);
    await page.waitForSelector('[data-mc="menu-furnace"]', { timeout: 5000 });
    await sleep(200);
    await shot(page, '25-fourneau-lingot');
    c = await dom('output'); await page.mouse.click(c[0], c[1]); await sleep(150);
    const cur = await ev(page, () => { const c = window.__game.player.inventory.cursor; return c ? c.id : 0; });
    const ingot = await ev(page, () => T.id('iron_ingot'));
    check('le fourneau cuit le minerai en lingot (menu fermé)', cur === ingot, `curseur ${cur}, attendu ${ingot}`);
    await page.keyboard.press('Escape'); await sleep(250);
  });

  await section('seau d\'eau', async () => {
    await chat(page, '/tp 50.5 4 50.5');
    await ticks(page, 5);
    await chat(page, '/give water_bucket');
    await ev(page, () => T.select('water_bucket'));
    await useOnGround(page, 50, 47);
    const b = await ev(page, () => T.block(50, 4, 47));
    check('le seau pose de l\'eau', b !== 0 && (await ev(page, () => T.count('bucket'))) === 1, `bloc ${b}`);
    await ticks(page, 60);
    const spread = await ev(page, (b) => [[49, 47], [51, 47], [50, 46], [50, 48]].filter(([x, z]) => T.block(x, 4, z) !== 0).length, b);
    check('l\'eau s\'écoule', spread >= 3, `${spread}/4 voisins`);
    await shot(page, '26-eau');
    const drift = await pos(page);
    console.log('  le courant a poussé le joueur en', drift.x.toFixed(2), drift.z.toFixed(2));
    await ev(page, () => { const p = window.__game.player; p.teleport(50.5, 4, 49.5); T.select('bucket'); T.aim(50.5, 4.4, 47.5); });
    await ticks(page, 1); await ev(page, () => T.aim(50.5, 4.4, 47.5)); await rclick(page);
    check('le seau vide reprend la source', (await ev(page, () => T.count('water_bucket'))) === 1 && (await ev(page, () => T.block(50, 4, 47))) !== b, `bloc ${await ev(page, () => T.block(50, 4, 47))}`);
    await ticks(page, 100);
    const left = await ev(page, () => { let n = 0; for (let x = 44; x <= 56; x++) for (let z = 41; z <= 53; z++) if (T.block(x, 4, z) !== 0) n++; return n; });
    check('l\'eau restante se retire', left === 0, `${left} cellules d'eau`);
  });

  await section('pêche', async () => {
    // un bassin de 11 × 7 creusé dans le sol plat, le joueur sur la berge
    const pond = await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game, w = g.world;
      const old = w.getBlock(64, 3, 60);
      for (let x = 60; x <= 70; x++) for (let z = 57; z <= 63; z++) w.setBlock(x, 3, z, B.WATER, 0);
      for (const e of g.entities) if (e.kind === 'mob' && Math.hypot(e.x - 62, e.z - 60) < 16) e.dead = true;
      g.player.teleport(57.5, 4, 60.5);
      return { old };
    });
    await ticks(page, 5);
    await chat(page, '/give fishing_rod');
    const bob = () => ev(page, () => { const b = window.__game.entities.find((e) => e.kind === 'bobber' && !e.dead); return b ? { x: +b.x.toFixed(2), y: +b.y.toFixed(3), z: +b.z.toFixed(2), floating: b.floating, grounded: b.grounded, wait: b.waitTicks, bite: b.biteTicks, hooked: !!b.hooked } : null; });
    const rod = () => ev(page, () => { const g = window.__game, h = g.player.inventory.held; return { id: h ? h.id : 0, damage: h ? h.damage : -1, fishing: g.interaction.fishing }; });
    const drops = () => ev(page, () => window.__game.entities.filter((e) => e.kind === 'item' && !e.dead && e.stack).map((e) => e.stack.id));
    const cast = async (x, y, z) => { await ev(page, (x, y, z) => { T.select('fishing_rod'); T.aim(x, y, z); }, x, y, z); await ticks(page, 2); await rclick(page); };
    const setBobber = (fields) => ev(page, (fields) => { const b = window.__game.entities.find((e) => e.kind === 'bobber' && !e.dead); if (b) Object.assign(b, fields); return !!b; }, fields);

    // --- lancer : le flotteur vole puis flotte
    await cast(64.5, 4.8, 60.5);
    await ticks(page, 40);
    const b1 = await bob();
    const r1 = await rod();
    check('pêche : la canne lance un flotteur qui flotte à la surface du bassin',
      !!b1 && b1.floating && !b1.grounded && b1.x >= 60 && b1.x < 71 && b1.z >= 57 && b1.z < 64 && b1.y > 3.6 && b1.y < 3.95 && r1.fishing && r1.damage === 0,
      `${JSON.stringify(b1)} ${JSON.stringify(r1)}`);
    check('pêche : l\'attente avant la touche est tirée entre 5 et 30 secondes', !!b1 && b1.wait > 50 && b1.wait < 600 && b1.bite === 0, JSON.stringify(b1));

    // --- tenir le bouton ne remonte pas la ligne ; un clic sans touche ne rapporte rien
    await ev(page, () => { window.__game.input.buttons[2] = true; });
    await ticks(page, 12);
    await ev(page, () => { window.__game.input.buttons[2] = false; });
    check('pêche : tenir le clic droit ne remonte pas la ligne', !!(await bob()));
    const inv0 = await ev(page, () => T.inv());
    const drops0 = (await drops()).length;
    await rclick(page);
    await ticks(page, 5);
    const r2 = await rod();
    check('pêche : remonter sans touche ne rapporte rien et n\'use pas la canne',
      !(await bob()) && !r2.fishing && r2.damage === 0 && (await drops()).length === drops0 && (await ev(page, () => T.inv())) === inv0, JSON.stringify(r2));

    // --- une touche : sillage, puis le flotteur s'enfonce
    await cast(64.5, 4.8, 60.5);
    await ticks(page, 40);
    const rest = await bob();
    await setBobber({ waitTicks: 20 });
    await page.waitForFunction(() => { const b = window.__game.entities.find((e) => e.kind === 'bobber' && !e.dead); return b && b.biteTicks > 0; }, { timeout: 30000 });
    await ticks(page, 6);
    const dip = await bob();
    check('pêche : quand un poisson mord, le flotteur s\'enfonce', !!rest && !!dip && dip.bite > 0 && dip.bite <= 40 && rest.y - dip.y > 0.12, `repos ${JSON.stringify(rest)} touche ${JSON.stringify(dip)}`);
    await shot(page, '27-peche-touche');

    // --- remonter pendant la touche : une prise, de l'expérience, un point d'usure
    const before = await ev(page, async () => { const F = await import('/src/world/Fishing.ts'); const I = (await import('/src/world/Ids.ts')).I; const p = window.__game.player;
      return { xp: p.xpLevel + p.xpProgress, allowed: [I.RAW_FISH, ...F.FISHING_JUNK, ...F.FISHING_TREASURE] }; });
    const known = await drops();
    await rclick(page);
    const flying = (await drops()).filter((id) => before.allowed.includes(id));
    const caught = flying.find((id) => !known.includes(id)) ?? flying[flying.length - 1];
    const had = await ev(page, (id) => window.__game.player.inventory.count(id), caught ?? 0);
    await ticks(page, 40);
    // la prise vole vers le pêcheur ; si elle retombe un peu court, il fait les deux pas qui manquent
    if ((await ev(page, (id) => window.__game.player.inventory.count(id), caught ?? 0)) === had) {
      await ev(page, (id) => { const g = window.__game; const e = g.entities.find((x) => x.kind === 'item' && !x.dead && x.stack && x.stack.id === id); if (e) g.player.teleport(e.x, Math.max(4, e.y), e.z); }, caught ?? 0);
      await ticks(page, 15);
    }
    const after = await ev(page, (id) => { const p = window.__game.player; return { xp: p.xpLevel + p.xpProgress, count: p.inventory.count(id) }; }, caught ?? 0);
    await ev(page, () => { window.__game.player.teleport(57.5, 4, 60.5); T.select('fishing_rod'); });
    await ticks(page, 2);
    const r3 = await rod();
    check('pêche : remonter pendant la touche rapporte une prise, de l\'expérience et use la canne d\'un point',
      caught !== undefined && after.count === had + 1 && after.xp > before.xp && r3.damage === 1 && !(await bob()),
      `prise ${caught}, ${had} → ${after.count}, xp ${before.xp.toFixed(2)} → ${after.xp.toFixed(2)}, canne ${JSON.stringify(r3)}`);

    // --- la touche passée, il est trop tard
    await cast(64.5, 4.8, 60.5);
    await ticks(page, 40);
    await setBobber({ waitTicks: 0, biteTicks: 1 });
    await ticks(page, 4);
    const late = await bob();
    const inv1 = await ev(page, () => T.inv());
    await rclick(page);
    await ticks(page, 5);
    check('pêche : la touche passée, l\'attente repart et remonter ne rapporte rien',
      !!late && late.bite === 0 && late.wait > 50 && (await ev(page, () => T.inv())) === inv1 && (await rod()).damage === 1, JSON.stringify(late));

    // --- flotteur posé sur le sol : deux points d'usure
    await cast(52.5, 4.0, 60.5);
    await ticks(page, 30);
    const ground = await bob();
    await rclick(page);
    await ticks(page, 3);
    check('pêche : un flotteur posé au sol ne pêche pas et use la canne de deux points', !!ground && ground.grounded && !ground.floating && ground.wait === 0 && (await rod()).damage === 3, `${JSON.stringify(ground)} ${JSON.stringify(await rod())}`);

    // --- créature accrochée : elle est tirée vers le pêcheur
    await ev(page, async () => {
      const M = await import('/src/entity/Mobs.ts');
      const g = window.__game;
      const cow = M.createMob('cow', g.rng);
      cow.setPosition(52.5, 4, 60.5);
      cow.behave = () => {};
      g.spawn(cow);
      window.__cow = cow;
    });
    await ticks(page, 3);
    await cast(52.5, 4.9, 60.5);
    await ticks(page, 10);
    const hook = await bob();
    await rclick(page);
    await ticks(page, 12);
    const cowX = await ev(page, () => { const c = window.__cow; const x = c.x; c.dead = true; return x; });
    check('pêche : une créature accrochée est tirée vers le pêcheur (cinq points d\'usure)', !!hook && hook.hooked && cowX > 53.2 && (await rod()).damage === 8, `${JSON.stringify(hook)} vache en x=${cowX.toFixed(2)} ${JSON.stringify(await rod())}`);

    // --- ranger la canne retire la ligne ; vue de l'extérieur pour la capture
    await cast(64.5, 4.8, 60.5);
    await ticks(page, 30);
    await shot(page, '27-peche-ligne');
    // de trois quarts, pour que l'avatar ne cache pas le flotteur
    await ev(page, () => { window.__game.viewMode = 1; T.aim(64.5, 4.8, 54.5); });
    await ticks(page, 4);
    await shot(page, '27-peche-ligne-exterieur');
    await ev(page, () => { const g = window.__game; g.viewMode = 0; const inv = g.player.inventory; inv.selected = (inv.selected + 1) % 9; });
    await ticks(page, 4);
    const away = await ev(page, () => ({ bobber: window.__game.entities.some((e) => e.kind === 'bobber' && !e.dead), fishing: window.__game.interaction.fishing, held: window.__game.player.heldItemId }));
    check('pêche : changer d\'objet retire la ligne', !away.bobber && !away.fishing, JSON.stringify(away));

    // --- fabrication, cuisson, tirage des prises
    const rules = await ev(page, async () => {
      const { I } = await import('/src/world/Ids.ts');
      const R = await import('/src/world/Recipes.ts');
      const F = await import('/src/world/Fishing.ts');
      const { ITEMS } = await import('/src/world/Items.ts');
      const seq = (...v) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };
      const craft = R.matchRecipe([0, 0, I.STICK, 0, I.STICK, I.STRING, I.STICK, 0, I.STRING], 3);
      const smelt = R.smeltingResult(I.RAW_FISH);
      const fish = F.rollFishingCatch(seq(0.5));
      const junk = F.rollFishingCatch(seq(0.9, 0));
      const treasure = F.rollFishingCatch(seq(0.97, 0, 0.5));
      let n = 0;
      let s = 12345;
      const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
      for (let i = 0; i < 2000; i++) if (F.rollFishingCatch(rnd).id === I.RAW_FISH) n++;
      return {
        craft: !!craft && craft.id === I.FISHING_ROD && craft.count === 1,
        smelt: !!smelt && smelt.id === I.COOKED_FISH,
        food: ITEMS[I.RAW_FISH].food === 2 && ITEMS[I.COOKED_FISH].food === 5 && ITEMS[I.FISHING_ROD].durability === 64,
        fish: fish.id === I.RAW_FISH && fish.count === 1 && fish.damage === 0,
        junk: junk.id === I.BOWL && junk.damage === 0,
        treasure: treasure.id === I.BOW && treasure.damage === Math.floor(384 * 0.5),
        share: n / 2000,
      };
    });
    check('pêche : recette de la canne, cuisson du poisson, valeurs nutritives', rules.craft && rules.smelt && rules.food, JSON.stringify(rules));
    check('pêche : tirage des prises (poisson ≈ 85 %, objets sans valeur, trouvailles usées)', rules.fish && rules.junk && rules.treasure && rules.share > 0.8 && rules.share < 0.9, JSON.stringify(rules));

    // --- remise en état : sol rebouché, canne et prises retirées
    await ev(page, (old, rodId, caught) => {
      const g = window.__game, w = g.world, inv = g.player.inventory;
      for (let x = 60; x <= 70; x++) for (let z = 57; z <= 63; z++) w.setBlock(x, 3, z, old, 0);
      for (let i = 0; i < inv.slots.length; i++) { const st = inv.slots[i]; if (st && st.id === rodId) inv.slots[i] = null; }
      if (caught && caught !== rodId) inv.remove(caught, 1);
      for (const e of g.entities) if ((e.kind === 'item' && Math.hypot(e.x - 62, e.z - 60) < 16) || e.kind === 'bobber') e.dead = true;
    }, pond.old, await ev(page, () => T.id('fishing_rod')), caught ?? 0);
    await ticks(page, 3);
  });

  await section('lit et sommeil', async () => {
    await chat(page, '/tp 60.5 4 60.5');
    await ticks(page, 5);
    await chat(page, '/give bed');
    await ev(page, () => T.select('bed'));
    await useOnGround(page, 60, 58);
    const bed = await ev(page, () => T.id('bed'));
    const cells = await ev(page, () => { const out = []; for (let x = 58; x <= 62; x++) for (let z = 55; z <= 60; z++) if (T.block(x, 4, z) !== 0) out.push([x, z, T.block(x, 4, z)]); return out; });
    check('lit posé (2 blocs)', cells.length === 2, JSON.stringify(cells));
    await ev(page, () => T.aim(60.5, 4.3, 58.5)); await ticks(page, 2); await rclick(page);
    check('de jour, impossible de dormir', await ev(page, () => window.__game.player.sleeping === false), JSON.stringify(await ev(page, () => window.__msgs.slice(-1))));
    await chat(page, '/time set night');
    await ticks(page, 2);
    const day0 = Math.floor((await state(page)).time / 24000);
    await rclick(page);
    const sleeping = await ev(page, () => window.__game.player.sleeping);
    check('de nuit, le joueur se couche', sleeping === true, JSON.stringify(await ev(page, () => window.__msgs.slice(-2))));
    await sleep(700);
    await shot(page, '27-sommeil');
    await page.waitForFunction(() => window.__game.player.sleeping === false, { timeout: 20000 });
    s = await state(page);
    const wakeInfo = await ev(page, () => {
      const p = window.__game.player;
      const bx = Math.floor(p.x);
      const by = Math.floor(p.y);
      const bz = Math.floor(p.z);
      const blockAtFeet = T.block(bx, by, bz);
      const bed = p.bed;
      const dist = bed ? Math.hypot(p.x - (bed.x + 0.5), p.z - (bed.z + 0.5)) : 0;
      return { blockAtFeet, bed, dist, onGround: p.onGround, y: p.y };
    });
    check('réveil au matin suivant', Math.floor(s.time / 24000) === day0 + 1 && s.time % 24000 < 1000, `time ${s.time}`);
    check('au réveil, le joueur est debout à côté du lit (pas dessus)', wakeInfo.onGround && wakeInfo.blockAtFeet === 0 && wakeInfo.dist >= 0.8 && wakeInfo.dist <= 2.5 && Math.abs(wakeInfo.y - 4) < 0.01, JSON.stringify(wakeInfo));
    check('le lit devient le point de réapparition', await ev(page, () => !!window.__game.player.bed));
  });

  await section('vues F5, F1, F3', async () => {
    await ev(page, () => T.look(0.6, -0.2));
    await page.keyboard.press('F5'); await sleep(300);
    check('F5 : vue de dos', await ev(page, () => window.__game.viewMode === 1));
    await shot(page, '28-f5-dos');
    await page.keyboard.press('F5'); await sleep(300);
    await shot(page, '29-f5-face');
    await page.keyboard.press('F5'); await sleep(200);
    check('F5 : retour à la première personne', await ev(page, () => window.__game.viewMode === 0));
    await page.keyboard.press('F3'); await sleep(700);
    await shot(page, '30-f3');
    await page.keyboard.press('F3');
    await page.keyboard.press('F1'); await sleep(300);
    await shot(page, '31-f1');
    await page.keyboard.press('F1');
  });

  await section('molette et touches 1-9', async () => {
    await page.keyboard.press('Digit3');
    await ticks(page, 2);
    check('touche 3 → case 3', await ev(page, () => window.__game.player.inventory.selected === 2));
    await page.mouse.move(640, 360);
    await page.mouse.wheel({ deltaY: 100 });
    await ticks(page, 2);
    check('molette → case suivante', await ev(page, () => window.__game.player.inventory.selected === 3), `case ${await ev(page, () => window.__game.player.inventory.selected)}`);
  });

  let marker = null;
  await section('sauvegarde, quitter, rejouer', async () => {
    await chat(page, '/tp 70.5 4 70.5');
    await ticks(page, 5);
    await chat(page, '/give cobblestone 10');
    await ev(page, () => T.select('cobblestone'));
    await useOnGround(page, 70, 67);
    await chat(page, '/summon cow');
    await ev(page, () => {
      const cows = T.mobs('cow').filter((e) => Math.hypot(e.x - 70.5, e.z - 67.5) < 6);
      if (cows.length > 0) cows[cows.length - 1].setBaby(12000);
    });
    await chat(page, '/difficulty normal');
    await chat(page, '/summon spider');
    await ticks(page, 10);
    marker = await ev(page, () => { const g = window.__game; return { block: T.block(70, 4, 67), inv: T.inv(), time: g.time, pos: [g.player.x, g.player.y, g.player.z], cows: T.mobs('cow').filter((e) => Math.hypot(e.x - g.player.x, e.z - g.player.z) < 48).length, near: T.mobs('cow').filter((e) => Math.hypot(e.x - 70.5, e.z - 67.5) < 6).length, babies: T.mobs('cow').filter((e) => e.baby && Math.hypot(e.x - g.player.x, e.z - g.player.z) < 48).length, spiders: T.mobs('spider').filter((e) => Math.hypot(e.x - g.player.x, e.z - g.player.z) < 48).length, hole: null, bed: g.player.bed, chest: T.block(40, 4, 38), health: g.player.health, mode: g.player.gameMode, advs: Array.from(g.player.advancements).sort() }; });
    if (holeAt) marker.hole = await ev(page, (h) => T.block(h.x, h.y, h.z), holeAt);
    console.log('  repères avant sauvegarde :', JSON.stringify(marker));
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await sleep(200);
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    check('« Sauvegarder et quitter » ramène au menu principal', await ev(page, () => true));
    await sleep(300);
    await click(page, 'play');
    await page.waitForSelector('[data-mc="world-play"]', { timeout: 10000 });
    await sleep(500);
    await shot(page, '32-liste-mondes');
    await click(page, 'world-play');
    await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
    await install(page);
    await ticks(page, 20);
    const now = await ev(page, () => { const g = window.__game; return { block: T.block(70, 4, 67), inv: T.inv(), time: g.time, pos: [g.player.x, g.player.y, g.player.z], cows: T.mobs('cow').filter((e) => Math.hypot(e.x - g.player.x, e.z - g.player.z) < 48).length, near: T.mobs('cow').filter((e) => Math.hypot(e.x - 70.5, e.z - 67.5) < 6).length, babies: T.mobs('cow').filter((e) => e.baby && Math.hypot(e.x - g.player.x, e.z - g.player.z) < 48).length, spiders: T.mobs('spider').filter((e) => Math.hypot(e.x - g.player.x, e.z - g.player.z) < 48).length, bed: g.player.bed, chest: T.block(40, 4, 38), health: g.player.health, mode: g.player.gameMode, advs: Array.from(g.player.advancements).sort() }; });
    if (holeAt) now.hole = await ev(page, (h) => T.block(h.x, h.y, h.z), holeAt);
    console.log('  repères après rechargement :', JSON.stringify(now));
    check('bloc posé persistant', now.block === marker.block && now.block !== 0);
    check('bloc cassé persistant', !holeAt || now.hole === 0);
    check('inventaire persistant', now.inv === marker.inv, now.inv);
    check('position persistante', Math.hypot(now.pos[0] - marker.pos[0], now.pos[2] - marker.pos[2]) < 0.2 && Math.abs(now.pos[1] - marker.pos[1]) < 0.2, JSON.stringify(now.pos));
    check('heure persistante', now.time >= marker.time && now.time < marker.time + 200, `${marker.time} → ${now.time}`);
    check('animaux persistants (rayon 48 blocs)', Math.abs(now.cows - marker.cows) <= 2 && now.near >= 1 && marker.near >= 1, `${marker.cows} → ${now.cows} ; vache invoquée à proximité : ${marker.near} → ${now.near}`);
    check('petit animal persistant après rechargement', marker.babies >= 1 && now.babies >= 1, `${marker.babies} → ${now.babies}`);
    check('monstres persistants', now.spiders >= 1 && marker.spiders >= 1, `${marker.spiders} → ${now.spiders}`);
    check('lit et blocs à entité persistants', JSON.stringify(now.bed) === JSON.stringify(marker.bed) && now.chest === marker.chest);
    check('progrès persistants (toute la chaîne jusqu\'au fer)', JSON.stringify(now.advs) === JSON.stringify(marker.advs) && now.advs.length === 10, JSON.stringify(now.advs));
    await shot(page, '33-recharge');
  });

  s = await state(page);
  console.log('état final', JSON.stringify(s));
  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const bad = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - bad.length}/${results.length} vérifications passées`);
  for (const r of bad) console.log('  ÉCHEC :', r.name, '—', r.detail);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
