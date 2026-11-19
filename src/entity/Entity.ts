/**
 * Base des entités (objets au sol, projectiles, créatures, joueur) et contrat avec le jeu.
 * Une entité est un corps physique (Body) qui expose aussi sa vue pour le rendu (EntityView).
 * Toute la logique tourne à 20 ticks par seconde ; le rendu interpole entre deux ticks.
 */
import type { SfxName } from '../audio/Sfx';
import type { ParticleKind } from '../render/Particles';
import type { Dimension, GameMode } from '../world/Constants';
import { B } from '../world/Ids';
import type { ItemStack } from '../world/ItemStack';
import type { World } from '../world/World';
import type { EntityKind, EntityView } from './EntityView';
import type { MobKind } from './MobModels';
import { Body, JUMP_VELOCITY, fluidPush, pointInFluid, travel, updateMedium } from './Physics';

export type DamageCause =
  | 'fall'
  | 'drown'
  | 'fire'
  | 'lava'
  | 'starve'
  | 'void'
  | 'cactus'
  | 'suffocate'
  | 'explosion'
  | 'attack'
  | 'arrow'
  | 'wither'
  | 'magic'
  | 'generic';

export type EffectType =
  | 'speed'
  | 'slow'
  | 'strength'
  | 'regeneration'
  | 'fire_resistance'
  | 'night_vision'
  | 'poison'
  | 'weakness'
  | 'wither';

export interface ActiveEffect {
  level: number;
  ticks: number;
}

export const EFFECT_TYPES: readonly EffectType[] = [
  'speed', 'slow', 'strength', 'regeneration', 'fire_resistance', 'night_vision', 'poison', 'weakness', 'wither',
];

/** Donnée sérialisable d'une entité (JSON pur). `type` désigne la classe à recréer. */
export interface EntityData {
  type: string;
  x: number;
  y: number;
  z: number;
  [key: string]: unknown;
}

/** Ce que les entités peuvent demander au jeu. Implémenté par Game. */
export interface GameApi {
  readonly world: World;
  readonly player: PlayerLike;
  /** Toutes les entités vivantes du monde (joueur compris). Ne pas modifier : passer par spawn() et `dead`. */
  readonly entities: readonly Entity[];
  /** Aléa de gameplay (0..1). */
  readonly rng: () => number;
  /** Heure du jour 0..23999 (0 = lever du soleil, 6000 = midi, 12000 = coucher, 18000 = minuit). */
  readonly dayTime: number;
  /** 0 paisible (aucun monstre), 1 facile, 2 normal, 3 difficile. */
  readonly difficulty: number;
  /** Dimension courante ('overworld', 'nether' ou 'end'). */
  readonly dimension?: Dimension;

  /** Ajoute une entité au monde (effective à la fin du tick courant). */
  spawn(e: Entity): void;
  /** Son positionné : atténué selon la distance au joueur. */
  sound(name: SfxName, x: number, y: number, z: number, volume?: number, pitch?: number): void;
  /** Son d'un bloc (matière déduite de son identifiant). */
  blockSound(kind: 'break' | 'place' | 'hit' | 'step', blockId: number, x: number, y: number, z: number): void;
  particles(kind: ParticleKind, x: number, y: number, z: number, count?: number, spread?: number, vx?: number, vy?: number, vz?: number): void;
  /** Éclats du bloc donné (casse, atterrissage). */
  blockParticles(x: number, y: number, z: number, blockId: number, meta: number, count?: number): void;
  /** Éclats de l'objet donné (nourriture mangée, outil cassé, œuf). */
  itemParticles(x: number, y: number, z: number, itemId: number, count?: number): void;
  /** Lâche un objet au sol avec une petite impulsion aléatoire. Retourne l'entité créée. */
  dropItem(x: number, y: number, z: number, id: number, count: number, damage?: number): Entity;
  /** Lâche une pile complète au sol (clone avec enchantements et variante de potion). Retourne l'entité créée. */
  dropStack?(x: number, y: number, z: number, stack: ItemStack): Entity;
  /** La colonne (x, z) est-elle dans un lieu généré de ce type (« fortress »…) ? Absent hors du jeu complet. */
  inStructure?(kind: string, x: number, z: number): boolean;
  /** Ouvre l'écran d'échange d'un villageois (absent hors du jeu complet). */
  openTrade?(villager: Entity): void;
  /** Ouvre la saisie du nom d'une créature (étiquette) ; absent hors du jeu complet. */
  openNameTag?(mob: Entity): void;
  /** Explosion : détruit des blocs (sauf si griefing vaut false), blesse et repousse les entités. */
  explode(x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null, griefing?: boolean): void;
  /** Entités dont la boîte coupe la boîte donnée. */
  entitiesInBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, except?: Entity | null): Entity[];
  /** Message dans le journal du joueur. */
  message(text: string): void;
}

let nextEntityId = 1;

export abstract class Entity extends Body implements EntityView {
  readonly id = nextEntityId++;
  abstract readonly kind: EntityKind;
  mobKind: MobKind = 'pig';

  pYaw = 0;
  yaw = 0;
  pHeadYaw = 0;
  headYaw = 0;
  pHeadPitch = 0;
  headPitch = 0;
  pLimbSwing = 0;
  limbSwing = 0;
  pLimbAmount = 0;
  limbAmount = 0;
  hurtTime = 0;
  deathTime = 0;
  age = 0;
  swing = 0;
  skyLight = 15;
  blockLight = 0;
  itemId = 0;
  itemCount = 0;
  offhandId = 0;
  blockId = 0;
  blockMeta = 0;
  fuse = 0;
  woolColor = 0xffffff;
  sheared = false;
  tamed = false;
  angry = false;
  sitting = false;
  collarColor = 0xd8342a;
  variant = 0;
  baby = false;
  mobScale = 1;
  sneaking = false;
  hidden = false;
  /** Nom donné par une étiquette (vide = aucun) : affiché au-dessus de la créature. */
  customName = '';
  /** Tenue en laisse : la corde va jusqu'au point (leashX, leashY, leashZ). */
  leashed = false;
  pLeashX = 0;
  pLeashY = 0;
  pLeashZ = 0;
  leashX = 0;
  leashY = 0;
  leashZ = 0;
  /** Assis sur une monture (joueur à cheval). */
  riding = false;
  /** Cheval sellé. */
  saddled = false;

  /** À retirer du monde à la fin du tick. */
  dead = false;
  /** Ticks de feu restants (0 = ne brûle pas). */
  fireTicks = 0;

  /** Un tick de logique (20 par seconde). Doit commencer par beginTick(). */
  abstract tick(game: GameApi): void;

  /** Mémorise l'état précédent pour l'interpolation du rendu et vieillit l'entité. */
  protected beginTick(): void {
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.pYaw = this.yaw;
    this.pHeadYaw = this.headYaw;
    this.pHeadPitch = this.headPitch;
    this.pLimbSwing = this.limbSwing;
    this.pLimbAmount = this.limbAmount;
    this.age++;
  }

  /** Place l'entité (sans interpolation depuis l'ancienne position). */
  teleport(x: number, y: number, z: number): void {
    this.setPosition(x, y, z);
    this.vx = this.vy = this.vz = 0;
    this.fallDistance = 0;
  }

  /** Fixe l'orientation sans interpolation. */
  setRotation(yaw: number, pitch = 0): void {
    this.yaw = this.pYaw = this.headYaw = this.pHeadYaw = yaw;
    this.headPitch = this.pHeadPitch = pitch;
  }

  /** Relève la lumière au centre de l'entité (pour le rendu). */
  updateLight(w: World): void {
    const raw = w.getRawLight(Math.floor(this.x), Math.floor(this.y + this.height * 0.5), Math.floor(this.z));
    this.skyLight = raw >> 4;
    this.blockLight = raw & 15;
  }

  /** Inflige des dégâts (en demi-cœurs). Retourne true si le coup a porté. */
  hurt(_game: GameApi, _amount: number, _cause: DamageCause, _attacker: Entity | null = null): boolean {
    return false;
  }

  /** Clic droit du joueur sur l'entité. Retourne true si l'interaction a eu lieu. */
  /**
   * L'entité porte un état que le joueur a créé (villageois avec qui il a commercé) : son chunk
   * doit être sauvegardé même si aucun bloc n'y a changé, sinon elle serait régénérée à neuf.
   */
  get persistent(): boolean {
    return false;
  }

  /**
   * L'entité vit hors des chunks (dragon de l'Ender) : elle n'est ni abandonnée quand elle sort
   * du monde chargé, ni sauvegardée ou retirée avec un chunk. Le jeu la gère lui-même.
   */
  get roaming(): boolean {
    return false;
  }

  interact(_game: GameApi, _player: PlayerLike): boolean {
    return false;
  }

  /** Les autres entités et le rayon de visée du joueur peuvent-ils la toucher ? */
  get pickable(): boolean {
    return false;
  }

  /** Boîte de visée personnalisée [x0, y0, z0, x1, y1, z1] (tableaux, cadres) ; false = boîte symétrique. */
  pickBounds(_out: number[]): boolean {
    return false;
  }

  distanceSqTo(e: Body): number {
    const dx = e.x - this.x;
    const dy = e.y - this.y;
    const dz = e.z - this.z;
    return dx * dx + dy * dy + dz * dz;
  }

  distanceSq(x: number, y: number, z: number): number {
    const dx = x - this.x;
    const dy = y - this.y;
    const dz = z - this.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** La boîte de l'entité coupe-t-elle la boîte donnée ? */
  intersects(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const hw = this.width / 2;
    return this.x + hw > x0 && this.x - hw < x1 && this.y + this.height > y0 && this.y < y1 && this.z + hw > z0 && this.z - hw < z1;
  }

  /** L'entité touche-t-elle un bloc du type donné ? */
  touchesBlock(w: World, id: number): boolean {
    const hw = this.width / 2;
    const x0 = Math.floor(this.x - hw + 0.001);
    const x1 = Math.floor(this.x + hw - 0.001);
    const y0 = Math.floor(this.y + 0.001);
    const y1 = Math.floor(this.y + this.height - 0.001);
    const z0 = Math.floor(this.z - hw + 0.001);
    const z1 = Math.floor(this.z + hw - 0.001);
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (w.getBlock(x, y, z) === id) return true;
        }
      }
    }
    return false;
  }

  /** Données à sauvegarder avec le chunk ; null = entité non sauvegardée. */
  save(): EntityData | null {
    return null;
  }

  /** Champs communs d'une sauvegarde. */
  protected saveBase(type: string): EntityData {
    return {
      type,
      x: round3(this.x),
      y: round3(this.y),
      z: round3(this.z),
      vx: round3(this.vx),
      vy: round3(this.vy),
      vz: round3(this.vz),
      yaw: round3(this.yaw),
      age: this.age,
      fire: this.fireTicks,
    };
  }

  /** Restaure les champs communs depuis une sauvegarde. */
  loadBase(d: EntityData): void {
    this.setPosition(num(d.x, 0), num(d.y, 64), num(d.z, 0));
    this.vx = num(d.vx, 0);
    this.vy = num(d.vy, 0);
    this.vz = num(d.vz, 0);
    this.setRotation(num(d.yaw, 0));
    this.age = num(d.age, 0);
    this.fireTicks = num(d.fire, 0);
  }
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Lecture tolérante d'un nombre dans une sauvegarde. */
export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Être vivant : points de vie, dégâts d'environnement (chute, noyade, feu, lave, cactus, étouffement),
 * déplacement commandé (moveStrafe / moveForward / jumping), animation de marche.
 */
export abstract class Living extends Entity {
  health = 20;
  maxHealth = 20;
  /** Ticks d'invulnérabilité restants après un coup. */
  invulnerable = 0;
  /** Réserve d'air en ticks (300 = pleine). */
  air = 300;

  /** Commandes de déplacement pour le tick : -1..1 (strafe > 0 = droite, forward > 0 = avant) et saut. */
  moveStrafe = 0;
  moveForward = 0;
  jumping = false;
  /** Vitesse de marche (blocs par tick à pleine commande) : 0.1 pour le joueur. */
  speed = 0.1;
  /** Accélération en l'air. */
  airAccel = 0.02;
  /** Véhicule ou monture actuelle. */
  vehicle: Entity | null = null;
  /** Vol libre sans gravité (joueur créatif). */
  flying = false;
  eyeHeight = 1.62;
  /** Ne se noie pas. */
  waterBreathing = false;
  /** Insensible au feu et à la lave. */
  fireImmune = false;

  /** Effets actifs (type → { niveau, durée restante en ticks }). */
  readonly effects = new Map<EffectType, ActiveEffect>();

  private getEffectTicks(type: EffectType): number {
    return this.effects.get(type)?.ticks ?? 0;
  }

  private setEffectTicks(type: EffectType, ticks: number): void {
    const t = Math.max(0, Math.floor(ticks));
    if (t <= 0) {
      this.effects.delete(type);
      return;
    }
    const cur = this.effects.get(type);
    this.effects.set(type, { level: cur ? cur.level : 1, ticks: t });
  }

  get witherTicks(): number {
    return this.getEffectTicks('wither');
  }
  set witherTicks(v: number) {
    this.setEffectTicks('wither', v);
  }
  get poisonTicks(): number {
    return this.getEffectTicks('poison');
  }
  set poisonTicks(v: number) {
    this.setEffectTicks('poison', v);
  }
  get slowTicks(): number {
    return this.getEffectTicks('slow');
  }
  set slowTicks(v: number) {
    this.setEffectTicks('slow', v);
  }
  get weakTicks(): number {
    return this.getEffectTicks('weakness');
  }
  set weakTicks(v: number) {
    this.setEffectTicks('weakness', v);
  }

  addEffect(type: EffectType, ticks: number, level = 1): void {
    const t = Math.max(0, Math.floor(ticks));
    const lvl = Math.max(1, Math.floor(level));
    if (t <= 0) return;
    const cur = this.effects.get(type);
    if (!cur || lvl > cur.level || (lvl === cur.level && t > cur.ticks)) {
      this.effects.set(type, { level: lvl, ticks: t });
    }
  }

  removeEffect(type: EffectType): void {
    this.effects.delete(type);
  }

  hasEffect(type: EffectType): boolean {
    const e = this.effects.get(type);
    return !!e && e.ticks > 0;
  }

  effectLevel(type: EffectType): number {
    return this.effects.get(type)?.level ?? 0;
  }

  effectTicks(type: EffectType): number {
    return this.getEffectTicks(type);
  }

  /** Dernier agresseur et âge (en ticks) du dernier coup reçu de lui. */
  attacker: Entity | null = null;
  attackerAge = 0;

  private jumpDelay = 0;
  private swingTicks = -1;

  get alive(): boolean {
    return this.health > 0 && !this.dead;
  }

  get pickable(): boolean {
    return this.alive;
  }

  tick(game: GameApi): void {
    this.beginTick();
    if (this.health <= 0) {
      this.deathTick(game);
      return;
    }
    this.environmentTick(game);
    if (this.health <= 0) return;
    this.think(game);
    this.moveTick(game);
    this.updateLight(game.world);
  }

  /** Décide des commandes du tick (IA d'une créature, entrées du joueur). */
  protected abstract think(game: GameApi): void;

  /** Lance l'animation du bras. */
  swingArm(): void {
    this.swingTicks = 0;
    this.swing = 0.01;
  }

  // ------------------------------------------------------------------ environnement

  protected environmentTick(game: GameApi): void {
    const w = game.world;
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.attacker && ++this.attackerAge > 200) this.attacker = null;
    for (const [type, fx] of this.effects) {
      fx.ticks--;
      if (type === 'wither') {
        if (fx.ticks % 40 === 0) this.hurt(game, 1, 'wither', null);
        if (this.health <= 0) return;
      } else if (type === 'poison') {
        const interval = fx.level >= 2 ? 12 : 25;
        if (fx.ticks % interval === 0 && this.health > 1) this.hurt(game, 1, 'magic', null);
      } else if (type === 'regeneration') {
        const interval = fx.level >= 2 ? 25 : 50;
        if (fx.ticks % interval === 0 && this.health > 0 && this.health < this.maxHealth) this.heal(1);
      } else if (type === 'fire_resistance') {
        this.fireTicks = 0;
      }
      if (fx.ticks <= 0) this.effects.delete(type);
    }
    if (this.swingTicks >= 0) {
      this.swingTicks++;
      if (this.swingTicks >= 6) {
        this.swingTicks = -1;
        this.swing = 0;
      } else {
        this.swing = this.swingTicks / 6;
      }
    }

    const wasInWater = this.inWater;
    updateMedium(w, this);
    if (this.inWater) {
      if (!wasInWater && this.age > 1) {
        const speed = Math.sqrt(this.vx * this.vx * 0.2 + this.vy * this.vy + this.vz * this.vz * 0.2);
        if (speed > 0.08) {
          game.sound('splash', this.x, this.y, this.z, Math.min(1, speed * 2));
          game.particles('splash', this.x, Math.floor(this.y) + 1, this.z, 12, this.width * 0.6);
        }
      }
      fluidPush(w, this, B.WATER, 0.014);
      if (this.fireTicks > 0) {
        this.fireTicks = 0;
        game.sound('fizz', this.x, this.y, this.z, 0.6);
      }
      this.fallDistance = 0;
    }

    // respiration
    const eyeY = this.y + this.eyeHeight;
    if (!this.waterBreathing && pointInFluid(w, B.WATER, this.x, eyeY, this.z)) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        game.particles('bubble', this.x, eyeY, this.z, 8, 0.3);
        this.hurt(game, 2, 'drown');
      }
    } else {
      this.air = 300;
    }

    // étouffement dans un bloc plein
    if (!this.noClip && w.isOpaque(Math.floor(this.x), Math.floor(eyeY), Math.floor(this.z))) {
      this.hurt(game, 1, 'suffocate');
    }

    // lave, feu
    if (this.inLava) {
      if (!this.fireImmune) {
        this.hurt(game, 4, 'lava');
        this.fireTicks = Math.max(this.fireTicks, 300);
      }
      this.fallDistance *= 0.5;
    } else if (this.touchesBlock(w, B.FIRE)) {
      if (!this.fireImmune) {
        this.hurt(game, 1, 'fire');
        this.fireTicks = Math.max(this.fireTicks, 160);
      }
    }
    if (this.fireTicks > 0) {
      const cx = Math.floor(this.x);
      const cy = Math.floor(this.y);
      const cz = Math.floor(this.z);
      if (w.getBlock(cx, cy, cz) === B.CAULDRON) {
        const cm = w.getMeta(cx, cy, cz) & 3;
        if (cm > 0) {
          this.fireTicks = 0;
          w.setMeta(cx, cy, cz, cm - 1);
          game.sound('fizz', this.x, this.y, this.z, 0.7);
        }
      }
    }
    if (this.fireTicks > 0) {
      if (this.fireImmune || (w.raining && w.canSeeSky(Math.floor(this.x), Math.floor(this.y + this.height), Math.floor(this.z)))) {
        this.fireTicks = 0;
      } else {
        if (this.fireTicks % 20 === 0) this.hurt(game, 1, 'fire');
        this.fireTicks--;
        if ((this.age & 3) === 0) game.particles('flame', this.x, this.y + this.height * 0.5, this.z, 1, this.width * 0.5);
      }
    }

    if (this.touchesBlock(w, B.CACTUS)) this.hurt(game, 1, 'cactus');
    if (this.y < -64) this.hurt(game, 4, 'void');
  }

  // ------------------------------------------------------------------ déplacement

  protected moveTick(game: GameApi): void {
    if (this.vehicle) {
      this.vx = this.vy = this.vz = 0;
      this.fallDistance = 0;
      this.onGround = false;
      return;
    }
    const w = game.world;
    if (this.jumpDelay > 0) this.jumpDelay--;
    if (this.jumping && !this.flying) {
      if (this.inWater || this.inLava) {
        this.vy += 0.04;
      } else if (this.onGround && this.jumpDelay === 0) {
        this.jump();
        this.jumpDelay = 10;
      }
    } else {
      this.jumpDelay = 0;
    }

    const speedLvl = this.effectLevel('speed');
    const slowLvl = this.effectLevel('slow');
    let moveSpeed = this.speed;
    if (speedLvl > 0) moveSpeed *= 1 + 0.2 * speedLvl;
    if (slowLvl > 0) moveSpeed *= Math.max(0.1, 1 - 0.15 * slowLvl);

    travel(w, this, this.moveStrafe * 0.98, this.moveForward * 0.98, {
      yaw: this.yaw,
      speed: moveSpeed,
      airAccel: this.airAccel,
      sneaking: this.sneaking,
      flying: this.flying,
      edgeGuard: this.edgeGuard(),
    });

    if (this.onGround && this.fallDistance > 0) {
      this.land(game, this.fallDistance);
      this.fallDistance = 0;
    }

    const dx = this.x - this.px;
    const dz = this.z - this.pz;
    const target = Math.min(1, Math.sqrt(dx * dx + dz * dz) * 4);
    this.limbAmount += (target - this.limbAmount) * 0.4;
    this.limbSwing += this.limbAmount;
  }

  /** Reste-t-on au bord des blocs (joueur accroupi) ? */
  protected edgeGuard(): boolean {
    return false;
  }

  protected jump(): void {
    this.vy = JUMP_VELOCITY;
  }

  /** Atterrissage après une chute de `distance` blocs. */
  protected land(game: GameApi, distance: number): void {
    const damage = Math.ceil(distance - 3);
    if (damage <= 0) return;
    game.sound(damage > 4 ? 'fall_big' : 'fall_small', this.x, this.y, this.z);
    const below = game.world.getBlockAndMeta(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
    if ((below & 255) !== B.AIR) game.blockParticles(this.x, this.y, this.z, below & 255, below >> 8, 8);
    this.hurt(game, damage, 'fall');
  }

  // ------------------------------------------------------------------ dégâts

  hurt(game: GameApi, amount: number, cause: DamageCause, attacker: Entity | null = null): boolean {
    if (this.health <= 0 || this.dead) return false;
    if ((this.fireImmune || this.hasEffect('fire_resistance')) && (cause === 'fire' || cause === 'lava')) return false;
    if (this.invulnerable > 0 && cause !== 'void') return false;
    amount = this.reduceDamage(game, amount, cause);
    if (amount <= 0) return false;
    this.health -= amount;
    this.invulnerable = 10;
    this.hurtTime = 10;
    if (attacker) {
      this.attacker = attacker;
      this.attackerAge = 0;
      let dx = this.x - attacker.x;
      let dz = this.z - attacker.z;
      if (dx * dx + dz * dz < 1e-4) {
        dx = game.rng() - 0.5;
        dz = game.rng() - 0.5;
      }
      this.knockback(dx, dz, 0.4);
    }
    if (this.health <= 0) {
      this.health = 0;
      const s = this.deathSound();
      if (s) game.sound(s, this.x, this.y, this.z);
      this.onDeath(game, cause, attacker);
    } else {
      const s = this.hurtSound();
      if (s) game.sound(s, this.x, this.y, this.z, 1, 0.9 + game.rng() * 0.2);
    }
    return true;
  }

  /** Réduction des dégâts (armure). */
  protected reduceDamage(_game: GameApi, amount: number, _cause: DamageCause): number {
    return amount;
  }

  /** Recul : (dx, dz) = direction de la poussée. */
  knockback(dx: number, dz: number, strength: number): void {
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    this.vx = this.vx / 2 + (dx / len) * strength;
    this.vz = this.vz / 2 + (dz / len) * strength;
    this.vy = Math.min(0.4, this.vy / 2 + strength);
  }

  heal(amount: number): void {
    if (this.health <= 0) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** Dissipe poison, lenteur, faiblesse et flétrissement (lait, réapparition). */
  clearEffects(): void {
    this.effects.clear();
  }

  protected hurtSound(): SfxName | null {
    return 'mob_hurt';
  }

  protected deathSound(): SfxName | null {
    return 'mob_hurt';
  }

  /** Appelé une fois, au moment de la mort : butin, etc. */
  protected onDeath(_game: GameApi, _cause: DamageCause, _attacker: Entity | null): void {}

  /** Animation de mort : le corps bascule 20 ticks puis disparaît dans un nuage de fumée. */
  protected deathTick(game: GameApi): void {
    this.deathTime++;
    if (this.hurtTime > 0) this.hurtTime--;
    this.moveStrafe = this.moveForward = 0;
    this.jumping = false;
    updateMedium(game.world, this);
    travel(game.world, this, 0, 0, { yaw: this.yaw, speed: 0, airAccel: 0, sneaking: false, flying: false, edgeGuard: false });
    this.limbAmount *= 0.6;
    this.updateLight(game.world);
    if (this.deathTime >= 20 && !this.dead) {
      this.dead = true;
      game.particles('smoke', this.x, this.y + this.height * 0.5, this.z, 16, Math.max(this.width, this.height) * 0.5);
    }
  }
}

/** Ce que les créatures et les objets voient du joueur. */
export interface PlayerLike extends Living {
  readonly gameMode: GameMode;
  /** Les monstres peuvent-ils le prendre pour cible (vivant, en survie) ? */
  readonly targetable: boolean;
  /** Identifiant de l'objet tenu en main (0 = main vide). */
  readonly heldItemId: number;
  readonly inventory?: { readonly held: ItemStack | null };
  /** Commandes du tick : elles dirigent aussi la monture. */
  readonly input: { forward: number; strafe: number; jump: boolean; sneak: boolean };
  /** Monture actuelle (cheval), ou null. */
  vehicle: Entity | null;
  /** Monte sur l'entité ; false si le joueur est déjà en selle. */
  mount(vehicle: Entity): boolean;
  /** Descend de sa monture, à côté d'elle si la place est libre. */
  dismount(game: GameApi): void;
  /** Range la pile dans l'inventaire ; retourne la quantité qui n'a pas pu l'être. */
  collect(stack: ItemStack): number;
  /** Consomme `count` exemplaires de l'objet tenu (sans effet en créatif). */
  consumeHeld(count?: number): void;
  /** Remplace l'objet tenu par un autre (seau → seau de lait) ou le range à côté si la pile compte plusieurs objets. */
  replaceHeld(id: number): void;
  /** Use l'objet tenu de `amount` points (sans effet en créatif). */
  damageHeld(game: GameApi, amount?: number): void;
  addXp(amount: number): void;
  /** Ajoute `n` à une statistique du joueur (voir game/Stats). */
  addStat(key: string, n?: number): void;
}
