import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

interface FoliageInstance {
  x: number;
  z: number;
  baseMatrix: THREE.Matrix4;
}

export class CountrysideEnv {
  public readonly sky: Sky;
  private readonly sunVec = new THREE.Vector3();
  private grassShaderUniforms = { uTime: { value: 0 } };
  private readonly grassMesh: THREE.InstancedMesh;
  private readonly grassInstances: FoliageInstance[] = [];

  private whiteFlowersMesh!: THREE.InstancedMesh;
  private readonly whiteFlowerInstances: FoliageInstance[] = [];
  private yellowFlowersMesh!: THREE.InstancedMesh;
  private readonly yellowFlowerInstances: FoliageInstance[] = [];

  // Ensemble des coordonnées (x,z) occupées au sol (y=0) par une dalle de sol, brique ou porte
  private readonly occupiedGroundCells = new Set<string>();
  private readonly zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  private readonly pmremGenerator: THREE.PMREMGenerator;
  private currentEnvMap: THREE.Texture | null = null;

  // Système de pluie douce de campagne
  public isRaining = false;
  private rainPoints?: THREE.Points;
  private rainPositions?: Float32Array;
  private readonly rainCount = 2600;

  constructor(private readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();

    // 1. Physically-based Atmospheric Sky (immense dôme atmosphérique infini)
    this.sky = new Sky();
    this.sky.scale.setScalar(8000);
    this.scene.add(this.sky);

    // 2. Instanced 3D Grass Tufts with GPU Wind Shader
    this.grassMesh = this.createInstancedMeadowGrass(22000);
    this.scene.add(this.grassMesh);

    // 3. Instanced Wildflowers (Marguerites blanches & boutons d'or)
    this.createWildflowers(1100);

    // 4. Distant Countryside Horizon (Trees & Rolling Hills beyond r=38m)
    this.createCountrysideHorizon();

    // 5. Pluie douce de campagne (2600 gouttes)
    this.initRainSystem();
  }

  private initRainSystem(): void {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = Math.random() * 32;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainPositions = positions;

    const mat = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.14,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
  }

  public toggleRain(): boolean {
    this.isRaining = !this.isRaining;
    if (this.rainPoints) {
      this.rainPoints.visible = this.isRaining;
    }
    return this.isRaining;
  }

  public updateSunAndEnvironment(
    elevationDeg: number,
    azimuthDeg: number,
    turbidity = 1.6,
    rayleigh = 2.2
  ): THREE.Vector3 {
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['turbidity'].value = turbidity;
    skyUniforms['rayleigh'].value = rayleigh;
    skyUniforms['mieCoefficient'].value = 0.0015;
    skyUniforms['mieDirectionalG'].value = 0.55;

    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    this.sunVec.setFromSphericalCoords(1, phi, theta);
    skyUniforms['sunPosition'].value.copy(this.sunVec);

    if (this.currentEnvMap) {
      this.currentEnvMap.dispose();
    }
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(elevationDeg > 5 ? 0x7faad4 : 0x0f172a);

    const bounceGround = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: elevationDeg > 5 ? 0x456e32 : 0x0f172a })
    );
    bounceGround.position.y = -2;
    envScene.add(bounceGround);

    this.currentEnvMap = this.pmremGenerator.fromScene(envScene, 0.04).texture;
    this.scene.environment = this.currentEnvMap;
    this.scene.environmentIntensity = elevationDeg > 5 ? 0.26 : 0.15;

    return this.sunVec.clone();
  }

  private createInstancedMeadowGrass(count: number): THREE.InstancedMesh {
    const bladeW = 0.2;
    const bladeH = 0.3;
    const g1 = new THREE.PlaneGeometry(bladeW, bladeH, 1, 3);
    g1.translate(0, bladeH / 2 - 0.5, 0);
    const g2 = g1.clone();
    g2.rotateY(Math.PI / 3);
    const g3 = g1.clone();
    g3.rotateY(-Math.PI / 3);

    const mergedGeo = this.mergeGeometries([g1, g2, g3]);

    const posAttr = mergedGeo.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const heightRatio = Math.max(0, Math.min(1, (y + 0.5) / bladeH));
      const taper = 1.0 - heightRatio * 0.78;
      posAttr.setX(i, posAttr.getX(i) * taper);
      posAttr.setZ(i, posAttr.getZ(i) * taper);

      const r = THREE.MathUtils.lerp(0.18, 0.44, heightRatio);
      const g = THREE.MathUtils.lerp(0.34, 0.66, heightRatio);
      const b = THREE.MathUtils.lerp(0.11, 0.2, heightRatio);
      colors.push(r, g, b);
    }
    mergedGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    mergedGeo.computeVertexNormals();

    const grassMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.01,
      side: THREE.DoubleSide,
    });

    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.grassShaderUniforms.uTime;
      shader.vertexShader =
        `uniform float uTime;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          float hFactor = clamp((transformed.y + 0.5) / 0.30, 0.0, 1.0);
          vec4 worldInstancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float wave = sin(uTime * 2.2 + worldInstancePos.x * 0.45 + worldInstancePos.z * 0.35) * 0.08;
          float gust = cos(uTime * 1.3 + worldInstancePos.x * 0.15 - worldInstancePos.z * 0.25) * 0.04;
          transformed.x += (wave + gust) * hFactor * hFactor;
          transformed.z += (wave * 0.6) * hFactor * hFactor;
          `
        );
    };

    const instanced = new THREE.InstancedMesh(mergedGeo, grassMat, count);
    instanced.receiveShadow = true;
    instanced.castShadow = false;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const radius = Math.pow(Math.random(), 0.7) * 65;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      const s = 0.65 + Math.random() * 0.65;
      dummy.scale.set(s, s * (0.75 + Math.random() * 0.35), s);
      dummy.updateMatrix();

      instanced.setMatrixAt(i, dummy.matrix);
      this.grassInstances.push({ x, z, baseMatrix: dummy.matrix.clone() });

      const hueShift = (Math.random() - 0.5) * 0.04;
      const lightShift = (Math.random() - 0.5) * 0.08;
      color.setHSL(0.27 + hueShift, 0.52, 0.48 + lightShift);
      instanced.setColorAt(i, color);
    }

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    return instanced;
  }

  private createWildflowers(count: number): void {
    const flowerGeo = new THREE.DodecahedronGeometry(0.05, 0);
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.65 });
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.55 });

    const whiteCount = Math.floor(count * 0.65);
    const yellowCount = count - whiteCount;

    this.whiteFlowersMesh = new THREE.InstancedMesh(flowerGeo, whiteMat, whiteCount);
    this.yellowFlowersMesh = new THREE.InstancedMesh(flowerGeo, yellowMat, yellowCount);

    const dummy = new THREE.Object3D();
    let wIdx = 0;
    let yIdx = 0;

    for (let i = 0; i < count; i++) {
      const r = 4 + Math.random() * 55;
      const a = Math.random() * Math.PI * 2;
      const fx = Math.cos(a) * r;
      const fz = Math.sin(a) * r;
      dummy.position.set(fx, -0.36 + Math.random() * 0.08, fz);
      dummy.scale.set(1, 0.5, 1);
      dummy.updateMatrix();

      if (wIdx < whiteCount && (i % 3 !== 0 || yIdx >= yellowCount)) {
        this.whiteFlowersMesh.setMatrixAt(wIdx++, dummy.matrix);
        this.whiteFlowerInstances.push({ x: fx, z: fz, baseMatrix: dummy.matrix.clone() });
      } else if (yIdx < yellowCount) {
        this.yellowFlowersMesh.setMatrixAt(yIdx++, dummy.matrix);
        this.yellowFlowerInstances.push({ x: fx, z: fz, baseMatrix: dummy.matrix.clone() });
      }
    }

    this.whiteFlowersMesh.instanceMatrix.needsUpdate = true;
    this.yellowFlowersMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.whiteFlowersMesh);
    this.scene.add(this.yellowFlowersMesh);
  }

  private isNearAnyOccupiedGroundCell(px: number, pz: number, margin = 0.78): boolean {
    const minCellX = Math.floor(px - margin);
    const maxCellX = Math.ceil(px + margin);
    const minCellZ = Math.floor(pz - margin);
    const maxCellZ = Math.ceil(pz + margin);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cz = minCellZ; cz <= maxCellZ; cz++) {
        if (this.occupiedGroundCells.has(`${cx},${cz}`)) {
          if (Math.abs(px - cx) <= margin && Math.abs(pz - cz) <= margin) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Masque totalement l'herbe 3D ET les fleurs sauvages sous et au bord d'une dalle de sol ou brique (x, z)
   * afin qu'aucun brin d'herbe ni fleur ne dépasse jamais à travers le sol construit.
   */
  public syncGrassAt(bx: number, bz: number, hasElementOnGround: boolean): void {
    const rx = Math.round(bx);
    const rz = Math.round(bz);
    const key = `${rx},${rz}`;

    if (hasElementOnGround) {
      this.occupiedGroundCells.add(key);
    } else {
      this.occupiedGroundCells.delete(key);
    }

    const margin = 0.78;
    const searchRadius = 1.65;

    // 1. Update Grass Tufts in local neighborhood
    let grassChanged = false;
    for (let i = 0; i < this.grassInstances.length; i++) {
      const inst = this.grassInstances[i];
      if (Math.abs(inst.x - rx) <= searchRadius && Math.abs(inst.z - rz) <= searchRadius) {
        const hide = this.isNearAnyOccupiedGroundCell(inst.x, inst.z, margin);
        this.grassMesh.setMatrixAt(i, hide ? this.zeroMatrix : inst.baseMatrix);
        grassChanged = true;
      }
    }
    if (grassChanged) {
      this.grassMesh.instanceMatrix.needsUpdate = true;
    }

    // 2. Update White Wildflowers in local neighborhood
    let whiteChanged = false;
    for (let i = 0; i < this.whiteFlowerInstances.length; i++) {
      const inst = this.whiteFlowerInstances[i];
      if (Math.abs(inst.x - rx) <= searchRadius && Math.abs(inst.z - rz) <= searchRadius) {
        const hide = this.isNearAnyOccupiedGroundCell(inst.x, inst.z, margin);
        this.whiteFlowersMesh.setMatrixAt(i, hide ? this.zeroMatrix : inst.baseMatrix);
        whiteChanged = true;
      }
    }
    if (whiteChanged) {
      this.whiteFlowersMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Update Yellow Wildflowers in local neighborhood
    let yellowChanged = false;
    for (let i = 0; i < this.yellowFlowerInstances.length; i++) {
      const inst = this.yellowFlowerInstances[i];
      if (Math.abs(inst.x - rx) <= searchRadius && Math.abs(inst.z - rz) <= searchRadius) {
        const hide = this.isNearAnyOccupiedGroundCell(inst.x, inst.z, margin);
        this.yellowFlowersMesh.setMatrixAt(i, hide ? this.zeroMatrix : inst.baseMatrix);
        yellowChanged = true;
      }
    }
    if (yellowChanged) {
      this.yellowFlowersMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private createCountrysideHorizon(): void {
    const horizonGroup = new THREE.Group();

    const hillMat = new THREE.MeshStandardMaterial({
      color: 0x3f6e2c,
      roughness: 0.92,
      metalness: 0.0,
    });

    const hillCount = 18;
    for (let i = 0; i < hillCount; i++) {
      const angle = (i / hillCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const dist = 92 + Math.random() * 25;
      const hillGeo = new THREE.SphereGeometry(28 + Math.random() * 18, 24, 16);
      const hill = new THREE.Mesh(hillGeo, hillMat);
      hill.scale.set(1.6, 0.36 + Math.random() * 0.15, 1.2);
      hill.position.set(Math.cos(angle) * dist, -6, Math.sin(angle) * dist);
      hill.receiveShadow = true;
      horizonGroup.add(hill);
    }

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const foliageMat1 = new THREE.MeshStandardMaterial({ color: 0x3b6e28, roughness: 0.82 });
    const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x4d8234, roughness: 0.82 });

    const treeCount = 65;
    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.08;
      const dist = 38 + Math.random() * 38;
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;

      const tree = new THREE.Group();
      const scale = 0.85 + Math.random() * 0.7;

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 2.6, 7), trunkMat);
      trunk.position.y = 0.8;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      tree.add(trunk);

      const crownMat = i % 2 === 0 ? foliageMat1 : foliageMat2;
      const mainCrown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.9, 1), crownMat);
      mainCrown.position.y = 3.1;
      mainCrown.scale.set(1.1, 0.95, 1.1);
      mainCrown.castShadow = true;
      mainCrown.receiveShadow = true;
      tree.add(mainCrown);

      const subCrown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), crownMat);
      subCrown.position.set(0.8, 2.6, 0.5);
      subCrown.castShadow = true;
      tree.add(subCrown);

      tree.position.set(tx, 0, tz);
      tree.scale.setScalar(scale);
      horizonGroup.add(tree);
    }

    this.scene.add(horizonGroup);
  }

  private mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;

    for (const g of geos) {
      const pos = g.attributes.position;
      const norm = g.attributes.normal;
      const uv = g.attributes.uv;
      const idx = g.index;

      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
        uvs.push(uv.getX(i), uv.getY(i));
      }

      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          indices.push(idx.getX(i) + vertexOffset);
        }
      }
      vertexOffset += pos.count;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    merged.setIndex(indices);
    return merged;
  }

  public update(elapsedSeconds: number, playerPos?: THREE.Vector3): void {
    this.grassShaderUniforms.uTime.value = elapsedSeconds;

    if (playerPos) {
      this.sky.position.set(playerPos.x, 0, playerPos.z);
    }

    if (this.isRaining && this.rainPositions && this.rainPoints) {
      const px = playerPos?.x ?? 0;
      const pz = playerPos?.z ?? 0;
      const posAttr = this.rainPoints.geometry.attributes.position;
      const fallSpeed = 32.0 * 0.016;

      for (let i = 0; i < this.rainCount; i++) {
        let y = this.rainPositions[i * 3 + 1] - fallSpeed;
        if (y < -0.5) {
          y = 28 + Math.random() * 4;
          this.rainPositions[i * 3 + 0] = px + (Math.random() - 0.5) * 56;
          this.rainPositions[i * 3 + 2] = pz + (Math.random() - 0.5) * 56;
        }
        this.rainPositions[i * 3 + 1] = y;
      }
      posAttr.needsUpdate = true;
    }
  }
}
