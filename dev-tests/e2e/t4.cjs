// Batterie « s'y retrouver » sur un monde plat en survie : boussole, horloge, carte, panneaux, statistiques.
const { sleep, launch, openPage, click, createWorld, shot, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, rclick, lclick, section } = require('./h.cjs');

/** Retire les créatures et objets au sol, joueur au calme. */
const calm = (page) => ev(page, () => {
  const g = window.__game;
  g.difficulty = 0;
  for (const e of g.entities) if (e !== g.player && (e.kind === 'mob' || e.kind === 'item')) e.dead = true;
});

/** Quitte vers le titre puis relance le monde (seul monde de la liste). */
async function reload(page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
  await sleep(200);
  await click(page, 'quit');
  await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
  await sleep(300);
  await click(page, 'play');
  await page.waitForSelector('[data-mc="world-play"]', { timeout: 10000 });
  await sleep(300);
  await click(page, 'world-play');
  await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
  await install(page);
  await ticks(page, 10);
}

(async () => {
  const errors = [];
  const browser = await launch();
  const page = await openPage(browser, errors);
  await createWorld(page, { name: 'Reperes', seed: '42', flat: true });
  await install(page);
  await ticks(page, 20);
  await calm(page);

  await section('recettes', async () => {
    const r = await ev(page, async () => {
      const { B, I } = await import('/src/world/Ids.ts');
      const R = await import('/src/world/Recipes.ts');
      const m = (grid, id) => { const x = R.matchRecipe(grid, 3); return x && x.id === id ? x.count : 0; };
      return {
        compass: m([0, I.IRON_INGOT, 0, I.IRON_INGOT, I.REDSTONE, I.IRON_INGOT, 0, I.IRON_INGOT, 0], I.COMPASS),
        clock: m([0, I.GOLD_INGOT, 0, I.GOLD_INGOT, I.REDSTONE, I.GOLD_INGOT, 0, I.GOLD_INGOT, 0], I.CLOCK),
        map: m([I.PAPER, I.PAPER, I.PAPER, I.PAPER, I.COMPASS, I.PAPER, I.PAPER, I.PAPER, I.PAPER], I.MAP),
        sign: m([B.BIRCH_PLANKS, B.BIRCH_PLANKS, B.BIRCH_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, 0, I.STICK, 0], I.SIGN),
      };
    });
    check('recettes : boussole, horloge, carte vierge (8 papiers + boussole), 3 panneaux', r.compass === 1 && r.clock === 1 && r.map === 1 && r.sign === 3, JSON.stringify(r));
  });

  await section('boussole', async () => {
    try {
      // le point d'apparition à l'ouest du joueur : regarder vers l'ouest, puis vers le nord (il est alors à gauche)
      const sp = await ev(page, async () => {
        const { I } = await import('/src/world/Ids.ts');
        const { makeStack } = await import('/src/world/ItemStack.ts');
        const g = window.__game, p = g.player;
        p.inventory.slots[0] = makeStack(I.COMPASS, 1);
        p.inventory.selected = 0;
        p.teleport(g.spawnPoint.x + 30.5, 4, g.spawnPoint.z + 0.5);
        T.look(Math.PI / 2, 0);
        return { x: g.spawnPoint.x, z: g.spawnPoint.z };
      });
      await ticks(page, 50);
      const west = await ev(page, async () => {
        const { dialTile } = await import('/src/world/Tiles.ts');
        const g = window.__game;
        const tile = g.dynamicTile(317);
        let frame = -1;
        for (let f = 0; f < 32; f++) if (dialTile('compass', f) === tile) frame = f;
        return { frame, icon: document.querySelector('.mc-hotbar .mc-item')?.style.backgroundImage.length ?? 0, url: document.querySelector('.mc-hotbar .mc-item')?.style.backgroundImage.slice(-40) };
      });
      await ev(page, () => T.look(0, 0));
      await ticks(page, 50);
      const north = await ev(page, async () => {
        const { dialTile } = await import('/src/world/Tiles.ts');
        const tile = window.__game.dynamicTile(317);
        let frame = -1;
        for (let f = 0; f < 32; f++) if (dialTile('compass', f) === tile) frame = f;
        return { frame, url: document.querySelector('.mc-hotbar .mc-item')?.style.backgroundImage.slice(-40) };
      });
      await shot(page, '70-boussole');
      const near = (f, want) => Math.min((f - want + 32) % 32, (want - f + 32) % 32) <= 1;
      check('boussole : face au point d\'apparition, l\'aiguille pointe droit devant', near(west.frame, 0), JSON.stringify({ sp, west }));
      check('boussole : point d\'apparition à gauche, l\'aiguille pointe à gauche', near(north.frame, 24), JSON.stringify(north));
      check('boussole : l\'icône de la barre d\'objets suit l\'aiguille', !!west.url && !!north.url && west.url !== north.url, `${west.url} / ${north.url}`);
    } finally {
      await ev(page, () => { window.__game.player.inventory.slots[0] = null; }).catch(() => undefined);
    }
  });

  await section('horloge', async () => {
    try {
      await ev(page, async () => {
        const { I } = await import('/src/world/Ids.ts');
        const { makeStack } = await import('/src/world/ItemStack.ts');
        const p = window.__game.player;
        p.inventory.slots[0] = makeStack(I.CLOCK, 1);
        p.inventory.selected = 0;
      });
      const frameAt = async (time) => {
        await chat(page, `/time set ${time}`);
        await ticks(page, 50);
        return ev(page, async () => {
          const { dialTile } = await import('/src/world/Tiles.ts');
          const tile = window.__game.dynamicTile(318);
          for (let f = 0; f < 32; f++) if (dialTile('clock', f) === tile) return f;
          return -1;
        });
      };
      const noon = await frameAt(6000);
      await shot(page, '71-horloge-midi');
      const midnight = await frameAt(18000);
      const near = (f, want) => Math.min((f - want + 32) % 32, (want - f + 32) % 32) <= 1;
      check('horloge : soleil en haut à midi, lune en haut à minuit', near(noon, 0) && near(midnight, 16), `midi ${noon}, minuit ${midnight}`);
    } finally {
      await chat(page, '/time set 1000').catch(() => undefined);
      await ev(page, () => { window.__game.player.inventory.slots[0] = null; }).catch(() => undefined);
    }
  });

  let mapMark = null;
  await section('carte', async () => {
    try {
      await calm(page);
      // repère doré dans le sol, à 3 blocs du joueur
      await ev(page, async () => {
        const { B, I } = await import('/src/world/Ids.ts');
        const { makeStack } = await import('/src/world/ItemStack.ts');
        const g = window.__game, p = g.player;
        p.teleport(20.5, 4, 20.5);
        g.world.setBlock(23, 3, 20, B.GOLD_BLOCK, 0);
        p.inventory.slots[0] = makeStack(I.MAP, 1);
        p.inventory.selected = 0;
        T.look(0, 1.2); // vers le ciel : aucun bloc visé
      });
      await ticks(page, 5);
      await rclick(page);
      await ticks(page, 20);
      const a = await ev(page, async () => {
        const { I } = await import('/src/world/Ids.ts');
        const g = window.__game, s = g.player.inventory.held;
        const m = g.heldMap();
        if (!m) return { held: s && [s.id, s.damage] };
        const px = (x, z) => m.colors[(z - m.z0) * 128 + (x - m.x0)];
        let painted = 0;
        for (const c of m.colors) if (c) painted++;
        return { held: [s.id, s.damage, s.count], isMap: s.id === I.FILLED_MAP, x0: m.x0, z0: m.z0, gold: px(23, 20) >> 2, far: px(-60, -60), painted };
      });
      check('carte : un clic droit change la carte vierge en carte n° 0 de la zone (128 × 128, alignée)', a.isMap && a.held[1] === 0 && a.x0 === -64 && a.z0 === -64, JSON.stringify(a));
      check('carte : la zone autour du joueur se dessine (bloc d\'or en jaune), le lointain reste vierge', a.gold === 15 && a.far === 0 && a.painted > 5000, JSON.stringify(a));
      // en marchant vers le coin nord-ouest, la carte se complète
      await ev(page, () => { window.__game.player.teleport(-40.5, 4, -40.5); });
      await ticks(page, 25);
      const b = await ev(page, () => { const m = window.__game.heldMap(); return { far: m.colors[(-60 - m.z0) * 128 + (-60 - m.x0)] }; });
      check('carte : en se déplaçant, la carte se complète', b.far !== 0, JSON.stringify(b));
      await ev(page, () => { window.__game.player.teleport(20.5, 4, 20.5); T.look(0, -1.2); });
      await ticks(page, 10);
      await shot(page, '72-carte');
      mapMark = await ev(page, () => { const m = window.__game.heldMap(); let sum = 0; for (let i = 0; i < m.colors.length; i++) sum = (sum * 31 + m.colors[i]) >>> 0; return { id: m.id, sum }; });
    } finally {
      await ev(page, () => T.look(0, 0)).catch(() => undefined);
    }
  });

  let signMark = null;
  await section('panneaux', async () => {
    try {
      await calm(page);
      await ev(page, async () => {
        const { B, I } = await import('/src/world/Ids.ts');
        const { makeStack } = await import('/src/world/ItemStack.ts');
        const g = window.__game, p = g.player, w = g.world;
        p.teleport(40.5, 4, 40.5);
        w.setBlock(40, 4, 36, B.STONE_BRICKS, 0);
        w.setBlock(40, 5, 36, B.STONE_BRICKS, 0);
        p.inventory.slots[1] = makeStack(I.SIGN, 4);
        p.inventory.selected = 1;
      });
      await ev(page, () => T.aim(40.5, 4, 38.5));
      await ticks(page, 2);
      await rclick(page);
      await page.waitForSelector('[data-mc="sign"]', { timeout: 5000 });
      await page.keyboard.type('Bonjour');
      await page.keyboard.press('Enter');
      await page.keyboard.type('le monde');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Nord ->');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.type('ok');
      await shot(page, '73-panneau-saisie');
      await click(page, 'sign-done');
      await sleep(200);
      await ev(page, () => { window.__game.player.teleport(40.5, 4, 38.5 + 1); T.aim(40.5, 5.5, 37.0); });
      await ticks(page, 2);
      await rclick(page);
      await page.waitForSelector('[data-mc="sign"]', { timeout: 5000 });
      await page.keyboard.type('Ceci est une ligne trop longue');
      await page.keyboard.press('Escape');
      await sleep(200);
      // troisième panneau, posé en regardant vers l'est : sa face écrite doit regarder l'ouest, vers le joueur
      await ev(page, () => { window.__game.player.teleport(44.5, 4, 40.5); T.aim(46.5, 4, 40.5); });
      await ticks(page, 2);
      await rclick(page);
      await page.waitForSelector('[data-mc="sign"]', { timeout: 5000 });
      await page.keyboard.type('Est');
      await page.keyboard.press('Escape');
      await sleep(200);
      const s = await ev(page, () => {
        const g = window.__game, w = g.world;
        const out = {};
        for (const be of w.blockEntities.values()) if (be.type === 'sign') out[`${be.x},${be.y},${be.z}`] = { id: w.getBlock(be.x, be.y, be.z), meta: w.getMeta(be.x, be.y, be.z), lines: be.lines };
        return { signs: out, left: g.player.inventory.slots[1]?.count, visuals: g.signRenderer.signs.size, modal: g.ui.modal };
      });
      const st = s.signs['40,4,38'];
      const wall = s.signs['40,5,37'];
      check('panneau au sol : posé sur un poteau, tourné vers le joueur, texte saisi au clavier (Entrée, flèche haut)',
        !!st && st.id === 163 && st.meta === 0 && JSON.stringify(st.lines) === JSON.stringify(['Bonjour', 'le monde', 'ok', 'Nord ->']), JSON.stringify(s));
      check('panneau mural : plaqué contre le mur, ligne coupée à 15 caractères, Échap garde le texte',
        !!wall && wall.id === 164 && wall.meta === 0 && wall.lines[0] === 'Ceci est une li', JSON.stringify(wall));
      const east = s.signs['46,4,40'];
      check('panneau au sol : posé en regardant vers l\'est, il est tourné vers l\'ouest (12 seizièmes de tour)', !!east && east.id === 163 && east.meta === 12 && east.lines[0] === 'Est', JSON.stringify(east));
      check('panneaux : trois panneaux consommés, trois affichés, la partie a repris', s.left === 1 && s.visuals === 3 && s.modal === false, JSON.stringify(s));
      await ev(page, () => { window.__game.player.teleport(40.5, 4, 41.5); T.aim(40.5, 4.9, 37.5); });
      await ticks(page, 5);
      await shot(page, '74-panneaux');
      signMark = s.signs;
    } finally {
      await ev(page, () => T.look(0, 0)).catch(() => undefined);
    }
  });

  let statMark = null;
  await section('statistiques', async () => {
    try {
      await calm(page);
      const before = await ev(page, () => ({ ...window.__game.stats }));
      await ev(page, async () => {
        const { B, I } = await import('/src/world/Ids.ts');
        const { makeStack } = await import('/src/world/ItemStack.ts');
        const g = window.__game, p = g.player;
        p.teleport(60.5, 4, 60.5);
        T.look(0, 0);
        // la carte reste en case 0 (tenue pendant la marche), les panneaux en case 1
        p.inventory.slots[2] = makeStack(I.DIAMOND_SWORD, 1);
        p.inventory.slots[9] = makeStack(B.OAK_LOG, 1);
        p.inventory.selected = 0;
      });
      await ticks(page, 3);
      // marcher, sauter
      await page.keyboard.down('KeyW');
      await ticks(page, 20);
      await page.keyboard.up('KeyW');
      for (let i = 0; i < 3; i++) {
        await page.keyboard.down('Space');
        await ticks(page, 3);
        await page.keyboard.up('Space');
        await ticks(page, 14);
      }
      // creuser le bloc d'herbe sous ses pieds, à la main
      await ev(page, () => { const p = window.__game.player; T.aim(Math.floor(p.x) + 0.5, 3.99, Math.floor(p.z) - 1.5); });
      await ticks(page, 2);
      await ev(page, () => { window.__game.input.buttons[0] = true; });
      await ticks(page, 30);
      await ev(page, () => { window.__game.input.buttons[0] = false; });
      // fabriquer 4 planches dans la grille de l'inventaire (souris du menu)
      await page.keyboard.press('KeyE');
      await page.waitForSelector('[data-mc="menu-inventory"]', { timeout: 5000 });
      await ev(page, () => {
        const m = window.__game.menu;
        m.click(m.indexOf('main', 0), 0, false);
        m.click(m.indexOf('craft', 0), 0, false);
        m.click(m.indexOf('result', 0), 0, false);
        m.click(m.indexOf('main', 1), 0, false);
      });
      await page.keyboard.press('Escape');
      await sleep(200);
      // une poule vaincue à l'épée
      await ev(page, async () => {
        const M = await import('/src/entity/Mobs.ts');
        const g = window.__game, p = g.player;
        p.inventory.selected = 2;
        const c = M.createMob('chicken', g.rng);
        c.setPosition(p.x, p.y, p.z - 1.6);
        g.spawn(c);
        T.aim(c.x, c.y + 0.4, c.z);
      });
      await ticks(page, 3);
      await lclick(page);
      await ticks(page, 10);
      const after = await ev(page, () => ({ ...window.__game.stats }));
      const d = (k) => (after[k] ?? 0) - (before[k] ?? 0);
      const delta = { walk: d('walk_cm'), jumps: d('jumps'), grass: d('mined:2'), planks: d('crafted:39'), chicken: d('killed:chicken'), kills: d('mob_kills'), dealt: d('damage_dealt'), time: d('play_time') };
      check('statistiques : marche, sauts, bloc creusé, planches fabriquées, poule vaincue, temps de jeu',
        delta.walk > 100 && delta.jumps === 3 && delta.grass === 1 && delta.planks === 4 && delta.chicken === 1 && delta.kills === 1 && delta.dealt >= 4 && delta.time > 60, JSON.stringify(delta));
      // l'écran des statistiques, depuis la pause
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
      await click(page, 'stats');
      await page.waitForSelector('[data-mc="stats"]', { timeout: 5000 });
      const rows = async () => page.evaluate(() => [...document.querySelectorAll('[data-mc="stats-row"]')].map((r) => r.textContent));
      const general = await rows();
      await shot(page, '75-statistiques');
      await click(page, 'stats-tab-blocks');
      const blocks = await rows();
      await click(page, 'stats-tab-items');
      const items = await rows();
      await click(page, 'stats-tab-mobs');
      const mobs = await rows();
      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
      await page.keyboard.press('Escape');
      await sleep(200);
      check('écran Statistiques : général (13 lignes, sauts, échanges), blocs, objets et créatures',
        general.length === 13 && general.some((t) => t.startsWith('Échanges avec des villageois')) && general.some((t) => t.startsWith('Sauts')) && blocks.some((t) => t.includes("Bloc d'herbe")) && items.some((t) => t.includes('4 fabriqués'))
          && mobs.some((t) => t.startsWith('Poule') && t.includes('1 vaincu')),
        JSON.stringify({ general: general.slice(0, 5), blocks, items, mobs }));
      statMark = await ev(page, () => ({ ...window.__game.stats }));
    } finally {
      await page.keyboard.up('KeyW').catch(() => undefined);
      await ev(page, () => { window.__game.input.buttons[0] = false; }).catch(() => undefined);
    }
  });

  await section('sauvegarde et rechargement', async () => {
    const heldBefore = await ev(page, () => window.__game.player.inventory.slots.findIndex((s) => s && s.id === 386));
    // la carte a continué de se dessiner pendant les sections précédentes (bloc creusé, panneaux) : repère pris juste avant de quitter
    mapMark = await ev(page, () => {
      const g = window.__game;
      g.player.inventory.selected = 1; // la carte n'est plus tenue : elle ne change plus
      const m = g.maps.get(0);
      let sum = 0, painted = 0;
      for (let i = 0; i < m.colors.length; i++) { sum = (sum * 31 + m.colors[i]) >>> 0; if (m.colors[i]) painted++; }
      return { id: m.id, sum, painted };
    });
    await reload(page);
    const r = await ev(page, () => {
      const g = window.__game, w = g.world, inv = g.player.inventory;
      const k = inv.slots.findIndex((s) => s && s.id === 386);
      const map = k >= 0 ? g.maps.get(inv.slots[k].damage) : null;
      let sum = 0;
      if (map) for (let i = 0; i < map.colors.length; i++) sum = (sum * 31 + map.colors[i]) >>> 0;
      const signs = {};
      for (const be of w.blockEntities.values()) if (be.type === 'sign') signs[`${be.x},${be.y},${be.z}`] = { id: w.getBlock(be.x, be.y, be.z), meta: w.getMeta(be.x, be.y, be.z), lines: be.lines };
      return { slot: k, mapId: map?.id, sum, signs, stats: { ...g.stats } };
    });
    check('rechargement : la carte et ses pixels sont retrouvés', r.slot === heldBefore && mapMark && mapMark.painted > 5000 && r.mapId === mapMark.id && r.sum === mapMark.sum, JSON.stringify({ r: { slot: r.slot, id: r.mapId, sum: r.sum }, mapMark }));
    check('rechargement : les trois panneaux et leur texte sont retrouvés', JSON.stringify(r.signs) === JSON.stringify(signMark), JSON.stringify(r.signs));
    const keys = ['jumps', 'mined:2', 'crafted:39', 'killed:chicken', 'mob_kills'];
    check('rechargement : les statistiques sont retrouvées', statMark && keys.every((k) => r.stats[k] === statMark[k]) && r.stats.play_time >= statMark.play_time, JSON.stringify(keys.map((k) => [k, statMark?.[k], r.stats[k]])));
  });

  await section('casser un panneau', async () => {
    try {
      await calm(page);
      await ev(page, () => { const p = window.__game.player; p.teleport(40.5, 4, 40.2); p.inventory.selected = 0; T.aim(40.5, 4.9, 38.5); });
      await ticks(page, 3);
      const signsBefore = await ev(page, () => window.__game.signRenderer.signs.size);
      await ev(page, () => { window.__game.input.buttons[0] = true; });
      await ticks(page, 45);
      await ev(page, () => { window.__game.input.buttons[0] = false; });
      // aller ramasser le panneau tombé
      await ev(page, () => { window.__game.player.teleport(40.5, 4, 38.5); });
      await ticks(page, 30);
      const r = await ev(page, async () => {
        const { I } = await import('/src/world/Ids.ts');
        const g = window.__game, w = g.world;
        return { block: w.getBlock(40, 4, 38), be: !!w.getBlockEntity(40, 4, 38), visuals: g.signRenderer.signs.size, signs: g.player.inventory.count(I.SIGN) };
      });
      check('panneau cassé à la main : il disparaît avec son texte et redevient un panneau dans l\'inventaire',
        r.block === 0 && !r.be && r.visuals === signsBefore - 1 && r.signs === 2, JSON.stringify({ signsBefore, ...r }));
    } finally {
      await ev(page, () => { window.__game.input.buttons[0] = false; }).catch(() => undefined);
    }
  });

  await section('Nether : boussole et horloge s\'affolent', async () => {
    try {
      const r = await ev(page, async () => {
        const g = window.__game, p = g.player;
        await g.switchDimension('nether', p.x, p.z);
        const seen = new Set();
        const seenClock = new Set();
        for (let i = 0; i < 40; i++) { g.tick(); seen.add(g.dynamicTile(317)); seenClock.add(g.dynamicTile(318)); }
        const dim = g.dimension;
        await g.switchDimension('overworld', p.x, p.z);
        return { dim, compass: seen.size, clock: seenClock.size, back: g.dimension };
      });
      check('Nether : l\'aiguille et le cadran tournent au hasard', r.dim === 'nether' && r.compass >= 6 && r.clock >= 6 && r.back === 'overworld', JSON.stringify(r));
    } catch (e) {
      check('Nether : passage', false, String(e));
    }
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const bad = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - bad.length}/${results.length} vérifications passées`);
  for (const r of bad) console.log('  ÉCHEC :', r.name, '—', r.detail);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('ERREUR FATALE', e); process.exit(2); });
