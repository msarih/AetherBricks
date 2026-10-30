import * as THREE from 'three';
import { VoxelWorld } from './VoxelWorld';

export class AmbientParticleSystem {
  public root = new THREE.Group();

  // 1. Lucioles nocturnes
  private firefliesCount = 120;
  private firefliesPoints!: THREE.Points;
  private firefliesPositions!: Float32Array;
  private firefliesPhases!: Float32Array;
  private firefliesMat!: THREE.PointsMaterial;

  // 2. Pétales et feuilles flottantes diurnes
  private petalsCount = 140;
  private petalsPoints!: THREE.Points;
  private petalsPositions!: Float32Array;
  private petalsVelocities!: Float32Array;
  private petalsMat!: THREE.PointsMaterial;

  // 3. Fumée de cheminées et feux de camp
  private smokeCount = 160;
  private smokePoints!: THREE.Points;
  private smokePositions!: Float32Array;
  private smokeAges!: Float32Array;
  private smokeMat!: THREE.PointsMaterial;

  constructor(private readonly scene: THREE.Scene, private readonly world: VoxelWorld) {
    this.initFireflies();
    this.initDriftingPetals();
    this.initSmokeSystem();
    this.scene.add(this.root);
  }

  private initFireflies(): void {
    const geo = new THREE.BufferGeometry();
    this.firefliesPositions = new Float32Array(this.firefliesCount * 3);
    this.firefliesPhases = new Float32Array(this.firefliesCount);

    for (let i = 0; i < this.firefliesCount; i++) {
      this.firefliesPositions[i * 3 + 0] = (Math.random() - 0.5) * 48;
      this.firefliesPositions[i * 3 + 1] = 0.4 + Math.random() * 4.5;
      this.firefliesPositions[i * 3 + 2] = (Math.random() - 0.5) * 48;
      this.firefliesPhases[i] = Math.random() * Math.PI * 2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(this.firefliesPositions, 3));

    this.firefliesMat = new THREE.PointsMaterial({
      color: 0xfef08a,
      size: 0.28,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.firefliesPoints = new THREE.Points(geo, this.firefliesMat);
    this.root.add(this.firefliesPoints);
  }

  private initDriftingPetals(): void {
    const geo = new THREE.BufferGeometry();
    this.petalsPositions = new Float32Array(this.petalsCount * 3);
    this.petalsVelocities = new Float32Array(this.petalsCount * 3);

    for (let i = 0; i < this.petalsCount; i++) {
      this.petalsPositions[i * 3 + 0] = (Math.random() - 0.5) * 60;
      this.petalsPositions[i * 3 + 1] = 0.5 + Math.random() * 8.0;
      this.petalsPositions[i * 3 + 2] = (Math.random() - 0.5) * 60;

      this.petalsVelocities[i * 3 + 0] = 0.8 + Math.random() * 0.8; // dérive vent vers +X
      this.petalsVelocities[i * 3 + 1] = -0.25 - Math.random() * 0.35; // descente douce
      this.petalsVelocities[i * 3 + 2] = 0.3 + Math.random() * 0.4;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(this.petalsPositions, 3));

    this.petalsMat = new THREE.PointsMaterial({
      color: 0xfbcfe8,
      size: 0.18,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });

    this.petalsPoints = new THREE.Points(geo, this.petalsMat);
    this.root.add(this.petalsPoints);
  }

  private initSmokeSystem(): void {
    const geo = new THREE.BufferGeometry();
    this.smokePositions = new Float32Array(this.smokeCount * 3);
    this.smokeAges = new Float32Array(this.smokeCount);

    for (let i = 0; i < this.smokeCount; i++) {
      this.smokePositions[i * 3 + 0] = 0;
      this.smokePositions[i * 3 + 1] = -999;
      this.smokePositions[i * 3 + 2] = 0;
      this.smokeAges[i] = 1.0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(this.smokePositions, 3));

    this.smokeMat = new THREE.PointsMaterial({
      color: 0xd1d5db,
      size: 0.42,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    this.smokePoints = new THREE.Points(geo, this.smokeMat);
    this.root.add(this.smokePoints);
  }

  public update(dt: number, elapsed: number, playerPos: THREE.Vector3, isNight: boolean): void {
    const px = playerPos.x;
    const pz = playerPos.z;

    // 1. Mise à jour des Lucioles (Fireflies)
    const targetFireflyOpacity = isNight ? 0.88 : 0.0;
    this.firefliesMat.opacity = THREE.MathUtils.lerp(
      this.firefliesMat.opacity,
      targetFireflyOpacity,
      dt * 2.0
    );

    if (this.firefliesMat.opacity > 0.02) {
      const posAttr = this.firefliesPoints.geometry.attributes.position;
      for (let i = 0; i < this.firefliesCount; i++) {
        const phase = this.firefliesPhases[i] + elapsed * 1.5;
        this.firefliesPositions[i * 3 + 0] += Math.sin(phase) * 0.012;
        this.firefliesPositions[i * 3 + 1] += Math.cos(phase * 0.7) * 0.008;
        this.firefliesPositions[i * 3 + 2] += Math.sin(phase * 0.5) * 0.012;

        // Recentrer les lucioles autour du joueur
        const dx = this.firefliesPositions[i * 3 + 0] - px;
        const dz = this.firefliesPositions[i * 3 + 2] - pz;
        if (Math.abs(dx) > 28) this.firefliesPositions[i * 3 + 0] = px - Math.sign(dx) * 26;
        if (Math.abs(dz) > 28) this.firefliesPositions[i * 3 + 2] = pz - Math.sign(dz) * 26;
        if (this.firefliesPositions[i * 3 + 1] < 0.2) this.firefliesPositions[i * 3 + 1] = 0.5;
        if (this.firefliesPositions[i * 3 + 1] > 6.0) this.firefliesPositions[i * 3 + 1] = 4.0;
      }
      posAttr.needsUpdate = true;
    }

    // 2. Mise à jour des Pétales et Feuilles diurnes
    const targetPetalsOpacity = !isNight ? 0.78 : 0.0;
    this.petalsMat.opacity = THREE.MathUtils.lerp(this.petalsMat.opacity, targetPetalsOpacity, dt * 2.0);

    if (this.petalsMat.opacity > 0.02) {
      const posAttr = this.petalsPoints.geometry.attributes.position;
      for (let i = 0; i < this.petalsCount; i++) {
        this.petalsPositions[i * 3 + 0] += this.petalsVelocities[i * 3 + 0] * dt;
        this.petalsPositions[i * 3 + 1] += this.petalsVelocities[i * 3 + 1] * dt;
        this.petalsPositions[i * 3 + 2] += this.petalsVelocities[i * 3 + 2] * dt;

        // Recyclage au sol ou distance
        if (
          this.petalsPositions[i * 3 + 1] < -0.4 ||
          Math.abs(this.petalsPositions[i * 3 + 0] - px) > 34 ||
          Math.abs(this.petalsPositions[i * 3 + 2] - pz) > 34
        ) {
          this.petalsPositions[i * 3 + 0] = px - 28 + Math.random() * 12;
          this.petalsPositions[i * 3 + 1] = 4.5 + Math.random() * 4.5;
          this.petalsPositions[i * 3 + 2] = pz + (Math.random() - 0.5) * 56;
        }
      }
      posAttr.needsUpdate = true;
    }

    // 3. Fumée de cheminées et feux de camp
    this.updateSmoke(dt, playerPos);
  }

  private updateSmoke(dt: number, playerPos: THREE.Vector3): void {
    const fireEmitters = this.world.getFireEmitters(playerPos, 50);

    if (fireEmitters.length === 0) {
      this.smokeMat.opacity = 0;
      return;
    }
    this.smokeMat.opacity = 0.35;

    const posAttr = this.smokePoints.geometry.attributes.position;
    for (let i = 0; i < this.smokeCount; i++) {
      this.smokeAges[i] += dt * 0.45;

      if (this.smokeAges[i] >= 1.0) {
        this.smokeAges[i] = Math.random() * 0.2;
        const emitter = fireEmitters[Math.floor(Math.random() * fireEmitters.length)];
        this.smokePositions[i * 3 + 0] = emitter.x + (Math.random() - 0.5) * 0.2;
        this.smokePositions[i * 3 + 1] = emitter.y;
        this.smokePositions[i * 3 + 2] = emitter.z + (Math.random() - 0.5) * 0.2;
      } else {
        // La fumée monte et dérive doucement avec le vent
        this.smokePositions[i * 3 + 0] += dt * 0.25;
        this.smokePositions[i * 3 + 1] += dt * 1.15;
        this.smokePositions[i * 3 + 2] += dt * 0.12;
      }
    }
    posAttr.needsUpdate = true;
  }
}
