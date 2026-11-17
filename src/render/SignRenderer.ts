/**
 * Panneaux : planche (et poteau pour un panneau posé au sol) avec leurs 4 lignes de texte.
 * Ils ne passent pas par le maillage des chunks : un panneau sur poteau tourne par seizièmes
 * de tour, et son texte est une image dessinée à la demande.
 *
 * Mesures de Minecraft : planche de 1 × 0,5 × 1/12 de bloc, poteau de 7/12 de haut ;
 * panneau mural plaqué contre le bloc qui le porte, entre 4,5/16 et 12,5/16 de hauteur.
 */
import * as THREE from 'three';
import type { Atlas } from './Atlas';
import { lightColor, worldUniforms } from './ChunkMaterials';
import { B } from '../world/Ids';
import { FACING_DX, FACING_DZ } from '../world/Blocks';
import { T } from '../world/Tiles';
import { posKey, type BlockEntity, type World } from '../world/World';

const BOARD_W = 1;
const BOARD_H = 0.5;
const BOARD_D = 1 / 12;
const POST_H = 7 / 12;
const TEXT_W = 256;
const TEXT_H = 128;

interface SignBlockEntity extends BlockEntity {
  lines?: unknown;
}

class SignVisual {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly textTexture: THREE.CanvasTexture;
  private readonly textMaterial: THREE.MeshBasicMaterial;
  private readonly woodMaterial: THREE.MeshBasicMaterial;
  private text = '\0';
  stamp = 0;

  constructor(
    readonly key: string,
    wood: THREE.Texture,
    geometries: { board: THREE.BufferGeometry; post: THREE.BufferGeometry; text: THREE.BufferGeometry },
    x: number,
    y: number,
    z: number,
    id: number,
    meta: number,
  ) {
    this.canvas.width = TEXT_W;
    this.canvas.height = TEXT_H;
    this.textTexture = new THREE.CanvasTexture(this.canvas);
    this.textTexture.magFilter = THREE.LinearFilter;
    this.textTexture.minFilter = THREE.LinearFilter;
    this.textTexture.generateMipmaps = false;
    this.textMaterial = new THREE.MeshBasicMaterial({ map: this.textTexture, transparent: true, alphaTest: 0.3 });
    this.woodMaterial = new THREE.MeshBasicMaterial({ map: wood });

    const board = new THREE.Mesh(geometries.board, this.woodMaterial);
    const text = new THREE.Mesh(geometries.text, this.textMaterial);
    text.position.z = BOARD_D / 2 + 0.002;
    const face = new THREE.Group();
    face.add(board, text);
    this.group.add(face);

    if (id === B.WALL_SIGN) {
      // tourné vers sa direction (méta 0..3), plaqué contre le bloc qui le porte
      const f = meta & 3;
      this.group.rotation.y = Math.atan2(FACING_DX[f], FACING_DZ[f]);
      this.group.position.set(x + 0.5, y + 8.5 / 16, z + 0.5);
      face.position.z = -(0.5 - BOARD_D / 2);
    } else {
      // seizièmes de tour : la face écrite regarde (sin r·π/8, cos r·π/8)
      this.group.rotation.y = ((meta & 15) * Math.PI) / 8;
      this.group.position.set(x + 0.5, y, z + 0.5);
      face.position.y = POST_H + BOARD_H / 2;
      const post = new THREE.Mesh(geometries.post, this.woodMaterial);
      post.position.y = POST_H / 2;
      this.group.add(post);
    }
    this.group.traverse((o) => {
      o.matrixAutoUpdate = true;
    });
  }

  /** Redessine le texte s'il a changé. */
  setLines(lines: readonly string[]): void {
    const text = lines.join('\n');
    if (text === this.text) return;
    this.text = text;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, TEXT_W, TEXT_H);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "bold 22px Verdana, 'DejaVu Sans', sans-serif";
    for (let i = 0; i < 4; i++) {
      const line = lines[i] ?? '';
      if (line) ctx.fillText(line, TEXT_W / 2, 19 + i * 30, TEXT_W - 12);
    }
    this.textTexture.needsUpdate = true;
  }

  setLight(color: THREE.Color): void {
    this.woodMaterial.color.copy(color);
    this.textMaterial.color.copy(color);
  }

  dispose(): void {
    this.textTexture.dispose();
    this.textMaterial.dispose();
    this.woodMaterial.dispose();
  }
}

export class SignRenderer {
  private readonly root = new THREE.Group();
  private readonly signs = new Map<number, SignVisual>();
  private readonly wood: THREE.DataTexture;
  private readonly geometries: { board: THREE.BufferGeometry; post: THREE.BufferGeometry; text: THREE.BufferGeometry };
  private readonly light = new THREE.Color();
  private frame = 0;

  constructor(scene: THREE.Scene, atlas: Atlas) {
    scene.add(this.root);
    const px = atlas.tilePixels(T.oak_planks);
    this.wood = new THREE.DataTexture(new Uint8Array(px), 16, 16, THREE.RGBAFormat);
    this.wood.magFilter = THREE.NearestFilter;
    this.wood.minFilter = THREE.NearestFilter;
    this.wood.generateMipmaps = false;
    this.wood.needsUpdate = true;
    this.geometries = {
      board: new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_D),
      post: new THREE.BoxGeometry(BOARD_D, POST_H, BOARD_D),
      text: new THREE.PlaneGeometry(BOARD_W - 1 / 16, BOARD_H - 1 / 16),
    };
  }

  /** À chaque image : un visuel par panneau chargé, texte et lumière à jour. */
  sync(world: World): void {
    const frame = ++this.frame;
    for (const be of world.blockEntities.values()) {
      if (be.type !== 'sign') continue;
      const v = world.getBlockAndMeta(be.x, be.y, be.z);
      const id = v & 255;
      if (id !== B.SIGN && id !== B.WALL_SIGN) continue;
      const k = posKey(be.x, be.y, be.z);
      const shape = `${id}:${v >> 8}`;
      let s = this.signs.get(k);
      if (s && s.key !== shape) {
        this.remove(k, s);
        s = undefined;
      }
      if (!s) {
        s = new SignVisual(shape, this.wood, this.geometries, be.x, be.y, be.z, id, v >> 8);
        this.signs.set(k, s);
        this.root.add(s.group);
      }
      s.stamp = frame;
      const lines = (be as SignBlockEntity).lines;
      s.setLines(Array.isArray(lines) ? (lines as string[]) : []);
      lightColor(world.getSkyLight(be.x, be.y, be.z), world.getBlockLight(be.x, be.y, be.z), worldUniforms.uSkyLight.value, this.light);
      s.setLight(this.light);
    }
    for (const [k, s] of this.signs) if (s.stamp !== frame) this.remove(k, s);
  }

  private remove(k: number, s: SignVisual): void {
    this.root.remove(s.group);
    s.dispose();
    this.signs.delete(k);
  }

  dispose(): void {
    for (const [k, s] of this.signs) this.remove(k, s);
    this.wood.dispose();
    this.geometries.board.dispose();
    this.geometries.post.dispose();
    this.geometries.text.dispose();
    this.root.removeFromParent();
  }
}
