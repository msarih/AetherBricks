import * as THREE from 'three';
import { VoxelWorld } from '../world/VoxelWorld';
import { SoundManager } from '../audio/SoundManager';
import { CharacterAvatar } from './CharacterAvatar';

export type CameraViewMode = 'tps-back' | 'tps-front' | 'fps';

export class PlayerController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly position = new THREE.Vector3(0, 1.2, 4);
  public readonly velocity = new THREE.Vector3();
  public readonly avatar: CharacterAvatar;

  private yaw = 0;
  private pitch = -0.18;
  private characterFacingYaw = 0;
  private isMovingInput = false;
  public isFlying = false;
  public isGrounded = false;
  public isLocked = false;
  public viewMode: CameraViewMode = 'tps-back';

  private readonly keys = new Set<string>();
  private readonly playerRadius = 0.34;
  private readonly playerHeight = 1.72;
  private readonly eyeOffset = 0.62;
  private stepTimer = 0;

  constructor(
    camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    private readonly world: VoxelWorld,
    private readonly sound: SoundManager,
    private readonly onLockChange?: (locked: boolean) => void,
    private readonly onViewModeChange?: (mode: CameraViewMode) => void
  ) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';

    this.avatar = new CharacterAvatar();
    this.world.scene.add(this.avatar.root);
    this.syncCamera(0.016);

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys.add(e.code);
      if (e.code === 'KeyF' && this.isLocked) {
        this.toggleFlyMode();
      }
      if (e.code === 'KeyV' && this.isLocked) {
        this.cycleViewMode();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const sensitivity = 0.0021;
      const prevYaw = this.yaw;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      const maxPitch = Math.PI / 2 - 0.08;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

      // Keep relative facing offset when rotating camera with mouse if standing still
      if (!this.isMovingInput) {
        this.characterFacingYaw += this.yaw - prevYaw;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
      if (!this.isLocked) {
        this.keys.clear();
      }
      this.onLockChange?.(this.isLocked);
    });
  }

  public requestLock(): void {
    this.domElement.requestPointerLock();
  }

  public toggleFlyMode(): void {
    this.isFlying = !this.isFlying;
    this.velocity.y = 0;
    this.sound.playSelect();
  }

  public cycleViewMode(explicitMode?: CameraViewMode): CameraViewMode {
    if (explicitMode) {
      this.viewMode = explicitMode;
    } else if (this.viewMode === 'tps-back') {
      this.viewMode = 'tps-front';
    } else if (this.viewMode === 'tps-front') {
      this.viewMode = 'fps';
    } else {
      this.viewMode = 'tps-back';
    }
    this.sound.playSelect();
    this.syncCamera(0.016);
    this.onViewModeChange?.(this.viewMode);
    return this.viewMode;
  }

  public getViewModeLabel(): string {
    switch (this.viewMode) {
      case 'tps-back':
        return '3E PERSONNE (DOS)';
      case 'tps-front':
        return '3E PERSONNE (FACE)';
      case 'fps':
        return '1RE PERSONNE (FPS)';
    }
  }

  public triggerActionAnimation(): void {
    // Lorsqu'on pose ou détruit une brique, le personnage fait face à la cible visée et lève le bras
    this.characterFacingYaw = this.yaw;
    this.avatar.triggerArmSwing();
  }

  public resetPosition(): void {
    this.position.set(0, 1.2, 4);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.18;
    this.characterFacingYaw = 0;
    this.syncCamera(0.016);
  }

  public intersectsBrick(bx: number, by: number, bz: number): boolean {
    const minX = this.position.x - this.playerRadius;
    const maxX = this.position.x + this.playerRadius;
    const minY = this.position.y - this.playerHeight * 0.5;
    const maxY = this.position.y + this.playerHeight * 0.5;
    const minZ = this.position.z - this.playerRadius;
    const maxZ = this.position.z + this.playerRadius;

    return (
      maxX > bx - 0.5 &&
      minX < bx + 0.5 &&
      maxY > by - 0.5 &&
      minY < by + 0.5 &&
      maxZ > bz - 0.5 &&
      minZ < bz + 0.5
    );
  }

  private checkWorldCollision(pos: THREE.Vector3): boolean {
    const minX = Math.floor(pos.x - this.playerRadius + 0.5);
    const maxX = Math.floor(pos.x + this.playerRadius + 0.5);
    const minY = Math.floor(pos.y - this.playerHeight * 0.5 + 0.5);
    const maxY = Math.floor(pos.y + this.playerHeight * 0.5 + 0.5);
    const minZ = Math.floor(pos.z - this.playerRadius + 0.5);
    const maxZ = Math.floor(pos.z + this.playerRadius + 0.5);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.world.hasBrickAt(x, y, z)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private isTouchingLadder(pos: THREE.Vector3 = this.position): boolean {
    const r = this.playerRadius + 0.18;
    const minX = Math.floor(pos.x - r + 0.5);
    const maxX = Math.floor(pos.x + r + 0.5);
    const minY = Math.floor(pos.y - this.playerHeight * 0.5 + 0.5);
    const maxY = Math.floor(pos.y + this.playerHeight * 0.5 + 0.5);
    const minZ = Math.floor(pos.z - r + 0.5);
    const maxZ = Math.floor(pos.z + r + 0.5);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.world.hasLadderAt(x, y, z)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private hasStepUpStairOrSlopeAt(pos: THREE.Vector3): boolean {
    const minX = Math.floor(pos.x - this.playerRadius + 0.5);
    const maxX = Math.floor(pos.x + this.playerRadius + 0.5);
    const footY = Math.floor(pos.y - this.playerHeight * 0.5 + 0.5);
    const minZ = Math.floor(pos.z - this.playerRadius + 0.5);
    const maxZ = Math.floor(pos.z + this.playerRadius + 0.5);

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (this.world.hasStairOrSlopeAt(x, footY, z)) {
          return true;
        }
      }
    }
    return false;
  }

  public update(dt: number): void {
    const clampedDt = Math.min(dt, 0.05);

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const moveDir = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveDir.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveDir.sub(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveDir.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveDir.sub(right);

    this.isMovingInput = moveDir.lengthSq() > 0.001;
    if (this.isMovingInput) {
      moveDir.normalize();
      // Le personnage change immédiatement de face selon la flèche de direction pressée (Haut, Bas, Gauche, Droite)
      this.characterFacingYaw = Math.atan2(-moveDir.x, -moveDir.z);
    }

    const isSprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const baseSpeed = this.isFlying ? 10.5 : 5.8;
    const speed = isSprinting && !this.isFlying ? baseSpeed * 1.55 : baseSpeed;

    this.velocity.x = moveDir.x * speed;
    this.velocity.z = moveDir.z * speed;

    const onLadder = !this.isFlying && this.isTouchingLadder();

    if (this.isFlying) {
      this.velocity.y = 0;
      if (this.keys.has('Space')) this.velocity.y = 7.5;
      if (this.keys.has('KeyC') || this.keys.has('ShiftLeft')) this.velocity.y = -7.5;
    } else if (onLadder) {
      // Escalade fluide sur les échelles : Espace ou Flèche Haut / W fait monter, sinon descente douce contrôlée
      if (this.keys.has('Space') || this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
        this.velocity.y = 4.8;
      } else if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
        this.velocity.y = -4.2;
      } else {
        this.velocity.y = -1.6;
      }
      this.isGrounded = true;
    } else {
      this.velocity.y -= 23.0 * clampedDt;
      if (this.keys.has('Space') && this.isGrounded) {
        this.velocity.y = 8.4;
        this.isGrounded = false;
        this.sound.playStep();
      }
    }

    // Apply X movement (with automatic step-up on stairs & triangular slopes)
    const nextX = this.position.clone();
    nextX.x += this.velocity.x * clampedDt;
    if (!this.checkWorldCollision(nextX)) {
      this.position.x = nextX.x;
    } else if (this.isGrounded && this.hasStepUpStairOrSlopeAt(nextX)) {
      const stepX = nextX.clone();
      stepX.y += 1.02;
      if (!this.checkWorldCollision(stepX)) {
        this.position.copy(stepX);
      } else {
        this.velocity.x = 0;
      }
    } else {
      this.velocity.x = 0;
    }

    // Apply Z movement (with automatic step-up on stairs & triangular slopes)
    const nextZ = this.position.clone();
    nextZ.z += this.velocity.z * clampedDt;
    if (!this.checkWorldCollision(nextZ)) {
      this.position.z = nextZ.z;
    } else if (this.isGrounded && this.hasStepUpStairOrSlopeAt(nextZ)) {
      const stepZ = nextZ.clone();
      stepZ.y += 1.02;
      if (!this.checkWorldCollision(stepZ)) {
        this.position.copy(stepZ);
      } else {
        this.velocity.z = 0;
      }
    } else {
      this.velocity.z = 0;
    }

    // Apply Y movement
    const nextY = this.position.clone();
    nextY.y += this.velocity.y * clampedDt;
    const groundMinY = -0.5 + this.playerHeight * 0.5;

    this.isGrounded = false;
    if (nextY.y <= groundMinY) {
      this.position.y = groundMinY;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else if (!this.checkWorldCollision(nextY)) {
      this.position.y = nextY.y;
    } else {
      if (this.velocity.y < 0) {
        this.isGrounded = true;
      }
      this.velocity.y = 0;
    }

    this.position.x = Math.max(-78, Math.min(78, this.position.x));
    this.position.z = Math.max(-78, Math.min(78, this.position.z));

    if (this.isGrounded && !this.isFlying && this.isMovingInput) {
      this.stepTimer += clampedDt * (isSprinting ? 1.45 : 1.0);
      if (this.stepTimer >= 0.42) {
        this.stepTimer = 0;
        this.sound.playStep();
      }
    } else {
      this.stepTimer = 0.3;
    }

    this.syncCamera(clampedDt);
  }

  public getEyePosition(): THREE.Vector3 {
    return new THREE.Vector3(
      this.position.x,
      this.position.y + this.eyeOffset,
      this.position.z
    );
  }

  public getAimDirection(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    dir.applyEuler(euler);
    return dir.normalize();
  }

  private syncCamera(dt: number): void {
    const isThirdPerson = this.viewMode !== 'fps';
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.avatar.update(
      dt,
      this.position,
      this.isMovingInput,
      horizSpeed,
      this.characterFacingYaw,
      this.pitch,
      this.isGrounded,
      this.isFlying,
      isThirdPerson
    );

    const headPos = this.getEyePosition();

    if (this.viewMode === 'fps') {
      this.camera.position.copy(headPos);
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    } else if (this.viewMode === 'tps-back') {
      const dist = 3.6;
      const aimDir = this.getAimDirection();
      const rightOffset = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(0.35);
      const camPos = headPos
        .clone()
        .add(rightOffset)
        .addScaledVector(aimDir, -dist)
        .add(new THREE.Vector3(0, 0.35, 0));

      camPos.y = Math.max(-0.15, camPos.y);

      this.camera.position.copy(camPos);
      const lookTarget = headPos.clone().add(rightOffset).addScaledVector(aimDir, 6.0);
      this.camera.lookAt(lookTarget);
    } else {
      const dist = 3.2;
      const forwardFlat = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const camPos = headPos
        .clone()
        .addScaledVector(forwardFlat, dist)
        .add(new THREE.Vector3(0, 0.25, 0));
      camPos.y = Math.max(-0.15, camPos.y);

      this.camera.position.copy(camPos);
      this.camera.lookAt(this.position.x, this.position.y + 0.25, this.position.z);
    }
  }
}
