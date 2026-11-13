/**
 * Vue d'une entité pour le rendu : ce que la logique de jeu expose à l'afficheur.
 * La logique met ces champs à jour à chaque tick (20 Hz) ; l'afficheur interpole
 * entre l'état précédent (p*) et l'état courant.
 */
import type { MobKind } from './MobModels';

export type EntityKind = 'mob' | 'player' | 'item' | 'falling_block' | 'arrow' | 'tnt';

export interface EntityView {
  /** Identifiant unique, stable pendant toute la vie de l'entité. */
  readonly id: number;
  readonly kind: EntityKind;
  /** Modèle à utiliser pour 'mob' et 'player'. */
  mobKind: MobKind;

  /** Position des pieds (centre de la base de la boîte) au tick précédent et au tick courant. */
  px: number;
  py: number;
  pz: number;
  x: number;
  y: number;
  z: number;

  /**
   * Orientation du corps en radians, précédente et courante.
   * Lacet 0 = regarde vers -z ; l'avant vaut (-sin(yaw), 0, -cos(yaw)).
   */
  pYaw: number;
  yaw: number;
  /** Orientation de la tête : lacet absolu (même convention) et tangage (positif = vers le haut). */
  pHeadYaw: number;
  headYaw: number;
  pHeadPitch: number;
  headPitch: number;

  /** Phase du cycle de marche (croît avec la distance parcourue) et amplitude 0..1, précédentes et courantes. */
  pLimbSwing: number;
  limbSwing: number;
  pLimbAmount: number;
  limbAmount: number;

  /** Ticks restants de l'éclair rouge après un coup (0 = aucun). */
  hurtTime: number;
  /** Ticks écoulés depuis la mort (0 = vivant) : le corps bascule sur le côté en 20 ticks. */
  deathTime: number;
  /** Ticks écoulés depuis l'apparition (flottement des objets, clignotement de la TNT). */
  age: number;
  /** Progression du coup porté par le bras, 0..1 (0 = au repos). */
  swing: number;

  /** Lumière à la position de l'entité : niveaux 0..15. */
  skyLight: number;
  blockLight: number;

  /** 'item' : identifiant de l'objet (bloc < 256 → mini-bloc, sinon icône plate) et quantité. Aussi : objet tenu par un 'mob' ou 'player' (0 = rien). */
  itemId: number;
  itemCount: number;
  /** 'falling_block' et 'tnt' : bloc et méta à afficher. */
  blockId: number;
  blockMeta: number;
  /** 'tnt' : ticks restants avant l'explosion. Creeper : gonflement 0..1. */
  fuse: number;
  /** Mouton : couleur de la laine (0xRRGGBB) et tonte. */
  woolColor: number;
  sheared: boolean;
  /** Accroupi (joueur) : le corps s'incline. */
  sneaking: boolean;
  /** Le maillage ne doit pas être dessiné (joueur en vue à la première personne). */
  hidden: boolean;
}
