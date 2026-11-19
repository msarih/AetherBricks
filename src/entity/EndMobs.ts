/**
 * Créatures de la fin du jeu : le poisson d'argent des forts, les cristaux de l'End et le
 * dragon de l'Ender.
 *
 * Le dragon (Minecraft 1.12, simplifié) tourne autour des piliers, se fait soigner par les
 * cristaux à sa portée, crache des boules qui laissent un nuage brûlant, fonce sur le joueur,
 * et vient par moments se poser sur la fontaine centrale, où l'épée peut l'atteindre.
 *
 * Écarts avec Minecraft : une seule zone de touche (pas de dégâts doublés à la tête) et un
 * trajet de ronde circulaire au lieu du graphe de points de passage.
 */
import type { SfxName } from '../audio/Sfx';
import { B } from '../world/Ids';
import { EXIT_PILLAR_TOP } from '../world/gen/EndLayout';
import { Entity, Living, num } from './Entity';
import type { DamageCause, EntityData, GameApi } from './Entity';
import type { EntityKind } from './EntityView';
import { getMobModel } from './MobModels';
import { Monster, TAU, clamp, registerMob, wrapAngle } from './Mobs';
import { Fireball } from './Objects';

// =============================================================================================
// Poisson d'argent
// =============================================================================================

/** Poisson d'argent : petit, rapide, il sort de la cage de la salle du portail. */
export class Silverfish extends Monster {
  constructor() {
    super('silverfish', 8, 0.075);
  }

  protected fight(game: GameApi, t: Living): void {
    this.chase(game, t);
    this.melee(game, t, (this.width + t.width) / 2 + 0.5, 1);
  }

  protected dropLoot(): void {}
}

registerMob('silverfish', () => new Silverfish());

// =============================================================================================
// Cristal de l'End
// =============================================================================================

/** Portée du rayon de soin d'un cristal, en blocs. */
export const CRYSTAL_RANGE = 32;
/** Puissance de l'explosion d'un cristal détruit (Minecraft : 6). */
const CRYSTAL_BLAST = 6;
/** Dégâts infligés au dragon quand on détruit le cristal qui le soigne. */
const CRYSTAL_BACKLASH = 10;

/**
 * Cristal de l'End : posé au sommet d'un pilier, il soigne le dragon qui passe à sa portée.
 * Le moindre coup le fait exploser.
 */
export class EndCrystal extends Entity {
  readonly kind: EntityKind = 'mob';
  /** Dragon en cours de soin et ticks pendant lesquels le rayon reste affiché. */
  beam: EnderDragon | null = null;
  beamTicks = 0;

  constructor() {
    super();
    this.mobKind = 'end_crystal';
    const m = getMobModel('end_crystal');
    this.width = m.width;
    this.height = m.height;
    this.noClip = true;
  }

  override get pickable(): boolean {
    return !this.dead;
  }

  tick(game: GameApi): void {
    this.beginTick();
    this.updateLight(game.world);
    const d = this.beam;
    if (d && this.beamTicks > 0 && d.alive) {
      this.beamTicks--;
      this.pLeashX = this.leashed ? this.leashX : d.x;
      this.pLeashY = this.leashed ? this.leashY : d.y + 1.2;
      this.pLeashZ = this.leashed ? this.leashZ : d.z;
      this.leashX = d.x;
      this.leashY = d.y + 1.2;
      this.leashZ = d.z;
      this.leashed = true;
    } else {
      this.leashed = false;
      this.beam = null;
    }
  }

  override hurt(game: GameApi, _amount: number, _cause: DamageCause, attacker: Entity | null = null): boolean {
    if (this.dead) return false;
    this.dead = true;
    const d = this.beam;
    if (d && this.beamTicks > 0 && d.alive) d.hurt(game, CRYSTAL_BACKLASH, 'explosion', attacker);
    game.explode(this.x, this.y + 1, this.z, CRYSTAL_BLAST, false, attacker);
    return true;
  }

  override save(): EntityData | null {
    return this.dead ? null : this.saveBase('end_crystal');
  }

  static load(d: EntityData): EndCrystal {
    const c = new EndCrystal();
    c.loadBase(d);
    return c;
  }
}

// =============================================================================================
// Dragon de l'Ender
// =============================================================================================

export const DRAGON_MAX_HEALTH = 200;
/** Durée de l'agonie du dragon, en ticks (Minecraft : 200). */
export const DRAGON_DEATH_TICKS = 200;

/** Ronde : rayon du cercle autour du centre de l'île et nombre de points de passage. */
const ROUND_RADIUS = 60;
const ROUND_POINTS = 12;
/** Vitesses de vol, en blocs par tick. */
const SPEED_ROUND = 0.5;
const SPEED_STRAFE = 0.55;
const SPEED_CHARGE = 0.9;
const SPEED_LAND = 0.4;
/** Virage maximal par tick, en radians. */
const TURN_RATE = 0.065;
/** Dégâts de contact : ailes et corps, tête. */
const WING_DAMAGE = 5;
const HEAD_DAMAGE = 10;
/** Nuage de souffle : durée, rayon, dégâts toutes les demi-secondes. */
const CLOUD_TICKS = 100;
const CLOUD_RADIUS = 3;
const CLOUD_DAMAGE = 3;
/** Dégâts encaissés posé sur la fontaine avant de reprendre son vol. */
const PERCH_FLEE_DAMAGE = 50;

export type DragonPhase = 'round' | 'strafe' | 'charge' | 'landing' | 'perched' | 'takeoff' | 'dying';

interface Cloud {
  x: number;
  y: number;
  z: number;
  ticks: number;
}

/** Blocs que le dragon ne détruit pas en passant (Minecraft) : obsidienne, pierre de l'End, bedrock, barreaux, portail. */
function dragonProof(id: number): boolean {
  return id === B.AIR || id === B.OBSIDIAN || id === B.END_STONE || id === B.BEDROCK || id === B.IRON_BARS || id === B.END_PORTAL
    || id === B.END_PORTAL_FRAME || id === B.DRAGON_EGG || id === B.FIRE || id === B.TORCH;
}

/** Boule du dragon : elle ne brûle rien, mais laisse un nuage de souffle là où elle s'écrase. */
class DragonFireball extends Fireball {
  constructor(private readonly burst: (x: number, y: number, z: number) => void) {
    super(false);
  }

  /** Ne se renvoie pas d'un coup, contrairement à celle du ghast. */
  override get pickable(): boolean {
    return false;
  }

  protected override trail(game: GameApi): void {
    game.particles('portal', this.x, this.y + 0.5, this.z, 2, 0.4);
  }

  protected override detonate(game: GameApi): void {
    if (this.dead) return;
    this.dead = true;
    game.sound('fizz', this.x, this.y, this.z, 0.9, 0.6);
    this.burst(this.x, this.y, this.z);
  }

  override save(): EntityData | null {
    return null;
  }
}

export class EnderDragon extends Living {
  readonly kind: EntityKind = 'mob';
  phase: DragonPhase = 'round';
  /** L'agonie est terminée : le jeu ouvre le portail de sortie. */
  defeated = false;
  /** Cristaux encore debout à portée de vue du jeu (rafraîchi toutes les demi-secondes). */
  crystals = 0;

  private goalX = 0;
  private goalY = 90;
  private goalZ = 0;
  private phaseTicks = 0;
  private point = 0;
  private clockwise = 1;
  private perchDamage = 0;
  private breathDelay = 0;
  private readonly clouds: Cloud[] = [];

  constructor() {
    super();
    this.mobKind = 'ender_dragon';
    const m = getMobModel('ender_dragon');
    this.width = m.width;
    this.height = m.height;
    this.eyeHeight = m.eyeHeight;
    this.health = this.maxHealth = DRAGON_MAX_HEALTH;
    this.noClip = true;
    this.fireImmune = true;
    this.waterBreathing = true;
    this.flying = true;
  }

  override get roaming(): boolean {
    return true;
  }

  protected think(): void {}

  protected override hurtSound(): SfxName | null {
    return 'mob_hurt';
  }

  /** Point de passage `i` de la ronde. */
  private roundPoint(i: number): { x: number; y: number; z: number } {
    const k = ((i % ROUND_POINTS) + ROUND_POINTS) % ROUND_POINTS;
    const a = (k / ROUND_POINTS) * TAU;
    return { x: Math.cos(a) * ROUND_RADIUS, y: 84 + ((k * 7) % 3) * 8, z: Math.sin(a) * ROUND_RADIUS };
  }

  private setGoal(x: number, y: number, z: number): void {
    this.goalX = x;
    this.goalY = clamp(y, 20, 122);
    this.goalZ = z;
  }

  private enter(phase: DragonPhase): void {
    this.phase = phase;
    this.phaseTicks = 0;
    if (phase === 'round') {
      // reprend la ronde au point le plus proche, dans le sens où il vole déjà
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < ROUND_POINTS; i++) {
        const p = this.roundPoint(i);
        const d = (p.x - this.x) * (p.x - this.x) + (p.z - this.z) * (p.z - this.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      this.point = best + this.clockwise;
    } else if (phase === 'perched') {
      this.perchDamage = 0;
      this.breathDelay = 40;
    }
  }

  /** Position de la gueule (les boules et le souffle en partent). */
  private mouth(): { x: number; y: number; z: number } {
    return { x: this.x - Math.sin(this.yaw) * 6.5, y: this.y + 1.4, z: this.z - Math.cos(this.yaw) * 6.5 };
  }

  override tick(game: GameApi): void {
    this.beginTick();
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.hurtTime > 0) this.hurtTime--;
    this.updateLight(game.world);
    this.tickClouds(game);
    if (this.health <= 0) {
      this.dyingTick(game);
      return;
    }
    if ((this.age + this.id) % 10 === 0) this.tickCrystals(game);

    this.phaseTicks++;
    let speed = SPEED_ROUND;
    const p = game.player;
    switch (this.phase) {
      case 'round': {
        const wp = this.roundPoint(this.point);
        this.setGoal(wp.x, wp.y, wp.z);
        if (this.distanceSq(wp.x, wp.y, wp.z) < 12 * 12) {
          this.point += this.clockwise;
          this.chooseNext(game);
        }
        break;
      }
      case 'strafe': {
        speed = SPEED_STRAFE;
        this.setGoal(p.x, p.y + 14, p.z);
        const dx = p.x - this.x;
        const dz = p.z - this.z;
        const flat = Math.sqrt(dx * dx + dz * dz);
        const facing = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - this.yaw));
        if (flat < 44 && facing < 0.35 && this.phaseTicks > 20) {
          this.spit(game, p);
          this.enter('round');
        } else if (this.phaseTicks > 320 || !p.targetable) {
          this.enter('round');
        }
        break;
      }
      case 'charge': {
        speed = SPEED_CHARGE;
        this.setGoal(p.x, p.y + 0.5, p.z);
        if (this.phaseTicks > 110 || !p.targetable || this.distanceSq(p.x, p.y, p.z) < 3 * 3) this.enter('round');
        break;
      }
      case 'landing': {
        speed = SPEED_LAND;
        this.setGoal(0.5, EXIT_PILLAR_TOP + 1, 0.5);
        if (this.distanceSq(0.5, EXIT_PILLAR_TOP + 1, 0.5) < 2.5 * 2.5) {
          this.setPosition(0.5, EXIT_PILLAR_TOP + 1, 0.5);
          this.px = this.x;
          this.py = this.y;
          this.pz = this.z;
          this.enter('perched');
          game.sound('thunder', this.x, this.y, this.z, 0.8, 1.5);
          // posé : plus aucun déplacement ce tick-ci
          return;
        }
        if (this.phaseTicks > 600) {
          this.enter('round');
        }
        break;
      }
      case 'perched':
        this.perchTick(game);
        return;
      case 'takeoff': {
        this.setGoal(this.x - Math.sin(this.yaw) * 30, EXIT_PILLAR_TOP + 24, this.z - Math.cos(this.yaw) * 30);
        if (this.phaseTicks > 50) this.enter(p.targetable && this.distanceSq(p.x, p.y, p.z) < 40 * 40 ? 'charge' : 'round');
        break;
      }
      default:
        break;
    }
    this.fly(speed);
    if (this.age % 5 === 0) this.strike(game);
    if ((this.age & 1) === 0) this.smash(game);
  }

  /** En fin de tronçon de ronde : continuer, aller cracher sur le joueur, ou venir se poser. */
  private chooseNext(game: GameApi): void {
    const p = game.player;
    const r = game.rng();
    // il se pose d'autant plus volontiers qu'il lui reste peu de cristaux (Minecraft : 1 chance sur cristaux + 3)
    if (r < 1 / (this.crystals + 3) / 2) {
      this.enter('landing');
      return;
    }
    const near = p.targetable && p.x * p.x + p.z * p.z < 140 * 140;
    if (near && game.rng() < 0.3) this.enter('strafe');
  }

  /** Vole vers le but : virage limité, montée et descente douces. */
  private fly(speed: number): void {
    const dx = this.goalX - this.x;
    const dy = this.goalY - this.y;
    const dz = this.goalZ - this.z;
    if (dx * dx + dz * dz > 1) this.yaw += clamp(wrapAngle(Math.atan2(-dx, -dz) - this.yaw), -TURN_RATE, TURN_RATE);
    const climb = clamp(dy * 0.08, -0.45, 0.45);
    this.x -= Math.sin(this.yaw) * speed;
    this.z -= Math.cos(this.yaw) * speed;
    this.y += climb;
    this.headYaw = this.yaw;
    // le corps pique ou se cabre avec la pente du vol
    this.headPitch += (Math.atan2(climb, speed) - this.headPitch) * 0.2;
    this.limbAmount = 1;
    this.limbSwing += 0.35;
  }

  /** Crache une boule vers la cible ; elle laisse un nuage de souffle. */
  private spit(game: GameApi, t: Living): void {
    const m = this.mouth();
    const ball = new DragonFireball((x, y, z) => this.clouds.push({ x, y, z, ticks: CLOUD_TICKS }));
    ball.owner = this;
    ball.shoot(m.x, m.y, m.z, t.x - m.x, t.y + t.height * 0.5 - m.y, t.z - m.z, 0.8);
    game.spawn(ball);
    game.sound('fire', m.x, m.y, m.z, 1, 0.5);
  }

  /** Posé sur la fontaine : il suit le joueur du regard et souffle sur lui s'il s'approche. */
  private perchTick(game: GameApi): void {
    const p = game.player;
    this.limbAmount *= 0.8;
    this.headPitch *= 0.8;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    if (p.targetable) this.yaw += clamp(wrapAngle(Math.atan2(-dx, -dz) - this.yaw), -0.04, 0.04);
    this.headYaw = this.yaw;
    if (--this.breathDelay <= 0) {
      this.breathDelay = 70;
      if (p.targetable && dx * dx + dz * dz < 20 * 20) {
        // le souffle retombe en nuage entre la gueule et le joueur
        const m = this.mouth();
        const reach = Math.min(1, 9 / (Math.sqrt(dx * dx + dz * dz) + 1e-6));
        this.clouds.push({ x: this.x + dx * reach, y: p.y + 0.2, z: this.z + dz * reach, ticks: CLOUD_TICKS });
        game.particles('portal', m.x, m.y, m.z, 30, 1.5);
        game.sound('fire', m.x, m.y, m.z, 1, 0.4);
      }
    }
    if (this.phaseTicks > 260 || this.perchDamage >= PERCH_FLEE_DAMAGE) this.enter('takeoff');
  }

  /** Cristal le plus proche à portée : il soigne le dragon d'un demi-cœur toutes les demi-secondes. */
  private tickCrystals(game: GameApi): void {
    let best: EndCrystal | null = null;
    let bestD = CRYSTAL_RANGE * CRYSTAL_RANGE;
    let count = 0;
    for (const e of game.entities) {
      if (!(e instanceof EndCrystal) || e.dead) continue;
      count++;
      const d = this.distanceSqTo(e);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    this.crystals = count;
    if (best) {
      best.beam = this;
      best.beamTicks = 12;
      if (this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1);
    }
  }

  /** Bouscule et blesse ceux qu'il touche : les ailes renversent, la tête frappe plus fort. */
  private strike(game: GameApi): void {
    const m = this.mouth();
    for (const e of game.entitiesInBox(m.x - 1.5, m.y - 1.5, m.z - 1.5, m.x + 1.5, m.y + 1.5, m.z + 1.5, this)) {
      if (e instanceof Living && e.alive && e.mobKind !== 'enderman') e.hurt(game, HEAD_DAMAGE, 'attack', this);
    }
    for (const e of game.entitiesInBox(this.x - 4, this.y - 1, this.z - 4, this.x + 4, this.y + 3, this.z + 4, this)) {
      if (!(e instanceof Living) || !e.alive || e.mobKind === 'enderman') continue;
      if (e.hurt(game, WING_DAMAGE, 'attack', this)) e.vy = Math.max(e.vy, 0.5);
    }
  }

  /** Détruit les blocs fragiles qu'il traverse. */
  private smash(game: GameApi): void {
    const w = game.world;
    if (!w.rules.mobGriefing) return;
    const x0 = Math.floor(this.x - 2);
    const y0 = Math.floor(this.y);
    const z0 = Math.floor(this.z - 2);
    for (let y = y0; y <= y0 + 3; y++) {
      for (let z = z0; z <= z0 + 4; z++) {
        for (let x = x0; x <= x0 + 4; x++) {
          const id = w.getBlock(x, y, z);
          if (dragonProof(id) || id === B.WATER || id === B.LAVA) continue;
          w.setBlock(x, y, z, B.AIR, 0);
          if (game.rng() < 0.2) game.blockParticles(x + 0.5, y + 0.5, z + 0.5, id, 0, 4);
        }
      }
    }
  }

  private tickClouds(game: GameApi): void {
    const list = this.clouds;
    let n = 0;
    for (const c of list) {
      if (--c.ticks <= 0) continue;
      list[n++] = c;
      if ((c.ticks & 1) === 0) game.particles('portal', c.x, c.y + 0.4, c.z, 3, CLOUD_RADIUS * 0.7);
      if (c.ticks % 10 !== 0) continue;
      const r = CLOUD_RADIUS;
      for (const e of game.entitiesInBox(c.x - r, c.y - 1, c.z - r, c.x + r, c.y + 2, c.z + r, this)) {
        if (e instanceof Living && e.alive && e.mobKind !== 'enderman' && e.distanceSq(c.x, e.y, c.z) < r * r) e.hurt(game, CLOUD_DAMAGE, 'magic', this);
      }
    }
    list.length = n;
  }

  /** Zone où le souffle du dragon brûle en ce moment (pour les tests et l'affichage). */
  get cloudCount(): number {
    return this.clouds.length;
  }

  override hurt(game: GameApi, amount: number, cause: DamageCause, attacker: Entity | null = null): boolean {
    if (this.health <= 0 || this.dead) return false;
    // seuls les coups, les flèches, les explosions et la magie l'atteignent
    if (cause !== 'attack' && cause !== 'arrow' && cause !== 'explosion' && cause !== 'magic') return false;
    // posé, ses écailles renvoient les flèches (Minecraft)
    if (this.phase === 'perched' && cause === 'arrow') return false;
    if (attacker === this) return false;
    if (!super.hurt(game, amount, cause, attacker)) return false;
    this.vx = this.vy = this.vz = 0;
    if (this.phase === 'perched') this.perchDamage += amount;
    else if (this.phase === 'round' && attacker === game.player && game.player.targetable && game.rng() < 0.25) this.enter('charge');
    return true;
  }

  protected override onDeath(game: GameApi, _cause: DamageCause, attacker: Entity | null): void {
    if ((attacker ?? this.attacker) === game.player) {
      game.player.addStat('mob_kills');
      game.player.addStat('killed:ender_dragon');
    }
    this.phase = 'dying';
    this.phaseTicks = 0;
  }

  /** Agonie : il gagne le centre de l'île, s'élève en se désagrégeant, puis disparaît. */
  private dyingTick(game: GameApi): void {
    this.deathTime++;
    this.hurtTime = 10;
    const dx = 0.5 - this.x;
    const dz = 0.5 - this.z;
    if (dx * dx + dz * dz > 6 * 6 && this.deathTime < DRAGON_DEATH_TICKS - 80) {
      this.setGoal(0.5, EXIT_PILLAR_TOP + 14, 0.5);
      this.fly(SPEED_ROUND);
    } else {
      this.y += 0.08;
      this.yaw += 0.12;
      this.headYaw = this.yaw;
    }
    if (this.deathTime % 5 === 0) {
      const ox = (game.rng() - 0.5) * 8;
      const oy = (game.rng() - 0.5) * 4;
      const oz = (game.rng() - 0.5) * 8;
      game.particles('explosion', this.x + ox, this.y + 1 + oy, this.z + oz, 2, 0.8);
      game.particles('portal', this.x, this.y + 1, this.z, 12, 3);
    }
    if (this.deathTime % 25 === 1) game.sound('explode', this.x, this.y, this.z, 1, 0.5 + game.rng() * 0.3);
    if (this.deathTime >= DRAGON_DEATH_TICKS) {
      this.defeated = true;
      this.dead = true;
      game.particles('explosion', this.x, this.y + 1, this.z, 30, 4);
    }
  }

  override save(): EntityData | null {
    return null;
  }
}

/** Santé d'un dragon relue d'une sauvegarde. */
export function readDragonHealth(v: unknown): number {
  return clamp(num(v, DRAGON_MAX_HEALTH), 1, DRAGON_MAX_HEALTH);
}
