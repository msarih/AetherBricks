/**
 * Aides pures de survie partagées entre le solo (Game.ts) et le serveur multijoueur :
 * messages de mort et recherche d'une case libre à côté d'un lit.
 */
import type { DamageCause, Entity } from '../entity/Entity';
import { isBoxFree } from '../entity/Physics';
import { BLOCK_SHAPE, BLOCK_SOLID, FACING_DX, FACING_DZ, SHAPE } from '../world/Blocks';
import { CHUNK_HEIGHT } from '../world/Constants';
import { B } from '../world/Ids';
import type { World } from '../world/World';

export const MOB_LABELS: Record<string, string> = {
  zombie: 'un zombie',
  skeleton: 'un squelette',
  spider: 'une araignée',
  creeper: 'un creeper',
  zombie_pigman: 'un cochon-zombie',
  ghast: 'un ghast',
  magma_cube: 'un cube de magma',
  blaze: 'un blaze',
  wither_skeleton: 'un squelette wither',
  slime: 'un slime',
  enderman: 'un enderman',
  witch: 'une sorcière',
  silverfish: "un poisson d'argent",
  ender_dragon: "le dragon de l'Ender",
  iron_golem: 'un golem de fer',
  wolf: 'un loup',
};

/**
 * Formate un message de mort en français.
 * Si `playerName` est null (mode solo), utilise « Vous … » ; sinon utilise le pseudo du joueur.
 */
export function formatDeathMessage(
  playerName: string | null,
  cause: DamageCause,
  by: Entity | null,
  killerName?: string,
): string {
  const killer = killerName || (by ? (by.kind === 'player' && by.customName ? by.customName : MOB_LABELS[by.mobKind] ?? 'une créature') : '');
  if (playerName === null) {
    switch (cause) {
      case 'fall':
        return 'Vous êtes tombé de trop haut';
      case 'drown':
        return 'Vous vous êtes noyé';
      case 'fire':
        return 'Vous avez péri dans les flammes';
      case 'lava':
        return 'Vous avez tenté de nager dans la lave';
      case 'starve':
        return 'Vous êtes mort de faim';
      case 'void':
        return 'Vous êtes tombé hors du monde';
      case 'cactus':
        return 'Vous avez été piqué à mort';
      case 'suffocate':
        return 'Vous avez suffoqué dans un mur';
      case 'explosion':
        return by ? `Vous avez été soufflé par ${killer}` : 'Vous avez explosé';
      case 'attack':
        return by ? `Vous avez été tué par ${killer}` : 'Vous avez été tué';
      case 'arrow':
        return by ? `Vous avez été abattu par ${killer}` : 'Vous avez été abattu par une flèche';
      case 'wither':
        return 'Vous avez été flétri';
      case 'magic':
        return by ? `Vous avez été tué par la magie d'${killer}` : 'Vous avez été tué par magie';
      default:
        return 'Vous êtes mort';
    }
  }
  switch (cause) {
    case 'fall':
      return `${playerName} est tombé de trop haut`;
    case 'drown':
      return `${playerName} s'est noyé`;
    case 'fire':
      return `${playerName} a péri dans les flammes`;
    case 'lava':
      return `${playerName} a tenté de nager dans la lave`;
    case 'starve':
      return `${playerName} est mort de faim`;
    case 'void':
      return `${playerName} est tombé hors du monde`;
    case 'cactus':
      return `${playerName} a été piqué à mort`;
    case 'suffocate':
      return `${playerName} a suffoqué dans un mur`;
    case 'explosion':
      return killer ? `${playerName} a été soufflé par ${killer}` : `${playerName} a explosé`;
    case 'attack':
      return killer ? `${playerName} a été tué par ${killer}` : `${playerName} a été tué`;
    case 'arrow':
      return killer ? `${playerName} a été abattu par ${killer}` : `${playerName} a été abattu par une flèche`;
    case 'wither':
      return `${playerName} a été flétri`;
    case 'magic':
      return killer ? `${playerName} a été tué par la magie de ${killer}` : `${playerName} a été tué par magie`;
    default:
      return `${playerName} est mort`;
  }
}

/** Case libre pour tenir debout à côté du lit (tête en hx, by, hz), ou null si toutes sont obstruées. */
export function findBedStandSpot(
  w: World,
  hx: number,
  by: number,
  hz: number,
  width = 0.6,
  height = 1.8,
): { x: number; y: number; z: number } | null {
  if (!w.isLoaded(hx, hz) || w.getBlock(hx, by, hz) !== B.BED) return null;
  const d = w.getMeta(hx, by, hz) & 3;
  const fx = hx - FACING_DX[d];
  const fz = hz - FACING_DZ[d];
  const hasFoot = w.getBlock(fx, by, fz) === B.BED;
  const candidates: Array<[number, number]> = [];
  const seen = new Set<string>();
  const push = (x: number, z: number): void => {
    if ((x === hx && z === hz) || (hasFoot && x === fx && z === fz)) return;
    const k = `${x},${z}`;
    if (seen.has(k)) return;
    seen.add(k);
    candidates.push([x, z]);
  };
  for (const [ax, az] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) push(hx + ax, hz + az);
  if (hasFoot) for (const [ax, az] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) push(fx + ax, fz + az);
  for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) push(hx + ax, hz + az);
  if (hasFoot) for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) push(fx + ax, fz + az);

  const hw = width / 2;
  for (const cy of [by, by - 1, by + 1]) {
    if (cy < 1 || cy + 2 >= CHUNK_HEIGHT) continue;
    for (const [cx, cz] of candidates) {
      if (!w.isLoaded(cx, cz)) continue;
      const below = w.getBlock(cx, cy - 1, cz);
      if (BLOCK_SOLID[below] !== 1 || below === B.CACTUS) continue;
      const feet = w.getBlock(cx, cy, cz);
      const head = w.getBlock(cx, cy + 1, cz);
      if (BLOCK_SHAPE[feet] === SHAPE.FLUID || BLOCK_SHAPE[head] === SHAPE.FLUID) continue;
      if (feet === B.FIRE || head === B.FIRE || feet === B.CACTUS || head === B.CACTUS) continue;
      const sx = cx + 0.5;
      const sz = cz + 0.5;
      if (!isBoxFree(w, sx - hw, cy, sz - hw, sx + hw, cy + height, sz + hw)) continue;
      return { x: sx, y: cy, z: sz };
    }
  }
  return null;
}
