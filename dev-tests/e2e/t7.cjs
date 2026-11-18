// Batterie « créatures » : slime, enderman, sorcière et ses potions, cheval, calamar, golem de fer,
// ocelot et chat, laisse, étiquette. Monde plat en survie, puis un monde normal pour le village et la mer.
const { sleep, launch, openPage, click, createWorld, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, rclick, lclick, section } = require('./h.cjs');

/** Aides côté page : création de créatures, recherche par identifiant. */
async function helpers(page) {
  await install(page);
  await ev(page, async () => {
    const { createMob } = await import('/src/entity/Mobs.ts');
    const g = window.__game;
    window.M = {
      get: (id) => g.entities.find((e) => e.id === id) || null,
      spawn: (kind, x, z, o = {}) => {
        const m = createMob(kind);
        if (o.size) m.setSize(o.size);
        Object.assign(m, o.set || {});
        m.setPosition(x, o.y ?? 4, z);
        m.setRotation(o.yaw ?? 0);
        if (o.frozen) m.behave = () => {};
        g.spawn(m);
        return m.id;
      },
      clear: () => { for (const e of g.entities) if (e !== g.player) e.dead = true; },
      items: (name) => g.entities.filter((e) => e.kind === 'item' && !e.dead && e.itemId === T.id(name)).reduce((n, e) => n + e.itemCount, 0),
      dist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
      home: () => { const p = g.player; p.teleport(0.5, 4, 0.5); p.vx = p.vy = p.vz = 0; p.fallDistance = 0; },
      mode: (m) => { g.player.gameMode = m; if (m === 'survival') g.player.flying = false; },
      heal: () => { const p = g.player; p.health = 20; p.hunger = 20; p.invulnerable = 0; p.clearEffects(); p.fireTicks = 0; },
    };
  });
}

const calm = async (page) => {
  await ev(page, () => { M.clear(); M.home(); M.heal(); });
  await chat(page, '/time set day');
  await chat(page, '/clear');
  await ticks(page, 3);
};

/** Quitte vers le titre puis relance le premier monde de la liste. */
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
  await helpers(page);
  await ticks(page, 10);
}

(async () => {
  const errors = [];
  const browser = await launch();
  const page = await openPage(browser, errors);
  await createWorld(page, { name: 'Creatures', seed: '42', flat: true });
  await helpers(page);
  await ticks(page, 20);
  const herds = await ev(page, () => T.kinds());
  await calm(page);

  await section('objets, recettes, butin', async () => {
    check('monde plat (plaine) : des chevaux sont nés avec le monde, en troupeau', (herds.horse || 0) >= 2, JSON.stringify(herds));
    const r = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const { generateLoot } = await import('/src/world/Loot.ts');
      const { B, I } = await import('/src/world/Ids.ts');
      const { ITEMS } = await import('/src/world/Items.ts');
      const lead = matchRecipe([I.STRING, I.STRING, 0, I.STRING, I.SLIME_BALL, 0, 0, 0, I.STRING], 3);
      const sticky = matchRecipe([0, I.SLIME_BALL, 0, 0, B.PISTON, 0, 0, 0, 0], 3);
      const found = { saddle: 0, tag: 0 };
      for (let i = 0; i < 300; i++) {
        for (const s of generateLoot('dungeon', 1337, i * 7, 20, -i * 3, 27)) {
          if (s && s.id === I.SADDLE) found.saddle++;
          if (s && s.id === I.NAME_TAG) found.tag++;
        }
      }
      const labels = [I.SLIME_BALL, I.ENDER_PEARL, I.SADDLE, I.LEAD, I.NAME_TAG].map((id) => ITEMS[id] && ITEMS[id].label);
      return { lead, sticky, found, labels, I: { LEAD: I.LEAD }, B: { STICKY: B.STICKY_PISTON } };
    });
    check('les cinq nouveaux objets existent (boule de slime, perle, selle, laisse, étiquette)', r.labels.every((l) => typeof l === 'string' && l.length > 2), r.labels.join(', '));
    check('recette de la laisse : 4 ficelles et une boule de slime donnent 2 laisses', r.lead && r.lead.id === r.I.LEAD && r.lead.count === 2, JSON.stringify(r.lead));
    check('recette du piston collant avec une boule de slime', r.sticky && r.sticky.id === r.B.STICKY, JSON.stringify(r.sticky));
    check('selle et étiquette se trouvent dans les coffres des donjons', r.found.saddle > 5 && r.found.tag > 5, JSON.stringify(r.found));
  });

  await section('slime', async () => {
    await ev(page, () => M.mode('creative'));
    const big = await ev(page, () => M.spawn('slime', 4.5, -4.5, { size: 4 }));
    await ticks(page, 5);
    const b = await ev(page, (id) => { const m = M.get(id); return { size: m.size, health: m.health, width: m.width }; }, big);
    check('gros slime : taille 4, 16 points de vie, 2 blocs de large', b.size === 4 && b.health === 16 && Math.abs(b.width - 2.04) < 0.01, JSON.stringify(b));
    await ev(page, (id) => { const g = window.__game; M.get(id).hurt(g, 100, 'attack', g.player); }, big);
    await ticks(page, 30);
    const mid = await ev(page, () => T.mobs('slime').map((m) => m.size));
    check('tué, le gros slime se divise en 2 à 4 slimes moyens', mid.length >= 2 && mid.length <= 4 && mid.every((s) => s === 2), JSON.stringify(mid));
    await ev(page, () => { const g = window.__game; for (const m of T.mobs('slime')) m.hurt(g, 100, 'attack', g.player); });
    await ticks(page, 30);
    const small = await ev(page, () => T.mobs('slime').map((m) => m.size));
    check('les moyens se divisent à leur tour en petits slimes', small.length >= 4 && small.every((s) => s === 1), JSON.stringify(small));
    // quelques petits de plus, pour que le butin ne dépende pas d'un tirage malchanceux
    await ev(page, () => { for (let i = 0; i < 12; i++) M.spawn('slime', 3 + (i % 4), -6 - Math.floor(i / 4), { size: 1 }); });
    await ticks(page, 3);
    await ev(page, () => { const g = window.__game; for (const m of T.mobs('slime')) m.hurt(g, 100, 'attack', g.player); });
    await ticks(page, 30);
    const loot = await ev(page, () => ({ balls: M.items('slime_ball') + T.count('slime_ball'), left: T.mobs('slime').length, killed: window.__game.stats['killed:slime'] || 0 }));
    check('les petits slimes ne se divisent plus et lâchent des boules de slime', loot.left === 0 && loot.balls >= 1, JSON.stringify(loot));
    check('statistiques : les slimes vaincus sont comptés', loot.killed >= 7, String(loot.killed));

    // dégâts : un gros slime blesse, un petit non
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); M.spawn('slime', 0.5, -1.0, { size: 1 }); });
    await ticks(page, 80);
    const h1 = await ev(page, () => window.__game.player.health);
    check('un petit slime au contact ne blesse pas', h1 === 20, 'vie ' + h1);
    await ev(page, () => { M.clear(); M.heal(); M.spawn('slime', 0.5, -2.2, { size: 4 }); });
    await ticks(page, 80);
    const h2 = await ev(page, () => window.__game.player.health);
    check('un gros slime au contact blesse', h2 < 20, 'vie ' + h2);

    const sc = await ev(page, async () => {
      const { isSlimeChunk } = await import('/src/entity/Creatures.ts');
      let n = 0, same = true;
      for (let cx = -25; cx < 25; cx++) for (let cz = -20; cz < 20; cz++) { const a = isSlimeChunk(42, cx, cz); if (a) n++; if (a !== isSlimeChunk(42, cx, cz)) same = false; }
      let other = 0;
      for (let cx = -25; cx < 25; cx++) for (let cz = -20; cz < 20; cz++) if (isSlimeChunk(43, cx, cz) !== isSlimeChunk(42, cx, cz)) other++;
      return { n, same, other };
    });
    check('chunks à slimes : un sur dix environ, tirés de la graine', sc.n > 120 && sc.n < 280 && sc.same && sc.other > 100, JSON.stringify(sc));
  });

  await section('enderman', async () => {
    await calm(page);
    // sous un toit : au grand jour, un enderman provoqué se calme et s'en va
    const roof = (id) => ev(page, async (id) => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      for (let x = -4; x <= 4; x++) for (let z = -3; z <= 13; z++) g.world.setBlock(x, 9, z, id ? B.STONE : B.AIR, 0);
    }, id);
    await roof(true);
    await ev(page, () => { M.mode('survival'); M.heal(); T.look(0, 0); });
    const id = await ev(page, () => M.spawn('enderman', 0.5, 9.5, { yaw: Math.PI }));
    await ticks(page, 60);
    const idle = await ev(page, (id) => { const m = M.get(id); return { target: !!m.target, angry: m.angry, health: window.__game.player.health, height: m.height }; }, id);
    check('enderman dans le dos du joueur : il reste paisible', idle.target === false && idle.angry === false && idle.health === 20, JSON.stringify(idle));
    // le regarder dans les yeux
    let stared = null;
    for (let i = 0; i < 12 && !(stared && stared.target); i++) {
      await ev(page, (id) => { const m = M.get(id); T.aim(m.x, m.y + m.eyeHeight, m.z); }, id);
      await ticks(page, 2);
      stared = await ev(page, (id) => { const m = M.get(id); return { target: m.target === window.__game.player, angry: m.angry }; }, id);
    }
    check('regardé dans les yeux, il prend le joueur pour cible', stared.target === true && stared.angry === true, JSON.stringify(stared));
    let hurt = 20;
    for (let i = 0; i < 50 && hurt >= 20; i++) { await ticks(page, 2); hurt = await ev(page, () => window.__game.player.health); }
    check('provoqué, il attaque', hurt < 20 && hurt > 0, 'vie ' + hurt);
    await ev(page, () => { M.mode('creative'); M.heal(); });
    await ticks(page, 15);
    await roof(false);
    const calmed = await ev(page, (id) => { const m = M.get(id); return { target: !!m.target, angry: m.angry }; }, id);
    check('le joueur hors d’atteinte (créatif), il se calme', calmed.target === false && calmed.angry === false, JSON.stringify(calmed));

    const arrow = await ev(page, (id) => {
      const g = window.__game, m = M.get(id);
      const before = { x: m.x, z: m.z, h: m.health };
      const ok = m.hurt(g, 5, 'arrow', g.player);
      return { ok, moved: Math.hypot(m.x - before.x, m.z - before.z), same: m.health === before.h };
    }, id);
    check('une flèche ne le touche pas : il s’est téléporté', arrow.ok === false && arrow.moved > 1 && arrow.same, JSON.stringify(arrow));

    const wet = await ev(page, async (id) => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game, m = M.get(id);
      const x = Math.floor(m.x), z = Math.floor(m.z);
      g.world.setBlock(x, 4, z, B.WATER, 0);
      return { x, z, h: m.health };
    }, id);
    await ticks(page, 25);
    const dry = await ev(page, async (id, wet) => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game, m = M.get(id);
      const r = { h: m.health, away: Math.hypot(m.x - wet.x - 0.5, m.z - wet.z - 0.5), inWater: m.inWater };
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (g.world.getBlock(wet.x + dx, 4, wet.z + dz) === B.WATER) g.world.setBlock(wet.x + dx, 4, wet.z + dz, B.AIR, 0);
      return r;
    }, id, wet);
    check('l’eau le blesse et le fait fuir', dry.h < wet.h && dry.away > 3 && !dry.inWater, JSON.stringify(dry));

    // il emporte un bloc : seules des citrouilles sont à sa portée
    const pen = await ev(page, async (id) => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game, m = M.get(id);
      m.dead = true;
      const cx = 20, cz = 20;
      let n = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue;
        g.world.setBlock(cx + dx, 4, cz + dz, B.PUMPKIN, 0);
        n++;
      }
      const e = M.get(M.spawn('enderman', cx + 0.5, cz + 0.5));
      // il reste au milieu des citrouilles : seule sa promenade est coupée, pas son envie de blocs
      e.wander = () => {};
      return { id: e.id, n, cx, cz };
    }, id);
    let carried = 0;
    for (let i = 0; i < 80 && !carried; i++) {
      await ticks(page, 20);
      carried = await ev(page, (id) => { const m = M.get(id); return m ? m.blockId : -1; }, pen.id);
    }
    const after = await ev(page, async (pen) => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      let n = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (g.world.getBlock(pen.cx + dx, 4, pen.cz + dz) === B.PUMPKIN) n++;
      return { n, pumpkin: B.PUMPKIN };
    }, pen);
    check('il emporte un bloc : une citrouille a quitté le sol et il la tient', carried === after.pumpkin && after.n === pen.n - 1, JSON.stringify({ carried, reste: after.n, avant: pen.n }));
    // loin du joueur, un enderman les mains vides disparaît ; celui qui porte un bloc reste, sinon le bloc serait perdu
    const far = await ev(page, async (id) => {
      const g = window.__game, m = M.get(id);
      let d = 0;
      for (const c of [110, 104, 98]) if (g.world.isLoaded(c, 0)) { d = c; break; }
      if (!d) return null;
      m.teleport(d + 0.5, 4, 0.5);
      return { empty: M.spawn('enderman', d + 0.5, 4.5), d };
    }, pen.id);
    await ticks(page, 10);
    const kept = await ev(page, (id, far) => (far ? { carrier: !!M.get(id), empty: !!M.get(far.empty) } : null), pen.id, far);
    check('un enderman qui porte un bloc ne disparaît pas loin du joueur', !!kept && kept.carrier === true && kept.empty === false, JSON.stringify(kept));
    await ev(page, (id, pen) => { M.get(id).teleport(pen.cx + 0.5, 4, pen.cz + 0.5); }, pen.id, pen);
    await ticks(page, 3);
    await ev(page, (id) => { const g = window.__game; M.get(id).hurt(g, 1000, 'attack', g.player); }, pen.id);
    await ticks(page, 30);
    const dropped = await ev(page, () => M.items('pumpkin') + T.count('pumpkin'));
    check('tué, il rend le bloc qu’il portait', dropped === 1, String(dropped));
    await ev(page, async (pen) => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) g.world.setBlock(pen.cx + dx, 4, pen.cz + dz, B.AIR, 0);
      for (let i = 0; i < 14; i++) M.spawn('enderman', 30.5 + (i % 7) * 2, 30.5 + Math.floor(i / 7) * 2);
    }, pen);
    await ticks(page, 3);
    await ev(page, () => { const g = window.__game; for (const m of T.mobs('enderman')) m.hurt(g, 1000, 'attack', g.player); });
    await ticks(page, 30);
    const pearls = await ev(page, () => M.items('ender_pearl') + T.count('ender_pearl'));
    check('les endermen lâchent des perles de l’Ender', pearls >= 1 && pearls <= 15, String(pearls));
  });

  await section('sorcière et potions', async () => {
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); T.look(0, 0); });
    const id = await ev(page, () => M.spawn('witch', 0.5, -6.5, { yaw: Math.PI }));
    let seen = { potion: false, fx: false };
    for (let i = 0; i < 40 && !(seen.potion && seen.fx); i++) {
      await ticks(page, 5);
      const s = await ev(page, () => {
        const g = window.__game, p = g.player;
        return { potion: g.entities.some((e) => e.kind === 'item' && e.itemId === T.id('splash_potion')), fx: p.poisonTicks > 0 || p.slowTicks > 0 || p.weakTicks > 0 || p.health < 20 };
      });
      seen = { potion: seen.potion || s.potion, fx: seen.fx || s.fx };
    }
    check('la sorcière lance une potion sur le joueur', seen.potion === true);
    check('la potion fait effet (poison, lenteur, faiblesse ou dégâts)', seen.fx === true);
    // elle se soigne en buvant
    await ev(page, (id) => { M.mode('creative'); const m = M.get(id); m.health = 8; }, id);
    let healed = 8;
    for (let i = 0; i < 30 && healed < 16; i++) { await ticks(page, 20); healed = await ev(page, (id) => M.get(id).health, id); }
    check('blessée, la sorcière boit et se soigne', healed >= 16, 'vie ' + healed);
    const own = await ev(page, async (id) => {
      const { ThrownPotion } = await import('/src/entity/Objects.ts');
      const g = window.__game, m = M.get(id);
      const pig = M.get(M.spawn('pig', m.x + 1, m.z, { frozen: true }));
      const before = { witch: m.health, pig: pig.health };
      const pot = new ThrownPotion('harm');
      pot.shoot(m.x + 0.5, m.y + 3, m.z, 0, -1, 0, 0.5);
      g.spawn(pot);
      return { before, pig: pig.id };
    }, id);
    await ticks(page, 20);
    const splash = await ev(page, (id, own) => ({ witch: M.get(id).health >= own.before.witch, pig: M.get(own.pig) ? M.get(own.pig).health : 0, pigBefore: own.before.pig }), id, own);
    check('une potion de dégâts blesse les créatures autour, pas les sorcières', splash.witch === true && splash.pig < splash.pigBefore, JSON.stringify(splash));

    // poison : fait mal mais ne tue pas ; cœurs verts
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); const p = window.__game.player; p.health = 6; p.hunger = 10; p.poisonTicks = 400; });
    await ticks(page, 60);
    const mid = await ev(page, () => ({ h: window.__game.player.health, tint: window.__game.heartTint, fx: document.querySelector('.mc-row-hearts').dataset.fx }));
    check('poison : la vie baisse et les cœurs virent au vert', mid.h < 6 && mid.tint === 'poison' && mid.fx === 'poison', JSON.stringify(mid));
    await ticks(page, 360);
    const end = await ev(page, () => { const p = window.__game.player; return { h: p.health, alive: p.alive, left: p.poisonTicks, fx: document.querySelector('.mc-row-hearts').dataset.fx }; });
    check('poison : il s’arrête à un demi-cœur, sans tuer', end.alive && end.h === 1 && end.left === 0 && end.fx === '', JSON.stringify(end));

    // lenteur : mêmes 40 ticks de marche, moins de chemin
    const walk = async (slow) => {
      await ev(page, (slow) => { M.home(); M.heal(); T.look(0, 0); window.__game.player.slowTicks = slow; }, slow);
      await ticks(page, 5);
      const z0 = await ev(page, () => window.__game.player.z);
      await page.keyboard.down('KeyW'); await ticks(page, 40); await page.keyboard.up('KeyW');
      const z1 = await ev(page, () => window.__game.player.z);
      await ticks(page, 10);
      return z0 - z1;
    };
    const normal = await walk(0);
    const slowed = await walk(2000);
    check('lenteur : le joueur marche environ 15 % moins vite', slowed / normal > 0.78 && slowed / normal < 0.92, `${slowed.toFixed(2)} contre ${normal.toFixed(2)} blocs`);

    // faiblesse : un coup de poing ne blesse plus
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); });
    const pig = await ev(page, () => M.spawn('pig', 0.5, -1.6, { frozen: true }));
    await ticks(page, 5);
    await ev(page, (id) => { const m = M.get(id); window.__game.player.weakTicks = 400; T.aim(m.x, m.y + 0.5, m.z); }, pig);
    await ticks(page, 2);
    await lclick(page);
    await ticks(page, 12);
    const weak = await ev(page, (id) => M.get(id).health, pig);
    await ev(page, (id) => { const m = M.get(id); window.__game.player.weakTicks = 0; T.aim(m.x, m.y + 0.5, m.z); }, pig);
    await ticks(page, 2);
    await lclick(page);
    await ticks(page, 5);
    const strong = await ev(page, (id) => { const m = M.get(id); return m ? m.health : 0; }, pig);
    check('faiblesse : le coup de poing ne blesse plus ; sans elle, il blesse', weak === 10 && strong === 9, `${weak} puis ${strong}`);

    // le lait dissipe tout
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); const p = window.__game.player; p.poisonTicks = 900; p.slowTicks = 900; p.weakTicks = 900; p.witherTicks = 900; });
    await chat(page, '/give milk_bucket 1');
    await ev(page, () => { T.select('milk_bucket'); T.look(0, 0.5); window.__game.input.buttons[2] = true; });
    await ticks(page, 45);
    await ev(page, () => { window.__game.input.buttons[2] = false; });
    const milk = await ev(page, () => { const p = window.__game.player; return [p.poisonTicks, p.slowTicks, p.weakTicks, p.witherTicks, T.count('bucket')]; });
    check('boire du lait dissipe poison, lenteur, faiblesse et flétrissement', milk[0] === 0 && milk[1] === 0 && milk[2] === 0 && milk[3] === 0 && milk[4] === 1, JSON.stringify(milk));
  });

  await section('cheval', async () => {
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); });
    const id = await ev(page, () => M.spawn('horse', 0.5, -2.2, { yaw: Math.PI / 2 }));
    await ticks(page, 5);
    const stats = await ev(page, (id) => { const m = M.get(id); return { hp: m.maxHealth, speed: m.speedStat, jump: m.jumpStat, variant: m.variant }; }, id);
    check('cheval : vie, vitesse et détente dans les fourchettes de Minecraft', stats.hp >= 15 && stats.hp <= 30 && stats.speed >= 0.1124 && stats.speed <= 0.3376 && stats.jump >= 0.4 && stats.jump <= 1.0 && stats.variant >= 0 && stats.variant <= 6, JSON.stringify(stats));
    const mount = async () => {
      await ev(page, (id) => { const m = M.get(id); const p = window.__game.player; p.teleport(m.x, 4, m.z + 2.2); p.inventory.selected = 8; T.aim(m.x, m.y + 1, m.z); }, id);
      await ticks(page, 2);
      await rclick(page);
      return ev(page, (id) => { const g = window.__game, p = g.player, m = M.get(id); return { on: p.vehicle === m, riding: p.riding, dy: p.y - m.y, dxz: Math.hypot(p.x - m.x, p.z - m.z) }; }, id);
    };
    const up = await mount();
    check('clic droit à mains nues : le joueur monte en selle', up.on && up.riding && Math.abs(up.dy - 0.85) < 0.05 && up.dxz < 0.01, JSON.stringify(up));
    let off = null;
    for (let i = 0; i < 30; i++) { await ticks(page, 5); off = await ev(page, (id) => { const p = window.__game.player, m = M.get(id); return { on: p.vehicle === m, tamed: m.tamed, temper: m.temper, y: p.y }; }, id); if (!off.on) break; }
    check('cheval sauvage : il désarçonne son cavalier et s’habitue un peu', off.on === false && off.tamed === false && off.temper === 5, JSON.stringify(off));
    const treat = await ev(page, (id) => { const m = M.get(id); m.health = m.maxHealth - 4; return m.temper; }, id);
    await chat(page, '/give sugar 4');
    await ev(page, (id) => { const m = M.get(id); const p = window.__game.player; p.teleport(m.x, 4, m.z + 2.2); T.select('sugar'); T.aim(m.x, m.y + 1, m.z); }, id);
    await ticks(page, 2);
    await rclick(page);
    const fed = await ev(page, (id) => ({ temper: M.get(id).temper, sugar: T.count('sugar') }), id);
    check('une friandise (sucre) le met en confiance', fed.temper === treat + 3 && fed.sugar === 3, JSON.stringify(fed));
    await chat(page, '/clear');
    await ev(page, (id) => { M.get(id).temper = 100; }, id);
    await mount();
    let tamed = false;
    for (let i = 0; i < 30 && !tamed; i++) { await ticks(page, 5); tamed = await ev(page, (id) => M.get(id).tamed, id); }
    check('en confiance, il se laisse apprivoiser', tamed === true);
    // sans selle : il ne se dirige pas
    await ev(page, () => T.look(0, 0));
    const p0 = await ev(page, (id) => { const m = M.get(id); return { x: m.x, z: m.z }; }, id);
    await page.keyboard.down('KeyW'); await ticks(page, 20); await page.keyboard.up('KeyW');
    const p1 = await ev(page, (id, p0) => { const m = M.get(id); return { moved: Math.hypot(m.x - p0.x, m.z - p0.z), on: window.__game.player.vehicle === m }; }, id, p0);
    check('sans selle, on tient en selle mais on ne le dirige pas', p1.on && p1.moved < 0.3, JSON.stringify(p1));
    await page.keyboard.down('ShiftLeft'); await ticks(page, 4); await page.keyboard.up('ShiftLeft');
    await ticks(page, 10);
    const down = await ev(page, (id) => { const p = window.__game.player, m = M.get(id); return { on: !!p.vehicle, riding: p.riding, d: Math.hypot(p.x - m.x, p.z - m.z), y: p.y, ground: p.onGround }; }, id);
    check('s’accroupir fait descendre, à côté du cheval', !down.on && !down.riding && down.d > 0.7 && down.d < 2.5 && Math.abs(down.y - 4) < 0.01 && down.ground, JSON.stringify(down));
    // selle
    await chat(page, '/give saddle 1');
    await ev(page, (id) => { const m = M.get(id); const p = window.__game.player; p.teleport(m.x, 4, m.z + 2.2); T.select('saddle'); T.aim(m.x, m.y + 1, m.z); }, id);
    await ticks(page, 2);
    await rclick(page);
    const sad = await ev(page, (id) => ({ saddled: M.get(id).saddled, left: T.count('saddle'), on: !!window.__game.player.vehicle }), id);
    check('clic droit avec une selle : le cheval est sellé', sad.saddled && sad.left === 0 && !sad.on, JSON.stringify(sad));
    await ev(page, (id) => { const m = M.get(id); m.speedStat = 0.3; m.jumpStat = 0.8; m.health = m.maxHealth; }, id);
    await mount();
    await ev(page, () => T.look(0, 0));
    await ticks(page, 3);
    const r0 = await ev(page, (id) => { const m = M.get(id); return { x: m.x, z: m.z }; }, id);
    await page.keyboard.down('KeyW'); await ticks(page, 40); await page.keyboard.up('KeyW');
    const r1 = await ev(page, (id, r0) => { const m = M.get(id), p = window.__game.player; return { dz: r0.z - m.z, dx: Math.abs(m.x - r0.x), with: Math.hypot(p.x - m.x, p.z - m.z), dy: p.y - m.y, yaw: Math.abs(m.yaw - p.yaw) }; }, id, r0);
    check('sellé, il avance où regarde son cavalier, bien plus vite qu’à pied', r1.dz > 15 && r1.dx < 1 && r1.with < 0.01 && Math.abs(r1.dy - 0.85) < 0.05 && r1.yaw < 0.01, JSON.stringify(r1));
    await ticks(page, 20);
    await ev(page, () => T.look(Math.PI / 2, 0));
    await page.keyboard.down('KeyW'); await ticks(page, 20); await page.keyboard.up('KeyW');
    const r2 = await ev(page, (id, r1) => { const m = M.get(id); return { yaw: m.yaw, x: m.x }; }, id, r1);
    check('tourner le regard fait tourner le cheval', Math.abs(r2.yaw - Math.PI / 2) < 0.01 && r2.x < r0.x - 3, JSON.stringify(r2));
    await ticks(page, 20);
    let top = 0;
    await page.keyboard.down('Space');
    for (let i = 0; i < 12; i++) { await ticks(page, 2); top = Math.max(top, await ev(page, (id) => M.get(id).y, id)); }
    await page.keyboard.up('Space');
    await ticks(page, 30);
    check('la touche de saut le fait sauter (plus de 2 blocs)', top > 6, 'sommet y = ' + top.toFixed(2));
    // un coup donné en selle ne touche pas sa propre monture
    const hp0 = await ev(page, (id) => { T.look(0, -1.2); return M.get(id).health; }, id);
    await ticks(page, 2);
    await lclick(page);
    await ticks(page, 5);
    const hp1 = await ev(page, (id) => ({ h: M.get(id).health, aimed: window.__game.interaction.entity === M.get(id) }), id);
    check('en selle, on ne frappe pas sa propre monture', hp1.h === hp0 && hp1.aimed === false, JSON.stringify(hp1));
    // une téléportation fait descendre : le cheval ne ramène pas son cavalier
    await chat(page, '/tp ~30 ~ ~');
    await ticks(page, 10);
    const tp = await ev(page, (id) => { const p = window.__game.player, m = M.get(id); return { on: !!p.vehicle, riding: p.riding, d: Math.hypot(p.x - m.x, p.z - m.z), rider: !!m.rider }; }, id);
    check('se téléporter fait descendre de cheval', !tp.on && !tp.riding && tp.d > 25 && !tp.rider, JSON.stringify(tp));
  });

  await section('calamar', async () => {
    await calm(page);
    await ev(page, () => M.mode('creative'));
    const pool = await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      for (let x = 12; x < 22; x++) for (let z = -5; z < 5; z++) for (let y = 1; y <= 3; y++) g.world.setBlock(x, y, z, B.WATER, 0);
      return { id: M.spawn('squid', 17, 0, { y: 1.5 }), dry: M.spawn('squid', 4.5, 6.5) };
    });
    let far = 0, wet = true, yMax = 0;
    for (let i = 0; i < 12; i++) {
      await ticks(page, 20);
      const s = await ev(page, (id) => { const m = M.get(id); return m ? { d: Math.hypot(m.x - 17, m.z), w: m.inWater, y: m.y, alive: m.alive } : null; }, pool.id);
      if (!s || !s.alive) { wet = false; break; }
      far = Math.max(far, s.d); wet = wet && s.w; yMax = Math.max(yMax, s.y);
    }
    check('dans l’eau, le calamar nage sans en sortir', wet && far > 1 && yMax < 4, JSON.stringify({ far, wet, yMax }));
    const dry = await ev(page, (id) => { const m = M.get(id); return m ? m.health : 0; }, pool.dry);
    check('hors de l’eau, il s’asphyxie', dry < 10, 'vie ' + dry);
    // l'encre du calamar échoué ne compte pas
    await ticks(page, 25);
    await ev(page, (id) => { const g = window.__game; for (const e of g.entities) if (e.kind === 'item') e.dead = true; const m = M.get(id); m.invulnerable = 0; m.hurt(g, 100, 'attack', g.player); }, pool.id);
    await ticks(page, 30);
    const ink = await ev(page, () => M.items('black_dye') + T.count('black_dye'));
    check('il lâche de l’encre (colorant noir)', ink >= 1 && ink <= 3, String(ink));
    await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      for (let x = 12; x < 22; x++) for (let z = -5; z < 5; z++) { g.world.setBlock(x, 3, z, B.GRASS, 0); g.world.setBlock(x, 2, z, B.DIRT, 0); g.world.setBlock(x, 1, z, B.DIRT, 0); }
    });
  });

  await section('golem de fer', async () => {
    await calm(page);
    await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      M.mode('survival');
      // quatre blocs de fer en T ; il ne manque que la citrouille
      g.world.setBlock(0, 4, -4, B.IRON_BLOCK, 0);
      g.world.setBlock(0, 5, -4, B.IRON_BLOCK, 0);
      g.world.setBlock(-1, 5, -4, B.IRON_BLOCK, 0);
      g.world.setBlock(1, 5, -4, B.IRON_BLOCK, 0);
    });
    await chat(page, '/give pumpkin 1');
    // perché sur deux blocs, pour viser le dessus du bloc de fer du haut
    await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game, p = g.player;
      g.world.setBlock(0, 4, -2, B.STONE, 0);
      g.world.setBlock(0, 5, -2, B.STONE, 0);
      p.teleport(0.5, 6, -1.5);
      T.select('pumpkin');
      T.aim(0.5, 6, -3.6);
    });
    await ticks(page, 3);
    const aimed = await ev(page, () => T.hit());
    await rclick(page);
    await ticks(page, 5);
    await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      g.world.setBlock(0, 4, -2, B.AIR, 0);
      g.world.setBlock(0, 5, -2, B.AIR, 0);
      M.home();
    });
    await ticks(page, 10);
    const built = await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      const golems = T.mobs('iron_golem');
      const left = [[0, 4, -4], [0, 5, -4], [-1, 5, -4], [1, 5, -4], [0, 6, -4]].filter(([x, y, z]) => g.world.getBlock(x, y, z) !== B.AIR).length;
      const m = golems[0];
      return { n: golems.length, left, made: m && m.playerMade, hp: m && m.health, id: m && m.id, pumpkins: T.count('pumpkin') };
    });
    check('une citrouille posée sur quatre blocs de fer en T donne un golem de fer', built.n === 1 && built.left === 0 && built.made === true && built.hp === 100 && built.pumpkins === 0, JSON.stringify({ ...built, aimed }));
    await ev(page, (id) => { const g = window.__game; M.get(id).hurt(g, 2, 'attack', g.player); }, built.id);
    await ticks(page, 20);
    const loyal = await ev(page, (id) => ({ target: !!M.get(id).target, h: window.__game.player.health }), built.id);
    check('le golem construit par le joueur ne se retourne pas contre lui', loyal.target === false && loyal.h === 20, JSON.stringify(loyal));
    // il s'en prend aux monstres, pas aux creepers
    await ev(page, () => M.mode('creative'));
    const foes = await ev(page, (id) => { const m = M.get(id); return { creeper: M.spawn('creeper', m.x + 3, m.z + 2) }; }, built.id);
    await ticks(page, 60);
    const peace = await ev(page, (id, foes) => ({ target: !!M.get(id).target, creeper: !!M.get(foes.creeper) }), built.id, foes);
    check('il laisse les creepers tranquilles', peace.target === false && peace.creeper === true, JSON.stringify(peace));
    const spider = await ev(page, (id, foes) => { const m = M.get(id); M.get(foes.creeper).dead = true; return M.spawn('spider', m.x - 4, m.z + 3); }, built.id, foes);
    let dead = false;
    for (let i = 0; i < 30 && !dead; i++) { await ticks(page, 10); dead = await ev(page, (id) => { const m = M.get(id); return !m || !m.alive; }, spider); }
    check('il tue l’araignée qui s’approche', dead === true);
    // golem de village : il riposte
    const wild = await ev(page, () => { M.mode('survival'); M.heal(); return M.spawn('iron_golem', 8.5, 8.5); });
    await ticks(page, 5);
    await ev(page, (id) => { const g = window.__game; M.get(id).hurt(g, 2, 'attack', g.player); }, wild);
    await ticks(page, 5);
    const angry = await ev(page, (id) => M.get(id).target === window.__game.player, wild);
    check('un golem de village frappé par le joueur riposte', angry === true);
    await ev(page, (id) => { M.mode('creative'); const g = window.__game; const m = M.get(id); m.invulnerable = 0; m.hurt(g, 1000, 'attack', g.player); }, wild);
    await ticks(page, 30);
    const iron = await ev(page, () => M.items('iron_ingot') + T.count('iron_ingot'));
    check('il lâche 3 à 5 lingots de fer', iron >= 3 && iron <= 5, String(iron));
  });

  await section('ocelot et chat', async () => {
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); });
    const id = await ev(page, () => M.spawn('ocelot', 0.5, -4.5));
    await ticks(page, 60);
    const fled = await ev(page, (id) => M.dist(M.get(id), window.__game.player), id);
    check('ocelot sauvage : il détale devant un joueur debout', fled > 6.5, 'à ' + fled.toFixed(1) + ' blocs');
    await chat(page, '/give raw_fish 40');
    await ev(page, (id) => { T.select('raw_fish'); const m = M.get(id), p = window.__game.player; p.teleport(m.x + 7, 4, m.z); }, id);
    let near = 99;
    for (let i = 0; i < 40 && near > 2.6; i++) { await ticks(page, 10); near = await ev(page, (id) => M.dist(M.get(id), window.__game.player), id); }
    check('du poisson cru en main l’attire', near <= 2.6, 'à ' + near.toFixed(1) + ' blocs');
    let cat = { tamed: false };
    let clicks = 0;
    for (let i = 0; i < 40 && !cat.tamed; i++) {
      await ev(page, (id) => { const m = M.get(id); T.aim(m.x, m.y + 0.35, m.z); }, id);
      await ticks(page, 1);
      const before = await ev(page, () => T.count('raw_fish'));
      await rclick(page);
      const now = await ev(page, () => T.count('raw_fish'));
      if (now < before) clicks++;
      cat = await ev(page, (id) => { const m = M.get(id); return { tamed: m.tamed, variant: m.variant, sitting: m.sitting, fish: T.count('raw_fish') }; }, id);
      if (!cat.tamed) { let d = 99; for (let k = 0; k < 20 && d > 2.6; k++) { await ticks(page, 5); d = await ev(page, (id) => M.dist(M.get(id), window.__game.player), id); } }
    }
    check('nourri de poisson, il finit par s’apprivoiser : c’est un chat, assis', cat.tamed && cat.variant >= 1 && cat.variant <= 3 && cat.sitting === true && cat.fish === 40 - clicks && clicks >= 1, JSON.stringify({ ...cat, clicks }));
    // assis, il reste ; debout, il suit
    await ev(page, () => { const p = window.__game.player; p.inventory.selected = 8; p.teleport(p.x + 9, 4, p.z); });
    await ticks(page, 60);
    const stay = await ev(page, (id) => M.dist(M.get(id), window.__game.player), id);
    await ev(page, (id) => { const m = M.get(id); const p = window.__game.player; p.teleport(m.x + 1.5, 4, m.z); T.aim(m.x, m.y + 0.35, m.z); }, id);
    await ticks(page, 2);
    await rclick(page);
    const stood = await ev(page, (id) => M.get(id).sitting, id);
    await ev(page, () => { const p = window.__game.player; p.teleport(p.x + 9, 4, p.z); });
    await ticks(page, 100);
    const follow = await ev(page, (id) => M.dist(M.get(id), window.__game.player), id);
    check('assis, le chat reste sur place ; un clic droit le relève et il suit son maître', stay > 7 && stood === false && follow < 5, JSON.stringify({ stay, stood, follow }));
    await ev(page, () => { const p = window.__game.player; p.teleport(p.x + 30, 4, p.z + 30); });
    await ticks(page, 20);
    const tp = await ev(page, (id) => M.dist(M.get(id), window.__game.player), id);
    check('trop loin, il réapparaît près de son maître', tp < 6, 'à ' + tp.toFixed(1) + ' blocs');

    // creepers : sans chat il s'approche et s'allume, avec un chat il s'écarte
    await ev(page, (id) => { M.home(); M.heal(); T.look(0, 0); M.get(id).dead = true; }, id);
    await ticks(page, 3);
    const c1 = await ev(page, () => M.spawn('creeper', 0.5, -6.5, { yaw: Math.PI }));
    let lit = false;
    for (let i = 0; i < 30 && !lit; i++) { await ticks(page, 4); lit = await ev(page, (id) => { const m = M.get(id); return !!m && m.fuseTicks > 0; }, c1); }
    await ev(page, (id) => { const m = M.get(id); if (m) m.dead = true; }, c1);
    check('sans chat : le creeper s’approche et allume sa mèche', lit === true);
    await ticks(page, 5);
    const c2 = await ev(page, () => {
      M.heal();
      const cat = M.get(M.spawn('ocelot', 0.5, -1.2));
      cat.tamed = true; cat.owner = 'player'; cat.variant = 2; cat.sitting = true;
      return { creeper: M.spawn('creeper', 0.5, -6.5, { yaw: Math.PI }), cat: cat.id };
    });
    let maxFuse = 0, minDist = 99;
    for (let i = 0; i < 30; i++) {
      await ticks(page, 4);
      const s = await ev(page, (c2) => { const m = M.get(c2.creeper), c = M.get(c2.cat); return m && c ? { f: m.fuseTicks, d: M.dist(m, c) } : null; }, c2);
      if (!s) { maxFuse = 99; break; }
      maxFuse = Math.max(maxFuse, s.f); minDist = Math.min(minDist, s.d);
    }
    const safe = await ev(page, (c2) => ({ alive: !!M.get(c2.creeper), h: window.__game.player.health }), c2);
    check('avec un chat près du joueur : le creeper garde ses distances et n’explose pas', maxFuse === 0 && minDist > 4 && safe.alive && safe.h === 20, JSON.stringify({ maxFuse, minDist, ...safe }));
  });

  await section('laisse', async () => {
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); });
    await chat(page, '/give lead 2');
    const id = await ev(page, () => M.spawn('cow', 0.5, -2.2));
    await ticks(page, 5);
    const zombie = await ev(page, () => M.spawn('villager', 3.5, -2.2));
    const leash = async (target) => {
      await ev(page, (id) => { const m = M.get(id); const p = window.__game.player; p.teleport(m.x, 4, m.z + 2); T.select('lead'); T.aim(m.x, m.y + m.height * 0.5, m.z); }, target);
      await ticks(page, 2);
      await rclick(page);
      await ticks(page, 2);
    };
    await leash(zombie);
    const no = await ev(page, (id) => { const m = M.get(id); const r = { held: !!m.leashHolder, leads: T.count('lead'), modal: window.__game.ui.modal }; return r; }, zombie);
    await page.keyboard.press('Escape');
    await ticks(page, 5);
    await ev(page, (id) => { M.get(id).dead = true; }, zombie);
    check('un villageois ne se met pas en laisse', no.held === false && no.leads === 2, JSON.stringify(no));
    await leash(id);
    const on = await ev(page, (id) => { const m = M.get(id), g = window.__game; return { held: m.leashHolder === g.player, shown: m.leashed, leads: T.count('lead'), rope: !!g.entityRenderer.visuals.get(m.id).leash }; }, id);
    check('clic droit avec une laisse : la vache est attachée, la corde est dessinée', on.held && on.shown && on.leads === 1 && on.rope, JSON.stringify(on));
    await ev(page, () => { window.__game.player.inventory.selected = 8; T.look(0, 0); });
    await page.keyboard.down('KeyW'); await ticks(page, 70); await page.keyboard.up('KeyW');
    await ticks(page, 30);
    const led = await ev(page, (id) => { const m = M.get(id), p = window.__game.player; return { d: M.dist(m, p), z: p.z, held: m.leashHolder === p }; }, id);
    check('la vache suit le joueur qui la promène', led.held && led.d < 6.5 && led.z < -10, JSON.stringify(led));
    // nouer à une barrière
    const post = await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game, p = g.player;
      const x = Math.floor(p.x), z = Math.floor(p.z) - 2;
      g.world.setBlock(x, 4, z, B.OAK_FENCE, 0);
      T.aim(x + 0.5, 4.5, z + 0.5);
      return { x, z };
    });
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 2);
    const tied = await ev(page, (id) => { const m = M.get(id); return { knot: m.leashKnot, held: !!m.leashHolder }; }, id);
    check('clic droit sur une barrière : la laisse y est nouée', tied.knot && tied.knot.x === post.x && tied.knot.z === post.z && !tied.held, JSON.stringify(tied));
    await ev(page, () => { const p = window.__game.player; p.teleport(p.x + 14, 4, p.z); });
    await ticks(page, 200);
    const kept = await ev(page, (id, post) => { const m = M.get(id); return { d: Math.hypot(m.x - post.x - 0.5, m.z - post.z - 0.5), knot: !!m.leashKnot }; }, id, post);
    check('attachée, la vache reste autour de la barrière', kept.knot && kept.d < 6.5, JSON.stringify(kept));
    // détacher : la laisse tombe
    await ev(page, (id) => { const m = M.get(id); const p = window.__game.player; p.teleport(m.x, 4, m.z + 2); p.inventory.selected = 8; T.aim(m.x, m.y + m.height * 0.5, m.z); }, id);
    await ticks(page, 2);
    await rclick(page);
    await ticks(page, 30);
    const freed = await ev(page, (id) => { const m = M.get(id); return { knot: !!m.leashKnot, held: !!m.leashHolder, leads: T.count('lead') + M.items('lead') }; }, id);
    check('clic droit sur la vache : elle est détachée et la laisse est rendue', !freed.knot && !freed.held && freed.leads === 2, JSON.stringify(freed));
    // la laisse casse au-delà de 10 blocs
    await ticks(page, 20);
    await leash(id);
    const again = await ev(page, (id) => M.get(id).leashHolder === window.__game.player, id);
    await ev(page, () => { const p = window.__game.player; p.teleport(p.x - 25, 4, p.z); });
    await ticks(page, 5);
    const broke = await ev(page, (id) => { const m = M.get(id); return { held: !!m.leashHolder, shown: m.leashed }; }, id);
    check('au-delà de 10 blocs, la laisse casse', again === true && broke.held === false && broke.shown === false, JSON.stringify({ again, ...broke }));
  });

  await section('étiquette', async () => {
    await calm(page);
    await ev(page, () => { M.mode('survival'); M.heal(); });
    await chat(page, '/give name_tag 2');
    const id = await ev(page, () => M.spawn('pig', 0.5, -1.8, { frozen: true }));
    await ticks(page, 5);
    await ev(page, (id) => { const m = M.get(id); T.select('name_tag'); T.aim(m.x, m.y + 0.5, m.z); }, id);
    await ticks(page, 2);
    await rclick(page);
    const opened = await page.waitForSelector('[data-mc="name"]', { timeout: 5000 }).then(() => true).catch(() => false);
    check('clic droit avec une étiquette : la saisie du nom s’ouvre', opened);
    await page.keyboard.press('Escape');
    await ticks(page, 5);
    const esc = await ev(page, (id) => ({ name: M.get(id).customName, tags: T.count('name_tag'), modal: window.__game.ui.modal }), id);
    check('Échap abandonne : pas de nom, étiquette gardée', esc.name === '' && esc.tags === 2 && !esc.modal, JSON.stringify(esc));
    await ev(page, (id) => { const m = M.get(id); T.aim(m.x, m.y + 0.5, m.z); }, id);
    await ticks(page, 2);
    await rclick(page);
    await page.waitForSelector('[data-mc="name-line"]', { timeout: 5000 });
    await sleep(150);
    await page.keyboard.type('Babe');
    await page.keyboard.press('Enter');
    await ticks(page, 5);
    const named = await ev(page, (id) => { const m = M.get(id), g = window.__game; const v = g.entityRenderer.visuals.get(m.id); return { name: m.customName, tags: T.count('name_tag'), plate: !!(v && v.namePlate), modal: g.ui.modal }; }, id);
    check('le nom saisi est donné à la créature, affiché au-dessus d’elle, et l’étiquette est consommée', named.name === 'Babe' && named.tags === 1 && named.plate && !named.modal, JSON.stringify(named));
    // un monstre nommé ne disparaît pas
    const far = await ev(page, () => {
      M.mode('creative');
      const g = window.__game;
      let d = 0;
      for (const c of [110, 104, 98]) if (g.world.isLoaded(Math.floor(c), 0)) { d = c; break; }
      if (!d) return null;
      const a = M.get(M.spawn('zombie', d + 0.5, 0.5));
      a.customName = 'Gardien';
      a.fireImmune = true;
      const b = M.get(M.spawn('zombie', d + 0.5, 3.5));
      b.fireImmune = true;
      return { a: a.id, b: b.id, d };
    });
    await ticks(page, 10);
    const kept = await ev(page, (far) => (far ? { named: !!M.get(far.a), plain: !!M.get(far.b), d: far.d } : null), far);
    check('un monstre nommé ne disparaît pas loin du joueur, un autre si', !!kept && kept.named === true && kept.plain === false, JSON.stringify(kept));
  });

  await section('sauvegarde', async () => {
    await calm(page);
    await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      M.mode('creative');
      const horse = M.get(M.spawn('horse', 6.5, -6.5, { frozen: true }));
      horse.tamed = true; horse.saddled = true; horse.variant = 4; horse.speedStat = 0.2222; horse.customName = 'Tornade';
      const cat = M.get(M.spawn('ocelot', -6.5, -6.5));
      cat.tamed = true; cat.owner = 'player'; cat.variant = 3; cat.sitting = true;
      const golem = M.get(M.spawn('iron_golem', -6.5, 6.5, { frozen: true }));
      golem.playerMade = true;
      g.world.setBlock(6, 4, 6, B.OAK_FENCE, 0);
      const cow = M.get(M.spawn('cow', 7.5, 7.5));
      cow.tieTo(6, 4, 6);
      const slime = M.get(M.spawn('slime', 10.5, 0.5, { size: 4, frozen: true }));
      slime.customName = 'Gluant';
      const ender = M.get(M.spawn('enderman', -10.5, 0.5, { frozen: true }));
      ender.customName = 'Voleur'; ender.blockId = B.TNT;
    });
    await ticks(page, 20);
    await reload(page);
    const r = await ev(page, async () => {
      const { B } = await import('/src/world/Ids.ts');
      const one = (k) => T.mobs(k)[0];
      const h = one('horse'), c = one('ocelot'), g = one('iron_golem'), s = T.mobs('slime').find((m) => m.customName === 'Gluant'), e = one('enderman');
      const cow = T.mobs('cow').find((m) => m.leashKnot);
      return {
        horse: h && { tamed: h.tamed, saddled: h.saddled, variant: h.variant, speed: h.speedStat, name: h.customName },
        cat: c && { tamed: c.tamed, variant: c.variant, sitting: c.sitting },
        golem: g && { made: g.playerMade },
        cow: cow && cow.leashKnot,
        slime: s && { size: s.size, health: s.health },
        ender: e && { name: e.customName, tnt: e.blockId === B.TNT },
      };
    });
    check('après rechargement : cheval apprivoisé, sellé, même robe, même vitesse, même nom', r.horse && r.horse.tamed && r.horse.saddled && r.horse.variant === 4 && Math.abs(r.horse.speed - 0.2222) < 1e-4 && r.horse.name === 'Tornade', JSON.stringify(r.horse));
    check('après rechargement : le chat est toujours apprivoisé, assis, du même pelage', r.cat && r.cat.tamed && r.cat.variant === 3 && r.cat.sitting, JSON.stringify(r.cat));
    check('après rechargement : le golem construit reste celui du joueur', r.golem && r.golem.made === true, JSON.stringify(r.golem));
    check('après rechargement : la vache est toujours nouée à sa barrière', r.cow && r.cow.x === 6 && r.cow.y === 4 && r.cow.z === 6, JSON.stringify(r.cow));
    check('après rechargement : le slime nommé garde sa taille, l’enderman son nom et son bloc', r.slime && r.slime.size === 4 && r.slime.health === 16 && r.ender && r.ender.name === 'Voleur' && r.ender.tnt, JSON.stringify({ slime: r.slime, ender: r.ender }));
  });

  // ---------------------------------------------------------------- monde normal : village, mer
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-mc="pause"]', { timeout: 5000 });
  await sleep(200);
  await click(page, 'quit');
  await page.waitForSelector('[data-mc="title"]', { timeout: 30000 });
  await sleep(300);
  await createWorld(page, { name: 'Terre', seed: '1337' });
  await helpers(page);
  await ticks(page, 20);
  const goto = async (x, y, z) => {
    await ev(page, (x, y, z) => { const p = window.__game.player; p.teleport(x, y, z); p.vx = p.vy = p.vz = 0; }, x, y, z);
    await page.waitForFunction(() => { const g = window.__game; return g.chunks.isReady(g.player.x, g.player.z, 3); }, { timeout: 120000 });
    await ev(page, (x, y, z) => { const p = window.__game.player; p.teleport(x, y, z); p.vx = p.vy = p.vz = 0; p.fallDistance = 0; }, x, y, z);
    await ticks(page, 10);
  };

  await section('golem du village', async () => {
    await ev(page, () => { M.mode('creative'); window.__game.player.flying = true; });
    await chat(page, '/time set day');
    const v = await ev(page, () => window.__game.locate('village'));
    await goto(v.x + 0.5, v.y + 12, v.z + 0.5);
    await ticks(page, 40);
    const r = await ev(page, (v) => {
      const list = T.mobs('iron_golem');
      const m = list[0];
      return { n: list.length, d: m ? Math.hypot(m.x - v.x, m.z - v.z) : -1, made: m ? m.playerMade : null, ground: m ? m.onGround : null, y: m ? m.y : 0, villagers: T.mobs('villager').length };
    }, v);
    check('chaque village a son golem de fer, près du puits', r.n === 1 && r.d >= 0 && r.d < 24 && r.made === false && r.ground === true && r.villagers > 3, JSON.stringify(r));
  });

  await section('calamars en mer', async () => {
    const sea = await ev(page, async () => {
      const { isWaterBiome } = await import('/src/world/gen/Biomes.ts');
      const { WorldGen } = await import('/src/world/gen/WorldGen.ts');
      const g = window.__game;
      const gen = new WorldGen(g.world.seed, 'default', g.world.genVersion);
      const p = g.player;
      // la mer la plus proche : une colonne d'eau profonde d'au moins 6 blocs
      for (let r = 64; r <= 2400; r += 48) {
        for (let a = 0; a < 16; a++) {
          const x = Math.floor(p.x + Math.cos((a * Math.PI) / 8) * r), z = Math.floor(p.z + Math.sin((a * Math.PI) / 8) * r);
          if (isWaterBiome(gen.biomeAt(x, z)) && gen.terrainTop(x, z) <= 55) return { x, z };
        }
      }
      return null;
    });
    if (!sea) { check('une mer à moins de 2400 blocs', false); return; }
    await goto(sea.x + 0.5, 80, sea.z + 0.5);
    let squids = [];
    for (let i = 0; i < 60 && squids.length === 0; i++) {
      await ticks(page, 20);
      squids = await ev(page, () => T.mobs('squid').map((m) => ({ w: m.inWater, y: Math.round(m.y), d: Math.round(M.dist(m, window.__game.player)) })));
    }
    check('des calamars apparaissent d’eux-mêmes dans la mer, loin du joueur', squids.length >= 1 && squids.length <= 5 && squids.every((s) => s.y <= 62 && s.y >= 44 && s.d >= 20), JSON.stringify({ sea, squids }));
  });

  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
