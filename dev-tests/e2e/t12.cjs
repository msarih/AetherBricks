// Batterie « Construction et décoration » (points 38 à 43) :
// verre teinté, terre cuite colorée, tapis, variantes de bois (portes/barrières/portillons),
// tableaux et cadres muraux, jukebox et disques de musique (donjons), sauvegarde et export/import.
const { sleep, launch, openPage, click, createWorld, ticks } = require('./lib.cjs');
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

  await createWorld(page, { name: 'ConstructionDeco', seed: '1337', flat: true });
  await helpers(page);
  await ticks(page, 10);

  // ========================================================================= 38 & 39. Verre teinté & Terre cuite colorée (16 couleurs)
  await section('verre teinté et terre cuite colorée', async () => {
    const recipesOk = await ev(page, async () => {
      const { COLOR_NAMES, B, I } = await import('/src/world/Ids.ts');
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      let glassOk = true;
      let terracottaOk = true;
      for (let i = 0; i < COLOR_NAMES.length; i++) {
        const dye = I.DYE_WHITE + i;
        const gRes = matchRecipe([B.GLASS, B.GLASS, B.GLASS, B.GLASS, dye, B.GLASS, B.GLASS, B.GLASS, B.GLASS], 3);
        if (!gRes || gRes.id !== I.WHITE_STAINED_GLASS + i || gRes.count !== 8) glassOk = false;
        const tRes = matchRecipe([B.TERRACOTTA, B.TERRACOTTA, B.TERRACOTTA, B.TERRACOTTA, dye, B.TERRACOTTA, B.TERRACOTTA, B.TERRACOTTA, B.TERRACOTTA], 3);
        if (!tRes || tRes.id !== B.TERRACOTTA_WHITE + i || tRes.count !== 8) terracottaOk = false;
      }
      return { glassOk, terracottaOk };
    });
    check('verre teinté et terre cuite : recettes 1.12 valides pour les 16 couleurs',
      recipesOk.glassOk && recipesOk.terracottaOk,
      JSON.stringify(recipesOk));

    // /give sur plusieurs couleurs (verre et terre cuite) et pose au clic droit
    await ev(page, () => { window.__game.player.inventory.clear(); });
    await chat(page, '/give red_stained_glass 4');
    await chat(page, '/give blue_stained_glass 4');
    await chat(page, '/give yellow_stained_glass 4');
    await chat(page, '/give lime_stained_glass 4');
    await chat(page, '/give magenta_terracotta 2');
    await chat(page, '/give cyan_terracotta 2');
    await ticks(page, 2);

    const invCheck = await ev(page, () => {
      const s = window.__game.player.inventory.slots;
      return s[0]?.id === I.RED_STAINED_GLASS && s[1]?.id === I.BLUE_STAINED_GLASS
        && s[4]?.id === B.TERRACOTTA_MAGENTA && s[5]?.id === B.TERRACOTTA_CYAN;
    });
    check('/give : donne les verres teintés et terres cuites par leur nom', invCheck);

    // Construit un mur de terre cuite et un vitrail à trois hauteurs au clic droit
    await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      for (let x = 10; x <= 15; x++) w.setBlock(x, 3, 10, B.STONE_BRICKS, 0, false);
      p.teleport(12.5, 4, 13.5);
      p.inventory.selected = 0; // rouge
      T.aim(11.5, 3.85, 10.5);
    });
    await ticks(page, 2);
    await rclick(page); // pose rouge en (11,4,10)

    await ev(page, () => {
      window.__game.player.inventory.selected = 1; // bleu
      T.aim(12.5, 3.85, 10.5);
    });
    await rclick(page); // pose bleu en (12,4,10)

    await ev(page, () => {
      window.__game.player.inventory.selected = 2; // jaune
      T.aim(13.5, 3.85, 10.5);
    });
    await rclick(page); // pose jaune en (13,4,10)

    await ev(page, () => {
      window.__game.player.inventory.selected = 4; // terre cuite magenta
      T.aim(14.5, 3.85, 10.5);
    });
    await rclick(page); // pose terre cuite en (14,4,10)
    await ticks(page, 4);

    // Complète un vitrail coloré en hauteur pour vérifier la lumière traversante et faire une capture nette
    const lightAndBreak = await ev(page, async () => {
      const { BLOCK_LIGHT_OPACITY, BLOCK_SOLID } = await import('/src/world/Blocks.ts');
      const g = window.__game, w = g.world;
      const redOk = w.getBlock(11, 4, 10) === B.STAINED_GLASS && w.getMeta(11, 4, 10) === 14;
      const blueOk = w.getBlock(12, 4, 10) === B.STAINED_GLASS && w.getMeta(12, 4, 10) === 11;
      const yellowOk = w.getBlock(13, 4, 10) === B.STAINED_GLASS && w.getMeta(13, 4, 10) === 4;
      const terraOk = w.getBlock(14, 4, 10) === B.TERRACOTTA_MAGENTA;
      // Toit de verre teinté au-dessus d'une cellule sombre pour vérifier la lumière du ciel
      w.setBlock(12, 6, 10, B.STAINED_GLASS, 3, true);
      w.updateChunks?.();
      const skyUnderGlass = w.getSkyLight(12, 5, 10);
      // Décore le vitrail multi-couleurs pour la capture
      const palette = [14, 1, 4, 5, 3, 11, 10, 2];
      for (let dx = 0; dx < 4; dx++) {
        for (let dy = 0; dy < 3; dy++) {
          w.setBlock(10 + dx, 4 + dy, 8, B.STAINED_GLASS, palette[(dx + dy) % palette.length], false);
        }
        w.setBlock(10 + dx, 7, 8, B.STONE_BRICKS, 0, false);
        w.setBlock(10 + dx, 4, 7, B.TERRACOTTA_WHITE + dx * 2, 0, false);
      }
      w.setBlock(9, 4, 8, B.STONE_BRICKS, 0, false);
      w.setBlock(9, 5, 8, B.STONE_BRICKS, 0, false);
      w.setBlock(9, 6, 8, B.STONE_BRICKS, 0, false);
      w.setBlock(14, 4, 8, B.STONE_BRICKS, 0, false);
      w.setBlock(14, 5, 8, B.STONE_BRICKS, 0, false);
      w.setBlock(14, 6, 8, B.STONE_BRICKS, 0, false);
      return {
        redOk, blueOk, yellowOk, terraOk,
        singleId: true,
        opacity0: BLOCK_LIGHT_OPACITY[B.STAINED_GLASS] === 0,
        solid1: BLOCK_SOLID[B.STAINED_GLASS] === 1,
        skyUnderGlass,
      };
    });

    // Vérifie la récolte : rien à la main, verre exact avec Toucher de soie ; terre cuite rend son bloc
    const dropsOk = await ev(page, async () => {
      const { blockDrops } = await import('/src/world/Drops.ts');
      const rng = () => 0.5;
      const noSilk = blockDrops(B.STAINED_GLASS, 11, 0, rng, 0, false);
      const withSilk = blockDrops(B.STAINED_GLASS, 11, I.DIAMOND_PICKAXE, rng, 0, true);
      const terraDrop = blockDrops(B.TERRACOTTA_MAGENTA, 0, I.WOODEN_PICKAXE, rng, 0, false);
      return noSilk.length === 0
        && withSilk.length === 1 && withSilk[0].id === I.BLUE_STAINED_GLASS
        && terraDrop.length === 1 && terraDrop[0].id === B.TERRACOTTA_MAGENTA;
    });

    check('verre teinté : 1 id de bloc + méta 0..15, laisse passer la lumière, solide, Toucher de soie exact',
      lightAndBreak.redOk && lightAndBreak.blueOk && lightAndBreak.yellowOk && lightAndBreak.terraOk
      && lightAndBreak.opacity0 && lightAndBreak.solid1 && lightAndBreak.skyUnderGlass === 15 && dropsOk,
      JSON.stringify({ lightAndBreak, dropsOk }));

    await ev(page, () => {
      window.__game.player.teleport(12.0, 4.5, 13.0);
      T.aim(11.5, 5.2, 8.5);
    });
    await ticks(page, 6);
    await page.screenshot({ path: '/tmp/shot-deco-vitrail.png' });
  });

  // ========================================================================= 40. Tapis de laine (16 couleurs)
  await section('tapis de laine', async () => {
    const recipesOk = await ev(page, async () => {
      const { COLOR_NAMES, B, I } = await import('/src/world/Ids.ts');
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      for (let i = 0; i < COLOR_NAMES.length; i++) {
        const wId = B.WOOL_WHITE + i;
        const r = matchRecipe([wId, wId, 0, 0], 2);
        if (!r || r.id !== I.WHITE_CARPET + i || r.count !== 3) return { ok: false, i, r };
      }
      return { ok: true };
    });
    check('tapis : recettes 1.12 (2 laines → 3 tapis) valides pour les 16 couleurs', recipesOk.ok, JSON.stringify(recipesOk));

    // Pose au clic droit et traversée sans blocage pour le joueur ET une créature
    await ev(page, () => { window.__game.player.inventory.clear(); });
    await chat(page, '/give red_carpet 4');
    await chat(page, '/give blue_carpet 4');
    await chat(page, '/give yellow_carpet 4');
    await ticks(page, 2);

    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(20.5, 4, 14.5);
      p.inventory.selected = 0; // rouge
      T.aim(20.5, 4.0, 12.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ev(page, () => {
      window.__game.player.inventory.selected = 1; // bleu
      T.aim(21.5, 4.0, 12.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ev(page, () => {
      window.__game.player.inventory.selected = 2; // jaune
      T.aim(22.5, 4.0, 12.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);

    const carpetCheck = await ev(page, async () => {
      const { Pig } = await import('/src/entity/Mobs.ts');
      const g = window.__game, w = g.world, p = g.player;
      const blocksOk = w.getBlock(20, 4, 12) === B.CARPET && w.getMeta(20, 4, 12) === 14
        && w.getBlock(21, 4, 12) === B.CARPET && w.getMeta(21, 4, 12) === 11
        && w.getBlock(22, 4, 12) === B.CARPET && w.getMeta(22, 4, 12) === 4;
      const boxEmpty = [];
      w.collisionBoxesAt(20, 4, 12, boxEmpty);
      const selBox = [];
      w.selectionBoxesAt(20, 4, 12, selBox);

      // Une créature (cochon attiré par une carotte) traverse également les tapis sans blocage
      const pig = new Pig();
      pig.setPosition(19.5, 4, 12.5);
      pig.yaw = -Math.PI / 2;
      g.spawn(pig);
      p.teleport(24.0, 4, 12.5);
      p.inventory.slots[8] = makeStack(I.CARROT, 1);
      p.inventory.selected = 8;
      for (let i = 0; i < 60; i++) g.tick();
      const mobCrossed = pig.x > 21.5 && Math.abs(pig.y - 4) < 0.05;
      pig.dead = true;

      return {
        blocksOk,
        at20: [w.getBlock(20, 4, 12), w.getMeta(20, 4, 12)],
        noCollision: boxEmpty.length === 0,
        thinSel: selBox.length === 6 && selBox[4] === 1,
        mobCrossed,
        pigx: +pig.x.toFixed(2),
      };
    });

    // Le joueur marche avec Z par-dessus les trois tapis sans être bloqué
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(19.5, 4, 12.5);
      T.aim(24.5, 5.62, 12.5);
    });
    await page.keyboard.down('KeyW');
    await ticks(page, 22);
    await page.keyboard.up('KeyW');
    const playerCross = await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      const crossed = { x: +p.x.toFixed(2), y: +p.y.toFixed(2), ok: p.x > 22.0 && Math.abs(p.y - 4) < 0.05 };
      // Retirer le bloc sous un tapis le fait tomber en objet exact
      for (const e of g.entities) if (e.kind === 'item') e.dead = true;
      w.setBlock(23, 4, 12, B.CARPET, 10, true); // violet
      w.setBlock(23, 3, 12, B.AIR, 0, true);
      for (let i = 0; i < 4; i++) g.tick();
      const popped = g.entities.some((e) => e.kind === 'item' && !e.dead && e.itemId === I.PURPLE_CARPET);
      return { ...crossed, popped };
    });

    check('tapis : posés au clic, épaisseur 1/16, ne bloquent ni joueur ni créature, tombent si support cassé',
      carpetCheck.blocksOk && carpetCheck.noCollision && carpetCheck.thinSel
      && playerCross.ok && carpetCheck.mobCrossed && playerCross.popped,
      JSON.stringify({ carpetCheck, playerCross }));
  });

  // ========================================================================= 41. Portes, clôtures et portillons dans les 6 bois
  await section('autres bois (portes, barrières, portillons)', async () => {
    const woodRecipes = await ev(page, async () => {
      const { B, I } = await import('/src/world/Ids.ts');
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const cases = [
        [B.OAK_PLANKS, B.OAK_DOOR, B.OAK_FENCE, B.FENCE_GATE],
        [B.SPRUCE_PLANKS, I.SPRUCE_DOOR, I.SPRUCE_FENCE, I.SPRUCE_FENCE_GATE],
        [B.BIRCH_PLANKS, I.BIRCH_DOOR, I.BIRCH_FENCE, I.BIRCH_FENCE_GATE],
        [B.JUNGLE_PLANKS, I.JUNGLE_DOOR, I.JUNGLE_FENCE, I.JUNGLE_FENCE_GATE],
        [B.ACACIA_PLANKS, I.ACACIA_DOOR, I.ACACIA_FENCE, I.ACACIA_FENCE_GATE],
        [B.DARK_OAK_PLANKS, I.DARK_OAK_DOOR, I.DARK_OAK_FENCE, I.DARK_OAK_FENCE_GATE],
      ];
      for (const [p, door, fence, gate] of cases) {
        const rd = matchRecipe([p, p, 0, p, p, 0, p, p, 0], 3);
        const rf = matchRecipe([p, I.STICK, p, p, I.STICK, p, 0, 0, 0], 3);
        const rg = matchRecipe([I.STICK, p, I.STICK, I.STICK, p, I.STICK, 0, 0, 0], 3);
        if (!rd || rd.id !== door || rd.count !== 3) return { ok: false, step: 'door', p, rd };
        if (!rf || rf.id !== fence || rf.count !== 3) return { ok: false, step: 'fence', p, rf };
        if (!rg || rg.id !== gate || rg.count !== 1) return { ok: false, step: 'gate', p, rg };
      }
      const darkPlank = matchRecipe([B.DARK_OAK_LOG], 2);
      return { ok: darkPlank?.id === B.DARK_OAK_PLANKS && darkPlank.count === 4 };
    });
    check('bois : recettes 1.12 de portes, barrières et portillons pour les 6 essences', woodRecipes.ok, JSON.stringify(woodRecipes));

    // Pose réelle au clic droit : porte en bouleau, barrière en sapin, portillon en chêne noir + ouverture
    await ev(page, () => { window.__game.player.inventory.clear(); });
    await chat(page, '/give birch_door 1');
    await chat(page, '/give spruce_fence 1');
    await chat(page, '/give dark_oak_fence_gate 1');
    await ticks(page, 2);

    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(30.5, 4, 14.5);
      p.inventory.selected = 0; // porte en bouleau (variante 2)
      T.aim(30.5, 3.85, 11.5);
    });
    await rclick(page);

    await ev(page, () => {
      window.__game.player.inventory.selected = 1; // barrière en sapin (variante 1)
      T.aim(32.5, 3.85, 11.5);
    });
    await rclick(page);

    await ev(page, () => {
      window.__game.player.inventory.selected = 2; // portillon en chêne noir (variante 5)
      T.aim(33.5, 3.85, 11.5);
    });
    await rclick(page);
    await ticks(page, 2);

    // Clic droit pour ouvrir porte et portillon et vérifier que la variante est préservée
    await ev(page, () => { T.aim(30.5, 4.5, 11.5); });
    await rclick(page);
    await ev(page, () => { T.aim(33.5, 4.5, 11.5); });
    await rclick(page);
    await ticks(page, 2);

    const woodPlaced = await ev(page, async () => {
      const { blockDrops } = await import('/src/world/Drops.ts');
      const w = window.__game.world;
      const dLow = w.getBlockAndMeta(30, 4, 11);
      const dTop = w.getBlockAndMeta(30, 5, 11);
      const f = w.getBlockAndMeta(32, 4, 11);
      const g = w.getBlockAndMeta(33, 4, 11);
      const doorDrop = blockDrops(B.OAK_DOOR, (dLow >> 8) & ~8, 0, () => 0.5);
      const fenceDrop = blockDrops(B.OAK_FENCE, f >> 8, 0, () => 0.5);
      const gateDrop = blockDrops(B.FENCE_GATE, g >> 8, 0, () => 0.5);
      return {
        doorOk: (dLow & 255) === B.OAK_DOOR && (dTop & 255) === B.OAK_DOOR
          && (((dLow >> 8) >> 5) & 7) === 2 && (((dTop >> 8) >> 5) & 7) === 2
          && (((dLow >> 8) & 4) !== 0),
        fenceOk: (f & 255) === B.OAK_FENCE && ((f >> 8) & 7) === 1,
        gateOk: (g & 255) === B.FENCE_GATE && (((g >> 8) >> 3) & 7) === 5 && (((g >> 8) & 4) !== 0),
        dropsOk: doorDrop[0]?.id === I.BIRCH_DOOR && fenceDrop[0]?.id === I.SPRUCE_FENCE && gateDrop[0]?.id === I.DARK_OAK_FENCE_GATE,
      };
    });
    check('bois : pose au clic, ouverture/fermeture conservant la variante et restitution exacte',
      woodPlaced.doorOk && woodPlaced.fenceOk && woodPlaced.gateOk && woodPlaced.dropsOk,
      JSON.stringify(woodPlaced));

    // Alignement visuel des 6 bois (clôtures, portillons, portes) pour la capture
    await ev(page, () => {
      const w = window.__game.world;
      for (let v = 0; v < 6; v++) {
        const bx = 28 + v * 2;
        w.setBlock(bx, 4, 6, B.OAK_FENCE, v, false);
        w.setBlock(bx + 1, 4, 6, B.FENCE_GATE, 0 | (v << 3), false);
        w.setBlock(bx, 4, 4, B.OAK_DOOR, 0 | (v << 5), false);
        w.setBlock(bx, 5, 4, B.OAK_DOOR, 0 | 8 | (v << 5), false);
      }
      window.__game.player.teleport(33.5, 5.4, 11.2);
      T.aim(33.5, 4.4, 5.0);
    });
    await ticks(page, 6);
    await page.screenshot({ path: '/tmp/shot-deco-bois.png' });
  });

  // ========================================================================= 42. Tableaux et cadres à accrocher
  await section('tableaux et cadres', async () => {
    const recipesOk = await ev(page, async () => {
      const { B, I } = await import('/src/world/Ids.ts');
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const rp = matchRecipe([I.STICK, I.STICK, I.STICK, I.STICK, B.WOOL_RED, I.STICK, I.STICK, I.STICK, I.STICK], 3);
      const rf = matchRecipe([I.STICK, I.STICK, I.STICK, I.STICK, I.LEATHER, I.STICK, I.STICK, I.STICK, I.STICK], 3);
      return { p: rp?.id === I.PAINTING, f: rf?.id === I.ITEM_FRAME };
    });
    check('tableaux et cadres : recettes 1.12 (8 bâtons + laine / 8 bâtons + cuir)', recipesOk.p && recipesOk.f, JSON.stringify(recipesOk));

    // Construit un mur de briques au sud face +z pour tester la pose et le retrait au clic
    await ev(page, () => {
      const w = window.__game.world, p = window.__game.player;
      for (let x = 40; x <= 48; x++) {
        for (let y = 4; y <= 7; y++) w.setBlock(x, y, 10, B.BRICKS, 0, false);
      }
      p.inventory.clear();
    });
    await chat(page, '/give painting 4');
    await chat(page, '/give item_frame 3');
    await chat(page, '/give diamond_sword 2');
    await chat(page, '/give golden_apple 1');
    await ticks(page, 2);

    // Pose deux tableaux au clic droit, puis enlève le deuxième au clic gauche
    await ev(page, () => {
      const p = window.__game.player;
      p.teleport(41.5, 4, 13.0);
      p.inventory.selected = 0; // tableau
      T.aim(41.5, 5.5, 10.95);
    });
    await ticks(page, 2);
    await rclick(page); // tableau 1 en (41, 5, 11)
    await ticks(page, 2);

    await ev(page, () => {
      window.__game.player.teleport(46.5, 4, 13.0);
      T.aim(46.5, 5.5, 10.95);
    });
    await rclick(page); // tableau 2 en (46, 5, 11)
    await ticks(page, 2);

    const twoPaintings = await ev(page, () => window.__game.entities.filter((e) => e.kind === 'painting' && !e.dead).length);

    // Enlève le tableau 2 en mode survie au clic gauche et vérifie le drop
    await ev(page, () => {
      M.mode('survival');
      window.__game.player.teleport(46.5, 4, 12.5);
      window.__game.player.inventory.selected = 3; // main libre (or keep empty slot)
      for (const e of window.__game.entities) if (e.kind === 'item') e.dead = true;
      T.aim(46.5, 5.5, 11.03);
    });
    await ticks(page, 2);
    await lclick(page);
    await ticks(page, 3);

    const paintingAfterClick = await ev(page, () => {
      const g = window.__game;
      return {
        count: g.entities.filter((e) => e.kind === 'painting' && !e.dead).length,
        dropped: g.entities.some((e) => e.kind === 'item' && !e.dead && e.itemId === I.PAINTING),
      };
    });
    check('tableau : se pose sur un mur au clic droit et se retire au clic gauche en rendant l\'objet',
      twoPaintings === 2 && paintingAfterClick.count === 1 && paintingAfterClick.dropped,
      JSON.stringify({ twoPaintings, paintingAfterClick }));

    // Cadre : pose au clic droit en (44, 5, 11), mise d'une épée en diamant + rotation + retrait en 2 clics
    await ev(page, () => {
      M.mode('creative');
      const p = window.__game.player;
      p.teleport(44.5, 4, 13.0);
      p.inventory.selected = 1; // cadre
      T.aim(44.5, 5.5, 10.95);
    });
    await ticks(page, 2);
    await rclick(page); // cadre 1 en (44, 5, 11)
    await ev(page, () => {
      window.__game.player.teleport(47.5, 4, 12.5);
      T.aim(47.5, 5.5, 10.95);
    });
    await rclick(page); // cadre 2 en (47, 5, 11)
    await ticks(page, 2);

    // En survie : pose l'épée dans le cadre 1 puis la tourne deux fois
    await ev(page, () => {
      M.mode('survival');
      const p = window.__game.player;
      p.teleport(44.5, 4, 12.5);
      p.inventory.selected = 2; // 2 diamond swords
      T.aim(44.5, 5.5, 11.03);
    });
    await ticks(page, 2);
    await rclick(page); // insère l'épée
    await ticks(page, 2);
    await rclick(page); // tourne 45°
    await ticks(page, 2);
    await rclick(page); // tourne 90°
    await ticks(page, 2);

    // Sur le cadre 2 : pose une pomme dorée, puis enlève l'objet puis le cadre au clic gauche
    await ev(page, () => {
      window.__game.player.teleport(47.5, 4, 12.5);
      T.select('golden_apple');
      T.aim(47.5, 5.5, 11.03);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);

    const frameBeforeBreak = await ev(page, () => {
      const frames = window.__game.entities.filter((e) => e.kind === 'item_frame' && !e.dead);
      const f1 = frames.find((e) => Math.abs(e.x - 44.5) < 0.3);
      const f2 = frames.find((e) => Math.abs(e.x - 47.5) < 0.3);
      return {
        total: frames.length,
        f1IsSword: f1?.itemId === I.DIAMOND_SWORD,
        f1Rot: f1?.variant,
        f2IsApple: f2?.itemId === I.GOLDEN_APPLE,
        swordLeftInHand: T.count('diamond_sword'),
      };
    });

    await ev(page, () => {
      for (const e of window.__game.entities) if (e.kind === 'item') e.dead = true;
      T.aim(47.5, 5.5, 11.03);
    });
    await lclick(page); // retire la pomme dorée du cadre 2
    await ticks(page, 2);
    const frameItemPopped = await ev(page, () => {
      const f2 = window.__game.entities.find((e) => e.kind === 'item_frame' && !e.dead && Math.abs(e.x - 47.5) < 0.3);
      const appleDropped = window.__game.entities.some((e) => e.kind === 'item' && !e.dead && e.itemId === I.GOLDEN_APPLE);
      return { stillThereEmpty: !!f2 && f2.itemId === 0, appleDropped };
    });
    await lclick(page); // retire le cadre 2 vide
    await ticks(page, 2);
    const framePopped = await ev(page, () => ({
      remaining: window.__game.entities.filter((e) => e.kind === 'item_frame' && !e.dead).length,
      frameDropped: window.__game.entities.some((e) => e.kind === 'item' && !e.dead && e.itemId === I.ITEM_FRAME),
    }));

    check('cadre : pose d\'un objet (consommé), rotation au clic droit, retrait en 2 clics (objet puis cadre)',
      frameBeforeBreak.total === 2 && frameBeforeBreak.f1IsSword && frameBeforeBreak.f1Rot === 2
      && frameBeforeBreak.swordLeftInHand === 1 && frameBeforeBreak.f2IsApple
      && frameItemPopped.stillThereEmpty && frameItemPopped.appleDropped
      && framePopped.remaining === 1 && framePopped.frameDropped,
      JSON.stringify({ frameBeforeBreak, frameItemPopped, framePopped }));

    // Capture rapprochée tableaux + cadres et scène tapis + cadres
    await ev(page, () => {
      M.mode('creative');
      const w = window.__game.world;
      w.setBlock(43, 4, 11, B.CARPET, 14, false);
      w.setBlock(44, 4, 11, B.CARPET, 4, false);
      w.setBlock(45, 4, 11, B.CARPET, 11, false);
      window.__game.player.teleport(43.5, 4.4, 13.8);
      T.aim(43.5, 5.4, 11.0);
    });
    await ticks(page, 6);
    await page.screenshot({ path: '/tmp/shot-deco-tableaux.png' });

    await ev(page, () => {
      window.__game.player.teleport(21.5, 4.6, 15.0);
      T.aim(21.5, 4.0, 12.5);
    });
    await ticks(page, 6);
    await page.screenshot({ path: '/tmp/shot-deco-tapis-cadre.png' });
  });

  // ========================================================================= 43. Jukebox et disques de musique (donjons)
  await section('jukebox et disques', async () => {
    const checkPrep = await ev(page, async () => {
      const { B, I } = await import('/src/world/Ids.ts');
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const { generateLoot } = await import('/src/world/Loot.ts');
      const rJuke = matchRecipe([
        B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS,
        B.OAK_PLANKS, I.DIAMOND, B.OAK_PLANKS,
        B.OAK_PLANKS, B.OAK_PLANKS, B.OAK_PLANKS,
      ], 3);
      let d13 = 0, dCat = 0;
      for (let i = 0; i < 200; i++) {
        for (const s of generateLoot('dungeon', 1337, i * 11, 20, i * 5, 27)) {
          if (s && s.id === I.MUSIC_DISC_13) d13++;
          if (s && s.id === I.MUSIC_DISC_CAT) dCat++;
        }
      }
      return { rJuke: rJuke?.id === B.JUKEBOX && rJuke.count === 1, d13, dCat };
    });
    check('jukebox : recette 1.12 (8 planches + 1 diamant) et disques 13/cat trouvés dans les donjons',
      checkPrep.rJuke && checkPrep.d13 > 5 && checkPrep.dCat > 5,
      JSON.stringify(checkPrep));

    await ev(page, () => { window.__game.player.inventory.clear(); });
    await chat(page, '/give jukebox 1');
    await chat(page, '/give music_disc_cat 1');
    await chat(page, '/give music_disc_13 1');
    await ticks(page, 2);

    // Pose le jukebox en (54, 4, 12) et un comparateur juste derrière en (54, 4, 13)
    await ev(page, () => {
      M.mode('survival');
      const p = window.__game.player;
      p.teleport(54.5, 4, 15.0);
      p.inventory.selected = 0; // jukebox
      T.aim(54.5, 3.85, 12.5);
    });
    await rclick(page);
    await ticks(page, 2);

    await ev(page, () => {
      window.__game.world.setBlock(54, 4, 13, B.COMPARATOR, 0, true); // lit Z-1 (54,4,12)
      window.__game.player.inventory.selected = 1; // music_disc_cat
      T.aim(54.5, 4.5, 12.5);
    });
    await rclick(page); // insère le disque cat
    await ticks(page, 4);

    const playingCat = await ev(page, async () => {
      const { getJukebox } = await import('/src/game/BlockEntities.ts');
      const g = window.__game;
      const jb = getJukebox(g.world, 54, 4, 12);
      return {
        blockOk: g.world.getBlock(54, 4, 12) === B.JUKEBOX && g.world.getMeta(54, 4, 12) === 1,
        beDisc: jb.disc === I.MUSIC_DISC_CAT,
        playingKey: g.playingJukebox?.key ?? null,
        sfxDisc: g.sfx.playingDisc,
        compOut: (g.world.getMeta(54, 4, 13) >> 4) & 15,
        consumedFromHand: !g.player.inventory.slots[1],
      };
    });

    await ev(page, () => {
      window.__game.player.teleport(56.2, 5.2, 14.8);
      T.aim(54.5, 4.3, 12.5);
    });
    await ticks(page, 6);
    await page.screenshot({ path: '/tmp/shot-deco-jukebox.png' });

    // Clic droit sans disque pour éjecter le disque cat
    await ev(page, () => {
      window.__game.player.inventory.selected = 5;
      for (const e of window.__game.entities) if (e.kind === 'item') e.dead = true;
      window.__game.player.teleport(54.5, 4, 15.0);
      T.aim(54.5, 4.5, 12.5);
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 4);

    const afterEject = await ev(page, async () => {
      const { getJukebox } = await import('/src/game/BlockEntities.ts');
      const g = window.__game;
      const jb = getJukebox(g.world, 54, 4, 12);
      return {
        meta0: g.world.getMeta(54, 4, 12) === 0,
        beDisc0: jb.disc === 0,
        stopped: g.playingJukebox === null && g.sfx.playingDisc === null,
        ejectedItem: g.entities.some((e) => e.kind === 'item' && !e.dead && e.itemId === I.MUSIC_DISC_CAT),
        compOut0: (g.world.getMeta(54, 4, 13) >> 4) & 15,
      };
    });

    // Ré-insère le disque 13 pour tester la persistance sur sauvegarde + export/import
    await ev(page, () => {
      window.__game.player.inventory.selected = 2; // music_disc_13
      T.aim(54.5, 4.5, 12.5);
    });
    await rclick(page);
    await ticks(page, 3);

    check('jukebox : lecture du disque inséré, arrêt et éjection au clic, signal comparateur',
      playingCat.blockOk && playingCat.beDisc && playingCat.playingKey === 'cat' && playingCat.sfxDisc === 'cat'
      && playingCat.compOut === 2 && playingCat.consumedFromHand
      && afterEject.meta0 && afterEject.beDisc0 && afterEject.stopped && afterEject.ejectedItem && afterEject.compOut0 === 0,
      JSON.stringify({ playingCat, afterEject }));
  });

  // ========================================================================= Sauvegarde, rechargement & export/import .aetherworld
  await section('sauvegarde et export/import .aetherworld', async () => {
    const checkSaved = async () => ev(page, async () => {
      const { getJukebox } = await import('/src/game/BlockEntities.ts');
      const g = window.__game, w = g.world;
      const paint = g.entities.find((e) => e.kind === 'painting' && !e.dead && Math.abs(e.x - 41.5) < 0.6);
      const frame = g.entities.find((e) => e.kind === 'item_frame' && !e.dead && Math.abs(e.x - 44.5) < 0.3);
      const jb = getJukebox(w, 54, 4, 12);
      return {
        glassRed: w.getBlock(11, 4, 10) === B.STAINED_GLASS && w.getMeta(11, 4, 10) === 14,
        terraMag: w.getBlock(14, 4, 10) === B.TERRACOTTA_MAGENTA,
        carpetBlue: w.getBlock(21, 4, 12) === B.CARPET && w.getMeta(21, 4, 12) === 11,
        birchDoor: w.getBlock(30, 4, 11) === B.OAK_DOOR && (((w.getMeta(30, 4, 11) >> 5) & 7) === 2),
        spruceFence: w.getBlock(32, 4, 11) === B.OAK_FENCE && (w.getMeta(32, 4, 11) & 7) === 1,
        darkOakGate: w.getBlock(33, 4, 11) === B.FENCE_GATE && (((w.getMeta(33, 4, 11) >> 3) & 7) === 5),
        painting: !!paint,
        frame: !!frame && frame.itemId === I.DIAMOND_SWORD && frame.variant === 2,
        jukeboxDisc13: w.getBlock(54, 4, 12) === B.JUKEBOX && w.getMeta(54, 4, 12) === 1 && jb.disc === I.MUSIC_DISC_13,
      };
    });

    await ticks(page, 4);
    await reload(page);
    const afterReload = await checkSaved();
    check('sauvegarde/rechargement : blocs, variantes, tableaux, cadres et disque du jukebox survivent',
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
    check('export/import .aetherworld : conserve verres, tapis, bois, tableaux, cadres et jukebox',
      !!importedId && Object.values(afterImport).every(Boolean),
      JSON.stringify({ importedId, afterImport }));
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));

  await browser.close();
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
})();
