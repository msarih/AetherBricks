// Batterie « l'End » : perle et œil de l'Ender, fort souterrain et son portail, l'île de l'End,
// les cristaux, le dragon, le portail de sortie et le retour. Monde normal (graine 1337).
const { sleep, launch, openPage, click, createWorld, ticks } = require('./lib.cjs');
const { results, check, install, ev, chat, rclick, lclick, section } = require('./h.cjs');

/** Les douze cadres d'un anneau, autour de la cellule centrale. */
const RING = [[-1, -2], [0, -2], [1, -2], [-1, 2], [0, 2], [1, 2], [-2, -1], [-2, 0], [-2, 1], [2, -1], [2, 0], [2, 1]];
const DX = [0, -1, 0, 1];
const DZ = [1, 0, -1, 0];

async function helpers(page) {
  await install(page);
  await ev(page, async () => {
    const { B, I } = await import('/src/world/Ids.ts');
    const g = window.__game;
    window.B = B;
    window.I = I;
    window.M = {
      get: (id) => g.entities.find((e) => e.id === id) || null,
      named: (name) => g.entities.filter((e) => e.constructor.name === name && !e.dead),
      items: (name) => g.entities.filter((e) => e.kind === 'item' && !e.dead && e.constructor.name === 'ItemEntity' && e.itemId === T.id(name)).reduce((n, e) => n + e.itemCount, 0),
      mode: (m) => { g.player.gameMode = m; if (m === 'survival') g.player.flying = false; },
      fly: () => { const p = g.player; p.gameMode = 'creative'; p.flying = true; p.onGround = false; p.vx = p.vy = p.vz = 0; },
      heal: () => { const p = g.player; p.health = 20; p.hunger = 20; p.invulnerable = 0; p.clearEffects(); p.fireTicks = 0; p.fallDistance = 0; },
      kill: (kind) => { for (const e of g.entities) if (e.kind === 'mob' && e.mobKind === kind) e.dead = true; },
      dragon: () => g.endFight.dragon,
      crystals: () => g.entities.filter((e) => e.mobKind === 'end_crystal' && !e.dead),
      /** Immobilise le dragon : il ne vole plus, ne décide plus rien, ne frappe ni ne casse. */
      freeze: (x, y, z) => {
        const d = g.endFight.dragon;
        d.fly = () => {};
        d.chooseNext = () => {};
        d.strike = () => {};
        d.smash = () => {};
        d.phase = 'round';
        d.setPosition(x, y, z);
        return d;
      },
      thaw: () => { const d = g.endFight.dragon; delete d.fly; delete d.chooseNext; delete d.strike; delete d.smash; return d; },
    };
  });
}

const settled = (page) => page.waitForFunction(() => { const g = window.__game; return !g.dimensionSwitching && g.areaLoaded(); }, { timeout: 120000 });

async function goto(page, x, y, z, fly = true) {
  await ev(page, (x, y, z, fly) => { const p = window.__game.player; if (fly) M.fly(); p.teleport(x, y, z); p.onGround = false; }, x, y, z, fly);
  await settled(page);
  await ticks(page, 5);
}

const inDimension = (page, dim) => page.waitForFunction((dim) => { const g = window.__game; return g.dimension === dim && !g.dimensionSwitching; }, { timeout: 120000 }, dim);

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
  await createWorld(page, { name: 'End', seed: '1337', creative: true });
  await helpers(page);
  await ticks(page, 20);
  await chat(page, '/time set day');
  const home = await ev(page, () => { const p = window.__game.player; return { x: p.x, y: p.y, z: p.z }; });

  // ------------------------------------------------------------------ objets, recettes, butin
  await section('objets, recettes, butin', async () => {
    const r = await ev(page, async () => {
      const { matchRecipe } = await import('/src/world/Recipes.ts');
      const { generateLoot } = await import('/src/world/Loot.ts');
      const { ITEMS } = await import('/src/world/Items.ts');
      const { BLOCKS } = await import('/src/world/Blocks.ts');
      const powder = matchRecipe([I.BLAZE_ROD, 0, 0, 0], 2);
      const eye = matchRecipe([I.BLAZE_POWDER, I.ENDER_PEARL, 0, 0], 2);
      let pearls = 0, books = 0;
      for (let i = 0; i < 300; i++) {
        for (const s of generateLoot('stronghold_corridor', 1337, i * 7, 20, -i * 3, 27)) if (s && s.id === I.ENDER_PEARL) pearls++;
        for (const s of generateLoot('stronghold_library', 1337, i * 7, 20, -i * 3, 27)) if (s && s.id === I.BOOK) books += s.count;
      }
      return {
        powder, eye, pearls, books,
        labels: [I.BLAZE_POWDER, I.ENDER_EYE].map((id) => ITEMS[id] && ITEMS[id].label),
        blocks: [B.END_STONE, B.END_PORTAL_FRAME, B.END_PORTAL, B.DRAGON_EGG].map((id) => BLOCKS[id] && BLOCKS[id].label),
        frameHard: BLOCKS[B.END_PORTAL_FRAME].hardness, portalSolid: BLOCKS[B.END_PORTAL].solid, portalItem: BLOCKS[B.END_PORTAL].hasItem,
        version: window.__game.world.genVersion,
      };
    });
    check('recette : 1 bâton de blaze → 2 poudres de blaze', r.powder && r.powder.id === 397 && r.powder.count === 2, JSON.stringify(r.powder));
    check('recette : perle de l’Ender + poudre de blaze → œil de l’Ender', r.eye && r.eye.id === 398 && r.eye.count === 1, JSON.stringify(r.eye));
    check('objets et blocs nommés en français', r.labels.every(Boolean) && r.blocks.every(Boolean), JSON.stringify([r.labels, r.blocks]));
    check('cadre incassable, portail traversable et sans objet', r.frameHard === -1 && r.portalSolid === false && r.portalItem === false, JSON.stringify(r));
    check('butin du fort : perles de l’Ender dans les coffres, livres dans la bibliothèque', r.pearls >= 20 && r.books >= 200, JSON.stringify({ perles: r.pearls, livres: r.books }));
    check('un nouveau monde porte la version 3 du générateur', r.version === 3, String(r.version));
  });

  // ------------------------------------------------------------------ plan du fort (générateur)
  let fort = null;
  await section('générateur : le fort', async () => {
    await chat(page, '/locate fort');
    const r = await ev(page, async () => {
      const { WorldGen } = await import('/src/world/gen/WorldGen.ts');
      const { BLOCK_SOLID } = await import('/src/world/Blocks.ts');
      const g = window.__game;
      const target = g.strongholdTarget();
      const portal = g.strongholdPortal();
      const gen = new WorldGen(g.world.seed, 'default', 3);
      const old = new WorldGen(g.world.seed, 'default', 2);
      const cache = new Map();
      const chunk = (cx, cz) => { const k = cx + ':' + cz; let c = cache.get(k); if (!c) { c = gen.generateChunk(cx, cz); cache.set(k, c); } return c; };
      const at = (x, y, z) => (y < 0 || y > 127 ? 0 : chunk(x >> 4, z >> 4).blocks[(y << 8) | ((z & 15) << 4) | (x & 15)]);
      const open = (x, y, z) => BLOCK_SOLID[at(x, y, z)] !== 1;
      const stand = (x, y, z) => open(x, y, z) && open(x, y + 1, z) && !open(x, y - 1, z);
      // parcours à pied de l'entrée de la salle du portail jusqu'en haut de l'escalier en colimaçon
      const DX = [0, -1, 0, 1], DZ = [1, 0, -1, 0];
      const sx = portal.x - DX[portal.dir] * 8, sz = portal.z - DZ[portal.dir] * 8, sy = portal.y - 2;
      const seen = new Set();
      const key = (x, y, z) => x + ',' + y + ',' + z;
      const queue = [[sx, sy, sz]];
      seen.add(key(sx, sy, sz));
      let top = -1, nodes = 0, platform = false;
      const startOk = stand(sx, sy, sz);
      while (queue.length && nodes < 60000) {
        const [x, y, z] = queue.shift();
        nodes++;
        if (Math.abs(x - target.x + 0.5) <= 1 && Math.abs(z - target.z + 0.5) <= 1) top = Math.max(top, y);
        if (Math.abs(x - portal.x) === 3 && z === portal.z && y === portal.y + 1) platform = true;
        if (Math.abs(z - portal.z) === 3 && x === portal.x && y === portal.y + 1) platform = true;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], nz = z + DZ[d];
          if (Math.abs(nx - target.x) > 170 || Math.abs(nz - target.z) > 170) continue;
          for (const dy of [1, 0, -1, -2, -3]) {
            const ny = y + dy;
            if (dy === 1 && !open(x, y + 2, z)) continue;
            if (!stand(nx, ny, nz)) continue;
            const k = key(nx, ny, nz);
            if (!seen.has(k)) { seen.add(k); queue.push([nx, ny, nz]); }
            break;
          }
        }
      }
      // contenu du fort, et le même endroit dans un monde d'avant (version 2)
      let frames = 0, eyes = 0, shelves = 0, oldFrames = 0, oldBricks = 0, bricks = 0, lootChests = 0, spawners = 0;
      const c0x = (Math.min(target.x, portal.x) - 60) >> 4, c1x = (Math.max(target.x, portal.x) + 60) >> 4;
      const c0z = (Math.min(target.z, portal.z) - 60) >> 4, c1z = (Math.max(target.z, portal.z) + 60) >> 4;
      for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
        const c = chunk(cx, cz);
        for (let i = 0; i < c.blocks.length; i++) {
          const id = c.blocks[i];
          if (id === B.END_PORTAL_FRAME) { frames++; if (c.meta[i] & 4) eyes++; }
          else if (id === B.BOOKSHELF) shelves++;
          else if (id === B.MOSSY_STONE_BRICKS || id === B.CRACKED_STONE_BRICKS) bricks++;
        }
        for (const be of c.blockEntities) {
          if (be.type === 'chest' && String(be.loot).startsWith('stronghold')) lootChests++;
          if (be.type === 'spawner' && be.mob === 'silverfish') spawners++;
        }
        const o = old.generateChunk(cx, cz);
        for (let i = 0; i < o.blocks.length; i++) {
          if (o.blocks[i] === B.END_PORTAL_FRAME) oldFrames++;
          if (o.blocks[i] === B.CRACKED_STONE_BRICKS) oldBricks++;
        }
      }
      const again = gen.generateChunk(portal.x >> 4, portal.z >> 4);
      const first = chunk(portal.x >> 4, portal.z >> 4);
      const same = again.blocks.every((v, i) => v === first.blocks[i]) && again.meta.every((v, i) => v === first.meta[i]);
      const cover = gen.terrainTop(target.x | 0, target.z | 0) - target.y;
      return { target, portal, startOk, top, platform, nodes, frames, eyes, shelves, bricks, lootChests, spawners, oldFrames, oldBricks, same, cover, msg: window.__msgs.slice(-1)[0], far: Math.hypot(target.x, target.z) };
    });
    fort = r;
    check('/locate fort donne sa position et sa profondeur', /^Fort : x -?\d+, z -?\d+, sous terre vers y \d+/.test(r.msg || ''), r.msg);
    check('le fort est loin de l’origine (au moins 320 blocs) et sous la roche', r.far >= 320 && r.cover >= 14, JSON.stringify({ distance: Math.round(r.far), roche: r.cover }));
    check('12 cadres de portail, une cage à poissons d’argent, des briques moussues et fissurées', r.frames === 12 && r.spawners === 1 && r.bricks > 200, JSON.stringify({ cadres: r.frames, yeux: r.eyes, cages: r.spawners, briques: r.bricks }));
    check('on va à pied de la salle du portail jusqu’en haut de l’escalier d’entrée, et sur l’estrade', r.startOk && r.top >= r.target.y + 8 && r.platform, JSON.stringify({ depart: r.startOk, sommet: r.top, y: r.target.y, estrade: r.platform, cases: r.nodes }));
    check('salles annexes : au moins un coffre de fort ou une bibliothèque', r.lootChests >= 1 || r.shelves >= 20, JSON.stringify({ coffres: r.lootChests, rayonnages: r.shelves }));
    check('le même chunk du fort est généré à l’identique', r.same === true);
    check('monde d’avant (version 2) : aucun fort au même endroit', r.oldFrames === 0, JSON.stringify({ cadres: r.oldFrames }));
  });
  if (!fort) throw new Error('fort introuvable');
  const P = fort.portal;

  // ------------------------------------------------------------------ perle de l'Ender
  await section('perle de l’Ender', async () => {
    // d'une dalle posée haut dans le ciel, pour que rien n'arrête la perle au départ
    const hx = Math.floor(home.x), hz = Math.floor(home.z);
    await goto(page, hx + 0.5, 112, hz + 0.5);
    await ev(page, (hx, hz) => {
      const g = window.__game;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) g.world.setBlock(hx + dx, 110, hz + dz, B.STONE, 0);
      M.mode('survival'); M.heal();
      g.player.teleport(hx + 0.5, 111, hz + 0.5);
    }, hx, hz);
    await ticks(page, 10);
    await chat(page, '/give ender_pearl 4');
    await ticks(page, 2);
    const start = await ev(page, () => { const p = window.__game.player; M.heal(); T.select('ender_pearl'); T.look(0.3, 0.1); return { x: p.x, y: p.y, z: p.z }; });
    await ticks(page, 2);
    await rclick(page);
    const flying = await ev(page, () => M.named('ThrownPearl').length);
    await rclick(page);
    const afterTwo = await ev(page, () => ({ pearls: T.count('ender_pearl'), flying: M.named('ThrownPearl').length }));
    await page.waitForFunction(() => M.named('ThrownPearl').length === 0, { timeout: 30000 });
    await ticks(page, 1);
    const land = await ev(page, async () => {
      const { isBoxFree } = await import('/src/entity/Physics.ts');
      const g = window.__game, p = g.player, hw = p.width / 2;
      return { x: p.x, y: p.y, z: p.z, health: p.health, free: isBoxFree(g.world, p.x - hw, p.y, p.z - hw, p.x + hw, p.y + p.height, p.z + hw), alive: p.alive };
    });
    const moved = Math.hypot(land.x - start.x, land.z - start.z);
    check('clic droit : la perle part', flying === 1, String(flying));
    check('un second clic dans la seconde ne lance rien (délai d’une seconde)', afterTwo.pearls === 3 && afterTwo.flying === 1, JSON.stringify(afterTwo));
    check('le joueur est téléporté là où la perle tombe, dans un espace libre', moved > 8 && land.free && land.alive, JSON.stringify({ blocs: +moved.toFixed(1), libre: land.free }));
    check('la téléportation coûte 2 cœurs et demi', land.health === 15, 'vie ' + land.health);
    await ev(page, (hx, hz) => { M.heal(); const w = window.__game.world; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) w.setBlock(hx + dx, 110, hz + dz, B.AIR, 0); }, hx, hz);
  });

  // ------------------------------------------------------------------ œil de l'Ender lancé
  await section('œil de l’Ender lancé', async () => {
    await goto(page, home.x, home.y, home.z, false);
    await ev(page, () => { M.mode('survival'); M.heal(); });
    await chat(page, '/clear');
    await chat(page, '/give ender_eye 3');
    await ticks(page, 2);
    const t0 = await ev(page, () => { const g = window.__game, p = g.player; T.select('ender_eye'); T.look(0, 1.2); const t = g.strongholdTarget(); return { x: p.x, y: p.y, z: p.z, tx: t.x, tz: t.z }; });
    await ticks(page, 2);
    await rclick(page);
    const thrown = await ev(page, () => { const e = M.named('EyeOfEnder')[0]; if (e) e.survives = true; return { n: M.named('EyeOfEnder').length, eyes: T.count('ender_eye'), id: e ? e.id : 0 }; });
    await ticks(page, 45);
    const mid = await ev(page, (id) => { const e = M.get(id); return e ? { x: e.x, y: e.y, z: e.z } : null; }, thrown.id);
    await page.waitForFunction(() => M.named('EyeOfEnder').length === 0, { timeout: 30000 });
    await ticks(page, 2);
    const dropped = await ev(page, () => M.items('ender_eye'));
    let toward = 0, rise = 0;
    if (mid) {
      const dx = mid.x - t0.x, dz = mid.z - t0.z, gx = t0.tx - t0.x, gz = t0.tz - t0.z;
      toward = (dx * gx + dz * gz) / (Math.hypot(dx, dz) * Math.hypot(gx, gz) || 1);
      rise = mid.y - t0.y;
    }
    check('clic droit en l’air : l’œil s’envole et il est consommé', thrown.n === 1 && thrown.eyes === 2, JSON.stringify(thrown));
    check('il monte et file en direction du fort', toward > 0.95 && rise > 2, JSON.stringify({ cap: +toward.toFixed(3), montee: +rise.toFixed(1) }));
    check('au bout de 4 secondes il retombe, intact', dropped === 1, 'yeux au sol : ' + dropped);
    // un œil qui se brise ne laisse rien
    await ev(page, () => { for (const e of window.__game.entities) if (e.kind === 'item') e.dead = true; });
    await rclick(page);
    await ev(page, () => { const e = M.named('EyeOfEnder')[0]; if (e) e.survives = false; });
    await page.waitForFunction(() => M.named('EyeOfEnder').length === 0, { timeout: 30000 });
    await ticks(page, 2);
    const broken = await ev(page, () => ({ sol: M.items('ender_eye'), main: T.count('ender_eye') }));
    check('une fois sur cinq il se brise : rien ne retombe', broken.sol === 0 && broken.main === 1, JSON.stringify(broken));
    // monde sans fort (créé avant) : l'œil ne part pas et n'est pas consommé
    const inert = await ev(page, async () => {
      const g = window.__game;
      const v = g.world.genVersion;
      g.world.genVersion = 2;
      g.input.presses[2]++;
      await new Promise((r) => setTimeout(r, 400));
      const out = { target: g.strongholdTarget(), eyes: T.count('ender_eye'), flying: M.named('EyeOfEnder').length };
      g.world.genVersion = v;
      return out;
    });
    check('dans un monde créé avant les forts, l’œil reste en main', inert.target === null && inert.eyes === 1 && inert.flying === 0, JSON.stringify(inert));
  });

  // ------------------------------------------------------------------ le fort, en jeu
  await section('le fort en jeu', async () => {
    await goto(page, P.x + 0.5, P.y + 2, P.z + 0.5);
    await ticks(page, 20);
    const r = await ev(page, (P, RING, DX, DZ) => {
      const g = window.__game, w = g.world;
      let frames = 0, eyes = 0;
      for (const [dx, dz] of RING) { const v = w.getBlockAndMeta(P.x + dx, P.y, P.z + dz); if ((v & 255) === B.END_PORTAL_FRAME) { frames++; if ((v >> 8) & 4) eyes++; } }
      const sx = P.x - DX[P.dir] * 4, sz = P.z - DZ[P.dir] * 4;
      const be = w.getBlockEntity(sx, P.y, sz);
      return {
        frames, eyes, lava: w.getBlock(P.x, P.y - 2, P.z) === B.LAVA, hole: w.getBlock(P.x, P.y, P.z) === B.AIR,
        spawner: w.getBlock(sx, P.y, sz) === B.SPAWNER && be && be.mob, sx, sz, light: w.getLight(sx, P.y + 1, sz),
      };
    }, P, RING, DX, DZ);
    check('salle du portail : 12 cadres en anneau au-dessus d’un bassin de lave', r.frames === 12 && r.lava && r.hole, JSON.stringify(r));
    check('la cage en haut des marches est à poissons d’argent', r.spawner === 'silverfish', JSON.stringify(r));
    // la cage produit des poissons d'argent quand un joueur en survie est proche
    await ev(page, (r, P) => {
      const g = window.__game;
      M.mode('survival'); M.heal();
      g.player.teleport(r.sx + 0.5, P.y + 1, r.sz + 0.5 + 0);
      g.world.getBlockEntity(r.sx, P.y, r.sz).delay = 1;
    }, r, P);
    let fish = 0;
    for (let i = 0; i < 12 && fish === 0; i++) {
      await ticks(page, 10);
      fish = await ev(page, (r, P) => { const be = window.__game.world.getBlockEntity(r.sx, P.y, r.sz); if (T.mobs('silverfish').length === 0 && be.delay > 2) be.delay = 1; return T.mobs('silverfish').length; }, r, P);
    }
    check('la cage fait apparaître des poissons d’argent', fish >= 1, String(fish));
    await ev(page, () => { M.heal(); });
    await ticks(page, 60);
    const bitten = await ev(page, () => ({ health: window.__game.player.health, fish: T.mobs('silverfish').map((m) => m.health) }));
    check('le poisson d’argent (4 cœurs) mord le joueur', bitten.health < 20 && bitten.fish.every((h) => h <= 8), JSON.stringify(bitten));
    await ev(page, (r, P) => { M.kill('silverfish'); window.__game.world.getBlockEntity(r.sx, P.y, r.sz).delay = 100000; M.heal(); }, r, P);
  });

  // ------------------------------------------------------------------ les yeux sur les cadres
  await section('poser les yeux, ouvrir le portail', async () => {
    await chat(page, '/clear');
    await chat(page, '/give ender_eye 16');
    await ticks(page, 2);
    const frames = await ev(page, (P, RING) => RING.map(([dx, dz]) => ({ x: P.x + dx, z: P.z + dz, eye: (window.__game.world.getMeta(P.x + dx, P.y, P.z + dz) & 4) !== 0 })), P, RING);
    const todo = frames.filter((f) => !f.eye);
    // le premier en survie, debout sur l'estrade à côté du cadre
    const first = todo[0];
    const side = { x: first.x + Math.sign(first.x - P.x) * (Math.abs(first.x - P.x) === 2 ? 1 : 0), z: first.z + Math.sign(first.z - P.z) * (Math.abs(first.z - P.z) === 2 ? 1 : 0) };
    await ev(page, (side, first, P) => {
      const g = window.__game;
      M.mode('survival'); M.heal();
      g.player.teleport(side.x + 0.5, P.y + 1, side.z + 0.5);
      T.select('ender_eye');
      T.aim(first.x + 0.5, P.y + 0.8, first.z + 0.5);
    }, side, first, P);
    await ticks(page, 3);
    const aimed = await ev(page, () => T.hit());
    await rclick(page);
    const one = await ev(page, (first, P) => ({ eye: (window.__game.world.getMeta(first.x, P.y, first.z) & 4) !== 0, left: T.count('ender_eye') }), first, P);
    check('clic droit sur un cadre : l’œil s’y loge et il est consommé', aimed && aimed.id === 190 && one.eye && one.left === 15, JSON.stringify({ aimed, one }));
    await rclick(page);
    const twice = await ev(page, () => ({ left: T.count('ender_eye'), flying: M.named('EyeOfEnder').length }));
    check('un cadre déjà garni ne prend pas un second œil (et l’œil ne part pas en l’air)', twice.left === 15 && twice.flying === 0, JSON.stringify(twice));
    // les autres en survolant le bassin
    await ev(page, (P) => { M.fly(); window.__game.player.teleport(P.x + 0.5, P.y + 1.4, P.z + 0.5); window.__game.player.onGround = false; T.select('ender_eye'); }, P);
    let before = null;
    for (let i = 1; i < todo.length; i++) {
      if (i === todo.length - 1) before = await ev(page, (P) => window.__game.world.getBlock(P.x, P.y, P.z), P);
      await ev(page, (f, P) => { const p = window.__game.player; p.teleport(P.x + 0.5, P.y + 1.4, P.z + 0.5); p.onGround = false; p.flying = true; T.aim(f.x + 0.5, P.y + 0.8, f.z + 0.5); }, todo[i], P);
      await ticks(page, 2);
      await rclick(page);
    }
    const done = await ev(page, (P, RING) => {
      const w = window.__game.world;
      let eyes = 0, portal = 0;
      for (const [dx, dz] of RING) if (w.getMeta(P.x + dx, P.y, P.z + dz) & 4) eyes++;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (w.getBlock(P.x + dx, P.y, P.z + dz) === B.END_PORTAL) portal++;
      return { eyes, portal, light: w.getLight(P.x, P.y + 1, P.z) };
    }, P, RING);
    check('à onze yeux, le portail reste fermé', before === 0, 'bloc au centre : ' + before);
    check('au douzième, les neuf cellules du centre deviennent le portail', done.eyes === 12 && done.portal === 9, JSON.stringify(done));
  });

  // ------------------------------------------------------------------ portail bâti à la main
  await section('portail bâti à la main', async () => {
    const at = { x: Math.floor(home.x) + 6, y: 118, z: Math.floor(home.z) + 6 };
    await goto(page, at.x + 0.5, at.y + 1.4, at.z + 0.5);
    await ev(page, (at, RING) => {
      const w = window.__game.world;
      // dix cadres déjà garnis, deux vides, tous tournés n'importe comment
      RING.forEach(([dx, dz], i) => w.setBlock(at.x + dx, at.y, at.z + dz, B.END_PORTAL_FRAME, (i % 4) | (i < 10 ? 4 : 0)));
      M.fly(); T.select('ender_eye');
    }, at, RING);
    const click1 = async (i) => {
      await ev(page, (at, d) => { const p = window.__game.player; p.teleport(at.x + 0.5, at.y + 1.4, at.z + 0.5); p.onGround = false; p.flying = true; T.aim(at.x + d[0] + 0.5, at.y + 0.8, at.z + d[1] + 0.5); }, at, RING[i]);
      await ticks(page, 2);
      await rclick(page);
      return ev(page, (at) => window.__game.world.getBlock(at.x, at.y, at.z), at);
    };
    const eleven = await click1(10);
    const twelve = await click1(11);
    check('12 cadres posés par le joueur, quel que soit leur sens : le portail s’ouvre au douzième œil', eleven === 0 && twelve === 191, JSON.stringify({ onze: eleven, douze: twelve }));
    // on le referme pour ne pas y tomber
    await ev(page, (at) => { const w = window.__game.world; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) w.setBlock(at.x + dx, at.y, at.z + dz, B.AIR, 0); }, at);
  });

  // ------------------------------------------------------------------ entrée dans l'End
  let pillars = [];
  await section('entrer dans l’End', async () => {
    await goto(page, P.x + 0.5, P.y + 3, P.z + 0.5);
    await ev(page, (P) => { M.mode('survival'); M.heal(); const p = window.__game.player; p.teleport(P.x + 0.5, P.y + 1.6, P.z + 0.5); p.onGround = false; }, P);
    await inDimension(page, 'end');
    await settled(page);
    await ticks(page, 20);
    const r = await ev(page, async () => {
      const g = window.__game, p = g.player, w = g.world;
      let obsidian = 0, air = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (w.getBlock(100 + dx, 48, dz) === B.OBSIDIAN) obsidian++;
        if (w.getBlock(100 + dx, 49, dz) === B.AIR && w.getBlock(100 + dx, 50, dz) === B.AIR) air++;
      }
      const bossEl = document.querySelector('[data-mc="boss"]');
      return {
        pos: [p.x, p.y, p.z], ground: p.onGround, obsidian, air, visits: p.stats.end_visits, boss: g.boss, alive: p.alive, health: p.health,
        bossShown: bossEl && getComputedStyle(bossEl).display !== 'none', bossName: bossEl && bossEl.textContent,
        dragons: T.mobs('ender_dragon').length, darken: w.skyDarken, rain: g.raining, sky: [g.sky.skyColor.r, g.sky.skyColor.g, g.sky.skyColor.b],
        adv: [...p.advancements].filter((a) => ['blaze_rod', 'ender_eye', 'the_end'].includes(a)), keys: (await g.storage.chunkKeys(g.info.id + ':end')).size,
      };
    });
    check('tomber dans le portail emmène dans l’End, sur la plate-forme d’obsidienne (100, 49, 0)', Math.abs(r.pos[0] - 100.5) < 0.6 && Math.abs(r.pos[1] - 49) < 0.6 && Math.abs(r.pos[2] - 0.5) < 0.6 && r.obsidian === 25 && r.air === 25 && r.alive, JSON.stringify(r.pos) + ' obsidienne ' + r.obsidian);
    check('le dragon est là, avec sa barre de vie en haut de l’écran', r.dragons === 1 && r.boss && r.boss.progress === 1 && r.bossShown && /Dragon/.test(r.bossName || ''), JSON.stringify({ dragons: r.dragons, boss: r.boss, affichee: r.bossShown }));
    check('ciel noir, ni pluie ni jour', r.sky.every((c) => c < 0.1) && r.darken === 11 && r.rain === false, JSON.stringify({ ciel: r.sky, nuit: r.darken }));
    check('l’entrée est comptée, et le progrès « La fin ? » débloqué', r.visits === 1 && r.adv.includes('the_end'), JSON.stringify({ entrees: r.visits, progres: r.adv }));
    // le terrain : de la plate-forme au centre à pied, les piliers, la fontaine
    await ev(page, () => { M.fly(); });
    await goto(page, 0.5, 66, 8.5);
    await ticks(page, 20);
    const land = await ev(page, async () => {
      const { EndGen } = await import('/src/world/gen/EndGen.ts');
      const { endPillars } = await import('/src/world/gen/EndLayout.ts');
      const g = window.__game, w = g.world;
      const gen = new EndGen(g.world.seed);
      let maxStep = 0, prev = gen.terrainTop(97, 0), holes = 0;
      for (let x = 96; x >= 4; x--) { const t = gen.terrainTop(x, 0); if (t < 0) holes++; maxStep = Math.max(maxStep, Math.abs(t - prev)); prev = t; }
      const pillars = endPillars(g.world.seed).map((p) => ({ ...p }));
      let ok = 0, caged = 0, crystalOn = 0;
      const crystals = M.crystals();
      for (const p of pillars) {
        if (w.getBlock(p.x, p.height - 1, p.z) === B.OBSIDIAN && w.getBlock(p.x, p.height, p.z) === B.BEDROCK && w.getBlock(p.x + p.radius, p.height - 2, p.z) === B.OBSIDIAN) ok++;
        if (w.getBlock(p.x + 2, p.height + 1, p.z) === B.IRON_BARS) caged++;
        if (crystals.some((c) => Math.abs(c.x - p.x - 0.5) < 0.1 && Math.abs(c.z - p.z - 0.5) < 0.1 && Math.abs(c.y - p.height - 1) < 0.1)) crystalOn++;
      }
      let torches = 0, pool = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.getBlock(dx, 61, dz) === B.TORCH) torches++;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (w.getBlock(dx, 59, dz) === B.END_PORTAL) pool++;
      return {
        maxStep, holes, pillars, ok, caged, crystalOn, crystals: crystals.length, heights: pillars.map((p) => p.height).sort((a, b) => a - b),
        rim: gen.terrainTop(99, 0), centre: gen.terrainTop(6, 6), voidFar: gen.terrainTop(160, 0),
        fountain: w.getBlock(0, 58, 0) === B.BEDROCK && w.getBlock(0, 62, 0) === B.BEDROCK && w.getBlock(3, 59, 0) === B.BEDROCK, torches, pool, egg: w.getBlock(0, 63, 0),
      };
    });
    pillars = land.pillars;
    check('île de pierre de l’End dans le vide ; de la plate-forme au centre, jamais plus d’un bloc à monter', land.rim === 48 && land.centre === 58 && land.voidFar === -1 && land.holes === 0 && land.maxStep <= 1, JSON.stringify({ bord: land.rim, centre: land.centre, marche: land.maxStep, trous: land.holes }));
    check('10 piliers d’obsidienne de 76 à 103 blocs, coiffés de bedrock', land.ok === 10 && land.heights[0] === 76 && land.heights[9] === 103, JSON.stringify(land.heights));
    check('un cristal au sommet de chacun, dont 2 en cage de barreaux', land.crystals === 10 && land.crystalOn === 10 && land.caged === 2, JSON.stringify({ cristaux: land.crystals, places: land.crystalOn, cages: land.caged }));
    check('fontaine de bedrock au centre, 4 torches, bassin vide, pas d’œuf', land.fountain && land.torches === 4 && land.pool === 0 && land.egg === 0, JSON.stringify({ fontaine: land.fountain, torches: land.torches, bassin: land.pool, oeuf: land.egg }));
    let endermen = 0;
    for (let i = 0; i < 30 && endermen === 0; i++) { await ticks(page, 20); endermen = await ev(page, () => T.mobs('enderman').length); }
    await ticks(page, 100);
    const pop = await ev(page, () => ({ n: T.mobs('enderman').length, others: Object.keys(T.kinds()).filter((k) => !['player', 'enderman', 'end_crystal', 'ender_dragon', 'item', 'fireball'].includes(k)) }));
    check('des endermen peuplent l’île (12 au plus), et rien d’autre', endermen >= 1 && pop.n <= 12 && pop.others.length === 0, JSON.stringify(pop));
  });

  // ------------------------------------------------------------------ cristaux
  const free = () => pillars.filter((p) => !p.caged);
  await section('cristaux de l’End', async () => {
    const p0 = free()[0];
    await goto(page, p0.x + 3.5, p0.height + 1, p0.z + 0.5);
    await ev(page, (p0) => { const d = M.freeze(p0.x + 0.5, p0.height + 9, p0.z + 10.5); d.health = 100; }, p0);
    await ticks(page, 32);
    const heal = await ev(page, (p0) => {
      const d = M.dragon();
      const c = M.crystals().find((c) => Math.abs(c.x - p0.x - 0.5) < 0.1 && Math.abs(c.z - p0.z - 0.5) < 0.1);
      return { health: d.health, beam: c.leashed, to: [c.leashX, c.leashY, c.leashZ], dragon: [d.x, d.y, d.z], count: d.crystals };
    }, p0);
    check('un cristal à portée soigne le dragon (un demi-cœur par demi-seconde) et un rayon les relie', heal.health >= 102 && heal.health <= 104 && heal.beam && Math.abs(heal.to[0] - heal.dragon[0]) < 0.1, JSON.stringify(heal));
    await ev(page, () => { const d = M.freeze(0.5, 126, 0.5); d.health = 100; });
    await ticks(page, 30);
    const far = await ev(page, () => ({ health: M.dragon().health, beams: M.crystals().filter((c) => c.leashed).length }));
    check('hors de portée (32 blocs), plus de soin ni de rayon', far.health === 100 && far.beams === 0, JSON.stringify(far));
    // on frappe le cristal qui soigne : il explose et le dragon encaisse le contrecoup
    await ev(page, (p0) => { const d = M.freeze(p0.x + 0.5, p0.height + 9, p0.z + 10.5); d.health = 100; d.invulnerable = 0; }, p0);
    await ticks(page, 12);
    const h0 = await ev(page, (p0) => { const p = window.__game.player; p.teleport(p0.x + 3.5, p0.height + 1, p0.z + 0.5); p.onGround = false; p.flying = true; T.aim(p0.x + 0.5, p0.height + 2, p0.z + 0.5); return M.dragon().health; }, p0);
    await ticks(page, 2);
    await lclick(page);
    await ticks(page, 5);
    const boom = await ev(page, (p0) => {
      const w = window.__game.world;
      return { crystals: M.crystals().length, health: M.dragon().health, bedrock: w.getBlock(p0.x, p0.height, p0.z) === B.BEDROCK, obsidian: w.getBlock(p0.x, p0.height - 1, p0.z) === B.OBSIDIAN, alive: window.__game.player.alive };
    }, p0);
    check('un coup suffit : le cristal explose (le pilier d’obsidienne tient)', boom.crystals === 9 && boom.bedrock && boom.obsidian, JSON.stringify(boom));
    check('détruire le cristal qui le soigne blesse le dragon de 5 cœurs', h0 - boom.health >= 9 && h0 - boom.health <= 14, JSON.stringify({ avant: h0, apres: boom.health }));
    // une flèche fait le même effet, de loin
    const p1 = free()[1];
    await goto(page, p1.x + 12.5, p1.height + 1, p1.z + 0.5);
    await ev(page, async (p1) => {
      const { Arrow } = await import('/src/entity/Objects.ts');
      const g = window.__game;
      M.freeze(0.5, 126, 0.5);
      const a = new Arrow();
      a.owner = g.player;
      a.shoot(p1.x + 10.5, p1.height + 2, p1.z + 0.5, -1, 0.02, 0, 2.5, 0, g.rng);
      g.spawn(a);
    }, p1);
    await ticks(page, 20);
    const shot = await ev(page, () => M.crystals().length);
    check('une flèche détruit un cristal à distance', shot === 8, 'cristaux : ' + shot);
  });

  // ------------------------------------------------------------------ mourir dans l'End, y revenir
  await section('mourir dans l’End, revenir', async () => {
    await ev(page, () => { const d = M.freeze(0.5, 126, 150.5); d.health = 120; M.mode('survival'); M.heal(); window.__game.player.teleport(20.5, 62, 20.5); });
    await ticks(page, 20);
    await chat(page, '/kill');
    await page.waitForSelector('[data-mc="respawn"]:not([disabled])', { timeout: 15000 });
    await click(page, 'respawn');
    await inDimension(page, 'overworld');
    await settled(page);
    await ticks(page, 10);
    const back = await ev(page, () => {
      const g = window.__game, p = g.player, s = g.spawnPoint;
      return { alive: p.alive, health: p.health, d: Math.hypot(p.x - s.x, p.z - s.z), y: p.y, dragons: T.mobs('ender_dragon').length, boss: g.boss, saved: g.endFight.save(), screen: !!document.querySelector('[data-mc="death"]') };
    });
    check('mort dans l’End : on réapparaît à la surface, au point d’apparition', back.alive && back.health === 20 && back.d < 24 && back.y > 40 && !back.screen, JSON.stringify(back));
    check('hors de l’End, ni dragon ni barre de vie ; sa vie est gardée', back.dragons === 0 && back.boss === null && back.saved.health === 120 && back.saved.killed === false, JSON.stringify(back.saved));
    await ev(page, () => { M.fly(); void window.__game.enterEnd(); });
    await inDimension(page, 'end');
    await settled(page);
    await ev(page, () => { M.fly(); });
    await goto(page, 0.5, 66, 8.5);
    await ticks(page, 30);
    const again = await ev(page, () => ({ health: M.dragon() && M.dragon().health, dragons: T.mobs('ender_dragon').length, crystals: M.crystals().length, visits: window.__game.player.stats.end_visits }));
    check('de retour : le dragon retrouve sa vie (120), les cristaux détruits le restent (8)', again.dragons === 1 && again.health >= 120 && again.health <= 126 && again.crystals === 8 && again.visits === 2, JSON.stringify(again));
  });

  // ------------------------------------------------------------------ sauvegarde dans l'End
  await section('sauvegarde et rechargement dans l’End', async () => {
    await ev(page, () => { const d = M.freeze(0.5, 126, 0.5); d.health = 111; });
    await ticks(page, 5);
    await reload(page);
    await settled(page);
    await ev(page, () => { M.fly(); });
    await ticks(page, 30);
    const r = await ev(page, () => {
      const g = window.__game;
      return { dim: g.dimension, health: M.dragon() && M.dragon().health, dragons: T.mobs('ender_dragon').length, crystals: M.crystals().length, boss: g.boss && +g.boss.progress.toFixed(2) };
    });
    check('on reprend dans l’End : même vie du dragon, mêmes cristaux, barre affichée', r.dim === 'end' && r.dragons === 1 && r.health >= 111 && r.health <= 118 && r.crystals === 8 && r.boss > 0.5, JSON.stringify(r));
  });

  // ------------------------------------------------------------------ le dragon
  await section('le dragon', async () => {
    await goto(page, 0.5, 66, 8.5);
    // ronde
    await ev(page, () => { const d = M.dragon(); d.chooseNext = () => {}; d.phase = 'round'; d.setPosition(60.5, 90, 0.5); d.health = 200; });
    const track = [];
    for (let i = 0; i < 12; i++) { await ticks(page, 20); track.push(await ev(page, () => { const d = M.dragon(); return [d.x, d.y, d.z, d.yaw]; })); }
    let path = 0, rMin = 1e9, rMax = 0, yMin = 1e9, yMax = 0, turned = 0;
    for (let i = 0; i < track.length; i++) {
      const [x, y, z] = track[i];
      const r = Math.hypot(x, z);
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      if (i > 0) { path += Math.hypot(x - track[i - 1][0], z - track[i - 1][2]); turned += Math.abs(track[i][3] - track[i - 1][3]); }
    }
    check('il vole en ronde autour des piliers (hors de leur cercle, entre 76 et 110 de haut)', path > 90 && rMin > 40 && rMax < 85 && yMin > 76 && yMax < 110 && turned > 1, JSON.stringify({ chemin: Math.round(path), rayon: [Math.round(rMin), Math.round(rMax)], y: [Math.round(yMin), Math.round(yMax)], virage: +turned.toFixed(1) }));
    // insensible au feu, aux chutes, au vide
    const immune = await ev(page, () => { const g = window.__game, d = M.dragon(); d.invulnerable = 0; const h = d.health; return [d.hurt(g, 10, 'fire'), d.hurt(g, 10, 'lava'), d.hurt(g, 10, 'fall'), d.hurt(g, 10, 'void'), d.health === h]; });
    check('insensible au feu, à la lave, aux chutes et au vide', immune.every((v, i) => (i < 4 ? v === false : v === true)), JSON.stringify(immune));
    // boule et nuage de souffle
    await ev(page, () => {
      const g = window.__game, p = g.player;
      M.kill('enderman');
      M.mode('survival'); M.heal();
      p.teleport(20.5, 62, 20.5);
      const d = M.dragon();
      d.setPosition(20.5, 78, 70.5); d.setRotation(0); d.phase = 'strafe'; d.phaseTicks = 0;
    });
    let balls = 0;
    for (let i = 0; i < 60 && balls === 0; i++) { await ticks(page, 5); balls = await ev(page, () => { M.heal(); return window.__game.entities.filter((e) => e.kind === 'fireball' && !e.dead).length; }); }
    const phaseAfter = await ev(page, () => M.dragon().phase);
    check('il vient cracher une boule sur le joueur, puis reprend sa ronde', balls >= 1 && phaseAfter !== 'strafe', JSON.stringify({ boules: balls, phase: phaseAfter }));
    await ev(page, () => { M.freeze(0.5, 126, 200.5); M.fly(); window.__game.player.teleport(20.5, 90, 20.5); });
    let cloud = null;
    for (let i = 0; i < 40 && !cloud; i++) { await ticks(page, 5); cloud = await ev(page, () => { const c = M.dragon().clouds[0]; return c ? { x: c.x, y: c.y, z: c.z, ticks: c.ticks } : null; }); }
    check('la boule laisse un nuage de souffle là où elle s’écrase', !!cloud, JSON.stringify(cloud));
    if (cloud) {
      await ev(page, (c) => { const g = window.__game, d = M.dragon(); d.clouds[0].ticks = 100; M.mode('survival'); M.heal(); M.kill('enderman'); g.player.teleport(c.x, c.y + 0.1, c.z); }, cloud);
      await ticks(page, 24);
      const burnt = await ev(page, () => ({ health: window.__game.player.health, alive: window.__game.player.alive }));
      check('rester dans le nuage brûle (1 cœur et demi par demi-seconde)', burnt.alive && burnt.health <= 17 && burnt.health >= 8, JSON.stringify(burnt));
      await ev(page, () => { M.dragon().clouds.length = 0; M.heal(); });
    }
    // contact
    await ev(page, () => {
      const g = window.__game, p = g.player;
      M.mode('survival'); M.heal(); M.kill('enderman');
      p.teleport(20.5, 62, 20.5);
    });
    await ticks(page, 15);
    await ev(page, () => { const p = window.__game.player; M.heal(); const d = M.freeze(p.x, p.y + 1, p.z); delete d.strike; });
    await ticks(page, 8);
    const hit = await ev(page, () => { const p = window.__game.player; const out = { health: p.health, vy: p.vy, by: p.attacker && p.attacker.mobKind }; M.freeze(0.5, 126, 200.5); M.heal(); return out; });
    check('son passage blesse et projette le joueur', hit.health <= 15 && hit.by === 'ender_dragon', JSON.stringify(hit));
    // blocs
    await ev(page, () => {
      const w = window.__game.world;
      M.fly(); window.__game.player.teleport(30.5, 102, 20.5);
      w.setBlock(30, 100, 30, B.OAK_PLANKS, 0); w.setBlock(31, 101, 30, B.STONE, 0); w.setBlock(29, 100, 31, B.GLASS, 0);
      w.setBlock(30, 101, 31, B.OBSIDIAN, 0); w.setBlock(31, 100, 31, B.END_STONE, 0);
      const d = M.freeze(30.5, 100, 30.5); delete d.smash;
    });
    await ticks(page, 6);
    const smashed = await ev(page, () => {
      const w = window.__game.world;
      const out = { planks: w.getBlock(30, 100, 30), stone: w.getBlock(31, 101, 30), glass: w.getBlock(29, 100, 31), obsidian: w.getBlock(30, 101, 31), endStone: w.getBlock(31, 100, 31) };
      M.freeze(0.5, 126, 200.5);
      w.setBlock(30, 101, 31, B.AIR, 0); w.setBlock(31, 100, 31, B.AIR, 0);
      return out;
    });
    check('il détruit les blocs qu’il traverse, sauf l’obsidienne et la pierre de l’End', smashed.planks === 0 && smashed.stone === 0 && smashed.glass === 0 && smashed.obsidian === 14 && smashed.endStone === 189, JSON.stringify(smashed));
    // il se pose sur la fontaine
    await ev(page, () => { M.fly(); window.__game.player.teleport(0.5, 64.5, 5.5); const d = M.thaw(); d.chooseNext = () => {}; d.setPosition(40.5, 80, 0.5); d.health = 200; d.phase = 'landing'; d.phaseTicks = 0; });
    await page.waitForFunction(() => M.dragon().phase === 'perched', { timeout: 60000 });
    await ticks(page, 5);
    const perched = await ev(page, () => {
      const g = window.__game, d = M.dragon(), p = g.player;
      d.invulnerable = 0;
      const h = d.health;
      const arrow = d.hurt(g, 9, 'arrow', p);
      p.teleport(0.5, 63.6, 4.6); p.onGround = false; p.flying = true;
      T.aim(0.5, 64.3, 1.5);
      return { pos: [d.x, d.y, d.z], arrow, same: d.health === h, torches: [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => g.world.getBlock(dx, 61, dz) === B.TORCH).length };
    });
    check('il vient se poser sur la colonne de la fontaine (sans casser ses torches)', Math.abs(perched.pos[0] - 0.5) < 0.1 && perched.pos[1] === 63 && Math.abs(perched.pos[2] - 0.5) < 0.1 && perched.torches === 4, JSON.stringify(perched));
    check('posé, ses écailles renvoient les flèches', perched.arrow === false && perched.same, JSON.stringify(perched));
    await chat(page, '/give diamond_sword');
    await ticks(page, 2);
    const h1 = await ev(page, () => { T.select('diamond_sword'); const d = M.dragon(); d.invulnerable = 0; return d.health; });
    await ticks(page, 2);
    await lclick(page);
    const struck = await ev(page, () => ({ health: M.dragon().health, phase: M.dragon().phase }));
    check('posé, on l’atteint à l’épée', h1 - struck.health >= 6, JSON.stringify({ avant: h1, apres: struck.health }));
    await ev(page, () => { const g = window.__game, d = M.dragon(); d.invulnerable = 0; d.hurt(g, 60, 'attack', g.player); });
    await ticks(page, 3);
    const off = await ev(page, () => M.dragon().phase);
    await ticks(page, 45);
    const up = await ev(page, () => M.dragon().y);
    check('après 25 cœurs de dégâts encaissés posé, il reprend son vol', off === 'takeoff' && up > 70, JSON.stringify({ phase: off, y: Math.round(up) }));
  });

  // ------------------------------------------------------------------ la mort du dragon
  await section('la mort du dragon', async () => {
    await ev(page, () => {
      const g = window.__game, p = g.player;
      M.fly(); M.kill('enderman');
      p.teleport(20.5, 76, 20.5); p.onGround = false; p.flying = true;
      const d = M.freeze(20.5, 75, 15.5); d.health = 4; d.invulnerable = 0;
      T.select('diamond_sword');
      T.aim(20.5, 76.2, 17.6);
      window.__msgs.length = 0;
    });
    await ticks(page, 3);
    const level0 = await ev(page, () => window.__game.player.xpLevel);
    await lclick(page);
    const dying = await ev(page, () => { const g = window.__game, d = M.dragon(); const out = { health: d.health, phase: d.phase, boss: g.boss, killed: g.endFight.killed, rewarded: g.endFight.rewarded }; M.thaw(); return out; });
    check('le coup de grâce : il entre en agonie, la barre tombe à zéro', dying.health === 0 && dying.phase === 'dying' && dying.boss && dying.boss.progress === 0 && !dying.rewarded, JSON.stringify(dying));
    await ev(page, () => { window.__game.player.teleport(8.5, 66, 8.5); });
    await page.waitForFunction(() => window.__game.endFight.rewarded === true, { timeout: 60000 });
    await ticks(page, 5);
    const won = await ev(page, () => {
      const g = window.__game, w = g.world, p = g.player;
      let pool = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (w.getBlock(dx, 59, dz) === B.END_PORTAL) pool++;
      const bossEl = document.querySelector('[data-mc="boss"]');
      return {
        pool, pillar: w.getBlock(0, 59, 0) === B.BEDROCK, egg: w.getBlock(0, 63, 0) === B.DRAGON_EGG, level: p.xpLevel, killed: p.stats['killed:ender_dragon'],
        dragons: T.mobs('ender_dragon').length, boss: g.boss, bossShown: bossEl && getComputedStyle(bossEl).display !== 'none', msg: window.__msgs.filter((m) => /dragon/i.test(m)),
      };
    });
    check('à sa mort, le bassin de la fontaine devient le portail de sortie (20 cellules autour de la colonne)', won.pool === 20 && won.pillar, JSON.stringify({ bassin: won.pool }));
    check('l’œuf de dragon apparaît au sommet de la colonne', won.egg === true);
    check('le joueur reçoit l’expérience (plus de 60 niveaux) et le message de victoire', won.level - level0 >= 60 && won.msg.length === 1, JSON.stringify({ niveaux: won.level - level0, msg: won.msg }));
    check('plus de dragon ni de barre de vie ; la victoire est comptée', won.dragons === 0 && won.boss === null && !won.bossShown && won.killed === 1, JSON.stringify({ dragons: won.dragons, boss: won.boss, tues: won.killed }));
    await ticks(page, 100);
    const none = await ev(page, () => T.mobs('ender_dragon').length);
    await ev(page, () => { M.mode('survival'); M.heal(); window.__game.player.teleport(8.5, 60, 8.5); });
    await ticks(page, 15);
    const adv = await ev(page, () => { const out = window.__game.player.advancements.has('dragon'); M.fly(); return out; });
    check('le dragon ne revient pas ; progrès « Libérer l’End » débloqué', none === 0 && adv === true, JSON.stringify({ dragons: none, progres: adv }));
    // l'œuf se dérobe au clic droit
    await ev(page, () => { const p = window.__game.player; p.teleport(0.5, 63.4, 3.2); p.onGround = false; p.flying = true; p.inventory.selected = 8; T.aim(0.5, 63.5, 0.5); });
    await ticks(page, 3);
    const eggHit = await ev(page, () => T.hit());
    await rclick(page);
    const egg = await ev(page, () => {
      const w = window.__game.world;
      let found = null;
      for (let dy = -4; dy <= 4; dy++) for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) if (w.getBlock(dx, 63 + dy, dz) === B.DRAGON_EGG) found = [dx, 63 + dy, dz];
      return { old: w.getBlock(0, 63, 0), found, below: found && w.getBlock(found[0], found[1] - 1, found[2]) };
    });
    check('clic droit sur l’œuf : il se téléporte sur un sol voisin', eggHit && eggHit.id === 192 && egg.old === 0 && egg.found && egg.below !== 0, JSON.stringify({ vise: eggHit, egg }));
  });

  // ------------------------------------------------------------------ le retour
  await section('le portail de sortie et l’écran de fin', async () => {
    await ev(page, () => { M.mode('survival'); M.heal(); const p = window.__game.player; p.teleport(1.5, 61.5, 0.5); p.onGround = false; });
    await inDimension(page, 'overworld');
    await settled(page);
    await page.waitForSelector('[data-mc="win"]', { timeout: 15000 });
    const r = await ev(page, () => {
      const g = window.__game, p = g.player, s = g.spawnPoint;
      return { alive: p.alive, d: Math.hypot(p.x - s.x, p.z - s.z), modal: g.ui.modal, credits: g.endFight.creditsSeen, text: document.querySelector('[data-mc="win"]').textContent.slice(0, 60) };
    });
    check('sauter dans le portail ramène à la surface, au point d’apparition', r.alive && r.d < 24, JSON.stringify(r));
    check('la première fois, l’écran de fin s’affiche', r.modal === true && /^Fin/.test(r.text) && r.credits === true, JSON.stringify(r));
    await sleep(300);
    await click(page, 'continue');
    await ticks(page, 10);
    const after = await ev(page, () => ({ modal: window.__game.ui.modal, screen: !!document.querySelector('[data-mc="win"]'), y: window.__game.player.y, alive: window.__game.player.alive }));
    check('« Retourner dans le monde » : la partie reprend', after.modal === false && !after.screen && after.alive, JSON.stringify(after));
    // second voyage, par le vrai portail du fort
    await goto(page, P.x + 0.5, P.y + 3, P.z + 0.5);
    const still = await ev(page, (P) => { const w = window.__game.world; let n = 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (w.getBlock(P.x + dx, P.y, P.z + dz) === B.END_PORTAL) n++; return n; }, P);
    await ev(page, (P) => { M.mode('survival'); M.heal(); const p = window.__game.player; p.teleport(P.x + 0.5, P.y + 1.6, P.z + 0.5); p.onGround = false; }, P);
    await inDimension(page, 'end');
    await settled(page);
    await ticks(page, 60);
    const second = await ev(page, () => {
      const g = window.__game, w = g.world;
      let pool = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (w.isLoaded(dx, dz) && w.getBlock(dx, 59, dz) === B.END_PORTAL) pool++;
      return { dragons: T.mobs('ender_dragon').length, boss: g.boss, killed: g.endFight.killed, pos: [g.player.x, g.player.y, g.player.z], pool };
    });
    check('le portail du fort reste ouvert ; dans l’End, plus de dragon', still === 9 && second.dragons === 0 && second.boss === null && second.killed, JSON.stringify({ portail: still, ...second }));
    await ev(page, () => { M.fly(); });
    await goto(page, 3.5, 64, 3.5);
    await ticks(page, 50);
    const pool = await ev(page, () => { const w = window.__game.world; let n = 0; for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (w.getBlock(dx, 59, dz) === B.END_PORTAL) n++; return n; });
    await ev(page, () => { M.mode('survival'); M.heal(); const p = window.__game.player; p.teleport(-1.5, 61.5, 0.5); p.onGround = false; });
    await inDimension(page, 'overworld');
    await settled(page);
    await ticks(page, 20);
    const quiet = await ev(page, () => ({ screen: !!document.querySelector('[data-mc="win"]'), modal: window.__game.ui.modal, alive: window.__game.player.alive }));
    check('le portail de sortie est toujours là ; au second retour, pas d’écran de fin', pool === 20 && !quiet.screen && quiet.modal === false && quiet.alive, JSON.stringify({ bassin: pool, ...quiet }));
  });

  // ------------------------------------------------------------------ export / import
  await section('export et import', async () => {
    const r = await ev(page, async () => {
      const WF = await import('/src/world/WorldFile.ts');
      const g = window.__game;
      await g.save();
      const endKeys = (await g.storage.chunkKeys(g.info.id + ':end')).size;
      const copy = await WF.importWorld(g.storage, await (await WF.exportWorld(g.storage, g.info.id)).arrayBuffer());
      const copyEnd = (await g.storage.chunkKeys(copy.id + ':end')).size;
      const state = copy.state && copy.state.end;
      await g.storage.deleteWorld(copy.id);
      const gone = (await g.storage.chunkKeys(copy.id + ':end')).size;
      return { endKeys, copyEnd, state, gone, version: copy.genVersion };
    });
    check('un monde exporté puis importé garde ses chunks de l’End et l’état du combat', r.endKeys > 0 && r.copyEnd === r.endKeys && r.state && r.state.killed === true && r.version === 3, JSON.stringify(r));
    check('supprimer un monde supprime aussi ses chunks de l’End', r.gone === 0, String(r.gone));
  });

  const fails = results.filter((r) => !r.ok);
  console.log(`\nBILAN : ${results.length - fails.length}/${results.length} ; erreurs de console : ${errors.length}`);
  for (const f of fails) console.log('  ECHEC : ' + f.name + (f.detail ? ' — ' + f.detail : ''));
  for (const e of errors.slice(0, 5)) console.log('  ' + e);
  await browser.close();
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
