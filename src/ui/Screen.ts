/**
 * Ce qu'est un écran (menu de cases, pause, options, chat, mort, titre, chargement) pour GameUi,
 * et ce que GameUi met à la disposition des écrans.
 */
import type { UiHost } from './UiApi';

export interface Screen {
  readonly el: HTMLElement;
  /** L'écran met le jeu en pause (pause, options ouvertes depuis la pause). */
  readonly pausing: boolean;
  /** L'écran couvre tout (titre, chargement, options) : le HUD n'est pas affiché dessous. */
  readonly opaque?: boolean;
  /** L'élément vient d'être inséré dans la page (prise de focus). */
  opened?(): void;
  /** À chaque image, tant que l'écran est ouvert. */
  update?(dt: number): void;
  /** Touche enfoncée pendant que l'écran est ouvert ; retourner true si elle est consommée. */
  key?(e: KeyboardEvent): boolean;
  /** L'écran est retiré : libérer les écouteurs globaux. */
  dispose?(): void;
}

export type TitlePage = 'main' | 'worlds' | 'create';

export interface UiContext {
  readonly host: UiHost;
  /** Élément racine de l'interface. */
  readonly root: HTMLElement;
  /** Historique des saisies du chat (partagé entre les ouvertures). */
  readonly chatHistory: string[];
  /** Échelle courante : taille d'un pixel d'interface en pixels CSS. */
  scale(): number;
  /** Recalcule l'échelle (après un changement de `settings.guiScale`). */
  refreshScale(): void;
  /** L'écran `s` est-il toujours l'écran affiché ? */
  isCurrent(s: Screen): boolean;
  /** Un écran est-il ouvert ? */
  hasScreen(): boolean;
  closeScreen(): void;
  openPause(): void;
  /** Écran d'options ; `back` est appelé par « Terminé » et Échap. */
  openOptions(back: () => void, pausing: boolean): void;
  /** Écran des statistiques (depuis la pause) ; `back` est appelé par « Terminé » et Échap. */
  openStats(back: () => void): void;
  /** Menu principal, sur la page demandée, avec un éventuel message d'erreur à afficher. */
  openTitle(page: TitlePage, error?: string): void;
  /**
   * Signale une erreur survenue alors que l'écran qui l'a provoquée n'est plus affiché :
   * elle apparaît dans le journal et sur le prochain menu principal.
   */
  fail(message: string): void;
}

/** Message lisible d'une erreur quelconque (promesse rejetée). */
export function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Erreur inconnue';
}

/** Appelle une fonction asynchrone de l'hôte ; une exception synchrone devient un rejet. */
export function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err);
  }
}
