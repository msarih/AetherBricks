/**
 * Entités inertes : objet au sol, bloc qui tombe, TNT amorcée, flèche, projectile lancé (œuf, boule de neige).
 */
import { BLOCK_REPLACEABLE, BLOCK_SHAPE, SHAPE } from '../world/Blocks';
import { B, I } from '../world/Ids';
import { maxStack } from '../world/Items';
import { canMerge, type ItemStack } from '../world/ItemStack';
import { newRayHit, rayBoxDistance, raycast } from '../world/Raycast';
import { Entity, Living, num, type DamageCause, type EntityData, type GameApi } from './Entity';
import type { EntityKind } from './EntityView';
import { groundSlip, move, updateMedium } from './Physics';

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
    return d;
  }

  static load(d: EntityData): ItemEntity | null {
    const id = num(d.id, 0);
    const count = num(d.count, 0);
    if (id <= 0 || count <= 0) return null;
    const e = new ItemEntity({ id, count, damage: num(d.damage, 0) });
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
        if (target instanceof Living) {
          // aucun dégât, mais un recul et l'éclair rouge
          const cause: DamageCause = 'generic';
          if (!target.hurt(game, 0.001, cause, this.owner)) target.knockback(dx, dz, 0.3);
        }
        this.dead = true;
        if (this.itemId === I.EGG) {
          game.itemParticles(x, y, z, I.EGG, 8);
          Thrown.onEggBreak?.(game, x, y, z);
        } else {
          game.particles('snow', x, y, z, 8, 0.1);
        }
        return;
      }
      this.x += this.vx;
      this.y += this.vy;
      this.z += this.vz;
    }
    this.vx *= 0.99;
    this.vy *= 0.99;
    this.vz *= 0.99;
    this.vy -= 0.03;
    if (this.y < -64 || this.age > 600) this.dead = true;
  }
}

/** Le bloc est-il un fluide ? (aide pour les projectiles et les objets) */
export function isFluidBlock(id: number): boolean {
  return BLOCK_SHAPE[id] === SHAPE.FLUID;
}
