const path = require('path');
const fs = require('fs');
const S = path.resolve(__dirname);
fs.mkdirSync(path.join(S, 'shots', 'game'), { recursive: true });
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.env.GAME_URL || 'http://localhost:5173/';
async function launch() {
  return puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
  });
}
async function openPage(browser, errors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('  pageerror', e.message, (e.stack || '').split('\n').slice(0, 4).join(' | ')); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { const t = m.text(); if (!/404|favicon/.test(t)) { errors.push('console.' + m.type() + ': ' + t); console.log('  console.' + m.type(), t.slice(0, 300)); } } });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-mc="title"]', { timeout: 20000 });
  return page;
}
const click = (page, id) => page.evaluate((id) => { const e = document.querySelector(`#ui [data-mc="${id}"]`); if (!e) throw new Error('repère introuvable : ' + id); e.click(); }, id);
async function createWorld(page, { name = 'Test', seed = '1337', creative = false, flat = false } = {}) {
  await click(page, 'play');
  await page.waitForSelector('[data-mc="world-create"]', { timeout: 10000 });
  await sleep(200);
  await click(page, 'world-create');
  await page.waitForSelector('[data-mc="seed"]', { timeout: 10000 });
  await page.evaluate((name, seed) => {
    const set = (id, v) => { const i = document.querySelector(`[data-mc="${id}"]`); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
    set('name', name); set('seed', seed);
  }, name, seed);
  if (creative) await click(page, 'mode');
  if (flat) await click(page, 'type');
  await click(page, 'create');
  await page.waitForFunction('window.__game && window.__game.ready === true', { timeout: 120000 });
}
const shot = (page, name) => page.screenshot({ path: `${S}/shots/game/${name}.png` });
// avance le jeu de n ticks réels (attend que le temps du monde ait progressé)
async function ticks(page, n) {
  const t0 = await page.evaluate(() => window.__game.time);
  await page.waitForFunction((t) => window.__game.time >= t, { timeout: 60000 + n * 200 }, t0 + n);
}
const state = (page) => page.evaluate(() => {
  const g = window.__game, p = g.player;
  return {
    pos: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], onGround: p.onGround, health: p.health, hunger: p.hunger,
    time: g.time, entities: g.entities.length, kinds: g.entities.reduce((m, e) => { const k = e.kind === 'mob' ? e.mobKind : e.kind; m[k] = (m[k] || 0) + 1; return m; }, {}),
    stats: { ...g.chunks.stats }, drawn: g.chunkRenderer.count, modal: g.ui.modal, pausing: g.ui.pausing,
  };
});
module.exports = { S, sleep, launch, openPage, click, createWorld, shot, ticks, state, URL };
