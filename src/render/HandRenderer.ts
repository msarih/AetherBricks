/**
 * Main et objet tenu à la première personne.
 *
 * Dessinés après le monde, dans leur propre scène avec leur propre caméra (champ fixe de 70°),
 * après effacement de la profondeur : la main ne traverse jamais les blocs.
 * Les enchaînements de transformations reprennent ceux de Minecraft (balancement de marche,
 * coup, rangement/sortie, repas, arc, parade).
 */
import * as THREE from 'three';
import type { Atlas } from './Atlas';
import { lightColor, worldUniforms } from './ChunkMaterials';
import { ItemModel, MatrixChain, createMobMaterial, getMobAssets } from './EntityRenderer';
import { getMobModel } from '../entity/MobModels';
import { I } from '../world/Ids';
import { MAP_PAPER, mapPixelRgb } from '../world/MapColors';
import { T } from '../world/Tiles';

export interface HandState {
  /** Phase du balancement de marche, croissante, en radians. */
  bobPhase: number;
  /** Amplitude du balancement, 0..1. */
  bobAmount: number;
  /** Lumière à la position du joueur, 0..15. */
  skyLight: number;
  blockLight: number;
  /** Progression de l'utilisation en cours, 0..1 ; 0 = aucune. */
  useProgress: number;
  useKind: 'none' | 'eat' | 'bow' | 'block';
  /** La ligne de la canne à pêche est à l'eau : la canne s'affiche sans sa ficelle. */
  fishing: boolean;
  /** Variation de l'orientation de la caméra, en radians par image (léger retard de la main). */
  yawDelta: number;
  pitchDelta: number;
  /** Tuile animée de l'objet tenu (aiguille de la boussole, cadran de l'horloge), -1 sinon. */
  iconTile: number;
  /** Carte tenue en main, ou null. */
  map: HeldMap | null;
  /** Tangage du regard en radians (positif = vers le haut) : la carte se relève quand on baisse les yeux. */
  pitch: number;
}

/** Carte tenue : ses pixels (voir world/MapColors) et le repère du joueur. */
export interface HeldMap {
  id: number;
  colors: Uint8Array;
  version: number;
  /** Position du joueur en pixels de carte (0..128 ; hors de cet intervalle : le joueur est hors de la carte). */
  markerX: number;
  markerZ: number;
  /** Direction du regard sur la carte (nord en haut) : composantes x et z du regard horizontal. */
  dirX: number;
  dirZ: number;
}

const MAP_TEX = 128;

/**
 * Carte dépliée devant le joueur : planche de papier et texture de 128 × 128 pixels,
 * recopiée quand la carte change ou quand le joueur bouge (repère).
 */
class MapDisplay {
  readonly group = new THREE.Group();
  private readonly base = new Uint8Array(MAP_TEX * MAP_TEX * 4);
  private readonly data = new Uint8Array(MAP_TEX * MAP_TEX * 4);
  private readonly texture: THREE.DataTexture;
  private readonly mapMaterial: THREE.MeshBasicMaterial;
  private readonly paperMaterial = new THREE.MeshBasicMaterial({ color: 0xd9c793 });
  private readonly borderMaterial = new THREE.MeshBasicMaterial({ color: 0x7a5c33 });
  private shownId = -1;
  private shownVersion = -1;
  private markerKey = '';

  constructor() {
    this.texture = new THREE.DataTexture(this.data, MAP_TEX, MAP_TEX, THREE.RGBAFormat);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.mapMaterial = new THREE.MeshBasicMaterial({ map: this.texture });
    const border = new THREE.Mesh(new THREE.PlaneGeometry(1.11, 1.11), this.borderMaterial);
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(1.07, 1.07), this.paperMaterial);
    const map = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mapMaterial);
    paper.position.z = 0.002;
    map.position.z = 0.004;
    for (const m of [border, paper, map]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /** Recopie les pixels si besoin et pose le repère du joueur. */
  update(m: HeldMap, light: THREE.Color): void {
    if (m.id !== this.shownId || m.version !== this.shownVersion) {
      this.shownId = m.id;
      this.shownVersion = m.version;
      const out = this.base;
      for (let z = 0; z < MAP_TEX; z++) {
        // ligne z = 0 (nord) en haut : la texture se lit de bas en haut
        let o = (MAP_TEX - 1 - z) * MAP_TEX * 4;
        for (let x = 0; x < MAP_TEX; x++, o += 4) {
          const px = m.colors[z * MAP_TEX + x];
          const c = px === 0 ? MAP_PAPER : mapPixelRgb(px);
          out[o] = (c >> 16) & 255;
          out[o + 1] = (c >> 8) & 255;
          out[o + 2] = c & 255;
          out[o + 3] = 255;
        }
      }
      this.markerKey = '';
    }
    const key = `${this.shownId}:${this.shownVersion}:${m.markerX.toFixed(1)}:${m.markerZ.toFixed(1)}:${m.dirX.toFixed(2)}:${m.dirZ.toFixed(2)}`;
    if (key !== this.markerKey) {
      this.markerKey = key;
      this.data.set(this.base);
      this.drawMarker(m);
      this.texture.needsUpdate = true;
    }
    this.mapMaterial.color.copy(light);
    this.paperMaterial.color.setHex(0xd9c793).multiply(light);
    this.borderMaterial.color.setHex(0x7a5c33).multiply(light);
  }

  /** Flèche blanche bordée de noir, pointe dans la direction du regard ; un point au bord si le joueur est hors de la carte. */
  private drawMarker(m: HeldMap): void {
    const inside = m.markerX >= 0 && m.markerX < MAP_TEX && m.markerZ >= 0 && m.markerZ < MAP_TEX;
    const cx = Math.max(0.5, Math.min(MAP_TEX - 0.5, m.markerX));
    const cz = Math.max(0.5, Math.min(MAP_TEX - 0.5, m.markerZ));
    const len = Math.hypot(m.dirX, m.dirZ) || 1;
    const fx = m.dirX / len;
    const fz = m.dirZ / len;
    for (let z = Math.floor(cz) - 6; z <= Math.floor(cz) + 6; z++) {
      for (let x = Math.floor(cx) - 6; x <= Math.floor(cx) + 6; x++) {
        if (x < 0 || z < 0 || x >= MAP_TEX || z >= MAP_TEX) continue;
        const rx = x + 0.5 - cx;
        const rz = z + 0.5 - cz;
        let color = -1;
        if (inside) {
          const along = rx * fx + rz * fz;
          const side = Math.abs(rx * -fz + rz * fx);
          if (along >= -3.2 && along <= 4.6 && side <= (4.6 - along) * 0.5) color = 0x1a1a1a;
          if (along >= -2.4 && along <= 3.6 && side <= (3.6 - along) * 0.42) color = 0xffffff;
        } else {
          const r = Math.hypot(rx, rz);
          if (r <= 2.2) color = 0x1a1a1a;
          if (r <= 1.3) color = 0xffffff;
        }
        if (color < 0) continue;
        const o = ((MAP_TEX - 1 - z) * MAP_TEX + x) * 4;
        this.data[o] = (color >> 16) & 255;
        this.data[o + 1] = (color >> 8) & 255;
        this.data[o + 2] = color & 255;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    this.mapMaterial.dispose();
    this.paperMaterial.dispose();
    this.borderMaterial.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

/** Durée d'un coup, en secondes (6 ticks). */
const SWING_DURATION = 0.3;
/** Vitesse de rangement / sortie (0,4 par tick). */
const EQUIP_SPEED = 8;
const RAD_TO_DEG = 180 / Math.PI;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Un modèle affiché dans la main, avec son groupe de maillages. */
interface Shown {
  model: ItemModel;
  group: THREE.Group;
}

export class HandRenderer {
  /** false : rien n'est dessiné (vue à la troisième personne, interface masquée). */
  visible = true;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 10);
  /** Reçoit la matrice calculée à chaque image ; contient le bras ou l'objet. */
  private readonly holder = new THREE.Group();
  private readonly arm: THREE.Mesh;
  private readonly armMaterial: THREE.ShaderMaterial;
  private readonly chain = new MatrixChain();
  private readonly light = new THREE.Color();

  /** Objet demandé et objet réellement affiché (ils diffèrent pendant le rangement). */
  private targetId = 0;
  private shownId = 0;
  private shown: Shown | null = null;
  /** Arc : sprites des étapes de tension, créés à la demande. */
  private bowStages: Array<Shown | null> = [null, null, null];
  /** Canne à pêche dont la ligne est lancée, créée à la demande. */
  private rodCast: Shown | null = null;
  /** Images de la boussole et de l'horloge déjà construites, par tuile. */
  private readonly dialShown = new Map<number, Shown>();
  /** Carte dépliée (carte remplie tenue en main). */
  private readonly mapDisplay = new MapDisplay();
  private current: THREE.Object3D;
  /** Seconde main (affichée en bas à gauche à la première personne). */
  private readonly offHolder = new THREE.Group();
  private offTargetId = 0;
  private offShown: Shown | null = null;
  private readonly offChain = new MatrixChain();

  /** 1 = sorti, 0 = rangé (hors de l'écran, en bas). */
  private equip = 1;
  /** Temps écoulé du coup en cours, < 0 au repos. */
  private swingTime = -1;
  private lagYaw = 0;
  private lagPitch = 0;
  private useTime = 0;
  private blockBlend = 0;

  constructor(private readonly atlas: Atlas) {
    const assets = getMobAssets(getMobModel('player'));
    const part = assets.parts.find((p) => p.name === 'armR');
    this.armMaterial = createMobMaterial(assets.texture);
    // Pas de brouillard sur la main
    this.armMaterial.uniforms.uFogNear = { value: 1e6 };
    this.armMaterial.uniforms.uFogFar = { value: 2e6 };
    this.arm = new THREE.Mesh(part ? part.geometry : new THREE.BufferGeometry(), this.armMaterial);
    this.arm.frustumCulled = false;
    this.current = this.arm;

    this.holder.matrixAutoUpdate = false;
    this.holder.add(this.arm);
    this.holder.add(this.mapDisplay.group);
    this.offHolder.matrixAutoUpdate = false;
    this.scene.add(this.holder, this.offHolder);
    this.camera.position.set(0, 0, 0);
  }

  /** Objet tenu (0 = main nue : bras du joueur). Déclenche « rangement puis sortie » si l'objet change. */
  setItem(itemId: number): void {
    this.targetId = itemId;
  }

  /** Objet tenu en seconde main (0 = rien, affiché en bas à gauche). */
  setOffhand(itemId: number): void {
    if (itemId === this.offTargetId) return;
    this.offTargetId = itemId;
    if (this.offShown) {
      this.offShown.group.removeFromParent();
      this.offShown.model.dispose();
      this.offShown = null;
    }
    if (itemId !== 0) {
      const model = ItemModel.forItem(this.atlas, itemId);
      model.detachFromWorld(false);
      const group = model.instance();
      group.traverse((o) => {
        o.frustumCulled = false;
      });
      this.offHolder.add(group);
      this.offShown = { model, group };
    }
  }

  /** Lance (ou relance) l'animation de coup. */
  swing(): void {
    this.swingTime = 0;
  }

  get swinging(): boolean {
    return this.swingTime >= 0;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Remplace le modèle affiché (appelé quand la main est rangée). */
  private show(itemId: number): void {
    this.disposeShown();
    this.shownId = itemId;
    if (itemId !== 0) this.shown = this.makeShown(ItemModel.forItem(this.atlas, itemId));
  }

  private makeShown(model: ItemModel): Shown {
    model.detachFromWorld(false);
    const group = model.instance();
    group.traverse((o) => {
      o.frustumCulled = false;
    });
    group.visible = false;
    this.holder.add(group);
    return { model, group };
  }

  private disposeShown(): void {
    const all = [this.shown, ...this.bowStages, this.rodCast];
    for (const s of all) {
      if (!s) continue;
      this.holder.remove(s.group);
      s.model.dispose();
    }
    for (const s of this.dialShown.values()) {
      this.holder.remove(s.group);
      s.model.dispose();
    }
    this.dialShown.clear();
    this.shown = null;
    this.bowStages = [null, null, null];
    this.rodCast = null;
  }

  /** Sprite d'une image de la boussole ou de l'horloge. */
  private dial(tile: number): Shown {
    let s = this.dialShown.get(tile);
    if (!s) {
      s = this.makeShown(ItemModel.forTile(this.atlas, tile));
      this.dialShown.set(tile, s);
    }
    return s;
  }

  /** Sprite de la canne à pêche dont la ligne est lancée. */
  private castRod(): Shown {
    if (!this.rodCast) this.rodCast = this.makeShown(ItemModel.forTile(this.atlas, T.fishing_rod_cast));
    return this.rodCast;
  }

  /** Sprite de l'arc selon la tension (0..1). */
  private bowStage(pull: number): Shown | null {
    if (pull <= 0) return this.shown;
    const stage = pull >= 0.9 ? 2 : pull > 0.65 ? 1 : 0;
    let s = this.bowStages[stage];
    if (!s) {
      const tile = stage === 2 ? T.bow_pulling_2 : stage === 1 ? T.bow_pulling_1 : T.bow_pulling_0;
      s = this.makeShown(ItemModel.forTile(this.atlas, tile));
      this.bowStages[stage] = s;
    }
    return s;
  }

  /** Position de base d'un objet tenu, avec la rotation du coup (repère de la caméra, puis échelle 0,4). */
  private transformItem(down: number, swing: number): void {
    const f = Math.sin(swing * swing * Math.PI);
    const f1 = Math.sin(Math.sqrt(swing) * Math.PI);
    this.chain
      .translate(0.56, -0.52, -0.72)
      .translate(0, down * -0.6, 0)
      .rotateY(45)
      .rotateY(f * -20)
      .rotateZ(f1 * -20)
      .rotateX(f1 * -80)
      .scale(0.4);
  }

  update(dt: number, state: HandState): void {
    dt = clamp(dt, 0, 0.1);

    // Coup
    if (this.swingTime >= 0) {
      this.swingTime += dt;
      if (this.swingTime >= SWING_DURATION) this.swingTime = -1;
    }
    let swing = this.swingTime < 0 ? 0 : this.swingTime / SWING_DURATION;

    // Rangement puis sortie quand l'objet change
    if (this.shownId !== this.targetId) {
      this.equip = Math.max(0, this.equip - dt * EQUIP_SPEED);
      if (this.equip <= 0.1) this.show(this.targetId);
    } else {
      this.equip = Math.min(1, this.equip + dt * EQUIP_SPEED);
    }
    const down = 1 - this.equip;

    // Retard de la main sur les mouvements de la caméra
    const decay = Math.exp(-dt * 14);
    this.lagYaw = clamp((this.lagYaw + state.yawDelta) * decay, -1.5, 1.5);
    this.lagPitch = clamp((this.lagPitch + state.pitchDelta) * decay, -1.5, 1.5);

    const using = state.useProgress > 0 ? state.useKind : 'none';
    this.useTime = using === 'none' ? 0 : this.useTime + dt;
    this.blockBlend = clamp(this.blockBlend + (using === 'block' ? 1 : -1) * dt * 12, 0, 1);

    const c = this.chain.identity();
    // Balancement de marche
    const bob = 0.1 * clamp(state.bobAmount, 0, 1);
    const phase = state.bobPhase;
    c.translate(Math.sin(phase) * bob * 0.5, -Math.abs(Math.cos(phase) * bob), 0);
    c.rotateZ(Math.sin(phase) * bob * 3);
    c.rotateX(Math.abs(Math.cos(phase - 0.2) * bob) * 5);
    c.rotateX(-this.lagPitch * 0.1 * RAD_TO_DEG);
    c.rotateY(-this.lagYaw * 0.1 * RAD_TO_DEG);

    let display: THREE.Object3D;
    if (this.shownId === I.FILLED_MAP && state.map && this.shown && state.useProgress <= 0) {
      // Carte tenue à deux mains (Minecraft 1.12) : à plat en bas de l'écran quand on regarde devant,
      // elle se relève face au joueur quand il baisse les yeux.
      const pitchDeg = -state.pitch * RAD_TO_DEG;
      const f = clamp(1 - pitchDeg / 45 + 0.1, 0, 1);
      const lift = -Math.cos(f * Math.PI) * 0.5 + 0.5;
      const s = Math.sin(Math.sqrt(swing) * Math.PI);
      c.translate(0, 0.1 * s, -0.4 * Math.sin(Math.sqrt(swing) * Math.PI));
      c.translate(0, 0.04 + down * -1.2 + lift * -0.5, -0.72);
      c.rotateX(lift * -85);
      c.rotateX(s * 20);
      c.scale(0.76);
      lightColor(state.skyLight, state.blockLight, worldUniforms.uSkyLight.value, this.light);
      this.mapDisplay.update(state.map, this.light);
      display = this.mapDisplay.group;
    } else if (this.shownId === 0 || !this.shown) {
      // Main nue : bras droit du joueur
      display = this.arm;
      const r = Math.sin(Math.sqrt(swing) * Math.PI);
      c.translate(-0.3 * r, 0.4 * Math.sin(Math.sqrt(swing) * Math.PI * 2), -0.4 * Math.sin(swing * Math.PI));
      c.translate(0.64, -0.6, -0.72);
      c.translate(0, down * -0.6, 0);
      c.rotateY(45);
      c.rotateY(r * 70);
      c.rotateZ(Math.sin(swing * swing * Math.PI) * -20);
      c.translate(-1, 3.6, 3.5);
      c.rotateZ(120);
      c.rotateX(200);
      c.rotateY(-135);
      c.translate(5.6, 0, 0);
      // Épaule du modèle de Minecraft, léger écart du bras, puis passage de son repère (y vers le bas) au nôtre
      c.translate(-5 / 16, 2 / 16, 0);
      c.rotateZ(0.1 * RAD_TO_DEG);
      c.scale(1, -1, -1);
      lightColor(state.skyLight, state.blockLight, worldUniforms.uSkyLight.value, this.light);
      (this.armMaterial.uniforms.uColor.value as THREE.Color).copy(this.light);
    } else {
      let shown = this.shown;
      const progress = clamp(state.useProgress, 0, 1);
      if (using === 'eat') {
        // L'objet vient vers la bouche et tremble
        const left = 1 - progress;
        const shake = left < 0.8 ? Math.abs(Math.cos(this.useTime * 5 * Math.PI) * 0.1) : 0;
        const f = 1 - Math.pow(left, 27);
        c.translate(0, shake, 0);
        c.translate(f * 0.6, f * -0.5, 0);
        c.rotateY(f * 90);
        c.rotateX(f * 10);
        c.rotateZ(f * 30);
        this.transformItem(down, 0);
      } else if (using === 'bow') {
        // L'arc se redresse et recule à mesure qu'on le tend
        this.transformItem(down, 0);
        c.rotateZ(-18);
        c.rotateY(-12);
        c.rotateX(-8);
        c.translate(-0.9, 0.2, 0);
        if (progress > 0.1) c.translate(0, Math.sin((this.useTime * 20 - 0.1) * 1.3) * (progress - 0.1) * 0.01, 0);
        c.translate(0, 0, progress * 0.1);
        c.scale(1, 1, 1 + progress * 0.2);
        if (this.shownId === I.BOW) shown = this.bowStage(progress) ?? shown;
      } else {
        if (this.shownId === I.FISHING_ROD && state.fishing) shown = this.castRod();
        if (state.iconTile >= 0 && (this.shownId === I.COMPASS || this.shownId === I.CLOCK)) shown = this.dial(state.iconTile);
        swing *= 1 - this.blockBlend;
        const r = Math.sin(Math.sqrt(swing) * Math.PI);
        c.translate(-0.4 * r, 0.2 * Math.sin(Math.sqrt(swing) * Math.PI * 2), -0.2 * Math.sin(swing * Math.PI));
        this.transformItem(down, swing);
        if (this.blockBlend > 0) {
          // Parade à l'épée
          const b = this.blockBlend;
          c.translate(-0.5 * b, 0.2 * b, 0);
          c.rotateY(30 * b);
          c.rotateX(-80 * b);
          c.rotateY(60 * b);
        }
      }
      // Présentation : un bloc est un cube de 0,4 vu de trois quarts ; un objet plat est tourné de profil et incliné
      if (!shown.model.isBlock) c.scale(2).translate(0, 4 / 16, 2 / 16).rotateY(-135).rotateZ(25).scale(0.85);
      shown.model.setLight(state.skyLight, state.blockLight);
      display = shown.group;
    }

    if (display !== this.current) {
      this.current.visible = false;
      this.current = display;
    }
    display.visible = true;
    this.holder.matrix.copy(c.matrix);
    this.holder.matrixWorldNeedsUpdate = true;

    if (this.offShown) {
      this.offHolder.visible = true;
      const oc = this.offChain.identity();
      if (state.useKind === 'block' && this.offTargetId === I.SHIELD && this.targetId !== I.SHIELD) {
        oc.translate(-0.34, -0.44, -0.68).rotateY(18).rotateX(8);
      } else {
        oc.translate(-0.56, -0.52, -0.72);
      }
      if (!this.offShown.model.isBlock) oc.scale(2).translate(0, 4 / 16, 2 / 16).rotateY(135).rotateZ(-25).scale(0.85);
      else oc.rotateY(45).scale(0.4);
      this.offShown.model.setLight(state.skyLight, state.blockLight);
      this.offHolder.matrix.copy(oc.matrix);
      this.offHolder.matrixWorldNeedsUpdate = true;
    } else {
      this.offHolder.visible = false;
    }
  }

  /** Efface la profondeur puis dessine la main par-dessus l'image, sans effacer la couleur. */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.disposeShown();
    if (this.offShown) {
      this.offShown.group.removeFromParent();
      this.offShown.model.dispose();
      this.offShown = null;
    }
    this.mapDisplay.dispose();
    this.armMaterial.dispose();
    this.holder.clear();
    this.offHolder.clear();
  }
}
