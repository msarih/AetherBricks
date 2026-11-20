/**
 * Physique des entités : boîte englobante alignée sur les axes, collisions avec le monde,
 * marches, fluides, échelles. Mêmes constantes que Minecraft (unités : blocs par tick, 20 ticks/s).
 */
import { BLOCKS, BLOCK_SHAPE, SHAPE } from '../world/Blocks';
import { fluidHeight } from '../world/BlockModels';
import { B } from '../world/Ids';
import type { World } from '../world/World';

export const GRAVITY = 0.08;
export const DRAG = 0.98;
export const JUMP_VELOCITY = 0.42;

export class Body {
  /** Position des pieds (centre de la base de la boîte). */
  x = 0;
  y = 0;
  z = 0;
  /** Position au tick précédent (interpolation du rendu). */
  px = 0;
  py = 0;
  pz = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  width = 0.6;
  height = 1.8;
  stepHeight = 0;
  onGround = false;
  /** A buté contre un mur pendant le dernier déplacement. */
  collidedH = false;
  collidedV = false;
  inWater = false;
  inLava = false;
  inWeb = false;
  onLadder = false;
  fallDistance = 0;
  /** Traverse les blocs (mode spectateur / débogage). */
  noClip = false;

  setPosition(x: number, y: number, z: number): void {
    this.x = this.px = x;
    this.y = this.py = y;
    this.z = this.pz = z;
  }
}

const boxes: number[] = [];
/**
 * Tolérance des tests de collision : la boîte est recalculée depuis le centre à chaque tick et l'arrondi
 * flottant peut placer un bord un cheveu dans un mur (2.3 - 0.3 = 1.9999999999999998), qui serait alors ignoré.
 */
const EPS = 1e-7;

function clipY(b: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dy: number): number {
  for (let i = 0; i < b.length; i += 6) {
    if (x1 <= b[i] + EPS || x0 >= b[i + 3] - EPS || z1 <= b[i + 2] + EPS || z0 >= b[i + 5] - EPS) continue;
    if (dy > 0 && y1 <= b[i + 1]) {
      const d = b[i + 1] - y1;
      if (d < dy) dy = d;
    } else if (dy < 0 && y0 >= b[i + 4]) {
      const d = b[i + 4] - y0;
      if (d > dy) dy = d;
    }
  }
  return dy;
}

function clipX(b: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dx: number): number {
  for (let i = 0; i < b.length; i += 6) {
    if (y1 <= b[i + 1] || y0 >= b[i + 4] || z1 <= b[i + 2] + EPS || z0 >= b[i + 5] - EPS) continue;
    if (dx > 0 && x1 <= b[i] + EPS) {
      const d = b[i] - x1;
      if (d < dx) dx = d;
    } else if (dx < 0 && x0 >= b[i + 3] - EPS) {
      const d = b[i + 3] - x0;
      if (d > dx) dx = d;
    }
  }
  return dx;
}

function clipZ(b: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, dz: number): number {
  for (let i = 0; i < b.length; i += 6) {
    if (x1 <= b[i] + EPS || x0 >= b[i + 3] - EPS || y1 <= b[i + 1] || y0 >= b[i + 4]) continue;
    if (dz > 0 && z1 <= b[i + 2] + EPS) {
      const d = b[i + 2] - z1;
      if (d < dz) dz = d;
    } else if (dz < 0 && z0 >= b[i + 5] - EPS) {
      const d = b[i + 5] - z0;
      if (d > dz) dz = d;
    }
  }
  return dz;
}

/** La boîte de l'entité, décalée de (dx, dy, dz), est-elle libre de toute collision ? */
export function isFree(w: World, b: Body, dx: number, dy: number, dz: number): boolean {
  const hw = b.width / 2;
  const x0 = b.x + dx - hw;
  const y0 = b.y + dy;
  const z0 = b.z + dz - hw;
  const x1 = b.x + dx + hw;
  const y1 = b.y + dy + b.height;
  const z1 = b.z + dz + hw;
  boxes.length = 0;
  w.collectCollisions(x0, y0, z0, x1, y1, z1, boxes);
  for (let i = 0; i < boxes.length; i += 6) {
    if (x1 > boxes[i] + EPS && x0 < boxes[i + 3] - EPS && y1 > boxes[i + 1] + EPS && y0 < boxes[i + 4] - EPS && z1 > boxes[i + 2] + EPS && z0 < boxes[i + 5] - EPS) return false;
  }
  return true;
}

/** Une boîte quelconque est-elle libre ? */
export function isBoxFree(w: World, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  boxes.length = 0;
  w.collectCollisions(x0, y0, z0, x1, y1, z1, boxes);
  for (let i = 0; i < boxes.length; i += 6) {
    if (x1 > boxes[i] + EPS && x0 < boxes[i + 3] - EPS && y1 > boxes[i + 1] + EPS && y0 < boxes[i + 4] - EPS && z1 > boxes[i + 2] + EPS && z0 < boxes[i + 5] - EPS) return false;
  }
  return true;
}

/**
 * Déplace l'entité de (dx, dy, dz) en s'arrêtant contre les blocs.
 * `edgeGuard` : ne quitte pas le bord d'un bloc (joueur accroupi).
 */
export function move(w: World, b: Body, dx: number, dy: number, dz: number, edgeGuard = false): void {
  if (b.noClip) {
    b.x += dx;
    b.y += dy;
    b.z += dz;
    b.onGround = false;
    b.collidedH = b.collidedV = false;
    return;
  }
  if (b.inWeb) {
    b.inWeb = false;
    dx *= 0.25;
    dy *= 0.05;
    dz *= 0.25;
    b.vx = b.vy = b.vz = 0;
  }

  if (edgeGuard && b.onGround) {
    const step = 0.05;
    while (dx !== 0 && isFree(w, b, dx, -1, 0)) {
      if (dx < step && dx >= -step) dx = 0;
      else if (dx > 0) dx -= step;
      else dx += step;
    }
    while (dz !== 0 && isFree(w, b, 0, -1, dz)) {
      if (dz < step && dz >= -step) dz = 0;
      else if (dz > 0) dz -= step;
      else dz += step;
    }
    while (dx !== 0 && dz !== 0 && isFree(w, b, dx, -1, dz)) {
      if (dx < step && dx >= -step) dx = 0;
      else if (dx > 0) dx -= step;
      else dx += step;
      if (dz < step && dz >= -step) dz = 0;
      else if (dz > 0) dz -= step;
      else dz += step;
    }
  }

  const odx = dx;
  const ody = dy;
  const odz = dz;
  const hw = b.width / 2;
  let x0 = b.x - hw;
  let y0 = b.y;
  let z0 = b.z - hw;
  let x1 = b.x + hw;
  let y1 = b.y + b.height;
  let z1 = b.z + hw;

  boxes.length = 0;
  w.collectCollisions(
    Math.min(x0, x0 + dx),
    Math.min(y0, y0 + dy),
    Math.min(z0, z0 + dz),
    Math.max(x1, x1 + dx),
    Math.max(y1, y1 + dy) + b.stepHeight,
    Math.max(z1, z1 + dz),
    boxes,
  );

  dy = clipY(boxes, x0, y0, z0, x1, y1, z1, dy);
  y0 += dy;
  y1 += dy;
  const grounded = b.onGround || (ody !== dy && ody < 0);
  dx = clipX(boxes, x0, y0, z0, x1, y1, z1, dx);
  x0 += dx;
  x1 += dx;
  dz = clipZ(boxes, x0, y0, z0, x1, y1, z1, dz);
  z0 += dz;
  z1 += dz;

  if (b.stepHeight > 0 && grounded && (odx !== dx || odz !== dz)) {
    // tentative de montée de marche
    const sx = dx;
    const sy = dy;
    const sz = dz;
    const ax0 = x0;
    const ay0 = y0;
    const az0 = z0;
    const ax1 = x1;
    const ay1 = y1;
    const az1 = z1;

    x0 = b.x - hw;
    y0 = b.y;
    z0 = b.z - hw;
    x1 = b.x + hw;
    y1 = b.y + b.height;
    z1 = b.z + hw;
    let uy = clipY(boxes, x0, y0, z0, x1, y1, z1, b.stepHeight);
    y0 += uy;
    y1 += uy;
    let ux = clipX(boxes, x0, y0, z0, x1, y1, z1, odx);
    x0 += ux;
    x1 += ux;
    let uz = clipZ(boxes, x0, y0, z0, x1, y1, z1, odz);
    z0 += uz;
    z1 += uz;
    const down = clipY(boxes, x0, y0, z0, x1, y1, z1, -b.stepHeight);
    y0 += down;
    y1 += down;
    uy += down;

    if (sx * sx + sz * sz >= ux * ux + uz * uz) {
      dx = sx;
      dy = sy;
      dz = sz;
      x0 = ax0;
      y0 = ay0;
      z0 = az0;
      x1 = ax1;
      y1 = ay1;
      z1 = az1;
    } else {
      dx = ux;
      dy = uy;
      dz = uz;
    }
  }

  b.x = (x0 + x1) / 2;
  b.y = y0;
  b.z = (z0 + z1) / 2;
  b.collidedH = odx !== dx || odz !== dz;
  b.collidedV = ody !== dy;
  b.onGround = ody !== dy && ody < 0;
  if (odx !== dx) b.vx = 0;
  if (odz !== dz) b.vz = 0;
  if (ody !== dy) b.vy = 0;
}

/** Met à jour inWater / inLava / onLadder / inWeb d'après les blocs que touche l'entité. */
export function updateMedium(w: World, b: Body): void {
  const hw = b.width / 2;
  b.inWater = fluidTouch(w, B.WATER, b.x - hw + 0.001, b.y + 0.4, b.z - hw + 0.001, b.x + hw - 0.001, b.y + b.height - 0.4, b.z + hw - 0.001);
  b.inLava = fluidTouch(w, B.LAVA, b.x - hw + 0.1, b.y + 0.4, b.z - hw + 0.1, b.x + hw - 0.1, b.y + b.height - 0.4, b.z + hw - 0.1);
  const bx = Math.floor(b.x);
  const by = Math.floor(b.y);
  const bz = Math.floor(b.z);
  const id = w.getBlock(bx, by, bz);
  b.onLadder = BLOCKS[id].climbable;
  b.inWeb = false;
  const x0 = Math.floor(b.x - hw + 0.001);
  const x1 = Math.floor(b.x + hw - 0.001);
  const z0 = Math.floor(b.z - hw + 0.001);
  const z1 = Math.floor(b.z + hw - 0.001);
  const yTop = Math.floor(b.y + b.height - 0.001);
  for (let y = by; y <= yTop && !b.inWeb; y++) {
    for (let z = z0; z <= z1 && !b.inWeb; z++) {
      for (let x = x0; x <= x1; x++) {
        if (w.getBlock(x, y, z) === B.COBWEB) {
          b.inWeb = true;
          break;
        }
      }
    }
  }
}

/** La boîte touche-t-elle le fluide donné (en tenant compte de la hauteur de sa surface) ? */
export function fluidTouch(w: World, fluid: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  if (y1 < y0) y1 = y0;
  const bx0 = Math.floor(x0);
  const bx1 = Math.floor(x1);
  const by0 = Math.floor(y0);
  const by1 = Math.floor(y1);
  const bz0 = Math.floor(z0);
  const bz1 = Math.floor(z1);
  for (let y = by0; y <= by1; y++) {
    for (let z = bz0; z <= bz1; z++) {
      for (let x = bx0; x <= bx1; x++) {
        const v = w.getBlockAndMeta(x, y, z);
        if ((v & 255) !== fluid) continue;
        let h = fluidHeight(v >> 8);
        if (w.getBlock(x, y + 1, z) === fluid) h = 1;
        if (y + h >= y0) return true;
      }
    }
  }
  return false;
}

/** Le point est-il dans le fluide donné ? */
export function pointInFluid(w: World, fluid: number, x: number, y: number, z: number): boolean {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  const v = w.getBlockAndMeta(bx, by, bz);
  if ((v & 255) !== fluid) return false;
  if (w.getBlock(bx, by + 1, bz) === fluid) return true;
  return y - by < fluidHeight(v >> 8) + 0.11;
}

/**
 * Courant du fluide dans la boîte : pousse les entités dans le sens de l'écoulement.
 * Retourne false si aucun courant.
 */
const flow = { x: 0, y: 0, z: 0 };
export function fluidPush(w: World, b: Body, fluid: number, strength: number): boolean {
  const hw = b.width / 2;
  const bx0 = Math.floor(b.x - hw + 0.001);
  const bx1 = Math.floor(b.x + hw - 0.001);
  const by0 = Math.floor(b.y + 0.4);
  const by1 = Math.floor(Math.max(b.y + 0.4, b.y + b.height - 0.4));
  const bz0 = Math.floor(b.z - hw + 0.001);
  const bz1 = Math.floor(b.z + hw - 0.001);
  flow.x = flow.y = flow.z = 0;
  let any = false;
  for (let y = by0; y <= by1; y++) {
    for (let z = bz0; z <= bz1; z++) {
      for (let x = bx0; x <= bx1; x++) {
        const v = w.getBlockAndMeta(x, y, z);
        if ((v & 255) !== fluid) continue;
        any = true;
        const meta = v >> 8;
        const level = meta & 8 ? 0 : meta & 7;
        for (let f = 0; f < 4; f++) {
          const dx = f === 0 ? -1 : f === 1 ? 1 : 0;
          const dz = f === 2 ? -1 : f === 3 ? 1 : 0;
          const n = w.getBlockAndMeta(x + dx, y, z + dz);
          const nid = n & 255;
          let nl = -1;
          if (nid === fluid) {
            const nm = n >> 8;
            nl = nm & 8 ? 0 : nm & 7;
          } else if (!BLOCKS[nid].solid) {
            // case libre : le fluide s'y déverse s'il peut tomber
            const below = w.getBlockAndMeta(x + dx, y - 1, z + dz);
            if ((below & 255) === fluid) {
              const bm = below >> 8;
              nl = (bm & 8 ? 0 : bm & 7) + 8;
            }
          }
          if (nl < 0) continue;
          const d = nl - level;
          flow.x += dx * d;
          flow.z += dz * d;
        }
        if (meta & 8) flow.y -= 6;
      }
    }
  }
  if (!any) return false;
  const len = Math.hypot(flow.x, flow.y, flow.z);
  if (len < 1e-6) return false;
  b.vx += (flow.x / len) * strength;
  b.vy += (flow.y / len) * strength;
  b.vz += (flow.z / len) * strength;
  return true;
}

/** Glissance du bloc sous les pieds (0.6 par défaut, 0.98 sur la glace). */
export function groundSlip(w: World, b: Body): number {
  const id = w.getBlock(Math.floor(b.x), Math.floor(b.y - 0.5001), Math.floor(b.z));
  return id === B.ICE ? 0.98 : 0.6;
}

/** Ajoute une accélération dans le repère de l'entité (lacet 0 = vers -z). */
export function moveRelative(b: Body, strafe: number, forward: number, accel: number, yaw: number): void {
  let d = strafe * strafe + forward * forward;
  if (d < 1e-4) return;
  d = Math.sqrt(d);
  if (d < 1) d = 1;
  const k = accel / d;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // avant = (-sin, -cos) ; droite = (cos, -sin)
  b.vx += (strafe * c - forward * s) * k;
  b.vz += (-strafe * s - forward * c) * k;
}

export interface TravelOptions {
  yaw: number;
  /** Vitesse de marche (0.1 pour le joueur). */
  speed: number;
  /** Accélération en l'air (0.02, 0.026 en sprint). */
  airAccel: number;
  sneaking: boolean;
  /** Vol libre (créatif) : pas de gravité. */
  flying: boolean;
  /** Empêche de quitter le bord d'un bloc. */
  edgeGuard: boolean;
  /** Efficacité de nage (0.02 par défaut). */
  swimAccel?: number;
}

/**
 * Un tick de déplacement d'un être vivant : accélération selon les commandes, déplacement, frottements, gravité.
 * strafe > 0 = vers la droite, forward > 0 = vers l'avant.
 */
export function travel(w: World, b: Body, strafe: number, forward: number, o: TravelOptions): void {
  if (o.flying) {
    const vy = b.vy;
    moveRelative(b, strafe, forward, o.airAccel, o.yaw);
    move(w, b, b.vx, b.vy, b.vz);
    b.vx *= 0.91;
    b.vz *= 0.91;
    b.vy = vy * 0.6;
    b.fallDistance = 0;
    return;
  }
  if (b.inWater) {
    const y0 = b.y;
    moveRelative(b, strafe, forward, o.swimAccel ?? 0.02, o.yaw);
    move(w, b, b.vx, b.vy, b.vz);
    b.vx *= 0.8;
    b.vy *= 0.8;
    b.vz *= 0.8;
    b.vy -= 0.02;
    if (b.collidedH && isFree(w, b, b.vx, b.vy + 0.6 - b.y + y0, b.vz)) b.vy = 0.3;
    b.fallDistance = 0;
    return;
  }
  if (b.inLava) {
    const y0 = b.y;
    moveRelative(b, strafe, forward, 0.02, o.yaw);
    move(w, b, b.vx, b.vy, b.vz);
    b.vx *= 0.5;
    b.vy *= 0.5;
    b.vz *= 0.5;
    b.vy -= 0.02;
    if (b.collidedH && isFree(w, b, b.vx, b.vy + 0.6 - b.y + y0, b.vz)) b.vy = 0.3;
    b.fallDistance *= 0.5;
    return;
  }

  const slip = b.onGround ? groundSlip(w, b) * 0.91 : 0.91;
  const accel = b.onGround ? o.speed * (0.16277136 / (slip * slip * slip)) : o.airAccel;
  moveRelative(b, strafe, forward, accel, o.yaw);

  if (b.onLadder) {
    const m = 0.15;
    if (b.vx < -m) b.vx = -m;
    else if (b.vx > m) b.vx = m;
    if (b.vz < -m) b.vz = -m;
    else if (b.vz > m) b.vz = m;
    b.fallDistance = 0;
    if (b.vy < -0.15) b.vy = -0.15;
    if (o.sneaking && b.vy < 0) b.vy = 0;
  }

  const yBefore = b.y;
  move(w, b, b.vx, b.vy, b.vz, o.edgeGuard);
  if (b.collidedH && b.onLadder) b.vy = 0.2;

  // distance de chute : l'appelant applique les dégâts à l'atterrissage puis la remet à zéro
  if (b.y < yBefore) b.fallDistance += yBefore - b.y;

  b.vy -= GRAVITY;
  b.vy *= DRAG;
  b.vx *= slip;
  b.vz *= slip;
}
