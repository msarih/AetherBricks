import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  BrickDefinition,
  createBrickCatalog,
  createCountrysideGrassPBR,
  applyPaintToVisual,
  getLocalFaceKey,
  getOrCreatePitMaterial,
} from './Materials';
import { BrickEntry, getStarterScene } from './Presets';
import { CountrysideEnv } from './CountrysideEnv';
import {
  BRICK_TYPE_DIRT,
  BRICK_TYPE_DOOR_OAK,
  BRICK_TYPE_GRASS_BLOCK,
  BRICK_TYPE_STONE,
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
  OBJ_TYPE_CAMPFIRE,
  OBJ_TYPE_FOUNTAIN,
  OBJ_TYPE_FLOWERS,
  OBJ_TYPE_TORCH,
  SLAB_OFFSET_Y,
  SLAB_THICKNESS,
  createArchBlockGroup,
  createBalustradeGroup,
  createBedGroup,
  createBookshelfGroup,
  createCampfireGroup,
  createCarpetMesh,
  createChairGroup,
  createCrossWindowGroup,
  createCypressGroup,
  createFireplaceGroup,
  createFlatSlabMesh,
  createFountainGroup,
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
  createTorchGroup,
  createTriangleWedgeMesh,
  createWaterMesh,
  createWildflowersGroup,
  isBed,
  isCarpet,
  isCeilingSlab,
  isChair,
  isFlatSlab,
  isFloorSlab,
  isLadder,
  isStairOrSlope,
  isSteppingStone,
  isTwoBlocksTall,
  isWater,
  isWildflowers,
} from './ArchitecturalObjects';

interface HistoryAction {
  kind: 'place' | 'remove' | 'paint';
  entry: BrickEntry;
  prevColor?: string;
  prevPattern?: string;
  prevFacePaints?: Record<string, { color: string; pattern: string }>;
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
  private readonly proxyBedGeo = new THREE.BoxGeometry(1.3, 0.8, 1.9);
  private readonly proxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly groundMesh: THREE.Mesh;

  // Système d'excavation de terre (creusement Minecraft avec masque transparent dynamique)
  private readonly maskSize = 512;
  private readonly maskCanvas = document.createElement('canvas');
  private readonly maskCtx: CanvasRenderingContext2D;
  private readonly maskTexture: THREE.CanvasTexture;
  public readonly dugColumns = new Set<string>(); // "x,z"
  public readonly dugVoxels = new Set<string>(); // "x,y,z"
  public readonly pitMeshes = new Map<string, THREE.Mesh>();
  public readonly pitDepths = new Map<string, number>();

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
  private readonly paintGhostPlane: THREE.Mesh;
  private readonly paintGhostMat: THREE.MeshBasicMaterial;
  private isPaintGhostActive = false;
  public rotationStep = 0; // 0, 1, 2, 3 (90° increments)
  private activeSelectedType = 1;

  public currentTarget: {
    placePos: THREE.Vector3;
    removePos: THREE.Vector3 | null;
    removeType: number | null;
    hitBrickType: number | null;
    isDoorHit: boolean;
    doorIsOpen?: boolean;
    normal?: THREE.Vector3;
  } | null = null;

  public lastValidTarget: {
    placePos: THREE.Vector3;
    removePos: THREE.Vector3 | null;
    removeType: number | null;
    hitBrickType: number | null;
    isDoorHit: boolean;
    doorIsOpen?: boolean;
    normal?: THREE.Vector3;
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

    // Clean planar cube geometry (1x1x1) for perfectly flush, smooth and seamless walls
    this.brickGeo = new THREE.BoxGeometry(1, 1, 1);

    // Initialisation du masque de sol pour l'excavation Minecraft
    this.maskCanvas.width = this.maskSize;
    this.maskCanvas.height = this.maskSize;
    this.maskCtx = this.maskCanvas.getContext('2d')!;
    this.maskCtx.fillStyle = '#ffffff';
    this.maskCtx.fillRect(0, 0, this.maskSize, this.maskSize);

    this.maskTexture = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTexture.minFilter = THREE.NearestFilter;
    this.maskTexture.magFilter = THREE.NearestFilter;
    this.maskTexture.flipY = false;

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

    // Shader hook pour découper les trous creusés dans le sol en direct avec alignement exact au voxel
    groundMat.onBeforeCompile = (shader) => {
      shader.uniforms.uHoleMask = { value: this.maskTexture };
      shader.vertexShader = `
        varying vec3 vWorldPos;
        ${shader.vertexShader}
      `.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      );
      shader.fragmentShader = `
        uniform sampler2D uHoleMask;
        varying vec3 vWorldPos;
        ${shader.fragmentShader}
      `.replace(
        '#include <dithering_fragment>',
        `
        #include <dithering_fragment>
        vec2 voxelCoord = floor(vWorldPos.xz + 0.5);
        vec2 maskCoord = (voxelCoord + 256.0 + 0.5) / 512.0;
        if (maskCoord.x >= 0.0 && maskCoord.x <= 1.0 && maskCoord.y >= 0.0 && maskCoord.y <= 1.0) {
          vec4 holeSample = texture2D(uHoleMask, maskCoord);
          if (holeSample.r < 0.5) {
            discard;
          }
        }
        `
      );
    };

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.position.set(0, -0.5, 0);
    this.groundMesh.receiveShadow = true;
    this.groundMesh.name = 'ground';
    this.scene.add(this.groundMesh);
    this.interactables.push(this.groundMesh);
    if (this.countryside) {
      for (const h of this.countryside.hills) {
        this.interactables.push(h.mesh);
      }
    }

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

    // Ghost surface fine de peinture (fine couche sur le mur au lieu d'un cube)
    const paintPlaneGeo = new THREE.PlaneGeometry(1.006, 1.006);
    this.paintGhostMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.paintGhostPlane = new THREE.Mesh(paintPlaneGeo, this.paintGhostMat);
    const planeEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(paintPlaneGeo),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    this.paintGhostPlane.add(planeEdges);
    this.paintGhostPlane.visible = false;
    this.scene.add(this.paintGhostPlane);

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

  public setPaintModeActive(active: boolean, colorHex?: string): void {
    this.isPaintGhostActive = active;
    if (active && colorHex) {
      try {
        this.paintGhostMat.color.setStyle(colorHex);
      } catch {
        this.paintGhostMat.color.setHex(0x38bdf8);
      }
    }
    if (!active) {
      this.paintGhostPlane.visible = false;
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

  public findAnyItemAt(x: number, y: number, z: number, preferredType?: number | null): PlacedItem | undefined {
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

  public setGroundHoleMask(x: number, z: number, isHole: boolean): void {
    const rx = Math.round(x);
    const rz = Math.round(z);
    const px = rx + 256;
    const pz = rz + 256;
    if (px >= 0 && px < this.maskSize && pz >= 0 && pz < this.maskSize) {
      this.maskCtx.fillStyle = isHole ? '#000000' : '#ffffff';
      this.maskCtx.fillRect(px, pz, 1, 1);
      this.maskTexture.needsUpdate = true;
    }
  }

  /**
   * Construit une géométrie de fosse/trou ouverte vers le haut (5 faces intérieures).
   * Découpe des strates géologiques colorées de 1 mètre chacune pour observer visuellement la profondeur !
   * Zéro polygone sur le dessus ou à l'extérieur : aucun conflit avec la prairie environnante !
   */
  private createPitGeometry(
    hasNorth: boolean,
    hasSouth: boolean,
    hasWest: boolean,
    hasEast: boolean,
    floorY: number,
    topY = -0.5
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];

    const depth = Math.max(1, Math.round(topY - floorY));

    // Couleurs géologiques distinctes par niveau de profondeur
    const STRATA_COLORS: THREE.Color[] = [
      new THREE.Color(0x8d5b4c), // Niveau 1 (-1m) : Humus & Terreau fertile brun chaud
      new THREE.Color(0xd97706), // Niveau 2 (-2m) : Argile ocre dorée
      new THREE.Color(0xe2d9c8), // Niveau 3 (-3m) : Calcaire & Grès sédimentaire clair
      new THREE.Color(0x64748b), // Niveau 4 (-4m) : Granit gris & Ardoise minérale
      new THREE.Color(0xb45309), // Niveau 5 (-5m) : Basalte volcanique & Veine d'or
      new THREE.Color(0x7c3aed), // Niveau 6+ (-6m et +) : Abysse tellurique & Cristaux d'Améthyste luminescents
    ];

    const getStrataColor = (step: number): THREE.Color => {
      const idx = Math.min(step, STRATA_COLORS.length - 1);
      return STRATA_COLORS[idx];
    };

    // 1. Fond horizontal du trou au niveau floorY (tourné vers le haut : normal 0, 1, 0)
    positions.push(
      -0.5, floorY, -0.5,
      -0.5, floorY,  0.5,
       0.5, floorY,  0.5,
      -0.5, floorY, -0.5,
       0.5, floorY,  0.5,
       0.5, floorY, -0.5
    );
    for (let i = 0; i < 6; i++) normals.push(0, 1, 0);
    uvs.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
    const bottomColor = getStrataColor(depth - 1);
    for (let i = 0; i < 6; i++) {
      colors.push(bottomColor.r, bottomColor.g, bottomColor.b);
    }

    // Helper pour pousser un rectangle vertical (paroi de 1m) avec sa couleur de strate géologique
    const pushQuad = (
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
      p4: [number, number, number],
      norm: [number, number, number],
      col: THREE.Color
    ) => {
      // 2 triangles : p1-p2-p3 et p1-p3-p4
      positions.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
      for (let i = 0; i < 6; i++) {
        normals.push(...norm);
        colors.push(col.r, col.g, col.b);
      }
      uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    };

    // Découpage en strates verticales de 1 mètre pour chaque paroi visible
    for (let step = 0; step < depth; step++) {
      const segTop = topY - step;
      const segBottom = topY - (step + 1);
      const col = getStrataColor(step);

      // 2. Paroi Nord (z = -0.5) tournée vers l'intérieur (+Z)
      if (hasNorth) {
        pushQuad(
          [-0.5, segBottom, -0.5],
          [ 0.5, segBottom, -0.5],
          [ 0.5, segTop,    -0.5],
          [-0.5, segTop,    -0.5],
          [0, 0, 1],
          col
        );
      }

      // 3. Paroi Sud (z = 0.5) tournée vers l'intérieur (-Z)
      if (hasSouth) {
        pushQuad(
          [ 0.5, segBottom,  0.5],
          [-0.5, segBottom,  0.5],
          [-0.5, segTop,     0.5],
          [ 0.5, segTop,     0.5],
          [0, 0, -1],
          col
        );
      }

      // 4. Paroi Ouest (x = -0.5) tournée vers l'intérieur (+X)
      if (hasWest) {
        pushQuad(
          [-0.5, segBottom,  0.5],
          [-0.5, segBottom, -0.5],
          [-0.5, segTop,   -0.5],
          [-0.5, segTop,     0.5],
          [1, 0, 0],
          col
        );
      }

      // 5. Paroi Est (x = 0.5) tournée vers l'intérieur (-X)
      if (hasEast) {
        pushQuad(
          [ 0.5, segBottom, -0.5],
          [ 0.5, segBottom,  0.5],
          [ 0.5, segTop,     0.5],
          [ 0.5, segTop,    -0.5],
          [-1, 0, 0],
          col
        );
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }

  public updatePitMeshAt(rx: number, rz: number): void {
    const key = `${rx},${rz}`;
    const oldMesh = this.pitMeshes.get(key);
    if (oldMesh) {
      this.scene.remove(oldMesh);
      oldMesh.geometry.dispose();
      const idx = this.interactables.indexOf(oldMesh);
      if (idx !== -1) this.interactables.splice(idx, 1);
      this.pitMeshes.delete(key);
    }

    if (!this.dugColumns.has(key)) {
      this.pitDepths.delete(key);
      return;
    }

    const depth = this.pitDepths.get(key) ?? 1;
    const floorY = -0.5 - depth;
    const topY = -0.5;

    const hasNorth = !this.dugColumns.has(`${rx},${rz - 1}`);
    const hasSouth = !this.dugColumns.has(`${rx},${rz + 1}`);
    const hasWest  = !this.dugColumns.has(`${rx - 1},${rz}`);
    const hasEast  = !this.dugColumns.has(`${rx + 1},${rz}`);

    const geo = this.createPitGeometry(hasNorth, hasSouth, hasWest, hasEast, floorY, topY);
    const mat = getOrCreatePitMaterial();

    const pitMesh = new THREE.Mesh(geo, mat);
    pitMesh.position.set(rx, 0, rz);
    pitMesh.receiveShadow = true;
    pitMesh.castShadow = false;
    pitMesh.userData = { x: rx, y: -depth, z: rz, type: BRICK_TYPE_DIRT, isPit: true };

    this.scene.add(pitMesh);
    this.pitMeshes.set(key, pitMesh);
    this.interactables.push(pitMesh);
  }

  public updatePitNeighborhood(rx: number, rz: number): void {
    this.updatePitMeshAt(rx, rz);
    this.updatePitMeshAt(rx + 1, rz);
    this.updatePitMeshAt(rx - 1, rz);
    this.updatePitMeshAt(rx, rz + 1);
    this.updatePitMeshAt(rx, rz - 1);
  }

  /**
   * Creuse la terre naturelle comme dans Minecraft.
   * Découpe un trou net dans la prairie et matérialise une fosse en terre/roche avec parois intérieures.
   */
  public digGroundAt(x: number, y: number, z: number): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const colKey = `${rx},${rz}`;

    if (ry >= 0) {
      if (this.dugColumns.has(colKey)) {
        // Déjà creusé en surface, creuse un niveau de plus en profondeur
        const curDepth = this.pitDepths.get(colKey) ?? 1;
        this.pitDepths.set(colKey, curDepth + 1);
        this.dugVoxels.add(`${rx},-${curDepth + 1},${rz}`);
      } else {
        this.dugColumns.add(colKey);
        this.dugVoxels.add(`${rx},-1,${rz}`);
        this.pitDepths.set(colKey, 1);
        this.setGroundHoleMask(rx, rz, true);
        this.countryside?.syncGrassAt(rx, rz, true);
      }
    } else {
      const curDepth = this.pitDepths.get(colKey) ?? Math.max(1, Math.abs(ry));
      this.pitDepths.set(colKey, curDepth + 1);
      this.dugVoxels.add(`${rx},-${curDepth + 1},${rz}`);
    }

    this.updatePitNeighborhood(rx, rz);

    this.spawnBurst(new THREE.Vector3(rx, -0.5, rz), 18);
    this.recordHistoryAction({
      kind: 'remove',
      entry: { x: rx, y: ry, z: rz, type: BRICK_TYPE_DIRT },
    });

    this.saveToLocalStorage();
    this.onWorldChanged?.();
    return true;
  }

  /**
   * Peint un mur ou élément avec une couleur et un motif décoratif.
   * Si hitNormal est fourni, seule la face visée (ex: face intérieure du mur) est peinte !
   */
  public paintBrickAt(
    x: number,
    y: number,
    z: number,
    color: string,
    pattern = 'plain',
    hitNormal?: THREE.Vector3,
    recordHistory = true
  ): boolean {
    const item = this.findAnyItemAt(x, y, z);
    if (!item) return false;

    const prevColor = item.entry.color;
    const prevPattern = item.entry.pattern;
    const prevFacePaints = item.entry.facePaints ? JSON.parse(JSON.stringify(item.entry.facePaints)) : undefined;

    item.entry.color = color;
    item.entry.pattern = pattern;

    if (hitNormal) {
      const rotRad = (item.entry.rot ?? 0) * (Math.PI / 2);
      const faceKey = getLocalFaceKey(hitNormal, rotRad);
      if (!item.entry.facePaints) item.entry.facePaints = {};
      item.entry.facePaints[faceKey] = { color, pattern };
    }

    const def = this.catalog.get(item.entry.type);
    applyPaintToVisual(item.visualRoot, color, pattern, def?.material, item.entry.facePaints);

    if (recordHistory) {
      this.recordHistoryAction({
        kind: 'paint',
        entry: { ...item.entry },
        prevColor,
        prevPattern,
        prevFacePaints,
      });
      this.saveToLocalStorage();
    }

    this.onWorldChanged?.();
    return true;
  }

  /**
   * Effectue un lancer de rayon depuis les coordonnées 2D de la souris (utile en Mode Navigation)
   */
  public raycastFromMouse(
    normalizedMouse: THREE.Vector2,
    camera: THREE.Camera
  ): {
    placePos: THREE.Vector3;
    removePos: THREE.Vector3 | null;
    removeType: number | null;
    hitBrickType: number | null;
    normal?: THREE.Vector3;
  } | null {
    const picker = new THREE.Raycaster();
    picker.setFromCamera(normalizedMouse, camera);
    const rawHits = picker.intersectObjects(this.interactables, false);
    for (const hit of rawHits) {
      if (hit.distance < 0.2) continue;
      if (hit.object === this.groundMesh) {
        const px = Math.round(hit.point.x);
        const pz = Math.round(hit.point.z);
        if (this.dugColumns.has(`${px},${pz}`)) continue;
        return {
          placePos: new THREE.Vector3(px, Math.max(0, Math.round(hit.point.y)), pz),
          removePos: new THREE.Vector3(px, Math.max(0, Math.round(hit.point.y)), pz),
          removeType: BRICK_TYPE_DIRT,
          hitBrickType: BRICK_TYPE_GRASS_BLOCK,
          normal: hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0),
        };
      }
      if (hit.object.userData && hit.object.userData.isHill) {
        const px = Math.round(hit.point.x);
        const py = Math.max(0, Math.round(hit.point.y));
        const pz = Math.round(hit.point.z);
        return {
          placePos: new THREE.Vector3(px, py, pz),
          removePos: new THREE.Vector3(px, py, pz),
          removeType: BRICK_TYPE_DIRT,
          hitBrickType: BRICK_TYPE_GRASS_BLOCK,
          normal: hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0),
        };
      }
      const data = hit.object.userData as BrickEntry;
      return {
        placePos: new THREE.Vector3(data.x, data.y, data.z),
        removePos: new THREE.Vector3(data.x, data.y, data.z),
        removeType: data.type,
        hitBrickType: data.type,
        normal: hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0),
      };
    }
    return null;
  }

  /**
   * Utilisé pour les collisions physiques du joueur :
   * Seuls les blocs principaux ("main:x,y,z") fermés bloquent le passage.
   * Les échelles (isLadder) ne bloquent pas l'entrée dans la case afin de permettre de grimper.
   */
  public getTerrainHeightAt(x: number, z: number): number {
    const rx = Math.round(x);
    const rz = Math.round(z);
    if (this.dugColumns.has(`${rx},${rz}`)) {
      for (let y = 0; y >= -25; y--) {
        if (this.hasBrickAt(rx, y, rz)) {
          return y + 0.5;
        }
      }
      const depth = this.pitDepths.get(`${rx},${rz}`) ?? 1;
      return -0.5 - depth;
    }
    return this.countryside ? this.countryside.getTerrainHeight(x, z) : -0.5;
  }

  public hasObstacleAt(pos: THREE.Vector3, radius: number, height: number): boolean {
    return this.countryside ? this.countryside.hasObstacleAt(pos, radius, height) : false;
  }

  public getGroundHeight(x: number, z: number, maxFeetY: number): number {
    let highest = this.getTerrainHeightAt(x, z);

    const rx = Math.round(x);
    const rz = Math.round(z);

    const startY = Math.min(30, Math.floor(maxFeetY + 1.2));
    const endY = Math.max(-25, Math.floor(highest - 0.5));

    for (let y = startY; y >= endY; y--) {
      // 1. Dalle de plafond à y : surface supérieure solide à y + 0.50
      const ceilItem = this.bricks.get(`ceil:${rx},${y},${rz}`);
      if (ceilItem) {
        const topY = y + 0.50;
        if (topY <= maxFeetY + 0.65 && topY > highest) {
          highest = topY;
        }
      }

      // 2. Bloc principal, toiture ou triangle à y : surface supérieure solide à y + 0.50
      const mainItem = this.bricks.get(`main:${rx},${y},${rz}`);
      if (mainItem) {
        const t = mainItem.entry.type;
        if (
          !isWater(t) &&
          !isLadder(t) &&
          !isWildflowers(t) &&
          !(t === BRICK_TYPE_DOOR_OAK && mainItem.entry.open)
        ) {
          const topY = y + 0.50;
          if (topY <= maxFeetY + 0.65 && topY > highest) {
            highest = topY;
          }
        }
      }

      // 3. Dalle de sol à y : surface supérieure à y - 0.34
      const floorItem = this.bricks.get(`floor:${rx},${y},${rz}`);
      if (floorItem) {
        const topY = y - 0.34;
        if (topY <= maxFeetY + 0.65 && topY > highest) {
          highest = topY;
        }
      }
    }

    return highest;
  }

  public checkSolidCollision(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number
  ): boolean {
    const minCellX = Math.floor(minX + 0.5);
    const maxCellX = Math.floor(maxX + 0.5);
    const minCellY = Math.floor(minY + 0.5);
    const maxCellY = Math.floor(maxY + 0.5);
    const minCellZ = Math.floor(minZ + 0.5);
    const maxCellZ = Math.floor(maxZ + 0.5);

    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        for (let z = minCellZ; z <= maxCellZ; z++) {
          // 1. Plafonds (dalles de plafond posées en haut de la case : [y + 0.34, y + 0.50])
          // Empêche la tête de traverser le plafond par en-dessous.
          // Si le joueur marche au-dessus du plafond (ses pieds sont au niveau y + 0.50 ou plus), le plafond ne bloque pas ses déplacements horizontaux !
          const ceilItem = this.bricks.get(`ceil:${x},${y},${z}`);
          if (ceilItem) {
            const cMinY = y + 0.34;
            if (maxY > cMinY && minY < cMinY + 0.05) {
              if (maxX > x - 0.5 && minX < x + 0.5 && maxZ > z - 0.5 && minZ < z + 0.5) {
                return true;
              }
            }
          }

          // Note : Les dalles de sol ("floor:x,y,z") ne sont JAMAIS des obstacles bloquants horizontaux !
          // Ce sont des revêtements de sol minces (16cm) sur lesquels le personnage marche directement via getGroundHeight.

          // 2. Blocs principaux ("main:x,y,z") : briques, toitures, triangles, piliers, etc.
          const mainItem = this.bricks.get(`main:${x},${y},${z}`);
          if (mainItem) {
            const t = mainItem.entry.type;
            if (
              (t === BRICK_TYPE_DOOR_OAK && mainItem.entry.open) ||
              isLadder(t) ||
              isWater(t) ||
              isCarpet(t) ||
              isSteppingStone(t) ||
              isWildflowers(t)
            ) {
              continue;
            }

            const bMinY = y - 0.50;
            const bMaxY = y + 0.50;
            // Pour être un obstacle solide bloquant le passage horizontal,
            // le sommet du bloc doit être nettement au-dessus des pieds (au moins 0.40m au-dessus de minY),
            // afin de ne pas bloquer le joueur qui marche sur une surface de blocs ou qui franchit une marche.
            if (maxY > bMinY && bMaxY > minY + 0.40) {
              if (maxX > x - 0.5 && minX < x + 0.5 && maxZ > z - 0.5 && minZ < z + 0.5) {
                return true;
              }
            }
          }
        }
      }
    }
    return false;
  }

  public hasBrickAt(x: number, y: number, z: number): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item =
      this.bricks.get(`main:${rx},${ry},${rz}`) ||
      this.bricks.get(`ceil:${rx},${ry},${rz}`) ||
      this.bricks.get(`floor:${rx},${ry},${rz}`);
    if (!item) return false;
    if (item.entry.type === BRICK_TYPE_DOOR_OAK && item.entry.open) {
      return false;
    }
    if (
      isLadder(item.entry.type) ||
      isWater(item.entry.type) ||
      isCarpet(item.entry.type) ||
      isSteppingStone(item.entry.type) ||
      isWildflowers(item.entry.type)
    ) {
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
    const item = this.findAnyItemAt(rx, ry, rz, OBJ_TYPE_CHAIR);
    return Boolean(item && isChair(item.entry.type));
  }

  public getChairRotation(x: number, y: number, z: number): number {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item = this.findAnyItemAt(rx, ry, rz, OBJ_TYPE_CHAIR);
    return item?.entry.rot ?? 0;
  }

  public isBedAt(x: number, y: number, z: number): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item = this.findAnyItemAt(rx, ry, rz, OBJ_TYPE_BED);
    return Boolean(item && isBed(item.entry.type));
  }

  public getBedRotation(x: number, y: number, z: number): number {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    const item = this.findAnyItemAt(rx, ry, rz, OBJ_TYPE_BED);
    return item?.entry.rot ?? 0;
  }

  /**
   * Trouve le fauteuil face auquel se trouve le joueur.
   * Ne propose de s'asseoir QUE si le joueur est EN FACE du fauteuil (pas derrière le dossier).
   */
  public getFacingChair(
    playerPos: THREE.Vector3,
    aimDir: THREE.Vector3,
    maxDist = 2.2
  ): THREE.Vector3 | null {
    let bestChair: THREE.Vector3 | null = null;
    let bestScore = -1;

    for (const item of this.uniqueItems) {
      if (isChair(item.entry.type)) {
        const cx = item.entry.x;
        const cy = item.entry.y;
        const cz = item.entry.z;

        const dx = cx - playerPos.x;
        const dy = (cy + 0.1) - playerPos.y;
        const dz = cz - playerPos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > maxDist) continue;

        // Le joueur doit regarder en direction du fauteuil
        const toChair = new THREE.Vector3(dx, dy, dz).normalize();
        const lookDot = aimDir.dot(toChair);
        if (lookDot < 0.45) continue;

        // Le joueur doit se situer du côté de l'assise (devant le fauteuil), JAMAIS derrière le dossier !
        const chairRot = item.entry.rot ?? 0;
        const chairYaw = chairRot * (Math.PI / 2);
        // L'avant de la chaise pointe vers (0, 0, -1) tourné de chairYaw
        const chairFront = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), chairYaw);

        const chairToPlayer = new THREE.Vector3(playerPos.x - cx, 0, playerPos.z - cz).normalize();
        const frontDot = chairToPlayer.dot(chairFront);

        // Si le joueur est derrière le dossier (frontDot < 0.1), NE PAS proposer de s'asseoir
        if (frontDot < 0.1) continue;

        const score = lookDot * 2.0 + frontDot * 1.5 - dist;
        if (score > bestScore) {
          bestScore = score;
          bestChair = new THREE.Vector3(cx, cy, cz);
        }
      }
    }
    return bestChair;
  }

  /**
   * Trouve le lit face auquel se trouve le joueur.
   * Ne propose de dormir QUE si le joueur regarde le lit et n'est pas bloqué derrière la tête de lit.
   */
  public getFacingBed(
    playerPos: THREE.Vector3,
    aimDir: THREE.Vector3,
    maxDist = 2.5
  ): THREE.Vector3 | null {
    let bestBed: THREE.Vector3 | null = null;
    let bestScore = -1;

    for (const item of this.uniqueItems) {
      if (isBed(item.entry.type)) {
        const bx = item.entry.x;
        const by = item.entry.y;
        const bz = item.entry.z;

        const dx = bx - playerPos.x;
        const dy = (by + 0.1) - playerPos.y;
        const dz = bz - playerPos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > maxDist) continue;

        // Le joueur doit regarder en direction du lit
        const toBed = new THREE.Vector3(dx, dy, dz).normalize();
        const lookDot = aimDir.dot(toBed);
        if (lookDot < 0.4) continue;

        // Ne pas proposer si le joueur est derrière la tête de lit (+Z local)
        const bedRot = item.entry.rot ?? 0;
        const bedYaw = bedRot * (Math.PI / 2);
        const headboardDir = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), bedYaw);

        const bedToPlayer = new THREE.Vector3(playerPos.x - bx, 0, playerPos.z - bz);
        const headDot = bedToPlayer.dot(headboardDir);
        if (headDot > 0.75) continue; // Derrière la tête de lit

        const score = lookDot * 2.0 - dist;
        if (score > bestScore) {
          bestScore = score;
          bestBed = new THREE.Vector3(bx, by, bz);
        }
      }
    }
    return bestBed;
  }

  public getNearbyChair(playerPos: THREE.Vector3, maxDist = 2.2): THREE.Vector3 | null {
    return this.getFacingChair(playerPos, new THREE.Vector3(0, 0, -1), maxDist);
  }

  public getNearbyBed(playerPos: THREE.Vector3, maxDist = 2.5): THREE.Vector3 | null {
    return this.getFacingBed(playerPos, new THREE.Vector3(0, 0, -1), maxDist);
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

  public checkNearbyEnvironment(
    pos: THREE.Vector3,
    radius: number = 7
  ): { nearFire: boolean; nearWater: boolean } {
    let nearFire = false;
    let nearWater = false;
    const r2 = radius * radius;
    const px = pos.x;
    const py = pos.y;
    const pz = pos.z;

    for (const item of this.bricks.values()) {
      const e = item.entry;
      const dx = e.x - px;
      const dy = e.y - py;
      const dz = e.z - pz;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq <= r2) {
        const t = e.type;
        if (t === OBJ_TYPE_CAMPFIRE || t === OBJ_TYPE_FIREPLACE || t === OBJ_TYPE_TORCH) {
          nearFire = true;
        }
        if (t === OBJ_TYPE_WATER || t === OBJ_TYPE_FOUNTAIN) {
          nearWater = true;
        }
        if (nearFire && nearWater) break;
      }
    }
    return { nearFire, nearWater };
  }

  public getFireEmitters(playerPos: THREE.Vector3, maxDist: number = 50): THREE.Vector3[] {
    const emitters: THREE.Vector3[] = [];
    const maxScanDistSq = maxDist * maxDist;
    const px = playerPos.x;
    const pz = playerPos.z;

    for (const item of this.bricks.values()) {
      const e = item.entry;
      const t = e.type;
      if (t === OBJ_TYPE_CAMPFIRE || t === OBJ_TYPE_FIREPLACE || t === OBJ_TYPE_TORCH) {
        const dx = e.x - px;
        const dz = e.z - pz;
        if (dx * dx + dz * dz < maxScanDistSq) {
          const spawnY = t === OBJ_TYPE_FIREPLACE ? e.y + 1.2 : e.y + 0.35;
          emitters.push(new THREE.Vector3(e.x, spawnY, e.z));
        }
      }
    }
    return emitters;
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
    open = false,
    color?: string,
    pattern?: string,
    facePaints?: Record<string, { color: string; pattern: string }>
  ): boolean {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const rz = Math.round(z);
    if (ry < -32 || ry > 120) return false;

    // Si on rebouche un trou de surface (bloc posé à y = 0 ou y = -1, hors échelle)
    if (this.dugColumns.has(`${rx},${rz}`) && ry >= -1 && !isLadder(type)) {
      this.dugColumns.delete(`${rx},${rz}`);
      this.setGroundHoleMask(rx, rz, false);
      this.countryside?.syncGrassAt(rx, rz, false);
      this.updatePitNeighborhood(rx, rz);
    }

    const k1 = this.slotKeyForType(rx, ry, rz, type);
    if (this.bricks.has(k1)) return false;

    const twoTall = isTwoBlocksTall(type);
    const k2 = `main:${rx},${ry + 1},${rz}`;
    if (twoTall && this.bricks.has(k2)) return false;

    const def = this.catalog.get(type) ?? this.catalog.get(1)!;
    const entry: BrickEntry = { x: rx, y: ry, z: rz, type: def.id, rot: rot % 4, open, color, pattern, facePaints };

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

      // Si un tapis est déjà posé sur cette case, ajuster sa hauteur pour qu'il repose parfaitement sur la dalle
      if (isFloorSlab(def.id)) {
        const existingMain = this.bricks.get(`main:${rx},${ry},${rz}`);
        if (existingMain && existingMain.entry.type === OBJ_TYPE_CARPET) {
          existingMain.visualRoot.position.y = ry - 0.34 + 0.013;
        }
      }

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
      def.id === OBJ_TYPE_CYPRESS ||
      def.id === OBJ_TYPE_CAMPFIRE ||
      def.id === OBJ_TYPE_FOUNTAIN ||
      def.id === OBJ_TYPE_FLOWERS ||
      def.id === OBJ_TYPE_TORCH
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
          visualRoot = createCypressGroup();
          break;
        case OBJ_TYPE_CAMPFIRE:
          visualRoot = createCampfireGroup();
          break;
        case OBJ_TYPE_FOUNTAIN:
          visualRoot = createFountainGroup();
          break;
        case OBJ_TYPE_FLOWERS:
          visualRoot = createWildflowersGroup();
          break;
        case OBJ_TYPE_TORCH:
          visualRoot = createTorchGroup();
          break;
        default:
          visualRoot = createCypressGroup();
          break;
      }
      if (def.id === OBJ_TYPE_CARPET) {
        const hasFloor = this.bricks.has(`floor:${rx},${ry},${rz}`);
        const carpetY = hasFloor ? ry - 0.34 + 0.013 : ry - 0.50 + 0.013;
        visualRoot.position.set(rx, carpetY, rz);
      } else {
        visualRoot.position.set(rx, ry, rz);
      }
      visualRoot.rotation.y = (entry.rot ?? 0) * (Math.PI / 2);
      this.scene.add(visualRoot);

      const isBedObj = def.id === OBJ_TYPE_BED;
      const proxy = new THREE.Mesh(isBedObj ? this.proxyBedGeo : this.proxyBoxGeo, this.proxyMat);
      proxy.position.set(rx, ry, rz);
      if (isBedObj) {
        proxy.rotation.y = (entry.rot ?? 0) * (Math.PI / 2);
      }
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

    if (color || pattern || facePaints) {
      applyPaintToVisual(visualRoot, color ?? '#f8fafc', pattern ?? 'plain', def.material, entry.facePaints);
    }

    const placed: PlacedItem = { slotKey: k1, visualRoot, hitProxies, entry, light, doorPivot };
    this.uniqueItems.add(placed);
    this.bricks.set(k1, placed);
    if (twoTall) {
      this.bricks.set(k2, placed);
    }

    if (ry >= 0 && this.dugColumns.has(`${rx},${rz}`)) {
      this.dugColumns.delete(`${rx},${rz}`);
      this.setGroundHoleMask(rx, rz, false);
    }
    this.dugVoxels.delete(`${rx},${ry},${rz}`);

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
    if (!existing) {
      // Si aucun bloc n'est posé et qu'on vise le sol ou sous-sol, on creuse la terre (comme Minecraft !)
      if (Math.round(y) <= 0) {
        return this.digGroundAt(x, y, z);
      }
      return false;
    }

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

    if (isFloorSlab(baseEntry.type)) {
      const existingMain = this.bricks.get(`main:${baseEntry.x},${baseEntry.y},${baseEntry.z}`);
      if (existingMain && existingMain.entry.type === OBJ_TYPE_CARPET) {
        existingMain.visualRoot.position.y = baseEntry.y - 0.50 + 0.013;
      }
    }

    if (baseEntry.y < 0) {
      this.dugVoxels.add(`${baseEntry.x},${baseEntry.y},${baseEntry.z}`);
      // Si on creuse la terre au fond du trou (ex: bloc de sol à y <= -2), creuser plus profond !
      if (!this.hasBrickAt(baseEntry.x, baseEntry.y - 1, baseEntry.z)) {
        this.digGroundAt(baseEntry.x, baseEntry.y, baseEntry.z);
      }
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
      } else if (action.kind === 'remove') {
        this.setBrick(
          action.entry.x,
          action.entry.y,
          action.entry.z,
          action.entry.type,
          false,
          i === 0,
          action.entry.rot ?? 0,
          action.entry.open ?? false,
          action.entry.color,
          action.entry.pattern,
          action.entry.facePaints
        );
      } else if (action.kind === 'paint') {
        const it = this.findAnyItemAt(action.entry.x, action.entry.y, action.entry.z);
        if (it) {
          it.entry.facePaints = action.prevFacePaints ? { ...action.prevFacePaints } : undefined;
          if (action.prevColor) {
            it.entry.color = action.prevColor;
            it.entry.pattern = action.prevPattern ?? 'plain';
          } else {
            delete it.entry.color;
            delete it.entry.pattern;
          }
          const def = this.catalog.get(it.entry.type);
          applyPaintToVisual(
            it.visualRoot,
            it.entry.color ?? '#f8fafc',
            it.entry.pattern ?? 'plain',
            def?.material,
            it.entry.facePaints
          );
        }
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
          action.entry.open ?? false,
          action.entry.color,
          action.entry.pattern,
          action.entry.facePaints
        );
      } else if (action.kind === 'remove') {
        this.removeBrick(
          action.entry.x,
          action.entry.y,
          action.entry.z,
          false,
          i === batch.length - 1,
          action.entry.type
        );
      } else if (action.kind === 'paint') {
        const it = this.findAnyItemAt(action.entry.x, action.entry.y, action.entry.z);
        if (it) {
          it.entry.facePaints = action.entry.facePaints ? { ...action.entry.facePaints } : undefined;
          it.entry.color = action.entry.color;
          it.entry.pattern = action.entry.pattern;
          const def = this.catalog.get(it.entry.type);
          applyPaintToVisual(
            it.visualRoot,
            it.entry.color ?? '#f8fafc',
            it.entry.pattern ?? 'plain',
            def?.material,
            it.entry.facePaints
          );
        }
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
    for (const [, mesh] of this.pitMeshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.pitMeshes.clear();
    this.pitDepths.clear();

    this.uniqueItems.clear();
    this.bricks.clear();
    this.dugColumns.clear();
    this.dugVoxels.clear();
    this.maskCtx.fillStyle = '#ffffff';
    this.maskCtx.fillRect(0, 0, this.maskSize, this.maskSize);
    this.maskTexture.needsUpdate = true;

    this.interactables.length = 0;
    this.interactables.push(this.groundMesh);
    if (this.countryside) {
      for (const h of this.countryside.hills) {
        this.interactables.push(h.mesh);
      }
    }
    this.undoStack = [];
    this.redoStack = [];
    if (save) {
      this.saveToLocalStorage();
    }
  }

  public loadPreset(entries: BrickEntry[], save = true): void {
    this.clearAll(false);
    for (const e of entries) {
      if (e.y < 0) {
        this.dugColumns.add(`${e.x},${e.z}`);
        this.setGroundHoleMask(e.x, e.z, true);
        this.updatePitNeighborhood(e.x, e.z);
      }
      this.setBrick(e.x, e.y, e.z, e.type, false, false, e.rot ?? 0, e.open ?? false, e.color, e.pattern, e.facePaints);
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

    // Always cast directly from the camera through the exact center crosshair (0, 0)
    // so there is ZERO parallax discrepancy between what the crosshair points at and what gets hit!
    // Note: We keep raycasting active even in Navigation mode so currentTarget and lastValidTarget
    // remain up to date for sidebar tools (e.g. "Peindre le mur visé maintenant")!
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
    let hit: THREE.Intersection | undefined;
    for (const h of rawHits) {
      if (h.distance < minValidDist) continue;
      if (h.object === this.groundMesh) {
        const px = Math.round(h.point.x);
        const pz = Math.round(h.point.z);
        if (this.dugColumns.has(`${px},${pz}`)) {
          // Sol creusé : le rayon passe à travers le trou transparent pour viser le fond !
          continue;
        }
      }
      hit = h;
      break;
    }

    if (hit && hit.face) {
      const normal = hit.face.normal.clone();
      normal.transformDirection(hit.object.matrixWorld).round();

      if (hit.object === this.groundMesh || (hit.object.userData && hit.object.userData.isHill)) {
        const px = Math.round(hit.point.x);
        const py = Math.max(0, Math.round(hit.point.y));
        const pz = Math.round(hit.point.z);
        const placePos = new THREE.Vector3(px, py, pz);
        const removePos = new THREE.Vector3(px, py, pz);
        this.currentTarget = {
          placePos,
          removePos,
          removeType: BRICK_TYPE_DIRT,
          hitBrickType: BRICK_TYPE_GRASS_BLOCK,
          isDoorHit: false,
          normal: normal.clone(),
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
          normal: normal.clone(),
        };
      }

      this.lastValidTarget = { ...this.currentTarget };

      if (enableRaycast) {
        if (this.isPaintGhostActive) {
          this.ghostGroup.visible = false;
          if (this.currentTarget.removePos) {
            const hitPos = this.currentTarget.removePos;
            this.paintGhostPlane.position.copy(hitPos).addScaledVector(normal, 0.504);
            this.paintGhostPlane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
            this.paintGhostPlane.visible = true;
          } else {
            this.paintGhostPlane.visible = false;
          }
        } else {
          this.paintGhostPlane.visible = false;
          this.ghostGroup.position.copy(this.currentTarget.placePos);
          this.ghostGroup.visible = true;
        }
      } else {
        // En mode navigation, on masque le fantôme de placement mais on conserve currentTarget & lastValidTarget
        this.ghostGroup.visible = false;
        this.paintGhostPlane.visible = false;
      }
    } else {
      this.currentTarget = null;
      this.ghostGroup.visible = false;
      this.paintGhostPlane.visible = false;
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
