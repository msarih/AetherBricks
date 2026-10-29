import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BrickDefinition, createBrickCatalog, createCountrysideGrassPBR } from './Materials';
import { BrickEntry, getStarterScene } from './Presets';
import { CountrysideEnv } from './CountrysideEnv';
import {
  BRICK_TYPE_DOOR_OAK,
  BRICK_TYPE_WINDOW_CROSS,
  BRICK_TYPE_WINDOW_MODERN,
  createCrossWindowGroup,
  createModernWindowGroup,
  createOakDoorGroup,
  isTwoBlocksTall,
} from './ArchitecturalObjects';

interface HistoryAction {
  kind: 'place' | 'remove';
  entry: BrickEntry;
}

interface PlacedItem {
  visualRoot: THREE.Object3D;
  hitProxies: THREE.Mesh[];
  entry: BrickEntry;
  light?: THREE.PointLight;
  doorPivot?: THREE.Group;
}

interface ParticleBurst {
  mesh: THREE.InstancedMesh;
  velocities: THREE.Vector3[];
  positions: THREE.Vector3[];
  age: number;
  maxAge: number;
}

const STORAGE_KEY = 'aetherbricks_world_v2';

export class VoxelWorld {
  public readonly scene: THREE.Scene;
  public readonly catalog: Map<number, BrickDefinition>;
  private readonly brickGeo: THREE.BufferGeometry;
  private readonly proxyBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly proxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly groundMesh: THREE.Mesh;

  // Map from "x,y,z" -> PlacedItem (for 2-block-tall doors, both (x,y,z) and (x,y+1,z) point to the same PlacedItem)
  private readonly bricks = new Map<string, PlacedItem>();
  private readonly uniqueItems = new Set<PlacedItem>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly interactables: THREE.Object3D[] = [];
  private countryside?: CountrysideEnv;

  // Ghost block preview
  private readonly ghostGroup: THREE.Group;
  private readonly ghostBoxMesh: THREE.Mesh;
  private readonly ghostWireframe: THREE.LineSegments;
  public rotationStep = 0; // 0, 1, 2, 3 (90° increments)

  public currentTarget: {
    placePos: THREE.Vector3;
    removePos: THREE.Vector3 | null;
    hitBrickType: number | null;
    isDoorHit: boolean;
    doorIsOpen?: boolean;
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
    this.ghostBoxMesh = new THREE.Mesh(new THREE.BoxGeometry(1.005, 1.005, 1.005), ghostMat);
    const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.01, 1.01, 1.01));
    const edgesMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
    });
    this.ghostWireframe = new THREE.LineSegments(edgesGeo, edgesMat);
    this.ghostGroup.add(this.ghostBoxMesh);
    this.ghostGroup.add(this.ghostWireframe);
    this.ghostGroup.visible = false;
    this.scene.add(this.ghostGroup);

    this.raycaster.near = 0.1;
    this.raycaster.far = 11.5;

    // Load saved world or starter scene
    if (!this.loadFromLocalStorage()) {
      this.loadPreset(getStarterScene(), false);
    }
  }

  public setGhostMode(selectedType: number): void {
    const twoTall = isTwoBlocksTall(selectedType);
    if (twoTall) {
      this.ghostBoxMesh.scale.set(1, 2, 1);
      this.ghostBoxMesh.position.set(0, 0.5, 0);
      this.ghostWireframe.scale.set(1, 2, 1);
      this.ghostWireframe.position.set(0, 0.5, 0);
    } else {
      this.ghostBoxMesh.scale.set(1, 1, 1);
      this.ghostBoxMesh.position.set(0, 0, 0);
      this.ghostWireframe.scale.set(1, 1, 1);
      this.ghostWireframe.position.set(0, 0, 0);
    }
  }

  public rotatePlacement(): number {
    this.rotationStep = (this.rotationStep + 1) % 4;
    return this.rotationStep;
  }

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  /**
   * Utilisé pour les collisions physiques du joueur :
   * Une porte ouverte (`type === 9` et `open === true`) laisse passer le joueur !
   */
  public hasBrickAt(x: number, y: number, z: number): boolean {
    const item = this.bricks.get(this.key(Math.round(x), Math.round(y), Math.round(z)));
    if (!item) return false;
    if (item.entry.type === BRICK_TYPE_DOOR_OAK && item.entry.open) {
      return false;
    }
    return true;
  }

  public getBrickCount(): number {
    return this.uniqueItems.size;
  }

  public setBrick(
    x: number,
    y: number,
    z: number,
    type: number,
    recordHistory = true,
    spawnParticles = false,
    rot = this.rotationStep,
    open = false
  ): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    if (ry < 0 || ry > 120) return false;

    const k1 = this.key(rx, ry, rz);
    if (this.bricks.has(k1)) return false;

    const twoTall = isTwoBlocksTall(type);
    const k2 = this.key(rx, ry + 1, rz);
    if (twoTall && this.bricks.has(k2)) return false;

    const def = this.catalog.get(type) ?? this.catalog.get(1)!;
    const entry: BrickEntry = { x: rx, y: ry, z: rz, type: def.id, rot: rot % 4, open };

    let visualRoot: THREE.Object3D;
    let doorPivot: THREE.Group | undefined;
    const hitProxies: THREE.Mesh[] = [];

    if (def.id === BRICK_TYPE_WINDOW_CROSS) {
      visualRoot = createCrossWindowGroup();
      visualRoot.position.set(rx, ry, rz);
      visualRoot.rotation.y = (entry.rot ?? 0) * (Math.PI / 2);
      this.scene.add(visualRoot);

      const proxy = new THREE.Mesh(this.proxyBoxGeo, this.proxyMat);
      proxy.position.set(rx, ry, rz);
      proxy.userData = { ...entry };
      this.scene.add(proxy);
      this.interactables.push(proxy);
      hitProxies.push(proxy);
    } else if (def.id === BRICK_TYPE_WINDOW_MODERN) {
      visualRoot = createModernWindowGroup();
      visualRoot.position.set(rx, ry, rz);
      visualRoot.rotation.y = (entry.rot ?? 0) * (Math.PI / 2);
      this.scene.add(visualRoot);

      const proxy = new THREE.Mesh(this.proxyBoxGeo, this.proxyMat);
      proxy.position.set(rx, ry, rz);
      proxy.userData = { ...entry };
      this.scene.add(proxy);
      this.interactables.push(proxy);
      hitProxies.push(proxy);
    } else if (def.id === BRICK_TYPE_DOOR_OAK) {
      const doorObj = createOakDoorGroup();
      visualRoot = doorObj.root;
      doorPivot = doorObj.doorPivot;
      if (entry.open) {
        doorPivot.rotation.y = Math.PI * 0.48;
      }
      visualRoot.position.set(rx, ry, rz);
      visualRoot.rotation.y = (entry.rot ?? 0) * (Math.PI / 2);
      this.scene.add(visualRoot);

      // Deux boîtes de sélection (bloc bas ry et bloc haut ry+1)
      const proxyBottom = new THREE.Mesh(this.proxyBoxGeo, this.proxyMat);
      proxyBottom.position.set(rx, ry, rz);
      proxyBottom.userData = { ...entry };

      const proxyTop = new THREE.Mesh(this.proxyBoxGeo, this.proxyMat);
      proxyTop.position.set(rx, ry + 1, rz);
      proxyTop.userData = { ...entry };

      this.scene.add(proxyBottom, proxyTop);
      this.interactables.push(proxyBottom, proxyTop);
      hitProxies.push(proxyBottom, proxyTop);
    } else {
      const mesh = new THREE.Mesh(this.brickGeo, def.material);
      mesh.position.set(rx, ry, rz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { ...entry };
      visualRoot = mesh;
      this.scene.add(mesh);
      this.interactables.push(mesh);
      hitProxies.push(mesh);
    }

    let light: THREE.PointLight | undefined;
    if (def.isLight) {
      light = new THREE.PointLight(0xfffbeb, 4.2, 11, 1.5);
      light.position.set(rx, ry, rz);
      this.scene.add(light);
    }

    const placed: PlacedItem = { visualRoot, hitProxies, entry, light, doorPivot };
    this.uniqueItems.add(placed);
    this.bricks.set(k1, placed);
    if (twoTall) {
      this.bricks.set(k2, placed);
    }

    if (ry === 0) {
      this.countryside?.syncGrassAt(rx, rz, true);
    }

    if (recordHistory) {
      this.undoStack.push({ kind: 'place', entry: { ...entry } });
      this.redoStack = [];
      this.saveToLocalStorage();
    }

    if (spawnParticles) {
      this.spawnBurst(new THREE.Vector3(rx, ry, rz), 10);
    }

    return true;
  }

  public toggleDoorAt(x: number, y: number, z: number): boolean | null {
    const item = this.bricks.get(this.key(Math.round(x), Math.round(y), Math.round(z)));
    if (!item || item.entry.type !== BRICK_TYPE_DOOR_OAK) return null;
    item.entry.open = !item.entry.open;
    this.saveToLocalStorage();
    return item.entry.open;
  }

  public removeBrick(x: number, y: number, z: number, recordHistory = true, spawnParticles = true): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const k = this.key(rx, ry, rz);
    const existing = this.bricks.get(k);
    if (!existing) return false;

    const baseEntry = existing.entry;
    this.scene.remove(existing.visualRoot);
    if (existing.light) {
      this.scene.remove(existing.light);
    }

    for (const proxy of existing.hitProxies) {
      this.scene.remove(proxy);
      const idx = this.interactables.indexOf(proxy);
      if (idx !== -1) {
        this.interactables.splice(idx, 1);
      }
    }

    this.uniqueItems.delete(existing);
    this.bricks.delete(this.key(baseEntry.x, baseEntry.y, baseEntry.z));
    if (isTwoBlocksTall(baseEntry.type)) {
      this.bricks.delete(this.key(baseEntry.x, baseEntry.y + 1, baseEntry.z));
    }

    if (baseEntry.y === 0) {
      this.countryside?.syncGrassAt(baseEntry.x, baseEntry.z, false);
    }

    if (recordHistory) {
      this.undoStack.push({ kind: 'remove', entry: { ...baseEntry } });
      this.redoStack = [];
      this.saveToLocalStorage();
    }

    if (spawnParticles) {
      this.spawnBurst(new THREE.Vector3(baseEntry.x, baseEntry.y, baseEntry.z), 18);
    }

    return true;
  }

  public undo(): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;

    if (action.kind === 'place') {
      this.removeBrick(action.entry.x, action.entry.y, action.entry.z, false, true);
    } else {
      this.setBrick(
        action.entry.x,
        action.entry.y,
        action.entry.z,
        action.entry.type,
        false,
        true,
        action.entry.rot ?? 0,
        action.entry.open ?? false
      );
    }
    this.redoStack.push(action);
    this.saveToLocalStorage();
    return true;
  }

  public redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;

    if (action.kind === 'place') {
      this.setBrick(
        action.entry.x,
        action.entry.y,
        action.entry.z,
        action.entry.type,
        false,
        true,
        action.entry.rot ?? 0,
        action.entry.open ?? false
      );
    } else {
      this.removeBrick(action.entry.x, action.entry.y, action.entry.z, false, true);
    }
    this.undoStack.push(action);
    this.saveToLocalStorage();
    return true;
  }

  public clearAll(save = true): void {
    for (const item of this.uniqueItems) {
      this.scene.remove(item.visualRoot);
      if (item.light) this.scene.remove(item.light);
      for (const proxy of item.hitProxies) {
        this.scene.remove(proxy);
      }
      if (item.entry.y === 0) {
        this.countryside?.syncGrassAt(item.entry.x, item.entry.z, false);
      }
    }
    this.uniqueItems.clear();
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
      this.setBrick(e.x, e.y, e.z, e.type, false, false, e.rot ?? 0, e.open ?? false);
    }
    if (save) {
      this.saveToLocalStorage();
    }
  }

  public serialize(): BrickEntry[] {
    const list: BrickEntry[] = [];
    for (const item of this.uniqueItems) {
      list.push({ ...item.entry });
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

  public update(
    dt: number,
    camera: THREE.Camera,
    aimOrigin?: THREE.Vector3,
    aimDirection?: THREE.Vector3
  ): void {
    // Animate doors smoothly
    for (const item of this.uniqueItems) {
      if (item.doorPivot) {
        const targetAngle = item.entry.open ? Math.PI * 0.48 : 0;
        item.doorPivot.rotation.y = THREE.MathUtils.lerp(
          item.doorPivot.rotation.y,
          targetAngle,
          Math.min(1, dt * 10)
        );
      }
    }

    if (aimOrigin && aimDirection) {
      this.raycaster.set(aimOrigin, aimDirection);
    } else {
      this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    }
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
          isDoorHit: false,
        };
      } else {
        const hitPos = hit.object.position.clone().round();
        const data = hit.object.userData as BrickEntry;
        const removePos = new THREE.Vector3(data.x, data.y, data.z);
        const placePos = hitPos.clone().add(normal);
        const placedItem = this.bricks.get(this.key(data.x, data.y, data.z));
        this.currentTarget = {
          placePos,
          removePos,
          hitBrickType: data.type,
          isDoorHit: data.type === BRICK_TYPE_DOOR_OAK,
          doorIsOpen: placedItem?.entry.open,
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
