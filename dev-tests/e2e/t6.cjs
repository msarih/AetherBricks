// Batterie « forteresse du Nether » : forteresse, cage à blazes, blaze, squelette wither, verrues du Nether.
const { sleep, launch, openPage, createWorld, shot, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, section } = require('./h.cjs');

const SEED = '1337';

/** Téléporte le joueur et attend que les chunks autour de lui soient affichés. */
async function goto(page, x, y, z) {
  const go = () => ev(page, (x, y, z) => { const p = window.__game.player; p.teleport(x, y, z); p.vx = p.vy = p.vz = 0; p.fallDistance = 0; }, x, y, z);
  await go();
  await page.waitForFunction(() => { const g = window.__game; return g.chunks.isReady(g.player.x, g.player.z, 3); }, { timeout: 120000 });
  await go();
  await ticks(page, 5);
}

/** Retire toutes les créatures et les objets au sol. */
const sweep = (page) => ev(page, () => { const g = window.__game; for (const e of g.entities) if (e !== g.player) e.dead = true; });

(async () => {
  const errors = [];
  const browser = await launch();
  const page = await openPage(browser, errors);
  await createWorld(page, { name: 'Nether', seed: SEED, creative: true });
  await install(page);
  await ticks(page, 20);
  await ev(page, () => { window.__game.difficulty = 0; window.__game.player.flying = true; });

  let fort = null;
  let scan = null;
  await section('forteresse', async () => {
    await ev(page, () => { window.__msgs.length = 0; });
    await chat(page, '/locate forteresse');
    const over = await ev(page, () => ({ loc: window.__game.locate('fortress'), msg: window.__msgs.join(' | ') }));
    check('depuis la surface, /locate forteresse renvoie vers le Nether', over.loc === null && over.msg.includes('Nether'), over.msg);

    await ev(page, () => { void window.__game.switchDimension('nether', 0, 0); });
    await page.waitForFunction(() => window.__game.dimension === 'nether' && window.__game.chunks.isReady(window.__game.player.x, window.__game.player.z, 2), { timeout: 180000 });
    await ticks(page, 10);
    fort = await ev(page, () => window.__game.locate('fortress'));
    check('dans le Nether, une forteresse est signalée', !!fort && fort.y === 64, JSON.stringify(fort));
    if (!fort) return;
    await goto(page, fort.x + 0.5, fort.y + 1.2, fort.z + 0.5);

    scan = await ev(page, async (seed, f) => {
      const { NetherGen } = await import('/src/world/gen/NetherGen.ts');
      const { B } = await import('/src/world/Ids.ts');
      const gen = new NetherGen(Number(seed), 2);
      const old = new NetherGen(Number(seed), 1);
      const out = { bricks: 0, fences: 0, soul: 0, spawners: [], chests: [], warts: [], oldBricks: 0, chunks: 0 };
      for (let cz = (f.z - 150) >> 4; cz <= (f.z + 150) >> 4; cz++) for (let cx = (f.x - 150) >> 4; cx <= (f.x + 150) >> 4; cx++) {
        const c = gen.generateChunk(cx, cz);
        let has = false;
        for (let y = 20; y < 76; y++) for (let i = 0; i < 256; i++) {
          const id = c.blocks[(y << 8) | i];
          if (id === B.NETHER_BRICKS) { out.bricks++; has = true; }
          else if (id === B.NETHER_BRICK_FENCE) out.fences++;
          else if (id === B.SOUL_SAND) out.soul++;
          else if (id === B.NETHER_WART) out.warts.push({ x: cx * 16 + (i & 15), y, z: cz * 16 + (i >> 4), meta: c.meta[(y << 8) | i] });
        }
        if (has) out.chunks++;
        for (const be of c.blockEntities) { if (be.type === 'spawner') out.spawners.push(be); if (be.type === 'chest' && be.loot === 'fortress') out.chests.push(be); }
        if (has) out.oldBricks += old.generateChunk(cx, cz).blocks.reduce((n, id) => n + (id === B.NETHER_BRICKS ? 1 : 0), 0);
      }
      return out;
    }, SEED, fort);
    check('forteresse de briques du Nether étalée sur de nombreux chunks', scan.bricks > 4000 && scan.chunks >= 12 && scan.fences >= 10, JSON.stringify({ briques: scan.bricks, chunks: scan.chunks, barrieres: scan.fences }));
    check('au moins une cage à blazes, un coffre et une salle des verrues', scan.spawners.length >= 1 && scan.spawners.every((s) => s.mob === 'blaze') && scan.chests.length >= 1 && scan.warts.length >= 12 && scan.soul >= 12,
      JSON.stringify({ cages: scan.spawners.length, coffres: scan.chests.length, verrues: scan.warts.length }));
    check('anciens mondes : aucune forteresse dans le Nether', scan.oldBricks === 0, String(scan.oldBricks));

    const here = await ev(page, async (f) => {
      const { B } = await import('/src/world/Ids.ts');
      const { worldUniforms } = await import('/src/render/ChunkMaterials.ts');
      const w = window.__game.world;
      let bricks = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (w.getBlock(f.x + dx, f.y, f.z + dz) === B.NETHER_BRICKS) bricks++;
      return { bricks, ambient: worldUniforms.uAmbient.value };
    }, fort);
    check('le carrefour central est là où /locate l’indique (dalle de 7 × 7)', here.bricks === 49, String(here.bricks));
    check('le Nether n’est jamais tout à fait noir (lumière minimale relevée)', here.ambient >= 0.25, String(here.ambient));
    await shot(page, 't6-forteresse');
  });

  await section('cage à blazes', async () => {
    if (!scan || scan.spawners.length === 0) throw new Error('pas de cage');
    const s = scan.spawners[0];
    await goto(page, s.x + 0.5, s.y + 2.5, s.z + 4.5);
    await sweep(page);
    const quiet = await ev(page, async (s) => {
      const { B } = await import('/src/world/Ids.ts');
      const w = window.__game.world;
      const be = w.getBlockEntity(s.x, s.y, s.z);
      let fence = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (w.getBlock(s.x + dx, s.y, s.z + dz) === B.NETHER_BRICK_FENCE) fence++;
      return { block: w.getBlock(s.x, s.y, s.z) === B.SPAWNER, mob: be ? be.mob : null, fence };
    }, s);
    check('la cage est sur son estrade, entourée de barrières', quiet.block && quiet.mob === 'blaze' && quiet.fence >= 10, JSON.stringify(quiet));
    await ev(page, () => { window.__game.difficulty = 2; });
    let born = 0;
    for (let i = 0; i < 20 && born === 0; i++) {
      await ticks(page, 10);
      born = await ev(page, (s) => T.mobs('blaze').filter((e) => Math.abs(e.x - s.x) < 7 && Math.abs(e.z - s.z) < 7).length, s);
    }
    check('la cage fait apparaître des blazes', born >= 1 && born <= 6, String(born));
    await ev(page, () => { window.__game.difficulty = 0; });
    await sweep(page);
  });

  await section('blaze', async () => {
    if (!fort) throw new Error('pas de forteresse');
    await goto(page, fort.x + 0.5, fort.y + 1, fort.z + 0.5);
    await sweep(page);
    await ticks(page, 2);
    // joueur en survie sur le carrefour, un blaze à 3 blocs sur la même dalle
    await ev(page, async (f) => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game, p = g.player;
      g.difficulty = 2;
      p.gameMode = 'survival';
      p.flying = false;
      p.health = 20;
      p.teleport(f.x + 0.5, f.y + 1, f.z + 2.5);
      const b = createMob('blaze');
      b.setPosition(f.x + 0.5, f.y + 1.6, f.z - 2.5);
      g.spawn(b);
      window.__blaze = b;
      window.__seen = { small: 0, burning: false, minHealth: 20 };
    }, fort);
    const model = await ev(page, () => { const b = window.__blaze; return { h: b.height, immune: b.fireImmune, flying: b.flying }; });
    check('le blaze vole et ne craint pas le feu', model.flying === true && model.immune === true && model.h === 1.8, JSON.stringify(model));
    for (let i = 0; i < 60; i++) {
      await ticks(page, 5);
      const st = await ev(page, () => {
        const g = window.__game, p = g.player, s = window.__seen;
        s.small += g.entities.filter((e) => e.kind === 'fireball' && e.small).length;
        if (p.fireTicks > 0) s.burning = true;
        s.minHealth = Math.min(s.minHealth, p.health);
        if (p.health < 8) p.health = 20;
        return s;
      });
      if (st.small > 0 && st.burning) break;
    }
    const seen = await ev(page, () => window.__seen);
    check('le blaze tire des petites boules de feu qui enflamment le joueur', seen.small > 0 && seen.burning === true && seen.minHealth < 20, JSON.stringify(seen));
    const kill = await ev(page, () => {
      const g = window.__game, p = g.player, b = window.__blaze;
      const before = g.stats['killed:blaze'] || 0;
      p.gameMode = 'creative';
      p.fireTicks = 0;
      b.hurt(g, 100, 'attack', p);
      return { before, dead: b.health <= 0 };
    });
    await ticks(page, 30);
    const stat = await ev(page, () => window.__game.stats['killed:blaze'] || 0);
    check('un blaze tué par le joueur est compté', kill.dead && stat === kill.before + 1, JSON.stringify({ kill, stat }));
    await sweep(page);
  });

  await section('squelette wither', async () => {
    if (!fort) throw new Error('pas de forteresse');
    await sweep(page);
    await ev(page, async (f) => {
      const { createMob } = await import('/src/entity/Mobs.ts');
      const g = window.__game, p = g.player;
      g.difficulty = 2;
      p.gameMode = 'survival';
      p.flying = false;
      p.health = 20;
      p.witherTicks = 0;
      p.teleport(f.x + 0.5, f.y + 1, f.z + 2.5);
      const s = createMob('wither_skeleton');
      s.setPosition(f.x + 0.5, f.y + 1, f.z - 0.5);
      g.spawn(s);
      window.__ws = s;
    }, fort);
    const model = await ev(page, async () => { const { I } = await import('/src/world/Ids.ts'); const s = window.__ws; return { h: s.height, sword: s.itemId === I.STONE_SWORD, scale: s.mobScale, immune: s.fireImmune }; });
    check('squelette wither : plus grand qu’un squelette, épée de pierre en main', model.h === 2.4 && model.sword && model.scale === 1.2 && model.immune, JSON.stringify(model));
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) {
      await ticks(page, 3);
      hit = await ev(page, () => { const p = window.__game.player; return p.witherTicks > 0 ? { health: p.health, wither: p.witherTicks } : null; });
    }
    check('son coup blesse (8 en difficulté normale) et flétrit pour 10 secondes', !!hit && hit.health <= 12 && hit.wither > 150, JSON.stringify(hit));
    // on l'écarte : le flétrissement continue seul
    await ev(page, () => { window.__ws.dead = true; });
    await ticks(page, 100);
    const later = await ev(page, () => { const p = window.__game.player; return { health: p.health, wither: p.witherTicks, alive: p.alive }; });
    check('le flétrissement ronge la vie tout seul, puis s’arrête', !!hit && later.health < hit.health && later.wither < hit.wither, JSON.stringify({ hit, later }));
    await ev(page, () => { const p = window.__game.player; p.witherTicks = 0; p.health = 20; p.gameMode = 'creative'; p.flying = true; });

    // apparition : seulement sur les briques. La règle, puis 2 minutes de jeu accélérées au cœur de la forteresse.
    const rule = await ev(page, async () => {
      const { fortressGuard } = await import('/src/entity/Spawner.ts');
      const { B } = await import('/src/world/Ids.ts');
      const count = {};
      let s = 12345;
      const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      for (let i = 0; i < 400; i++) { const k = fortressGuard(B.NETHER_BRICKS, rng); count[k] = (count[k] || 0) + 1; }
      return { count, elsewhere: fortressGuard(B.NETHERRACK, rng) };
    });
    check('sur les briques du Nether : surtout des squelettes wither, quelques blazes ; ailleurs, rien de tel',
      rule.count.wither_skeleton > 150 && rule.count.blaze > 30 && rule.elsewhere === null, JSON.stringify(rule));
    await sweep(page);
    await goto(page, fort.x + 0.5, fort.y + 1.2, fort.z + 0.5);
    const natural = await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      g.difficulty = 2;
      for (let i = 0; i < 2400; i++) g.tick();
      const ws = T.mobs('wither_skeleton');
      const onBricks = ws.filter((e) => e.onGround && g.world.getBlock(Math.floor(e.x), Math.floor(e.y - 0.5), Math.floor(e.z)) === B.NETHER_BRICKS).length;
      const grounded = ws.filter((e) => e.onGround).length;
      g.difficulty = 0;
      return { count: ws.length, grounded, onBricks, kinds: T.kinds() };
    });
    check('des squelettes wither apparaissent d’eux-mêmes dans la forteresse', natural.count >= 1, JSON.stringify(natural));
    // des briques posées par le joueur hors d'une forteresse n'attirent pas de gardiens
    const outside = await ev(page, (f) => ({ inside: window.__game.inStructure('fortress', f.x, f.z), away: window.__game.inStructure('fortress', f.x + 3000, f.z + 3000) }), fort);
    check('seule l’emprise de la forteresse compte, pas n’importe quelle brique', outside.inside === true && outside.away === false, JSON.stringify(outside));
    await sweep(page);
  });

  await section('verrues du Nether', async () => {
    if (!scan || scan.warts.length === 0) throw new Error('pas de verrues');
    const ripe = scan.warts.find((w) => (w.meta & 3) === 3) || scan.warts[0];
    await goto(page, ripe.x + 0.5, ripe.y + 2.2, ripe.z + 0.5);
    await sweep(page);
    const room = await ev(page, async (r) => {
      const { B } = await import('/src/world/Ids.ts');
      const w = window.__game.world;
      return { wart: w.getBlock(r.x, r.y, r.z) === B.NETHER_WART, meta: w.getMeta(r.x, r.y, r.z), soul: w.getBlock(r.x, r.y - 1, r.z) === B.SOUL_SAND };
    }, ripe);
    check('les verrues poussent sur le sable des âmes', room.wart && room.soul, JSON.stringify(room));
    // récolte : une verrue mûre en donne plusieurs
    await ev(page, (r) => { window.__game.world.breakBlock(r.x, r.y, r.z, true); }, ripe);
    await ticks(page, 5);
    const drop = await ev(page, async () => {
      const { I } = await import('/src/world/Ids.ts');
      return window.__game.entities.filter((e) => e.kind === 'item' && e.itemId === I.NETHER_WART).reduce((n, e) => n + e.itemCount, 0);
    });
    const want = (room.meta & 3) === 3 ? [2, 4] : [1, 1];
    check('récolter une verrue ' + ((room.meta & 3) === 3 ? 'mûre en donne 2 à 4' : 'jeune en donne 1'), drop >= want[0] && drop <= want[1], String(drop));
    // replanter : la verrue se pose sur le sable des âmes, pas ailleurs
    const planted = await ev(page, async (r) => {
      const { B, I } = await import('/src/world/Ids.ts');
      const { makeStack } = await import('/src/world/ItemStack.ts');
      const { canStay } = await import('/src/world/Behavior.ts');
      const g = window.__game, p = g.player;
      p.inventory.slots[0] = makeStack(I.NETHER_WART, 4);
      p.inventory.selected = 0;
      p.teleport(r.x + 0.5, r.y + 1.2, r.z + 0.5);
      T.aim(r.x + 0.5, r.y - 0.01, r.z + 0.5);
      return { soul: canStay(g.world, r.x, r.y, r.z, B.NETHER_WART, 0), brick: canStay(g.world, r.x, r.y + 3, r.z, B.NETHER_WART, 0) };
    }, ripe);
    await ticks(page, 3);
    await ev(page, (r) => { T.aim(r.x + 0.5, r.y - 0.01, r.z + 0.5); window.__game.input.presses[2]++; }, ripe);
    await ticks(page, 5);
    const after = await ev(page, async (r) => { const { B } = await import('/src/world/Ids.ts'); const w = window.__game.world; return { block: w.getBlock(r.x, r.y, r.z) === B.NETHER_WART, meta: w.getMeta(r.x, r.y, r.z) }; }, ripe);
    check('une verrue se replante sur le sable des âmes (jeune pousse)', planted.soul === true && planted.brick === false && after.block && after.meta === 0, JSON.stringify({ planted, after }));

    if (scan.chests.length > 0) {
      const c = scan.chests[0];
      await goto(page, c.x + 0.5, c.y + 2.2, c.z + 0.5);
      const loot = await ev(page, async (c) => {
        const { getChest } = await import('/src/game/BlockEntities.ts');
        const w = window.__game.world;
        const be = w.getBlockEntity(c.x, c.y, c.z);
        const table = be ? be.loot : null;
        const chest = getChest(w, c.x, c.y, c.z);
        return { table, items: chest.items.filter(Boolean).length };
      }, c);
      check('coffre de la forteresse : butin tiré à l’ouverture', loot.table === 'fortress' && loot.items >= 2, JSON.stringify(loot));
    }
  });

  await section('retour à la surface', async () => {
    await ev(page, () => { const g = window.__game; g.difficulty = 0; void g.switchDimension('overworld', 0, 0); });
    await page.waitForFunction(() => window.__game.dimension === 'overworld' && window.__game.chunks.isReady(window.__game.player.x, window.__game.player.z, 2), { timeout: 180000 });
    await ticks(page, 10);
    const back = await ev(page, async () => { const { worldUniforms } = await import('/src/render/ChunkMaterials.ts'); return { ambient: worldUniforms.uAmbient.value, loc: window.__game.locate('fortress') }; });
    check('à la surface, la nuit redevient noire et la forteresse n’est plus signalée', back.ambient < 0.1 && back.loc === null, JSON.stringify(back));
  });

  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
