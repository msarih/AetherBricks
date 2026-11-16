/**
 * Créatures : animaux (cochon, vache, mouton, poule) et monstres (zombie, squelette, creeper, araignée).
 *
 * Pilotage volontairement simple, sans recherche de chemin : la créature tourne vers sa cible,
 * avance, saute quand elle bute contre un bloc, contourne quand elle n'avance plus, nage en surface,
 * et refuse en errance les vides de plus de 3 blocs, l'eau, la lave, le feu et les cactus.
 *
 * Conventions : lacet 0 = regarde vers -z, avant = (-sin lacet, 0, -cos lacet) ; 20 ticks par seconde.
 */
import type { SfxName } from '../audio/Sfx';
import { BLOCK_SOLID } from '../world/Blocks';
import { B, COLOR_HEX, I } from '../world/Ids';
import { newRayHit, raycast } from '../world/Raycast';
import type { World } from '../world/World';
import { Living, num } from './Entity';
import type { DamageCause, Entity, EntityData, GameApi, PlayerLike } from './Entity';
import type { EntityKind } from './EntityView';
import { getMobModel } from './MobModels';
import type { MobKind } from './MobModels';
import { Arrow } from './Objects';
import { findPath, type PathPoint } from './Pathfinder';
import { isBoxFree } from './Physics';

export const PASSIVE_KINDS: readonly MobKind[] = ['pig', 'cow', 'sheep', 'chicken'];
export const HOSTILE_KINDS: readonly MobKind[] = ['zombie', 'skeleton', 'creeper', 'spider'];

/** Rayon (en blocs) autour des parents ou de l'œuf dans lequel on compte les animaux. */
export const ANIMAL_RADIUS = 32;
/** Au-delà de ce nombre d'animaux dans le rayon ANIMAL_RADIUS, plus de naissance (reproduction, œuf cassé). */
export const ANIMAL_CAP = 24;

const TAU = Math.PI * 2;
/** Ticks d'amour après avoir été nourri. */
const LOVE_TICKS = 600;
/** Délai entre deux reproductions (5 minutes). */
const BREED_COOLDOWN = 6000;
/** Durée de croissance d'un petit jusqu'à l'âge adulte (20 minutes). */
export const BABY_GROW_TICKS = 24000;
/** Durée de la panique après un coup (3 secondes). */
const PANIC_TICKS = 60;
/** Distance de repérage du joueur par les monstres. */
const FOLLOW_RANGE = 16;
/** Distance à laquelle un monstre abandonne sa cible. */
const LOSE_RANGE = 32;
/** Durée de la mèche du creeper. */
const FUSE_TICKS = 30;
/** Gravité d'une flèche (blocs par tick²) et vitesse des flèches de squelette. */
const ARROW_GRAVITY = 0.05;
const ARROW_SPEED = 1.6;

const ray = newRayHit();

function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Entier aléatoire dans [lo, hi]. */
function randInt(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Fait-il jour (le soleil brûle les morts-vivants, les araignées sont paisibles) ? */
function isDay(game: GameApi): boolean {
  const t = game.dayTime;
  return t < 12500 || t >= 23500;
}

/**
 * Recale le centre d'une boîte de demi-largeur `hw` dont un bord frôle une limite de bloc (au seizième).
 * Physics.move recalcule la boîte depuis le centre à chaque tick : après un arrêt contre un mur, l'arrondi
 * flottant peut la faire commencer un cheveu à l'intérieur du mur, que move() ne voit alors plus, et la
 * créature le traverse. On ramène donc le bord du bon côté de la limite.
 */
function snapAxis(c: number, hw: number): number {
  const lo = c - hw;
  let r = Math.round(lo * 16) / 16;
  if (lo < r && r - lo < 1e-7) return r + hw + 1e-9;
  const hi = c + hw;
  r = Math.round(hi * 16) / 16;
  if (hi > r && hi - r < 1e-7) return r - hw - 1e-9;
  return c;
}

function countAnimals(game: GameApi, x: number, z: number): number {
  let n = 0;
  const rSq = ANIMAL_RADIUS * ANIMAL_RADIUS;
  for (const e of game.entities) {
    if (e instanceof Animal && !e.dead) {
      const dx = e.x - x;
      const dz = e.z - z;
      if (dx * dx + dz * dz <= rSq) n++;
    }
  }
  return n;
}

// =============================================================================================
// Base commune
// =============================================================================================

export abstract class Mob extends Living {
  readonly kind: EntityKind = 'mob';
  /** Valeur de `speed` à l'allure normale (0.1 = joueur, 4,3 blocs/s). */
  protected walkSpeed: number;
  /** Cri de l'espèce (ambiance, blessure, mort) ; null = muette. */
  protected voice: SfxName | null = null;

  // errance
  private wanderX = 0;
  private wanderZ = 0;
  private wanderTicks = 0;
  private pauseTicks: number;

  // regard
  private lookTarget: Entity | null = null;
  private lookOffset = 0;
  private lookTicks = 0;
  /** Tête baissée (mouton qui broute). */
  protected headDown = false;

  // détection de blocage et contournement
  private sampleX = 0;
  private sampleY = 0;
  private sampleZ = 0;
  private sampleTicks = 0;
  private sampleDist = 0;
  /** Ticks du relevé en cours passés à buter contre un obstacle. */
  private blockedTicks = 0;
  private detourTicks = 0;
  private detourSign = 1;
  /** Détours enchaînés sans avoir progressé : chacun part de l'autre côté et dure deux fois plus. */
  private detourStreak = 0;
  /** Grimpe aux murs : buter contre un obstacle n'est pas être bloquée. */
  protected climbs = false;
  /** Chemin calculé par A* vers la cible (uniquement hors errance). */
  private path: PathPoint[] | null = null;
  private pathIndex = 0;
  private pathGoalX = 0;
  private pathGoalZ = 0;
  private lastPathTick = -100;

  private ambientDelay: number;

  constructor(kind: MobKind, health: number, walkSpeed: number) {
    super();
    this.mobKind = kind;
    const m = getMobModel(kind);
    this.width = m.width;
    this.height = m.height;
    this.eyeHeight = m.eyeHeight;
    this.stepHeight = 0.6;
    this.health = this.maxHealth = health;
    this.walkSpeed = walkSpeed;
    this.speed = walkSpeed;
    this.pauseTicks = Math.floor(Math.random() * 60);
    this.ambientDelay = 100 + Math.floor(Math.random() * 400);
  }

  /** Comportement du tick : fixe moveForward / moveStrafe / jumping / speed et le lacet. */
  protected abstract behave(game: GameApi): void;
  /** Butin lâché à la mort. `burning` : mort en feu ; `byPlayer` : tué par le joueur. */
  protected abstract dropLoot(game: GameApi, burning: boolean, byPlayer: boolean): void;
  /** Expérience donnée au joueur qui la tue. */
  protected abstract xpValue(game: GameApi): number;

  protected think(game: GameApi): void {
    // avant le déplacement du tick : ne pas traverser le mur contre lequel on s'appuie (voir snapAxis)
    const hw = this.width / 2;
    this.x = snapAxis(this.x, hw);
    this.z = snapAxis(this.z, hw);
    this.moveStrafe = 0;
    this.moveForward = 0;
    this.jumping = false;
    this.speed = this.walkSpeed;
    this.behave(game);
    if (this.dead) return;
    // nage : garder la tête hors de l'eau
    if (this.inWater || this.inLava) this.jumping = true;
    if (((this.age + this.id) & 3) === 0) this.pushApart(game);
    if (--this.ambientDelay <= 0) {
      this.ambientDelay = 160 + Math.floor(game.rng() * 400);
      const s = this.ambientSound(game);
      if (s) game.sound(s, this.x, this.y + this.eyeHeight, this.z, 0.8, (this.baby ? 1.4 : 0.9) + game.rng() * 0.2);
    }
    this.updateHead();
  }

  // ------------------------------------------------------------------ pilotage

  /** Tourne le corps vers le lacet voulu, d'au plus `max` radians. */
  protected turn(want: number, max = 0.5): void {
    this.yaw += clamp(wrapAngle(want - this.yaw), -max, max);
  }

  /** Tourne le corps vers un point. */
  protected face(tx: number, tz: number, max = 0.5): void {
    const dx = tx - this.x;
    const dz = tz - this.z;
    if (dx * dx + dz * dz > 1e-6) this.turn(Math.atan2(-dx, -dz), max);
  }

  /**
   * Suit un chemin A* vers `(tx, ty, tz)` : réservé aux créatures ayant une cible (poursuite,
   * nourriture, partenaire). Le calcul est plafonné et étalé entre les créatures (toutes les 15 ticks).
   */
  protected pathTo(game: GameApi, tx: number, ty: number, tz: number, factor: number, careful: boolean): void {
    const gx = Math.floor(tx);
    const gz = Math.floor(tz);
    const elapsed = this.age - this.lastPathTick;
    const goalMoved = Math.abs(gx - this.pathGoalX) + Math.abs(gz - this.pathGoalZ) >= 2;
    const staggeredTurn = ((this.age + this.id * 3) % 15) === 0;
    if (!this.climbs && (staggeredTurn || (this.path === null && elapsed >= 12) || (goalMoved && elapsed >= 10))) {
      this.lastPathTick = this.age;
      this.pathGoalX = gx;
      this.pathGoalZ = gz;
      this.path = findPath(game.world, this.x, this.y, this.z, tx, ty, tz, this.height, careful);
      this.pathIndex = 0;
    }
    if (this.path && this.pathIndex < this.path.length) {
      let wp = this.path[this.pathIndex];
      const dx = wp.x - this.x;
      const dz = wp.z - this.z;
      if (dx * dx + dz * dz < 0.36 && Math.abs(wp.y - this.y) < 1.2) {
        this.pathIndex++;
        if (this.pathIndex < this.path.length) wp = this.path[this.pathIndex];
      }
      if (this.pathIndex < this.path.length) {
        this.walkTo(game, wp.x, wp.z, factor, careful);
        if (wp.y > this.y + 0.2 && this.onGround) this.jumping = true;
        return;
      }
    }
    this.walkTo(game, tx, tz, factor, careful);
  }

  protected clearPath(): void {
    this.path = null;
    this.pathIndex = 0;
  }

  /**
   * Marche vers (tx, tz) à `factor` fois l'allure normale. `careful` : refuse les vides de plus de
   * 3 blocs et l'eau (errance) ; sinon seuls la lave, le feu et les cactus arrêtent la créature.
   * Retourne false si elle n'ose pas avancer.
   */
  protected walkTo(game: GameApi, tx: number, tz: number, factor: number, careful: boolean): boolean {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const distSq = dx * dx + dz * dz;
    let want = distSq > 1e-6 ? Math.atan2(-dx, -dz) : this.yaw;
    if (this.detourTicks > 0) {
      this.detourTicks--;
      want += this.detourSign * 1.2;
    }
    this.turn(want);
    this.speed = this.walkSpeed * factor;

    if (this.hazard(game.world, -Math.sin(this.yaw), -Math.cos(this.yaw), careful)) {
      if (!careful && this.detourTicks <= 0) this.startDetour(game);
      return false;
    }
    this.moveForward = 1;
    if (this.collidedH) {
      this.blockedTicks++;
      if (this.onGround) this.jumping = true;
    }

    // relevé toutes les 20 ticks : n'avance plus, ou bute contre un mur sans se rapprocher → contourner
    if (++this.sampleTicks >= 20) {
      const dist = Math.sqrt(distSq);
      const sx = this.x - this.sampleX;
      const sy = this.y - this.sampleY;
      const sz = this.z - this.sampleZ;
      const still = sx * sx + sy * sy + sz * sz < 0.16;
      const walled = !this.climbs && this.blockedTicks >= 10 && this.sampleDist - dist < 0.4;
      if (this.detourTicks > 0) {
        // le détour bute lui aussi : essayer l'autre côté
        if (still) this.detourSign = -this.detourSign;
      } else if (still || walled) {
        this.startDetour(game);
      } else {
        this.detourStreak = 0;
      }
      this.sampleX = this.x;
      this.sampleY = this.y;
      this.sampleZ = this.z;
      this.sampleDist = dist;
      this.blockedTicks = 0;
      this.sampleTicks = 0;
    }
    return true;
  }

  /** Détour : marche de biais (1,2 rad) ; d'un côté au hasard d'abord, puis en alternant et en doublant la durée. */
  private startDetour(game: GameApi): void {
    this.detourTicks = (15 + Math.floor(game.rng() * 25)) * Math.min(8, 1 << this.detourStreak);
    this.detourSign = this.detourStreak === 0 ? (game.rng() < 0.5 ? 1 : -1) : -this.detourSign;
    this.detourStreak++;
  }

  /**
   * Danger dans la direction unitaire (dx, dz), juste devant la boîte : lave, feu, cactus, colonne non chargée,
   * et si `careful` eau ou vide de plus de 3 blocs. Ignoré en l'air et dans un fluide.
   */
  protected hazard(w: World, dx: number, dz: number, careful: boolean): boolean {
    if (!this.onGround || this.inWater || this.inLava) return false;
    const reach = this.width / 2 + 0.5;
    const ax = Math.floor(this.x + dx * reach);
    const az = Math.floor(this.z + dz * reach);
    if (!w.isLoaded(ax, az)) return true;
    const by = Math.floor(this.y + 0.01);
    // d = 0 : mur ou marche ; d = 1 : sol de plain-pied ; d = 2..4 : chute de 1 à 3 blocs
    for (let d = 0; d <= 4; d++) {
      const id = w.getBlock(ax, by - d, az);
      if (id === B.LAVA || id === B.FIRE || id === B.CACTUS) return true;
      if (id === B.WATER) return careful;
      if (BLOCK_SOLID[id] === 1) return false;
    }
    return careful;
  }

  /** Errance : pauses, puis marche vers un point proche tiré au hasard. */
  protected wander(game: GameApi, factor = 1): void {
    if (this.wanderTicks > 0) {
      this.wanderTicks--;
      const dx = this.wanderX - this.x;
      const dz = this.wanderZ - this.z;
      if (dx * dx + dz * dz < 1 || !this.walkTo(game, this.wanderX, this.wanderZ, factor, true)) {
        this.wanderTicks = 0;
        this.pauseTicks = 20 + Math.floor(game.rng() * 100);
      } else if (this.wanderTicks === 0) {
        this.pauseTicks = 40 + Math.floor(game.rng() * 120);
      }
      return;
    }
    // dans l'eau, pas de pause : rejoindre la terre ferme
    if (this.inWater) this.pauseTicks = 0;
    if (this.pauseTicks > 0) {
      this.pauseTicks--;
      this.idleLook(game);
      return;
    }
    const a = game.rng() * TAU;
    const dist = 3 + game.rng() * 6;
    const tx = this.x + Math.cos(a) * dist;
    const tz = this.z + Math.sin(a) * dist;
    if (!game.world.isLoaded(Math.floor(tx), Math.floor(tz))) {
      this.pauseTicks = 20;
      return;
    }
    this.wanderX = tx;
    this.wanderZ = tz;
    this.wanderTicks = 60 + Math.floor(game.rng() * 100);
  }

  /** L'errance en cours est-elle une pause (créature immobile) ? */
  protected get resting(): boolean {
    return this.wanderTicks <= 0 && this.pauseTicks > 0;
  }

  // ------------------------------------------------------------------ regard

  /** Regarde une entité pendant `ticks` ticks. */
  protected lookAt(e: Entity, ticks = 2): void {
    this.lookTarget = e;
    this.lookTicks = ticks;
  }

  /** À l'arrêt : regarde parfois ailleurs, ou suit des yeux le joueur proche. */
  private idleLook(game: GameApi): void {
    if (this.lookTicks > 0 || game.rng() >= 0.02) return;
    const p = game.player;
    if (p.alive && this.distanceSqTo(p) < 36 && game.rng() < 0.7) {
      this.lookAt(p, 40 + Math.floor(game.rng() * 40));
    } else {
      this.lookTarget = null;
      this.lookOffset = (game.rng() * 2 - 1) * 1.1;
      this.lookTicks = 20 + Math.floor(game.rng() * 40);
    }
  }

  private updateHead(): void {
    let wantYaw = this.yaw;
    let wantPitch = 0;
    if (this.headDown) {
      wantPitch = -1;
    } else if (this.lookTicks > 0) {
      this.lookTicks--;
      const t = this.lookTarget;
      if (t && !t.dead) {
        const dx = t.x - this.x;
        const dz = t.z - this.z;
        const eye = t instanceof Living ? t.eyeHeight : t.height * 0.5;
        const dy = t.y + eye - (this.y + this.eyeHeight);
        const h = Math.sqrt(dx * dx + dz * dz);
        if (h > 1e-3) wantYaw = Math.atan2(-dx, -dz);
        wantPitch = clamp(Math.atan2(dy, Math.max(h, 0.3)), -1, 1);
      } else {
        wantYaw = this.yaw + this.lookOffset;
      }
    } else {
      this.lookTarget = null;
    }
    // la tête ne dépasse pas l'épaule
    wantYaw = this.yaw + clamp(wrapAngle(wantYaw - this.yaw), -1.3, 1.3);
    this.headYaw += clamp(wrapAngle(wantYaw - this.headYaw), -0.35, 0.35);
    this.headPitch += (wantPitch - this.headPitch) * 0.3;
  }

  // ------------------------------------------------------------------ voisinage

  /** Répulsion douce avec les êtres vivants qui chevauchent la boîte. */
  private pushApart(game: GameApi): void {
    const hw = this.width / 2 + 0.1;
    const list = game.entitiesInBox(this.x - hw, this.y, this.z - hw, this.x + hw, this.y + this.height, this.z + hw, this);
    let px = 0;
    let pz = 0;
    for (const e of list) {
      if (!(e instanceof Living) || !e.alive) continue;
      let dx = this.x - e.x;
      let dz = this.z - e.z;
      let len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) {
        dx = game.rng() - 0.5;
        dz = game.rng() - 0.5;
        len = Math.sqrt(dx * dx + dz * dz) || 1;
      }
      const k = 0.05 / len;
      px += dx * k;
      pz += dz * k;
      // les autres créatures se repoussent elles-mêmes à leur tour
      if (!(e instanceof Mob)) {
        e.vx -= dx * k;
        e.vz -= dz * k;
      }
    }
    const p = Math.sqrt(px * px + pz * pz);
    if (p < 1e-6) return;
    // une bousculade ne pousse personne dans le vide, l'eau ou la lave
    if (this.hazard(game.world, px / p, pz / p, true)) return;
    this.vx += px;
    this.vz += pz;
  }

  /** Ligne de vue des yeux aux yeux, arrêtée par les blocs à collision. */
  protected canSee(w: World, e: Living): boolean {
    const ox = this.x;
    const oy = this.y + this.eyeHeight;
    const oz = this.z;
    const dx = e.x - ox;
    const dy = e.y + e.eyeHeight - oy;
    const dz = e.z - oz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-3) return true;
    return !raycast(w, ox, oy, oz, dx / dist, dy / dist, dz / dist, dist, ray, true);
  }

  // ------------------------------------------------------------------ dégâts, sons, butin

  hurt(game: GameApi, amount: number, cause: DamageCause, attacker: Entity | null = null): boolean {
    if (!super.hurt(game, amount, cause, attacker)) return false;
    if (this.health > 0) this.onHurt(game, cause, attacker);
    return true;
  }

  /** Appelé après un coup encaissé dont la créature a réchappé. */
  protected onHurt(_game: GameApi, _cause: DamageCause, _attacker: Entity | null): void {}

  protected ambientSound(_game: GameApi): SfxName | null {
    return this.voice;
  }

  protected hurtSound(): SfxName | null {
    return this.voice ?? 'mob_hurt';
  }

  protected deathSound(): SfxName | null {
    return this.voice ?? 'mob_hurt';
  }

  protected onDeath(game: GameApi, cause: DamageCause, attacker: Entity | null): void {
    if (this.baby) return;
    const killer = attacker ?? this.attacker;
    const byPlayer = killer === game.player;
    this.dropLoot(game, this.fireTicks > 0 || cause === 'fire' || cause === 'lava', byPlayer);
    if (byPlayer) {
      const xp = this.xpValue(game);
      if (xp > 0) game.player.addXp(xp);
    }
  }

  /** Lâche `count` exemplaires d'un objet à mi-hauteur du corps. */
  protected drop(game: GameApi, id: number, count: number): void {
    if (count > 0) game.dropItem(this.x, this.y + this.height * 0.5, this.z, id, count);
  }

  /** État propre à l'espèce, ajouté à la sauvegarde. */
  protected saveExtra(_d: EntityData): void {}

  /** Restaure l'état propre à l'espèce. */
  loadExtra(_d: EntityData): void {}
}

// =============================================================================================
// Animaux
// =============================================================================================

export abstract class Animal extends Mob {
  /** Objet qui l'attire et permet la reproduction. */
  readonly food: number;
  /** Ticks de panique restants. */
  panicTicks = 0;
  /** Ticks d'amour restants (nourri, cherche un partenaire). */
  loveTicks = 0;
  /** Ticks avant de pouvoir se reproduire à nouveau. */
  breedCooldown = 0;
  /** Ticks restants avant l'âge adulte (0 = adulte). */
  growTicks = 0;

  private readonly adultWidth: number;
  private readonly adultHeight: number;
  private readonly adultEyeHeight: number;
  private fleeX = 0;
  private fleeZ = 0;
  private fleeTicks = 0;
  /** Agresseur fui pendant la panique. */
  private fleeFrom: Entity | null = null;
  private mate: Animal | null = null;
  /** Adulte suivi par un petit. */
  private parent: Animal | null = null;

  constructor(kind: MobKind, health: number, walkSpeed: number, food: number) {
    super(kind, health, walkSpeed);
    this.food = food;
    this.adultWidth = this.width;
    this.adultHeight = this.height;
    this.adultEyeHeight = this.eyeHeight;
  }

  /** Transforme l'animal en petit (ou le remet à la taille adulte si `ticks <= 0`). */
  setBaby(ticks = BABY_GROW_TICKS): void {
    this.growTicks = Math.max(0, Math.floor(ticks));
    const isBaby = this.growTicks > 0;
    this.baby = isBaby;
    const scale = isBaby ? 0.5 : 1;
    this.width = this.adultWidth * scale;
    this.height = this.adultHeight * scale;
    this.eyeHeight = this.adultEyeHeight * scale;
  }

  protected behave(game: GameApi): void {
    if (this.growTicks > 0) {
      if (--this.growTicks <= 0) this.setBaby(0);
    }
    if (this.breedCooldown > 0) this.breedCooldown--;
    if (this.panicTicks > 0) {
      this.panicTicks--;
      this.panic(game);
      return;
    }
    if (!this.baby && this.loveTicks > 0) {
      this.loveTicks--;
      if ((this.age & 15) === 0) game.particles('heart', this.x, this.y + this.height + 0.2, this.z, 1, this.width * 0.5);
      if (this.seekMate(game)) return;
    }
    if (this.tempted(game)) return;
    if (this.baby && this.followParent(game)) return;
    if (this.special(game)) return;
    this.wander(game);
  }

  /**
   * Un petit rejoint l'adulte de son espèce le plus proche (8 blocs alentour) dès qu'il s'en
   * éloigne de plus de 3 blocs. Retourne true s'il occupe le tick.
   */
  private followParent(game: GameApi): boolean {
    let a = this.parent;
    if (a && (!a.alive || a.baby || this.distanceSqTo(a) > 256)) a = this.parent = null;
    if (!a && ((this.age + this.id) % 20) === 0) {
      let best = 64;
      for (const e of game.entitiesInBox(this.x - 8, this.y - 4, this.z - 8, this.x + 8, this.y + 4 + this.height, this.z + 8, this)) {
        if (!(e instanceof Animal) || e.mobKind !== this.mobKind || !e.alive || e.baby) continue;
        const d = this.distanceSqTo(e);
        if (d < best) {
          best = d;
          a = e;
        }
      }
      this.parent = a;
    }
    if (!a || this.distanceSqTo(a) < 9) return false;
    this.lookAt(a, 5);
    this.pathTo(game, a.x, a.y, a.z, 1.1, true);
    return true;
  }

  /** Comportement propre à l'espèce, prioritaire sur l'errance. Retourne true s'il occupe le tick. */
  protected special(_game: GameApi): boolean {
    return false;
  }

  protected onHurt(game: GameApi, _cause: DamageCause, attacker: Entity | null): void {
    this.panicTicks = PANIC_TICKS;
    this.loveTicks = 0;
    this.fleeFrom = attacker;
    this.pickFlee(game, attacker);
  }

  /** Choisit un point de fuite : à l'opposé de l'agresseur s'il y en a un, au hasard sinon. */
  private pickFlee(game: GameApi, from: Entity | null): void {
    let a = game.rng() * TAU;
    if (from && !from.dead) {
      const dx = this.x - from.x;
      const dz = this.z - from.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > 1e-4 && dSq < 256) a = Math.atan2(dz, dx) + (game.rng() - 0.5) * 1.2;
    }
    this.fleeX = this.x + Math.cos(a) * 8;
    this.fleeZ = this.z + Math.sin(a) * 8;
    this.fleeTicks = 20 + Math.floor(game.rng() * 20);
  }

  private panic(game: GameApi): void {
    const dx = this.fleeX - this.x;
    const dz = this.fleeZ - this.z;
    if (--this.fleeTicks <= 0 || dx * dx + dz * dz < 1) this.pickFlee(game, this.fleeFrom);
    // vide ou eau devant : n'importe où ailleurs
    if (!this.walkTo(game, this.fleeX, this.fleeZ, 2, true)) this.pickFlee(game, null);
    if (this.panicTicks <= 0) this.fleeFrom = null;
  }

  /** Suit le joueur qui tient sa nourriture. */
  private tempted(game: GameApi): boolean {
    const p = game.player;
    if (!p.alive || p.heldItemId !== this.food) return false;
    const dSq = this.distanceSqTo(p);
    if (dSq > 100) return false;
    this.lookAt(p, 10);
    if (dSq > 6.25) this.pathTo(game, p.x, p.y, p.z, 1.25, true);
    else this.face(p.x, p.z, 0.3);
    return true;
  }

  /** Rejoint un partenaire amoureux de la même espèce ; à son contact, un nouvel animal naît. */
  private seekMate(game: GameApi): boolean {
    let m = this.mate;
    if (m && (!m.alive || m.loveTicks <= 0 || this.distanceSqTo(m) > 100)) m = this.mate = null;
    if (!m && ((this.age + this.id) % 10) === 0) {
      let best = 64;
      for (const e of game.entitiesInBox(this.x - 8, this.y - 3, this.z - 8, this.x + 8, this.y + 3 + this.height, this.z + 8, this)) {
        if (!(e instanceof Animal) || e.mobKind !== this.mobKind || !e.alive || e.loveTicks <= 0) continue;
        const d = this.distanceSqTo(e);
        if (d < best) {
          best = d;
          m = e;
        }
      }
      this.mate = m;
    }
    if (!m) return false;
    this.lookAt(m, 5);
    const dSq = this.distanceSqTo(m);
    if (dSq > 1.2) this.pathTo(game, m.x, m.y, m.z, 1, true);
    // un seul des deux parents fait naître le petit
    if (dSq < 3.2 && this.id < m.id) this.breed(game, m);
    return true;
  }

  private breed(game: GameApi, m: Animal): void {
    this.loveTicks = m.loveTicks = 0;
    this.breedCooldown = m.breedCooldown = BREED_COOLDOWN;
    this.mate = m.mate = null;
    const x = (this.x + m.x) / 2;
    const z = (this.z + m.z) / 2;
    const y = Math.max(this.y, m.y);
    game.particles('heart', x, y + this.height, z, 7, this.width);
    if (countAnimals(game, x, z) >= ANIMAL_CAP) return;
    const child = createMob(this.mobKind, game.rng);
    if (!(child instanceof Animal)) return;
    child.inherit(game, this, m);
    child.setBaby(BABY_GROW_TICKS);
    child.setPosition(x, y, z);
    child.setRotation(game.rng() * TAU);
    game.spawn(child);
    if (game.player.alive) {
      game.player.addXp(randInt(game.rng, 1, 7));
      game.sound('orb', x, y, z, 0.6);
    }
  }

  /** Ce que le nouveau-né hérite de ses parents. */
  protected inherit(_game: GameApi, _a: Animal, _b: Animal): void {}

  /** Clic droit : le joueur nourrit l'animal avec sa nourriture préférée (accélère la croissance d'un petit de 10 %). */
  interact(game: GameApi, player: PlayerLike): boolean {
    if (!this.alive || player.heldItemId !== this.food) return false;
    if (this.baby) {
      player.consumeHeld(1);
      const reduce = Math.max(1, Math.floor(this.growTicks * 0.1));
      this.setBaby(this.growTicks - reduce);
      game.sound('eat', this.x, this.y + this.eyeHeight, this.z, 0.6, 1.3);
      game.particles('bonemeal', this.x, this.y + this.height * 0.5, this.z, 5, this.width * 0.5);
      return true;
    }
    if (this.breedCooldown > 0 || this.loveTicks > 0) return false;
    player.consumeHeld(1);
    this.loveTicks = LOVE_TICKS;
    this.panicTicks = 0;
    game.sound('eat', this.x, this.y + this.eyeHeight, this.z, 0.6);
    game.particles('heart', this.x, this.y + this.height + 0.2, this.z, 5, this.width * 0.6);
    return true;
  }

  protected xpValue(game: GameApi): number {
    return randInt(game.rng, 1, 3);
  }

  save(): EntityData | null {
    if (this.health <= 0 || this.dead) return null;
    const d = this.saveBase('mob');
    d.kind = this.mobKind;
    d.health = this.health;
    d.breed = this.breedCooldown;
    if (this.growTicks > 0) d.grow = this.growTicks;
    this.saveExtra(d);
    return d;
  }

  loadExtra(d: EntityData): void {
    this.breedCooldown = Math.max(0, Math.floor(num(d.breed, 0)));
    const grow = Math.max(0, Math.floor(num(d.grow, 0)));
    if (grow > 0) this.setBaby(grow);
  }
}

export class Pig extends Animal {
  constructor() {
    super('pig', 10, 0.04, I.CARROT);
    this.voice = 'pig';
  }

  protected dropLoot(game: GameApi, burning: boolean): void {
    this.drop(game, burning ? I.COOKED_PORKCHOP : I.RAW_PORKCHOP, randInt(game.rng, 1, 3));
  }
}

export class Cow extends Animal {
  constructor() {
    super('cow', 10, 0.04, I.WHEAT);
    this.voice = 'cow';
  }

  /** Seau vide → seau de lait (adulte uniquement). */
  interact(game: GameApi, player: PlayerLike): boolean {
    if (this.alive && !this.baby && player.heldItemId === I.BUCKET) {
      player.replaceHeld(I.MILK_BUCKET);
      game.sound('bucket_fill', this.x, this.y + this.height * 0.5, this.z, 0.8);
      return true;
    }
    return super.interact(game, player);
  }

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.RAW_BEEF, randInt(game.rng, 1, 3));
    this.drop(game, I.LEATHER, randInt(game.rng, 0, 2));
  }
}

/** Indices de couleur (ordre des laines) des toisons naturelles. */
const WOOL_WHITE = 0;
const WOOL_GRAY = 7;
const WOOL_LIGHT_GRAY = 8;
const WOOL_BROWN = 12;
const WOOL_BLACK = 15;

function randomWool(rng: () => number): number {
  const r = rng();
  if (r < 0.82) return WOOL_WHITE;
  if (r < 0.87) return WOOL_BLACK;
  if (r < 0.92) return WOOL_GRAY;
  if (r < 0.97) return WOOL_LIGHT_GRAY;
  return WOOL_BROWN;
}

export class Sheep extends Animal {
  /** Indice de couleur de la toison (0 = blanc … 15 = noir, ordre des blocs de laine). */
  wool = WOOL_WHITE;
  private grazeTicks = 0;

  constructor(rng: () => number = Math.random) {
    super('sheep', 8, 0.04, I.WHEAT);
    this.voice = 'sheep';
    this.setWool(randomWool(rng));
  }

  setWool(index: number): void {
    this.wool = index >= 0 && index < 16 ? Math.floor(index) : WOOL_WHITE;
    this.woolColor = this.wool === WOOL_WHITE ? 0xffffff : COLOR_HEX[this.wool];
  }

  /** Broute de temps en temps à l'arrêt : l'herbe devient terre et la laine repousse. */
  protected special(game: GameApi): boolean {
    if (this.grazeTicks > 0) {
      this.grazeTicks--;
      this.headDown = this.grazeTicks > 4;
      if (this.grazeTicks === 4) this.eatGrass(game);
      return true;
    }
    if (this.resting && this.onGround && game.rng() < (this.sheared ? 1 / 250 : 1 / 1000) && this.grassBelow(game.world) !== 0) {
      this.grazeTicks = 40;
      return true;
    }
    return false;
  }

  /** 1 : herbe haute aux pieds ; 2 : bloc d'herbe sous les pieds ; 0 : rien à brouter. */
  private grassBelow(w: World): number {
    const x = Math.floor(this.x);
    const y = Math.floor(this.y + 0.01);
    const z = Math.floor(this.z);
    if (w.getBlock(x, y, z) === B.TALL_GRASS) return 1;
    if (w.getBlock(x, y - 1, z) === B.GRASS) return 2;
    return 0;
  }

  private eatGrass(game: GameApi): void {
    const w = game.world;
    const x = Math.floor(this.x);
    const y = Math.floor(this.y + 0.01);
    const z = Math.floor(this.z);
    const what = this.grassBelow(w);
    if (what === 0) return;
    if (what === 1) {
      game.blockParticles(x + 0.5, y + 0.3, z + 0.5, B.TALL_GRASS, w.getMeta(x, y, z), 8);
      w.setBlock(x, y, z, B.AIR, 0);
    } else {
      game.blockParticles(x + 0.5, y, z + 0.5, B.GRASS, 0, 8);
      w.setBlock(x, y - 1, z, B.DIRT, 0);
    }
    game.blockSound('break', B.GRASS, x + 0.5, y, z + 0.5);
    this.sheared = false;
  }

  protected onHurt(game: GameApi, cause: DamageCause, attacker: Entity | null): void {
    this.grazeTicks = 0;
    this.headDown = false;
    super.onHurt(game, cause, attacker);
  }

  /** Cisailles : 1 à 3 laines de sa couleur (adulte uniquement). */
  interact(game: GameApi, player: PlayerLike): boolean {
    if (this.alive && !this.baby && player.heldItemId === I.SHEARS) {
      if (this.sheared) return false;
      this.sheared = true;
      const n = randInt(game.rng, 1, 3);
      for (let i = 0; i < n; i++) game.dropItem(this.x, this.y + this.height * 0.8, this.z, B.WOOL_WHITE + this.wool, 1);
      game.sound('shear', this.x, this.y + this.height * 0.5, this.z);
      player.damageHeld(game, 1);
      return true;
    }
    return super.interact(game, player);
  }

  protected inherit(game: GameApi, a: Animal, b: Animal): void {
    const p = game.rng() < 0.5 ? a : b;
    if (p instanceof Sheep) this.setWool(p.wool);
  }

  protected dropLoot(game: GameApi): void {
    if (!this.sheared) this.drop(game, B.WOOL_WHITE + this.wool, 1);
    this.drop(game, I.RAW_MUTTON, randInt(game.rng, 1, 2));
  }

  protected saveExtra(d: EntityData): void {
    d.wool = this.wool;
    d.sheared = this.sheared;
  }

  loadExtra(d: EntityData): void {
    super.loadExtra(d);
    this.setWool(num(d.wool, WOOL_WHITE));
    this.sheared = d.sheared === true;
  }
}

export class Chicken extends Animal {
  /** Ticks avant le prochain œuf (5 à 10 minutes). */
  eggTimer: number;

  constructor(rng: () => number = Math.random) {
    super('chicken', 4, 0.04, I.WHEAT_SEEDS);
    this.voice = 'chicken';
    this.eggTimer = 6000 + Math.floor(rng() * 6000);
  }

  protected behave(game: GameApi): void {
    // chute lente, en battant des ailes
    if (!this.onGround && this.vy < 0) this.vy *= 0.6;
    if (!this.baby && --this.eggTimer <= 0) {
      this.eggTimer = 6000 + Math.floor(game.rng() * 6000);
      game.dropItem(this.x, this.y + 0.2, this.z, I.EGG, 1);
      game.sound('egg', this.x, this.y, this.z, 1, 0.9 + game.rng() * 0.2);
    }
    super.behave(game);
  }

  /** Pas de dégâts de chute. */
  protected land(): void {}

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.RAW_CHICKEN, 1);
    this.drop(game, I.FEATHER, randInt(game.rng, 0, 2));
  }

  protected saveExtra(d: EntityData): void {
    d.egg = this.eggTimer;
  }

  loadExtra(d: EntityData): void {
    super.loadExtra(d);
    this.eggTimer = Math.max(1, Math.floor(num(d.egg, this.eggTimer)));
  }
}

// =============================================================================================
// Monstres
// =============================================================================================

export abstract class Monster extends Mob {
  /** Cible poursuivie (le joueur, ou une créature qui l'a blessé). */
  target: Living | null = null;
  /** Ligne de vue sur la cible, rafraîchie tous les 5 ticks. */
  protected seesTarget = false;
  protected attackCooldown = 0;
  /** Ticks écoulés sans avoir vu le joueur. */
  protected unseenTicks = 0;
  /** Prend feu au soleil (morts-vivants). */
  protected burnsInSun = false;

  protected behave(game: GameApi): void {
    if (game.difficulty <= 0) {
      this.dead = true;
      return;
    }
    if (this.checkDespawn(game)) return;
    if (this.attackCooldown > 0) this.attackCooldown--;
    this.updateTarget(game);
    if (this.burnsInSun) this.sunburn(game);
    const t = this.target;
    if (t) {
      this.lookAt(t);
      this.fight(game, t);
    } else {
      this.idle(game);
    }
  }

  /** Comportement face à la cible. */
  protected abstract fight(game: GameApi, t: Living): void;

  /** Comportement sans cible. */
  protected idle(game: GameApi): void {
    this.wander(game);
  }

  /** Veut-elle s'en prendre au joueur qu'elle aperçoit ? */
  protected aggressive(_game: GameApi): boolean {
    return true;
  }

  /** Disparition loin du joueur : toujours au-delà de 96 blocs, au hasard au-delà de 32 après 30 s sans le voir. */
  private checkDespawn(game: GameApi): boolean {
    const dSq = this.distanceSqTo(game.player);
    this.unseenTicks++;
    if (dSq > 96 * 96 || (dSq > 32 * 32 && this.unseenTicks > 600 && game.rng() < 1 / 800)) {
      this.dead = true;
      return true;
    }
    return false;
  }

  private updateTarget(game: GameApi): void {
    const p = game.player;
    let t = this.target;
    if (t) {
      const lost = t === p ? !p.targetable : !t.alive;
      if (lost || this.distanceSqTo(t) > LOSE_RANGE * LOSE_RANGE) {
        this.dropTarget();
        t = null;
      }
    }
    const phase = (this.age + this.id) % 10;
    if (t) {
      if (phase % 5 === 0) this.seesTarget = this.canSee(game.world, t);
      if (this.seesTarget && t === p) this.unseenTicks = 0;
    } else if (phase === 0 && p.targetable && this.distanceSqTo(p) <= FOLLOW_RANGE * FOLLOW_RANGE && this.aggressive(game) && this.canSee(game.world, p)) {
      this.setTarget(p);
      this.unseenTicks = 0;
    }
  }

  protected setTarget(t: Living): void {
    this.target = t;
    this.seesTarget = true;
  }

  protected dropTarget(): void {
    this.target = null;
    this.seesTarget = false;
    this.clearPath();
  }

  /** Riposte : celui qui la blesse devient sa cible. */
  protected onHurt(game: GameApi, _cause: DamageCause, attacker: Entity | null): void {
    if (!attacker || attacker === this || !(attacker instanceof Living)) return;
    if (attacker === game.player) {
      this.unseenTicks = 0;
      if (!game.player.targetable) return;
    }
    this.setTarget(attacker);
  }

  private sunburn(game: GameApi): void {
    if ((this.age + this.id) % 10 !== 0 || this.inWater || !isDay(game)) return;
    const w = game.world;
    if (w.raining || game.rng() >= 0.5) return;
    if (w.canSeeSky(Math.floor(this.x), Math.floor(this.y + this.height), Math.floor(this.z))) {
      this.fireTicks = Math.max(this.fireTicks, 160);
    }
  }

  /** Frappe la cible si elle est à portée (distance horizontale entre centres) et que le coup est prêt. */
  protected melee(game: GameApi, t: Living, reach: number, damage: number): boolean {
    if (this.attackCooldown > 0) return false;
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    if (dx * dx + dz * dz > reach * reach) return false;
    if (t.y > this.y + this.height + 0.3 || t.y + t.height < this.y - 0.3) return false;
    this.attackCooldown = 20;
    this.swingArm();
    t.hurt(game, damage, 'attack', this);
    return true;
  }

  /** Avance vers la cible, sans la bousculer une fois au contact. */
  protected chase(game: GameApi, t: Living, factor = 1): void {
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const contact = (this.width + t.width) / 2 + 0.1;
    if (dx * dx + dz * dz > contact * contact) this.pathTo(game, t.x, t.y, t.z, factor, false);
    else this.face(t.x, t.z);
  }

  protected xpValue(): number {
    return 5;
  }

  save(): EntityData | null {
    if (this.health <= 0 || this.dead) return null;
    const d = this.saveBase('mob');
    d.kind = this.mobKind;
    d.health = this.health;
    this.saveExtra(d);
    return d;
  }
}

export class Zombie extends Monster {
  constructor() {
    super('zombie', 20, 0.053);
    this.voice = 'zombie';
    this.burnsInSun = true;
  }

  protected fight(game: GameApi, t: Living): void {
    this.chase(game, t);
    // 2 / 3 / 4 dégâts en facile / normal / difficile
    this.melee(game, t, (this.width + t.width) / 2 + 0.6, 1 + clamp(Math.floor(game.difficulty), 1, 3));
  }

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.ROTTEN_FLESH, randInt(game.rng, 0, 2));
  }
}

export class Skeleton extends Monster {
  private shootTimer = 30;
  private strafeDir = 1;
  private strafeTicks = 0;

  constructor() {
    super('skeleton', 20, 0.058);
    this.voice = 'skeleton';
    this.burnsInSun = true;
    this.itemId = I.BOW;
    this.itemCount = 1;
  }

  protected fight(game: GameApi, t: Living): void {
    const w = game.world;
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);

    if (!this.seesTarget || d > 12) {
      // trop loin ou cible masquée : se rapprocher
      this.chase(game, t);
    } else {
      this.face(t.x, t.z);
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      if (d < 7) {
        // trop près : reculer, sauf vers un vide
        if (!this.hazard(w, s, c, true)) this.moveForward = -0.7;
      }
      // pas de côté, pour être plus dur à viser
      if (--this.strafeTicks <= 0 || this.collidedH) {
        this.strafeTicks = 30 + Math.floor(game.rng() * 40);
        this.strafeDir = game.rng() < 0.5 ? 1 : -1;
      }
      if (this.hazard(w, c * this.strafeDir, -s * this.strafeDir, true)) this.strafeDir = -this.strafeDir;
      else this.moveStrafe = this.strafeDir * 0.5;
    }

    if (this.seesTarget && d <= 15) {
      if (--this.shootTimer <= 0) {
        this.shootTimer = 30 + Math.floor(game.rng() * 31);
        this.shoot(game, t);
      }
    } else if (this.shootTimer < 20) {
      this.shootTimer = 20;
    }
  }

  /** Tire une flèche vers le buste de la cible, en compensant la chute de la flèche. */
  private shoot(game: GameApi, t: Living): void {
    const ox = this.x;
    const oy = this.y + this.eyeHeight - 0.1;
    const oz = this.z;
    const dx = t.x - ox;
    const dz = t.z - oz;
    const h = t.y + t.height * 0.45 - oy;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-3) return;
    // angle de tir tendu d'un projectile de vitesse s soumis à la gravité g
    const s2 = ARROW_SPEED * ARROW_SPEED;
    const g = ARROW_GRAVITY;
    const disc = s2 * s2 - g * (g * d * d + 2 * h * s2);
    const tan = disc >= 0 ? (s2 - Math.sqrt(disc)) / (g * d) : 1;
    const a = new Arrow();
    a.owner = this;
    a.shoot(ox, oy, oz, dx, tan * d, dz, ARROW_SPEED, Math.max(2, 14 - game.difficulty * 4), game.rng);
    game.spawn(a);
    game.sound('bow', ox, oy, oz, 1, 0.9 + game.rng() * 0.3);
    this.swingArm();
  }

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.BONE, randInt(game.rng, 0, 2));
    this.drop(game, I.ARROW, randInt(game.rng, 0, 2));
  }
}

export class Creeper extends Monster {
  /** Avancement de la mèche, 0..30. `fuse` (vue) en est la fraction 0..1. */
  fuseTicks = 0;
  private igniting = false;

  constructor() {
    super('creeper', 20, 0.058);
  }

  protected fight(game: GameApi, t: Living): void {
    const dSq = this.distanceSqTo(t);
    if (this.igniting) {
      // la mèche s'éteint si la cible s'éloigne à plus de 7 blocs ou sort de vue
      if (dSq > 49 || !this.seesTarget) this.igniting = false;
    } else if (dSq < 9 && this.seesTarget) {
      this.igniting = true;
      if (this.fuseTicks === 0) game.sound('fuse', this.x, this.y + this.height * 0.5, this.z, 1, 0.5);
    }

    if (this.igniting) {
      this.face(t.x, t.z);
      if (++this.fuseTicks >= FUSE_TICKS) {
        this.fuse = 1;
        this.dead = true;
        game.explode(this.x, this.y + this.height * 0.5, this.z, 3, false, this);
        return;
      }
    } else {
      if (this.fuseTicks > 0) this.fuseTicks--;
      this.chase(game, t);
    }
    this.fuse = this.fuseTicks / FUSE_TICKS;
  }

  protected idle(game: GameApi): void {
    this.igniting = false;
    if (this.fuseTicks > 0) this.fuseTicks--;
    this.fuse = this.fuseTicks / FUSE_TICKS;
    this.wander(game);
  }

  protected hurtSound(): SfxName | null {
    return 'creeper_hurt';
  }

  protected deathSound(): SfxName | null {
    return 'creeper_hurt';
  }

  protected dropLoot(game: GameApi): void {
    this.drop(game, I.GUNPOWDER, randInt(game.rng, 0, 2));
  }
}

export class Spider extends Monster {
  /** Attaquée : hostile même en plein jour, jusqu'à ce qu'elle perde sa cible. */
  private angry = false;

  constructor() {
    super('spider', 16, 0.07);
    this.voice = 'spider';
    this.climbs = true;
  }

  protected behave(game: GameApi): void {
    super.behave(game);
    // grimpe aux murs contre lesquels elle bute (même mécanique qu'une échelle : vy = 0.2)
    if (this.collidedH && this.moveForward !== 0) this.onLadder = true;
  }

  /** Lumière effective à hauteur du corps. */
  private lightHere(w: World): number {
    return w.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
  }

  /** Hostile la nuit ou dans le noir ; paisible à la lumière du jour tant qu'on ne l'attaque pas. */
  protected aggressive(game: GameApi): boolean {
    return this.angry || !isDay(game) || this.lightHere(game.world) < 10;
  }

  protected onHurt(game: GameApi, cause: DamageCause, attacker: Entity | null): void {
    super.onHurt(game, cause, attacker);
    if (this.target) this.angry = true;
  }

  protected dropTarget(): void {
    super.dropTarget();
    this.angry = false;
  }

  protected fight(game: GameApi, t: Living): void {
    // en pleine lumière, elle se désintéresse peu à peu d'une cible qui ne l'a pas attaquée
    if (!this.angry && game.rng() < 0.01 && isDay(game) && this.lightHere(game.world) >= 10) {
      this.dropTarget();
      return;
    }
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    this.chase(game, t);
    // bond sur la cible
    if (this.onGround && d > 2 && d < 5 && game.rng() < 0.1) {
      this.vx = (dx / d) * 0.4 + this.vx * 0.2;
      this.vz = (dz / d) * 0.4 + this.vz * 0.2;
      this.vy = 0.4;
      this.onGround = false;
    }
    // 2 / 2 / 3 dégâts en facile / normal / difficile
    this.melee(game, t, (this.width + t.width) / 2 + 0.5, game.difficulty >= 3 ? 3 : 2);
  }

  protected dropLoot(game: GameApi, _burning: boolean, byPlayer: boolean): void {
    this.drop(game, I.STRING, randInt(game.rng, 0, 2));
    if (byPlayer && game.rng() < 1 / 3) this.drop(game, I.SPIDER_EYE, 1);
  }
}

// =============================================================================================
// Fabrique, chargement, œuf
// =============================================================================================

/**
 * Crée une créature du type donné (à placer avec setPosition puis à passer à game.spawn).
 * `rng` tire ce qui varie à la naissance (couleur de la laine, minuterie de ponte). Null pour 'player'.
 */
export function createMob(kind: MobKind, rng: () => number = Math.random): Mob | null {
  switch (kind) {
    case 'pig':
      return new Pig();
    case 'cow':
      return new Cow();
    case 'sheep':
      return new Sheep(rng);
    case 'chicken':
      return new Chicken(rng);
    case 'zombie':
      return new Zombie();
    case 'skeleton':
      return new Skeleton();
    case 'creeper':
      return new Creeper();
    case 'spider':
      return new Spider();
    default:
      return null;
  }
}

/** Recrée une créature depuis sa sauvegarde (`type === 'mob'`, `kind` = espèce). Null si la donnée est invalide. */
export function loadMob(d: EntityData): Mob | null {
  if (!d || d.type !== 'mob' || typeof d.kind !== 'string') return null;
  const kind = d.kind as MobKind;
  if (!PASSIVE_KINDS.includes(kind) && !HOSTILE_KINDS.includes(kind)) return null;
  const m = createMob(kind);
  if (!m) return null;
  m.loadBase(d);
  m.health = clamp(num(d.health, m.maxHealth), 1, m.maxHealth);
  m.loadExtra(d);
  return m;
}

/**
 * Œuf brisé en (x, y, z) : une fois sur huit, un poussin en sort (une fois sur 32 parmi celles-là : 4 poussins).
 * À brancher par le jeu : `Thrown.onEggBreak = hatchEgg`.
 */
export function hatchEgg(game: GameApi, x: number, y: number, z: number): void {
  if (game.rng() >= 0.125) return;
  const count = game.rng() < 1 / 32 ? 4 : 1;
  for (let i = 0; i < count; i++) {
    if (countAnimals(game, x, z) >= ANIMAL_CAP) return;
    const c = new Chicken(game.rng);
    c.setBaby(BABY_GROW_TICKS);
    const hw = c.width / 2;
    // l'impact est souvent au ras d'un bloc : chercher la place libre la plus proche au-dessus
    const tries = [y, Math.floor(y) + 1, Math.floor(y) + 2];
    for (const ty of tries) {
      if (!isBoxFree(game.world, x - hw, ty, z - hw, x + hw, ty + c.height, z + hw)) continue;
      c.setPosition(x, ty, z);
      c.setRotation(game.rng() * TAU);
      game.spawn(c);
      break;
    }
  }
}
