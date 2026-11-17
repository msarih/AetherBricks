/**
 * Interaction du joueur avec le monde : visée, minage, pose de blocs, activation (portes, coffres…),
 * utilisation des objets (nourriture, arc, canne à pêche, seaux, briquet, houe…) et attaque des entités.
 *
 * `tick()` tourne à 20 ticks par seconde (logique) ; `frame()` à chaque image (contour du bloc visé).
 */
import { Living, type Entity, type GameApi } from '../entity/Entity';
import { notifyTamedWolves } from '../entity/Mobs';
import { Arrow, FishingBobber, Thrown } from '../entity/Objects';
import type { Input } from '../player/Input';
import { attackDamage, type Player } from '../player/Player';
import type { HandRenderer } from '../render/HandRenderer';
import type { Selection } from '../render/Selection';
import type { UiApi } from '../ui/UiApi';
import { applyBonemeal, canStay, fireCanStay, neighborChanged, topSolid } from '../world/Behavior';
import { META_DOOR_HINGE_RIGHT, META_DOOR_OPEN, META_DOOR_UPPER, ccw, collisionBoxes, cw, opposite } from '../world/BlockModels';
import {
  BLOCKS,
  BLOCK_REPLACEABLE,
  BLOCK_SHAPE,
  BLOCK_SOLID,
  FACING_DX,
  FACING_DZ,
  ROT,
  SHAPE,
  TINT,
  isCrop,
  isDoor,
  isFluid,
  isLeaves,
  particleTile,
} from '../world/Blocks';
import { CHUNK_HEIGHT, FACE_DOWN, FACE_DX, FACE_DY, FACE_DZ, FACE_EAST, FACE_NORTH, FACE_SOUTH, FACE_UP, FACE_WEST } from '../world/Constants';
import { blockDrops, canHarvest, miningSpeed, type Drop } from '../world/Drops';
import { enchantLevel } from '../world/Enchants';
import { B, I } from '../world/Ids';
import { getItem, isTool } from '../world/Items';
import { cloneStackWithCount, makeStack } from '../world/ItemStack';
import { newRayHit, rayBoxDistance, raycast } from '../world/Raycast';
import { getChest, getFurnace } from './BlockEntities';
import { AnvilMenu, ChestMenu, CraftingMenu, EnchantMenu, FurnaceMenu, HOTBAR_SIZE, type Menu, type XpHost } from './Inventory';

/** Ce dont l'interaction a besoin, en plus du contrat des entités. Implémenté par Game. */
export interface InteractionHost extends GameApi {
  readonly player: Player;
  readonly ui: UiApi;
  readonly selection: Selection;
  readonly hand: HandRenderer;
  readonly input: Input;
  /** La tête du joueur est-elle sous l'eau ? */
  readonly headInWater: boolean;
  /** Éclats du bloc frappé, sur la face visée. */
  blockHitParticles(x: number, y: number, z: number, face: number, id: number, meta: number): void;
  /** Ouvre un écran de cases (et libère la souris). */
  openMenu(menu: Menu): void;
  /** Le joueur clique sur un lit. */
  trySleep(x: number, y: number, z: number, meta: number): void;
}

/** Portée de la main, en blocs. */
const REACH_SURVIVAL = 4.5;
const REACH_CREATIVE = 5;
const ENTITY_REACH_SURVIVAL = 3;
const ENTITY_REACH_CREATIVE = 4.5;
/** Durée d'un repas, en ticks. */
const EAT_TICKS = 32;
/** Ticks entre deux blocs cassés / deux clics droits répétés. */
const BREAK_DELAY = 5;
const USE_DELAY = 4;

/** Direction (facing) pointée par la normale d'une face latérale, -1 pour le haut / le bas. */
function faceFacing(face: number): number {
  switch (face) {
    case FACE_SOUTH:
      return 0;
    case FACE_WEST:
      return 1;
    case FACE_NORTH:
      return 2;
    case FACE_EAST:
      return 3;
    default:
      return -1;
  }
}

const ORE_XP = new Set<number>([B.COAL_ORE, B.DIAMOND_ORE, B.EMERALD_ORE, B.LAPIS_ORE, B.REDSTONE_ORE]);

export class Interaction {
  /** Bloc visé (valide si `hasBlock`). */
  readonly hit = newRayHit();
  hasBlock = false;
  /** Entité visée (prioritaire sur le bloc). */
  entity: Entity | null = null;

  private readonly fluidHit = newRayHit();
  private readonly look = { x: 0, y: 0, z: 1 };
  private readonly boxes: number[] = [];
  private readonly tmp: number[] = [];

  /** Minage en cours. */
  private mining = false;
  private bx = 0;
  private by = 0;
  private bz = 0;
  private breakProgress = 0;
  private breakTicks = 0;
  private breakDelay = 0;
  private useDelay = 0;
  /** Objet en cours d'utilisation (repas, arc) : un changement d'objet l'interrompt. */
  private useItem = 0;
  private useSlot = 0;
  /** Le clic droit en cours vient d'être pressé (et non répété parce que le bouton est tenu). */
  private freshClick = false;
  /** Flotteur de la canne à pêche, tant que la ligne est lancée. */
  private bobber: FishingBobber | null = null;

  constructor(private readonly game: InteractionHost) {}

  // ------------------------------------------------------------------ visée

  /** La ligne de la canne à pêche est-elle lancée ? */
  get fishing(): boolean {
    return this.bobber !== null && !this.bobber.dead;
  }

  private reach(): number {
    return this.game.player.creative ? REACH_CREATIVE : REACH_SURVIVAL;
  }

  private updateTarget(ex: number, ey: number, ez: number): void {
    const g = this.game;
    const p = g.player;
    const l = this.look;
    p.look(l);
    this.hasBlock = raycast(g.world, ex, ey, ez, l.x, l.y, l.z, this.reach(), this.hit);

    let best = this.hasBlock ? this.hit.dist : p.creative ? ENTITY_REACH_CREATIVE : ENTITY_REACH_SURVIVAL;
    best = Math.min(best, p.creative ? ENTITY_REACH_CREATIVE : ENTITY_REACH_SURVIVAL);
    let found: Entity | null = null;
    for (const e of g.entities) {
      if (e === p || e.dead || !e.pickable) continue;
      const hw = e.width / 2 + 0.1;
      const d = rayBoxDistance(ex, ey, ez, l.x, l.y, l.z, e.x - hw, e.y - 0.1, e.z - hw, e.x + hw, e.y + e.height + 0.1, e.z + hw, best);
      if (d >= 0 && d <= best) {
        best = d;
        found = e;
      }
    }
    this.entity = found;
  }

  /** À chaque image : cible depuis l'œil interpolé, contour et fissures du bloc visé. */
  frame(alpha: number): void {
    const g = this.game;
    const p = g.player;
    if (!p.alive || p.sleeping || g.ui.modal) {
      g.selection.hide();
      return;
    }
    const ex = p.px + (p.x - p.px) * alpha;
    const ey = p.py + (p.y - p.py) * alpha + p.pEyeHeight + (p.eyeHeight - p.pEyeHeight) * alpha;
    const ez = p.pz + (p.z - p.pz) * alpha;
    this.updateTarget(ex, ey, ez);
    if (this.hasBlock && !this.entity) {
      const h = this.hit;
      this.boxes.length = 0;
      g.world.selectionBoxesAt(h.x, h.y, h.z, this.boxes);
      const same = this.mining && h.x === this.bx && h.y === this.by && h.z === this.bz;
      g.selection.show(h.x, h.y, h.z, this.boxes, same ? Math.min(1, this.breakProgress) : 0);
    } else {
      g.selection.hide();
    }
  }

  /** Abandonne le minage et l'utilisation en cours. */
  reset(): void {
    this.mining = false;
    this.breakProgress = 0;
    this.breakTicks = 0;
    const p = this.game.player;
    if (p.useKind !== 'none') p.stopUsing();
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    const g = this.game;
    const p = g.player;
    const input = g.input;
    const leftClick = input.presses[0] > 0;
    const middleClick = input.presses[1] > 0;
    const rightClick = input.presses[2] > 0;
    input.presses[0] = input.presses[1] = input.presses[2] = 0;

    if (!p.alive || p.sleeping || g.ui.modal) {
      this.reset();
      return;
    }
    this.updateTarget(p.x, p.y + p.eyeHeight, p.z);
    if (this.breakDelay > 0) this.breakDelay--;
    if (this.useDelay > 0) this.useDelay--;

    this.tickUse(input.buttons[2]);

    if (middleClick) this.pickBlock();

    if (leftClick && p.useKind === 'none') {
      this.swing();
      if (this.entity) this.attack(this.entity);
      else if (!this.hasBlock) g.sound('attack_miss', p.x, p.y + p.eyeHeight, p.z, 0.4, 0.9 + g.rng() * 0.2);
    }

    // un clic bref (bouton déjà relâché au tick suivant) compte aussi : casse immédiate en créatif, herbes, torches…
    if ((input.buttons[0] || leftClick) && p.useKind === 'none' && this.hasBlock && !this.entity) this.mine(leftClick);
    else {
      this.mining = false;
      this.breakProgress = 0;
    }

    if (this.bobber && this.bobber.dead) this.bobber = null;
    if ((rightClick || (input.buttons[2] && this.useDelay === 0)) && p.useKind === 'none') {
      this.freshClick = rightClick;
      if (this.rightClick()) this.useDelay = USE_DELAY;
    }
  }

  private swing(): void {
    this.game.player.swingArm();
    this.game.hand.swing();
  }

  // ------------------------------------------------------------------ minage

  private mine(clicked: boolean): void {
    const g = this.game;
    const p = g.player;
    const h = this.hit;
    const id = h.id;
    const def = BLOCKS[id];
    if (isFluid(id)) return;

    if (p.creative) {
      if (clicked || this.breakDelay === 0) {
        this.breakTarget(h.x, h.y, h.z);
        this.breakDelay = BREAK_DELAY;
        this.swing();
      }
      return;
    }

    if (!this.mining || h.x !== this.bx || h.y !== this.by || h.z !== this.bz) {
      this.mining = true;
      this.bx = h.x;
      this.by = h.y;
      this.bz = h.z;
      this.breakProgress = 0;
      this.breakTicks = 0;
    }
    if (this.breakDelay > 0) return;
    if (def.hardness < 0) {
      if ((this.breakTicks++ & 3) === 0) this.swing();
      return;
    }

    const held = p.heldItemId;
    const eff = enchantLevel(p.inventory.held, 'efficiency');
    let damage: number;
    if (def.hardness === 0) damage = 1;
    else {
      damage = miningSpeed(id, held, eff) / def.hardness / (canHarvest(id, held) ? 30 : 100);
      if (g.headInWater) damage /= 5;
      if (!p.onGround) damage /= 5;
    }
    this.breakProgress += damage;

    if ((this.breakTicks & 3) === 0) {
      this.swing();
      g.blockHitParticles(h.x, h.y, h.z, h.face, id, h.meta);
      g.blockSound('hit', id, h.x + 0.5, h.y + 0.5, h.z + 0.5);
    }
    this.breakTicks++;

    if (this.breakProgress >= 1) {
      this.breakTarget(h.x, h.y, h.z);
      this.mining = false;
      this.breakProgress = 0;
      this.breakTicks = 0;
      // un bloc cassé d'un seul coup n'impose pas d'attente
      this.breakDelay = damage >= 1 ? 0 : BREAK_DELAY;
    }
  }

  /** Casse le bloc au nom du joueur : effet, butin selon l'outil tenu, usure. */
  private breakTarget(x: number, y: number, z: number): void {
    const g = this.game;
    const w = g.world;
    const p = g.player;
    const v = w.getBlockAndMeta(x, y, z);
    const id = v & 255;
    const meta = v >> 8;
    if (id === B.AIR || isFluid(id)) return;
    const def = BLOCKS[id];
    if (def.hardness < 0 && !p.creative) return;
    const held = p.heldItemId;
    const creative = p.creative;

    w.host.effect('break', x, y, z, id, meta);
    let drops: Drop[] = [];

    const heldStack = p.inventory.held;
    const fortune = enchantLevel(heldStack, 'fortune');
    const silkTouch = enchantLevel(heldStack, 'silk_touch') > 0;

    if (isDoor(id)) {
      // les deux moitiés partent ensemble, un seul butin
      const ly = meta & META_DOOR_UPPER ? y - 1 : y;
      if (!creative) drops = blockDrops(id, meta & ~META_DOOR_UPPER, held, g.rng, fortune, silkTouch);
      if (w.getBlock(x, ly, z) === id) w.setBlock(x, ly, z, B.AIR, 0, false);
      if (w.getBlock(x, ly + 1, z) === id) w.setBlock(x, ly + 1, z, B.AIR, 0, false);
      this.notifyAround(x, ly, z);
      this.notifyAround(x, ly + 1, z);
    } else if (id === B.BED) {
      const d = meta & 3;
      const s = meta & 4 ? -1 : 1;
      const ox = x + FACING_DX[d] * s;
      const oz = z + FACING_DZ[d] * s;
      if (!creative) drops = blockDrops(B.BED, meta | 4, held, g.rng, fortune, silkTouch);
      w.setBlock(x, y, z, B.AIR, 0, false);
      if (w.getBlock(ox, y, oz) === B.BED) w.setBlock(ox, y, oz, B.AIR, 0, false);
      this.notifyAround(x, y, z);
      this.notifyAround(ox, y, oz);
    } else {
      if (!creative) drops = blockDrops(id, meta, held, g.rng, fortune, silkTouch);
      if (id === B.ICE && !creative && drops.length === 0) {
        const below = w.getBlock(x, y - 1, z);
        w.setBlock(x, y, z, BLOCK_SOLID[below] === 1 || isFluid(below) ? B.WATER : B.AIR, 0);
      } else {
        w.setBlock(x, y, z, B.AIR, 0);
      }
    }

    for (const d of drops) g.dropItem(x + 0.5, y + 0.5, z + 0.5, d.id, d.count);
    if (!creative) {
      if (ORE_XP.has(id) && drops.length > 0 && drops[0].id !== id) p.addXp(1 + Math.floor(g.rng() * 3));
      if (isTool(held) && def.hardness > 0) p.damageHeld(g);
      p.exhaustion += 0.005;
    }
  }

  private notifyAround(x: number, y: number, z: number): void {
    const w = this.game.world;
    neighborChanged(w, x, y, z);
    w.notifyNeighbors(x, y, z);
  }

  // ------------------------------------------------------------------ attaque

  private attack(e: Entity): void {
    const g = this.game;
    const p = g.player;
    const held = p.heldItemId;
    let damage = attackDamage(held);
    const sharp = enchantLevel(p.inventory.held, 'sharpness');
    if (sharp > 0) damage += 0.5 * sharp + 0.5;
    const crit = p.fallDistance > 0 && !p.onGround && !p.inWater && !p.onLadder && !p.flying;
    if (crit) damage *= 1.5;
    const ok = e.hurt(g, damage, 'attack', p);
    const ey = e.y + e.height * 0.6;
    if (ok) {
      if (e instanceof Living) notifyTamedWolves(g, e);
      g.sound(crit ? 'attack_crit' : 'attack', e.x, ey, e.z, 0.7, 0.9 + g.rng() * 0.2);
      if (crit) g.particles('crit', e.x, ey, e.z, 8, 0.4);
      if (isTool(held)) p.damageHeld(g);
      if (!p.creative) p.exhaustion += 0.1;
      if (p.sprinting && e instanceof Living) {
        e.knockback(e.x - p.x, e.z - p.z, 0.4);
        p.sprinting = false;
      }
    } else {
      g.sound('attack_miss', p.x, p.y + p.eyeHeight, p.z, 0.4, 0.9 + g.rng() * 0.2);
    }
  }

  // ------------------------------------------------------------------ utilisation continue (repas, arc)

  private tickUse(rightDown: boolean): void {
    const g = this.game;
    const p = g.player;
    if (p.useKind === 'none') return;
    const held = p.heldItemId;
    if (held !== this.useItem || p.inventory.selected !== this.useSlot) {
      p.stopUsing();
      return;
    }
    if (!rightDown) {
      if (p.useKind === 'bow') this.releaseBow();
      p.stopUsing();
      return;
    }
    p.useTicks++;
    if (p.useKind !== 'eat') return;

    const drink = held === I.MILK_BUCKET;
    if (p.useTicks % 4 === 0) {
      const l = this.look;
      p.look(l);
      const x = p.x + l.x * 0.35;
      const y = p.y + p.eyeHeight - 0.25 + l.y * 0.35;
      const z = p.z + l.z * 0.35;
      if (!drink) g.itemParticles(x, y, z, held, 3);
      g.sound(drink ? 'drink' : 'eat', x, y, z, 0.5, 0.9 + g.rng() * 0.3);
    }
    if (p.useTicks >= EAT_TICKS) {
      const item = getItem(held);
      p.feed(item.food, item.saturation);
      g.sound('burp', p.x, p.y + p.eyeHeight, p.z, 0.5, 0.9 + g.rng() * 0.2);
      if (held === I.GOLDEN_APPLE) p.heal(4);
      if (held === I.MUSHROOM_STEW) p.replaceHeld(I.BOWL);
      else if (drink) {
        p.fireTicks = 0;
        p.replaceHeld(I.BUCKET);
      } else p.consumeHeld();
      p.stopUsing();
      this.useDelay = USE_DELAY;
    }
  }

  private releaseBow(): void {
    const g = this.game;
    const p = g.player;
    const t = p.useTicks / 20;
    const power = Math.min(1, (t * t + 2 * t) / 3);
    if (power < 0.1) return;
    if (!p.creative && p.inventory.count(I.ARROW) === 0) return;
    const l = this.look;
    p.look(l);
    const arrow = new Arrow();
    arrow.owner = p;
    arrow.fromPlayer = true;
    arrow.powerLevel = enchantLevel(p.inventory.held, 'power');
    arrow.critical = power >= 1;
    arrow.shoot(p.x + l.x * 0.3, p.y + p.eyeHeight - 0.1, p.z + l.z * 0.3, l.x, l.y, l.z, power * 3, 1, g.rng);
    g.spawn(arrow);
    g.sound('bow', p.x, p.y + p.eyeHeight, p.z, 0.8, 0.8 + power * 0.4 + g.rng() * 0.2);
    if (!p.creative) p.inventory.remove(I.ARROW, 1);
    p.damageHeld(g);
  }

  private startUse(kind: 'eat' | 'bow'): void {
    const p = this.game.player;
    p.useKind = kind;
    p.useTicks = 0;
    this.useItem = p.heldItemId;
    this.useSlot = p.inventory.selected;
  }

  // ------------------------------------------------------------------ clic droit

  /** Retourne true si une action a eu lieu. */
  private rightClick(): boolean {
    const g = this.game;
    const p = g.player;
    const held = p.heldItemId;

    if (this.entity) {
      if (this.entity.interact(g, p)) {
        this.swing();
        return true;
      }
    } else if (this.hasBlock) {
      if ((!p.input.sneak || held === 0) && this.activate()) {
        this.swing();
        return true;
      }
      if (held !== 0 && this.useOnBlock(held)) {
        this.swing();
        return true;
      }
    }
    return held !== 0 && this.useInAir(held);
  }

  /** Active le bloc visé (porte, coffre, établi…). */
  private activate(): boolean {
    const g = this.game;
    const w = g.world;
    const p = g.player;
    const h = this.hit;
    const { x, y, z, id, meta } = h;

    if (id === B.OAK_DOOR) {
      const ly = meta & META_DOOR_UPPER ? y - 1 : y;
      const lower = w.getBlockAndMeta(x, ly, z);
      const upper = w.getBlockAndMeta(x, ly + 1, z);
      const open = ((lower >> 8) & META_DOOR_OPEN) === 0;
      if ((lower & 255) === id) w.setMeta(x, ly, z, open ? (lower >> 8) | META_DOOR_OPEN : (lower >> 8) & ~META_DOOR_OPEN);
      if ((upper & 255) === id) w.setMeta(x, ly + 1, z, open ? (upper >> 8) | META_DOOR_OPEN : (upper >> 8) & ~META_DOOR_OPEN);
      g.sound(open ? 'door_open' : 'door_close', x + 0.5, ly + 1, z + 0.5, 0.8, 0.9 + g.rng() * 0.2);
      return true;
    }
    if (id === B.LEVER) {
      w.setMeta(x, y, z, meta ^ 8, true);
      g.sound('door_open', x + 0.5, y + 0.5, z + 0.5, 0.5, meta & 8 ? 0.5 : 0.6);
      return true;
    }
    if (id === B.STONE_BUTTON) {
      if (!(meta & 8)) {
        w.setMeta(x, y, z, meta | 8, true);
        w.scheduleTick(x, y, z, 20);
        g.sound('door_open', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.6);
      }
      return true;
    }
    if (id === B.TRAPDOOR || id === B.FENCE_GATE) {
      const open = (meta & 4) === 0;
      let m = meta ^ 4;
      // un portillon s'ouvre à l'opposé du joueur
      if (id === B.FENCE_GATE && open) {
        const pf = this.playerFacing();
        if ((pf & 1) === (meta & 1)) m = (m & ~3) | pf;
      }
      w.setMeta(x, y, z, m);
      g.sound(open ? 'door_open' : 'door_close', x + 0.5, y + 0.5, z + 0.5, 0.8, 0.9 + g.rng() * 0.2);
      return true;
    }
    if (id === B.CHEST) {
      const chest = getChest(w, x, y, z);
      g.openMenu(new ChestMenu(p.inventory, chest, () => w.markBlockEntityDirty(chest)));
      g.sound('chest_open', x + 0.5, y + 0.5, z + 0.5, 0.6, 0.9 + g.rng() * 0.2);
      return true;
    }
    if (id === B.CRAFTING_TABLE) {
      g.openMenu(new CraftingMenu(p.inventory));
      return true;
    }
    if (id === B.FURNACE || id === B.FURNACE_LIT) {
      const furnace = getFurnace(w, x, y, z);
      g.openMenu(new FurnaceMenu(p.inventory, furnace, () => w.markBlockEntityDirty(furnace)));
      return true;
    }
    if (id === B.ENCHANTING_TABLE) {
      let bookshelves = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
          const midX = x + Math.sign(dx);
          const midZ = z + Math.sign(dz);
          for (let dy = 0; dy <= 1; dy++) {
            if (w.getBlock(x + dx, y + dy, z + dz) !== B.BOOKSHELF) continue;
            if (w.getBlock(midX, y + dy, midZ) === B.AIR) bookshelves++;
          }
        }
      }
      g.openMenu(new EnchantMenu(p.inventory, Math.min(15, bookshelves), this.xpHost()));
      return true;
    }
    if (id === B.ANVIL) {
      g.openMenu(new AnvilMenu(p.inventory, this.xpHost()));
      return true;
    }
    if (id === B.BED) {
      g.trySleep(x, y, z, meta);
      return true;
    }
    return false;
  }

  private xpHost(): XpHost {
    const g = this.game;
    const p = g.player;
    return {
      get xpLevel() { return p.xpLevel; },
      get creative() { return p.creative; },
      get enchantSeed() { return p.enchantSeed; },
      spendLevels: (n: number) => { p.xpLevel = Math.max(0, p.xpLevel - n); },
      rotateEnchantSeed: () => { p.enchantSeed = (Math.floor(g.rng() * 0xfffffffe) >>> 0) + 1; },
      rng: g.rng,
    };
  }

  /** Direction horizontale du regard : 0 sud (+z), 1 ouest (-x), 2 nord (-z), 3 est (+x). */
  private playerFacing(): number {
    const l = this.look;
    this.game.player.look(l);
    if (Math.abs(l.x) > Math.abs(l.z)) return l.x > 0 ? 3 : 1;
    return l.z > 0 ? 0 : 2;
  }

  /** Utilise l'objet tenu sur le bloc visé. */
  private useOnBlock(held: number): boolean {
    const g = this.game;
    const w = g.world;
    const p = g.player;
    const h = this.hit;
    const item = getItem(held);

    if (held === I.BUCKET || held === I.WATER_BUCKET || held === I.LAVA_BUCKET) return false; // voir useInAir
    if (held === B.LILY_PAD) return false;

    if (held === I.FLINT_AND_STEEL) {
      if (h.id === B.TNT) {
        w.setBlock(h.x, h.y, h.z, B.AIR, 0);
        w.host.primeTnt(h.x, h.y, h.z, 80);
      } else {
        const x = h.x + FACE_DX[h.face];
        const y = h.y + FACE_DY[h.face];
        const z = h.z + FACE_DZ[h.face];
        if (w.getBlock(x, y, z) !== B.AIR || !fireCanStay(w, x, y, z)) return false;
        w.setBlock(x, y, z, B.FIRE, 0);
      }
      g.sound('ignite', h.x + 0.5, h.y + 0.5, h.z + 0.5, 0.8, 0.9 + g.rng() * 0.2);
      p.damageHeld(g);
      return true;
    }

    if (item.tool === 'hoe') {
      if ((h.id !== B.GRASS && h.id !== B.DIRT) || h.face === FACE_DOWN || w.getBlock(h.x, h.y + 1, h.z) !== B.AIR) return false;
      w.setBlock(h.x, h.y, h.z, B.FARMLAND, 0);
      g.blockSound('place', B.GRAVEL, h.x + 0.5, h.y + 1, h.z + 0.5);
      p.damageHeld(g);
      return true;
    }

    if (held === I.BONE_MEAL) {
      if (!applyBonemeal(w, h.x, h.y, h.z)) return false;
      p.consumeHeld();
      return true;
    }

    if (item.places >= 0) return this.place(item.places);
    return false;
  }

  /** Utilise l'objet tenu sans bloc (ou après l'échec de l'usage sur le bloc). */
  private useInAir(held: number): boolean {
    const g = this.game;
    const w = g.world;
    const p = g.player;
    const item = getItem(held);
    const l = this.look;
    p.look(l);
    const ex = p.x;
    const ey = p.y + p.eyeHeight;
    const ez = p.z;

    if (held === I.BUCKET) {
      const f = this.fluidHit;
      if (!raycast(w, ex, ey, ez, l.x, l.y, l.z, this.reach(), f, false, true)) return false;
      if ((f.id !== B.WATER && f.id !== B.LAVA) || f.meta !== 0) return false;
      w.setBlock(f.x, f.y, f.z, B.AIR, 0);
      p.replaceHeld(f.id === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET);
      g.sound('bucket_fill', f.x + 0.5, f.y + 0.5, f.z + 0.5, 0.8);
      this.swing();
      return true;
    }

    if (held === I.WATER_BUCKET || held === I.LAVA_BUCKET) {
      if (!this.hasBlock) return false;
      const h = this.hit;
      let x = h.x;
      let y = h.y;
      let z = h.z;
      if (BLOCK_REPLACEABLE[h.id] !== 1) {
        x += FACE_DX[h.face];
        y += FACE_DY[h.face];
        z += FACE_DZ[h.face];
      }
      if (y < 0 || y >= CHUNK_HEIGHT || BLOCK_REPLACEABLE[w.getBlock(x, y, z)] !== 1) return false;
      w.setBlock(x, y, z, held === I.WATER_BUCKET ? B.WATER : B.LAVA, 0);
      p.replaceHeld(I.BUCKET);
      g.sound('bucket_empty', x + 0.5, y + 0.5, z + 0.5, 0.8);
      this.swing();
      return true;
    }

    if (held === B.LILY_PAD) {
      const f = this.fluidHit;
      if (!raycast(w, ex, ey, ez, l.x, l.y, l.z, this.reach(), f, false, true)) return false;
      if (f.id !== B.WATER && f.id !== B.ICE) return false;
      if (w.getBlock(f.x, f.y + 1, f.z) !== B.AIR) return false;
      w.setBlock(f.x, f.y + 1, f.z, B.LILY_PAD, 0);
      g.blockSound('place', B.LILY_PAD, f.x + 0.5, f.y + 1, f.z + 0.5);
      p.consumeHeld();
      this.swing();
      return true;
    }

    if (held === I.BOW) {
      if (!p.creative && p.inventory.count(I.ARROW) === 0) return false;
      this.startUse('bow');
      return false; // pas de délai : l'arc se bande tant que le bouton est tenu
    }

    if (held === I.FISHING_ROD) {
      // un clic lance la ligne, le suivant la remonte ; tenir le bouton ne répète rien
      if (!this.freshClick) return false;
      const b = this.bobber;
      if (b && !b.dead) {
        const wear = b.reel(g);
        this.bobber = null;
        g.sound('bow', ex, ey, ez, 0.4, 1.3 + g.rng() * 0.2);
        if (wear > 0) p.damageHeld(g, wear);
      } else {
        const nb = new FishingBobber(p);
        nb.cast(ex + l.x * 0.3, ey - 0.1, ez + l.z * 0.3, l.x, l.y, l.z, 1.1);
        g.spawn(nb);
        this.bobber = nb;
        g.sound('bow', ex, ey, ez, 0.5, 0.4 + g.rng() * 0.2);
      }
      this.swing();
      return true;
    }

    if (held === I.EGG || held === I.SNOWBALL) {
      const t = new Thrown(held);
      t.owner = p;
      t.shoot(ex + l.x * 0.3, ey - 0.1, ez + l.z * 0.3, l.x, l.y, l.z, 1.5);
      g.spawn(t);
      g.sound('bow', ex, ey, ez, 0.4, 0.5 + g.rng() * 0.2);
      p.consumeHeld();
      this.swing();
      return true;
    }

    if (item.food > 0 || held === I.MILK_BUCKET) {
      if (p.hunger < 20 || held === I.GOLDEN_APPLE || held === I.MILK_BUCKET) this.startUse('eat');
      return false;
    }
    return false;
  }

  // ------------------------------------------------------------------ pose

  /** La cellule est-elle libre de toute créature pour y poser ce bloc ? */
  private cellFree(x: number, y: number, z: number, id: number, meta: number): boolean {
    if (BLOCK_SOLID[id] !== 1) return true;
    const g = this.game;
    const t = this.tmp;
    t.length = 0;
    collisionBoxes(id, meta, g.world.neighborFn(x, y, z), t);
    for (let i = 0; i < t.length; i += 6) {
      const found = g.entitiesInBox(x + t[i] / 16, y + t[i + 1] / 16, z + t[i + 2] / 16, x + t[i + 3] / 16, y + Math.min(16, t[i + 4]) / 16, z + t[i + 5] / 16, null);
      for (const e of found) if (e instanceof Living && e.alive) return false;
    }
    return true;
  }

  private replaceable(x: number, y: number, z: number): boolean {
    return y >= 0 && y < CHUNK_HEIGHT && BLOCK_REPLACEABLE[this.game.world.getBlock(x, y, z)] === 1;
  }

  private placed(x: number, y: number, z: number, id: number): boolean {
    const g = this.game;
    g.blockSound('place', id, x + 0.5, y + 0.5, z + 0.5);
    g.player.consumeHeld();
    return true;
  }

  /** Pose le bloc `id` contre le bloc visé, orienté selon la face cliquée et le regard. */
  private place(id: number): boolean {
    const g = this.game;
    const w = g.world;
    const h = this.hit;
    const def = BLOCKS[id];
    const shape = def.shape;
    const face = h.face;
    const side = faceFacing(face);
    const pf = this.playerFacing();

    // --- cas qui modifient le bloc visé lui-même ---
    if (shape === SHAPE.SLAB && h.id === id && ((h.meta === 0 && face === FACE_UP) || (h.meta === 1 && face === FACE_DOWN))) {
      if (!this.cellFree(h.x, h.y, h.z, id, 2)) return false;
      w.setBlock(h.x, h.y, h.z, id, 2);
      return this.placed(h.x, h.y, h.z, id);
    }
    if (id === B.SNOW_LAYER && h.id === B.SNOW_LAYER && h.meta < 7) {
      w.setBlock(h.x, h.y, h.z, id, h.meta + 1);
      return this.placed(h.x, h.y, h.z, id);
    }
    if (id === B.VINE && h.id === B.VINE) return false;

    // --- cellule de destination ---
    let x = h.x;
    let y = h.y;
    let z = h.z;
    const onto = BLOCK_REPLACEABLE[h.id] !== 1;
    if (onto) {
      x += FACE_DX[face];
      y += FACE_DY[face];
      z += FACE_DZ[face];
    }
    const there = w.getBlockAndMeta(x, y, z);
    const thereId = there & 255;
    const thereMeta = there >> 8;

    if (shape === SHAPE.SLAB && onto && thereId === id && thereMeta !== 2) {
      if (!this.cellFree(x, y, z, id, 2)) return false;
      w.setBlock(x, y, z, id, 2);
      return this.placed(x, y, z, id);
    }
    if (id === B.SNOW_LAYER && onto && thereId === B.SNOW_LAYER && thereMeta < 7) {
      w.setBlock(x, y, z, id, thereMeta + 1);
      return this.placed(x, y, z, id);
    }
    if (id === B.VINE && onto && thereId === B.VINE && side >= 0) {
      const bit = 1 << opposite(side);
      if (thereMeta & bit) return false;
      w.setBlock(x, y, z, id, thereMeta | bit);
      return this.placed(x, y, z, id);
    }
    if (!this.replaceable(x, y, z)) return false;
    // on ne remplace pas un bloc par lui-même (herbes hautes, feu…)
    if (thereId === id && !isFluid(id)) return false;

    let meta = 0;
    switch (shape) {
      case SHAPE.SLAB: {
        const fy = h.hy - Math.floor(h.hy);
        meta = onto && (face === FACE_DOWN || (side >= 0 && fy > 0.5)) ? 1 : 0;
        break;
      }
      case SHAPE.STAIRS: {
        const fy = h.hy - Math.floor(h.hy);
        meta = pf | (onto && (face === FACE_DOWN || (side >= 0 && fy > 0.5)) ? 4 : 0);
        break;
      }
      case SHAPE.DOOR:
        return this.placeDoor(x, y, z, id, pf);
      case SHAPE.BED:
        return this.placeBed(x, y, z, pf);
      case SHAPE.TRAPDOOR: {
        const fy = h.hy - Math.floor(h.hy);
        if (side >= 0 && onto) meta = side | (fy > 0.5 ? 8 : 0);
        else meta = opposite(pf) | (onto && face === FACE_DOWN ? 8 : 0);
        break;
      }
      case SHAPE.LADDER: {
        meta = -1;
        if (side >= 0 && onto && canStay(w, x, y, z, id, side)) meta = side;
        else for (let f = 0; f < 4 && meta < 0; f++) if (canStay(w, x, y, z, id, f)) meta = f;
        if (meta < 0) return false;
        break;
      }
      case SHAPE.TORCH:
      case SHAPE.LEVER:
      case SHAPE.BUTTON: {
        meta = -1;
        if (side >= 0 && onto && canStay(w, x, y, z, id, side + 1)) meta = side + 1;
        else if (canStay(w, x, y, z, id, 0)) meta = 0;
        else for (let f = 0; f < 4 && meta < 0; f++) if (canStay(w, x, y, z, id, f + 1)) meta = f + 1;
        if (meta < 0) return false;
        break;
      }
      case SHAPE.FENCE_GATE:
        meta = pf;
        break;
      case SHAPE.VINE: {
        if (side < 0 || !onto) return false;
        meta = 1 << opposite(side);
        break;
      }
      default:
        if (id === B.PISTON || id === B.STICKY_PISTON) {
          g.player.look(this.look);
          if (this.look.y > 0.7) meta = 1;
          else if (this.look.y < -0.7) meta = 0;
          else meta = opposite(pf) + 2;
        } else if (def.rot === ROT.AXIS) meta = face === FACE_UP || face === FACE_DOWN || !onto ? 0 : face === FACE_WEST || face === FACE_EAST ? 1 : 2;
        else if (def.rot === ROT.FACING) meta = opposite(pf);
        else if (isLeaves(id)) meta = 1;
        break;
    }

    if (isCrop(id) && w.getBlock(x, y - 1, z) !== B.FARMLAND) return false;
    if (!canStay(w, x, y, z, id, meta)) return false;
    if (!this.cellFree(x, y, z, id, meta)) return false;
    if (!w.setBlock(x, y, z, id, meta)) return false;
    // le bloc a pu être aussitôt refusé par le monde (support manquant…)
    if (w.getBlock(x, y, z) !== id && !def.gravity) return false;
    return this.placed(x, y, z, id);
  }

  private placeDoor(x: number, y: number, z: number, id: number, pf: number): boolean {
    const w = this.game.world;
    if (!this.replaceable(x, y + 1, z) || !topSolid(w, x, y - 1, z)) return false;
    // charnière : à gauche par défaut ; à droite si une porte est déjà à gauche ou s'il y a plus de murs à droite
    const lf = ccw(pf);
    const rf = cw(pf);
    const lx = x + FACING_DX[lf];
    const lz = z + FACING_DZ[lf];
    const rx = x + FACING_DX[rf];
    const rz = z + FACING_DZ[rf];
    const solid = (bx: number, by: number, bz: number): number => (BLOCK_SOLID[w.getBlock(bx, by, bz)] === 1 && BLOCK_SHAPE[w.getBlock(bx, by, bz)] === SHAPE.CUBE ? 1 : 0);
    const left = solid(lx, y, lz) + solid(lx, y + 1, lz);
    const right = solid(rx, y, rz) + solid(rx, y + 1, rz);
    const doorLeft = w.getBlock(lx, y, lz) === id;
    const doorRight = w.getBlock(rx, y, rz) === id;
    let meta = pf;
    if ((doorLeft && !doorRight) || right > left) meta |= META_DOOR_HINGE_RIGHT;
    if (!this.cellFree(x, y, z, id, meta) || !this.cellFree(x, y + 1, z, id, meta | META_DOOR_UPPER)) return false;
    w.setBlock(x, y, z, id, meta, false);
    w.setBlock(x, y + 1, z, id, meta | META_DOOR_UPPER, false);
    this.notifyAround(x, y, z);
    this.notifyAround(x, y + 1, z);
    return this.placed(x, y, z, id);
  }

  private placeBed(x: number, y: number, z: number, pf: number): boolean {
    const w = this.game.world;
    const hx = x + FACING_DX[pf];
    const hz = z + FACING_DZ[pf];
    if (!this.replaceable(hx, y, hz)) return false;
    if (!topSolid(w, x, y - 1, z) || !topSolid(w, hx, y - 1, hz)) return false;
    if (!this.cellFree(x, y, z, B.BED, pf) || !this.cellFree(hx, y, hz, B.BED, pf | 4)) return false;
    w.setBlock(x, y, z, B.BED, pf, false);
    w.setBlock(hx, y, hz, B.BED, pf | 4, false);
    this.notifyAround(x, y, z);
    this.notifyAround(hx, y, hz);
    return this.placed(x, y, z, B.BED);
  }

  // ------------------------------------------------------------------ divers

  /** Clic milieu : sélectionne dans la barre le bloc visé (en créatif, le fait apparaître). */
  pickBlock(): void {
    if (!this.hasBlock || this.entity) return;
    const p = this.game.player;
    const inv = p.inventory;
    let id = this.hit.id;
    if (id === B.WHEAT) id = I.WHEAT_SEEDS;
    else if (id === B.CARROTS) id = I.CARROT;
    else if (id === B.POTATOES) id = I.POTATO;
    else if (id === B.FURNACE_LIT) id = B.FURNACE;
    else if (!BLOCKS[id].hasItem) return;

    const inBar = inv.find(id, 0, HOTBAR_SIZE);
    if (inBar >= 0) {
      inv.selected = inBar;
      return;
    }
    const elsewhere = inv.find(id, HOTBAR_SIZE);
    if (elsewhere >= 0) {
      const tmp = inv.slots[inv.selected];
      inv.slots[inv.selected] = inv.slots[elsewhere];
      inv.slots[elsewhere] = tmp;
      return;
    }
    if (!p.creative) return;
    if (inv.slots[inv.selected]) {
      for (let i = 0; i < HOTBAR_SIZE; i++) {
        if (!inv.slots[i]) {
          inv.selected = i;
          break;
        }
      }
    }
    inv.slots[inv.selected] = makeStack(id, 1);
  }

  /** Lâche l'objet tenu (toute la pile si `all`). */
  dropHeld(all: boolean): void {
    const p = this.game.player;
    const inv = p.inventory;
    const held = inv.slots[inv.selected];
    if (!held || !p.alive) return;
    if (p.useKind !== 'none') p.stopUsing();
    if (all || held.count <= 1) {
      inv.slots[inv.selected] = null;
      inv.drop(held);
    } else {
      held.count--;
      inv.drop(cloneStackWithCount(held, 1));
    }
    this.swing();
  }
}

/** Teinte (0xRRGGBB) des éclats d'un bloc, selon la colonne où il se trouve. */
export function particleTint(game: GameApi, x: number, z: number, id: number): number {
  const def = BLOCKS[id];
  if (def.tint === TINT.FIXED) return def.tintColor;
  if (def.tint === TINT.NONE || id === B.GRASS) return 0xffffff;
  const c = game.world.chunkAt(x, z);
  if (!c) return 0xffffff;
  const o = (((z & 15) << 4) | (x & 15)) * 9 + (def.tint === TINT.FOLIAGE ? 3 : 0);
  return (c.tints[o] << 16) | (c.tints[o + 1] << 8) | c.tints[o + 2];
}

export { particleTile };
