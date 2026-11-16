/**
 * Progression guidée (« progrès ») pour accompagner un joueur débutant en survie.
 * Vérifie l'état du joueur (inventaire, sommeil…) et débloque les étapes dans l'ordre,
 * avec une notification visuelle, une phrase d'explication et un rappel du prochain objectif.
 */
import type { Player } from '../player/Player';
import { B, I } from '../world/Ids';

export interface Advancement {
  id: string;
  title: string;
  /** Phrase affichée quand le progrès vient d'être accompli. */
  detail: string;
  /** Explication de comment accomplir cette étape tant qu'elle est le prochain objectif. */
  goal: string;
  icon: number;
  check: (p: Player) => boolean;
}

function hasAny(p: Player, ids: readonly number[], minCount = 1): boolean {
  let total = 0;
  for (const s of p.inventory.slots) {
    if (s && ids.includes(s.id)) total += s.count;
  }
  const cur = p.inventory.cursor;
  if (cur && ids.includes(cur.id)) total += cur.count;
  return total >= minCount;
}

const LOG_IDS = [B.OAK_LOG, B.SPRUCE_LOG, B.BIRCH_LOG, B.JUNGLE_LOG, B.ACACIA_LOG];
const PLANK_IDS = [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.JUNGLE_PLANKS, B.ACACIA_PLANKS];

export const ADVANCEMENTS: readonly Advancement[] = [
  {
    id: 'wood',
    title: 'Couper du bois',
    detail: 'Appuyez sur E et ouvrez le livre de recettes pour faire des planches.',
    goal: 'Objectif : maintenez le clic gauche sur un tronc d’arbre pour ramasser du bois',
    icon: B.OAK_LOG,
    check: (p) => hasAny(p, LOG_IDS),
  },
  {
    id: 'planks',
    title: 'Planches de bois',
    detail: 'Avec 4 planches dans l’inventaire (E), fabriquez un établi.',
    goal: 'Objectif : appuyez sur E et transformez une bûche en 4 planches',
    icon: B.OAK_PLANKS,
    check: (p) => hasAny(p, PLANK_IDS, 4),
  },
  {
    id: 'crafting_table',
    title: 'Établi prêt',
    detail: 'Posez l’établi au sol (clic droit) et ouvrez-le pour fabriquer des outils.',
    goal: 'Objectif : fabriquez un établi avec 4 planches dans l’inventaire (E)',
    icon: B.CRAFTING_TABLE,
    check: (p) => hasAny(p, [B.CRAFTING_TABLE]),
  },
  {
    id: 'wooden_pickaxe',
    title: 'Première pioche',
    detail: 'La pioche en bois permet de récolter de la pierre en creusant le sol.',
    goal: 'Objectif : posez l’établi (clic droit) et fabriquez des bâtons puis une pioche en bois',
    icon: I.WOODEN_PICKAXE,
    check: (p) => hasAny(p, [I.WOODEN_PICKAXE, I.STONE_PICKAXE, I.IRON_PICKAXE, I.GOLDEN_PICKAXE, I.DIAMOND_PICKAXE]),
  },
  {
    id: 'cobblestone',
    title: 'Âge de pierre',
    detail: 'Avec 8 pierres taillées sur l’établi, vous pouvez fabriquer un fourneau et des outils en pierre.',
    goal: 'Objectif : minez de la roche grise avec votre pioche pour obtenir 8 pierres taillées',
    icon: B.COBBLESTONE,
    check: (p) => hasAny(p, [B.COBBLESTONE], 8),
  },
  {
    id: 'furnace',
    title: 'Au fourneau !',
    detail: 'Un fourneau cuit la viande, les minerais et fait du charbon de bois (bûche + planche).',
    goal: 'Objectif : fabriquez un fourneau sur l’établi avec 8 pierres taillées',
    icon: B.FURNACE,
    check: (p) => hasAny(p, [B.FURNACE]),
  },
  {
    id: 'torch',
    title: 'Faire de la lumière',
    detail: 'Posez des torches (clic droit) pour éclairer la nuit et éloigner les monstres.',
    goal: 'Objectif : fabriquez des torches (1 charbon + 1 bâton) pour éclairer la nuit',
    icon: B.TORCH,
    check: (p) => hasAny(p, [B.TORCH]),
  },
  {
    id: 'bed',
    title: 'Un lit pour la nuit',
    detail: 'Posez le lit et faites un clic droit dessus la nuit pour passer directement au matin.',
    goal: 'Objectif : récupérez 3 laines sur des moutons et 3 planches pour fabriquer un lit sur l’établi',
    icon: B.BED,
    check: (p) => hasAny(p, [B.BED]) || p.bed !== null,
  },
  {
    id: 'slept',
    title: 'Bonne nuit !',
    detail: 'Vous avez passé la nuit à l’abri et défini votre point de réapparition.',
    goal: 'Objectif : posez votre lit et cliquez droit dessus quand la nuit tombe',
    icon: B.BED,
    check: (p) => p.sleeping,
  },
  {
    id: 'iron',
    title: 'L’âge du fer',
    detail: 'Les lingots de fer permettent de forger une pioche en fer, un seau, des cisailles et une armure.',
    goal: 'Objectif : minez du minerai de fer (avec une pioche en pierre) et fondez-le au fourneau',
    icon: I.IRON_INGOT,
    check: (p) => hasAny(p, [I.IRON_INGOT]),
  },
];
