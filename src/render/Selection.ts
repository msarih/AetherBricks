/**
 * Surlignage du bloc visé (contour noir) et fissures de minage.
 */
import * as THREE from 'three';
import { T } from '../world/Tiles';

const EPS = 0.002;

const CRACK_VERTEX = /* glsl */ `
attribute vec2 uv2d;
varying vec2 vUv;
void main() {
  vUv = uv2d;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CRACK_FRAGMENT = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray atlas;
uniform float uLayer;
varying vec2 vUv;
void main() {
  vec4 c = textureLod(atlas, vec3(fract(vUv), uLayer), 0.0);
  if (c.a < 0.05) discard;
  gl_FragColor = vec4(c.rgb, c.a);
}
`;

export class Selection {
  private readonly outline: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly crackMaterial: THREE.ShaderMaterial;
  private signature = '';
  private stage = -1;

  constructor(scene: THREE.Scene, atlasTexture: THREE.Texture) {
    this.outline = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.outline.frustumCulled = false;
    this.outline.visible = false;
    this.outline.renderOrder = 5;
    scene.add(this.outline);

    this.crackMaterial = new THREE.ShaderMaterial({
      uniforms: { atlas: { value: atlasTexture }, uLayer: { value: T.destroy_0 } },
      vertexShader: CRACK_VERTEX,
      fragmentShader: CRACK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    this.crack = new THREE.Mesh(new THREE.BufferGeometry(), this.crackMaterial);
    this.crack.frustumCulled = false;
    this.crack.visible = false;
    this.crack.renderOrder = 4;
    scene.add(this.crack);
  }

  /**
   * Montre le contour du bloc (x, y, z). `boxes` : boîtes de sélection en seizièmes.
   * `progress` : avancement du minage 0..1 (0 = pas de fissure).
   */
  show(x: number, y: number, z: number, boxes: readonly number[], progress: number): void {
    const sig = `${x},${y},${z}:${boxes.join(',')}`;
    if (sig !== this.signature) {
      this.signature = sig;
      this.rebuild(boxes);
      this.outline.position.set(x, y, z);
      this.crack.position.set(x, y, z);
    }
    this.outline.visible = boxes.length > 0;
    const stage = progress > 0 ? Math.min(9, Math.floor(progress * 10)) : -1;
    this.crack.visible = stage >= 0 && boxes.length > 0;
    if (stage >= 0 && stage !== this.stage) {
      this.crackMaterial.uniforms.uLayer.value = T.destroy_0 + stage;
    }
    this.stage = stage;
  }

  hide(): void {
    this.outline.visible = false;
    this.crack.visible = false;
  }

  private rebuild(boxes: readonly number[]): void {
    const lines: number[] = [];
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < boxes.length; i += 6) {
      const x0 = boxes[i] / 16 - EPS;
      const y0 = boxes[i + 1] / 16 - EPS;
      const z0 = boxes[i + 2] / 16 - EPS;
      const x1 = boxes[i + 3] / 16 + EPS;
      const y1 = boxes[i + 4] / 16 + EPS;
      const z1 = boxes[i + 5] / 16 + EPS;
      // 12 arêtes
      lines.push(
        x0, y0, z0, x1, y0, z0, x1, y0, z0, x1, y0, z1, x1, y0, z1, x0, y0, z1, x0, y0, z1, x0, y0, z0,
        x0, y1, z0, x1, y1, z0, x1, y1, z0, x1, y1, z1, x1, y1, z1, x0, y1, z1, x0, y1, z1, x0, y1, z0,
        x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1,
      );
      // 6 faces (sens antihoraire vu de l'extérieur), UV = position dans le bloc
      const quad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, uAxis: number, vAxis: number): void => {
        const base = pos.length / 3;
        const pts = [ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz];
        for (let k = 0; k < 12; k += 3) {
          pos.push(pts[k], pts[k + 1], pts[k + 2]);
          uv.push(pts[k + uAxis], 1 - pts[k + vAxis]);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 2); // haut
      quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, 2); // bas
      quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 1); // nord
      quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 1); // sud
      quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, 2, 1); // ouest
      quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 2, 1); // est
    }
    this.outline.geometry.dispose();
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.outline.geometry = lg;

    this.crack.geometry.dispose();
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cg.setAttribute('uv2d', new THREE.Float32BufferAttribute(uv, 2));
    cg.setIndex(idx);
    this.crack.geometry = cg;
  }

  dispose(): void {
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.crack.geometry.dispose();
    this.crackMaterial.dispose();
    this.outline.removeFromParent();
    this.crack.removeFromParent();
  }
}
