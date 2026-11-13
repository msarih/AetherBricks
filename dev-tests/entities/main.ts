/**
 * Page de test de l'affichage des entités (src/render/EntityRenderer.ts), de la main à la première
 * personne (HandRenderer.ts) et des icônes d'inventaire (ItemIcons.ts).
 * Reproduit le réglage du moteur : gestion des couleurs désactivée, sortie linéaire, autoClear false.
 *
 * Paramètres d'URL :
 *   ?view=mob&kind=pig        une créature : face, trois quarts, profil en marche, dos, blessée, mourante, morte
 *   ?view=special             poses particulières (joueur accroupi, objets tenus, arc, creeper qui gonfle…)
 *   ?view=things              objets au sol, TNT, bloc qui tombe, flèches
 *   ?view=hand&item=330       main à la première personne (item=0 : main nue) ; swing=0..1, use=eat|bow|block,
 *                             progress=0..1, bob=phase, down=0..1 (rangement)
 *   ?view=icons               planche de toutes les icônes (onglets du créatif)
 * Communs : t (temps figé en secondes ; absent = animation), sky / block (lumière 0..15), night=1,
 *           cam=x,y,z et look=x,y,z, swingPhase (phase de marche).
 */
import * as THREE from 'three';
import { Atlas } from '../../src/render/Atlas';
import { worldUniforms } from '../../src/render/ChunkMaterials';
import { EntityRenderer } from '../../src/render/EntityRenderer';
import { HandRenderer, type HandState } from '../../src/render/HandRenderer';
import { ItemIcons } from '../../src/render/ItemIcons';
import type { EntityKind, EntityView } from '../../src/entity/EntityView';
import type { MobKind } from '../../src/entity/MobModels';
import { B, I } from '../../src/world/Ids';
import { CREATIVE_TABS, getItem } from '../../src/world/Items';

THREE.ColorManagement.enabled = false;

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => {
  const v = params.get(key);
  return v === null || v === '' ? fallback : Number(v);
};
const view = params.get('view') ?? 'mob';
const fixedTime = params.has('t') ? num('t', 0) : null;
const sky = num('sky', 15);
const blockLight = num('block', 0);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.autoClear = false;
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

if (params.get('night') === '1') worldUniforms.uSkyLight.value.setRGB(0.2, 0.22, 0.4);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 500);
const atlas = new Atlas();
const entities = new EntityRenderer(scene, atlas);
const hand = new HandRenderer(atlas);
const icons = new ItemIcons(renderer, atlas);
hand.visible = view === 'hand';
hand.setAspect(window.innerWidth / window.innerHeight);

// Sol en damier (cases d'un bloc) pour juger des tailles et des ombres
{
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const light = (x + y) % 2 === 0;
      data[o] = light ? 122 : 108;
      data[o + 1] = light ? 172 : 156;
      data[o + 2] = light ? 92 : 80;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
}

let nextId = 1;
function ent(kind: EntityKind, x: number, y: number, z: number, o: Partial<EntityView> = {}): EntityView {
  const yaw = o.yaw ?? Math.PI;
  const e: EntityView = {
    id: nextId++,
    kind,
    mobKind: 'pig',
    px: x,
    py: y,
    pz: z,
    x,
    y,
    z,
    pYaw: yaw,
    yaw,
    pHeadYaw: yaw,
    headYaw: yaw,
    pHeadPitch: 0,
    headPitch: 0,
    pLimbSwing: 0,
    limbSwing: 0,
    pLimbAmount: 0,
    limbAmount: 0,
    hurtTime: 0,
    deathTime: 0,
    age: 0,
    swing: 0,
    skyLight: sky,
    blockLight,
    itemId: 0,
    itemCount: 1,
    blockId: 0,
    blockMeta: 0,
    fuse: 0,
    woolColor: 0xffffff,
    sheared: false,
    sneaking: false,
    hidden: false,
    ...o,
  };
  if (o.yaw !== undefined) {
    e.pYaw = o.pYaw ?? yaw;
    e.pHeadYaw = o.pHeadYaw ?? o.headYaw ?? yaw;
    e.headYaw = o.headYaw ?? yaw;
  }
  if (o.headPitch !== undefined) e.pHeadPitch = o.pHeadPitch ?? o.headPitch;
  if (o.limbSwing !== undefined) e.pLimbSwing = o.pLimbSwing ?? o.limbSwing;
  if (o.limbAmount !== undefined) e.pLimbAmount = o.pLimbAmount ?? o.limbAmount;
  return e;
}

const list: EntityView[] = [];
/** Entités animées en continu quand le temps n'est pas figé. */
const walkers: EntityView[] = [];
let camPos = new THREE.Vector3(0, 2.2, 14);
let camLook = new THREE.Vector3(0, 0.9, 0);
const walkPhase = num('swingPhase', 1.2);
const FACE = Math.PI; // regarde la caméra (+z)

function mobRow(kind: MobKind, z: number, extra: Partial<EntityView> = {}): void {
  const step = kind === 'spider' ? 2.8 : 2;
  const x0 = -3 * step;
  const mk = (i: number, o: Partial<EntityView>): EntityView => {
    const e = ent(kind === 'player' ? 'player' : 'mob', x0 + i * step, 0, z, { mobKind: kind, ...extra, ...o });
    list.push(e);
    return e;
  };
  mk(0, { yaw: FACE });
  mk(1, { yaw: FACE + 0.7 });
  walkers.push(mk(2, { yaw: Math.PI / 2, limbSwing: walkPhase, limbAmount: 1 }));
  mk(3, { yaw: 0 });
  mk(4, { yaw: FACE - 0.7, headYaw: FACE - 0.7 + 0.8, headPitch: 0.4, hurtTime: 5 });
  mk(5, { yaw: FACE + 0.5, deathTime: 6 });
  mk(6, { yaw: FACE + 0.5, deathTime: 20 });
}

if (view === 'mob') {
  const kind = (params.get('kind') ?? 'pig') as MobKind;
  const extra: Partial<EntityView> = {};
  if (params.has('wool')) extra.woolColor = Number(params.get('wool'));
  if (params.get('sheared') === '1') extra.sheared = true;
  if (params.has('item')) extra.itemId = num('item', 0);
  if (params.has('fuse')) extra.fuse = num('fuse', 0);
  mobRow(kind, 0, extra);
  camPos.set(0, kind === 'spider' ? 2.6 : 2.2, kind === 'spider' ? 15 : 10.8);
  camLook.set(0, 0.8, 0);
} else if (view === 'special') {
  const p = (x: number, z: number, o: Partial<EntityView>): EntityView => {
    const e = ent('player', x, 0, z, { mobKind: 'player', ...o });
    list.push(e);
    return e;
  };
  const m = (kind: MobKind, x: number, z: number, o: Partial<EntityView>): EntityView => {
    const e = ent('mob', x, 0, z, { mobKind: kind, ...o });
    list.push(e);
    return e;
  };
  // Rang avant : joueur
  p(-7, 2, { yaw: FACE + 0.6, itemId: I.IRON_PICKAXE });
  p(-5, 2, { yaw: Math.PI / 2, itemId: I.IRON_SWORD });
  p(-3, 2, { yaw: FACE - 0.6, itemId: B.GRASS });
  p(-1, 2, { yaw: FACE + 0.6, itemId: I.IRON_PICKAXE, swing: 0.3 });
  p(1, 2, { yaw: Math.PI / 2, sneaking: true, itemId: I.DIAMOND_PICKAXE });
  p(3, 2, { yaw: FACE + 0.6, sneaking: true });
  p(5, 2, { yaw: FACE - 0.5, itemId: I.APPLE });
  walkers.push(p(7, 2, { yaw: -Math.PI / 2, limbSwing: walkPhase, limbAmount: 1, itemId: I.BOW }));
  // Rang arrière : créatures
  m('skeleton', -6, -2, { yaw: FACE + 0.6, itemId: I.BOW });
  m('skeleton', -4, -2, { yaw: Math.PI / 2, itemId: I.BOW, headPitch: 0.3 });
  m('zombie', -2, -2, { yaw: Math.PI / 2 });
  m('creeper', 0, -2, { yaw: FACE + 0.5, fuse: 0.55 });
  m('creeper', 2, -2, { yaw: FACE + 0.5, fuse: 0.95 });
  m('sheep', 4, -2, { yaw: FACE + 0.7, woolColor: 0xd9418c });
  m('sheep', 6, -2, { yaw: FACE + 0.7, sheared: true });
  m('chicken', 8, -2, { yaw: FACE + 0.6, y: 0.6, py: 0.5 });
  camPos.set(0.5, 3.6, 16.5);
  camLook.set(0.5, 0.8, 0);
} else if (view === 'things') {
  const drop = (x: number, z: number, itemId: number, itemCount: number): void => {
    list.push(ent('item', x, 0, z, { itemId, itemCount, age: 7 }));
  };
  drop(-5, 2, B.STONE, 1);
  drop(-4, 2, B.GRASS, 20);
  drop(-3, 2, B.OAK_LOG, 40);
  drop(-2, 2, I.IRON_PICKAXE, 1);
  drop(-1, 2, I.APPLE, 20);
  drop(0, 2, I.ARROW, 40);
  drop(1, 2, B.TALL_GRASS, 1);
  drop(2, 2, B.TORCH, 1);
  drop(3, 2, B.GLASS, 1);
  drop(4, 2, B.FURNACE, 1);
  drop(5, 2, B.OAK_STAIRS, 3);
  // TNT : éteinte, clignotante, sur le point d'exploser
  list.push(ent('tnt', -4.5, 0, 0, { blockId: B.TNT, fuse: 78 }));
  list.push(ent('tnt', -3, 0, 0, { blockId: B.TNT, fuse: 42 }));
  list.push(ent('tnt', -1.5, 0, 0, { blockId: B.TNT, fuse: 2 }));
  // Blocs qui tombent
  list.push(ent('falling_block', 0.5, 0.6, 0, { blockId: B.SAND }));
  list.push(ent('falling_block', 2, 0.3, 0, { blockId: B.FURNACE }));
  // Flèches : vers −z, vers +x, vers la caméra en montant, vers −x en piquant
  list.push(ent('arrow', 3.5, 0.6, 0, { yaw: 0 }));
  list.push(ent('arrow', 4.5, 0.6, 0, { yaw: -Math.PI / 2 }));
  list.push(ent('arrow', 5.5, 0.6, 0, { yaw: FACE - 0.6, headPitch: 0.6 }));
  list.push(ent('arrow', 6.5, 0.6, 0, { yaw: Math.PI / 2, headPitch: -0.8 }));
  camPos.set(0.5, 3.2, 12);
  camLook.set(0.5, 0.4, 0.6);
} else if (view === 'hand') {
  // Un petit décor derrière la main
  list.push(ent('mob', -1.5, 0, -5, { mobKind: 'pig', yaw: FACE + 0.6 }));
  list.push(ent('mob', 1.2, 0, -6, { mobKind: 'zombie', yaw: FACE - 0.3 }));
  list.push(ent('falling_block', 0, 0, -8, { blockId: B.STONE }));
  camera.fov = 70;
  camPos.set(0, 1.62, 0);
  camLook.set(0, 1.4, -6);
}

if (params.has('cam')) camPos.fromArray(params.get('cam')!.split(',').map(Number));
if (params.has('look')) camLook.fromArray(params.get('look')!.split(',').map(Number));
camera.position.copy(camPos);
camera.lookAt(camLook);
camera.updateProjectionMatrix();

// Main : état piloté par l'URL
const handState: HandState = {
  bobPhase: num('bob', 0),
  bobAmount: params.has('bob') ? 1 : 0,
  skyLight: sky,
  blockLight,
  useProgress: num('progress', 0),
  useKind: (params.get('use') ?? 'none') as HandState['useKind'],
  yawDelta: num('yawDelta', 0),
  pitchDelta: num('pitchDelta', 0),
};
if (view === 'hand') {
  hand.setItem(num('item', 0));
  // Laisse le temps de sortir l'objet et d'installer la pose d'utilisation
  for (let i = 0; i < 40; i++) hand.update(0.05, handState);
  if (params.has('swing')) {
    hand.swing();
    // Par petits pas : update() borne dt à 0,1 s
    for (let i = 0; i < 10; i++) hand.update((num('swing', 0) * 0.3) / 10, handState);
  }
  if (params.has('down')) {
    // Rangement en cours : on demande un autre objet et on avance d'une fraction
    hand.setItem(num('item', 0) === 0 ? B.STONE : 0);
    hand.update((num('down', 0) * 0.9) / 8, handState);
  }
}

// Planche d'icônes
if (view === 'icons') {
  renderer.domElement.style.display = 'none';
  const root = document.getElementById('icones')!;
  for (const tab of CREATIVE_TABS) {
    const title = document.createElement('h2');
    title.textContent = `${tab.label} (${tab.items.length})`;
    const tabIcon = document.createElement('span');
    tabIcon.style.cssText = 'display:inline-block;width:24px;height:24px;vertical-align:middle;margin-right:6px';
    icons.apply(tabIcon, tab.icon);
    title.prepend(tabIcon);
    root.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'grille';
    for (const id of tab.items) {
      const cell = document.createElement('div');
      cell.className = 'case';
      cell.title = `${id} ${getItem(id).label}`;
      icons.apply(cell, id);
      grid.appendChild(cell);
    }
    root.appendChild(grid);
  }
} else if (params.get('icons') === '1') {
  // Quelques icônes produites pendant le rendu : vérifie que l'état du renderer est bien restitué
  const root = document.getElementById('icones')!;
  const grid = document.createElement('div');
  grid.className = 'grille';
  root.appendChild(grid);
  let n = 0;
  const some = [B.GRASS, B.FURNACE, B.GLASS, B.TNT, I.IRON_PICKAXE, B.OAK_STAIRS];
  const timer = setInterval(() => {
    if (n >= some.length) {
      clearInterval(timer);
      return;
    }
    const cell = document.createElement('div');
    cell.className = 'case';
    icons.apply(cell, some[n++]);
    grid.appendChild(cell);
  }, 100);
}

const aide = document.getElementById('aide')!;
if (view !== 'icons') aide.textContent = `view=${view}  (mob&kind=… | special | things | hand&item=… | icons)`;
if (params.get('aide') === '0') aide.textContent = '';

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  hand.setAspect(camera.aspect);
});
window.addEventListener('mousedown', () => hand.swing());

let frames = 0;
let last = performance.now();
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const time = fixedTime ?? now / 1000;
  if (fixedTime === null) {
    // Animation continue : marche, âge (flottement des objets), mèche de la TNT
    for (const e of walkers) {
      e.pLimbSwing = e.limbSwing;
      e.limbSwing += dt * 12;
    }
    for (const e of list) {
      e.age = time * 20;
      if (e.kind === 'tnt') e.fuse = 80 - ((time * 20) % 80);
    }
    if (view === 'hand') {
      if (params.get('walk') === '1') {
        handState.bobPhase = time * 8;
        handState.bobAmount = 1;
      }
      hand.update(dt, handState);
    }
  }
  renderer.setClearColor(worldUniforms.uFogColor.value, 1);
  renderer.clear();
  entities.sync(list, 1, time);
  renderer.render(scene, camera);
  hand.render(renderer);
  frames++;
  if (frames === 3) (window as unknown as { __ready: boolean }).__ready = true;
}
frame();
