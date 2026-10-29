import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BrickDefinition, createBrickCatalog, createCountrysideGrassPBR } from './Materials';
import { BrickEntry, getStarterScene } from './Presets';
import { CountrysideEnv } from './CountrysideEnv';
import {
  BRICK_TYPE_DOOR_OAK,
  BRICK_TYPE_WINDOW_CROSS,
  BRICK_TYPE_WINDOW_FRAMELESS,
  BRICK_TYPE_WINDOW_MODERN,
  OBJ_TYPE_ARCH_WHITE,
  OBJ_TYPE_BALUSTRADE_WHITE,
  OBJ_TYPE_BED,
  OBJ_TYPE_BOOKSHELF,
  OBJ_TYPE_CARPET,
  OBJ_TYPE_CHAIR,
  OBJ_TYPE_CYPRESS,
  OBJ_TYPE_FENCE_OAK,
  OBJ_TYPE_FIREPLACE,
  OBJ_TYPE_GABLE_ROOF,
  OBJ_TYPE_HEDGE,
  OBJ_TYPE_LADDER_OAK,
  OBJ_TYPE_LANTERN_POST,
  OBJ_TYPE_PILLAR_WHITE,
  OBJ_TYPE_PLANTER_BOX,
  OBJ_TYPE_STAIRS_OAK,
  OBJ_TYPE_STAIRS_WHITE,
  OBJ_TYPE_STEPPING_STONE,
  OBJ_TYPE_TABLE,
  OBJ_TYPE_TRIANGLE_OAK,
  OBJ_TYPE_TRIANGLE_WHITE,
  OBJ_TYPE_WATER,
  SLAB_OFFSET_Y,
  SLAB_THICKNESS,
  createArchBlockGroup,
  createBalustradeGroup,
  createBedGroup,
  createBookshelfGroup,
  createCarpetMesh,
  createChairGroup,
  createCrossWindowGroup,
  createCypressGroup,
  createFireplaceGroup,
  createFlatSlabMesh,
  createFramelessWindowGroup,
  createGableRoofMesh,
  createHedgeMesh,
  createLadderGroup,
  createLanternPostGroup,
  createModernWindowGroup,
  createOakDoorGroup,
  createOakFenceGroup,
  createPillarGroup,
  createPlanterBoxGroup,
  createStairsGroup,
  createSteppingStoneMesh,
  createTableGroup,
  createTriangleWedgeMesh,
  createWaterMesh,
  isCarpet,
  isCeilingSlab,
  isChair,
  isFlatSlab,
  isFloorSlab,
  isLadder,
  isStairOrSlope,
  isTwoBlocksTall,
  isWater,
} from './ArchitecturalObjects';

interface HistoryAction {
  kind: 'place' | 'remove';
  entry: BrickEntry;
}

interface PlacedItem {
  slotKey: string;
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

const STORAGE_KEY = 'aetherbricks_world_v3';

export class VoxelWorld {
  public readonly scene: THREE.Scene;
  public readonly catalog: Map<number, BrickDefinition>;
  private readonly brickGeo: THREE.BufferGeometry;
  private readonly proxyBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly proxySlabGeo = new THREE.BoxGeometry(1, SLAB_THICKNESS, 1);
  private readonly proxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly groundMesh: THREE.Mesh;

  // Map from slotKey ("main:x,y,z" | "floor:x,y,z" | "ceil:x,y,z") -> PlacedItem
  private readonly bricks = new Map<string, PlacedItem>();
  private readonly uniqueItems = new Set<PlacedItem>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly interactables: THREE.Object3D[] = [];
  private isDragStrokeActive = false;
  private dragLockedY: number | null = null;
  private countryside?: CountrysideEnv;
  public onWorldChanged?: () => void;

  // Ghost block preview
  private readonly ghostGroup: THREE.Group;
  private readonly ghostBoxMesh: THREE.Mesh;
  private readonly ghostWireframe: THREE.LineSegments;
  public rotationStep = 0; // 0, 1, 2, 3 (90° increments)
  private activeSelectedType = 1;

  public currentTarget: {
    placePos: THREE.Vector3;
    removePos: THREE.Vector3 | null;
    removeType: number | null;
    hitBrickType: number | null;
    isDoorHit: boolean;
    doorIsOpen?: boolean;
  } | null = null;

  // Undo / Redo stacks (chaque étape peut contenir 1 bloc ou tout un tracé en masse)
  private undoStack: HistoryAction[][] = [];
  private redoStack: HistoryAction[][] = [];
  private activeHistoryBatch: HistoryAction[] | null = null;

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

    // Immense prairie infinie (4000m x 4000m) avec PBR Albedo + Normal + Roughness
    const grassPBR = createCountrysideGrassPBR();
    const groundGeo = new THREE.PlaneGeometry(4000, 4000);
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
      opacity: 0.28,
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
    this.raycaster.far = 18.0;

    // Load saved world or starter scene
    if (!this.loadFromLocalStorage()) {
      this.loadPreset(getStarterScene(), false);
    }
  }

  public setGhostMode(selectedType: number): void {
    this.activeSelectedType = selectedType;
    if (isTwoBlocksTall(selectedType)) {
      this.ghostBoxMesh.scale.set(1, 2, 1);
      this.ghostBoxMesh.position.set(0, 0.5, 0);
      this.ghostWireframe.scale.set(1, 2, 1);
      this.ghostWireframe.position.set(0, 0.5, 0);
    } else if (isFloorSlab(selectedType)) {
      this.ghostBoxMesh.scale.set(1, SLAB_THICKNESS, 1);
      this.ghostBoxMesh.position.set(0, -SLAB_OFFSET_Y, 0);
      this.ghostWireframe.scale.set(1, SLAB_THICKNESS, 1);
      this.ghostWireframe.position.set(0, -SLAB_OFFSET_Y, 0);
    } else if (isCeilingSlab(selectedType)) {
      this.ghostBoxMesh.scale.set(1, SLAB_THICKNESS, 1);
      this.ghostBoxMesh.position.set(0, SLAB_OFFSET_Y, 0);
      this.ghostWireframe.scale.set(1, SLAB_THICKNESS, 1);
      this.ghostWireframe.position.set(0, SLAB_OFFSET_Y, 0);
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

  public beginDragStroke(initialPlaneY?: number): void {
    if (initialPlaneY !== undefined) {
      this.isDragStrokeActive = true;
      this.dragLockedY = Math.round(initialPlaneY);
    }
    this.activeHistoryBatch = [];
  }

  public endDragStroke(): void {
    this.isDragStrokeActive = false;
    this.dragLockedY = null;
    if (this.activeHistoryBatch && this.activeHistoryBatch.length > 0) {
      this.undoStack.push(this.activeHistoryBatch);
      this.redoStack = [];
    }
    this.activeHistoryBatch = null;
  }

  private recordHistoryAction(action: HistoryAction): void {
    if (this.activeHistoryBatch) {
      this.activeHistoryBatch.push(action);
    } else {
      this.undoStack.push([action]);
    }
    this.redoStack = [];
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }

  private hasAnyGroundItemAt(x: number, z: number): boolean {
    const rx = Math.round(x);
    const rz = Math.round(z);
    return (
      this.bricks.has(`floor:${rx},0,${rz}`) ||
      this.bricks.has(`main:${rx},0,${rz}`) ||
      this.bricks.has(`ceil:${rx},0,${rz}`)
    );
  }

  /**
   * Clé de stockage séparant :
   * - les dalles de sol ("floor:x,y,z")
   * - les dalles de plafond ("ceil:x,y,z")
   * - les blocs/murs/portes/fenêtres principaux ("main:x,y,z")
   * Ainsi, une dalle de sol ne force JAMAIS une brique posée dessus à flotter à y+1 !
   */
  private slotKeyForType(x: number, y: number, z: number, type: number): string {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    if (isFloorSlab(type)) return `floor:${rx},${ry},${rz}`;
    if (isCeilingSlab(type)) return `ceil:${rx},${ry},${rz}`;
    return `main:${rx},${ry},${rz}`;
  }

  private findAnyItemAt(x: number, y: number, z: number, preferredType?: number | null): PlacedItem | undefined {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    if (preferredType) {
      const exact = this.bricks.get(this.slotKeyForType(rx, ry, rz, preferredType));
      if (exact) return exact;
    }
    return (
      this.bricks.get(`main:${rx},${ry},${rz}`) ||
      this.bricks.get(`ceil:${rx},${ry},${rz}`) ||
      this.bricks.get(`floor:${rx},${ry},${rz}`)
    );
  }

  /**
   * Trace et pose une ligne continue de briques/dalles entre `from` et `to`
   */
  public placeLine(
    from: THREE.Vector3,
    to: THREE.Vector3,
    type: number,
    canPlaceAt: (x: number, y: number, z: number) => boolean
  ): number {
    const x0 = Math.round(from.x);
    const y0 = Math.round(from.y);
    const z0 = Math.round(from.z);
    const x1 = Math.round(to.x);
    const y1 = Math.round(to.y);
    const z1 = Math.round(to.z);

    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));

    if (steps === 0 || steps > 20) {
      if (canPlaceAt(x1, y1, z1) && this.setBrick(x1, y1, z1, type, true, true, this.rotationStep, false)) {
        return 1;
      }
      return 0;
    }

    let placedCount = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.round(x0 + dx * t);
      const cy = Math.round(y0 + dy * t);
      const cz = Math.round(z0 + dz * t);
      if (canPlaceAt(cx, cy, cz)) {
        if (this.setBrick(cx, cy, cz, type, true, i === steps, this.rotationStep, false)) {
          placedCount++;
        }
      }
    }
    return placedCount;
  }

  /**
   * Supprime en masse sur toute la ligne balayée par la souris entre `from` et `to`.
   */
  public removeLine(from: THREE.Vector3, to: THREE.Vector3): number {
    const x0 = Math.round(from.x);
    const y0 = Math.round(from.y);
    const z0 = Math.round(from.z);
    const x1 = Math.round(to.x);
    const y1 = Math.round(to.y);
    const z1 = Math.round(to.z);

    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));

    if (steps === 0 || steps > 20) {
      return this.removeBrick(x1, y1, z1, true, true) ? 1 : 0;
    }

    let removedCount = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.round(x0 + dx * t);
      const cy = Math.round(y0 + dy * t);
      const cz = Math.round(z0 + dz * t);
      if (this.removeBrick(cx, cy, cz, true, i === steps)) {
        removedCount++;
      }
    }
    return removedCount;
  }

  /**
   * Remplissage de boîte (Volume entre deux coins A et B) avec le type choisi
   */
  public fillBox(
    from: THREE.Vector3,
    to: THREE.Vector3,
    type: number,
    canPlaceAt: (x: number, y: number, z: number) => boolean
  ): number {
    const minX = Math.min(Math.round(from.x), Math.round(to.x));
    const maxX = Math.max(Math.round(from.x), Math.round(to.x));
    const minY = Math.max(0, Math.min(Math.round(from.y), Math.round(to.y)));
    const maxY = Math.min(60, Math.max(Math.round(from.y), Math.round(to.y)));
    const minZ = Math.min(Math.round(from.z), Math.round(to.z));
    const maxZ = Math.max(Math.round(from.z), Math.round(to.z));

    const totalVolume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    if (totalVolume > 2500) {
      return 0; // Sécurité de performance
    }

    this.beginDragStroke();
    let count = 0;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (canPlaceAt(x, y, z)) {
            if (this.setBrick(x, y, z, type, true, false, this.rotationStep, false)) {
              count++;
            }
          }
        }
      }
    }
    this.endDragStroke();
    return count;
  }

  /**
   * Suppression de boîte (Volume entre deux coins A et B)
   */
  public clearBox(from: THREE.Vector3, to: THREE.Vector3): number {
    const minX = Math.min(Math.round(from.x), Math.round(to.x));
    const maxX = Math.max(Math.round(from.x), Math.round(to.x));
    const minY = Math.max(0, Math.min(Math.round(from.y), Math.round(to.y)));
    const maxY = Math.min(60, Math.max(Math.round(from.y), Math.round(to.y)));
    const minZ = Math.min(Math.round(from.z), Math.round(to.z));
    const maxZ = Math.max(Math.round(from.z), Math.round(to.z));

    const totalVolume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    if (totalVolume > 2500) {
      return 0;
    }

    this.beginDragStroke();
    let count = 0;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (this.removeBrick(x, y, z, true, false)) {
            count++;
          }
        }
      }
    }
    this.endDragStroke();
    return count;
  }

  /**
   * Utilisé pour les collisions physiques du joueur :
   * Seuls les blocs principaux ("main:x,y,z") fermés bloquent le passage.
   * Les échelles (isLadder) ne bloquent pas l'entrée dans la case afin de permettre de grimper.
   */
  public hasBrickAt(x: number, y: number, z: number): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item = this.bricks.get(`main:${rx},${ry},${rz}`);
    if (!item) return false;
    if (item.entry.type === BRICK_TYPE_DOOR_OAK && item.entry.open) {
      return false;
    }
    if (isLadder(item.entry.type) || isWater(item.entry.type) || isCarpet(item.entry.type)) {
      return false;
    }
    return true;
  }

  public hasWaterAt(x: number, y: number, z: number): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item = this.bricks.get(`main:${rx},${ry},${rz}`);
    return Boolean(item && isWater(item.entry.type));
  }

  public isChairAt(x: number, y: number, z: number): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item = this.bricks.get(`main:${rx},${ry},${rz}`);
    return Boolean(item && isChair(item.entry.type));
  }

  public hasLadderAt(x: number, y: number, z: number): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item = this.bricks.get(`main:${rx},${ry},${rz}`);
    return Boolean(item && isLadder(item.entry.type));
  }

  public hasStairOrSlopeAt(x: number, y: number, z: number): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item = this.bricks.get(`main:${rx},${ry},${rz}`);
    return Boolean(item && isStairOrSlope(item.entry.type));
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

    const k1 = this.slotKeyForType(rx, ry, rz, type);
    if (this.bricks.has(k1)) return false;

    const twoTall = isTwoBlocksTall(type);
    const k2 = `main:${rx},${ry + 1},${rz}`;
    if (twoTall && this.bricks.has(k2)) return false;

    const def = this.catalog.get(type) ?? this.catalog.get(1)!;
    const entry: BrickEntry = { x: rx, y: ry, z: rz, type: def.id, rot: rot % 4, open };

    let visualRoot: THREE.Object3D;
    let doorPivot: THREE.Group | undefined;
    const hitProxies: THREE.Mesh[] = [];

    if (isFlatSlab(def.id)) {
      const slabMesh = createFlatSlabMesh(def.id);
      const yOffset = isFloorSlab(def.id) ? -SLAB_OFFSET_Y : SLAB_OFFSET_Y;
      slabMesh.position.set(rx, ry + yOffset, rz);
      slabMesh.rotation.y = (entry.rot ?? 0) * (Math.PI / 2);
      visualRoot = slabMesh;
      this.scene.add(slabMesh);

      // Boîte de sélection plate (0.16m d'épaisseur seulement !) pour ne JAMAIS intercepter les rayons en l'air
      const proxy = new THREE.Mesh(this.proxySlabGeo, this.proxyMat);
      proxy.position.set(rx, ry + yOffset, rz);
      proxy.userData = { ...entry };
      this.scene.add(proxy);
      this.interactables.push(proxy);
      hitProxies.push(proxy);
    } else if (def.id === BRICK_TYPE_WINDOW_CROSS) {
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
    } else if (def.id === BRICK_TYPE_WINDOW_FRAMELESS) {
      visualRoot = createFramelessWindowGroup();
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

      const proxyBottom = new THREE.Mesh(this.proxyBoxGeo, this.proxyMat);
      proxyBottom.position.set(rx, ry, rz);
      proxyBottom.userData = { ...entry };

      const proxyTop = new THREE.Mesh(this.proxyBoxGeo, this.proxyMat);
      proxyTop.position.set(rx, ry + 1, rz);
      proxyTop.userData = { ...entry };

      this.scene.add(proxyBottom, proxyTop);
      this.interactables.push(proxyBottom, proxyTop);
      hitProxies.push(proxyBottom, proxyTop);
    } else if (
      def.id === OBJ_TYPE_STAIRS_WHITE ||
      def.id === OBJ_TYPE_STAIRS_OAK ||
      def.id === OBJ_TYPE_LADDER_OAK ||
      def.id === OBJ_TYPE_TRIANGLE_WHITE ||
      def.id === OBJ_TYPE_TRIANGLE_OAK ||
      def.id === OBJ_TYPE_GABLE_ROOF ||
      def.id === OBJ_TYPE_PILLAR_WHITE ||
      def.id === OBJ_TYPE_BALUSTRADE_WHITE ||
      def.id === OBJ_TYPE_FENCE_OAK ||
      def.id === OBJ_TYPE_ARCH_WHITE ||
      def.id === OBJ_TYPE_PLANTER_BOX ||
      def.id === OBJ_TYPE_LANTERN_POST ||
      def.id === OBJ_TYPE_TABLE ||
      def.id === OBJ_TYPE_CHAIR ||
      def.id === OBJ_TYPE_BED ||
      def.id === OBJ_TYPE_BOOKSHELF ||
      def.id === OBJ_TYPE_FIREPLACE ||
      def.id === OBJ_TYPE_CARPET ||
      def.id === OBJ_TYPE_WATER ||
      def.id === OBJ_TYPE_STEPPING_STONE ||
      def.id === OBJ_TYPE_HEDGE ||
      def.id === OBJ_TYPE_CYPRESS
    ) {
      switch (def.id) {
        case OBJ_TYPE_STAIRS_WHITE:
          visualRoot = createStairsGroup(false);
          break;
        case OBJ_TYPE_STAIRS_OAK:
          visualRoot = createStairsGroup(true);
          break;
        case OBJ_TYPE_LADDER_OAK:
          visualRoot = createLadderGroup();
          break;
        case OBJ_TYPE_TRIANGLE_WHITE:
          visualRoot = createTriangleWedgeMesh(false);
          break;
        case OBJ_TYPE_TRIANGLE_OAK:
          visualRoot = createTriangleWedgeMesh(true);
          break;
        case OBJ_TYPE_GABLE_ROOF:
          visualRoot = createGableRoofMesh();
          break;
        case OBJ_TYPE_PILLAR_WHITE:
          visualRoot = createPillarGroup();
          break;
        case OBJ_TYPE_BALUSTRADE_WHITE:
          visualRoot = createBalustradeGroup();
          break;
        case OBJ_TYPE_FENCE_OAK:
          visualRoot = createOakFenceGroup();
          break;
        case OBJ_TYPE_ARCH_WHITE:
          visualRoot = createArchBlockGroup();
          break;
        case OBJ_TYPE_PLANTER_BOX:
          visualRoot = createPlanterBoxGroup();
          break;
        case OBJ_TYPE_LANTERN_POST:
          visualRoot = createLanternPostGroup();
          break;
        case OBJ_TYPE_TABLE:
          visualRoot = createTableGroup();
          break;
        case OBJ_TYPE_CHAIR:
          visualRoot = createChairGroup();
          break;
        case OBJ_TYPE_BED:
          visualRoot = createBedGroup();
          break;
        case OBJ_TYPE_BOOKSHELF:
          visualRoot = createBookshelfGroup();
          break;
        case OBJ_TYPE_FIREPLACE:
          visualRoot = createFireplaceGroup();
          break;
        case OBJ_TYPE_CARPET:
          visualRoot = createCarpetMesh();
          break;
        case OBJ_TYPE_WATER:
          visualRoot = createWaterMesh();
          break;
        case OBJ_TYPE_STEPPING_STONE:
          visualRoot = createSteppingStoneMesh();
          break;
        case OBJ_TYPE_HEDGE:
          visualRoot = createHedgeMesh();
          break;
        case OBJ_TYPE_CYPRESS:
        default:
          visualRoot = createCypressGroup();
          break;
      }
      visualRoot.position.set(rx, ry, rz);
      visualRoot.rotation.y = (entry.rot ?? 0) * (Math.PI / 2);
      this.scene.add(visualRoot);

      const proxy = new THREE.Mesh(this.proxyBoxGeo, this.proxyMat);
      proxy.position.set(rx, ry, rz);
      proxy.userData = { ...entry };
      this.scene.add(proxy);
      this.interactables.push(proxy);
      hitProxies.push(proxy);
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
      const lightColor = def.id === OBJ_TYPE_FIREPLACE ? 0xff6600 : 0xfde68a;
      const lightIntensity = def.id === OBJ_TYPE_FIREPLACE ? 1.8 : 1.4;
      light = new THREE.PointLight(lightColor, lightIntensity, 8, 1.8);
      light.position.set(rx, ry, rz);
      this.scene.add(light);
    }

    const placed: PlacedItem = { slotKey: k1, visualRoot, hitProxies, entry, light, doorPivot };
    this.uniqueItems.add(placed);
    this.bricks.set(k1, placed);
    if (twoTall) {
      this.bricks.set(k2, placed);
    }

    if (ry === 0) {
      this.countryside?.syncGrassAt(rx, rz, true);
    }

    if (recordHistory) {
      this.recordHistoryAction({ kind: 'place', entry: { ...entry } });
      this.saveToLocalStorage();
    }

    if (spawnParticles) {
      this.spawnBurst(new THREE.Vector3(rx, ry, rz), 10);
    }

    return true;
  }

  public toggleDoorAt(x: number, y: number, z: number): boolean | null {
    const item = this.bricks.get(`main:${Math.round(x)},${Math.round(y)},${Math.round(z)}`);
    if (!item || item.entry.type !== BRICK_TYPE_DOOR_OAK) return null;
    item.entry.open = !item.entry.open;
    this.saveToLocalStorage();
    return item.entry.open;
  }

  public removeBrick(
    x: number,
    y: number,
    z: number,
    recordHistory = true,
    spawnParticles = true,
    preferredType?: number | null
  ): boolean {
    const existing = this.findAnyItemAt(x, y, z, preferredType);
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
    this.bricks.delete(existing.slotKey);
    if (isTwoBlocksTall(baseEntry.type)) {
      this.bricks.delete(`main:${baseEntry.x},${baseEntry.y + 1},${baseEntry.z}`);
    }

    if (baseEntry.y === 0 && !this.hasAnyGroundItemAt(baseEntry.x, baseEntry.z)) {
      this.countryside?.syncGrassAt(baseEntry.x, baseEntry.z, false);
    }

    if (recordHistory) {
      this.recordHistoryAction({ kind: 'remove', entry: { ...baseEntry } });
      this.saveToLocalStorage();
    }

    if (spawnParticles) {
      this.spawnBurst(new THREE.Vector3(baseEntry.x, baseEntry.y, baseEntry.z), 18);
    }

    return true;
  }

  public undo(): number {
    const batch = this.undoStack.pop();
    if (!batch || batch.length === 0) return 0;

    for (let i = batch.length - 1; i >= 0; i--) {
      const action = batch[i];
      if (action.kind === 'place') {
        this.removeBrick(action.entry.x, action.entry.y, action.entry.z, false, i === 0, action.entry.type);
      } else {
        this.setBrick(
          action.entry.x,
          action.entry.y,
          action.entry.z,
          action.entry.type,
          false,
          i === 0,
          action.entry.rot ?? 0,
          action.entry.open ?? false
        );
      }
    }
    this.redoStack.push(batch);
    this.saveToLocalStorage();
    return batch.length;
  }

  public redo(): number {
    const batch = this.redoStack.pop();
    if (!batch || batch.length === 0) return 0;

    for (let i = 0; i < batch.length; i++) {
      const action = batch[i];
      if (action.kind === 'place') {
        this.setBrick(
          action.entry.x,
          action.entry.y,
          action.entry.z,
          action.entry.type,
          false,
          i === batch.length - 1,
          action.entry.rot ?? 0,
          action.entry.open ?? false
        );
      } else {
        this.removeBrick(
          action.entry.x,
          action.entry.y,
          action.entry.z,
          false,
          i === batch.length - 1,
          action.entry.type
        );
      }
    }
    this.undoStack.push(batch);
    this.saveToLocalStorage();
    return batch.length;
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

  /**
   * Exporte la construction entière au format universel Wavefront (.OBJ)
   * Prêt pour Blender, Maya, Windows 3D Viewer ou impression 3D !
   */
  public exportToOBJ(worldName = 'aetherbricks-monde'): void {
    let objText = `# AetherBricks 3D - Export Wavefront OBJ\n# Monde: ${worldName}\n# Éléments: ${this.uniqueItems.size}\n\n`;

    let vertOffset = 1;
    for (const item of this.uniqueItems) {
      const e = item.entry;
      const def = this.catalog.get(e.type);
      const name = def?.name.replace(/[^a-zA-Z0-9]/g, '_') || `block_${e.type}`;
      objText += `g ${name}_${e.x}_${e.y}_${e.z}\n`;

      const x = e.x;
      const y = e.y;
      const z = e.z;
      const hx = 0.5;
      const hy = isFlatSlab(e.type) ? SLAB_THICKNESS / 2 : 0.5;
      const hz = 0.5;
      const cy = isFloorSlab(e.type) ? y - SLAB_OFFSET_Y : isCeilingSlab(e.type) ? y + SLAB_OFFSET_Y : y;

      objText += `v ${x - hx} ${cy - hy} ${z + hz}\n`;
      objText += `v ${x + hx} ${cy - hy} ${z + hz}\n`;
      objText += `v ${x + hx} ${cy + hy} ${z + hz}\n`;
      objText += `v ${x - hx} ${cy + hy} ${z + hz}\n`;
      objText += `v ${x - hx} ${cy - hy} ${z - hz}\n`;
      objText += `v ${x + hx} ${cy - hy} ${z - hz}\n`;
      objText += `v ${x + hx} ${cy + hy} ${z - hz}\n`;
      objText += `v ${x - hx} ${cy + hy} ${z - hz}\n`;

      objText += `f ${vertOffset} ${vertOffset + 1} ${vertOffset + 2} ${vertOffset + 3}\n`;
      objText += `f ${vertOffset + 5} ${vertOffset + 4} ${vertOffset + 7} ${vertOffset + 6}\n`;
      objText += `f ${vertOffset + 4} ${vertOffset} ${vertOffset + 3} ${vertOffset + 7}\n`;
      objText += `f ${vertOffset + 1} ${vertOffset + 5} ${vertOffset + 6} ${vertOffset + 2}\n`;
      objText += `f ${vertOffset + 3} ${vertOffset + 2} ${vertOffset + 6} ${vertOffset + 7}\n`;
      objText += `f ${vertOffset + 4} ${vertOffset + 5} ${vertOffset + 1} ${vertOffset}\n`;

      vertOffset += 8;
    }

    const blob = new Blob([objText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${worldName}.obj`;
    a.click();
    URL.revokeObjectURL(url);
  }

  public saveToLocalStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
    } catch {
      // Ignore quota errors
    }
    this.onWorldChanged?.();
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
    playerEyePos?: THREE.Vector3,
    enableRaycast = true
  ): void {
    // Recentrage imperceptible du sol selon la position du joueur (monde infini sans couture)
    if (playerEyePos) {
      const tileSize = 4000 / 1182; // ~3.384m
      const snapX = Math.round(playerEyePos.x / tileSize) * tileSize;
      const snapZ = Math.round(playerEyePos.z / tileSize) * tileSize;
      if (
        Math.abs(this.groundMesh.position.x - snapX) > 20 ||
        Math.abs(this.groundMesh.position.z - snapZ) > 20
      ) {
        this.groundMesh.position.x = snapX;
        this.groundMesh.position.z = snapZ;
      }
    }

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

    if (!enableRaycast) {
      this.currentTarget = null;
      this.ghostGroup.visible = false;
      this.updateParticles(dt);
      return;
    }

    // Always cast directly from the camera through the exact center crosshair (0, 0)
    // so there is ZERO parallax discrepancy between what the crosshair points at and what gets hit!
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    // Minimum distance filter so blocks behind the player (between 3rd-person camera and character back) are ignored
    const minValidDist = playerEyePos
      ? Math.max(0.2, camera.position.distanceTo(playerEyePos) - 0.45)
      : 0.2;

    // 1. If we are in a hold-and-drag mass creation stroke, lock strictly onto the horizontal plane y = dragLockedY!
    // This guarantees that sweeping across the ground or a floor NEVER jumps up into the air!
    if (this.isDragStrokeActive && this.dragLockedY !== null) {
      const planeHeightWorld = this.dragLockedY - 0.5;
      const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeightWorld);
      const pt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(dragPlane, pt)) {
        const dist = pt.distanceTo(camera.position);
        if (dist >= minValidDist && dist <= this.raycaster.far) {
          const placePos = new THREE.Vector3(
            Math.round(pt.x),
            this.dragLockedY,
            Math.round(pt.z)
          );
          this.currentTarget = {
            placePos,
            removePos: null,
            removeType: null,
            hitBrickType: null,
            isDoorHit: false,
          };
          this.ghostGroup.position.copy(placePos);
          this.ghostGroup.visible = true;
          this.updateParticles(dt);
          return;
        }
      }
    }

    const rawHits = this.raycaster.intersectObjects(this.interactables, false);
    const hit = rawHits.find((h) => h.distance >= minValidDist);

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
          removeType: null,
          hitBrickType: null,
          isDoorHit: false,
        };
      } else {
        const data = hit.object.userData as BrickEntry;
        const removePos = new THREE.Vector3(data.x, data.y, data.z);
        const placedItem = this.findAnyItemAt(data.x, data.y, data.z, data.type);

        let placePos: THREE.Vector3;

        // Si on pointe sur une dalle de sol (isFloorSlab) :
        // - Si on tient une brique, porte ou fenêtre, on la pose SUR cette dalle au niveau data.y (et NON à data.y + 1 en l'air !)
        // - Si on tient une autre dalle de sol et qu'on vise le dessus de la dalle, on calcule la case du sol directement sous le point précis visé
        if (isFloorSlab(data.type)) {
          if (!isFloorSlab(this.activeSelectedType) && normal.y > 0) {
            placePos = new THREE.Vector3(data.x, data.y, data.z);
          } else {
            placePos = new THREE.Vector3(
              Math.round(hit.point.x + normal.x * 0.5),
              data.y,
              Math.round(hit.point.z + normal.z * 0.5)
            );
          }
        } else if (isCeilingSlab(data.type)) {
          if (isCeilingSlab(this.activeSelectedType)) {
            placePos = new THREE.Vector3(
              Math.round(hit.point.x + normal.x * 0.5),
              data.y,
              Math.round(hit.point.z + normal.z * 0.5)
            );
          } else {
            placePos = new THREE.Vector3(data.x, data.y, data.z).add(normal);
          }
        } else {
          const hitVoxelPos = new THREE.Vector3(
            Math.round(hit.object.position.x),
            Math.round(hit.object.position.y),
            Math.round(hit.object.position.z)
          );
          placePos = hitVoxelPos.add(normal);
        }

        // Sécurité supplémentaire : si le rayon touche la face latérale d'une brique mais très près du sol
        // et que la case (placePos.x, 0, placePos.z) est vide, privilégier le sol (y = 0)
        if (placePos.y > 0 && hit.point.y < -0.15 && !this.hasBrickAt(placePos.x, 0, placePos.z)) {
          placePos.y = 0;
        }

        this.currentTarget = {
          placePos,
          removePos,
          removeType: data.type,
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

    this.updateParticles(dt);
  }

  private updateParticles(dt: number): void {
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
