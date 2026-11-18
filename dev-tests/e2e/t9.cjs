// Batterie « Équipement » (points 25 à 29) : seconde main, bouclier, chaudron, gâteau, alambic et potions.
const { sleep, launch, openPage, click, createWorld, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, rclick, lclick, section } = require('./h.cjs');

async function helpers(page) {
  await install(page);
  await ev(page, async () => {
    const { B, I } = await import('/src/world/Ids.ts');
    const { makeStack } = await import('/src/world/ItemStack.ts');
    const g = window.__game;
    window.B = B;
    window.I = I;
    window.makeStack = makeStack;
    window.M = {
      mode: (m) => { g.player.gameMode = m; if (m === 'survival') g.player.flying = false; },
      heal: () => { const p = g.player; p.health = 20; p.hunger = 20; p.invulnerable = 0; p.clearEffects(); p.fireTicks = 0; p.fallDistance = 0; },
    };
  });
}

async function reload(page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
  await sleep(150);
  await click(page, 'quit');
  await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
  await click(page, 'play');
  await page.waitForSelector('[data-mc="world-play"]', { timeout: 10000 });
  await click(page, 'world-play');
  await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
  await helpers(page);
  await ticks(page, 10);
}

(async () => {
  const browser = await launch();
  const errors = [];
  const page = await openPage(browser, errors);

  await createWorld(page, { name: 'Equipement', seed: '1337', flat: true });
  await helpers(page);
  await ticks(page, 10);

  // ========================================================================= 26. Seconde main
  await section('seconde main', async () => {
    await ev(page, () => {
      const p = window.__game.player;
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.DIAMOND_PICKAXE, 1);
      p.inventory.slots[1] = makeStack(B.TORCH, 8);
      p.inventory.selected = 0;
    });

    // Case dédiée dans l'écran d'inventaire + touche F
    await page.keyboard.press('KeyE');
    await page.waitForSelector('[data-mc="menu-inventory"]', { timeout: 5000 });
    const hasOffhandSlot = await ev(page, () => !!document.querySelector('[data-group="offhand"]'));
    check('seconde main : case dédiée présente dans l\'inventaire', hasOffhandSlot);
    await page.keyboard.press('Escape');
    await ticks(page, 2);

    // Touche F échange main principale et seconde main
    await ev(page, () => { window.__game.player.inventory.selected = 1; });
    await ticks(page, 2);
    await page.keyboard.press('KeyF');
    await ticks(page, 3);
    const afterF = await ev(page, () => {
      const g = window.__game, p = g.player;
      return {
        ok: p.heldItemId === 0 && p.offhandItemId === B.TORCH && g.hand.offTargetId === B.TORCH && p.offhandId === B.TORCH,
        heldId: p.heldItemId,
        offId: p.offhandItemId,
        handOff: g.hand.offTargetId,
        entityOff: p.offhandId,
      };
    });
    check('seconde main : touche F échange main principale et seconde main et met à jour le rendu',
      afterF.ok,
      JSON.stringify(afterF));

    // Clic droit : main principale (pioche) n'a rien à faire -> seconde main (torche) pose le bloc
    await ev(page, () => {
      const g = window.__game, p = g.player;
      p.inventory.selected = 0;
      p.teleport(10.5, 4, 10.5);
      T.aim(12.5, 3.8, 10.5);
    });
    await ticks(page, 3);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t9-torche-gauche.png' });
    await rclick(page);
    await ticks(page, 3);
    const torchPlaced = await ev(page, () => ({ ok: T.block(12, 4, 10) === B.TORCH, bloc: T.block(12, 4, 10) }));
    check('seconde main : clic droit utilise la seconde main si la principale n\'a rien à faire', torchPlaced.ok, `bloc=${torchPlaced.bloc}`);

    // Main principale prioritaire : avec un bloc en main principale, c'est lui qui est posé
    await ev(page, () => {
      window.__game.player.inventory.slots[2] = makeStack(B.COBBLESTONE, 4);
      window.__game.player.inventory.selected = 2;
      T.aim(10.5, 3.8, 12.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);
    const cobblePlaced = await ev(page, () => ({ ok: T.block(10, 4, 12) === B.COBBLESTONE, bloc: T.block(10, 4, 12) }));
    check('seconde main : la main principale reste prioritaire au clic droit', cobblePlaced.ok, `bloc=${cobblePlaced.bloc}`);

    // Tombe à la mort comme le reste de l'inventaire, en conservant sorte de potion et enchantements
    const droppedOnDeath = await ev(page, () => {
      const g = window.__game, p = g.player;
      for (const e of g.entities) if (e.kind === 'item') e.dead = true;
      p.inventory.clear();
      p.inventory.offhand[0] = makeStack(I.SHIELD, 1);
      p.inventory.slots[0] = makeStack(I.POTION, 1, 0, undefined, 'healing');
      p.inventory.slots[1] = makeStack(I.SPLASH_POTION, 1, 0, undefined, 'speed');
      p.inventory.slots[2] = makeStack(I.DIAMOND_SWORD, 1, 0, { sharpness: 3 });
      p.hurt(g, 100, 'void');
      const ground = g.entities.filter((e) => e.kind === 'item' && !e.dead).map((e) => ({
        id: e.stack.id,
        potion: e.stack.potion ?? null,
        sharpness: e.stack.enchants?.sharpness ?? 0,
      }));
      return {
        dead: !p.alive,
        offAfter: p.offhandItemId,
        hasShieldDrop: ground.some((x) => x.id === I.SHIELD),
        hasHealingPotion: ground.some((x) => x.id === I.POTION && x.potion === 'healing'),
        hasSpeedSplash: ground.some((x) => x.id === I.SPLASH_POTION && x.potion === 'speed'),
        hasEnchantedSword: ground.some((x) => x.id === I.DIAMOND_SWORD && x.sharpness === 3),
        ground,
      };
    });
    check('seconde main : l\'objet en seconde main tombe à la mort', droppedOnDeath.dead && droppedOnDeath.offAfter === 0 && droppedOnDeath.hasShieldDrop, JSON.stringify(droppedOnDeath));
    check('mort du joueur : une potion garde sa sorte et un objet enchanté garde ses enchantements au sol',
      droppedOnDeath.hasHealingPotion && droppedOnDeath.hasSpeedSplash && droppedOnDeath.hasEnchantedSword,
      JSON.stringify(droppedOnDeath.ground));
    await page.waitForSelector('[data-mc="respawn"]:not([disabled])', { timeout: 15000 });
    await click(page, 'respawn');
    await ticks(page, 5);
    await ev(page, () => M.heal());
  });

  // ========================================================================= 25. Bouclier
  await section('bouclier', async () => {
    // Recette + réparation à l'enclume
    const craftAndAnvil = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const { computeAnvilResult } = await import('/src/world/Enchants.ts');
      const r = matchRecipe([B.OAK_PLANKS, I.IRON_INGOT, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, 0, B.OAK_PLANKS, 0], 3);
      const damaged = makeStack(I.SHIELD, 1, 100);
      const repaired = computeAnvilResult(damaged, makeStack(B.OAK_PLANKS, 2));
      return {
        craftOk: r?.id === I.SHIELD && r.count === 1,
        maxDur: (await import('/src/world/Items.ts')).getItem(I.SHIELD).durability,
        repairedDmg: repaired?.result.damage ?? -1,
      };
    });
    check('bouclier : recette 6 planches + 1 fer, 336 durabilité et réparable à l\'enclume',
      craftAndAnvil.craftOk && craftAndAnvil.maxDur === 336 && craftAndAnvil.repairedDmg < 100,
      JSON.stringify(craftAndAnvil));

    // Garde après 5 ticks, ralentissement, protection frontale, non-protection dos/chute/feu/noyade/faim/poison/vide, usure coup >= 3
    const { t4, t6 } = await ev(page, () => {
      const g = window.__game, p = g.player;
      p.inventory.clear();
      p.inventory.offhand[0] = makeStack(I.SHIELD, 1);
      p.teleport(20.5, 4, 20.5);
      p.yaw = 0; p.pitch = 0;
      g.input.buttons[2] = true;
      for (let i = 0; i < 4; i++) g.tick();
      const t4 = { useKind: p.useKind, blocking: p.blocking };
      for (let i = 0; i < 2; i++) g.tick();
      const t6 = { useKind: p.useKind, blocking: p.blocking };
      return { t4, t6 };
    });
    await ticks(page, 4);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t9-bouclier-1p.png' });

    // Vérification géométrique de la projection à l'écran : le bouclier levé est à gauche et laisse le centre (0,0) dégagé
    const screenProj = await ev(page, () => {
      const g = window.__game;
      const cam = g.hand.camera;
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      const mat = g.hand.offHolder.matrix;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const lx of [-0.5, 0.5]) {
        for (const ly of [-0.5, 0.5]) {
          for (const lz of [-0.05, 0.05]) {
            const pt = cam.position.clone().set(lx, ly, lz).applyMatrix4(mat).project(cam);
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }
        }
      }
      const center = cam.position.clone().set(0, 0, 0).applyMatrix4(mat).project(cam);
      return {
        centerX: +center.x.toFixed(3),
        centerY: +center.y.toFixed(3),
        minX: +minX.toFixed(3),
        maxX: +maxX.toFixed(3),
        minY: +minY.toFixed(3),
        maxY: +maxY.toFixed(3),
        centerClear: maxX < -0.1 && maxY < 0.65 && center.x > -0.9 && center.x < -0.3 && center.y > -0.9 && center.y < -0.1,
      };
    });
    check('seconde main à l\'écran : le bouclier levé reste à gauche et laisse le centre de l\'image visible',
      screenProj.centerClear,
      JSON.stringify(screenProj));

    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await ticks(page, 2);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t9-bouclier-f5.png' });
    await page.keyboard.press('F5');

    const shieldResult = await ev(page, async (t4, t6) => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const { Arrow } = await import('/src/entity/Objects.ts');
      const g = window.__game, p = g.player;
      const zFront = createMob('zombie');
      zFront.setPosition(p.x, p.y, p.z - 2); // devant (yaw 0 => -z)
      const hp0 = p.health;
      const blockedFront = !p.hurt(g, 5, 'attack', zFront);
      const dmgAfter5 = p.inventory.offhandItem?.damage ?? -1;

      const arr = new Arrow();
      arr.owner = zFront;
      arr.shoot(p.x, p.y + 1.2, p.z - 3, 0, 0, 1, 2, 0, g.rng);
      g.spawn(arr);
      for (let i = 0; i < 6; i++) g.tick();
      const arrowBlocked = p.health === hp0 && arr.vz < 0;

      const zBack = createMob('zombie');
      zBack.setPosition(p.x, p.y, p.z + 2); // derrière
      const hitBack = p.hurt(g, 3, 'attack', zBack);
      p.invulnerable = 0;

      const fallHit = p.hurt(g, 2, 'fall'); p.invulnerable = 0;
      const fireHit = p.hurt(g, 2, 'fire'); p.invulnerable = 0;
      const drownHit = p.hurt(g, 2, 'drown'); p.invulnerable = 0;
      const magicHit = p.hurt(g, 2, 'magic'); p.invulnerable = 0;
      g.input.buttons[2] = false;
      p.stopUsing();
      return {
        t4Block: t4.blocking,
        t6Block: t6.blocking,
        blockedFront,
        dmgAfter5,
        arrowBlocked,
        hitBack,
        bypassed: fallHit && fireHit && drownHit && magicHit,
      };
    }, t4, t6);
    check('bouclier : protège après 5 ticks, pare devant (coup + flèche), use de coup+1, laisse passer dos/chute/feu/noyade/magie',
      !t4.blocking && t6.blocking && shieldResult.blockedFront && shieldResult.dmgAfter5 === 6 &&
      shieldResult.arrowBlocked && shieldResult.hitBack && shieldResult.bypassed,
      JSON.stringify(shieldResult));

    // Bouclier en main principale + casse à bout d'usure
    const mainHandAndBreak = await ev(page, async () => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game, p = g.player;
      M.heal();
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.SHIELD, 1, 333);
      p.inventory.selected = 0;
      p.yaw = 0; p.pitch = 0;
      g.input.buttons[2] = true;
      for (let i = 0; i < 6; i++) g.tick();
      const blockingMain = p.blocking;
      const z = createMob('zombie');
      z.setPosition(p.x, p.y, p.z - 2);
      const blocked = !p.hurt(g, 5, 'attack', z);
      const broken = p.inventory.slots[0] === null;
      g.input.buttons[2] = false;
      p.stopUsing();
      return { blockingMain, blocked, broken };
    });
    check('bouclier : fonctionne en main principale et casse à bout d\'usure',
      mainHandAndBreak.blockingMain && mainHandAndBreak.blocked && mainHandAndBreak.broken,
      JSON.stringify(mainHandAndBreak));
    await ev(page, () => M.heal());
  });

  // ========================================================================= 28. Chaudron
  await section('chaudron', async () => {
    const craftBottleCauldron = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const c = matchRecipe([I.IRON_INGOT, 0, I.IRON_INGOT, I.IRON_INGOT, 0, I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT], 3);
      const b = matchRecipe([B.GLASS, 0, B.GLASS, 0, B.GLASS, 0, 0, 0, 0], 3);
      return { cauldron: c?.id === B.CAULDRON, bottle: b?.id === I.GLASS_BOTTLE && b.count === 3 };
    });
    check('chaudron & fiole : recettes chaudron (7 fer) et fiole (3 verres → 3)', craftBottleCauldron.cauldron && craftBottleCauldron.bottle, JSON.stringify(craftBottleCauldron));

    // Pose des 3 niveaux pour capture, puis test seau, fiole, pluie et extinction
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(30, 4, 30, B.CAULDRON, 1);
      w.setBlock(32, 4, 30, B.CAULDRON, 2);
      w.setBlock(34, 4, 30, B.CAULDRON, 3);
      w.setBlock(32, 4, 34, B.STONE, 0);
      p.teleport(32.5, 5, 34.5);
      T.aim(32.5, 4.4, 30.5);
    });
    await ticks(page, 6);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t9-chaudron-niveaux.png' });

    // Remplissage au seau d'eau -> niveau 3 + seau vide ; puis fiole vide -> niveau 2 + fiole d'eau ; fiole d'eau -> niveau 3
    await ev(page, () => {
      const g = window.__game, p = g.player;
      g.world.setBlock(32, 4, 30, B.CAULDRON, 0);
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.WATER_BUCKET, 1);
      p.inventory.selected = 0;
      p.teleport(32.5, 4, 32.5);
      T.aim(32.5, 4.8, 30.95);
    });
    await ticks(page, 2);
    await sleep(60);
    await rclick(page);
    await ticks(page, 2);
    const afterWaterBucket = await ev(page, () => ({ meta: window.__game.world.getMeta(32, 4, 30), heldBucket: window.__game.player.heldItemId === I.BUCKET, hit: window.__game.interaction.hit.id }));

    await ev(page, () => {
      const p = window.__game.player;
      p.inventory.slots[1] = makeStack(I.GLASS_BOTTLE, 1);
      p.inventory.selected = 1;
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);
    const afterBottleTake = await ev(page, () => ({
      meta: window.__game.world.getMeta(32, 4, 30),
      potion: window.__game.player.inventory.slots.find((s) => s?.id === I.POTION)?.potion ?? null,
    }));

    await ev(page, () => {
      const p = window.__game.player;
      const idx = p.inventory.slots.findIndex((s) => s?.id === I.POTION);
      p.inventory.selected = idx >= 0 ? idx : 0;
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);
    const afterBottlePut = await ev(page, () => ({
      meta: window.__game.world.getMeta(32, 4, 30),
      heldBottle: window.__game.player.heldItemId === I.GLASS_BOTTLE,
    }));

    // Extinction d'une créature en feu + pluie
    const fireAndRain = await ev(page, async () => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const { randomTick } = await import('/src/world/Behavior.ts');
      const g = window.__game, w = g.world;
      const pig = createMob('pig');
      pig.setPosition(32.5, 4.25, 30.5);
      pig.fireTicks = 100;
      g.spawn(pig);
      g.tick();
      const extinguished = pig.fireTicks === 0 && w.getMeta(32, 4, 30) === 2;
      pig.dead = true;
      w.setMeta(32, 4, 30, 0);
      w.raining = true;
      for (let i = 0; i < 200 && w.getMeta(32, 4, 30) === 0; i++) randomTick(w, 32, 4, 30, B.CAULDRON, 0);
      const rainLevel = w.getMeta(32, 4, 30);
      w.raining = false;
      return { extinguished, rainLevel };
    });

    check('chaudron : seau d\'eau, fiole vide/eau, extinction et remplissage sous la pluie',
      afterWaterBucket.meta === 3 && afterWaterBucket.heldBucket &&
      afterBottleTake.meta === 2 && afterBottleTake.potion === 'water' &&
      afterBottlePut.meta === 3 && afterBottlePut.heldBottle &&
      fireAndRain.extinguished && fireAndRain.rainLevel >= 1,
      JSON.stringify({ afterWaterBucket, afterBottleTake, afterBottlePut, fireAndRain }));
  });

  // ========================================================================= 29. Gâteau
  await section('gâteau', async () => {
    // Recette avec seaux de lait rendus vides dans la grille
    await ev(page, () => {
      const p = window.__game.player;
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(B.CRAFTING_TABLE, 1);
      p.inventory.slots[1] = makeStack(I.MILK_BUCKET, 1);
      p.inventory.slots[2] = makeStack(I.MILK_BUCKET, 1);
      p.inventory.slots[3] = makeStack(I.MILK_BUCKET, 1);
      p.inventory.slots[4] = makeStack(I.SUGAR, 2);
      p.inventory.slots[5] = makeStack(I.EGG, 1);
      p.inventory.slots[6] = makeStack(I.WHEAT, 3);
      p.inventory.selected = 0;
      p.teleport(40.5, 4, 40.5);
      T.aim(42.5, 3.8, 40.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ev(page, () => { T.aim(42.5, 4.5, 40.5); });
    await ticks(page, 2);
    await rclick(page);
    await page.waitForSelector('[data-mc="menu-crafting"]', { timeout: 5000 });
    const craftCake = await ev(page, () => {
      const m = window.__game.ui.screen?.menu;
      if (!m) return { ok: false };
      const grid = m.group('craft');
      const res = m.group('result')[0];
      const inv = [...m.group('hotbar'), ...m.group('main')];
      const idxOf = (sl) => m.slots.indexOf(sl);
      const placeId = (id, toSlot) => {
        const src = inv.find((s) => s.stack?.id === id);
        if (!src) return;
        m.click(idxOf(src), 0, false);
        m.click(idxOf(toSlot), 1, false);
        if (m.inv.cursor) m.click(idxOf(src), 0, false);
      };
      placeId(I.MILK_BUCKET, grid[0]); placeId(I.MILK_BUCKET, grid[1]); placeId(I.MILK_BUCKET, grid[2]);
      placeId(I.SUGAR, grid[3]); placeId(I.EGG, grid[4]); placeId(I.SUGAR, grid[5]);
      placeId(I.WHEAT, grid[6]); placeId(I.WHEAT, grid[7]); placeId(I.WHEAT, grid[8]);
      const resultId = res.stack?.id ?? 0;
      m.click(idxOf(res), 0, true);
      const remainders = [grid[0].stack?.id, grid[1].stack?.id, grid[2].stack?.id];
      return { ok: resultId === B.CAKE && remainders.every((x) => x === I.BUCKET), resultId, remainders };
    });
    await page.keyboard.press('Escape');
    await ticks(page, 2);
    check('gâteau : recette 3 laits (rendus seaux vides) + 2 sucres + 1 œuf + 3 blés', craftCake.ok, JSON.stringify(craftCake));

    // Pose, faim pleine refusée, 7 parts (+2 faim, +0.4 saturation), rétrécissement, cassé ne rend rien
    await ev(page, () => {
      const p = window.__game.player;
      const idx = p.inventory.slots.findIndex((s) => s?.id === B.CAKE);
      p.inventory.selected = idx >= 0 ? idx : 0;
      T.aim(40.5, 3.8, 38.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);
    // Faim pleine -> refusé
    await ev(page, () => { const p = window.__game.player; p.hunger = 20; T.aim(40.5, 4.3, 38.5); });
    await ticks(page, 2);
    await rclick(page);
    const fullBlocked = await ev(page, () => window.__game.world.getMeta(40, 4, 38) === 0);

    // Manger 3 parts puis capture, puis finir les 7 parts (viser le côté restant du gâteau : x = 40.88)
    await ev(page, () => { const p = window.__game.player; p.hunger = 2; p.saturation = 0; T.aim(40.88, 4.25, 38.5); });
    await rclick(page);
    await ticks(page, 2);
    const after1 = await ev(page, () => ({ hunger: window.__game.player.hunger, sat: +window.__game.player.saturation.toFixed(2), meta: window.__game.world.getMeta(40, 4, 38) }));
    await rclick(page);
    await rclick(page);
    await ticks(page, 3);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t9-gateau-entame.png' });
    const boxShrank = await ev(page, async () => {
      const { collisionBoxes } = await import('/src/world/BlockModels.ts');
      const box = [];
      collisionBoxes(B.CAKE, window.__game.world.getMeta(40, 4, 38), () => 0, box);
      return box[0] === 7; // 1 + 3 * 2 = 7
    });
    for (let i = 0; i < 4; i++) await rclick(page);
    await ticks(page, 2);
    const after7 = await ev(page, () => window.__game.world.getBlock(40, 4, 38) === 0);

    // Cassé -> aucun butin
    const breakNoDrop = await ev(page, () => {
      const g = window.__game;
      g.world.setBlock(40, 4, 38, B.CAKE, 0);
      const before = g.entities.filter((e) => e.kind === 'item' && !e.dead).length;
      g.world.breakBlock(40, 4, 38, true);
      const after = g.entities.filter((e) => e.kind === 'item' && !e.dead).length;
      return after === before;
    });

    check('gâteau : refusé faim pleine, 7 parts (+2 faim, +0.4 sat), rétrécit et cassé sans butin',
      fullBlocked && after1.hunger === 4 && after1.sat === 0.4 && after1.meta === 1 && boxShrank && after7 && breakNoDrop,
      JSON.stringify({ fullBlocked, after1, boxShrank, after7, breakNoDrop }));
  });

  // ========================================================================= 27. Alambic et potions
  await section('alambic et potions', async () => {
    // Recettes carotte dorée, pastèque scintillante, alambic, larme de ghast sur ghast
    const recipesAndDrop = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const { createMob } = await import('/src/entity/Mobs.ts');
      const stand = matchRecipe([0, I.BLAZE_ROD, 0, B.COBBLESTONE, B.COBBLESTONE, B.COBBLESTONE, 0, 0, 0], 3);
      const gCarrot = matchRecipe([I.GOLD_NUGGET, I.GOLD_NUGGET, I.GOLD_NUGGET, I.GOLD_NUGGET, I.CARROT, I.GOLD_NUGGET, I.GOLD_NUGGET, I.GOLD_NUGGET, I.GOLD_NUGGET], 3);
      const gMelon = matchRecipe([I.GOLD_NUGGET, I.GOLD_NUGGET, I.GOLD_NUGGET, I.GOLD_NUGGET, I.MELON_SLICE, I.GOLD_NUGGET, I.GOLD_NUGGET, I.GOLD_NUGGET, I.GOLD_NUGGET], 3);
      const g = window.__game;
      g.difficulty = 2;
      const gh = createMob('ghast');
      gh.setPosition(42, 6, 42);
      g.spawn(gh);
      g.tick();
      gh.hurt(g, 50, 'attack', g.player);
      for (let i = 0; i < 25; i++) g.tick();
      const hasTear = g.entities.some((e) => e.kind === 'item' && !e.dead && e.itemId === I.GHAST_TEAR) || g.player.inventory.count(I.GHAST_TEAR) > 0;
      return { stand: stand?.id === B.BREWING_STAND, gCarrot: gCarrot?.id === I.GOLDEN_CARROT, gMelon: gMelon?.id === I.GLISTERING_MELON, hasTear };
    });
    check('potions : recettes alambic, carotte dorée, pastèque scintillante et larme de ghast',
      recipesAndDrop.stand && recipesAndDrop.gCarrot && recipesAndDrop.gMelon && recipesAndDrop.hasTear,
      JSON.stringify(recipesAndDrop));

    // Pose alambic, ouverture, maj-clic depuis l'inventaire, distillation 400 ticks (water -> awkward -> speed -> speed_2 + splash)
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(50, 4, 50, B.BREWING_STAND, 0);
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.POTION, 1, 0, undefined, 'water');
      p.inventory.slots[1] = makeStack(I.POTION, 1, 0, undefined, 'water');
      p.inventory.slots[2] = makeStack(I.NETHER_WART, 1);
      p.inventory.slots[3] = makeStack(I.BLAZE_POWDER, 1);
      p.inventory.selected = 5;
      p.teleport(50.5, 4, 52.5);
      T.aim(50.5, 4.5, 50.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await page.waitForSelector('[data-mc="menu-brewing"]', { timeout: 5000 });
    const shiftFill = await ev(page, () => {
      const g = window.__game, m = g.ui.screen?.menu;
      if (!m) return { ok: false };
      const inv = [...m.group('hotbar'), ...m.group('main')];
      for (const id of [I.POTION, I.POTION, I.NETHER_WART, I.BLAZE_POWDER]) {
        const src = inv.find((s) => s.stack && s.stack.id === id);
        if (src) m.click(m.slots.indexOf(src), 0, true);
      }
      const b0 = m.stand.items[0]?.potion === 'water';
      const b1 = m.stand.items[1]?.potion === 'water';
      const ing = m.stand.items[3]?.id === I.NETHER_WART;
      const fuelSlot = m.stand.items[4]?.id === I.BLAZE_POWDER;
      for (let i = 0; i < 200; i++) g.tick();
      return { ok: b0 && b1 && ing && fuelSlot, b0, b1, ing, fuelSlot };
    });
    check('alambic : l\'écran se remplit au maj-clic depuis l\'inventaire', shiftFill.ok, JSON.stringify(shiftFill));
    await ticks(page, 2);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t9-alambic-ecran.png' });

    const brewChain = await ev(page, async () => {
      const { brewResult } = await import('/src/world/Potions.ts');
      const g = window.__game;
      const m = g.ui.screen?.menu;
      for (let i = 0; i < 205; i++) g.tick();
      const awkwardPotion = m?.stand.items[0]?.potion ?? null;
      const fuelAfter1 = m?.stand.fuel ?? -1;

      const sSpeed = brewResult(m.stand.items[0], I.SUGAR);
      const sHeal = brewResult(m.stand.items[0], I.GLISTERING_MELON);
      const sNV = brewResult(m.stand.items[0], I.GOLDEN_CARROT);
      const sStr = brewResult(m.stand.items[0], I.BLAZE_POWDER);
      const sFire = brewResult(m.stand.items[0], I.MAGMA_CREAM);
      const sPois = brewResult(m.stand.items[0], I.SPIDER_EYE);
      const sRegen = brewResult(m.stand.items[0], I.GHAST_TEAR);
      const sLong = brewResult(sSpeed, I.REDSTONE);
      const sLvl2 = brewResult(sHeal, I.GLOWSTONE_DUST);
      const sSplash = brewResult(sSpeed, I.GUNPOWDER);
      return {
        awkwardPotion,
        fuelAfter1,
        allVariants: sSpeed?.potion === 'speed' && sHeal?.potion === 'healing' && sNV?.potion === 'night_vision' &&
          sStr?.potion === 'strength' && sFire?.potion === 'fire_resistance' && sPois?.potion === 'poison' &&
          sRegen?.potion === 'regeneration' && sLong?.potion === 'speed_long' && sLvl2?.potion === 'healing_2' &&
          sSplash?.id === I.SPLASH_POTION && sSplash?.potion === 'speed',
      };
    });
    await page.keyboard.press('Escape');
    await ticks(page, 2);
    check('alambic : distillation en 400 ticks (carburant 20), chaîne complète + variantes + splash',
      brewChain.awkwardPotion === 'awkward' && brewChain.fuelAfter1 === 19 && brewChain.allVariants,
      JSON.stringify(brewChain));

    // Casse de l'alambic à la pioche (rend le bloc + les potions avec leur sorte, et retire l'entité de bloc) + casse d'un coffre avec potion
    const breakContainers = await ev(page, async () => {
      const { getBrewingStand, getChest } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world, p = g.player;
      for (const e of g.entities) if (e.kind === 'item') e.dead = true;
      const b = getBrewingStand(w, 50, 4, 50);
      b.items = [makeStack(I.POTION, 1, 0, undefined, 'strength'), null, null, null, null];
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.DIAMOND_PICKAXE, 1);
      p.inventory.selected = 0;
      p.teleport(50.5, 4, 52.2);
      T.aim(50.5, 4.3, 50.5);
      g.input.buttons[0] = true;
      for (let i = 0; i < 40 && w.getBlock(50, 4, 50) !== B.AIR; i++) g.tick();
      g.input.buttons[0] = false;
      const standDrops = g.entities.filter((e) => e.kind === 'item' && !e.dead).map((e) => ({ id: e.stack.id, potion: e.stack.potion ?? null }));
      const standBeAfter = w.getBlockEntity(50, 4, 50) ?? null;

      for (const e of g.entities) if (e.kind === 'item') e.dead = true;
      w.setBlock(52, 4, 50, B.CHEST, 0);
      getChest(w, 52, 4, 50).items[0] = makeStack(I.POTION, 1, 0, undefined, 'regeneration');
      w.breakBlock(52, 4, 50, true);
      const chestDrops = g.entities.filter((e) => e.kind === 'item' && !e.dead).map((e) => ({ id: e.stack.id, potion: e.stack.potion ?? null }));
      return {
        standBroken: w.getBlock(50, 4, 50) === B.AIR,
        hasStandBlock: standDrops.some((d) => d.id === B.BREWING_STAND),
        hasStrengthPotion: standDrops.some((d) => d.id === I.POTION && d.potion === 'strength'),
        noStandEntityLeft: standBeAfter === null,
        hasRegenFromChest: chestDrops.some((d) => d.id === I.POTION && d.potion === 'regeneration'),
        standDrops,
        chestDrops,
      };
    });
    check('alambic : cassé à la pioche, rend l\'alambic et son contenu (potion avec sa sorte) et retire son entité de bloc',
      breakContainers.standBroken && breakContainers.hasStandBlock && breakContainers.hasStrengthPotion && breakContainers.noStandEntityLeft,
      JSON.stringify(breakContainers));
    check('coffre : une potion garde sa sorte après la casse d\'un coffre',
      breakContainers.hasRegenFromChest,
      JSON.stringify(breakContainers.chestDrops));

    // Soin (même faim pleine), lait qui dissipe tous les effets, rapidité (+20 % distance) et force (+3 par niveau)
    const effectsGameplay = await ev(page, async () => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game, p = g.player;
      M.heal();
      p.teleport(55.5, 4, 55.5);
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.POTION, 1, 0, undefined, 'healing');
      p.inventory.selected = 0;
      p.health = 10;
      p.hunger = 20;
      g.input.buttons[2] = true;
      for (let i = 0; i < 35; i++) g.tick();
      g.input.buttons[2] = false;
      p.stopUsing();
      const healthAfterHeal = p.health;
      const bottleAfterHeal = p.heldItemId === I.GLASS_BOTTLE;

      p.addEffect('strength', 2000, 2);
      p.addEffect('night_vision', 2000, 1);
      p.addEffect('speed', 2000, 1);
      p.inventory.slots[0] = makeStack(I.MILK_BUCKET, 1);
      g.input.buttons[2] = true;
      for (let i = 0; i < 35; i++) g.tick();
      g.input.buttons[2] = false;
      p.stopUsing();
      const effectsAfterMilk = p.effects.size;
      const bucketAfterMilk = p.heldItemId === I.BUCKET;

      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.DIAMOND_SWORD, 1);
      p.inventory.selected = 0;
      const hitZombie = () => {
        const z = createMob('zombie');
        z.setPosition(p.x, p.y, p.z - 2);
        g.spawn(z);
        const hp0 = z.health;
        g.interaction.attack(z);
        const dmg = hp0 - z.health;
        z.dead = true;
        return dmg;
      };
      const dmgBase = hitZombie();
      p.attackCooldown = 0;
      for (let i = 0; i < 25; i++) g.tick();
      p.addEffect('strength', 2000, 2);
      const dmgStr2 = hitZombie();
      p.clearEffects();
      return { healthAfterHeal, bottleAfterHeal, effectsAfterMilk, bucketAfterMilk, dmgBase, dmgStr2 };
    });
    check('potions : la potion de soin rend de la vie (même faim pleine) et le lait retire tous les effets',
      effectsGameplay.healthAfterHeal === 14 && effectsGameplay.bottleAfterHeal &&
      effectsGameplay.effectsAfterMilk === 0 && effectsGameplay.bucketAfterMilk,
      JSON.stringify(effectsGameplay));

    const walkDist = async () => {
      await ev(page, () => {
        const p = window.__game.player;
        p.teleport(40.5, 4, 80.5);
        p.yaw = 0; p.pitch = 0; p.vx = 0; p.vz = 0;
      });
      await ticks(page, 4);
      const z0 = await ev(page, () => window.__game.player.z);
      await page.keyboard.down('KeyW');
      await ticks(page, 40);
      await page.keyboard.up('KeyW');
      const z1 = await ev(page, () => window.__game.player.z);
      return +(z0 - z1).toFixed(2);
    };
    await ev(page, () => M.heal());
    const distNoSpeed = await walkDist();
    await ev(page, () => window.__game.player.addEffect('speed', 2000, 1));
    const distWithSpeed = await walkDist();
    await ev(page, () => M.heal());
    check('potions : la rapidité allonge la distance parcourue et la force augmente les dégâts d\'un coup',
      distWithSpeed > distNoSpeed * 1.12 && effectsGameplay.dmgStr2 === effectsGameplay.dmgBase + 6,
      JSON.stringify({ distNoSpeed, distWithSpeed, dmgBase: effectsGameplay.dmgBase, dmgStr2: effectsGameplay.dmgStr2 }));

    // /give potion <sorte>, /give splash_potion <sorte> et potions dans la palette créative
    const giveAndCreative = await ev(page, async () => {
      const { CREATIVE_TABS } = await import('/src/world/Items.ts');
      const { POTION_KEYS, SPLASH_POTION_KEYS } = await import('/src/world/Potions.ts');
      const g = window.__game, p = g.player;
      p.inventory.clear();
      g.chat('/give potion soin');
      g.chat('/give splash_potion vision_nocturne');
      const gotHeal = p.inventory.slots.some((s) => s?.id === I.POTION && s.potion === 'healing');
      const gotSplashNV = p.inventory.slots.some((s) => s?.id === I.SPLASH_POTION && s.potion === 'night_vision');
      const allStacks = CREATIVE_TABS.flatMap((t) => t.stacks);
      const hasAllDrinkable = POTION_KEYS.every((k) => allStacks.some((s) => s.id === I.POTION && s.potion === k));
      const hasAllSplash = SPLASH_POTION_KEYS.every((k) => allStacks.some((s) => s.id === I.SPLASH_POTION && s.potion === k));
      return { gotHeal, gotSplashNV, hasAllDrinkable, hasAllSplash };
    });
    check('commandes et créatif : /give potion <sorte>, /give splash_potion <sorte> et toutes les potions dans la palette créative',
      giveAndCreative.gotHeal && giveAndCreative.gotSplashNV && giveAndCreative.hasAllDrinkable && giveAndCreative.hasAllSplash,
      JSON.stringify(giveAndCreative));

    // Boire potion en 32 ticks -> rend fiole vide + HUD effets + vision nocturne dans une grotte noire
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      for (let x = 58; x <= 64; x++) {
        for (let z = 58; z <= 64; z++) {
          for (let y = 4; y <= 7; y++) {
            const wall = x === 58 || x === 64 || z === 58 || z === 64 || y === 7;
            w.setBlock(x, y, z, wall ? B.STONE : B.AIR, 0, false);
          }
        }
      }
      p.teleport(61.5, 4, 61.5);
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.POTION, 1, 0, undefined, 'night_vision');
      p.inventory.selected = 0;
    });
    await ticks(page, 6);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t9-grotte-avant.png' });
    const ambBefore = await ev(page, async () => (await import('/src/render/ChunkMaterials.ts')).worldUniforms.uAmbient.value);

    // Maintenir clic droit 32 ticks pour boire
    await ev(page, () => { window.__game.input.buttons[2] = true; });
    await ticks(page, 34);
    await ev(page, () => { window.__game.input.buttons[2] = false; });
    await ticks(page, 4);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t9-grotte-apres.png' });
    const drinkAndNV = await ev(page, async () => {
      const { worldUniforms } = await import('/src/render/ChunkMaterials.ts');
      const p = window.__game.player;
      return {
        bottleBack: p.heldItemId === I.GLASS_BOTTLE,
        hasNV: p.hasEffect('night_vision'),
        hudPill: document.querySelector('[data-mc="effects"]')?.textContent ?? '',
        ambAfter: worldUniforms.uAmbient.value,
      };
    });
    check('potions : boire en 32 ticks rend la fiole, affiche l\'effet à l\'écran et éclaire la grotte (vision nocturne)',
      drinkAndNV.bottleBack && drinkAndNV.hasNV && drinkAndNV.hudPill.includes('Vision nocturne') && drinkAndNV.ambAfter > ambBefore + 0.5,
      JSON.stringify({ ambBefore, ...drinkAndNV }));

    // Potion jetable par le joueur (ThrownPotion)
    const splashSelf = await ev(page, () => {
      const g = window.__game, p = g.player;
      p.inventory.slots[1] = makeStack(I.SPLASH_POTION, 1, 0, undefined, 'speed');
      p.inventory.selected = 1;
      T.aim(p.x, p.y, p.z + 1);
      return true;
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 15);
    const gotSpeed = await ev(page, () => window.__game.player.hasEffect('speed'));
    check('potions : potion jetable utilisable par le joueur', splashSelf && gotSpeed);
  });

  // ========================================================================= Persistance, ancienne sauvegarde & export/import
  await section('sauvegarde et compatibilité', async () => {
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      p.teleport(70.5, 4, 70.5);
      p.inventory.offhand[0] = makeStack(I.SHIELD, 1, 12);
      p.addEffect('strength', 1200, 2);
      w.setBlock(72, 4, 70, B.CAULDRON, 2);
      w.setBlock(72, 4, 72, B.CAKE, 4);
      w.setBlock(74, 4, 70, B.BREWING_STAND, 0);
      const stand = w.getBlockEntity(74, 4, 70);
      if (stand) w.blockEntities.delete(stand.key ?? '');
    });
    // Ouvre l'alambic en (74,4,70) pour créer son entité avec distillation en cours
    await ev(page, () => { window.__game.player.teleport(74.5, 4, 72.5); T.aim(74.5, 4.5, 70.5); });
    await ticks(page, 2);
    await rclick(page);
    await page.waitForSelector('[data-mc="menu-brewing"]', { timeout: 5000 });
    await ev(page, () => {
      const g = window.__game;
      const m = g.ui.screen?.menu;
      if (m) {
        m.stand.items[0] = makeStack(I.POTION, 1, 0, undefined, 'water');
        m.stand.items[3] = makeStack(I.NETHER_WART, 1);
        m.stand.items[4] = makeStack(I.BLAZE_POWDER, 1);
        for (let i = 0; i < 50; i++) g.tick();
        g.world.markBlockEntityDirty(m.stand);
      }
    });
    await page.keyboard.press('Escape');
    await ticks(page, 2);

    await reload(page);

    const afterReload = await ev(page, async () => {
      const { getBrewingStand } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world, p = g.player;
      const b = getBrewingStand(w, 74, 4, 70);
      return {
        ok: p.offhandItemId === I.SHIELD && (p.inventory.offhandItem?.damage ?? -1) === 12 &&
          p.effectLevel('strength') === 2 && w.getMeta(72, 4, 70) === 2 &&
          w.getMeta(72, 4, 72) === 4 && b.brewTime > 0 && b.fuel === 20,
        offhandId: p.offhandItemId,
        offhandDmg: p.inventory.offhandItem?.damage ?? -1,
        strLvl: p.effectLevel('strength'),
        cauldronMeta: w.getMeta(72, 4, 70),
        cakeMeta: w.getMeta(72, 4, 72),
        brewTime: b.brewTime,
        brewFuel: b.fuel,
      };
    });
    check('sauvegarde : seconde main, effets, alambic en cours, chaudron et gâteau persistent après rechargement',
      afterReload.ok,
      JSON.stringify(afterReload));

    // Lecture d'une sauvegarde d'avant la section (sans offhand, ancien tableau effects)
    const legacyLoad = await ev(page, () => {
      const p = window.__game.player;
      p.loadState({
        x: p.x, y: p.y, z: p.z,
        inventory: { slots: [[I.APPLE, 2, 0]], armor: [null, null, null, null], selected: 0 },
        effects: [120, 80, 40, 20],
      });
      return {
        ok: p.offhandItemId === 0 && (p.inventory.slots[0]?.id ?? 0) === I.APPLE &&
          p.poisonTicks === 120 && p.slowTicks === 80 && p.weakTicks === 40 && p.witherTicks === 20,
        offhand: p.offhandItemId,
        apple: p.inventory.slots[0]?.id ?? 0,
        poison: p.poisonTicks,
        slow: p.slowTicks,
        weak: p.weakTicks,
        wither: p.witherTicks,
      };
    });
    check('compatibilité : ancienne sauvegarde sans seconde main et ancien tableau effects lue sans erreur',
      legacyLoad.ok,
      JSON.stringify(legacyLoad));
    await ev(page, () => { window.__game.player.inventory.offhand[0] = makeStack(I.SHIELD, 1, 12); });

    // Export / import .aetherworld
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 10000 });
    await click(page, 'play');
    await page.waitForSelector('[data-mc="world-export"]', { timeout: 10000 });
    await page.evaluate(async () => {
      const { exportWorld, importWorld } = await import('/src/world/WorldFile.ts');
      const { Storage } = await import('/src/world/Storage.ts');
      const st = await Storage.open();
      const worlds = await st.listWorlds();
      const blob = await exportWorld(st, worlds[0].id);
      window.__importedInfo = await importWorld(st, await blob.arrayBuffer());
    });
    const importedId = await page.evaluate(() => window.__importedInfo?.id ?? '');
    await page.reload();
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await click(page, 'play');
    await page.waitForSelector('[data-mc="world-play"]', { timeout: 10000 });
    await click(page, 'world-play');
    await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
    await helpers(page);
    const afterImport = await ev(page, async () => {
      const { getBrewingStand } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world, p = g.player;
      const b = getBrewingStand(w, 74, 4, 70);
      return {
        ok: p.offhandItemId === I.SHIELD && w.getMeta(72, 4, 70) === 2 &&
          w.getMeta(72, 4, 72) === 4 && b.fuel === 20,
        offhandId: p.offhandItemId,
        cauldronMeta: w.getMeta(72, 4, 70),
        cakeMeta: w.getMeta(72, 4, 72),
        brewFuel: b.fuel,
      };
    });
    check('export/import .aetherworld : conserve seconde main, chaudron, gâteau et alambic',
      !!importedId && afterImport.ok,
      JSON.stringify(afterImport));
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
