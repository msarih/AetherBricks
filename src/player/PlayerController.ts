import * as THREE from 'three';
import { VoxelWorld } from '../world/VoxelWorld';
import { SoundManager } from '../audio/SoundManager';

export class PlayerController {
  public readonly camera: THREE.PerspectiveCamera;
  public readonly position = new THREE.Vector3(0, 1.2, 4);
  public readonly velocity = new THREE.Vector3();

  private yaw = 0;
  private pitch = -0.12;
  public isFlying = false;
  public isGrounded = false;
  public isLocked = false;

  private readonly keys = new Set<string>();
  private readonly playerRadius = 0.34;
  private readonly playerHeight = 1.72;
  private readonly eyeOffset = 0.62; // Distance above player base center
  private stepTimer = 0;

  constructor(
    camera: THREE.PerspectiveCamera,
    private readonly domElement: HTMLElement,
    private readonly world: VoxelWorld,
    private readonly sound: SoundManager,
    private readonly onLockChange?: (locked: boolean) => void
  ) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.syncCamera();

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyF' && this.isLocked) {
        this.toggleFlyMode();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const sensitivity = 0.0021;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      const maxPitch = Math.PI / 2 - 0.04;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
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

  public resetPosition(): void {
    this.position.set(0, 1.2, 4);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = -0.12;
    this.syncCamera();
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

  public update(dt: number): void {
    const clampedDt = Math.min(dt, 0.05);

    // Forward & Right vectors on horizontal plane
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const moveDir = new THREE.Vector3();
    // Works automatically for both AZERTY (ZQSD) and QWERTY (WASD) via physical KeyCodes + Arrow keys
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveDir.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveDir.sub(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveDir.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveDir.sub(right);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
    }

    const isSprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const baseSpeed = this.isFlying ? 10.5 : 5.8;
    const speed = isSprinting && !this.isFlying ? baseSpeed * 1.55 : baseSpeed;

    this.velocity.x = moveDir.x * speed;
    this.velocity.z = moveDir.z * speed;

    if (this.isFlying) {
      this.velocity.y = 0;
      if (this.keys.has('Space')) this.velocity.y = 7.5;
      if (this.keys.has('KeyC') || this.keys.has('ShiftLeft')) this.velocity.y = -7.5;
    } else {
      // Gravity
      this.velocity.y -= 23.0 * clampedDt;
      if (this.keys.has('Space') && this.isGrounded) {
        this.velocity.y = 8.4;
        this.isGrounded = false;
        this.sound.playStep();
      }
    }

    // Apply X movement with collision
    const nextX = this.position.clone();
    nextX.x += this.velocity.x * clampedDt;
    if (!this.checkWorldCollision(nextX)) {
      this.position.x = nextX.x;
    }

    // Apply Z movement with collision
    const nextZ = this.position.clone();
    nextZ.z += this.velocity.z * clampedDt;
    if (!this.checkWorldCollision(nextZ)) {
      this.position.z = nextZ.z;
    }

    // Apply Y movement with ground + voxel collision
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

    // Keep within flat terrain bounds (-78..78)
    this.position.x = Math.max(-78, Math.min(78, this.position.x));
    this.position.z = Math.max(-78, Math.min(78, this.position.z));

    // Footstep sound when walking on ground or bricks
    if (this.isGrounded && !this.isFlying && moveDir.lengthSq() > 0.1) {
      this.stepTimer += clampedDt * (isSprinting ? 1.45 : 1.0);
      if (this.stepTimer >= 0.42) {
        this.stepTimer = 0;
        this.sound.playStep();
      }
    } else {
      this.stepTimer = 0.3;
    }

    this.syncCamera();
  }

  private syncCamera(): void {
    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeOffset,
      this.position.z
    );
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
