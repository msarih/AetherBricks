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
  public isSitting = false;
  private currentChairPos: THREE.Vector3 | null = null;
  public isInWater = false;
  public isOnLadder = false;
  public isSprinting = false;
  public viewMode: CameraViewMode = 'tps-back';

  private readonly keys = new Set<string>();
  private readonly playerRadius = 0.34;
  private readonly playerHeight = 1.72;
  private readonly eyeOffset = 0.62;
  private stepTimer = 0;
  private ladderClimbDistance = 0;

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
      // Ignore character inputs when typing in text fields or modals
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          (active as HTMLElement).isContentEditable)
      ) {
        this.clearKeys();
        return;
      }

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
      // macOS quirk: releasing Meta/Alt/Ctrl might swallow subsequent keyups
      if (e.key === 'Meta' || e.key === 'Alt' || e.key === 'Control') {
        this.clearKeys();
      }
    });

    // Évite le bug où le personnage continue d'avancer indéfiniment lors d'une perte de focus
    window.addEventListener('blur', () => this.clearKeys());
    window.addEventListener('focus', () => this.clearKeys());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clearKeys();
      }
    });
    window.addEventListener('contextmenu', () => this.clearKeys());

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
      this.clearKeys();
      this.onLockChange?.(this.isLocked);
    });
  }

  public clearKeys(): void {
    this.keys.clear();
    this.velocity.x = 0;
    this.velocity.z = 0;
    if (this.isFlying) {
      this.velocity.y = 0;
    }
    this.isMovingInput = false;
  }

  public requestLock(): void {
    this.domElement.requestPointerLock();
  }

  public exitLock(): void {
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }

  public toggleFlyMode(): void {
    if (this.isSitting) {
      this.standUp();
    }
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

  public getYaw(): number {
    return this.yaw;
  }

  public resetPosition(spawnPos?: { x: number; y: number; z: number; yaw?: number; pitch?: number }): void {
    const x = spawnPos?.x ?? 0;
    const z = spawnPos?.z ?? 6;
    const groundY = this.world.getTerrainHeightAt(x, z) + this.playerHeight * 0.5;
    let y = spawnPos?.y ?? groundY;
    if (y < groundY) y = groundY;

    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = spawnPos?.yaw ?? 0;
    this.pitch = spawnPos?.pitch ?? -0.08;
    this.characterFacingYaw = this.yaw;
    this.isSitting = false;
    this.currentChairPos = null;
    this.isFlying = false;
    this.clearKeys();

    // Dégagement de sécurité anti-blocage au spawn
    if (this.checkWorldCollision(this.position)) {
      for (let offsetZ = 0.5; offsetZ <= 4.0; offsetZ += 0.5) {
        const testPos = new THREE.Vector3(x, groundY, z + offsetZ);
        if (!this.checkWorldCollision(testPos)) {
          this.position.copy(testPos);
          break;
        }
      }
      if (this.checkWorldCollision(this.position)) {
        for (let offsetY = 0.5; offsetY <= 3.0; offsetY += 0.5) {
          const testPos = new THREE.Vector3(x, y + offsetY, z);
          if (!this.checkWorldCollision(testPos)) {
            this.position.copy(testPos);
            break;
          }
        }
      }
    }

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
    // 1. Collision avec les obstacles naturels (arbres infranchissables et intérieur des collines)
    if (this.world.hasObstacleAt(pos, this.playerRadius, this.playerHeight)) {
      return true;
    }

    // 2. Collision avec les blocs de construction (briques, dalles, toits, meubles...)
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

  public standUp(): void {
    if (!this.isSitting) return;
    this.isSitting = false;

    const chair = this.currentChairPos || this.position.clone();
    this.currentChairPos = null;

    // Calculer la hauteur naturelle du sol sous les pieds
    const groundY = this.world.getTerrainHeightAt(chair.x, chair.z) + this.playerHeight * 0.5;

    // Directions candidates pour poser le joueur debout hors du fauteuil (vers l'avant du regard, ou les 4 points cardinaux)
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    const candidates: THREE.Vector3[] = [
      forward,
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
    ];

    let placed = false;
    for (const dir of candidates) {
      for (const dist of [0.85, 1.15, 1.45]) {
        const testX = chair.x + dir.x * dist;
        const testZ = chair.z + dir.z * dist;
        const testGroundY = this.world.getTerrainHeightAt(testX, testZ) + this.playerHeight * 0.5;
        const testPos = new THREE.Vector3(testX, testGroundY, testZ);

        if (!this.checkWorldCollision(testPos)) {
          this.position.copy(testPos);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }

    // Si entouré d'obstacles sur tous les côtés, surélever au-dessus du dossier
    if (!placed) {
      this.position.set(chair.x, chair.y + 1.25, chair.z);
    }

    this.velocity.set(0, 0, 0);
    this.clearKeys();
    this.syncCamera(0.016);
  }

  public toggleSitting(chairPos?: THREE.Vector3): boolean {
    if (this.isSitting) {
      this.standUp();
      return false;
    }
    if (chairPos) {
      this.isSitting = true;
      this.isFlying = false;
      this.currentChairPos = chairPos.clone();
      this.velocity.set(0, 0, 0);
      this.position.set(chairPos.x, chairPos.y + 0.14, chairPos.z);
      return true;
    }
    return false;
  }

  private checkInWater(pos: THREE.Vector3 = this.position): boolean {
    const rx = Math.round(pos.x);
    const ry = Math.round(pos.y - this.playerHeight * 0.25);
    const rz = Math.round(pos.z);
    return this.world.hasWaterAt(rx, ry, rz);
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
    if (this.keys.has('KeyW') || this.keys.has('KeyZ') || this.keys.has('ArrowUp')) moveDir.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveDir.sub(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveDir.add(right);
    if (this.keys.has('KeyA') || this.keys.has('KeyQ') || this.keys.has('ArrowLeft')) moveDir.sub(right);

    this.isMovingInput = moveDir.lengthSq() > 0.001;
    if (this.isSitting && (this.isMovingInput || this.keys.has('Space'))) {
      this.standUp();
    }
    if (this.isMovingInput) {
      moveDir.normalize();
      // Le personnage change immédiatement de face selon la flèche de direction pressée (Haut, Bas, Gauche, Droite)
      this.characterFacingYaw = Math.atan2(-moveDir.x, -moveDir.z);
    }

    if (this.isSitting) {
      this.velocity.set(0, 0, 0);
      this.syncCamera(clampedDt);
      return;
    }

    this.isInWater = this.checkInWater();
    this.isSprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && this.isLocked;

    // Vitesse dynamique : marche / course rapide au sol et vol normal / turbo en l'air
    let speed = 6.0;
    if (this.isFlying) {
      speed = this.isSprinting ? 32.0 : 12.0;
    } else if (this.isInWater) {
      speed = this.isSprinting ? 6.2 : 3.8;
    } else {
      speed = this.isSprinting ? 12.8 : 6.0;
    }

    this.velocity.x = moveDir.x * speed;
    this.velocity.z = moveDir.z * speed;

    const onLadder = !this.isFlying && this.isTouchingLadder();
    this.isOnLadder = onLadder;

    if (this.isFlying) {
      const vertSpeed = this.isSprinting ? 22.0 : 9.0;
      this.velocity.y = 0;
      if (this.keys.has('Space')) {
        this.velocity.y = vertSpeed;
      }
      if (this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight')) {
        this.velocity.y = -vertSpeed;
      }
    } else if (this.isInWater) {
      // Physique de nage douce dans l'eau : flottabilité et remontée avec Espace
      this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, -0.6, clampedDt * 3.5);
      if (this.keys.has('Space')) {
        this.velocity.y = this.isSprinting ? 5.2 : 3.6;
      } else if (this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight')) {
        this.velocity.y = -(this.isSprinting ? 4.8 : 3.2);
      }
      this.isGrounded = false;
    } else if (onLadder) {
      // Escalade réaliste et naturelle sur les échelles :
      // - Monter : Espace ou Avancer (W / Flèche Haut)
      // - Descendre : Reculer (S / Flèche Bas) ou S'accroupir (C / Shift / Ctrl)
      // - Arrêt : Si aucune commande n'est pressée, le joueur reste solidement agrippé aux échelons (vitesse = 0) !
      const isClimbUp =
        this.keys.has('Space') ||
        this.keys.has('KeyW') ||
        this.keys.has('KeyZ') ||
        this.keys.has('ArrowUp');
      const isClimbDown =
        this.keys.has('KeyS') ||
        this.keys.has('ArrowDown') ||
        this.keys.has('KeyC') ||
        this.keys.has('ShiftLeft') ||
        this.keys.has('ShiftRight') ||
        this.keys.has('ControlLeft') ||
        this.keys.has('ControlRight');

      const climbSpeed = this.isSprinting ? 3.6 : 2.5;
      let targetVy = 0;
      if (isClimbUp) {
        targetVy = climbSpeed;
      } else if (isClimbDown) {
        targetVy = -climbSpeed;
      } else {
        targetVy = 0; // Prise ferme sur les barreaux (zéro glissade involontaire !)
      }

      this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, targetVy, clampedDt * 14.0);
      this.isGrounded = true;

      // Son régulier d'échelons en bois à chaque prise de barreau
      if (Math.abs(this.velocity.y) > 0.35) {
        this.ladderClimbDistance += Math.abs(this.velocity.y) * clampedDt;
        if (this.ladderClimbDistance >= 0.38) {
          this.sound.playStep();
          this.ladderClimbDistance = 0;
        }
      }
    } else {
      this.velocity.y -= 23.0 * clampedDt;
      if (this.keys.has('Space') && this.isGrounded) {
        this.velocity.y = this.isSprinting ? 9.6 : 8.4;
        this.isGrounded = false;
        this.sound.playStep();
      }
    }

    // Effet cinématique subtil d'accélération FOV (sensation de vitesse fluide)
    const isAccelerating =
      this.isSprinting &&
      (this.isMovingInput ||
        (this.isFlying &&
          (this.keys.has('Space') ||
            this.keys.has('KeyC') ||
            this.keys.has('ControlLeft') ||
            this.keys.has('ControlRight'))));
    const targetFov = isAccelerating ? (this.isFlying ? 79 : 75) : 70;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, clampedDt * 8.0);
      this.camera.updateProjectionMatrix();
    }

    // Apply X movement (with automatic step-up on stairs, slopes & rolling hills)
    const nextX = this.position.clone();
    nextX.x += this.velocity.x * clampedDt;

    const targetGroundYX = this.world.getTerrainHeightAt(nextX.x, nextX.z) + this.playerHeight * 0.5;
    if (this.isGrounded && !this.isFlying) {
      const slopeDeltaX = targetGroundYX - this.position.y;
      if (slopeDeltaX > 0 && slopeDeltaX <= 0.65) {
        nextX.y += slopeDeltaX;
      }
    }

    if (!this.checkWorldCollision(nextX)) {
      this.position.x = nextX.x;
      if (this.isGrounded && !this.isFlying) {
        this.position.y = nextX.y;
      }
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

    // Apply Z movement (with automatic step-up on stairs, slopes & rolling hills)
    const nextZ = this.position.clone();
    nextZ.z += this.velocity.z * clampedDt;

    const targetGroundYZ = this.world.getTerrainHeightAt(this.position.x, nextZ.z) + this.playerHeight * 0.5;
    if (this.isGrounded && !this.isFlying) {
      const slopeDeltaZ = targetGroundYZ - this.position.y;
      if (slopeDeltaZ > 0 && slopeDeltaZ <= 0.65) {
        nextZ.y += slopeDeltaZ;
      }
    }

    if (!this.checkWorldCollision(nextZ)) {
      this.position.z = nextZ.z;
      if (this.isGrounded && !this.isFlying) {
        this.position.y = nextZ.y;
      }
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

    // Apply Y movement (with real-time terrain collision on hills and ground plane)
    const nextY = this.position.clone();
    nextY.y += this.velocity.y * clampedDt;
    const terrainY = this.world.getTerrainHeightAt(this.position.x, this.position.z);
    const groundMinY = terrainY + this.playerHeight * 0.5;

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

    // Maintien au sol en descente de colline (évite les soubresauts)
    if (this.isGrounded && !this.isFlying && this.isMovingInput) {
      const currentSnapY = this.world.getTerrainHeightAt(this.position.x, this.position.z) + this.playerHeight * 0.5;
      if (Math.abs(this.position.y - currentSnapY) < 0.28) {
        this.position.y = currentSnapY;
        this.velocity.y = 0;
        this.isGrounded = true;
      }
    }

    // Monde ouvert infini : aucune barrière artificielle !

    if (this.isGrounded && !this.isFlying && this.isMovingInput) {
      this.stepTimer += clampedDt * (this.isSprinting ? 1.6 : 1.0);
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
      isThirdPerson,
      this.isSitting,
      this.isOnLadder,
      this.velocity.y
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
