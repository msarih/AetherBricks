/**
 * Règles de jeu du monde (/gamerule), sauvegardées avec l'état du monde.
 * Les valeurs par défaut suivent exactement Minecraft Java 1.12.
 */

export interface GameRules {
  keepInventory: boolean;
  doDaylightCycle: boolean;
  doMobSpawning: boolean;
  mobGriefing: boolean;
  doFireTick: boolean;
  naturalRegeneration: boolean;
}

export type GameRuleName = keyof GameRules;

export const DEFAULT_GAME_RULES: Readonly<GameRules> = Object.freeze({
  keepInventory: false,
  doDaylightCycle: true,
  doMobSpawning: true,
  mobGriefing: true,
  doFireTick: true,
  naturalRegeneration: true,
});

export const GAME_RULE_NAMES: readonly GameRuleName[] = [
  'keepInventory',
  'doDaylightCycle',
  'doMobSpawning',
  'mobGriefing',
  'doFireTick',
  'naturalRegeneration',
] as const;

const RULE_LOOKUP = new Map<string, GameRuleName>(GAME_RULE_NAMES.map((name) => [name.toLowerCase(), name]));

export function createGameRules(): GameRules {
  return { ...DEFAULT_GAME_RULES };
}

/** Résout le nom exact d'une règle sans tenir compte de la casse. */
export function resolveGameRule(input: string): GameRuleName | null {
  return RULE_LOOKUP.get(input.toLowerCase()) ?? null;
}

/** Charge les règles depuis un objet sauvegardé ; tout champ absent ou invalide garde sa valeur par défaut. */
export function loadGameRules(rules: GameRules, raw: unknown): void {
  Object.assign(rules, DEFAULT_GAME_RULES);
  if (!raw || typeof raw !== 'object') return;
  const src = raw as Record<string, unknown>;
  for (const name of GAME_RULE_NAMES) {
    if (typeof src[name] === 'boolean') rules[name] = src[name] as boolean;
  }
}

export function saveGameRules(rules: Readonly<GameRules>): GameRules {
  return { ...rules };
}
