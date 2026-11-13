/**
 * Affichage des chunks : deux maillages par chunk (passe opaque avec test alpha, passe translucide).
 */
import * as THREE from 'three';
import type { ChunkSink } from '../world/ChunkManager';
import { chunkKey } from '../world/Constants';
import type { PassData } from '../world/mesh/MeshTypes';
import { createChunkMaterials, passGeometry, type ChunkMaterials } from './ChunkMaterials';

interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  translucent: THREE.Mesh | null;
}

export class ChunkRenderer implements ChunkSink {
  readonly group = new THREE.Group();
  readonly materials: ChunkMaterials;
  /** Statistiques pour l'écran de débogage. */
  triangles = 0;

  private readonly meshes = new Map<number, ChunkMeshes>();

  constructor(scene: THREE.Scene, atlasTexture: THREE.Texture) {
    this.materials = createChunkMaterials(atlasTexture);
    this.group.name = 'chunks';
    scene.add(this.group);
  }

  get count(): number {
    return this.meshes.size;
  }

  setChunkMesh(cx: number, cz: number, opaque: PassData | null, translucent: PassData | null): void {
    const key = chunkKey(cx, cz);
    let entry = this.meshes.get(key);
    if (!entry) {
      entry = { opaque: null, translucent: null };
      this.meshes.set(key, entry);
    }
    entry.opaque = this.replace(entry.opaque, opaque, this.materials.opaque, cx, cz, 0);
    entry.translucent = this.replace(entry.translucent, translucent, this.materials.translucent, cx, cz, 1);
  }

  private replace(old: THREE.Mesh | null, data: PassData | null, material: THREE.Material, cx: number, cz: number, order: number): THREE.Mesh | null {
    if (old) {
      this.triangles -= (old.geometry.index?.count ?? 0) / 3;
      old.geometry.dispose();
    }
    if (!data || data.indices.length === 0) {
      if (old) this.group.remove(old);
      return null;
    }
    const geometry = passGeometry(data);
    // sphère englobante calculée sur l'étendue verticale réelle (meilleur tri et meilleur rejet hors champ)
    const pos = data.positions;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      const y = pos[i];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const half = (maxY - minY) / 2;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, minY + half, 8), Math.sqrt(128 + half * half) + 1);
    this.triangles += data.indices.length / 3;
    if (old) {
      old.geometry = geometry;
      return old;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx * 16, 0, cz * 16);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = order;
    this.group.add(mesh);
    return mesh;
  }

  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const entry = this.meshes.get(key);
    if (!entry) return;
    this.meshes.delete(key);
    for (const m of [entry.opaque, entry.translucent]) {
      if (!m) continue;
      this.triangles -= (m.geometry.index?.count ?? 0) / 3;
      m.geometry.dispose();
      this.group.remove(m);
    }
  }

  clear(): void {
    for (const entry of this.meshes.values()) {
      for (const m of [entry.opaque, entry.translucent]) {
        if (!m) continue;
        m.geometry.dispose();
        this.group.remove(m);
      }
    }
    this.meshes.clear();
    this.triangles = 0;
  }

  dispose(): void {
    this.clear();
    this.materials.opaque.dispose();
    this.materials.translucent.dispose();
    this.group.removeFromParent();
  }
}
