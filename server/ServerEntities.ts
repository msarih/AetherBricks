/**
 * Adaptateurs d'entités et de lumière pour le serveur multijoueur autoritaire.
 */
import { type DamageCause, type EffectType, type Entity, type GameApi } from '../src/entity/Entity';
import { updateMedium } from '../src/entity/Physics';
import type { RemoteEntityState } from '../src/net/Protocol';
import { Player } from '../src/player/Player';
import type { ParticleKind } from '../src/render/Particles';
import { BLOCK_EMIT } from '../src/world/Blocks';
import type { Chunk } from '../src/world/Chunk';
import { CHUNK_HEIGHT } from '../src/world/Constants';
import { getItem } from '../src/world/Items';
import type { ItemStack } from '../src/world/ItemStack';

/** Durée de recharge d'attaque Minecraft 1.12 en ticks selon l'objet tenu. */
export function attackCooldownTicks(itemId: number): number {
  if (itemId <= 0) return 5;
  const tool = getItem(itemId).tool;
  if (tool === 'sword') return 13;
  if (tool === 'axe') return 20;
  if (tool === 'pickaxe') return 17;
  if (tool === 'shovel') return 20;
  return 5;
}

/** Joueur côté serveur : réutilise toute la logique survie de Player sans simulation physique locale. */
export class ServerPlayerEntity extends Player {
  invDirty = false;
  vitalsDirty = false;
  attackRechargeTicks = 20;
  canPvp: () => boolean = () => true;
  onHurtNotify?: (vx: number, vy: number, vz: number) => void;
  onDeathNotify?: (cause: DamageCause, attacker: Entity | null) => void;

  constructor(name = '') {
    super('survival');
    this.customName = name;
  }

  override get roaming(): boolean {
    return true;
  }

  /** Consomme la jauge de recharge 1.12 et retourne le multiplicateur de dégâts (0.2..1.0). */
  consumeAttackMultiplier(itemId: number): number {
    const cooldown = attackCooldownTicks(itemId);
    const progress = Math.min(1, this.attackRechargeTicks / cooldown);
    this.attackRechargeTicks = 0;
    return 0.2 + progress * progress * 0.8;
  }

  /** Met à jour position, distance de chute et épuisement depuis un paquet `move` validé. */
  handleMove(
    game: GameApi,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    sneaking: boolean,
    onGround: boolean,
    sprinting: boolean,
    swing: number,
  ): void {
    if (!this.alive || this.sleeping) return;
    const prevX = this.x;
    const prevY = this.y;
    const prevZ = this.z;
    const prevOnGround = this.onGround;
    this.setPosition(x, y, z);
    this.setRotation(yaw, pitch);
    this.sneaking = sneaking;
    this.onGround = onGround;
    this.sprinting = sprinting;
    this.swing = swing;
    updateMedium(game.world, this);

    const dy = y - prevY;
    if (this.creative || this.spectator || this.inWater || this.flying) {
      this.fallDistance = 0;
    } else if (this.inLava) {
      this.fallDistance *= 0.5;
    } else if (!onGround && dy < 0) {
      this.fallDistance += -dy;
    }
    if (onGround && this.fallDistance > 0) {
      super.land(game, this.fallDistance);
      this.fallDistance = 0;
    }

    const dist = Math.hypot(x - prevX, z - prevZ);
    if (!this.creative && !this.spectator && dist > 0 && dist < 5) {
      if (this.inWater) this.exhaustion += 0.015 * Math.hypot(dist, dy);
      else if (onGround) this.exhaustion += (sprinting ? 0.1 : 0.01) * dist;
    }
    if (!this.creative && !this.spectator && prevOnGround && !onGround && dy > 0) {
      this.exhaustion += sprinting ? 0.2 : 0.05;
    }
  }

  override tick(game: GameApi): void {
    this.attackRechargeTicks++;
    if (this.useKind !== 'none') this.useTicks++;
    const prevH = this.health;
    const prevF = this.hunger;
    const prevA = this.air;
    const prevFire = this.fireTicks > 0;
    const prevFx = this.effects.size;
    super.tick(game);
    if (this.alive && this.effects.size > 0 && this.age % 12 === 0) {
      const firstType = this.effects.keys().next().value;
      const kind: ParticleKind =
        firstType === 'fire_resistance' || firstType === 'strength'
          ? 'flame'
          : firstType === 'night_vision'
            ? 'portal'
            : firstType === 'slow' || firstType === 'weakness' || firstType === 'wither'
              ? 'smoke'
              : 'slime';
      game.particles(kind, this.x, this.y + 1.0, this.z, 2, 0.35);
    }
    if (
      this.health !== prevH ||
      this.hunger !== prevF ||
      this.air !== prevA ||
      (this.fireTicks > 0) !== prevFire ||
      this.effects.size !== prevFx
    ) {
      this.vitalsDirty = true;
    }
  }

  protected override think(_game: GameApi): void {}

  protected override moveTick(_game: GameApi): void {}

  protected override deathTick(_game: GameApi): void {
    if (this.deathTime < 20) this.deathTime++;
    if (this.hurtTime > 0) this.hurtTime--;
  }

  override hurt(game: GameApi, amount: number, cause: DamageCause, attacker: Entity | null = null): boolean {
    if (attacker instanceof ServerPlayerEntity && attacker !== this && !this.canPvp()) return false;
    const ok = super.hurt(game, amount, cause, attacker);
    if (ok) {
      this.vitalsDirty = true;
      this.invDirty = true;
      if (this.health > 0) {
        this.onHurtNotify?.(this.vx, this.vy, this.vz);
      }
    }
    return ok;
  }

  protected override onDeath(game: GameApi, cause: DamageCause, attacker: Entity | null): void {
    super.onDeath(game, cause, attacker);
    this.invDirty = true;
    this.vitalsDirty = true;
    this.onDeathNotify?.(cause, attacker);
  }

  override collect(stack: ItemStack): number {
    const before = stack.count;
    const left = super.collect(stack);
    if (left < before) this.invDirty = true;
    return left;
  }

  override consumeHand(hand: 'main' | 'offhand', count = 1): void {
    if (this.creative) return;
    super.consumeHand(hand, count);
    this.invDirty = true;
  }

  override replaceHand(hand: 'main' | 'offhand', id: number): void {
    super.replaceHand(hand, id);
    this.invDirty = true;
  }

  override damageHand(hand: 'main' | 'offhand', game: GameApi, amount = 1): void {
    if (this.creative) return;
    super.damageHand(hand, game, amount);
    this.invDirty = true;
  }

  override addXp(amount: number): void {
    if (amount <= 0) return;
    super.addXp(amount);
    this.vitalsDirty = true;
  }

  override addEffect(type: EffectType, ticks: number, level = 1): void {
    super.addEffect(type, ticks, level);
    this.vitalsDirty = true;
  }

  override removeEffect(type: EffectType): void {
    super.removeEffect(type);
    this.vitalsDirty = true;
  }

  override clearEffects(): void {
    super.clearEffects();
    this.vitalsDirty = true;
  }
}

/** Calcule une lumière colonne simple (ciel + sources ponctuelles) et marque le chunk prêt pour la simulation serveur. */
export function computeServerChunkLight(chunk: Chunk): void {
  const blocks = chunk.blocks;
  const light = chunk.light;
  const hm = chunk.heightmap;
  for (let lz = 0; lz < 16; lz++) {
    for (let lx = 0; lx < 16; lx++) {
      const col = (lz << 4) | lx;
      const top = hm[col];
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const idx = (y << 8) | col;
        const sky = y >= top ? 15 : 0;
        const blk = BLOCK_EMIT[blocks[idx]] & 15;
        light[idx] = (sky << 4) | blk;
      }
    }
  }
  chunk.meshed = true;
}

/** Sérialise une entité serveur pour diffusion réseau aux clients à portée. */
export function serializeEntityState(e: Entity): RemoteEntityState {
  const out: RemoteEntityState = {
    id: e.id,
    kind: e.kind,
    x: Math.round(e.x * 1000) / 1000,
    y: Math.round(e.y * 1000) / 1000,
    z: Math.round(e.z * 1000) / 1000,
    yaw: Math.round(e.yaw * 1000) / 1000,
  };
  if (e.kind === 'mob') {
    out.mobKind = e.mobKind;
    out.headYaw = Math.round(e.headYaw * 1000) / 1000;
    out.headPitch = Math.round(e.headPitch * 1000) / 1000;
  }
  if (e.hurtTime > 0) out.hurtTime = e.hurtTime;
  if (e.deathTime > 0) out.deathTime = e.deathTime;
  if (e.swing > 0) out.swing = Math.round(e.swing * 100) / 100;
  if (e.itemId > 0) out.itemId = e.itemId;
  if (e.itemCount > 0) out.itemCount = e.itemCount;
  if (e.offhandId > 0) out.offhandId = e.offhandId;
  if (e.blockId > 0) out.blockId = e.blockId;
  if (e.blockMeta > 0) out.blockMeta = e.blockMeta;
  if (e.fuse > 0) out.fuse = Math.round(e.fuse * 100) / 100;
  if (e.woolColor !== 0xffffff) out.woolColor = e.woolColor;
  if (e.sheared) out.sheared = true;
  if (e.tamed) out.tamed = true;
  if (e.angry) out.angry = true;
  if (e.sitting) out.sitting = true;
  if (e.collarColor !== 0xd8342a) out.collarColor = e.collarColor;
  if (e.variant !== 0) out.variant = e.variant;
  if (e.customName) out.customName = e.customName;
  if (e.leashed) {
    out.leashed = true;
    out.leashX = Math.round(e.leashX * 1000) / 1000;
    out.leashY = Math.round(e.leashY * 1000) / 1000;
    out.leashZ = Math.round(e.leashZ * 1000) / 1000;
  }
  if (e.saddled) out.saddled = true;
  if (e.baby) out.baby = true;
  if (e.mobScale !== 1) out.mobScale = e.mobScale;
  return out;
}
