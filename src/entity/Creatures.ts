/**
 * Créatures ajoutées après les premières (voir entity/Mobs) : slime, enderman, sorcière, cheval,
 * calamar, golem de fer, ocelot et chat. Chaque espèce s'inscrit auprès de la fabrique de Mobs
 * au chargement de ce module ; il suffit donc de l'importer une fois (le jeu le fait).
 *
 * Valeurs (vie, dégâts, butin) reprises de Minecraft 1.12.
 */
import { BLOCK_SOLID } from '../world/Blocks';
import { B, I } from '../world/Ids';
import type { World } from '../world/World';
import { Living, num } from './Entity';
import type { DamageCause, Entity, EntityData, GameApi, PlayerLike } from './Entity';
import { HORSE_VARIANTS } from './MobModels';
import { Animal, Mob, Monster, TAU, clamp, isDay, randInt, registerMob } from './Mobs';
import { ThrownPotion, type PotionEffect } from './Objects';
import { isBoxFree } from './Physics';

function isFluid(id: number): boolean {
  return id === B.WATER || id === B.LAVA;
}

// =============================================================================================
// Slime
// =============================================================================================

/**
 * Slime : cube vert qui avance par bonds. Trois tailles (4, 2, 1) : tué, un gros se divise en
 * 2 à 4 plus petits ; les plus petits ne blessent pas et lâchent des boules de slime.
 */
export class Slime extends Monster {
  size = 2;
  private jumpWait = 10;

  constructor(size = 2) {
    super('slime', 4, 0.05);
    this.setSize(size);
  }

  setSize(s: number): void {
    const size = s >= 4 ? 4 : s >= 2 ? 2 : 1;
    this.size = size;
    const w = 0.51 * size;
    this.width = w;
    this.height = w;
    this.eyeHeight = w * 0.625;
    this.mobScale = size;
    this.maxHealth = size * size;
    this.health = this.maxHealth;
  }

  protected override idle(game: GameApi): void {
    if (this.onGround && --this.jumpWait <= 0) {
      this.jumpWait = 10 + Math.floor(game.rng() * 20);
      this.yaw += (game.rng() - 0.5) * 2;
      this.headYaw = this.yaw;
      this.leap(game);
    } else if (!this.onGround) {
      this.moveForward = 0.8;
    }
  }

  protected fight(game: GameApi, t: Living): void {
    this.face(t.x, t.z);
    if (this.onGround && --this.jumpWait <= 0) {
      this.jumpWait = 4 + Math.floor(game.rng() * 8);
      this.leap(game);
    } else if (!this.onGround) {
      this.moveForward = 1;
    }
    // les petits slimes sont inoffensifs
    if (this.size > 1) this.melee(game, t, (this.width + t.width) / 2 + 0.25, this.size);
  }

  private leap(game: GameApi): void {
    this.vy = 0.42;
    this.onGround = false;
    this.moveForward = 1;
    game.sound('pop', this.x, this.y, this.z, 0.1 * this.size, 1.3 - this.size * 0.15);
  }

  protected override land(game: GameApi, distance: number): void {
    game.particles('slime', this.x, this.y + 0.1, this.z, this.size * 3, this.width * 0.5);
    super.land(game, distance);
  }

  protected dropLoot(game: GameApi): void {
    if (this.size === 1) {
      this.drop(game, I.SLIME_BALL, randInt(game.rng, 0, 2));
      return;
    }
    const count = 2 + Math.floor(game.rng() * 3);
    for (let i = 0; i < count; i++) {
      const child = new Slime(this.size / 2);
      const ox = ((i % 2) - 0.5) * this.width * 0.5;
      const oz = (Math.floor(i / 2) - 0.5) * this.width * 0.5;
      child.setPosition(this.x + ox, this.y + 0.3, this.z + oz);
      child.setRotation(game.rng() * TAU);
      game.spawn(child);
    }
  }

  protected override xpValue(): number {
    return this.size;
  }

  override saveExtra(d: EntityData): void {
    d.size = this.size;
  }

  override loadExtra(d: EntityData): void {
    this.setSize(num(d.size, 2));
    this.health = clamp(num(d.health, this.maxHealth), 1, this.maxHealth);
  }
}

/** Un chunk sur dix abrite des slimes en profondeur (sous y = 40), d'après la graine du monde. */
export function isSlimeChunk(seed: number, cx: number, cz: number): boolean {
  let h = (Math.imul(cx, 0x1f1f1f1f) ^ Math.imul(cz, 0x5f356495) ^ Math.imul(seed, 0x2545f491) ^ 0x3ad8025f) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) % 10 === 0;
}

// =============================================================================================
// Enderman
// =============================================================================================

/** Blocs qu'un enderman peut emporter (Minecraft 1.12). */
const CARRIABLE: ReadonlySet<number> = new Set<number>([
  B.GRASS, B.DIRT, B.SAND, B.GRAVEL, B.CLAY, B.DANDELION, B.POPPY, B.BROWN_MUSHROOM, B.RED_MUSHROOM,
  B.TNT, B.CACTUS, B.PUMPKIN, B.MELON,
]);

/**
 * Enderman : grand, noir, paisible tant qu'on ne le regarde pas dans les yeux et qu'on ne le frappe
 * pas. Provoqué, il fond sur sa cible en se téléportant. Les flèches ne l'atteignent jamais, l'eau
 * le blesse, et il déplace des blocs au hasard de ses promenades.
 */
export class Enderman extends Monster {
  private stare = 0;
  private teleportDelay = 0;

  constructor() {
    super('enderman', 40, 0.069);
    this.mobScale = 0.93;
  }

  /** Tant qu'il porte un bloc, il ne disparaît pas : le bloc serait perdu pour le monde. */
  get persistent(): boolean {
    return this.blockId !== 0 || super.persistent;
  }

  protected override aggressive(): boolean {
    return false;
  }

  protected override followRange(): number {
    return 64;
  }

  protected override loseRange(): number {
    return 72;
  }

  protected override behave(game: GameApi): void {
    if (this.teleportDelay > 0) this.teleportDelay--;
    // l'eau et la pluie le blessent : il s'enfuit
    const w = game.world;
    if ((this.age + this.id) % 10 === 0 && (this.inWater || (w.raining && w.canSeeSky(Math.floor(this.x), Math.floor(this.y + this.height), Math.floor(this.z))))) {
      this.hurt(game, 1, 'drown');
      this.dropTarget();
      this.angry = false;
      this.teleportRandomly(game);
    }
    // au grand jour, il se calme et disparaît ailleurs
    if (this.target && (this.age + this.id) % 20 === 0 && isDay(game) && game.rng() < 0.15
      && w.canSeeSky(Math.floor(this.x), Math.floor(this.y + this.height), Math.floor(this.z))) {
      this.dropTarget();
      this.angry = false;
      this.teleportRandomly(game);
    }
    if (!this.target) this.watch(game);
    super.behave(game);
  }

  /** Le joueur le regarde-t-il dans les yeux ? Cinq ticks de suite, et il attaque. */
  private watch(game: GameApi): void {
    const p = game.player;
    if (!p.targetable || this.distanceSqTo(p) > 64 * 64 || !this.stared(game, p)) {
      this.stare = 0;
      return;
    }
    if (++this.stare >= 5) {
      this.stare = 0;
      this.provoke(game, p);
    }
  }

  private stared(game: GameApi, p: PlayerLike): boolean {
    const dx = this.x - p.x;
    const dy = this.y + this.eyeHeight - (p.y + p.eyeHeight);
    const dz = this.z - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-3) return true;
    const cp = Math.cos(p.headPitch);
    const dot = (-Math.sin(p.yaw) * cp * dx + Math.sin(p.headPitch) * dy - Math.cos(p.yaw) * cp * dz) / d;
    return dot > 1 - 0.025 / d && this.canSee(game.world, p);
  }

  private provoke(game: GameApi, t: Living): void {
    this.setTarget(t);
    this.angry = true;
    game.sound('zombie', this.x, this.y + this.eyeHeight, this.z, 1, 0.5);
  }

  protected override dropTarget(): void {
    super.dropTarget();
    this.angry = false;
  }

  protected override onHurt(game: GameApi, cause: DamageCause, attacker: Entity | null): void {
    super.onHurt(game, cause, attacker);
    if (this.target) this.angry = true;
    // un coup qui ne vient pas d'une arme (chute, feu, magie) le fait fuir
    if (cause !== 'attack' && game.rng() < 0.9) this.teleportRandomly(game);
  }

  /** Flèches et projectiles ne le touchent jamais : il s'est déjà téléporté. */
  override hurt(game: GameApi, amount: number, cause: DamageCause, attacker: Entity | null = null): boolean {
    if (cause === 'arrow' || (cause === 'generic' && attacker)) {
      if (this.alive) for (let i = 0; i < 16 && !this.teleportRandomly(game); i++);
      return false;
    }
    return super.hurt(game, amount, cause, attacker);
  }

  protected fight(game: GameApi, t: Living): void {
    const dSq = this.distanceSqTo(t);
    // cible lointaine : il réapparaît près d'elle
    if (dSq > 256 && this.teleportDelay <= 0) {
      this.teleportDelay = 30;
      const a = game.rng() * TAU;
      this.teleportTo(game, t.x + Math.cos(a) * 3, t.y + 2, t.z + Math.sin(a) * 3);
    }
    this.chase(game, t, 1.7);
    // 4 / 7 / 10 dégâts en facile / normal / difficile
    this.melee(game, t, (this.width + t.width) / 2 + 0.7, [4, 4, 7, 10][clamp(Math.floor(game.difficulty), 1, 3)]);
  }

  protected override idle(game: GameApi): void {
    this.wander(game);
    const rng = game.rng;
    if (this.blockId === 0) {
      if (rng() < 1 / 40) this.pickUp(game);
    } else if (rng() < 1 / 1200) {
      this.putDown(game);
    }
  }

  /** Emporte un bloc voisin de la liste, s'il en trouve un à découvert. */
  private pickUp(game: GameApi): void {
    const w = game.world;
    const rng = game.rng;
    const x = Math.floor(this.x - 2 + rng() * 4);
    const y = Math.floor(this.y + rng() * 3);
    const z = Math.floor(this.z - 2 + rng() * 4);
    const v = w.getBlockAndMeta(x, y, z);
    const id = v & 255;
    if (!CARRIABLE.has(id) || BLOCK_SOLID[w.getBlock(x, y + 1, z)] === 1) return;
    w.setBlock(x, y, z, B.AIR, 0);
    this.blockId = id;
    this.blockMeta = v >> 8;
    game.blockSound('break', id, x + 0.5, y + 0.5, z + 0.5);
  }

  /** Repose le bloc porté sur un sol ferme voisin. */
  private putDown(game: GameApi): void {
    const w = game.world;
    const rng = game.rng;
    const x = Math.floor(this.x - 1 + rng() * 2);
    const y = Math.floor(this.y + rng() * 2);
    const z = Math.floor(this.z - 1 + rng() * 2);
    if (w.getBlock(x, y, z) !== B.AIR || BLOCK_SOLID[w.getBlock(x, y - 1, z)] !== 1) return;
    if (game.entitiesInBox(x, y, z, x + 1, y + 1, z + 1).length > 0) return;
    w.setBlock(x, y, z, this.blockId, this.blockMeta);
    game.blockSound('place', this.blockId, x + 0.5, y + 0.5, z + 0.5);
    this.blockId = 0;
    this.blockMeta = 0;
  }

  /** Téléportation au hasard dans un rayon de 32 blocs. Retourne false si aucun point d'arrivée ne convient. */
  teleportRandomly(game: GameApi): boolean {
    const rng = game.rng;
    return this.teleportTo(game, this.x + (rng() - 0.5) * 64, this.y + Math.floor(rng() * 16) - 4, this.z + (rng() - 0.5) * 64);
  }

  /** Se pose sur le premier sol ferme sous (x, y, z), si la place est libre et au sec. */
  private teleportTo(game: GameApi, x: number, y: number, z: number): boolean {
    const w = game.world;
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (!w.isLoaded(bx, bz)) return false;
    let by = Math.floor(clamp(y, 2, 125));
    let found = false;
    for (let i = 0; i < 40 && by > 1; i++, by--) {
      if (BLOCK_SOLID[w.getBlock(bx, by - 1, bz)] === 1) {
        found = true;
        break;
      }
    }
    if (!found) return false;
    const hw = this.width / 2;
    const cx = bx + 0.5;
    const cz = bz + 0.5;
    if (!isBoxFree(w, cx - hw, by, cz - hw, cx + hw, by + this.height, cz + hw)) return false;
    for (let dy = 0; dy < 3; dy++) if (isFluid(w.getBlock(bx, by + dy, bz))) return false;
    game.particles('portal', this.x, this.y + this.height * 0.5, this.z, 24, 0.8);
    game.sound('pop', this.x, this.y + 1, this.z, 0.8, 0.5);
    this.teleport(cx, by, cz);
    this.clearPath();
    game.particles('portal', cx, by + this.height * 0.5, cz, 24, 0.8);
    game.sound('pop', cx, by + 1, cz, 0.8, 0.6);
    return true;
  }

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.ENDER_PEARL, randInt(game.rng, 0, 1));
    if (this.blockId !== 0) this.drop(game, this.blockId, 1);
  }

  override saveExtra(d: EntityData): void {
    if (this.blockId !== 0) d.carried = [this.blockId, this.blockMeta];
  }

  override loadExtra(d: EntityData): void {
    const c = d.carried;
    if (Array.isArray(c) && typeof c[0] === 'number' && CARRIABLE.has(c[0])) {
      this.blockId = c[0];
      this.blockMeta = typeof c[1] === 'number' ? c[1] & 15 : 0;
    }
  }
}

// =============================================================================================
// Sorcière
// =============================================================================================

/** Ticks entre deux potions lancées, portée de tir, durée pour boire. */
const WITCH_THROW_INTERVAL = 60;
const WITCH_RANGE = 10;
const WITCH_DRINK_TICKS = 32;

/**
 * Sorcière : garde ses distances et jette des potions (lenteur de loin, poison, faiblesse de près,
 * sinon dégâts). Blessée, elle boit une potion de soin ; en feu, une potion qui l'éteint.
 */
export class Witch extends Monster {
  private throwTimer = 30;
  private drink: 'heal' | 'fire' | null = null;
  private drinkTicks = 0;
  private fireProof = 0;

  constructor() {
    super('witch', 26, 0.058);
  }

  /** Boit-elle une potion en ce moment ? */
  get drinking(): boolean {
    return this.drink !== null;
  }

  protected override behave(game: GameApi): void {
    if (this.fireProof > 0 && --this.fireProof === 0) this.fireImmune = false;
    if (this.drink) {
      if (--this.drinkTicks <= 0) {
        if (this.drink === 'heal') this.heal(4);
        else {
          this.fireTicks = 0;
          this.fireImmune = true;
          this.fireProof = 600;
        }
        this.drink = null;
        game.sound('burp', this.x, this.y + this.eyeHeight, this.z, 0.4, 1.2);
      } else if (this.drinkTicks % 6 === 0) {
        game.sound('drink', this.x, this.y + this.eyeHeight, this.z, 0.5, 0.9 + game.rng() * 0.2);
      }
    } else if (this.fireTicks > 0 && !this.fireImmune) {
      this.startDrink('fire');
    } else if (this.health < this.maxHealth && game.rng() < 0.05) {
      this.startDrink('heal');
    }
    super.behave(game);
  }

  private startDrink(kind: 'heal' | 'fire'): void {
    this.drink = kind;
    this.drinkTicks = WITCH_DRINK_TICKS;
  }

  protected fight(game: GameApi, t: Living): void {
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (!this.seesTarget || d > WITCH_RANGE - 2) this.chase(game, t);
    else this.face(t.x, t.z);
    if (this.drink || !this.seesTarget || d > WITCH_RANGE) {
      if (this.throwTimer < 20) this.throwTimer = 20;
      return;
    }
    if (--this.throwTimer > 0) return;
    this.throwTimer = WITCH_THROW_INTERVAL;
    this.throwPotion(game, t, this.choose(game, t, d));
  }

  /** Choix de la potion, comme dans Minecraft : lenteur de loin, poison, faiblesse de près, dégâts sinon. */
  private choose(game: GameApi, t: Living, d: number): PotionEffect {
    if (d >= 8 && t.slowTicks <= 0) return 'slow';
    if (t.health >= 8 && t.poisonTicks <= 0) return 'poison';
    if (d <= 3 && t.weakTicks <= 0 && game.rng() < 0.25) return 'weak';
    return 'harm';
  }

  private throwPotion(game: GameApi, t: Living, effect: PotionEffect): void {
    const ox = this.x;
    const oy = this.y + this.eyeHeight - 0.1;
    const oz = this.z;
    // vise un peu devant la cible, en cloche
    const dx = t.x + (t.x - t.px) * 4 - ox;
    const dz = t.z + (t.z - t.pz) * 4 - oz;
    const d = Math.sqrt(dx * dx + dz * dz);
    const dy = t.y + t.eyeHeight - 1.1 - oy + d * 0.2;
    const potion = new ThrownPotion(effect);
    potion.owner = this;
    potion.shoot(ox, oy, oz, dx, dy, dz, 0.75);
    game.spawn(potion);
    game.sound('bow', ox, oy, oz, 0.6, 0.6 + game.rng() * 0.2);
    this.swingArm();
  }

  protected dropLoot(game: GameApi): void {
    const loot = [I.GLOWSTONE_DUST, I.SUGAR, I.REDSTONE, I.SPIDER_EYE, I.GUNPOWDER, I.STICK];
    const kinds = randInt(game.rng, 1, 3);
    for (let i = 0; i < kinds; i++) this.drop(game, loot[Math.floor(game.rng() * loot.length)], randInt(game.rng, 0, 2));
  }
}

// =============================================================================================
// Cheval
// =============================================================================================

/** Hauteur des pieds du cavalier au-dessus de ceux du cheval. */
export const HORSE_SEAT = 0.85;
const HORSE_TREATS: ReadonlyMap<number, { heal: number; temper: number }> = new Map([
  [I.SUGAR, { heal: 1, temper: 3 }],
  [I.WHEAT, { heal: 2, temper: 3 }],
  [I.APPLE, { heal: 3, temper: 3 }],
  [I.GOLDEN_APPLE, { heal: 10, temper: 10 }],
]);

/**
 * Cheval. Pour l'apprivoiser, on le monte à mains nues jusqu'à ce qu'il cesse de désarçonner
 * (les friandises aident). Apprivoisé puis sellé, il obéit aux commandes de son cavalier :
 * avancer, tourner avec le regard, sauter. S'accroupir fait descendre.
 * Vie, vitesse et détente varient d'un cheval à l'autre.
 */
export class Horse extends Animal {
  /** 0..100 : chance (en %) qu'il se laisse apprivoiser à la prochaine tentative. */
  temper = 0;
  /** Vitesse sous la selle (0,1 = marche du joueur) et impulsion du saut. */
  speedStat: number;
  jumpStat: number;
  rider: PlayerLike | null = null;
  private buckTicks = 0;

  constructor(rng: () => number = Math.random) {
    super('horse', 20, 0.045, I.GOLDEN_APPLE);
    this.stepHeight = 1;
    this.variant = Math.floor(rng() * HORSE_VARIANTS);
    this.maxHealth = this.health = 15 + Math.floor(rng() * 8) + Math.floor(rng() * 9);
    this.speedStat = (0.45 + (rng() + rng() + rng()) * 0.3) * 0.25;
    this.jumpStat = 0.4 + (rng() + rng() + rng()) * 0.2;
  }

  override tick(game: GameApi): void {
    super.tick(game);
    const r = this.rider;
    if (!r) return;
    if (r.vehicle !== this || !r.alive || this.dead || !this.alive) {
      this.unseat(game);
      return;
    }
    // le cavalier suit sa monture, sans casser l'interpolation de sa position
    r.x = this.x;
    r.y = this.y + HORSE_SEAT * (this.baby ? 0.5 : 1);
    r.z = this.z;
  }

  private unseat(game: GameApi): void {
    const r = this.rider;
    this.rider = null;
    this.passenger = null;
    if (r && r.vehicle === this) r.dismount(game);
  }

  protected override behave(game: GameApi): void {
    const r = this.rider;
    if (!r || r.vehicle !== this) {
      if (r) {
        this.rider = null;
        this.passenger = null;
      }
      super.behave(game);
      return;
    }
    if (!this.tamed) {
      // il rue : après quelques secondes, il accepte son cavalier ou le jette à terre
      this.wander(game, 2.2);
      if (--this.buckTicks <= 0) {
        if (game.rng() * 100 < this.temper) this.tame(game);
        else {
          this.temper = Math.min(100, this.temper + 5);
          this.unseat(game);
          game.particles('smoke', this.x, this.y + this.height, this.z, 7, this.width * 0.5);
          game.sound('mob_hurt', this.x, this.y + this.eyeHeight, this.z, 0.8, 0.7);
        }
      }
      return;
    }
    if (!this.saddled) return;
    // sellé : il va où regarde son cavalier
    const inp = r.input;
    this.clearPath();
    this.yaw = r.yaw;
    const f = inp.forward < 0 ? inp.forward * 0.25 : inp.forward;
    this.moveForward = f;
    this.moveStrafe = inp.strafe * 0.5;
    this.speed = this.speedStat;
    if (inp.jump && this.onGround && !this.inWater) {
      this.vy = this.jumpStat;
      this.onGround = false;
      if (f > 0) {
        this.vx -= Math.sin(this.yaw) * 0.4 * f;
        this.vz -= Math.cos(this.yaw) * 0.4 * f;
      }
    }
  }

  private tame(game: GameApi): void {
    this.tamed = true;
    this.panicTicks = 0;
    game.particles('heart', this.x, this.y + this.height + 0.2, this.z, 7, this.width * 0.6);
    game.sound('orb', this.x, this.y, this.z, 0.7, 1.2);
  }

  override interact(game: GameApi, player: PlayerLike): boolean {
    if (!this.alive) return false;
    const held = player.heldItemId;
    const treat = HORSE_TREATS.get(held);
    if (treat) {
      // pomme dorée sur un cheval apprivoisé en pleine forme : reproduction
      if (held === I.GOLDEN_APPLE && this.tamed && !this.baby && this.health >= this.maxHealth) return super.interact(game, player);
      if (this.baby && held === I.GOLDEN_APPLE) return super.interact(game, player);
      if (this.health >= this.maxHealth && (this.tamed || this.temper >= 100)) return false;
      player.consumeHeld(1);
      this.heal(treat.heal);
      if (!this.tamed) this.temper = Math.min(100, this.temper + treat.temper);
      game.sound('eat', this.x, this.y + this.eyeHeight, this.z, 0.6);
      game.particles('bonemeal', this.x, this.y + this.height * 0.7, this.z, 4, this.width * 0.4);
      return true;
    }
    if (this.baby) return false;
    if (held === I.SADDLE) {
      if (!this.tamed || this.saddled) return false;
      this.saddled = true;
      player.consumeHeld(1);
      game.sound('door_close', this.x, this.y + this.height, this.z, 0.5, 1.4);
      return true;
    }
    if (player.input.sneak && this.saddled && held === 0 && !this.rider) {
      this.saddled = false;
      game.dropItem(this.x, this.y + this.height, this.z, I.SADDLE, 1);
      return true;
    }
    if (this.rider || !player.mount(this)) return false;
    this.rider = player;
    this.passenger = player;
    this.panicTicks = 0;
    this.buckTicks = 30 + Math.floor(game.rng() * 60);
    return true;
  }

  protected override inherit(game: GameApi, a: Animal, b: Animal): void {
    if (!(a instanceof Horse) || !(b instanceof Horse)) return;
    const rng = game.rng;
    this.variant = rng() < 0.5 ? a.variant : b.variant;
    // moyenne des parents et d'un tirage neuf, comme dans Minecraft
    const fresh = new Horse(rng);
    this.maxHealth = Math.round((a.maxHealth + b.maxHealth + fresh.maxHealth) / 3);
    this.health = this.maxHealth;
    this.speedStat = (a.speedStat + b.speedStat + fresh.speedStat) / 3;
    this.jumpStat = (a.jumpStat + b.jumpStat + fresh.jumpStat) / 3;
  }

  protected override onDeath(game: GameApi, cause: DamageCause, attacker: Entity | null): void {
    this.unseat(game);
    super.onDeath(game, cause, attacker);
  }

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.LEATHER, randInt(game.rng, 0, 2));
    if (this.saddled) this.drop(game, I.SADDLE, 1);
  }

  protected override saveExtra(d: EntityData): void {
    d.variant = this.variant;
    d.maxHealth = this.maxHealth;
    d.speed = Math.round(this.speedStat * 10000) / 10000;
    d.jump = Math.round(this.jumpStat * 1000) / 1000;
    if (this.tamed) d.tamed = 1;
    if (this.saddled) d.saddle = 1;
    if (this.temper > 0) d.temper = this.temper;
  }

  override loadExtra(d: EntityData): void {
    super.loadExtra(d);
    this.variant = clamp(Math.floor(num(d.variant, 0)), 0, HORSE_VARIANTS - 1);
    this.maxHealth = clamp(num(d.maxHealth, this.maxHealth), 1, 40);
    this.health = clamp(num(d.health, this.maxHealth), 1, this.maxHealth);
    this.speedStat = clamp(num(d.speed, this.speedStat), 0.05, 0.4);
    this.jumpStat = clamp(num(d.jump, this.jumpStat), 0.3, 1.1);
    this.tamed = d.tamed === 1;
    this.saddled = d.saddle === 1 && this.tamed;
    this.temper = clamp(Math.floor(num(d.temper, 0)), 0, 100);
  }
}

// =============================================================================================
// Calamar
// =============================================================================================

/**
 * Calamar : nage au hasard dans l'eau, s'asphyxie hors de l'eau, lâche des poches d'encre
 * (le colorant noir). Il apparaît et disparaît loin du joueur, comme les monstres.
 */
export class Squid extends Mob {
  private swimYaw = 0;
  private rise = 0;
  private thrust = 0.6;
  private swimTicks = 0;
  private dryTicks = 0;

  constructor() {
    super('squid', 10, 0.03);
    this.waterBreathing = true;
    this.airAccel = 0.02;
  }

  get leashable(): boolean {
    return true;
  }

  protected behave(game: GameApi): void {
    if (!this.persistent) {
      const dSq = this.distanceSqTo(game.player);
      if (dSq > 96 * 96 || (dSq > 40 * 40 && game.rng() < 1 / 800)) {
        this.dead = true;
        return;
      }
    }
    if (!this.inWater) {
      // échoué : il retombe et s'asphyxie
      this.flying = false;
      if (++this.dryTicks > 40 && this.age % 20 === 0) this.hurt(game, 2, 'drown');
      return;
    }
    this.dryTicks = 0;
    this.flying = true;
    const rng = game.rng;
    if (--this.swimTicks <= 0 || this.collidedH) {
      this.swimTicks = 40 + Math.floor(rng() * 80);
      this.swimYaw = rng() * TAU;
      this.rise = (rng() - 0.5) * 0.05;
      this.thrust = rng() < 0.2 ? 0 : 0.4 + rng() * 0.4;
    }
    this.turn(this.swimYaw, 0.12);
    this.moveForward = this.thrust;
    this.vy += this.rise;
    // rester sous la surface et au-dessus du fond
    const w = game.world;
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    if (w.getBlock(bx, Math.floor(this.y + this.height + 0.4), bz) !== B.WATER) {
      this.vy -= 0.04;
      if (this.rise > 0) this.rise = -this.rise;
    } else if (this.collidedV && this.rise < 0) {
      this.rise = -this.rise;
    }
  }

  protected override onHurt(game: GameApi): void {
    // jet d'encre et fuite
    game.particles('large_smoke', this.x, this.y + this.height * 0.5, this.z, 6, 0.4);
    this.swimTicks = 0;
  }

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.DYE_BLACK, randInt(game.rng, 1, 3));
  }

  protected xpValue(game: GameApi): number {
    return randInt(game.rng, 1, 3);
  }

  save(): EntityData | null {
    if (this.health <= 0 || this.dead) return null;
    return this.saveMob();
  }
}

// =============================================================================================
// Golem de fer
// =============================================================================================

/** Au-delà de cette distance de son point d'attache, le golem revient. */
const GOLEM_ROAM = 20;

/**
 * Golem de fer : gardien des villages. Il attaque les monstres qui s'approchent (pas les
 * creepers) et projette sa victime en l'air. Celui d'un village se retourne contre le joueur
 * qui le frappe ; celui que le joueur construit (quatre blocs de fer en T, une citrouille
 * dessus) ne l'attaque jamais.
 */
export class IronGolem extends Mob {
  playerMade = false;
  target: Living | null = null;
  private attackCooldown = 0;
  private homeX = Number.NaN;
  private homeZ = Number.NaN;

  constructor() {
    super('iron_golem', 100, 0.045);
    this.waterBreathing = true;
    this.stepHeight = 1;
  }

  get leashable(): boolean {
    return true;
  }

  get persistent(): boolean {
    return this.playerMade || super.persistent;
  }

  setHome(x: number, z: number): void {
    this.homeX = x;
    this.homeZ = z;
  }

  /** Insensible au recul et aux chutes. */
  override knockback(): void {}

  protected override land(): void {}

  protected behave(game: GameApi): void {
    if (Number.isNaN(this.homeX)) this.setHome(this.x, this.z);
    if (this.attackCooldown > 0) this.attackCooldown--;
    let t = this.target;
    if (t && (!t.alive || this.distanceSqTo(t) > 24 * 24 || (t === game.player && !game.player.targetable))) t = this.target = null;
    if (!t && (this.age + this.id) % 10 === 0) t = this.target = this.findThreat(game);
    if (t) {
      this.lookAt(t);
      const dx = t.x - this.x;
      const dz = t.z - this.z;
      const reach = (this.width + t.width) / 2 + 0.6;
      if (dx * dx + dz * dz > reach * reach) this.pathTo(game, t.x, t.y, t.z, 1.4, false);
      else {
        this.face(t.x, t.z);
        if (this.attackCooldown <= 0 && Math.abs(t.y - this.y) < this.height) {
          this.attackCooldown = 20;
          this.swingArm();
          if (t.hurt(game, 7 + Math.floor(game.rng() * 15), 'attack', this)) t.vy += 0.4;
          game.sound('attack_crit', this.x, this.y + this.eyeHeight, this.z, 0.8, 0.6);
        }
      }
      return;
    }
    const hx = this.homeX - this.x;
    const hz = this.homeZ - this.z;
    if (hx * hx + hz * hz > GOLEM_ROAM * GOLEM_ROAM) {
      this.pathTo(game, this.homeX, this.y, this.homeZ, 1, true);
      return;
    }
    this.clearPath();
    this.wander(game, 0.8);
  }

  /** Monstre le plus proche à portée de vue (16 blocs), creepers exceptés. */
  private findThreat(game: GameApi): Living | null {
    let best = 16 * 16;
    let found: Living | null = null;
    for (const e of game.entitiesInBox(this.x - 16, this.y - 6, this.z - 16, this.x + 16, this.y + 8, this.z + 16, this)) {
      if (!(e instanceof Monster) || !e.alive || e.mobKind === 'creeper') continue;
      const d = this.distanceSqTo(e);
      if (d < best && this.canSee(game.world, e)) {
        best = d;
        found = e;
      }
    }
    return found;
  }

  protected override onHurt(game: GameApi, _cause: DamageCause, attacker: Entity | null): void {
    if (!(attacker instanceof Living) || attacker === this) return;
    if (attacker === game.player && (this.playerMade || !game.player.targetable)) return;
    this.target = attacker;
  }

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.IRON_INGOT, randInt(game.rng, 3, 5));
    this.drop(game, B.POPPY, randInt(game.rng, 0, 2));
  }

  protected xpValue(): number {
    return 0;
  }

  save(): EntityData | null {
    if (this.health <= 0 || this.dead) return null;
    const d = this.saveMob();
    if (this.playerMade) d.made = 1;
    if (!Number.isNaN(this.homeX)) d.home = [Math.round(this.homeX), Math.round(this.homeZ)];
    return d;
  }

  override loadExtra(d: EntityData): void {
    this.playerMade = d.made === 1;
    const h = d.home;
    if (Array.isArray(h) && typeof h[0] === 'number' && typeof h[1] === 'number') this.setHome(h[0], h[1]);
  }
}

/**
 * Une citrouille vient d'être posée en (x, y, z) : si elle coiffe quatre blocs de fer en T
 * (deux empilés, un bras de chaque côté du bloc du haut), l'ensemble devient un golem de fer.
 * Retourne le golem créé, ou null.
 */
export function tryBuildGolem(game: GameApi, x: number, y: number, z: number): IronGolem | null {
  const w = game.world;
  const head = w.getBlock(x, y, z);
  if (head !== B.PUMPKIN && head !== B.JACK_O_LANTERN) return null;
  const iron = (bx: number, by: number, bz: number): boolean => w.getBlock(bx, by, bz) === B.IRON_BLOCK;
  if (!iron(x, y - 1, z) || !iron(x, y - 2, z)) return null;
  for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
    if (!iron(x + dx, y - 1, z + dz) || !iron(x - dx, y - 1, z - dz)) continue;
    const cells: Array<[number, number, number]> = [[x, y, z], [x, y - 1, z], [x, y - 2, z], [x + dx, y - 1, z + dz], [x - dx, y - 1, z - dz]];
    for (const [bx, by, bz] of cells) {
      game.blockParticles(bx + 0.5, by + 0.5, bz + 0.5, w.getBlock(bx, by, bz), 0, 6);
      w.setBlock(bx, by, bz, B.AIR, 0);
    }
    const golem = new IronGolem();
    golem.playerMade = true;
    golem.setPosition(x + 0.5, y - 2, z + 0.5);
    golem.setRotation(game.player.yaw + Math.PI);
    golem.setHome(x + 0.5, z + 0.5);
    game.spawn(golem);
    game.sound('levelup', x + 0.5, y, z + 0.5, 0.5, 0.6);
    return golem;
  }
  return null;
}

// =============================================================================================
// Ocelot et chat
// =============================================================================================

/**
 * Ocelot : félin farouche des jungles, qui fuit le joueur sauf s'il s'approche accroupi ou lui
 * tend du poisson cru. Nourri de poisson, il peut s'apprivoiser : il devient un chat (trois
 * pelages), suit son maître, s'assoit sur un clic droit, et fait fuir les creepers.
 */
export class Ocelot extends Animal {
  owner: string | null = null;

  constructor() {
    super('ocelot', 10, 0.06, I.RAW_FISH);
  }

  /** Retombe toujours sur ses pattes. */
  protected override land(): void {}

  protected override behave(game: GameApi): void {
    if (this.tamed && this.sitting && this.panicTicks <= 0) {
      if (this.growTicks > 0 && --this.growTicks <= 0) this.setBaby(0);
      if (this.breedCooldown > 0) this.breedCooldown--;
      this.vx = 0;
      this.vz = 0;
      const p = game.player;
      if (p.alive && this.distanceSqTo(p) < 64) this.lookAt(p, 10);
      return;
    }
    super.behave(game);
  }

  protected override special(game: GameApi): boolean {
    const p = game.player;
    if (!p.alive) return false;
    const dSq = this.distanceSqTo(p);
    if (!this.tamed) {
      // farouche : un joueur debout à moins de 6 blocs le fait détaler
      if (dSq < 36 && !p.sneaking && p.targetable) {
        this.startle(game, p, 40);
        return true;
      }
      return false;
    }
    if (dSq > 144 && p.onGround) {
      this.joinOwner(game.world, p);
      return true;
    }
    if (dSq > 16) {
      this.lookAt(p, 10);
      this.pathTo(game, p.x, p.y, p.z, 1.25, true);
      return true;
    }
    return false;
  }

  /** Trop loin de son maître : le chat réapparaît près de lui. */
  private joinOwner(w: World, owner: PlayerLike): void {
    const ox = Math.floor(owner.x);
    const oy = Math.floor(owner.y);
    const oz = Math.floor(owner.z);
    const hw = this.width / 2;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
        const x = ox + dx;
        const z = oz + dz;
        if (!w.isLoaded(x, z) || BLOCK_SOLID[w.getBlock(x, oy - 1, z)] !== 1) continue;
        if (!isBoxFree(w, x + 0.5 - hw, oy, z + 0.5 - hw, x + 0.5 + hw, oy + this.height, z + 0.5 + hw)) continue;
        this.setPosition(x + 0.5, oy, z + 0.5);
        this.vx = this.vy = this.vz = 0;
        this.clearPath();
        return;
      }
    }
  }

  protected override onHurt(game: GameApi, cause: DamageCause, attacker: Entity | null): void {
    this.sitting = false;
    super.onHurt(game, cause, attacker);
  }

  override interact(game: GameApi, player: PlayerLike): boolean {
    if (!this.alive) return false;
    const held = player.heldItemId;
    if (!this.tamed) {
      if (held !== I.RAW_FISH) return false;
      player.consumeHeld(1);
      if (game.rng() < 1 / 3) {
        this.tamed = true;
        this.owner = 'player';
        this.variant = 1 + Math.floor(game.rng() * 3);
        this.sitting = true;
        this.panicTicks = 0;
        this.clearPath();
        game.particles('heart', this.x, this.y + this.height + 0.2, this.z, 7, this.width);
        game.sound('orb', this.x, this.y, this.z, 0.7, 1.3);
      } else {
        game.particles('smoke', this.x, this.y + this.height + 0.2, this.z, 5, this.width);
      }
      return true;
    }
    if (held === I.RAW_FISH) {
      if (this.health < this.maxHealth) {
        player.consumeHeld(1);
        this.heal(2);
        game.sound('eat', this.x, this.y + this.eyeHeight, this.z, 0.6, 1.3);
        return true;
      }
      if (super.interact(game, player)) {
        this.sitting = false;
        return true;
      }
    }
    this.sitting = !this.sitting;
    if (this.sitting) {
      this.vx = this.vz = 0;
      this.clearPath();
    }
    return true;
  }

  /** Le chaton de deux chats est un chat. */
  protected override inherit(game: GameApi, a: Animal, b: Animal): void {
    const p = game.rng() < 0.5 ? a : b;
    if (p instanceof Ocelot && p.tamed) {
      this.tamed = true;
      this.owner = p.owner;
      this.variant = p.variant;
    }
  }

  protected dropLoot(): void {}

  protected override saveExtra(d: EntityData): void {
    if (this.tamed) {
      d.owner = this.owner ?? 'player';
      d.variant = this.variant;
      d.sit = this.sitting ? 1 : 0;
    }
  }

  override loadExtra(d: EntityData): void {
    super.loadExtra(d);
    if (typeof d.owner === 'string' && d.owner.length > 0) {
      this.tamed = true;
      this.owner = d.owner;
      this.variant = clamp(Math.floor(num(d.variant, 1)), 1, 3);
      this.sitting = d.sit === 1;
    }
  }
}

// =============================================================================================
// Inscription auprès de la fabrique
// =============================================================================================

registerMob('slime', () => new Slime());
registerMob('enderman', () => new Enderman());
registerMob('witch', () => new Witch());
registerMob('horse', (rng) => new Horse(rng));
registerMob('squid', () => new Squid());
registerMob('iron_golem', () => new IronGolem());
registerMob('ocelot', () => new Ocelot());
