/**
 * Progression guidée (« progrès ») pour accompagner un joueur débutant en survie.
 * Vérifie l'état du joueur (inventaire, sommeil…) et débloque les étapes dans l'ordre,
 * avec une notification visuelle, une phrase d'explication et un rappel du prochain objectif.
 */
import type { Player } from '../player/Player';
import type { Dimension, WorldType } from '../world/Constants';
import { B, I } from '../world/Ids';
import { STAT, killedKey } from './Stats';

export interface AdvancementContext {
  worldType: WorldType;
  genVersion: number;
  dimension: Dimension;
  endVisited: boolean;
}

export interface Advancement {
  id: string;
  title: string;
  /** Phrase affichée quand le progrès vient d'être accompli. `{inv}` = touche de l'inventaire. */
  detail: string;
  /** Explication de comment accomplir cette étape tant qu'elle est le prochain objectif. */
  goal: string;
  icon: number;
  check: (p: Player) => boolean;
  /** Condition pour afficher cet objectif dans le bandeau guidé (par défaut : surface uniquement). */
  available?: (ctx: AdvancementContext) => boolean;
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

const LOG_IDS = [B.OAK_LOG, B.SPRUCE_LOG, B.BIRCH_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.DARK_OAK_LOG];
const PLANK_IDS = [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.JUNGLE_PLANKS, B.ACACIA_PLANKS, B.DARK_OAK_PLANKS];

export const ADVANCEMENTS: readonly Advancement[] = [
  {
    id: 'wood',
    title: 'Couper du bois',
    detail: 'Appuyez sur {inv} et ouvrez le livre de recettes pour faire des planches.',
    goal: 'Objectif : maintenez le clic gauche sur un tronc d’arbre pour ramasser du bois',
    icon: B.OAK_LOG,
    check: (p) => hasAny(p, LOG_IDS),
  },
  {
    id: 'planks',
    title: 'Planches de bois',
    detail: 'Avec 4 planches dans l’inventaire ({inv}), fabriquez un établi.',
    goal: 'Objectif : appuyez sur {inv} et transformez une bûche en 4 planches',
    icon: B.OAK_PLANKS,
    check: (p) => hasAny(p, PLANK_IDS, 4),
  },
  {
    id: 'crafting_table',
    title: 'Établi prêt',
    detail: 'Posez l’établi au sol (clic droit) et ouvrez-le pour fabriquer des outils.',
    goal: 'Objectif : fabriquez un établi avec 4 planches dans l’inventaire ({inv})',
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
  {
    id: 'iron_pickaxe',
    title: 'Pioche en fer',
    detail: 'La pioche en fer récolte l’or, la redstone et surtout le diamant.',
    goal: 'Objectif : fabriquez une pioche en fer sur l’établi (3 lingots de fer + 2 bâtons)',
    icon: I.IRON_PICKAXE,
    check: (p) => hasAny(p, [I.IRON_PICKAXE, I.DIAMOND_PICKAXE]),
  },
  {
    id: 'armor',
    title: 'Bien protégé',
    detail: 'Chaque pièce d’armure portée réduit les dégâts reçus : la barre d’armure s’affiche au-dessus de la vie.',
    goal: 'Objectif : fabriquez une pièce d’armure et glissez-la dans les cases d’armure de l’inventaire ({inv})',
    icon: I.IRON_CHESTPLATE,
    check: (p) => p.inventory.armor.some((s) => s !== null),
  },
  {
    id: 'bread',
    title: 'Agriculteur',
    detail: 'Un champ de blé près de l’eau donne du pain à volonté. Le blé sert aussi à élever vaches et moutons.',
    goal: 'Objectif : labourez la terre (houe), plantez des graines, récoltez 3 blés et fabriquez du pain',
    icon: I.BREAD,
    check: (p) => hasAny(p, [I.BREAD]),
  },
  {
    id: 'diamond',
    title: 'Des diamants !',
    detail: 'Le diamant donne les meilleurs outils et la meilleure armure du jeu.',
    goal: 'Objectif : creusez tout en bas du monde (hauteur Y sous 16, visible avec F3) et minez du diamant avec une pioche en fer',
    icon: I.DIAMOND,
    check: (p) => hasAny(p, [I.DIAMOND]),
  },
  {
    id: 'blaze_rod',
    title: 'Dans le feu',
    detail: 'Un bâton de blaze donne 2 poudres de blaze. Avec une perle de l’Ender, la poudre fait un œil de l’Ender.',
    goal: 'Objectif : bâtissez un portail du Nether (cadre d’obsidienne de 4 × 5, allumé au briquet), trouvez une forteresse et tuez un blaze pour son bâton',
    icon: I.BLAZE_ROD,
    check: (p) => hasAny(p, [I.BLAZE_ROD, I.BLAZE_POWDER, I.ENDER_EYE]),
    available: (ctx) => ctx.genVersion >= 2 && ctx.dimension !== 'end',
  },
  {
    id: 'ender_eye',
    title: 'L’œil de l’Ender',
    detail: 'Lancé (clic droit), l’œil vole vers le fort le plus proche. Suivez-le, puis creusez là où il plonge.',
    goal: 'Objectif : tuez des endermen pour leurs perles et fabriquez un œil de l’Ender (1 perle + 1 poudre de blaze). Il en faudra une douzaine',
    icon: I.ENDER_EYE,
    check: (p) => hasAny(p, [I.ENDER_EYE]) || (p.stats[STAT.END_VISITS] ?? 0) > 0,
    available: (ctx) => ctx.genVersion >= 3 && ctx.dimension !== 'end',
  },
  {
    id: 'the_end',
    title: 'La fin ?',
    detail: 'Vous voici dans l’End. Détruisez les cristaux au sommet des piliers : ils soignent le dragon.',
    goal: 'Objectif : dans le fort, trouvez la salle du portail, posez un œil de l’Ender sur chacun des 12 cadres et sautez dans le portail',
    icon: B.END_STONE,
    check: (p) => (p.stats[STAT.END_VISITS] ?? 0) > 0,
    available: (ctx) => ctx.genVersion >= 3 && ctx.dimension === 'overworld',
  },
  {
    id: 'dragon',
    title: 'Libérer l’End',
    detail: 'Le dragon de l’Ender est vaincu. Le portail au centre de l’île vous ramène chez vous.',
    goal: 'Objectif : détruisez les cristaux (une flèche suffit), puis abattez le dragon ; il se pose par moments sur la fontaine centrale',
    icon: B.DRAGON_EGG,
    check: (p) => (p.stats[killedKey('ender_dragon')] ?? 0) > 0,
    available: (ctx) => ctx.dimension === 'end' || (ctx.dimension === 'overworld' && ctx.endVisited),
  },
];

/**
 * Indique si l'objectif guidé d'un progrès est réalisable dans le monde et la dimension actuels.
 * En monde plat, le terrain ne contient ni bois, ni pierre, ni minerai, ni structure : aucun
 * objectif guidé n'est affiché (comme dans Minecraft 1.12, les progrès restent toutefois
 * déblocables si le joueur obtient l'objet autrement).
 */
export function isAdvancementAvailable(adv: Advancement, ctx: AdvancementContext): boolean {
  if (ctx.worldType === 'flat') return false;
  if (adv.available) return adv.available(ctx);
  return ctx.dimension === 'overworld';
}

/** Remplace les repères de touche (`{inv}`) d'un texte de progrès par le nom affiché de la touche. */
export function advancementText(text: string, inventoryKey: string): string {
  return text.replace(/\{inv\}/g, inventoryKey);
}
