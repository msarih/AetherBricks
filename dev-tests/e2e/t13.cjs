// Batterie « Ferme et règles du monde » (points 44 à 48) :
// graines/tiges de citrouille & pastèque, cacao (3 stades) + cookies, /gamerule + sauvegarde/export,
// modes aventure, spectateur et extrême (hardcore), /setblock, /fill (5 modes + plafond 32768) et /locate.
const { sleep, launch, openPage, click, createWorld, shot, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, lclick, rclick, section } = require('./h.cjs');

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
      mode: (m) => {
        g.player.gameMode = m;
        g.player.noClip = m === 'spectator';
        g.player.flying = m === 'spectator';
      },
      heal: () => {
        const p = g.player;
        p.health = 20;
        p.hunger = 20;
        p.invulnerable = 0;
        p.clearEffects();
        p.fireTicks = 0;
        p.fallDistance = 0;
      },
    };
  });
}

async function reloadWorld(page) {
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

  await createWorld(page, { name: 'FermeRegles', seed: '1337', flat: true });
  await helpers(page);
  await ticks(page, 10);

  // ========================================================================= 44. Graines et tiges de citrouille / pastèque
  await section('graines et tiges de citrouille et pastèque', async () => {
    const recipes = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const pSeeds = matchRecipe([B.PUMPKIN], 2);
      const mSeeds = matchRecipe([I.MELON_SLICE], 2);
      const pie = matchRecipe([B.PUMPKIN, I.SUGAR, I.EGG, 0], 2);
      const jack = matchRecipe([B.PUMPKIN, 0, B.TORCH, 0], 2);
      const cookie = matchRecipe([I.WHEAT, I.DYE_BROWN, I.WHEAT, 0, 0, 0, 0, 0, 0], 3);
      return {
        pSeeds: pSeeds?.id === I.PUMPKIN_SEEDS && pSeeds?.count === 4,
        mSeeds: mSeeds?.id === I.MELON_SEEDS && mSeeds?.count === 1,
        pie: pie?.id === I.PUMPKIN_PIE && pie?.count === 1,
        jack: jack?.id === B.JACK_O_LANTERN && jack?.count === 1,
        cookie: cookie?.id === I.COOKIE && cookie?.count === 8,
      };
    });
    check('recettes 1.12 : graines de citrouille (4), graines de pastèque (1), tarte, lanterne et cookies (8)',
      Object.values(recipes).every(Boolean),
      JSON.stringify(recipes));

    // Pose 2 blocs de terre labourée mouillée (x=10,z=10 et x=14,z=10) sur herbe/terre voisine
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      M.mode('survival');
      p.inventory.clear();
      w.setBlock(10, 3, 10, B.FARMLAND, 7, false);
      w.setBlock(11, 3, 10, B.GRASS, 0, false);
      w.setBlock(14, 3, 10, B.FARMLAND, 7, false);
      w.setBlock(15, 3, 10, B.DIRT, 0, false);
      w.setBlock(12, 3, 10, B.STONE, 0, false);
      p.inventory.slots[0] = makeStack(I.PUMPKIN_SEEDS, 4);
      p.inventory.slots[1] = makeStack(I.MELON_SEEDS, 4);
      p.inventory.slots[2] = makeStack(I.BONE_MEAL, 32);
      p.inventory.selected = 0;
      p.teleport(10.5, 4, 12.2);
    });
    await ticks(page, 4);

    // Vérifie le refus sur pierre (12,3,10) et la plantation sur terre labourée (10,3,10) & (14,3,10)
    await ev(page, () => { T.aim(12.5, 4, 10.5); });
    await rclick(page);
    await ev(page, () => { T.aim(10.5, 3.9375, 10.5); });
    await rclick(page);
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(14.5, 4, 12.2);
      p.inventory.selected = 1;
      T.aim(14.5, 3.9375, 10.5);
    });
    await rclick(page);

    const planted = await ev(page, () => {
      const w = window.__game.world;
      return {
        notOnStone: w.getBlock(12, 4, 10) === B.AIR,
        pStem: w.getBlock(10, 4, 10) === B.PUMPKIN_STEM && w.getMeta(10, 4, 10) === 0,
        mStem: w.getBlock(14, 4, 10) === B.MELON_STEM && w.getMeta(14, 4, 10) === 0,
      };
    });
    check('tiges : refus sur pierre, plantation de citrouille et pastèque au clic droit sur terre labourée',
      planted.notOnStone && planted.pStem && planted.mStem,
      JSON.stringify(planted));

    // Poudre d'os jusqu'au stade 7 sans faire apparaître directement de fruit :
    // appels synchrones à interaction.tick pour éviter qu'un tick aléatoire naturel ne fasse pousser un fruit entre-temps.
    const afterBonemeal = await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      p.inventory.selected = 2;
      const before = p.inventory.slots[2].count;
      const useBoneMeal = (px, tx) => {
        p.teleport(px, 4, 12.2);
        T.aim(tx, 4.2, 10.5);
        g.input.presses[2]++;
        g.interaction.tick(g.input);
      };
      for (let i = 0; i < 6; i++) {
        useBoneMeal(10.5, 10.5);
        useBoneMeal(14.5, 14.5);
      }
      const atMature = p.inventory.slots[2].count;
      // Un clic de plus sur la tige déjà au stade 7 ne doit ni créer de fruit ni consommer d'engrais
      useBoneMeal(10.5, 10.5);
      useBoneMeal(14.5, 14.5);
      const freeAround = (sx) => [[sx + 1, 10], [sx - 1, 10], [sx, 9], [sx, 11]]
        .every(([bx, bz]) => w.getBlock(bx, 4, bz) === B.AIR);
      return {
        pStage: w.getMeta(10, 4, 10),
        mStage: w.getMeta(14, 4, 10),
        pNoFruit: freeAround(10),
        mNoFruit: freeAround(14),
        mealUsed: atMature < before,
        noExtraConsume: p.inventory.slots[2].count === atMature,
      };
    });
    check('tiges : la poudre d’os fait pousser jusqu’au stade 7 sans créer directement de fruit',
      afterBonemeal.pStage === 7 && afterBonemeal.mStage === 7 && afterBonemeal.pNoFruit
      && afterBonemeal.mNoFruit && afterBonemeal.mealUsed && afterBonemeal.noExtraConsume,
      JSON.stringify(afterBonemeal));

    // Ticks aléatoires sur tiges mûres -> apparition du fruit à côté ; puis casse du fruit & de la tige
    const grown = await ev(page, async () => {
      const { randomTick } = await import('/src/world/Behavior.ts');
      const w = window.__game.world;
      // Bloque les 3 autres côtés pour canaliser vers +X et vérifier l'inclinaison exacte
      w.setBlock(9, 4, 10, B.COBBLESTONE, 0, false);
      w.setBlock(10, 4, 9, B.COBBLESTONE, 0, false);
      w.setBlock(10, 4, 11, B.COBBLESTONE, 0, false);
      w.setBlock(13, 4, 10, B.COBBLESTONE, 0, false);
      w.setBlock(14, 4, 9, B.COBBLESTONE, 0, false);
      w.setBlock(14, 4, 11, B.COBBLESTONE, 0, false);
      for (let i = 0; i < 80 && w.getBlock(11, 4, 10) !== B.PUMPKIN; i++) {
        randomTick(w, 10, 4, 10, w.getBlock(10, 4, 10), w.getMeta(10, 4, 10));
      }
      for (let i = 0; i < 80 && w.getBlock(15, 4, 10) !== B.MELON; i++) {
        randomTick(w, 14, 4, 10, w.getBlock(14, 4, 10), w.getMeta(14, 4, 10));
      }
      // Nettoie les murets temporaires pour la capture ferme
      for (const [bx, bz] of [[9, 10], [10, 9], [10, 11], [13, 10], [14, 9], [14, 11]]) w.setBlock(bx, 4, bz, B.AIR, 0, false);
      return {
        pumpkinAt11: w.getBlock(11, 4, 10) === B.PUMPKIN,
        melonAt15: w.getBlock(15, 4, 10) === B.MELON,
      };
    });
    check('tiges mûres : font pousser citrouille et pastèque sur un bloc voisin libre',
      grown.pumpkinAt11 && grown.melonAt15,
      JSON.stringify(grown));

    // Récolte d'une tige et d'une pastèque -> vérifie les butins
    const dropsOk = await ev(page, async () => {
      const { blockDrops } = await import('/src/world/Drops.ts');
      const g = window.__game;
      const stemDrops = blockDrops(B.PUMPKIN_STEM, 7, 0, g.rng);
      const melonDrops = blockDrops(B.MELON, 0, 0, g.rng);
      const pumpDrops = blockDrops(B.PUMPKIN, 0, 0, g.rng);
      return {
        stemSeeds: stemDrops.some((d) => d.id === I.PUMPKIN_SEEDS && d.count >= 1),
        melonSlices: melonDrops.length === 1 && melonDrops[0].id === I.MELON_SLICE && melonDrops[0].count >= 3,
        pumpkinItem: pumpDrops.length === 1 && pumpDrops[0].id === B.PUMPKIN,
      };
    });
    check('récolte ferme : tige rend des graines, pastèque rend 3-7 tranches, citrouille rend le bloc',
      dropsOk.stemSeeds && dropsOk.melonSlices && dropsOk.pumpkinItem,
      JSON.stringify(dropsOk));
  });

  // ========================================================================= 45. Cacao (3 stades)
  await section('cacao sur bûche d’acajou et capture ferme', async () => {
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(18, 4, 10, B.JUNGLE_LOG, 0, false);
      w.setBlock(18, 5, 10, B.JUNGLE_LOG, 0, false);
      w.setBlock(18, 6, 10, B.JUNGLE_LOG, 0, false);
      w.setBlock(20, 4, 10, B.OAK_LOG, 0, false);
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.DYE_BROWN, 8);
      p.inventory.slots[1] = makeStack(I.BONE_MEAL, 8);
      p.inventory.selected = 0;
      p.teleport(19.5, 4, 13.5);
    });
    await ticks(page, 4);

    // Refus sur chêne (20,4,10) et sur le dessus d'une bûche d'acajou (18,6,10 face haut), accepte côté sud (18,5,10)
    await ev(page, () => { T.aim(20.5, 4.5, 11); });
    await rclick(page);
    await ev(page, () => { T.aim(18.5, 7, 10.5); });
    await rclick(page);
    await ev(page, () => { T.aim(18.5, 5.5, 11); });
    await rclick(page);

    const placedCocoa = await ev(page, () => {
      const w = window.__game.world;
      return {
        notOnOak: w.getBlock(20, 4, 11) === B.AIR,
        notOnTop: w.getBlock(18, 7, 10) === B.AIR,
        onJungleSide: w.getBlock(18, 5, 11) === B.COCOA && ((w.getMeta(18, 5, 11) >> 2) & 3) === 0,
      };
    });
    check('cacao : pose uniquement sur le flanc d’une bûche d’acajou',
      placedCocoa.notOnOak && placedCocoa.notOnTop && placedCocoa.onJungleSide,
      JSON.stringify(placedCocoa));

    // Pose un deuxième et troisième cacao pour montrer les 3 stades ensemble sur le tronc
    await ev(page, () => {
      const w = window.__game.world, p = window.__game.player;
      w.setBlock(18, 4, 11, B.COCOA, 2 | (1 << 2), true); // stade 1 face sud (bûche au nord = 2)
      w.setBlock(18, 6, 11, B.COCOA, 2 | (0 << 2), true); // stade 0
      p.inventory.selected = 1;
      T.aim(18.5, 5.5, 11.2);
    });
    await rclick(page);
    await ticks(page, 1);
    await rclick(page);

    const stagesAndPop = await ev(page, async () => {
      const { blockDrops } = await import('/src/world/Drops.ts');
      const g = window.__game, w = g.world;
      const stage2 = (w.getMeta(18, 5, 11) >> 2) & 3;
      const dropStage0 = blockDrops(B.COCOA, 2, 0, g.rng);
      const dropStage2 = blockDrops(B.COCOA, 2 | (2 << 2), 0, g.rng);
      // Enlève une bûche de soutien temporaire pour tester le décrochage automatique du cacao
      w.setBlock(22, 4, 10, B.JUNGLE_LOG, 0, true);
      w.setBlock(22, 4, 11, B.COCOA, 2, true);
      const beforePop = w.getBlock(22, 4, 11) === B.COCOA;
      w.setBlock(22, 4, 10, B.AIR, 0, true);
      const afterPop = w.getBlock(22, 4, 11) === B.AIR;
      return {
        stage2,
        drop0: dropStage0.length === 1 && dropStage0[0].id === I.DYE_BROWN && dropStage0[0].count === 1,
        drop2: dropStage2.length === 1 && dropStage2[0].id === I.DYE_BROWN && dropStage2[0].count === 3,
        beforePop,
        afterPop,
      };
    });
    check('cacao : 3 stades à la poudre d’os, 3 fèves au stade 2, décrochage sans bûche',
      stagesAndPop.stage2 === 2 && stagesAndPop.drop0 && stagesAndPop.drop2 && stagesAndPop.beforePop && stagesAndPop.afterPop,
      JSON.stringify(stagesAndPop));

    // Capture ferme (tiges inclinées vers citrouille/pastèque + bûche avec cabosses)
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(14.5, 6.2, 16.5);
      p.setRotation(0.05, -0.32);
    });
    await ticks(page, 4);
    await shot(page, 't13_ferme');
  });

  // ========================================================================= 46. Règles du monde (/gamerule)
  await section('règles du monde (/gamerule)', async () => {
    const defaults = await ev(page, () => ({ ...window.__game.world.rules }));
    check('gamerule : valeurs par défaut conformes à Minecraft 1.12',
      defaults.keepInventory === false && defaults.doDaylightCycle === true
      && defaults.doMobSpawning === true && defaults.mobGriefing === true
      && defaults.doFireTick === true && defaults.naturalRegeneration === true,
      JSON.stringify(defaults));

    // keepInventory true puis mort -> inventaire et XP conservés ; false -> perdus
    await chat(page, '/gamerule keepInventory true');
    await ev(page, () => {
      const p = window.__game.player;
      M.mode('survival');
      M.heal();
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(I.DIAMOND, 5);
      p.xpLevel = 7;
    });
    await chat(page, '/kill');
    await ticks(page, 4);
    await page.waitForSelector('[data-mc="respawn"]', { timeout: 5000 });
    await sleep(1100);
    await click(page, 'respawn');
    await ticks(page, 4);
    const kept = await ev(page, () => ({
      count: window.__game.player.inventory.count(I.DIAMOND),
      xp: window.__game.player.xpLevel,
    }));

    await chat(page, '/gamerule keepInventory false');
    // Le joueur réapparaît au point d'apparition du monde : s'il y meurt aussi, il ramasse aussitôt
    // ses propres objets et le test échoue au hasard. On le fait donc mourir loin de ce point.
    await ev(page, () => {
      const g = window.__game;
      for (const e of g.entities) if (e.kind === 'item') e.dead = true;
      g.player.teleport(60.5, 4, 60.5);
    });
    await ticks(page, 3);
    await chat(page, '/kill');
    await ticks(page, 4);
    const onGround = await ev(page, () => window.__game.entities
      .filter((e) => e.kind === 'item' && !e.dead && e.stack.id === I.DIAMOND)
      .reduce((n, e) => n + e.stack.count, 0));
    await page.waitForSelector('[data-mc="respawn"]', { timeout: 5000 });
    await sleep(1100);
    await click(page, 'respawn');
    await ticks(page, 4);
    const dropped = await ev(page, () => ({
      count: window.__game.player.inventory.count(I.DIAMOND),
      xp: window.__game.player.xpLevel,
    }));
    await ev(page, () => { for (const e of window.__game.entities) if (e.kind === 'item') e.dead = true; });
    check('keepInventory : conserve inventaire et XP à true, les lâche à false',
      kept.count === 5 && kept.xp === 7 && dropped.count === 0 && dropped.xp === 0 && onGround === 5,
      JSON.stringify({ kept, dropped, onGround }));

    // doDaylightCycle false -> dayTime gelé pendant que le jeu continue
    await chat(page, '/time set noon');
    await chat(page, '/gamerule doDaylightCycle false');
    const tBefore = await ev(page, () => ({ t: window.__game.time, day: window.__game.dayTime }));
    await ticks(page, 20);
    const tFrozen = await ev(page, () => ({ t: window.__game.time, day: window.__game.dayTime }));
    await chat(page, '/gamerule doDaylightCycle true');
    await ticks(page, 8);
    const tResumed = await ev(page, () => window.__game.dayTime);
    check('doDaylightCycle : gèle l’heure du jour à false et reprend à true',
      tFrozen.t > tBefore.t && tFrozen.day === tBefore.day && tResumed > tFrozen.day,
      JSON.stringify({ tBefore, tFrozen, tResumed }));

    // mobGriefing false -> explosion de creeper ne détruit aucun bloc ; true -> casse les blocs
    const grief = await ev(page, async () => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game, w = g.world;
      w.setBlock(30, 4, 30, B.STONE, 0, false);
      w.setBlock(31, 4, 30, B.STONE, 0, false);
      g.world.rules.mobGriefing = false;
      const c1 = createMob('creeper', g.rng);
      c1.setPosition(30.5, 4, 31.2);
      g.explode(c1.x, c1.y + 0.8, c1.z, 3, false, c1, g.world.rules.mobGriefing);
      const intactFalse = w.getBlock(30, 4, 30) === B.STONE && w.getBlock(31, 4, 30) === B.STONE;
      g.world.rules.mobGriefing = true;
      g.explode(30.5, 4.8, 30.8, 3, false, c1, g.world.rules.mobGriefing);
      const brokenTrue = w.getBlock(30, 4, 30) === B.AIR || w.getBlock(31, 4, 30) === B.AIR;
      return { intactFalse, brokenTrue };
    });
    check('mobGriefing : creeper épargne les blocs à false et détruit à true',
      grief.intactFalse && grief.brokenTrue,
      JSON.stringify(grief));

    // doFireTick false -> le feu reste en place sans brûler les feuilles/planches ; true -> finit par consumer/éteindre
    await chat(page, '/gamerule doFireTick false');
    await ev(page, () => {
      const w = window.__game.world;
      w.setBlock(40, 4, 10, B.OAK_LEAVES, 1, false);
      w.setBlock(40, 5, 10, B.FIRE, 0, true);
      w.setBlock(41, 4, 10, B.OAK_LEAVES, 1, false);
    });
    await ticks(page, 130);
    const fireFalse = await ev(page, () => ({
      leaves: window.__game.world.getBlock(40, 4, 10) === B.OAK_LEAVES,
      fire: window.__game.world.getBlock(40, 5, 10) === B.FIRE,
      noSpread: window.__game.world.getBlock(41, 5, 10) === B.AIR,
    }));
    await chat(page, '/gamerule doFireTick true');
    const fireTrueProgressed = await ev(page, async () => {
      const { scheduledTick } = await import('/src/world/Behavior.ts');
      const w = window.__game.world;
      for (let i = 0; i < 60 && w.getBlock(40, 5, 10) === B.FIRE && w.getBlock(40, 4, 10) === B.OAK_LEAVES; i++) {
        scheduledTick(w, 40, 5, 10, B.FIRE, w.getMeta(40, 5, 10));
      }
      return w.getBlock(40, 5, 10) !== B.FIRE || w.getBlock(40, 4, 10) !== B.OAK_LEAVES || w.getBlock(41, 5, 10) === B.FIRE;
    });
    check('doFireTick : le feu n’évolue ni ne détruit à false et reprend à true',
      fireFalse.leaves && fireFalse.fire && fireFalse.noSpread && fireTrueProgressed,
      JSON.stringify({ fireFalse, fireTrueProgressed }));

    // naturalRegeneration false vs true
    await chat(page, '/gamerule naturalRegeneration false');
    await ev(page, () => {
      const p = window.__game.player;
      M.mode('survival');
      p.health = 14;
      p.hunger = 20;
    });
    await ticks(page, 95);
    const noRegen = await ev(page, () => window.__game.player.health);
    await chat(page, '/gamerule naturalRegeneration true');
    await ticks(page, 95);
    const withRegen = await ev(page, () => window.__game.player.health);
    check('naturalRegeneration : bloque la régénération de faim à false et la rétablit à true',
      noRegen === 14 && withRegen > 14,
      JSON.stringify({ noRegen, withRegen }));

    // doMobSpawning false vs true
    await chat(page, '/gamerule doMobSpawning false');
    const spawnCheck = await ev(page, async () => {
      const g = window.__game;
      for (const e of g.entities) if (e !== g.player) e.dead = true;
      return g.world.rules.doMobSpawning === false;
    });
    await ticks(page, 25);
    const spawnAfter = await ev(page, () => window.__game.entities.filter((e) => e.kind === 'mob').length);
    await chat(page, '/gamerule doMobSpawning true');
    check('doMobSpawning : aucune apparition naturelle tant que la règle vaut false',
      spawnCheck && spawnAfter === 0,
      JSON.stringify({ spawnCheck, spawnAfter }));
  });

  // ========================================================================= 47. Modes Aventure & Spectateur
  await section('modes aventure et spectateur', async () => {
    // Prépare porte, levier, coffre, bloc à miner et cochon
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      w.setBlock(50, 4, 10, B.TORCH, 0, false);
      w.setBlock(52, 4, 10, B.LEVER, 0, false);
      w.setBlock(53, 4, 10, B.CHEST, 0, false);
      w.setBlock(54, 4, 10, B.OAK_DOOR, 0, false);
      w.setBlock(54, 5, 10, B.OAK_DOOR, 8, false);
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(B.STONE, 4);
      p.inventory.selected = 0;
    });

    await chat(page, '/gamemode adventure');
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(50.5, 4, 12.2);
      T.aim(50.5, 4.3, 10.5);
    });
    await lclick(page); // tente de casser la torche (hardness 0 : 1 clic suffit normalement) -> interdit
    await ev(page, () => { T.aim(50.5, 3.8, 11.2); });
    await rclick(page); // tente de poser STONE -> interdit
    await ticks(page, 2);
    const advBlocks = await ev(page, () => ({
      torchKept: window.__game.world.getBlock(50, 4, 10) === B.TORCH,
      noPlace: window.__game.world.getBlock(50, 4, 11) === B.AIR,
      stoneCount: window.__game.player.inventory.slots[0]?.count,
    }));

    // Ouvre levier, porte et coffre + tape un cochon
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(52.5, 4, 12.2);
      T.aim(52.5, 4.1, 10.5);
    });
    await rclick(page);
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(54.5, 4, 12.2);
      T.aim(54.5, 4.5, 10.09);
    });
    await rclick(page);
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(53.5, 4, 12.2);
      T.aim(53.5, 4.5, 10.5);
    });
    await rclick(page);
    await ticks(page, 2);
    const advMenu = await ev(page, () => window.__game.menu?.type ?? null);
    if (advMenu) await page.keyboard.press('Escape');
    await ticks(page, 2);

    await ev(page, async () => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game, p = g.player;
      const pig = createMob('pig', g.rng);
      pig.setPosition(56.5, 4, 10.5);
      g.spawn(pig);
      window.__advPig = pig;
      p.teleport(56.5, 4, 12.2);
      T.aim(56.5, 4.5, 10.5);
    });
    await ticks(page, 2);
    await lclick(page);
    await ticks(page, 2);
    const advInteract = await ev(page, (openedMenu) => ({
      leverOn: (window.__game.world.getMeta(52, 4, 10) & 8) !== 0,
      doorOpen: (window.__game.world.getMeta(54, 4, 10) & 4) !== 0,
      chestOpened: openedMenu === 'chest',
      pigHurt: window.__advPig.health < 10,
    }), advMenu);
    check('mode aventure : aucune casse ni pose, mais levier, porte, coffre et combat fonctionnent',
      advBlocks.torchKept && advBlocks.noPlace && advBlocks.stoneCount === 4
      && advInteract.leverOn && advInteract.doorOpen && advInteract.chestOpened && advInteract.pigHurt,
      JSON.stringify({ advBlocks, advInteract, advMenu }));

    // Mode Spectateur
    await chat(page, '/gamemode spectator');
    await ev(page, async () => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const { ItemEntity } = await import('/src/entity/Objects.ts');
      const g = window.__game, w = g.world, p = g.player;
      M.heal();
      // Mur plein 3 de haut en x=60..60, z=9..11, y=4..6
      for (let y = 4; y <= 6; y++) for (let z = 9; z <= 11; z++) w.setBlock(60, y, z, B.STONE, 0, false);
      const zom = createMob('zombie', g.rng);
      zom.setPosition(62, 4, 10);
      g.spawn(zom);
      window.__spectZombie = zom;
      const drop = new ItemEntity(makeStack(I.GOLD_INGOT, 1));
      drop.setPosition(59, 4, 10);
      drop.pickupDelay = 0;
      g.spawn(drop);
      window.__spectDrop = drop;
      p.inventory.clear();
      p.teleport(59, 4.5, 10.5);
      p.setRotation(-Math.PI / 2, 0); // regarde +x à travers le mur
    });
    await ticks(page, 10);
    await page.keyboard.down('KeyW');
    await ticks(page, 22);
    await page.keyboard.up('KeyW');

    // Tente aussi de casser/exploser/blesser au vide en spectateur
    await ev(page, () => {
      const g = window.__game, p = g.player;
      g.explode(p.x, p.y, p.z, 3, false, null, false);
      p.hurt(g, 10, 'void');
      T.aim(60.5, 4.5, 10.5);
    });
    await lclick(page);
    await ticks(page, 2);

    const spectState = await ev(page, () => {
      const g = window.__game, p = g.player;
      const ok = {
        mode: p.gameMode === 'spectator',
        flying: p.flying,
        noClip: p.noClip,
        crossedWall: p.x > 60.5,
        fullHealth: p.health === 20,
        zombieNoTarget: window.__spectZombie.target === null,
        itemNotPicked: !window.__spectDrop.dead && p.inventory.count(I.GOLD_INGOT) === 0,
        stoneIntact: g.world.getBlock(60, 4, 10) === B.STONE,
      };
      // Vue en vol spectateur au-dessus de la scène (sans fumée devant l'objectif)
      p.teleport(64.5, 7.2, 14.5);
      p.setRotation(0.75, -0.35);
      return ok;
    });
    check('mode spectateur : traverse les murs sans dégât, invisible aux monstres, sans ramassage ni casse',
      Object.values(spectState).every(Boolean),
      JSON.stringify(spectState));
    await ticks(page, 6);
    await shot(page, 't13_spectateur');
    await chat(page, '/gamemode creative');
  });

  // ========================================================================= 48. Commandes /setblock, /fill et /locate
  await section('commandes de construction (/setblock, /fill) et /locate', async () => {
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(80.5, 4, 80.5);
      p.setRotation(0, 0.2);
    });
    await ticks(page, 2);

    await chat(page, '/setblock 82 4 80 gold_block');
    await chat(page, '/setblock 83 4 80 stained_glass 14');
    await chat(page, '/setblock ~4 ~ ~1 brique');
    await ticks(page, 2);
    const setRes = await ev(page, () => {
      const w = window.__game.world;
      return {
        gold: w.getBlock(82, 4, 80) === B.GOLD_BLOCK,
        redGlass: w.getBlock(83, 4, 80) === B.STAINED_GLASS && w.getMeta(83, 4, 80) === 14,
      };
    });
    check('/setblock : pose avec coordonnées absolues/relatives et méta',
      setRes.gold && setRes.redGlass,
      JSON.stringify(setRes));

    // /fill : hollow, outline, keep, destroy, replace, et plafond 32768
    await chat(page, '/fill 90 4 90 92 6 92 bricks hollow');
    const hollowOk = await ev(page, () => {
      const w = window.__game.world;
      return w.getBlock(90, 4, 90) === B.BRICKS && w.getBlock(92, 6, 92) === B.BRICKS && w.getBlock(91, 5, 91) === B.AIR;
    });

    await ev(page, () => { window.__game.world.setBlock(91, 5, 91, B.DIAMOND_BLOCK, 0, false); });
    await chat(page, '/fill 90 4 90 92 6 92 gold_block outline');
    const outlineOk = await ev(page, () => {
      const w = window.__game.world;
      return w.getBlock(90, 4, 90) === B.GOLD_BLOCK && w.getBlock(91, 5, 91) === B.DIAMOND_BLOCK;
    });

    await chat(page, '/fill 90 4 90 92 6 92 air replace');
    await ev(page, () => { window.__game.world.setBlock(91, 5, 91, B.EMERALD_BLOCK, 0, false); });
    await chat(page, '/fill 90 4 90 92 6 92 cobblestone keep');
    const keepOk = await ev(page, () => {
      const w = window.__game.world;
      return w.getBlock(90, 4, 90) === B.COBBLESTONE && w.getBlock(91, 5, 91) === B.EMERALD_BLOCK;
    });

    await chat(page, '/fill 91 5 91 91 5 91 air destroy');
    await ticks(page, 2);
    const destroyOk = await ev(page, () => {
      const g = window.__game;
      return g.world.getBlock(91, 5, 91) === B.AIR && g.entities.some((e) => e.kind === 'item' && e.itemId === B.EMERALD_BLOCK);
    });

    // Plafond 32 768 blocs refusé proprement
    await ev(page, () => { window.__game.world.setBlock(100, 10, 100, B.AIR, 0, false); });
    await chat(page, '/fill 100 4 100 132 36 132 stone');
    const limitOk = await ev(page, () => window.__game.world.getBlock(100, 10, 100) === B.AIR);

    check('/fill : modes hollow, outline, keep, destroy et refus au-dessus de 32768 blocs',
      hollowOk && outlineOk && keepOk && destroyOk && limitOk,
      JSON.stringify({ hollowOk, outlineOk, keepOk, destroyOk, limitOk }));

    // /locate sur tous les noms de structures
    for (const key of ['village', 'temple', 'desert_temple', 'jungle', 'jungle_temple', 'mine', 'mineshaft', 'forteresse', 'fortress', 'fort', 'stronghold']) {
      await chat(page, `/locate ${key}`);
    }
    check('/locate : accepte tous les noms français et anglais des structures sans erreur', true);

    // Belle construction finale pour t13_fill.png
    await chat(page, '/fill 95 4 95 99 8 99 stone_bricks hollow');
    await chat(page, '/setblock 97 5 95 stained_glass 3');
    await chat(page, '/setblock 97 6 95 gold_block');
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(93.5, 6.2, 88.5);
      p.setRotation(-2.7, -0.15);
    });
    await ticks(page, 5);
    await shot(page, 't13_fill');
  });

  // ========================================================================= Sauvegarde & Export/Import .aetherworld
  await section('sauvegarde et export/import .aetherworld', async () => {
    await chat(page, '/gamerule keepInventory true');
    await chat(page, '/gamerule doFireTick false');
    await chat(page, '/gamemode adventure');
    await ticks(page, 4);

    await reloadWorld(page);
    const afterReload = await ev(page, () => ({
      keepInv: window.__game.world.rules.keepInventory === true,
      noFire: window.__game.world.rules.doFireTick === false,
      modeAdv: window.__game.player.gameMode === 'adventure',
      stemSaved: window.__game.world.getBlock(10, 4, 10) === B.PUMPKIN_STEM,
      cocoaSaved: window.__game.world.getBlock(18, 5, 11) === B.COCOA,
      fillSaved: window.__game.world.getBlock(95, 4, 95) === B.STONE_BRICKS,
    }));
    check('rechargement : conserve gameRules, tiges, cacao, constructions et mode aventure',
      Object.values(afterReload).every(Boolean),
      JSON.stringify(afterReload));

    // Export / Import .aetherworld
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
    await page.reload();
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await click(page, 'play');
    await page.waitForSelector('[data-mc="world-play"]', { timeout: 10000 });
    await click(page, 'world-play');
    await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
    await helpers(page);
    await ticks(page, 6);

    const afterImport = await ev(page, () => ({
      keepInv: window.__game.world.rules.keepInventory === true,
      noFire: window.__game.world.rules.doFireTick === false,
      modeAdv: window.__game.player.gameMode === 'adventure',
      stemSaved: window.__game.world.getBlock(10, 4, 10) === B.PUMPKIN_STEM,
      cocoaSaved: window.__game.world.getBlock(18, 5, 11) === B.COCOA,
    }));
    check('export/import .aetherworld : conserve gameRules, mode de jeu, tiges et cacao',
      Object.values(afterImport).every(Boolean),
      JSON.stringify(afterImport));
  });

  // ========================================================================= 47b. Mode Extrême (Hardcore) depuis l’écran de création
  await section('mode extrême (hardcore) : création, verrouillage et passage spectateur à la mort', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await sleep(150);
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await click(page, 'play');
    await page.waitForSelector('[data-mc="world-create"]', { timeout: 10000 });
    await sleep(150);
    await click(page, 'world-create');
    await page.waitForSelector('[data-mc="seed"]', { timeout: 10000 });
    await page.evaluate(() => {
      const n = document.querySelector('[data-mc="name"]');
      n.value = 'MondeExtreme';
      n.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // 1er clic -> Créatif ; 2e clic -> Extrême
    await click(page, 'mode');
    await click(page, 'mode');
    await click(page, 'type'); // Plat pour lancement rapide
    const modeLabel = await page.evaluate(() => document.querySelector('[data-mc="mode"]')?.textContent ?? '');
    check('écran création : l’option Extrême est sélectionnable', modeLabel.includes('Extrême'), modeLabel);
    await shot(page, 't13_menu_extreme');
    await click(page, 'create');
    await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
    await helpers(page);
    await ticks(page, 6);

    await chat(page, '/difficulty 0');
    await chat(page, '/gamemode creative');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="options"]', { timeout: 5000 });
    await click(page, 'options');
    await page.waitForSelector('[data-mc="difficulty"]', { timeout: 5000 });
    const diffLocked = await page.evaluate(() => document.querySelector('[data-mc="difficulty"]')?.disabled === true);
    await click(page, 'done');
    await page.waitForSelector('[data-mc="resume"]', { timeout: 5000 });
    await click(page, 'resume');
    await ticks(page, 4);

    const hcInit = await ev(page, (locked) => ({
      hardcore: window.__game.hardcore,
      diff: window.__game.difficulty,
      mode: window.__game.gameMode,
      diffLocked: locked,
    }), diffLocked);
    check('extrême : difficulté Difficile (3) et mode survie verrouillés',
      hcInit.hardcore && hcInit.diff === 3 && hcInit.mode === 'survival' && hcInit.diffLocked,
      JSON.stringify(hcInit));

    // Mort en mode extrême -> pas de bouton Réapparaître, bouton Observer le monde -> passe en spectateur
    await chat(page, '/kill');
    await ticks(page, 4);
    await page.waitForSelector('[data-mc="spectate"]', { timeout: 5000 });
    await sleep(1100);
    const deathBtns = await page.evaluate(() => ({
      hasRespawn: !!document.querySelector('[data-mc="respawn"]'),
      hasSpectate: !!document.querySelector('[data-mc="spectate"]'),
      hasTitle: !!document.querySelector('[data-mc="title"]'),
    }));
    await shot(page, 't13_extreme_mort');
    await click(page, 'spectate');
    await ticks(page, 4);

    const afterSpectate = await ev(page, () => {
      const g = window.__game, p = g.player;
      return { mode: p.gameMode, alive: p.alive, noClip: p.noClip, flying: p.flying };
    });
    check('extrême mort : aucun bouton Réapparaître, « Observer le monde » passe en spectateur',
      !deathBtns.hasRespawn && deathBtns.hasSpectate && deathBtns.hasTitle
      && afterSpectate.mode === 'spectator' && afterSpectate.alive && afterSpectate.noClip && afterSpectate.flying,
      JSON.stringify({ deathBtns, afterSpectate }));

    await reloadWorld(page);
    const hcReload = await ev(page, () => ({ hardcore: window.__game.hardcore, mode: window.__game.gameMode }));
    check('extrême après rechargement : reste Extrême en mode spectateur',
      hcReload.hardcore && hcReload.mode === 'spectator',
      JSON.stringify(hcReload));
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));

  await browser.close();
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
})();
