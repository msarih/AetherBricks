/**
 * Échanges des villageois (Minecraft 1.12).
 *
 * Chaque villageois a un métier (la couleur de sa robe) et, dans ce métier, une carrière
 * qui fixe ses offres : on lui vend des denrées contre des émeraudes, on lui achète des
 * objets avec des émeraudes. Les offres arrivent par paliers : faire un échange pour la
 * première fois débloque le palier suivant et réapprovisionne le villageois.
 *
 * Prix et quantités repris de Minecraft 1.12, limités aux objets qui existent dans ce jeu.
 * Module pur : aucune dépendance au monde ni aux entités.
 */
import { B, I } from '../world/Ids';
import { rollEnchantOffers, type Enchants } from '../world/Enchants';
import { sanitizeEnchants } from '../world/ItemStack';

export type Profession = 'farmer' | 'librarian' | 'priest' | 'smith' | 'butcher';
export const PROFESSIONS: readonly Profession[] = ['farmer', 'librarian', 'priest', 'smith', 'butcher'];

export const PROFESSION_LABELS: Record<Profession, string> = {
  farmer: 'Fermier',
  librarian: 'Bibliothécaire',
  priest: 'Prêtre',
  smith: 'Forgeron',
  butcher: 'Boucher',
};

/** Une offre : ce que le joueur donne (un ou deux objets) et ce qu'il reçoit. */
export interface Offer {
  buy: number;
  buyCount: number;
  buy2: number;
  buy2Count: number;
  sell: number;
  sellCount: number;
  /** Enchantements de l'objet vendu, s'il en a. */
  enchants?: Enchants;
  /** Nombre d'échanges faits depuis le dernier réapprovisionnement, et plafond. */
  uses: number;
  maxUses: number;
}

type Range = readonly [min: number, max: number];
/** Le villageois achète : [objet, quantité] contre une émeraude. */
type BuySpec = { buy: number; count: Range };
/** Le villageois vend : émeraudes (et parfois un second objet) contre [objet, quantité]. */
type SellSpec = { sell: number; price: Range; count?: Range; extra?: readonly [id: number, count: number]; enchanted?: boolean };
type Spec = BuySpec | SellSpec;

interface Career {
  label: string;
  tiers: readonly (readonly Spec[])[];
}

const buy = (id: number, min: number, max: number): BuySpec => ({ buy: id, count: [min, max] });
const sell = (id: number, pMin: number, pMax: number, cMin = 1, cMax = cMin): SellSpec => ({ sell: id, price: [pMin, pMax], count: [cMin, cMax] });
const enchanted = (id: number, pMin: number, pMax: number): SellSpec => ({ sell: id, price: [pMin, pMax], enchanted: true });

const CAREERS: Record<Profession, readonly Career[]> = {
  farmer: [
    {
      label: 'Fermier',
      tiers: [
        [buy(I.WHEAT, 18, 22), buy(I.POTATO, 15, 19), buy(I.CARROT, 15, 19), sell(I.BREAD, 1, 1, 2, 4)],
        [buy(B.PUMPKIN, 8, 13), sell(I.PUMPKIN_PIE, 1, 1, 2, 3)],
        [buy(B.MELON, 7, 12), sell(I.APPLE, 1, 1, 5, 7)],
        [sell(I.COOKIE, 1, 1, 6, 6)],
      ],
    },
    {
      label: 'Pêcheur',
      tiers: [
        [buy(I.STRING, 15, 20), buy(I.COAL, 16, 24), { sell: I.COOKED_FISH, price: [1, 1], count: [6, 6], extra: [I.RAW_FISH, 6] }],
        [sell(I.FISHING_ROD, 7, 8)],
      ],
    },
    {
      label: 'Berger',
      tiers: [
        [buy(B.WOOL_WHITE, 16, 22), sell(I.SHEARS, 3, 4)],
        [sell(B.WOOL_RED, 1, 2), sell(B.WOOL_BLUE, 1, 2), sell(B.WOOL_YELLOW, 1, 2), sell(B.WOOL_GREEN, 1, 2)],
      ],
    },
    {
      label: 'Fléchier',
      tiers: [
        [buy(I.STRING, 15, 20), sell(I.ARROW, 1, 1, 8, 12)],
        [sell(I.BOW, 2, 3), { sell: I.FLINT, price: [1, 1], count: [6, 10], extra: [B.GRAVEL, 10] }],
      ],
    },
  ],
  librarian: [
    {
      label: 'Bibliothécaire',
      tiers: [
        [buy(I.PAPER, 24, 36), sell(B.BOOKSHELF, 3, 4)],
        [buy(I.BOOK, 8, 10), sell(I.COMPASS, 10, 12)],
        [sell(I.CLOCK, 10, 12), sell(B.GLASS, 1, 1, 3, 5)],
        [sell(I.MAP, 7, 11)],
      ],
    },
  ],
  priest: [
    {
      label: 'Prêtre',
      tiers: [
        [buy(I.ROTTEN_FLESH, 36, 40), buy(I.GOLD_INGOT, 8, 10)],
        [sell(I.REDSTONE, 1, 1, 1, 4), sell(I.LAPIS, 1, 1, 1, 2)],
        [sell(B.GLOWSTONE, 1, 1, 1, 3)],
        [sell(I.GOLDEN_APPLE, 8, 11)],
      ],
    },
  ],
  smith: [
    {
      label: 'Armurier',
      tiers: [
        [buy(I.COAL, 16, 24), sell(I.IRON_HELMET, 4, 6)],
        [buy(I.IRON_INGOT, 7, 9), sell(I.IRON_CHESTPLATE, 10, 14)],
        [buy(I.DIAMOND, 3, 4), enchanted(I.DIAMOND_CHESTPLATE, 16, 19)],
      ],
    },
    {
      label: 'Forgeron d’armes',
      tiers: [
        [buy(I.COAL, 16, 24), sell(I.IRON_AXE, 6, 8)],
        [buy(I.IRON_INGOT, 7, 9), enchanted(I.IRON_SWORD, 9, 10)],
        [buy(I.DIAMOND, 3, 4), enchanted(I.DIAMOND_SWORD, 12, 15), enchanted(I.DIAMOND_AXE, 9, 12)],
      ],
    },
    {
      label: 'Forgeron d’outils',
      tiers: [
        [buy(I.COAL, 16, 24), enchanted(I.IRON_SHOVEL, 5, 7)],
        [buy(I.IRON_INGOT, 7, 9), enchanted(I.IRON_PICKAXE, 9, 11)],
        [buy(I.DIAMOND, 3, 4), enchanted(I.DIAMOND_PICKAXE, 12, 15)],
      ],
    },
  ],
  butcher: [
    {
      label: 'Boucher',
      tiers: [
        [buy(I.RAW_PORKCHOP, 14, 18), buy(I.RAW_CHICKEN, 14, 18)],
        [buy(I.COAL, 16, 24), sell(I.COOKED_PORKCHOP, 1, 1, 5, 7), sell(I.COOKED_CHICKEN, 1, 1, 6, 8)],
      ],
    },
    {
      label: 'Tanneur',
      tiers: [
        [buy(I.LEATHER, 9, 12), sell(I.LEATHER_LEGGINGS, 2, 4)],
        [enchanted(I.LEATHER_CHESTPLATE, 7, 12)],
      ],
    },
  ],
};

/** Échanges possibles avant réapprovisionnement (Minecraft : 7). */
export const MAX_USES = 7;

export function isProfession(v: unknown): v is Profession {
  return typeof v === 'string' && (PROFESSIONS as readonly string[]).includes(v);
}

export function careerCount(profession: Profession): number {
  return CAREERS[profession].length;
}

export function careerLabel(profession: Profession, career: number): string {
  return (CAREERS[profession][career] ?? CAREERS[profession][0]).label;
}

export function tierCount(profession: Profession, career: number): number {
  return (CAREERS[profession][career] ?? CAREERS[profession][0]).tiers.length;
}

function between(r: Range, rng: () => number): number {
  return r[0] + Math.floor(rng() * (r[1] - r[0] + 1));
}

/** Offres du palier `tier` (à partir de 1) d'une carrière, quantités et prix tirés au hasard. */
export function offersForTier(profession: Profession, career: number, tier: number, rng: () => number): Offer[] {
  const c = CAREERS[profession][career] ?? CAREERS[profession][0];
  const specs = c.tiers[tier - 1] ?? [];
  const out: Offer[] = [];
  for (const s of specs) {
    if ('buy' in s) {
      out.push({ buy: s.buy, buyCount: between(s.count, rng), buy2: 0, buy2Count: 0, sell: I.EMERALD, sellCount: 1, uses: 0, maxUses: MAX_USES });
      continue;
    }
    const o: Offer = {
      buy: I.EMERALD, buyCount: between(s.price, rng), buy2: s.extra ? s.extra[0] : 0, buy2Count: s.extra ? s.extra[1] : 0,
      sell: s.sell, sellCount: s.count ? between(s.count, rng) : 1, uses: 0, maxUses: MAX_USES,
    };
    if (s.enchanted) {
      // comme une table d'enchantement entourée de quelques bibliothèques
      const rolls = rollEnchantOffers(s.sell, 6, rng);
      if (rolls.length > 0) o.enchants = rolls[Math.min(rolls.length - 1, 1)].enchants;
    }
    out.push(o);
  }
  return out;
}

/** Relit des offres sauvegardées ; ce qui est illisible est écarté. */
export function loadOffers(raw: unknown): Offer[] {
  const out: Offer[] = [];
  if (!Array.isArray(raw)) return out;
  const int = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : lo);
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== 'object') continue;
    const o: Offer = {
      buy: int(r.buy, 0, 4095), buyCount: int(r.buyCount, 1, 64), buy2: int(r.buy2, 0, 4095), buy2Count: int(r.buy2Count, 0, 64),
      sell: int(r.sell, 0, 4095), sellCount: int(r.sellCount, 1, 64), uses: int(r.uses, 0, 999), maxUses: int(r.maxUses, 1, 999),
    };
    if (o.buy === 0 || o.sell === 0) continue;
    const enchants = sanitizeEnchants(r.enchants);
    if (enchants) o.enchants = enchants;
    out.push(o);
  }
  return out;
}
