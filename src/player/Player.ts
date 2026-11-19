/**
 * Le joueur : un être vivant commandé par les entrées, avec inventaire, faim, expérience et armure.
 * Les commandes du tick sont écrites dans `input` par le jeu ; la visée (lacet, tangage) est appliquée
 * à chaque image par `turn()`.
 */
import type { SfxName } from '../audio/Sfx';
import { EFFECT_TYPES, Living, num, round3, type DamageCause, type EffectType, type Entity, type GameApi, type PlayerLike } from '../entity/Entity';
import { notifyTamedWolves } from '../entity/Mobs';
import type { EntityKind } from '../entity/EntityView';
import type { MobKind } from '../entity/MobModels';
import { JUMP_VELOCITY, isBoxFree, travel, updateMedium } from '../entity/Physics';
import { Inventory } from '../game/Inventory';
import { STAT, addStat, craftedKey, killedByKey, loadStats, type Stats } from '../game/Stats';
import type { GameMode } from '../world/Constants';
import { armorProtectionFactor } from '../world/Enchants';
import { I } from '../world/Ids';
import { getItem } from '../world/Items';
import { makeStack, type ItemStack } from '../world/ItemStack';

export interface PlayerInput {
  /** -1..1 : > 0 vers l'avant. */
  forward: number;
  /** -1..1 : > 0 vers la droite. */
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export type UseKind = 'none' | 'eat' | 'bow' | 'block';

const STAND_EYE = 1.62;
const SNEAK_EYE = 1.54;
const MAX_PITCH = Math.PI / 2 - 0.001;
/** Causes de dégâts que l'armure atténue. */
const ARMOR_CAUSES: ReadonlySet<DamageCause> = new Set<DamageCause>(['attack', 'arrow', 'explosion', 'cactus', 'lava', 'generic']);

/** Points d'expérience nécessaires pour passer du niveau donné au suivant. */
export function xpNeeded(level: number): number {
  if (level < 16) return 2 * level + 7;
  if (level < 31) return 5 * level - 38;
  return 9 * level - 158;
}

export class Player extends Living implements PlayerLike {
  readonly kind: EntityKind = 'player';
  mobKind: MobKind = 'player';

  gameMode: GameMode;
  readonly inventory = new Inventory();
  readonly input: PlayerInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

  /** Faim en demi-gigots (0..20), saturation (réserve cachée) et épuisement (0..4). */
  hunger = 20;
  saturation = 5;
  exhaustion = 0;
  xpLevel = 0;
  /** Avancement vers le niveau suivant (0..1). */
  xpProgress = 0;
  /** Graine d'enchantement du joueur (fixe les propositions jusqu'au prochain enchantement). */
  enchantSeed = 1337;

  sprinting = false;
  /** Utilisation d'un objet en cours (manger, bander l'arc) et sa durée en ticks. */
  useKind: UseKind = 'none';
  useTicks = 0;
  /** Couché dans un lit. */
  sleeping = false;
  sleepTicks = 0;
  /** Point de réapparition fixé par un lit. */
  bed: { x: number; y: number; z: number } | null = null;
  /** Cause et auteur du dernier coup mortel (pour le message de mort). */
  deathCause: DamageCause = 'generic';
  deathBy: Entity | null = null;
  /** Identifiants des progrès (étape guidée) déjà accomplis par le joueur. */
  readonly advancements = new Set<string>();
  /** Statistiques (écran « Statistiques » du menu de pause). */
  stats: Stats = {};

  /** Balancement de la vue : amplitude (0..1) et distance parcourue, avec leurs valeurs du tick précédent. */
  pBob = 0;
  bob = 0;
  pWalk = 0;
  walk = 0;
  /** Hauteur des yeux au tick précédent (elle s'abaisse en douceur quand on s'accroupit). */
  pEyeHeight = STAND_EYE;

  /** Son non positionné joué pour le joueur (branché par le jeu). */
  sfx: (name: SfxName, volume?: number, pitch?: number) => void = () => {};

  private foodTimer = 0;
  private stepAcc = 0;
  private jumpTap = 0;
  private forwardTap = 0;

  constructor(gameMode: GameMode) {
    super();
    this.gameMode = gameMode;
    this.stepHeight = 0.6;
    this.inventory.crafted = (id, count) => this.addStat(craftedKey(id), count);
  }

  addStat(key: string, n = 1): void {
    addStat(this.stats, key, n);
  }

  // ------------------------------------------------------------------ PlayerLike

  get targetable(): boolean {
    return this.alive && (this.gameMode === 'survival' || this.gameMode === 'adventure');
  }

  get heldItemId(): number {
    return this.inventory.heldId;
  }

  get offhandItemId(): number {
    return this.inventory.offhandId;
  }

  /** Bouclier levé et actif (après 5 ticks de clic droit maintenu). */
  get blocking(): boolean {
    return this.useKind === 'block' && this.useTicks >= 5;
  }

  get creative(): boolean {
    return this.gameMode === 'creative';
  }

  get spectator(): boolean {
    return this.gameMode === 'spectator';
  }

  collect(stack: ItemStack): number {
    return this.inventory.add(stack);
  }

  consumeHeld(count = 1): void {
    this.consumeHand('main', count);
  }

  consumeHand(hand: 'main' | 'offhand', count = 1): void {
    if (this.creative) return;
    if (hand === 'offhand') this.inventory.consumeOffhand(count);
    else this.inventory.consumeHeld(count);
  }

  replaceHeld(id: number): void {
    this.replaceHand('main', id);
  }

  replaceHand(hand: 'main' | 'offhand', id: number): void {
    const inv = this.inventory;
    const stack = hand === 'offhand' ? inv.offhandItem : inv.held;
    if (this.creative) {
      if (inv.count(id) === 0) inv.give(id, 1);
      return;
    }
    if (!stack || stack.count <= 1) {
      if (hand === 'offhand') inv.offhand[0] = makeStack(id, 1);
      else inv.slots[inv.selected] = makeStack(id, 1);
    } else {
      stack.count--;
      inv.give(id, 1);
    }
  }

  damageHeld(game: GameApi, amount = 1): void {
    this.damageHand('main', game, amount);
  }

  damageHand(hand: 'main' | 'offhand', game: GameApi, amount = 1): void {
    if (this.creative) return;
    const id = hand === 'offhand' ? this.inventory.offhandId : this.inventory.heldId;
    if (id === 0) return;
    const broke = hand === 'offhand'
      ? this.inventory.damageOffhand(amount, game.rng)
      : this.inventory.damageHeld(amount, game.rng);
    if (broke) {
      game.sound('tool_break', this.x, this.y + this.eyeHeight, this.z, 0.9);
      game.itemParticles(this.x, this.y + this.eyeHeight - 0.3, this.z, id, 8);
    }
  }

  addXp(amount: number): void {
    if (amount <= 0) return;
    this.sfx('orb', 0.35, 0.8 + Math.random() * 0.6);
    let points = amount;
    while (points > 0) {
      const need = xpNeeded(this.xpLevel);
      const missing = (1 - this.xpProgress) * need;
      if (points < missing) {
        this.xpProgress += points / need;
        points = 0;
      } else {
        points -= missing;
        this.xpProgress = 0;
        this.xpLevel++;
        if (this.xpLevel % 5 === 0) this.sfx('levelup', 0.7);
      }
    }
  }

  // ------------------------------------------------------------------ monture

  /** Quitte sa monture sans bouger (téléportation, portail, lit). */
  leaveVehicle(): void {
    this.vehicle = null;
    this.riding = false;
  }

  /** Une téléportation fait descendre de cheval : sinon la monture ramènerait aussitôt son cavalier. */
  override teleport(x: number, y: number, z: number): void {
    this.leaveVehicle();
    super.teleport(x, y, z);
  }

  mount(vehicle: Entity): boolean {
    if (this.spectator || this.vehicle || !this.alive || this.sleeping) return false;
    this.vehicle = vehicle;
    this.riding = true;
    this.sprinting = false;
    this.flying = false;
    this.stopUsing();
    this.vx = this.vy = this.vz = 0;
    return true;
  }

  dismount(game: GameApi): void {
    const v = this.vehicle;
    if (!v) return;
    this.leaveVehicle();
    this.fallDistance = 0;
    this.vx = this.vy = this.vz = 0;
    // à gauche, à droite ou derrière la monture, là où la place est libre ; sinon sur place
    const hw = this.width / 2;
    const side = v.width / 2 + hw + 0.2;
    const sx = Math.cos(v.yaw);
    const sz = -Math.sin(v.yaw);
    const spots: Array<[number, number]> = [[-sx * side, -sz * side], [sx * side, sz * side], [Math.sin(v.yaw) * side, Math.cos(v.yaw) * side]];
    for (const [dx, dz] of spots) {
      const x = v.x + dx;
      const z = v.z + dz;
      for (const y of [v.y, v.y + 1, v.y - 1]) {
        if (!game.world.isSolid(Math.floor(x), Math.floor(y - 0.01), Math.floor(z))) continue;
        if (!isBoxFree(game.world, x - hw, y, z - hw, x + hw, y + this.height, z + hw)) continue;
        this.setPosition(x, y, z);
        return;
      }
    }
    this.setPosition(v.x, v.y + v.height, v.z);
  }

  // ------------------------------------------------------------------ visée et commandes

  /** Tourne la vue (radians) : `dYaw` > 0 vers la gauche, `dPitch` > 0 vers le haut. */
  turn(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.headYaw = this.yaw;
    this.headPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.headPitch + dPitch));
  }

  /** Direction du regard (vecteur unitaire écrit dans `out`). */
  look(out: { x: number; y: number; z: number }): void {
    const cp = Math.cos(this.headPitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.headPitch);
    out.z = -Math.cos(this.yaw) * cp;
  }

  /** Appui sur la touche de saut : deux appuis rapprochés basculent le vol en créatif. */
  tapJump(): void {
    if (!this.creative || !this.alive) return;
    if (this.jumpTap > 0) {
      this.flying = !this.flying;
      this.jumpTap = 0;
      if (this.flying) this.vy = 0;
    } else {
      this.jumpTap = 7;
    }
  }

  /** Appui sur la touche « avancer » : deux appuis rapprochés lancent la course. */
  tapForward(): void {
    if (this.forwardTap > 0) {
      this.forwardTap = 0;
      if (this.canSprint()) this.sprinting = true;
    } else {
      this.forwardTap = 7;
    }
  }

  private canSprint(): boolean {
    return !this.sneaking && this.useKind === 'none' && !this.sleeping && (this.creative || this.spectator || this.hunger > 6);
  }

  stopUsing(): void {
    this.useKind = 'none';
    this.useTicks = 0;
  }

  /** Mange : rend de la faim et de la saturation. */
  feed(food: number, saturation: number): void {
    this.hunger = Math.min(20, this.hunger + food);
    this.saturation = Math.min(this.hunger, this.saturation + saturation);
  }

  // ------------------------------------------------------------------ tick

  tick(game: GameApi): void {
    const creative = this.creative;
    const spect = this.spectator;
    const invuln = creative || spect;
    this.waterBreathing = invuln;
    this.fireImmune = invuln;
    this.noClip = spect;
    if (spect) {
      this.flying = true;
      this.fallDistance = 0;
      this.fireTicks = 0;
      if (this.vehicle) this.leaveVehicle();
    } else if (!creative) {
      this.flying = false;
    }
    if (this.jumpTap > 0) this.jumpTap--;
    if (this.forwardTap > 0) this.forwardTap--;
    this.pBob = this.bob;
    this.pWalk = this.walk;
    this.pEyeHeight = this.eyeHeight;
    this.eyeHeight += ((this.sneaking ? SNEAK_EYE : STAND_EYE) - this.eyeHeight) * 0.5;
    this.itemId = this.inventory.heldId;
    this.offhandId = this.inventory.offhandId;
    super.tick(game);
    if (this.alive) this.foodTick(game);
  }

  protected think(_game: GameApi): void {
    const inp = this.input;
    this.headYaw = this.yaw;
    if (this.sleeping) {
      this.leaveVehicle();
      this.moveForward = this.moveStrafe = 0;
      this.jumping = false;
      this.sneaking = false;
      this.sprinting = false;
      this.vx = this.vz = 0;
      return;
    }
    if (this.vehicle) {
      // en selle : les commandes vont à la monture ; s'accroupir fait descendre
      this.moveForward = this.moveStrafe = 0;
      this.jumping = false;
      this.sneaking = false;
      this.sprinting = false;
      if (inp.sneak || this.vehicle.dead) this.dismount(_game);
      return;
    }
    let f = inp.forward;
    let s = inp.strafe;
    this.sneaking = inp.sneak && !this.flying;

    if (this.sprinting && (f <= 0 || this.collidedH || !this.canSprint())) this.sprinting = false;
    if (!this.sprinting && inp.sprint && f > 0 && !this.collidedH && this.canSprint()) this.sprinting = true;

    if (this.sneaking) {
      f *= 0.3;
      s *= 0.3;
    }
    if (this.useKind !== 'none') {
      f *= 0.2;
      s *= 0.2;
    }
    this.speed = this.sprinting ? 0.13 : 0.1;
    if (this.flying) {
      this.airAccel = this.sprinting ? 0.1 : 0.05;
      if (inp.jump) this.vy += 0.15;
      if (inp.sneak) this.vy -= 0.15;
      if (this.onGround && !this.spectator) this.flying = false;
    } else {
      this.airAccel = this.sprinting ? 0.026 : 0.02;
    }
    this.moveForward = f;
    this.moveStrafe = s;
    this.jumping = inp.jump;
  }

  protected moveTick(game: GameApi): void {
    if (this.vehicle) {
      // porté : la monture place le joueur après son propre déplacement (voir Horse.tick)
      this.vx = this.vy = this.vz = 0;
      this.fallDistance = 0;
      this.onGround = false;
      this.limbAmount *= 0.6;
      this.bob *= 0.6;
      return;
    }
    super.moveTick(game);
    const dx = this.x - this.px;
    const dy = this.y - this.py;
    const dz = this.z - this.pz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // distances parcourues (un déplacement de plus de 2 blocs en un tick est une téléportation)
    if (dist > 0 && dist < 2) {
      if (this.inWater) this.addStat(STAT.SWIM, dist * 100);
      else if (this.flying) this.addStat(STAT.FLY, dist * 100);
      else if (this.onGround) this.addStat(STAT.WALK, dist * 100);
    }

    const target = this.onGround ? Math.min(1, dist * 10) : 0;
    this.bob += (target - this.bob) * 0.4;
    this.walk += dist * 0.6;

    if (!this.creative && !this.spectator) {
      if (this.inWater) this.exhaustion += 0.015 * Math.sqrt(dist * dist + dy * dy);
      else if (this.onGround) this.exhaustion += (this.sprinting ? 0.1 : 0.01) * dist;
    }

    if (this.onGround && !this.sneaking && !this.spectator && dist > 0.005) {
      this.stepAcc += dist * 0.6;
      if (this.stepAcc >= 1) {
        this.stepAcc = 0;
        const bx = Math.floor(this.x);
        const bz = Math.floor(this.z);
        let by = Math.floor(this.y - 0.2);
        let id = game.world.getBlock(bx, by, bz);
        // une couche de neige ou un tapis de plantes sous les pieds
        const at = game.world.getBlock(bx, Math.floor(this.y), bz);
        if (at !== 0 && !this.inWater) {
          id = at;
          by = Math.floor(this.y);
        }
        if (id !== 0) game.blockSound('step', id, bx + 0.5, by + 0.5, bz + 0.5);
      }
    } else if (this.inWater && dist + Math.abs(dy) > 0.02) {
      this.stepAcc += (dist + Math.abs(dy)) * 0.35;
      if (this.stepAcc >= 1) {
        this.stepAcc = 0;
        game.sound('swim', this.x, this.y, this.z, 0.35, 0.8 + game.rng() * 0.4);
      }
    }
  }

  protected edgeGuard(): boolean {
    return this.sneaking && this.onGround;
  }

  protected jump(): void {
    this.vy = JUMP_VELOCITY;
    this.addStat(STAT.JUMP);
    if (this.sprinting) {
      this.vx -= Math.sin(this.yaw) * 0.2;
      this.vz -= Math.cos(this.yaw) * 0.2;
    }
    if (!this.creative) this.exhaustion += this.sprinting ? 0.2 : 0.05;
  }

  private foodTick(game: GameApi): void {
    if (this.creative || this.spectator) return;
    const diff = game.difficulty;
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (diff > 0) this.hunger = Math.max(0, this.hunger - 1);
    }
    if (diff === 0) {
      if (this.health < this.maxHealth && this.age % 20 === 0) this.heal(1);
      if (this.hunger < 20 && this.age % 10 === 0) this.hunger++;
    }
    if (game.world.rules.naturalRegeneration && this.hunger >= 18 && this.health < this.maxHealth) {
      if (++this.foodTimer >= 80) {
        this.heal(1);
        this.exhaustion += 3;
        this.foodTimer = 0;
      }
    } else if (this.hunger <= 0) {
      if (++this.foodTimer >= 80) {
        // facile : la faim s'arrête à 5 cœurs ; normal : à un demi-cœur ; difficile : elle tue
        if (this.health > 10 || diff >= 3 || (this.health > 1 && diff === 2)) this.hurt(game, 1, 'starve');
        this.foodTimer = 0;
      }
    } else {
      this.foodTimer = 0;
    }
  }

  // ------------------------------------------------------------------ dégâts, mort

  hurt(game: GameApi, amount: number, cause: DamageCause, attacker: Entity | null = null): boolean {
    if (this.spectator) return false;
    if (this.creative && cause !== 'void') return false;
    if (this.blocking && (cause === 'attack' || cause === 'arrow' || cause === 'explosion')) {
      const fromFront = attacker === null || (attacker.x - this.x) * -Math.sin(this.yaw) + (attacker.z - this.z) * -Math.cos(this.yaw) > 0;
      if (fromFront) {
        if (amount >= 3) {
          const shieldHand = this.heldItemId === I.SHIELD ? 'main' : 'offhand';
          this.damageHand(shieldHand, game, Math.floor(amount) + 1);
        }
        game.sound('attack_miss', this.x, this.y + 1, this.z, 0.8, 0.7);
        return false;
      }
    }
    const ok = super.hurt(game, amount, cause, attacker);
    if (ok) {
      this.sleeping = false;
      // un mal qui ronge (poison, flétrissement, faim) n'empêche ni de manger ni de boire le lait qui le guérit
      if (cause !== 'magic' && cause !== 'wither' && cause !== 'starve') this.stopUsing();
      if (attacker instanceof Living) notifyTamedWolves(game, attacker);
    }
    return ok;
  }

  protected reduceDamage(game: GameApi, amount: number, cause: DamageCause): number {
    if (ARMOR_CAUSES.has(cause)) {
      const points = this.inventory.armorPoints();
      if (points > 0) {
        if (this.inventory.damageArmor(Math.max(1, Math.floor(amount / 4)), game.rng)) {
          game.sound('tool_break', this.x, this.y + 1, this.z, 0.9);
        }
        amount = (amount * (25 - points)) / 25;
      }
      const epf = armorProtectionFactor(this.inventory.armor);
      if (epf > 0) amount *= 1 - epf * 0.04;
    }
    this.exhaustion += 0.1;
    this.addStat(STAT.DAMAGE_TAKEN, amount);
    return amount;
  }

  protected hurtSound(): SfxName | null {
    return 'hurt';
  }

  protected deathSound(): SfxName | null {
    return 'death';
  }

  protected onDeath(game: GameApi, cause: DamageCause, attacker: Entity | null): void {
    this.deathCause = cause;
    this.deathBy = attacker;
    this.addStat(STAT.DEATHS);
    if (attacker && attacker.kind === 'mob') this.addStat(killedByKey(attacker.mobKind));
    this.sprinting = false;
    this.flying = false;
    this.sleeping = false;
    this.vehicle = null;
    this.riding = false;
    this.stopUsing();
    if (!game.world.rules.keepInventory) {
      for (const s of this.inventory.takeAll()) {
        const e = game.dropStack ? game.dropStack(this.x, this.y + 0.9, this.z, s) : game.dropItem(this.x, this.y + 0.9, this.z, s.id, s.count, s.damage);
        e.vx = (game.rng() - 0.5) * 0.5;
        e.vy = 0.2 + game.rng() * 0.2;
        e.vz = (game.rng() - 0.5) * 0.5;
      }
      this.xpLevel = 0;
      this.xpProgress = 0;
    }
  }

  /** Le corps du joueur reste dans le monde jusqu'à la réapparition. */
  protected deathTick(game: GameApi): void {
    if (this.deathTime < 20) this.deathTime++;
    if (this.hurtTime > 0) this.hurtTime--;
    this.moveStrafe = this.moveForward = 0;
    this.jumping = false;
    this.bob *= 0.6;
    updateMedium(game.world, this);
    travel(game.world, this, 0, 0, { yaw: this.yaw, speed: 0, airAccel: 0, sneaking: false, flying: false, edgeGuard: false });
    this.limbAmount *= 0.6;
    this.updateLight(game.world);
  }

  /** Réapparaît en (x, y, z), en pleine forme. */
  respawn(x: number, y: number, z: number): void {
    this.health = this.maxHealth;
    this.hunger = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.air = 300;
    this.fireTicks = 0;
    this.clearEffects();
    this.vehicle = null;
    this.riding = false;
    this.deathTime = 0;
    this.hurtTime = 0;
    this.invulnerable = 60;
    this.sprinting = false;
    this.flying = false;
    this.sleeping = false;
    this.attacker = null;
    this.stopUsing();
    this.teleport(x, y, z);
    this.onGround = false;
  }

  // ------------------------------------------------------------------ sauvegarde

  saveState(): Record<string, unknown> {
    return {
      x: round3(this.x),
      y: round3(this.y),
      z: round3(this.z),
      vx: round3(this.vx),
      vy: round3(this.vy),
      vz: round3(this.vz),
      yaw: round3(this.yaw),
      pitch: round3(this.headPitch),
      health: round3(this.health),
      hunger: this.hunger,
      saturation: round3(this.saturation),
      exhaustion: round3(this.exhaustion),
      air: this.air,
      fire: this.fireTicks,
      effects: Array.from(this.effects, ([type, fx]) => ({ type, level: fx.level, ticks: fx.ticks })),
      fall: round3(this.fallDistance),
      xpLevel: this.xpLevel,
      xpProgress: round3(this.xpProgress),
      enchantSeed: this.enchantSeed,
      flying: this.flying,
      bed: this.bed ? [this.bed.x, this.bed.y, this.bed.z] : null,
      advancements: [...this.advancements],
      stats: { ...this.stats },
      inventory: this.inventory.save(),
    };
  }

  loadState(d: Record<string, unknown>): void {
    this.setPosition(num(d.x, this.x), num(d.y, this.y), num(d.z, this.z));
    this.vx = num(d.vx, 0);
    this.vy = num(d.vy, 0);
    this.vz = num(d.vz, 0);
    this.setRotation(num(d.yaw, 0), Math.max(-MAX_PITCH, Math.min(MAX_PITCH, num(d.pitch, 0))));
    this.health = Math.max(0, Math.min(this.maxHealth, num(d.health, this.maxHealth)));
    this.hunger = Math.max(0, Math.min(20, num(d.hunger, 20)));
    this.saturation = Math.max(0, num(d.saturation, 5));
    this.exhaustion = Math.max(0, num(d.exhaustion, 0));
    this.air = num(d.air, 300);
    this.fireTicks = num(d.fire, 0);
    this.effects.clear();
    const fx = Array.isArray(d.effects) ? d.effects : [];
    if (fx.length > 0 && typeof fx[0] === 'number') {
      // Ancien format [poison, slow, weak, wither]
      this.poisonTicks = Math.max(0, Math.floor(num(fx[0], 0)));
      this.slowTicks = Math.max(0, Math.floor(num(fx[1], 0)));
      this.weakTicks = Math.max(0, Math.floor(num(fx[2], 0)));
      this.witherTicks = Math.max(0, Math.floor(num(fx[3], 0)));
    } else {
      for (const entry of fx) {
        if (!entry || typeof entry !== 'object') continue;
        const o = entry as Record<string, unknown>;
        const t = o.type as EffectType;
        if (EFFECT_TYPES.includes(t)) {
          this.addEffect(t, Math.floor(num(o.ticks, 0)), Math.floor(num(o.level, 1)));
        }
      }
    }
    this.fallDistance = Math.max(0, num(d.fall, 0));
    this.xpLevel = Math.max(0, Math.floor(num(d.xpLevel, 0)));
    this.xpProgress = Math.max(0, Math.min(0.999, num(d.xpProgress, 0)));
    this.enchantSeed = Math.max(1, Math.floor(num(d.enchantSeed, 1337)) >>> 0);
    this.flying = this.spectator || (d.flying === true && this.creative);
    const bed = d.bed;
    this.bed =
      Array.isArray(bed) && bed.length === 3 && bed.every((v) => typeof v === 'number')
        ? { x: bed[0] as number, y: bed[1] as number, z: bed[2] as number }
        : null;
    this.advancements.clear();
    if (Array.isArray(d.advancements)) {
      for (const id of d.advancements) if (typeof id === 'string') this.advancements.add(id);
    }
    this.stats = loadStats(d.stats);
    this.inventory.load(d.inventory);
    if (this.health <= 0) this.deathTime = 20;
  }
}

/** Dégâts d'attaque de l'objet tenu (main nue : 1). */
export function attackDamage(itemId: number): number {
  return itemId > 0 ? getItem(itemId).attack : 1;
}
