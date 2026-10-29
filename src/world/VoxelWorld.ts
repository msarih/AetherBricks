import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BrickDefinition, createBrickCatalog, createCountrysideGrassPBR } from './Materials';
import { BrickEntry, getStarterScene } from './Presets';
import { CountrysideEnv } from './CountrysideEnv';

interface HistoryAction {
  kind: 'place' | 'remove';
  entry: BrickEntry;
}

interface ParticleBurst {
  mesh: THREE.InstancedMesh;
  velocities: THREE.Vector3[];
  positions: THREE.Vector3[];
  age: number;
  maxAge: number;
}

const STORAGE_KEY = 'aetherbricks_world_v1';

export class VoxelWorld {
  public readonly scene: THREE.Scene;
  public readonly catalog: Map<number, BrickDefinition>;
  private readonly brickGeo: THREE.BufferGeometry;
  private readonly groundMesh: THREE.Mesh;
  private readonly bricks = new Map<string, { mesh: THREE.Mesh; type: number; light?: THREE.PointLight }>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly interactables: THREE.Object3D[] = [];
  private countryside?: CountrysideEnv;

  // Ghost block preview
  private readonly ghostGroup: THREE.Group;
  private readonly ghostMesh: THREE.Mesh;
  public currentTarget: {
    placePos: THREE.Vector3;
    removePos: THREE.Vector3 | null;
    hitBrickType: number | null;
  } | null = null;

  // Undo / Redo stacks
  private undoStack: HistoryAction[] = [];
  private redoStack: HistoryAction[] = [];

  // Particle bursts
  private bursts: ParticleBurst[] = [];
  private readonly particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  private readonly particleMat = new THREE.MeshStandardMaterial({
    color: 0xf8f6f0,
    roughness: 0.65,
  });

  constructor(scene: THREE.Scene, countryside?: CountrysideEnv) {
    this.scene = scene;
    this.countryside = countryside;
    this.catalog = createBrickCatalog();

    // High-resolution beveled cube geometry (4 segments, 3.2cm chamfer)
    this.brickGeo = new RoundedBoxGeometry(1, 1, 1, 4, 0.032);

    // Flat countryside grass ground plane (220m x 220m) with PBR Albedo + Normal + Roughness
    const grassPBR = createCountrysideGrassPBR();
    const groundGeo = new THREE.PlaneGeometry(220, 220);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: grassPBR.albedo,
      normalMap: grassPBR.normal,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: grassPBR.roughness,
      roughness: 0.88,
      metalness: 0.01,
    });

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.position.set(0, -0.5, 0);
    this.groundMesh.receiveShadow = true;
    this.groundMesh.name = 'ground';
    this.scene.add(this.groundMesh);
    this.interactables.push(this.groundMesh);

    // Ghost placement indicator
    this.ghostGroup = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    });
    this.ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(1.005, 1.005, 1.005), ghostMat);
    const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01));
    const edgesMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    });
    const wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
    this.ghostGroup.add(this.ghostMesh);
    this.ghostGroup.add(wireframe);
    this.ghostGroup.visible = false;
    this.scene.add(this.ghostGroup);

    this.raycaster.near = 0.1;
    this.raycaster.far = 11.5;

    // Load saved world or starter scene
    if (!this.loadFromLocalStorage()) {
      this.loadPreset(getStarterScene(), false);
    }
  }

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  public hasBrickAt(x: number, y: number, z: number): boolean {
    return this.bricks.has(this.key(Math.round(x), Math.round(y), Math.round(z)));
  }

  public getBrickCount(): number {
    return this.bricks.size;
  }

  public setBrick(x: number, y: number, z: number, type: number, recordHistory = true, spawnParticles = false): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    if (ry < 0 || ry > 120) return false;

    const k = this.key(rx, ry, rz);
    if (this.bricks.has(k)) return false;

    const def = this.catalog.get(type) ?? this.catalog.get(1)!;
    const mesh = new THREE.Mesh(this.brickGeo, def.material);
    mesh.position.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { isBrick: true, x: rx, y: ry, z: rz, type: def.id };

    let light: THREE.PointLight | undefined;
    if (def.isLight) {
      light = new THREE.PointLight(0xfffbeb, 4.2, 11, 1.5);
      light.position.set(rx, ry, rz);
      this.scene.add(light);
    }

    this.scene.add(mesh);
    this.interactables.push(mesh);
    this.bricks.set(k, { mesh, type: def.id, light });

    if (ry === 0) {
      this.countryside?.syncGrassAt(rx, rz, true);
    }

    if (recordHistory) {
      this.undoStack.push({ kind: 'place', entry: { x: rx, y: ry, z: rz, type: def.id } });
      this.redoStack = [];
      this.saveToLocalStorage();
    }

    if (spawnParticles) {
      this.spawnBurst(new THREE.Vector3(rx, ry, rz), 10);
    }

    return true;
  }

  public removeBrick(x: number, y: number, z: number, recordHistory = true, spawnParticles = true): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const k = this.key(rx, ry, rz);
    const existing = this.bricks.get(k);
    if (!existing) return false;

    this.scene.remove(existing.mesh);
    if (existing.light) {
      this.scene.remove(existing.light);
    }
    const idx = this.interactables.indexOf(existing.mesh);
    if (idx !== -1) {
      this.interactables.splice(idx, 1);
    }
    this.bricks.delete(k);

    if (ry === 0) {
      this.countryside?.syncGrassAt(rx, rz, false);
    }

    if (recordHistory) {
      this.undoStack.push({ kind: 'remove', entry: { x: rx, y: ry, z: rz, type: existing.type } });
      this.redoStack = [];
      this.saveToLocalStorage();
    }

    if (spawnParticles) {
      this.spawnBurst(new THREE.Vector3(rx, ry, rz), 18);
    }

    return true;
  }

  public undo(): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;

    if (action.kind === 'place') {
      this.removeBrick(action.entry.x, action.entry.y, action.entry.z, false, true);
    } else {
      this.setBrick(action.entry.x, action.entry.y, action.entry.z, action.entry.type, false, true);
    }
    this.redoStack.push(action);
    this.saveToLocalStorage();
    return true;
  }

  public redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;

    if (action.kind === 'place') {
      this.setBrick(action.entry.x, action.entry.y, action.entry.z, action.entry.type, false, true);
    } else {
      this.removeBrick(action.entry.x, action.entry.y, action.entry.z, false, true);
    }
    this.undoStack.push(action);
    this.saveToLocalStorage();
    return true;
  }

  public clearAll(save = true): void {
    for (const [, item] of this.bricks) {
      this.scene.remove(item.mesh);
      if (item.light) this.scene.remove(item.light);
      const { x, y, z } = item.mesh.userData as BrickEntry;
      if (y === 0) {
        this.countryside?.syncGrassAt(x, z, false);
      }
    }
    this.bricks.clear();
    this.interactables.length = 0;
    this.interactables.push(this.groundMesh);
    this.undoStack = [];
    this.redoStack = [];
    if (save) {
      this.saveToLocalStorage();
    }
  }

  public loadPreset(entries: BrickEntry[], save = true): void {
    this.clearAll(false);
    for (const e of entries) {
      this.setBrick(e.x, e.y, e.z, e.type, false, false);
    }
    if (save) {
      this.saveToLocalStorage();
    }
  }

  public serialize(): BrickEntry[] {
    const list: BrickEntry[] = [];
    for (const [, item] of this.bricks) {
      const { x, y, z, type } = item.mesh.userData as BrickEntry;
      list.push({ x, y, z, type });
    }
    return list;
  }

  public saveToLocalStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
    } catch {
      // Ignore quota errors
    }
  }

  public loadFromLocalStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as BrickEntry[];
      if (!Array.isArray(parsed)) return false;
      this.loadPreset(parsed, false);
      return true;
    } catch {
      return false;
    }
  }

  private spawnBurst(origin: THREE.Vector3, count: number): void {
    const instanced = new THREE.InstancedMesh(this.particleGeo, this.particleMat, count);
    instanced.castShadow = true;
    const velocities: THREE.Vector3[] = [];
    const positions: THREE.Vector3[] = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const pos = origin.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.7,
          (Math.random() - 0.5) * 0.7,
          (Math.random() - 0.5) * 0.7
        )
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3.8,
        Math.random() * 3.6 + 1.0,
        (Math.random() - 0.5) * 3.8
      );
      positions.push(pos);
      velocities.push(vel);
      dummy.position.copy(pos);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }

    this.scene.add(instanced);
    this.bursts.push({
      mesh: instanced,
      velocities,
      positions,
      age: 0,
      maxAge: 0.48,
    });
  }

  public update(dt: number, camera: THREE.Camera): void {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = this.raycaster.intersectObjects(this.interactables, false);

    const hit = hits[0];
    if (hit && hit.face) {
      const normal = hit.face.normal.clone();
      normal.transformDirection(hit.object.matrixWorld).round();

      if (hit.object === this.groundMesh) {
        const px = Math.round(hit.point.x);
        const pz = Math.round(hit.point.z);
        const placePos = new THREE.Vector3(px, 0, pz);
        this.currentTarget = {
          placePos,
          removePos: null,
          hitBrickType: null,
        };
      } else {
        const { x, y, z, type } = hit.object.userData as BrickEntry;
        const removePos = new THREE.Vector3(x, y, z);
        const placePos = removePos.clone().add(normal);
        this.currentTarget = {
          placePos,
          removePos,
          hitBrickType: type,
        };
      }

      this.ghostGroup.position.copy(this.currentTarget.placePos);
      this.ghostGroup.visible = true;
    } else {
      this.currentTarget = null;
      this.ghostGroup.visible = false;
    }

    // Update particle bursts
    const dummy = new THREE.Object3D();
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      if (b.age >= b.maxAge) {
        this.scene.remove(b.mesh);
        b.mesh.dispose();
        this.bursts.splice(i, 1);
        continue;
      }

      const scale = 1 - b.age / b.maxAge;
      for (let j = 0; j < b.positions.length; j++) {
        b.velocities[j].y -= 12.5 * dt;
        b.positions[j].addScaledVector(b.velocities[j], dt);
        dummy.position.copy(b.positions[j]);
        dummy.scale.setScalar(scale);
        dummy.rotation.x += 4 * dt;
        dummy.rotation.y += 5 * dt;
        dummy.updateMatrix();
        b.mesh.setMatrixAt(j, dummy.matrix);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
