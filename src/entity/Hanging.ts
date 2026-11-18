/**
 * Entités accrochées aux murs : tableaux décoratifs et cadres d'objets.
 */
import { BLOCK_REPLACEABLE, BLOCK_SOLID, FACING_DX, FACING_DZ } from '../world/Blocks';
import { CHUNK_HEIGHT } from '../world/Constants';
import { B, I } from '../world/Ids';
import { cloneStackWithCount, makeStack, sanitizeEnchants, type ItemStack } from '../world/ItemStack';
import type { World } from '../world/World';
import { Entity, num, type DamageCause, type EntityData, type GameApi, type PlayerLike } from './Entity';
import type { EntityKind } from './EntityView';

export interface PaintingMotif {
  readonly key: string;
  readonly label: string;
  /** Largeur et hauteur en blocs. */
  readonly w: number;
  readonly h: number;
}

/** Série de tableaux disponibles (1×1, 2×1, 1×2 et 2×2 blocs). */
export const PAINTINGS: readonly PaintingMotif[] = [
  { key: 'kebab', label: 'Kebab', w: 1, h: 1 },
  { key: 'aztec', label: 'Aztèque', w: 1, h: 1 },
  { key: 'bomb', label: 'Bombe', w: 1, h: 1 },
  { key: 'plant', label: 'Plante', w: 1, h: 1 },
  { key: 'wasteland', label: 'Terre désolée', w: 1, h: 1 },
  { key: 'courbet', label: 'Courbet', w: 2, h: 1 },
  { key: 'sunset', label: 'Coucher de soleil', w: 2, h: 1 },
  { key: 'creebet', label: "Creeper au bord de l'eau", w: 2, h: 1 },
  { key: 'wanderer', label: 'Voyageur', w: 1, h: 2 },
  { key: 'skull_and_roses', label: 'Crâne et roses', w: 2, h: 2 },
];

export function clampFacing(f: number): number {
  return ((Math.floor(f) % 4) + 4) & 3;
}

/** Axe horizontal (+droite quand on regarde l'entité de face) pour une direction 0..3. */
export function hangingRight(facing: number): readonly [number, number] {
  const f = clampFacing(facing);
  return [FACING_DZ[f], -FACING_DX[f]];
}

export abstract class HangingEntity extends Entity {
  /** Cellule occupée devant le mur d'appui (coin bas-gauche face au tableau). */
  anchorX = 0;
  anchorY = 0;
  anchorZ = 0;
  facing = 0;
  tilesW = 1;
  tilesH = 1;

  get pickable(): boolean {
    return true;
  }

  get persistent(): boolean {
    return true;
  }

  protected placeAtAnchor(ax: number, ay: number, az: number, facing: number, w: number, h: number): void {
    this.anchorX = ax;
    this.anchorY = ay;
    this.anchorZ = az;
    this.facing = clampFacing(facing);
    this.tilesW = w;
    this.tilesH = h;
    const dx = FACING_DX[this.facing];
    const dz = FACING_DZ[this.facing];
    const [rx, rz] = hangingRight(this.facing);
    const cx = ax + 0.5 + rx * (w - 1) * 0.5 - dx * (0.5 - 1 / 32);
    const cz = az + 0.5 + rz * (w - 1) * 0.5 - dz * (0.5 - 1 / 32);
    this.width = w;
    this.height = h;
    this.setPosition(cx, ay, cz);
    this.setRotation(Math.atan2(dx, dz), 0);
  }

  override pickBounds(out: number[]): boolean {
    const dx = FACING_DX[this.facing];
    const dz = FACING_DZ[this.facing];
    const hw = this.tilesW * 0.5;
    const xHalf = dx !== 0 ? 0.06 : hw;
    const zHalf = dz !== 0 ? 0.06 : hw;
    out[0] = this.x - xHalf;
    out[1] = this.y;
    out[2] = this.z - zHalf;
    out[3] = this.x + xHalf;
    out[4] = this.y + this.tilesH;
    out[5] = this.z + zHalf;
    return true;
  }

  isSupported(w: World): boolean {
    return hangingFits(w, null, this.anchorX, this.anchorY, this.anchorZ, this.facing, this.tilesW, this.tilesH, this);
  }

  override tick(game: GameApi): void {
    this.beginTick();
    if (this.age % 5 === 0 && !this.isSupported(game.world)) {
      this.popOff(game, true);
      return;
    }
    this.updateLight(game.world);
  }

  protected abstract popOff(game: GameApi, dropSelf: boolean): void;
}

/** Vérifie qu'un cadre ou tableau w×h peut tenir devant son mur sans chevaucher un autre objet accroché. */
export function hangingFits(
  world: World,
  entities: readonly Entity[] | null,
  ax: number,
  ay: number,
  az: number,
  facing: number,
  w: number,
  h: number,
  ignore?: Entity,
): boolean {
  const f = clampFacing(facing);
  const dx = FACING_DX[f];
  const dz = FACING_DZ[f];
  const [rx, rz] = hangingRight(f);
  for (let v = 0; v < h; v++) {
    const cy = ay + v;
    if (cy < 0 || cy >= CHUNK_HEIGHT) return false;
    for (let u = 0; u < w; u++) {
      const cx = ax + rx * u;
      const cz = az + rz * u;
      const front = world.getBlock(cx, cy, cz);
      if (front !== B.AIR && BLOCK_REPLACEABLE[front] !== 1) return false;
      const back = world.getBlock(cx - dx, cy, cz - dz);
      if (BLOCK_SOLID[back] !== 1) return false;
    }
  }
  if (!entities) return true;
  const minX = Math.min(ax, ax + rx * (w - 1));
  const maxX = Math.max(ax, ax + rx * (w - 1)) + 1;
  const minZ = Math.min(az, az + rz * (w - 1));
  const maxZ = Math.max(az, az + rz * (w - 1)) + 1;
  const bounds: number[] = [];
  for (const e of entities) {
    if (e === ignore || e.dead || !(e instanceof HangingEntity)) continue;
    if (e.facing !== f) continue;
    if (!e.pickBounds(bounds)) continue;
    if (bounds[3] > minX && bounds[0] < maxX && bounds[4] > ay && bounds[1] < ay + h && bounds[5] > minZ && bounds[2] < maxZ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------- tableau

export class Painting extends HangingEntity {
  readonly kind: EntityKind = 'painting';

  constructor(ax = 0, ay = 0, az = 0, facing = 0, motifIndex = 0) {
    super();
    const idx = motifIndex >= 0 && motifIndex < PAINTINGS.length ? Math.floor(motifIndex) : 0;
    const motif = PAINTINGS[idx];
    this.variant = idx;
    this.placeAtAnchor(ax, ay, az, facing, motif.w, motif.h);
  }

  /** Choisit aléatoirement le plus grand motif qui tient sur le mur, comme dans Minecraft 1.12. */
  static tryCreate(world: World, entities: readonly Entity[], ax: number, ay: number, az: number, facing: number, rng: () => number): Painting | null {
    const fitting: Array<{ idx: number; area: number }> = [];
    let bestArea = 0;
    for (let i = 0; i < PAINTINGS.length; i++) {
      const m = PAINTINGS[i];
      if (!hangingFits(world, entities, ax, ay, az, facing, m.w, m.h)) continue;
      const area = m.w * m.h;
      if (area > bestArea) bestArea = area;
      fitting.push({ idx: i, area });
    }
    if (fitting.length === 0) return null;
    const best = fitting.filter((c) => c.area === bestArea);
    const chosen = best[Math.floor(rng() * best.length)];
    return new Painting(ax, ay, az, facing, chosen.idx);
  }

  override hurt(game: GameApi, _amount: number, _cause: DamageCause, attacker: Entity | null = null): boolean {
    if (this.dead) return false;
    const creative = (attacker as { creative?: boolean } | null)?.creative === true;
    this.popOff(game, !creative);
    return true;
  }

  protected override popOff(game: GameApi, dropSelf: boolean): void {
    if (this.dead) return;
    this.dead = true;
    game.blockSound('break', B.OAK_PLANKS, this.x, this.y + this.height * 0.5, this.z);
    if (dropSelf) game.dropItem(this.x, this.y + this.height * 0.5, this.z, I.PAINTING, 1);
  }

  override save(): EntityData {
    const d = this.saveBase('painting');
    d.ax = this.anchorX;
    d.ay = this.anchorY;
    d.az = this.anchorZ;
    d.facing = this.facing;
    d.motif = this.variant;
    return d;
  }

  static load(d: EntityData): Painting {
    const p = new Painting(
      num(d.ax, Math.floor(d.x)),
      num(d.ay, Math.floor(d.y)),
      num(d.az, Math.floor(d.z)),
      num(d.facing, 0),
      num(d.motif, 0),
    );
    p.loadBase(d);
    p.placeAtAnchor(p.anchorX, p.anchorY, p.anchorZ, p.facing, p.tilesW, p.tilesH);
    return p;
  }
}

// ---------------------------------------------------------------------------------------- cadre

export class ItemFrame extends HangingEntity {
  readonly kind: EntityKind = 'item_frame';
  framed: ItemStack | null = null;
  frameRotation = 0;

  constructor(ax = 0, ay = 0, az = 0, facing = 0) {
    super();
    this.placeAtAnchor(ax, ay, az, facing, 1, 1);
  }

  setFramed(stack: ItemStack | null, rot = 0): void {
    this.framed = stack ? cloneStackWithCount(stack, 1) : null;
    this.frameRotation = ((Math.floor(rot) % 8) + 8) & 7;
    this.itemId = this.framed ? this.framed.id : 0;
    this.variant = this.frameRotation;
  }

  override interact(game: GameApi, player: PlayerLike): boolean {
    if (this.dead) return false;
    if (!this.framed) {
      const held = player.inventory?.held;
      if (!held || held.id <= 0 || held.count <= 0) return false;
      this.setFramed(held, 0);
      player.consumeHeld(1);
      game.sound('click', this.x, this.y + 0.5, this.z, 0.7, 1.1);
      return true;
    }
    this.setFramed(this.framed, (this.frameRotation + 1) & 7);
    game.sound('click', this.x, this.y + 0.5, this.z, 0.7, 1.25);
    return true;
  }

  override hurt(game: GameApi, _amount: number, _cause: DamageCause, attacker: Entity | null = null): boolean {
    if (this.dead) return false;
    const creative = (attacker as { creative?: boolean } | null)?.creative === true;
    if (this.framed) {
      if (!creative) this.dropFramed(game);
      this.setFramed(null, 0);
      game.sound('pop', this.x, this.y + 0.5, this.z, 0.6, 0.9);
      return true;
    }
    this.popOff(game, !creative);
    return true;
  }

  private dropFramed(game: GameApi): void {
    if (!this.framed) return;
    if (game.dropStack) game.dropStack(this.x, this.y + 0.5, this.z, this.framed);
    else game.dropItem(this.x, this.y + 0.5, this.z, this.framed.id, 1, this.framed.damage);
  }

  protected override popOff(game: GameApi, dropSelf: boolean): void {
    if (this.dead) return;
    this.dead = true;
    game.blockSound('break', B.OAK_PLANKS, this.x, this.y + 0.5, this.z);
    if (this.framed) {
      this.dropFramed(game);
      this.setFramed(null, 0);
    }
    if (dropSelf) game.dropItem(this.x, this.y + 0.5, this.z, I.ITEM_FRAME, 1);
  }

  override save(): EntityData {
    const d = this.saveBase('item_frame');
    d.ax = this.anchorX;
    d.ay = this.anchorY;
    d.az = this.anchorZ;
    d.facing = this.facing;
    d.rot = this.frameRotation;
    if (this.framed) {
      d.item = {
        id: this.framed.id,
        damage: this.framed.damage,
        ...(this.framed.enchants ? { enchants: { ...this.framed.enchants } } : {}),
        ...(this.framed.potion ? { potion: this.framed.potion } : {}),
      };
    }
    return d;
  }

  static load(d: EntityData): ItemFrame {
    const f = new ItemFrame(
      num(d.ax, Math.floor(d.x)),
      num(d.ay, Math.floor(d.y)),
      num(d.az, Math.floor(d.z)),
      num(d.facing, 0),
    );
    f.loadBase(d);
    f.placeAtAnchor(f.anchorX, f.anchorY, f.anchorZ, f.facing, 1, 1);
    const raw = d.item as { id?: unknown; damage?: unknown; enchants?: unknown; potion?: unknown } | undefined;
    if (raw && typeof raw.id === 'number' && raw.id > 0) {
      const potion = typeof raw.potion === 'string' && raw.potion.length > 0 && raw.potion.length <= 40 ? raw.potion : undefined;
      f.setFramed(makeStack(raw.id, 1, num(raw.damage, 0), sanitizeEnchants(raw.enchants), potion), num(d.rot, 0));
    }
    return f;
  }
}
