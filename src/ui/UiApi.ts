/**
 * Contrat entre l'interface (DOM) et le jeu.
 *  - UiGame : ce que l'interface lit du jeu en cours et ce qu'elle peut lui demander ;
 *  - UiHost : ce que l'interface demande à l'application (mondes, réglages, icônes) ;
 *  - UiApi  : ce que le jeu et l'application demandent à l'interface.
 * L'interface ne touche ni au monde ni au rendu 3D ; le jeu ne touche jamais au DOM.
 */
import type { Inventory, Menu } from '../game/Inventory';
import type { GameMode, WorldType } from '../world/Constants';
import type { Settings, WorldInfo } from '../world/Storage';

/** Le jeu en cours, vu par l'interface. Toutes les valeurs sont relues à chaque image. */
export interface UiGame {
  readonly inventory: Inventory;
  readonly gameMode: GameMode;
  /** Vie en demi-cœurs (0..maxHealth). */
  readonly health: number;
  readonly maxHealth: number;
  /** Faim en demi-gigots (0..20). */
  readonly hunger: number;
  /** Points d'armure (0..20) ; la rangée n'est affichée que si > 0. */
  readonly armor: number;
  /** Réserve d'air en ticks (0..300) ; les bulles ne sont affichées que si < 300. */
  readonly air: number;
  readonly xpLevel: number;
  /** Avancement vers le niveau suivant (0..1). */
  readonly xpProgress: number;
  /** > 0 pendant les 10 ticks qui suivent un coup reçu (cœurs qui tremblent, voile rouge). */
  readonly hurtTime: number;
  /** La tête du joueur est sous l'eau / dans la lave (voile coloré plein écran). */
  readonly headInWater: boolean;
  readonly headInLava: boolean;
  /** Le joueur brûle (flammes en bas de l'écran). */
  readonly onFire: boolean;
  /** Voile noir plein écran (0..1) : endormissement dans un lit. */
  readonly fade: number;
  /** Prochain objectif guidé (en survie), ou chaîne vide si tout est terminé. */
  readonly guideGoal: string;
  /** 0 paisible, 1 facile, 2 normal, 3 difficile. */
  difficulty: number;

  /** Statistiques du joueur (voir game/Stats) : clé → valeur. */
  readonly stats: Readonly<Record<string, number>>;
  /** Tuile animée d'un objet (aiguille de la boussole, cadran de l'horloge), ou -1. */
  dynamicTile(itemId: number): number;
  /** Texte du panneau en (x, y, z), saisi dans l'écran ouvert par UiApi.openSignEditor() (4 lignes). */
  setSignText(x: number, y: number, z: number, lines: string[]): void;

  /** Lignes de l'écran de débogage (F3) : colonne de gauche et colonne de droite. */
  debugLines(): { left: string[]; right: string[] };

  /**
   * Le joueur vient de fermer l'écran de conteneur ouvert par UiApi.openMenu() (touche E ou Échap).
   * Le jeu referme le menu (Menu.close()) et reprend la souris.
   */
  closeMenu(): void;
  /** Reprendre la partie après la pause, le chat ou tout autre écran : le jeu reprend la souris. */
  resume(): void;
  /** Réapparaître après la mort. */
  respawn(): void;
  /** Texte validé dans le chat : message, ou commande s'il commence par « / ». */
  chat(text: string): void;
  /** Propositions de complétion pour une commande en cours de saisie (touche Tab). */
  complete(text: string): string[];
}

/** Une offre d'un villageois, telle que l'écran d'échange l'affiche. */
export interface TradeOfferView {
  buy: number;
  buyCount: number;
  /** Second objet demandé (0 = aucun). */
  buy2: number;
  buy2Count: number;
  sell: number;
  sellCount: number;
  enchanted: boolean;
  /** Offre épuisée jusqu'au prochain réapprovisionnement. */
  soldOut: boolean;
  /** Le joueur a de quoi payer. */
  affordable: boolean;
}

/** Échanges d'un villageois, vus par l'interface (fournis par le jeu à UiApi.openTrade()). */
export interface TradeView {
  /** Métier du villageois. */
  readonly title: string;
  offers(): TradeOfferView[];
  /** Conclut l'échange de l'offre `index` ; false s'il est impossible. */
  trade(index: number): boolean;
  /** L'écran est fermé : le villageois reprend sa route. */
  closed(): void;
}

export interface NewWorldOptions {
  name: string;
  /** Graine saisie (texte libre ; vide = aléatoire). */
  seed: string;
  worldType: WorldType;
  gameMode: GameMode;
}

/** L'application, vue par l'interface. */
export interface UiHost {
  /** Réglages courants : l'écran d'options les modifie en place puis appelle settingsChanged(). */
  readonly settings: Settings;
  /** Partie en cours, ou null au menu principal. */
  readonly game: UiGame | null;
  /** Faux si les mondes ne survivront pas au rechargement de la page (IndexedDB indisponible). */
  readonly persistent: boolean;

  /** Image d'un objet (data URL PNG, à afficher en `image-rendering: pixelated`) ; chaîne vide pour l'id 0. */
  iconUrl(itemId: number): string;
  /** Image 16×16 d'une tuile de l'atlas (data URL PNG) : fonds de menu, etc. Voir T dans world/Tiles. */
  tileUrl(tile: number): string;
  /** Son de clic des boutons. */
  click(): void;

  listWorlds(): Promise<WorldInfo[]>;
  /** Crée un monde et lance la partie (l'écran de chargement est géré par l'application). */
  createWorld(options: NewWorldOptions): Promise<void>;
  playWorld(id: string): Promise<void>;
  deleteWorld(id: string): Promise<void>;
  renameWorld(id: string, name: string): Promise<void>;
  /** Télécharge le monde enregistré dans un fichier `.aetherworld` (sauvegarde externe). */
  exportWorld(id: string): Promise<void>;
  /** Ajoute comme nouveau monde celui que contient le fichier ; rend son identifiant. */
  importWorld(file: File): Promise<string>;
  /** Sauvegarde la partie en cours et revient au menu principal. */
  quitToTitle(): Promise<void>;
  /** À appeler après toute modification de `settings` : applique et enregistre. */
  settingsChanged(): void;
}

/** L'interface, vue par le jeu et l'application. */
export interface UiApi {
  /** Un écran capte le clavier et la souris : le jeu ne doit pas lire les entrées. */
  readonly modal: boolean;
  /** L'écran ouvert met le jeu en pause (pause, options ouvertes depuis la pause). */
  readonly pausing: boolean;

  /** Menu principal (liste des mondes, création, options). Cache le HUD et tout autre écran. */
  showTitle(): void;
  /** Écran de chargement plein écran. `progress` : 0..1. */
  showLoading(title: string, detail: string, progress: number): void;
  /** Cache le menu principal et l'écran de chargement, affiche le HUD : la partie commence. */
  showGame(): void;

  /** Ouvre l'écran d'un menu de cases (inventaire, créatif, établi, fourneau, coffre). */
  openMenu(menu: Menu): void;
  openPause(): void;
  /** Ouvre la saisie du chat, pré-remplie avec `initial` (« / » pour une commande). */
  openChat(initial?: string): void;
  /** Saisie du texte d'un panneau qui vient d'être posé (4 lignes de 15 caractères au plus). */
  openSignEditor(x: number, y: number, z: number, lines: readonly string[]): void;
  /** Écran d'échange avec un villageois (le jeu continue pendant ce temps). */
  openTrade(view: TradeView): void;
  /** Écran de mort. */
  showDeath(message: string): void;
  /** Ferme l'écran ouvert, sans rien demander au jeu. */
  closeScreen(): void;

  /** Ajoute une ligne au journal (chat) ; elle s'efface au bout de quelques secondes. */
  addMessage(text: string): void;
  /** Message bref au-dessus de la barre d'objets (« Vous ne pouvez dormir que la nuit »). */
  actionBar(text: string): void;
  /** Notification de progrès accompli en haut à droite de l'écran. */
  showAdvancement(title: string, detail: string, iconId: number): void;
  /** Affiche ou cache l'écran de débogage (F3). */
  toggleDebug(): void;
  /** Cache tout le HUD (F1). */
  setHudVisible(visible: boolean): void;

  /** À chaque image : rafraîchit le HUD et l'écran ouvert. */
  update(dt: number): void;
}
