/**
 * Enchantements et enclume : définitions, tirage des propositions, fusion et effets.
 * Module pur (pas de DOM ni de Three.js).
 */
import { B, I } from './Ids';
import { getItem } from './Items';
import { cloneStack, maxDamage, type ItemStack, type Slot } from './ItemStack';

export type EnchantId =
  | 'efficiency'
  | 'unbreaking'
  | 'sharpness'
  | 'protection'
  | 'fortune'
  | 'silk_touch'
  | 'power';

export type Enchants = Partial<Record<EnchantId, number>>;

export interface EnchantDef {
  id: EnchantId;
  name: string;
  maxLevel: number;
}

export const ENCHANT_DEFS: Record<EnchantId, EnchantDef> = {
  efficiency: { id: 'efficiency', name: 'Efficacité', maxLevel: 5 },
  unbreaking: { id: 'unbreaking', name: 'Solidité', maxLevel: 3 },
  sharpness: { id: 'sharpness', name: 'Tranchant', maxLevel: 5 },
  protection: { id: 'protection', name: 'Protection', maxLevel: 4 },
  fortune: { id: 'fortune', name: 'Fortune', maxLevel: 3 },
  silk_touch: { id: 'silk_touch', name: 'Toucher de soie', maxLevel: 1 },
  power: { id: 'power', name: 'Puissance', maxLevel: 5 },
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

export function isEnchantId(k: string): k is EnchantId {
  return k in ENCHANT_DEFS;
}

export function enchantLabel(id: EnchantId, level: number): string {
  const def = ENCHANT_DEFS[id];
  if (def.maxLevel === 1) return def.name;
  const r = ROMAN[level] ?? String(level);
  return `${def.name} ${r}`;
}

export function enchantLines(enchants?: Enchants): string[] {
  if (!enchants) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(enchants)) {
    if (isEnchantId(k) && typeof v === 'number' && v > 0) {
      out.push(enchantLabel(k, v));
    }
  }
  return out;
}

export function cloneEnchants(e?: Enchants): Enchants | undefined {
  if (!e) return undefined;
  const out: Enchants = {};
  let any = false;
  for (const [k, v] of Object.entries(e)) {
    if (isEnchantId(k) && typeof v === 'number' && v > 0) {
      out[k] = Math.floor(v);
      any = true;
    }
  }
  return any ? out : undefined;
}

export function hasEnchants(s: ItemStack | null | undefined): boolean {
  if (!s?.enchants) return false;
  for (const v of Object.values(s.enchants)) if (typeof v === 'number' && v > 0) return true;
  return false;
}

export function enchantLevel(s: ItemStack | null | undefined, id: EnchantId): number {
  const v = s?.enchants?.[id];
  return typeof v === 'number' && v > 0 ? v : 0;
}

export function applicableEnchants(itemId: number): EnchantId[] {
  if (itemId <= 0) return [];
  const def = getItem(itemId);
  const out: EnchantId[] = [];
  if (def.tool === 'pickaxe' || def.tool === 'axe' || def.tool === 'shovel') {
    out.push('efficiency', 'fortune', 'silk_touch', 'unbreaking');
  } else if (def.tool === 'sword') {
    out.push('sharpness', 'unbreaking');
  } else if (itemId === I.BOW) {
    out.push('power', 'unbreaking');
  } else if (def.armorSlot >= 0) {
    out.push('protection', 'unbreaking');
  } else if (itemId === I.FISHING_ROD || def.tool === 'shears' || def.tool === 'hoe') {
    out.push('unbreaking');
  }
  return out;
}

export function canEnchantItem(itemId: number): boolean {
  return applicableEnchants(itemId).length > 0;
}

export function areEnchantsCompatible(a: EnchantId, b: EnchantId): boolean {
  if (a === b) return false;
  if ((a === 'fortune' && b === 'silk_touch') || (a === 'silk_touch' && b === 'fortune')) return false;
  return true;
}

export interface EnchantOffer {
  /** Niveau d'expérience minimal requis pour débloquer cette proposition. */
  minLevel: number;
  /** Coût réel en niveaux et en lapis-lazuli (1, 2 ou 3). */
  lapisCost: number;
  enchants: Enchants;
  /** Libellé d'aperçu affiché sur le bouton. */
  preview: string;
}

function pickLevel(id: EnchantId, power: number, rng: () => number): number {
  const max = ENCHANT_DEFS[id].maxLevel;
  if (max === 1) return 1;
  // Plus la puissance (liée aux bibliothèques et à l'emplacement) est élevée, plus le niveau tiré est haut
  const frac = Math.min(1, Math.max(0, (power - 1) / 29));
  const target = 1 + frac * (max - 1) + (rng() - 0.35) * 0.9;
  return Math.max(1, Math.min(max, Math.round(target)));
}

/** Tire 3 propositions d'enchantement pour un objet donné selon le nombre de bibliothèques (0..15). */
export function rollEnchantOffers(itemId: number, bookshelves: number, rng: () => number): EnchantOffer[] {
  const pool = applicableEnchants(itemId);
  if (pool.length === 0) return [];
  const bs = Math.max(0, Math.min(15, Math.floor(bookshelves)));
  const base = Math.floor(rng() * 8) + 1 + Math.floor(bs / 2) + Math.floor(rng() * (bs + 1));
  const minLevels = [
    Math.max(1, Math.floor(base / 3)),
    Math.max(2, Math.floor((base * 2) / 3 + 1)),
    Math.max(3, Math.max(base, bs * 2)),
  ];

  const offers: EnchantOffer[] = [];
  for (let slot = 0; slot < 3; slot++) {
    const minLevel = minLevels[slot];
    const lapisCost = slot + 1;
    const primary = pool[Math.floor(rng() * pool.length)];
    const lvl1 = pickLevel(primary, minLevel, rng);
    const enchants: Enchants = { [primary]: lvl1 };

    // Chance d'un second enchantement compatible sur les paliers supérieurs
    const secondChance = slot === 2 ? 0.45 + bs * 0.02 : slot === 1 ? 0.2 : 0.05;
    if (pool.length > 1 && rng() < secondChance) {
      const compat = pool.filter((e) => areEnchantsCompatible(primary, e));
      if (compat.length > 0) {
        const secondary = compat[Math.floor(rng() * compat.length)];
        enchants[secondary] = pickLevel(secondary, minLevel, rng);
      }
    }

    offers.push({
      minLevel,
      lapisCost,
      enchants,
      preview: enchantLabel(primary, lvl1),
    });
  }
  return offers;
}

/** Somme des niveaux de Protection sur l'armure équipée (plafonnée à 20). */
export function armorProtectionFactor(armor: readonly Slot[]): number {
  let epf = 0;
  for (const s of armor) epf += enchantLevel(s, 'protection');
  return Math.min(20, epf);
}

/** Matériau de réparation d'un outil ou d'une armure sur l'enclume (0 si non réparable par matériau). */
export function repairMaterial(itemId: number): number {
  const name = getItem(itemId).name;
  if (name.startsWith('wooden_')) return B.OAK_PLANKS;
  if (name.startsWith('stone_')) return B.COBBLESTONE;
  if (name.startsWith('iron_')) return I.IRON_INGOT;
  if (name.startsWith('golden_')) return I.GOLD_INGOT;
  if (name.startsWith('diamond_')) return I.DIAMOND;
  if (name.startsWith('leather_')) return I.LEATHER;
  if (itemId === I.BOW || itemId === I.FISHING_ROD) return I.STRING;
  return 0;
}

export interface AnvilOutput {
  result: ItemStack;
  cost: number;
  materialUsed: number;
}

/** Calcule le résultat de l'enclume (réparation par matériau ou fusion de deux objets identiques). */
export function computeAnvilResult(left: Slot, right: Slot): AnvilOutput | null {
  if (!left || !right) return null;
  const maxDmg = maxDamage(left.id);
  if (maxDmg <= 0) return null;

  // 1) Réparation avec un matériau (ex. lingot de fer, diamant, planche)
  const mat = repairMaterial(left.id);
  if (mat > 0 && right.id === mat && left.damage > 0) {
    const perUnit = Math.max(1, Math.ceil(maxDmg * 0.25));
    const needed = Math.min(right.count, Math.ceil(left.damage / perUnit));
    if (needed <= 0) return null;
    const res = cloneStack(left)!;
    res.damage = Math.max(0, left.damage - needed * perUnit);
    return { result: res, cost: needed, materialUsed: needed };
  }

  // 2) Fusion de deux objets identiques (durabilité + enchantements)
  if (left.id === right.id) {
    const leftDur = maxDmg - left.damage;
    const rightDur = maxDmg - right.damage;
    const bonus = Math.floor(maxDmg * 0.12);
    const newDur = Math.min(maxDmg, leftDur + rightDur + bonus);
    const newDamage = Math.max(0, maxDmg - newDur);

    const merged: Enchants = cloneEnchants(left.enchants) ?? {};
    let enchantCost = 0;
    if (right.enchants) {
      for (const [k, rv] of Object.entries(right.enchants)) {
        if (!isEnchantId(k) || typeof rv !== 'number' || rv <= 0) continue;
        const lv = merged[k] ?? 0;
        const maxLvl = ENCHANT_DEFS[k].maxLevel;
        if (lv > 0) {
          const next = lv === rv ? Math.min(maxLvl, lv + 1) : Math.max(lv, rv);
          if (next > lv) {
            merged[k] = next;
            enchantCost += next;
          }
        } else {
          // Vérifier compatibilité (ex. Fortune vs Toucher de soie)
          let ok = true;
          for (const existing of Object.keys(merged)) {
            if (isEnchantId(existing) && !areEnchantsCompatible(existing, k)) {
              ok = false;
              break;
            }
          }
          if (ok) {
            merged[k] = Math.min(maxLvl, rv);
            enchantCost += merged[k]!;
          }
        }
      }
    }

    const res: ItemStack = {
      id: left.id,
      count: 1,
      damage: newDamage,
      ...(Object.keys(merged).length > 0 ? { enchants: merged } : {}),
    };
    const repairCost = left.damage > 0 && newDamage < left.damage ? 1 : 0;
    const cost = Math.max(1, enchantCost + repairCost);
    return { result: res, cost, materialUsed: 1 };
  }

  return null;
}
