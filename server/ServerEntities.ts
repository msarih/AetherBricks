/**
 * Adaptateurs d'entités et de lumière pour le serveur multijoueur autoritaire.
 */
import { Entity, Living, type DamageCause, type GameApi, type PlayerLike } from '../src/entity/Entity';
import type { EntityKind } from '../src/entity/EntityView';
import type { Inventory } from '../src/game/Inventory';
import type { RemoteEntityState } from '../src/net/Protocol';
import { xpNeeded } from '../src/player/Player';
import { BLOCK_EMIT } from '../src/world/Blocks';
import type { Chunk } from '../src/world/Chunk';
import { CHUNK_HEIGHT, type GameMode } from '../src/world/Constants';
import { makeStack, type ItemStack } from '../src/world/ItemStack';

/** Joueur côté serveur exposé comme PlayerLike aux créatures et objets au sol. */
export class ServerPlayerEntity extends Living implements PlayerLike {
  readonly kind: EntityKind = 'player';
  gameMode: GameMode = 'survival';
  xpLevel = 0;
  xpProgress = 0;
  invDirty = false;
  vitalsDirty = false;
  readonly input = { forward: 0, strafe: 0, jump: false, sneak: false };

  constructor(readonly inventory: Inventory) {
    super();
    this.width = 0.6;
    this.height = 1.8;
    this.eyeHeight = 1.62;
  }

  get creative(): boolean {
    return this.gameMode === 'creative';
  }

  override get roaming(): boolean {
    return true;
  }

  /** Jalon 4 : les créatures hostiles n'infligent pas encore de dégâts aux joueurs (jalon 5). */
  get targetable(): boolean {
    return false;
  }

  override hurt(_game: GameApi, _amount: number, _cause: DamageCause, _attacker: Entity | null = null): boolean {
    return false;
  }

  get heldItemId(): number {
    return this.inventory.heldId;
  }

  mount(vehicle: Entity): boolean {
    if (this.vehicle) return false;
    this.vehicle = vehicle;
    return true;
  }

  dismount(_game: GameApi): void {
    this.vehicle = null;
  }

  collect(stack: ItemStack): number {
    const before = stack.count;
    const left = this.inventory.add(stack);
    if (left < before) this.invDirty = true;
    return left;
  }

  consumeHeld(count = 1): void {
    if (this.creative) return;
    this.inventory.consumeHeld(count);
    this.invDirty = true;
  }

  replaceHeld(id: number): void {
    const inv = this.inventory;
    const s = inv.slots[inv.selected];
    if (!s) return;
    if (this.creative) {
      if (inv.find(id) < 0) {
        const stack = makeStack(id, 1);
        if (inv.add(stack) > 0) inv.drop(stack);
      }
      this.invDirty = true;
      return;
    }
    if (s.count <= 1) {
      inv.slots[inv.selected] = makeStack(id, 1);
    } else {
      s.count--;
      const rem = makeStack(id, 1);
      if (inv.add(rem) > 0) inv.drop(rem);
    }
    this.invDirty = true;
  }

  damageHeld(game: GameApi, amount = 1): void {
    if (this.creative) return;
    this.inventory.damageHeld(amount, game.rng);
    this.invDirty = true;
  }

  addXp(amount: number): void {
    if (amount <= 0) return;
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
      }
    }
    this.vitalsDirty = true;
  }

  addStat(_key: string, _n = 1): void {}

  tick(_game: GameApi): void {}
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
