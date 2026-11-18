/**
 * Le combat de l'End : fait vivre le dragon tant qu'il n'est pas vaincu, puis ouvre le portail
 * de sortie au centre de l'île et y dépose l'œuf.
 *
 * Le dragon n'est pas sauvegardé avec les chunks (il vole bien au-delà de ceux qui sont
 * chargés) : seule sa vie est notée dans l'état du monde, et il réapparaît à chaque entrée
 * dans l'End tant qu'il n'a pas été tué.
 */
import { DRAGON_MAX_HEALTH, EnderDragon, readDragonHealth } from '../entity/EndMobs';
import type { GameApi } from '../entity/Entity';
import { B } from '../world/Ids';
import { EXIT_EGG_Y, EXIT_POOL_Y, inExitPool } from '../world/gen/EndLayout';

/** Expérience donnée par le dragon (Minecraft : 12 000 points à la première victoire). */
export const DRAGON_XP = 12000;

export class EndFight {
  /** Le dragon a été tué (son agonie peut encore être en cours). */
  killed = false;
  /** Portail ouvert, œuf posé et expérience donnée. */
  rewarded = false;
  /** Le joueur a déjà vu l'écran de fin. */
  creditsSeen = false;
  /** Le joueur est déjà entré dans l'End. */
  visited = false;
  private health = DRAGON_MAX_HEALTH;
  dragon: EnderDragon | null = null;

  load(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const d = raw as Record<string, unknown>;
    this.killed = d.killed === true;
    this.rewarded = d.rewarded === true;
    this.creditsSeen = d.credits === true;
    this.visited = d.visited === true;
    this.health = readDragonHealth(d.health);
  }

  save(): Record<string, unknown> {
    this.sync();
    return { killed: this.killed, rewarded: this.rewarded, credits: this.creditsSeen, visited: this.visited, health: this.health };
  }

  private sync(): void {
    const d = this.dragon;
    if (d && !d.dead && d.health > 0) this.health = d.health;
  }

  /** Le joueur quitte l'End : la vie du dragon est gardée, il réapparaîtra au retour. */
  leave(): void {
    this.sync();
    this.dragon = null;
  }

  /** Barre de vie à afficher, ou null (dragon absent ou vaincu). */
  get progress(): number | null {
    const d = this.dragon;
    return d && !d.dead ? Math.max(0, d.health) / d.maxHealth : null;
  }

  /**
   * Un tick dans l'End. Retourne true au moment où le dragon vient d'être vaincu
   * (portail ouvert, œuf posé, expérience donnée).
   */
  tick(game: GameApi): boolean {
    this.visited = true;
    const d = this.dragon;
    if (!this.killed) {
      if (d && d.health <= 0) {
        this.killed = true;
      } else if (!d || d.dead) {
        const fresh = new EnderDragon();
        fresh.health = this.health;
        fresh.setPosition(0.5, 96, -40.5);
        fresh.setRotation(Math.PI / 2);
        game.spawn(fresh);
        this.dragon = fresh;
      }
      return false;
    }
    if (this.rewarded) {
      // le portail se rebâtit si un chunk de la fontaine n'était pas chargé à la mort du dragon
      if (game.world.age % 40 === 0) this.openExit(game);
      return false;
    }
    if (d && !d.dead) return false;
    this.dragon = null;
    if (!this.openExit(game)) return false;
    this.rewarded = true;
    game.world.setBlock(0, EXIT_EGG_Y, 0, B.DRAGON_EGG, 0);
    game.player.addXp(DRAGON_XP);
    return true;
  }

  /** Remplit le bassin de la fontaine de blocs de portail. Retourne false si elle n'est pas chargée. */
  private openExit(game: GameApi): boolean {
    const w = game.world;
    if (!w.isLoaded(-3, -3) || !w.isLoaded(3, -3) || !w.isLoaded(-3, 3) || !w.isLoaded(3, 3)) return false;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (inExitPool(dx, dz) && w.getBlock(dx, EXIT_POOL_Y, dz) !== B.END_PORTAL) w.setBlock(dx, EXIT_POOL_Y, dz, B.END_PORTAL, 0);
      }
    }
    return true;
  }
}
