/**
 * Statistiques du joueur (Minecraft 1.12, écran « Statistiques ») : compteurs généraux,
 * blocs minés, objets fabriqués, créatures vaincues et créatures qui ont vaincu le joueur.
 * Un compteur est une clé texte et un entier ; ils sont sauvegardés avec le joueur.
 * Module pur.
 */
import type { MobKind } from '../entity/MobModels';

export type Stats = Record<string, number>;

/** Compteurs généraux. Distances en centimètres, temps en ticks, dégâts en demi-cœurs. */
export const STAT = {
  PLAY_TIME: 'play_time',
  WALK: 'walk_cm',
  SWIM: 'swim_cm',
  FLY: 'fly_cm',
  JUMP: 'jumps',
  DEATHS: 'deaths',
  MOB_KILLS: 'mob_kills',
  DAMAGE_DEALT: 'damage_dealt',
  DAMAGE_TAKEN: 'damage_taken',
  FISH: 'fish_caught',
  BRED: 'animals_bred',
  SLEEP: 'sleep_in_bed',
  TRADES: 'trades',
} as const;

export const minedKey = (blockId: number): string => `mined:${blockId}`;
export const craftedKey = (itemId: number): string => `crafted:${itemId}`;
export const killedKey = (kind: string): string => `killed:${kind}`;
export const killedByKey = (kind: string): string => `killed_by:${kind}`;

/** Noms des créatures dans l'écran des statistiques. */
export const MOB_NAMES: Record<MobKind, string> = {
  pig: 'Cochon',
  cow: 'Vache',
  sheep: 'Mouton',
  chicken: 'Poule',
  wolf: 'Loup',
  zombie: 'Zombie',
  skeleton: 'Squelette',
  creeper: 'Creeper',
  spider: 'Araignée',
  zombie_pigman: 'Cochon-zombie',
  ghast: 'Ghast',
  magma_cube: 'Cube de magma',
  villager: 'Villageois',
  player: 'Joueur',
};

/** Ajoute `n` au compteur (arrondi à l'entier, jamais négatif). */
export function addStat(stats: Stats, key: string, n = 1): void {
  if (!(n > 0)) return;
  stats[key] = Math.round((stats[key] ?? 0) + n);
}

/** Relit des statistiques sauvegardées : seuls les entiers positifs sont gardés. */
export function loadStats(raw: unknown): Stats {
  const out: Stats = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && k.length <= 64) out[k] = Math.floor(v);
  }
  return out;
}
