/**
 * Représentation d'un joueur distant en multijoueur.
 * Hérite d'Entity pour être géré et affiché par EntityRenderer comme les autres entités.
 */
import { Entity, type GameApi } from '../entity/Entity';
import type { EntityKind } from '../entity/EntityView';
import type { RemotePlayerState } from './Protocol';

export class RemotePlayerEntity extends Entity {
  readonly kind: EntityKind = 'player';
  readonly remoteId: number;
  gameMode: RemotePlayerState['gameMode'] = 'survival';
  blocking = false;

  override get roaming(): boolean {
    return true;
  }
  override get pickable(): boolean {
    return !this.hidden && this.gameMode !== 'spectator';
  }
  override width = 0.6;
  override height = 1.8;

  private tx: number;
  private ty: number;
  private tz: number;
  private tyaw: number;
  private tpitch: number;

  constructor(s: RemotePlayerState) {
    super();
    this.remoteId = s.id;
    this.mobKind = 'player';
    this.customName = s.name;
    this.px = this.x = this.tx = s.x;
    this.py = this.y = this.ty = s.y;
    this.pz = this.z = this.tz = s.z;
    this.pYaw = this.yaw = this.pHeadYaw = this.headYaw = this.tyaw = s.yaw;
    this.pHeadPitch = this.headPitch = this.tpitch = s.pitch;
    this.sneaking = s.sneaking;
    this.swing = s.swing;
    this.gameMode = s.gameMode;
    this.itemId = s.heldId ?? 0;
    this.offhandId = s.offhandId ?? 0;
    this.blocking = s.blocking ?? false;
    this.hurtTime = s.hurtTime ?? 0;
    this.hidden = s.alive === false;
  }

  applyServerState(s: RemotePlayerState): void {
    this.customName = s.name;
    this.tx = s.x;
    this.ty = s.y;
    this.tz = s.z;
    this.tyaw = s.yaw;
    this.tpitch = s.pitch;
    this.sneaking = s.sneaking;
    this.swing = s.swing;
    this.gameMode = s.gameMode;
    this.itemId = s.heldId ?? 0;
    this.offhandId = s.offhandId ?? 0;
    this.blocking = s.blocking ?? false;
    this.hurtTime = s.hurtTime ?? 0;
    this.hidden = s.alive === false;
  }

  tick(api: GameApi): void {
    this.age++;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.pYaw = this.yaw;
    this.pHeadYaw = this.headYaw;
    this.pHeadPitch = this.headPitch;
    this.pLimbSwing = this.limbSwing;
    this.pLimbAmount = this.limbAmount;

    const dx = this.tx - this.x;
    const dz = this.tz - this.z;
    const horiz = Math.hypot(dx, dz);
    this.x = this.tx;
    this.y = this.ty;
    this.z = this.tz;
    this.yaw = this.tyaw;
    this.headYaw = this.tyaw;
    this.headPitch = this.tpitch;

    const targetAmt = Math.min(1, horiz * 4);
    this.limbAmount += (targetAmt - this.limbAmount) * 0.4;
    this.limbSwing += horiz * 2.5;

    this.updateLight(api.world);
  }
}
