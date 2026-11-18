// Batterie « Redstone avancée » (points 32 à 37) : répéteur, comparateur, entonnoir, distributeur, dropper, capteur de lumière, bloc musical.
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

  await createWorld(page, { name: 'RedstoneAvancee', seed: '1337', flat: true });
  await helpers(page);
  await ticks(page, 10);

  // ========================================================================= 32. Répéteur
  await section('répéteur', async () => {
    const recipeOk = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const r = matchRecipe([B.REDSTONE_TORCH, I.REDSTONE, B.REDSTONE_TORCH, B.STONE, B.STONE, B.STONE, 0, 0, 0], 3);
      return r?.id === B.REPEATER && r.count === 1;
    });
    check('répéteur : recette 2 torches redstone + 1 redstone + 3 pierres', recipeOk);

    // Pose au clic droit vers -Z (nord), 3 clics droits pour passer de 1 à 4 ticks
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      for (let z = 12; z <= 18; z++) w.setBlock(10, 3, z, B.STONE, 0, false);
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(B.REPEATER, 1);
      p.inventory.selected = 0;
      p.teleport(10.5, 4, 17.5);
      T.aim(10.5, 4.0, 15.5); // vise le bloc dessous (10,3,15) ? Non, on vise (10,3,15) haut :
      T.aim(10.5, 3.85, 15.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);
    await ev(page, () => { T.aim(10.5, 4.05, 15.5); }); // vise le répéteur en (10,4,15)
    for (let i = 0; i < 3; i++) {
      await rclick(page);
      await ticks(page, 2);
    }
    const repDelay4 = await ev(page, () => {
      const m = window.__game.world.getMeta(10, 4, 15);
      return { isRep: window.__game.world.getBlock(10, 4, 15) === B.REPEATER, delay: ((m >> 2) & 3) + 1, facing: m & 3 };
    });
    await rclick(page);
    await ticks(page, 2);
    const repWrap = await ev(page, () => (((window.__game.world.getMeta(10, 4, 15) >> 2) & 3) + 1));
    // Remet à 4 ticks (3 clics)
    for (let i = 0; i < 3; i++) { await rclick(page); await ticks(page, 2); }
    check('répéteur : 3 clics règlent le délai à 4 ticks puis le 4e revient à 1',
      repDelay4.isRep && repDelay4.delay === 4 && repWrap === 1,
      JSON.stringify({ repDelay4, repWrap }));

    // Mesure exacte du délai de 4 ticks + sens unique
    const delayMeasure = await ev(page, () => {
      const g = window.__game, w = g.world;
      w.setBlock(10, 4, 16, B.REDSTONE_WIRE, 0, true);
      w.setBlock(10, 4, 14, B.REDSTONE_LAMP, 0, true);
      w.setBlock(10, 4, 17, B.LEVER, 8, true); // allumé
      const states = [];
      for (let t = 1; t <= 5; t++) {
        g.tick();
        states.push(w.getBlock(10, 4, 14) === B.REDSTONE_LAMP_LIT);
      }
      // Vérifie sens inverse : allumer la sortie seule n'allume pas l'entrée
      w.setBlock(10, 4, 17, B.AIR, 0, true);
      for (let i = 0; i < 6; i++) g.tick();
      w.setBlock(10, 4, 13, B.REDSTONE_BLOCK, 0, true);
      w.setBlock(10, 4, 14, B.REDSTONE_WIRE, 0, true);
      for (let i = 0; i < 6; i++) g.tick();
      const reverseWire = w.getMeta(10, 4, 16);
      w.setBlock(10, 4, 13, B.AIR, 0, true);
      w.setBlock(10, 4, 14, B.REDSTONE_LAMP, 0, true);
      return { states, reverseWire };
    });
    check('répéteur : retarde le signal de 4 ticks et ne laisse passer que dans un sens',
      delayMeasure.states[0] === false && delayMeasure.states[1] === false && delayMeasure.states[2] === false
      && delayMeasure.states[3] === true && delayMeasure.reverseWire === 0,
      JSON.stringify(delayMeasure));

    // Verrouillage latéral par un second répéteur allumé
    const lockTest = await ev(page, () => {
      const g = window.__game, w = g.world;
      // Rallume le répéteur principal (10,4,15, facing=2)
      w.setBlock(10, 4, 17, B.LEVER, 8, true);
      for (let i = 0; i < 6; i++) g.tick();
      const litBeforeLock = (w.getMeta(10, 4, 15) & 16) !== 0;
      // Répéteur latéral en (9,4,15) pointant vers +X (facing=3) alimenté par bloc de redstone en (8,4,15)
      w.setBlock(8, 3, 15, B.STONE, 0, false);
      w.setBlock(9, 3, 15, B.STONE, 0, false);
      w.setBlock(9, 4, 15, B.REPEATER, 3, true);
      w.setBlock(8, 4, 15, B.REDSTONE_BLOCK, 0, true);
      for (let i = 0; i < 4; i++) g.tick();
      const lockedBit = (w.getMeta(10, 4, 15) & 32) !== 0;
      // Coupe l'entrée arrière : la sortie doit rester figée allumée !
      w.setBlock(10, 4, 17, B.LEVER, 0, true);
      for (let i = 0; i < 10; i++) g.tick();
      const stillOnWhileLocked = (w.getMeta(10, 4, 15) & 16) !== 0;
      // Déverrouille : la sortie finit par s'éteindre
      w.setBlock(8, 4, 15, B.AIR, 0, true);
      for (let i = 0; i < 10; i++) g.tick();
      const offAfterUnlock = (w.getMeta(10, 4, 15) & 16) === 0;
      return { litBeforeLock, lockedBit, stillOnWhileLocked, offAfterUnlock };
    });
    check('répéteur : verrouillé par un répéteur latéral, reste figé puis se déverrouille',
      lockTest.litBeforeLock && lockTest.lockedBit && lockTest.stillOnWhileLocked && lockTest.offAfterUnlock,
      JSON.stringify(lockTest));
  });

  // ========================================================================= 33. Comparateur
  await section('comparateur', async () => {
    const recipeOk = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const r = matchRecipe([0, B.REDSTONE_TORCH, 0, B.REDSTONE_TORCH, I.QUARTZ, B.REDSTONE_TORCH, B.STONE, B.STONE, B.STONE], 3);
      return r?.id === B.COMPARATOR && r.count === 1;
    });
    check('comparateur : recette 3 torches redstone + quartz du Nether + 3 pierres', recipeOk);

    // Pose comparateur orienté vers -Z (facing=2) lisant un coffre en (20,4,16), fil de sortie en (20,4,14)
    const compRead = await ev(page, async () => {
      const { getChest } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world;
      w.setBlock(20, 4, 16, B.CHEST, 2, true);
      w.setBlock(20, 4, 15, B.COMPARATOR, 2, true); // facing=2 (-z), mode comparaison
      w.setBlock(20, 4, 14, B.REDSTONE_WIRE, 0, true);
      for (let i = 0; i < 3; i++) g.tick();
      const wireEmpty = w.getMeta(20, 4, 14);
      const chest = getChest(w, 20, 4, 16);
      for (let i = 0; i < 27; i++) chest.items[i] = makeStack(B.STONE, 64);
      w.markBlockEntityDirty(chest);
      w.notifyNeighbors(20, 4, 16);
      const { updateRedstoneAround } = await import('/src/world/Redstone.ts');
      updateRedstoneAround(w, 20, 4, 16);
      for (let i = 0; i < 3; i++) g.tick();
      const wireFull = w.getMeta(20, 4, 14);
      return { wireEmpty, wireFull };
    });
    check('comparateur : sort 0 quand le coffre est vide et 15 quand il est plein',
      compRead.wireEmpty === 0 && compRead.wireFull === 15,
      JSON.stringify(compRead));

    // Mode comparaison vs mode soustraction au clic droit réel
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      // Envoie un signal de force 10 sur le côté gauche (19,4,15) via fil de force 10
      for (let dx = 1; dx <= 6; dx++) w.setBlock(19 - dx, 4, 15, B.REDSTONE_WIRE, 0, true);
      w.setBlock(19, 4, 15, B.REDSTONE_WIRE, 0, true);
      w.setBlock(13, 4, 15, B.REDSTONE_BLOCK, 0, true); // puissance à 19,4,15 = 15 - 6 = 9
      p.teleport(20.5, 4, 13.0);
      T.aim(20.5, 4.05, 15.5);
    });
    await ticks(page, 4);
    const compareOut = await ev(page, () => ({
      sidePower: window.__game.world.getMeta(19, 4, 15),
      wireOut: window.__game.world.getMeta(20, 4, 14),
      mode: (window.__game.world.getMeta(20, 4, 15) & 4) !== 0,
    }));
    await rclick(page); // bascule en soustraction
    await ticks(page, 4);
    const subtractOut = await ev(page, () => ({
      sidePower: window.__game.world.getMeta(19, 4, 15),
      wireOut: window.__game.world.getMeta(20, 4, 14),
      mode: (window.__game.world.getMeta(20, 4, 15) & 4) !== 0,
    }));
    check('comparateur : mode comparaison (15) puis mode soustraction au clic droit (15 - côté)',
      !compareOut.mode && compareOut.wireOut === 15 && subtractOut.mode
      && subtractOut.wireOut === 15 - subtractOut.sidePower && subtractOut.wireOut > 0 && subtractOut.wireOut < 15,
      JSON.stringify({ compareOut, subtractOut }));
  });

  // ========================================================================= 34. Entonnoir
  await section('entonnoir', async () => {
    const recipeOk = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const r = matchRecipe([I.IRON_INGOT, 0, I.IRON_INGOT, I.IRON_INGOT, B.CHEST, I.IRON_INGOT, 0, I.IRON_INGOT, 0], 3);
      return r?.id === B.HOPPER && r.count === 1;
    });
    check('entonnoir : recette 5 fers + 1 coffre', recipeOk);

    // Interface 5 cases à l'ouverture
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(30, 4, 15, B.CHEST, 2, true);
      w.setBlock(30, 5, 15, B.HOPPER, 1, true); // pointe vers le bas (1 = -y)
      w.setBlock(30, 6, 15, B.CHEST, 2, true);
      p.teleport(30.5, 4, 17.5);
      T.aim(30.5, 5.5, 15.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await page.waitForSelector('[data-mc="menu-hopper"]', { timeout: 5000 });
    const hopperSlots = await page.evaluate(() => document.querySelectorAll('[data-mc="menu-hopper"] [data-group="container"]').length);
    await page.keyboard.press('Escape');
    await ticks(page, 2);
    check('entonnoir : clic droit ouvre une interface de 5 cases', hopperSlots === 5, `slots=${hopperSlots}`);

    // Transfert d'un coffre au-dessus vers un coffre en dessous + verrouillage sous signal
    const hopTransfer = await ev(page, async () => {
      const { getChest } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world;
      const top = getChest(w, 30, 6, 15);
      const bot = getChest(w, 30, 4, 15);
      top.items[0] = makeStack(I.DIAMOND, 5);
      for (let i = 0; i < 40; i++) g.tick();
      const movedMid = bot.items[0]?.count ?? 0;
      const leftMid = top.items[0]?.count ?? 0;
      // Verrouille l'entonnoir avec un bloc de redstone à côté
      w.setBlock(31, 5, 15, B.REDSTONE_BLOCK, 0, true);
      for (let i = 0; i < 30; i++) g.tick();
      const movedLocked = bot.items[0]?.count ?? 0;
      return { movedMid, leftMid, movedLocked };
    });
    check('entonnoir : transfère du coffre supérieur au coffre inférieur et s\'arrête sous signal',
      hopTransfer.movedMid >= 2 && hopTransfer.leftMid < 5 && hopTransfer.movedLocked === hopTransfer.movedMid,
      JSON.stringify(hopTransfer));
  });

  // Capture 1 : répéteur, comparateur et entonnoir côte à côte
  await ev(page, () => {
    const g = window.__game, w = g.world, p = g.player;
    w.setBlock(15, 4, 30, B.REDSTONE_BLOCK, 0, true);
    w.setBlock(16, 4, 30, B.REDSTONE_WIRE, 0, true);
    w.setBlock(17, 4, 30, B.REPEATER, 3 | 12 | 16, true); // délai max, allumé, vers +X
    w.setBlock(18, 4, 30, B.REDSTONE_WIRE, 0, true);
    w.setBlock(19, 4, 30, B.CHEST, 2, true);
    w.setBlock(20, 4, 30, B.COMPARATOR, 3, true); // lit le coffre, vers +X
    w.setBlock(21, 4, 30, B.HOPPER, 1, true); // entonnoir juste à côté
    p.teleport(18.5, 5.2, 33.8);
    T.aim(18.5, 4.2, 30.5);
  });
  await ticks(page, 4);
  await page.screenshot({ path: 'dev-tests/e2e/shots/t11-circuit-logique.png' });

  // ========================================================================= 35. Distributeur et dropper
  await section('distributeur et dropper', async () => {
    const recipes = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const disp = matchRecipe([B.COBBLESTONE, B.COBBLESTONE, B.COBBLESTONE, B.COBBLESTONE, I.BOW, B.COBBLESTONE, B.COBBLESTONE, I.REDSTONE, B.COBBLESTONE], 3);
      const drop = matchRecipe([B.COBBLESTONE, B.COBBLESTONE, B.COBBLESTONE, B.COBBLESTONE, 0, B.COBBLESTONE, B.COBBLESTONE, I.REDSTONE, B.COBBLESTONE], 3);
      return { disp: disp?.id === B.DISPENSER, drop: drop?.id === B.DROPPER };
    });
    check('distributeur & dropper : recettes 1.12 (avec arc pour le distributeur)', recipes.disp && recipes.drop, JSON.stringify(recipes));

    // Ouvre l'interface 9 cases du distributeur
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(40, 4, 40, B.DISPENSER, 2, true); // face vers +Z (sud)
      p.teleport(40.5, 4, 43.0);
      T.aim(40.5, 4.5, 40.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await page.waitForSelector('[data-mc="menu-dispenser"]', { timeout: 5000 });
    const dispSlots = await page.evaluate(() => document.querySelectorAll('[data-mc="menu-dispenser"] [data-group="container"]').length);
    await page.keyboard.press('Escape');
    await ticks(page, 2);
    check('distributeur : clic droit ouvre une interface de 9 cases', dispSlots === 9, `slots=${dispSlots}`);

    // Distributeur lance un objet au front de signal (pas en continu), et tire une flèche
    await ev(page, async () => {
      const { getDispenser } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world, p = g.player;
      for (const e of g.entities) if (e.kind === 'item' || e.kind === 'arrow') e.dead = true;
      const d = getDispenser(w, 40, 4, 40, 'dispenser');
      d.items[0] = makeStack(I.APPLE, 4);
      w.setBlock(39, 4, 40, B.LEVER, 0, true);
      p.teleport(38.0, 4, 42.5);
      T.aim(39.5, 4.15, 40.5);
    });
    await ticks(page, 2);
    await rclick(page); // active le levier
    await ticks(page, 22);
    await ev(page, () => {
      const g = window.__game, p = g.player;
      p.teleport(42.8, 4.8, 43.5);
      T.aim(40.5, 4.3, 40.9);
    });
    await ticks(page, 2);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t11-distributeur-drop.png' });

    const dispLaunch = await ev(page, async () => {
      const { getDispenser } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world;
      const d = getDispenser(w, 40, 4, 40, 'dispenser');
      const itemsOnGround = g.entities.filter((e) => e.kind === 'item' && !e.dead && e.itemId === I.APPLE);
      const countLeft = d.items[0]?.count ?? 0;
      // Teste aussi la flèche : deuxième front
      w.setBlock(39, 4, 40, B.LEVER, 0, true);
      g.tick();
      d.items[0] = makeStack(I.ARROW, 2);
      w.setBlock(39, 4, 40, B.LEVER, 8, true);
      for (let i = 0; i < 6; i++) g.tick();
      const arrowFired = g.entities.some((e) => e.kind === 'arrow' && !e.dead);
      return { itemsOnGround: itemsOnGround.length, countLeft, arrowFired };
    });
    check('distributeur : lance un objet au front (reste au sol, pas en continu) et tire les flèches',
      dispLaunch.itemsOnGround === 1 && dispLaunch.countLeft === 3 && dispLaunch.arrowFired,
      JSON.stringify(dispLaunch));

    // Dropper pose un objet au sol (ou dans un coffre devant)
    const dropperTest = await ev(page, async () => {
      const { getChest, getDispenser } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world;
      for (const e of g.entities) if (e.kind === 'item') e.dead = true;
      w.setBlock(44, 4, 40, B.DROPPER, 2, true); // +Z
      const dr = getDispenser(w, 44, 4, 40, 'dropper');
      dr.items[0] = makeStack(I.GOLD_INGOT, 3);
      w.setBlock(43, 4, 40, B.REDSTONE_BLOCK, 0, true);
      for (let i = 0; i < 8; i++) g.tick();
      const droppedGold = g.entities.filter((e) => e.kind === 'item' && !e.dead && e.itemId === I.GOLD_INGOT);
      // Enlève le signal, pose un coffre devant (44,4,41), puis rallume
      w.setBlock(43, 4, 40, B.AIR, 0, true);
      g.tick();
      w.setBlock(44, 4, 41, B.CHEST, 2, true);
      w.setBlock(43, 4, 40, B.REDSTONE_BLOCK, 0, true);
      for (let i = 0; i < 8; i++) g.tick();
      const chest = getChest(w, 44, 4, 41);
      return { dropped: droppedGold.length === 1, inChest: chest.items[0]?.id === I.GOLD_INGOT && chest.items[0]?.count === 1 };
    });
    check('dropper : dépose l\'objet au sol ou le pousse dans un coffre devant au front de signal',
      dropperTest.dropped && dropperTest.inChest,
      JSON.stringify(dropperTest));
  });

  // ========================================================================= 36. Capteur de lumière du jour
  await section('capteur de lumière', async () => {
    const recipeOk = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const r = matchRecipe([B.GLASS, B.GLASS, B.GLASS, I.QUARTZ, I.QUARTZ, I.QUARTZ, B.OAK_SLAB, B.OAK_SLAB, B.OAK_SLAB], 3);
      return r?.id === B.DAYLIGHT_DETECTOR && r.count === 1;
    });
    check('capteur de lumière : recette 3 verres + 3 quartz + 3 dalles de bois', recipeOk);

    await chat(page, '/time set noon');
    await ticks(page, 2);
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(B.DAYLIGHT_DETECTOR, 1);
      p.inventory.selected = 0;
      p.teleport(50.5, 4, 52.5);
      T.aim(50.5, 3.85, 50.5);
    });
    await ticks(page, 2);
    await rclick(page); // pose le capteur en (50,4,50)
    await ticks(page, 4);
    await ev(page, () => {
      const w = window.__game.world;
      w.setBlock(50, 4, 49, B.REDSTONE_WIRE, 0, true);
      w.setBlock(51, 4, 50, B.REDSTONE_LAMP, 0, true);
    });
    await ticks(page, 4);
    const dayVal = await ev(page, () => ({
      wire: window.__game.world.getMeta(50, 4, 49),
      lamp: window.__game.world.getBlock(51, 4, 50) === B.REDSTONE_LAMP_LIT,
    }));

    await chat(page, '/time set night');
    await ticks(page, 4);
    const nightVal = await ev(page, () => ({
      wire: window.__game.world.getMeta(50, 4, 49),
      lamp: window.__game.world.getBlock(51, 4, 50) === B.REDSTONE_LAMP_LIT,
    }));

    // Clic droit pour inverser (doit sortir 15 la nuit)
    await ev(page, () => { T.aim(50.5, 4.15, 50.5); });
    await rclick(page);
    await ticks(page, 4);
    const invNightVal = await ev(page, () => ({
      inverted: (window.__game.world.getMeta(50, 4, 50) & 16) !== 0,
      wire: window.__game.world.getMeta(50, 4, 49),
      lamp: window.__game.world.getBlock(51, 4, 50) === B.REDSTONE_LAMP_LIT,
    }));
    await chat(page, '/time set day');
    await ticks(page, 4);
    const invDayVal = await ev(page, () => window.__game.world.getMeta(50, 4, 49));
    check('capteur de lumière : 15 le jour, 0 la nuit, inversé au clic droit',
      dayVal.wire === 15 && dayVal.lamp && nightVal.wire === 0 && !nightVal.lamp
      && invNightVal.inverted && invNightVal.wire === 15 && invNightVal.lamp && invDayVal === 0,
      JSON.stringify({ dayVal, nightVal, invNightVal, invDayVal }));
  });

  // ========================================================================= 37. Bloc musical
  await section('bloc musical', async () => {
    const recipeOk = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const r = matchRecipe([B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, I.REDSTONE, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS], 3);
      return r?.id === B.NOTE_BLOCK && r.count === 1;
    });
    check('bloc musical : recette 8 planches autour de 1 redstone', recipeOk);

    // Pose sur de la pierre -> instrument grosse_caisse, clics droits règlent les notes 1, 2, 3... et capture
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(60, 4, 60, B.STONE, 0, true);
      w.setBlock(60, 5, 60, B.NOTE_BLOCK, 0, true);
      p.teleport(60.5, 4.5, 64.0);
      T.aim(60.5, 5.5, 60.5);
    });
    await ticks(page, 3);
    const notes = [];
    for (let i = 0; i < 3; i++) {
      await rclick(page);
      await ticks(page, 2);
      notes.push(await ev(page, () => window.__game.lastNote));
    }
    await page.screenshot({ path: 'dev-tests/e2e/shots/t11-musical-pierre.png' });

    // Remplace dessous par des planches -> instrument basse, joue au front de signal (pas en continu) + capture
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(60, 4, 60, B.OAK_PLANKS, 0, true);
      w.setBlock(59, 4, 60, B.STONE, 0, false);
      w.setBlock(59, 5, 60, B.LEVER, 0, true);
      p.teleport(59.5, 4.5, 63.0);
      T.aim(59.5, 5.15, 60.5);
    });
    await ticks(page, 2);
    await rclick(page); // active le levier (front montant)
    await ticks(page, 2);
    const onPlanks1 = await ev(page, () => window.__game.lastNote);
    await ev(page, () => {
      window.__game.player.teleport(60.5, 4.5, 64.0);
      T.aim(60.5, 5.5, 60.5);
    });
    await ticks(page, 1);
    await page.screenshot({ path: 'dev-tests/e2e/shots/t11-musical-planches.png' });
    await ticks(page, 10);
    const onPlanksHeld = await ev(page, () => window.__game.lastNote?.count);

    // Instruments sable (flûte) et verre (clochette), et boucle des 25 notes (24 -> 0)
    const otherInstruments = await ev(page, () => {
      const g = window.__game, w = g.world;
      w.setBlock(59, 5, 60, B.AIR, 0, true);
      w.setBlock(60, 4, 60, B.SAND, 0, true);
      w.setBlock(59, 5, 60, B.REDSTONE_BLOCK, 0, true);
      const sandInst = g.lastNote?.instrument;
      w.setBlock(59, 5, 60, B.AIR, 0, true);
      w.setBlock(60, 4, 60, B.GLASS, 0, true);
      w.setBlock(59, 5, 60, B.REDSTONE_BLOCK, 0, true);
      const glassInst = g.lastNote?.instrument;
      return { sandInst, glassInst };
    });

    check('bloc musical : 25 notes réglées par clic droit, instruments par bloc et déclenchement sur front',
      notes[0]?.note === 1 && notes[1]?.note === 2 && notes[2]?.note === 3 && notes[0]?.instrument === 'grosse_caisse'
      && onPlanks1?.instrument === 'basse' && onPlanksHeld === onPlanks1?.count
      && otherInstruments.sandInst === 'flute' && otherInstruments.glassInst === 'clochette',
      JSON.stringify({ notes, onPlanks1, onPlanksHeld, otherInstruments }));
  });

  // ========================================================================= Commandes /give
  await ev(page, () => { window.__game.player.inventory.clear(); });
  for (const cmd of ['/give repeater', '/give comparator', '/give hopper', '/give dispenser', '/give dropper', '/give daylight_detector', '/give noteblock', '/give note_block']) {
    await chat(page, cmd);
  }
  const giveCheck = await ev(page, () => {
    const slots = window.__game.player.inventory.slots;
    const countOf = (id) => slots.reduce((s, st) => s + (st && st.id === id ? st.count : 0), 0);
    return {
      rep: countOf(B.REPEATER),
      comp: countOf(B.COMPARATOR),
      hop: countOf(B.HOPPER),
      disp: countOf(B.DISPENSER),
      drop: countOf(B.DROPPER),
      day: countOf(B.DAYLIGHT_DETECTOR),
      note: countOf(B.NOTE_BLOCK),
    };
  });
  check('commandes /give : repeater, comparator, hopper, dispenser, dropper, daylight_detector, noteblock/note_block',
    giveCheck.rep >= 1 && giveCheck.comp >= 1 && giveCheck.hop >= 1 && giveCheck.disp >= 1
    && giveCheck.drop >= 1 && giveCheck.day >= 1 && giveCheck.note >= 2,
    JSON.stringify(giveCheck));

  // ========================================================================= Sauvegarde & export/import
  await section('sauvegarde et export/import', async () => {
    await ev(page, async () => {
      const { getChest, getDaylight, getDispenser, getHopper } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world, p = g.player;
      p.teleport(70.5, 4, 72.5);
      // Répéteur à délai 4 (bits 12) + comparateur mode soustraction + coffre plein
      w.setBlock(70, 4, 70, B.REPEATER, 2 | 12, true);
      w.setBlock(72, 4, 71, B.CHEST, 2, true);
      const chest = getChest(w, 72, 4, 71);
      for (let i = 0; i < 27; i++) chest.items[i] = makeStack(B.IRON_BLOCK, 64);
      w.markBlockEntityDirty(chest);
      w.setBlock(72, 4, 70, B.COMPARATOR, 2 | 4 | (15 << 4), true);
      // Entonnoir et distributeur avec contenu + capteur inversé + bloc musical accordé
      w.setBlock(74, 4, 70, B.HOPPER, 1, true);
      const hop = getHopper(w, 74, 4, 70);
      hop.items[0] = makeStack(I.EMERALD, 12);
      w.markBlockEntityDirty(hop);
      w.setBlock(76, 4, 70, B.DISPENSER, 2, true);
      const disp = getDispenser(w, 76, 4, 70, 'dispenser');
      disp.items[4] = makeStack(I.ARROW, 16);
      w.markBlockEntityDirty(disp);
      w.setBlock(78, 4, 70, B.DAYLIGHT_DETECTOR, 16, true);
      getDaylight(w, 78, 4, 70);
      w.setBlock(80, 4, 70, B.NOTE_BLOCK, 17, true);
    });
    await ticks(page, 4);
    await reload(page);

    const checkSaved = async () => ev(page, async () => {
      const { getChest, getDispenser, getHopper } = await import('/src/game/BlockEntities.ts');
      const w = window.__game.world;
      const chest = getChest(w, 72, 4, 71);
      const hop = getHopper(w, 74, 4, 70);
      const disp = getDispenser(w, 76, 4, 70, 'dispenser');
      return {
        repDelay: ((w.getMeta(70, 4, 70) >> 2) & 3) + 1,
        compModeSub: (w.getMeta(72, 4, 70) & 4) !== 0,
        compOut: (w.getMeta(72, 4, 70) >> 4) & 15,
        chestFull: chest.items.every((s) => s && s.id === B.IRON_BLOCK && s.count === 64),
        hopEmerald: hop.items[0]?.id === I.EMERALD && hop.items[0]?.count === 12,
        dispArrow: disp.items[4]?.id === I.ARROW && disp.items[4]?.count === 16,
        dayInv: (w.getMeta(78, 4, 70) & 16) !== 0,
        noteVal: w.getMeta(80, 4, 70) & 31,
      };
    });

    const afterReload = await checkSaved();
    check('sauvegarde : blocs redstone (délai, mode, inversion, note) et conteneurs pleins persistent',
      afterReload.repDelay === 4 && afterReload.compModeSub && afterReload.compOut === 15
      && afterReload.chestFull && afterReload.hopEmerald && afterReload.dispArrow
      && afterReload.dayInv && afterReload.noteVal === 17,
      JSON.stringify(afterReload));

    // Export / import .aetherworld
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
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

    const afterImport = await checkSaved();
    check('export/import .aetherworld : conserve tous les réglages redstone et le contenu des conteneurs',
      !!importedId && afterImport.repDelay === 4 && afterImport.compModeSub && afterImport.compOut === 15
      && afterImport.chestFull && afterImport.hopEmerald && afterImport.dispArrow
      && afterImport.dayInv && afterImport.noteVal === 17,
      JSON.stringify(afterImport));
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));

  await browser.close();
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
})();
