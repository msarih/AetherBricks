// Batterie « Transport » (points 30 et 31) : bateau, rails automatiques, propulseur, détecteur, wagonnet et mines.
const { sleep, launch, openPage, click, createWorld, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, rclick, section } = require('./h.cjs');

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

  await createWorld(page, { name: 'Transport', seed: '1337', flat: true });
  await helpers(page);
  await ticks(page, 10);

  // ========================================================================= 30. Bateau
  await section('bateau', async () => {
    // Recette 5 planches en U
    const recipeOk = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const r = matchRecipe([B.OAK_PLANKS, 0, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, 0, 0, 0], 3);
      return r?.id === I.BOAT && r.count === 1;
    });
    check('bateau : recette 5 planches en U', recipeOk);

    // Creuse un lac (x: 10..26, z: 10..26, y: 2..3) et pose le bateau au clic droit sur l'eau
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      g.difficulty = 0;
      for (let x = 10; x <= 26; x++) {
        for (let z = 10; z <= 26; z++) {
          w.setBlock(x, 2, z, B.WATER, 0, false);
          w.setBlock(x, 3, z, B.WATER, 0, false);
        }
      }
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.BOAT, 1);
      p.inventory.selected = 0;
      p.teleport(10.5, 4, 18.5);
      T.aim(13.5, 3.8, 18.5);
    });
    await ticks(page, 4);
    await rclick(page);
    await ticks(page, 5);

    const placedBoat = await ev(page, () => {
      const g = window.__game;
      const b = g.entities.find((e) => e.kind === 'boat' && !e.dead);
      return { found: !!b, held: g.player.heldItemId, y: b ? +b.y.toFixed(2) : 0 };
    });
    check('bateau : se pose sur l\'eau au clic droit et flotte', placedBoat.found && placedBoat.held === 0 && placedBoat.y >= 3.2 && placedBoat.y <= 4.1, JSON.stringify(placedBoat));

    // Clic droit sur le bateau -> embarquement
    await ev(page, () => {
      const b = window.__game.entities.find((e) => e.kind === 'boat' && !e.dead);
      if (b) T.aim(b.x, b.y + 0.3, b.z);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 3);
    const mounted = await ev(page, () => window.__game.player.vehicle?.kind === 'boat');
    check('bateau : clic droit sur le bateau fait monter dedans', mounted);

    // Conduite Z/S/Q/D + captures 1p et F5 sur le lac
    await ev(page, () => {
      const g = window.__game, b = g.player.vehicle;
      if (b) { b.setPosition(18.5, 3.77, 18.5); b.yaw = 0; b.vx = b.vz = 0; }
      T.look(0, -0.75);
    });
    await ticks(page, 3);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t10-bateau-1p.png' });
    await ev(page, () => { T.look(0, -0.35); });
    await page.keyboard.press('F5');
    await ticks(page, 2);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t10-bateau-f5.png' });
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');

    const startWater = await ev(page, () => {
      const b = window.__game.player.vehicle;
      return { x: b.x, z: b.z, yaw: b.yaw };
    });
    await page.keyboard.down('KeyW'); // Z (AZERTY) = KeyW
    await ticks(page, 20);
    await page.keyboard.up('KeyW');
    const afterZ = await ev(page, () => {
      const b = window.__game.player.vehicle;
      return { x: b.x, z: b.z, yaw: b.yaw };
    });
    await page.keyboard.down('KeyA'); // Q = tourner à gauche
    await ticks(page, 8);
    await page.keyboard.up('KeyA');
    const afterQ = await ev(page, () => window.__game.player.vehicle.yaw);
    await page.keyboard.down('KeyD'); // D = tourner à droite
    await ticks(page, 16);
    await page.keyboard.up('KeyD');
    const afterD = await ev(page, () => window.__game.player.vehicle.yaw);
    await ev(page, () => { const b = window.__game.player.vehicle; b.vx = b.vz = 0; });
    await page.keyboard.down('KeyS'); // S = reculer
    await ticks(page, 12);
    await page.keyboard.up('KeyS');
    const afterS = await ev(page, () => {
      const b = window.__game.player.vehicle;
      return { x: b.x, z: b.z };
    });
    const distWater = +(startWater.z - afterZ.z).toFixed(2);
    check('bateau : Z avance, S recule, Q et D tournent sur l\'eau',
      distWater > 2.5 && afterQ > startWater.yaw + 0.2 && afterD < afterQ - 0.4 && Math.hypot(afterS.x - afterZ.x, afterS.z - afterZ.z) > 0.2,
      JSON.stringify({ distWater, yaw0: +startWater.yaw.toFixed(2), afterQ: +afterQ.toFixed(2), afterD: +afterD.toFixed(2) }));

    // Terre ferme : glisse à peine (< distance sur l'eau)
    await ev(page, () => {
      const b = window.__game.player.vehicle;
      b.setPosition(35.5, 4, 18.5);
      b.yaw = 0; b.vx = b.vz = 0;
    });
    await ticks(page, 3);
    const land0 = await ev(page, () => window.__game.player.vehicle.z);
    await page.keyboard.down('KeyW');
    await ticks(page, 20);
    await page.keyboard.up('KeyW');
    const land1 = await ev(page, () => window.__game.player.vehicle.z);
    const distLand = +(land0 - land1).toFixed(2);
    check('bateau : avance beaucoup plus vite sur l\'eau que sur la terre ferme', distWater > distLand * 3, `eau=${distWater}, terre=${distLand}`);

    // Maj fait descendre
    await page.keyboard.down('ShiftLeft');
    await ticks(page, 3);
    await page.keyboard.up('ShiftLeft');
    await ticks(page, 2);
    const dismounted = await ev(page, () => window.__game.player.vehicle === null);
    check('bateau : Maj fait descendre', dismounted);

    // Ne monte pas une marche d'eau qui descend + choc contre un bloc sans casser
    const waterfallAndCrash = await ev(page, () => {
      const g = window.__game, w = g.world;
      // Marche d'eau : y=4 en z=30 (retenu par bord), y=3 en z=31..33
      for (let x = 14; x <= 16; x++) {
        w.setBlock(x, 4, 29, B.STONE, 0, false);
        w.setBlock(x, 4, 30, B.WATER, 0, false);
        w.setBlock(x, 3, 31, B.WATER, 0, false);
        w.setBlock(x, 3, 32, B.WATER, 0, false);
        w.setBlock(x, 3, 33, B.STONE, 0, false);
        w.setBlock(x, 4, 34, B.STONE, 0, false);
      }
      const b = g.entities.find((e) => e.kind === 'boat' && !e.dead);
      b.setPosition(15.5, 3.5, 31.8);
      b.vx = 0; b.vz = -0.35; // fonce vers la marche d'eau z=30 (en haut) et vers les blocs
      for (let i = 0; i < 15; i++) g.tick();
      const stayedBelowStep = b.y < 4.0;
      b.setPosition(15.5, 4, 32.5);
      b.vx = 0; b.vz = 0.42; // choc grande vitesse contre mur z=34
      for (let i = 0; i < 10; i++) g.tick();
      const survivedCrash = !b.dead;
      return { stayedBelowStep, y: +b.y.toFixed(2), survivedCrash };
    });
    check('bateau : ne monte pas une marche d\'eau qui descend et ne casse pas au choc',
      waterfallAndCrash.stayedBelowStep && waterfallAndCrash.survivedCrash,
      JSON.stringify(waterfallAndCrash));

    // Créature touche un bateau vide -> monte dedans et reste coincée
    const mobInBoat = await ev(page, async () => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game;
      const b = g.entities.find((e) => e.kind === 'boat' && !e.dead);
      b.setPosition(18.5, 3.5, 18.5);
      b.vx = b.vz = 0;
      const pig = createMob('pig');
      pig.setPosition(18.5, 4, 18.5);
      g.spawn(pig);
      for (let i = 0; i < 40; i++) g.tick();
      const riding = pig.vehicle === b && b.rider === pig;
      const dist = Math.hypot(pig.x - b.x, pig.z - b.z);
      return { riding, dist: +dist.toFixed(2) };
    });
    check('bateau : une créature qui touche un bateau vide y monte et reste coincée',
      mobInBoat.riding && mobInBoat.dist < 0.1,
      JSON.stringify(mobInBoat));

    // Casse en quelques coups et redevient un objet bateau
    const boatBreak = await ev(page, () => {
      const g = window.__game, p = g.player;
      for (const e of g.entities) if (e.kind === 'item') e.dead = true;
      const b = g.entities.find((e) => e.kind === 'boat' && !e.dead);
      let hits = 0;
      while (!b.dead && hits < 10) {
        b.hurt(g, 1, 'attack', p);
        hits++;
      }
      g.tick();
      const drop = g.entities.some((e) => e.kind === 'item' && !e.dead && e.itemId === I.BOAT);
      return { dead: b.dead, hits, drop };
    });
    check('bateau : se casse en quelques coups et redevient un objet bateau',
      boatBreak.dead && boatBreak.hits >= 2 && boatBreak.hits <= 5 && boatBreak.drop,
      JSON.stringify(boatBreak));
  });

  // ========================================================================= 31. Rails et wagonnet
  await section('rails et wagonnet', async () => {
    // Recettes : rail, rail propulseur, rail détecteur, wagonnet
    const recipes = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const rail = matchRecipe([I.IRON_INGOT, 0, I.IRON_INGOT, I.IRON_INGOT, I.STICK, I.IRON_INGOT, I.IRON_INGOT, 0, I.IRON_INGOT], 3);
      const pow = matchRecipe([I.GOLD_INGOT, 0, I.GOLD_INGOT, I.GOLD_INGOT, I.STICK, I.GOLD_INGOT, I.GOLD_INGOT, I.REDSTONE, I.GOLD_INGOT], 3);
      const det = matchRecipe([I.IRON_INGOT, 0, I.IRON_INGOT, I.IRON_INGOT, B.STONE_PRESSURE_PLATE, I.IRON_INGOT, I.IRON_INGOT, I.REDSTONE, I.IRON_INGOT], 3);
      const cart = matchRecipe([I.IRON_INGOT, 0, I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, I.IRON_INGOT, 0, 0, 0], 3);
      return {
        rail: rail?.id === B.RAIL && rail.count === 16,
        pow: pow?.id === B.POWERED_RAIL && pow.count === 6,
        det: det?.id === B.DETECTOR_RAIL && det.count === 6,
        cart: cart?.id === I.MINECART && cart.count === 1,
      };
    });
    check('rails & wagonnet : les 4 recettes (rail, propulseur, détecteur, wagonnet)',
      recipes.rail && recipes.pow && recipes.det && recipes.cart,
      JSON.stringify(recipes));

    // Pose manuelle de rails : raccordement automatique (ligne droite, virage, montée d'un bloc) + capture
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      for (const e of g.entities) if (e.kind !== 'player') e.dead = true;
      // Marche d'un bloc en (44, 4, 40) pour la montée
      w.setBlock(44, 4, 40, B.STONE, 0, false);
      w.setBlock(45, 4, 40, B.STONE, 0, false);
      w.setBlock(46, 4, 40, B.STONE, 0, false);
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(B.RAIL, 16);
      p.inventory.slots[1] = makeStack(B.POWERED_RAIL, 4);
      p.inventory.selected = 0;
      p.teleport(41.5, 6, 43.5);
    });
    const placeAt = async (x, y, z, slot) => {
      await ev(page, (x, y, z, slot) => {
        const p = window.__game.player;
        p.inventory.selected = slot;
        p.teleport(x + 0.5, y + 2, z + 1.5);
        T.aim(x + 0.5, y + 0.98, z + 0.5);
      }, x, y, z, slot);
      await ticks(page, 2);
      await rclick(page);
      await ticks(page, 2);
    };
    // Pose chemin : (40,4,42) -> (40,4,41) -> (40,4,40) -> (41,4,40) [propulseur] -> (42,4,40) -> (43,4,40) -> (44,5,40)
    await placeAt(40, 3, 42, 0);
    await placeAt(40, 3, 41, 0);
    await placeAt(40, 3, 40, 0);
    await placeAt(41, 3, 40, 1);
    await placeAt(42, 3, 40, 0);
    await placeAt(43, 3, 40, 0);
    await placeAt(44, 4, 40, 0);
    await placeAt(45, 4, 40, 0);

    // Alimente le rail propulseur en (41, 4, 40) avec un bloc de redstone en dessous (41, 3, 40)
    await ev(page, async () => {
      const { updateRedstoneAround } = await import('/src/world/Redstone.ts');
      const g = window.__game, w = g.world;
      w.setBlock(41, 3, 40, B.REDSTONE_BLOCK, 0, true);
      updateRedstoneAround(w, 41, 3, 40);
      g.player.teleport(38.5, 6, 44.5);
      T.aim(41.5, 4.2, 40.5);
    });
    await ticks(page, 6);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t10-circuit-rails.png' });

    const autoConnect = await ev(page, () => {
      const w = window.__game.world;
      return {
        ns: w.getMeta(40, 4, 42),
        curveSE: w.getMeta(40, 4, 40),
        poweredOn: w.getMeta(41, 4, 40),
        ascE: w.getMeta(43, 4, 40),
      };
    });
    check('rails : pose manuelle raccorde droite (0), virage SE (6), montée E (2) et propulseur allumé (bit 8)',
      autoConnect.ns === 0 && autoConnect.curveSE === 6 && (autoConnect.poweredOn & 8) !== 0 && autoConnect.ascE === 2,
      JSON.stringify(autoConnect));

    // Pose du wagonnet sur rail au clic droit, poussée à pied, embarquement, virage + montée
    await ev(page, () => {
      const p = window.__game.player;
      p.inventory.slots[2] = makeStack(I.MINECART, 1);
      p.inventory.selected = 2;
      p.teleport(40.5, 4, 43.5);
      T.aim(40.5, 4.05, 42.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 3);
    const cartPlaced = await ev(page, () => {
      const g = window.__game;
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      return { found: !!c, held: g.player.heldItemId };
    });
    check('wagonnet : se pose sur un rail au clic droit', cartPlaced.found && cartPlaced.held === 0, JSON.stringify(cartPlaced));

    // Poussée à pied
    await page.keyboard.down('KeyW');
    await ticks(page, 6);
    await page.keyboard.up('KeyW');
    const pushedOnFoot = await ev(page, () => {
      const c = window.__game.entities.find((e) => e.kind === 'minecart' && !e.dead);
      return { z: +c.z.toFixed(2), vz: +c.vz.toFixed(3) };
    });
    check('wagonnet : on peut le pousser à pied', pushedOnFoot.z < 42.4, JSON.stringify(pushedOnFoot));

    // Replace au départ, clic droit pour monter, Z pousse doucement puis le propulseur lance sur le virage et la montée
    await ev(page, () => {
      const g = window.__game, p = g.player;
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      c.setPosition(40.5, 4.0625, 42.5);
      c.vx = c.vz = 0;
      p.teleport(40.5, 4, 43.5);
      T.aim(c.x, c.y + 0.35, c.z);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);
    const cartMounted = await ev(page, () => window.__game.player.vehicle?.kind === 'minecart');
    check('wagonnet : clic droit fait monter dedans', cartMounted);

    // Captures wagonnet en marche : vue de dedans et F5
    await ev(page, () => { T.look(0, -0.35); });
    await page.keyboard.down('KeyW');
    await ticks(page, 8);
    await page.keyboard.up('KeyW');
    await ev(page, () => {
      const c = window.__game.player.vehicle;
      T.look(c ? c.yaw : 0, -0.95);
    });
    await ticks(page, 2);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t10-wagonnet-1p.png' });
    await ev(page, () => { T.look(0, -0.35); });
    await page.keyboard.press('F5');
    await ticks(page, 3);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t10-wagonnet-f5.png' });
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');

    // Attend la traversée du virage (40,4,40), du propulseur (41,4,40) et la montée (44,5,40)
    const afterRide = await ev(page, () => {
      const g = window.__game;
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      let maxX = c.x, maxY = c.y;
      for (let i = 0; i < 25; i++) {
        g.tick();
        if (c.x > maxX) maxX = c.x;
        if (c.y > maxY) maxY = c.y;
      }
      return { x: +maxX.toFixed(2), y: +maxY.toFixed(2), z: +c.z.toFixed(2) };
    });
    check('wagonnet : Z le pousse, il suit un virage et monte une pente d\'un bloc',
      afterRide.x > 42.5 && afterRide.y >= 4.9,
      JSON.stringify(afterRide));

    // Maj fait descendre
    await page.keyboard.down('ShiftLeft');
    await ticks(page, 3);
    await page.keyboard.up('ShiftLeft');
    const cartDismount = await ev(page, () => window.__game.player.vehicle === null);
    check('wagonnet : Maj fait descendre', cartDismount);

    // Rail propulseur éteint freine/arrête ; allumé relance
    const poweredTest = await ev(page, () => {
      const g = window.__game, w = g.world;
      for (let x = 50; x <= 56; x++) {
        w.setBlock(x, 3, 50, B.STONE, 0, false);
        w.setBlock(x, 4, 50, x === 52 || x === 53 ? B.POWERED_RAIL : B.RAIL, 1, false);
      }
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      c.setPosition(50.5, 4.0625, 50.5);
      c.vx = 0.25; c.vz = 0;
      for (let i = 0; i < 20; i++) g.tick();
      const stoppedX = c.x;
      const stoppedVx = c.vx;
      // Allume le rail propulseur (53,4,50) et pose un mur en (52,4,50) ou lance
      w.setBlock(53, 3, 50, B.REDSTONE_BLOCK, 0, true);
      c.vx = 0.05;
      for (let i = 0; i < 15; i++) g.tick();
      return { stoppedX: +stoppedX.toFixed(2), stoppedVx: +stoppedVx.toFixed(3), boostedX: +c.x.toFixed(2) };
    });
    check('rail propulseur : éteint il freine/arrête le wagonnet, allumé il le relance',
      poweredTest.stoppedX < 53.5 && Math.abs(poweredTest.stoppedVx) < 0.01 && poweredTest.boostedX > 55,
      JSON.stringify(poweredTest));

    // Relance d'un wagonnet à l'arrêt contre un bloc en cliquant réellement sur un levier
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(52, 4, 50, B.STONE, 0, true);
      w.setBlock(53, 3, 50, B.STONE, 0, false);
      w.setBlock(53, 3, 51, B.STONE, 0, false);
      w.setBlock(53, 4, 50, B.POWERED_RAIL, 1, true);
      for (let x = 54; x <= 59; x++) {
        w.setBlock(x, 3, 50, B.STONE, 0, false);
        w.setBlock(x, 4, 50, B.RAIL, 1, false);
      }
      w.setBlock(53, 4, 51, B.LEVER, 0, true);
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      c.setPosition(53.5, 4.0625, 50.5);
      c.vx = 0; c.vz = 0;
      p.inventory.clear();
      p.inventory.selected = 0;
      p.teleport(53.5, 4, 53.0);
      T.aim(53.5, 4.15, 51.5);
    });
    await ticks(page, 3);
    await rclick(page);
    await ticks(page, 25);
    const leverBoost = await ev(page, () => {
      const g = window.__game, w = g.world;
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      return {
        leverOn: (w.getMeta(53, 4, 51) & 8) !== 0,
        railOn: (w.getMeta(53, 4, 50) & 8) !== 0,
        x: c ? +c.x.toFixed(2) : 0,
      };
    });
    check('rail propulseur : clic réel sur levier relance un wagonnet à l\'arrêt contre un bloc',
      leverBoost.leverOn && leverBoost.railOn && leverBoost.x > 55.5,
      JSON.stringify(leverBoost));

    // Rail détecteur allume une lampe à redstone voisine
    const detectorTest = await ev(page, () => {
      const g = window.__game, w = g.world;
      w.setBlock(60, 4, 60, B.RAIL, 1, false);
      w.setBlock(61, 4, 60, B.DETECTOR_RAIL, 1, false);
      w.setBlock(62, 4, 60, B.RAIL, 1, false);
      w.setBlock(61, 4, 61, B.REDSTONE_LAMP, 0, true);
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      c.setPosition(60.5, 4.0625, 60.5);
      c.vx = 0.2; c.vz = 0;
      let lit = false;
      for (let i = 0; i < 15; i++) {
        g.tick();
        if (w.getBlock(61, 4, 61) === B.REDSTONE_LAMP_LIT) lit = true;
      }
      return { lit };
    });
    check('rail détecteur : allume une lampe à redstone au passage d\'un wagonnet', detectorTest.lit);

    // Wagonnet arrêté sur rail détecteur : lampe allumée en continu sur 80 ticks, puis éteinte après départ
    const detectorSteady = await ev(page, () => {
      const g = window.__game, w = g.world;
      w.setBlock(63, 4, 60, B.RAIL, 1, false);
      w.setBlock(64, 4, 60, B.RAIL, 1, false);
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      c.setPosition(61.5, 4.0625, 60.5);
      c.vx = 0; c.vz = 0;
      for (let i = 0; i < 5; i++) g.tick();
      let offTicks = 0;
      for (let i = 0; i < 80; i++) {
        g.tick();
        if (w.getBlock(61, 4, 61) !== B.REDSTONE_LAMP_LIT) offTicks++;
      }
      // Départ du wagonnet hors du rail détecteur
      c.setPosition(64.5, 4.0625, 60.5);
      c.vx = 0; c.vz = 0;
      for (let i = 0; i < 25; i++) g.tick();
      const litAfterLeave = w.getBlock(61, 4, 61) === B.REDSTONE_LAMP_LIT;
      return { offTicks, litAfterLeave };
    });
    check('rail détecteur : wagonnet immobile garde la lampe allumée en continu puis l\'éteint au départ',
      detectorSteady.offTicks === 0 && !detectorSteady.litAfterLeave,
      JSON.stringify(detectorSteady));

    // Créature monte dans un wagonnet vide + casse du wagonnet en quelques coups
    const cartMobAndBreak = await ev(page, async () => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game, p = g.player;
      for (const e of g.entities) if (e.kind === 'item') e.dead = true;
      const c = g.entities.find((e) => e.kind === 'minecart' && !e.dead);
      c.setPosition(60.5, 4.0625, 60.5);
      c.vx = c.vz = 0;
      const sheep = createMob('sheep');
      sheep.setPosition(60.5, 4.1, 60.5);
      g.spawn(sheep);
      for (let i = 0; i < 10; i++) g.tick();
      const mobMounted = sheep.vehicle === c && c.rider === sheep;
      let hits = 0;
      while (!c.dead && hits < 10) {
        c.hurt(g, 1, 'attack', p);
        hits++;
      }
      g.tick();
      const drop = g.entities.some((e) => e.kind === 'item' && !e.dead && e.itemId === I.MINECART);
      return { mobMounted, dead: c.dead, hits, drop };
    });
    check('wagonnet : une créature y monte et il se casse en quelques coups',
      cartMobAndBreak.mobMounted && cartMobAndBreak.dead && cartMobAndBreak.hits >= 2 && cartMobAndBreak.drop,
      JSON.stringify(cartMobAndBreak));

    // Commandes /give
    await ev(page, () => { window.__game.player.inventory.clear(); });
    for (const cmd of ['/give boat', '/give rail 64', '/give powered_rail', '/give detector_rail', '/give minecart', '/give lever', '/give redstone_lamp']) {
      await chat(page, cmd);
    }
    const giveCheck = await ev(page, () => {
      const slots = window.__game.player.inventory.slots;
      const countOf = (id) => slots.reduce((s, st) => s + (st && st.id === id ? st.count : 0), 0);
      return {
        boat: countOf(I.BOAT),
        rail: countOf(B.RAIL),
        powered: countOf(B.POWERED_RAIL),
        detector: countOf(B.DETECTOR_RAIL),
        cart: countOf(I.MINECART),
        lever: countOf(B.LEVER),
        lamp: countOf(B.REDSTONE_LAMP),
      };
    });
    check('commandes /give : boat, rail 64, powered_rail, detector_rail, minecart, lever, redstone_lamp',
      giveCheck.boat >= 1 && giveCheck.rail >= 64 && giveCheck.powered >= 1 && giveCheck.detector >= 1
      && giveCheck.cart >= 1 && giveCheck.lever >= 1 && giveCheck.lamp >= 1,
      JSON.stringify(giveCheck));
  });

  // ========================================================================= Sauvegarde & export/import
  await section('sauvegarde et export/import', async () => {
    const afterSaveNoReload = await ev(page, async () => {
      const { Boat, Minecart } = await import('/src/entity/Vehicles.ts');
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game, w = g.world, p = g.player;
      for (const e of g.entities) if (e.kind !== 'player') e.dead = true;
      g.tick();
      // Bateau avec passager (vache) sur le lac + wagonnet avec passager (cochon) sur rail
      const boat = new Boat();
      boat.setPosition(20.5, 3.77, 20.5);
      const cow = createMob('cow');
      cow.setPosition(20.5, 4.0, 20.5);
      g.spawn(boat);
      g.spawn(cow);

      w.setBlock(70, 4, 70, B.RAIL, 0, false);
      const cart = new Minecart();
      cart.setPosition(70.5, 4.0625, 70.5);
      const pig = createMob('pig');
      pig.setPosition(70.5, 4.3, 70.5);
      g.spawn(cart);
      g.spawn(pig);
      g.tick();
      p.teleport(22.5, 4, 20.5);

      await g.save();
      const cows = g.entities.filter((e) => e.kind === 'mob' && !e.dead && e.mobKind === 'cow');
      const pigs = g.entities.filter((e) => e.kind === 'mob' && !e.dead && e.mobKind === 'pig');
      return {
        cows: cows.length,
        pigs: pigs.length,
        cowInBoat: cows[0] === boat.rider && cows[0]?.vehicle === boat,
        pigInCart: pigs[0] === cart.rider && pigs[0]?.vehicle === cart,
        cowDist: cows[0] ? +Math.hypot(cows[0].x - boat.x, cows[0].z - boat.z).toFixed(3) : 99,
        pigDist: pigs[0] ? +Math.hypot(pigs[0].x - cart.x, pigs[0].z - cart.z).toFixed(3) : 99,
      };
    });
    check('sauvegarde sans rechargement : les passagers restent dans le monde et dans leur véhicule',
      afterSaveNoReload.cows === 1 && afterSaveNoReload.pigs === 1
      && afterSaveNoReload.cowInBoat && afterSaveNoReload.pigInCart
      && afterSaveNoReload.cowDist < 0.1 && afterSaveNoReload.pigDist < 0.1,
      JSON.stringify(afterSaveNoReload));

    await ticks(page, 4);
    await reload(page);

    const afterReload = await ev(page, () => {
      const g = window.__game;
      const boats = g.entities.filter((e) => e.kind === 'boat' && !e.dead);
      const carts = g.entities.filter((e) => e.kind === 'minecart' && !e.dead);
      const cows = g.entities.filter((e) => e.kind === 'mob' && !e.dead && e.mobKind === 'cow');
      const pigs = g.entities.filter((e) => e.kind === 'mob' && !e.dead && e.mobKind === 'pig');
      return {
        boats: boats.length,
        carts: carts.length,
        cows: cows.length,
        pigs: pigs.length,
        boatHasCow: boats.some((b) => b.rider?.mobKind === 'cow'),
        cartHasPig: carts.some((c) => c.rider?.mobKind === 'pig'),
      };
    });
    check('sauvegarde : bateau et wagonnet (avec passager) persistent après rechargement sans doublon',
      afterReload.boats === 1 && afterReload.carts === 1
      && afterReload.cows === 1 && afterReload.pigs === 1
      && afterReload.boatHasCow && afterReload.cartHasPig,
      JSON.stringify(afterReload));

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
    await ticks(page, 6);
    const afterImport = await ev(page, () => {
      const g = window.__game;
      const boats = g.entities.filter((e) => e.kind === 'boat' && !e.dead);
      const carts = g.entities.filter((e) => e.kind === 'minecart' && !e.dead);
      return {
        boats: boats.length,
        carts: carts.length,
        cartHasPig: carts.some((c) => c.rider?.mobKind === 'pig'),
      };
    });
    check('export/import .aetherworld : conserve bateau et wagonnet (avec passager)',
      !!importedId && afterImport.boats === 1 && afterImport.carts === 1 && afterImport.cartHasPig,
      JSON.stringify(afterImport));
  });

  // ========================================================================= Mine abandonnée (monde normal 1337)
  await section('mine abandonnée (monde normal)', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await createWorld(page, { name: 'Mine1337', seed: '1337', flat: false });
    await helpers(page);
    await ticks(page, 10);

    const mineCheck = await ev(page, async () => {
      const { Minecart } = await import('/src/entity/Vehicles.ts');
      const g = window.__game, w = g.world, p = g.player;
      const loc = g.locate('mineshaft');
      if (!loc) return { found: false };
      p.teleport(loc.x + 0.5, loc.y + 1, loc.z + 0.5);
      for (let i = 0; i < 120; i++) {
        g.chunks.update(loc.x, loc.z);
        if (g.chunks.isReady(loc.x, loc.z, 2)) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      let rail = null;
      for (let dx = -24; dx <= 24 && !rail; dx++) {
        for (let dz = -24; dz <= 24 && !rail; dz++) {
          for (let dy = -12; dy <= 12 && !rail; dy++) {
            const x = loc.x + dx, y = loc.y + dy, z = loc.z + dz;
            if (w.getBlock(x, y, z) === B.RAIL) {
              const m = w.getMeta(x, y, z);
              rail = { x, y, z, meta: m };
            }
          }
        }
      }
      if (!rail) return { found: true, hasRail: false };
      p.addEffect('night_vision', 600, 1);
      const camX = rail.x + (rail.meta === 1 ? -1.8 : 0.5);
      const camZ = rail.z + (rail.meta === 1 ? 0.5 : 1.8);
      p.teleport(camX, rail.y, camZ);
      const cart = new Minecart();
      cart.setPosition(rail.x + 0.5, rail.y + 0.0625, rail.z + 0.5);
      g.spawn(cart);
      cart.vx = rail.meta === 1 ? 0.1 : 0;
      cart.vz = rail.meta === 0 ? 0.1 : 0;
      for (let i = 0; i < 4; i++) g.tick();
      T.aim(cart.x, cart.y + 0.3, cart.z);
      return {
        found: true,
        hasRail: true,
        metaOk: rail.meta === 0 || rail.meta === 1,
        movedOnMineRail: Math.hypot(cart.x - (rail.x + 0.5), cart.z - (rail.z + 0.5)) > 0.1,
      };
    });
    await ticks(page, 3);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t10-mine-rails.png' });
    check('mine abandonnée : rails générés inchangés (méta 0/1) et utilisables en wagonnet',
      mineCheck.found && mineCheck.hasRail && mineCheck.metaOk && mineCheck.movedOnMineRail,
      JSON.stringify(mineCheck));
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
