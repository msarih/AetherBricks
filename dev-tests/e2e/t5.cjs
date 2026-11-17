// Batterie « lieux à découvrir » sur un monde normal en survie : générateur, donjons, coffres à butin, villages, villageois.
const { sleep, launch, openPage, click, createWorld, shot, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, section } = require('./h.cjs');

const SEED = '1337';

/** Retire les créatures hostiles et les objets au sol, joueur au calme. */
const calm = (page) => ev(page, () => {
  const g = window.__game;
  g.difficulty = 0;
  for (const e of g.entities) if (e !== g.player && e.kind === 'item') e.dead = true;
});

/** Téléporte le joueur et attend que les chunks autour de lui soient affichés. */
async function goto(page, x, y, z) {
  await ev(page, (x, y, z) => { const p = window.__game.player; p.teleport(x, y, z); p.vx = p.vy = p.vz = 0; p.fallDistance = 0; }, x, y, z);
  await page.waitForFunction(() => { const g = window.__game; return g.chunks.isReady(g.player.x, g.player.z, 3); }, { timeout: 120000 });
  await ev(page, (x, y, z) => { const p = window.__game.player; p.teleport(x, y, z); p.vx = p.vy = p.vz = 0; p.fallDistance = 0; }, x, y, z);
  await ticks(page, 5);
}

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
  await createWorld(page, { name: 'Lieux', seed: SEED });
  await install(page);
  await ticks(page, 20);
  await calm(page);

  await section('générateur', async () => {
    const r = await ev(page, async (seed) => {
      const { WorldGen } = await import('/src/world/gen/WorldGen.ts');
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game;
      const v1 = new WorldGen(Number(seed), 'default', 1);
      const v2a = new WorldGen(Number(seed), 'default', 2);
      const v2b = new WorldGen(Number(seed), 'default', 2);
      const flat = new WorldGen(Number(seed), 'flat', 2);
      const village = g.locate('village');
      const vcx = village.x >> 4, vcz = village.z >> 4;
      const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      let deterministic = true, v1Places = 0, v2Places = 0, v2Entities = 0, v1Entities = 0, flatEntities = 0;
      const placed = (c) => c.blocks.reduce((n, id) => n + (id === B.GRASS_PATH || id === B.SPAWNER || id === B.CHEST || id === B.OAK_DOOR ? 1 : 0), 0);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const a = v2a.generateChunk(vcx + dx, vcz + dz);
        // l'autre générateur parcourt les chunks dans l'ordre inverse : le résultat ne doit pas en dépendre
        const b = v2b.generateChunk(vcx - dx, vcz - dz);
        const b2 = v2b.generateChunk(vcx + dx, vcz + dz);
        void b;
        if (!same(a.blocks, b2.blocks) || !same(a.meta, b2.meta) || JSON.stringify(a.blockEntities) !== JSON.stringify(b2.blockEntities) || JSON.stringify(a.spawns) !== JSON.stringify(b2.spawns)) deterministic = false;
        v2Places += placed(a);
        v2Entities += a.blockEntities.length + a.spawns.length;
        const old = v1.generateChunk(vcx + dx, vcz + dz);
        v1Places += placed(old);
        v1Entities += old.blockEntities.length + old.spawns.length;
        const f = flat.generateChunk(vcx + dx, vcz + dz);
        flatEntities += f.blockEntities.length + f.spawns.length + placed(f);
      }
      // hauteur du sol calculée sans générer le chunk : elle doit être celle du terrain réel
      let cols = 0, exact = 0;
      const soft = (id) => id === 0 || id === B.WATER || id === B.ICE || (id >= B.OAK_LOG && id <= B.ACACIA_LOG) || (id >= B.OAK_LEAVES && id <= B.ACACIA_LEAVES) || (id >= B.TALL_GRASS && id <= B.PUMPKIN) || id === B.SNOW_LAYER || id === B.VINE || id === B.LILY_PAD || id === B.MELON;
      for (let cz = -2; cz < 2; cz++) for (let cx = -2; cx < 2; cx++) {
        const c = v1.generateChunk(cx, cz);
        for (let lz = 0; lz < 16; lz += 3) for (let lx = 0; lx < 16; lx += 3) {
          let y = 127;
          while (y > 0 && soft(c.blocks[(y << 8) | (lz << 4) | lx])) y--;
          cols++;
          if (y === v2a.terrainTop(cx * 16 + lx, cz * 16 + lz)) exact++;
        }
      }
      // anciens mondes : le générateur en version 1 rend exactement les chunks d'avant (copie de référence)
      const ref = await import('/dev-tests/ref/WorldGenV1.ts');
      const refNether = await import('/dev-tests/ref/NetherGenV1.ts');
      const { NetherGen } = await import('/src/world/gen/NetherGen.ts');
      const oldGen = new ref.WorldGen(Number(seed), 'default');
      const oldNether = new refNether.NetherGen(Number(seed));
      const newNether = new NetherGen(Number(seed), 1);
      const oldFlat = new ref.WorldGen(Number(seed), 'flat');
      const newFlat = new WorldGen(Number(seed), 'flat', 2);
      let compared = 0, different = 0;
      const eq = (a, b) => same(a.blocks, b.blocks) && same(a.meta, b.meta) && same(a.biomes, b.biomes) && same(a.heightmap, b.heightmap) && same(a.tints, b.tints);
      const spots = [[vcx, vcz], [0, 0], [40, -75], [-60, 11], [75, 66], [3, 52], [-20, -20], [120, 5]];
      for (const [bx, bz] of spots) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
        compared++;
        if (!eq(oldGen.generateChunk(bx + dx, bz + dz), v1.generateChunk(bx + dx, bz + dz))) different++;
        compared++;
        if (!eq(oldNether.generateChunk(bx + dx, bz + dz), newNether.generateChunk(bx + dx, bz + dz))) different++;
      }
      compared++;
      if (!eq(oldFlat.generateChunk(1, 1), newFlat.generateChunk(1, 1))) different++;
      const spawnSame = JSON.stringify(oldGen.findSpawn()) === JSON.stringify(v1.findSpawn());
      return { version: g.world.genVersion, deterministic, v1Places, v1Entities, v2Places, v2Entities, flatEntities, cols, exact, compared, different, spawnSame };
    }, SEED);
    check('un nouveau monde porte la version 2 du générateur', r.version === 2, 'version ' + r.version);
    check('le même chunk est généré à l’identique, quel que soit l’ordre', r.deterministic === true);
    check('générateur en version 1 (anciens mondes) : aucun lieu, aucun coffre, aucun habitant', r.v1Places === 0 && r.v1Entities === 0, JSON.stringify({ blocs: r.v1Places, entites: r.v1Entities }));
    check('générateur en version 2 : le village est bien là (chemins, portes, coffres, habitants)', r.v2Places > 50 && r.v2Entities > 5, JSON.stringify({ blocs: r.v2Places, entites: r.v2Entities }));
    check('monde plat : aucun lieu généré', r.flatEntities === 0, String(r.flatEntities));
    check('hauteur du sol calculée = terrain réel (au moins 98 % des colonnes)', r.exact / r.cols >= 0.98, `${r.exact}/${r.cols}`);
    check('anciens mondes : terrain identique à l’octet près (Overworld, Nether, monde plat, point d’apparition)', r.different === 0 && r.compared >= 60 && r.spawnSame, `${r.different} chunks différents sur ${r.compared}`);
  });

  await section('donjon', async () => {
    // cherche le donjon le plus proche en rejouant le générateur, puis s'y rend
    const d = await ev(page, async (seed) => {
      const { WorldGen } = await import('/src/world/gen/WorldGen.ts');
      const gen = new WorldGen(Number(seed), 'default', 2);
      for (let r = 0; r <= 14; r++) {
        for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue;
          const c = gen.generateChunk(cx, cz);
          const s = c.blockEntities.find((b) => b.type === 'spawner');
          if (s) return { spawner: s, chests: c.blockEntities.filter((b) => b.type === 'chest') };
        }
      }
      return null;
    }, SEED);
    check('un donjon existe à moins de 14 chunks de l’origine', !!d, d ? JSON.stringify(d.spawner) : '');
    if (!d) return;
    const s = d.spawner;
    await goto(page, s.x + 1.5, s.y, s.z + 0.5);
    const room = await ev(page, async (s) => {
      const { B } = await import('/src/world/Ids.ts');
      const g = window.__game, w = g.world;
      const be = w.getBlockEntity(s.x, s.y, s.z);
      let floor = 0, mossy = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const id = w.getBlock(s.x + dx, s.y - 1, s.z + dz);
        if (id === B.COBBLESTONE || id === B.MOSSY_COBBLESTONE) floor++;
        if (id === B.MOSSY_COBBLESTONE) mossy++;
      }
      const chunk = w.chunkAt(s.x, s.z);
      return { block: w.getBlock(s.x, s.y, s.z) === B.SPAWNER, be: be ? { type: be.type, mob: be.mob } : null, floor, mossy, modified: chunk.modified };
    }, s);
    check('la cage est au centre d’une salle au sol de pierres', room.block && room.floor === 9, JSON.stringify(room));
    check('le générateur de monstres connaît son espèce', room.be && room.be.type === 'spawner' && ['zombie', 'skeleton', 'spider'].includes(room.be.mob), JSON.stringify(room.be));
    check('le chunk du donjon reste « non modifié » tant qu’on n’y touche pas', room.modified === false);

    // paisible : rien n'apparaît ; normal dans le noir : des monstres de l'espèce de la cage apparaissent
    await ticks(page, 45);
    const quiet = await ev(page, (kind) => T.mobs(kind).length, room.be.mob);
    check('en paisible, la cage ne produit rien', quiet === 0, String(quiet));
    await ev(page, () => { const g = window.__game; g.difficulty = 2; g.player.gameMode = 'creative'; });
    let born = 0;
    for (let i = 0; i < 12 && born === 0; i++) {
      await ticks(page, 10);
      born = await ev(page, (s, kind) => T.mobs(kind).filter((e) => Math.abs(e.x - s.x) < 6 && Math.abs(e.z - s.z) < 6 && Math.abs(e.y - s.y) < 4).length, s, room.be.mob);
    }
    check('en difficulté normale, la cage fait apparaître ses monstres dans la salle', born >= 1 && born <= 6, `${born} ${room.be.mob}`);
    await ev(page, () => { const g = window.__game; g.difficulty = 0; g.player.gameMode = 'survival'; for (const e of g.entities) if (e.kind === 'mob' && e.mobKind !== 'villager' && e !== g.player) e.dead = true; });
    await ticks(page, 3);

    if (d.chests.length > 0) {
      const c = d.chests[0];
      const r = await ev(page, async (c) => {
        const { getChest } = await import('/src/game/BlockEntities.ts');
        const { generateLoot } = await import('/src/world/Loot.ts');
        const g = window.__game, w = g.world;
        const before = w.getBlockEntity(c.x, c.y, c.z);
        const loot = before ? before.loot : null;
        const chest = getChest(w, c.x, c.y, c.z);
        const items = chest.items.filter(Boolean);
        const again = generateLoot('dungeon', w.seed, c.x, c.y, c.z, 27).filter(Boolean);
        return { loot, after: chest.loot, n: items.length, same: JSON.stringify(items) === JSON.stringify(again), modified: w.chunkAt(c.x, c.z).modified };
      }, c);
      check('coffre du donjon : butin tiré à la première ouverture', r.loot === 'dungeon' && r.after === undefined && r.n >= 4, JSON.stringify(r));
      check('le butin dépend de la graine et de la position (même tirage rejoué)', r.same === true);
      check('ouvrir le coffre marque le chunk à sauvegarder', r.modified === true);
    } else {
      check('coffre du donjon (aucun coffre dans ce donjon)', true);
    }
  });

  let village = null;
  await section('village', async () => {
    await chat(page, '/time set day');
    await ev(page, () => { window.__msgs.length = 0; });
    await chat(page, '/locate village');
    const msg = await ev(page, () => window.__msgs.join(' | '));
    village = await ev(page, () => window.__game.locate('village'));
    check('/locate village indique le village le plus proche', !!village && msg.includes('Village') && msg.includes(`x ${village.x}`), msg);
    if (!village) return;
    await goto(page, village.x + 0.5, village.y + 8, village.z + 0.5);
    await ticks(page, 20);
    const r = await ev(page, async (v) => {
      const { B } = await import('/src/world/Ids.ts');
      const w = window.__game.world;
      let water = 0, path = 0, doors = 0, crops = 0, torches = 0;
      for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) if (w.getBlock(v.x + dx, v.y, v.z + dz) === B.WATER) water++;
      for (let z = v.z - 48; z <= v.z + 48; z++) for (let x = v.x - 48; x <= v.x + 48; x++) {
        for (let y = v.y - 10; y <= v.y + 14; y++) {
          const id = w.getBlock(x, y, z);
          if (id === B.GRASS_PATH || id === B.GRAVEL) path += id === B.GRASS_PATH || w.getBlock(x, y + 1, z) === B.AIR ? 1 : 0;
          else if (id === B.OAK_DOOR) doors++;
          else if (id === B.WHEAT || id === B.CARROTS || id === B.POTATOES) crops++;
          else if (id === B.TORCH) torches++;
        }
      }
      const smith = [...w.blockEntities.values()].filter((b) => b.type === 'chest' && b.loot === 'blacksmith').length;
      return { water, path, doors: doors / 2, crops, torches, smith, villagers: T.mobs('villager').length };
    }, village);
    check('le puits est au centre du village (2 × 2 d’eau)', r.water === 4, JSON.stringify(r));
    check('des chemins partent du puits', r.path >= 80, String(r.path));
    check('des maisons avec leur porte (au moins 4)', r.doors >= 4, String(r.doors));
    check('des champs cultivés et des torches', r.crops >= 14 && r.torches >= 4, JSON.stringify({ cultures: r.crops, torches: r.torches }));
    check('les villageois habitent le village (entre 5 et 20)', r.villagers >= 5 && r.villagers <= 20, String(r.villagers));
    await shot(page, 't5-village');
  });

  await section('villageois', async () => {
    if (!village) throw new Error('pas de village');
    // on choisit un villageois, on se place devant lui avec de quoi payer la première offre
    const who = await ev(page, async () => {
      const { makeStack } = await import('/src/world/ItemStack.ts');
      const { I } = await import('/src/world/Ids.ts');
      const g = window.__game, p = g.player;
      const v = T.mobs('villager')[0];
      window.__v = v;
      const o = v.offers[0];
      p.inventory.clear();
      p.inventory.slots[0] = makeStack(o.buy, o.buyCount * 2);
      if (o.buy2) p.inventory.slots[1] = makeStack(o.buy2, o.buy2Count * 2);
      p.inventory.selected = 8;
      p.teleport(v.x, v.y, v.z + 1.8);
      T.aim(v.x, v.y + 1.4, v.z);
      return { profession: v.profession, title: v.title, tier: v.tier, offers: v.offers.length, offer: o, emeralds: I.EMERALD };
    });
    check('un villageois a un métier et des offres de premier palier', who.tier === 1 && who.offers >= 1 && typeof who.title === 'string', JSON.stringify({ metier: who.title, offres: who.offers }));
    await ticks(page, 1);
    await ev(page, () => { const v = window.__v; T.aim(v.x, v.y + 1.4, v.z); window.__game.input.presses[2]++; });
    await ticks(page, 3);
    await page.waitForSelector('[data-mc="trade"]', { timeout: 5000 }).catch(() => {});
    const open = await page.$('[data-mc="trade"]');
    check('clic droit sur un villageois : l’écran d’échange s’ouvre', !!open);
    if (!open) return;
    const title = await page.$eval('[data-mc="trade-title"]', (e) => e.textContent);
    check('l’écran porte le métier du villageois', title === who.title, title);
    await shot(page, 't5-echange');
    const before = await ev(page, (o) => ({ buy: window.__game.player.inventory.count(o.buy), sell: window.__game.player.inventory.count(o.sell) }), who.offer);
    await page.click('[data-mc="trade-offer-0"]');
    await sleep(150);
    const after = await ev(page, (o) => ({ buy: window.__game.player.inventory.count(o.buy), sell: window.__game.player.inventory.count(o.sell), uses: window.__v.offers[0].uses, traded: window.__v.traded, stat: window.__game.stats.trades || 0 }), who.offer);
    check('un échange : le prix est retiré, l’objet reçu', before.buy - after.buy === who.offer.buyCount && after.sell - before.sell === who.offer.sellCount, JSON.stringify({ before, after }));
    check('l’échange est compté (offre et statistiques)', after.uses === 1 && after.traded === true && after.stat === 1, JSON.stringify(after));
    // offre trop chère : bouton inactif, rien ne bouge
    await ev(page, () => { window.__game.player.inventory.clear(); });
    await sleep(120);
    const disabled = await page.$eval('[data-mc="trade-offer-0"]', (e) => e.disabled);
    check('sans de quoi payer, l’offre est inactive', disabled === true);
    // premier échange : réapprovisionnement et palier suivant
    await ticks(page, 50);
    const stocked = await ev(page, () => ({ tier: window.__v.tier, offers: window.__v.offers.length, uses: window.__v.offers[0].uses }));
    const rows = await page.$$eval('[data-mc^="trade-offer-"]', (els) => els.length);
    check('le premier échange débloque le palier suivant et réapprovisionne', stocked.tier === 2 && stocked.offers > who.offers && stocked.uses === 0 && rows === stocked.offers, JSON.stringify({ stocked, rows }));
    await page.keyboard.press('Escape');
    await sleep(250);
    const closed = await ev(page, () => ({ modal: window.__game.ui.modal, customer: window.__v.customer === null }));
    check('Échap ferme l’écran et libère le villageois', closed.modal === false && closed.customer === true, JSON.stringify(closed));

    // le villageois avec qui on a commercé survit au rechargement, avec ses paliers
    const mark = await ev(page, () => { const v = window.__v; return { x: v.x, z: v.z, profession: v.profession, tier: v.tier, offers: JSON.stringify(v.offers) }; });
    await reload(page);
    await page.waitForFunction(() => window.__game.chunks.isReady(window.__game.player.x, window.__game.player.z, 3), { timeout: 120000 });
    await ticks(page, 10);
    const back = await ev(page, (m) => {
      const list = T.mobs('villager');
      const v = list.find((e) => e.traded);
      return { count: list.length, found: !!v, tier: v ? v.tier : 0, same: v ? JSON.stringify(v.offers) === m.offers && v.profession === m.profession : false };
    }, mark);
    check('après rechargement : le villageois garde son palier et ses offres', back.found && back.tier === 2 && back.same, JSON.stringify(back));
    check('après rechargement : pas de villageois en double', back.count >= 5 && back.count <= 20, String(back.count));
  });

  await section('nuit au village', async () => {
    if (!village) throw new Error('pas de village');
    await calm(page);
    await goto(page, village.x + 0.5, village.y + 8, village.z + 0.5);
    await chat(page, '/time set day');
    // de jour ils sortent : on leur laisse le temps de s'éloigner, puis on fait tomber la nuit
    await ticks(page, 400);
    const day = await ev(page, () => T.mobs('villager').map((v) => Math.hypot(v.x - v.homeX, v.z - v.homeZ)));
    await chat(page, '/time set night');
    await ticks(page, 500);
    const night = await ev(page, () => T.mobs('villager').map((v) => Math.hypot(v.x - v.homeX, v.z - v.homeZ)));
    const far = (l) => l.filter((d) => d > 4).length;
    const mean = (l) => l.reduce((a, b) => a + b, 0) / Math.max(1, l.length);
    check('de jour, des villageois s’éloignent de chez eux', far(day) >= 2, `${far(day)} sur ${day.length} à plus de 4 blocs`);
    check('la nuit, ils rentrent (presque tous à moins de 4 blocs de chez eux)', far(night) <= Math.max(1, Math.floor(night.length * 0.2)) && mean(night) < mean(day), `jour ${mean(day).toFixed(1)} → nuit ${mean(night).toFixed(1)} ; ${far(night)} encore loin`);
    await chat(page, '/time set day');
  });

  await section('badlands', async () => {
    const r = await ev(page, async (seed) => {
      const { WorldGen } = await import('/src/world/gen/WorldGen.ts');
      const { BIOME } = await import('/src/world/gen/Biomes.ts');
      const { B, I } = await import('/src/world/Ids.ts');
      const R = await import('/src/world/Recipes.ts');
      const gen = new WorldGen(Number(seed), 'default', 2);
      const old = new WorldGen(Number(seed), 'default', 1);
      // cherche la colonne de badlands la plus proche de l'origine
      let best = null;
      for (let z = -3000; z <= 3000; z += 60) for (let x = -3000; x <= 3000; x += 60) {
        if (gen.biomeAt(x, z) !== BIOME.BADLANDS) continue;
        const d = Math.hypot(x, z);
        if (!best || d < best.d) best = { x, z, d };
      }
      if (!best) return { found: false };
      const count = (c) => { const kinds = new Set(); let n = 0, sand = 0; for (const id of c.blocks) { if (id >= B.TERRACOTTA && id <= B.TERRACOTTA_BLACK) { n++; kinds.add(id); } else if (id === B.RED_SAND) sand++; } return { n, kinds: kinds.size, sand }; };
      let total = { n: 0, kinds: 0, sand: 0 }, oldTotal = 0, biomeCols = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const c = gen.generateChunk((best.x >> 4) + dx, (best.z >> 4) + dz);
        const k = count(c);
        total = { n: total.n + k.n, kinds: Math.max(total.kinds, k.kinds), sand: total.sand + k.sand };
        biomeCols += c.biomes.reduce((a, b) => a + (b === BIOME.BADLANDS ? 1 : 0), 0);
        const o = count(old.generateChunk((best.x >> 4) + dx, (best.z >> 4) + dz));
        oldTotal += o.n + o.sand;
      }
      const m = (grid, id) => { const x = R.matchRecipe(grid, 3); return x && x.id === id ? x.count : 0; };
      const T8 = B.TERRACOTTA;
      return {
        found: true, at: best, ...total, biomeCols, oldTotal,
        stained: m([T8, T8, T8, T8, I.DYE_RED, T8, T8, T8, T8], B.TERRACOTTA_RED),
        smelt: R.smeltingResult(B.CLAY),
      };
    }, SEED);
    check('un biome de badlands existe dans ce monde', r.found === true, r.found ? `x ${r.at.x}, z ${r.at.z}` : '');
    if (!r.found) return;
    check('badlands : strates de terre cuite (au moins 4 couleurs) et sable rouge', r.n > 2000 && r.kinds >= 4 && r.sand > 0 && r.biomeCols > 100, JSON.stringify({ terreCuite: r.n, couleurs: r.kinds, sableRouge: r.sand, colonnes: r.biomeCols }));
    check('anciens mondes : ni terre cuite ni sable rouge au même endroit', r.oldTotal === 0, String(r.oldTotal));
    check('recettes : argile cuite → terre cuite ; 8 terres cuites + teinture → 8 colorées', r.stained === 8 && r.smelt && r.smelt.id === 167, JSON.stringify({ stained: r.stained, smelt: r.smelt }));
  });

  await section('pyramide du désert', async () => {
    const t = await ev(page, () => window.__game.locate('desert_temple'));
    check('/locate trouve une pyramide du désert', !!t, t ? `x ${t.x}, z ${t.z}` : '');
    if (!t) return;
    await ev(page, () => { const g = window.__game; g.difficulty = 0; g.player.gameMode = 'creative'; g.player.flying = true; });
    await goto(page, t.x + 0.5, t.y + 14, t.z + 0.5);
    const r = await ev(page, async (t) => {
      const { B } = await import('/src/world/Ids.ts');
      const w = window.__game.world;
      const chests = [...w.blockEntities.values()].filter((b) => b.type === 'chest' && b.loot === 'desert_temple');
      // sommet : 3 × 3 de grès et les créneaux des deux tours, à 9 blocs au-dessus du sol, à cheval sur plusieurs chunks
      let top = 0;
      for (let z = t.z - 10; z <= t.z + 10; z++) for (let x = t.x - 10; x <= t.x + 10; x++) if (w.getBlock(x, t.y + 9, z) === B.SANDSTONE) top++;
      const plate = { x: t.x, y: t.y - 11, z: t.z };
      return {
        chests: chests.length, top,
        blue: w.getBlock(t.x, t.y, t.z) === B.TERRACOTTA_BLUE,
        plate: w.getBlock(plate.x, plate.y, plate.z) === B.STONE_PRESSURE_PLATE,
        tnt: w.getBlock(plate.x, plate.y - 1, plate.z) === B.TNT,
        tntBelow: [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => w.getBlock(plate.x + dx, plate.y - 2, plate.z + dz))).filter((id) => id === B.TNT).length,
        chunks: new Set([[-10, -10], [10, -10], [-10, 10], [10, 10]].map(([dx, dz]) => `${(t.x + dx) >> 4},${(t.z + dz) >> 4}`)).size,
        plate3: plate,
      };
    }, t);
    check('pyramide entière malgré les frontières de chunks (sommet et créneaux : 25 blocs de grès)', r.top === 25 && r.chunks >= 2, JSON.stringify({ sommet: r.top, chunks: r.chunks }));
    check('bloc bleu au centre du sol, 4 coffres dans la salle du trésor', r.blue && r.chests === 4, JSON.stringify({ bleu: r.blue, coffres: r.chests }));
    check('le piège est armé : plaque de pression sur une TNT, 9 TNT sous le sol', r.plate && r.tnt && r.tntBelow === 9, JSON.stringify({ plaque: r.plate, tnt: r.tnt, dessous: r.tntBelow }));
    // tant que personne ne marche sur la plaque, rien ne se passe ; dès qu'on y marche, tout saute
    await ticks(page, 40);
    const still = await ev(page, async (p) => { const { B } = await import('/src/world/Ids.ts'); return window.__game.world.getBlock(p.x, p.y - 1, p.z) === B.TNT; }, r.plate3);
    check('le piège ne part pas tout seul', still === true);
    await ev(page, (p) => { const pl = window.__game.player; pl.flying = false; pl.teleport(p.x + 0.5, p.y + 0.1, p.z + 0.5); pl.vx = pl.vy = pl.vz = 0; }, r.plate3);
    await ticks(page, 130);
    const after = await ev(page, async (p) => {
      const { B } = await import('/src/world/Ids.ts');
      const w = window.__game.world;
      let tnt = 0, air = 0;
      for (let dy = -2; dy <= 0; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const id = w.getBlock(p.x + dx, p.y + dy, p.z + dz);
        if (id === B.TNT) tnt++;
        if (id === B.AIR) air++;
      }
      const chests = [...w.blockEntities.values()].filter((b) => b.type === 'chest' && Math.abs(b.x - p.x) <= 3 && Math.abs(b.z - p.z) <= 3).length;
      return { tnt, air, chests, alive: window.__game.player.alive };
    }, r.plate3);
    check('marcher sur la plaque fait sauter la salle du trésor', after.tnt === 0 && after.air >= 40 && after.chests === 0, JSON.stringify(after));
    await ev(page, () => { for (const e of window.__game.entities) if (e.kind === 'item') e.dead = true; });
  });

  await section('temple de la jungle', async () => {
    const t = await ev(page, () => window.__game.locate('jungle_temple'));
    check('/locate jungle trouve un temple de la jungle', !!t, t ? `x ${t.x}, z ${t.z}` : '');
    if (!t) return;
    await ev(page, () => { const g = window.__game; g.difficulty = 0; g.player.gameMode = 'creative'; g.player.flying = true; });
    await goto(page, t.x + 0.5, t.y + 6, t.z + 0.5);
    const r = await ev(page, async (t) => {
      const { B } = await import('/src/world/Ids.ts');
      const { FACING_DX, FACING_DZ } = await import('/src/world/Blocks.ts');
      const w = window.__game.world;
      const chests = [...w.blockEntities.values()].filter((b) => b.type === 'chest' && b.loot === 'jungle_temple');
      let lever = null, piston = null, head = null, mossy = 0;
      for (let y = t.y - 6; y <= t.y + 11; y++) for (let z = t.z - 10; z <= t.z + 10; z++) for (let x = t.x - 10; x <= t.x + 10; x++) {
        const id = w.getBlock(x, y, z);
        if (id === B.LEVER) lever = { x, y, z, meta: w.getMeta(x, y, z) };
        else if (id === B.STICKY_PISTON) piston = { x, y, z, meta: w.getMeta(x, y, z) };
        else if (id === B.PISTON_HEAD) head = { x, y, z };
        else if (id === B.MOSSY_COBBLESTONE) mossy++;
      }
      if (!lever) return { chests: chests.length, mossy, lever: null };
      const f = (lever.meta & 7) - 1;
      // le levier est une petite pièce plaquée contre son support : on vise le pied du levier, pas le milieu de la case
      const aim = { x: lever.x + 0.5 - FACING_DX[f] * 0.42, y: lever.y + 0.5, z: lever.z + 0.5 - FACING_DZ[f] * 0.42 };
      return { chests: chests.length, mossy, lever, piston, head, aim, stand: { x: lever.x + FACING_DX[f] * 1.4 + 0.5, y: lever.y, z: lever.z + FACING_DZ[f] * 1.4 + 0.5 } };
    }, t);
    check('temple de pierres moussues, deux coffres au sous-sol', r.mossy > 300 && r.chests === 2, JSON.stringify({ moussues: r.mossy, coffres: r.chests }));
    check('mécanisme en place : levier abaissé, piston collant sorti', !!r.lever && (r.lever.meta & 8) !== 0 && !!r.piston && (r.piston.meta & 8) !== 0 && !!r.head, JSON.stringify({ levier: r.lever, piston: r.piston }));
    if (!r.lever || !r.piston || !r.head) return;
    // le bloc-porte est juste devant la tête du piston ; le coffre caché, derrière lui
    const door = { x: r.head.x * 2 - r.piston.x, y: r.head.y, z: r.head.z * 2 - r.piston.z };
    const before = await ev(page, (d) => window.__game.world.getBlock(d.x, d.y, d.z), door);
    await ev(page, (s, a) => { const p = window.__game.player; p.flying = true; p.teleport(s.x, s.y, s.z); p.vx = p.vy = p.vz = 0; T.aim(a.x, a.y, a.z); }, r.stand, r.aim);
    await ticks(page, 3);
    const aimed = await ev(page, (a) => { T.aim(a.x, a.y, a.z); return T.hit(); }, r.aim);
    await ticks(page, 2);
    const seen = await ev(page, () => T.hit());
    void aimed;
    if (!seen || seen.x !== r.lever.x || seen.y !== r.lever.y || seen.z !== r.lever.z) throw new Error('le levier n’est pas sous le viseur : ' + JSON.stringify(seen));
    await ev(page, () => { window.__game.input.presses[2]++; });
    await ticks(page, 10);
    const after = await ev(page, async (r, door) => {
      const { B } = await import('/src/world/Ids.ts');
      const w = window.__game.world;
      return {
        lever: w.getMeta(r.lever.x, r.lever.y, r.lever.z) & 8,
        piston: w.getMeta(r.piston.x, r.piston.y, r.piston.z) & 8,
        head: w.getBlock(r.head.x, r.head.y, r.head.z),
        door: w.getBlock(door.x, door.y, door.z),
        mossy: B.MOSSY_COBBLESTONE,
      };
    }, r, door);
    check('relever le levier fait reculer le piston : le bloc s’efface devant le coffre caché',
      before === after.mossy && after.lever === 0 && after.piston === 0 && after.head === after.mossy && after.door === 0, JSON.stringify({ before, after }));
  });

  await section('mine abandonnée', async () => {
    const m = await ev(page, () => window.__game.locate('mineshaft'));
    check('/locate mine trouve une mine abandonnée', !!m, m ? `x ${m.x}, y ${m.y}, z ${m.z}` : '');
    if (!m) return;
    const r = await ev(page, async (seed, m) => {
      const { WorldGen } = await import('/src/world/gen/WorldGen.ts');
      const { B } = await import('/src/world/Ids.ts');
      const gen = new WorldGen(Number(seed), 'default', 2);
      const count = { rail: 0, fence: 0, planks: 0, web: 0, chest: 0, spawner: 0, torch: 0 };
      for (let cz = (m.z - 80) >> 4; cz <= (m.z + 80) >> 4; cz++) for (let cx = (m.x - 80) >> 4; cx <= (m.x + 80) >> 4; cx++) {
        const c = gen.generateChunk(cx, cz);
        for (let y = 10; y < 52; y++) for (let i = 0; i < 256; i++) {
          const id = c.blocks[(y << 8) | i];
          if (id === B.RAIL) count.rail++; else if (id === B.OAK_FENCE) count.fence++; else if (id === B.OAK_PLANKS) count.planks++; else if (id === B.COBWEB) count.web++; else if (id === B.TORCH) count.torch++;
        }
        for (const be of c.blockEntities) { if (be.type === 'chest' && be.loot === 'mineshaft') count.chest++; if (be.type === 'spawner' && be.mob === 'spider') count.spawner++; }
      }
      return count;
    }, SEED, m);
    check('galeries étayées, rails, toiles et torches', r.fence >= 60 && r.planks >= 90 && r.rail >= 60 && r.web >= 5, JSON.stringify(r));
    check('la mine cache au moins un coffre ou une cage à araignées', r.chest + r.spawner >= 1, JSON.stringify({ coffres: r.chest, cages: r.spawner }));
    await ev(page, () => { const g = window.__game; g.player.gameMode = 'creative'; g.player.flying = true; });
    await goto(page, m.x + 0.5, m.y + 0.2, m.z + 0.5);
    const room = await ev(page, async (m) => {
      const { B } = await import('/src/world/Ids.ts');
      const w = window.__game.world;
      let air = 0;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) for (let dy = 0; dy <= 3; dy++) if (w.getBlock(m.x + dx, m.y + dy, m.z + dz) === B.AIR) air++;
      return { air, floor: w.getBlock(m.x, m.y - 1, m.z) === B.DIRT, exit: w.getBlock(m.x + 6, m.y, m.z) !== B.STONE || w.getBlock(m.x - 6, m.y, m.z) !== B.STONE || w.getBlock(m.x, m.y, m.z + 6) !== B.STONE || w.getBlock(m.x, m.y, m.z - 6) !== B.STONE };
    }, m);
    check('salle de départ creusée sous terre (9 × 9, sol de terre) avec au moins une galerie', room.air === 324 && room.floor && room.exit, JSON.stringify(room));
    await shot(page, 't5-mine');
  });

  await section('export et import', async () => {
    const r = await ev(page, async () => {
      const WF = await import('/src/world/WorldFile.ts');
      const g = window.__game;
      await g.save();
      // ce monde (version 2) : la copie importée garde son générateur
      const copy = await WF.importWorld(g.storage, await (await WF.exportWorld(g.storage, g.info.id)).arrayBuffer());
      // un monde d'avant (pas de version notée) : la copie reste sans version, donc sans lieux
      const oldId = 'w-test-ancien';
      const { genVersion, ...rest } = g.info;
      void genVersion;
      await g.storage.putWorld({ ...rest, id: oldId, name: 'Ancien', thumbnail: undefined });
      const oldCopy = await WF.importWorld(g.storage, await (await WF.exportWorld(g.storage, oldId)).arrayBuffer());
      for (const id of [copy.id, oldId, oldCopy.id]) await g.storage.deleteWorld(id);
      return { copy: copy.genVersion, old: oldCopy.genVersion === undefined, distinct: copy.id !== g.info.id };
    });
    check('un monde exporté puis importé garde son générateur (2), un ancien monde reste sans lieux', r.copy === 2 && r.old === true && r.distinct, JSON.stringify(r));
  });

  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
