// Batterie « Progression guidée et objectifs impossibles » :
// vérifie l'absence de bandeau « Objectif : … » en monde plat, son affichage en monde normal,
// le filtrage par genVersion et dimension, le chêne noir dans LOG_IDS/PLANK_IDS, et la persistance.
const { sleep, launch, openPage, click, createWorld, shot, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, section } = require('./h.cjs');

async function readGuide(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-mc="guide"]');
    return {
      text: el ? el.textContent : '',
      visible: el ? getComputedStyle(el).display !== 'none' : false,
      goal: window.__game?.guideGoal ?? '',
    };
  });
}

(async () => {
  const browser = await launch();
  const errors = [];
  const page = await openPage(browser, errors);

  // ========================================================================= 1. Monde plat en survie
  await section('monde plat en survie : aucun objectif impossible', async () => {
    await createWorld(page, { name: 'PlatObjectifs', seed: '42', flat: true });
    await install(page);
    await ticks(page, 15);

    const flatGuide = await readGuide(page);
    check('monde plat survie : aucun bandeau « Objectif : … » affiché',
      !flatGuide.visible && flatGuide.text === '' && flatGuide.goal === '',
      JSON.stringify(flatGuide));
    await shot(page, 't14_plat_survie');

    // Chêne noir (DARK_OAK_LOG / DARK_OAK_PLANKS) débloque quand même wood et planks, sans afficher de bandeau
    await chat(page, '/give dark_oak_log 1');
    await ticks(page, 12);
    const afterLog = await ev(page, () => ({
      wood: window.__game.player.advancements.has('wood'),
      planks: window.__game.player.advancements.has('planks'),
    }));
    await chat(page, '/give dark_oak_planks 4');
    await ticks(page, 12);
    const afterPlanks = await ev(page, () => ({
      wood: window.__game.player.advancements.has('wood'),
      planks: window.__game.player.advancements.has('planks'),
    }));
    const flatGuideAfter = await readGuide(page);
    check('chêne noir : bûche et planches de chêne noir valident wood et planks (bandeau toujours masqué en plat)',
      afterLog.wood && !afterLog.planks && afterPlanks.planks && !flatGuideAfter.visible && flatGuideAfter.text === '',
      JSON.stringify({ afterLog, afterPlanks, flatGuideAfter }));
  });

  // ========================================================================= 2. Monde normal en survie
  await section('monde normal en survie : bandeau bois, remappage, genVersion et dimensions', async () => {
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await sleep(150);
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await page.reload();
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });

    await createWorld(page, { name: 'NormalObjectifs', seed: '1337', flat: false });
    await install(page);
    await ticks(page, 15);

    const normalGuide = await readGuide(page);
    check('monde normal survie : le bandeau « Objectif : … bois » apparaît toujours',
      normalGuide.visible && normalGuide.text.includes('Objectif :') && normalGuide.text.includes('bois'),
      JSON.stringify(normalGuide));
    await shot(page, 't14_normal_survie');

    // Remappage de la touche d'inventaire dans guideGoal + passage à l'étape suivante (fourneau)
    const remapAndStep = await ev(page, () => {
      const g = window.__game;
      const saved = new Set(g.player.advancements);
      const kb = g.settings.keybinds.inventory;
      g.player.advancements.clear();
      g.player.advancements.add('wood');
      const base = g.guideGoal;
      g.settings.keybinds.inventory = 'KeyI';
      const remapped = g.guideGoal;
      g.settings.keybinds.inventory = kb;
      for (const id of ['planks', 'crafting_table', 'wooden_pickaxe', 'cobblestone']) g.player.advancements.add(id);
      const afterCobble = g.guideGoal;
      g.player.advancements.clear();
      for (const id of saved) g.player.advancements.add(id);
      return { base, remapped, afterCobble };
    });
    check('monde normal : guideGoal reflète la touche d’inventaire et passe au fourneau après cobblestone',
      remapAndStep.base.includes('appuyez sur E ') && remapAndStep.remapped.includes('appuyez sur I ') && remapAndStep.afterCobble.includes('fourneau'),
      JSON.stringify(remapAndStep));

    // Filtrage selon genVersion (v1 / v2 / v3) et dimension (overworld / nether / end)
    const matrix = await ev(page, async () => {
      const { ADVANCEMENTS, isAdvancementAvailable } = await import('/src/game/Advancements.ts');
      const next = (done, ctx) => {
        const set = new Set(done);
        const a = ADVANCEMENTS.find((x) => !set.has(x.id) && isAdvancementAvailable(x, ctx));
        return a ? a.id : '';
      };
      const upToDiamond = ADVANCEMENTS.slice(0, 14).map((a) => a.id); // wood..diamond
      const upToBlaze = [...upToDiamond, 'blaze_rod'];
      const upToEye = [...upToBlaze, 'ender_eye'];
      const upToEnd = [...upToEye, 'the_end'];
      return {
        flatAny: next([], { worldType: 'flat', genVersion: 3, dimension: 'overworld', endVisited: false }),
        v1AfterDiamond: next(upToDiamond, { worldType: 'default', genVersion: 1, dimension: 'overworld', endVisited: false }),
        v1Nether: next([], { worldType: 'default', genVersion: 1, dimension: 'nether', endVisited: false }),
        v2AfterDiamond: next(upToDiamond, { worldType: 'default', genVersion: 2, dimension: 'overworld', endVisited: false }),
        v2AfterBlaze: next(upToBlaze, { worldType: 'default', genVersion: 2, dimension: 'overworld', endVisited: false }),
        v2InEnd: next(upToBlaze, { worldType: 'default', genVersion: 2, dimension: 'end', endVisited: true }),
        v3AfterBlazeOverworld: next(upToBlaze, { worldType: 'default', genVersion: 3, dimension: 'overworld', endVisited: false }),
        v3AfterEyeOverworld: next(upToEye, { worldType: 'default', genVersion: 3, dimension: 'overworld', endVisited: false }),
        v3AfterEyeNether: next(upToEye, { worldType: 'default', genVersion: 3, dimension: 'nether', endVisited: false }),
        v3EarlyNether: next([], { worldType: 'default', genVersion: 3, dimension: 'nether', endVisited: false }),
        v3InEnd: next(upToEnd, { worldType: 'default', genVersion: 3, dimension: 'end', endVisited: true }),
        v3AfterEndOverworld: next(upToEnd, { worldType: 'default', genVersion: 3, dimension: 'overworld', endVisited: true }),
      };
    });
    check('filtrage monde/version/dimension : aucun objectif hors-portée en plat, v1, v2, Nether ou End',
      matrix.flatAny === ''
      && matrix.v1AfterDiamond === ''
      && matrix.v1Nether === ''
      && matrix.v2AfterDiamond === 'blaze_rod'
      && matrix.v2AfterBlaze === ''
      && matrix.v2InEnd === 'dragon'
      && matrix.v3AfterBlazeOverworld === 'ender_eye'
      && matrix.v3AfterEyeOverworld === 'the_end'
      && matrix.v3AfterEyeNether === ''
      && matrix.v3EarlyNether === 'blaze_rod'
      && matrix.v3InEnd === 'dragon'
      && matrix.v3AfterEndOverworld === 'dragon',
      JSON.stringify(matrix));

    // Modes non-survie : aucun bandeau affiché
    const modeGoals = {};
    for (const mode of ['creative', 'adventure', 'spectator']) {
      await chat(page, `/gamemode ${mode}`);
      await ticks(page, 4);
      modeGoals[mode] = await readGuide(page);
    }
    await chat(page, '/gamemode survival');
    await ticks(page, 4);
    check('modes non-survie : aucun bandeau affiché en créatif, aventure ou spectateur',
      ['creative', 'adventure', 'spectator'].every((m) => !modeGoals[m].visible && modeGoals[m].goal === ''),
      JSON.stringify(modeGoals));

    // Progression déjà avancée conservée au rechargement
    await chat(page, '/give iron_ingot 1');
    await ticks(page, 12);
    const beforeSave = await ev(page, () => Array.from(window.__game.player.advancements).sort());
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
    await sleep(150);
    await click(page, 'quit');
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await page.reload();
    await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
    await click(page, 'play');
    await page.waitForSelector('[data-mc="world-play"]', { timeout: 10000 });
    await click(page, 'world-play');
    await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
    await ticks(page, 10);
    const afterReload = await ev(page, () => ({
      advs: Array.from(window.__game.player.advancements).sort(),
      goal: window.__game.guideGoal,
    }));
    check('progression existante conservée après rechargement (iron débloqué → objectif pioche en fer)',
      JSON.stringify(afterReload.advs) === JSON.stringify(beforeSave)
      && afterReload.advs.includes('iron')
      && afterReload.goal.includes('pioche en fer'),
      JSON.stringify({ beforeSave, afterReload }));
  });

  console.log('erreurs de page/console :', errors.length, errors.slice(0, 10));
  check('aucune erreur de page ni de console', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));

  await browser.close();
  process.exit(fails.length === 0 && errors.length === 0 ? 0 : 1);
})();
