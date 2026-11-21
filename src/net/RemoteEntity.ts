/**
 * Représentation côté client d'une entité simulée par le serveur (créature, objet au sol, projectile…).
 * Hérite d'Entity pour être gérée et interpolée par EntityRenderer comme en solo.
 */
import { Entity, type GameApi } from '../entity/Entity';
import type { EntityKind } from '../entity/EntityView';
import { getMobModel } from '../entity/MobModels';
import type { RemoteEntityState } from './Protocol';

export class RemoteEntity extends Entity {
  readonly kind: EntityKind;
  readonly remoteId: number;

  override get roaming(): boolean {
    return true;
  }

  override get pickable(): boolean {
    return this.kind === 'mob';
  }

  private tx: number;
  private ty: number;
  private tz: number;
  private tyaw: number;
  private theadYaw: number;
  private theadPitch: number;

  constructor(s: RemoteEntityState) {
    super();
    this.kind = s.kind;
    this.remoteId = s.id;
    this.mobKind = s.mobKind ?? 'pig';
    if (this.kind === 'mob') {
      const m = getMobModel(this.mobKind);
      this.width = m.width;
      this.height = m.height;
    } else if (this.kind === 'item') {
      this.width = 0.25;
      this.height = 0.25;
    } else if (this.kind === 'falling_block' || this.kind === 'tnt') {
      this.width = 0.98;
      this.height = 0.98;
    }
    this.px = this.x = this.tx = s.x;
    this.py = this.y = this.ty = s.y;
    this.pz = this.z = this.tz = s.z;
    this.pYaw = this.yaw = this.tyaw = s.yaw;
    this.pHeadYaw = this.headYaw = this.theadYaw = s.headYaw ?? s.yaw;
    this.pHeadPitch = this.headPitch = this.theadPitch = s.headPitch ?? 0;
    this.pLeashX = this.leashX = s.leashX ?? 0;
    this.pLeashY = this.leashY = s.leashY ?? 0;
    this.pLeashZ = this.leashZ = s.leashZ ?? 0;
    this.applyServerState(s);
  }

  applyServerState(s: RemoteEntityState): void {
    if (s.mobKind) this.mobKind = s.mobKind;
    this.tx = s.x;
    this.ty = s.y;
    this.tz = s.z;
    this.tyaw = s.yaw;
    this.theadYaw = s.headYaw ?? s.yaw;
    this.theadPitch = s.headPitch ?? 0;
    this.hurtTime = s.hurtTime ?? 0;
    this.deathTime = s.deathTime ?? 0;
    this.swing = s.swing ?? 0;
    this.itemId = s.itemId ?? 0;
    this.itemCount = s.itemCount ?? 0;
    this.offhandId = s.offhandId ?? 0;
    this.blockId = s.blockId ?? 0;
    this.blockMeta = s.blockMeta ?? 0;
    this.fuse = s.fuse ?? 0;
    this.woolColor = s.woolColor ?? 0xffffff;
    this.sheared = s.sheared ?? false;
    this.tamed = s.tamed ?? false;
    this.angry = s.angry ?? false;
    this.sitting = s.sitting ?? false;
    this.collarColor = s.collarColor ?? 0xd8342a;
    this.variant = s.variant ?? 0;
    this.customName = s.customName ?? '';
    this.leashed = s.leashed ?? false;
    if (this.leashed) {
      this.leashX = s.leashX ?? 0;
      this.leashY = s.leashY ?? 0;
      this.leashZ = s.leashZ ?? 0;
    }
    this.saddled = s.saddled ?? false;
    this.baby = s.baby ?? false;
    this.mobScale = s.mobScale ?? 1;
    if (this.kind === 'mob') {
      const m = getMobModel(this.mobKind);
      const scale = (this.baby ? 0.5 : 1) * this.mobScale;
      this.width = m.width * scale;
      this.height = m.height * scale;
    }
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
    this.pLeashX = this.leashX;
    this.pLeashY = this.leashY;
    this.pLeashZ = this.leashZ;

    const dx = this.tx - this.x;
    const dz = this.tz - this.z;
    const horiz = Math.hypot(dx, dz);
    this.x = this.tx;
    this.y = this.ty;
    this.z = this.tz;
    this.yaw = this.tyaw;
    this.headYaw = this.theadYaw;
    this.headPitch = this.theadPitch;

    if (this.kind === 'mob') {
      const targetAmt = Math.min(1, horiz * 4);
      this.limbAmount += (targetAmt - this.limbAmount) * 0.4;
      this.limbSwing += horiz * 2.5;
    }

    this.updateLight(api.world);
  }
}
