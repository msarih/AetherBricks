import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class CountrysideEnv {
  public readonly sky: Sky;
  private readonly sunVec = new THREE.Vector3();
  private grassShaderUniforms = { uTime: { value: 0 } };
  private readonly grassMesh: THREE.InstancedMesh;
  private readonly grassPositions: { x: number; z: number; baseMatrix: THREE.Matrix4 }[] = [];
  private readonly pmremGenerator: THREE.PMREMGenerator;
  private currentEnvMap: THREE.Texture | null = null;

  constructor(private readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();

    // 1. Physically-based Atmospheric Sky (Rayleigh + Mie scattering)
    this.sky = new Sky();
    this.sky.scale.setScalar(450);
    this.scene.add(this.sky);

    // 2. Instanced 3D Grass Tufts with GPU Wind Shader (22,000 tufts across the flat meadow)
    this.grassMesh = this.createInstancedMeadowGrass(22000);
    this.scene.add(this.grassMesh);

    // 3. Instanced Wildflowers (Marguerites blanches & boutons d'or)
    this.createWildflowers(1100);

    // 4. Distant Countryside Horizon (Trees, Pasture Fences & Rolling Hills beyond r=38m)
    this.createCountrysideHorizon();
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

    // Bake soft, non-glaring indirect lighting (IBL)
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
    // Crossed blade tuft geometry (2 intersecting tapered planes per tuft)
    const bladeW = 0.22;
    const bladeH = 0.34;
    const g1 = new THREE.PlaneGeometry(bladeW, bladeH, 1, 3);
    g1.translate(0, bladeH / 2 - 0.5, 0);
    const g2 = g1.clone();
    g2.rotateY(Math.PI / 3);
    const g3 = g1.clone();
    g3.rotateY(-Math.PI / 3);

    // Merge the 3 intersecting blades into a single lush tuft geometry
    const mergedGeo = this.mergeGeometries([g1, g2, g3]);

    // Taper top vertices of each blade so grass tips are pointy
    const posAttr = mergedGeo.attributes.position;
    const colors: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const heightRatio = Math.max(0, Math.min(1, (y + 0.5) / bladeH));
      const taper = 1.0 - heightRatio * 0.78;
      posAttr.setX(i, posAttr.getX(i) * taper);
      posAttr.setZ(i, posAttr.getZ(i) * taper);

      // Vertex color gradient: darker earthy green at root, vibrant sun-lit green at tip
      const r = THREE.MathUtils.lerp(0.18, 0.48, heightRatio);
      const g = THREE.MathUtils.lerp(0.34, 0.72, heightRatio);
      const b = THREE.MathUtils.lerp(0.11, 0.22, heightRatio);
      colors.push(r, g, b);
    }
    mergedGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    mergedGeo.computeVertexNormals();

    const grassMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    // Inject GPU wind sway in vertex shader
    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.grassShaderUniforms.uTime;
      shader.vertexShader =
        `uniform float uTime;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          float hFactor = clamp((transformed.y + 0.5) / 0.34, 0.0, 1.0);
          vec4 worldInstancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float wave = sin(uTime * 2.2 + worldInstancePos.x * 0.45 + worldInstancePos.z * 0.35) * 0.09;
          float gust = cos(uTime * 1.3 + worldInstancePos.x * 0.15 - worldInstancePos.z * 0.25) * 0.05;
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
      // Distribute more densely near the player and out to 65m
      const radius = Math.pow(Math.random(), 0.7) * 65;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      const s = 0.65 + Math.random() * 0.75;
      dummy.scale.set(s, s * (0.8 + Math.random() * 0.45), s);
      dummy.updateMatrix();

      instanced.setMatrixAt(i, dummy.matrix);
      this.grassPositions.push({ x, z, baseMatrix: dummy.matrix.clone() });

      // Subtle natural variation per tuft
      const hueShift = (Math.random() - 0.5) * 0.04;
      const lightShift = (Math.random() - 0.5) * 0.08;
      color.setHSL(0.27 + hueShift, 0.55, 0.52 + lightShift);
      instanced.setColorAt(i, color);
    }

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    return instanced;
  }

  /**
   * Masque ou réaffiche les brins d'herbe 3D sous une coordonnée de brique (x, z)
   */
  public syncGrassAt(bx: number, bz: number, hasBrickOnGround: boolean): void {
    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    let changed = false;
    for (let i = 0; i < this.grassPositions.length; i++) {
      const gp = this.grassPositions[i];
      if (Math.abs(gp.x - bx) < 0.6 && Math.abs(gp.z - bz) < 0.6) {
        this.grassMesh.setMatrixAt(i, hasBrickOnGround ? zeroMat : gp.baseMatrix);
        changed = true;
      }
    }
    if (changed) {
      this.grassMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private createWildflowers(count: number): void {
    const flowerGeo = new THREE.DodecahedronGeometry(0.055, 0);
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const yellowMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 });

    const whiteFlowers = new THREE.InstancedMesh(flowerGeo, whiteMat, Math.floor(count * 0.65));
    const yellowFlowers = new THREE.InstancedMesh(flowerGeo, yellowMat, Math.floor(count * 0.35));

    const dummy = new THREE.Object3D();
    let wIdx = 0;
    let yIdx = 0;

    for (let i = 0; i < count; i++) {
      const r = 4 + Math.random() * 55;
      const a = Math.random() * Math.PI * 2;
      dummy.position.set(Math.cos(a) * r, -0.24 + Math.random() * 0.1, Math.sin(a) * r);
      dummy.scale.set(1, 0.5, 1);
      dummy.updateMatrix();

      if (i % 3 !== 0 && wIdx < whiteFlowers.count) {
        whiteFlowers.setMatrixAt(wIdx++, dummy.matrix);
      } else if (yIdx < yellowFlowers.count) {
        yellowFlowers.setMatrixAt(yIdx++, dummy.matrix);
      }
    }

    this.scene.add(whiteFlowers);
    this.scene.add(yellowFlowers);
  }

  private createCountrysideHorizon(): void {
    const horizonGroup = new THREE.Group();

    // 1. Collines verdoyantes douces à l'horizon (au-delà du plateau plat de construction)
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

    // 2. Arbres de campagne (Chênes & Cyprès) en lisière de prairie (entre 38m et 75m)
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

  public update(elapsedSeconds: number): void {
    this.grassShaderUniforms.uTime.value = elapsedSeconds;
  }
}

