/**
 * Entités inertes : objet au sol, bloc qui tombe, TNT amorcée, flèche, projectile lancé (œuf, boule de neige),
 * flotteur de canne à pêche.
 */
import { BLOCK_REPLACEABLE, BLOCK_SHAPE, SHAPE } from '../world/Blocks';
import { fluidHeight } from '../world/BlockModels';
import { FISHING_BITE_MAX, FISHING_BITE_MIN, FISHING_WAIT_MAX, FISHING_WAIT_MIN, rollFishingCatch } from '../world/Fishing';
import { B, I } from '../world/Ids';
import { maxStack } from '../world/Items';
import { canMerge, makeStack, sanitizeEnchants, type ItemStack } from '../world/ItemStack';
import { newRayHit, rayBoxDistance, raycast } from '../world/Raycast';
import { Entity, Living, num, type DamageCause, type EntityData, type GameApi, type PlayerLike } from './Entity';
import type { EntityKind } from './EntityView';
import { groundSlip, move, pointInFluid, updateMedium } from './Physics';

const hit = newRayHit();

// ---------------------------------------------------------------------------------------- objet au sol

export class ItemEntity extends Entity {
  readonly kind: EntityKind = 'item';
  stack: ItemStack;
  /** Ticks avant que le joueur puisse ramasser l'objet. */
  pickupDelay = 10;

  constructor(stack: ItemStack) {
    super();
    this.stack = stack;
    this.width = 0.25;
    this.height = 0.25;
    this.itemId = stack.id;
    this.itemCount = stack.count;
    this.setRotation(Math.random() * Math.PI * 2);
  }

  tick(game: GameApi): void {
    this.beginTick();
    const w = game.world;
    if (this.pickupDelay > 0) this.pickupDelay--;

    updateMedium(w, this);
    if (this.inLava || this.touchesBlock(w, B.FIRE)) {
      this.dead = true;
      game.sound('fizz', this.x, this.y, this.z, 0.4, 2);
      game.particles('smoke', this.x, this.y + 0.2, this.z, 4, 0.1);
      return;
    }
    if (this.inWater) {
      this.vx *= 0.99;
      this.vz *= 0.99;
      if (this.vy < 0.06) this.vy += 0.02;
    } else {
      this.vy -= 0.04;
    }
    // coincé dans un bloc plein : on remonte
    if (w.isOpaque(Math.floor(this.x), Math.floor(this.y + 0.125), Math.floor(this.z))) {
      this.y += 0.15;
      this.vy = 0;
      this.vx *= 0.5;
      this.vz *= 0.5;
    } else {
      move(w, this, this.vx, this.vy, this.vz);
    }
    const f = this.onGround ? groundSlip(w, this) * 0.98 : 0.98;
    this.vx *= f;
    this.vy *= 0.98;
    this.vz *= f;

    if (this.age % 20 === this.id % 20 && this.stack.count < maxStack(this.stack.id)) this.mergeNearby(game);

    const p = game.player;
    if (this.pickupDelay === 0 && p.alive) {
      const hw = this.width / 2;
      if (p.intersects(this.x - hw - 1, this.y - 0.5, this.z - hw - 1, this.x + hw + 1, this.y + this.height + 0.5, this.z + hw + 1)) {
        const before = this.stack.count;
        const left = p.collect(this.stack);
        if (left < before) {
          game.sound('pop', this.x, this.y, this.z, 0.5, 1.4 + game.rng() * 0.8);
          this.stack.count = left;
          this.itemCount = left;
          if (left <= 0) this.dead = true;
        }
      }
    }

    if (this.age >= 6000) this.dead = true;
    if (this.y < -64) this.dead = true;
    this.updateLight(w);
  }

  private mergeNearby(game: GameApi): void {
    const others = game.entitiesInBox(this.x - 0.6, this.y - 0.3, this.z - 0.6, this.x + 0.6, this.y + 0.6, this.z + 0.6, this);
    const max = maxStack(this.stack.id);
    for (const o of others) {
      if (!(o instanceof ItemEntity) || o.dead) continue;
      if (!canMerge(this.stack, o.stack)) continue;
      if (this.stack.count + o.stack.count > max) continue;
      this.stack.count += o.stack.count;
      this.itemCount = this.stack.count;
      this.pickupDelay = Math.max(this.pickupDelay, o.pickupDelay);
      this.age = Math.min(this.age, o.age);
      o.dead = true;
    }
  }

  save(): EntityData {
    const d = this.saveBase('item');
    d.id = this.stack.id;
    d.count = this.stack.count;
    d.damage = this.stack.damage;
    if (this.stack.enchants && Object.keys(this.stack.enchants).length > 0) d.enchants = { ...this.stack.enchants };
    return d;
  }

  static load(d: EntityData): ItemEntity | null {
    const id = num(d.id, 0);
    const count = num(d.count, 0);
    if (id <= 0 || count <= 0) return null;
    const stack = makeStack(id, count, num(d.damage, 0), sanitizeEnchants(d.enchants));
    const e = new ItemEntity(stack);
    e.loadBase(d);
    return e;
  }
}

// ---------------------------------------------------------------------------------------- bloc qui tombe

export class FallingBlock extends Entity {
  readonly kind: EntityKind = 'falling_block';

  constructor(id: number, meta: number) {
    super();
    this.blockId = id;
    this.blockMeta = meta;
    this.width = 0.98;
    this.height = 0.98;
  }

  tick(game: GameApi): void {
    this.beginTick();
    const w = game.world;
    this.vy -= 0.04;
    move(w, this, this.vx, this.vy, this.vz);
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.vz *= 0.98;
    this.updateLight(w);

    if (this.onGround) {
      this.dead = true;
      const bx = Math.floor(this.x);
      const by = Math.floor(this.y + 0.5);
      const bz = Math.floor(this.z);
      const at = w.getBlock(bx, by, bz);
      if (BLOCK_REPLACEABLE[at] && w.setBlock(bx, by, bz, this.blockId, this.blockMeta)) {
        game.blockSound('place', this.blockId, bx + 0.5, by + 0.5, bz + 0.5);
      } else {
        game.dropItem(this.x, this.y + 0.3, this.z, this.blockId, 1);
      }
    } else if (this.age > 600 || this.y < -64) {
      this.dead = true;
      if (this.y >= 0) game.dropItem(this.x, this.y, this.z, this.blockId, 1);
    }
  }

  save(): EntityData {
    const d = this.saveBase('falling_block');
    d.block = this.blockId;
    d.meta = this.blockMeta;
    return d;
  }

  static load(d: EntityData): FallingBlock | null {
    const id = num(d.block, 0);
    if (id <= 0 || id > 255) return null;
    const e = new FallingBlock(id, num(d.meta, 0));
    e.loadBase(d);
    return e;
  }
}

// ---------------------------------------------------------------------------------------- TNT

export class Tnt extends Entity {
  readonly kind: EntityKind = 'tnt';

  constructor(fuse = 80) {
    super();
    this.blockId = B.TNT;
    this.fuse = fuse;
    this.width = 0.98;
    this.height = 0.98;
  }

  tick(game: GameApi): void {
    this.beginTick();
    const w = game.world;
    this.vy -= 0.04;
    move(w, this, this.vx, this.vy, this.vz);
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.vz *= 0.98;
    if (this.onGround) {
      this.vx *= 0.7;
      this.vz *= 0.7;
    }
    this.updateLight(w);
    this.fuse--;
    if (this.fuse <= 0) {
      this.dead = true;
      game.explode(this.x, this.y + 0.49, this.z, 4, false, this);
    } else if ((this.age & 1) === 0) {
      game.particles('smoke', this.x, this.y + 1.05, this.z, 1, 0.05);
    }
  }

  save(): EntityData {
    const d = this.saveBase('tnt');
    d.fuse = this.fuse;
    return d;
  }

  static load(d: EntityData): Tnt {
    const e = new Tnt(num(d.fuse, 80));
    e.loadBase(d);
    return e;
  }
}

// ---------------------------------------------------------------------------------------- projectiles

/** Cherche la première entité touchée par le segment de vol. Retourne l'entité et renseigne `hitDist`. */
let hitDist = 0;
function sweepEntities(game: GameApi, self: Entity, owner: Entity | null, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): Entity | null {
  const ex = ox + dx * max;
  const ey = oy + dy * max;
  const ez = oz + dz * max;
  const list = game.entitiesInBox(Math.min(ox, ex) - 1, Math.min(oy, ey) - 1, Math.min(oz, ez) - 1, Math.max(ox, ex) + 1, Math.max(oy, ey) + 1, Math.max(oz, ez) + 1, self);
  let best: Entity | null = null;
  let bestT = max;
  for (const e of list) {
    if (!e.pickable) continue;
    if (e === owner && self.age < 5) continue;
    const hw = e.width / 2 + 0.3;
    const t = rayBoxDistance(ox, oy, oz, dx, dy, dz, e.x - hw, e.y - 0.3, e.z - hw, e.x + hw, e.y + e.height + 0.3, e.z + hw, bestT);
    if (t >= 0 && t <= bestT) {
      bestT = t;
      best = e;
    }
  }
  hitDist = bestT;
  return best;
}

export class Arrow extends Entity {
  readonly kind: EntityKind = 'arrow';
  owner: Entity | null = null;
  /** Dégâts par unité de vitesse (2 par défaut : 6 à pleine puissance). */
  damage = 2;
  /** Niveau de l'enchantement Puissance sur l'arc (0 = aucun). */
  powerLevel = 0;
  critical = false;
  /** Tirée par le joueur : il peut la ramasser. */
  fromPlayer = false;
  inGround = false;
  private stuckX = 0;
  private stuckY = 0;
  private stuckZ = 0;
  private stuckId = 0;
  private groundTicks = 0;

  constructor() {
    super();
    this.width = 0.3;
    this.height = 0.3;
  }

  /** Lance la flèche depuis (x, y, z) dans la direction donnée, à `speed` blocs par tick, avec une dispersion. */
  shoot(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, spread: number, rng: () => number): void {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const s = 0.0075 * spread;
    this.vx = (dx / len + (rng() - 0.5) * 2 * s) * speed;
    this.vy = (dy / len + (rng() - 0.5) * 2 * s) * speed;
    this.vz = (dz / len + (rng() - 0.5) * 2 * s) * speed;
    this.setPosition(x, y, z);
    this.aim();
    this.pYaw = this.yaw;
    this.pHeadPitch = this.headPitch;
    this.pHeadYaw = this.headYaw;
  }

  private aim(): void {
    const h = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (h < 1e-6 && Math.abs(this.vy) < 1e-6) return;
    this.yaw = this.headYaw = Math.atan2(-this.vx, -this.vz);
    this.headPitch = Math.atan2(this.vy, h);
  }

  tick(game: GameApi): void {
    this.beginTick();
    const w = game.world;
    this.updateLight(w);

    if (this.inGround) {
      if (w.getBlock(this.stuckX, this.stuckY, this.stuckZ) !== this.stuckId) {
        // le bloc porteur a disparu : la flèche retombe
        this.inGround = false;
        this.vx = (game.rng() - 0.5) * 0.1;
        this.vy = 0;
        this.vz = (game.rng() - 0.5) * 0.1;
      } else {
        if (++this.groundTicks >= 1200) this.dead = true;
        const p = game.player;
        if (this.fromPlayer && this.groundTicks > 10 && p.alive && p.intersects(this.x - 1, this.y - 0.5, this.z - 1, this.x + 1, this.y + 0.8, this.z + 1)) {
          if (p.gameMode === 'creative' || p.collect({ id: I.ARROW, count: 1, damage: 0 }) === 0) {
            game.sound('pop', this.x, this.y, this.z, 0.5, 1.6);
            this.dead = true;
          }
        }
        return;
      }
    }

    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
    if (speed > 1e-6) {
      const dx = this.vx / speed;
      const dy = this.vy / speed;
      const dz = this.vz / speed;
      const oy = this.y + 0.15;
      let max = speed;
      const blockHit = raycast(w, this.x, oy, this.z, dx, dy, dz, speed, hit, true);
      if (blockHit) max = hit.dist;
      const target = sweepEntities(game, this, this.owner, this.x, oy, this.z, dx, dy, dz, max);
      if (target) {
        let amount = Math.ceil(speed * this.damage);
        if (this.powerLevel > 0) amount = Math.ceil(amount * (1 + 0.25 * (this.powerLevel + 1)));
        if (this.critical) amount += Math.floor(game.rng() * (amount / 2 + 2));
        if (target.hurt(game, amount, 'arrow', this.owner)) {
          if (this.fireTicks > 0) target.fireTicks = Math.max(target.fireTicks, 100);
          game.sound('arrow_hit', this.x, this.y, this.z, 1, 1.1 + game.rng() * 0.2);
          this.dead = true;
          return;
        }
        // cible invulnérable : la flèche rebondit
        this.vx *= -0.1;
        this.vy *= -0.1;
        this.vz *= -0.1;
        this.aim();
        return;
      }
      if (blockHit) {
        const back = 0.05;
        this.x = hit.hx - dx * back;
        this.y = hit.hy - dy * back - 0.15;
        this.z = hit.hz - dz * back;
        this.vx = this.vy = this.vz = 0;
        this.inGround = true;
        this.groundTicks = 0;
        this.stuckX = hit.x;
        this.stuckY = hit.y;
        this.stuckZ = hit.z;
        this.stuckId = hit.id;
        this.critical = false;
        game.sound('arrow_hit', this.x, this.y, this.z, 1, 1.1 + game.rng() * 0.2);
        return;
      }
      this.x += this.vx;
      this.y += this.vy;
      this.z += this.vz;
      this.aim();
    }

    updateMedium(w, this);
    let drag = 0.99;
    if (this.inWater) {
      drag = 0.6;
      game.particles('bubble', this.x, this.y, this.z, 2, 0.1);
      this.fireTicks = 0;
    }
    if (this.critical && speed > 0.5) game.particles('crit', this.x, this.y + 0.15, this.z, 1, 0.1);
    this.vx *= drag;
    this.vy *= drag;
    this.vz *= drag;
    this.vy -= 0.05;
    if (this.y < -64 || this.age > 2400) this.dead = true;
  }

  save(): EntityData | null {
    if (!this.inGround) return null;
    const d = this.saveBase('arrow');
    d.pitch = this.headPitch;
    d.fromPlayer = this.fromPlayer;
    d.block = [this.stuckX, this.stuckY, this.stuckZ, this.stuckId];
    return d;
  }

  static load(d: EntityData): Arrow {
    const e = new Arrow();
    e.loadBase(d);
    e.vx = e.vy = e.vz = 0;
    e.headPitch = e.pHeadPitch = num(d.pitch, 0);
    e.fromPlayer = d.fromPlayer === true;
    const b = d.block;
    if (Array.isArray(b) && b.length === 4) {
      e.inGround = true;
      e.stuckX = num(b[0], 0);
      e.stuckY = num(b[1], 0);
      e.stuckZ = num(b[2], 0);
      e.stuckId = num(b[3], 0);
    }
    return e;
  }
}

/** Œuf ou boule de neige en vol. */
export class Thrown extends Entity {
  readonly kind: EntityKind = 'item';
  owner: Entity | null = null;
  /** Appelé quand un œuf se brise (apparition éventuelle d'un poussin) : branché par le jeu. */
  static onEggBreak: ((game: GameApi, x: number, y: number, z: number) => void) | null = null;
  /** Chute par tick (une potion tombe plus vite qu'un œuf). */
  protected gravity = 0.03;

  constructor(itemId: number) {
    super();
    this.itemId = itemId;
    this.itemCount = 1;
    this.width = 0.25;
    this.height = 0.25;
  }

  shoot(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number): void {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;
    this.vz = (dz / len) * speed;
    this.setPosition(x, y, z);
  }

  tick(game: GameApi): void {
    this.beginTick();
    const w = game.world;
    this.updateLight(w);
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
    if (speed > 1e-6) {
      const dx = this.vx / speed;
      const dy = this.vy / speed;
      const dz = this.vz / speed;
      const oy = this.y + 0.125;
      let max = speed;
      const blockHit = raycast(w, this.x, oy, this.z, dx, dy, dz, speed, hit, true);
      if (blockHit) max = hit.dist;
      const target = sweepEntities(game, this, this.owner, this.x, oy, this.z, dx, dy, dz, max);
      if (target || blockHit) {
        const d = target ? hitDist : hit.dist;
        const x = this.x + dx * d;
        const y = oy + dy * d;
        const z = this.z + dz * d;
        this.dead = true;
        this.impact(game, x, y, z, target instanceof Living ? target : null, dx, dz);
        return;
      }
      this.x += this.vx;
      this.y += this.vy;
      this.z += this.vz;
    }
    this.vx *= 0.99;
    this.vy *= 0.99;
    this.vz *= 0.99;
    this.vy -= this.gravity;
    if (this.y < -64 || this.age > 600) this.dead = true;
  }

  /** Le projectile se brise en (x, y, z), sur `target` s'il a touché un être vivant. */
  protected impact(game: GameApi, x: number, y: number, z: number, target: Living | null, dx: number, dz: number): void {
    if (target) {
      // aucun dégât, mais un recul et l'éclair rouge
      const cause: DamageCause = 'generic';
      if (!target.hurt(game, 0.001, cause, this.owner)) target.knockback(dx, dz, 0.3);
    }
    if (this.itemId === I.EGG) {
      game.itemParticles(x, y, z, I.EGG, 8);
      Thrown.onEggBreak?.(game, x, y, z);
    } else {
      game.particles('snow', x, y, z, 8, 0.1);
    }
  }
}

export type PotionEffect = 'harm' | 'poison' | 'slow' | 'weak';

/** Rayon d'action d'une potion jetable, en blocs. */
const SPLASH_RADIUS = 4;

/**
 * Potion jetable (sorcière) : en se brisant, elle touche tous les êtres vivants à moins de
 * 4 blocs, d'autant plus fort qu'ils sont près. Les sorcières y sont insensibles.
 */
export class ThrownPotion extends Thrown {
  constructor(readonly effect: PotionEffect) {
    super(I.SPLASH_POTION);
    this.gravity = 0.05;
  }

  protected override impact(game: GameApi, x: number, y: number, z: number, target: Living | null): void {
    game.blockSound('break', B.GLASS, x, y, z);
    game.particles('splash', x, y, z, 24, 0.8);
    game.particles(this.effect === 'harm' ? 'crit' : 'slime', x, y + 0.2, z, 12, 1.2);
    const r = SPLASH_RADIUS;
    for (const e of game.entitiesInBox(x - r, y - 2, z - r, x + r, y + 2, z + r, null)) {
      if (!(e instanceof Living) || !e.alive || e.mobKind === 'witch') continue;
      const d = Math.sqrt(e.distanceSq(x, y - e.height * 0.5, z));
      if (e !== target && d >= r) continue;
      applyPotion(game, e, this.effect, e === target ? 1 : 1 - d / r, this.owner);
    }
  }
}

/** Applique l'effet d'une potion à un être vivant, avec une force de 0 à 1. */
export function applyPotion(game: GameApi, e: Living, effect: PotionEffect, strength: number, source: Entity | null): void {
  if (strength <= 0) return;
  switch (effect) {
    case 'harm':
      e.hurt(game, Math.max(1, Math.round(6 * strength)), 'magic', source);
      break;
    case 'poison':
      e.poisonTicks = Math.max(e.poisonTicks, Math.round(900 * strength));
      break;
    case 'slow':
      e.slowTicks = Math.max(e.slowTicks, Math.round(1800 * strength));
      break;
    default:
      e.weakTicks = Math.max(e.weakTicks, Math.round(1800 * strength));
      break;
  }
}

// ---------------------------------------------------------------------------------------- pêche

/** Longueur maximale de la ligne, en blocs : au-delà, elle casse. */
const LINE_MAX = 32;
/** Ticks pendant lesquels un sillage annonce la touche. */
const TRAIL_TICKS = 30;

/** Hauteur (y du monde) de la surface de l'eau à la verticale du point s'il est dans l'eau, NaN sinon. */
function waterSurfaceAt(w: GameApi['world'], x: number, y: number, z: number): number {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  let by = Math.floor(y);
  let v = w.getBlockAndMeta(bx, by, bz);
  if ((v & 255) !== B.WATER) return NaN;
  for (let i = 0; i < 8; i++) {
    const up = w.getBlockAndMeta(bx, by + 1, bz);
    if ((up & 255) !== B.WATER) break;
    by++;
    v = up;
  }
  const surface = by + fluidHeight(v >> 8);
  return y <= surface ? surface : NaN;
}

/**
 * Flotteur d'une canne à pêche. Lancé par le joueur, il vole, flotte à la surface de l'eau et
 * s'enfonce quand un poisson mord : remonter la ligne à ce moment-là rapporte une prise.
 * Il n'est pas sauvegardé et disparaît si le pêcheur meurt, range sa canne ou s'éloigne.
 */
export class FishingBobber extends Entity {
  readonly kind: EntityKind = 'bobber';
  /** Ticks avant la prochaine touche (0 = pas encore tirés au sort). */
  waitTicks = 0;
  /** Ticks restants de la touche en cours (> 0 : un poisson mord). */
  biteTicks = 0;
  /** À la surface de l'eau. */
  floating = false;
  /** Posé sur le sol. */
  grounded = false;
  /** Créature accrochée par l'hameçon. */
  hooked: Entity | null = null;
  private trailAngle = 0;

  constructor(readonly owner: PlayerLike) {
    super();
    this.width = 0.25;
    this.height = 0.25;
  }

  /** Lance le flotteur depuis (x, y, z) dans la direction donnée, à `speed` blocs par tick. */
  cast(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number): void {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;
    this.vz = (dz / len) * speed;
    this.setPosition(x, y, z);
  }

  tick(game: GameApi): void {
    this.beginTick();
    const w = game.world;
    this.updateLight(w);
    const p = this.owner;
    if (!p.alive || p.heldItemId !== I.FISHING_ROD || this.distanceSqTo(p) > LINE_MAX * LINE_MAX || this.y < -64) {
      this.dead = true;
      return;
    }

    const h = this.hooked;
    if (h) {
      if (h.dead || !h.pickable) this.hooked = null;
      else {
        this.x = h.x;
        this.y = h.y + h.height * 0.8;
        this.z = h.z;
        this.vx = this.vy = this.vz = 0;
        return;
      }
    }

    // une fois à l'eau, le point de mesure descend un peu : le flotteur qui danse ne « sort » pas de l'eau
    const surface = waterSurfaceAt(w, this.x, this.y - (this.floating ? 0.2 : 0), this.z);
    if (!Number.isNaN(surface)) {
      if (!this.floating) {
        this.floating = true;
        this.grounded = false;
        game.sound('splash', this.x, this.y, this.z, 0.3, 1.4 + game.rng() * 0.4);
        game.particles('splash', this.x, surface + 0.05, this.z, 6, 0.15);
      }
      // ressort amorti vers la ligne de flottaison ; pendant une touche, le flotteur est tiré sous l'eau
      const target = surface - 0.1 - (this.biteTicks > 0 ? 0.3 : 0);
      this.vy = (this.vy + (target - this.y) * 0.15) * 0.7;
      this.vx *= 0.8;
      this.vz *= 0.8;
      move(w, this, this.vx, this.vy, this.vz);
      this.tickBite(game, surface);
      return;
    }
    this.floating = false;
    this.waitTicks = 0;
    this.biteTicks = 0;

    // en vol : l'hameçon peut accrocher une créature
    if (!this.grounded) {
      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
      if (speed > 1e-6) {
        const target = sweepEntities(game, this, p, this.x, this.y + 0.125, this.z, this.vx / speed, this.vy / speed, this.vz / speed, speed);
        if (target && target !== p) {
          this.hooked = target;
          return;
        }
      }
    }
    this.vy -= 0.03;
    move(w, this, this.vx, this.vy, this.vz);
    this.grounded = this.onGround;
    if (this.onGround) this.vx = this.vz = 0;
    else {
      this.vx *= 0.92;
      this.vy *= 0.92;
      this.vz *= 0.92;
    }
  }

  /** Attente, sillage qui approche, puis touche. */
  private tickBite(game: GameApi, surface: number): void {
    const rng = game.rng;
    const w = game.world;
    if (this.biteTicks > 0) {
      this.biteTicks--;
      if (this.age % 3 === 0) game.particles('splash', this.x, surface + 0.05, this.z, 2, 0.15);
      return;
    }
    if (this.waitTicks <= 0) {
      this.waitTicks = FISHING_WAIT_MIN + Math.floor(rng() * (FISHING_WAIT_MAX - FISHING_WAIT_MIN));
      return;
    }
    const before = this.waitTicks;
    // sous la pluie, le poisson mord plus vite
    this.waitTicks -= w.raining && rng() < 0.25 && w.canSeeSky(Math.floor(this.x), Math.floor(surface) + 1, Math.floor(this.z)) ? 2 : 1;
    if (this.waitTicks <= 0) {
      this.waitTicks = 0;
      this.biteTicks = FISHING_BITE_MIN + Math.floor(rng() * (FISHING_BITE_MAX - FISHING_BITE_MIN));
      this.vy -= 0.2;
      game.sound('splash', this.x, this.y, this.z, 0.5, 0.9 + rng() * 0.3);
      game.particles('bubble', this.x, surface - 0.25, this.z, 6, 0.2);
      game.particles('splash', this.x, surface + 0.05, this.z, 10, 0.2);
      return;
    }
    if (this.waitTicks <= TRAIL_TICKS) {
      if (before > TRAIL_TICKS) this.trailAngle = rng() * Math.PI * 2;
      const d = 0.2 + (this.waitTicks / TRAIL_TICKS) * 2.5;
      const tx = this.x + Math.sin(this.trailAngle) * d;
      const tz = this.z + Math.cos(this.trailAngle) * d;
      if (pointInFluid(w, B.WATER, tx, surface - 0.3, tz)) game.particles('splash', tx, surface + 0.05, tz, 1, 0.04);
    }
  }

  /**
   * Remonte la ligne. Un poisson qui mord donne une prise, lancée vers le pêcheur, et de l'expérience ;
   * une créature accrochée est tirée vers lui. Retourne l'usure à appliquer à la canne.
   */
  reel(game: GameApi): number {
    if (this.dead) return 0;
    this.dead = true;
    const p = this.owner;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dz = p.z - this.z;
    const lift = Math.sqrt(Math.sqrt(dx * dx + dy * dy + dz * dz)) * 0.08;
    const h = this.hooked;
    if (h && !h.dead) {
      h.vx += dx * 0.1;
      h.vy += dy * 0.1 + lift;
      h.vz += dz * 0.1;
      return 5;
    }
    if (this.biteTicks > 0) {
      const caught = rollFishingCatch(game.rng);
      if (caught.id === I.RAW_FISH) p.addStat('fish_caught');
      const item = new ItemEntity(caught);
      item.setPosition(this.x, this.y + 0.1, this.z);
      item.vx = dx * 0.1;
      item.vy = dy * 0.1 + lift;
      item.vz = dz * 0.1;
      game.spawn(item);
      p.addXp(1 + Math.floor(game.rng() * 6));
      return 1;
    }
    return this.grounded ? 2 : 0;
  }
}

/** Boule de feu tirée par un ghast : vole en ligne droite, explose à l'impact et peut être renvoyée en la frappant. */
export class Fireball extends Entity {
  readonly kind: EntityKind = 'fireball';
  owner: Entity | null = null;
  deflected = false;
  /** Petite boule de feu de blaze : brûle sa cible sans rien faire exploser. */
  small = false;

  constructor(small = false) {
    super();
    this.small = small;
    this.width = small ? 0.4 : 1;
    this.height = small ? 0.4 : 1;
    if (small) this.mobScale = 0.45;
  }

  /** Seule la grosse boule de feu du ghast se renvoie d'un coup. */
  override get pickable(): boolean {
    return !this.dead && !this.small;
  }

  shoot(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed = 0.55): void {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;
    this.vz = (dz / len) * speed;
    this.setPosition(x, y, z);
    this.yaw = this.headYaw = Math.atan2(-this.vx, -this.vz);
    this.headPitch = Math.atan2(this.vy, Math.sqrt(this.vx * this.vx + this.vz * this.vz));
    this.pYaw = this.yaw;
    this.pHeadYaw = this.headYaw;
    this.pHeadPitch = this.headPitch;
  }

  override hurt(game: GameApi, _amount: number, _cause: DamageCause, attacker: Entity | null): boolean {
    if (this.dead || !attacker) return false;
    const speed = Math.max(0.6, Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz));
    const dx = this.x - attacker.x;
    const dy = this.y + this.height * 0.5 - (attacker.y + attacker.height * 0.8);
    const dz = this.z - attacker.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;
    this.vz = (dz / len) * speed;
    this.owner = attacker;
    this.deflected = true;
    this.age = 0;
    game.sound('fizz', this.x, this.y, this.z, 0.8, 1.3);
    return true;
  }

  tick(game: GameApi): void {
    this.beginTick();
    const w = game.world;
    this.updateLight(w);
    if (this.age > 240) {
      this.dead = true;
      return;
    }

    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
    if (speed > 1e-6) {
      const dx = this.vx / speed;
      const dy = this.vy / speed;
      const dz = this.vz / speed;
      const oy = this.y + 0.5;
      let max = speed;
      const blockHit = raycast(w, this.x, oy, this.z, dx, dy, dz, speed, hit, true);
      if (blockHit) max = hit.dist;
      const target = sweepEntities(game, this, this.owner, this.x, oy, this.z, dx, dy, dz, max);
      if (target) {
        this.x += dx * max;
        this.y += dy * max;
        this.z += dz * max;
        this.detonate(game, target);
        return;
      }
      if (blockHit) {
        this.x += dx * max;
        this.y += dy * max;
        this.z += dz * max;
        this.detonate(game, null);
        return;
      }
    }

    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    if ((this.age & 1) === 0) {
      game.particles('flame', this.x, this.y + 0.5, this.z, 1, 0.25);
      game.particles('smoke', this.x, this.y + 0.5, this.z, 1, 0.25);
    }
    if (this.y < -64 || this.y > 320) this.dead = true;
  }

  private detonate(game: GameApi, target: Entity | null): void {
    if (this.dead) return;
    this.dead = true;
    if (this.small) {
      // boule de blaze : 5 de dégâts et le feu à la cible, ou une flamme là où elle s'écrase
      if (target) {
        if (target.hurt(game, 5, 'fire', this.owner) && target instanceof Living && !target.fireImmune) target.fireTicks = Math.max(target.fireTicks, 100);
      } else {
        const bx = Math.floor(this.x);
        const by = Math.floor(this.y + 0.5);
        const bz = Math.floor(this.z);
        if (game.world.getBlock(bx, by, bz) === B.AIR && game.world.isSolid(bx, by - 1, bz)) game.world.setBlock(bx, by, bz, B.FIRE, 0);
      }
      game.sound('fizz', this.x, this.y, this.z, 0.5, 1.6);
      return;
    }
    if (target) {
      const dmg = this.deflected && target.mobKind === 'ghast' ? 20 : 6;
      target.hurt(game, dmg, 'explosion', this.owner);
    }
    game.explode(this.x, this.y + 0.5, this.z, 1.5, true, this.owner);
  }

  save(): EntityData | null {
    if (this.dead) return null;
    const d = this.saveBase('fireball');
    if (this.deflected) d.deflected = 1;
    if (this.small) d.small = 1;
    return d;
  }

  static load(d: EntityData): Fireball {
    const f = new Fireball(Boolean(d.small));
    f.loadBase(d);
    f.deflected = Boolean(d.deflected);
    return f;
  }
}

/** Le bloc est-il un fluide ? (aide pour les projectiles et les objets) */
export function isFluidBlock(id: number): boolean {
  return BLOCK_SHAPE[id] === SHAPE.FLUID;
}
