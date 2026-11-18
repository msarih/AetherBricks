/**
 * Véhicules : bateau et wagonnet.
 * Réutilisent Living.vehicle / Player.mount / Player.dismount pour porter le joueur ou une créature.
 */
import { B, I } from '../world/Ids';
import { isRail, railShape, setDetectorRailActive } from '../world/Rails';
import { Entity, Living, num, round3, type DamageCause, type EntityData, type GameApi, type PlayerLike } from './Entity';
import type { EntityKind } from './EntityView';
import { loadMob } from './Mobs';
import { move } from './Physics';

const BOAT_SEAT = -0.08;
const MINECART_SEAT = -0.05;
const MAX_CART_SPEED = 0.4;
const MAX_BOAT_SPEED = 0.42;

function isPlayerLike(e: Living): e is Living & PlayerLike {
  return e.kind === 'player';
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function unseatPassenger(game: GameApi, vehicle: Entity, rider: Living | null): void {
  if (!rider) return;
  if (isPlayerLike(rider)) {
    if (rider.vehicle === vehicle) rider.dismount(game);
  } else if (rider.vehicle === vehicle) {
    rider.vehicle = null;
    rider.riding = false;
  }
}

function findMountableMob(game: GameApi, v: Entity, pad: number): Living | null {
  const x0 = v.x - v.width / 2 - pad;
  const x1 = v.x + v.width / 2 + pad;
  const y0 = v.y - 0.1;
  const y1 = v.y + v.height + 0.2;
  const z0 = v.z - v.width / 2 - pad;
  const z1 = v.z + v.width / 2 + pad;
  for (const e of game.entities) {
    if (!(e instanceof Living) || e.kind !== 'mob' || !e.alive || e.dead || e.vehicle) continue;
    if (e.width > 1.2 || e.height > 2.2) continue;
    if (e.intersects(x0, y0, z0, x1, y1, z1)) return e;
  }
  return null;
}

function syncPassenger(vehicle: Entity, rider: Living, seatY: number): void {
  rider.x = vehicle.x;
  rider.y = vehicle.y + seatY;
  rider.z = vehicle.z;
  rider.px = rider.x;
  rider.py = rider.y;
  rider.pz = rider.z;
  rider.vx = rider.vy = rider.vz = 0;
  rider.fallDistance = 0;
}

// ============================================================================ Bateau

export class Boat extends Entity {
  readonly kind: EntityKind = 'boat';
  override get pickable(): boolean { return true; }
  override get persistent(): boolean { return true; }

  health = 4;
  rider: Living | null = null;
  private pendingMob: EntityData | null = null;
  private pendingPlayer = false;

  constructor() {
    super();
    this.width = 1.375;
    this.height = 0.5625;
    this.stepHeight = 0;
  }

  override interact(_game: GameApi, player: PlayerLike): boolean {
    if (this.dead || this.rider) return false;
    if (!player.mount(this)) return false;
    this.rider = player as unknown as Living;
    this.pendingMob = null;
    this.pendingPlayer = false;
    syncPassenger(this, this.rider, BOAT_SEAT);
    return true;
  }

  override hurt(game: GameApi, amount: number, cause: DamageCause, attacker: Entity | null = null): boolean {
    if (this.dead) return false;
    if (cause === 'void') {
      this.dead = true;
      return true;
    }
    if (cause !== 'attack' && cause !== 'arrow' && cause !== 'explosion') return false;
    const creative = attacker instanceof Living && isPlayerLike(attacker) && (attacker as { creative?: boolean }).creative === true;
    this.health -= creative ? this.health : Math.max(1, amount);
    if (this.health <= 0) {
      unseatPassenger(game, this, this.rider);
      this.rider = null;
      if (!creative) game.dropItem(this.x, this.y + 0.3, this.z, I.BOAT, 1);
      this.dead = true;
    }
    return true;
  }

  override tick(game: GameApi): void {
    this.beginTick();
    if (this.pendingMob) {
      const m = loadMob(this.pendingMob);
      this.pendingMob = null;
      if (m) {
        m.vehicle = this;
        m.riding = true;
        this.rider = m;
        syncPassenger(this, m, BOAT_SEAT);
        game.spawn(m);
      }
    } else if (this.pendingPlayer) {
      this.pendingPlayer = false;
      const p = game.player as unknown as Living & PlayerLike;
      if (!p.vehicle && p.alive && p.mount(this)) {
        this.rider = p;
        syncPassenger(this, p, BOAT_SEAT);
      }
    }

    if (this.rider && (this.rider.dead || !this.rider.alive || this.rider.vehicle !== this)) {
      unseatPassenger(game, this, this.rider);
      this.rider = null;
    }

    if (!this.rider) {
      const mob = findMountableMob(game, this, 0.15);
      if (mob) {
        mob.vehicle = this;
        mob.riding = true;
        this.rider = mob;
        syncPassenger(this, mob, BOAT_SEAT);
      }
    }

    const w = game.world;
    // Surface d'eau dans le niveau courant du bateau : il flotte mais ne grimpe pas une marche d'eau
    let waterSurface = -1;
    const wy = Math.floor(this.y + 0.25);
    const x0 = Math.floor(this.x - 0.5);
    const x1 = Math.floor(this.x + 0.5);
    const z0 = Math.floor(this.z - 0.5);
    const z1 = Math.floor(this.z + 0.5);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const v = w.getBlockAndMeta(ix, wy, iz);
        if ((v & 255) !== B.WATER) continue;
        const lvl = (v >> 8) & 7;
        const top = wy + (1 - lvl / 8) * 0.875;
        if (top > waterSurface) waterSurface = top;
      }
    }
    const onWater = waterSurface >= 0 && this.y <= waterSurface + 0.15;

    if (this.rider && isPlayerLike(this.rider)) {
      const inp = this.rider.input;
      this.yaw -= inp.strafe * 0.06;
      const accel = onWater
        ? inp.forward > 0
          ? 0.045
          : inp.forward < 0
            ? -0.022
            : 0
        : inp.forward > 0
          ? 0.008
          : inp.forward < 0
            ? -0.005
            : 0;
      if (accel !== 0) {
        this.vx += -Math.sin(this.yaw) * accel;
        this.vz += -Math.cos(this.yaw) * accel;
      }
    }

    if (onWater) {
      const targetY = waterSurface - 0.35;
      if (this.y < targetY) this.vy = Math.min(0.08, (targetY - this.y) * 0.5);
      else this.vy = Math.max(-0.04, (targetY - this.y) * 0.3);
    } else {
      this.stepHeight = 0;
      this.vy -= 0.04;
    }

    const drag = onWater ? 0.9 : this.onGround ? 0.5 : 0.91;
    this.vx *= drag;
    this.vz *= drag;

    const spd = Math.hypot(this.vx, this.vz);
    if (spd > MAX_BOAT_SPEED) {
      const k = MAX_BOAT_SPEED / spd;
      this.vx *= k;
      this.vz *= k;
    }

    move(w, this, this.vx, this.vy, this.vz);
    if (this.collidedH) {
      // Choc contre un bloc : ne casse pas le bateau (comportement 1.12)
      if (Math.abs(this.vx) < 0.001) this.vx = 0;
      if (Math.abs(this.vz) < 0.001) this.vz = 0;
    }
    if (this.onGround && this.vy < 0) this.vy = 0;

    this.updateLight(w);
    if (this.rider) syncPassenger(this, this.rider, BOAT_SEAT);
    if (this.y < -64) this.dead = true;
  }

  override save(): EntityData | null {
    if (this.dead) return null;
    const d: EntityData = {
      type: 'boat',
      x: round3(this.x),
      y: round3(this.y),
      z: round3(this.z),
      yaw: round3(this.yaw),
    };
    if (this.rider) {
      if (isPlayerLike(this.rider)) d.playerRider = true;
      else d.mobRider = this.rider.save();
    }
    return d;
  }

  static load(d: EntityData): Boat {
    const b = new Boat();
    b.setPosition(d.x, d.y, d.z);
    b.yaw = num(d.yaw, 0);
    if (d.playerRider === true) b.pendingPlayer = true;
    if (typeof d.mobRider === 'object' && d.mobRider !== null) b.pendingMob = d.mobRider as EntityData;
    return b;
  }
}

// ============================================================================ Wagonnet

export class Minecart extends Entity {
  readonly kind: EntityKind = 'minecart';
  override get pickable(): boolean { return true; }
  override get persistent(): boolean { return true; }

  health = 4;
  rider: Living | null = null;
  private pendingMob: EntityData | null = null;
  private pendingPlayer = false;

  constructor() {
    super();
    this.width = 0.98;
    this.height = 0.7;
    this.stepHeight = 0;
  }

  override interact(_game: GameApi, player: PlayerLike): boolean {
    if (this.dead || this.rider) return false;
    if (!player.mount(this)) return false;
    this.rider = player as unknown as Living;
    this.pendingMob = null;
    this.pendingPlayer = false;
    syncPassenger(this, this.rider, MINECART_SEAT);
    return true;
  }

  override hurt(game: GameApi, amount: number, cause: DamageCause, attacker: Entity | null = null): boolean {
    if (this.dead) return false;
    if (cause === 'void') {
      this.dead = true;
      return true;
    }
    if (cause !== 'attack' && cause !== 'arrow' && cause !== 'explosion') return false;
    const creative = attacker instanceof Living && isPlayerLike(attacker) && (attacker as { creative?: boolean }).creative === true;
    this.health -= creative ? this.health : Math.max(1, amount);
    if (this.health <= 0) {
      unseatPassenger(game, this, this.rider);
      this.rider = null;
      if (!creative) game.dropItem(this.x, this.y + 0.3, this.z, I.MINECART, 1);
      this.dead = true;
    }
    return true;
  }

  override tick(game: GameApi): void {
    this.beginTick();
    if (this.pendingMob) {
      const m = loadMob(this.pendingMob);
      this.pendingMob = null;
      if (m) {
        m.vehicle = this;
        m.riding = true;
        this.rider = m;
        syncPassenger(this, m, MINECART_SEAT);
        game.spawn(m);
      }
    } else if (this.pendingPlayer) {
      this.pendingPlayer = false;
      const p = game.player as unknown as Living & PlayerLike;
      if (!p.vehicle && p.alive && p.mount(this)) {
        this.rider = p;
        syncPassenger(this, p, MINECART_SEAT);
      }
    }

    if (this.rider && (this.rider.dead || !this.rider.alive || this.rider.vehicle !== this)) {
      unseatPassenger(game, this, this.rider);
      this.rider = null;
    }

    // Une créature qui touche un wagonnet vide y monte
    if (!this.rider) {
      const mob = findMountableMob(game, this, 0.15);
      if (mob) {
        mob.vehicle = this;
        mob.riding = true;
        this.rider = mob;
        syncPassenger(this, mob, MINECART_SEAT);
      }
    }

    // Poussé à pied par le joueur (s'il n'est pas dedans)
    const player = game.player;
    if (player.alive && player.vehicle !== this) {
      const dx = this.x - player.x;
      const dz = this.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.85 && Math.abs(this.y - player.y) < 1.0) {
        this.vx += (dx / d) * 0.06;
        this.vz += (dz / d) * 0.06;
      }
    }

    const w = game.world;
    const bx = Math.floor(this.x);
    let by = Math.floor(this.y + 0.15);
    const bz = Math.floor(this.z);
    let v = w.getBlockAndMeta(bx, by, bz);
    if (!isRail(v & 255)) {
      const below = w.getBlockAndMeta(bx, by - 1, bz);
      if (isRail(below & 255)) {
        by--;
        v = below;
      }
    }
    const railId = v & 255;

    if (isRail(railId)) {
      this.stepHeight = 1;
      const meta = v >> 8;
      const shape = railShape(railId, meta);
      this.fallDistance = 0;

      if (railId === B.DETECTOR_RAIL) {
        setDetectorRailActive(w, bx, by, bz, true);
        w.scheduleTick(bx, by, bz, 20);
      }

      // Commande du joueur assis (Z pousse doucement dans la direction du regard projetée sur le rail)
      if (this.rider && isPlayerLike(this.rider) && this.rider.input.forward > 0) {
        const lx = -Math.sin(this.rider.yaw);
        const lz = -Math.cos(this.rider.yaw);
        this.vx += lx * 0.018;
        this.vz += lz * 0.018;
      }

      // Guidage selon la forme du rail (0..9)
      if (shape === 0) {
        // N-S
        this.x = bx + 0.5;
        this.vx = 0;
        this.y = by + 0.0625;
      } else if (shape === 1) {
        // E-W
        this.z = bz + 0.5;
        this.vz = 0;
        this.y = by + 0.0625;
      } else if (shape === 2) {
        // montée +X
        this.z = bz + 0.5;
        this.vz = 0;
        this.vx -= 0.0078125;
        this.y = by + 0.0625 + clamp(this.x - bx, 0, 1);
      } else if (shape === 3) {
        // montée -X
        this.z = bz + 0.5;
        this.vz = 0;
        this.vx += 0.0078125;
        this.y = by + 0.0625 + clamp(1 - (this.x - bx), 0, 1);
      } else if (shape === 4) {
        // montée -Z
        this.x = bx + 0.5;
        this.vx = 0;
        this.vz += 0.0078125;
        this.y = by + 0.0625 + clamp(1 - (this.z - bz), 0, 1);
      } else if (shape === 5) {
        // montée +Z
        this.x = bx + 0.5;
        this.vx = 0;
        this.vz -= 0.0078125;
        this.y = by + 0.0625 + clamp(this.z - bz, 0, 1);
      } else if (shape >= 6 && shape <= 9) {
        this.y = by + 0.0625;
        const dirZ = shape === 6 || shape === 7 ? 1 : -1;
        const dirX = shape === 6 || shape === 9 ? 1 : -1;
        const lx = this.x - (bx + 0.5);
        const lz = this.z - (bz + 0.5);
        const spd = Math.hypot(this.vx, this.vz);
        if (Math.abs(this.vz) >= Math.abs(this.vx)) {
          this.x = bx + 0.5;
          if (this.vz * dirZ < 0 && lz * dirZ <= 0) {
            this.vx = dirX * spd;
            this.vz = 0;
            this.z = bz + 0.5;
          }
        } else {
          this.z = bz + 0.5;
          if (this.vx * dirX < 0 && lx * dirX <= 0) {
            this.vz = dirZ * spd;
            this.vx = 0;
            this.x = bx + 0.5;
          }
        }
      }

      // Rail propulseur : allumé -> accélère ; éteint -> freine
      if (railId === B.POWERED_RAIL) {
        if (meta & 8) {
          const spd = Math.hypot(this.vx, this.vz);
          if (spd > 0.01) {
            this.vx += (this.vx / spd) * 0.06;
            this.vz += (this.vz / spd) * 0.06;
          } else if (shape === 0 || shape === 4 || shape === 5) {
            const bN = w.isSolid(bx, by, bz - 1);
            const bS = w.isSolid(bx, by, bz + 1);
            if (bN && !bS) this.vz = 0.06;
            else if (bS && !bN) this.vz = -0.06;
          } else {
            const bW = w.isSolid(bx - 1, by, bz);
            const bE = w.isSolid(bx + 1, by, bz);
            if (bW && !bE) this.vx = 0.06;
            else if (bE && !bW) this.vx = -0.06;
          }
        } else {
          this.vx *= 0.5;
          this.vz *= 0.5;
          if (Math.hypot(this.vx, this.vz) < 0.01) {
            this.vx = 0;
            this.vz = 0;
          }
        }
      } else {
        const drag = this.rider ? 0.997 : 0.96;
        this.vx *= drag;
        this.vz *= drag;
      }

      const spd = Math.hypot(this.vx, this.vz);
      if (spd > MAX_CART_SPEED) {
        const k = MAX_CART_SPEED / spd;
        this.vx *= k;
        this.vz *= k;
      }

      this.onGround = true;
      move(w, this, this.vx, 0, this.vz);
      this.vy = 0;
      // Ajuste y si on vient de passer sur une pente
      const nbx = Math.floor(this.x);
      const nbz = Math.floor(this.z);
      for (const nby of [by, by + 1, by - 1]) {
        const nv = w.getBlockAndMeta(nbx, nby, nbz);
        if (!isRail(nv & 255)) continue;
        const ns = railShape(nv & 255, nv >> 8);
        if (ns === 2) this.y = nby + 0.0625 + clamp(this.x - nbx, 0, 1);
        else if (ns === 3) this.y = nby + 0.0625 + clamp(1 - (this.x - nbx), 0, 1);
        else if (ns === 4) this.y = nby + 0.0625 + clamp(1 - (this.z - nbz), 0, 1);
        else if (ns === 5) this.y = nby + 0.0625 + clamp(this.z - nbz, 0, 1);
        else this.y = nby + 0.0625;
        break;
      }
      if (Math.hypot(this.vx, this.vz) > 0.005) {
        this.yaw = Math.atan2(-this.vx, -this.vz);
      }
    } else {
      this.stepHeight = 0;
      this.vy -= 0.04;
      const drag = this.onGround ? 0.5 : 0.95;
      this.vx *= drag;
      this.vz *= drag;
      move(w, this, this.vx, this.vy, this.vz);
      if (this.onGround && this.vy < 0) this.vy = 0;
    }

    this.updateLight(w);
    if (this.rider) syncPassenger(this, this.rider, MINECART_SEAT);
    if (this.y < -64) this.dead = true;
  }

  override save(): EntityData | null {
    if (this.dead) return null;
    const d: EntityData = {
      type: 'minecart',
      x: round3(this.x),
      y: round3(this.y),
      z: round3(this.z),
      yaw: round3(this.yaw),
    };
    if (this.rider) {
      if (isPlayerLike(this.rider)) d.playerRider = true;
      else d.mobRider = this.rider.save();
    }
    return d;
  }

  static load(d: EntityData): Minecart {
    const c = new Minecart();
    c.setPosition(d.x, d.y, d.z);
    c.yaw = num(d.yaw, 0);
    if (d.playerRider === true) c.pendingPlayer = true;
    if (typeof d.mobRider === 'object' && d.mobRider !== null) c.pendingMob = d.mobRider as EntityData;
    return c;
  }
}
