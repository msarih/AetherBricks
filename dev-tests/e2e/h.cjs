const { sleep, launch, openPage, click, createWorld, shot, ticks, state } = require('./lib.cjs');
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
}

async function install(page) {
  await page.evaluate(async () => {
    const items = await import('/src/world/Items.ts');
    const g = window.__game;
    const names = new Map();
    for (const it of items.ITEMS) if (it) names.set(it.name, it.id);
    window.__msgs = window.__msgs || [];
    if (!g.ui.__wrapped) {
      const add = g.ui.addMessage.bind(g.ui);
      g.ui.addMessage = (t) => { window.__msgs.push(t); add(t); };
      g.ui.__wrapped = true;
    }
    window.T = {
      id: (n) => { const v = names.get(n); if (v === undefined) throw new Error('objet inconnu ' + n); return v; },
      count: (n) => { const id = T.id(n); return g.player.inventory.slots.reduce((s, x) => s + (x && x.id === id ? x.count : 0), 0); },
      look: (yaw, pitch) => { const p = g.player; p.turn(yaw - p.yaw, pitch - p.headPitch); },
      aim: (x, y, z) => { const p = g.player; const dx = x - p.x, dy = y - (p.y + p.eyeHeight), dz = z - p.z; T.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); },
      select: (n) => { const id = T.id(n); const inv = g.player.inventory; let i = inv.slots.findIndex((x, k) => k < 9 && x && x.id === id); if (i < 0) { const j = inv.slots.findIndex((x) => x && x.id === id); if (j < 0) throw new Error('pas dans l\'inventaire : ' + n); const tmp = inv.slots[0]; inv.slots[0] = inv.slots[j]; inv.slots[j] = tmp; i = 0; } inv.selected = i; },
      block: (x, y, z) => g.world.getBlock(x, y, z),
      hit: () => { const it = g.interaction; return it.hasBlock ? { x: it.hit.x, y: it.hit.y, z: it.hit.z, face: it.hit.face, id: it.hit.id } : null; },
      mobs: (kind) => g.entities.filter((e) => e.kind === 'mob' && e.mobKind === kind && !e.dead),
      kinds: () => g.entities.reduce((m, e) => { const k = e.kind === 'mob' ? e.mobKind : e.kind; m[k] = (m[k] || 0) + 1; return m; }, {}),
      inv: () => g.player.inventory.slots.map((x, i) => (x ? `${i}:${items.ITEMS[x.id].name}x${x.count}` : null)).filter(Boolean).join(' '),
    };
  });
}
const ev = (page, fn, ...a) => page.evaluate(fn, ...a);
const chat = (page, t) => ev(page, (t) => window.__game.chat(t), t);
const rclick = async (page) => { await ev(page, () => { window.__game.input.presses[2]++; }); await ticks(page, 3); };
const lclick = async (page) => { await ev(page, () => { window.__game.input.presses[0]++; }); await ticks(page, 2); };
const pos = (page) => ev(page, () => { const p = window.__game.player; return { x: p.x, y: p.y, z: p.z, g: p.onGround }; });
const section = async (name, fn) => {
  console.log('--- ' + name);
  try { await fn(); } catch (e) { check(name + ' (exception)', false, String(e && e.message || e).slice(0, 300)); }
};
/** Vise le dessus du bloc du sol (x, z) puis clique droit ; renvoie la cellule posée attendue. */
async function useOnGround(page, x, z) {
  await ev(page, (x, z) => T.aim(x + 0.5, 4, z + 0.5), x, z);
  await ticks(page, 2);
  const h = await ev(page, () => T.hit());
  await rclick(page);
  return h;
}

module.exports = { results, check, install, ev, chat, rclick, lclick, pos, section, useOnGround };
